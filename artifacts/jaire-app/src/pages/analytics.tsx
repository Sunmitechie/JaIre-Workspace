import { useGetAnalyticsDashboard, useGetActivityFeed, useGetRevenueAnalytics } from "@workspace/api-client-react";
import { formatNGN } from "@/lib/currency";
import { TrendingUp, Users, Activity, Building, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from "recharts";

const EXCHANGE_RATE = 1600;

export default function Analytics() {
  const { data: dashboard, isLoading } = useGetAnalyticsDashboard();
  const { data: activity } = useGetActivityFeed({ limit: 10 });
  const { data: revenueHistory } = useGetRevenueAnalytics({ days: 7 });

  if (isLoading || !dashboard) {
    return (
      <div className="container py-12 px-4 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  const revenueByDate: Record<string, number> = {};
  revenueHistory?.forEach((r) => {
    revenueByDate[r.date] = (revenueByDate[r.date] ?? 0) + r.revenue_usdc * EXCHANGE_RATE;
  });
  const revenueData = Object.entries(revenueByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue]) => ({
      date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      revenue: Math.round(revenue),
    }));

  const occupancyData = (dashboard.workspace_stats ?? []).map((stat: any) => ({
    name: (stat.workspace_name ?? stat.name ?? "").split(" ")[0],
    occupancy: Math.round((stat.occupancy_rate ?? 0) * 100),
  }));

  const stats = [
    {
      label: "Total Revenue",
      value: formatNGN(dashboard.total_revenue_usdc * EXCHANGE_RATE),
      sub: `${dashboard.total_sessions} sessions`,
      icon: TrendingUp,
      color: "rgba(255,170,0,",
    },
    {
      label: "Active Sessions",
      value: dashboard.active_sessions,
      sub: "Live right now",
      icon: Activity,
      color: "rgba(52,211,153,",
    },
    {
      label: "Occupancy",
      value: `${(dashboard.occupancy_rate * 100).toFixed(1)}%`,
      sub: `Avg ${dashboard.avg_session_duration_hours.toFixed(1)}h`,
      icon: Users,
      color: "rgba(56,189,248,",
    },
    {
      label: "Yield Earned",
      value: formatNGN(dashboard.yield_earned_usdc * EXCHANGE_RATE),
      sub: "From idle escrow",
      icon: Zap,
      color: "rgba(139,92,246,",
    },
  ];

  return (
    <div className="container py-12 px-4 md:px-6">
      <div className="mb-12">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-widest mb-4"
          style={{ background: "rgba(255,170,0,0.08)", color: "#FFAA00", border: "1px solid rgba(255,170,0,0.2)" }}
        >
          <Building className="w-3 h-3" /> Host Dashboard
        </div>
        <h1 className="text-5xl font-bold tracking-tight mb-2">Analytics</h1>
        <p className="text-muted-foreground text-lg">Real-time performance insights.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, sub, icon: Icon, color }) => (
          <div
            key={label}
            className="p-6 rounded-2xl"
            style={{ background: `${color}0.06)`, border: `1px solid ${color}0.2)` }}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}0.15)` }}>
                <Icon className="w-4 h-4" style={{ color: `${color}0.9)` }} />
              </div>
            </div>
            <div className="text-2xl font-bold mb-1">{value}</div>
            <div className="text-xs text-muted-foreground">{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div
          className="lg:col-span-2 p-6 rounded-2xl"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <h3 className="font-bold text-lg mb-6">Revenue — Last 7 Days</h3>
          {revenueData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(43 100% 50%)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="hsl(43 100% 50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`} tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(val: number) => [formatNGN(val), "Revenue"]}
                  contentStyle={{ background: "rgba(10,12,18,0.95)", border: "1px solid rgba(255,170,0,0.2)", borderRadius: "12px", color: "#fff" }}
                />
                <Area type="monotone" dataKey="revenue" stroke="hsl(43 100% 50%)" strokeWidth={2} fill="url(#revenueGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-60 flex items-center justify-center text-muted-foreground text-sm">
              Not enough data yet
            </div>
          )}
        </div>

        <div
          className="p-6 rounded-2xl"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <h3 className="font-bold text-lg mb-6">Occupancy by Space</h3>
          {occupancyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={occupancyData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
                <Tooltip
                  formatter={(val: number) => [`${val}%`, "Occupancy"]}
                  contentStyle={{ background: "rgba(10,12,18,0.95)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: "12px", color: "#fff" }}
                />
                <Bar dataKey="occupancy" fill="hsl(262 83% 66%)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-60 flex items-center justify-center text-muted-foreground text-sm">
              No data yet
            </div>
          )}
        </div>
      </div>

      <div
        className="p-6 rounded-2xl"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <h3 className="font-bold text-lg mb-5">Activity Feed</h3>
        <div className="space-y-3 max-h-72 overflow-y-auto">
          {!activity?.length ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No activity yet</div>
          ) : (
            activity.map((event: any, i: number) => (
              <div key={i} className="flex items-center gap-4 py-3 border-b border-white/5 last:border-0">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold"
                  style={{ background: "rgba(255,170,0,0.1)", color: "#FFAA00" }}
                >
                  {event.event_type?.[0]?.toUpperCase() || "E"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium capitalize">{(event.event_type || "event").replace(/_/g, " ")}</div>
                  <div className="text-xs text-muted-foreground">{event.workspace_name || event.description || ""}</div>
                </div>
                {event.amount_ngn != null && (
                  <div className="text-sm font-bold text-primary shrink-0">{formatNGN(event.amount_ngn)}</div>
                )}
                <div className="text-xs text-muted-foreground shrink-0">
                  {event.created_at ? format(new Date(event.created_at), "HH:mm") : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
