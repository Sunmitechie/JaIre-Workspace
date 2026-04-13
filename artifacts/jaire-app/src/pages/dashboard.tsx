import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { useListBookings, useListWorkspaces } from "@workspace/api-client-react";
import { getUser } from "@/lib/auth";
import { formatNGN } from "@/lib/currency";
import { WalletPanel } from "@/components/wallet-panel";
import { QrCode, Clock, ChevronRight, Wallet, MapPin, Wifi, Users, ArrowRight, Mic, Star } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const NGN_PER_USDC = 1600;

const WS_IMAGES: Record<string, string> = {
  "ws-001": "/src/assets/the-hub.png",
  "ws-002": "/src/assets/founders-suite.png",
  "ws-003": "/src/assets/blockchain-lounge.png",
  "ws-004": "/src/assets/board-room.png",
};

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function LiveClock({ checkInTime }: { checkInTime: string }) {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    const update = () => {
      const diff = Math.floor((Date.now() - new Date(checkInTime).getTime()) / 1000);
      const h = Math.floor(diff / 3600).toString().padStart(2, "0");
      const m = Math.floor((diff % 3600) / 60).toString().padStart(2, "0");
      const s = (diff % 60).toString().padStart(2, "0");
      setElapsed(`${h}:${m}:${s}`);
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [checkInTime]);
  return <span className="font-mono text-2xl font-bold tracking-tight">{elapsed}</span>;
}

