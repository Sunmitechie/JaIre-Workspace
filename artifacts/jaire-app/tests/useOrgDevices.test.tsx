import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOrgDevices } from "../src/pages/org/useOrgDevices";

vi.mock("@/lib/org-auth", () => ({ getOrgToken: () => "org-token" }));

const device = {
  id: "device-1",
  orgId: "org-1",
  workspaceId: null,
  deviceName: "Desk plug",
  deviceType: "smart_plug",
  mqttClientId: "mqtt-1",
  isOnline: false,
  powerState: false,
  currentWatts: null,
  voltage: null,
  currentAmps: null,
  todayKwh: null,
  temperature: null,
  lastSeen: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

describe("useOrgDevices", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds a device and resets the form after success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => device });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useOrgDevices(false));
    const form = {
      deviceName: "Desk plug",
      deviceType: "smart_plug",
      workspaceId: "workspace-1",
      mqttClientId: "mqtt-1",
    };
    const event = { preventDefault: vi.fn() } as unknown as React.FormEvent;

    act(() => {
      result.current.setShowAddDevice(true);
      result.current.setDeviceForm(form);
    });
    await act(async () => result.current.addDevice(event));

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(result.current.devices).toEqual([device]);
    expect(result.current.showAddDevice).toBe(false);
    expect(result.current.deviceForm).toEqual({
      deviceName: "",
      deviceType: "smart_plug",
      workspaceId: "",
      mqttClientId: "",
    });
    expect(result.current.deviceFormLoading).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer org-token" },
      body: JSON.stringify(form),
    });
  });
});
