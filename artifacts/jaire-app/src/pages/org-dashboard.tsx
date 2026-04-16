import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { getOrgUser, getOrgToken, clearOrgUser, saveOrgUser } from "@/lib/org-auth";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE_URL}/api`;

interface Metric {
  total_workspaces: number;
  total_bookings: number;
  active_now: number;
  revenue_usdc: number;
}

interface Booking {
  id: string;
  workspaceId: string;
  status: string;
  startTime: string;
  endTime?: string;
  billedUsdc?: number;
  escrowTxSignature?: string;
}

interface Workspace {
  id: string;
  name: string;
  description: string;
  workspaceType: string;
  capacity: number;
  hourlyRateNgn: number;
  hourlyRateUsdc: number;
  isAvailable: boolean;
  amenities: string;
  imageUrl?: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  completed: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  confirmed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

const KYC_BADGE: Record<string, { label: string; cls: string }> = {
  pending:   { label: "KYC Pending",   cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  submitted: { label: "KYC Submitted", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  verified:  { label: "Verified",      cls: "bg-green-500/20 text-green-400 border-green-500/30" },
  rejected:  { label: "KYC Rejected",  cls: "bg-red-500/20 text-red-400 border-red-500/30" },
};

export default function OrgDashboard() {
  const [, setLocation] = useLocation();
  const org = getOrgUser();
  const [metrics, setMetrics] = useState<Metric | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "workspaces" | "bookings">("overview");

  // Add workspace modal state
  const [showAddWs, setShowAddWs] = useState(false);
  const [wsForm, setWsForm] = useState({
    name: "", description: "", capacity: "1", hourly_rate_ngn: "2000",
    workspace_type: "hot_desk", floor: "1", amenities: "", image_url: "",
  });
  const [wsLoading, setWsLoading] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);

  // Jaie AI chat state
  const [jaieOpen, setJaieOpen] = useState(false);
  const [jaieHistory, setJaieHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [jaieInput, setJaieInput] = useState("");
  const [jaieLoading, setJaieLoading] = useState(false);
  const jaieBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!org) { setLocation("/org/signup"); return; }
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = getOrgToken();
      const res = await fetch(`${API}/org/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMetrics(data.metrics);
      setWorkspaces(data.workspaces ?? []);
      setRecentBookings(data.recent_bookings ?? []);

      // Sync org KYC status
      if (data.org) saveOrgUser({ ...org!, ...data.org, token: token! });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAddWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setWsLoading(true);
    setWsError(null);
    try {
      const token = getOrgToken();
      const res = await fetch(`${API}/org/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...wsForm,
          capacity: Number(wsForm.capacity),
          hourly_rate_ngn: Number(wsForm.hourly_rate_ngn),
          floor: Number(wsForm.floor),
          amenities: wsForm.amenities.split(",").map(a => a.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowAddWs(false);
      setWsForm({ name: "", description: "", capacity: "1", hourly_rate_ngn: "2000", workspace_type: "hot_desk", floor: "1", amenities: "", image_url: "" });
      loadDashboard();
    } catch (e) {
      setWsError(e instanceof Error ? e.message : String(e));
    } finally {
      setWsLoading(false);
    }
  };

  const toggleAvailability = async (ws: Workspace) => {
    try {
      const token = getOrgToken();
      await fetch(`${API}/org/workspaces/${ws.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_available: !ws.isAvailable }),
      });
      loadDashboard();
    } catch {}
  };

  const sendJaieMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = jaieInput.trim();
    if (!text || jaieLoading) return;
    const userMsg = { role: "user" as const, content: text };
    setJaieHistory(h => [...h, userMsg]);
    setJaieInput("");
    setJaieLoading(true);
    try {
      const token = getOrgToken();
      const res = await fetch(`${API}/jaie/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, history: jaieHistory.slice(-10) }),
      });
      const data = await res.json();
      setJaieHistory(h => [...h, { role: "assistant", content: data.response ?? "Sorry, I couldn't process that." }]);
    } catch {
      setJaieHistory(h => [...h, { role: "assistant", content: "Connection error. Please try again." }]);
    } finally {
      setJaieLoading(false);
      setTimeout(() => jaieBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  const kycBadge = KYC_BADGE[org?.kycStatus ?? "pending"];

  if (!org) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-20">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0d0d0d]">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-base">J</span>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">{org.businessName ?? org.ownerEmail}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${kycBadge.cls}`}>{kycBadge.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {org.kycStatus === "pending" && (
              <button onClick={() => setLocation("/org/kyc")} className="text-xs px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-lg transition-all">
                Complete KYC
              </button>
            )}
            <button onClick={() => { clearOrgUser(); setLocation("/org/signup"); }} className="text-xs text-gray-500 hover:text-gray-300">
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pt-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-white/5 p-1 rounded-xl w-fit">
          {(["overview", "workspaces", "bookings"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                activeTab === tab ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm mb-6">{error}</div>
        )}

        {!loading && activeTab === "overview" && metrics && (
          <>
            {/* Metric cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Workspaces", value: metrics.total_workspaces, icon: "🏢", sub: "listed" },
                { label: "Total Bookings", value: metrics.total_bookings, icon: "📅", sub: "all time" },
                { label: "Active Now", value: metrics.active_now, icon: "⚡", sub: "in session" },
                { label: "Revenue", value: `$${metrics.revenue_usdc.toFixed(2)}`, icon: "💰", sub: "USDC earned" },
              ].map(m => (
                <div key={m.label} className="bg-[#111] border border-white/10 rounded-2xl p-5">
                  <p className="text-2xl mb-1">{m.icon}</p>
                  <p className="text-white text-2xl font-bold">{m.value}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{m.label}</p>
                  <p className="text-gray-600 text-xs">{m.sub}</p>
                </div>
              ))}
            </div>

            {/* KYC prompt if not verified */}
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

            {/* Recent activity */}
            <div className="bg-[#111] border border-white/10 rounded-2xl p-6">
              <h3 className="text-white font-semibold mb-4">Recent Activity</h3>
              {recentBookings.length === 0 ? (
                <p className="text-gray-600 text-sm text-center py-8">No bookings yet. Add workspaces to get started.</p>
              ) : (
                <div className="space-y-3">
                  {recentBookings.slice(0, 8).map(b => (
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
                        {b.billedUsdc != null && (
                          <p className="text-white text-sm font-medium">${b.billedUsdc.toFixed(2)}</p>
                        )}
                        {b.escrowTxSignature && (
                          <a
                            href={`https://explorer.solana.com/tx/${b.escrowTxSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-400 text-xs hover:underline"
                          >
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
        )}

        {!loading && activeTab === "workspaces" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white text-xl font-semibold">Your Workspaces</h2>
              <button
                onClick={() => setShowAddWs(true)}
                disabled={org.kycStatus === "rejected"}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-40"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Workspace
              </button>
            </div>

            {workspaces.length === 0 ? (
              <div className="text-center py-16 bg-[#111] border border-white/10 rounded-2xl">
                <p className="text-4xl mb-4">🏢</p>
                <p className="text-white font-medium mb-1">No workspaces yet</p>
                <p className="text-gray-500 text-sm mb-6">Add your first workspace to start accepting bookings.</p>
                <button onClick={() => setShowAddWs(true)} className="px-4 py-2 bg-purple-600 text-white text-sm rounded-xl">
                  Add Your First Workspace
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {workspaces.map(ws => (
                  <div key={ws.id} className="bg-[#111] border border-white/10 rounded-2xl p-5 flex flex-col gap-3">
                    {ws.imageUrl && (
                      <img src={ws.imageUrl} alt={ws.name} className="w-full h-32 object-cover rounded-xl" />
                    )}
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-white font-medium">{ws.name}</p>
                        <p className="text-gray-500 text-xs mt-0.5 capitalize">{ws.workspaceType.replace("_", " ")} · {ws.capacity} seat{ws.capacity > 1 ? "s" : ""}</p>
                      </div>
                      <button
                        onClick={() => toggleAvailability(ws)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-all ${ws.isAvailable ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-gray-500/20 text-gray-500 border-gray-600/30"}`}
                      >
                        {ws.isAvailable ? "Available" : "Offline"}
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">₦{ws.hourlyRateNgn.toLocaleString()}/hr</span>
                      <span className="text-gray-600 text-xs">${ws.hourlyRateUsdc.toFixed(2)} USDC</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && activeTab === "bookings" && (
          <div>
            <h2 className="text-white text-xl font-semibold mb-6">All Bookings</h2>
            {recentBookings.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-16">No bookings yet.</p>
            ) : (
              <div className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left text-gray-500 font-medium px-5 py-3">Booking ID</th>
                      <th className="text-left text-gray-500 font-medium px-5 py-3">Workspace</th>
                      <th className="text-left text-gray-500 font-medium px-5 py-3">Status</th>
                      <th className="text-left text-gray-500 font-medium px-5 py-3">Start</th>
                      <th className="text-right text-gray-500 font-medium px-5 py-3">Billed</th>
                      <th className="text-right text-gray-500 font-medium px-5 py-3">On-chain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentBookings.map(b => (
                      <tr key={b.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                        <td className="px-5 py-3 text-gray-400 font-mono text-xs">{b.id.slice(0, 8)}…</td>
                        <td className="px-5 py-3 text-gray-400 text-xs">{b.workspaceId}</td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[b.status] ?? STATUS_COLORS["pending"]}`}>
                            {b.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-400 text-xs">{new Date(b.startTime).toLocaleDateString()}</td>
                        <td className="px-5 py-3 text-right text-white text-xs">
                          {b.billedUsdc != null ? `$${b.billedUsdc.toFixed(2)}` : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {b.escrowTxSignature ? (
                            <a
                              href={`https://explorer.solana.com/tx/${b.escrowTxSignature}?cluster=devnet`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-purple-400 text-xs hover:underline"
                            >
                              View ↗
                            </a>
                          ) : <span className="text-gray-700 text-xs">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Jaie AI Floating Button */}
      <button
        onClick={() => setJaieOpen(o => !o)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all hover:scale-110 active:scale-95"
        style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)", boxShadow: "0 8px 30px rgba(124,58,237,0.5)" }}
        title="Ask Jaie"
      >
        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>

      {/* Jaie Chat Panel */}
      {jaieOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-[360px] max-h-[520px] flex flex-col bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10" style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(79,70,229,0.1))" }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}>J</div>
              <div>
                <p className="text-white text-sm font-semibold">Jaie</p>
                <p className="text-gray-500 text-xs">Your JaIre business partner</p>
              </div>
            </div>
            <button onClick={() => setJaieOpen(false)} className="text-gray-500 hover:text-gray-300 p-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[360px]">
            {jaieHistory.length === 0 && (
              <div className="text-center py-6">
                <p className="text-gray-500 text-sm">Hey! I'm Jaie — ask me anything about your workspaces, revenue, or how JaIre works.</p>
                <div className="mt-4 flex flex-col gap-2">
                  {["How does my 85% settlement work?", "How do I add a workspace?", "Why do I need KYC?"].map(q => (
                    <button key={q} onClick={() => { setJaieInput(q); }} className="text-xs text-purple-400 hover:text-purple-300 border border-purple-500/20 hover:border-purple-500/40 rounded-lg px-3 py-1.5 transition-all text-left">{q}</button>
                  ))}
                </div>
              </div>
            )}
            {jaieHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-purple-600 text-white"
                    : "bg-white/8 text-gray-200 border border-white/8"
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {jaieLoading && (
              <div className="flex justify-start">
                <div className="bg-white/8 border border-white/8 rounded-xl px-3 py-2 flex gap-1">
                  {[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                </div>
              </div>
            )}
            <div ref={jaieBottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={sendJaieMessage} className="border-t border-white/10 p-3 flex gap-2">
            <input
              value={jaieInput}
              onChange={e => setJaieInput(e.target.value)}
              placeholder="Ask Jaie anything..."
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
              disabled={jaieLoading}
            />
            <button
              type="submit"
              disabled={jaieLoading || !jaieInput.trim()}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded-xl transition-all"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
            </button>
          </form>
        </div>
      )}

      {/* Add Workspace Modal */}
      {showAddWs && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-semibold text-lg">Add New Workspace</h3>
              <button onClick={() => setShowAddWs(false)} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {wsError && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{wsError}</div>}

            <form onSubmit={handleAddWorkspace} className="space-y-4">
              <div>
                <label className="text-gray-400 text-sm block mb-1">Name *</label>
                <input required value={wsForm.name} onChange={e => setWsForm(f => ({ ...f, name: e.target.value }))} placeholder="Ground Floor Hot Desk A" className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm" />
              </div>
              <div>
                <label className="text-gray-400 text-sm block mb-1">Description</label>
                <textarea rows={2} value={wsForm.description} onChange={e => setWsForm(f => ({ ...f, description: e.target.value }))} placeholder="Quiet corner desk with natural light..." className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Type</label>
                  <select value={wsForm.workspace_type} onChange={e => setWsForm(f => ({ ...f, workspace_type: e.target.value }))} className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm">
                    <option value="hot_desk">Hot Desk</option>
                    <option value="private_suite">Private Suite</option>
                    <option value="meeting_room">Meeting Room</option>
                    <option value="lounge">Lounge</option>
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Capacity (seats)</label>
                  <input type="number" min="1" value={wsForm.capacity} onChange={e => setWsForm(f => ({ ...f, capacity: e.target.value }))} className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Hourly Rate (₦) *</label>
                  <input required type="number" min="100" value={wsForm.hourly_rate_ngn} onChange={e => setWsForm(f => ({ ...f, hourly_rate_ngn: e.target.value }))} className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm" />
                </div>
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Floor</label>
                  <input type="number" min="1" value={wsForm.floor} onChange={e => setWsForm(f => ({ ...f, floor: e.target.value }))} className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-sm block mb-1">Amenities (comma-separated)</label>
                <input value={wsForm.amenities} onChange={e => setWsForm(f => ({ ...f, amenities: e.target.value }))} placeholder="WiFi, Standing Desk, Coffee, AC" className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm" />
              </div>
              <div>
                <label className="text-gray-400 text-sm block mb-1">Image URL</label>
                <input value={wsForm.image_url} onChange={e => setWsForm(f => ({ ...f, image_url: e.target.value }))} placeholder="https://..." className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddWs(false)} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white text-sm rounded-xl transition-all">Cancel</button>
                <button type="submit" disabled={wsLoading} className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50">
                  {wsLoading ? "Adding..." : "Add Workspace"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
