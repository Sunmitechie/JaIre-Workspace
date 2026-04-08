import { Router } from "express";
import { ConnectWalletBody, FundWalletBody } from "@workspace/api-zod";

const router = Router();

const NGN_PER_USDC = 1600;

router.post("/connect", async (req, res) => {
  try {
    const body = ConnectWalletBody.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid request" });
    }

    res.json({
      public_key: "JDtjhBDwv3WwJpQR1LAcC9kTCwr4sbZhdEYVmKPcxRE",
      wallet_type: "mpc",
      balance_usdc: 12.5,
      balance_sol: 0.1,
      verifier_id: body.data.web3auth_token.slice(0, 16),
      connected: true,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to connect wallet" });
  }
});

router.get("/balance", async (req, res) => {
  try {
    res.json({
      public_key: "JDtjhBDwv3WwJpQR1LAcC9kTCwr4sbZhdEYVmKPcxRE",
      balance_usdc: 12.5,
      balance_sol: 0.1,
      last_updated: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get balance" });
  }
});

router.post("/fund", async (req, res) => {
  try {
    const body = FundWalletBody.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const { amount_ngn, payment_method } = body.data;
    const estimatedUsdc = parseFloat((amount_ngn / NGN_PER_USDC).toFixed(4));
    const reference = `JAIRE-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    res.json({
      payment_url: `https://checkout.paystack.com/demo?ref=${reference}&amount=${amount_ngn}`,
      reference,
      amount_ngn,
      estimated_usdc: estimatedUsdc,
      exchange_rate: NGN_PER_USDC,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to initiate funding" });
  }
});

export default router;
