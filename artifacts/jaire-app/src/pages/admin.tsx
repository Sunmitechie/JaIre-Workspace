import { useState, useEffect, useCallback } from "react";
import OverviewTab from "./admin/OverviewTab";
import OrganizationsTab from "./admin/OrganizationsTab";
import type { ActivityEvent, BookingRow, OrgRow, Overview } from "./admin/types";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE_URL}/api`;

// ── Helpers ────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  active:    "bg-green-500/20 text-green-400",
  completed: "bg-gray-500/20 text-gray-400",
  confirmed: "bg-blue-500/20 text-blue-300",
  pending:   "bg-yellow-500/20 text-yellow-400",
  cancelled: "bg-red-500/20 text-red-400",
};
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtSecs(s: number | null) {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
// ── Component ──────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [adminKey, setAdminKey]       = useState(() => localStorage.getItem("jaire_admin_key") ?? "");
  const [authed, setAuthed]           = useState(false);
  const [authError, setAuthError]     = useState("");

  const [overview, setOverview]       = useState<Overview | null>(null);
  const [orgs, setOrgs]               = useState<OrgRow[]>([]);
  const [recentBookings, setRecentBookings] = useState<BookingRow[]>([]);
  const [activity, setActivity]       = useState<ActivityEvent[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");

  const [activeTab, setActiveTab]     = useState<"overview" | "orgs" | "bookings" | "blink">("overview");
  const [kycUpdating, setKycUpdating] = useState<string | null>(null);
  const [kycMsg, setKycMsg]           = useState<Record<string, string>>({});

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    "Authorization": `Bearer ${adminKey}`,
  }), [adminKey]);

  const fetchAll = useCallback(async () => {
    if (!adminKey) return;
    setLoading(true);
    setError("");
    try {
      const [ovRes, orgRes, bkRes, actRes] = await Promise.all([
        fetch(`${API}/admin/overview`,       { headers: headers() }),
        fetch(`${API}/admin/organizations`,  { headers: headers() }),
        fetch(`${API}/admin/bookings?limit=30`, { headers: headers() }),
        fetch(`${API}/admin/activity?limit=20`, { headers: headers() }),
      ]);
      if (ovRes.status === 401) { setAuthed(false); setAuthError("Invalid admin key"); return; }
      if (ovRes.ok)  setOverview(await ovRes.json());
      if (orgRes.ok) { const d = await orgRes.json(); setOrgs(d.organizations ?? []); }
      if (bkRes.ok)  { const d = await bkRes.json(); setRecentBookings(d.bookings ?? []); }
      if (actRes.ok) { const d = await actRes.json(); setActivity(d.events ?? []); }
      setAuthed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [adminKey, headers]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem("jaire_admin_key", adminKey);
    await fetchAll();
  }

  async function updateKyc(orgId: string, status: string) {
    setKycUpdating(orgId);
    try {
      const res = await fetch(`${API}/admin/organizations/${orgId}/kyc`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setKycMsg((prev) => ({ ...prev, [orgId]: `KYC set to ${status}` }));
        setOrgs((prev) => prev.map((o) => o.id === orgId ? { ...o, kyc_status: status as OrgRow["kyc_status"] } : o));
        setTimeout(() => setKycMsg((prev) => { const n = { ...prev }; delete n[orgId]; return n; }), 3000);
      }
    } finally {
      setKycUpdating(null);
    }
  }

  // ── Login gate ──────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl font-black text-white">J</span>
            </div>
            <h1 className="text-2xl font-bold text-white">JaIre Admin</h1>
            <p className="text-gray-500 text-sm mt-1">Platform management console</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Admin Key</label>
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="Enter JAIRE_ADMIN_TOKEN"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-purple-500/60 placeholder-gray-600"
              />
            </div>
            {authError && <p className="text-red-400 text-xs">{authError}</p>}
            <button
              type="submit"
              disabled={!adminKey || loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-semibold disabled:opacity-40 transition"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const TABS = [
    { key: "overview",  label: "Overview" },
    { key: "orgs",      label: `Orgs (${orgs.length})` },
    { key: "bookings",  label: `Bookings (${recentBookings.length})` },
    { key: "blink",     label: "Solana Blink" },
  ] as const;

  const blinkBaseUrl = window.location.origin + BASE_URL;
  const checkinBlinkUrl = `${blinkBaseUrl}/api/actions/checkin`;

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-20">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0d0d0d] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
              <span className="text-sm font-black text-white">J</span>
            </div>
            <span className="text-white font-semibold text-sm">JaIre</span>
            <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 text-[10px] font-semibold border border-purple-500/30">
              ADMIN
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchAll}
              disabled={loading}
              className="text-xs text-gray-400 hover:text-white transition px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20"
            >
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
            <button
              onClick={() => { localStorage.removeItem("jaire_admin_key"); setAuthed(false); setAdminKey(""); }}
              className="text-xs text-gray-500 hover:text-red-400 transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 bg-[#111] border border-white/10 rounded-xl p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition ${
                activeTab === t.key
                  ? "bg-white/10 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "overview" && overview && <OverviewTab overview={overview} activity={activity} />}

        {activeTab === "orgs" && (
          <OrganizationsTab
            organizations={orgs}
            kycUpdating={kycUpdating}
            kycMessages={kycMsg}
            onUpdateKyc={updateKyc}
          />
        )}

        {/* ── BOOKINGS TAB ──────────────────────────────────────────────── */}
        {activeTab === "bookings" && (
          <div className="space-y-2">
            {recentBookings.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-12">No bookings yet</p>
            ) : (
              recentBookings.map((b) => (
                <div key={b.id} className="bg-[#111] border border-white/10 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[b.status] ?? ""}`}>
                          {b.status}
                        </span>
                        <span className="text-white text-xs font-semibold truncate">
                          {b.workspace_name ?? "Unknown space"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {b.user_name} {b.user_email ? `· ${b.user_email}` : ""}
                      </p>
                      <div className="flex gap-3 mt-1 flex-wrap">
                        <span className="text-[10px] text-gray-600">In: {fmtTime(b.check_in_time)}</span>
                        {b.check_out_time && <span className="text-[10px] text-gray-600">Out: {fmtTime(b.check_out_time)}</span>}
                        {b.actual_seconds && <span className="text-[10px] text-gray-600">Duration: {fmtSecs(b.actual_seconds)}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {b.billed_usdc != null && b.billed_usdc > 0 && (
                        <p className="text-sm font-bold text-green-400">${b.billed_usdc.toFixed(4)}</p>
                      )}
                      {b.escrow_usdc != null && b.escrow_usdc > 0 && (
                        <p className="text-xs text-blue-400">escrow ${b.escrow_usdc.toFixed(2)}</p>
                      )}
                      {b.refunded_usdc != null && b.refunded_usdc > 0 && (
                        <p className="text-xs text-yellow-400">refund ${b.refunded_usdc.toFixed(4)}</p>
                      )}
                    </div>
                  </div>
                  {b.settle_tx && (
                    <div className="mt-2 pt-2 border-t border-white/5">
                      <a
                        href={`https://explorer.solana.com/tx/${b.settle_tx}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-mono text-purple-400 hover:text-purple-300"
                      >
                        tx: {b.settle_tx.slice(0, 20)}…
                      </a>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── BLINK TAB ─────────────────────────────────────────────────── */}
        {activeTab === "blink" && (
          <div className="space-y-6 max-w-2xl">
            <div className="bg-[#111] border border-white/10 rounded-2xl p-6">
              <h3 className="text-white font-semibold mb-1">Solana Blink — Workspace Check-in</h3>
              <p className="text-gray-500 text-xs mb-5">
                Share these URLs in Phantom, Dialect, Backpack, or any Blink-compatible wallet to
                let anyone check in on-chain without leaving their wallet.
              </p>

              {/* Generic checkin blink */}
              <div className="mb-5">
                <p className="text-xs text-gray-400 font-semibold mb-2">Generic Check-in Blink</p>
                <div className="bg-black/40 border border-white/10 rounded-xl p-3 flex items-center gap-2 group">
                  <code className="text-[11px] text-purple-300 flex-1 break-all">
                    {checkinBlinkUrl}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(checkinBlinkUrl)}
                    className="text-xs text-gray-500 hover:text-white flex-shrink-0 transition px-2 py-1 rounded bg-white/5"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-[10px] text-gray-600 mt-1">
                  Dialect Blink viewer: <a
                    href={`https://dial.to/?action=solana-action:${encodeURIComponent(checkinBlinkUrl)}`}
                    target="_blank" rel="noreferrer"
                    className="text-purple-400 hover:underline"
                  >Open in dial.to ↗</a>
                </p>
              </div>

              {/* Per-workspace blinks */}
              <div>
                <p className="text-xs text-gray-400 font-semibold mb-2">Per-Workspace Blinks</p>
                {overview?.total_workspaces === 0 ? (
                  <p className="text-gray-600 text-xs">No workspaces yet.</p>
                ) : (
                  <div className="space-y-2">
                    {orgs.flatMap(() => []).length === 0 && (
                      <p className="text-gray-600 text-xs italic">
                        Use <code className="text-purple-400">/api/actions/workspace/:id</code> with any workspace ID.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Blink spec reference */}
              <div className="mt-6 pt-5 border-t border-white/10 space-y-3">
                <p className="text-xs text-gray-400 font-semibold">Action Endpoints</p>
                {[
                  ["GET",  "/api/actions/actions.json",          "Actions manifest (Solana well-known)"],
                  ["GET",  "/api/actions/checkin",               "Generic workspace picker action"],
                  ["POST", "/api/actions/checkin?workspace_id=X&hours=N", "Returns unsigned USDC tx"],
                  ["GET",  "/api/actions/workspace/:id",         "Workspace-specific action metadata"],
                  ["POST", "/api/actions/workspace/:id?hours=N", "Returns unsigned USDC tx"],
                ].map(([method, path, desc]) => (
                  <div key={path} className="flex gap-3 items-start">
                    <span className={`flex-shrink-0 w-10 text-center px-1 py-0.5 rounded text-[10px] font-bold ${method === "GET" ? "bg-blue-500/20 text-blue-400" : "bg-green-500/20 text-green-400"}`}>
                      {method}
                    </span>
                    <div className="min-w-0">
                      <code className="text-[11px] text-purple-300">{path}</code>
                      <p className="text-[10px] text-gray-600 mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions.json preview */}
              <div className="mt-5 pt-5 border-t border-white/10">
                <p className="text-xs text-gray-400 font-semibold mb-2">How it works</p>
                <ol className="space-y-2 text-xs text-gray-400 list-decimal list-inside">
                  <li>User opens the Blink URL in Phantom or Dialect.</li>
                  <li>Wallet calls <span className="text-white">GET</span> → shows title, description, and action buttons.</li>
                  <li>User picks a duration and clicks the button.</li>
                  <li>Wallet calls <span className="text-white">POST</span> with the user's wallet address.</li>
                  <li>JaIre returns a serialised <span className="text-purple-300">USDC transfer transaction</span> (unsigned).</li>
                  <li>Wallet asks user to sign → broadcasts on Solana devnet.</li>
                  <li>USDC flows to JaIre vault · on-chain memo records the booking.</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
