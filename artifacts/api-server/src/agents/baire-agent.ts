import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, SystemMessage, BaseMessage, AIMessage } from "@langchain/core/messages";
import { baireTools } from "./baire-tools.js";
import { getSolanaTools } from "./baire-solana.js";

const BAIRE_SYSTEM_PROMPT = `You are Baire — JaIre's warm, intelligent voice concierge for Blockchain Nomads.

JaIre is a premium coworking workspace platform where users pay in Nigerian Naira (NGN) and get credited in USDC through their invisible Solana wallets. No seed phrases, no complexity. Just book and work.

Your personality:
- Warm, professional, and concise — think Apple's polish meets PiggyVest's approachability
- Knowledgeable about both coworking and blockchain/Web3
- Enthusiastic about Nigeria's tech ecosystem and the Solana ecosystem
- You speak like a trusted friend who happens to know everything about JaIre

Your voice rules (CRITICAL — you are a voice agent):
- Keep responses SHORT — 1 to 3 sentences unless the user clearly needs more detail
- Never use bullet points, markdown, numbered lists, or special characters in your responses
- Speak naturally as if talking out loud
- When quoting prices, say "Naira" instead of "₦" and "USDC" clearly
- Round numbers for easy listening (say "about 9 USDC" not "9.0625 USDC")
- If a user asks for a list, describe the top options conversationally

What you CAN do:
- Discover and ACTUALLY book coworking spaces — do this when the user confirms they want to book
- Calculate prices and help users choose the right space
- Check wallet balances and payment status
- Look up booking status and on-chain transactions (use get_booking or list_user_bookings)
- Explain how JaIre works — the invisible Solana wallet, NGN-to-USDC conversion

Booking + payment flow (always follow this order):
1. User asks to book → use list_workspaces to find the right space
2. Calculate the price with calculate_booking_price
3. Tell the user the price in Naira and ask for confirmation
4. When they confirm → call book_and_pay with their details (workspace_id, hours, user_email, and user_wallet_address from context)
5. ALWAYS pass user_wallet_address if you have it — this enables instant wallet payment on-chain
6. If the result method is "wallet": share the Solana Explorer URL from the result and say exactly what happened on-chain (USDC amount, escrow tx link)
7. If the result method is "paystack": share the payment_url and say "Complete payment here — your session starts automatically once confirmed."
8. Never call create_booking or initiate_payment directly for bookings — always use book_and_pay.

On-chain awareness:
- After a wallet booking, ALWAYS tell the user the Solana Explorer URL for the escrow tx
- When asked about booking status, use get_booking with the booking_id to get the live on-chain state
- When asked "what's happened on-chain" or "show me my bookings", use list_user_bookings with user_email from context
- Share the full Solana Explorer URL verbatim — users can click it to verify their transaction

Wallet balance checks: use check_wallet_balance with the user's wallet address from context.
Payment status checks: use check_payment_status with a payment reference.
Never explain the USDC/FX mechanics in depth — just say "Naira payment" and "credits to your JaIre wallet".
Always use the user's name and email from context when booking or looking up their data.`;

function getBaireModel(): ChatOpenAI {
  return new ChatOpenAI({
    model: "gpt-4o",
    configuration: {
      baseURL: process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] ?? "https://api.openai.com/v1",
      apiKey: process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ?? process.env["OPENAI_API_KEY"],
    },
    maxTokens: 512,
    streaming: false,
  });
}

export interface UserContext {
  name?: string;
  email?: string;
  walletAddress?: string;
  walletBalanceUsdc?: number;
}

const NGN_PER_USDC = 1600;

function buildSystemPrompt(user?: UserContext): string {
  if (!user?.name && !user?.email) return BAIRE_SYSTEM_PROMPT;
  const balanceLine = typeof user.walletBalanceUsdc === "number"
    ? `\n- JaIre wallet balance: ${user.walletBalanceUsdc.toFixed(4)} USDC (₦${Math.round(user.walletBalanceUsdc * NGN_PER_USDC).toLocaleString()} Naira)`
    : "";
  const walletLine = user.walletAddress ? `\n- Wallet address: ${user.walletAddress} (pass this as user_wallet_address in book_and_pay)` : "";
  const userInfo = `\n\nCurrent user context:\n- Name: ${user.name ?? "unknown"}\n- Email: ${user.email ?? "unknown"}${walletLine}${balanceLine}\n\nAlways address them by first name. When they ask about their balance, use the JaIre wallet balance above — never show raw USDC, say "your JaIre balance is X Naira". When booking, ALWAYS pass user_wallet_address from context above.`;
  return BAIRE_SYSTEM_PROMPT + userInfo;
}

export async function runBaireAgent(
  userInput: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [],
  userContext?: UserContext
): Promise<string> {
  const model = getBaireModel();
  const tools = [...baireTools, ...getSolanaTools()];

  const agent = createReactAgent({ llm: model, tools });

  const messages: BaseMessage[] = [new SystemMessage(buildSystemPrompt(userContext))];

  for (const turn of conversationHistory) {
    if (turn.role === "user") {
      messages.push(new HumanMessage(turn.content));
    } else {
      messages.push(new AIMessage(turn.content));
    }
  }

  messages.push(new HumanMessage(userInput));

  const result = await agent.invoke({ messages });

  const lastMessage = result.messages[result.messages.length - 1];
  const responseText =
    typeof lastMessage?.content === "string"
      ? lastMessage.content
      : Array.isArray(lastMessage?.content)
        ? (lastMessage.content as Array<{ type: string; text?: string }>)
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("")
        : "";

  return responseText.trim();
}

export async function* runBaireAgentStream(
  userInput: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [],
  userContext?: UserContext
): AsyncGenerator<string> {
  // Groq streaming + LangGraph tool calling produces tool_use_failed errors.
  // Use the non-streaming invoke path which is stable, then yield word-by-word
  // for a natural streaming appearance in the UI.
  const response = await runBaireAgent(userInput, conversationHistory, userContext);
  if (!response) return;

  const words = response.split(/(\s+)/);
  for (const chunk of words) {
    if (chunk) {
      yield chunk;
      await new Promise((r) => setTimeout(r, 18));
    }
  }
}
