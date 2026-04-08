import { Link } from "wouter";
import { useListWorkspaces } from "@workspace/api-client-react";
import { formatNGN } from "@/lib/currency";
import { ArrowRight, MapPin, Zap, Shield, Mic, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Particles } from "@/components/particles";
import { isLoggedIn } from "@/lib/auth";

export default function Home() {
  const { data: workspaces, isLoading } = useListWorkspaces();
  const loggedIn = isLoggedIn();

  return (
    <div className="flex flex-col min-h-screen relative">
      <Particles count={55} />

      <section className="relative z-10 min-h-[92vh] flex flex-col items-center justify-center text-center px-6 py-20">
        <div
          className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full mb-10"
          style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.2)" }}
        >
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-sm font-medium text-primary">Lagos · Victoria Island · Lekki</span>
        </div>

        <h1 className="text-6xl md:text-8xl font-bold tracking-tight max-w-5xl mb-8 leading-[0.92]">
          Workspace that<br />
          <span className="text-gradient-gold">works for you</span>
        </h1>

        <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mb-12 leading-relaxed font-light">
          Premium coworking in Lagos. Book by the minute, pay in Naira.
          <br className="hidden md:block" />
          Meet Baire — your AI concierge that does it all.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link href={loggedIn ? "/baire" : "/login"}>
            <button
              className="h-14 px-10 rounded-xl text-base font-semibold flex items-center gap-2.5 transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                color: "hsl(220 40% 5%)",
                boxShadow: "0 8px 32px rgba(255,170,0,0.25)",
              }}
            >
              {loggedIn ? "Talk to Baire" : "Get Started Free"}
              <ArrowRight className="w-4 h-4" />
            </button>
          </Link>
          <Link href={loggedIn ? "/workspaces" : "/login"}>
            <button className="h-14 px-10 rounded-xl text-base font-semibold flex items-center gap-2.5 transition-all hover:bg-white/8 glass-card">
              <MapPin className="w-4 h-4 text-primary" />
              Browse Spaces
            </button>
          </Link>
        </div>

        <div className="mt-20 flex flex-wrap justify-center gap-8 text-sm text-muted-foreground">
          {[
            { label: "Second-precision billing", icon: Clock },
            { label: "Instant access", icon: Zap },
            { label: "AI-powered booking", icon: Mic },
            { label: "Secure payments", icon: Shield },
          ].map(({ label, icon: Icon }) => (
            <div key={label} className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-primary/70" />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 py-24 border-t border-white/6">
        <div className="container px-4 md:px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              Featured <span className="text-gradient-gold">Spaces</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Every space is designed for focus, collaboration, and growth.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-80 w-full rounded-2xl" />
                ))
              : workspaces?.slice(0, 4).map((ws) => (
                  <Link key={ws.id} href={loggedIn ? `/workspaces/${ws.id}` : "/login"} className="group block">
                    <div
                      className="rounded-2xl overflow-hidden flex flex-col h-full transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                      }}
                    >
                      <div className="aspect-[4/3] relative overflow-hidden bg-muted">
                        <img
                          src={ws.image_url || '/src/assets/the-hub.png'}
                          alt={ws.name}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                          <span
                            className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest"
                            style={{ background: "rgba(255,170,0,0.15)", color: "#FFAA00", border: "1px solid rgba(255,170,0,0.3)" }}
                          >
                            {(ws.workspace_type ?? 'hot_desk').replace('_', ' ')}
                          </span>
                          {ws.is_available && (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                          )}
                        </div>
                      </div>
                      <div className="p-5 flex-1 flex flex-col justify-between">
                        <div>
                          <h3 className="font-bold text-lg mb-1">{ws.name}</h3>
                          <p className="text-xs text-muted-foreground line-clamp-2">{ws.description}</p>
                        </div>
                        <div className="mt-4 pt-4 border-t border-white/6 flex items-center justify-between">
                          <div>
                            <div className="text-lg font-bold text-primary">{formatNGN(ws.hourly_rate_ngn)}</div>
                            <div className="text-[11px] text-muted-foreground">per hour</div>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="w-3 h-3" />
                            Floor {ws.floor}
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
          </div>

          <div className="text-center mt-10">
            <Link href={loggedIn ? "/workspaces" : "/login"}>
              <button className="inline-flex items-center gap-2 text-primary font-semibold hover:gap-3 transition-all">
                View all spaces <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-24 border-t border-white/6">
        <div className="container px-4 md:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium mb-6"
                style={{ background: "rgba(139,92,246,0.1)", color: "hsl(262 83% 72%)", border: "1px solid rgba(139,92,246,0.2)" }}
              >
                <Mic className="w-3.5 h-3.5" />
                Meet Baire
              </div>
              <h2 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
                Your AI concierge.<br />
                <span className="text-gradient-sky-purple">Voice-first.</span>
              </h2>
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                Just speak. Baire understands what you need, checks availability, and books your space — all in seconds. No forms, no friction.
              </p>
              <Link href={loggedIn ? "/baire" : "/login"}>
                <button
                  className="h-12 px-8 rounded-xl text-sm font-semibold inline-flex items-center gap-2 transition-all hover:scale-[1.02]"
                  style={{
                    background: "linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(56,189,248,0.2) 100%)",
                    border: "1px solid rgba(139,92,246,0.4)",
                    color: "hsl(262 83% 76%)",
                  }}
                >
                  <Mic className="w-4 h-4" />
                  {loggedIn ? "Open Baire" : "Try Baire"}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </Link>
            </div>

            <div className="relative">
              <div
                className="rounded-3xl p-8 space-y-4"
                style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.15)" }}
              >
                {[
                  { side: "right", bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.08)", label: "You", text: "I need a quiet spot for a call tomorrow afternoon, 3 hours" },
                  { side: "left", bg: "rgba(139,92,246,0.1)", border: "rgba(139,92,246,0.2)", label: "B", text: "The Founders Suite is available tomorrow 2-5 PM. 3 hours will cost ₦10,500. Shall I book it?" },
                  { side: "right", bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.08)", label: "You", text: "Yes, go ahead!" },
                  { side: "left", bg: "rgba(139,92,246,0.1)", border: "rgba(139,92,246,0.2)", label: "B", text: "Done! Founders Suite is booked. See you tomorrow at 2 PM." },
                ].map((msg, i) => (
                  <div key={i} className={`flex items-start gap-3 ${msg.side === "right" ? "flex-row-reverse" : ""}`}>
                    <div
                      className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold"
                      style={{ background: msg.side === "left" ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.1)", color: msg.side === "left" ? "hsl(262 83% 76%)" : undefined }}
                    >{msg.label}</div>
                    <div
                      className={`rounded-2xl ${msg.side === "right" ? "rounded-tr-sm" : "rounded-tl-sm"} px-4 py-3 text-sm max-w-[80%]`}
                      style={{ background: msg.bg, border: `1px solid ${msg.border}` }}
                    >{msg.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-24 border-t border-white/6">
        <div className="container px-4 md:px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: Clock, color: "rgba(255,170,0,", title: "Billed by the second", desc: "Only pay for the exact time you're in the space. Walk out and billing stops instantly." },
              { icon: Zap, color: "rgba(56,189,248,", title: "Instant access", desc: "No deposits, no waitlists. Book in seconds and walk in moments later." },
              { icon: Shield, color: "rgba(139,92,246,", title: "Private & secure", desc: "Your payments are processed securely. No paperwork, no long-term commitments." },
            ].map(({ icon: Icon, color, title, desc }) => (
              <div key={title} className="p-8 rounded-2xl flex flex-col gap-4" style={{ background: `${color}0.05)`, border: `1px solid ${color}0.15)` }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${color}0.15)` }}>
                  <Icon className="w-6 h-6" style={{ color: `${color}0.9)` }} />
                </div>
                <h3 className="text-xl font-bold">{title}</h3>
                <p className="text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 py-24 border-t border-white/6">
        <div className="container px-4 md:px-6 text-center">
          <h2 className="text-4xl md:text-6xl font-bold mb-6">
            Ready to work<br /><span className="text-gradient-gold">differently?</span>
          </h2>
          <p className="text-xl text-muted-foreground mb-10 max-w-lg mx-auto">
            Join hundreds of nomads who book smarter with JaIre.
          </p>
          <Link href={loggedIn ? "/baire" : "/login"}>
            <button
              className="h-16 px-14 rounded-xl text-lg font-bold inline-flex items-center gap-3 transition-all hover:scale-[1.02]"
              style={{
                background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                color: "hsl(220 40% 5%)",
                boxShadow: "0 16px 48px rgba(255,170,0,0.3)",
              }}
            >
              {loggedIn ? "Open Baire" : "Start for free"}
              <ArrowRight className="w-5 h-5" />
            </button>
          </Link>
        </div>
      </section>
    </div>
  );
}
