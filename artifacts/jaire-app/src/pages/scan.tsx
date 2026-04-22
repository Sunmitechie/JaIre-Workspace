import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Html5Qrcode } from "html5-qrcode";
import { getUser } from "@/lib/auth";
import { formatNGN } from "@/lib/currency";
import { QrCode, CheckCircle, XCircle, Camera } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

type ScanState = "idle" | "scanning" | "processing" | "success" | "error";

export default function Scan() {
  const [, setLocation] = useLocation();
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [resultMsg, setResultMsg] = useState("");
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [hasActiveSession, setHasActiveSession] = useState<boolean | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const didScan = useRef(false);
  const didAutoScan = useRef(false);

  // ── On mount: check active session, auto-process ?qr= param if present ──
  useEffect(() => {
    checkActiveSession().then(() => {
      // After session check resolves, handle ?qr= if present
      const params = new URLSearchParams(window.location.search);
      const qrParam = params.get("qr");
      if (qrParam && !didAutoScan.current) {
        didAutoScan.current = true;
        handleQRData(qrParam);
      }
    });
  }, []);

  async function checkActiveSession(): Promise<void> {
    try {
      const res = await fetch(`${BASE_URL}/api/bookings?status=active`);
      if (res.ok) {
        const data = await res.json();
        const user = getUser();
        const uid = user?.id ?? "guest";
        const active = (data as any[]).find((b: any) => b.user_id === uid || b.status === "active");
        setHasActiveSession(!!active);
      } else {
        setHasActiveSession(false);
      }
    } catch {
      setHasActiveSession(false);
    }
  }

  // ── Camera: start AFTER the DOM element renders (useEffect on scanState) ──
  useEffect(() => {
    if (scanState !== "scanning") return;

    // Tiny delay to ensure #qr-reader div is in the DOM
    const t = setTimeout(() => {
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;

      scanner
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          async (decoded) => {
            if (didScan.current) return;
            didScan.current = true;
            await stopScanner();
            // If the decoded value is a URL with ?qr= param, extract it
            const qrData = extractQrParam(decoded);
            await handleQRData(qrData);
          },
          () => {}
        )
        .catch(() => {
          setScanState("error");
          setResultMsg("Camera permission denied. Please allow camera access and try again.");
        });
    }, 100);

    return () => clearTimeout(t);
  }, [scanState]);

  function extractQrParam(decoded: string): string {
    try {
      const url = new URL(decoded);
      const qp = url.searchParams.get("qr");
      if (qp) return qp;
    } catch {}
    return decoded;
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

    // Re-read active session fresh to make sure we use the right endpoint
    let activeSession = hasActiveSession;
    if (activeSession === null) {
      try {
        const res = await fetch(`${BASE_URL}/api/bookings?status=active`);
        if (res.ok) {
          const data = await res.json();
          const uid = user?.id ?? "guest";
          activeSession = (data as any[]).some((b: any) => b.user_id === uid || b.status === "active");
          setHasActiveSession(activeSession);
        }
      } catch {}
    }

    try {
      const endpoint = activeSession ? "/api/qr/checkout" : "/api/qr/checkin";
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qr_data: qrData,
          user_id: user?.email ?? user?.id ?? "guest",
          user_name: user?.name ?? "JaIre Member",
          user_email: user?.email,
          user_wallet_address: user?.walletAddress ?? undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setScanState("error");
        setResultMsg(data.error || "QR scan failed. Please try again.");
        return;
      }

      setScanState("success");
      if (activeSession) {
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

      {(scanState === "idle" || scanState === "scanning") && (
        <div className="space-y-4">
          {scanState === "idle" && (
            <button
              onClick={() => { didScan.current = false; setScanState("scanning"); }}
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
          )}

          {scanState === "scanning" && (
            <>
              <div
                className="rounded-2xl overflow-hidden relative"
                style={{ border: "1px solid rgba(255,170,0,0.3)" }}
              >
                {/* This div MUST exist in the DOM before Html5Qrcode.start() is called */}
                <div id="qr-reader" className="w-full" />
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
            </>
          )}
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
            onClick={() => { setScanState("idle"); didScan.current = false; didAutoScan.current = false; }}
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
