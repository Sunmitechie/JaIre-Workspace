import jaireLogo from "@assets/ChatGPT_Image_Apr_16,_2026,_09_52_10_PM_1776375405013.png";

const base = import.meta.env.BASE_URL;

export default function Slide01Cover() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0C0D11]">
      <img
        src={`${base}hero-cover.png`}
        crossOrigin="anonymous"
        className="absolute inset-0 w-full h-full object-cover opacity-30"
        alt=""
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0C0D11] via-[#0C0D11]/60 to-[#0C0D11]/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0C0D11] via-transparent to-transparent" />

      <div className="relative z-10 flex flex-col justify-between h-full px-[8vw] py-[7vh]">
        <div>
          <img src={jaireLogo} crossOrigin="anonymous" className="h-[6vh] w-auto" alt="JaIre" />
        </div>

        <div>
          <p className="font-body text-[1.5vw] text-primary font-semibold tracking-[0.25em] uppercase mb-[2.5vh]">
            Web2.5 · DePIN Coworking · Solana
          </p>
          <h1 className="font-display font-black text-text leading-[0.88] tracking-tighter mb-[1vh]">
            <span className="block text-[7.5vw]">Workspace.</span>
            <span className="block text-[7.5vw] text-primary">On-Chain.</span>
          </h1>
          <p className="font-body text-[1.8vw] text-[#A8ABBE] font-medium mt-[3vh] max-w-[42vw] leading-relaxed">
            Per-second billing. Invisible wallets. AI-native booking.
            Built for the 35 million crypto users in West Africa — and everyone else.
          </p>
        </div>

        <div className="flex items-center gap-[2vw]">
          <span className="font-body text-[1.5vw] text-muted">Pre-Seed Round · 2026</span>
          <span className="block w-[5vw] h-[1px] bg-primary/50" />
          <span className="font-body text-[1.5vw] text-muted">Strictly Confidential</span>
        </div>
      </div>
    </div>
  );
}
