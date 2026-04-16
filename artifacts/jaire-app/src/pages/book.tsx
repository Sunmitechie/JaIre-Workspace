import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useGetWorkspace } from "@workspace/api-client-react";
import { formatNGN } from "@/lib/currency";
import { getUser } from "@/lib/auth";
import { ArrowLeft, Clock, Minus, Plus, Wallet, CreditCard, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Load Paystack v2 inline script ──────────────────────────────────────────
function loadPaystack(): Promise<void> {
  if (typeof (window as any).PaystackPop === "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (document.getElementById("paystack-js-v2")) {
      const wait = setInterval(() => {
        if (typeof (window as any).PaystackPop === "function") { clearInterval(wait); resolve(); }
      }, 100);
      return;
    }
    const s = document.createElement("script");
    s.id = "paystack-js-v2";
    s.src = "https://js.paystack.co/v2/inline.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Paystack failed to load"));
    document.head.appendChild(s);
  });
}

interface BookResult {
  method: "wallet" | "paystack";
  booking_id: string;
  workspace_name: string;
  booking_status: string;
  escrow_tx?: string | null;
  paystack_reference?: string;
  paystack_url?: string;
  paystack_access_code?: string;
  amount_ngn: number;
  amount_usdc: number;
  wallet_balance_usdc: number;
  shortfall_ngn?: number;
}

