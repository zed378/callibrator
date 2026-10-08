/**
 * P21-09 — the client-facility administration service (spec
 * MEMORY/specs/P19-04-client-facilities.md § 4.4 – § 4.6, § 13, § 16): every 409 of § 4.4 with its
 * text, the lifecycle, the session revocation on leaving `active` (AM-1, G-17's
 * clientFacilityStatus.revokesSessions row), delete only of an unreferenced facility, the audit
 * rows inside the transaction (contact fields as "changed", never their values), the bound
 * user's own facility (S-8), and another tenant's facility as a 404.
 *
 * The REAL service, models, hooks, session and audit services over memoryDb.
 */
import { UniqueConstraintError } from "sequelize";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as AdminService from "../../services/clientFacilityAdmin.service";
import type * as Models from "../../models";
import { tenantStorage, type TenantContextStore } from "../../middlewares/tenantContext.middleware";
import type { ClientFacilityId, TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(undefined)),
  del: jest.fn(() => Promise.resolve(undefined)),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const models = jest.requireActual<typeof Models>("../../models");
const svc = jest.requireActual<typeof AdminService>("../../services/clientFacilityAdmin.service");

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TenantId;
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TenantId;
const SELF = "50505050-5050-4050-8050-505050505050";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const F_T2 = "f9f9f9f9-f9f9-4f9f-8f9f-f9f9f9f9f9f9";
const ADMIN = "11111111-1111-4111-8111-111111111111";
const BOUND = "22222222-2222-4222-8222-222222222222";
const actor = { userId: ADMIN, ipAddress: "127.0.0.1", userAgent: "jest" };

const ctx = (over: Partial<TenantContextStore> = {}): TenantContextStore => ({
  tenantId: T,
  isSuperAdmin: false,
  isSystemTask: false,
  userId: ADMIN,
  clientFacilityId: null,
  facilityBound: false,
  ...over,
});
const asAdmin = <R>(fn: () => Promise<R>): Promise<R> => tenantStorage.run(ctx(), fn);
const audits = (operation: string): Record<string, unknown>[] =>
  mdb.rows("AuditLog").filter((r) => (r["changes"] as { operation?: string } | null)?.operation === operation);

beforeEach(() => {
  mdb.reset();
  mdb.seed("ClientFacility", [
    { id: SELF, tenantId: T, name: "Rumah Sakit Sintetis", code: "SELF", isSelf: true, status: "active", createdAt: new Date("2026-01-01") },
    { id: F1, tenantId: T, name: "Facility One", code: "F-0001", kind: "clinic", status: "active", createdAt: new Date("2026-02-01") },
    { id: F2, tenantId: T, name: "Facility Two", code: "F-0002", kind: "hospital", status: "inactive", statusReason: "paused", createdAt: new Date("2026-03-01") },
    { id: F_T2, tenantId: T2, name: "Facility One", code: "F-0001", status: "active" },
  ]);
  mdb.seed("User", { id: BOUND, tenantId: T, username: "bound", email: "bound@example.test", password: "x", status: "ACTIVE", isActive: true, clientFacilityId: F1, firstName: "Bound" });
  mdb.seed("Session", [
    { id: "5e550000-0000-4000-8000-000000000001", user_id: BOUND, tenant_id: T, token_hash: "h1", is_revoked: false, is_active: true },
    { id: "5e550000-0000-4000-8000-000000000002", user_id: ADMIN, tenant_id: T, token_hash: "h2", is_revoked: false, is_active: true },
  ]);
});

