import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { formatNGN, formatUSDC } from "@/lib/currency";
import { Wallet, Copy, ExternalLink, ShieldCheck, Zap, Loader2, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { getUser } from "@/lib/auth";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const MARKET_RATE = 1600;

interface WalletBalance {
  wallet_address: string;
  sol_balance: number;
  usdc_balance: number;
  usdc_mint: string;
}

export default function WalletPage() {
  const user = getUser();
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [airdropping, setAirdropping] = useState(false);
  const [lastAirdropTx, setLastAirdropTx] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!user?.walletAddress) { setLoading(false); return; }
    try {
      const r = await fetch(`${BASE}/mpc/balance/${user.walletAddress}`, { cache: "no-store" });
      if (r.ok) setBalance(await r.json());
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [user?.walletAddress]);

  // Sync verifierId to DB on mount so wallet booking path works
  useEffect(() => {
    if (!user?.idToken) return;
    fetch(`${BASE}/api/wallet/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ web3auth_token: user.idToken, email: user.email, name: user.name }),
    }).catch(() => {});
  }, [user?.idToken]);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);

  const copyAddress = () => {
    if (user?.walletAddress) {
      navigator.clipboard.writeText(user.walletAddress);
      toast.success("Address copied");
    }
  };

  const openExplorer = () => {
    if (user?.walletAddress) {
      window.open(`https://explorer.solana.com/address/${user.walletAddress}?cluster=devnet`, "_blank");
    }
  };

  const handleAirdrop = async () => {
    if (!user?.walletAddress) return;
    setAirdropping(true);
    try {
      const r = await fetch(`${BASE}/api/wallet/devnet-airdrop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: user.walletAddress, amount_usdc: 5 }),
      });
      const data = await r.json() as { success?: boolean; tx_signature?: string; is_simulated?: boolean; amount_usdc?: number; error?: string };
      if (!r.ok || !data.success) throw new Error(data.error ?? "Airdrop failed");

      setLastAirdropTx(data.tx_signature ?? null);
      toast.success(`+${data.amount_usdc} USDC received!`, {
        description: data.is_simulated
          ? "Simulated on devnet"
          : data.tx_signature
            ? `Tx: ${data.tx_signature.slice(0, 12)}…`
            : undefined,
        action: data.tx_signature ? {
          label: "View on Solana",
          onClick: () => window.open(`https://explorer.solana.com/tx/${data.tx_signature}?cluster=devnet`, "_blank"),
        } : undefined,
      });
      await fetchBalance();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Airdrop failed");
    } finally {
      setAirdropping(false);
    }
  };

  if (!user) {
    return (
      <div className="container py-24 text-center max-w-md mx-auto">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{ background: "rgba(255,255,255,0.06)" }}>
          <Wallet className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold mb-3">Sign in first</h2>
        <p className="text-muted-foreground">Connect your wallet from the top navigation to access this page.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="container py-12 max-w-2xl"><Skeleton className="h-72 w-full rounded-3xl" /></div>;
  }

  const ngnEquiv = balance ? Math.round(balance.usdc_balance * MARKET_RATE) : 0;

  return (
    <div className="container py-12 px-4 max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">JaIre Wallet</h1>

      {/* Balance card */}
      <div
        className="rounded-3xl p-8 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.18) 0%, rgba(255,255,255,0.03) 100%)", border: "1px solid rgba(124,58,237,0.3)" }}
      >
        <div className="absolute top-0 right-0 p-8 opacity-[0.07] pointer-events-none">
          <ShieldCheck className="w-40 h-40 text-purple-400" />
        </div>

        <div className="relative z-10">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">Available Balance</div>
          <div className="text-5xl font-bold tracking-tighter mb-1">{formatUSDC(balance?.usdc_balance ?? 0)}</div>
          <div className="text-sm text-muted-foreground mb-6">≈ {formatNGN(ngnEquiv)} · {(balance?.sol_balance ?? 0).toFixed(4)} SOL</div>

          <div className="pt-5 border-t border-white/10 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Solana Address (Devnet)</div>
              <div className="font-mono text-sm">
                {user.walletAddress
                  ? `${user.walletAddress.slice(0, 8)}…${user.walletAddress.slice(-8)}`
                  : "Not connected"}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyAddress}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
                title="Copy address"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                onClick={openExplorer}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-105"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
                title="View on Solana Explorer"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Devnet airdrop */}
      <div
        className="rounded-3xl p-6"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(0,255,163,0.1)", border: "1px solid rgba(0,255,163,0.2)" }}>
            <Zap className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex-1">
            <div className="font-bold mb-0.5">Get Test USDC (Devnet)</div>
            <div className="text-sm text-muted-foreground mb-4">
              Receive 5 USDC from the JaIre treasury on Solana devnet. Use it to book a workspace and see the on-chain escrow transaction.
            </div>

            {lastAirdropTx && (
              <a
                href={`https://explorer.solana.com/tx/${lastAirdropTx}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-emerald-400 mb-3 hover:underline"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Last airdrop confirmed on-chain · View tx
              </a>
            )}

            <Button
              onClick={handleAirdrop}
              disabled={airdropping || !user.walletAddress}
              className="h-11 px-6 rounded-xl font-semibold"
              style={{
                background: "linear-gradient(135deg, rgba(0,255,163,0.15) 0%, rgba(0,200,130,0.2) 100%)",
                border: "1px solid rgba(0,255,163,0.35)",
                color: "#00FFA3",
              }}
            >
              {airdropping ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-2" />Sending…</>
              ) : (
                <><Zap className="w-4 h-4 mr-2" />Airdrop 5 USDC</>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div
        className="rounded-2xl p-5 text-sm text-muted-foreground"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="font-semibold text-foreground mb-2">How your wallet works</div>
        <ul className="space-y-1.5 list-disc list-inside">
          <li>Your wallet is created invisibly when you sign in — no seed phrases, no MetaMask</li>
          <li>When you pay with Paystack, NGN converts to USDC and goes into your wallet</li>
          <li>When you book, USDC is locked in escrow on Solana — fully on-chain</li>
          <li>At checkout, only the time you used is billed — the rest is refunded to this wallet</li>
        </ul>
      </div>
    </div>
  );
}
