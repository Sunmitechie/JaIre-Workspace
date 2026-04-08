import { useGetAnalyticsDashboard, useGetActivityFeed, useGetRevenueAnalytics } from "@workspace/api-client-react";
import { formatNGN, formatUSDC } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Users, Activity, Building, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';

export default function Analytics() {
  const { data: dashboard, isLoading: isDashboardLoading } = useGetAnalyticsDashboard();
  const { data: activity, isLoading: isActivityLoading } = useGetActivityFeed({ limit: 10 });
  const { data: revenueHistory } = useGetRevenueAnalytics({ days: 7 });

  if (isDashboardLoading || !dashboard) {
    return (
      <div className="container py-12 px-4 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </div>
        <Skeleton className="h-[400px] w-full rounded-2xl" />
      </div>
    );
  }

  const revenueByDate: Record<string, number> = {};
  revenueHistory?.forEach((r) => {
    revenueByDate[r.date] = (revenueByDate[r.date] ?? 0) + r.revenue_usdc;
  });
  const revenueData = Object.entries(revenueByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue]) => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      revenue,
    }));

  const occupancyData = (dashboard.workspace_stats ?? []).map((stat: any) => ({
    name: stat.workspace_name ?? stat.name ?? '',
    occupancy: (stat.occupancy_rate ?? 0) * 100
  }));

  return (
    <div className="container py-12 px-4 md:px-6">
      <div className="mb-10 flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">Host Analytics</h1>
          <p className="text-muted-foreground text-lg">Real-time performance metrics.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Total Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatUSDC(dashboard.total_revenue_usdc)}</div>
            <p className="text-xs text-muted-foreground font-mono mt-1">
              {formatNGN(dashboard.total_revenue_ngn)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Active Sessions</CardTitle>
            <Activity className="h-4 w-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.active_sessions}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Live right now
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase">Occupancy Rate</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{(dashboard.occupancy_rate * 100).toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              Avg duration: {dashboard.avg_session_duration_hours.toFixed(1)}h
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-primary uppercase">DeFi Yield Earned</CardTitle>
            <Building className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{formatUSDC(dashboard.yield_earned_usdc)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              From escrowed funds
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        <Card className="col-span-2 bg-card">
          <CardHeader>
            <CardTitle>Revenue Trend (Last 7 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorRevenue)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-1 bg-card">
          <CardHeader>
            <CardTitle>Occupancy by Space</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={occupancyData} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    axisLine={false} 
                    tickLine={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    width={100}
                  />
                  <Tooltip 
                    cursor={{ fill: 'hsl(var(--muted)/0.5)' }}
                    contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                  />
                  <Bar dataKey="occupancy" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {isActivityLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : activity?.map((event) => (
              <div key={event.id} className="flex items-start gap-4 pb-6 border-b border-border/50 last:border-0 last:pb-0">
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  {event.event_type === 'check_in' && <ArrowDownRight className="w-5 h-5 text-primary" />}
                  {event.event_type === 'check_out' && <ArrowUpRight className="w-5 h-5 text-muted-foreground" />}
                  {event.event_type === 'payment' && <Activity className="w-5 h-5 text-accent" />}
                  {event.event_type === 'wallet_funded' && <TrendingUp className="w-5 h-5 text-primary" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-sm">
                      <span className="text-foreground capitalize">{(event.event_type ?? '').replace(/_/g, ' ')}</span>
                      {event.workspace_name && <span className="text-muted-foreground"> at {event.workspace_name}</span>}
                    </p>
                    {event.amount_usdc && (
                      <span className="font-bold text-sm text-foreground">{formatUSDC(event.amount_usdc)}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(event.timestamp), 'MMM d, h:mm a')} • {event.user_name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
