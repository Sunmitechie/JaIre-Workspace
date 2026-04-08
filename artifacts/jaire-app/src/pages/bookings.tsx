import { Link } from "wouter";
import { useListBookings } from "@workspace/api-client-react";
import { formatNGN } from "@/lib/currency";
import { Calendar, Clock, MapPin, ArrowRight, Receipt } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

const statusStyles: Record<string, { bg: string; border: string; color: string }> = {
  active: { bg: "rgba(52,211,153,0.1)", border: "rgba(52,211,153,0.3)", color: "#34d399" },
  completed: { bg: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)" },
  cancelled: { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)", color: "#f87171" },
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
        <p className="text-muted-foreground text-lg">Your workspace history and receipts.</p>
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
              const style = statusStyles[booking.status] || statusStyles.completed!;
              const durationMins = Math.round((booking.actual_duration_seconds || 0) / 60);
              return (
                <div
                  key={booking.id}
                  className="rounded-2xl p-6 flex flex-col md:flex-row md:items-center gap-5 transition-all hover:scale-[1.005]"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.15)" }}
                  >
                    <MapPin className="w-6 h-6 text-primary" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                      <h3 className="font-bold text-lg">{booking.workspace_name}</h3>
                      <span
                        className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
                        style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}
                      >
                        {booking.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        {booking.check_in_time
                          ? format(new Date(booking.check_in_time), "MMM d, yyyy · h:mm a")
                          : "—"}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {durationMins > 0 ? `${durationMins} min` : "0 min"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between md:flex-col md:items-end gap-4 border-t md:border-t-0 border-white/6 pt-4 md:pt-0 shrink-0">
                    <div className="text-right">
                      <div className="text-xl font-bold text-primary">
                        {formatNGN(booking.ngn_amount_paid || 0)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {booking.status === "active" ? "running" : "total"}
                      </div>
                    </div>

                    {booking.status === "active" && (
                      <Link href={`/session/${booking.id}`}>
                        <button
                          className="h-8 px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all hover:scale-[1.03]"
                          style={{ background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }}
                        >
                          Live <ArrowRight className="w-3 h-3" />
                        </button>
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
}
