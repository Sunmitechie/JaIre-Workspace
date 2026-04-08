import { useRoute, Link } from "wouter";
import { useGetWorkspace, useGetWorkspaceAvailability } from "@workspace/api-client-react";
import { formatNGN } from "@/lib/currency";
import { MapPin, Users, Check, ArrowLeft, Clock, Calendar as CalendarIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import { useState } from "react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export default function WorkspaceDetail() {
  const [, params] = useRoute("/workspaces/:id");
  const id = params?.id || "";
  const [date, setDate] = useState<Date>(new Date());

  const { data: ws, isLoading } = useGetWorkspace(id);
  const { data: availability, isLoading: isAvailabilityLoading } = useGetWorkspaceAvailability(
    id,
    { date: format(date, "yyyy-MM-dd") },
    { query: { enabled: !!id } }
  );

  if (isLoading) {
    return (
      <div className="container py-12 px-4">
        <Skeleton className="h-8 w-32 mb-8" />
        <Skeleton className="h-80 w-full rounded-3xl mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="col-span-2 space-y-4">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-32 w-full" />
          </div>
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  if (!ws) return <div className="container py-24 text-center text-muted-foreground">Workspace not found</div>;

  return (
    <div className="container py-12 px-4 md:px-6">
      <Link href="/workspaces" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to workspaces
      </Link>

      <div className="aspect-[21/8] relative rounded-3xl overflow-hidden mb-12 border border-white/8">
        <img
          src={ws.image_url || '/src/assets/the-hub.png'}
          alt={ws.name}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <div className="flex gap-2 mb-3">
              <span
                className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm"
                style={{ background: "rgba(255,170,0,0.15)", color: "#FFAA00", border: "1px solid rgba(255,170,0,0.3)" }}
              >
                {(ws.workspace_type ?? 'hot_desk').replace('_', ' ')}
              </span>
              {ws.is_available && (
                <span
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm"
                  style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }}
                >
                  Available
                </span>
              )}
            </div>
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-2">{ws.name}</h1>
            <div className="flex items-center gap-2 text-white/70 text-lg">
              <MapPin className="w-5 h-5" />
              Floor {ws.floor}, Lagos Tech Hub
            </div>
          </div>
          <div
            className="p-5 rounded-2xl text-right"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,170,0,0.2)" }}
          >
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Rate</div>
            <div className="text-3xl font-bold text-primary">{formatNGN(ws.hourly_rate_ngn)}<span className="text-base font-normal text-muted-foreground">/hr</span></div>
            <div className="text-xs text-muted-foreground mt-1">Billed by the second</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="col-span-2 space-y-12">
          <section>
            <h2 className="text-2xl font-bold mb-4">About this space</h2>
            <p className="text-lg text-muted-foreground leading-relaxed">{ws.description}</p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-6">Amenities</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(56,189,248,0.1)" }}>
                  <Users className="w-4 h-4" style={{ color: "hsl(199 93% 60%)" }} />
                </div>
                <span className="font-medium">Up to {ws.capacity} people</span>
              </div>
              {ws.amenities?.map((amenity: string) => (
                <div
                  key={amenity}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,170,0,0.1)" }}>
                    <Check className="w-4 h-4 text-primary" />
                  </div>
                  <span className="font-medium capitalize">{amenity.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="col-span-1">
          <div
            className="rounded-2xl p-6 sticky top-24"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <h3 className="text-lg font-bold mb-5">Check Availability</h3>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="w-full h-11 px-4 rounded-xl flex items-center gap-2 text-sm font-medium mb-5 text-left transition-colors hover:bg-white/8"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  <CalendarIcon className="w-4 h-4 text-primary shrink-0" />
                  {format(date, "MMMM d, yyyy")}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} initialFocus />
              </PopoverContent>
            </Popover>

            <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
              {isAvailabilityLoading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)
              ) : !availability?.length ? (
                <div className="text-center py-6 text-sm text-muted-foreground">No slots for this date</div>
              ) : (
                availability.map((slot: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-3 rounded-xl"
                    style={
                      slot.is_available
                        ? { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }
                        : { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", opacity: 0.5 }
                    }
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-mono font-medium">
                        {slot.start_time?.substring(0, 5)} – {slot.end_time?.substring(0, 5)}
                      </span>
                    </div>
                    <span
                      className={cn("text-[11px] font-bold uppercase tracking-wider", slot.is_available ? "text-emerald-400" : "text-muted-foreground")}
                    >
                      {slot.is_available ? "Free" : "Booked"}
                    </span>
                  </div>
                ))
              )}
            </div>

            <Link href={`/book/${ws.id}`}>
              <button
                className="w-full h-14 rounded-xl text-base font-bold transition-all hover:scale-[1.01] hover:opacity-95"
                style={{
                  background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                  color: "hsl(220 40% 5%)",
                  boxShadow: "0 8px 24px rgba(255,170,0,0.2)",
                }}
              >
                Book This Space
              </button>
            </Link>
            <p className="text-[11px] text-center text-muted-foreground mt-3">
              Only charged for the exact seconds you use.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
