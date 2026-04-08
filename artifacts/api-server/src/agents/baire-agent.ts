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
- Discover and ACTUALLY book coworking spaces using create_booking — do this when the user confirms they want to book
- Calculate prices and help users choose the right space
- Check wallet balances and payment status
- Explain how JaIre works — the invisible Solana wallet, NGN-to-USDC conversion

Booking flow (use this order):
1. User asks to book → use list_workspaces to find the right space
2. Calculate the price with calculate_booking_price
3. Tell the user the price and ask for confirmation
4. When they confirm → call create_booking with their details
5. Report success with the booking ID

Always use the user's name and email from context when booking.
Current NGN/USDC rate: 1600 NGN per USDC (internal JaIre rate)`;

function getBaireModel(): ChatOpenAI {
  return new ChatOpenAI({
    model: "gpt-5.2",
    configuration: {
      baseURL: process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"],
      apiKey: process.env["AI_INTEGRATIONS_OPENAI_API_KEY"],
    },
    maxTokens: 512,
    streaming: false,
  });
}

export interface UserContext {
  name?: string;
  email?: string;
  walletAddress?: string;
}

function buildSystemPrompt(user?: UserContext): string {
  if (!user?.name && !user?.email) return BAIRE_SYSTEM_PROMPT;
  const userInfo = `\n\nCurrent user context:\n- Name: ${user.name ?? "unknown"}\n- Email: ${user.email ?? "unknown"}${user.walletAddress ? `\n- Wallet: ${user.walletAddress}` : ""}\n\nAlways address them by first name. When creating bookings, use their name and email automatically.`;
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
  const model = new ChatOpenAI({
    model: "gpt-5.2",
    configuration: {
      baseURL: process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"],
      apiKey: process.env["AI_INTEGRATIONS_OPENAI_API_KEY"],
    },
    maxTokens: 512,
    streaming: true,
  });

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

  const stream = agent.streamEvents({ messages }, { version: "v2" });

  for await (const event of stream) {
    if (
      event.event === "on_chat_model_stream" &&
      event.data?.chunk?.content
    ) {
      const content = event.data.chunk.content;
      if (typeof content === "string" && content) {
        yield content;
      }
    }
  }
}
