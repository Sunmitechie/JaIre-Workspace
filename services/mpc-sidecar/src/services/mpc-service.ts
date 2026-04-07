import { createRemoteJWKSet, jwtVerify } from "jose";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import crypto from "crypto";
import { config } from "../config.js";

const JWKS = createRemoteJWKSet(new URL(config.web3auth.jwksUrl));

export interface Web3AuthUser {
  sub: string;
  email?: string;
  name?: string;
  wallets?: Array<{ curve: string; type: string; public_key: string }>;
  verifier: string;
  verifierId: string;
}

/**
 * Verify a Web3Auth issued JWT and return the decoded user payload.
 */
export async function verifyWeb3AuthJWT(idToken: string): Promise<Web3AuthUser> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    algorithms: ["ES256"],
  });

  const user = payload as unknown as Web3AuthUser;
  if (!user.sub) throw new Error("Invalid Web3Auth token: missing sub");
  return user;
}

/**
 * Derive a deterministic factor-key share for a specific user.
 *
 * The node factor key (WEB3AUTH_NODE_FACTOR_KEY) is used as HMAC key material.
 * The resulting share is a 32-byte hex string that the frontend SDK can use
 * together with the user's other shares (device + Web3Auth network) to reach
 * threshold and sign transactions via TSS.
 *
 * This share is deterministic: same user → same share every call.
 */
export function deriveUserFactorShare(verifierId: string): string {
  const hmac = crypto.createHmac("sha256", config.web3auth.nodeFactorKey);
  hmac.update(`jaire-factor-v1:${verifierId}`);
  return hmac.digest("hex");
}

/**
 * Derive a deterministic Solana keypair for a user from the factor share.
 * This keypair represents the "server's view" of the user's key contribution.
 *
 * NOTE: In production TSS, no party ever holds the full private key.
 * This keypair is used for simulation / devnet testing ONLY.
 * Replace with a proper TSS signing call once the full MPC stack is wired.
 */
export function deriveUserDevnetKeypair(verifierId: string): Keypair {
  const factorShare = deriveUserFactorShare(verifierId);
  const seed = Buffer.from(factorShare.slice(0, 64), "hex");
  return Keypair.fromSeed(seed);
}

/**
 * Return the Solana wallet address for a Web3Auth user.
 * Uses deterministic derivation from their verifier ID + the node factor key.
 */
export function getUserWalletAddress(verifierId: string): string {
  return deriveUserDevnetKeypair(verifierId).publicKey.toBase58();
}

/**
 * Check if this sidecar recognises a given user (has their factor registered).
 * For now every verified JWT user is automatically supported.
 */
export function isRegisteredUser(_verifierId: string): boolean {
  return true;
}
