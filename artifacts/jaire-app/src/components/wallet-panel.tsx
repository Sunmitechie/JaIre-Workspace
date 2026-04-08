import { useState, useCallback } from "react";
import { getUser, updateUser } from "@/lib/auth";
import { formatNGN } from "@/lib/currency";
import { ExternalLink, Wallet, ArrowUpRight, CheckCircle, Loader2, AlertCircle } from "lucide-react";

const NGN_PER_USDC = 1600;
const AMOUNTS_NGN = [5000, 10000, 25000, 50000];

interface WalletState {
  sol: number;
  usdc: number;
  loading: boolean;
  error: string | null;
}

interface FundResult {
  txHash: string;
  amountNgn: number;
  amountUsdc: number;
  links: { solana_explorer: string; solscan: string };
  isSimulated: boolean;
}

interface WalletPanelProps {
  onClose: () => void;
}

export function WalletPanel({ onClose }: WalletPanelProps) {
  const user = getUser();
  const [wallet, setWallet] = useState<WalletState>({ sol: 0, usdc: 0, loading: false, error: null });
  const [fundState, setFundState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [fundResult, setFundResult] = useState<FundResult | null>(null);
  const [selectedNgn, setSelectedNgn] = useState(10000);
  const [fundError, setFundError] = useState<string | null>(null);
  const [balanceLoaded, setBalanceLoaded] = useState(false);

  const loadBalance = useCallback(async () => {
    if (!user?.walletAddress) return;
    setWallet((w) => ({ ...w, loading: true, error: null }));
    try {
      const res = await fetch(`/jaire/devnet/balance/${user.walletAddress}`);
      const data = await res.json();
      setWallet({ sol: data.sol_balance ?? 0, usdc: data.usdc_balance ?? 0, loading: false, error: null });
      setBalanceLoaded(true);
    } catch {
      setWallet((w) => ({ ...w, loading: false, error: "Couldn't fetch balance" }));
      setBalanceLoaded(true);
    }
  }, [user?.walletAddress]);

  if (!balanceLoaded && !wallet.loading) {
    loadBalance();
  }

  const handleFund = async () => {
    if (!user?.email) return;
    setFundState("loading");
    setFundError(null);

    try {
      const ref = `JAIRE-DEMO-${Date.now()}`;
      const res = await fetch("/jaire/webhook/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_identifier: user.email,
          amount_ngn: selectedNgn,
          user_name: user.name,
        }),
      });

      if (!res.ok) throw new Error("Payment simulation failed");
      const data = await res.json();

      setFundResult({
        txHash: data.tx_signature ?? "simulated",
        amountNgn: data.amount_ngn ?? selectedNgn,
        amountUsdc: data.amount_usdc ?? selectedNgn / NGN_PER_USDC,
        links: data.explorer_links ?? {},
        isSimulated: data.is_test_mode ?? true,
      });
      setFundState("success");
      await loadBalance();
    } catch (err) {
      setFundError("Payment simulation failed. Please try again.");
      setFundState("error");
    }
  };

  const ngnBalance = wallet.usdc * NGN_PER_USDC;
  const shortAddr = user?.walletAddress
    ? `${user.walletAddress.slice(0, 4)}...${user.walletAddress.slice(-4)}`
    : "—";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 mb-6 sm:mb-0 rounded-3xl overflow-hidden"
        style={{ background: "hsl(220 40% 7%)", border: "1px solid rgba(255,170,0,0.15)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4" style={{ background: "rgba(255,170,0,0.04)", borderBottom: "1px solid rgba(255,170,0,0.1)" }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,170,0,0.12)" }}>
                <Wallet className="w-4 h-4 text-primary" />
              </div>
              <span className="font-bold text-sm">Your Wallet</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-widest" style={{ background: "rgba(56,189,248,0.1)", color: "hsl(199 93% 60%)", border: "1px solid rgba(56,189,248,0.25)" }}>
                {user?.walletNetwork ?? "devnet"}
              </span>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
            </div>
          </div>

          <div className="font-mono text-xs text-muted-foreground mb-4 flex items-center gap-2">
            <span>{shortAddr}</span>
            {user?.walletAddress && (
              <a href={`https://explorer.solana.com/address/${user.walletAddress}?cluster=devnet`} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {wallet.loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Checking balance...</span>
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

        <div className="p-6">
          {fundState === "success" && fundResult ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                <CheckCircle className="w-5 h-5" />
                <span>Payment confirmed!</span>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount paid</span>
                  <span>{formatNGN(fundResult.amountNgn)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">USDC received</span>
                  <span className="text-primary">{fundResult.amountUsdc.toFixed(4)} USDC</span>
                </div>
              </div>
              <div className="px-3 py-2.5 rounded-xl text-xs font-mono break-all" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-muted-foreground mb-1">TX Signature {fundResult.isSimulated && <span className="text-amber-400">(devnet sim)</span>}</div>
                <div className="text-foreground/80">{fundResult.txHash.slice(0, 32)}...</div>
              </div>
              {fundResult.links.solscan && (
                <a
                  href={fundResult.links.solscan.replace(/^\[SIMULATED\] /, "")}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs hover:underline"
                  style={{ color: "hsl(199 93% 60%)" }}
                >
                  <ExternalLink className="w-3 h-3" />
                  View on Solscan {fundResult.isSimulated && "(devnet)"}
                </a>
              )}
              <button
                onClick={() => { setFundState("idle"); setFundResult(null); }}
                className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                Add more funds
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold mb-3">Top Up Account</p>
                <div className="grid grid-cols-4 gap-2">
                  {AMOUNTS_NGN.map((a) => (
                    <button
                      key={a}
                      onClick={() => setSelectedNgn(a)}
                      className="py-2 rounded-xl text-[11px] font-bold transition-all"
                      style={
                        selectedNgn === a
                          ? { background: "rgba(255,170,0,0.15)", border: "1px solid rgba(255,170,0,0.4)", color: "#FFAA00" }
                          : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }
                      }
                    >
                      ₦{a >= 1000 ? `${a / 1000}k` : a}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-between text-sm px-1">
                <span className="text-muted-foreground">You get</span>
                <span className="font-medium text-primary">{(selectedNgn / NGN_PER_USDC).toFixed(4)} USDC</span>
              </div>

              {fundError && (
                <div className="text-xs text-red-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {fundError}
                </div>
              )}

              <button
                onClick={handleFund}
                disabled={fundState === "loading"}
                className="w-full h-12 rounded-xl font-bold flex items-center justify-center gap-2 transition-all hover:opacity-90 disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                  color: "hsl(220 40% 5%)",
                }}
              >
                {fundState === "loading" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                ) : (
                  <><ArrowUpRight className="w-4 h-4" /> Pay {formatNGN(selectedNgn)}</>
                )}
              </button>

              <p className="text-[10px] text-muted-foreground text-center">
                Devnet demo — no real money is charged. Powered by Solana.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
