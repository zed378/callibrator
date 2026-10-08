/**
 * P21-09 (ADR-124 Am. 2; P19-04 spec § 7.2, § 10.1, § 13; P19-08 § 9.5, § 10) — the facility
 * contract: the refusal and scope-loss codes, the fingerprint's canonical text, and the request
 * schemas of the facility administration and the user binding.
 */
import {
  CLIENT_FACILITY_SORTS,
  FACILITY_MODES,
  FACILITY_REFUSAL_CODES,
  SCOPE_FINGERPRINT_VERSION,
  SCOPE_LOSS_CODES,
  clientFacilityCreate,
  clientFacilityIdParams,
  clientFacilityListQuery,
  clientFacilityStatusChange,
  clientFacilityUpdate,
  isScopeLossCode,
  scopeFingerprintInput,
  userFacilityBinding,
} from "@callibrator/contracts/clientFacilities";

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";

describe("P21-09 — codes and modes", () => {
  it("the refusal codes of § 7.2 and the route gate's, in order, frozen", () => {
    expect(FACILITY_REFUSAL_CODES).toEqual([
      "FACILITY_BINDING_PENDING",
      "FACILITY_UNRESOLVED",
      "FACILITY_INACTIVE",
      "FACILITY_ENDED",
      "FACILITY_ROUTE_REFUSED",
    ]);
    expect(Object.isFrozen(FACILITY_REFUSAL_CODES)).toBe(true);
  });

  it("the scope-loss codes of P19-08 § 10 — the route refusal is NOT one", () => {
    expect(SCOPE_LOSS_CODES).toEqual(["ACCOUNT_INACTIVE", "TENANT_SUSPENDED", "TENANT_DELETED", "FACILITY_INACTIVE", "FACILITY_ENDED", "FACILITY_BINDING_PENDING"]);
    expect(Object.isFrozen(SCOPE_LOSS_CODES)).toBe(true);
    expect(isScopeLossCode("FACILITY_ENDED")).toBe(true);
    expect(isScopeLossCode("FACILITY_ROUTE_REFUSED")).toBe(false);
    expect(isScopeLossCode(403)).toBe(false);
    expect(isScopeLossCode(undefined)).toBe(false);
  });

  it("two facility modes", () => {
    expect(FACILITY_MODES).toEqual(["single", "multi"]);
    expect(CLIENT_FACILITY_SORTS).toEqual(["name", "code", "createdAt"]);
  });
});

describe("P21-09 — the scope fingerprint's canonical text (AM-26)", () => {
  it("one part per line after the version; unbound and missing parts are explicit", () => {
    expect(scopeFingerprintInput({ tenantId: "t", clientFacilityId: F1, roleId: "r", facilityStatus: "active" })).toBe(
      `${SCOPE_FINGERPRINT_VERSION}\nt\n${F1}\nr\nactive`,
    );
    expect(scopeFingerprintInput({ tenantId: null, clientFacilityId: null, roleId: null, facilityStatus: null })).toBe(
      "scope-fingerprint/v1\n-\nunbound\n-\n-",
    );
  });
});

describe("P21-09 — clientFacilityCreate", () => {
  it("normalises the name, upper-cases the code, takes the details", () => {
    expect(
      clientFacilityCreate.parse({ name: "  Rumah   Sakit  Sintetis ", code: " f-0001 ", kind: "hospital", contactEmail: "contact@example.test", city: " Kota " }),
    ).toEqual({ name: "Rumah Sakit Sintetis", code: "F-0001", kind: "hospital", contactEmail: "contact@example.test", city: "Kota" });
  });

  it("refuses SELF, a bad code, an empty name, a bad e-mail, and every unknown key (isSelf, status, tenantId)", () => {
    expect(clientFacilityCreate.safeParse({ name: "A", code: "self" }).success).toBe(false);
    expect(clientFacilityCreate.safeParse({ name: "A", code: "-bad" }).success).toBe(false);
    expect(clientFacilityCreate.safeParse({ name: "   ", code: "F1" }).success).toBe(false);
    expect(clientFacilityCreate.safeParse({ name: "A", code: "F1", contactEmail: "nope" }).success).toBe(false);
    for (const key of ["isSelf", "status", "tenantId", "legacyId"]) {
      expect(clientFacilityCreate.safeParse({ name: "A", code: "F1", [key]: true }).success).toBe(false);
    }
  });
});

describe("P21-09 — clientFacilityUpdate, status change, list, params", () => {
  it("an update changes at least one field and stays strict", () => {
    expect(clientFacilityUpdate.parse({ name: "B" })).toEqual({ name: "B" });
    expect(clientFacilityUpdate.parse({ code: "f2", contactEmail: null })).toEqual({ code: "F2", contactEmail: null });
    expect(clientFacilityUpdate.safeParse({}).success).toBe(false);
    expect(clientFacilityUpdate.safeParse({ status: "ended" }).success).toBe(false);
  });

  it("a status change needs a known status and a reason", () => {
    expect(clientFacilityStatusChange.parse({ status: "inactive", reason: " paused " })).toEqual({ status: "inactive", reason: "paused" });
    expect(clientFacilityStatusChange.safeParse({ status: "deleted", reason: "xyz" }).success).toBe(false);
    expect(clientFacilityStatusChange.safeParse({ status: "ended", reason: "x" }).success).toBe(false);
  });

  it("the list query: defaults, bounds, strict", () => {
    expect(clientFacilityListQuery.parse({})).toEqual({ page: 1, limit: 25, sort: "name" });
    expect(clientFacilityListQuery.parse({ page: "2", limit: "200", status: "ended", kind: "clinic", q: " rs ", sort: "code" })).toEqual({
      page: 2,
      limit: 200,
      status: "ended",
      kind: "clinic",
      q: "rs",
      sort: "code",
    });
    expect(clientFacilityListQuery.safeParse({ limit: "201" }).success).toBe(false);
    expect(clientFacilityListQuery.safeParse({ clientFacilityId: F1 }).success).toBe(false);
  });

  it("params take a UUID", () => {
    expect(clientFacilityIdParams.parse({ clientFacilityId: F1 })).toEqual({ clientFacilityId: F1 });
    expect(clientFacilityIdParams.safeParse({ clientFacilityId: "x" }).success).toBe(false);
  });
});

describe("P21-09 — userFacilityBinding (§ 10.1)", () => {
  it("bind (a facility) and unbind (null) with a reason; strict", () => {
    expect(userFacilityBinding.parse({ userId: F1, clientFacilityId: F1, reason: "starts at F1" })).toEqual({
      userId: F1,
      clientFacilityId: F1,
      reason: "starts at F1",
    });
    expect(userFacilityBinding.parse({ userId: F1, clientFacilityId: null, roleId: F1, reason: "moves to provider" })).toMatchObject({
      clientFacilityId: null,
      roleId: F1,
    });
    expect(userFacilityBinding.safeParse({ userId: F1, clientFacilityId: F1 }).success).toBe(false);
    expect(userFacilityBinding.safeParse({ userId: F1, clientFacilityId: F1, reason: "ok ok", tenantId: F1 }).success).toBe(false);
  });
});
