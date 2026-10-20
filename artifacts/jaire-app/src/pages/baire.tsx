import { useState, useRef, useEffect, useCallback } from "react";
import { Send } from "lucide-react";
import { getUser } from "@/lib/auth";
import { WalletPanel } from "@/components/wallet-panel";
import Conversation from "./baire/Conversation";
import Welcome from "./baire/Welcome";
import type { Message } from "./baire/content";
import type { BaireState, OrbGlow } from "./baire/types";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function createConversation(): Promise<number> {
  const res = await fetch(`${BASE_URL}/api/baire/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "JaIre Session" }),
  });
  return (await res.json()).id;
}

async function playAudioBlob(blob: Blob, audioRef: React.MutableRefObject<HTMLAudioElement | null>): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); audioRef.current = null; resolve(); };
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
  const [walletBalanceUsdc, setWalletBalanceUsdc] = useState<number | null>(null);

  const isWelcome = messages.length === 0;

  const [convInitError, setConvInitError] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isMutedRef = useRef(isMuted);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  const initConversation = useCallback(() => {
    setConvInitError(false);
    createConversation()
      .then(setConvId)
      .catch(() => setConvInitError(true));
  }, []);

  useEffect(() => {
    initConversation();
  }, [initConversation]);

  // Sync verifierId to DB so wallet booking path works (same as book/wallet pages)
  useEffect(() => {
    if (!user?.idToken) return;
    fetch(`${BASE_URL}/api/wallet/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ web3auth_token: user.idToken, email: user.email, name: user.name }),
    }).catch(() => {});
  }, [user?.idToken]);

  useEffect(() => {
    if (!user?.walletAddress) return;
    fetch(`${BASE_URL}/mpc/balance/${user.walletAddress}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: any) => { if (typeof d.usdc_balance === "number") setWalletBalanceUsdc(d.usdc_balance); })
      .catch(() => {});
  }, [user?.walletAddress]);

  useEffect(() => {
    if (scrollRef.current && !isWelcome) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isWelcome]);

  useEffect(() => {
    if (showInput && inputRef.current) inputRef.current.focus();
  }, [showInput]);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
  }, []);

  const speakWithElevenLabs = useCallback(async (text: string) => {
    if (isMutedRef.current) { setBaireState("idle"); return; }
    stopAudio();
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
      await playAudioBlob(blob, audioRef);
    } catch {
      // silently fall through
    } finally {
      setBaireState("idle");
    }
  }, [stopAudio]);

  const sendTextMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || baireState === "processing") return;
      if (!convId) {
        if (convInitError) initConversation();
        return;
      }
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
            wallet_balance_usdc: walletBalanceUsdc ?? undefined,
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
    [convId, convInitError, initConversation, baireState, user, speakWithElevenLabs, walletBalanceUsdc]
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
    else if (baireState === "speaking") { stopAudio(); setBaireState("idle"); }
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

      {isWelcome && (
        <Welcome
          firstName={firstName}
          conversationError={convInitError}
          onRetry={initConversation}
          state={baireState}
          listeningLabel={listeningLabel}
          stateLabel={stateLabel}
          orbSize={orbSize}
          orbGlow={orbGlow}
          onOrbPress={handleOrbPress}
          isMuted={isMuted}
          setIsMuted={setIsMuted}
          showInput={showInput}
          setShowInput={setShowInput}
          sendTextMessage={sendTextMessage}
        />
      )}

      {!isWelcome && (
        <Conversation
          messages={messages}
          scrollRef={scrollRef}
          inputRef={inputRef}
          state={baireState}
          listeningLabel={listeningLabel}
          orbGlow={orbGlow}
          orbSize={orbSize}
          stateLabel={stateLabel}
          onOrbPress={handleOrbPress}
          isMuted={isMuted}
          onToggleMute={() => setIsMuted(!isMuted)}
          showInput={showInput}
          setShowInput={setShowInput}
          inputText={inputText}
          setInputText={setInputText}
          onTextSubmit={handleTextSend}
        />
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
