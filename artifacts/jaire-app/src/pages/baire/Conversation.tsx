import type { FormEvent, Ref } from "react";
import { Keyboard, Send, Volume2, VolumeX, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  extractPaymentUrl,
  extractSolanaExplorerUrl,
  extractWorkspaceIds,
  MessageLinks,
  Message,
  stripWorkspaceTags,
  WorkspaceCard,
} from "./content";
import type { BaireState, OrbGlow } from "./types";

type Props = {
  messages: Message[];
  scrollRef: Ref<HTMLDivElement>;
  inputRef: Ref<HTMLInputElement>;
  state: BaireState;
  listeningLabel: string;
  orbGlow: OrbGlow;
  orbSize: number;
  stateLabel: string;
  onOrbPress: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  showInput: boolean;
  setShowInput: (show: boolean) => void;
  inputText: string;
  setInputText: (text: string) => void;
  onTextSubmit: (event?: FormEvent) => void;
};

export default function Conversation({
  messages,
  scrollRef,
  inputRef,
  state,
  listeningLabel,
  orbGlow,
  orbSize,
  stateLabel,
  onOrbPress,
  isMuted,
  onToggleMute,
  showInput,
  setShowInput,
  inputText,
  setInputText,
  onTextSubmit,
}: Props) {
  return (
    <>
      <div className="shrink-0 px-6 pt-5 pb-4 flex items-center gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0" style={{ background: orbGlow.bg, boxShadow: state !== "idle" ? orbGlow.shadow : "none", color: state === "listening" ? "hsl(220 40% 8%)" : "white", transition: "all 0.4s ease" }}>B</div>
        <div><div className="font-semibold text-sm leading-none">Baire</div><div className="text-[11px] text-muted-foreground mt-0.5">{state === "listening" ? listeningLabel : state === "processing" ? "Thinking…" : state === "speaking" ? "Speaking…" : "Online"}</div></div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 relative z-10" style={{ scrollBehavior: "smooth" }}>
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((message, index) => {
            const isBaire = message.role === "baire";
            const settled = isBaire && !message.isStreaming;
            const paymentUrl = settled ? extractPaymentUrl(message.content) : null;
            const explorerUrl = settled ? extractSolanaExplorerUrl(message.content) : null;
            const workspaceIds = settled ? extractWorkspaceIds(message.content) : [];
            const displayText = isBaire ? stripWorkspaceTags(message.content) : message.content;
            return (
              <div key={index} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
                {isBaire && <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-1" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(56,189,248,0.3))", border: "1px solid rgba(139,92,246,0.3)", color: "hsl(262 83% 76%)" }}>B</div>}
                <div className={cn("rounded-2xl text-[15px] leading-relaxed max-w-[82%]", message.role === "user" ? "rounded-tr-sm px-4 py-3" : "rounded-tl-sm px-4 py-3")} style={message.role === "user" ? { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" } : { background: "rgba(139,92,246,0.09)", border: "1px solid rgba(139,92,246,0.2)" }}>
                  {displayText || (message.isStreaming ? null : "…")}
                  {message.isStreaming && !message.content && <div className="flex gap-1.5 py-1">{[0, 1, 2].map(dot => <div key={dot} className="w-2 h-2 rounded-full bg-current opacity-40 animate-bounce" style={{ animationDelay: `${dot * 150}ms` }} />)}</div>}
                  {message.isStreaming && message.content && <span className="inline-block w-0.5 h-4 bg-current opacity-60 ml-0.5 animate-pulse align-bottom" />}
                  {workspaceIds.length > 0 && <div className={cn("flex gap-3 flex-wrap", workspaceIds.length > 1 && "mt-3")}>{workspaceIds.map(id => <WorkspaceCard key={id} workspaceId={id} />)}</div>}
                  <MessageLinks paymentUrl={paymentUrl} explorerUrl={explorerUrl} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-7 pt-3 relative z-10" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)", backdropFilter: "blur(16px)" }}>
        <div className="max-w-2xl mx-auto">
          {showInput && (
            <form onSubmit={onTextSubmit} className="flex items-center gap-2 mb-3">
              <input ref={inputRef} value={inputText} onChange={event => setInputText(event.target.value)} placeholder="Type a message…" className="flex-1 h-11 px-4 rounded-2xl text-sm placeholder:text-muted-foreground focus:outline-none transition-all" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }} disabled={state === "processing"} />
              <button type="submit" disabled={!inputText.trim() || state === "processing"} className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all disabled:opacity-30" style={{ background: "rgba(255,170,0,0.15)", color: "#FFAA00", border: "1px solid rgba(255,170,0,0.25)" }}><Send className="w-4 h-4" /></button>
              <button type="button" onClick={() => setShowInput(false)} className="w-11 h-11 rounded-2xl flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}><X className="w-4 h-4" /></button>
            </form>
          )}
          <div className="flex items-center justify-center gap-5">
            {state === "listening" && <div className="flex items-center gap-[3px]">{Array.from({ length: 9 }).map((_, index) => <div key={index} className="rounded-full bg-primary" style={{ width: "3px", height: `${6 + Math.abs(Math.sin((index / 8) * Math.PI * 2)) * 16}px`, animation: `baire-wave ${0.4 + (index % 3) * 0.12}s ease-in-out infinite alternate`, animationDelay: `${index * 55}ms` }} />)}</div>}
            <button onClick={onOrbPress} disabled={state === "processing"} className={cn("relative rounded-full flex items-center justify-center transition-all duration-400 select-none", state === "idle" && "hover:scale-105 active:scale-95", state === "listening" && "scale-110")} style={{ width: orbSize, height: orbSize, background: orbGlow.bg, boxShadow: orbGlow.shadow }}>
              {state === "processing" ? <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.9)" }} /> : <span className="font-bold text-lg" style={{ color: state === "listening" ? "hsl(220 40% 8%)" : "white" }}>B</span>}
              {state === "listening" && <div className="absolute inset-0 rounded-full border-2 border-primary/25 animate-ping" />}
            </button>
            <div className="flex flex-col gap-1.5 items-center">
              <button onClick={onToggleMute} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">{isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}{isMuted ? "Unmute" : "Mute"}</button>
              <button onClick={() => setShowInput(!showInput)} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"><Keyboard className="w-3 h-3" />Type</button>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground mt-3">{stateLabel}</p>
        </div>
      </div>
    </>
  );
}