export default function Dashboard() {
  const user = getUser();
  const displayName = user?.name?.split(" ")[0] || "Nomad";

  const [walletOpen, setWalletOpen] = useState(false);
  const [ngnBalance, setNgnBalance] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: bookings, refetch: refetchBookings } = useListBookings();
  const { data: workspaces } = useListWorkspaces();

  const activeSession = bookings?.find((b) => b.status === "active");
  const completedSessions = bookings?.filter((b) => b.status === "completed") ?? [];

  const fetchBalance = useCallback(async () => {
    if (!user?.walletAddress) return;
    try {
      const res = await fetch(`${BASE_URL}/api/jaire/devnet/balance/${user.walletAddress}`);
      if (!res.ok) return;
      const d = await res.json();
      setNgnBalance((d.usdc_balance ?? 0) * NGN_PER_USDC);
    } catch {}
  }, [user?.walletAddress]);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);

  useEffect(() => {
    const iv = setInterval(() => { refetchBookings(); fetchBalance(); }, 30000);
    return () => clearInterval(iv);
  }, [refetchBookings, fetchBalance]);

  return (
    <div className="flex-1 relative min-h-screen overflow-x-hidden">
      {/* Ambient background glows */}
      <div
        className="pointer-events-none fixed"
        style={{
          top: "-15vw", left: "-10vw",
          width: "60vw", height: "60vw",
          background: "radial-gradient(circle, rgba(255,170,0,0.07) 0%, transparent 70%)",
          filter: "blur(40px)", zIndex: 0,
        }}
      />
      <div
        className="pointer-events-none fixed"
        style={{
          bottom: "0", right: "-15vw",
          width: "55vw", height: "55vw",
          background: "radial-gradient(circle, rgba(139,92,246,0.08) 0%, transparent 70%)",
          filter: "blur(40px)", zIndex: 0,
        }}
      />

      <div className="relative z-10 max-w-xl mx-auto px-4 pt-8 pb-28 space-y-5">

        {/* Greeting */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] text-muted-foreground">{timeGreeting()}</p>
            <h1 className="text-[28px] font-bold leading-tight mt-0.5">{displayName} <span style={{ filter: "grayscale(0)" }}>👋</span></h1>
          </div>
          <Link href="/baire">
            <button
              className="flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-medium transition-all hover:scale-[1.03]"
              style={{
                background: "rgba(139,92,246,0.12)",
                border: "1px solid rgba(139,92,246,0.22)",
                color: "hsl(262 83% 76%)",
                backdropFilter: "blur(12px)",
              }}
            >
              <Mic className="w-3.5 h-3.5" />
              Baire
            </button>
          </Link>
        </div>

        {/* Wallet Card — premium credit card design */}
        <button
          onClick={() => { setWalletOpen(true); fetchBalance(); }}
          className="w-full rounded-3xl overflow-hidden relative text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background: "linear-gradient(135deg, hsl(220 40% 10%) 0%, hsl(220 35% 8%) 100%)",
            border: "1px solid rgba(255,170,0,0.2)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,170,0,0.08) inset",
            minHeight: "168px",
          }}
        >
          {/* Card decorative glow */}
          <div
            className="absolute"
            style={{
              top: "-40%", right: "-20%",
              width: "70%", height: "140%",
              background: "radial-gradient(ellipse, rgba(255,170,0,0.12) 0%, transparent 70%)",
              filter: "blur(20px)",
            }}
          />
          {/* Card decorative circles */}
          <div className="absolute" style={{ top: -24, right: -24, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,170,0,0.06)", border: "1px solid rgba(255,170,0,0.1)" }} />
          <div className="absolute" style={{ top: 16, right: 64, width: 72, height: 72, borderRadius: "50%", background: "rgba(255,170,0,0.04)" }} />

          <div className="relative p-6 flex flex-col justify-between" style={{ minHeight: 168 }}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(255,170,0,0.15)", border: "1px solid rgba(255,170,0,0.3)" }}
                >
                  <Wallet className="w-4 h-4 text-primary" />
                </div>
                <span className="text-[13px] font-medium text-muted-foreground">Wallet</span>
              </div>
              <span
                className="text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-widest"
                style={{ background: "rgba(56,189,248,0.1)", color: "rgba(56,189,248,0.9)", border: "1px solid rgba(56,189,248,0.2)" }}
              >
                {user?.walletNetwork ?? "devnet"}
              </span>
            </div>

            <div>
              {ngnBalance !== null ? (
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">Available Balance</div>
                  <div className="text-3xl font-bold" style={{ letterSpacing: "-0.02em" }}>
                    {formatNGN(ngnBalance)}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">Available Balance</div>
                  <div className="text-3xl font-bold text-muted-foreground">— —</div>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground font-mono">
                  {user?.walletAddress
                    ? `${user.walletAddress.slice(0, 6)}···${user.walletAddress.slice(-4)}`
                    : "No wallet"}
                </div>
                <div className="text-[11px] text-primary flex items-center gap-1">
                  {ngnBalance === 0 ? "Top up →" : "View →"}
                </div>
              </div>
            </div>
          </div>
        </button>

        {/* Active session OR check-in CTA */}
        {activeSession ? (
          <Link href={`/session/${activeSession.id}`}>
            <div
              className="rounded-2xl p-5 relative overflow-hidden transition-all hover:scale-[1.01]"
              style={{
                background: "linear-gradient(135deg, rgba(52,211,153,0.08) 0%, rgba(16,185,129,0.04) 100%)",
                border: "1px solid rgba(52,211,153,0.25)",
                boxShadow: "0 0 40px rgba(52,211,153,0.06)",
              }}
            >
              <div
                className="absolute"
                style={{ top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: "rgba(52,211,153,0.06)" }}
              />
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: "0 0 8px rgba(52,211,153,0.8)" }} />
                <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">Live Session</span>
              </div>
              <div className="font-bold text-lg mb-1">{activeSession.workspace_name}</div>
              {activeSession.check_in_time && (
                <div className="flex items-center gap-2 mt-2">
                  <Clock className="w-3.5 h-3.5 text-emerald-400/70" />
                  <LiveClock checkInTime={activeSession.check_in_time} />
                </div>
              )}
              <div className="mt-3 text-[12px] text-emerald-400/70">Tap to view session details →</div>
            </div>
          </Link>
        ) : (
          <Link href="/scan">
            <div
              className="rounded-2xl overflow-hidden relative transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{
                background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                boxShadow: "0 12px 40px rgba(255,170,0,0.25)",
              }}
            >
              <div
                className="absolute"
                style={{ bottom: -24, right: -24, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.12)" }}
              />
              <div className="px-6 py-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-black/15 flex items-center justify-center shrink-0">
                  <QrCode className="w-6 h-6 text-black/80" />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-black/90 text-[17px]">Scan to Check In</div>
                  <div className="text-[12px] text-black/55 mt-0.5">Point your camera at any workspace QR code</div>
                </div>
                <ArrowRight className="w-5 h-5 text-black/50 shrink-0" />
              </div>
            </div>
          </Link>
        )}

        {/* Workspaces — horizontal scroll */}
        {workspaces && workspaces.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Available Spaces</span>
              <Link href="/workspaces">
                <button className="text-[12px] text-primary hover:underline flex items-center gap-1">
                  See all <ChevronRight className="w-3 h-3" />
                </button>
              </Link>
            </div>
            <div
              ref={scrollRef}
              className="flex gap-3 overflow-x-auto pb-2"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {workspaces.map((ws: any) => (
                <Link key={ws.id} href={`/workspaces/${ws.id}`}>
                  <div
                    className="rounded-2xl overflow-hidden shrink-0 transition-all hover:scale-[1.02] hover:-translate-y-0.5 cursor-pointer group"
                    style={{
                      width: 200,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.07)",
                    }}
                  >
                    <div className="relative" style={{ height: 112 }}>
                      <img
                        src={WS_IMAGES[ws.id] || "/src/assets/the-hub.png"}
                        alt={ws.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)" }} />
                      {ws.is_available && (
                        <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 6px rgba(52,211,153,0.9)" }} />
                      )}
                      <div className="absolute bottom-2 left-3 right-3">
                        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,170,0,0.9)" }}>
                          {(ws.workspace_type ?? "hot_desk").replace("_", " ")}
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-3">
                      <div className="font-semibold text-[13px] truncate">{ws.name}</div>
                      <div className="flex items-center justify-between mt-1.5">
                        <div className="text-[13px] font-bold text-primary">{formatNGN(ws.hourly_rate_ngn)}<span className="text-[10px] font-normal text-muted-foreground">/hr</span></div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          {ws.has_wifi && <Wifi className="w-2.5 h-2.5" />}
                          {ws.capacity && <><Users className="w-2.5 h-2.5" /><span>{ws.capacity}</span></>}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Recent Sessions */}
        {completedSessions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Recent Sessions</span>
              <Link href="/bookings">
                <button className="text-[12px] text-primary hover:underline flex items-center gap-1">
                  All <ChevronRight className="w-3 h-3" />
                </button>
              </Link>
            </div>
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {completedSessions.slice(0, 4).map((b, idx) => (
                <Link key={b.id} href={`/session/${b.id}`}>
                  <div
                    className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/3 transition-colors cursor-pointer"
                    style={idx > 0 ? { borderTop: "1px solid rgba(255,255,255,0.05)" } : {}}
                  >
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: "rgba(255,170,0,0.07)", border: "1px solid rgba(255,170,0,0.12)" }}
                    >
                      <MapPin className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[13px] truncate">{b.workspace_name}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {b.check_in_time
                          ? new Date(b.check_in_time).toLocaleDateString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                          : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-bold text-primary">{b.ngn_amount_paid ? formatNGN(b.ngn_amount_paid) : "—"}</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Empty state — no sessions, show Baire CTA */}
        {completedSessions.length === 0 && !activeSession && (
          <Link href="/baire">
            <div
              className="rounded-2xl p-6 text-center transition-all hover:scale-[1.01]"
              style={{
                background: "rgba(139,92,246,0.06)",
                border: "1px solid rgba(139,92,246,0.15)",
              }}
            >
              <div
                className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center text-[22px]"
                style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.2)" }}
              >
                ✨
              </div>
              <p className="font-semibold text-[15px] mb-1">Say hi to Baire</p>
              <p className="text-[13px] text-muted-foreground">Your AI concierge. Ask her anything — she'll find and book your perfect space.</p>
              <div className="mt-4 inline-flex items-center gap-2 text-[13px] font-semibold" style={{ color: "hsl(262 83% 76%)" }}>
                <Mic className="w-3.5 h-3.5" /> Start a conversation
              </div>
            </div>
          </Link>
        )}
      </div>

      {walletOpen && (
        <WalletPanel
          onClose={() => {
            setWalletOpen(false);
            setTimeout(fetchBalance, 1200);
          }}
        />
      )}
    </div>
  );
}
