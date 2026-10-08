/**
 * P21-09d — G-14: `facilityClause` (spec P19-04 § 8, AM-9). Skip for every unbound shape, the
 * bound context's facility bound as the LAST parameter, the deny sentinel for a bound principal
 * with no facility, and no facility parameter at the type level.
 */
import { facilityClause, type FacilityColumn } from "../../utils/facilityPredicate.util";
import { tenantStorage, type TenantContextStore } from "../../middlewares/tenantContext.middleware";
import { NO_FACILITY_ID, type ClientFacilityId, type TenantId } from "../../types/ids";

const T = "aaaaaaaa-0000-4000-8000-000000000001" as TenantId;
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1" as ClientFacilityId;

const within = <R>(store: Partial<TenantContextStore> | null, fn: () => R): R =>
  store === null
    ? fn()
    : tenantStorage.run({ tenantId: T, isSuperAdmin: false, isSystemTask: false, ...store }, fn);

describe("G-14 facilityClause", () => {
  it.each([
    ["no context", null],
    ["a system task", { isSystemTask: true, facilityBound: true, clientFacilityId: F1 }],
    ["the super admin", { isSuperAdmin: true, facilityBound: true, clientFacilityId: F1 }],
    ["an unbound principal", { facilityBound: false, clientFacilityId: null }],
    ["a context without the facility fields", {}],
  ] as const)("%s: an empty clause, nothing bound", (_name, store) => {
    expect(within(store, () => facilityClause("client_facility_id", 2))).toEqual({ clause: "", bind: [] });
  });

  it("bound: the clause names the column and binds the context's facility at the given position", () => {
    expect(within({ facilityBound: true, clientFacilityId: F1 }, () => facilityClause("d.client_facility_id", 3))).toEqual({
      clause: " AND d.client_facility_id = $3",
      bind: [F1],
    });
  });

  it("bound with no facility: the deny sentinel, never an open clause", () => {
    expect(within({ facilityBound: true, clientFacilityId: null }, () => facilityClause("client_facility_id", 1))).toEqual({
      clause: " AND client_facility_id = $1",
      bind: [NO_FACILITY_ID],
    });
  });

  it("refuses a column outside the allow-listed shape and a bad position", () => {
    expect(() => facilityClause("tenant_id" as unknown as FacilityColumn, 1)).toThrow(TypeError);
    expect(() => facilityClause("x.client_facility_id; DROP" as unknown as FacilityColumn, 1)).toThrow(TypeError);
    expect(() => facilityClause("client_facility_id", 0)).toThrow(TypeError);
    expect(() => facilityClause("client_facility_id", 1.5)).toThrow(TypeError);
  });

  it("has no facility parameter (AM-9): the arity is two", () => {
    expect(facilityClause.length).toBe(2);
    // @ts-expect-error -- a third (facility) argument does not compile: the facility comes from the context only
    expect(within({ facilityBound: true, clientFacilityId: F1 }, () => facilityClause("client_facility_id", 1, "other"))).toEqual({
      clause: " AND client_facility_id = $1",
      bind: [F1],
    });
  });
});
