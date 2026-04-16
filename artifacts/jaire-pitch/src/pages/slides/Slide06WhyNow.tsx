export default function Slide06WhyNow() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0C0D11]">
      <div className="absolute top-0 left-0 right-0 h-[1vh] bg-primary" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_#F5A623_0%,_transparent_50%)] opacity-[0.04]" />

      <div className="relative z-10 flex flex-col h-full px-[8vw] py-[7vh]">
        <div className="mb-[4vh]">
          <p className="font-body text-[1.5vw] text-primary font-semibold tracking-widest uppercase mb-[1vh]">Why Now</p>
          <h2 className="font-display text-[4vw] font-black text-text tracking-tight">Three forces converging — right now.</h2>
        </div>

        <div className="grid grid-cols-3 gap-[2.5vw] flex-1">
          <div className="flex flex-col">
            <div className="h-[0.6vh] bg-primary rounded-full mb-[3vh]" />
            <h3 className="font-display text-[2vw] font-bold text-primary mb-[2vh]">Solana's Speed</h3>
            <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-relaxed mb-[2vh]">
              65,000 TPS. Transactions at $0.00025. Sub-second finality. Per-second billing was physically impossible two years ago.
            </p>
            <p className="font-display text-[2.8vw] font-black text-text mt-auto">$0.00025</p>
            <p className="font-body text-[1.5vw] text-muted">per Solana transaction</p>
          </div>

          <div className="flex flex-col">
            <div className="h-[0.6vh] bg-[#2A2D3A] rounded-full mb-[3vh]" />
            <h3 className="font-display text-[2vw] font-bold text-primary mb-[2vh]">MPC Wallets</h3>
            <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-relaxed mb-[2vh]">
              Web3Auth MPC Core Kit eliminates seed phrases. Users sign up with Google — get a Solana wallet invisibly. Crypto adoption just lost its biggest barrier.
            </p>
            <p className="font-display text-[2.8vw] font-black text-text mt-auto">0 clicks</p>
            <p className="font-body text-[1.5vw] text-muted">to get a Solana wallet as a user</p>
          </div>

          <div className="flex flex-col">
            <div className="h-[0.6vh] bg-[#2A2D3A] rounded-full mb-[3vh]" />
            <h3 className="font-display text-[2vw] font-bold text-primary mb-[2vh]">Africa's Crypto Moment</h3>
            <p className="font-body text-[1.6vw] text-[#A8ABBE] leading-relaxed mb-[2vh]">
              Nigeria is #2 globally in crypto adoption. The gig economy is booming. Remote workers need flexible space — by the hour, not the month.
            </p>
            <p className="font-display text-[2.8vw] font-black text-text mt-auto">35M+</p>
            <p className="font-body text-[1.5vw] text-muted">crypto users in West Africa</p>
          </div>
        </div>
      </div>
    </div>
  );
}
