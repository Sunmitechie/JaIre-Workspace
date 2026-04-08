import { useState } from "react";
import { Link } from "wouter";
import { useListWorkspaces } from "@workspace/api-client-react";
import { formatNGN } from "@/lib/currency";
import { MapPin, Users, Wifi, Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Workspaces() {
  const [search, setSearch] = useState("");
  const { data: workspaces, isLoading } = useListWorkspaces();

  const filtered = workspaces?.filter(
    (ws) =>
      ws.name.toLowerCase().includes(search.toLowerCase()) ||
      ws.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="container py-12 px-4 md:px-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
        <div>
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-widest mb-4"
            style={{ background: "rgba(255,170,0,0.08)", color: "#FFAA00", border: "1px solid rgba(255,170,0,0.2)" }}
          >
            <MapPin className="w-3 h-3" /> Lagos
          </div>
          <h1 className="text-5xl font-bold tracking-tight mb-2">Workspaces</h1>
          <p className="text-muted-foreground text-lg">Find your perfect environment.</p>
        </div>

        <div className="relative w-full md:w-80">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            placeholder="Search spaces..."
            className="w-full h-12 pl-11 pr-4 rounded-xl bg-white/5 border border-white/10 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 focus:bg-white/8 transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[420px] w-full rounded-3xl" />
            ))
          : filtered?.length === 0
          ? (
            <div className="col-span-2 py-24 text-center">
              <Search className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-xl font-bold mb-2">No spaces found</h3>
              <p className="text-muted-foreground">Try a different search term.</p>
            </div>
          )
          : filtered?.map((ws) => (
              <Link key={ws.id} href={`/workspaces/${ws.id}`} className="group block">
                <div
                  className="rounded-3xl overflow-hidden flex flex-col transition-all duration-300 hover:scale-[1.01] hover:-translate-y-0.5"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <div className="aspect-[16/9] relative overflow-hidden">
                    <img
                      src={ws.image_url || '/src/assets/the-hub.png'}
                      alt={ws.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <div className="absolute top-4 left-4 right-4 flex gap-2">
                      <span
                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm"
                        style={{ background: "rgba(255,170,0,0.15)", color: "#FFAA00", border: "1px solid rgba(255,170,0,0.3)" }}
                      >
                        {(ws.workspace_type ?? 'hot_desk').replace('_', ' ')}
                      </span>
                      {ws.is_available ? (
                        <span
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm"
                          style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }}
                        >
                          Available
                        </span>
                      ) : (
                        <span
                          className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm"
                          style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.12)" }}
                        >
                          Occupied
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-7">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h2 className="text-2xl font-bold mb-1">{ws.name}</h2>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5" />
                          Floor {ws.floor}, Lagos Tech Hub
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-primary">{formatNGN(ws.hourly_rate_ngn)}</div>
                        <div className="text-xs text-muted-foreground">per hour</div>
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground leading-relaxed mb-5 line-clamp-2">{ws.description}</p>

                    <div className="flex items-center gap-4 text-sm text-muted-foreground border-t border-white/6 pt-5">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-4 h-4" />
                        <span>Up to {ws.capacity}</span>
                      </div>
                      {ws.amenities?.slice(0, 2).map((a: string) => (
                        <div key={a} className="flex items-center gap-1.5">
                          <Wifi className="w-4 h-4" />
                          <span className="capitalize">{a.replace('_', ' ')}</span>
                        </div>
                      ))}
                      <div
                        className="ml-auto px-4 py-1.5 rounded-lg text-xs font-semibold transition-all group-hover:scale-[1.03]"
                        style={{
                          background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                          color: "hsl(220 40% 5%)",
                        }}
                      >
                        Book Now →
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
      </div>
    </div>
  );
}
