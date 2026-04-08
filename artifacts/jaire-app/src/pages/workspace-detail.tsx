import { useRoute, Link } from "wouter";
import { useGetWorkspace, useGetWorkspaceAvailability } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { formatNGN, formatUSDC } from "@/lib/currency";
import { MapPin, Users, Check, ArrowLeft, Clock, Calendar as CalendarIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
    { date: format(date, 'yyyy-MM-dd') },
    { query: { enabled: !!id } }
  );

  if (isLoading) {
    return (
      <div className="container py-12 px-4">
        <Skeleton className="h-8 w-32 mb-8" />
        <Skeleton className="h-[400px] w-full rounded-2xl mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="col-span-2 space-y-4">
            <Skeleton className="h-12 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    );
  }

  if (!ws) {
    return <div className="container py-24 text-center">Workspace not found</div>;
  }

  return (
    <div className="container py-12 px-4 md:px-6">
      <Link href="/workspaces" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to workspaces
      </Link>

      <div className="aspect-[21/9] md:aspect-[21/7] relative rounded-3xl overflow-hidden mb-12 bg-muted border border-border">
        <img 
          src={ws.image_url || '/src/assets/the-hub.png'} 
          alt={ws.name}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/20 to-transparent" />
        <div className="absolute bottom-0 left-0 p-8 md:p-12 w-full flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <div className="flex gap-3 mb-4">
              <Badge variant="outline" className="bg-background/50 backdrop-blur-md uppercase tracking-wider border-white/20">
                {(ws.workspace_type ?? 'hot_desk').replace('_', ' ')}
              </Badge>
              {ws.is_available && (
                <Badge className="bg-primary/80 backdrop-blur-md text-primary-foreground border-none">
                  Available Now
                </Badge>
              )}
            </div>
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-2">{ws.name}</h1>
            <div className="flex items-center text-white/80 gap-2 text-lg">
              <MapPin className="w-5 h-5" />
              <span>Floor {ws.floor}, Lagos Tech Hub</span>
            </div>
          </div>
          <div className="bg-background/80 backdrop-blur-xl p-6 rounded-2xl border border-white/10 flex flex-col items-end">
            <div className="text-sm text-muted-foreground uppercase tracking-wider font-semibold mb-1">Rate</div>
            <div className="text-3xl font-bold text-primary mb-1">{formatUSDC(ws.hourly_rate_usdc)}<span className="text-lg font-normal text-muted-foreground">/hr</span></div>
            <div className="text-sm font-mono text-muted-foreground">{formatNGN(ws.hourly_rate_ngn)}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
        <div className="col-span-2 space-y-12">
          <section>
            <h2 className="text-2xl font-bold mb-4">About this space</h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {ws.description}
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-6">Amenities & Features</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-foreground" />
                </div>
                <span className="font-medium">Capacity: {ws.capacity} people</span>
              </div>
              {ws.amenities?.map((amenity: string, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                    <Check className="w-5 h-5 text-primary" />
                  </div>
                  <span className="font-medium capitalize">{amenity.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="col-span-1">
          <div className="bg-card rounded-2xl border border-border p-6 sticky top-24">
            <h3 className="text-xl font-bold mb-6">Availability</h3>
            
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full justify-start text-left font-normal mb-6",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <div className="space-y-3 mb-8 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {isAvailabilityLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
              ) : availability?.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">No slots available for this date</div>
              ) : (
                availability?.map((slot: any, i: number) => (
                  <div 
                    key={i} 
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border",
                      slot.is_available ? "bg-background border-border" : "bg-muted/50 border-transparent opacity-50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium">{slot.start_time.substring(0,5)} - {slot.end_time.substring(0,5)}</span>
                    </div>
                    {slot.is_available ? (
                      <span className="text-xs font-bold text-primary">Available</span>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">Booked</span>
                    )}
                  </div>
                ))
              )}
            </div>

            <Link href={`/book/${ws.id}`}>
              <Button size="lg" className="w-full text-lg h-14">
                Book Now
              </Button>
            </Link>
            <p className="text-xs text-center text-muted-foreground mt-4">
              You will only be billed for the exact seconds you use.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
