import { useState, useEffect, useRef, useCallback } from "react";
      <OrgJaieChat
        open={jaieOpen}
        setOpen={setJaieOpen}
        history={jaieHistory}
        input={jaieInput}
        setInput={setJaieInput}
        loading={jaieLoading}
        streaming={jaieStreaming}
        bottomRef={jaieBottomRef}
        onSubmit={sendJaieMessage}
      />
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
  }, [activeTab]);

  async function loadDashboard() {
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
  }

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

        {!loading && activeTab === "overview" && metrics && (
          <OrgOverviewTab org={org} metrics={metrics} recentBookings={recentBookings} orgQr={orgQr} setLocation={setLocation} />
        )}

        {!loading && activeTab === "workspaces" && (
          <OrgWorkspacesTab
            workspaces={workspaces}
            orgKycStatus={org.kycStatus}
            setShowAddWs={setShowAddWs}
            openEditModal={openEditModal}
            toggleAvailability={toggleAvailability}
          />
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
        {!loading && activeTab === "devices" && (
          <OrgDevicesTab
            devices={devices}
            devicesLoading={devicesLoading}
            workspaces={workspaces}
            mqttConnected={mqttConnected}
            simExpanded={simExpanded}
            setSimExpanded={setSimExpanded}
            simForm={simForm}
            setSimForm={setSimForm}
            simLoading={simLoading}
            simResult={simResult}
            setShowAddDevice={setShowAddDevice}
            sendPowerCommand={sendPowerCommand}
            deleteDevice={deleteDevice}
            simulateTelemetry={simulateTelemetry}
          />
        )}
      </div>

      <OrgJaieChat
        open={jaieOpen}
        setOpen={setJaieOpen}
        history={jaieHistory}
        input={jaieInput}
        setInput={setJaieInput}
        loading={jaieLoading}
        streaming={jaieStreaming}
        bottomRef={jaieBottomRef}
        onSubmit={sendJaieMessage}
      />

      <OrgWorkspaceModals actions={workspaceActions} />
    </div>
  );
}
