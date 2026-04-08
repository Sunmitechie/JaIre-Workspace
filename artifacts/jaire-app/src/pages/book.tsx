import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useGetWorkspace, useCreateBooking, useGetWalletBalance } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { formatNGN, formatUSDC } from "@/lib/currency";
import { ArrowLeft, Clock, Wallet, CreditCard, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";

export default function BookWorkspace() {
  const [, params] = useRoute("/book/:workspaceId");
  const workspaceId = params?.workspaceId || "";
  const [, setLocation] = useLocation();

  const [hours, setHours] = useState([2]);
  const [paymentMethod, setPaymentMethod] = useState<"wallet_usdc" | "paystack_ngn">("wallet_usdc");

  const { data: ws, isLoading: isWsLoading } = useGetWorkspace(workspaceId, { query: { enabled: !!workspaceId } });
  const { data: wallet } = useGetWalletBalance();
  const createBooking = useCreateBooking();

  const handleBook = () => {
    if (!ws) return;
    
    // Estimate cost
    const estimatedUSDC = ws.hourly_rate_usdc * hours[0];
    
    if (paymentMethod === "wallet_usdc" && (!wallet || wallet.balance_usdc < estimatedUSDC)) {
      toast.error("Insufficient USDC balance", {
        description: "Please fund your wallet or use NGN payment."
      });
      return;
    }

    createBooking.mutate({
      data: {
        workspace_id: workspaceId,
        planned_duration_hours: hours[0],
        payment_method: paymentMethod
      }
    }, {
      onSuccess: (booking) => {
        toast.success("Booking confirmed!");
        setLocation(`/session/${booking.id}`);
      },
      onError: () => {
        toast.error("Failed to create booking");
      }
    });
  };

  if (isWsLoading) {
    return <div className="container max-w-3xl py-12 px-4"><Skeleton className="h-[600px] w-full rounded-2xl" /></div>;
  }

  if (!ws) {
    return <div className="container py-24 text-center">Workspace not found</div>;
  }

  const estimatedUSDC = ws.hourly_rate_usdc * hours[0];
  const estimatedNGN = ws.hourly_rate_ngn * hours[0];

  return (
    <div className="container max-w-3xl py-12 px-4 md:px-6">
      <Link href={`/workspaces/${workspaceId}`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to details
      </Link>

      <div className="bg-card rounded-3xl border border-border overflow-hidden">
        <div className="p-8 border-b border-border bg-muted/30">
          <div className="flex items-center gap-6 mb-6">
            <div className="w-24 h-24 rounded-xl overflow-hidden shrink-0">
              <img src={ws.image_url || '/src/assets/the-hub.png'} alt={ws.name} className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-2xl font-bold mb-1">{ws.name}</h1>
              <p className="text-muted-foreground">Floor {ws.floor}</p>
            </div>
          </div>
          
          <div className="bg-background rounded-xl p-4 border border-border flex justify-between items-center">
            <div className="text-muted-foreground text-sm font-medium uppercase tracking-wide">Hourly Rate</div>
            <div className="text-right">
              <div className="font-bold text-primary">{formatUSDC(ws.hourly_rate_usdc)}</div>
              <div className="text-sm font-mono text-muted-foreground">{formatNGN(ws.hourly_rate_ngn)}</div>
            </div>
          </div>
        </div>

        <div className="p-8 space-y-10">
          <section>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Planned Duration
              </h3>
              <div className="font-mono text-xl font-bold bg-secondary px-3 py-1 rounded-md">{hours[0]} Hours</div>
            </div>
            
            <Slider
              value={hours}
              onValueChange={setHours}
              max={12}
              min={1}
              step={1}
              className="mb-8"
            />
            <p className="text-sm text-muted-foreground">
              We'll escrow funds for the planned duration, but you'll only be billed for the exact seconds you use when you check out.
            </p>
          </section>

          <section>
            <h3 className="text-lg font-bold mb-6">Payment Method</h3>
            <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)} className="gap-4">
              <div className="relative">
                <RadioGroupItem value="wallet_usdc" id="wallet_usdc" className="peer sr-only" />
                <Label
                  htmlFor="wallet_usdc"
                  className="flex items-center justify-between p-4 border-2 rounded-xl cursor-pointer bg-background hover:bg-secondary/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent shrink-0">
                      <Wallet className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold">USDC Web3 Wallet</div>
                      <div className="text-sm text-muted-foreground">Pay with connected wallet</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm">{wallet ? formatUSDC(wallet.balance_usdc) : "Not connected"}</div>
                    <div className="text-xs text-muted-foreground">Balance</div>
                  </div>
                </Label>
              </div>

              <div className="relative">
                <RadioGroupItem value="paystack_ngn" id="paystack_ngn" className="peer sr-only" />
                <Label
                  htmlFor="paystack_ngn"
                  className="flex items-center justify-between p-4 border-2 rounded-xl cursor-pointer bg-background hover:bg-secondary/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#09A5DB]/20 flex items-center justify-center text-[#09A5DB] shrink-0">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold">Paystack NGN</div>
                      <div className="text-sm text-muted-foreground">Local card payment</div>
                    </div>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </section>

          <div className="pt-6 border-t border-border">
            <div className="flex justify-between items-end mb-6">
              <div>
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-1">Escrow Amount</div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="w-4 h-4 text-primary" /> Secure smart contract
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-foreground mb-1">{formatUSDC(estimatedUSDC)}</div>
                <div className="font-mono text-muted-foreground">{formatNGN(estimatedNGN)}</div>
              </div>
            </div>

            <Button 
              size="lg" 
              className="w-full h-14 text-lg" 
              onClick={handleBook}
              disabled={createBooking.isPending}
            >
              {createBooking.isPending ? "Processing..." : "Start Session & Lock Escrow"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
