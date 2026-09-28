import { Router, Request, Response } from "express";
import {
  verifyWeb3AuthJWT,
  deriveUserFactorShare,
  getUserWalletAddress,
  isRegisteredUser,
  deriveUserDevnetKeypair,
} from "../services/mpc-service.js";
import { logger } from "../lib/logger.js";
import {
  getWalletBalance,
  fundUserWallet,
  vaultFundUser,
  signUserUSDCTransfer,
  vaultToUserTransfer,
} from "../services/solana-wallet.js";
import { initializeEscrow, settleSession } from "../services/anchor-escrow.js";

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
    logger.error({ err }, "[mpc/factor-share] error");
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
    logger.error({ err }, "[mpc/wallet-balance] error");
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

    logger.info({
      isSimulated: result.is_simulated,
      amountUsdc: amount_usdc,
      walletPrefix: walletAddress.slice(0, 8),
      txSignature: result.tx_signature,
    }, "[mpc/fund-wallet] Wallet funding complete");

    res.json({
      ...result,
      verifier_id: verifierId,
      email: user.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[mpc/fund-wallet] error");
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

    logger.info({
      isSimulated: result.is_simulated,
      amountUsdc: amount_usdc,
      fromPrefix: result.from_address.slice(0, 8),
      toPrefix: to_address.slice(0, 8),
      txSignature: result.tx_signature,
    }, "[mpc/sign-usdc-transfer] USDC transfer signed");

    res.json({
      ...result,
      verifier_id: verifierId,
      email: user.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[mpc/sign-usdc-transfer] error");
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
    const { verifier_id, amount_usdc, mint, memo } = req.body as {
      verifier_id?: string;
      amount_usdc?: number;
      mint?: string;
      memo?: string;
    };

    if (!verifier_id) { res.status(400).json({ error: "verifier_id required" }); return; }
    if (!amount_usdc || amount_usdc <= 0) { res.status(400).json({ error: "amount_usdc must be > 0" }); return; }

    const vaultAddress = process.env["JAIRE_VAULT_ADDRESS"];
    if (!vaultAddress) { res.status(500).json({ error: "JAIRE_VAULT_ADDRESS not set" }); return; }

    const result = await signUserUSDCTransfer(verifier_id, vaultAddress, amount_usdc, mint, false, memo);

    logger.info({
      isSimulated: result.is_simulated,
      amountUsdc: amount_usdc,
      txSignature: result.tx_signature,
    }, "[mpc/internal/escrow] Escrow transfer complete");

    res.json({ ...result, vault_address: vaultAddress });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[mpc/internal/escrow] error");
    res.status(400).json({ error: message });
  }
});

/**
 * POST /mpc/escrow/initialize   [INTERNAL — server-to-server only]
 *
 * Lock user USDC into session escrow at QR check-in.
 * User's MPC-derived keypair signs the transfer; treasury pays gas.
 *
 * Body: {
 *   verifier_id:         string   Web3Auth verifier ID
 *   user_wallet_address: string   User's on-chain wallet
 *   booking_id:          string   Booking UUID
 *   planned_seconds:     number   Pre-paid duration in seconds
 *   escrow_usdc:         number   USDC to lock
 *   mint?:               string   Token mint (defaults to JAIRE_TEST_MINT)
 * }
 */
router.post("/escrow/initialize", async (req: Request, res: Response) => {
  try {
    const { verifier_id, user_wallet_address, booking_id, planned_seconds, escrow_usdc, mint } = req.body as {
      verifier_id?:         string;
      user_wallet_address?: string;
      booking_id?:          string;
      planned_seconds?:     number;
      escrow_usdc?:         number;
      mint?:                string;
    };

    if (!verifier_id)         { res.status(400).json({ error: "verifier_id required" });         return; }
    if (!user_wallet_address) { res.status(400).json({ error: "user_wallet_address required" }); return; }
    if (!booking_id)          { res.status(400).json({ error: "booking_id required" });           return; }
    if (!planned_seconds || planned_seconds <= 0) { res.status(400).json({ error: "planned_seconds must be > 0" }); return; }
    if (!escrow_usdc || escrow_usdc <= 0)         { res.status(400).json({ error: "escrow_usdc must be > 0" });     return; }

    const result = await initializeEscrow(
      verifier_id, user_wallet_address, booking_id, planned_seconds, escrow_usdc, mint,
    );

    if (!result.success) {
      res.status(500).json(result);
      return;
    }

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[mpc/escrow/initialize] error");
    res.status(500).json({ error: message });
  }
});

/**
 * POST /mpc/escrow/settle   [INTERNAL — server-to-server only]
 *
 * Atomically settle session escrow at QR check-out:
 *   vault → 85 % org wallet + refund → user wallet + 15 % stays in vault.
 *
 * Body: {
 *   user_wallet_address:  string   User's on-chain wallet
 *   booking_id:           string   Booking UUID
 *   deposit_usdc:         number   USDC locked at check-in
 *   planned_seconds:      number   Pre-paid duration
 *   duration_seconds:     number   Actual billed duration (from MQTT)
 *   org_wallet_address:   string   Org owner wallet for 85 %
 *   mint?:                string   Token mint
 * }
 */
router.post("/escrow/settle", async (req: Request, res: Response) => {
  try {
    const {
      user_wallet_address, booking_id, deposit_usdc,
      planned_seconds, duration_seconds, org_wallet_address, mint,
    } = req.body as {
      user_wallet_address?:  string;
      booking_id?:           string;
      deposit_usdc?:         number;
      planned_seconds?:      number;
      duration_seconds?:     number;
      org_wallet_address?:   string;
      mint?:                 string;
    };

    if (!user_wallet_address)  { res.status(400).json({ error: "user_wallet_address required" });  return; }
    if (!booking_id)           { res.status(400).json({ error: "booking_id required" });            return; }
    if (deposit_usdc === undefined || deposit_usdc <= 0) { res.status(400).json({ error: "deposit_usdc must be > 0" }); return; }
    if (!planned_seconds || planned_seconds <= 0)        { res.status(400).json({ error: "planned_seconds required" });  return; }
    if (duration_seconds === undefined || duration_seconds < 0) { res.status(400).json({ error: "duration_seconds required" }); return; }
    if (!org_wallet_address)   { res.status(400).json({ error: "org_wallet_address required" });    return; }

    const result = await settleSession(
      user_wallet_address, booking_id, deposit_usdc,
      planned_seconds, duration_seconds, org_wallet_address, mint,
    );

    if (!result.success) {
      res.status(500).json(result);
      return;
    }

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[mpc/escrow/settle] error");
    res.status(500).json({ error: message });
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
    const { to_address, amount_usdc, mint, memo } = req.body as {
      to_address?: string;
      amount_usdc?: number;
      mint?: string;
      memo?: string;
    };

    if (!to_address) { res.status(400).json({ error: "to_address required" }); return; }
    if (amount_usdc === undefined || amount_usdc < 0) { res.status(400).json({ error: "amount_usdc must be >= 0" }); return; }

    if (amount_usdc === 0) {
      res.json({ success: true, tx_signature: null, amount_usdc: 0, message: "No refund needed" });
      return;
    }

    const result = await vaultToUserTransfer(to_address, amount_usdc, mint, memo);

    logger.info({
      isSimulated: result.is_simulated,
      amountUsdc: amount_usdc,
      toPrefix: to_address.slice(0, 8),
      txSignature: result.tx_signature,
    }, "[mpc/vault-settle] Vault refund complete");

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[mpc/vault-settle] error");
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
    const { wallet_address, usdc_amount, reference, mint, memo } = req.body as {
      wallet_address?: string;
      usdc_amount?: number;
      reference?: string;
      mint?: string;
      memo?: string;
    };

    if (!wallet_address) { res.status(400).json({ error: "wallet_address required" }); return; }
    if (!usdc_amount || usdc_amount <= 0) { res.status(400).json({ error: "usdc_amount must be > 0" }); return; }

    const effectiveMemo = memo ?? (reference ? `JAIRE|FUND|${reference}|${usdc_amount}USDC` : undefined);
    const result = await fundUserWallet(wallet_address, usdc_amount, mint, false, effectiveMemo);

    if (result.tx_signature) {
      logger.info({
        isSimulated: result.is_simulated,
        amountUsdc: usdc_amount,
        walletPrefix: wallet_address.slice(0, 8),
        reference: reference ?? "none",
        txSignature: result.tx_signature,
      }, "[mpc/fund-by-address] Direct funding complete");
    } else {
      logger.error({
        amountUsdc: usdc_amount,
        walletPrefix: wallet_address.slice(0, 8),
        reference: reference ?? "none",
        error: result.error,
      }, "[mpc/fund-by-address] Direct funding failed");
    }

    res.json({ ...result, wallet_address, reference });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[mpc/fund-by-address] error");
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

/**
 * GET /mpc/vault-address   [INTERNAL — server-to-server only]
 *
 * Returns the JaIre vault's public Solana address so the API server
 * can target it for direct escrow payments without needing a separate env var.
 */
router.get("/vault-address", async (_req: Request, res: Response) => {
  try {
    const { getVaultKeypair } = await import("../services/solana-wallet.js");
    const vault = getVaultKeypair();
    res.json({ vault_address: vault.publicKey.toBase58() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
