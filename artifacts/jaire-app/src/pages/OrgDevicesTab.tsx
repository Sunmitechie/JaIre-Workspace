import type { Device, Workspace } from "./org-dashboard";

type Props = {
  devices: Device[];
  devicesLoading: boolean;
  workspaces: Workspace[];
  mqttConnected: boolean;
  simExpanded: string | null;
  setSimExpanded: (id: string | null) => void;
  simForm: Record<string, { watts: string; voltage: string; amps: string; power_state: boolean; temperature: string }>;
  setSimForm: (updater: (prev: Record<string, { watts: string; voltage: string; amps: string; power_state: boolean; temperature: string }>) => Record<string, { watts: string; voltage: string; amps: string; power_state: boolean; temperature: string }>) => void;
  simLoading: string | null;
  simResult: Record<string, string>;
  setShowAddDevice: (value: boolean) => void;
  sendPowerCommand: (device: Device, action: "on" | "off") => void;
  deleteDevice: (id: string) => void;
  simulateTelemetry: (device: Device) => void;
};

export default function OrgDevicesTab({ devices, devicesLoading, workspaces, mqttConnected, simExpanded, setSimExpanded, simForm, setSimForm, simLoading, simResult, setShowAddDevice, sendPowerCommand, deleteDevice, simulateTelemetry }: Props) {
  return (
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
          <button onClick={() => setShowAddDevice(true)} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-all">
            + Add Device
          </button>
        </div>
      </div>

      <div className="bg-[#111] border border-white/10 rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 text-sm flex-shrink-0">📡</div>
          <div>
            <p className="text-white text-sm font-medium">Connected to HiveMQ Public Broker</p>
            <p className="text-gray-500 text-xs mt-0.5">Topics: <code className="text-purple-400 bg-purple-500/10 px-1 rounded">jaire/devices/{'<orgId>'}/{'<deviceId>'}/telemetry</code> · Real hardware connects to the same broker using your org ID.</p>
          </div>
        </div>
      </div>

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
          {devices.map((device) => {
            const ws = workspaces.find((w) => w.id === device.workspaceId);
            const isSim = simExpanded === device.mqttClientId;
            const sForm = simForm[device.mqttClientId] ?? { watts: "120", voltage: "220", amps: "0.55", power_state: true, temperature: "38" };

            return (
              <div key={device.id} className="bg-[#111] border border-white/10 rounded-2xl overflow-hidden">
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
                      <button
                        onClick={() => sendPowerCommand(device, device.powerState ? "off" : "on")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${device.powerState ? "bg-green-500/15 border-green-500/30 text-green-400 hover:bg-green-500/25" : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"}`}
                      >
                        {device.powerState ? "ON" : "OFF"}
                      </button>
                      <button onClick={() => deleteDevice(device.id)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>

                  {device.isOnline && (
                    <div className="grid grid-cols-4 gap-3 mt-4">
                      {[
                        { label: "Power", value: device.currentWatts != null ? `${device.currentWatts.toFixed(1)}W` : "—" },
                        { label: "Voltage", value: device.voltage != null ? `${device.voltage.toFixed(0)}V` : "—" },
                        { label: "Current", value: device.currentAmps != null ? `${device.currentAmps.toFixed(2)}A` : "—" },
                        { label: "Temp", value: device.temperature != null ? `${device.temperature.toFixed(0)}°C` : "—" },
                      ].map((m) => (
                        <div key={m.label} className="bg-[#0d0d0d] border border-white/5 rounded-xl p-3 text-center">
                          <p className="text-gray-600 text-xs mb-1">{m.label}</p>
                          <p className="text-white font-mono text-sm font-bold">{m.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {device.lastSeen && <p className="text-gray-700 text-xs mt-3">Last seen: {new Date(device.lastSeen).toLocaleTimeString()}</p>}
                </div>

                <div className="border-t border-white/5">
                  <button onClick={() => setSimExpanded(isSim ? null : device.mqttClientId)} className="w-full flex items-center justify-between px-5 py-3 text-gray-500 hover:text-gray-300 hover:bg-white/3 transition-all text-xs">
                    <span className="flex items-center gap-2"><span className="text-yellow-500">⚗</span> Device Simulator — test without hardware</span>
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
                        ].map((field) => (
                          <div key={field.key}>
                            <label className="text-gray-600 text-xs block mb-1">{field.label}</label>
                            <input
                              type="number"
                              placeholder={field.placeholder}
                              value={(sForm as any)[field.key]}
                              onChange={(e) => setSimForm((prev) => ({ ...prev, [device.mqttClientId]: { ...sForm, [field.key]: e.target.value } }))}
                              className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500/50"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <div onClick={() => setSimForm((prev) => ({ ...prev, [device.mqttClientId]: { ...sForm, power_state: !sForm.power_state } }))} className={`w-9 h-5 rounded-full transition-all relative cursor-pointer ${sForm.power_state ? "bg-green-500" : "bg-white/20"}`}>
                            <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all ${sForm.power_state ? "left-[18px]" : "left-[3px]"}`} />
                          </div>
                          <span className="text-gray-400 text-xs">Power state: {sForm.power_state ? "ON" : "OFF"}</span>
                        </label>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-gray-600 text-xs font-mono bg-[#111] border border-white/5 rounded-lg px-3 py-2 flex-1 truncate">
                          Topic: jaire/devices/org/{device.mqttClientId}/telemetry
                        </div>
                        <button onClick={() => simulateTelemetry(device)} disabled={simLoading === device.mqttClientId} className="px-4 py-2 bg-yellow-500/15 hover:bg-yellow-500/25 border border-yellow-500/30 text-yellow-400 text-sm font-medium rounded-xl transition-all disabled:opacity-50 whitespace-nowrap">
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
    </div>
  );
}
