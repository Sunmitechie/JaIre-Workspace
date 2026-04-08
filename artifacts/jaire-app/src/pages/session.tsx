import { useRoute, useLocation, Link } from "wouter";
import { useGetBookingStatus, useCheckoutBooking, useGetBooking } from "@workspace/api-client-react";
import { formatNGN } from "@/lib/currency";
import { LogOut, Activity, MapPin, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export default function Session() {
  const [, params] = useRoute("/session/:bookingId");
  const bookingId = params?.bookingId || "";
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: booking, isLoading: isBookingLoading } = useGetBooking(bookingId, {
    query: { enabled: !!bookingId },
  });

  const { data: status } = useGetBookingStatus(bookingId, {
    query: {
      enabled: !!bookingId && booking?.status === "active",
      refetchInterval: 2000,
    },
  });

  const checkout = useCheckoutBooking();

  const handleCheckout = () => {
    checkout.mutate(
      { bookingId },
      {
        onSuccess: () => {
          toast.success("Checked out successfully!");
          queryClient.invalidateQueries();
          setLocation("/bookings");
        },
        onError: () => toast.error("Checkout failed. Please try again."),
      }
    );
  };

  if (isBookingLoading || !booking) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Skeleton className="h-96 w-[480px] rounded-3xl" />
      </div>
    );
  }

  const isCompleted = booking.status === "completed";
  const displayNGN = isCompleted
    ? (booking.ngn_amount_paid || 0)
    : (status?.current_cost_ngn || 0);
  const displayTime = isCompleted ? "Completed" : status?.elapsed_display || "00:00:00";
  const progress = isCompleted
    ? 100
    : Math.min(100, ((status?.elapsed_seconds || 0) / (status?.planned_seconds || 1)) * 100);
  const limitNGN = (booking.escrow_amount_usdc || 0) * 1600;

  return (
    <div className="flex-1 flex items-center justify-center p-4" style={{ background: "radial-gradient(ellipse at center, rgba(255,170,0,0.03) 0%, transparent 70%)" }}>
      <div
        className="w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)" }}
      >
        {!isCompleted && (
          <div
            className="h-1 transition-all duration-1000"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, hsl(43 100% 50%) 0%, hsl(262 83% 66%) 50%, hsl(199 93% 60%) 100%)",
            }}
          />
        )}

        <div className="p-8 text-center">
          <div
            className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 ${!isCompleted ? "pulse-ring" : ""}`}
            style={
              isCompleted
                ? { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }
                : { background: "rgba(255,170,0,0.12)", border: "1px solid rgba(255,170,0,0.3)" }
            }
          >
            {isCompleted ? (
              <MapPin className="w-7 h-7 text-muted-foreground" />
            ) : (
              <Activity className="w-7 h-7 text-primary animate-pulse" />
            )}
          </div>

          <h2 className="text-xl font-bold mb-1">{booking.workspace_name}</h2>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-8">
            {isCompleted ? "Session Ended" : "Live Session"}
          </div>

          <div className="font-mono text-7xl font-bold tracking-tighter mb-8 leading-none">
            {displayTime}
          </div>

          <div
            className="rounded-2xl p-6"
            style={{ background: "rgba(255,170,0,0.06)", border: "1px solid rgba(255,170,0,0.15)" }}
          >
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
              {isCompleted ? "Total Billed" : "Current Cost"}
            </div>
            <div className="text-4xl font-bold text-primary">
              {formatNGN(displayNGN)}
            </div>
            <div className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
              <Clock className="w-3 h-3" />
              Billed to the second
            </div>
          </div>
        </div>

        <div className="px-8 pb-8">
          {!isCompleted && (
            <div className="mb-6">
              <div className="flex justify-between text-xs font-medium text-muted-foreground mb-2">
                <span>Session usage</span>
                <span className="font-mono">{progress.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${progress}%`,
                    background: "linear-gradient(90deg, hsl(43 100% 50%) 0%, hsl(262 83% 66%) 100%)",
                  }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-[11px] text-muted-foreground">
                <span>₦0</span>
                <span>{formatNGN(limitNGN)} limit</span>
              </div>
            </div>
          )}

          {!isCompleted ? (
            <button
              className="w-full h-14 rounded-xl text-base font-semibold flex items-center justify-center gap-2.5 transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}
              onClick={handleCheckout}
              disabled={checkout.isPending}
            >
              <LogOut className="w-5 h-5" />
              {checkout.isPending ? "Checking out..." : "Check Out"}
            </button>
          ) : (
            <Link href="/bookings">
              <button
                className="w-full h-14 rounded-xl text-base font-semibold transition-all hover:opacity-90"
                style={{
                  background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                  color: "hsl(220 40% 5%)",
                }}
              >
                View Booking History
              </button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
