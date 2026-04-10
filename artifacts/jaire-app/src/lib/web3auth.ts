import { Web3Auth } from "@web3auth/modal";

// Injected at build time via vite.config.ts `define`
declare const __WEB3AUTH_CLIENT_ID__: string;

const NETWORK = "sapphire_devnet";

let _instance: Web3Auth | null = null;
let _initPromise: Promise<void> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

function createWeb3AuthInstance(): Web3Auth {
  return new Web3Auth({
    clientId: __WEB3AUTH_CLIENT_ID__,
    web3AuthNetwork: NETWORK as any,
    uiConfig: {
      appName: "JaIre",
      mode: "dark",
      theme: { primary: "#FFAA00" } as any,
      defaultLanguage: "en",
      logoLight: "",
      logoDark: "",
    } as any,
  });
}

export function getInstance(): Web3Auth {
  if (!_instance) _instance = createWeb3AuthInstance();
  return _instance;
}

export async function initWeb3Auth(): Promise<Web3Auth> {
  const w = getInstance();
  if (!_initPromise) {
    _initPromise = withTimeout(w.init(), 20_000, "Web3Auth init").catch((err) => {
      _initPromise = null;
      throw err;
    });
  }
  await _initPromise;
  return w;
}

export type SocialProvider = "google" | "twitter" | "apple";

export interface Web3AuthUser {
  idToken: string;
  email: string;
  name: string;
  profileImage?: string;
  typeOfLogin?: string;
}

/**
 * Trigger social OAuth login (Google / Twitter / Apple).
 * Opens a popup for OAuth; resolves after authentication.
 * Times out after 3 minutes so the loading screen never hangs forever.
 */
export async function loginWithSocial(provider: SocialProvider): Promise<Web3AuthUser> {
  const w = await initWeb3Auth();
  if ((w as any).status === "connected") {
    try { await w.logout(); } catch {}
  }
  await withTimeout(
    (w as any).connectTo("auth", { authConnection: provider }),
    180_000,
    "Social login",
  );
  return extractUserInfo(w);
}

/**
 * Trigger email passwordless login.
 * Web3Auth sends a magic-link / OTP to the email address.
 */
export async function loginWithEmail(email: string): Promise<Web3AuthUser> {
  const w = await initWeb3Auth();
  if ((w as any).status === "connected") {
    try { await w.logout(); } catch {}
  }
  await withTimeout(
    (w as any).connectTo("auth", {
      authConnection: "email_passwordless",
      extraLoginOptions: { login_hint: email },
    }),
    300_000,
    "Email login",
  );
  return extractUserInfo(w);
}

async function extractUserInfo(w: Web3Auth): Promise<Web3AuthUser> {
  const info = await w.getUserInfo();
  return {
    idToken: (info as any).idToken ?? "",
    email: (info as any).email ?? "",
    name: (info as any).name ?? "",
    profileImage: (info as any).profileImage ?? "",
    typeOfLogin: (info as any).typeOfLogin ?? "",
  };
}

export async function logoutWeb3Auth(): Promise<void> {
  if (_instance) {
    try { await _instance.logout(); } catch {}
    _instance = null;
    _initPromise = null;
  }
}
