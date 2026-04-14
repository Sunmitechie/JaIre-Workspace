import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { saveUser, isLoggedIn } from "@/lib/auth";
import { Particles } from "@/components/particles";
import {
  initWeb3Auth,
  getConnectedUser,
  loginWithSocial,
  hasOAuthRedirectResult,
  handleOAuthRedirect,
  type SocialProvider,
} from "@/lib/web3auth";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const SOCIAL_PROVIDERS: { id: SocialProvider; label: string; icon: React.ReactNode }[] = [
  {
    id: "google",
    label: "Continue with Google",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    ),
  },
  {
    id: "twitter",
    label: "Continue with X (Twitter)",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
  {
    id: "apple",
    label: "Continue with Apple",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    ),
  },
];

type Step = "checking" | "choose" | "redirecting" | "wallet" | "done";

export default function Login() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("checking");
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await initWeb3Auth();
        if (cancelled) return;

        let user = null;

        if (hasOAuthRedirectResult()) {
          setStep("wallet");
          setStatusMsg("Completing sign-in…");
          user = await handleOAuthRedirect(); // throws on failure
        } else {
          user = await getConnectedUser();
        }

        if (cancelled) return;

        if (user) {
          await finishLogin(user.idToken, user.email, user.name, user.profileImage ?? "");
        } else {
          setStep("choose");
        }
      } catch (err: any) {
        if (!cancelled) {
          setDebugInfo(err?.message ?? String(err));
          setStep("choose");
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const finishLogin = async (
    idToken: string,
    email: string,
    name: string,
    profileImage: string,
  ) => {
    setStep("wallet");
    setStatusMsg("Setting up your account...");

    let walletAddress: string | undefined;
    let verifierId: string | undefined;
    let resolvedEmail = email;
    let resolvedName = name;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      const res = await fetch(`${BASE_URL}/api/mpc/wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: idToken }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        walletAddress = data.wallet_address;
        verifierId = data.verifier_id;
        resolvedEmail = data.email || email;
        resolvedName = data.name || name;
      }
    } catch { /* non-fatal */ }

    setStatusMsg("Almost ready!");
    await delay(400);

    const userId = `w3a_${verifierId?.replace(/[^a-z0-9]/gi, "_") ?? Date.now()}`;
    saveUser({
      id: userId,
      name: resolvedName || resolvedEmail.split("@")[0] || "JaIre User",
      email: resolvedEmail,
      avatar:
        profileImage ||
        `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(resolvedEmail || userId)}`,
      provider: "google",
      walletAddress,
      walletNetwork: "devnet",
      walletCreatedAt: new Date().toISOString(),
      idToken,
    });

    setStep("done");

    setLocation("/baire");
    await delay(200);
    if (window.location.pathname.includes("/login")) {
      window.location.replace(`${BASE_URL}/baire`);
    }
  };

  const handleSocial = async (provider: SocialProvider) => {
    if (provider !== "google") {
      setError(
        `${provider === "twitter" ? "X (Twitter)" : "Apple"} sign-in is coming soon — please use Google for now.`
      );
      return;
    }
    if (step !== "choose") return;
    setActiveProvider(provider);
    setStep("redirecting");
    setStatusMsg("Connecting to Google…");
    setError(null);
    setDebugInfo(null);
    try {
      await loginWithSocial(provider);
      // Page navigates away — this code is unreachable in normal flow
    } catch (err: any) {
      setError(err?.message || "Sign-in failed. Please try again.");
      setStep("choose");
      setActiveProvider(null);
    }
  };

  const isLoading = step !== "choose";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden">
      <Particles count={50} />
      <div className="absolute inset-0 bg-gradient-radial from-[rgba(255,170,0,0.04)] via-transparent to-transparent pointer-events-none" />

      <div
        className="relative z-10 w-full max-w-md mx-auto px-6"
        style={{ animation: "fadeIn 0.6s ease-out" }}
      >
        <style>{`@keyframes fadeIn { from { opacity:0;transform:translateY(20px); } to { opacity:1;transform:translateY(0); } }`}</style>

        <div className="text-center mb-10">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
            style={{
              background: "linear-gradient(135deg,rgba(255,170,0,0.2) 0%,rgba(255,170,0,0.08) 100%)",
              border: "1px solid rgba(255,170,0,0.3)",
            }}
          >
            <span className="text-2xl font-bold text-gradient-gold">JI</span>
          </div>
          <h1 className="text-4xl font-bold mb-3">
            Welcome to <span className="text-gradient-gold">JaIre</span>
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed">
            Premium coworking for the Lagos tech scene.
            <br />
            Sign in to meet Baire, your space concierge.
          </p>
        </div>

        <div className="glass-card rounded-2xl p-8 border-gradient">
          {isLoading ? (
            <div className="py-8 flex flex-col items-center gap-6">
              <div className="relative w-20 h-20">
                <div
                  className="absolute inset-0 rounded-full border-2 border-primary/20 animate-spin"
                  style={{ borderTopColor: "hsl(43 100% 50%)", animationDuration: "1s" }}
                />
                <div
                  className="absolute inset-2 rounded-full border border-purple-500/30 animate-spin"
                  style={{ borderTopColor: "hsl(262 83% 66%)", animationDuration: "1.5s", animationDirection: "reverse" }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
              </div>
              <div className="text-center">
                <p className="font-semibold text-lg mb-1">
                  {step === "checking"
                    ? "Checking your session…"
                    : step === "redirecting"
                    ? "Redirecting to Google…"
                    : "Setting up your account"}
                </p>
                {statusMsg && (
                  <p className="text-muted-foreground text-sm" key={statusMsg}>{statusMsg}</p>
                )}
                {step === "redirecting" && (
                  <p className="text-xs text-muted-foreground/60 mt-2">
                    You'll be redirected to complete sign-in, then brought back here.
                  </p>
                )}
              </div>
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {error && (
                <div className="px-4 py-3 rounded-xl text-sm text-red-400 bg-red-400/8 border border-red-400/20 mb-2">
                  {error}
                </div>
              )}
              {debugInfo && (
                <div className="px-4 py-3 rounded-xl text-xs text-yellow-400/80 bg-yellow-400/5 border border-yellow-400/15 mb-2 font-mono break-all">
                  {debugInfo}
                </div>
              )}

              {SOCIAL_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSocial(p.id)}
                  disabled={isLoading}
                  className="w-full flex items-center gap-4 px-5 py-4 rounded-xl bg-white/4 hover:bg-white/8 border border-white/8 hover:border-white/16 transition-all duration-200 text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="shrink-0">{p.icon}</span>
                  <span className="font-medium text-[15px]">{p.label}</span>
                  <svg className="w-4 h-4 ml-auto text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/8" />
                </div>
                <div className="relative flex justify-center text-xs text-muted-foreground">
                  <span className="bg-background px-3">or</span>
                </div>
              </div>

              <div className="space-y-2">
                <input
                  id="email-input"
                  type="email"
                  placeholder="you@example.com"
                  className="w-full h-12 px-4 rounded-xl text-sm bg-white/4 border border-white/8 focus:outline-none focus:border-primary/50 focus:bg-white/6 transition-all placeholder:text-muted-foreground/50"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setError("Email sign-in is coming soon — please use Google for now.");
                    }
                  }}
                />
                <button
                  onClick={() => setError("Email sign-in is coming soon — please use Google for now.")}
                  disabled={isLoading}
                  className="w-full flex items-center gap-4 px-5 py-4 rounded-xl bg-primary/8 hover:bg-primary/12 border border-primary/20 hover:border-primary/40 transition-all duration-200 text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-5 h-5 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="font-medium text-[15px] text-primary">Continue with Email</span>
                  <svg className="w-4 h-4 ml-auto text-primary/60 group-hover:text-primary group-hover:translate-x-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6 leading-relaxed">
          By signing in, an invisible Solana wallet is created for you.<br />
          No seed phrases. No crypto knowledge required.
        </p>
      </div>
    </div>
  );
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
