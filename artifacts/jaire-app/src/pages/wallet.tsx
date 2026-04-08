import { useState } from "react";
import { useGetWalletBalance, useFundWallet } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNGN, formatUSDC, ngnToUsdc } from "@/lib/currency";
import { Wallet, ArrowDownToLine, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function WalletPage() {
  const [fundAmount, setFundAmount] = useState("5000");
  const { data: wallet, isLoading } = useGetWalletBalance();
  const fundMutation = useFundWallet();
  const queryClient = useQueryClient();

  const handleFund = () => {
    const amount = Number(fundAmount);
    if (isNaN(amount) || amount <= 0) return;

    fundMutation.mutate(
      { data: { amount_ngn: amount, payment_method: "paystack" } },
      {
        onSuccess: (res) => {
          toast.success("Wallet funded successfully!", {
            description: `Added ${res.usdc_minted.toFixed(2)} USDC.`
          });
          queryClient.invalidateQueries();
          setFundAmount("");
        },
        onError: () => {
          toast.error("Failed to fund wallet");
        }
      }
    );
  };

  const copyAddress = () => {
    if (wallet?.public_key) {
      navigator.clipboard.writeText(wallet.public_key);
      toast.success("Address copied to clipboard");
    }
  };

  if (isLoading) {
    return <div className="container py-12 max-w-2xl"><Skeleton className="h-64 w-full rounded-3xl" /></div>;
  }

  if (!wallet?.connected) {
    return (
      <div className="container py-24 text-center max-w-md mx-auto">
        <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center mx-auto mb-6">
          <Wallet className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold mb-3">Wallet Not Connected</h2>
        <p className="text-muted-foreground mb-8">Please connect your wallet from the top navigation to access this page.</p>
      </div>
    );
  }

  return (
    <div className="container py-12 px-4 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Web3 Wallet</h1>

      <div className="bg-gradient-to-br from-primary/20 via-card to-card rounded-3xl p-8 border border-border/50 mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
          <ShieldCheck className="w-32 h-32 text-primary" />
        </div>
        
        <div className="relative z-10">
          <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Available Balance</div>
          <div className="text-5xl font-bold text-foreground mb-2 tracking-tighter">
            {formatUSDC(wallet.balance_usdc)}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono bg-background/50 px-2 py-1 rounded">Solana: {wallet.balance_sol.toFixed(4)} SOL</span>
          </div>

          <div className="mt-8 pt-6 border-t border-white/10 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground mb-1 uppercase">Address</div>
              <div className="font-mono text-sm">{wallet.public_key.slice(0, 8)}...{wallet.public_key.slice(-8)}</div>
            </div>
            <div className="flex gap-2">
              <Button size="icon" variant="secondary" onClick={copyAddress} className="rounded-xl">
                <Copy className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="secondary" className="rounded-xl">
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-3xl border border-border p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent">
            <ArrowDownToLine className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold">Fund with Paystack</h3>
            <p className="text-sm text-muted-foreground">Convert NGN to USDC instantly</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Amount (NGN)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-muted-foreground">₦</span>
              <Input 
                type="number" 
                className="pl-8 h-14 text-lg bg-background" 
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
              />
            </div>
          </div>
          
          <div className="bg-secondary/50 rounded-xl p-4 flex justify-between items-center">
            <span className="text-sm text-muted-foreground">You will receive approx.</span>
            <span className="font-bold text-accent font-mono">{formatUSDC(ngnToUsdc(Number(fundAmount) || 0))}</span>
          </div>

          <Button 
            className="w-full h-14 text-lg mt-4" 
            onClick={handleFund}
            disabled={fundMutation.isPending || !fundAmount || Number(fundAmount) <= 0}
          >
            {fundMutation.isPending ? "Processing..." : "Fund Wallet"}
          </Button>
        </div>
      </div>
    </div>
  );
}
