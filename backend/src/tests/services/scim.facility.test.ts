/**
 * P21-09e — G-18 (spec P19-04 § 10.6; AM-15): provisioning by an identity provider in a tenant that
 * serves client facilities — SCIM and SSO just-in-time — over memoryDb (REAL models, hooks, audit).
 *
 *  - a tenant with only its self facility: nothing changes (`facilityBindingPending` false);
 *  - a tenant with a client facility: the new account is created PENDING (auth then refuses it
 *    `FACILITY_BINDING_PENDING` — tests/middlewares/facilityContext.auth);
 *  - SCIM never sets or clears a facility: a body, an extension attribute, a PATCH path or a PATCH
 *    value naming one is a 400, and nothing is written;
 *  - a BOUND user cannot be given a role outside the bound set by replace, patch or remove (400).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ScimService from "../../services/scim.service";
import type * as SsoService from "../../services/sso.service";
import { ROLE_IDS, ROLE_NAMES } from "../../constants/roleConstants";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(true)),
  del: jest.fn(() => Promise.resolve(true)),
  incr: jest.fn(() => Promise.resolve(1)),
  expire: jest.fn(() => Promise.resolve(true)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const scim = jest.requireActual<typeof ScimService>("../../services/scim.service");
const sso = jest.requireActual<typeof SsoService>("../../services/sso.service");

const SINGLE = "aaaaaaaa-0000-4000-8000-000000000001";
const MULTI = "bbbbbbbb-0000-4000-8000-000000000002";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const BOUND = "cccccccc-0000-4000-8000-0000000000b1";
const KEY = { apiKeyId: "dddddddd-0000-4000-8000-000000000001" };

beforeEach(() => {
  mdb.reset();
  mdb.seed("Tenant", [
    { id: SINGLE, name: "Self-served", code: "SS", status: "active" },
    { id: MULTI, name: "Provider", code: "PR", status: "active" },
  ]);
  mdb.seed("Role", (["USER", "TECHNICIAN", "ROOM_USER", "HEALTHCARE_TECHNICIAN"] as const).map((k) => ({ id: ROLE_IDS[k], name: ROLE_NAMES[k], status: "active", roleLevel: 1 })));
  mdb.seed("ClientFacility", [
    { id: "50505050-5050-4050-8050-505050505051", tenantId: SINGLE, name: "Self", code: "SELF", isSelf: true, status: "active" },
    { id: "50505050-5050-4050-8050-505050505052", tenantId: MULTI, name: "Self", code: "SELF", isSelf: true, status: "active" },
    { id: F1, tenantId: MULTI, name: "Facility One", code: "F-0001", status: "active" },
  ]);
  mdb.seed("User", {
    id: BOUND, tenantId: MULTI, username: "bound@example.test", email: "bound@example.test", password: "x", firstName: "B", lastName: "U",
    roleId: ROLE_IDS.ROOM_USER, clientFacilityId: F1, status: "ACTIVE", isActive: true,
  });
});

const pendingOf = (email: string): unknown => mdb.rows("User").find((u) => u["email"] === email)?.["facilityBindingPending"];

describe("G-18 SCIM — pending in a multi-facility tenant, never a facility", () => {
  it("a self-served tenant: the new account is not pending", async () => {
    await scim.createUser(SINGLE, { userName: "a@example.test" }, KEY);
    expect(pendingOf("a@example.test")).toBe(false);
  });

  it("a tenant with a client facility: the new account is pending", async () => {
    await scim.createUser(MULTI, { userName: "b@example.test" }, KEY);
    expect(pendingOf("b@example.test")).toBe(true);
  });

  it.each([
    ["a body attribute", { userName: "c@example.test", clientFacilityId: F1 }],
    ["an extension attribute", { userName: "c@example.test", "urn:callibrator:scim:1.0:User": { clientFacilityId: F1 } }],
  ])("create with %s naming a facility → 400, nothing written", async (_l, body) => {
    const before = mdb.committed().length;
    await expect(scim.createUser(MULTI, body as Parameters<typeof scim.createUser>[1], KEY)).rejects.toMatchObject({ status: 400 });
    expect(mdb.committed().slice(before)).toEqual([]);
  });

  it.each([
    ["a path", [{ op: "replace", path: "urn:callibrator:scim:1.0:User:clientFacilityId", value: F1 }]],
    ["a value object", [{ op: "replace", value: { clientFacilityId: null } }]],
  ])("patch with %s naming a facility → 400", async (_l, ops) => {
    await expect(scim.patchUser(MULTI, BOUND, ops as Parameters<typeof scim.patchUser>[2], KEY)).rejects.toMatchObject({ status: 400 });
    expect(mdb.rows("User").find((u) => u["id"] === BOUND)?.["clientFacilityId"]).toBe(F1);
  });

  it("a bound user: a role outside the bound set is refused (replace, patch, remove); a bound role is accepted", async () => {
    await expect(scim.updateUser(MULTI, BOUND, { roleId: ROLE_IDS.TECHNICIAN }, KEY)).rejects.toMatchObject({ status: 400 });
    await expect(scim.patchUser(MULTI, BOUND, [{ op: "replace", path: "roleId", value: ROLE_IDS.TECHNICIAN }], KEY)).rejects.toMatchObject({ status: 400 });
    await expect(scim.patchUser(MULTI, BOUND, [{ op: "remove", path: "roleId" }], KEY)).rejects.toMatchObject({ status: 400 });
    await scim.patchUser(MULTI, BOUND, [{ op: "replace", path: "roleId", value: ROLE_IDS.HEALTHCARE_TECHNICIAN }], KEY);
    expect(mdb.rows("User").find((u) => u["id"] === BOUND)?.["roleId"]).toBe(ROLE_IDS.HEALTHCARE_TECHNICIAN);
  });
});

describe("G-18 SSO just-in-time provisioning", () => {
  it("a self-served tenant: not pending; a tenant with a client facility: pending", async () => {
    await sso.provisionUser(SINGLE as Parameters<typeof sso.provisionUser>[0], { email: "jit1@example.test", firstName: "J", lastName: "One" });
    await sso.provisionUser(MULTI as Parameters<typeof sso.provisionUser>[0], { email: "jit2@example.test", firstName: "J", lastName: "Two" });
    expect([pendingOf("jit1@example.test"), pendingOf("jit2@example.test")]).toEqual([false, true]);
  });
});
