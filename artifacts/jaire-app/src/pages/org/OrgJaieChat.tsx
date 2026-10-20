import type { FormEvent, Ref } from "react";

export interface JaieMessage {
  role: "user" | "assistant";
  content: string;
}

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  history: JaieMessage[];
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  streaming: string;
  bottomRef: Ref<HTMLDivElement>;
  onSubmit: (event: FormEvent) => void;
};

const SUGGESTIONS = [
  "How does my 85% settlement work?",
  "Turn off my first workspace",
  "Which workspace is performing best?",
];

export default function OrgJaieChat({
  open,
  setOpen,
  history,
  input,
  setInput,
  loading,
  streaming,
  bottomRef,
  onSubmit,
}: Props) {
  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all hover:scale-110 active:scale-95"
        style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)", boxShadow: "0 8px 30px rgba(124,58,237,0.5)" }}
        title="Ask Jaie"
      >
        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[360px] max-h-[520px] flex flex-col bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10" style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(79,70,229,0.1))" }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}>J</div>
              <div><p className="text-white text-sm font-semibold">Jaie</p><p className="text-gray-500 text-xs">Your JaIre business partner</p></div>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 p-1" aria-label="Close Jaie chat">×</button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[360px]">
            {history.length === 0 && !streaming && (
              <div className="text-center py-6">
                <p className="text-gray-500 text-sm">Hey! I'm Jaie — ask me anything about your workspaces, revenue, or how JaIre works. I can also take actions for you.</p>
                <div className="mt-4 flex flex-col gap-2">
                  {SUGGESTIONS.map(question => <button key={question} onClick={() => setInput(question)} className="text-xs text-purple-400 hover:text-purple-300 border border-purple-500/20 hover:border-purple-500/40 rounded-lg px-3 py-1.5 transition-all text-left">{question}</button>)}
                </div>
              </div>
            )}
            {history.map((message, index) => (
              <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${message.role === "user" ? "bg-purple-600 text-white" : "bg-white/8 text-gray-200 border border-white/8"}`}>
                  {message.content}
                </div>
              </div>
            ))}
            {streaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-white/8 border border-white/8 rounded-xl px-3 py-2 text-sm text-gray-200 leading-relaxed">
                  {streaming}<span className="inline-block w-1.5 h-4 ml-0.5 bg-purple-400 rounded-sm animate-pulse align-middle" />
                </div>
              </div>
            )}
            {loading && !streaming && (
              <div className="flex justify-start"><div className="bg-white/8 border border-white/8 rounded-xl px-3 py-2 flex gap-1">{[0, 1, 2].map(index => <span key={index} className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: `${index * 0.15}s` }} />)}</div></div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={onSubmit} className="border-t border-white/10 p-3 flex gap-2">
            <input value={input} onChange={event => setInput(event.target.value)} placeholder="Ask Jaie anything..." className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50" disabled={loading} />
            <button type="submit" disabled={loading || !input.trim()} className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded-xl transition-all" aria-label="Send message">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
