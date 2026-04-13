import {
  Web3AuthMPCCoreKit,
  WEB3AUTH_NETWORK,
  COREKIT_STATUS,
} from "@web3auth/mpc-core-kit";
import { tssLib } from "@toruslabs/tss-dkls-lib";

declare const __WEB3AUTH_CLIENT_ID__: string;
declare const __GOOGLE_CLIENT_ID__: string;
declare const __WEB3AUTH_GOOGLE_VERIFIER__: string;

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

function buildInstance(): Web3AuthMPCCoreKit {
  return new Web3AuthMPCCoreKit({
    web3AuthClientId: __WEB3AUTH_CLIENT_ID__,
    web3AuthNetwork: WEB3AUTH_NETWORK.DEVNET,
    tssLib,
    storage: window.localStorage,
    // Popup mode: no page redirect, no state management issues.
    uxMode: "popup",
  });
}

/**
 * Initialize (or return cached) Web3AuthMPCCoreKit instance.
 * Safe to call multiple times — returns the same promise.
 */
export function initWeb3Auth(): Promise<Web3AuthMPCCoreKit> {
  if (_initPromise) return _initPromise;
  _instance = buildInstance();
  _initPromise = _instance
    .init()
    .then(() => _instance!)
    .catch((err) => {
      _instance = null;
      _initPromise = null;
      throw err;
    });
  return _initPromise;
}

/**
 * Verifier config for sapphire_devnet.
 */
const GOOGLE_VERIFIER = {
  typeOfLogin: "google" as const,
  verifier: __WEB3AUTH_GOOGLE_VERIFIER__,
  clientId: __GOOGLE_CLIENT_ID__,
};

/**
 * Login with social provider using a popup window (no page redirect).
 * Resolves with the authenticated user when the popup closes.
 */
export async function loginWithSocial(_provider: SocialProvider): Promise<Web3AuthUser> {
  if (_provider !== "google") {
    throw new Error(
      `${_provider === "twitter" ? "X (Twitter)" : "Apple"} sign-in is coming soon — please use Google for now.`
    );
  }
  const kit = await initWeb3Auth();
  // loginWithOAuth in popup mode resolves after the popup closes
  await kit.loginWithOAuth({ subVerifierDetails: GOOGLE_VERIFIER });
  if (kit.status !== COREKIT_STATUS.LOGGED_IN) {
    throw new Error("Login incomplete — please try again.");
  }
  return extractUserInfo(kit);
}

/**
 * Return the current authenticated user if a valid session exists.
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

/**
 * Get a Web3Auth-signed JWT for backend authentication.
 * Falls back to the provider idToken from getUserInfo().
 */
export async function getWeb3AuthJWT(): Promise<string> {
  try {
    const kit = await initWeb3Auth();
    if (kit.status !== COREKIT_STATUS.LOGGED_IN) throw new Error("Not logged in");
    const result = await (kit as any).authenticateUser();
    if (result?.idToken) return result.idToken as string;
  } catch {
    // fall through
  }
  try {
    const kit = await initWeb3Auth();
    const info = kit.getUserInfo() as Record<string, unknown>;
    const token = (info.idToken as string) || (info.oAuthIdToken as string) || "";
    return token;
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
