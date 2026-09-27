import { beforeEach, vi } from "vitest";
import { createPaystackMockFetch } from "./mocks/paystack";

export const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(createPaystackMockFetch());
});
