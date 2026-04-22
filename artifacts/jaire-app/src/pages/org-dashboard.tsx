import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { QRCodeSVG } from "qrcode.react";
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

interface Device {
  id: string;
  orgId: string;
  workspaceId: string | null;
  deviceName: string;
  deviceType: string;
  mqttClientId: string;
  isOnline: boolean;
  powerState: boolean;
  currentWatts: number | null;
  voltage: number | null;
  currentAmps: number | null;
  todayKwh: number | null;
  temperature: number | null;
  lastSeen: string | null;
  createdAt: string;
}

const EMPTY_WS_FORM = {
  name: "", description: "", capacity: "1", hourly_rate_ngn: "2000",
  workspace_type: "hot_desk", floor: "1", amenities: "", image_url: "",
};

const EMPTY_DEVICE_FORM = {
  deviceName: "", deviceType: "smart_plug", workspaceId: "", mqttClientId: "",
};

export default function OrgDashboard() {
  const [, setLocation] = useLocation();
  const org = getOrgUser();
  const [metrics, setMetrics] = useState<Metric | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "workspaces" | "bookings" | "wallet" | "devices">("overview");

  // Wallet state
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletCopied, setWalletCopied] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Devices state
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [deviceForm, setDeviceForm] = useState(EMPTY_DEVICE_FORM);
  const [deviceFormLoading, setDeviceFormLoading] = useState(false);
  const [deviceFormError, setDeviceFormError] = useState<string | null>(null);
  const [simExpanded, setSimExpanded] = useState<string | null>(null);
  const [simForm, setSimForm] = useState<Record<string, { watts: string; voltage: string; amps: string; power_state: boolean; temperature: string }>>({});
  const [simLoading, setSimLoading] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<Record<string, string>>({});
  const sseRef = useRef<EventSource | null>(null);

  // Add workspace modal state
  const [showAddWs, setShowAddWs] = useState(false);
  const [wsForm, setWsForm] = useState(EMPTY_WS_FORM);
  const [wsLoading, setWsLoading] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsImageFile, setWsImageFile] = useState<File | null>(null);
  const [wsImagePreview, setWsImagePreview] = useState<string | null>(null);
  const [wsImageUploading, setWsImageUploading] = useState(false);

  // Edit workspace modal state
  const [showEditWs, setShowEditWs] = useState(false);
  const [editingWs, setEditingWs] = useState<Workspace | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_WS_FORM);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);
  const [editImageUploading, setEditImageUploading] = useState(false);

  // Org-level QR code (one per org, rotating every 10s)
  const [orgQr, setOrgQr] = useState<{ qr_data: string; expires_in_ms: number; countdown: number } | null>(null);
  const orgQrIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOrgQr = useCallback(async () => {
    try {
      const token = getOrgToken();
      const res = await fetch(`${API}/qr/org`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json() as { qr_data: string; expires_in_ms: number };
        setOrgQr({ ...data, countdown: Math.ceil(data.expires_in_ms / 1000) });
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchOrgQr();
    orgQrIntervalRef.current = setInterval(() => {
      setOrgQr(prev => {
        if (!prev) return prev;
        const next = prev.countdown - 1;
        if (next <= 0) { fetchOrgQr(); return prev; }
        return { ...prev, countdown: next };
      });
    }, 1000);
    return () => { if (orgQrIntervalRef.current) clearInterval(orgQrIntervalRef.current); };
  }, [fetchOrgQr]);

  // Jaie AI chat state
  const [jaieOpen, setJaieOpen] = useState(false);
  const [jaieHistory, setJaieHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [jaieInput, setJaieInput] = useState("");
  const [jaieLoading, setJaieLoading] = useState(false);
  const [jaieStreaming, setJaieStreaming] = useState("");
  const jaieBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!org) { setLocation("/org/signup"); return; }
    loadDashboard();
  }, []);

  useEffect(() => {
    if (activeTab === "wallet") {
      if (!walletAddress) loadWalletBalance();
      else loadUsdcBalance(walletAddress);
    }
    if (activeTab === "devices") {
      loadDevices();
      checkMqttStatus();
      startDeviceSSE();
    } else {
      stopDeviceSSE();
    }
  }, [activeTab]);

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
      if (data.org) {
        saveOrgUser({ ...org!, ...data.org, token: token! });
        if (data.org.ownerWalletAddress) setWalletAddress(data.org.ownerWalletAddress);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadWalletBalance = async () => {
    try {
      const token = getOrgToken();
      const res = await fetch(`${API}/org/wallet-balance`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.walletAddress) {
          setWalletAddress(data.walletAddress);
          loadUsdcBalance(data.walletAddress);
        }
      }
    } catch {}
  };

  const loadUsdcBalance = async (address: string) => {
    setBalanceLoading(true);
    try {
      const res = await fetch(`${API}/wallet/balance?address=${address}`);
      if (res.ok) {
        const data = await res.json();
        setUsdcBalance(data.balance_usdc ?? data.usdc_balance ?? 0);
      }
    } catch {}
    setBalanceLoading(false);
  };

  // ── Device / IoT functions ─────────────────────────────────────────────────
  const loadDevices = async () => {
    setDevicesLoading(true);
    try {
      const token = getOrgToken();
      const res = await fetch(`${API}/devices`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setDevices(await res.json());
    } catch {}
    setDevicesLoading(false);
  };

  const checkMqttStatus = async () => {
    try {
      const token = getOrgToken();
      const res = await fetch(`${API}/devices/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMqttConnected(data.mqttConnected ?? false);
      }
    } catch {}
  };

  const startDeviceSSE = () => {
    if (sseRef.current) return;
    const token = getOrgToken();
    if (!token) return;
    const es = new EventSource(`${API}/devices/events?token=${encodeURIComponent(token)}`);
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type: string; deviceClientId?: string; data?: any };
        if (event.type === "connected") return;
        if (event.type === "telemetry" && event.deviceClientId) {
          setDevices(prev => prev.map(d =>
            d.mqttClientId === event.deviceClientId
              ? {
                  ...d,
                  isOnline: true,
                  powerState: event.data?.power_state ?? d.powerState,
                  currentWatts: event.data?.watts ?? d.currentWatts,
                  voltage: event.data?.voltage ?? d.voltage,
                  currentAmps: event.data?.amps ?? d.currentAmps,
                  temperature: event.data?.temperature ?? d.temperature,
                  lastSeen: new Date().toISOString(),
                }
              : d
          ));
        } else if (event.type === "command" && event.data?.id) {
          setDevices(prev => prev.map(d =>
            d.id === event.data.id ? { ...d, powerState: event.data.powerState } : d
          ));
        } else if (event.type === "status" && event.deviceClientId) {
          setDevices(prev => prev.map(d =>
            d.mqttClientId === event.deviceClientId ? { ...d, isOnline: event.data?.isOnline ?? d.isOnline } : d
          ));
        }
      } catch {}
    };
    sseRef.current = es;
  };

  const stopDeviceSSE = () => {
    sseRef.current?.close();
    sseRef.current = null;
  };

  const addDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeviceFormLoading(true);
    setDeviceFormError(null);
    try {
      const token = getOrgToken();
      const res = await fetch(`${API}/devices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(deviceForm),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      const device = await res.json();
      setDevices(prev => [...prev, device]);
      setDeviceForm(EMPTY_DEVICE_FORM);
      setShowAddDevice(false);
    } catch (err: any) {
      setDeviceFormError(err.message);
    }
    setDeviceFormLoading(false);
  };

  const deleteDevice = async (id: string) => {
    const token = getOrgToken();
    await fetch(`${API}/devices/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setDevices(prev => prev.filter(d => d.id !== id));
  };

  const sendPowerCommand = async (device: Device, action: "on" | "off") => {
    const token = getOrgToken();
    const res = await fetch(`${API}/devices/${device.id}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      const data = await res.json();
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, powerState: data.powerState } : d));
    }
  };

  const simulateTelemetry = async (device: Device) => {
    const form = simForm[device.mqttClientId] ?? { watts: "120", voltage: "220", amps: "0.55", power_state: true, temperature: "38" };
    setSimLoading(device.mqttClientId);
    setSimResult(prev => ({ ...prev, [device.mqttClientId]: "" }));
    try {
      const token = getOrgToken();
      const res = await fetch(`${API}/devices/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mqttClientId: device.mqttClientId,
          watts: parseFloat(form.watts) || 0,
          voltage: parseFloat(form.voltage) || 220,
          amps: parseFloat(form.amps) || 0,
          power_state: form.power_state,
          temperature: form.temperature ? parseFloat(form.temperature) : null,
        }),
      });
      const data = await res.json();
      setSimResult(prev => ({ ...prev, [device.mqttClientId]: res.ok ? "Published!" : (data.error ?? "Error") }));
    } catch {
      setSimResult(prev => ({ ...prev, [device.mqttClientId]: "Network error" }));
    }
    setSimLoading(null);
    setTimeout(() => setSimResult(prev => ({ ...prev, [device.mqttClientId]: "" })), 3000);
  };

  const uploadImage = async (file: File): Promise<string | null> => {
    const token = getOrgToken();
    const form = new FormData();
    form.append("image", file);
    const res = await fetch(`${API}/org/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error("Image upload failed");
    const data = await res.json();
    return data.url ?? null;
  };

  const handleAddWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setWsLoading(true);
    setWsError(null);
    try {
      let imageUrl = wsForm.image_url;
      if (wsImageFile) {
        setWsImageUploading(true);
        imageUrl = (await uploadImage(wsImageFile)) ?? imageUrl;
        setWsImageUploading(false);
      }
      const token = getOrgToken();
      const res = await fetch(`${API}/org/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...wsForm,
          image_url: imageUrl,
          capacity: Number(wsForm.capacity),
          hourly_rate_ngn: Number(wsForm.hourly_rate_ngn),
          floor: Number(wsForm.floor),
          amenities: wsForm.amenities.split(",").map(a => a.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowAddWs(false);
      setWsForm(EMPTY_WS_FORM);
      setWsImageFile(null);
      setWsImagePreview(null);
      loadDashboard();
    } catch (e) {
      setWsError(e instanceof Error ? e.message : String(e));
    } finally {
      setWsLoading(false);
      setWsImageUploading(false);
    }
  };

  const openEditModal = (ws: Workspace) => {
    setEditingWs(ws);
    let amenities = "";
    try { amenities = (JSON.parse(ws.amenities) as string[]).join(", "); } catch { amenities = ws.amenities; }
    setEditForm({
      name: ws.name,
      description: ws.description ?? "",
      capacity: String(ws.capacity),
      hourly_rate_ngn: String(ws.hourlyRateNgn),
      workspace_type: ws.workspaceType,
      floor: "1",
      amenities,
      image_url: ws.imageUrl ?? "",
    });
    setEditImageFile(null);
    setEditImagePreview(ws.imageUrl ?? null);
    setEditError(null);
    setShowEditWs(true);
  };

  const handleEditWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWs) return;
    setEditLoading(true);
    setEditError(null);
    try {
      let imageUrl = editForm.image_url;
      if (editImageFile) {
        setEditImageUploading(true);
        imageUrl = (await uploadImage(editImageFile)) ?? imageUrl;
        setEditImageUploading(false);
      }
      const token = getOrgToken();
      const res = await fetch(`${API}/org/workspaces/${editingWs.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: editForm.name,
          description: editForm.description,
          capacity: Number(editForm.capacity),
          hourly_rate_ngn: Number(editForm.hourly_rate_ngn),
          amenities: editForm.amenities.split(",").map(a => a.trim()).filter(Boolean),
          image_url: imageUrl,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowEditWs(false);
      setEditingWs(null);
      loadDashboard();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
    } finally {
      setEditLoading(false);
      setEditImageUploading(false);
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
    setJaieStreaming("");

    try {
      const token = getOrgToken();
      const res = await fetch(`${API}/jaie/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, history: jaieHistory.slice(-10) }),
      });

      if (!res.ok || !res.body) throw new Error("Connection failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "text") {
              accumulated += event.content;
              setJaieStreaming(accumulated);
              setTimeout(() => jaieBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 10);
            } else if (event.type === "done") {
              setJaieHistory(h => [...h, { role: "assistant", content: event.full_response ?? accumulated }]);
              setJaieStreaming("");
            } else if (event.type === "error") {
              setJaieHistory(h => [...h, { role: "assistant", content: "Something went wrong. Please try again." }]);
              setJaieStreaming("");
            }
          } catch {}
        }
      }
    } catch {
      setJaieHistory(h => [...h, { role: "assistant", content: "Connection error. Please try again." }]);
      setJaieStreaming("");
    } finally {
      setJaieLoading(false);
      setTimeout(() => jaieBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  const copyWallet = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress).then(() => {
        setWalletCopied(true);
        setTimeout(() => setWalletCopied(false), 2000);
      });
    }
  };

  const kycBadge = KYC_BADGE[org?.kycStatus ?? "pending"];
  if (!org) return null;

  const ImageUploadField = ({
    label,
    file,
    preview,
    onFile,
    onPreview,
  }: {
    label: string;
    file: File | null;
    preview: string | null;
    onFile: (f: File | null) => void;
    onPreview: (p: string | null) => void;
  }) => (
    <div>
      <label className="text-gray-400 text-sm block mb-1">{label}</label>
      {preview && (
        <div className="relative mb-2">
          <img src={preview} alt="preview" className="w-full h-28 object-cover rounded-xl" />
          <button
            type="button"
            onClick={() => { onFile(null); onPreview(null); }}
            className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/70 hover:bg-black rounded-full flex items-center justify-center text-white text-xs"
          >✕</button>
        </div>
      )}
      <label className="block w-full cursor-pointer">
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={ev => {
            const f = ev.target.files?.[0] ?? null;
            onFile(f);
            if (f) {
              const reader = new FileReader();
              reader.onload = () => onPreview(reader.result as string);
              reader.readAsDataURL(f);
            }
          }}
        />
        <div className="w-full bg-[#1a1a1a] border border-dashed border-white/20 hover:border-purple-500/50 rounded-xl px-4 py-3 text-gray-600 text-sm text-center transition-all">
          {file ? `📷 ${file.name}` : "Click to upload image"}
        </div>
      </label>
    </div>
  );

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
          {(["overview", "workspaces", "bookings", "wallet", "devices"] as const).map(tab => (
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

        {/* OVERVIEW TAB */}
        {!loading && activeTab === "overview" && metrics && (
          <>
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

            {/* ── Org QR Code ───────────────────────────────────────────────── */}
            <div
              className="rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-center gap-6"
              style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)" }}
            >
              <div className="flex flex-col items-center gap-2 shrink-0">
                <p className="text-xs text-purple-300 font-semibold tracking-wide uppercase">Entrance QR Code</p>
                {orgQr ? (
                  <>
                    <div className="bg-white p-3 rounded-xl">
                      <QRCodeSVG
                        value={`${window.location.origin}/scan?qr=${orgQr.qr_data}`}
                        size={160}
                        level="M"
                        includeMargin={false}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full animate-pulse"
                        style={{ background: orgQr.countdown <= 3 ? "#ef4444" : "#22c55e" }}
                      />
                      <p className="text-xs text-gray-400">
                        {orgQr.countdown > 0 ? `Refreshes in ${orgQr.countdown}s` : "Refreshing…"}
                      </p>
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
        )}

        {/* WORKSPACES TAB */}
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
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(ws)}
                        className="flex-1 py-2 text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-xl transition-all"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* BOOKINGS TAB */}
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
                            <a href={`https://explorer.solana.com/tx/${b.escrowTxSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-purple-400 text-xs hover:underline">
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

        {/* WALLET TAB */}
        {!loading && activeTab === "wallet" && (
          <div className="space-y-6">
            <h2 className="text-white text-xl font-semibold">Settlement Wallet</h2>

            {/* Wallet address card */}
            <div className="bg-[#111] border border-white/10 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/20 flex items-center justify-center text-xl">◎</div>
                <div>
                  <p className="text-white font-medium">Solana Wallet</p>
                  <p className="text-gray-500 text-xs">USDC settlements are sent here automatically</p>
                </div>
              </div>

              {walletAddress ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-3">
                    <span className="flex-1 text-gray-300 font-mono text-xs break-all">{walletAddress}</span>
                    <button
                      onClick={copyWallet}
                      className="ml-2 px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 text-xs rounded-lg transition-all whitespace-nowrap"
                    >
                      {walletCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>

                  {/* Live USDC Balance */}
                  <div className="flex items-center justify-between bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-gray-500 text-xs mb-0.5">Current USDC Balance</p>
                      {balanceLoading ? (
                        <div className="w-16 h-5 bg-white/10 rounded animate-pulse" />
                      ) : usdcBalance !== null ? (
                        <p className="text-white font-bold text-lg">${usdcBalance.toFixed(4)} <span className="text-gray-500 text-xs font-normal">USDC</span></p>
                      ) : (
                        <p className="text-gray-500 text-xs">Unable to fetch balance</p>
                      )}
                    </div>
                    <button
                      onClick={() => walletAddress && loadUsdcBalance(walletAddress)}
                      className="text-gray-600 hover:text-gray-400 transition-all p-1.5 rounded-lg hover:bg-white/5"
                      title="Refresh balance"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    </button>
                  </div>

                  <a
                    href={`https://explorer.solana.com/address/${walletAddress}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-purple-400 text-sm hover:text-purple-300 transition-all"
                  >
                    View on Solana Explorer ↗
                  </a>
                </div>
              ) : (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4">
                  <p className="text-yellow-400 text-sm font-medium">No wallet linked yet</p>
                  <p className="text-gray-500 text-xs mt-1">Your settlement wallet is created when you sign up via Web3Auth. Complete onboarding to activate it.</p>
                </div>
              )}
            </div>

            {/* How settlements work */}
            <div className="bg-[#111] border border-white/10 rounded-2xl p-6">
              <h3 className="text-white font-medium mb-4">How settlements work</h3>
              <div className="space-y-3">
                {[
                  { step: "1", label: "User pays in NGN via Paystack", detail: "Converted to USDC at 1608 NGN/USDC" },
                  { step: "2", label: "USDC held in escrow vault", detail: "Locked on-chain for the session duration" },
                  { step: "3", label: "User scans out (checkout)", detail: "Session ends, billing calculated per second" },
                  { step: "4", label: "85% sent to your wallet", detail: "On-chain USDC transfer, memo: JAIRE|SETTLE|…|85PCT" },
                ].map(s => (
                  <div key={s.step} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400 text-xs font-bold flex-shrink-0 mt-0.5">{s.step}</div>
                    <div>
                      <p className="text-white text-sm">{s.label}</p>
                      <p className="text-gray-600 text-xs">{s.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Revenue summary */}
            {metrics && (
              <div className="bg-[#111] border border-white/10 rounded-2xl p-6">
                <h3 className="text-white font-medium mb-4">Revenue Summary</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-gray-500 text-xs mb-1">Total Earned (USDC)</p>
                    <p className="text-white text-2xl font-bold">${metrics.revenue_usdc.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs mb-1">Completed Sessions</p>
                    <p className="text-white text-2xl font-bold">{metrics.total_bookings}</p>
                  </div>
                </div>
                <p className="text-gray-600 text-xs mt-4">JaIre retains 15% as a platform fee. Your 85% is settled on-chain automatically at each checkout.</p>
              </div>
            )}
          </div>
        )}
        {/* ── Devices Tab ─────────────────────────────────────────────────── */}
        {!loading && activeTab === "devices" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-white text-xl font-semibold">IoT Devices</h2>
                <p className="text-gray-500 text-xs mt-0.5">Smart plugs and power monitors connected via MQTT</p>
              </div>
              <div className="flex items-center gap-3">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${mqttConnected ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${mqttConnected ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
                  MQTT {mqttConnected ? "Connected" : "Connecting…"}
                </div>
                <button
                  onClick={() => setShowAddDevice(true)}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-all"
                >
                  + Add Device
                </button>
              </div>
            </div>

            {/* MQTT Broker Info */}
            <div className="bg-[#111] border border-white/10 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 text-sm flex-shrink-0">📡</div>
                <div>
                  <p className="text-white text-sm font-medium">Connected to HiveMQ Public Broker</p>
                  <p className="text-gray-500 text-xs mt-0.5">Topics: <code className="text-purple-400 bg-purple-500/10 px-1 rounded">jaire/devices/{"<orgId>"}/{"<deviceId>"}/telemetry</code> · Real hardware connects to the same broker using your org ID.</p>
                </div>
              </div>
            </div>

            {/* Device Cards */}
            {devicesLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : devices.length === 0 ? (
              <div className="bg-[#111] border border-white/10 rounded-2xl p-10 text-center">
                <div className="text-4xl mb-3">🔌</div>
                <p className="text-white font-medium mb-1">No devices yet</p>
                <p className="text-gray-500 text-sm">Add a smart plug or power monitor to start tracking energy usage per workspace.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {devices.map(device => {
                  const ws = workspaces.find(w => w.id === device.workspaceId);
                  const isSim = simExpanded === device.mqttClientId;
                  const sForm = simForm[device.mqttClientId] ?? { watts: "120", voltage: "220", amps: "0.55", power_state: true, temperature: "38" };
                  return (
                    <div key={device.id} className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden">
                      {/* Device Header */}
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 transition-all ${device.powerState ? "bg-green-500/15 border border-green-500/20" : "bg-white/5 border border-white/10"}`}>
                              🔌
                            </div>
                            <div>
                              <p className="text-white font-medium">{device.deviceName}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${device.isOnline ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-gray-500/10 border-gray-500/20 text-gray-500"}`}>
                                  <span className={`w-1 h-1 rounded-full ${device.isOnline ? "bg-green-400 animate-pulse" : "bg-gray-500"}`} />
                                  {device.isOnline ? "Online" : "Offline"}
                                </span>
                                {ws && <span className="text-gray-600 text-xs">{ws.name}</span>}
                                <span className="text-gray-700 text-xs capitalize">{device.deviceType.replace("_", " ")}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Power toggle */}
                            <button
                              onClick={() => sendPowerCommand(device, device.powerState ? "off" : "on")}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${device.powerState ? "bg-green-500/15 border-green-500/30 text-green-400 hover:bg-green-500/25" : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"}`}
                            >
                              {device.powerState ? "ON" : "OFF"}
                            </button>
                            <button
                              onClick={() => deleteDevice(device.id)}
                              className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                            </button>
                          </div>
                        </div>

                        {/* Telemetry readings */}
                        {device.isOnline && (
                          <div className="grid grid-cols-4 gap-3 mt-4">
                            {[
                              { label: "Power", value: device.currentWatts != null ? `${device.currentWatts.toFixed(1)}W` : "—" },
                              { label: "Voltage", value: device.voltage != null ? `${device.voltage.toFixed(0)}V` : "—" },
                              { label: "Current", value: device.currentAmps != null ? `${device.currentAmps.toFixed(2)}A` : "—" },
                              { label: "Temp", value: device.temperature != null ? `${device.temperature.toFixed(0)}°C` : "—" },
                            ].map(m => (
                              <div key={m.label} className="bg-[#0d0d0d] border border-white/5 rounded-xl p-3 text-center">
                                <p className="text-gray-600 text-xs mb-1">{m.label}</p>
                                <p className="text-white font-mono text-sm font-bold">{m.value}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {device.lastSeen && (
                          <p className="text-gray-700 text-xs mt-3">Last seen: {new Date(device.lastSeen).toLocaleTimeString()}</p>
                        )}
                      </div>

                      {/* Simulator panel */}
                      <div className="border-t border-white/5">
                        <button
                          onClick={() => setSimExpanded(isSim ? null : device.mqttClientId)}
                          className="w-full flex items-center justify-between px-5 py-3 text-gray-500 hover:text-gray-300 hover:bg-white/3 transition-all text-xs"
                        >
                          <span className="flex items-center gap-2">
                            <span className="text-yellow-500">⚗</span>
                            Device Simulator — test without hardware
                          </span>
                          <span>{isSim ? "▲" : "▼"}</span>
                        </button>

                        {isSim && (
                          <div className="px-5 pb-5 bg-[#0a0a0a] space-y-4">
                            <p className="text-gray-600 text-xs pt-3">Publishes a fake MQTT telemetry message as if this device sent it. Updates the dashboard live.</p>
                            <div className="grid grid-cols-2 gap-3">
                              {[
                                { key: "watts", label: "Watts", placeholder: "120" },
                                { key: "voltage", label: "Voltage (V)", placeholder: "220" },
                                { key: "amps", label: "Current (A)", placeholder: "0.55" },
                                { key: "temperature", label: "Temp (°C)", placeholder: "38" },
                              ].map(field => (
                                <div key={field.key}>
                                  <label className="text-gray-600 text-xs block mb-1">{field.label}</label>
                                  <input
                                    type="number"
                                    placeholder={field.placeholder}
                                    value={(sForm as any)[field.key]}
                                    onChange={e => setSimForm(prev => ({ ...prev, [device.mqttClientId]: { ...sForm, [field.key]: e.target.value } }))}
                                    className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50"
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <div
                                  onClick={() => setSimForm(prev => ({ ...prev, [device.mqttClientId]: { ...sForm, power_state: !sForm.power_state } }))}
                                  className={`w-9 h-5 rounded-full transition-all relative cursor-pointer ${sForm.power_state ? "bg-green-500" : "bg-white/20"}`}
                                >
                                  <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all ${sForm.power_state ? "left-[18px]" : "left-[3px]"}`} />
                                </div>
                                <span className="text-gray-400 text-xs">Power state: {sForm.power_state ? "ON" : "OFF"}</span>
                              </label>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-gray-600 text-xs font-mono bg-[#111] border border-white/5 rounded-lg px-3 py-2 flex-1 truncate">
                                Topic: jaire/devices/org/{device.mqttClientId}/telemetry
                              </div>
                              <button
                                onClick={() => simulateTelemetry(device)}
                                disabled={simLoading === device.mqttClientId}
                                className="px-4 py-2 bg-yellow-500/15 hover:bg-yellow-500/25 border border-yellow-500/30 text-yellow-400 text-sm font-medium rounded-xl transition-all disabled:opacity-50 whitespace-nowrap"
                              >
                                {simLoading === device.mqttClientId ? "Publishing…" : "Publish Telemetry"}
                              </button>
                            </div>
                            {simResult[device.mqttClientId] && (
                              <p className={`text-xs font-medium ${simResult[device.mqttClientId] === "Published!" ? "text-green-400" : "text-red-400"}`}>
                                {simResult[device.mqttClientId] === "Published!" ? "✓" : "✗"} {simResult[device.mqttClientId]}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add Device Modal */}
            {showAddDevice && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                  <h3 className="text-white font-semibold mb-4">Register IoT Device</h3>
                  <form onSubmit={addDevice} className="space-y-4">
                    <div>
                      <label className="text-gray-400 text-xs block mb-1">Device Name</label>
                      <input
                        required
                        placeholder="e.g. Plug — Desk Row A"
                        value={deviceForm.deviceName}
                        onChange={e => setDeviceForm(p => ({ ...p, deviceName: e.target.value }))}
                        className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs block mb-1">Device Type</label>
                      <select
                        value={deviceForm.deviceType}
                        onChange={e => setDeviceForm(p => ({ ...p, deviceType: e.target.value }))}
                        className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50"
                      >
                        <option value="smart_plug">Smart Plug</option>
                        <option value="power_monitor">Power Monitor</option>
                        <option value="smart_breaker">Smart Breaker</option>
                        <option value="env_sensor">Environmental Sensor</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs block mb-1">Workspace (optional)</label>
                      <select
                        value={deviceForm.workspaceId}
                        onChange={e => setDeviceForm(p => ({ ...p, workspaceId: e.target.value }))}
                        className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50"
                      >
                        <option value="">— Not assigned —</option>
                        {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-gray-400 text-xs block mb-1">MQTT Client ID</label>
                      <input
                        required
                        placeholder="e.g. plug-ws001-a"
                        value={deviceForm.mqttClientId}
                        onChange={e => setDeviceForm(p => ({ ...p, mqttClientId: e.target.value }))}
                        className="w-full bg-[#0d0d0d] border border-white/10 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-purple-500/50"
                      />
                      <p className="text-gray-600 text-xs mt-1">Used as the device identifier in MQTT topics. Must be unique per device.</p>
                    </div>
                    {deviceFormError && <p className="text-red-400 text-xs">{deviceFormError}</p>}
                    <div className="flex gap-3 pt-2">
                      <button type="button" onClick={() => { setShowAddDevice(false); setDeviceFormError(null); }} className="flex-1 py-2.5 border border-white/10 text-gray-400 rounded-xl text-sm hover:bg-white/5 transition-all">Cancel</button>
                      <button type="submit" disabled={deviceFormLoading} className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-50">
                        {deviceFormLoading ? "Registering…" : "Register Device"}
                      </button>
                    </div>
                  </form>
                </div>
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

          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] max-h-[360px]">
            {jaieHistory.length === 0 && !jaieStreaming && (
              <div className="text-center py-6">
                <p className="text-gray-500 text-sm">Hey! I'm Jaie — ask me anything about your workspaces, revenue, or how JaIre works. I can also take actions for you.</p>
                <div className="mt-4 flex flex-col gap-2">
                  {[
                    "How does my 85% settlement work?",
                    "Turn off my first workspace",
                    "Which workspace is performing best?",
                  ].map(q => (
                    <button key={q} onClick={() => setJaieInput(q)} className="text-xs text-purple-400 hover:text-purple-300 border border-purple-500/20 hover:border-purple-500/40 rounded-lg px-3 py-1.5 transition-all text-left">{q}</button>
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
            {jaieStreaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-white/8 border border-white/8 rounded-xl px-3 py-2 text-sm text-gray-200 leading-relaxed">
                  {jaieStreaming}
                  <span className="inline-block w-1.5 h-4 ml-0.5 bg-purple-400 rounded-sm animate-pulse align-middle" />
                </div>
              </div>
            )}
            {jaieLoading && !jaieStreaming && (
              <div className="flex justify-start">
                <div className="bg-white/8 border border-white/8 rounded-xl px-3 py-2 flex gap-1">
                  {[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                </div>
              </div>
            )}
            <div ref={jaieBottomRef} />
          </div>

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
              <button onClick={() => { setShowAddWs(false); setWsImageFile(null); setWsImagePreview(null); }} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
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
              <ImageUploadField
                label="Workspace Photo"
                file={wsImageFile}
                preview={wsImagePreview}
                onFile={setWsImageFile}
                onPreview={setWsImagePreview}
              />
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowAddWs(false); setWsImageFile(null); setWsImagePreview(null); }} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white text-sm rounded-xl transition-all">Cancel</button>
                <button type="submit" disabled={wsLoading || wsImageUploading} className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50">
                  {wsImageUploading ? "Uploading..." : wsLoading ? "Adding..." : "Add Workspace"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Workspace Modal */}
      {showEditWs && editingWs && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-semibold text-lg">Edit Workspace</h3>
              <button onClick={() => { setShowEditWs(false); setEditImageFile(null); setEditImagePreview(null); }} className="text-gray-500 hover:text-gray-300">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {editError && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{editError}</div>}

            <form onSubmit={handleEditWorkspace} className="space-y-4">
              <div>
                <label className="text-gray-400 text-sm block mb-1">Name *</label>
                <input required value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm" />
              </div>
              <div>
                <label className="text-gray-400 text-sm block mb-1">Description</label>
                <textarea rows={2} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Capacity (seats)</label>
                  <input type="number" min="1" value={editForm.capacity} onChange={e => setEditForm(f => ({ ...f, capacity: e.target.value }))} className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm" />
                </div>
                <div>
                  <label className="text-gray-400 text-sm block mb-1">Hourly Rate (₦) *</label>
                  <input required type="number" min="100" value={editForm.hourly_rate_ngn} onChange={e => setEditForm(f => ({ ...f, hourly_rate_ngn: e.target.value }))} className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-sm block mb-1">Amenities (comma-separated)</label>
                <input value={editForm.amenities} onChange={e => setEditForm(f => ({ ...f, amenities: e.target.value }))} className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm" />
              </div>
              <ImageUploadField
                label="Workspace Photo"
                file={editImageFile}
                preview={editImagePreview}
                onFile={setEditImageFile}
                onPreview={setEditImagePreview}
              />
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowEditWs(false); setEditImageFile(null); setEditImagePreview(null); }} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white text-sm rounded-xl transition-all">Cancel</button>
                <button type="submit" disabled={editLoading || editImageUploading} className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50">
                  {editImageUploading ? "Uploading..." : editLoading ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
