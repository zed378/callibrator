/**
 * P24-04 (ADR-133 § 6, Am. 4; spec MEMORY/specs/P19-05-calibration-dates.md § 9.1, § 9.2; FT-101)
 * — the per-tenant upstream import key as the calibration-record actor.
 *
 * REAL: the ApiKey, User, Tenant, CalibrationDevice and CalibrationRecord models and the tenant hooks
 * over memoryDb, the audit service, `apiKey.service#revokeApiKey`, and `calibrationDates.service`'s
 * quick entry (the record service the ETL writes through). Synthetic data only: no upstream value.
 *
 * Two tenants: tenant B's key is never A's actor, a user of tenant B is never A's performer, A's
 * cutover never revokes B's key. (No route is added: the facility dimension does not apply — an
 * API key is unbound, OQ-11 — and the record's facility comes from its device, FT-99.)
 */
import type * as MemoryDbModule from "../../fixtures/memoryDb";
import type * as RouteClient from "../../fixtures/routeClient";
import type * as ImportKeyModule from "../../../services/upstreamImport/importKey";
import type * as ApiKeyServiceModule from "../../../services/apiKey.service";
import type * as CalibrationDatesModule from "../../../services/calibrationDates.service";
import type * as TenantContextModule from "../../../middlewares/tenantContext.middleware";
import type * as IdsModule from "../../../types/ids";
import { IPM, seedIpmWorld, type IpmWorld } from "../../fixtures/ipmSeed";
import { environment } from "../../../config/env";

