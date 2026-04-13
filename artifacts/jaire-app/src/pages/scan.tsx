import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Html5Qrcode } from "html5-qrcode";
import { getUser } from "@/lib/auth";
import { formatNGN } from "@/lib/currency";
import { QrCode, CheckCircle, XCircle, Camera, ChevronDown, ChevronUp } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

type ScanState = "idle" | "scanning" | "processing" | "success" | "error";

interface DemoQR {
  workspace_id: string;
  workspace_name: string;
  qr_data: string;
  expires_in_ms: number;
}

export default function Scan() {
  const [, setLocation] = useLocation();
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [resultMsg, setResultMsg] = useState("");
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [hasActiveSession, setHasActiveSession] = useState<boolean | null>(null);
  const [demoQRs, setDemoQRs] = useState<DemoQR[]>([]);
  const [showDemo, setShowDemo] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const didScan = useRef(false);

  useEffect(() => {
    checkActiveSession();
    loadDemoQRs();
  }, []);

  async function checkActiveSession() {
    try {
      const res = await fetch(`${BASE_URL}/api/bookings?status=active`);
      if (res.ok) {
        const data = await res.json();
        const user = getUser();
        const uid = user?.id ?? "guest";
        const active = (data as any[]).find((b: any) => b.user_id === uid || b.status === "active");
        setHasActiveSession(!!active);
      }
    } catch {
      setHasActiveSession(false);
    }
  }

  async function loadDemoQRs() {
    const wsIds = ["ws-001", "ws-002", "ws-003"];
    const results: DemoQR[] = [];
    for (const id of wsIds) {
      try {
        const res = await fetch(`${BASE_URL}/api/qr/generate/${id}`);
        if (res.ok) {
          const data = await res.json();
          results.push(data as DemoQR);
        }
      } catch {}
    }
    setDemoQRs(results);
  }

  function startScanner() {
    setScanState("scanning");
    didScan.current = false;

    const scanner = new Html5Qrcode("qr-video-element");
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        async (decoded) => {
          if (didScan.current) return;
          didScan.current = true;
          await stopScanner();
          await handleQRData(decoded);
        },
        () => {}
      )
      .catch(() => {
        setScanState("error");
        setResultMsg("Camera permission denied. Please allow camera access and try again.");
      });
  }

  async function stopScanner() {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        scannerRef.current = null;
      }
    } catch {}
  }

  async function handleQRData(qrData: string) {
    setScanState("processing");
    const user = getUser();

    try {
      const endpoint = hasActiveSession ? "/api/qr/checkout" : "/api/qr/checkin";
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qr_data: qrData,
          user_id: user?.id ?? "guest",
          user_name: user?.name ?? "JaIre Member",
          user_email: user?.email,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setScanState("error");
        setResultMsg(data.error || "QR scan failed. Please try again.");
        return;
      }

      setScanState("success");
      if (hasActiveSession) {
        const ngn = data.billed_ngn ?? 0;
        setResultMsg(
          `Checked out from ${data.workspace_name}.\n${data.duration_display} · ${formatNGN(ngn)} billed.`
        );
        setBookingId(data.booking_id);
      } else {
        setResultMsg(`Checked in to ${data.workspace_name}.\nBilling starts now.`);
        setBookingId(data.booking_id);
      }
    } catch {
      setScanState("error");
      setResultMsg("Network error. Please check your connection and try again.");
    }
  }

  async function handleDemoScan(qrData: string) {
    if (scanState === "processing") return;
    await handleQRData(qrData);
  }

  useEffect(() => {
    return () => { stopScanner(); };
  }, []);

  const isCheckin = !hasActiveSession;

  return (
    <div className="flex-1 max-w-md mx-auto w-full px-4 py-8">
      <div className="text-center mb-8">
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
          style={{
            background: isCheckin ? "rgba(255,170,0,0.12)" : "rgba(239,68,68,0.12)",
            border: isCheckin ? "1px solid rgba(255,170,0,0.3)" : "1px solid rgba(239,68,68,0.3)",
          }}
        >
          <QrCode className="w-6 h-6" style={{ color: isCheckin ? "hsl(43 100% 50%)" : "#ef4444" }} />
        </div>
        <h1 className="text-2xl font-bold mb-1">
          {hasActiveSession === null ? "Loading…" : isCheckin ? "Check In" : "Check Out"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {hasActiveSession === null
            ? "Checking your session status…"
            : isCheckin
            ? "Scan the QR code at the workspace entrance"
            : "Scan the QR code to end your session"}
        </p>
      </div>

      {scanState === "idle" && (
        <div className="space-y-4">
          <button
            onClick={startScanner}
            className="w-full h-14 rounded-xl text-base font-semibold flex items-center justify-center gap-2.5 transition-all hover:scale-[1.01]"
            style={
              isCheckin
                ? {
                    background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                    color: "hsl(220 40% 5%)",
                  }
                : {
                    background: "rgba(239,68,68,0.15)",
                    color: "#ef4444",
                    border: "1px solid rgba(239,68,68,0.3)",
                  }
            }
          >
            <Camera className="w-5 h-5" />
            Open Camera
          </button>

          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <button
              className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white/3 transition-colors"
              onClick={() => {
                setShowDemo((v) => !v);
                if (!showDemo) loadDemoQRs();
              }}
            >
              <span className="flex items-center gap-2">
                <QrCode className="w-4 h-4" />
                Test with demo workspace QR
              </span>
              {showDemo ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showDemo && (
              <div className="px-4 pb-4 space-y-2">
                <p className="text-xs text-muted-foreground mb-3">
                  Tap a workspace below to simulate scanning its QR code.
                </p>
                {demoQRs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Loading workspaces…</p>
                ) : (
                  demoQRs.map((q) => (
                    <button
                      key={q.workspace_id}
                      onClick={() => handleDemoScan(q.qr_data)}
                      disabled={scanState === "processing"}
                      className="w-full px-4 py-3 rounded-xl text-left text-sm flex items-center gap-3 transition-all hover:bg-white/5 disabled:opacity-50"
                      style={{
                        background: "rgba(255,170,0,0.05)",
                        border: "1px solid rgba(255,170,0,0.15)",
                      }}
                    >
                      <QrCode className="w-4 h-4 text-primary shrink-0" />
                      <span className="font-medium">{q.workspace_name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">tap to scan</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {scanState === "scanning" && (
        <div className="space-y-4">
          <div
            className="rounded-2xl overflow-hidden relative"
            style={{ border: "1px solid rgba(255,170,0,0.3)" }}
          >
            <div id="qr-video-element" className="w-full" />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                boxShadow: "inset 0 0 0 2px rgba(255,170,0,0.4)",
                borderRadius: "1rem",
              }}
            />
          </div>
          <button
            onClick={async () => { await stopScanner(); setScanState("idle"); }}
            className="w-full h-12 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            Cancel
          </button>
        </div>
      )}

      {scanState === "processing" && (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div
            className="w-14 h-14 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(255,170,0,0.2)", borderTopColor: "hsl(43 100% 50%)" }}
          />
          <p className="text-sm text-muted-foreground">Processing…</p>
        </div>
      )}

      {scanState === "success" && (
        <div className="space-y-4">
          <div
            className="rounded-2xl p-6 text-center"
            style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)" }}
          >
            <CheckCircle className="w-12 h-12 mx-auto mb-4 text-emerald-400" />
            <h2 className="font-bold text-lg mb-2">
              {isCheckin ? "Checked In!" : "Checked Out!"}
            </h2>
            <p className="text-sm text-muted-foreground whitespace-pre-line">{resultMsg}</p>
          </div>

          {bookingId && (
            <button
              onClick={() => setLocation(`/session/${bookingId}`)}
              className="w-full h-12 rounded-xl text-sm font-semibold transition-all hover:scale-[1.01]"
              style={{
                background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
                color: "hsl(220 40% 5%)",
              }}
            >
              View Session
            </button>
          )}

          <button
            onClick={() => { setScanState("idle"); setBookingId(null); checkActiveSession(); }}
            className="w-full h-12 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            Done
          </button>
        </div>
      )}

      {scanState === "error" && (
        <div className="space-y-4">
          <div
            className="rounded-2xl p-6 text-center"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}
          >
            <XCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
            <h2 className="font-bold text-lg mb-2">Scan Failed</h2>
            <p className="text-sm text-muted-foreground">{resultMsg}</p>
          </div>
          <button
            onClick={() => { setScanState("idle"); didScan.current = false; }}
            className="w-full h-12 rounded-xl text-sm font-semibold transition-all hover:scale-[1.01]"
            style={{
              background: "linear-gradient(135deg, hsl(43 100% 50%) 0%, hsl(38 100% 44%) 100%)",
              color: "hsl(220 40% 5%)",
            }}
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
