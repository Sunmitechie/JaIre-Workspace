export default function Slide03Market() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0C0D11]">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#F5A623_0%,_transparent_55%)] opacity-[0.05]" />

      <div className="relative z-10 flex flex-col h-full px-[8vw] py-[7vh]">
        <div className="mb-[2vh]">
          <p className="font-body text-[1.5vw] text-primary font-semibold tracking-widest uppercase mb-[1vh]">Market Opportunity</p>
          <h2 className="font-display text-[3.8vw] font-black text-text tracking-tight">A massive market at the perfect intersection.</h2>
        </div>

        <div className="flex items-center gap-[6vw] flex-1">
          <div className="flex flex-col justify-center">
            <p className="font-display text-[11vw] font-black text-primary leading-none tracking-tighter">$47.5B</p>
            <p className="font-body text-[1.8vw] text-[#A8ABBE] mt-[1vh] font-medium">Global flex workspace market by 2030</p>
            <p className="font-body text-[1.5vw] text-muted mt-[0.8vh]">CAGR 17.7% — JLL Research 2024</p>
          </div>

          <div className="flex flex-col gap-[2vh] flex-1">
            <div className="bg-[#161820] border border-[#2A2D3A] rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
              <div className="flex items-baseline gap-[1.5vw]">
                <p className="font-display text-[3.2vw] font-black text-primary">$47.5B</p>
                <p className="font-body text-[1.5vw] text-muted font-medium">TAM</p>
              </div>
              <p className="font-body text-[1.5vw] text-[#A8ABBE] mt-[0.5vh]">Global flex workspace market</p>
            </div>
            <div className="bg-[#161820] border border-primary/30 rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
              <div className="flex items-baseline gap-[1.5vw]">
                <p className="font-display text-[3.2vw] font-black text-primary">$3.8B</p>
                <p className="font-body text-[1.5vw] text-muted font-medium">SAM</p>
              </div>
              <p className="font-body text-[1.5vw] text-[#A8ABBE] mt-[0.5vh]">Africa flex workspace + crypto-enabled payments</p>
            </div>
            <div className="bg-[#F5A623]/10 border border-primary/40 rounded-[1.5vw] px-[2.5vw] py-[2.5vh]">
              <div className="flex items-baseline gap-[1.5vw]">
                <p className="font-display text-[3.2vw] font-black text-primary">$380M</p>
                <p className="font-body text-[1.5vw] text-muted font-medium">SOM</p>
              </div>
              <p className="font-body text-[1.5vw] text-[#A8ABBE] mt-[0.5vh]">Nigeria + West Africa, Year 3 target</p>
            </div>
          </div>
        </div>

        <div className="flex gap-[4vw] border-t border-[#2A2D3A] pt-[2.5vh]">
          <p className="font-body text-[1.5vw] text-muted">35M+ crypto users in West Africa</p>
          <span className="text-muted">·</span>
          <p className="font-body text-[1.5vw] text-muted">$320B annual remittances to Africa</p>
          <span className="text-muted">·</span>
          <p className="font-body text-[1.5vw] text-muted">200M+ population in Nigeria alone</p>
        </div>
      </div>
    </div>
  );
}
