import {
  Web3AuthMPCCoreKit,
  WEB3AUTH_NETWORK,
  COREKIT_STATUS,
} from "@web3auth/mpc-core-kit";
import { tssLib } from "@toruslabs/tss-dkls-lib";

declare const __WEB3AUTH_CLIENT_ID__: string;

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

const BASE_URL_PATH = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

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
 * Returns true when the current URL contains OAuth callback params
 * injected by customauth after a social login redirect.
 */
export function hasOAuthRedirectResult(): boolean {
  const hash = window.location.hash;
  const search = window.location.search;
  return (
    hash.includes("state") ||
    hash.includes("b64Params") ||
    search.includes("state=") ||
    search.includes("code=")
  );
}

/**
 * Process the OAuth redirect result.
 * Call this when `hasOAuthRedirectResult()` is true on the login page.
 * Returns the authenticated user on success, null if processing failed.
 */
export async function handleOAuthRedirect(): Promise<Web3AuthUser | null> {
  const kit = await initWeb3Auth();
  if (kit.status !== COREKIT_STATUS.LOGGED_IN) {
    await kit.handleRedirectResult();
  }
  if (kit.status === COREKIT_STATUS.LOGGED_IN) {
    return extractUserInfo(kit);
  }
  return null;
}

/**
 * Return the current authenticated user if a valid session exists.
 * Returns null if the user is not logged in.
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
 * Demo verifiers for sapphire_devnet.
 * Google: Web3Auth's own demo verifier — works without dashboard config.
 * Twitter / Apple: will be added once project verifiers are configured.
 */
const DEMO_VERIFIERS = {
  google: {
    typeOfLogin: "google" as const,
    verifier: "w3a-google-demo",
    clientId:
      "519228911939-cri01h55lsjbsia1k7ll6qpalrus75ps.apps.googleusercontent.com",
  },
};

/**
 * Start social login — redirects the browser to the OAuth provider.
 * This function does NOT return normally; the page navigates away.
 * On return, the login page calls `handleOAuthRedirect()`.
 */
export async function loginWithSocial(provider: SocialProvider): Promise<void> {
  if (provider !== "google") {
    throw new Error(
      `${provider === "twitter" ? "X (Twitter)" : "Apple"} sign-in is coming soon — please use Google for now.`
    );
  }
  const kit = await initWeb3Auth();
  await kit.loginWithOAuth({ subVerifierDetails: DEMO_VERIFIERS.google });
}

/**
 * Email passwordless — coming soon (needs a dedicated verifier in dashboard).
 */
export async function loginWithEmail(_email: string): Promise<void> {
  throw new Error(
    "Email sign-in is coming soon — please use Google for now."
  );
}

export async function logoutWeb3Auth(): Promise<void> {
  if (_instance) {
    try {
      await _instance.logout();
    } catch {
      // logout errors are non-fatal
    }
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
