import { Link } from "wouter";
import { useListBookings } from "@workspace/api-client-react";
import { formatNGN } from "@/lib/currency";
import { Calendar, Clock, MapPin, ArrowRight, Receipt, ExternalLink, Link2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

const SOLANA_EXPLORER = "https://explorer.solana.com/tx";

function explorerUrl(sig: string) {
  return `${SOLANA_EXPLORER}/${sig}?cluster=devnet`;
}

function TxPill({ sig, label }: { sig: string; label: string }) {
  return (
    <a
      href={explorerUrl(sig)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono transition-all hover:opacity-80"
      style={{
        background: "rgba(52,211,153,0.08)",
        border: "1px solid rgba(52,211,153,0.25)",
        color: "#34d399",
      }}
    >
      <Link2 className="w-2.5 h-2.5 shrink-0" />
      {sig.slice(0, 6)}…{sig.slice(-4)}
      <span className="font-sans font-medium text-emerald-400/60">{label}</span>
      <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-50" />
    </a>
  );
}

const statusStyles: Record<string, { bg: string; border: string; color: string }> = {
  active:    { bg: "rgba(52,211,153,0.1)",  border: "rgba(52,211,153,0.3)",  color: "#34d399" },
  confirmed: { bg: "rgba(124,58,237,0.1)",  border: "rgba(124,58,237,0.3)",  color: "#a78bfa" },
  pending:   { bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.25)", color: "#fbbf24" },
  completed: { bg: "rgba(255,255,255,0.05)",border: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" },
  cancelled: { bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.2)",   color: "#f87171" },
};

export default function Bookings() {
  const { data: bookings, isLoading } = useListBookings();

  return (
    <div className="container py-12 px-4 md:px-6 max-w-5xl mx-auto">
      <div className="mb-12">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-widest mb-4"
          style={{ background: "rgba(255,170,0,0.08)", color: "#FFAA00", border: "1px solid rgba(255,170,0,0.2)" }}
        >
          <Receipt className="w-3 h-3" /> Your Sessions
        </div>
        <h1 className="text-5xl font-bold tracking-tight mb-2">Bookings</h1>
        <p className="text-muted-foreground text-lg">Your workspace history and on-chain receipts.</p>
      </div>

      <div className="space-y-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))
          : bookings?.length === 0
          ? (
            <div
              className="py-24 text-center rounded-3xl"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.1)" }}
            >
              <MapPin className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">No bookings yet</h3>
              <p className="text-muted-foreground mb-8">Book your first workspace to get started.</p>
              <Link href="/workspaces">
                <button
                  className="h-10 px-6 rounded-xl text-sm font-semibold inline-flex items-center gap-2 transition-all hover:scale-[1.02]"
                  style={{
                    background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                    color: "hsl(220 40% 5%)",
                  }}
                >
                  Browse Spaces <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </Link>
            </div>
          )
          : bookings?.map((booking) => {
              const bk = booking as any;
              const style = statusStyles[bk.status] || statusStyles.completed!;
              const durationMins = Math.round((bk.actual_duration_seconds || 0) / 60);
              const hasEscrow = !!bk.escrow_tx_signature;
              const hasSettle = !!bk.settlement_tx_signature;
              const isWalletPayment = bk.payment_method === "usdc_wallet";

              return (
                <div
                  key={bk.id}
                  className="rounded-2xl p-6 flex flex-col gap-4 transition-all hover:scale-[1.002]"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.15)" }}
                    >
                      <MapPin className="w-6 h-6 text-primary" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                        <h3 className="font-bold text-lg">{bk.workspace_name}</h3>
                        <span
                          className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
                          style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}
                        >
                          {bk.status}
                        </span>
                        {isWalletPayment && (
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
                            style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)", color: "#a78bfa" }}
                          >
                            On-chain
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" />
                          {bk.check_in_time
                            ? format(new Date(bk.check_in_time), "MMM d, yyyy · h:mm a")
                            : "—"}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          {durationMins > 0 ? `${durationMins} min` : `${bk.planned_duration_hours}h planned`}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:flex-col md:items-end gap-4 border-t md:border-t-0 border-white/6 pt-4 md:pt-0 shrink-0">
                      <div className="text-right">
                        <div className="text-xl font-bold text-primary">
                          {formatNGN(bk.ngn_amount_paid || 0)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {bk.escrow_amount_usdc ? `${bk.escrow_amount_usdc.toFixed(3)} USDC escrowed` : bk.status === "active" ? "running" : "total"}
                        </div>
                      </div>

                      {(bk.status === "active" || bk.status === "confirmed") && (
                        <Link href={`/session/${bk.id}`}>
                          <button
                            className="h-8 px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all hover:scale-[1.03]"
                            style={{
                              background: bk.status === "active" ? "rgba(52,211,153,0.12)" : "rgba(124,58,237,0.12)",
                              color: bk.status === "active" ? "#34d399" : "#a78bfa",
                              border: `1px solid ${bk.status === "active" ? "rgba(52,211,153,0.3)" : "rgba(124,58,237,0.3)"}`,
                            }}
                          >
                            {bk.status === "active" ? "Live" : "View"} <ArrowRight className="w-3 h-3" />
                          </button>
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* On-chain transaction links */}
                  {(hasEscrow || hasSettle) && (
                    <div
                      className="flex flex-wrap gap-2 pt-3 border-t"
                      style={{ borderColor: "rgba(52,211,153,0.1)" }}
                    >
                      <span className="text-[11px] text-muted-foreground self-center mr-1">Solana devnet:</span>
                      {hasEscrow && (
                        <TxPill sig={bk.escrow_tx_signature} label="escrow" />
                      )}
                      {hasSettle && (
                        <TxPill sig={bk.settlement_tx_signature} label="settlement" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
      </div>
    </div>
  );
}
