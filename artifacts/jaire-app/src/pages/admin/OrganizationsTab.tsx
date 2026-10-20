import type { OrgRow } from "./types";

const KYC_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  submitted: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  verified: "bg-green-500/20 text-green-400 border-green-500/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
};

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OrganizationsTab({
  organizations,
  kycUpdating,
  kycMessages,
  onUpdateKyc,
}: {
  organizations: OrgRow[];
  kycUpdating: string | null;
  kycMessages: Record<string, string>;
  onUpdateKyc: (orgId: string, status: string) => void;
}) {
  if (organizations.length === 0) {
    return <p className="text-gray-600 text-sm text-center py-12">No organizations yet</p>;
  }

  return (
    <div className="space-y-3">
      {organizations.map(org => (
        <div key={org.id} className="bg-[#111] border border-white/10 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="text-white font-semibold text-sm">{org.business_name}</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${KYC_COLORS[org.kyc_status] ?? ""}`}>{org.kyc_status}</span>
                {org.org_type && <span className="px-2 py-0.5 rounded-full text-[10px] text-gray-500 border border-white/10">{org.org_type.replace("_", " ")}</span>}
              </div>
              <p className="text-xs text-gray-400">{org.owner_email}</p>
              {org.owner_name && <p className="text-xs text-gray-500">{org.owner_name}</p>}
              {(org.state || org.country) && <p className="text-xs text-gray-600 mt-0.5">{[org.state, org.country].filter(Boolean).join(", ")}</p>}
            </div>
            <div className="flex gap-4 text-center flex-shrink-0">
              <div><p className="text-xs text-gray-500">Spaces</p><p className="text-sm font-bold text-white">{org.workspace_count}</p></div>
              <div><p className="text-xs text-gray-500">Bookings</p><p className="text-sm font-bold text-white">{org.booking_count}</p></div>
              <div><p className="text-xs text-gray-500">Revenue</p><p className="text-sm font-bold text-green-400">${org.revenue_usdc.toFixed(2)}</p></div>
            </div>
          </div>

          {org.owner_wallet && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <p className="text-[10px] text-gray-600">Wallet</p>
              <a href={`https://explorer.solana.com/address/${org.owner_wallet}?cluster=devnet`} target="_blank" rel="noreferrer" className="text-xs font-mono text-purple-400 hover:text-purple-300">{org.owner_wallet}</a>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2 flex-wrap">
            {kycMessages[org.id] ? (
              <p className="text-xs text-green-400">{kycMessages[org.id]}</p>
            ) : (
              <>
                {org.kyc_status !== "verified" && <button onClick={() => onUpdateKyc(org.id, "verified")} disabled={kycUpdating === org.id} className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-semibold hover:bg-green-500/30 transition disabled:opacity-40">✓ Approve KYC</button>}
                {org.kyc_status !== "rejected" && <button onClick={() => onUpdateKyc(org.id, "rejected")} disabled={kycUpdating === org.id} className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 text-xs font-semibold hover:bg-red-500/30 transition disabled:opacity-40">✗ Reject KYC</button>}
                {org.kyc_status !== "pending" && <button onClick={() => onUpdateKyc(org.id, "pending")} disabled={kycUpdating === org.id} className="px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 text-xs font-semibold hover:bg-yellow-500/30 transition disabled:opacity-40">Reset to Pending</button>}
              </>
            )}
            <span className="text-[10px] text-gray-600 ml-auto">Joined {formatTime(org.created_at)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
