import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useListBookings } from "@workspace/api-client-react";
import { useListWorkspaces } from "@workspace/api-client-react";
import { getUser } from "@/lib/auth";
import { formatNGN } from "@/lib/currency";
import { WalletPanel } from "@/components/wallet-panel";
import {
  QrCode,
  Activity,
  Clock,
  Mic,
  MapPin,
  ChevronRight,
  Wallet,
  Star,
  Users,
  Wifi,
  Loader2,
} from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const NGN_PER_USDC = 1600;

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const user = getUser();
  const displayName = user?.name?.split(" ")[0] || "Nomad";

  const [walletOpen, setWalletOpen] = useState(false);
  const [ngnBalance, setNgnBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const {
    data: bookings,
    isLoading: bookingsLoading,
    refetch: refetchBookings,
  } = useListBookings();

  const { data: workspaces, isLoading: wsLoading } = useListWorkspaces();

  const activeSession = bookings?.find((b) => b.status === "active");
  const completedSessions = bookings?.filter((b) => b.status === "completed") ?? [];
  const hasAnyBookings = (bookings?.length ?? 0) > 0;

  const fetchBalance = useCallback(async () => {
    if (!user?.walletAddress) return;
    setBalanceLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/jaire/devnet/balance/${user.walletAddress}`);
      if (!res.ok) return;
      const data = await res.json();
      setNgnBalance((data.usdc_balance ?? 0) * NGN_PER_USDC);
    } catch {
    } finally {
      setBalanceLoading(false);
    }
  }, [user?.walletAddress]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  useEffect(() => {
    const iv = setInterval(() => {
      refetchBookings();
      setTick((t) => t + 1);
    }, 30000);
    return () => clearInterval(iv);
  }, [refetchBookings]);

  useEffect(() => {
    if (tick > 0) fetchBalance();
  }, [tick, fetchBalance]);

  const featuredWorkspaces = workspaces?.slice(0, 3) ?? [];

  return (
    <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{timeGreeting()},</p>
          <h1 className="text-2xl font-bold">{displayName} 👋</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {activeSession ? "You're checked in right now." : "Ready to work today?"}
          </p>
        </div>
        <Link href="/baire">
          <button
            className="h-9 px-4 rounded-xl text-sm font-medium flex items-center gap-2 transition-all hover:opacity-90 shrink-0"
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

      <button
        onClick={() => { setWalletOpen(true); fetchBalance(); }}
        className="w-full rounded-2xl p-4 flex items-center gap-4 text-left hover:opacity-90 transition-opacity"
        style={{
          background: "linear-gradient(135deg, rgba(255,170,0,0.1) 0%, rgba(255,170,0,0.04) 100%)",
          border: "1px solid rgba(255,170,0,0.25)",
        }}
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(255,170,0,0.15)" }}
        >
          <Wallet className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground mb-0.5">Your Balance</div>
          {balanceLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Loading…</span>
            </div>
          ) : (
            <div className="text-xl font-bold text-primary">
              {ngnBalance !== null ? formatNGN(ngnBalance) : user?.walletAddress ? "Tap to load" : "No wallet yet"}
            </div>
          )}
        </div>
        <div className="text-xs text-muted-foreground shrink-0">
          {ngnBalance !== null && ngnBalance === 0 ? "Top up →" : "View →"}
        </div>
      </button>

      {activeSession ? (
        <Link href={`/session/${activeSession.id}`}>
          <div
            className="rounded-2xl p-5 cursor-pointer hover:opacity-90 transition-opacity"
            style={{
              background: "linear-gradient(135deg, rgba(52,211,153,0.1) 0%, rgba(52,211,153,0.04) 100%)",
              border: "1px solid rgba(52,211,153,0.3)",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Live Session</span>
              </div>
              <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
            </div>
            <div className="font-bold text-lg mb-1">{activeSession.workspace_name}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Checked in ·{" "}
              {activeSession.check_in_time
                ? new Date(activeSession.check_in_time).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })
                : ""}
              {" "}· Tap to view
            </div>
          </div>
        </Link>
      ) : (
        <Link href="/scan">
          <div
            className="rounded-2xl p-5 flex items-center gap-4 cursor-pointer hover:opacity-90 transition-opacity"
            style={{
              background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
            }}
          >
            <div className="w-10 h-10 rounded-xl bg-black/15 flex items-center justify-center shrink-0">
              <QrCode className="w-5 h-5 text-black/80" />
            </div>
            <div>
              <div className="font-bold text-black/90">Scan to Check In</div>
              <div className="text-xs text-black/60 mt-0.5">Point your camera at any workspace QR</div>
            </div>
            <ChevronRight className="w-5 h-5 text-black/50 ml-auto" />
          </div>
        </Link>
      )}

      {hasAnyBookings && completedSessions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-widest">Recent Sessions</h2>
            <Link href="/bookings">
              <button className="text-xs text-primary hover:underline flex items-center gap-1">
                All <ChevronRight className="w-3 h-3" />
              </button>
            </Link>
          </div>
          <div className="space-y-2">
            {completedSessions.slice(0, 3).map((b) => (
              <Link key={b.id} href={`/session/${b.id}`}>
                <div
                  className="rounded-xl p-4 flex items-center gap-4 hover:bg-white/4 transition-colors cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(255,170,0,0.08)" }}
                  >
                    <MapPin className="w-4 h-4 text-primary" />
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
                        : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-primary">
                      {b.ngn_amount_paid ? formatNGN(b.ngn_amount_paid) : "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">completed</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-widest">Available Spaces</h2>
          <Link href="/workspaces">
            <button className="text-xs text-primary hover:underline flex items-center gap-1">
              See all <ChevronRight className="w-3 h-3" />
            </button>
          </Link>
        </div>

        {wsLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-20 rounded-2xl animate-pulse"
                style={{ background: "rgba(255,255,255,0.03)" }}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {featuredWorkspaces.map((ws: any) => (
              <Link key={ws.id} href={`/workspaces/${ws.id}`}>
                <div
                  className="rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:bg-white/4 transition-colors"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-lg"
                    style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)" }}
                  >
                    🏢
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{ws.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                      <MapPin className="w-3 h-3" />
                      {ws.location ?? "Lagos"}
                      {ws.capacity && (
                        <>
                          <span>·</span>
                          <Users className="w-3 h-3" />
                          {ws.capacity}
                        </>
                      )}
                      {ws.has_wifi && (
                        <>
                          <span>·</span>
                          <Wifi className="w-3 h-3" />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-primary">
                      {ws.hourly_rate_ngn ? formatNGN(ws.hourly_rate_ngn) : "—"}
                    </div>
                    <div className="text-[11px] text-muted-foreground">/ hr</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {walletOpen && (
        <WalletPanel
          onClose={() => {
            setWalletOpen(false);
            setTimeout(fetchBalance, 1500);
          }}
        />
      )}
    </div>
  );
}
