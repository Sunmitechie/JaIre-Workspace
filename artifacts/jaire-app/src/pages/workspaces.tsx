import { useState } from "react";
import { Link } from "wouter";
import { useListWorkspaces } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNGN, formatUSDC } from "@/lib/currency";
import { MapPin, Users, Wifi, Search, Filter } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Workspaces() {
  const [search, setSearch] = useState("");
  const { data: workspaces, isLoading } = useListWorkspaces();

  const filteredWorkspaces = workspaces?.filter(ws => 
    ws.name.toLowerCase().includes(search.toLowerCase()) || 
    ws.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="container py-12 px-4 md:px-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">Workspaces</h1>
          <p className="text-muted-foreground text-lg">Find your perfect environment in Lagos.</p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search spaces..." 
              className="pl-9 bg-card"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon" className="shrink-0 bg-card">
            <Filter className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-full rounded-2xl" />
          ))
        ) : filteredWorkspaces?.length === 0 ? (
          <div className="col-span-2 py-24 text-center">
            <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-bold mb-2">No workspaces found</h3>
            <p className="text-muted-foreground">Try adjusting your search terms.</p>
          </div>
        ) : (
          filteredWorkspaces?.map((ws) => (
            <div key={ws.id} className="bg-card rounded-2xl border border-border overflow-hidden flex flex-col group hover:border-primary/50 transition-colors">
              <div className="aspect-[16/9] relative overflow-hidden bg-muted">
                <img 
                  src={ws.image_url || '/src/assets/the-hub.png'} 
                  alt={ws.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute top-4 left-4 flex gap-2">
                  <Badge variant="secondary" className="bg-background/80 backdrop-blur-md uppercase tracking-wider text-xs">
                    {(ws.workspace_type ?? 'hot_desk').replace('_', ' ')}
                  </Badge>
                  {ws.is_available && (
                    <Badge className="bg-primary/90 text-primary-foreground backdrop-blur-md">
                      Available Now
                    </Badge>
                  )}
                </div>
              </div>
              <div className="p-6 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">{ws.name}</h2>
                    <div className="flex items-center text-sm text-muted-foreground gap-1">
                      <MapPin className="w-4 h-4" />
                      <span>Floor {ws.floor}, Lagos Hub</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-primary">{formatUSDC(ws.hourly_rate_usdc)}<span className="text-sm font-normal text-muted-foreground">/hr</span></div>
                    <div className="text-sm font-mono text-muted-foreground">{formatNGN(ws.hourly_rate_ngn)}</div>
                  </div>
                </div>

                <p className="text-muted-foreground mb-6 flex-1">
                  {ws.description}
                </p>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="flex items-center gap-2 text-sm">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span>Up to {ws.capacity} people</span>
                  </div>
                  {ws.amenities?.map((amenity: string, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <Wifi className="w-4 h-4 text-muted-foreground" />
                      <span className="capitalize">{amenity}</span>
                    </div>
                  ))}
                </div>

                <div className="pt-6 border-t border-border mt-auto">
                  <Link href={`/workspaces/${ws.id}`}>
                    <Button className="w-full" size="lg">
                      View Details
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
