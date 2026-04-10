// ── process.nextTick polyfill ─────────────────────────────────────────────────
// Web3Auth's readable-stream dependency calls process.nextTick.
// vite-plugin-node-polyfills provides `process` but some bundled chunks load
// their own copy via require('process'). Patch it globally here first.
if (typeof process !== "undefined" && typeof process.nextTick !== "function") {
  (process as any).nextTick = (fn: (...a: unknown[]) => void, ...args: unknown[]) => {
    Promise.resolve().then(() => fn(...args));
  };
}
// ─────────────────────────────────────────────────────────────────────────────

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Suppress known Web3Auth internal browser errors ──────────────────────────
// These errors come from Web3Auth's internal stream/provider cleanup and do NOT
// affect app functionality. Without this, Vite's runtime-error-modal displays
// a crash screen unnecessarily.
const SUPPRESSED_MESSAGES = [
  "process2.nextTick is not a function",
  "Cannot read properties of undefined (reading 'isConnected')",
  "Failed to connect with wallet. Wallet connector is not ready yet",
  "WalletLoginError",
];

function isSuppressed(message: string): boolean {
  return SUPPRESSED_MESSAGES.some((m) => message.includes(m));
}

window.addEventListener("unhandledrejection", (event) => {
  const msg =
    (event.reason instanceof Error ? event.reason.message : String(event.reason ?? "")) || "";
  if (isSuppressed(msg)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
});

window.addEventListener(
  "error",
  (event) => {
    const msg = event.message || "";
    if (isSuppressed(msg)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);
// ─────────────────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")!).render(<App />);
