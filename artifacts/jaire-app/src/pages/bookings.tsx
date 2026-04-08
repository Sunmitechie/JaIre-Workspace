import { Link } from "wouter";
import { useListBookings } from "@workspace/api-client-react";
import { formatNGN, formatUSDC } from "@/lib/currency";
import { Calendar, Clock, MapPin, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

export default function Bookings() {
  const { data: bookings, isLoading } = useListBookings();

  return (
    <div className="container py-12 px-4 md:px-6 max-w-5xl mx-auto">
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight mb-2">Your Bookings</h1>
        <p className="text-muted-foreground text-lg">Session history and receipts.</p>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)
        ) : bookings?.length === 0 ? (
          <div className="py-24 text-center border border-dashed rounded-3xl bg-muted/20">
            <h3 className="text-xl font-bold mb-2">No bookings yet</h3>
            <p className="text-muted-foreground mb-6">You haven't booked any workspaces.</p>
            <Link href="/workspaces" className="text-primary hover:underline font-medium">Browse Workspaces &rarr;</Link>
          </div>
        ) : (
          bookings?.map((booking) => (
            <div key={booking.id} className="bg-card rounded-2xl border border-border p-6 flex flex-col md:flex-row md:items-center gap-6 hover:border-primary/30 transition-colors">
              <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center shrink-0">
                <MapPin className="w-8 h-8 text-muted-foreground" />
              </div>
              
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-xl font-bold">{booking.workspace_name}</h3>
                  <Badge variant={booking.status === 'active' ? 'default' : 'secondary'} className="uppercase text-[10px] tracking-wider">
                    {booking.status}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    <span>{booking.check_in_time ? format(new Date(booking.check_in_time), 'MMM d, yyyy') : 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    <span>
                      {Math.round((booking.actual_duration_seconds || 0) / 60)} mins
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between md:flex-col md:items-end gap-4 border-t md:border-t-0 border-border pt-4 md:pt-0">
                <div className="text-left md:text-right">
                  <div className="text-lg font-bold text-foreground">
                    {formatUSDC(booking.billed_amount_usdc || 0)}
                  </div>
                  <div className="text-xs font-mono text-muted-foreground">
                    {formatNGN(booking.ngn_amount_paid || 0)}
                  </div>
                </div>
                
                {booking.status === 'active' && (
                  <Link href={`/session/${booking.id}`}>
                    <Button size="sm" variant="secondary" className="gap-2">
                      Live Session <ArrowRight className="w-3 h-3" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
