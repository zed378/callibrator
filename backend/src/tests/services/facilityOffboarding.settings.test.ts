/**
 * P21-09e — the two off-boarding settings a tenant administrator writes through
 * `PATCH /tenants/settings` (spec P19-04 § 4.6, UD-18 (b)): a whole number in range, or cleared;
 * anything else is a 400 that names the key and nothing is written.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as TenantService from "../../services/tenant.service";
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
const T = "aaaaaaaa-0000-4000-8000-000000000001" as TenantId;
const ADMIN = "cccccccc-0000-4000-8000-000000000001";

beforeEach(() => {
  mdb.reset();
  mdb.seed("Tenant", { id: T, name: "Tenant", code: "TA", status: "active" });
});

describe("P21-09e off-boarding settings", () => {
  it.each([
    ["client_facilities_bound_user_deactivation_days", 45],
    ["client_facilities_bound_user_deactivation_days", "14"],
    ["client_facilities_ended_retention_years", 10],
    ["client_facilities_ended_retention_years", ""],
    ["client_facilities_ended_retention_years", null],
  ])("%s = %p is stored", async (key, value) => {
    await expect(tenantService.updateTenantSettings(T, { [key]: value }, ADMIN, { userId: ADMIN })).resolves.toBeDefined();
  });

  it.each([
    ["client_facilities_bound_user_deactivation_days", 0],
    ["client_facilities_bound_user_deactivation_days", 3651],
    ["client_facilities_bound_user_deactivation_days", "two weeks"],
    ["client_facilities_ended_retention_years", 1.5],
    ["client_facilities_ended_retention_years", 101],
  ])("%s = %p → 400 naming the key; nothing written", async (key, value) => {
    const before = mdb.committed().length;
    await expect(tenantService.updateTenantSettings(T, { [key]: value }, ADMIN, { userId: ADMIN })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(key) as unknown,
    });
    expect(mdb.committed().slice(before)).toEqual([]);
  });
});
