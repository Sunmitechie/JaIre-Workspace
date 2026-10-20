import { Keyboard, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BaireState, OrbGlow } from "./types";

const CHIPS = [
  "Book me a hot desk now",
  "What spaces are available?",
  "Find me a quiet private room",
  "What's my account balance?",
];

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

type Props = {
  firstName: string;
  conversationError: boolean;
  onRetry: () => void;
  state: BaireState;
  listeningLabel: string;
  stateLabel: string;
  orbSize: number;
  orbGlow: OrbGlow;
  onOrbPress: () => void;
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
  showInput: boolean;
  setShowInput: (show: boolean) => void;
  sendTextMessage: (text: string) => void;
};

export default function Welcome({
  firstName,
  conversationError,
  onRetry,
  state,
  listeningLabel,
  stateLabel,
  orbSize,
  orbGlow,
  onOrbPress,
  isMuted,
  setIsMuted,
  showInput,
  setShowInput,
  sendTextMessage,
}: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center relative z-10">
      {conversationError && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-2xl text-[13px]" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "rgba(252,165,165,0.9)" }}>
          <span>Couldn't connect to Baire. Check your network.</span>
          <button onClick={onRetry} className="flex items-center gap-1.5 font-semibold hover:opacity-80 transition-opacity shrink-0"><RefreshCw className="w-3 h-3" />Retry</button>
        </div>
      )}
      <div className="mb-10">
        <p className="text-[13px] font-medium mb-3 tracking-widest uppercase" style={{ color: "rgba(255,170,0,0.6)" }}>{timeGreeting()}</p>
        <h1 className="font-bold leading-tight mb-4" style={{ fontSize: "clamp(2rem, 6vw, 3.2rem)", background: "linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,0.75) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Hey {firstName},</h1>
        <h2 className="font-bold leading-snug mb-5" style={{ fontSize: "clamp(1.5rem, 5vw, 2.4rem)", background: "linear-gradient(135deg, hsl(43 100% 52%) 0%, hsl(262 83% 72%) 60%, hsl(199 93% 65%) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>What space are you<br />looking to book today?</h2>
        <p className="text-[15px] text-muted-foreground max-w-xs mx-auto leading-relaxed">Give me a voice command and I'll book it right away.</p>
      </div>
      <div className="flex flex-col items-center gap-4 mb-10">
        {state === "listening" && <div className="flex items-center gap-[3px] h-7">{Array.from({ length: 13 }).map((_, index) => <div key={index} className="rounded-full bg-primary" style={{ width: "3px", height: `${8 + Math.abs(Math.sin((index / 12) * Math.PI * 2)) * 20}px`, animation: `baire-wave ${0.4 + (index % 4) * 0.1}s ease-in-out infinite alternate`, animationDelay: `${index * 50}ms` }} />)}</div>}
        <button onClick={onOrbPress} disabled={state === "processing"} className={cn("relative rounded-full flex items-center justify-center transition-all duration-500 select-none", state === "idle" && "hover:scale-105 active:scale-95", state === "listening" && "scale-110")} style={{ width: orbSize, height: orbSize, background: orbGlow.bg, boxShadow: orbGlow.shadow }}>
          {state === "processing" ? <div className="w-9 h-9 rounded-full border-[2.5px] animate-spin" style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.9)" }} /> : <span className="font-bold text-2xl" style={{ color: state === "listening" ? "hsl(220 40% 8%)" : "white", letterSpacing: "-0.02em" }}>B</span>}
          {state === "listening" && <div className="absolute inset-0 rounded-full border-2 border-primary/25 animate-ping" />}
        </button>
        <p className="text-[13px] text-muted-foreground">{stateLabel}</p>
        <div className="flex items-center gap-5">
          <button onClick={() => setIsMuted(!isMuted)} className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">{isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}{isMuted ? "Unmute" : "Mute"}</button>
          <button onClick={() => setShowInput(!showInput)} className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"><Keyboard className="w-3.5 h-3.5" />Type instead</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 justify-center max-w-sm">
        {CHIPS.map(chip => <button key={chip} onClick={() => sendTextMessage(chip)} disabled={state !== "idle"} className="px-4 py-2 rounded-full text-[13px] font-medium transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-40" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(12px)" }}>{chip}</button>)}
      </div>
    </div>
  );
}
