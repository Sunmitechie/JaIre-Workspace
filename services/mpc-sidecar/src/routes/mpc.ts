import { Router, Request, Response } from "express";
import {
  verifyWeb3AuthJWT,
  deriveUserFactorShare,
  getUserWalletAddress,
  isRegisteredUser,
  deriveUserDevnetKeypair,
} from "../services/mpc-service.js";
import {
  getWalletBalance,
  fundUserWallet,
  vaultFundUser,
  signUserUSDCTransfer,
  vaultToUserTransfer,
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

/**
 * POST /mpc/internal/escrow   [INTERNAL — server-to-server only]
 *
 * Move USDC from a user's derived devnet wallet into the JaIre vault (escrow).
 * Called after a confirmed Paystack payment when a booking_id is linked.
 *
 * Body: { verifier_id: string, amount_usdc: number, mint?: string }
 */
router.post("/internal/escrow", async (req: Request, res: Response) => {
  try {
    const { verifier_id, amount_usdc, mint } = req.body as {
      verifier_id?: string;
      amount_usdc?: number;
      mint?: string;
    };

    if (!verifier_id) { res.status(400).json({ error: "verifier_id required" }); return; }
    if (!amount_usdc || amount_usdc <= 0) { res.status(400).json({ error: "amount_usdc must be > 0" }); return; }

    const vaultAddress = process.env["JAIRE_VAULT_ADDRESS"];
    if (!vaultAddress) { res.status(500).json({ error: "JAIRE_VAULT_ADDRESS not set" }); return; }

    const result = await signUserUSDCTransfer(verifier_id, vaultAddress, amount_usdc, mint, false);

    console.log(
      `[mpc/internal/escrow] ${result.is_simulated ? "SIM" : "LIVE"} ` +
      `${amount_usdc} USDC → vault tx=${result.tx_signature}`,
    );

    res.json({ ...result, vault_address: vaultAddress });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mpc/internal/escrow] error:", message);
    res.status(400).json({ error: message });
  }
});

/**
 * POST /mpc/vault-settle   [INTERNAL — server-to-server only]
 *
 * Return USDC from the vault back to a user wallet (checkout refund).
 * The vault keeps the billed amount; only the excess is returned.
 *
 * Body: { to_address: string, amount_usdc: number, mint?: string }
 */
router.post("/vault-settle", async (req: Request, res: Response) => {
  try {
    const { to_address, amount_usdc, mint } = req.body as {
      to_address?: string;
      amount_usdc?: number;
      mint?: string;
    };

    if (!to_address) { res.status(400).json({ error: "to_address required" }); return; }
    if (amount_usdc === undefined || amount_usdc < 0) { res.status(400).json({ error: "amount_usdc must be >= 0" }); return; }

    if (amount_usdc === 0) {
      res.json({ success: true, tx_signature: null, amount_usdc: 0, message: "No refund needed" });
      return;
    }

    const result = await vaultToUserTransfer(to_address, amount_usdc, mint);

    console.log(
      `[mpc/vault-settle] ${result.is_simulated ? "SIM" : "LIVE"} ` +
      `${amount_usdc} USDC → ${to_address.slice(0, 8)}... tx=${result.tx_signature}`,
    );

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mpc/vault-settle] error:", message);
    res.status(400).json({ error: message });
  }
});

/**
 * POST /mpc/fund-by-address   [INTERNAL — server-to-server only]
 *
 * Fund a wallet by address directly. Used by the payments webhook after
 * a successful Paystack charge — no user JWT required.
 *
 * Body: { wallet_address: string, usdc_amount: number, reference?: string, mint?: string }
 */
router.post("/fund-by-address", async (req: Request, res: Response) => {
  try {
    const { wallet_address, usdc_amount, reference, mint } = req.body as {
      wallet_address?: string;
      usdc_amount?: number;
      reference?: string;
      mint?: string;
    };

    if (!wallet_address) { res.status(400).json({ error: "wallet_address required" }); return; }
    if (!usdc_amount || usdc_amount <= 0) { res.status(400).json({ error: "usdc_amount must be > 0" }); return; }

    const result = await fundUserWallet(wallet_address, usdc_amount, mint);

    if (result.tx_signature) {
      console.log(
        `[mpc/fund-by-address] ${result.is_simulated ? "SIM" : "LIVE"} ` +
        `${usdc_amount} USDC → ${wallet_address.slice(0, 8)}... ref=${reference ?? "none"} tx=${result.tx_signature}`,
      );
    } else {
      console.error(
        `[mpc/fund-by-address] FAILED ${usdc_amount} USDC → ${wallet_address.slice(0, 8)}... ref=${reference ?? "none"} error=${result.error}`,
      );
    }

    res.json({ ...result, wallet_address, reference });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mpc/fund-by-address] error:", message);
    res.status(400).json({ error: message });
  }
});

/**
 * GET /mpc/balance/:address   [INTERNAL — server-to-server only]
 *
 * Return SOL + USDC balance for any wallet address without a JWT.
 */
router.get("/balance/:address", async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const balance = await getWalletBalance(address);
    res.json(balance);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

export default router;
