export default function Slide02Problem() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0C0D11]">
      <div className="absolute top-0 right-0 w-[35vw] h-[40vh] bg-[#F5A623]/4 rounded-bl-[8vw]" />
      <div className="absolute bottom-0 left-0 w-[20vw] h-[25vh] bg-[#F5A623]/3 rounded-tr-[6vw]" />

      <div className="relative z-10 flex flex-col h-full px-[8vw] py-[7vh]">
        <div className="mb-[4vh]">
          <p className="font-body text-[1.5vw] text-primary font-semibold tracking-widest uppercase mb-[1.5vh]">The Problem</p>
          <h2 className="font-display text-[4.5vw] font-black text-text tracking-tight leading-tight">
            Coworking is stuck in 2010.
            <span className="block text-[#A8ABBE]">Crypto payments are still broken.</span>
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-[2.5vw] flex-1">
          <div className="bg-[#161820] border border-[#2A2D3A] rounded-[2vw] px-[3vw] py-[3.5vh]">
            <div className="w-[3vw] h-[3vw] rounded-[0.8vw] bg-[#F5A623]/15 flex items-center justify-center mb-[2vh]">
              <span className="font-display text-[1.6vw] font-black text-primary">01</span>
            </div>
            <h3 className="font-display text-[2.2vw] font-bold text-text mb-[2vh]">The Coworking Trap</h3>
            <div className="space-y-[1.5vh]">
              <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-snug">
                Pay for a full day even if you stay 90 minutes.
              </p>
              <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-snug">
                No-show = full charge. No flexibility, no refunds.
              </p>
              <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-snug">
                Workspace operators lose 40%+ to unused bookings.
              </p>
            </div>
            <div className="mt-[2.5vh] border-t border-[#2A2D3A] pt-[2vh]">
              <p className="font-display text-[2.4vw] font-black text-primary">$7B+</p>
              <p className="font-body text-[1.5vw] text-muted">wasted on unused coworking time annually</p>
            </div>
          </div>

          <div className="bg-[#161820] border border-[#2A2D3A] rounded-[2vw] px-[3vw] py-[3.5vh]">
            <div className="w-[3vw] h-[3vw] rounded-[0.8vw] bg-[#F5A623]/15 flex items-center justify-center mb-[2vh]">
              <span className="font-display text-[1.6vw] font-black text-primary">02</span>
            </div>
            <h3 className="font-display text-[2.2vw] font-bold text-text mb-[2vh]">The Crypto Friction Wall</h3>
            <div className="space-y-[1.5vh]">
              <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-snug">
                Moving USDC to a Nigerian bank: 5 steps, 3%+ in fees, 1-3 days.
              </p>
              <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-snug">
                Seed phrases scare away 90% of non-crypto users.
              </p>
              <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-snug">
                No fiat on-ramp built for Naira users — until now.
              </p>
            </div>
            <div className="mt-[2.5vh] border-t border-[#2A2D3A] pt-[2vh]">
              <p className="font-display text-[2.4vw] font-black text-primary">Nigeria</p>
              <p className="font-body text-[1.5vw] text-muted">#2 globally for crypto adoption (Chainalysis 2024)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
