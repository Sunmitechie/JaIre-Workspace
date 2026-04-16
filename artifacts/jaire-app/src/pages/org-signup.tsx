import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { saveOrgUser, isOrgLoggedIn } from "@/lib/org-auth";
import { initWeb3Auth, getConnectedUser, loginWithSocial, type SocialProvider } from "@/lib/web3auth";
import { Particles } from "@/components/particles";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE_URL}/api`;

type Step = "checking" | "choose" | "signing-in" | "registering" | "done";

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
];

export default function OrgSignup() {
  const [step, setStep] = useState<Step>("checking");
  const [error, setError] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isOrgLoggedIn()) {
      setLocation("/org/dashboard");
      return;
    }
    initWeb3Auth().then(() => setStep("choose")).catch((e) => setError(String(e)));
  }, []);

  const handleSocialLogin = async (provider: SocialProvider) => {
    setStep("signing-in");
    setError(null);
    try {
      await loginWithSocial(provider);
      setStep("registering");
      const user = await getConnectedUser();
      if (!user) throw new Error("Failed to get user info");

      const res = await fetch(`${API}/org/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          name: user.name,
          verifier_id: user.verifierId,
          wallet_address: user.walletAddress,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { org, token } = await res.json();

      saveOrgUser({ ...org, token });
      setStep("done");

      // Route based on KYC status
      setTimeout(() => {
        if (org.kycStatus === "pending") {
          setLocation("/org/kyc");
        } else {
          setLocation("/org/dashboard");
        }
      }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("choose");
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center relative overflow-hidden">
      <Particles />

      <div className="relative z-10 w-full max-w-md px-6">
        {/* Brand */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-lg">J</span>
            </div>
            <span className="text-white text-2xl font-bold">JaIre for Orgs</span>
          </div>
          <p className="text-gray-400 text-sm">List your workspace, earn on-chain revenue</p>
        </div>

        {/* Card */}
        <div className="bg-[#111] border border-white/10 rounded-2xl p-8 shadow-2xl">
          {step === "checking" && (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-gray-400 mt-4 text-sm">Initialising...</p>
            </div>
          )}

          {(step === "choose" || step === "signing-in" || step === "registering") && (
            <>
              <h2 className="text-white text-xl font-semibold mb-2">Create your org account</h2>
              <p className="text-gray-500 text-sm mb-6">Your Web3Auth wallet is created automatically — no seed phrase needed.</p>

              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>
              )}

              <div className="space-y-3">
                {SOCIAL_PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSocialLogin(p.id)}
                    disabled={step !== "choose"}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {step !== "choose" ? (
                      <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    ) : p.icon}
                    {step === "signing-in" ? "Connecting wallet..." : step === "registering" ? "Creating account..." : p.label}
                  </button>
                ))}
              </div>

              <p className="text-gray-600 text-xs text-center mt-6">
                Already registered?{" "}
                <button onClick={() => setLocation("/org/dashboard")} className="text-purple-400 hover:text-purple-300">
                  Go to dashboard
                </button>
              </p>
            </>
          )}

          {step === "done" && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-white font-semibold">Account created!</p>
              <p className="text-gray-400 text-sm mt-1">Redirecting to KYC...</p>
            </div>
          )}
        </div>

        <p className="text-center text-gray-600 text-xs mt-6">
          Looking to book a desk?{" "}
          <button onClick={() => setLocation("/login")} className="text-purple-400 hover:text-purple-300">
            Sign in as a member
          </button>
        </p>
      </div>
    </div>
  );
}
