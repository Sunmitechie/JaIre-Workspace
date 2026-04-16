export default function Slide08Traction() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#0C0D11]">
      <div className="absolute left-[8vw] top-0 bottom-0 w-[0.15vw] bg-[#2A2D3A]" />

      <div className="relative z-10 flex flex-col h-full px-[8vw] py-[7vh]">
        <div className="mb-[4vh] pl-[0vw]">
          <p className="font-body text-[1.5vw] text-primary font-semibold tracking-widest uppercase mb-[1vh]">Traction</p>
          <h2 className="font-display text-[4vw] font-black text-text tracking-tight">Built in weeks. Ready to scale.</h2>
        </div>

        <div className="grid grid-cols-2 gap-[4vw] flex-1">
          <div className="flex flex-col gap-[2.5vh]">
            <div className="flex items-start gap-[2vw]">
              <div className="flex flex-col items-center">
                <div className="w-[1.2vw] h-[1.2vw] rounded-full bg-primary mt-[0.4vh]" />
                <div className="w-[0.15vw] bg-[#2A2D3A] flex-1 mt-[0.5vh]" />
              </div>
              <div>
                <p className="font-display text-[1.8vw] font-bold text-text">Live Platform</p>
                <p className="font-body text-[1.5vw] text-muted">Full-stack deployed on Solana devnet. QR check-in, escrow, per-second billing all functional.</p>
              </div>
            </div>
            <div className="flex items-start gap-[2vw]">
              <div className="flex flex-col items-center">
                <div className="w-[1.2vw] h-[1.2vw] rounded-full bg-primary mt-[0.4vh]" />
                <div className="w-[0.15vw] bg-[#2A2D3A] flex-1 mt-[0.5vh]" />
              </div>
              <div>
                <p className="font-display text-[1.8vw] font-bold text-text">Baire + Jaie AI Agents</p>
                <p className="font-body text-[1.5vw] text-muted">GPT-4o voice agents for users and org dashboards. Streaming. Fully integrated.</p>
              </div>
            </div>
            <div className="flex items-start gap-[2vw]">
              <div className="flex flex-col items-center">
                <div className="w-[1.2vw] h-[1.2vw] rounded-full bg-primary mt-[0.4vh]" />
              </div>
              <div>
                <p className="font-display text-[1.8vw] font-bold text-text">Paystack Fiat Bridge</p>
                <p className="font-body text-[1.5vw] text-muted">NGN payments exchanged to USDC from JaIre's vault. Live with real Paystack API.</p>
              </div>
            </div>
          </div>

          <div className="bg-[#161820] border border-[#2A2D3A] rounded-[2vw] px-[3vw] py-[3.5vh] flex flex-col justify-between">
            <div>
              <p className="font-display text-[1.8vw] font-bold text-primary mb-[3vh]">6-Month Roadmap</p>
              <div className="space-y-[2vh]">
                <div className="flex items-center gap-[1.5vw]">
                  <span className="w-[0.8vw] h-[0.8vw] rounded-full bg-primary shrink-0" />
                  <p className="font-body text-[1.5vw] text-text">Pilot with 3 Lagos workspace operators</p>
                </div>
                <div className="flex items-center gap-[1.5vw]">
                  <span className="w-[0.8vw] h-[0.8vw] rounded-full bg-[#2A2D3A] border border-primary/40 shrink-0" />
                  <p className="font-body text-[1.5vw] text-[#A8ABBE]">Mainnet migration — real USDC settlements</p>
                </div>
                <div className="flex items-center gap-[1.5vw]">
                  <span className="w-[0.8vw] h-[0.8vw] rounded-full bg-[#2A2D3A] border border-[#3A3D4A] shrink-0" />
                  <p className="font-body text-[1.5vw] text-[#A8ABBE]">KYC-verified org marketplace (10+ orgs)</p>
                </div>
                <div className="flex items-center gap-[1.5vw]">
                  <span className="w-[0.8vw] h-[0.8vw] rounded-full bg-[#2A2D3A] border border-[#3A3D4A] shrink-0" />
                  <p className="font-body text-[1.5vw] text-[#A8ABBE]">Expand to Accra and Nairobi</p>
                </div>
              </div>
            </div>
            <div className="border-t border-[#2A2D3A] pt-[2vh]">
              <p className="font-body text-[1.5vw] text-muted">Target: 500 active monthly bookings by Month 6</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
