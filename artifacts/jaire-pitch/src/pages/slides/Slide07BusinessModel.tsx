export default function Slide07BusinessModel() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0C0D11]">
      <div className="absolute bottom-0 right-0 w-[40vw] h-[50vh] bg-[#F5A623]/3 rounded-tl-[8vw]" />

      <div className="relative z-10 flex flex-col h-full px-[8vw] py-[7vh]">
        <div className="mb-[4vh]">
          <p className="font-body text-[1.5vw] text-primary font-semibold tracking-widest uppercase mb-[1vh]">Business Model</p>
          <h2 className="font-display text-[4vw] font-black text-text tracking-tight">Three revenue streams. Zero friction.</h2>
        </div>

        <div className="grid grid-cols-3 gap-[2.5vw] flex-1">
          <div className="bg-[#F5A623]/10 border border-primary/40 rounded-[2vw] px-[3vw] py-[3.5vh] flex flex-col">
            <p className="font-display text-[7vw] font-black text-primary leading-none mb-[2vh]">15%</p>
            <h3 className="font-display text-[2vw] font-bold text-text mb-[1.5vh]">Session Fee</h3>
            <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-relaxed flex-1">
              JaIre takes 15% of every booking. 85% settles to the org's Solana wallet automatically on checkout — zero chasing invoices.
            </p>
            <div className="mt-[2.5vh] border-t border-primary/20 pt-[2vh]">
              <p className="font-body text-[1.5vw] text-muted">Primary revenue stream</p>
            </div>
          </div>

          <div className="bg-[#161820] border border-[#2A2D3A] rounded-[2vw] px-[3vw] py-[3.5vh] flex flex-col">
            <p className="font-display text-[7vw] font-black text-primary leading-none mb-[2vh]">0.5%</p>
            <h3 className="font-display text-[2vw] font-bold text-text mb-[1.5vh]">FX Spread</h3>
            <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-relaxed flex-1">
              JaIre converts Naira to USDC at a 0.5% spread above market. Hidden from the user, earned on every Paystack top-up.
            </p>
            <div className="mt-[2.5vh] border-t border-[#2A2D3A] pt-[2vh]">
              <p className="font-body text-[1.5vw] text-muted">Passive on every fiat payment</p>
            </div>
          </div>

          <div className="bg-[#161820] border border-[#2A2D3A] rounded-[2vw] px-[3vw] py-[3.5vh] flex flex-col">
            <p className="font-display text-[3.5vw] font-black text-primary leading-none mb-[2vh]">JAIRE Token</p>
            <h3 className="font-display text-[2vw] font-bold text-text mb-[1.5vh]">Future Protocol Layer</h3>
            <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-relaxed flex-1">
              Governance token for workspace operators. Staking discounts for power users. On-chain reputation protocol for the DePIN layer.
            </p>
            <div className="mt-[2.5vh] border-t border-[#2A2D3A] pt-[2vh]">
              <p className="font-body text-[1.5vw] text-muted">Phase 2 — post-traction</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
