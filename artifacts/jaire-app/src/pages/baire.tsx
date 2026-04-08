import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Send, Volume2, VolumeX, Wallet, ArrowUpRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { getUser } from "@/lib/auth";
import { Link } from "wouter";
import { WalletPanel } from "@/components/wallet-panel";
import { formatNGN } from "@/lib/currency";

const NGN_PER_USDC = 1600;

interface Message {
  role: "user" | "baire";
  content: string;
  isStreaming?: boolean;
}

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function createConversation(): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/baire/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "JaIre Session" }),
  });
  const data = await res.json();
  return data.id;
}

const QUICK_ACTIONS = [
  { label: "Book a hot desk", prompt: "I'd like to book a hot desk for 2 hours today." },
  { label: "What's available?", prompt: "What coworking spaces do you have available?" },
  { label: "Check my balance", prompt: "Can you check my wallet balance?" },
  { label: "How does JaIre work?", prompt: "Explain how JaIre works — the payments and wallet stuff." },
];

export default function Baire() {
  const user = getUser();
  const firstName = user?.name?.split(" ")[0] || "there";

  const [messages, setMessages] = useState<Message[]>([
    {
      role: "baire",
      content: `Hi ${firstName}! I'm Baire, your workspace concierge. I can find and book the perfect space for you, check your wallet balance, or answer any questions about JaIre. What would you like to do today?`,
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [convId, setConvId] = useState<number | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    createConversation().then(setConvId).catch(console.error);
  }, []);

  useEffect(() => {
    if (!user?.walletAddress) return;
    let mounted = true;
    const fetchBal = async () => {
      try {
        const res = await fetch(`/api/jaire/devnet/balance/${user.walletAddress}`);
        const data = await res.json();
        if (mounted) setUsdcBalance(data.usdc_balance ?? 0);
      } catch {}
    };
    fetchBal();
    const iv = setInterval(fetchBal, 20000);
    return () => { mounted = false; clearInterval(iv); };
  }, [user?.walletAddress]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const speakText = useCallback(
    (text: string) => {
      if (isMuted || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.95;
      utter.pitch = 1.05;
      utter.volume = 0.9;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => v.lang === "en-US" && (v.name.includes("Samantha") || v.name.includes("Google US English Female") || v.name.includes("Female"))
      );
      if (preferred) utter.voice = preferred;
      utter.onstart = () => setIsSpeaking(true);
      utter.onend = () => setIsSpeaking(false);
      utter.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utter);
    },
    [isMuted]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || !convId || isProcessing) return;

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setIsProcessing(true);
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
                  const idx = updated.map((m, i) => m.role === "baire" ? i : -1).filter(i => i !== -1).at(-1);
                  if (idx !== undefined) updated[idx] = { role: "baire", content: fullText, isStreaming: true };
                  return updated;
                });
              } else if (event.type === "done") {
                const finalText = event.full_response || fullText;
                setMessages((prev) => {
                  const updated = [...prev];
                  const idx = updated.map((m, i) => m.role === "baire" ? i : -1).filter(i => i !== -1).at(-1);
                  if (idx !== undefined) updated[idx] = { role: "baire", content: finalText, isStreaming: false };
                  return updated;
                });
                speakText(finalText);

                if (finalText.toLowerCase().includes("booking confirmed") || finalText.toLowerCase().includes("booking id")) {
                  if (user?.walletAddress) {
                    fetch(`/api/jaire/devnet/balance/${user.walletAddress}`)
                      .then(r => r.json())
                      .then(d => setUsdcBalance(d.usdc_balance ?? 0))
                      .catch(() => {});
                  }
                }
              }
            } catch {}
          }
        }
      } catch {
        setMessages((prev) => {
          const updated = [...prev];
          const idx = updated.map((m, i) => m.role === "baire" ? i : -1).filter(i => i !== -1).at(-1);
          if (idx !== undefined) updated[idx] = { role: "baire", content: "Sorry, I had a brief hiccup. Could you try again?", isStreaming: false };
          return updated;
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [convId, isProcessing, user, speakText]
  );

  const startVoice = useCallback(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      alert("Voice input is not supported in this browser. Please use text input below.");
      return;
    }
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results).map((r: any) => r[0].transcript).join("");
      if (event.results[0].isFinal) sendMessage(transcript);
    };
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
  }, [sendMessage]);

  const stopVoice = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const handleTextSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    sendMessage(text);
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      <div
        className="border-b border-white/6 px-5 py-3.5 flex items-center justify-between shrink-0"
        style={{ background: "rgba(139,92,246,0.03)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(139,92,246,0.3) 0%, rgba(56,189,248,0.3) 100%)",
              border: "1px solid rgba(139,92,246,0.4)",
              color: "hsl(262 83% 76%)",
            }}
          >
            B
          </div>
          <div>
            <div className="font-bold text-sm leading-none">Baire</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-muted-foreground">
                {isListening ? "Listening..." : isSpeaking ? "Speaking..." : isProcessing ? "Thinking..." : "Online"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user?.walletAddress && (
            <button
              onClick={() => setWalletOpen(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:scale-[1.02]"
              style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.2)", color: "#FFAA00" }}
            >
              <Wallet className="w-3.5 h-3.5" />
              {usdcBalance !== null ? formatNGN(usdcBalance * NGN_PER_USDC) : "Wallet"}
            </button>
          )}
          <button
            onClick={() => { setIsMuted(!isMuted); if (!isMuted) window.speechSynthesis.cancel(); }}
            className={cn("w-8 h-8 rounded-lg flex items-center justify-center transition-colors", isMuted ? "text-muted-foreground bg-white/4" : "text-primary bg-primary/10")}
            title={isMuted ? "Unmute Baire" : "Mute Baire"}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <Link href="/workspaces">
            <button className="h-8 px-3 rounded-lg text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5" />
              Browse
            </button>
          </Link>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={cn("flex gap-3 max-w-[85%]", msg.role === "user" ? "ml-auto flex-row-reverse" : "")}>
              {msg.role === "baire" && (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-1"
                  style={{
                    background: "linear-gradient(135deg, rgba(139,92,246,0.25) 0%, rgba(56,189,248,0.25) 100%)",
                    border: "1px solid rgba(139,92,246,0.3)",
                    color: "hsl(262 83% 76%)",
                  }}
                >
                  B
                </div>
              )}
              <div
                className={cn("px-4 py-3 rounded-2xl text-[15px] leading-relaxed", msg.role === "user" ? "rounded-tr-sm" : "rounded-tl-sm")}
                style={
                  msg.role === "user"
                    ? { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }
                    : { background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }
                }
              >
                {msg.content || (msg.isStreaming ? null : "...")}
                {msg.isStreaming && !msg.content && (
                  <div className="flex items-center gap-1.5 py-1">
                    {[0, 1, 2].map((j) => (
                      <div key={j} className="w-2 h-2 rounded-full bg-current opacity-50 animate-bounce" style={{ animationDelay: `${j * 150}ms` }} />
                    ))}
                  </div>
                )}
                {msg.isStreaming && msg.content && (
                  <span className="inline-block w-0.5 h-4 bg-current opacity-60 ml-0.5 animate-pulse align-bottom" />
                )}
              </div>
            </div>
          ))}

          {messages.length === 1 && (
            <div className="pt-2 grid grid-cols-2 gap-2">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.prompt}
                  onClick={() => sendMessage(action.prompt)}
                  disabled={isProcessing}
                  className="text-left px-4 py-3 rounded-xl text-sm font-medium transition-all hover:scale-[1.01] disabled:opacity-50 flex items-center gap-2.5"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/6 p-5 shrink-0" style={{ background: "rgba(0,0,0,0.3)", backdropFilter: "blur(20px)" }}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-4 mb-4 justify-center">
            <button
              onClick={isListening ? stopVoice : startVoice}
              className={cn(
                "relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300",
                isListening ? "scale-110" : "hover:scale-105"
              )}
              style={
                isListening
                  ? { background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)", color: "hsl(220 40% 5%)" }
                  : {
                      background: "linear-gradient(135deg, rgba(139,92,246,0.25) 0%, rgba(56,189,248,0.25) 100%)",
                      border: "2px solid rgba(139,92,246,0.5)",
                      color: "hsl(262 83% 76%)",
                    }
              }
              title={isListening ? "Stop listening" : "Tap to speak"}
            >
              {isListening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              {isListening && <div className="absolute inset-0 rounded-full border-2 border-primary/40 animate-ping" />}
            </button>
          </div>

          {isListening && (
            <div className="flex items-center justify-center gap-1.5 mb-4 h-6">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="wave-bar w-1 bg-primary rounded-full"
                  style={{ height: `${Math.random() * 20 + 6}px`, animationDelay: `${i * 80}ms`, animationDuration: `${0.6 + Math.random() * 0.4}s` }}
                />
              ))}
            </div>
          )}

          <form onSubmit={handleTextSend} className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={isListening ? "Listening..." : "Or type your message..."}
              className="flex-1 h-12 px-4 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-all"
              disabled={isProcessing || isListening}
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isProcessing || isListening}
              className="w-12 h-12 rounded-xl flex items-center justify-center transition-all disabled:opacity-30 hover:scale-105"
              style={{ background: "rgba(255,170,0,0.15)", color: "#FFAA00", border: "1px solid rgba(255,170,0,0.3)" }}
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

          <p className="text-center text-xs text-muted-foreground mt-3">
            Tap the mic to speak · Baire can book spaces and make real transactions
          </p>
        </div>
      </div>

      {walletOpen && <WalletPanel onClose={() => setWalletOpen(false)} />}
    </div>
  );
}
