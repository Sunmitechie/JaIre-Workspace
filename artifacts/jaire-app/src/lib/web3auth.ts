import {
  Web3AuthMPCCoreKit,
  WEB3AUTH_NETWORK,
  COREKIT_STATUS,
  generateFactorKey,
} from "@web3auth/mpc-core-kit";
import { tssLib } from "@toruslabs/tss-dkls-lib";
import BN from "bn.js";

declare const __WEB3AUTH_CLIENT_ID__: string;
declare const __GOOGLE_CLIENT_ID__: string;
declare const __WEB3AUTH_GOOGLE_VERIFIER__: string;

const DEVICE_FACTOR_KEY = "jaire_mpc_device_factor";

export interface Web3AuthUser {
  idToken: string;
  email: string;
  name: string;
  profileImage?: string;
  verifierId?: string;
}

export type SocialProvider = "google" | "twitter" | "apple";

let _instance: Web3AuthMPCCoreKit | null = null;
let _initPromise: Promise<Web3AuthMPCCoreKit> | null = null;

// The redirect lands on /login, so baseUrl must be origin and redirectPathName "login".
const BASE_URL_PATH = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function buildInstance(): Web3AuthMPCCoreKit {
  return new Web3AuthMPCCoreKit({
    web3AuthClientId: __WEB3AUTH_CLIENT_ID__,
    web3AuthNetwork: WEB3AUTH_NETWORK.DEVNET,
    tssLib,
    storage: window.localStorage,
    uxMode: "redirect",
    baseUrl: `${window.location.origin}${BASE_URL_PATH}`,
    redirectPathName: "login",
  });
}

export function initWeb3Auth(): Promise<Web3AuthMPCCoreKit> {
  if (_initPromise) return _initPromise;
  _instance = buildInstance();
  _initPromise = _instance
    .init()
    .then(() => _instance!)
    .catch((err) => {
      console.error("[web3auth] init failed:", err);
      _instance = null;
      _initPromise = null;
      throw err;
    });
  return _initPromise;
}

// --------------------------------------------------------------------------
// OAuth redirect helpers
// --------------------------------------------------------------------------

/** Returns true when the current URL looks like a post-OAuth callback. */
export function hasOAuthRedirectResult(): boolean {
  const { hash, search } = window.location;
  return (
    hash.includes("state") ||
    hash.includes("b64Params") ||
    search.includes("state=") ||
    search.includes("code=")
  );
}

/**
 * Process the OAuth redirect result.
 * Handles:
 *   - Normal first-time login (REQUIRED_SHARE → auto-creates device factor)
 *   - Returning user whose device factor is still in localStorage
 *   - Returning user who lost their device factor (re-generates it)
 */
export async function handleOAuthRedirect(): Promise<Web3AuthUser | null> {
  const kit = await initWeb3Auth();

  // ① Call handleRedirectResult (processes the OAuth code in the URL)
  if (kit.status !== COREKIT_STATUS.LOGGED_IN) {
    try {
      await kit.handleRedirectResult();
    } catch (err) {
      console.error("[web3auth] handleRedirectResult failed:", err);
      return null;
    }
  }

  console.log("[web3auth] kit.status after handleRedirectResult:", kit.status);

  // ② If still need a second factor, create / restore the device factor
  if (kit.status === COREKIT_STATUS.REQUIRED_SHARE) {
    try {
      await ensureDeviceFactor(kit);
    } catch (err) {
      console.error("[web3auth] ensureDeviceFactor failed:", err);
      return null;
    }
  }

  // ③ Should be LOGGED_IN by now
  if (kit.status !== COREKIT_STATUS.LOGGED_IN) {
    console.error("[web3auth] unexpected status after factor setup:", kit.status);
    return null;
  }

  return extractUserInfo(kit);
}

/**
 * Ensure the device factor exists.
 * - If we have a stored hex key → try inputFactorKey
 * - Otherwise generate a brand-new device factor via enableMFA
 */
async function ensureDeviceFactor(kit: Web3AuthMPCCoreKit): Promise<void> {
  const stored = localStorage.getItem(DEVICE_FACTOR_KEY);

  if (stored) {
    // Attempt to restore the stored device factor
    try {
      await kit.inputFactorKey(new BN(stored, "hex"));
      console.log("[web3auth] restored existing device factor");
      return;
    } catch (err) {
      console.warn("[web3auth] stored device factor invalid, regenerating…", err);
      localStorage.removeItem(DEVICE_FACTOR_KEY);
    }
  }

  // Generate a new device factor (for first-time users or factor loss)
  console.log("[web3auth] generating new device factor via enableMFA…");
  const factorKey = generateFactorKey();
  const keyHex = factorKey.private.toString("hex");
  localStorage.setItem(DEVICE_FACTOR_KEY, keyHex);

  // enableMFA registers the factor with the Web3Auth nodes.
  await (kit as any).enableMFA({ factorKey: factorKey.private });
}

/**
 * Trigger the Google OAuth redirect — page navigates away.
 */
export async function loginWithSocial(provider: SocialProvider): Promise<void> {
  if (provider !== "google") {
    throw new Error(
      `${provider === "twitter" ? "X (Twitter)" : "Apple"} sign-in is coming soon.`
    );
  }
  const kit = await initWeb3Auth();
  await kit.loginWithOAuth({
    subVerifierDetails: {
      typeOfLogin: "google",
      verifier: __WEB3AUTH_GOOGLE_VERIFIER__,
      clientId: __GOOGLE_CLIENT_ID__,
    },
  });
  // ^ This redirects the page — code below is never reached.
}

/**
 * Return the currently authenticated user (session persisted in localStorage).
 */
export async function getConnectedUser(): Promise<Web3AuthUser | null> {
  try {
    const kit = await initWeb3Auth();
    if (kit.status !== COREKIT_STATUS.LOGGED_IN) return null;
    return extractUserInfo(kit);
  } catch {
    return null;
  }
}

export async function getWeb3AuthJWT(): Promise<string> {
  try {
    const kit = await initWeb3Auth();
    if (kit.status !== COREKIT_STATUS.LOGGED_IN) throw new Error("not logged in");
    const result = await (kit as any).authenticateUser?.();
    if (result?.idToken) return result.idToken as string;
  } catch { /* fallthrough */ }
  try {
    const kit = await initWeb3Auth();
    const info = kit.getUserInfo() as Record<string, unknown>;
    return (info.idToken as string) || (info.oAuthIdToken as string) || "";
  } catch {
    return "";
  }
}

export async function logoutWeb3Auth(): Promise<void> {
  if (_instance) {
    try { await _instance.logout(); } catch { /* non-fatal */ }
    _instance = null;
    _initPromise = null;
  }
}

function extractUserInfo(kit: Web3AuthMPCCoreKit): Web3AuthUser {
  const info = kit.getUserInfo() as Record<string, unknown>;
  return {
    idToken: (info.idToken as string) ?? "",
    email: (info.email as string) ?? "",
    name: (info.name as string) ?? "",
    profileImage:
      (info.profileImage as string) ?? (info.profilePicture as string) ?? "",
    verifierId: (info.verifierId as string) ?? (info.sub as string) ?? "",
  };
}
