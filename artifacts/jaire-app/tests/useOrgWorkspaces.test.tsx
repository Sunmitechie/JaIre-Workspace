import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOrgWorkspaces } from "../src/pages/org/useOrgWorkspaces";

vi.mock("@/lib/org-auth", () => ({ getOrgToken: () => "org-token" }));

describe("useOrgWorkspaces", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serializes and resets a new workspace form after success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const refreshWorkspaces = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useOrgWorkspaces(refreshWorkspaces));
    const form = {
      name: "North Desk",
      description: "Window seat",
      capacity: "4",
      hourly_rate_ngn: "2500",
      workspace_type: "hot_desk",
      floor: "2",
      amenities: "WiFi, Coffee",
      image_url: "",
    };
    const event = { preventDefault: vi.fn() } as unknown as React.FormEvent;

    act(() => {
      result.current.setShowAddWs(true);
      result.current.setWsForm(form);
    });
    await act(async () => result.current.handleAddWorkspace(event));

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/org/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer org-token" },
      body: JSON.stringify({
        ...form,
        capacity: 4,
        hourly_rate_ngn: 2500,
        floor: 2,
        amenities: ["WiFi", "Coffee"],
      }),
    });
    expect(result.current.showAddWs).toBe(false);
    expect(result.current.wsForm).toMatchObject({ name: "", capacity: "1" });
    expect(result.current.wsLoading).toBe(false);
    expect(refreshWorkspaces).toHaveBeenCalledOnce();
  });
});
