import { Router } from "express";
import { ConnectWalletBody, FundWalletBody } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

const MPC_SIDECAR = "http://localhost:9000";
const JAIRE_RATE = 1608; // NGN per USDC (market 1600 + 0.5% spread)

// ── POST /wallet/connect ───────────────────────────────────────────────────
// Verifies a Web3Auth token via MPC sidecar and upserts the user record
router.post("/connect", async (req, res) => {
  try {
    const body = ConnectWalletBody.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const { web3auth_token, email, name } = body.data as any;

    // Get wallet address from MPC sidecar
    const mpcRes = await fetch(`${MPC_SIDECAR}/mpc/wallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: web3auth_token }),
    });

    if (!mpcRes.ok) {
      const err = await mpcRes.json() as any;
      return res.status(502).json({ error: err.error ?? "MPC wallet error" });
    }

    const mpcData = (await mpcRes.json()) as {
      wallet_address: string;
      verifier_id: string;
      email?: string;
      name?: string;
    };

    // Fetch real balance
    const balRes = await fetch(
      `${MPC_SIDECAR}/mpc/balance/${mpcData.wallet_address}`,
    );
    const balance = balRes.ok
      ? ((await balRes.json()) as { sol_balance: number; usdc_balance: number })
      : { sol_balance: 0, usdc_balance: 0 };

    // Upsert user record
    await db
      .insert(users)
      .values({
        email: email ?? mpcData.email ?? mpcData.verifier_id,
        name: name ?? mpcData.name,
        walletAddress: mpcData.wallet_address,
        verifierId: mpcData.verifier_id,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          walletAddress: mpcData.wallet_address,
          verifierId: mpcData.verifier_id,
          updatedAt: new Date(),
        },
      });

    res.json({
      public_key: mpcData.wallet_address,
      wallet_type: "mpc",
      balance_usdc: balance.usdc_balance,
      balance_sol: balance.sol_balance,
      verifier_id: mpcData.verifier_id,
      connected: true,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to connect wallet" });
  }
});

// ── GET /wallet/balance ────────────────────────────────────────────────────
// Returns real devnet balance for a wallet address passed in query params
router.get("/balance", async (req, res) => {
  try {
    const address = (req.query["address"] as string) || (req.query["wallet"] as string);

    if (!address) {
      return res.status(400).json({ error: "wallet address is required (?address=...)" });
    }

    const balRes = await fetch(`${MPC_SIDECAR}/mpc/balance/${address}`);

    if (!balRes.ok) {
      const text = await balRes.text();
      return res.status(502).json({ error: `MPC sidecar error: ${text}` });
    }

    const balance = (await balRes.json()) as {
      wallet_address: string;
      sol_balance: number;
      usdc_balance: number;
      usdc_mint: string;
    };

    res.json({
      public_key: balance.wallet_address,
      balance_usdc: balance.usdc_balance,
      balance_sol: balance.sol_balance,
      usdc_mint: balance.usdc_mint,
      last_updated: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to get balance" });
  }
});

// ── POST /wallet/fund ──────────────────────────────────────────────────────
// Initiates a real Paystack payment to fund the user's wallet with USDC
router.post("/fund", async (req, res) => {
  try {
    const body = FundWalletBody.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const { amount_ngn } = body.data;
    const { user_email, user_wallet_address, callback_url } = req.body as {
      user_email?: string;
      user_wallet_address?: string;
      callback_url?: string;
    };

    if (!user_email) {
      return res.status(400).json({ error: "user_email is required" });
    }

    // Delegate to payments/initiate
    const initRes = await fetch(
      `http://localhost:${process.env["PORT"] ?? 8080}/api/payments/initiate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_ngn,
          user_email,
          user_wallet_address,
          callback_url,
        }),
      },
    );

    if (!initRes.ok) {
      const err = (await initRes.json()) as any;
      return res.status(initRes.status).json(err);
    }

    const data = (await initRes.json()) as any;

    res.json({
      payment_url: data.payment_url,
      reference: data.reference,
      amount_ngn,
      estimated_usdc: data.amount_usdc,
      exchange_rate: JAIRE_RATE,
      access_code: data.access_code,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to initiate funding" });
  }
});

export default router;
