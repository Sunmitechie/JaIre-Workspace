import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Volume2, VolumeX, ChevronDown, Keyboard } from "lucide-react";
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
  const data = await res.json();
  return data.id;
}

const QUICK_PROMPTS = [
  "What spaces are available now?",
  "Book me a hot desk for 2 hours",
  "What's my wallet balance?",
  "How does billing work?",
];

type BaireState = "idle" | "listening" | "processing" | "speaking";

export default function Baire() {
  const user = getUser();
  const firstName = user?.name?.split(" ")[0] || "there";

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "baire",
      content: `Hey ${firstName}! I'm Baire 😊 Your personal space concierge. I can find you the perfect spot to work, handle your bookings, and answer anything about JaIre. Just tap the button and talk to me, or type below!`,
    },
  ]);

  const [baireState, setBaireState] = useState<BaireState>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [convId, setConvId] = useState<number | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [inputText, setInputText] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    createConversation().then(setConvId).catch(console.error);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  const speakText = useCallback(
    (text: string) => {
      if (isMuted || !("speechSynthesis" in window)) {
        setBaireState("idle");
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.92;
      utter.pitch = 1.1;
      utter.volume = 0.95;

      const trySetVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(
          (v) =>
            v.lang.startsWith("en") &&
            (v.name.includes("Samantha") ||
              v.name.includes("Karen") ||
              v.name.includes("Moira") ||
              v.name.includes("Tessa") ||
              v.name.includes("Fiona") ||
              v.name.toLowerCase().includes("female") ||
              v.name.includes("Google US English Female"))
        ) ?? voices.find((v) => v.lang.startsWith("en"));
        if (preferred) utter.voice = preferred;
      };

      if (window.speechSynthesis.getVoices().length > 0) {
        trySetVoice();
      } else {
        window.speechSynthesis.addEventListener("voiceschanged", trySetVoice, { once: true });
      }

      utter.onstart = () => setBaireState("speaking");
      utter.onend = () => setBaireState("idle");
      utter.onerror = () => setBaireState("idle");
      window.speechSynthesis.speak(utter);
    },
    [isMuted]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !convId || baireState === "processing") return;
      setShowSuggestions(false);

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

        if (!response.body) throw new Error("No response body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "text") {
                fullText += event.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  const idx = updated.map((m, i) => (m.isStreaming ? i : -1)).filter((i) => i !== -1).at(-1);
                  if (idx !== undefined) updated[idx] = { role: "baire", content: fullText, isStreaming: true };
                  return updated;
                });
              } else if (event.type === "done") {
                const finalText = event.full_response || fullText;
                setMessages((prev) => {
                  const updated = [...prev];
                  const idx = updated.map((m, i) => (m.isStreaming ? i : -1)).filter((i) => i !== -1).at(-1);
                  if (idx !== undefined) updated[idx] = { role: "baire", content: finalText, isStreaming: false };
                  return updated;
                });
                speakText(finalText);
              }
            } catch {}
          }
        }
      } catch {
        setMessages((prev) => {
          const updated = [...prev];
          const idx = updated.map((m, i) => (m.isStreaming ? i : -1)).filter((i) => i !== -1).at(-1);
          if (idx !== undefined)
            updated[idx] = {
              role: "baire",
              content: "Oops, something went wrong on my end! Give me a second and try again?",
              isStreaming: false,
            };
          return updated;
        });
        setBaireState("idle");
      } finally {
        if (baireState !== "speaking") setBaireState("idle");
      }
    },
    [convId, baireState, user, speakText]
  );

  const startVoice = useCallback(() => {
    if (baireState !== "idle") return;
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      setShowInput(true);
      return;
    }
    window.speechSynthesis.cancel();
    setBaireState("listening");

    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onend = () => {
      if (baireState === "listening") setBaireState("idle");
    };
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join("");
      if (transcript) sendMessage(transcript);
    };
    recognition.onerror = () => setBaireState("idle");
    recognitionRef.current = recognition;
    recognition.start();
  }, [baireState, sendMessage]);

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop();
    setBaireState("idle");
  }, []);

  const handleOrbPress = () => {
    if (baireState === "listening") {
      stopVoice();
    } else if (baireState === "speaking") {
      window.speechSynthesis.cancel();
      setBaireState("idle");
    } else if (baireState === "idle") {
      startVoice();
    }
  };

  const handleTextSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    setShowInput(false);
    sendMessage(text);
  };

  const orbLabel =
    baireState === "listening"
      ? "Listening… tap to stop"
      : baireState === "processing"
      ? "Thinking…"
      : baireState === "speaking"
      ? "Tap to stop"
      : "Tap to speak";

  const orbColor =
    baireState === "listening"
      ? { from: "hsl(43 100% 50%)", to: "hsl(38 100% 44%)" }
      : baireState === "speaking"
      ? { from: "hsl(262 83% 66%)", to: "hsl(199 93% 60%)" }
      : baireState === "processing"
      ? { from: "rgba(139,92,246,0.4)", to: "rgba(56,189,248,0.4)" }
      : { from: "rgba(139,92,246,0.25)", to: "rgba(56,189,248,0.2)" };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ height: "calc(100vh - 4rem)" }}>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 pb-4"
        style={{ scrollBehavior: "smooth" }}
      >
        <div className="max-w-xl mx-auto pt-6 space-y-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-3",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "baire" && (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-1"
                  style={{
                    background: "linear-gradient(135deg, rgba(139,92,246,0.3) 0%, rgba(56,189,248,0.3) 100%)",
                    border: "1px solid rgba(139,92,246,0.35)",
                    color: "hsl(262 83% 76%)",
                  }}
                >
                  B
                </div>
              )}
              <div
                className={cn(
                  "px-4 py-3 rounded-2xl text-[15px] leading-relaxed max-w-[80%]",
                  msg.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm"
                )}
                style={
                  msg.role === "user"
                    ? { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }
                    : { background: "rgba(139,92,246,0.09)", border: "1px solid rgba(139,92,246,0.2)" }
                }
              >
                {msg.content || (msg.isStreaming ? null : "…")}
                {msg.isStreaming && !msg.content && (
                  <div className="flex items-center gap-1.5 py-1">
                    {[0, 1, 2].map((j) => (
                      <div
                        key={j}
                        className="w-2 h-2 rounded-full bg-current opacity-40 animate-bounce"
                        style={{ animationDelay: `${j * 150}ms` }}
                      />
                    ))}
                  </div>
                )}
                {msg.isStreaming && msg.content && (
                  <span className="inline-block w-0.5 h-4 bg-current opacity-60 ml-0.5 animate-pulse align-bottom" />
                )}
              </div>
            </div>
          ))}

          {showSuggestions && messages.length <= 1 && (
            <div className="grid grid-cols-2 gap-2 pt-2">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => sendMessage(p)}
                  disabled={baireState !== "idle"}
                  className="text-left px-3 py-2.5 rounded-xl text-sm transition-all hover:bg-white/6 disabled:opacity-40"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        className="shrink-0 pb-8 px-4"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 100%)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="max-w-xl mx-auto">
          {showInput ? (
            <div className="mb-4">
              <form onSubmit={handleTextSend} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowInput(false)}
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                <input
                  ref={inputRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Type your message…"
                  className="flex-1 h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-all"
                  disabled={baireState === "processing"}
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || baireState === "processing"}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-30 hover:scale-105 shrink-0"
                  style={{ background: "rgba(255,170,0,0.15)", color: "#FFAA00", border: "1px solid rgba(255,170,0,0.3)" }}
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          ) : null}

          <div className="flex flex-col items-center gap-3">
            {baireState === "listening" && (
              <div className="flex items-center gap-1 h-6">
                {Array.from({ length: 11 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-0.5 rounded-full bg-primary"
                    style={{
                      height: `${6 + Math.sin((i / 10) * Math.PI) * 18}px`,
                      animation: `baire-wave ${0.5 + (i % 3) * 0.15}s ease-in-out infinite alternate`,
                      animationDelay: `${i * 60}ms`,
                      opacity: 0.7 + (i % 2) * 0.3,
                    }}
                  />
                ))}
              </div>
            )}

            <button
              onClick={handleOrbPress}
              disabled={baireState === "processing"}
              className={cn(
                "relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500 select-none",
                baireState === "idle" && "hover:scale-105 active:scale-95",
                baireState === "listening" && "scale-110",
                baireState === "processing" && "cursor-wait"
              )}
              style={{
                background: `radial-gradient(circle at 35% 35%, ${orbColor.from}, ${orbColor.to})`,
                boxShadow:
                  baireState === "listening"
                    ? `0 0 0 8px rgba(255,170,0,0.15), 0 0 0 16px rgba(255,170,0,0.06), 0 0 40px rgba(255,170,0,0.3)`
                    : baireState === "speaking"
                    ? `0 0 0 8px rgba(139,92,246,0.15), 0 0 0 16px rgba(139,92,246,0.06), 0 0 40px rgba(139,92,246,0.3)`
                    : baireState === "processing"
                    ? `0 0 0 8px rgba(139,92,246,0.1), 0 0 20px rgba(139,92,246,0.2)`
                    : `0 0 0 1px rgba(139,92,246,0.2), 0 8px 32px rgba(0,0,0,0.4)`,
              }}
            >
              {baireState === "processing" ? (
                <div
                  className="w-8 h-8 rounded-full border-2 animate-spin"
                  style={{ borderColor: "rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.8)" }}
                />
              ) : (
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-xl font-bold" style={{ color: baireState === "listening" ? "hsl(220 40% 8%)" : "white" }}>
                    B
                  </span>
                  {baireState === "speaking" && (
                    <div className="flex gap-0.5">
                      {[0, 1, 2].map((j) => (
                        <div
                          key={j}
                          className="w-0.5 h-2 rounded-full bg-white/70 animate-bounce"
                          style={{ animationDelay: `${j * 100}ms` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {baireState === "listening" && (
                <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping" />
              )}
            </button>

            <p className="text-xs text-muted-foreground">{orbLabel}</p>

            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  setIsMuted(!isMuted);
                  if (!isMuted) window.speechSynthesis.cancel();
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                {isMuted ? "Unmute" : "Mute"}
              </button>

              <button
                onClick={() => setShowInput((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Keyboard className="w-3.5 h-3.5" />
                Type
              </button>
            </div>
          </div>
        </div>
      </div>

      {walletOpen && <WalletPanel onClose={() => setWalletOpen(false)} />}
    </div>
  );
}
