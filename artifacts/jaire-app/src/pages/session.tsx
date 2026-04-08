import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useGetBookingStatus, useCheckoutBooking, useGetBooking } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { formatNGN, formatUSDC } from "@/lib/currency";
import { LogOut, Activity, MapPin } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function Session() {
  const [, params] = useRoute("/session/:bookingId");
  const bookingId = params?.bookingId || "";
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: booking, isLoading: isBookingLoading } = useGetBooking(bookingId, { query: { enabled: !!bookingId } });
  
  // Poll every 2 seconds
  const { data: status } = useGetBookingStatus(bookingId, { 
    query: { 
      enabled: !!bookingId && booking?.status === 'active',
      refetchInterval: 2000
    } 
  });

  const checkout = useCheckoutBooking();

  const handleCheckout = () => {
    checkout.mutate(
      { bookingId },
      {
        onSuccess: () => {
          toast.success("Checked out successfully", {
            description: "Remaining escrow has been refunded."
          });
          queryClient.invalidateQueries();
          setLocation(`/bookings`);
        },
        onError: () => {
          toast.error("Checkout failed");
        }
      }
    );
  };

  if (isBookingLoading || !booking) {
    return <div className="flex-1 flex items-center justify-center"><Skeleton className="h-96 w-[500px] rounded-3xl" /></div>;
  }

  const isCompleted = booking.status === 'completed';
  const displayUSDC = isCompleted ? booking.billed_amount_usdc : (status?.current_cost_usdc || 0);
  const displayNGN = isCompleted ? booking.ngn_amount_paid : (status?.current_cost_ngn || 0);
  const displayTime = isCompleted ? "Completed" : (status?.elapsed_display || "00:00:00");
  const progress = isCompleted ? 100 : Math.min(100, ((status?.elapsed_seconds || 0) / (status?.planned_seconds || 1)) * 100);

  return (
    <div className="flex-1 flex items-center justify-center bg-muted/20 p-4">
      <div className="w-full max-w-lg bg-card rounded-3xl border border-border shadow-2xl overflow-hidden relative">
        {/* Animated background pulse for active sessions */}
        {!isCompleted && (
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-accent to-primary animate-[pulse_2s_ease-in-out_infinite]" />
        )}
        
        <div className="p-8 text-center border-b border-border/50">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-6">
            {isCompleted ? <MapPin className="w-8 h-8" /> : <Activity className="w-8 h-8 animate-pulse" />}
          </div>
          
          <h2 className="text-xl font-bold mb-1">{booking.workspace_name}</h2>
          <div className="text-sm font-medium text-muted-foreground uppercase tracking-widest mb-8">
            {isCompleted ? "Session Ended" : "Live Session"}
          </div>

          <div className="font-mono text-7xl font-bold tracking-tighter text-foreground mb-8">
            {displayTime}
          </div>

          <div className="flex flex-col items-center justify-center bg-background rounded-2xl p-6 border border-border">
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {isCompleted ? "Total Billed" : "Current Cost"}
            </div>
            <div className="text-4xl font-bold text-primary mb-1">{formatUSDC(displayUSDC || 0)}</div>
            <div className="text-lg font-mono text-muted-foreground">{formatNGN(displayNGN || 0)}</div>
          </div>
        </div>

        <div className="p-8 bg-muted/30">
          {!isCompleted && (
            <div className="mb-8">
              <div className="flex justify-between text-sm mb-2 font-medium">
                <span>Escrow consumed</span>
                <span className="font-mono">{progress.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-background rounded-full overflow-hidden border border-border">
                <div 
                  className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-1000 ease-linear" 
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>$0.00</span>
                <span>{formatUSDC(booking.escrow_amount_usdc)} (Limit)</span>
              </div>
            </div>
          )}

          {!isCompleted ? (
            <Button 
              size="lg" 
              variant="destructive" 
              className="w-full h-14 text-lg font-bold group"
              onClick={handleCheckout}
              disabled={checkout.isPending}
            >
              <LogOut className="w-5 h-5 mr-2 group-hover:-translate-x-1 transition-transform" />
              {checkout.isPending ? "Checking out..." : "Checkout & Refund"}
            </Button>
          ) : (
            <Link href="/bookings">
              <Button size="lg" className="w-full h-14 text-lg">
                View History
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
