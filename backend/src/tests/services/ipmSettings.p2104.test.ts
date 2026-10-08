/**
 * P21-04 — the tenant settings of the IPM aggregate (P19-02 spec § 4.3, § 11; P19-06 spec § 7.3;
 * ADR-126 Am. 5): written by a tenant administrator through `PATCH /tenants/settings` — a time zone
 * the runtime knows, an interval of 1 – 60 months, `true` / `false` for the two switches, or cleared;
 * anything else is a 400 naming the key and nothing is written. Read by `ipmSettingsOf`, defaults
 * filled in: Asia/Jakarta, not scheduled, no countersignature, the side effects ON (UD-17's working
 * decision, reversible per tenant).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as TenantService from "../../services/tenant.service";
import type * as IpmSettings from "../../services/ipmSettings.service";
import type { TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(true)),
  del: jest.fn(() => Promise.resolve(true)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const tenantService = jest.requireActual<typeof TenantService>("../../services/tenant.service");
const { ipmSettingsOf } = jest.requireActual<typeof IpmSettings>("../../services/ipmSettings.service");
const T = "aaaaaaaa-0000-4000-8000-000000000001" as TenantId;
const ADMIN = "cccccccc-0000-4000-8000-000000000001";

beforeEach(() => {
  mdb.reset();
  mdb.seed("Tenant", { id: T, name: "Tenant", code: "TA", status: "active" });
});

describe("PATCH /tenants/settings — the IPM keys", () => {
  it.each([
    ["tenant_time_zone", "Asia/Makassar"],
    ["tenant_time_zone", ""],
    ["ipm_interval_months", 1],
    ["ipm_interval_months", "60"],
    ["ipm_countersign_enabled", true],
    ["ipm_countersign_enabled", "false"],
    ["ipm_recommendation_side_effects", false],
    ["ipm_recommendation_side_effects", null],
  ])("%s = %p is stored", async (key, value) => {
    await expect(tenantService.updateTenantSettings(T, { [key]: value }, ADMIN, { userId: ADMIN })).resolves.toBeDefined();
  });

  it.each([
    ["tenant_time_zone", "Mars/Olympus"],
    ["tenant_time_zone", 7],
    ["ipm_interval_months", 0],
    ["ipm_interval_months", 61],
    ["ipm_countersign_enabled", "yes"],
    ["ipm_recommendation_side_effects", 1],
  ])("%s = %p → 400 naming the key; nothing written", async (key, value) => {
    const before = mdb.committed().length;
    await expect(tenantService.updateTenantSettings(T, { [key]: value }, ADMIN, { userId: ADMIN })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(key) as unknown,
    });
    expect(mdb.committed().slice(before)).toEqual([]);
  });
});

describe("ipmSettingsOf", () => {
  const seed = (values: Record<string, string>): void => {
    for (const [key, value] of Object.entries(values)) {
      mdb.seed("TenantSettings", { tenantId: T, key, value });
    }
  };

  it("unset: Asia/Jakarta, not scheduled, countersigning off, side effects on", async () => {
    expect(await ipmSettingsOf(T)).toEqual({ timeZone: "Asia/Jakarta", intervalMonths: null, countersignEnabled: false, sideEffectsEnabled: true });
  });

  it("set: the values as written", async () => {
    seed({ tenant_time_zone: "UTC", ipm_interval_months: "3", ipm_countersign_enabled: "true", ipm_recommendation_side_effects: "false" });
    expect(await ipmSettingsOf(T)).toEqual({ timeZone: "UTC", intervalMonths: 3, countersignEnabled: true, sideEffectsEnabled: false });
  });

  it("a stored value the runtime cannot use falls back to the default (a zone it does not know, an interval out of range, a flag that is neither)", async () => {
    seed({ tenant_time_zone: "Mars/Olympus", ipm_interval_months: "99", ipm_countersign_enabled: "maybe", ipm_recommendation_side_effects: "null" });
    expect(await ipmSettingsOf(T)).toEqual({ timeZone: "Asia/Jakarta", intervalMonths: null, countersignEnabled: false, sideEffectsEnabled: true });
  });
});
