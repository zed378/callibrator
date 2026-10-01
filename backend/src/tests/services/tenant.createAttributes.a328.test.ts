/**
 * A-328 — createTenant writes only Tenant attributes; its creator is the
 * audit row's.
 *
 * createTenant passed `createdBy` to Tenant.create, but `tenants` has no
 * created_by column and the model no such attribute, so Sequelize dropped it
 * silently (the Q-35 / A-286 class: a value the code "stores" that is never
 * stored). Decision (triage): the write is removed, not a column added — who
 * created a tenant is already recorded, inside the same transaction, by the
 * CREATE audit row under PLATFORM (A-95, A-125), which is where attribution
 * lives in this codebase.
 *
 * The guard is general: every key createTenant hands to Tenant.create must be
 * one of the model's own attributes, so the next dropped value fails here.
 *
 * REAL service, models and audit service on fixtures/memoryDb; Redis doubled.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as Service from "../../services/tenant.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as PlatformTenant from "../../constants/platformTenant";
import type { TenantId, UserId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => {
  const nothing = (): Promise<null> => Promise.resolve(null);
  return {
    get: nothing,
    set: nothing,
    del: nothing,
    delPattern: nothing,
    cacheKeys: { tenant: (id: string) => `t:${id}`, tenantByCode: (c: string) => `c:${c}` },
  };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real models, after the jest.mock factories above
const models = require("../../models") as {
  Tenant: { create: (...args: unknown[]) => unknown; getAttributes: () => Record<string, unknown> };
};
const svc = jest.requireActual<typeof Service>("../../services/tenant.service");
const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");
const { PLATFORM_TENANT_ID } = jest.requireActual<typeof PlatformTenant>("../../constants/platformTenant");

const CREATOR = "a3280000-0000-4000-8000-0000000000e1" as UserId;

const asSuperAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    tenantStorage.run({ tenantId: PLATFORM_TENANT_ID as TenantId, isSuperAdmin: true, isSystemTask: false }, () => {
      fn().then(resolve, reject);
    });
  });

beforeEach(() => {
  mdb.reset();
});

describe("A-328 — createTenant hands Tenant.create only Tenant attributes", () => {
  it("every key it writes is a model attribute (createdBy was not)", async () => {
    const create = jest.spyOn(models.Tenant, "create");
    await asSuperAdmin(() => svc.createTenant({ name: "New Hospital", code: "NEW-H" }, CREATOR, {}));
    expect(create).toHaveBeenCalledTimes(1);
    const values = create.mock.calls[0]?.[0] as Record<string, unknown>;
    const attributes = new Set(Object.keys(models.Tenant.getAttributes()));
    expect(Object.keys(values).filter((key) => !attributes.has(key))).toEqual([]);
    create.mockRestore();
  });

  it("the creator is recorded by the CREATE audit row, under PLATFORM", async () => {
    await asSuperAdmin(() => svc.createTenant({ name: "New Hospital", code: "NEW-H" }, CREATOR, {}));
    const audit = mdb
      .committed()
      .filter((w) => w.model === "AuditLog")
      .map((w) => (w.values ?? {}) as Record<string, unknown>);
    expect(audit).toEqual([expect.objectContaining({ action: "CREATE", resourceType: "Tenant", userId: CREATOR, tenantId: PLATFORM_TENANT_ID })]);
  });
});
