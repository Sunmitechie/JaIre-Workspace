export default function Slide05HowItWorks() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0C0D11]">
      <div className="absolute bottom-0 left-0 right-0 h-[30vh] bg-gradient-to-t from-[#F5A623]/4 to-transparent" />

      <div className="relative z-10 flex flex-col h-full px-[8vw] py-[7vh]">
        <div className="mb-[4.5vh]">
          <p className="font-body text-[1.5vw] text-primary font-semibold tracking-widest uppercase mb-[1vh]">How It Works</p>
          <h2 className="font-display text-[4vw] font-black text-text tracking-tight">From Naira to on-chain in under 60 seconds.</h2>
        </div>

        <div className="grid grid-cols-3 gap-[2.5vw] flex-1">
          <div className="bg-[#161820] border border-[#2A2D3A] rounded-[2vw] px-[3vw] py-[3.5vh] flex flex-col">
            <div className="mb-[2vh]">
              <span className="font-display text-[5vw] font-black text-primary/20 leading-none">01</span>
            </div>
            <h3 className="font-display text-[2vw] font-bold text-text mb-[2vh]">Baire Finds Your Space</h3>
            <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-relaxed flex-1">
              Tell Baire what you need — a desk, a boardroom, a quiet pod. She books it, quotes the per-minute rate, and locks your slot.
            </p>
            <div className="mt-[2vh] bg-[#0C0D11] rounded-[1vw] px-[1.5vw] py-[1.2vh]">
              <p className="font-body text-[1.4vw] text-primary font-medium">"Book me a quiet desk at The Hub for 3 hours"</p>
            </div>
          </div>

          <div className="bg-[#F5A623]/8 border border-primary/30 rounded-[2vw] px-[3vw] py-[3.5vh] flex flex-col">
            <div className="mb-[2vh]">
              <span className="font-display text-[5vw] font-black text-primary/30 leading-none">02</span>
            </div>
            <h3 className="font-display text-[2vw] font-bold text-text mb-[2vh]">Pay — Any Way You Want</h3>
            <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-relaxed flex-1">
              Pay in Naira via Paystack or with USDC. JaIre exchanges NGN to USDC from its vault and locks the amount in a Solana escrow.
            </p>
            <div className="mt-[2vh] flex gap-[1vw]">
              <span className="bg-[#0C0D11] border border-[#2A2D3A] rounded-[0.6vw] px-[1.2vw] py-[0.8vh] font-body text-[1.4vw] text-muted">Paystack NGN</span>
              <span className="bg-[#0C0D11] border border-[#2A2D3A] rounded-[0.6vw] px-[1.2vw] py-[0.8vh] font-body text-[1.4vw] text-muted">USDC wallet</span>
            </div>
          </div>

          <div className="bg-[#161820] border border-[#2A2D3A] rounded-[2vw] px-[3vw] py-[3.5vh] flex flex-col">
            <div className="mb-[2vh]">
              <span className="font-display text-[5vw] font-black text-primary/20 leading-none">03</span>
            </div>
            <h3 className="font-display text-[2vw] font-bold text-text mb-[2vh]">Check In. Pay Per Second.</h3>
            <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-relaxed flex-1">
              Scan the QR code to start the clock. Leave when you want. On checkout, you pay only for time used — 85% goes to the workspace, 15% to JaIre. On-chain.
            </p>
            <div className="mt-[2vh] bg-[#0C0D11] rounded-[1vw] px-[1.5vw] py-[1.2vh]">
              <p className="font-body text-[1.4vw] text-muted font-mono">JAIRE|SETTLE|<span className="text-primary">85PCT</span></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
