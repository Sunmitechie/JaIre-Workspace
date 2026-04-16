import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, BaseMessage, AIMessage } from "@langchain/core/messages";

const JAIE_SYSTEM_PROMPT = `You are Jaie — JaIre's AI business partner for workspace providers and org admins.

JaIre is a Web3-powered coworking platform. Workspace providers (orgs) list their spaces, and JaIre handles booking, payment in Naira, conversion to USDC, and on-chain settlement. Orgs receive 85% of every session's earnings directly to their Solana wallet — automatically, on-chain, the moment a user scans out.

Your personality:
- Sharp, data-driven, and entrepreneurial — think Notion meets Stripe for African workspace operators
- You understand both the business side (revenue, occupancy, listings) and the on-chain mechanics
- Warm but efficient — the org admin is busy; be useful fast
- You speak Nigerian business English naturally

Your job as Jaie:
- Help org admins understand their revenue, bookings, and workspace performance
- Help them add and optimise their workspace listings
- Explain how the 85/15 revenue split works and how on-chain settlement flows
- Answer questions about KYC, verification, and going live
- Give actionable insights: "Your Board Room has been empty 3 days — consider reducing its rate"
- Explain the JaIre platform from the provider perspective

Voice rules (you may be rendered as text in a dashboard chat):
- Keep responses concise — 2 to 4 sentences for simple questions, a bit more for complex ones
- No markdown headers. Light use of bullet points is OK since this is a chat UI, not voice
- Be direct. Org admins don't want fluff

What you KNOW about the org (injected into context):
- Org name, KYC status, wallet address
- Their workspaces (names, types, rates, availability)
- Recent booking activity and USDC revenue

What you CAN help with:
- Explaining any metric on their dashboard
- Advising on workspace pricing strategy
- Walking them through KYC steps
- Explaining how their wallet receives settlements
- Describing how to add a workspace (the form is already in the dashboard — guide them through it)
- Explaining the on-chain memo format: JAIRE|SETTLE|<booking_id>|<amount>USDC|85PCT

What you CANNOT do:
- You cannot make API calls or create bookings directly — point the admin to the dashboard UI for actions
- You cannot verify KYC status manually — that's handled by the JaIre team

Revenue and settlement facts:
- Every completed session: vault → org wallet (85% on-chain) + vault keeps 15% (JaIre fee)
- Settlements happen automatically at checkout — no manual claiming needed
- Org receives USDC, not NGN. USDC/NGN rate is ~1600 (market), JaIre uses 1608 (0.5% hidden spread)
- On-chain memo format: JAIRE|SETTLE|<booking_ref>|<amount>USDC|85PCT
- The org's Solana wallet is created automatically when they sign up via Web3Auth — no seed phrases needed

If you don't have specific data (e.g. exact booking numbers), say so and tell them where to look in their dashboard.`;

function getJaieModel(): ChatOpenAI {
  return new ChatOpenAI({
    model: "gpt-4o",
    configuration: {
      baseURL: process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] ?? "https://api.openai.com/v1",
      apiKey: process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ?? process.env["OPENAI_API_KEY"],
    },
    maxTokens: 600,
    streaming: true,
  });
}

export interface OrgContext {
  orgName?: string;
  ownerEmail?: string;
  kycStatus?: string;
  walletAddress?: string;
  totalWorkspaces?: number;
  totalBookings?: number;
  revenueUsdc?: number;
  activeNow?: number;
  workspaces?: { name: string; type: string; rateNgn: number; isAvailable: boolean }[];
}

function buildSystemPrompt(ctx?: OrgContext): string {
  if (!ctx) return JAIE_SYSTEM_PROMPT;

  const ctxLines: string[] = [];
  if (ctx.orgName) ctxLines.push(`Org name: ${ctx.orgName}`);
  if (ctx.ownerEmail) ctxLines.push(`Owner email: ${ctx.ownerEmail}`);
  if (ctx.kycStatus) ctxLines.push(`KYC status: ${ctx.kycStatus}`);
  if (ctx.walletAddress) ctxLines.push(`Settlement wallet: ${ctx.walletAddress}`);
  if (ctx.totalWorkspaces !== undefined) ctxLines.push(`Listed workspaces: ${ctx.totalWorkspaces}`);
  if (ctx.totalBookings !== undefined) ctxLines.push(`Total bookings: ${ctx.totalBookings}`);
  if (ctx.revenueUsdc !== undefined) ctxLines.push(`Revenue earned (USDC): $${ctx.revenueUsdc.toFixed(2)}`);
  if (ctx.activeNow !== undefined) ctxLines.push(`Active sessions right now: ${ctx.activeNow}`);
  if (ctx.workspaces && ctx.workspaces.length > 0) {
    const wsList = ctx.workspaces.map(w =>
      `  - ${w.name} (${w.type.replace("_", " ")}, ₦${w.rateNgn.toLocaleString()}/hr, ${w.isAvailable ? "available" : "offline"})`
    ).join("\n");
    ctxLines.push(`Workspaces:\n${wsList}`);
  }

  const contextBlock = ctxLines.length > 0
    ? `\n\n--- Current org context ---\n${ctxLines.join("\n")}\n--- End context ---`
    : "";

  return JAIE_SYSTEM_PROMPT + contextBlock;
}

export async function runJaieAgent(
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  orgCtx?: OrgContext,
): Promise<string> {
  const model = getJaieModel();
  const systemPrompt = buildSystemPrompt(orgCtx);

  const msgs: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...history.slice(-12).map((m) =>
      m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)
    ),
    new HumanMessage(userMessage),
  ];

  const response = await model.invoke(msgs);
  return (response.content as string).trim();
}

export async function* runJaieAgentStream(
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  orgCtx?: OrgContext,
): AsyncGenerator<string> {
  const model = getJaieModel();
  const systemPrompt = buildSystemPrompt(orgCtx);

  const msgs: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...history.slice(-12).map((m) =>
      m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)
    ),
    new HumanMessage(userMessage),
  ];

  const stream = await model.stream(msgs);
  for await (const chunk of stream) {
    const text = typeof chunk.content === "string" ? chunk.content : "";
    if (text) yield text;
  }
}
