import {
  Web3AuthNoModal,
  authConnector,
  UX_MODE,
  AUTH_CONNECTION,
  WEB3AUTH_NETWORK,
  WALLET_CONNECTORS,
} from "@web3auth/no-modal";

declare const __WEB3AUTH_CLIENT_ID__: string;

export interface Web3AuthUser {
  idToken: string;
  email: string;
  name: string;
  profileImage?: string;
}

export type SocialProvider = "google" | "twitter" | "apple";

let _instance: Web3AuthNoModal | null = null;
let _initPromise: Promise<Web3AuthNoModal> | null = null;

function buildInstance(): Web3AuthNoModal {
  return new Web3AuthNoModal({
    clientId: __WEB3AUTH_CLIENT_ID__,
    web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
    connectors: [
      authConnector({
        uxMode: UX_MODE.REDIRECT,
      }),
    ],
  });
}

/**
 * Initialize (or return cached) Web3Auth instance.
 * In REDIRECT mode, calling init() after an OAuth redirect automatically
 * restores the session — no popup, no cross-frame postMessage issues.
 */
export function initWeb3Auth(): Promise<Web3AuthNoModal> {
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

/** True if the current session is already authenticated (returned from OAuth redirect). */
export async function getConnectedUser(): Promise<Web3AuthUser | null> {
  try {
    const w = await initWeb3Auth();
    if (!w.connected) return null;
    return extractUserInfo(w);
  } catch {
    return null;
  }
}

/**
 * Start social OAuth — redirects the browser to the provider.
 * This function does NOT return; the page navigates away.
 * On return, `getConnectedUser()` will resolve the authenticated user.
 */
export async function loginWithSocial(provider: SocialProvider): Promise<void> {
  const w = await initWeb3Auth();
  const connectionMap: Record<SocialProvider, string> = {
    google: AUTH_CONNECTION.GOOGLE,
    twitter: AUTH_CONNECTION.TWITTER,
    apple: AUTH_CONNECTION.APPLE,
  };
  await w.connectTo(WALLET_CONNECTORS.AUTH, {
    authConnection: connectionMap[provider],
  });
}

/**
 * Start email passwordless OAuth — redirects the browser.
 * This function does NOT return; the page navigates away.
 */
export async function loginWithEmail(email: string): Promise<void> {
  const w = await initWeb3Auth();
  await w.connectTo(WALLET_CONNECTORS.AUTH, {
    authConnection: AUTH_CONNECTION.EMAIL_PASSWORDLESS,
    authConnectionParams: { login_hint: email },
  });
}

export async function logoutWeb3Auth(): Promise<void> {
  if (_instance) {
    try { await _instance.logout(); } catch {}
    _instance = null;
    _initPromise = null;
  }
}

async function extractUserInfo(w: Web3AuthNoModal): Promise<Web3AuthUser> {
  const info = await w.getUserInfo();
  return {
    idToken: (info as any).idToken ?? "",
    email: (info as any).email ?? "",
    name: (info as any).name ?? "",
    profileImage: (info as any).profileImage ?? "",
  };
}