jest.mock("../../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants } = jest.requireActual<typeof RouteClient>("../../fixtures/routeClient");
/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the config mock, as every memoryDb test */
const importKey = require("../../../services/upstreamImport/importKey") as typeof ImportKeyModule;
const apiKeyService = require("../../../services/apiKey.service") as typeof ApiKeyServiceModule;
const calibrationDates = require("../../../services/calibrationDates.service") as typeof CalibrationDatesModule;
const { tenantStorage } = require("../../../middlewares/tenantContext.middleware") as typeof TenantContextModule;
const { toTenantId } = require("../../../types/ids") as typeof IdsModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const D9 = "d1000000-0000-4000-8000-0000000000f9";
const SIGN_OFF = "2099-01-01";

let world: IpmWorld;
let A: ReturnType<typeof toTenantId>;
let B: ReturnType<typeof toTenantId>;

const inTenant = <T>(tenant: string, fn: () => Promise<T>): Promise<T> =>
  tenantStorage.run({ tenantId: toTenantId(tenant), isSuperAdmin: false, isSystemTask: false }, fn);
const keys = (): Record<string, unknown>[] => mdb.rows("ApiKey");
const audits = (operation: string): Record<string, unknown>[] =>
  mdb.rows("AuditLog").filter((a) => (a["changes"] as { operation?: string } | null)?.operation === operation);
const errorOf = async (p: Promise<unknown>): Promise<{ status?: number; publicCode?: string; message: string }> => {
  try {
    await p;
  } catch (e) {
    return e as { status?: number; publicCode?: string; message: string };
  }
  throw new Error("expected a refusal");
};

/** The process environment (config/env.ts); read per call. */
const penv = environment();
const ORIGINAL_GATE = penv["UPSTREAM_REAL_DATA_ALLOWED"];

beforeEach(() => {
  mdb.reset();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  A = toTenantId(world.tenantA);
  B = toTenantId(world.tenantB);
  mdb.seed("TenantSettings", { tenantId: world.tenantA, key: "tenant_time_zone", value: "UTC" });
  mdb.seed("CalibrationDevice", { id: D9, tenantId: world.tenantA, clientFacilityId: IPM.F1, name: "Alat sintetis 9", status: "active", isDeleted: false });
  delete penv["UPSTREAM_REAL_DATA_ALLOWED"];
});

afterAll(() => {
  if (ORIGINAL_GATE === undefined) {
    delete penv["UPSTREAM_REAL_DATA_ALLOWED"];
  } else {
    penv["UPSTREAM_REAL_DATA_ALLOWED"] = ORIGINAL_GATE;
  }
});

describe("P24-04 — provisioning the import key", () => {
  it("creates `upstream-import`, `calibration:write` only, expiring at sign-off + 90 days; audited; the key is never returned", async () => {
    const { key, created } = await inTenant(A, () => importKey.provisionImportKey(A, { signOffDate: SIGN_OFF, dataClass: "synthetic" }, { userId: world.admin.id }));
    expect(created).toBe(true);
    expect(key).toEqual({
      id: expect.any(String) as unknown,
      name: "upstream-import",
      keyPrefix: expect.stringMatching(/^cbk_/) as unknown,
      scopes: ["calibration:write"],
      expiresAt: new Date("2099-04-01T00:00:00.000Z"),
      isActive: true,
    });
    expect(Object.keys(key)).not.toContain("key");
    expect(keys()).toEqual([expect.objectContaining({ tenantId: world.tenantA, name: "upstream-import", createdBy: world.admin.id })]);
    expect(audits("IMPORT_KEY_CREATE")).toEqual([
      expect.objectContaining({ tenantId: world.tenantA, userId: world.admin.id, action: "CREATE", resourceType: "ApiKey", resourceId: key.id }),
    ]);
    expect(JSON.stringify(audits("IMPORT_KEY_CREATE"))).not.toContain(String(keys()[0]?.["keyHash"]));
  });

  it("a second call returns the usable key and writes nothing", async () => {
    const first = await inTenant(A, () => importKey.provisionImportKey(A, { signOffDate: SIGN_OFF, dataClass: "synthetic" }, { userId: world.admin.id }));
    const again = await inTenant(A, () => importKey.provisionImportKey(A, { signOffDate: SIGN_OFF, dataClass: "synthetic" }, { userId: world.admin.id }));
    expect(again).toEqual({ key: first.key, created: false });
    expect(keys()).toHaveLength(1);
    expect(audits("IMPORT_KEY_CREATE")).toHaveLength(1);
  });

  it("a live key that is not usable (no expiry, or another scope) is not reused: a new key is provisioned", async () => {
    mdb.seed("ApiKey", { id: "a9000000-0000-4000-8000-000000000001", tenantId: world.tenantA, name: "upstream-import", keyPrefix: "cbk_legacy01", keyHash: "x".repeat(64), scopes: ["calibration:write"], expiresAt: null, isActive: true, isDeleted: false });
    mdb.seed("ApiKey", { id: "a9000000-0000-4000-8000-000000000002", tenantId: world.tenantA, name: "upstream-import", keyPrefix: "cbk_legacy02", keyHash: "y".repeat(64), scopes: ["calibration:write", "equipment:write"], expiresAt: new Date("2099-01-01"), isActive: true, isDeleted: false });
    mdb.seed("ApiKey", { id: "a9000000-0000-4000-8000-000000000003", tenantId: world.tenantA, name: "upstream-import", keyPrefix: "cbk_legacy03", keyHash: "z".repeat(64), scopes: ["equipment:write"], expiresAt: new Date("2099-01-01"), isActive: true, isDeleted: false });
    mdb.seed("ApiKey", { id: "a9000000-0000-4000-8000-000000000004", tenantId: world.tenantA, name: "upstream-import", keyPrefix: "cbk_legacy04", keyHash: "w".repeat(64), scopes: ["calibration:write"], expiresAt: new Date("2000-01-01"), isActive: true, isDeleted: false });
    const { created } = await inTenant(A, () => importKey.provisionImportKey(A, { signOffDate: SIGN_OFF, dataClass: "synthetic" }, { userId: world.admin.id }));
    expect(created).toBe(true);
  });

  it.each([["2099-1-01"], ["2099-02-30"], ["not a day"]])("refuses a malformed sign-off day %s (400)", async (signOffDate) => {
    const err = await errorOf(inTenant(A, () => importKey.provisionImportKey(A, { signOffDate, dataClass: "synthetic" }, { userId: world.admin.id })));
    expect(err.status).toBe(400);
    expect(keys()).toHaveLength(0);
  });

  it("refuses a sign-off whose + 90 days is already past (400)", async () => {
    const err = await errorOf(inTenant(A, () => importKey.provisionImportKey(A, { signOffDate: "2020-01-01", dataClass: "synthetic" }, { userId: world.admin.id })));
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/already be expired/);
  });

  it("refuses a run declared real while UPSTREAM_REAL_DATA_ALLOWED is off (403, code top-level), and writes nothing", async () => {
    const err = await errorOf(inTenant(A, () => importKey.provisionImportKey(A, { signOffDate: SIGN_OFF, dataClass: "real" }, { userId: world.admin.id })));
    expect(err).toMatchObject({ status: 403, publicCode: "UPSTREAM_REAL_DATA_REFUSED" });
    expect(keys()).toHaveLength(0);
    expect(mdb.rows("AuditLog")).toHaveLength(0);
  });

  it("allows a real run once the gate is on (the DPIA gates recorded)", async () => {
    penv["UPSTREAM_REAL_DATA_ALLOWED"] = "true";
    const { created } = await inTenant(A, () => importKey.provisionImportKey(A, { signOffDate: SIGN_OFF, dataClass: "real" }, { userId: world.admin.id }));
    expect(created).toBe(true);
  });

  it("the key route refuses the reserved name, in any case or padding (only the import provisions it)", async () => {
    const err = await errorOf(inTenant(A, () => apiKeyService.createApiKey(A, { name: "  Upstream-IMPORT ", scopes: ["calibration:write"] })));
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/reserved/);
    expect(keys()).toHaveLength(0);
  });
});

