import { beforeEach, vi } from "vitest";
import { createSolanaRpcMock } from "./mocks/solana";

export const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(createSolanaRpcMock());
});
