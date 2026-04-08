import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const PYTHON_API_BASE = "http://localhost:8000";

const WORKSPACES = [
  {
    id: "ws-001",
    name: "The Hub — Open Floor",
    description: "Vibrant open coworking area with high-speed Wi-Fi, natural lighting, and a buzzing community of builders.",
    amenities: ["High-speed Wi-Fi", "Power outlets", "Coffee bar", "Printing", "Lockers"],
    capacity: 40,
    hourly_rate_ngn: 1500,
    daily_rate_ngn: 8000,
    weekly_rate_ngn: 40000,
  },
  {
    id: "ws-002",
    name: "Founders Suite — Private Office",
    description: "Fully equipped private office for focused deep work. Perfect for solo founders and small teams.",
    amenities: ["Dedicated desk", "Meeting room access", "High-speed Wi-Fi", "Climate control", "Whiteboard"],
    capacity: 4,
    hourly_rate_ngn: 3500,
    daily_rate_ngn: 18000,
    weekly_rate_ngn: 80000,
  },
  {
    id: "ws-003",
    name: "Blockchain Lounge — Crypto Corner",
    description: "Our signature space for Web3 builders — multiple monitors, fast internet, and a community of on-chain natives.",
    amenities: ["Dual monitors", "Ultra-fast Wi-Fi (1Gbps)", "Hardware wallet-friendly setup", "24/7 access", "Community Slack"],
    capacity: 12,
    hourly_rate_ngn: 2500,
    daily_rate_ngn: 12000,
    weekly_rate_ngn: 55000,
  },
  {
    id: "ws-004",
    name: "Board Room — Premium Meeting",
    description: "Impress your clients and investors in our premium conference room with AV setup and whiteboard wall.",
    amenities: ["Projector & screen", "Video conferencing (Zoom/Meet)", "Whiteboard wall", "Catering available", "Receptionist support"],
    capacity: 12,
    hourly_rate_ngn: 8000,
    daily_rate_ngn: 50000,
    weekly_rate_ngn: null,
  },
];

const NGN_USDC_RATE = parseFloat(process.env["NGN_USDC_RATE"] ?? "1600");

export const listWorkspacesTool = new DynamicStructuredTool({
  name: "list_workspaces",
  description: "List all available JaIre coworking spaces with pricing and amenities. Call this when the user asks about spaces, options, or what's available.",
  schema: z.object({}),
  func: async () => {
    const summary = WORKSPACES.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      amenities: w.amenities,
      capacity: w.capacity,
      pricing: {
        hourly_ngn: w.hourly_rate_ngn,
        daily_ngn: w.daily_rate_ngn,
        weekly_ngn: w.weekly_rate_ngn,
        hourly_usdc: +(w.hourly_rate_ngn / NGN_USDC_RATE).toFixed(4),
        daily_usdc: +(w.daily_rate_ngn / NGN_USDC_RATE).toFixed(4),
        weekly_usdc: w.weekly_rate_ngn
          ? +(w.weekly_rate_ngn / NGN_USDC_RATE).toFixed(4)
          : null,
      },
    }));
    return JSON.stringify(summary, null, 2);
  },
});

export const calculateBookingPriceTool = new DynamicStructuredTool({
  name: "calculate_booking_price",
  description: "Calculate the price for booking a workspace. Returns NGN and USDC amounts.",
  schema: z.object({
    workspace_id: z.string().describe("The workspace ID from list_workspaces (e.g. ws-001)"),
    duration_hours: z.number().optional().describe("Number of hours to book (use for hourly bookings)"),
    duration_days: z.number().optional().describe("Number of days to book (use for daily/weekly bookings)"),
  }),
  func: async ({ workspace_id, duration_hours, duration_days }) => {
    const workspace = WORKSPACES.find((w) => w.id === workspace_id);
    if (!workspace) {
      return JSON.stringify({ error: `Workspace ${workspace_id} not found. Use list_workspaces to see available options.` });
    }

    let ngn_amount = 0;
    let description = "";

    if (duration_hours && duration_hours > 0) {
      ngn_amount = workspace.hourly_rate_ngn * duration_hours;
      description = `${duration_hours} hour${duration_hours > 1 ? "s" : ""} at ₦${workspace.hourly_rate_ngn.toLocaleString()}/hr`;
    } else if (duration_days && duration_days >= 7 && workspace.weekly_rate_ngn) {
      const weeks = Math.floor(duration_days / 7);
      ngn_amount = workspace.weekly_rate_ngn * weeks;
      description = `${weeks} week${weeks > 1 ? "s" : ""} at ₦${workspace.weekly_rate_ngn.toLocaleString()}/week`;
    } else if (duration_days && duration_days > 0) {
      ngn_amount = workspace.daily_rate_ngn * duration_days;
      description = `${duration_days} day${duration_days > 1 ? "s" : ""} at ₦${workspace.daily_rate_ngn.toLocaleString()}/day`;
    } else {
      return JSON.stringify({ error: "Please provide either duration_hours or duration_days." });
    }

    const usdc_amount = +(ngn_amount / NGN_USDC_RATE).toFixed(4);

    return JSON.stringify({
      workspace: workspace.name,
      booking: description,
      ngn_amount,
      usdc_amount,
      exchange_rate: `₦${NGN_USDC_RATE}/USDC`,
      note: "Payment can be made in Naira via Paystack or Roqqu — USDC is automatically credited to your JaIre wallet.",
    });
  },
});

