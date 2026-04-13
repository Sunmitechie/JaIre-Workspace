import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Volume2, VolumeX, Keyboard, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getUser } from "@/lib/auth";
import { WalletPanel } from "@/components/wallet-panel";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Message {
  role: "user" | "baire";
  content: string;
  isStreaming?: boolean;
}

async function createConversation(): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/baire/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "JaIre Session" }),
  });
  return (await res.json()).id;
}

const CHIPS = [
  "Book me a hot desk now",
  "What spaces are available?",
  "Find me a quiet private room",
  "What's my account balance?",
];

type BaireState = "idle" | "listening" | "processing" | "speaking";

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

async function playAudioBlob(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    audio.play().catch(() => resolve());
  });
}

export default function Baire() {
  const user = getUser();
  const firstName = user?.name?.split(" ")[0] || "there";

  const [messages, setMessages] = useState<Message[]>([]);
  const [baireState, setBaireState] = useState<BaireState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [convId, setConvId] = useState<number | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [inputText, setInputText] = useState("");
  const [listeningLabel, setListeningLabel] = useState("Listening…");

  const isWelcome = messages.length === 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMutedRef = useRef(isMuted);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  useEffect(() => {
    createConversation().then(setConvId).catch(console.error);
  }, []);

  useEffect(() => {
    if (scrollRef.current && !isWelcome) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isWelcome]);

  useEffect(() => {
    if (showInput && inputRef.current) inputRef.current.focus();
  }, [showInput]);

  const speakWithElevenLabs = useCallback(async (text: string) => {
    if (isMutedRef.current) { setBaireState("idle"); return; }
    setBaireState("speaking");
    try {
      const res = await fetch(`${BASE_URL}/api/baire/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("TTS failed");
      const arrayBuffer = await res.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
      await playAudioBlob(blob);
    } catch {
      // silently fall through
    } finally {
      setBaireState("idle");
    }
  }, []);

  const sendTextMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !convId || baireState === "processing") return;
      setShowInput(false);
      setInputText("");

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setBaireState("processing");
      setMessages((prev) => [...prev, { role: "baire", content: "", isStreaming: true }]);

      try {
        const response = await fetch(`${BASE_URL}/api/baire/conversations/${convId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            user_name: user?.name,
            user_email: user?.email,
            wallet_address: user?.walletAddress,
          }),
        });
        if (!response.body) throw new Error("no body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "text") {
                fullText += ev.content;
                setMessages((prev) => {
                  const u = [...prev];
                  const idx = u.map((m, i) => (m.isStreaming ? i : -1)).filter((i) => i !== -1).at(-1);
                  if (idx !== undefined) u[idx] = { role: "baire", content: fullText, isStreaming: true };
                  return u;
                });
              } else if (ev.type === "done") {
                const final = ev.full_response || fullText;
                setMessages((prev) => {
                  const u = [...prev];
                  const idx = u.map((m, i) => (m.isStreaming ? i : -1)).filter((i) => i !== -1).at(-1);
                  if (idx !== undefined) u[idx] = { role: "baire", content: final, isStreaming: false };
                  return u;
                });
                // Speak with ElevenLabs
                speakWithElevenLabs(final);
              }
            } catch {}
          }
        }
      } catch {
        setMessages((prev) => {
          const u = [...prev];
          const idx = u.map((m, i) => (m.isStreaming ? i : -1)).filter((i) => i !== -1).at(-1);
          if (idx !== undefined) u[idx] = { role: "baire", content: "Oops — something went wrong. Try again?", isStreaming: false };
          return u;
        });
        setBaireState("idle");
      }
    },
    [convId, baireState, user, speakWithElevenLabs]
  );

  const sendVoiceMessage = useCallback(
    async (audioBlob: Blob) => {
      if (!convId) return;
      setBaireState("processing");
      setListeningLabel("Transcribing…");

      setMessages((prev) => [...prev, { role: "baire", content: "", isStreaming: true }]);

      try {
        const form = new FormData();
        form.append("audio", audioBlob, "voice.webm");

        const response = await fetch(`${BASE_URL}/api/baire/conversations/${convId}/voice-messages`, {
          method: "POST",
          body: form,
        });
        if (!response.body) throw new Error("no body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let transcript = "";
        let agentText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "user_transcript") {
                transcript = ev.content;
                setMessages((prev) => {
                  const updated = prev.filter((m) => !(m.role === "baire" && m.isStreaming && m.content === ""));
                  return [...updated,
                    { role: "user", content: transcript },
                    { role: "baire", content: "", isStreaming: true },
                  ];
                });
              } else if (ev.type === "agent_text") {
                agentText = ev.content;
                setMessages((prev) => {
                  const u = [...prev];
                  const idx = u.map((m, i) => (m.isStreaming ? i : -1)).filter((i) => i !== -1).at(-1);
                  if (idx !== undefined) u[idx] = { role: "baire", content: agentText, isStreaming: false };
                  return u;
                });
              } else if (ev.type === "done" && agentText) {
                // TTS via ElevenLabs — called AFTER SSE stream fully closes
                await speakWithElevenLabs(agentText);
              }
            } catch {}
          }
        }
      } catch {
        setMessages((prev) => {
          const u = [...prev];
          const idx = u.map((m, i) => (m.isStreaming ? i : -1)).filter((i) => i !== -1).at(-1);
          if (idx !== undefined) u[idx] = { role: "baire", content: "Couldn't process that. Try again?", isStreaming: false };
          return u;
        });
        setBaireState("idle");
      } finally {
        setListeningLabel("Listening…");
      }
    },
    [convId, speakWithElevenLabs]
  );

  const startVoice = useCallback(async () => {
    if (baireState !== "idle") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size > 1000) {
          await sendVoiceMessage(blob);
        } else {
          setBaireState("idle");
        }
      };

      recorder.start(250);
      setBaireState("listening");
      setListeningLabel("Listening…");
    } catch {
      // Mic not available — fall back to text input
      setShowInput(true);
    }
  }, [baireState, sendVoiceMessage]);

  const stopVoice = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setBaireState("processing");
  }, []);

  const handleOrbPress = () => {
    if (baireState === "listening") stopVoice();
    else if (baireState === "speaking") setBaireState("idle");
    else if (baireState === "idle") startVoice();
  };

  const handleTextSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    sendTextMessage(text);
  };

  const orbSize = isWelcome ? 96 : 72;

  const orbGlow =
    baireState === "listening"
      ? { bg: "linear-gradient(135deg, hsl(43 100% 50%), hsl(38 100% 44%))", shadow: "0 0 0 10px rgba(255,170,0,0.12), 0 0 0 22px rgba(255,170,0,0.05), 0 0 60px rgba(255,170,0,0.35)" }
      : baireState === "speaking"
      ? { bg: "linear-gradient(135deg, hsl(262 83% 62%), hsl(199 93% 55%))", shadow: "0 0 0 10px rgba(139,92,246,0.15), 0 0 0 22px rgba(139,92,246,0.06), 0 0 60px rgba(139,92,246,0.35)" }
      : baireState === "processing"
      ? { bg: "linear-gradient(135deg, rgba(139,92,246,0.5), rgba(56,189,248,0.4))", shadow: "0 0 30px rgba(139,92,246,0.25)" }
      : { bg: "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(56,189,248,0.25))", shadow: "0 0 0 1px rgba(139,92,246,0.2), 0 12px 40px rgba(0,0,0,0.5)" };

  const stateLabel =
    baireState === "listening" ? listeningLabel :
    baireState === "processing" ? "Thinking…" :
    baireState === "speaking" ? "Tap to stop" :
    "Tap to speak";

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden" style={{ height: "calc(100vh - 4rem)" }}>

      {/* Ambient background glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute transition-all duration-1000"
          style={{
            top: "-20%", left: "50%", transform: "translateX(-50%)",
            width: "80vw", height: "60vw",
            background: baireState === "listening"
              ? "radial-gradient(ellipse, rgba(255,170,0,0.12) 0%, transparent 70%)"
              : baireState === "speaking"
              ? "radial-gradient(ellipse, rgba(139,92,246,0.12) 0%, transparent 70%)"
              : "radial-gradient(ellipse, rgba(139,92,246,0.07) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
        <div className="absolute"
          style={{
            bottom: "-10%", right: "-10%",
            width: "50vw", height: "50vw",
            background: "radial-gradient(ellipse, rgba(255,170,0,0.05) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
      </div>

      {/* ─── WELCOME STATE ─── */}
      {isWelcome && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center relative z-10">
          <div className="mb-10">
            <p className="text-[13px] font-medium mb-3 tracking-widest uppercase"
              style={{ color: "rgba(255,170,0,0.6)" }}>
              {timeGreeting()}
            </p>
            <h1 className="font-bold leading-tight mb-4"
              style={{
                fontSize: "clamp(2rem, 6vw, 3.2rem)",
                background: "linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,0.75) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}>
              Hey {firstName},
            </h1>
            <h2 className="font-bold leading-snug mb-5"
              style={{
                fontSize: "clamp(1.5rem, 5vw, 2.4rem)",
                background: "linear-gradient(135deg, hsl(43 100% 52%) 0%, hsl(262 83% 72%) 60%, hsl(199 93% 65%) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}>
              What space are you<br />looking to book today?
            </h2>
            <p className="text-[15px] text-muted-foreground max-w-xs mx-auto leading-relaxed">
              Give me a voice command and I'll book it right away.
            </p>
          </div>

          {/* Orb */}
          <div className="flex flex-col items-center gap-4 mb-10">
            {baireState === "listening" && (
              <div className="flex items-center gap-[3px] h-7">
                {Array.from({ length: 13 }).map((_, i) => (
                  <div key={i} className="rounded-full bg-primary"
                    style={{
                      width: "3px",
                      height: `${8 + Math.abs(Math.sin((i / 12) * Math.PI * 2)) * 20}px`,
                      animation: `baire-wave ${0.4 + (i % 4) * 0.1}s ease-in-out infinite alternate`,
                      animationDelay: `${i * 50}ms`,
                    }}
                  />
                ))}
              </div>
            )}

            <button onClick={handleOrbPress} disabled={baireState === "processing"}
              className={cn("relative rounded-full flex items-center justify-center transition-all duration-500 select-none",
                baireState === "idle" && "hover:scale-105 active:scale-95",
                baireState === "listening" && "scale-110")}
              style={{ width: orbSize, height: orbSize, background: orbGlow.bg, boxShadow: orbGlow.shadow }}>
              {baireState === "processing" ? (
                <div className="w-9 h-9 rounded-full border-[2.5px] animate-spin"
                  style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.9)" }} />
              ) : (
                <span className="font-bold text-2xl"
                  style={{ color: baireState === "listening" ? "hsl(220 40% 8%)" : "white", letterSpacing: "-0.02em" }}>
                  B
                </span>
              )}
              {baireState === "listening" && (
                <div className="absolute inset-0 rounded-full border-2 border-primary/25 animate-ping" />
              )}
            </button>

            <p className="text-[13px] text-muted-foreground">{stateLabel}</p>

            <div className="flex items-center gap-5">
              <button onClick={() => setIsMuted(!isMuted)}
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
                {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                {isMuted ? "Unmute" : "Mute"}
              </button>
              <button onClick={() => setShowInput((v) => !v)}
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
                <Keyboard className="w-3.5 h-3.5" />
                Type instead
              </button>
            </div>
          </div>

          {/* Quick chips */}
          <div className="flex flex-wrap gap-2 justify-center max-w-sm">
            {CHIPS.map((chip) => (
              <button key={chip} onClick={() => sendTextMessage(chip)}
                disabled={baireState !== "idle"}
                className="px-4 py-2 rounded-full text-[13px] font-medium transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-40"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(12px)" }}>
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── CONVERSATION STATE ─── */}
      {!isWelcome && (
        <>
          <div className="shrink-0 px-6 pt-5 pb-4 flex items-center gap-3"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
              style={{ background: orbGlow.bg, boxShadow: baireState !== "idle" ? orbGlow.shadow : "none",
                color: baireState === "listening" ? "hsl(220 40% 8%)" : "white", transition: "all 0.4s ease" }}>
              B
            </div>
            <div>
              <div className="font-semibold text-sm leading-none">Baire</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {baireState === "listening" ? listeningLabel :
                 baireState === "processing" ? "Thinking…" :
                 baireState === "speaking" ? "Speaking…" : "Online"}
              </div>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 relative z-10"
            style={{ scrollBehavior: "smooth" }}>
            <div className="max-w-2xl mx-auto space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
                  {msg.role === "baire" && (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-1"
                      style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.3), rgba(56,189,248,0.3))",
                        border: "1px solid rgba(139,92,246,0.3)", color: "hsl(262 83% 76%)" }}>
                      B
                    </div>
                  )}
                  <div className={cn("px-4 py-3 rounded-2xl text-[15px] leading-relaxed max-w-[82%]",
                    msg.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm")}
                    style={msg.role === "user"
                      ? { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }
                      : { background: "rgba(139,92,246,0.09)", border: "1px solid rgba(139,92,246,0.2)" }}>
                    {msg.content || (msg.isStreaming ? null : "…")}
                    {msg.isStreaming && !msg.content && (
                      <div className="flex gap-1.5 py-1">
                        {[0, 1, 2].map((j) => (
                          <div key={j} className="w-2 h-2 rounded-full bg-current opacity-40 animate-bounce"
                            style={{ animationDelay: `${j * 150}ms` }} />
                        ))}
                      </div>
                    )}
                    {msg.isStreaming && msg.content && (
                      <span className="inline-block w-0.5 h-4 bg-current opacity-60 ml-0.5 animate-pulse align-bottom" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="shrink-0 px-4 pb-7 pt-3 relative z-10"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)", backdropFilter: "blur(16px)" }}>
            <div className="max-w-2xl mx-auto">
              {showInput && (
                <form onSubmit={handleTextSend} className="flex items-center gap-2 mb-3">
                  <input ref={inputRef} value={inputText} onChange={(e) => setInputText(e.target.value)}
                    placeholder="Type a message…"
                    className="flex-1 h-11 px-4 rounded-2xl text-sm placeholder:text-muted-foreground focus:outline-none transition-all"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                    disabled={baireState === "processing"} />
                  <button type="submit" disabled={!inputText.trim() || baireState === "processing"}
                    className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all disabled:opacity-30"
                    style={{ background: "rgba(255,170,0,0.15)", color: "#FFAA00", border: "1px solid rgba(255,170,0,0.25)" }}>
                    <Send className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setShowInput(false)}
                    className="w-11 h-11 rounded-2xl flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <X className="w-4 h-4" />
                  </button>
                </form>
              )}

              <div className="flex items-center justify-center gap-5">
                {baireState === "listening" && (
                  <div className="flex items-center gap-[3px]">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <div key={i} className="rounded-full bg-primary"
                        style={{
                          width: "3px",
                          height: `${6 + Math.abs(Math.sin((i / 8) * Math.PI * 2)) * 16}px`,
                          animation: `baire-wave ${0.4 + (i % 3) * 0.12}s ease-in-out infinite alternate`,
                          animationDelay: `${i * 55}ms`,
                        }}
                      />
                    ))}
                  </div>
                )}

                <button onClick={handleOrbPress} disabled={baireState === "processing"}
                  className={cn("relative rounded-full flex items-center justify-center transition-all duration-400 select-none",
                    baireState === "idle" && "hover:scale-105 active:scale-95",
                    baireState === "listening" && "scale-110")}
                  style={{ width: orbSize, height: orbSize, background: orbGlow.bg, boxShadow: orbGlow.shadow }}>
                  {baireState === "processing" ? (
                    <div className="w-7 h-7 rounded-full border-2 animate-spin"
                      style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.9)" }} />
                  ) : (
                    <span className="font-bold text-lg"
                      style={{ color: baireState === "listening" ? "hsl(220 40% 8%)" : "white" }}>
                      B
                    </span>
                  )}
                  {baireState === "listening" && (
                    <div className="absolute inset-0 rounded-full border-2 border-primary/25 animate-ping" />
                  )}
                </button>

                <div className="flex flex-col gap-1.5 items-center">
                  <button onClick={() => setIsMuted(!isMuted)}
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                    {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                    {isMuted ? "Unmute" : "Mute"}
                  </button>
                  <button onClick={() => setShowInput((v) => !v)}
                    className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                    <Keyboard className="w-3 h-3" />
                    Type
                  </button>
                </div>
              </div>

              <p className="text-center text-[11px] text-muted-foreground mt-3">{stateLabel}</p>
            </div>
          </div>
        </>
      )}

      {/* Welcome state text input */}
      {isWelcome && showInput && (
        <div className="shrink-0 px-4 pb-6 relative z-20">
          <form onSubmit={handleTextSend} className="max-w-sm mx-auto flex items-center gap-2">
            <input ref={inputRef} value={inputText} onChange={(e) => setInputText(e.target.value)}
              placeholder="Type a message to Baire…"
              className="flex-1 h-12 px-4 rounded-2xl text-sm focus:outline-none transition-all"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "white" }}
              disabled={baireState === "processing"} />
            <button type="submit" disabled={!inputText.trim() || baireState === "processing"}
              className="w-12 h-12 rounded-2xl flex items-center justify-center disabled:opacity-30 transition-all hover:scale-105"
              style={{ background: "linear-gradient(135deg, hsl(43 100% 50%), hsl(38 100% 44%))", color: "hsl(220 40% 5%)" }}>
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}

      {walletOpen && <WalletPanel onClose={() => setWalletOpen(false)} />}
    </div>
  );
}
