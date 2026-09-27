import { QRCodeSVG } from "qrcode.react";
import type { Booking, Metric, OrgUser } from "./org-dashboard";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  completed: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  confirmed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

const KYC_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "KYC Pending", cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  submitted: { label: "KYC Submitted", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  verified: { label: "Verified", cls: "bg-green-500/20 text-green-400 border-green-500/30" },
  rejected: { label: "KYC Rejected", cls: "bg-red-500/20 text-red-400 border-red-500/30" },
};

type Props = {
  org: OrgUser;
  metrics: Metric | null;
  recentBookings: Booking[];
  orgQr: { qr_data: string; expires_in_ms: number; countdown: number } | null;
  setLocation: (path: string) => void;
};

export default function OrgOverviewTab({ org, metrics, recentBookings, orgQr, setLocation }: Props) {
  const kycBadge = KYC_BADGE[org.kycStatus ?? "pending"];

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {metrics && [
          { label: "Workspaces", value: metrics.total_workspaces, icon: "🏢", sub: "listed" },
          { label: "Total Bookings", value: metrics.total_bookings, icon: "📅", sub: "all time" },
          { label: "Active Now", value: metrics.active_now, icon: "⚡", sub: "in session" },
          { label: "Revenue", value: `$${metrics.revenue_usdc.toFixed(2)}`, icon: "💰", sub: "USDC earned" },
        ].map((m) => (
          <div key={m.label} className="bg-[#111] border border-white/10 rounded-2xl p-5">
            <p className="text-2xl mb-1">{m.icon}</p>
            <p className="text-white text-2xl font-bold">{m.value}</p>
            <p className="text-gray-500 text-xs mt-0.5">{m.label}</p>
            <p className="text-gray-600 text-xs">{m.sub}</p>
          </div>
        ))}
      </div>

      <div
        className="rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-center gap-6"
        style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)" }}
      >
        <div className="flex flex-col items-center gap-2 shrink-0">
          <p className="text-xs text-purple-300 font-semibold tracking-wide uppercase">Entrance QR Code</p>
          {orgQr ? (
            <>
              <div className="bg-white p-3 rounded-xl">
                <QRCodeSVG value={`${window.location.origin}/scan?qr=${orgQr.qr_data}`} size={160} level="M" includeMargin={false} />
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ background: orgQr.countdown <= 3 ? "#ef4444" : "#22c55e" }}
                />
                <p className="text-xs text-gray-400">{orgQr.countdown > 0 ? `Refreshes in ${orgQr.countdown}s` : "Refreshing…"}</p>
              </div>
            </>
          ) : (
            <div className="w-[160px] h-[160px] rounded-xl bg-white/5 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-purple-500/40 border-t-purple-500 rounded-full animate-spin" />
            </div>
          )}
        </div>

        <div className="flex-1 text-center sm:text-left">
          <p className="text-white font-semibold mb-1">One QR for your entire space</p>
          <p className="text-gray-400 text-sm mb-3">
            Print or display this at your entrance. Members scan it to start or end their session.
            The code rotates every 10 seconds for security.
          </p>
          <ul className="text-xs text-gray-500 space-y-1">
            <li>✓ Works for check-in and check-out</li>
            <li>✓ Only activates bookings made at this space</li>
            <li>✓ Scanning opens the JaIre app on any phone</li>
          </ul>
        </div>
      </div>

      {org.kycStatus === "pending" && (
        <div className="p-5 bg-purple-500/10 border border-purple-500/20 rounded-2xl mb-6 flex items-center justify-between">
          <div>
            <p className="text-purple-300 font-medium">Complete your KYC to go live</p>
            <p className="text-gray-500 text-sm mt-0.5">Verified orgs can list workspaces and receive on-chain settlements.</p>
          </div>
          <button onClick={() => setLocation("/org/kyc")} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-all">
            Start KYC
          </button>
        </div>
      )}

      <div className="bg-[#111] border border-white/10 rounded-2xl p-6">
        <h3 className="text-white font-semibold mb-4">Recent Activity</h3>
        {recentBookings.length === 0 ? (
          <p className="text-gray-600 text-sm text-center py-8">No bookings yet. Add workspaces to get started.</p>
        ) : (
          <div className="space-y-3">
            {recentBookings.slice(0, 8).map((b) => (
              <div key={b.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[b.status] ?? STATUS_COLORS["pending"]}`}>
                    {b.status}
                  </span>
                  <div>
                    <p className="text-white text-sm">{b.workspaceId}</p>
                    <p className="text-gray-600 text-xs">{new Date(b.startTime).toLocaleString()}</p>
                  </div>
                </div>
                <div className="text-right">
                  {b.billedUsdc != null && <p className="text-white text-sm font-medium">${b.billedUsdc.toFixed(2)}</p>}
                  {b.escrowTxSignature && (
                    <a href={`https://explorer.solana.com/tx/${b.escrowTxSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-purple-400 text-xs hover:underline">
                      On-chain ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
