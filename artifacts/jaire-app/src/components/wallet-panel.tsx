import { useState, useCallback, useEffect, useRef } from "react";
import { getUser } from "@/lib/auth";
import { formatNGN } from "@/lib/currency";
import { ExternalLink, Wallet, ArrowUpRight, CheckCircle, Loader2, AlertCircle, RefreshCw } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const NGN_PER_USDC = 1600;
const MIN_NGN = 500;
const MAX_NGN = 5_000_000;

interface WalletState {
  sol: number;
  usdc: number;
  loading: boolean;
  error: string | null;
}

interface FundResult {
  txHash: string | null;
  amountNgn: number;
  amountUsdc: number;
  reference: string;
}

interface WalletPanelProps {
  onClose: () => void;
}

// Loads Paystack inline JS exactly once
let paystackLoaded = false;
function loadPaystackScript(): Promise<void> {
  if (paystackLoaded || (window as any).PaystackPop) { paystackLoaded = true; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.paystack.co/v2/inline.js";
    s.onload = () => { paystackLoaded = true; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export function WalletPanel({ onClose }: WalletPanelProps) {
  const user = getUser();
  const [wallet, setWallet] = useState<WalletState>({ sol: 0, usdc: 0, loading: true, error: null });
  const [fundState, setFundState] = useState<"idle" | "initiating" | "paying" | "polling" | "success" | "error">("idle");
  const [fundResult, setFundResult] = useState<FundResult | null>(null);
  const [ngnInput, setNgnInput] = useState("");
  const [fundError, setFundError] = useState<string | null>(null);

  const parsedNgn = parseInt(ngnInput.replace(/,/g, ""), 10) || 0;
  const usdcPreview = parsedNgn > 0 ? (parsedNgn / NGN_PER_USDC).toFixed(4) : null;
  const inputValid = parsedNgn >= MIN_NGN && parsedNgn <= MAX_NGN;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const loadBalance = useCallback(async () => {
    if (!user?.walletAddress) { setWallet(w => ({ ...w, loading: false })); return; }
    setWallet(w => ({ ...w, loading: true, error: null }));
    try {
      const res = await fetch(`${BASE_URL}/api/wallet/balance?address=${user.walletAddress}`);
      if (!res.ok) throw new Error("balance error");
      const data = await res.json();
      setWallet({ sol: data.balance_sol ?? 0, usdc: data.balance_usdc ?? 0, loading: false, error: null });
    } catch {
      setWallet(w => ({ ...w, loading: false, error: "Couldn't fetch balance" }));
    }
  }, [user?.walletAddress]);

  useEffect(() => { loadBalance(); }, [loadBalance]);

  useEffect(() => () => stopPolling(), []);

  const pollPayment = (reference: string, amountNgn: number) => {
    setFundState("polling");
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`${BASE_URL}/api/payments/status/${reference}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "success") {
            stopPolling();
            setFundResult({
              txHash: data.tx_signature ?? null,
              amountNgn,
              amountUsdc: data.amount_usdc ?? amountNgn / NGN_PER_USDC,
              reference,
            });
            setFundState("success");
            loadBalance();
            return;
          }
        }
      } catch {}
      if (attempts >= 30) { // 90s timeout
        stopPolling();
        setFundError("Payment not confirmed yet. Check back shortly.");
        setFundState("error");
      }
    }, 3000);
  };

  const handleFund = async () => {
    if (!user?.email) { setFundError("Please sign in first"); return; }
    if (!inputValid) {
      setFundError(`Enter an amount between ${formatNGN(MIN_NGN)} and ${formatNGN(MAX_NGN)}`);
      return;
    }

    setFundState("initiating");
    setFundError(null);

    // ── Auto-derive wallet if missing ──────────────────────────────────────
    // If walletAddress is missing (MPC derivation failed at login), retry now.
    if (!user.walletAddress) {
      if (!user.idToken) {
        setFundError("Session expired. Please sign out and sign back in.");
        setFundState("error");
        return;
      }
      try {
        const mpcRes = await fetch(`${BASE_URL}/api/mpc/wallet`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_token: user.idToken }),
        });
        if (!mpcRes.ok) throw new Error("wallet derivation failed");
        const mpcData = await mpcRes.json() as { wallet_address?: string };
        if (!mpcData.wallet_address) throw new Error("no address returned");
        // Patch localStorage so balance and subsequent calls work
        const { updateUser } = await import("@/lib/auth");
        updateUser({ walletAddress: mpcData.wallet_address });
        // Refresh the local reference so the payment can continue
        Object.assign(user, { walletAddress: mpcData.wallet_address });
      } catch {
        setFundError("Wallet not ready — please sign out and sign back in.");
        setFundState("error");
        return;
      }
    }

    try {
      // Step 1: Create Paystack transaction on backend
      const initRes = await fetch(`${BASE_URL}/api/payments/initiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_ngn: parsedNgn,
          user_email: user.email,
          user_wallet_address: user.walletAddress,
          callback_url: window.location.origin + (BASE_URL || "") + "/dashboard",
        }),
      });

      if (!initRes.ok) {
        const err = await initRes.json() as any;
        throw new Error(err.error ?? "Failed to initiate payment");
      }

      const { access_code, reference } = await initRes.json() as {
        access_code: string;
        reference: string;
        amount_usdc: number;
      };

      // Step 2: Load Paystack inline and open popup.
      // resumeTransaction(access_code) is the correct method for a server-
      // initiated transaction — it does NOT require the public key.
      await loadPaystackScript();
      const PaystackPop = (window as any).PaystackPop;
      if (!PaystackPop) throw new Error("Paystack checkout not available");

      setFundState("paying");

      // Start polling immediately — webhook fires even without a JS callback
      pollPayment(reference, parsedNgn);

      // v2 inline script: PaystackPop is a class — always use new.
      const popup = new PaystackPop();
      popup.resumeTransaction(access_code);
    } catch (err: any) {
      setFundError(err.message ?? "Payment failed. Please try again.");
      setFundState("error");
    }
  };

  const ngnBalance = wallet.usdc * NGN_PER_USDC;
  const shortAddr = user?.walletAddress
    ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}`
    : "—";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 mb-6 sm:mb-0 rounded-3xl overflow-hidden"
        style={{ background: "hsl(220 40% 7%)", border: "1px solid rgba(255,170,0,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4" style={{ background: "rgba(255,170,0,0.04)", borderBottom: "1px solid rgba(255,170,0,0.1)" }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,170,0,0.12)" }}>
                <Wallet className="w-4 h-4 text-primary" />
              </div>
              <span className="font-bold text-sm">JaIre Wallet</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-widest" style={{ background: "rgba(56,189,248,0.1)", color: "hsl(199 93% 60%)", border: "1px solid rgba(56,189,248,0.25)" }}>
                devnet
              </span>
              <button
                onClick={() => loadBalance()}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                title="Refresh balance"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
          </div>

          {/* Address */}
          <div className="font-mono text-xs text-muted-foreground mb-4 flex items-center gap-2">
            {user?.walletAddress ? (
              <>
                <span>{shortAddr}</span>
                <a
                  href={`https://solscan.io/account/${user.walletAddress}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-primary transition-colors"
                  title="View on Solscan"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </>
            ) : (
              <span className="text-amber-400/70 text-[11px] flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Wallet will be set up when you pay
              </span>
            )}
          </div>

          {/* Balance */}
          {wallet.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Checking balance…</span>
            </div>
          ) : wallet.error ? (
            <div className="flex items-center gap-1.5 text-sm text-red-400 py-2">
              <AlertCircle className="w-4 h-4" />
              <span>{wallet.error}</span>
            </div>
          ) : (
            <div>
              <div className="text-3xl font-bold mb-0.5">{formatNGN(ngnBalance)}</div>
              <div className="text-xs text-muted-foreground">{wallet.usdc.toFixed(4)} USDC · {wallet.sol.toFixed(4)} SOL</div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-6">
          {fundState === "success" && fundResult ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                <CheckCircle className="w-5 h-5" />
                <span>Payment confirmed!</span>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid</span>
                  <span className="font-medium">{formatNGN(fundResult.amountNgn)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credited</span>
                  <span className="font-medium text-primary">{fundResult.amountUsdc.toFixed(4)} USDC</span>
                </div>
              </div>

              {fundResult.txHash && (
                <div className="px-3 py-2.5 rounded-xl text-xs font-mono break-all" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="text-muted-foreground mb-1">Solana TX</div>
                  <a
                    href={`https://solscan.io/tx/${fundResult.txHash}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-400 hover:underline flex items-center gap-1"
                  >
                    {fundResult.txHash.slice(0, 24)}…
                    <ExternalLink className="w-2.5 h-2.5 inline shrink-0" />
                  </a>
                </div>
              )}

              <button
                onClick={() => { setFundState("idle"); setFundResult(null); }}
                className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                Add more funds
              </button>
            </div>

          ) : fundState === "polling" ? (
            <div className="space-y-3 py-4 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-sm font-medium">Confirming payment…</p>
              <p className="text-xs text-muted-foreground">Crediting USDC to your wallet on Solana devnet</p>
            </div>

          ) : fundState === "paying" ? (
            <div className="space-y-3 py-4 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-sm font-medium">Paystack checkout open</p>
              <p className="text-xs text-muted-foreground">Complete payment in the popup to fund your wallet</p>
            </div>

          ) : fundState === "initiating" ? (
            <div className="space-y-3 py-4 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-sm font-medium">Opening checkout…</p>
            </div>

          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold mb-3">Top Up Account</p>

                {/* NGN free-form input */}
                <div
                  className="flex items-center gap-2 rounded-2xl px-4 py-3 transition-all"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${parsedNgn > 0 && !inputValid ? "rgba(248,113,113,0.5)" : parsedNgn > 0 ? "rgba(255,170,0,0.4)" : "rgba(255,255,255,0.1)"}`,
                  }}
                >
                  <span className="text-xl font-bold text-muted-foreground shrink-0">₦</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={ngnInput}
                    onChange={(e) => {
                      // Allow digits and commas only
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      if (raw === "") { setNgnInput(""); return; }
                      // Format with commas
                      setNgnInput(Number(raw).toLocaleString("en-NG"));
                    }}
                    className="flex-1 bg-transparent outline-none text-2xl font-bold placeholder:text-muted-foreground/30 w-full"
                    style={{ color: parsedNgn > 0 && inputValid ? "white" : parsedNgn > 0 ? "rgba(248,113,113,0.9)" : undefined }}
                    autoFocus
                  />
                </div>

                {/* Quick-pick suggestions */}
                <div className="flex gap-2 mt-2.5">
                  {[5000, 10000, 25000, 50000].map((a) => (
                    <button
                      key={a}
                      onClick={() => setNgnInput(a.toLocaleString("en-NG"))}
                      className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}
                    >
                      ₦{a >= 1000 ? `${a / 1000}k` : a}
                    </button>
                  ))}
                </div>
              </div>

              {/* USDC preview */}
              {usdcPreview && inputValid && (
                <div className="flex justify-between items-center text-sm px-1">
                  <span className="text-muted-foreground">You receive approx.</span>
                  <span className="font-bold text-primary">{usdcPreview} USDC</span>
                </div>
              )}

              {fundError && (
                <div className="text-xs text-red-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {fundError}
                </div>
              )}

              <button
                onClick={handleFund}
                disabled={fundState !== "idle" || !inputValid}
                className="w-full h-12 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-40"
                style={{
                  background: inputValid
                    ? "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)"
                    : "rgba(255,255,255,0.07)",
                  color: inputValid ? "hsl(220 40% 5%)" : "rgba(255,255,255,0.3)",
                  border: inputValid ? "none" : "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <ArrowUpRight className="w-4 h-4" />
                {parsedNgn > 0 && inputValid ? `Pay ${formatNGN(parsedNgn)} via Paystack` : "Enter amount to continue"}
              </button>

              <p className="text-[10px] text-muted-foreground text-center">
                Secured by Paystack · USDC credited on Solana devnet
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
