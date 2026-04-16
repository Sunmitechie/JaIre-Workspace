import jaireLogo from "@assets/ChatGPT_Image_Apr_16,_2026,_09_52_10_PM_1776375405013.png";

export default function Slide04Solution() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0D0E13]">
      <div className="absolute left-0 top-0 w-[1vw] h-full bg-primary" />
      <div className="absolute right-[8vw] top-[12vh] w-[30vw] h-[30vw] rounded-full bg-[#F5A623]/5 blur-[4vw]" />

      <div className="relative z-10 flex h-full">
        <div className="flex flex-col justify-center pl-[10vw] pr-[4vw] w-[55vw]">
          <p className="font-body text-[1.5vw] text-primary font-semibold tracking-widest uppercase mb-[3vh]">The Solution</p>
          <h2 className="font-display font-black text-text tracking-tight leading-tight mb-[4vh]">
            <span className="block text-[4.8vw]">Book by the second.</span>
            <span className="block text-[4.8vw]">Pay without a wallet.</span>
            <span className="block text-[4.8vw] text-primary">Settle on Solana.</span>
          </h2>
          <p className="font-body text-[1.8vw] text-[#A8ABBE] leading-relaxed max-w-[38vw]">
            JaIre is the first DePIN coworking platform where users book workspaces through an AI agent, pay in Naira or USDC, and every transaction settles on-chain — invisibly.
          </p>
        </div>

        <div className="flex flex-col justify-center pr-[7vw] gap-[2.5vh] flex-1">
          <img src={jaireLogo} crossOrigin="anonymous" className="h-[10vh] w-auto mb-[1vh]" alt="JaIre" />

          <div className="border-l-[0.3vw] border-primary pl-[2vw]">
            <p className="font-display text-[1.8vw] font-bold text-text">Baire</p>
            <p className="font-body text-[1.5vw] text-muted">AI voice agent — books, answers, bills</p>
          </div>
          <div className="border-l-[0.3vw] border-[#2A2D3A] pl-[2vw]">
            <p className="font-display text-[1.8vw] font-bold text-text">Invisible Wallets</p>
            <p className="font-body text-[1.5vw] text-muted">Web3Auth MPC — no seed phrase, ever</p>
          </div>
          <div className="border-l-[0.3vw] border-[#2A2D3A] pl-[2vw]">
            <p className="font-display text-[1.8vw] font-bold text-text">Per-Second Billing</p>
            <p className="font-body text-[1.5vw] text-muted">USDC escrow unlocked by QR scan</p>
          </div>
          <div className="border-l-[0.3vw] border-[#2A2D3A] pl-[2vw]">
            <p className="font-display text-[1.8vw] font-bold text-text">Fiat Bridge</p>
            <p className="font-body text-[1.5vw] text-muted">Paystack NGN → JaIre vault → USDC on-chain</p>
          </div>
        </div>
      </div>
    </div>
  );
}
