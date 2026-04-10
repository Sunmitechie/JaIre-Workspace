import { Web3Auth } from "@web3auth/modal";

declare const __WEB3AUTH_CLIENT_ID__: string;

const NETWORK = "sapphire_devnet";
const CONNECT_TIMEOUT = 120_000; // 2 min for popup flow

let _instance: Web3Auth | null = null;
let _initPromise: Promise<Web3Auth> | null = null;

function createInstance(): Web3Auth {
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

/** Call this on page load to pre-warm the SDK so it's ready before the user clicks. */
export function preloadWeb3Auth(): void {
  if (_initPromise) return;
  _initPromise = (async () => {
    const w = createInstance();
    _instance = w;
    try {
      await w.init();
    } catch {
      // init errors are non-fatal — we'll retry on demand
      _initPromise = null;
      _instance = null;
    }
    return w;
  })();
}

async function ensureReady(): Promise<Web3Auth> {
  if (!_initPromise) preloadWeb3Auth();
  const w = await _initPromise!;
  return w;
}

export type SocialProvider = "google" | "twitter" | "apple";

export interface Web3AuthUser {
  idToken: string;
  email: string;
  name: string;
  profileImage?: string;
}

/**
 * Social OAuth login.
 *
 * Strategy:
 * 1. If already connected (restored session), return user immediately.
 * 2. Otherwise call connectTo and wait up to 2 minutes.
 * 3. If connectTo throws OR times out, the OAuth popup may still have
 *    completed on Web3Auth's end — we reset + re-init and check the
 *    restored session before giving up.
 */
export async function loginWithSocial(provider: SocialProvider): Promise<Web3AuthUser> {
  let w = await ensureReady();

  if ((w as any).status === "connected") {
    try { await w.logout(); } catch {}
  }

  const connectPromise = (w as any).connectTo("auth", { authConnection: provider });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("__TIMEOUT__")), CONNECT_TIMEOUT),
  );

  try {
    await Promise.race([connectPromise, timeout]);
  } catch (err: any) {
    const msg = String(err?.message ?? "");

    // If "not ready" or timeout: Web3Auth may have stored the session already.
    // Reset + re-init to surface the existing session.
    if (msg.includes("not ready") || msg === "__TIMEOUT__" || msg.includes("timed out")) {
      _instance = null;
      _initPromise = null;
      preloadWeb3Auth();
      const fresh = await _initPromise!;
      if ((fresh as any).status === "connected") {
        return extractUserInfo(fresh);
      }
      throw new Error("Sign-in window was closed or didn't respond. Please try again.");
    }

    // User closed popup
    if (msg.toLowerCase().includes("user closed") || msg.toLowerCase().includes("popup")) {
      throw new Error("Sign-in was cancelled.");
    }

    throw err;
  }

  return extractUserInfo(w);
}

/** Email magic-link login. */
export async function loginWithEmail(email: string): Promise<Web3AuthUser> {
  let w = await ensureReady();

  if ((w as any).status === "connected") {
    try { await w.logout(); } catch {}
  }

  const connectPromise = (w as any).connectTo("auth", {
    authConnection: "email_passwordless",
    extraLoginOptions: { login_hint: email },
  });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("__TIMEOUT__")), 300_000),
  );

  try {
    await Promise.race([connectPromise, timeout]);
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    if (msg === "__TIMEOUT__") {
      throw new Error("Email sign-in timed out. Please check your inbox and try again.");
    }
    if (msg.toLowerCase().includes("user closed") || msg.toLowerCase().includes("popup")) {
      throw new Error("Sign-in was cancelled.");
    }
    throw err;
  }

  return extractUserInfo(w);
}

async function extractUserInfo(w: Web3Auth): Promise<Web3AuthUser> {
  const info = await w.getUserInfo();
  return {
    idToken: (info as any).idToken ?? "",
    email: (info as any).email ?? "",
    name: (info as any).name ?? "",
    profileImage: (info as any).profileImage ?? "",
  };
}

export async function logoutWeb3Auth(): Promise<void> {
  if (_instance) {
    try { await _instance.logout(); } catch {}
    _instance = null;
    _initPromise = null;
  }
}
