import { useState, useEffect } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useGetBookingStatus, useCheckoutBooking, useGetBooking } from "@workspace/api-client-react";
import { formatNGN } from "@/lib/currency";
import { LogOut, Activity, MapPin, Clock, ExternalLink, CheckCircle2, Loader2, QrCode, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const SOLANA_EXPLORER = "https://explorer.solana.com/tx";

function explorerUrl(sig: string) {
  return `${SOLANA_EXPLORER}/${sig}?cluster=devnet`;
}

function TxLink({ sig, label }: { sig: string; label: string }) {
  return (
    <a
      href={explorerUrl(sig)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400 hover:text-emerald-300 transition-colors underline underline-offset-2"
    >
      {sig.slice(0, 8)}...{sig.slice(-6)}
      <ExternalLink className="w-3 h-3 shrink-0" />
      <span className="font-sans text-muted-foreground not-italic">{label}</span>
    </a>
  );
}

export default function Session() {
  const [, params] = useRoute("/session/:bookingId");
  const bookingId = params?.bookingId || "";
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: booking, isLoading: isBookingLoading, refetch } = useGetBooking(bookingId, {
    query: {
      enabled: !!bookingId,
      refetchInterval: (data) => {
        // Keep polling until the booking goes "active" or "completed"
        const status = (data as any)?.status;
        return status === "pending" || status === "confirmed" ? 3000 : false;
      },
    },
  });

  const { data: status } = useGetBookingStatus(bookingId, {
    query: {
      enabled: !!bookingId && (booking as any)?.status === "active",
      refetchInterval: 2000,
    },
  });

  const checkout = useCheckoutBooking();

  const handleCheckout = () => {
    checkout.mutate(
      { bookingId },
      {
        onSuccess: (data: any) => {
          toast.success("Checked out successfully!");
          queryClient.invalidateQueries();
          setLocation("/bookings");
        },
        onError: () => toast.error("Checkout failed. Please try again."),
      }
    );
  };

  if (isBookingLoading || !booking) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Skeleton className="h-96 w-[480px] rounded-3xl" />
      </div>
    );
  }

  const bk = booking as any;
  const bookingStatus: string = bk.status ?? "pending";
  const isCompleted = bookingStatus === "completed";
  const isActive = bookingStatus === "active";
  const isConfirmed = bookingStatus === "confirmed";
  const isPending = bookingStatus === "pending";

  const displayNGN = isCompleted
    ? (bk.ngn_amount_paid || 0)
    : ((status as any)?.current_cost_ngn || 0);
  const displayTime = isCompleted
    ? "Completed"
    : (status as any)?.elapsed_display || "00:00:00";
  const progress = isCompleted
    ? 100
    : Math.min(100, (((status as any)?.elapsed_seconds || 0) / ((status as any)?.planned_seconds || 1)) * 100);
  const limitNGN = (bk.escrow_amount_usdc || 0) * 1600;

  const escrowTx: string | null = bk.escrow_tx_signature ?? null;
  const settleTx: string | null = bk.settlement_tx_signature ?? null;

  // ── Pending state (payment not yet confirmed) ───────────────────────────
  if (isPending) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div
          className="w-full max-w-md rounded-3xl overflow-hidden shadow-2xl text-center p-10"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)" }}
        >
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 mx-auto"
            style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)" }}
          >
            <Loader2 className="w-7 h-7 text-amber-400 animate-spin" />
          </div>
          <h2 className="text-xl font-bold mb-2">{bk.workspace_name}</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Awaiting payment confirmation…<br />
            This usually takes just a few seconds.
          </p>
          <Link href="/bookings">
            <button className="text-sm text-muted-foreground hover:text-foreground transition-colors underline">
              View all bookings
            </button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Confirmed state (paid + escrowed, waiting for physical scan-in) ─────
  if (isConfirmed) {
    return (
      <div
        className="flex-1 flex items-center justify-center p-4"
        style={{ background: "radial-gradient(ellipse at center, rgba(124,58,237,0.04) 0%, transparent 70%)" }}
      >
        <div
          className="w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)" }}
        >
          <div
            className="h-1"
            style={{ background: "linear-gradient(90deg, hsl(262 83% 66%) 0%, hsl(199 93% 60%) 100%)" }}
          />

          <div className="p-8 text-center">
            <div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6"
              style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.35)" }}
            >
              <CheckCircle2 className="w-7 h-7 text-purple-400" />
            </div>

            <h2 className="text-xl font-bold mb-1">{bk.workspace_name}</h2>
            <p className="text-xs font-semibold text-purple-400 uppercase tracking-widest mb-6">
              Booking Confirmed · Funds Escrowed
            </p>

            <div
              className="rounded-2xl p-5 mb-6 text-left space-y-3"
              style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)" }}
            >
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Amount escrowed</span>
                <span className="font-bold text-purple-300">
                  {bk.escrow_amount_usdc?.toFixed(4)} USDC
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">NGN paid</span>
                <span className="font-medium">{formatNGN(bk.ngn_amount_paid || 0)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Reserved for</span>
                <span className="font-medium">{bk.planned_duration_hours}h</span>
              </div>
              {escrowTx && (
                <div className="pt-2 border-t border-white/8">
                  <p className="text-xs text-muted-foreground mb-1.5">On-chain escrow transaction</p>
                  <TxLink sig={escrowTx} label="(Solana devnet)" />
                </div>
              )}
            </div>

            <div
              className="rounded-2xl p-5 mb-6"
              style={{ background: "rgba(255,170,0,0.06)", border: "1px solid rgba(255,170,0,0.2)" }}
            >
              <QrCode className="w-8 h-8 text-primary mx-auto mb-3" />
              <p className="font-semibold mb-1">Scan in when you arrive</p>
              <p className="text-sm text-muted-foreground">
                Go to the workspace and scan the QR code at the entrance. Your USDC stays locked in the vault until you check out.
              </p>
            </div>

            <div className="text-xs text-muted-foreground">
              <p>Billing is per-second from scan-in to scan-out.</p>
              <p>Unused USDC is refunded immediately on checkout.</p>
            </div>
          </div>

          <div className="px-8 pb-8">
            <Link href="/scan">
              <button
                className="w-full h-14 rounded-xl text-base font-bold flex items-center justify-center gap-2.5 transition-all hover:scale-[1.01] hover:shadow-2xl"
                style={{
                  background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                  color: "hsl(220 40% 5%)",
                  boxShadow: "0 8px 32px rgba(255,170,0,0.25)",
                }}
              >
                <QrCode className="w-5 h-5" />
                Scan QR to Check In
              </button>
            </Link>
            <Link href="/bookings">
              <button className="w-full mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors py-2">
                View all bookings
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Active + Completed state (existing live session view) ───────────────
  return (
    <div className="flex-1 flex items-center justify-center p-4" style={{ background: "radial-gradient(ellipse at center, rgba(255,170,0,0.03) 0%, transparent 70%)" }}>
      <div
        className="w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)" }}
      >
        {!isCompleted && (
          <div
            className="h-1 transition-all duration-1000"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, hsl(43 100% 50%) 0%, hsl(262 83% 66%) 50%, hsl(199 93% 60%) 100%)",
            }}
          />
        )}

        <div className="p-8 text-center">
          <div
            className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 ${!isCompleted ? "pulse-ring" : ""}`}
            style={
              isCompleted
                ? { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }
                : { background: "rgba(255,170,0,0.12)", border: "1px solid rgba(255,170,0,0.3)" }
            }
          >
            {isCompleted ? (
              <MapPin className="w-7 h-7 text-muted-foreground" />
            ) : (
              <Activity className="w-7 h-7 text-primary animate-pulse" />
            )}
          </div>

          <h2 className="text-xl font-bold mb-1">{bk.workspace_name}</h2>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-8">
            {isCompleted ? "Session Ended" : "Live Session · Billing Per Second"}
          </div>

          <div className="font-mono text-7xl font-bold tracking-tighter mb-8 leading-none">
            {displayTime}
          </div>

          <div
            className="rounded-2xl p-6"
            style={{ background: "rgba(255,170,0,0.06)", border: "1px solid rgba(255,170,0,0.15)" }}
          >
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
              {isCompleted ? "Total Billed" : "Current Cost"}
            </div>
            <div className="text-4xl font-bold text-primary">
              {formatNGN(displayNGN)}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
              <Clock className="w-3 h-3" />
              Billed to the second
            </div>
          </div>

          {/* On-chain tx links */}
          {(escrowTx || settleTx) && (
            <div className="mt-4 space-y-2 text-left">
              {escrowTx && <TxLink sig={escrowTx} label="Escrow lock" />}
              {settleTx && <TxLink sig={settleTx} label="Settlement" />}
            </div>
          )}
        </div>

        <div className="px-8 pb-8">
          {!isCompleted && (
            <div className="mb-6">
              <div className="flex justify-between text-xs font-medium text-muted-foreground mb-2">
                <span>Session usage</span>
                <span className="font-mono">{progress.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${progress}%`,
                    background: "linear-gradient(90deg, hsl(43 100% 50%) 0%, hsl(262 83% 66%) 100%)",
                  }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-[11px] text-muted-foreground">
                <span>₦0</span>
                <span>{formatNGN(limitNGN)} escrowed limit</span>
              </div>
            </div>
          )}

          {!isCompleted ? (
            <button
              className="w-full h-14 rounded-xl text-base font-semibold flex items-center justify-center gap-2.5 transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}
              onClick={handleCheckout}
              disabled={checkout.isPending}
            >
              <LogOut className="w-5 h-5" />
              {checkout.isPending ? "Checking out..." : "Check Out"}
            </button>
          ) : (
            <div className="space-y-3">
              {settleTx && (
                <div
                  className="rounded-xl p-4 text-sm"
                  style={{ background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.2)" }}
                >
                  <p className="text-emerald-400 font-semibold mb-1">Settlement confirmed on-chain</p>
                  <TxLink sig={settleTx} label="85/15 split" />
                </div>
              )}
              <Link href="/bookings">
                <button
                  className="w-full h-14 rounded-xl text-base font-semibold transition-all hover:opacity-90"
                  style={{
                    background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                    color: "hsl(220 40% 5%)",
                  }}
                >
                  View Booking History
                </button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