export const checkWalletBalanceTool = new DynamicStructuredTool({
  name: "check_wallet_balance",
  description: "Check a user's USDC wallet balance on JaIre. Use when the user asks about their balance, how much they have, or their wallet.",
  schema: z.object({
    user_identifier: z.string().describe("The user's email address or phone number"),
  }),
  func: async ({ user_identifier }) => {
    try {
      const response = await fetch(`${PYTHON_API_BASE}/jaire/wallet/balance?identifier=${encodeURIComponent(user_identifier)}`);
      if (!response.ok) {
        return JSON.stringify({ error: "Could not retrieve wallet balance. Please ensure the account exists." });
      }
      const data = await response.json() as Record<string, unknown>;
      return JSON.stringify(data);
    } catch {
      return JSON.stringify({ error: "Wallet service temporarily unavailable. Please try again shortly." });
    }
  },
});

export const getExchangeRateTool = new DynamicStructuredTool({
  name: "get_exchange_rate",
  description: "Get the current NGN to USDC exchange rate used by JaIre for payments.",
  schema: z.object({}),
  func: async () => {
    return JSON.stringify({
      ngn_per_usdc: NGN_USDC_RATE,
      usdc_per_ngn: +(1 / NGN_USDC_RATE).toFixed(8),
      note: "JaIre uses a fixed internal rate. This rate is periodically updated to reflect market conditions.",
      example: `₦${NGN_USDC_RATE.toLocaleString()} → 1 USDC`,
    });
  },
});

export const getJaireInfoTool = new DynamicStructuredTool({
  name: "get_jaire_info",
  description: "Get general information about JaIre — what it is, how it works, payment methods, and the Solana wallet system. Use when users ask how JaIre works.",
  schema: z.object({
    topic: z.enum(["general", "payments", "wallet", "solana", "booking", "all"]).optional().describe("Specific topic to explain"),
  }),
  func: async ({ topic = "general" }) => {
    const info: Record<string, unknown> = {
      general: {
        name: "JaIre",
        tagline: "Premium coworking for Blockchain Nomads",
        description: "JaIre is a Web2.5 coworking platform where digital nomads and blockchain builders can book premium workspace by the hour, day, or week. You pay in Nigerian Naira — we handle the crypto magic behind the scenes.",
        locations: ["Lagos Island", "Victoria Island (coming soon)", "Lekki (coming soon)"],
        target_users: "Blockchain developers, DeFi traders, Web3 founders, and tech-forward nomads",
      },
      payments: {
        how_it_works: "Pay in Naira via bank transfer, card, or crypto — JaIre automatically converts to USDC and credits your wallet.",
        accepted_methods: ["Paystack (card/bank)", "Roqqu (NGN/crypto)", "Direct USDC transfer"],
        currency: "All prices shown in NGN. USDC equivalents calculated at current rate.",
        rate: `₦${NGN_USDC_RATE}/USDC`,
      },
      wallet: {
        type: "Invisible Solana wallet (MPC-based — you don't need to manage keys)",
        powered_by: "Web3Auth MPC — your wallet is secured by multi-party computation",
        access: "Log in with email or phone — your wallet is automatically created",
        token: "USDC on Solana (SPL token)",
        view_on_explorer: "All transactions are visible on Solscan (devnet during testing)",
      },
      solana: {
        network: "Solana blockchain (currently on devnet, mainnet at launch)",
        why_solana: "Fast finality (~400ms), sub-cent transaction fees, and growing DeFi ecosystem",
        usdc: "USD Coin (USDC) on Solana — stable, liquid, and globally accepted",
        future_features: ["Kamino Finance yield on idle USDC", "Solana Blinks for social media booking", "IoT smart plug access control"],
      },
      booking: {
        process: ["1. Choose your space", "2. Pay in Naira", "3. USDC credited instantly", "4. Access unlocked via IoT smart plug"],
        cancellation: "Cancel up to 2 hours before with full refund in USDC",
        extensions: "Extend your booking anytime — Baire can help you do it in seconds",
      },
    };

    if (topic === "all") {
      return JSON.stringify(info, null, 2);
    }
    return JSON.stringify(info[topic] ?? info.general, null, 2);
  },
});

export const baireTools = [
  listWorkspacesTool,
  calculateBookingPriceTool,
  checkWalletBalanceTool,
  getExchangeRateTool,
  getJaireInfoTool,
];
