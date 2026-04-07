import { Router, Request, Response } from "express";
import {
  verifyWeb3AuthJWT,
  deriveUserFactorShare,
  getUserWalletAddress,
  isRegisteredUser,
} from "../services/mpc-service.js";

const router = Router();

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
 * Returns: { factor_share: string, wallet_address: string }
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
 * Call this after wallet creation to persist the address on the backend.
 *
 * Body: { id_token: string }
 * Returns: { wallet_address: string, verifier_id: string }
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
 * Internal endpoint for the Python API to verify a Web3Auth token
 * and get user identity details without exposing the factor key.
 *
 * Body: { id_token: string }
 * Returns: { sub, email, name, verifier_id, wallet_address }
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

export default router;
