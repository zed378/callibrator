/**
 * P9-18 (storage/index, four gates): a probe driver never becomes the live one.
 *
 * Found by a planted defect during the conversion. `buildProbeDriver` builds
 * a driver from settings that have not been saved yet, to health-check them.
 * A plant that cached the probe as the platform driver left every storage
 * suite green. A cached probe would serve the platform's `global/` objects
 * from an unsaved, unvalidated configuration until the cache expired.
 */
const mockGetGlobalConfig = jest.fn();

jest.mock("../../services/storage/config.service", () => ({
  getGlobalConfig: mockGetGlobalConfig,
  getTenantConfig: jest.fn().mockResolvedValue(null),
  validateTenantConfig: jest.fn(),
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
}));

interface Built {
  name: string;
  root?: string;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const storage = require("../../services/storage") as {
  buildProbeDriver: (resolved: Record<string, unknown>) => Built;
  getGlobalStorage: () => Promise<{ driver: Built }>;
  getTenantStorage: (tenantId: string) => Promise<{ driver: Built }>;
  invalidateAll: () => void;
};

describe("storage — a probe driver is never cached", () => {
  beforeEach(() => {
    storage.invalidateAll();
    mockGetGlobalConfig.mockReset();
    mockGetGlobalConfig.mockReturnValue({ provider: "local", root: "/live-root", fsync: false });
  });

  it("the platform storage keeps its configured driver after a probe", async () => {
    const before = await storage.getGlobalStorage();
    const probe = storage.buildProbeDriver({ provider: "nfs", root: "/unsaved-probe", fsync: true });
    expect(probe.root).toContain("unsaved-probe");
    const after = await storage.getGlobalStorage();
    expect(after.driver).toBe(before.driver);
    expect(after.driver.root).toContain("live-root");
  });

  it("a probe built first is not picked up by the next resolve", async () => {
    storage.buildProbeDriver({ provider: "nfs", root: "/unsaved-probe", fsync: true });
    const live = await storage.getGlobalStorage();
    expect(live.driver.root).toContain("live-root");
    const tenant = await storage.getTenantStorage("5ea5c400-0000-4000-8000-0000000000a1");
    expect(tenant.driver.root).toContain("live-root");
  });
});
