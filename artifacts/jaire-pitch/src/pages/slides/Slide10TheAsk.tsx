import jaireLogo from "@assets/ChatGPT_Image_Apr_16,_2026,_09_52_10_PM_1776375405013.png";

export default function Slide10TheAsk() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0C0D11]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_#F5A623_0%,_transparent_55%)] opacity-[0.06]" />
      <div className="absolute top-0 left-0 right-0 h-[1vh] bg-primary" />

      <div className="relative z-10 flex h-full">
        <div className="flex flex-col justify-center pl-[8vw] pr-[4vw] w-[50vw]">
          <img src={jaireLogo} crossOrigin="anonymous" className="h-[7vh] w-auto mb-[3vh]" alt="JaIre" />
          <p className="font-body text-[1.5vw] text-primary font-semibold tracking-widest uppercase mb-[2vh]">The Ask</p>
          <p className="font-display text-[8vw] font-black text-primary leading-none tracking-tighter mb-[1vh]">$500K</p>
          <p className="font-display text-[2.5vw] font-bold text-text mb-[3vh]">Pre-Seed Round</p>
          <p className="font-body text-[1.7vw] text-[#A8ABBE] leading-relaxed max-w-[38vw]">
            To onboard 10 workspace operators, migrate to Solana mainnet, and reach 500 monthly active bookings within 6 months.
          </p>
        </div>

        <div className="flex flex-col justify-center pr-[8vw] gap-[2.5vh] flex-1">
          <p className="font-display text-[1.8vw] font-bold text-primary mb-[1vh]">Use of Funds</p>

          <div className="bg-[#161820] border border-[#2A2D3A] rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
            <div className="flex items-center justify-between">
              <p className="font-body text-[1.6vw] text-text font-medium">Engineering &amp; Infrastructure</p>
              <p className="font-display text-[2vw] font-bold text-primary">40%</p>
            </div>
            <div className="mt-[1vh] h-[0.5vh] bg-[#2A2D3A] rounded-full">
              <div className="h-full w-[40%] bg-primary rounded-full" />
            </div>
          </div>

          <div className="bg-[#161820] border border-[#2A2D3A] rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
            <div className="flex items-center justify-between">
              <p className="font-body text-[1.6vw] text-text font-medium">Operator Acquisition &amp; Pilots</p>
              <p className="font-display text-[2vw] font-bold text-primary">35%</p>
            </div>
            <div className="mt-[1vh] h-[0.5vh] bg-[#2A2D3A] rounded-full">
              <div className="h-full w-[35%] bg-primary rounded-full" />
            </div>
          </div>

          <div className="bg-[#161820] border border-[#2A2D3A] rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
            <div className="flex items-center justify-between">
              <p className="font-body text-[1.6vw] text-text font-medium">USDC Vault Liquidity</p>
              <p className="font-display text-[2vw] font-bold text-primary">25%</p>
            </div>
            <div className="mt-[1vh] h-[0.5vh] bg-[#2A2D3A] rounded-full">
              <div className="h-full w-[25%] bg-primary rounded-full" />
            </div>
          </div>

          <div className="border-t border-[#2A2D3A] pt-[2.5vh]">
            <p className="font-body text-[1.5vw] text-muted">Live demo: jaire.replit.app</p>
          </div>
        </div>
      </div>
    </div>
  );
}