describe("P24-04 — the import key as the recording actor", () => {
  const provision = (): Promise<unknown> =>
    inTenant(A, () => importKey.provisionImportKey(A, { signOffDate: SIGN_OFF, dataClass: "synthetic" }, { userId: world.admin.id }));

  it("records an imported calibration date as the key (api_key_id, no user), through the record service", async () => {
    await provision();
    const actor = await inTenant(A, () => importKey.importKeyActor(A, "synthetic"));
    expect(actor).toEqual({ userId: null, apiKeyId: keys()[0]?.["id"], ipAddress: null, userAgent: null });
    const result = await inTenant(A, () => calibrationDates.recordExternalCalibration(A, { calibrationDeviceId: D9, calibrationDate: "2024-03-01" }, actor));
    expect(result.record).toMatchObject({ apiKeyId: keys()[0]?.["id"], performedBy: null, entryKind: "external_date", externalLabName: null });
    expect(audits("RECORD_EXTERNAL_CALIBRATION")).toEqual([expect.objectContaining({ actorType: "system", actorName: "system:api-key", userId: null })]);
  });

  it("no key, or tenant B's key from tenant A's context: 409 IMPORT_KEY_MISSING", async () => {
    let err = await errorOf(inTenant(A, () => importKey.importKeyActor(A, "synthetic")));
    expect(err).toMatchObject({ status: 409, publicCode: "IMPORT_KEY_MISSING" });
    await inTenant(B, () => importKey.provisionImportKey(B, { signOffDate: SIGN_OFF, dataClass: "synthetic" }, { userId: world.other.id }));
    err = await errorOf(inTenant(A, () => importKey.importKeyActor(A, "synthetic")));
    expect(err.publicCode).toBe("IMPORT_KEY_MISSING");
    // Naming B while in A's context still reads nothing of B's (the hooks).
    err = await errorOf(inTenant(A, () => importKey.importKeyActor(B, "synthetic")));
    expect(err.publicCode).toBe("IMPORT_KEY_MISSING");
  });

  it("refuses to resolve the key for a real run while the gate is off", async () => {
    await provision();
    const err = await errorOf(inTenant(A, () => importKey.importKeyActor(A, "real")));
    expect(err.publicCode).toBe("UPSTREAM_REAL_DATA_REFUSED");
  });

  it("a resolvable upstream user is the performer (performed_by), never the key", async () => {
    await provision();
    const keyActor = await inTenant(A, () => importKey.importKeyActor(A, "synthetic"));
    const who = await inTenant(A, () => importKey.importCalibrationPerformer(A, { kind: "user", userId: world.staff.id }, keyActor));
    expect(who.actor).toEqual({ userId: world.staff.id, apiKeyId: null, ipAddress: null, userAgent: null });
    expect(who.performerSnapshot).toMatchObject({ name: expect.any(String) as unknown, source: "upstream-import" });
  });

  it("a deleted upstream user: the key, with the pseudonym by sequence number (never the upstream id)", async () => {
    await provision();
    const keyActor = await inTenant(A, () => importKey.importKeyActor(A, "synthetic"));
    const who = await inTenant(A, () => importKey.importCalibrationPerformer(A, { kind: "former", sequence: 7 }, keyActor));
    expect(who).toEqual({ actor: keyActor, performerSnapshot: { name: "Former upstream user #7", role: null, organisation: null, source: "upstream-import" } });
  });

  it.each([[0], [1.5]])("refuses a former user's sequence %s (400)", async (sequence) => {
    await provision();
    const keyActor = await inTenant(A, () => importKey.importKeyActor(A, "synthetic"));
    const err = await errorOf(inTenant(A, () => importKey.importCalibrationPerformer(A, { kind: "former", sequence }, keyActor)));
    expect(err.status).toBe(400);
  });

  it("a NULL upstream user: the key, recorded as the import, organisation the tenant", async () => {
    await provision();
    const keyActor = await inTenant(A, () => importKey.importKeyActor(A, "synthetic"));
    const who = await inTenant(A, () => importKey.importCalibrationPerformer(A, { kind: "none" }, keyActor));
    const tenant = mdb.rows("Tenant").find((t) => t["id"] === world.tenantA);
    expect(who.performerSnapshot).toEqual({ name: "Upstream import", role: "import", organisation: tenant?.["name"], source: "upstream-import" });
    expect(who.actor).toBe(keyActor);
  });

  it("a NULL upstream user of a tenant that does not exist: organisation null", async () => {
    const ghost = toTenantId("c9000000-0000-4000-8000-0000000000ff");
    const who = await inTenant(ghost, () => importKey.importCalibrationPerformer(ghost, { kind: "none" }, { apiKeyId: "a9000000-0000-4000-8000-0000000000ff" }));
    expect(who.performerSnapshot.organisation).toBeNull();
  });

  it("without the key actor a record with no person is refused, not written as nobody", async () => {
    const err = await errorOf(inTenant(A, () => importKey.importCalibrationPerformer(A, { kind: "none" }, { userId: world.staff.id })));
    expect(err.status).toBe(500);
  });

  it("two tenants: a mapped user of tenant B is refused (409), not replaced by the key", async () => {
    await provision();
    const keyActor = await inTenant(A, () => importKey.importKeyActor(A, "synthetic"));
    const err = await errorOf(inTenant(A, () => importKey.importCalibrationPerformer(A, { kind: "user", userId: world.other.id }, keyActor)));
    expect(err).toMatchObject({ status: 409, publicCode: "IMPORT_PERFORMER_NOT_FOUND" });
  });

  it("a mapped user deleted here is refused the same way", async () => {
    const gone = "c9000000-0000-4000-8000-0000000000fe";
    mdb.seed("User", { id: gone, tenantId: world.tenantA, username: "gone", name: "gone", email: "gone@a.test", password: "not-a-hash", isDeleted: true, is_deleted: true });
    const err = await errorOf(inTenant(A, () => importKey.importCalibrationPerformer(A, { kind: "user", userId: gone }, { apiKeyId: "a9000000-0000-4000-8000-0000000000ff" })));
    expect(err.publicCode).toBe("IMPORT_PERFORMER_NOT_FOUND");
  });
});

