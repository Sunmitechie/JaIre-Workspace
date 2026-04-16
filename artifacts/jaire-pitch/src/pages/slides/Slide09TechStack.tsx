export default function Slide09TechStack() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0C0D11]">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,_#0C0D11_0%,_#0E1016_100%)]" />

      <div className="relative z-10 flex flex-col h-full px-[8vw] py-[7vh]">
        <div className="mb-[4vh]">
          <p className="font-body text-[1.5vw] text-primary font-semibold tracking-widest uppercase mb-[1vh]">Technical Architecture</p>
          <h2 className="font-display text-[4vw] font-black text-text tracking-tight">Genuinely complex. Genuinely built.</h2>
        </div>

        <div className="grid grid-cols-2 gap-[3vw] flex-1">
          <div className="flex flex-col gap-[2vh]">
            <div className="bg-[#161820] border border-[#2A2D3A] rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
              <p className="font-body text-[1.4vw] text-primary font-semibold tracking-widest uppercase mb-[1.2vh]">Blockchain Layer</p>
              <p className="font-display text-[1.8vw] font-bold text-text">Solana · USDC · SPL Tokens</p>
              <p className="font-body text-[1.5vw] text-muted mt-[0.5vh]">On-chain escrow, per-second billing, 85/15 settlement with JAIRE memos</p>
            </div>
            <div className="bg-[#161820] border border-[#2A2D3A] rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
              <p className="font-body text-[1.4vw] text-primary font-semibold tracking-widest uppercase mb-[1.2vh]">Identity Layer</p>
              <p className="font-display text-[1.8vw] font-bold text-text">Web3Auth MPC Core Kit</p>
              <p className="font-body text-[1.5vw] text-muted mt-[0.5vh]">Invisible wallets via Google OAuth — no seed phrases, no friction, TSS threshold signing</p>
            </div>
            <div className="bg-[#161820] border border-[#2A2D3A] rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
              <p className="font-body text-[1.4vw] text-primary font-semibold tracking-widest uppercase mb-[1.2vh]">Payments Layer</p>
              <p className="font-display text-[1.8vw] font-bold text-text">Paystack · FX Oracle · USDC Bridge</p>
              <p className="font-body text-[1.5vw] text-muted mt-[0.5vh]">Naira in → USDC out from JaIre vault, 0.5% spread, real-time exchange</p>
            </div>
          </div>

          <div className="flex flex-col gap-[2vh]">
            <div className="bg-[#161820] border border-[#2A2D3A] rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
              <p className="font-body text-[1.4vw] text-primary font-semibold tracking-widest uppercase mb-[1.2vh]">AI Agent Layer</p>
              <p className="font-display text-[1.8vw] font-bold text-text">OpenAI GPT-4o · LangChain · SSE</p>
              <p className="font-body text-[1.5vw] text-muted mt-[0.5vh]">Baire (user) and Jaie (org) agents with real-time streaming, context injection, tool use</p>
            </div>
            <div className="bg-[#161820] border border-[#2A2D3A] rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
              <p className="font-body text-[1.4vw] text-primary font-semibold tracking-widest uppercase mb-[1.2vh]">Backend Layer</p>
              <p className="font-display text-[1.8vw] font-bold text-text">Node.js · Express · PostgreSQL · Drizzle</p>
              <p className="font-body text-[1.5vw] text-muted mt-[0.5vh]">REST API, webhook handlers, QR scan engine, JWT auth for users and orgs</p>
            </div>
            <div className="bg-[#F5A623]/8 border border-primary/30 rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
              <p className="font-body text-[1.4vw] text-primary font-semibold tracking-widest uppercase mb-[1.2vh]">Frontend Layer</p>
              <p className="font-display text-[1.8vw] font-bold text-text">React · Vite · Tailwind · Wouter</p>
              <p className="font-body text-[1.5vw] text-muted mt-[0.5vh]">Live demo available — deployed on Replit, fully functional</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
