/**
 * P20-07 (ADR-124 Am. 2 § 4; spec MEMORY/specs/P19-04-client-facilities.md § 4.3) —
 * services/clientFacility#createSelfFacility over memoryDb: the REAL models, the REAL tenant hooks
 * and the real audit service, in memory.
 *
 *  - a tenant without one gets ONE self facility (code SELF, kind other, active, the tenant's
 *    normalised name) and ONE CREATE audit row in that tenant, stamped with the facility, naming
 *    the creating user — or, with none, the back-fill's system actor;
 *  - a second call (a seed re-run, a tenant migration 0117 served) finds it and writes NOTHING;
 *  - inside a transaction both rows commit or roll back together (a rolled-back tenant creation
 *    leaves no facility and no audit row);
 *  - from a scoped context of ANOTHER tenant the facility is still the new tenant's (the reviewed
 *    `skipTenantScope`).
 * That the database refuses a second self facility, a non-active one and a changed `is_self` is
 * proven on PostgreSQL 18 (clientFacilities.p2007.live).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ServiceModule from "../../services/clientFacility.service";
import type * as TenantContextModule from "../../middlewares/tenantContext.middleware";
import type * as IdsModule from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the config mock, as every memoryDb test */
const service = require("../../services/clientFacility.service") as typeof ServiceModule;
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as typeof TenantContextModule;
const { db } = require("../../config") as { db: { transaction(): Promise<{ commit(): Promise<void>; rollback(): Promise<void> }> } };
const { toTenantId } = require("../../types/ids") as typeof IdsModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = { id: "c1000000-0000-4000-8000-000000000001", name: "  Rumah   Sakit  Sintetis " };
const OTHER = "c1000000-0000-4000-8000-000000000002";
const USER = "c1000000-0000-4000-8000-000000000003";

const facilities = () => mdb.rows("ClientFacility");
const audits = () => mdb.rows("AuditLog");

beforeEach(() => {
  mdb.reset();
});

describe("P20-07 — createSelfFacility", () => {
  it("creates the tenant's one self facility and its CREATE audit row, attributed to the user", async () => {
    const facility = await service.createSelfFacility(TENANT, { userId: USER });

    expect(facilities()).toEqual([
      expect.objectContaining({
        id: facility.id,
        tenantId: TENANT.id,
        name: "Rumah Sakit Sintetis",
        code: "SELF",
        kind: "other",
        isSelf: true,
        status: "active",
        createdBy: USER,
      }),
    ]);
    expect(audits()).toEqual([
      expect.objectContaining({
        tenantId: TENANT.id,
        userId: USER,
        actorType: "user",
        actorName: null,
        action: "CREATE",
        resourceType: "ClientFacility",
        resourceId: facility.id,
        clientFacilityId: facility.id,
        changes: {
          operation: "CREATE_SELF_FACILITY",
          tenantId: TENANT.id,
          before: {},
          after: { name: "Rumah Sakit Sintetis", code: "SELF", kind: "other", isSelf: true, status: "active" },
        },
      }),
    ]);
  });

  it("with no user (a seed): the back-fill's system actor", async () => {
    await service.createSelfFacility({ id: TENANT.id, name: "Default Hospital Tenant" });

    expect(facilities()[0]).toMatchObject({ createdBy: null, name: "Default Hospital Tenant" });
    expect(audits()).toEqual([
      expect.objectContaining({
        userId: null,
        actorType: "system",
        actorName: "system:client-facility-backfill",
        changes: expect.objectContaining({ operation: "CREATE_SELF_FACILITY", actor: "system:client-facility-backfill" }) as unknown,
      }),
    ]);
  });

  it("is idempotent: a second call returns the same facility and writes nothing", async () => {
    const first = await service.createSelfFacility(TENANT, null);
    const writes = mdb.writes().length;

    const second = await service.createSelfFacility(TENANT, { userId: USER });

    expect(second.id).toBe(first.id);
    expect(mdb.writes()).toHaveLength(writes);
    expect(facilities()).toHaveLength(1);
    expect(audits()).toHaveLength(1);
  });

  it("joins the caller's transaction: a rolled-back tenant creation leaves no facility and no audit row", async () => {
    const transaction = await db.transaction();
    await service.createSelfFacility(TENANT, { userId: USER }, { transaction: transaction as never });
    await transaction.rollback();
    expect(facilities()).toEqual([]);
    expect(audits()).toEqual([]);
    expect(mdb.committed()).toEqual([]);

    const committed = await db.transaction();
    await service.createSelfFacility(TENANT, { userId: USER }, { transaction: committed as never });
    await committed.commit();
    expect(facilities()).toHaveLength(1);
    expect(audits()).toHaveLength(1);
  });

  it("from another tenant's scoped context the facility is still the NEW tenant's (reviewed skipTenantScope)", async () => {
    await tenantStorage.run({ tenantId: toTenantId(OTHER), isSuperAdmin: false, isSystemTask: false }, async () => {
      await service.createSelfFacility(TENANT, null);
      // A second call from the same foreign context still finds it (the find skips the scope too).
      await service.createSelfFacility(TENANT, null);
    });
    expect(facilities()).toEqual([expect.objectContaining({ tenantId: TENANT.id, isSelf: true })]);
  });

  it("selfFacilityName: trimmed, inner whitespace collapsed, at most 255 characters, SELF when nothing is left", () => {
    expect(service.selfFacilityName(" a \t b\n c ")).toBe("a b c");
    expect(service.selfFacilityName("   ")).toBe("SELF");
    expect(service.selfFacilityName(`${"x".repeat(254)} yz`)).toBe("x".repeat(254));
    expect(service.selfFacilityName("y".repeat(300))).toHaveLength(255);
    expect(service.SELF_FACILITY_CODE).toBe("SELF");
  });
});
