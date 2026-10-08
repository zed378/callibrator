/**
 * P21-09 — spec MEMORY/specs/P19-04-client-facilities.md § 16 (hand-off 3 of P20-07):
 * `auditService.logAction` stamps `audit_logs.client_facility_id` from the RESOURCE when its
 * caller omits it, so a forgetful caller still writes the breach-scoping record correctly.
 *
 * The REAL audit service, models and hooks over memoryDb. Each branch of `resolveAuditFacility`:
 * a facility-scoped resource (deleted ones too), the facility itself, a resource type without a
 * facility, an unknown type, a non-UUID id, no id, a row not found, the AuditLog type, and a
 * caller that names the facility (never overridden).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as AuditServiceModule from "../../services/audit.service";
import { tenantStorage } from "../../middlewares/tenantContext.middleware";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const audit = jest.requireActual<typeof AuditServiceModule>("../../services/audit.service");

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const DEVICE = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const DELETED = "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2";
const VENDOR = "a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5";
const U = "11111111-1111-4111-8111-111111111111";

const log = (resourceType: string, resourceId: string | null, clientFacilityId?: string): Promise<unknown> =>
  tenantStorage.run({ tenantId: T as never, isSuperAdmin: false, isSystemTask: false }, () =>
    audit.logAction({ tenantId: T, userId: U, action: "UPDATE", resourceType, resourceId, ...(clientFacilityId ? { clientFacilityId } : {}) }),
  );
const stamped = (): unknown[] => mdb.rows("AuditLog").map((r) => r["clientFacilityId"] ?? null);

beforeEach(() => {
  mdb.reset();
  mdb.seed("CalibrationDevice", [
    { id: DEVICE, tenantId: T, clientFacilityId: F1, name: "Pump", status: "active", isDeleted: false },
    { id: DELETED, tenantId: T, clientFacilityId: F2, name: "Old pump", status: "active", isDeleted: true, deletedAt: new Date() },
  ]);
  mdb.seed("Vendor", { id: VENDOR, tenantId: T, name: "Vendor" });
});

describe("spec § 16 — the audit row's facility, from the resource", () => {
  it("a facility-scoped resource stamps its facility — a deleted one too", async () => {
    await log("CalibrationDevice", DEVICE);
    await log("CalibrationDevice", DELETED);
    expect(stamped()).toEqual([F1, F2]);
  });

  it("the facility itself stamps its own id", async () => {
    await log("ClientFacility", F2);
    expect(stamped()).toEqual([F2]);
  });

  it("a caller's own facility is never overridden", async () => {
    await log("CalibrationDevice", DEVICE, F2);
    expect(stamped()).toEqual([F2]);
  });

  it("stamps nothing for a resource without a facility, an unknown type, a non-UUID or missing id, an absent row, an AuditLog", async () => {
    await log("Vendor", VENDOR);
    await log("NoSuchModel", DEVICE);
    await log("CalibrationDevice", "not-a-uuid");
    await log("CalibrationDevice", null);
    await log("CalibrationDevice", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    await log("AuditLog", DEVICE);
    // `sequelize` is a value of the models barrel that is not a model (no attributes).
    await log("sequelize", DEVICE);
    expect(stamped()).toEqual([null, null, null, null, null, null, null]);
  });
});
