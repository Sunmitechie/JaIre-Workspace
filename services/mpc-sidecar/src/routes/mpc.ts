import { Router, Request, Response } from "express";
import {
  verifyWeb3AuthJWT,
  deriveUserFactorShare,
  getUserWalletAddress,
  isRegisteredUser,
} from "../services/mpc-service.js";
import {
  getWalletBalance,
  fundUserWallet,
  signUserUSDCTransfer,
} from "../services/solana-wallet.js";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
//  Factor & wallet identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /mpc/factor-share
 *
 * Provide the server's key-factor share to an authenticated Web3Auth user.
 * The frontend MPC Core Kit SDK combines this share with:
 *   - The Web3Auth network TSS shares
 *   - The user's device share (or social recovery share)
 * to reach the signing threshold.
 *
 * Body: { id_token: string }
 * Returns: { factor_share, wallet_address, verifier_id }
 */
router.post("/factor-share", async (req: Request, res: Response) => {
  try {
    const { id_token } = req.body as { id_token?: string };
    if (!id_token) {
      res.status(400).json({ error: "id_token is required" });
      return;
    }

    const user = await verifyWeb3AuthJWT(id_token);
    const verifierId = user.verifierId ?? user.sub;

    if (!isRegisteredUser(verifierId)) {
      res.status(403).json({ error: "User not registered with this factor" });
      return;
    }

    const factorShare = deriveUserFactorShare(verifierId);
    const walletAddress = getUserWalletAddress(verifierId);

    res.json({
      factor_share: factorShare,
      wallet_address: walletAddress,
      verifier_id: verifierId,
      version: "v1",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mpc/factor-share] error:", message);
    res.status(401).json({ error: `Authentication failed: ${message}` });
  }
});

/**
 * POST /mpc/wallet
 *
 * Derive and return the server-side wallet address for a user.
 *
 * Body: { id_token: string }
 * Returns: { wallet_address, verifier_id, email, name }
 */
router.post("/wallet", async (req: Request, res: Response) => {
  try {
    const { id_token } = req.body as { id_token?: string };
    if (!id_token) {
      res.status(400).json({ error: "id_token is required" });
      return;
    }

    const user = await verifyWeb3AuthJWT(id_token);
    const verifierId = user.verifierId ?? user.sub;
    const walletAddress = getUserWalletAddress(verifierId);

    res.json({
      wallet_address: walletAddress,
      verifier_id: verifierId,
      email: user.email,
      name: user.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(401).json({ error: `Authentication failed: ${message}` });
  }
});

/**
 * POST /mpc/verify-token
 *
 * Internal endpoint — Python API verifies a Web3Auth token and gets user
 * identity without exposing the factor key.
 *
 * Body: { id_token: string }
 * Returns: { sub, email, name, verifier_id, wallet_address, verified }
 */
router.post("/verify-token", async (req: Request, res: Response) => {
  try {
    const { id_token } = req.body as { id_token?: string };
    if (!id_token) {
      res.status(400).json({ error: "id_token is required" });
      return;
    }

    const user = await verifyWeb3AuthJWT(id_token);
    const verifierId = user.verifierId ?? user.sub;
    const walletAddress = getUserWalletAddress(verifierId);

    res.json({
      sub: user.sub,
      email: user.email,
      name: user.name,
      verifier_id: verifierId,
      wallet_address: walletAddress,
      verified: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(401).json({ error: `Token verification failed: ${message}`, verified: false });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Wallet operations (balance, fund, sign)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /mpc/wallet-balance
 *
 * Return the SOL and USDC balance for a Web3Auth user's invisible wallet.
 * Useful for the frontend to show "You have X USDC" before booking.
 *
 * Body: { id_token: string, mint?: string }
 * Returns: { wallet_address, sol_balance, usdc_balance, usdc_mint }
 */
router.post("/wallet-balance", async (req: Request, res: Response) => {
  try {
    const { id_token, mint } = req.body as { id_token?: string; mint?: string };
    if (!id_token) {
      res.status(400).json({ error: "id_token is required" });
      return;
    }

    const user = await verifyWeb3AuthJWT(id_token);
    const verifierId = user.verifierId ?? user.sub;
    const walletAddress = getUserWalletAddress(verifierId);

    const balance = await getWalletBalance(walletAddress, mint);

    res.json({
      ...balance,
      verifier_id: verifierId,
      email: user.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mpc/wallet-balance] error:", message);
    res.status(400).json({ error: message });
  }
});

/**
 * POST /mpc/fund-wallet
 *
 * Transfer USDC from the JaIre treasury to a user's invisible wallet.
 * Called automatically after a successful Paystack/Roqqu payment.
 *
 * Devnet: real on-chain transfer using treasury keypair
 * Test mode (is_simulated=true): returns a fake TX signature
 *
 * Body: { id_token: string, amount_usdc: number, is_simulated?: boolean, mint?: string }
 * Returns: { success, tx_signature, amount_usdc, wallet_address, is_simulated }
 */
router.post("/fund-wallet", async (req: Request, res: Response) => {
  try {
    const { id_token, amount_usdc, is_simulated, mint } = req.body as {
      id_token?: string;
      amount_usdc?: number;
      is_simulated?: boolean;
      mint?: string;
    };

    if (!id_token) {
      res.status(400).json({ error: "id_token is required" });
      return;
    }
    if (!amount_usdc || amount_usdc <= 0) {
      res.status(400).json({ error: "amount_usdc must be > 0" });
      return;
    }

    const user = await verifyWeb3AuthJWT(id_token);
    const verifierId = user.verifierId ?? user.sub;
    const walletAddress = getUserWalletAddress(verifierId);

    const result = await fundUserWallet(
      walletAddress,
      amount_usdc,
      mint,
      is_simulated ?? false,
    );

    console.log(
      `[mpc/fund-wallet] ${result.is_simulated ? "SIMULATED" : "LIVE"} ` +
      `${amount_usdc} USDC → ${walletAddress.slice(0, 8)}... ` +
      `tx=${result.tx_signature}`,
    );

    res.json({
      ...result,
      verifier_id: verifierId,
      email: user.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mpc/fund-wallet] error:", message);
    res.status(400).json({ error: message });
  }
});

/**
 * POST /mpc/sign-usdc-transfer
 *
 * Co-sign a USDC transfer from the user's invisible wallet to the escrow.
 * Called during check-in to move pre-payment from user wallet → treasury escrow.
 *
 * In devnet simulation the server derives the full user keypair (from the node
 * factor key) and signs on the user's behalf. On mainnet this becomes a proper
 * TSS co-sign ceremony where no party ever holds the full private key.
 *
 * Body: {
 *   id_token:      string  — Web3Auth JWT
 *   to_address:    string  — destination (treasury escrow address)
 *   amount_usdc:   number  — amount to transfer
 *   is_simulated?: boolean — skip real chain call (default: false)
 *   mint?:         string  — USDC mint override
 * }
 * Returns: { success, tx_signature, from_address, to_address, amount_usdc }
 */
router.post("/sign-usdc-transfer", async (req: Request, res: Response) => {
  try {
    const { id_token, to_address, amount_usdc, is_simulated, mint } = req.body as {
      id_token?: string;
      to_address?: string;
      amount_usdc?: number;
      is_simulated?: boolean;
      mint?: string;
    };

    if (!id_token) { res.status(400).json({ error: "id_token is required" }); return; }
    if (!to_address) { res.status(400).json({ error: "to_address is required" }); return; }
    if (!amount_usdc || amount_usdc <= 0) { res.status(400).json({ error: "amount_usdc must be > 0" }); return; }

    const user = await verifyWeb3AuthJWT(id_token);
    const verifierId = user.verifierId ?? user.sub;

    const result = await signUserUSDCTransfer(
      verifierId,
      to_address,
      amount_usdc,
      mint,
      is_simulated ?? false,
    );

    console.log(
      `[mpc/sign-usdc-transfer] ${result.is_simulated ? "SIMULATED" : "LIVE"} ` +
      `${amount_usdc} USDC ${result.from_address.slice(0, 8)}→${to_address.slice(0, 8)} ` +
      `tx=${result.tx_signature}`,
    );

    res.json({
      ...result,
      verifier_id: verifierId,
      email: user.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mpc/sign-usdc-transfer] error:", message);
    res.status(400).json({ error: message });
  }
});

export default router;
