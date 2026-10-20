import type { ActivityEvent, Overview } from "./types";

const KYC_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  submitted: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  verified: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
};

const EVENT_ICONS: Record<string, string> = {
  check_in: "↗",
  check_out: "↙",
  payment: "₿",
  refund: "↩",
};

function formatTime(value: string) {
  return new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-[#111] border border-white/10 rounded-2xl p-5">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function OverviewTab({
  overview,
  activity,
}: {
  overview: Overview;
  activity: ActivityEvent[];
}) {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-purple-900/40 to-blue-900/40 border border-purple-500/30 rounded-2xl p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-purple-300 mb-1">JaIre Vault</p>
            <p className="text-4xl font-bold text-white">
              ${overview.vault_balance_usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-lg text-purple-300 ml-1">USDC</span>
            </p>
            <p className="text-sm text-purple-400 mt-1">{overview.vault_sol.toFixed(4)} SOL</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 mb-1">Vault Address</p>
            <a href={`https://explorer.solana.com/address/${overview.vault_address}?cluster=devnet`} target="_blank" rel="noreferrer" className="text-xs text-purple-400 hover:text-purple-300 font-mono">
              {overview.vault_address ? `${overview.vault_address.slice(0, 6)}…${overview.vault_address.slice(-4)}` : "—"}
            </a>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-purple-500/20 grid grid-cols-2 gap-4">
          <div><p className="text-xs text-gray-500">Platform fees collected (15%)</p><p className="text-lg font-bold text-green-400">${overview.platform_fee_usdc.toFixed(2)}</p></div>
          <div><p className="text-xs text-gray-500">Locked in active escrow</p><p className="text-lg font-bold text-blue-400">${overview.total_escrow_usdc.toFixed(2)}</p></div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Organizations" value={overview.total_organizations} />
        <MetricCard label="Workspaces" value={overview.total_workspaces} />
        <MetricCard label="Total Bookings" value={overview.total_bookings} />
        <MetricCard label="Registered Users" value={overview.total_users} />
        <MetricCard label="Active Sessions" value={overview.active_sessions} accent="text-green-400" />
        <MetricCard label="Today Check-ins" value={overview.today_checkins} />
        <MetricCard label="Total Revenue" value={`$${overview.total_revenue_usdc.toFixed(2)}`} sub="USDC" accent="text-purple-400" />
        <MetricCard label="Revenue (NGN)" value={`₦${overview.total_revenue_ngn.toLocaleString()}`} />
      </div>

      <div className="bg-[#111] border border-white/10 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">KYC Status Distribution</h3>
        <div className="grid grid-cols-4 gap-3">
          {Object.entries(overview.kyc_counts).map(([status, count]) => (
            <div key={status} className="text-center">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${KYC_COLORS[status] ?? ""}`}>{status}</span>
              <p className="text-2xl font-bold text-white mt-2">{count}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[#111] border border-white/10 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Live Activity Feed</h3>
        {activity.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-8">No recent activity</p>
        ) : (
          <div className="space-y-2">
            {activity.slice(0, 10).map(event => (
              <div key={event.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                <span className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center text-sm flex-shrink-0">{EVENT_ICONS[event.eventType] ?? "·"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white"><span className="text-gray-400">{event.userName ?? event.userId ?? "User"}</span>{" "}<span className="capitalize">{event.eventType.replace("_", " ")}</span>{event.workspaceName && <span className="text-gray-500"> @ {event.workspaceName}</span>}</p>
                  {event.amountUsdc && <p className="text-xs text-green-400">${event.amountUsdc.toFixed(2)} USDC</p>}
                </div>
                <p className="text-[10px] text-gray-600 flex-shrink-0">{formatTime(event.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
