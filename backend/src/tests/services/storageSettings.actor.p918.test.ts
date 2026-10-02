/**
 * P9-18 (storageSettings, four gates): the caller's principal reaches the
 * storage audit row.
 *
 * Found by a planted defect during the conversion. Replacing `actor` with
 * `null` on the save left every suite green. config.service writes the
 * audit row of a storage change, and its actor comes from what this layer
 * passes, so a dropped actor makes a storage-credential change unattributable.
 */
const mockSet = jest.fn();
const mockClear = jest.fn();

jest.mock("../../services/storage/config.service", () => ({
  getTenantConfig: jest.fn().mockResolvedValue(null),
  validateTenantConfig: (input: Record<string, unknown>) => ({ provider: input["provider"] }),
  setTenantConfig: mockSet,
  clearTenantConfig: mockClear,
}));
jest.mock("../../services/storage", () => ({
  buildProbeDriver: () => ({ healthCheck: () => Promise.resolve({ ok: true }) }),
  invalidate: jest.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const settings = require("../../services/storageSettings.service") as {
  updateSettings: (tenantId: string, input: Record<string, unknown>, actor?: unknown) => Promise<unknown>;
  clearSettings: (tenantId: string, actor?: unknown) => Promise<unknown>;
};

const TENANT = "5ea5c400-0000-4000-8000-0000000000a1";
const ACTOR = { userId: "5ea5c400-0000-4000-8000-0000000000e1", ipAddress: "192.0.2.1", userAgent: "jest" };

describe("storageSettings — the actor reaches config.service", () => {
  beforeEach(() => {
    mockSet.mockReset().mockResolvedValue({});
    mockClear.mockReset().mockResolvedValue({ cleared: 1 });
  });

  it("a save passes the caller's principal", async () => {
    const input = { provider: "nfs", root: "/mnt/a" };
    await settings.updateSettings(TENANT, input, ACTOR);
    expect(mockSet).toHaveBeenCalledWith(TENANT, input, ACTOR);
  });

  it("a clear passes the caller's principal", async () => {
    await settings.clearSettings(TENANT, ACTOR);
    expect(mockClear).toHaveBeenCalledWith(TENANT, ACTOR);
  });
});
