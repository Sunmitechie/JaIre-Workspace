import { useState } from "react";
import { useLocation } from "wouter";
import { getOrgToken, getOrgUser, saveOrgUser } from "@/lib/org-auth";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API = `${BASE_URL}/api`;

const ORG_TYPES = [
  { value: "coworking_space", label: "Coworking Space" },
  { value: "accelerator", label: "Accelerator / Hub" },
  { value: "corporate_hub", label: "Corporate Hub" },
  { value: "community_hub", label: "Community Hub" },
  { value: "other", label: "Other" },
];

const NIGERIAN_STATES = [
  "Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
  "Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo",
  "Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa",
  "Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba",
  "Yobe","Zamfara",
];

export default function OrgKyc() {
  const [, setLocation] = useLocation();
  const org = getOrgUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    business_name: org?.businessName ?? "",
    org_type: "coworking_space",
    registration_number: "",
    country: "Nigeria",
    state: "Lagos",
    address: "",
    website: "",
    description: "",
    phone: "",
    logo_url: "",
  });

  if (!org) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <p className="text-white mb-4">You need to sign up first.</p>
          <button onClick={() => setLocation("/org/signup")} className="px-4 py-2 bg-purple-600 text-white rounded-lg">Go to signup</button>
        </div>
      </div>
    );
  }

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const token = getOrgToken();
      const res = await fetch(`${API}/org/kyc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      const { org: updated } = await res.json();
      saveOrgUser({ ...org, ...updated, token: token! });
      setSubmitted(true);
      setTimeout(() => setLocation("/org/dashboard"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-white text-2xl font-bold mb-2">KYC Submitted!</h2>
          <p className="text-gray-400">We'll verify your details within 24 hours. Taking you to your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button onClick={() => setLocation("/org/dashboard")} className="text-gray-500 hover:text-gray-300 text-sm flex items-center gap-1 mb-4">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </button>
          <h1 className="text-white text-3xl font-bold">Business Verification</h1>
          <p className="text-gray-400 mt-2">Complete your KYC to start listing workspaces and earning on-chain revenue.</p>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-3 mb-8 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
          <div className="w-8 h-8 bg-purple-500/20 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <p className="text-purple-300 text-sm font-medium">Your Web3Auth wallet is ready</p>
            <p className="text-gray-500 text-xs">{org.ownerWalletAddress ? `${org.ownerWalletAddress.slice(0, 12)}...${org.ownerWalletAddress.slice(-6)}` : "Wallet linked via MPC"}</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Business Info */}
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6">
            <h3 className="text-white font-semibold mb-4">Business Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-gray-400 text-sm block mb-1">Business Name *</label>
                <input
                  required
                  value={form.business_name}
                  onChange={e => set("business_name", e.target.value)}
                  placeholder="Lekki Innovation Hub Ltd."
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm"
                />
              </div>

              <div>
                <label className="text-gray-400 text-sm block mb-1">Organisation Type *</label>
                <select
                  value={form.org_type}
                  onChange={e => set("org_type", e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm"
                >
                  {ORG_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-gray-400 text-sm block mb-1">CAC / Reg Number</label>
                <input
                  value={form.registration_number}
                  onChange={e => set("registration_number", e.target.value)}
                  placeholder="RC-1234567"
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm"
                />
              </div>

              <div>
                <label className="text-gray-400 text-sm block mb-1">Phone Number *</label>
                <input
                  required
                  value={form.phone}
                  onChange={e => set("phone", e.target.value)}
                  placeholder="+234 800 000 0000"
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm"
                />
              </div>

              <div>
                <label className="text-gray-400 text-sm block mb-1">Website</label>
                <input
                  value={form.website}
                  onChange={e => set("website", e.target.value)}
                  placeholder="https://yourhub.com"
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6">
            <h3 className="text-white font-semibold mb-4">Location</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-gray-400 text-sm block mb-1">State *</label>
                <select
                  value={form.state}
                  onChange={e => set("state", e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm"
                >
                  {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="text-gray-400 text-sm block mb-1">Full Address *</label>
                <input
                  required
                  value={form.address}
                  onChange={e => set("address", e.target.value)}
                  placeholder="12 Admiralty Way, Lekki Phase 1"
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-gray-400 text-sm block mb-1">Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={e => set("description", e.target.value)}
                  placeholder="Tell members what makes your space special..."
                  className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm resize-none"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Submitting for review...
              </span>
            ) : "Submit for Verification"}
          </button>
        </form>
      </div>
    </div>
  );
}