describe("reads", () => {
  it("getMine: null for an unbound caller; the own row for a bound one (the readable rule); null if it cannot be read", async () => {
    expect(await asAdmin(() => svc.getMine())).toBeNull();
    expect(await svc.getMine()).toBeNull();
    const mine = await tenantStorage.run(ctx({ userId: BOUND, clientFacilityId: F1 as ClientFacilityId, facilityBound: true }), () => svc.getMine());
    expect(mine).toEqual({ id: F1, name: "Facility One", code: "F-0001", kind: "clinic", isSelf: false, status: "active" });
    const gone = await tenantStorage.run(ctx({ clientFacilityId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" as ClientFacilityId, facilityBound: true }), () => svc.getMine());
    expect(gone).toBeNull();
  });

  it("list: the tenant's facilities only, filtered, searched, sorted with an id tiebreak; paging in meta", async () => {
    const all = await asAdmin(() => svc.listFacilities(T, { page: 1, limit: 25, sort: "name" }));
    expect(all.rows.map((r) => r.id)).toEqual([F1, F2, SELF]);
    expect(all.meta).toEqual({ total: 3, page: 1, limit: 25, totalPages: 1 });
    expect(all.rows[0]).not.toHaveProperty("legacyId");
    const filtered = await asAdmin(() => svc.listFacilities(T, { page: 1, limit: 25, sort: "code", status: "inactive", kind: "hospital" }));
    expect(filtered.rows.map((r) => r.id)).toEqual([F2]);
    const searched = await asAdmin(() => svc.listFacilities(T, { page: 1, limit: 25, sort: "createdAt", q: "f-000" }));
    expect(searched.rows.map((r) => r.id)).toEqual([F2, F1]);
  });

  it("get, options and the bound users: another tenant's facility is a 404", async () => {
    expect((await asAdmin(() => svc.getFacility(T, F1))).name).toBe("Facility One");
    await expect(asAdmin(() => svc.getFacility(T, F_T2))).rejects.toMatchObject({ status: 404, message: "Client facility not found" });
    expect((await asAdmin(() => svc.facilityOptions(T))).map((o) => o.code)).toEqual(["F-0001", "F-0002", "SELF"]);
    const users = await asAdmin(() => svc.facilityUsers(T, F1));
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: BOUND, username: "bound", firstName: "Bound", status: "ACTIVE" });
    await expect(asAdmin(() => svc.facilityUsers(T, F_T2))).rejects.toMatchObject({ status: 404 });
  });
});

describe("create and edit", () => {
  it("creates an active, non-self facility with one audit row; contact values are never audited", async () => {
    const created = await asAdmin(() =>
      svc.createFacility(T, { name: "Klinik Tiga", code: "F-0003", kind: "clinic", contactEmail: "contact@example.test" }, actor),
    );
    expect(created).toMatchObject({ name: "Klinik Tiga", code: "F-0003", isSelf: false, status: "active", contactEmail: "contact@example.test" });
    const [row] = audits("CREATE_CLIENT_FACILITY");
    expect(row).toMatchObject({ action: "CREATE", resourceId: created.id, clientFacilityId: created.id });
    expect(JSON.stringify(row?.["changes"])).not.toContain("contact@example.test");
    expect((row?.["changes"] as { contactFieldsChanged: string[] }).contactFieldsChanged).toEqual(["contactEmail"]);
  });

  it("an actor without a user (an API key) is recorded as no user", async () => {
    const key = { apiKeyId: "a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9" };
    const created = await asAdmin(() => svc.createFacility(T, { name: "By Key", code: "F-0020" }, key));
    expect(mdb.rows("ClientFacility").find((f) => f["id"] === created.id)?.["createdBy"] ?? null).toBeNull();
    await asAdmin(() => svc.updateFacility(T, created.id, { city: "X" }, key));
    await asAdmin(() => svc.changeFacilityStatus(T, created.id, { status: "inactive", reason: "paused" }, { ...key, tenantAdmin: false }));
    expect(mdb.rows("ClientFacility").find((f) => f["id"] === created.id)).toMatchObject({ status: "inactive" });
  });

  it("409 for a code or (case-insensitive) name the tenant already uses — never another tenant's", async () => {
    await expect(asAdmin(() => svc.createFacility(T, { name: "New", code: "F-0001" }, actor))).rejects.toMatchObject({ status: 409 });
    await expect(asAdmin(() => svc.createFacility(T, { name: "facility one", code: "F-0009" }, actor))).rejects.toMatchObject({ status: 409 });
    // Tenant B's own administrator may use the same code and name (uniqueness is per tenant).
    const other = tenantStorage.run(ctx({ tenantId: T2 }), () => svc.createFacility(T2, { name: "Facility Two", code: "F-0002" }, actor));
    await expect(other).resolves.toMatchObject({ code: "F-0002" });
  });

  it("a unique-index race is the same 409; any other error passes through", async () => {
    const spy = jest.spyOn(models.ClientFacility, "create").mockRejectedValueOnce(new UniqueConstraintError({}));
    await expect(asAdmin(() => svc.createFacility(T, { name: "Race", code: "F-0010" }, actor))).rejects.toMatchObject({ status: 409 });
    spy.mockRejectedValueOnce(new Error("boom"));
    await expect(asAdmin(() => svc.createFacility(T, { name: "Race", code: "F-0010" }, actor))).rejects.toThrow("boom");
    spy.mockRestore();
  });

  it("edits the named fields with before/after; the self facility keeps SELF; duplicates are 409", async () => {
    expect((await asAdmin(() => svc.updateFacility(T, F2, { city: "Kota" }, actor))).city).toBe("Kota");
    const edited = await asAdmin(() => svc.updateFacility(T, F1, { name: "Facility Uno", contactPhone: "0800" }, actor));
    expect(edited).toMatchObject({ name: "Facility Uno", contactPhone: "0800", code: "F-0001" });
    const row = audits("UPDATE_CLIENT_FACILITY").find((r) => r["resourceId"] === F1);
    expect(row?.["changes"]).toMatchObject({ before: { name: "Facility One" }, after: { name: "Facility Uno" }, contactFieldsChanged: ["contactPhone"] });
    await expect(asAdmin(() => svc.updateFacility(T, SELF, { code: "OWN" }, actor))).rejects.toMatchObject({
      status: 409,
      message: "The tenant's own facility keeps its code SELF.",
    });
    expect((await asAdmin(() => svc.updateFacility(T, SELF, { name: "Our Hospital", code: "SELF" }, actor))).name).toBe("Our Hospital");
    expect((await asAdmin(() => svc.updateFacility(T, SELF, { kind: "hospital" }, actor))).kind).toBe("hospital");
    await expect(asAdmin(() => svc.updateFacility(T, F2, { code: "F-0001" }, actor))).rejects.toMatchObject({ status: 409 });
    await expect(asAdmin(() => svc.updateFacility(T, F_T2, { name: "X" }, actor))).rejects.toMatchObject({ status: 404 });
    const spy = jest.spyOn(models.ClientFacility.prototype, "update").mockRejectedValueOnce(new UniqueConstraintError({}));
    await expect(asAdmin(() => svc.updateFacility(T, F1, { name: "Race" }, actor))).rejects.toMatchObject({ status: 409 });
    spy.mockRestore();
  });
});

describe("§ 4.4 — the status lifecycle", () => {
  it.each([
    [{ isSelf: true, status: "active" }, "inactive", false, 409, "The tenant's own facility cannot be deactivated or ended — it holds the tenant's own devices."],
    [{ isSelf: false, status: "ended" }, "ended", true, 409, "This facility is already ended."],
    [{ isSelf: false, status: "ended" }, "inactive", true, 409, "An ended facility can only be reinstated to active."],
    [{ isSelf: false, status: "ended" }, "active", false, 403, "Only a tenant administrator can reinstate an ended facility."],
  ] as const)("refuses %j → %s (tenant admin: %s) with %i", (row, to, admin, status, message) => {
    expect(svc.statusRefusal(row, to, admin)).toMatchObject({ status, message });
  });

  it.each([
    [{ isSelf: false, status: "ended" }, "active", true],
    [{ isSelf: false, status: "active" }, "ended", false],
    [{ isSelf: false, status: "inactive" }, "active", false],
  ] as const)("allows %j → %s", (row, to, admin) => {
    expect(svc.statusRefusal(row, to, admin)).toBeNull();
  });

  it("leaving active revokes every session of the facility's bound users in the transaction (AM-1), audited with the count", async () => {
    const out = await asAdmin(() => svc.changeFacilityStatus(T, F1, { status: "ended", reason: "contract over" }, { ...actor, tenantAdmin: false }));
    expect(out.sessionsRevoked).toBe(1);
    expect(out.facility).toMatchObject({ status: "ended", statusReason: "contract over" });
    expect(mdb.rows("Session").filter((s) => !s["is_revoked"]).map((s) => s["user_id"])).toEqual([ADMIN]);
    expect(audits("CHANGE_CLIENT_FACILITY_STATUS")[0]?.["changes"]).toMatchObject({ from: "active", to: "ended", sessionsRevoked: 1 });
    const back = await asAdmin(() => svc.changeFacilityStatus(T, F1, { status: "active", reason: "renewed" }, { ...actor, tenantAdmin: true }));
    expect(back.sessionsRevoked).toBe(0);
  });

  it("a refused change writes nothing", async () => {
    const before = mdb.dump();
    await expect(asAdmin(() => svc.changeFacilityStatus(T, SELF, { status: "ended", reason: "nope" }, { ...actor, tenantAdmin: true }))).rejects.toMatchObject({ status: 409 });
    expect(mdb.dump()).toEqual(before);
  });
});

describe("§ 4.6 — delete", () => {
  it("refuses the self facility and a referenced one (with the counts); deletes an unreferenced one, audited", async () => {
    await expect(asAdmin(() => svc.deleteFacility(T, SELF, actor))).rejects.toMatchObject({ status: 409, message: "The tenant's own facility cannot be deleted." });
    await expect(asAdmin(() => svc.deleteFacility(T, F1, actor))).rejects.toMatchObject({
      status: 409,
      message: "This facility holds 0 devices and 1 users; end it instead — its history is kept.",
    });
    await asAdmin(() => svc.deleteFacility(T, F2, actor));
    expect(mdb.rows("ClientFacility").map((f) => f["id"])).not.toContain(F2);
    expect(audits("DELETE_CLIENT_FACILITY")[0]).toMatchObject({ action: "DELETE", resourceId: F2, clientFacilityId: F2 });
    await expect(asAdmin(() => svc.deleteFacility(T, F_T2, actor))).rejects.toMatchObject({ status: 404 });
  });
});
