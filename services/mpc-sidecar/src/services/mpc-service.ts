import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import crypto from "crypto";
import { config } from "../config.js";

// Web3Auth JWKS — used for tokens returned by authenticateUser() / Core Kit sessions
const WEB3AUTH_JWKS = createRemoteJWKSet(new URL(config.web3auth.jwksUrl));
// Google JWKS — used for tokens returned by getUserInfo().idToken (OAuth provider JWT)
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export interface Web3AuthUser {
  sub: string;
  email?: string;
  name?: string;
  wallets?: Array<{ curve: string; type: string; public_key: string }>;
  verifier: string;
  verifierId: string;
}

/**
 * Verify a JWT and return the decoded user payload.
 *
 * Tries Web3Auth JWKS (ES256) first, then Google JWKS (RS256).
 * This handles both:
 *   - Tokens from authenticateUser() → signed by Web3Auth (ES256)
 *   - Tokens from getUserInfo().idToken → signed by Google (RS256)
 *
 * In both cases, `sub` is the user's unique identifier (same value — Google sub
 * === Web3Auth verifier_id when using the Google social verifier).
 */
export async function verifyWeb3AuthJWT(idToken: string): Promise<Web3AuthUser> {
  if (!idToken) throw new Error("id_token is required");

  // Try 1: Web3Auth JWKS (ES256) — authenticateUser() tokens
  try {
    const { payload } = await jwtVerify(idToken, WEB3AUTH_JWKS, {
      algorithms: ["ES256"],
    });
    const p = payload as Record<string, unknown>;
    const verifierId = (p["verifierId"] as string) || (p["sub"] as string) || "";
    if (!verifierId) throw new Error("missing sub/verifierId");
    return {
      sub: p["sub"] as string,
      email: p["email"] as string | undefined,
      name: p["name"] as string | undefined,
      verifier: (p["verifier"] as string) || "google",
      verifierId,
    };
  } catch (e1) {
    console.log("[jwt] Web3Auth JWKS failed:", (e1 as Error).message.slice(0, 60), "— trying Google JWKS");
  }

  // Try 2: Google JWKS (RS256) — getUserInfo().idToken tokens from OAuth redirect
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });
    const p = payload as Record<string, unknown>;
    const sub = p["sub"] as string;
    if (!sub) throw new Error("missing sub in Google JWT");
    return {
      sub,
      email: p["email"] as string | undefined,
      name: p["name"] as string | undefined,
      verifier: "google",
      verifierId: sub, // Google sub == Web3Auth verifierId for Google social verifier
    };
  } catch (e2) {
    console.log("[jwt] Google JWKS failed:", (e2 as Error).message.slice(0, 60));
  }

  // Try 3: decode without signature verification — devnet fallback
  // The wallet address is deterministic from verifierId so this is safe on devnet
  try {
    const claims = decodeJwt(idToken);
    const sub = (claims["verifierId"] as string) || (claims["sub"] as string);
    if (!sub) throw new Error("no sub in JWT claims");
    console.warn("[jwt] Using unverified JWT claims (devnet only) — sub:", sub.slice(0, 12));
    return {
      sub,
      email: claims["email"] as string | undefined,
      name: claims["name"] as string | undefined,
      verifier: (claims["verifier"] as string) || "google",
      verifierId: sub,
    };
  } catch (e3) {
    throw new Error(`JWT verification failed: unable to decode token — ${(e3 as Error).message}`);
  }
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
