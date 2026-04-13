import { Link } from "wouter";
import { useListBookings } from "@workspace/api-client-react";
import { getUser } from "@/lib/auth";
import { formatNGN } from "@/lib/currency";
import {
  QrCode,
  Activity,
  Clock,
  History,
  Mic,
  MapPin,
  LogIn,
  LogOut,
  ChevronRight,
  Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const user = getUser();
  const { data: bookings, isLoading } = useListBookings();

  const activeSession = bookings?.find((b) => b.status === "active");
  const recentSessions = bookings?.filter((b) => b.status === "completed").slice(0, 4) ?? [];

  const totalSpentNgn = bookings
    ?.filter((b) => b.status === "completed" && b.ngn_amount_paid)
    .reduce((sum, b) => sum + (b.ngn_amount_paid ?? 0), 0) ?? 0;

  const totalSessions = bookings?.filter((b) => b.status === "completed").length ?? 0;

  const displayName = user?.name?.split(" ")[0] || "Nomad";

  return (
    <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Welcome back,</p>
          <h1 className="text-2xl font-bold">{displayName}</h1>
        </div>
        <Link href="/baire">
          <button
            className="h-9 px-4 rounded-xl text-sm font-medium flex items-center gap-2 transition-all hover:opacity-90"
            style={{
              background: "rgba(139,92,246,0.12)",
              border: "1px solid rgba(139,92,246,0.25)",
              color: "hsl(262 83% 72%)",
            }}
          >
            <Mic className="w-3.5 h-3.5" />
            Ask Baire
          </button>
        </Link>
      </div>

      {activeSession ? (
        <Link href={`/session/${activeSession.id}`}>
          <div
            className="rounded-2xl p-5 cursor-pointer hover:opacity-90 transition-opacity"
            style={{
              background: "linear-gradient(135deg, rgba(255,170,0,0.12) 0%, rgba(255,170,0,0.06) 100%)",
              border: "1px solid rgba(255,170,0,0.3)",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-widest text-primary">Live Session</span>
              </div>
              <Activity className="w-4 h-4 text-primary animate-pulse" />
            </div>
            <div className="font-bold text-lg mb-1">{activeSession.workspace_name}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Billing in progress — tap to view
            </div>
          </div>
        </Link>
      ) : (
        <div
          className="rounded-2xl p-5"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <p className="text-sm text-muted-foreground mb-4">Not checked in yet.</p>
          <Link href="/scan">
            <button
              className="w-full h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:scale-[1.01]"
              style={{
                background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                color: "hsl(220 40% 5%)",
              }}
            >
              <QrCode className="w-4 h-4" />
              Scan to Check In
            </button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Total Sessions", value: isLoading ? "—" : totalSessions.toString(), icon: History, color: "rgba(56,189,248," },
          { label: "Total Spent", value: isLoading ? "—" : formatNGN(totalSpentNgn), icon: Zap, color: "rgba(139,92,246," },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="rounded-2xl p-4"
            style={{ background: `${color}0.06)`, border: `1px solid ${color}0.15)` }}
          >
            <Icon className="w-4 h-4 mb-3" style={{ color: `${color}0.8)` }} />
            <div className="text-xl font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/scan">
          <div
            className="rounded-2xl p-4 cursor-pointer hover:opacity-90 transition-opacity flex flex-col gap-3"
            style={{ background: "rgba(255,170,0,0.06)", border: "1px solid rgba(255,170,0,0.18)" }}
          >
            <QrCode className="w-5 h-5 text-primary" />
            <div>
              <div className="font-semibold text-sm">Scan QR</div>
              <div className="text-xs text-muted-foreground">Check in or out</div>
            </div>
          </div>
        </Link>
        <Link href="/workspaces">
          <div
            className="rounded-2xl p-4 cursor-pointer hover:opacity-90 transition-opacity flex flex-col gap-3"
            style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.18)" }}
          >
            <MapPin className="w-5 h-5" style={{ color: "rgba(56,189,248,0.85)" }} />
            <div>
              <div className="font-semibold text-sm">Browse Spaces</div>
              <div className="text-xs text-muted-foreground">Explore hubs</div>
            </div>
          </div>
        </Link>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-widest">Recent Sessions</h2>
          <Link href="/bookings">
            <button className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ChevronRight className="w-3 h-3" />
            </button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : recentSessions.length === 0 ? (
          <div
            className="rounded-xl p-6 text-center text-sm text-muted-foreground"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            No sessions yet. Scan a workspace QR to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {recentSessions.map((b) => (
              <Link key={b.id} href={`/session/${b.id}`}>
                <div
                  className="rounded-xl p-4 flex items-center gap-4 hover:bg-white/4 transition-colors cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(255,170,0,0.1)" }}
                  >
                    {b.status === "active" ? (
                      <LogIn className="w-4 h-4 text-primary" />
                    ) : (
                      <LogOut className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{b.workspace_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.check_in_time
                        ? new Date(b.check_in_time).toLocaleDateString("en-NG", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Unknown time"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-primary">
                      {b.ngn_amount_paid ? formatNGN(b.ngn_amount_paid) : "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground capitalize">{b.status}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
