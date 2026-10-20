import { Link } from "wouter";
import { Users, Zap, ArrowRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import theHubImg from "@/assets/the-hub.png";
import foundersSuiteImg from "@/assets/founders-suite.png";
import blockchainLoungeImg from "@/assets/blockchain-lounge.png";
import boardRoomImg from "@/assets/board-room.png";

export interface Message {
  role: "user" | "baire";
  content: string;
  isStreaming?: boolean;
}

const WORKSPACES: Record<string, {
  name: string;
  image: string;
  description: string;
  hourlyRateNgn: number;
  capacity: number;
  amenities: string[];
}> = {
  "ws-001": {
    name: "The Hub — Open Floor", image: theHubImg,
    description: "Vibrant open coworking area with high-speed Wi-Fi, natural lighting, and a buzzing community of builders.",
    hourlyRateNgn: 1500, capacity: 40,
    amenities: ["High-speed Wi-Fi", "Power outlets", "Coffee bar", "Printing", "Lockers"],
  },
  "ws-002": {
    name: "Founders Suite — Private Office", image: foundersSuiteImg,
    description: "Fully equipped private office for focused deep work. Perfect for solo founders and small teams.",
    hourlyRateNgn: 3500, capacity: 4,
    amenities: ["Dedicated desk", "Meeting room access", "Wi-Fi", "Climate control", "Whiteboard"],
  },
  "ws-003": {
    name: "Blockchain Lounge — Crypto Corner", image: blockchainLoungeImg,
    description: "Our signature space for Web3 builders — multiple monitors, fast internet, and a community of on-chain natives.",
    hourlyRateNgn: 2500, capacity: 12,
    amenities: ["Dual monitors", "Ultra-fast Wi-Fi (1Gbps)", "Hardware wallet-friendly", "24/7 access", "Community Slack"],
  },
  "ws-004": {
    name: "Board Room — Premium Meeting", image: boardRoomImg,
    description: "Impress your clients and investors in our premium conference room with AV setup and whiteboard wall.",
    hourlyRateNgn: 8000, capacity: 12,
    amenities: ["Projector & screen", "Video conferencing", "Whiteboard wall", "Catering available", "Receptionist"],
  },
};

export function extractWorkspaceIds(text: string): string[] {
  const matches = [...text.matchAll(/\[\[WS:(ws-\d+)\]\]/gi)];
  return [...new Set(matches.map(match => match[1]!.toLowerCase()))];
}

export function stripWorkspaceTags(text: string): string {
  return text.replace(/\[\[WS:ws-\d+\]\]/gi, "").trim();
}

export function extractPaymentUrl(text: string): string | null {
  const match = text.match(/https?:\/\/(?:checkout\.)?paystack\.[^\s)>\"]+/i)
    ?? text.match(/https?:\/\/[^\s)>\"]*paystack[^\s)>\"]+/i);
  return match?.[0] ?? null;
}

export function extractSolanaExplorerUrl(text: string): string | null {
  const match = text.match(/https?:\/\/explorer\.solana\.com\/tx\/[^\s)>\"]+/i);
  return match?.[0] ?? null;
}

export function WorkspaceCard({ workspaceId }: { workspaceId: string }) {
  const workspace = WORKSPACES[workspaceId];
  if (!workspace) return null;
  return (
    <Link href="/workspaces">
      <div className="mt-3 rounded-2xl overflow-hidden cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.99] w-full max-w-xs" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div className="relative h-36 overflow-hidden">
          <img src={workspace.image} alt={workspace.name} className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)" }} />
          <div className="absolute bottom-2 left-3 right-3"><div className="text-white text-[13px] font-bold leading-tight">{workspace.name}</div></div>
        </div>
        <div className="px-3 py-2.5 space-y-2">
          <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{workspace.description}</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Users className="w-2.5 h-2.5" />{workspace.capacity} seats</div>
            <div className="text-primary font-bold text-[12px]">₦{workspace.hourlyRateNgn.toLocaleString()}<span className="font-normal text-[10px] text-muted-foreground">/hr</span></div>
          </div>
          <div className="flex flex-wrap gap-1">
            {workspace.amenities.slice(0, 3).map(amenity => <span key={amenity} className="px-1.5 py-0.5 rounded-full text-[9px] font-medium" style={{ background: "rgba(255,170,0,0.08)", color: "rgba(255,170,0,0.8)", border: "1px solid rgba(255,170,0,0.15)" }}>{amenity}</span>)}
            {workspace.amenities.length > 3 && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium" style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>+{workspace.amenities.length - 3} more</span>}
          </div>
          <div className={cn("flex items-center gap-1 text-[10px] font-semibold pt-0.5")} style={{ color: "rgba(255,170,0,0.9)" }}><Zap className="w-2.5 h-2.5" /> Book with Baire <ArrowRight className="w-2.5 h-2.5 ml-auto opacity-50" /></div>
        </div>
      </div>
    </Link>
  );
}

export function MessageLinks({ paymentUrl, explorerUrl }: { paymentUrl: string | null; explorerUrl: string | null }) {
  return (
    <>
      {paymentUrl && <a href={paymentUrl} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all hover:scale-[1.02] active:scale-95 w-fit" style={{ background: "linear-gradient(135deg, hsl(43 100% 50%), hsl(38 100% 44%))", color: "hsl(220 40% 5%)" }}><ExternalLink className="w-3.5 h-3.5" />Pay Now</a>}
      {explorerUrl && <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-semibold font-mono transition-all hover:scale-[1.02] active:scale-95 w-fit" style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", color: "#34d399" }}><ExternalLink className="w-3 h-3 shrink-0" />View on Solana Explorer</a>}
    </>
  );
}
