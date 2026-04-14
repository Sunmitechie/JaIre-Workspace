/**
 * web3auth.ts — Simplified authentication layer
 *
 * Strategy: Google Identity Services (GSI) gives us the Google ID token directly
 * in the browser (no redirect dance). That token is passed to the MPC sidecar
 * which handles all on-chain key management. The frontend never touches the
 * Web3Auth MPC Core Kit SDK at runtime — it only needs the Google JWT.
 */

declare const __GOOGLE_CLIENT_ID__: string;

export interface Web3AuthUser {
  idToken: string;
  email: string;
  name: string;
  profileImage?: string;
  verifierId?: string;
}

export type SocialProvider = "google" | "twitter" | "apple";

// --------------------------------------------------------------------------
// Google Identity Services loader
// --------------------------------------------------------------------------

let _gsiReady = false;

function loadGSI(): Promise<void> {
  if (_gsiReady || (window as any).google?.accounts?.id) {
    _gsiReady = true;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => { _gsiReady = true; resolve(); };
    s.onerror = () => reject(new Error("Failed to load Google Sign-In script. Check your internet connection."));
    document.head.appendChild(s);
  });
}

/**
 * Prompt the Google Identity Services dialog.
 * Resolves with the raw Google ID token (a JWT) when the user completes sign-in.
 */
function promptGoogleSignIn(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const google = (window as any).google;

    google.accounts.id.initialize({
      client_id: __GOOGLE_CLIENT_ID__,
      callback: (response: { credential?: string; error?: string }) => {
        if (response.credential) {
          resolve(response.credential);
        } else {
          reject(new Error(response.error ?? "Google sign-in was cancelled or failed."));
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: false,
    });

    // Attempt One Tap — if unavailable, click the hidden fallback button.
    google.accounts.id.prompt((notification: any) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        const container = document.getElementById("__gsi_btn_container__");
        if (container) {
          google.accounts.id.renderButton(container, {
            type: "standard",
            theme: "outline",
            size: "large",
          });
          // Programmatically trigger the rendered button
          const btn = container.querySelector("div[role='button']") as HTMLElement | null;
          if (btn) {
            btn.click();
          } else {
            // Last resort: poll briefly until the button is rendered
            let attempts = 0;
            const poll = setInterval(() => {
              const b = container.querySelector("div[role='button']") as HTMLElement | null;
              if (b) { clearInterval(poll); b.click(); return; }
              if (++attempts > 20) {
                clearInterval(poll);
                reject(new Error(
                  "Google sign-in prompt unavailable. " +
                  "Try opening the app in a new browser tab."
                ));
              }
            }, 100);
          }
        } else {
          reject(new Error(
            "Google sign-in prompt could not be displayed. " +
            "Try opening the app in a new browser tab."
          ));
        }
      }
    });
  });
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Kept for callers that used the old Web3Auth MPC Core Kit init.
 * Now a no-op — the sidecar handles all key management.
 */
export async function initWeb3Auth(): Promise<void> {
  // No-op — we no longer run the MPC Core Kit in the browser.
}

/**
 * Sign in with a social provider.
 * Google: uses GSI One Tap / popup — no page redirect required.
 */
export async function loginWithSocial(provider: SocialProvider): Promise<Web3AuthUser> {
  if (provider !== "google") {
    throw new Error(
      `${provider === "twitter" ? "X (Twitter)" : "Apple"} sign-in is coming soon.`
    );
  }

  await loadGSI();
  const idToken = await promptGoogleSignIn();
  const claims = decodeJwtPayload(idToken);

  return {
    idToken,
    email: claims.email ?? "",
    name: claims.name ?? "",
    profileImage: claims.picture ?? "",
    verifierId: claims.sub ?? "",
  };
}

/**
 * Returns the active user from localStorage (saved by auth.ts on previous login).
 * Kept for backward compat — always resolves, never throws.
 */
export async function getConnectedUser(): Promise<Web3AuthUser | null> {
  try {
    // Dynamically import to avoid circular deps
    const { getUser, isLoggedIn } = await import("./auth");
    if (!isLoggedIn()) return null;
    const u = getUser();
    if (!u) return null;
    return {
      idToken: u.idToken ?? "",
      email: u.email ?? "",
      name: u.name ?? "",
      profileImage: u.avatar ?? "",
      verifierId: u.id ?? "",
    };
  } catch {
    return null;
  }
}

/** Kept for backward compat — no longer uses redirect flow. */
export function hasOAuthRedirectResult(): boolean {
  return false;
}

/** Kept for backward compat — no longer uses redirect flow. */
export async function handleOAuthRedirect(): Promise<Web3AuthUser | null> {
  return null;
}

/** Returns the stored Google ID token from the last session. */
export async function getWeb3AuthJWT(): Promise<string> {
  try {
    const { getUser } = await import("./auth");
    return getUser()?.idToken ?? "";
  } catch {
    return "";
  }
}

export async function logoutWeb3Auth(): Promise<void> {
  try {
    const google = (window as any).google;
    google?.accounts?.id?.disableAutoSelect?.();
  } catch { /* non-fatal */ }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function decodeJwtPayload(token: string): Record<string, string> {
  try {
    const [, payload] = token.split(".");
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}
