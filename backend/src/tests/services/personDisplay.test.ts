/**
 * P21-09e — G-24 `personDisplay` (spec P19-04 § 12), over memoryDb: the exact key set, the
 * sources in order (snapshot, users), every fallback, and the redaction rule for a bound viewer.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as DisplayModule from "../../services/personDisplay.service";
import { tenantStorage, type TenantContextStore } from "../../middlewares/tenantContext.middleware";
import { PERSON_DISPLAY_KEYS } from "@callibrator/contracts/people";
import type { ClientFacilityId, TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const display = jest.requireActual<typeof DisplayModule>("../../services/personDisplay.service");

const T = "aaaaaaaa-0000-4000-8000-000000000001";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F_GONE = "f9f9f9f9-f9f9-4f9f-8f9f-f9f9f9f9f9f9";
const ROLE = "a0000000-0000-4000-8000-0000000000a1";
const STAFF = "cccccccc-0000-4000-8000-000000000001";
const NAMELESS = "cccccccc-0000-4000-8000-000000000002";
const LOST_FACILITY = "cccccccc-0000-4000-8000-000000000003";
const NO_TENANT = "cccccccc-0000-4000-8000-000000000004";
const OUTSIDE = "cccccccc-0000-4000-8000-0000000000ff";
const BOUND_F1 = "cccccccc-0000-4000-8000-000000000005";

const inCtx = <R>(store: Partial<TenantContextStore> | null, fn: () => Promise<R>): Promise<R> =>
  store === null ? fn() : tenantStorage.run({ tenantId: T as TenantId, isSuperAdmin: false, isSystemTask: false, ...store }, fn);

beforeEach(() => {
  mdb.reset();
  mdb.seed("Tenant", { id: T, name: "The Lab", code: "LAB", status: "active" });
  mdb.seed("Role", { id: ROLE, name: "TECHNICIAN", status: "active", roleLevel: 3 });
  mdb.seed("ClientFacility", { id: F1, tenantId: T, name: "Facility One", code: "F-0001", status: "active" });
  const user = (id: string, extra: Record<string, unknown>): Record<string, unknown> => ({
    id, tenantId: T, username: id.slice(-4), email: `${id.slice(-4)}@example.test`, password: "x", roleId: ROLE, status: "ACTIVE", isActive: true, firstName: "Ana", lastName: "Kalibrator", ...extra,
  });
  mdb.seed("User", [
    user(STAFF, {}),
    user(NAMELESS, { firstName: " ", lastName: "", roleId: null }),
    user(LOST_FACILITY, { clientFacilityId: F_GONE }),
    user(NO_TENANT, { tenantId: null }),
    user(BOUND_F1, { clientFacilityId: F1, firstName: "Room", lastName: "One" }),
  ]);
});

describe("G-24 displayPeople", () => {
  it("no ids → nothing read", async () => {
    expect((await display.displayPeople([null, undefined, ""])).size).toBe(0);
  });

  it("every fallback: no name, no role, a facility that is gone, no tenant, a user outside the tenant", async () => {
    const out = await inCtx(null, () => display.displayPeople([STAFF, NAMELESS, LOST_FACILITY, NO_TENANT, OUTSIDE, STAFF]));
    expect(Object.fromEntries(out)).toEqual({
      [STAFF]: { name: "Ana Kalibrator", role: "TECHNICIAN", organisation: "The Lab", redacted: false },
      [NAMELESS]: { name: null, role: null, organisation: "The Lab", redacted: false },
      [LOST_FACILITY]: { name: "Ana Kalibrator", role: "TECHNICIAN", organisation: null, redacted: false },
      [NO_TENANT]: { name: "Ana Kalibrator", role: "TECHNICIAN", organisation: null, redacted: false },
      [OUTSIDE]: { name: "Platform support", role: null, organisation: null, redacted: false },
    });
    for (const shown of out.values()) {
      expect(Object.keys(shown).sort()).toEqual([...PERSON_DISPLAY_KEYS].sort());
    }
  });

  it("a bound author's organisation is its facility", async () => {
    expect((await display.displayPeople([BOUND_F1])).get(BOUND_F1)).toEqual({ name: "Room One", role: "TECHNICIAN", organisation: "Facility One", redacted: false });
  });

  it("authors with no tenant read no tenant", async () => {
    expect((await display.displayPeople([NO_TENANT])).get(NO_TENANT)?.organisation).toBeNull();
  });

  it("a bound viewer with no facility sees every bound author redacted; staff in full", async () => {
    const out = await inCtx({ facilityBound: true, clientFacilityId: null }, () => display.displayPeople([LOST_FACILITY, STAFF]));
    expect(out.get(LOST_FACILITY)).toEqual({ name: null, role: "TECHNICIAN", organisation: null, redacted: true });
    expect(out.get(STAFF)?.redacted).toBe(false);
  });

  it("a bound viewer of the author's own facility sees the author", async () => {
    const out = await inCtx({ facilityBound: true, clientFacilityId: F_GONE as ClientFacilityId }, () => display.displayPeople([LOST_FACILITY]));
    expect(out.get(LOST_FACILITY)?.redacted).toBe(false);
  });
});

describe("G-24 withDisplays and the certificate snapshot", () => {
  it("adds each display field; a missing id is null; a model instance is answered as JSON", async () => {
    const instance = { toJSON: () => ({ id: "r1", performedBy: STAFF }) };
    const rows = await display.withDisplays([instance, { id: "r2", performedBy: null }], { performerDisplay: "performedBy" });
    expect(rows[0]?.["performerDisplay"]).toMatchObject({ name: "Ana Kalibrator" });
    expect(rows[1]?.["performerDisplay"]).toBeNull();
  });

  it("a signed certificate prints its snapshot; without an issuer name, organisation null; unsigned falls through", async () => {
    const signed = { id: "c1", calibratedBy: STAFF, signedSnapshot: { issuer: { name: "The Lab" }, calibratedBy: "As Printed" } };
    const bare = { id: "c2", calibratedBy: STAFF, signedSnapshot: { issuer: null, calibratedBy: null } };
    const unsigned = { id: "c3", calibratedBy: STAFF, signedSnapshot: null };
    const rows = await display.withDisplays([signed, bare, unsigned], { calibratedByDisplay: "calibratedBy" }, display.certificateSnapshotDisplay);
    expect(rows.map((r) => r["calibratedByDisplay"])).toEqual([
      { name: "As Printed", role: null, organisation: "The Lab", redacted: false },
      { name: null, role: null, organisation: null, redacted: false },
      { name: "Ana Kalibrator", role: "TECHNICIAN", organisation: "The Lab", redacted: false },
    ]);
    expect(await display.withDisplay(unsigned, { calibratedByDisplay: "calibratedBy" })).toMatchObject({ id: "c3" });
  });
});