export default function BookWorkspace() {
  const [, params] = useRoute("/book/:workspaceId");
  const workspaceId = params?.workspaceId || "";
  const [, setLocation] = useLocation();
  const user = getUser();

  const [hours, setHours] = useState(2);
  const [walletBalanceUsdc, setWalletBalanceUsdc] = useState<number | null>(null);
  const [booking, setBooking] = useState<boolean>(false);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: ws, isLoading } = useGetWorkspace(workspaceId, { query: { enabled: !!workspaceId } });

  // Fetch wallet balance on mount
  useEffect(() => {
    if (!user?.walletAddress) return;
    fetch(`${BASE}/api/jaire/devnet/balance/${user.walletAddress}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: any) => setWalletBalanceUsdc(d.usdc_balance ?? 0))
      .catch(() => setWalletBalanceUsdc(0));
  }, [user?.walletAddress]);

  const estimatedNgn = (ws?.hourly_rate_ngn ?? 0) * hours;
  const estimatedUsdc = walletBalanceUsdc !== null && ws ? ws.hourly_rate_ngn * hours / 1600 : null;
  const canPayWithWallet = walletBalanceUsdc !== null && estimatedUsdc !== null && walletBalanceUsdc >= estimatedUsdc;
  const shortfallNgn = estimatedUsdc !== null && walletBalanceUsdc !== null
    ? Math.max(0, Math.round((estimatedUsdc - walletBalanceUsdc) * 1600))
    : 0;

  // Poll payment status after Paystack popup
  const startPolling = (reference: string, bookingId: string) => {
    setPolling(true);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch(`${BASE}/api/payments/status/${reference}`, { cache: "no-store" });
        if (r.ok) {
          const d = await r.json() as { status: string };
          if (d.status === "success") {
            clearInterval(pollRef.current!);
            setPolling(false);
            toast.success("Payment confirmed! Your session is starting.");
            setLocation(`/session/${bookingId}`);
          }
        }
      } catch { /* ignore */ }
      if (attempts >= 60) { // 5 min timeout
        clearInterval(pollRef.current!);
        setPolling(false);
        toast.error("Payment timeout — check your wallet panel to recover.");
      }
    }, 5000);
  };

  const handleBook = async () => {
    if (!ws || !user?.email) {
      toast.error("Please sign in to book.");
      return;
    }

    setBooking(true);
    try {
      const r = await fetch(`${BASE}/api/payments/book-with-balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          planned_duration_hours: hours,
          user_email: user.email,
          user_name: user.name ?? undefined,
          user_wallet_address: user.walletAddress ?? undefined,
        }),
      });

      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? "Booking failed");
      }

      const result = await r.json() as BookResult;

      // Path A: paid from wallet → funds escrowed, waiting for QR scan-in
      if (result.method === "wallet") {
        toast.success(`Booking confirmed! USDC locked in escrow. Scan QR to check in.`);
        setLocation(`/session/${result.booking_id}`);
        return;
      }

      // Path B: Paystack flow
      await loadPaystack();
      const PaystackPop = (window as any).PaystackPop;
      if (!PaystackPop || typeof PaystackPop !== "function") {
        throw new Error("Paystack checkout not available — try opening the app in a new tab.");
      }
      const popup = new PaystackPop();
      popup.resumeTransaction(result.paystack_access_code, {
        onSuccess: () => {
          toast.success("Payment received — confirming on-chain…");
          startPolling(result.paystack_reference!, result.booking_id);
        },
        onCancel: () => {
          toast("Payment cancelled. Your booking slot is held for 10 minutes.");
          setBooking(false);
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setBooking(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container max-w-2xl py-12 px-4">
        <Skeleton className="h-[540px] w-full rounded-3xl" />
      </div>
    );
  }

  if (!ws) {
    return <div className="container py-24 text-center text-muted-foreground">Workspace not found</div>;
  }

  const balanceNgn = walletBalanceUsdc !== null ? Math.round(walletBalanceUsdc * 1600) : null;
  const isProcessing = booking || polling;

  return (
    <div className="container max-w-2xl py-12 px-4 md:px-6">
      <Link href={`/workspaces/${workspaceId}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to details
      </Link>

      <div
        className="rounded-3xl overflow-hidden"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)" }}
      >
        {/* Header */}
        <div
          className="p-8 border-b"
          style={{ background: "rgba(255,170,0,0.04)", borderColor: "rgba(255,170,0,0.12)" }}
        >
          <div className="flex items-center gap-5 mb-6">
            <div className="w-20 h-20 rounded-2xl overflow-hidden shrink-0 border border-white/10">
              <img src={ws.image_url || "/src/assets/the-hub.png"} alt={ws.name} className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-2xl font-bold mb-1">{ws.name}</h1>
              <p className="text-muted-foreground text-sm">Floor {ws.floor} · Up to {ws.capacity} people</p>
            </div>
          </div>

          <div
            className="flex justify-between items-center px-5 py-4 rounded-xl"
            style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.15)" }}
          >
            <div className="text-sm font-medium text-muted-foreground">Hourly rate</div>
            <div className="text-xl font-bold text-primary">
              {formatNGN(ws.hourly_rate_ngn)}<span className="text-sm font-normal text-muted-foreground">/hr</span>
            </div>
          </div>
        </div>

        <div className="p-8 space-y-8">
          {/* Duration */}
          <div>
            <h3 className="text-base font-bold mb-5 flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Duration
            </h3>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setHours(Math.max(1, hours - 1))}
                className="w-11 h-11 rounded-xl flex items-center justify-center transition-all hover:scale-105"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="flex-1 text-center">
                <div className="text-4xl font-bold">{hours}</div>
                <div className="text-sm text-muted-foreground">{hours === 1 ? "hour" : "hours"}</div>
              </div>
              <button
                onClick={() => setHours(Math.min(12, hours + 1))}
                className="w-11 h-11 rounded-xl flex items-center justify-center transition-all hover:scale-105"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 mt-4">
              {[1, 2, 3, 4].map((h) => (
                <button
                  key={h}
                  onClick={() => setHours(h)}
                  className="py-2 rounded-xl text-sm font-medium transition-all"
                  style={
                    hours === h
                      ? { background: "rgba(255,170,0,0.15)", border: "1px solid rgba(255,170,0,0.4)", color: "#FFAA00" }
                      : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }
                  }
                >
                  {h}h
                </button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground mt-3 text-center">
              You'll only be charged for the exact time you stay — billed to the second.
            </p>
          </div>

          {/* Price summary */}
          <div
            className="p-5 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-muted-foreground">{hours}h × {formatNGN(ws.hourly_rate_ngn)}</span>
              <span className="font-medium">{formatNGN(estimatedNgn)}</span>
            </div>
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <span>Security deposit</span>
              <span className="text-emerald-400">₦0 — none required</span>
            </div>
            <div className="mt-4 pt-4 border-t border-white/8 flex justify-between">
              <span className="font-bold">Max charge</span>
              <span className="font-bold text-primary text-lg">{formatNGN(estimatedNgn)}</span>
            </div>
          </div>

          {/* Payment method — smart */}
          <div>
            <h3 className="text-base font-bold mb-4 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              Payment
            </h3>

            {walletBalanceUsdc === null ? (
              <div className="flex items-center gap-3 px-5 py-4 rounded-xl animate-pulse"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Checking your wallet…</span>
              </div>
            ) : canPayWithWallet ? (
              <div
                className="flex items-center gap-4 px-5 py-4 rounded-xl"
                style={{ background: "rgba(124,58,237,0.08)", border: "2px solid rgba(124,58,237,0.35)" }}
              >
                <div className="w-4 h-4 rounded-full border-2 border-purple-400 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-purple-400" />
                </div>
                <div className="flex-1">
                  <div className="font-medium flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-purple-400" />
                    Pay from JaIre Wallet
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Balance: {formatNGN(balanceNgn!)} — instant, no bank needed
                  </div>
                </div>
                <div className="ml-auto">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {balanceNgn !== null && balanceNgn > 0 && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
                    style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)" }}>
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-amber-300">
                      Wallet balance ({formatNGN(balanceNgn)}) is short by {formatNGN(shortfallNgn)} — pay the full amount via Paystack to top up.
                    </span>
                  </div>
                )}
                <div
                  className="flex items-center gap-4 px-5 py-4 rounded-xl cursor-pointer"
                  style={{ background: "rgba(255,170,0,0.06)", border: "2px solid rgba(255,170,0,0.35)" }}
                >
                  <div className="w-4 h-4 rounded-full border-2 border-primary flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  </div>
                  <div>
                    <div className="font-medium">Pay with Paystack</div>
                    <div className="text-xs text-muted-foreground">Debit card, bank transfer, USSD</div>
                  </div>
                  <div className="ml-auto text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-lg">NGN</div>
                </div>
              </div>
            )}
          </div>

          {/* CTA */}
          <button
            className="w-full h-14 rounded-xl text-base font-bold flex items-center justify-center gap-2.5 transition-all hover:scale-[1.01] hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
              color: "hsl(220 40% 5%)",
              boxShadow: "0 8px 32px rgba(255,170,0,0.25)",
            }}
            onClick={handleBook}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {polling ? "Confirming payment…" : "Processing…"}
              </>
            ) : (
              `Confirm — ${formatNGN(estimatedNgn)}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
