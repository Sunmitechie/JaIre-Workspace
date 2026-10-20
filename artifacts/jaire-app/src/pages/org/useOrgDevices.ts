import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getOrgToken } from "@/lib/org-auth";
import { DEFAULT_DEVICE_SIMULATION, EMPTY_DEVICE_FORM } from "./types";
import type { Device, DeviceForm, SimulationForm } from "./types";

const API = `${import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}/api`;
export function useOrgDevices(active: boolean) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [deviceForm, setDeviceForm] = useState<DeviceForm>({ ...EMPTY_DEVICE_FORM });
  const [deviceFormLoading, setDeviceFormLoading] = useState(false);
  const [deviceFormError, setDeviceFormError] = useState<string | null>(null);
  const [simExpanded, setSimExpanded] = useState<string | null>(null);
  const [simForm, setSimForm] = useState<Record<string, SimulationForm>>({});
  const [simLoading, setSimLoading] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<Record<string, string>>({});
  const sseRef = useRef<EventSource | null>(null);
  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const response = await fetch(`${API}/devices`, {
        headers: { Authorization: `Bearer ${getOrgToken()}` },
      });
      if (response.ok) setDevices(await response.json() as Device[]);
    } catch {
      // Keep the last known device list when the service is unavailable.
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  const checkMqttStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API}/devices/status`, {
        headers: { Authorization: `Bearer ${getOrgToken()}` },
      });
      if (response.ok) {
        const data = await response.json();
        setMqttConnected(data.mqttConnected ?? false);
      }
    } catch {
      setMqttConnected(false);
    }
  }, []);

  const stopDeviceSSE = useCallback(() => {
    sseRef.current?.close();
    sseRef.current = null;
  }, []);

  const startDeviceSSE = useCallback(() => {
    if (sseRef.current) return;
    const token = getOrgToken();
    if (!token) return;

    const events = new EventSource(`${API}/devices/events?token=${encodeURIComponent(token)}`);
    events.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as {
          type: string;
          deviceClientId?: string;
          data?: Record<string, any>;
        };
        if (event.type === "connected") return;
        if (event.type === "telemetry" && event.deviceClientId) {
          setDevices(current => current.map(device => device.mqttClientId === event.deviceClientId
            ? {
                ...device,
                isOnline: true,
                powerState: event.data?.power_state ?? device.powerState,
                currentWatts: event.data?.watts ?? device.currentWatts,
                voltage: event.data?.voltage ?? device.voltage,
                currentAmps: event.data?.amps ?? device.currentAmps,
                temperature: event.data?.temperature ?? device.temperature,
                lastSeen: new Date().toISOString(),
              }
            : device));
        } else if (event.type === "command" && event.data?.id) {
          setDevices(current => current.map(device => device.id === event.data?.id
            ? { ...device, powerState: event.data?.powerState }
            : device));
        } else if (event.type === "status" && event.deviceClientId) {
          setDevices(current => current.map(device => device.mqttClientId === event.deviceClientId
            ? { ...device, isOnline: event.data?.isOnline ?? device.isOnline }
            : device));
        }
      } catch {
        // Ignore malformed event payloads and keep the current device state.
      }
    };
    sseRef.current = events;
  }, []);

  useEffect(() => {
    if (!active) {
      stopDeviceSSE();
      return;
    }
    void loadDevices();
    void checkMqttStatus();
    startDeviceSSE();
    return stopDeviceSSE;
  }, [active, checkMqttStatus, loadDevices, startDeviceSSE, stopDeviceSSE]);

  const addDevice = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setDeviceFormLoading(true);
    setDeviceFormError(null);
    try {
      const response = await fetch(`${API}/devices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getOrgToken()}` },
        body: JSON.stringify(deviceForm),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Failed");
      const device = await response.json() as Device;
      setDevices(current => [...current, device]);
      setDeviceForm({ ...EMPTY_DEVICE_FORM });
      setShowAddDevice(false);
    } catch (error) {
      setDeviceFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeviceFormLoading(false);
    }
  }, [deviceForm]);

  const deleteDevice = useCallback(async (id: string) => {
    await fetch(`${API}/devices/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${getOrgToken()}` },
    });
    setDevices(current => current.filter(device => device.id !== id));
  }, []);

  const sendPowerCommand = useCallback(async (device: Device, action: "on" | "off") => {
    const response = await fetch(`${API}/devices/${device.id}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getOrgToken()}` },
      body: JSON.stringify({ action }),
    });
    if (response.ok) {
      const data = await response.json();
      setDevices(current => current.map(item => item.id === device.id
        ? { ...item, powerState: data.powerState }
        : item));
    }
  }, []);

  const simulateTelemetry = useCallback(async (device: Device) => {
    const form = simForm[device.mqttClientId] ?? DEFAULT_DEVICE_SIMULATION;
    setSimLoading(device.mqttClientId);
    setSimResult(current => ({ ...current, [device.mqttClientId]: "" }));
    try {
      const response = await fetch(`${API}/devices/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getOrgToken()}` },
        body: JSON.stringify({
          mqttClientId: device.mqttClientId,
          watts: parseFloat(form.watts) || 0,
          voltage: parseFloat(form.voltage) || 220,
          amps: parseFloat(form.amps) || 0,
          power_state: form.power_state,
          temperature: form.temperature ? parseFloat(form.temperature) : null,
        }),
      });
      const data = await response.json();
      setSimResult(current => ({ ...current, [device.mqttClientId]: response.ok ? "Published!" : data.error ?? "Error" }));
    } catch {
      setSimResult(current => ({ ...current, [device.mqttClientId]: "Network error" }));
    } finally {
      setSimLoading(null);
      window.setTimeout(() => setSimResult(current => ({ ...current, [device.mqttClientId]: "" })), 3000);
    }
  }, [simForm]);

  return {
    devices,
    devicesLoading,
    mqttConnected,
    showAddDevice,
    setShowAddDevice,
    deviceForm,
    setDeviceForm,
    deviceFormLoading,
    deviceFormError,
    simExpanded,
    setSimExpanded,
    simForm,
    setSimForm,
    simLoading,
    simResult,
    addDevice,
    deleteDevice,
    sendPowerCommand,
    simulateTelemetry,
  };
}