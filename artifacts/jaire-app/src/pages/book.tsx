import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useGetWorkspace, useCreateBooking } from "@workspace/api-client-react";
import { formatNGN } from "@/lib/currency";
import { getUser } from "@/lib/auth";
import { ArrowLeft, Clock, CreditCard, Minus, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export default function BookWorkspace() {
  const [, params] = useRoute("/book/:workspaceId");
  const workspaceId = params?.workspaceId || "";
  const [, setLocation] = useLocation();

  const [hours, setHours] = useState(2);
  const { data: ws, isLoading } = useGetWorkspace(workspaceId, { query: { enabled: !!workspaceId } });
  const createBooking = useCreateBooking();
  const user = getUser();

  const handleBook = () => {
    if (!ws) return;
    createBooking.mutate(
      {
        data: {
          workspace_id: workspaceId,
          planned_duration_hours: hours,
          payment_method: "paystack",
          user_email: user?.email,
          user_name: user?.name,
        },
      },
      {
        onSuccess: (booking) => {
          toast.success("Booking confirmed!");
          setLocation(`/session/${booking.id}`);
        },
        onError: () => toast.error("Failed to create booking. Please try again."),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="container max-w-2xl py-12 px-4">
        <Skeleton className="h-[520px] w-full rounded-3xl" />
      </div>
    );
  }

  if (!ws) {
    return <div className="container py-24 text-center text-muted-foreground">Workspace not found</div>;
  }

  const estimatedNGN = ws.hourly_rate_ngn * hours;

  return (
    <div className="container max-w-2xl py-12 px-4 md:px-6">
      <Link href={`/workspaces/${workspaceId}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to details
      </Link>

      <div
        className="rounded-3xl overflow-hidden"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)" }}
      >
        <div
          className="p-8 border-b"
          style={{ background: "rgba(255,170,0,0.04)", borderColor: "rgba(255,170,0,0.12)" }}
        >
          <div className="flex items-center gap-5 mb-6">
            <div className="w-20 h-20 rounded-2xl overflow-hidden shrink-0 border border-white/10">
              <img src={ws.image_url || '/src/assets/the-hub.png'} alt={ws.name} className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-2xl font-bold mb-1">{ws.name}</h1>
              <p className="text-muted-foreground text-sm">Floor {ws.floor} · Up to {ws.capacity} people</p>
            </div>
          </div>

          <div
            className="flex justify-between items-center px-5 py-4 rounded-xl"
            style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.15)" }}
          >
            <div className="text-sm font-medium text-muted-foreground">Hourly rate</div>
            <div className="text-xl font-bold text-primary">{formatNGN(ws.hourly_rate_ngn)}<span className="text-sm font-normal text-muted-foreground">/hr</span></div>
          </div>
        </div>

        <div className="p-8 space-y-8">
          <div>
            <h3 className="text-base font-bold mb-5 flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Duration
            </h3>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setHours(Math.max(1, hours - 1))}
                className="w-11 h-11 rounded-xl flex items-center justify-center transition-all hover:scale-105"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="flex-1 text-center">
                <div className="text-4xl font-bold">{hours}</div>
                <div className="text-sm text-muted-foreground">{hours === 1 ? "hour" : "hours"}</div>
              </div>
              <button
                onClick={() => setHours(Math.min(12, hours + 1))}
                className="w-11 h-11 rounded-xl flex items-center justify-center transition-all hover:scale-105"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 mt-4">
              {[1, 2, 3, 4].map((h) => (
                <button
                  key={h}
                  onClick={() => setHours(h)}
                  className="py-2 rounded-xl text-sm font-medium transition-all"
                  style={
                    hours === h
                      ? { background: "rgba(255,170,0,0.15)", border: "1px solid rgba(255,170,0,0.4)", color: "#FFAA00" }
                      : { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.6)" }
                  }
                >
                  {h}h
                </button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground mt-3 text-center">
              You'll only be charged for the exact time you stay — billed to the second.
            </p>
          </div>

          <div
            className="p-5 rounded-2xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-muted-foreground">{hours}h × {formatNGN(ws.hourly_rate_ngn)}</span>
              <span className="font-medium">{formatNGN(estimatedNGN)}</span>
            </div>
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <span>Security deposit</span>
              <span className="text-emerald-400">₦0 — none required</span>
            </div>
            <div className="mt-4 pt-4 border-t border-white/8 flex justify-between">
              <span className="font-bold">Max charge</span>
              <span className="font-bold text-primary text-lg">{formatNGN(estimatedNGN)}</span>
            </div>
          </div>

          <div>
            <h3 className="text-base font-bold mb-4 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              Payment
            </h3>
            <div
              className="flex items-center gap-4 px-5 py-4 rounded-xl cursor-pointer"
              style={{ background: "rgba(255,170,0,0.06)", border: "2px solid rgba(255,170,0,0.35)" }}
            >
              <div className="w-4 h-4 rounded-full border-2 border-primary flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-primary" />
              </div>
              <div>
                <div className="font-medium">Pay with Paystack</div>
                <div className="text-xs text-muted-foreground">Debit card, bank transfer, USSD</div>
              </div>
              <div className="ml-auto text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded-lg">NGN</div>
            </div>
          </div>

          <button
            className="w-full h-14 rounded-xl text-base font-bold flex items-center justify-center gap-2.5 transition-all hover:scale-[1.01] hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
              color: "hsl(220 40% 5%)",
              boxShadow: "0 8px 32px rgba(255,170,0,0.25)",
            }}
            onClick={handleBook}
            disabled={createBooking.isPending}
          >
            {createBooking.isPending ? "Processing..." : `Confirm — ${formatNGN(estimatedNGN)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