describe("P24-04 — revoked at cutover (FT-101)", () => {
  it("revokes the tenant's live import keys (audited), leaves tenant B's, and the runbook check passes", async () => {
    const a = await inTenant(A, () => importKey.provisionImportKey(A, { signOffDate: SIGN_OFF, dataClass: "synthetic" }, { userId: world.admin.id }));
    await inTenant(B, () => importKey.provisionImportKey(B, { signOffDate: SIGN_OFF, dataClass: "synthetic" }, { userId: world.other.id }));
    expect(await inTenant(A, () => importKey.importKeyRevoked(A))).toBe(false);

    expect(await inTenant(A, () => importKey.revokeImportKeys(A, { userId: world.admin.id }))).toEqual([a.key.id]);
    expect(audits("API_KEY_REVOKE")).toEqual([expect.objectContaining({ tenantId: world.tenantA, userId: world.admin.id, resourceId: a.key.id })]);
    expect(await inTenant(A, () => importKey.importKeyRevoked(A))).toBe(true);
    // A revoked key no longer records.
    expect((await errorOf(inTenant(A, () => importKey.importKeyActor(A, "synthetic")))).publicCode).toBe("IMPORT_KEY_MISSING");
    // B's key is untouched.
    expect(await inTenant(B, () => importKey.importKeyRevoked(B))).toBe(false);
    // A second revocation finds nothing.
    expect(await inTenant(A, () => importKey.revokeImportKeys(A, { userId: world.admin.id }))).toEqual([]);
  });
});
