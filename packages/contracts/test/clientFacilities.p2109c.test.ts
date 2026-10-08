/**
 * P21-09c — the facility administration routes validate the path parameter and the body together
 * (`validate(schema, { from: ["params", "body"] })`): `clientFacilityEdit` and
 * `clientFacilityStatusRequest` (spec MEMORY/specs/P19-04-client-facilities.md § 13.1, § 13.2).
 */
import { clientFacilityEdit, clientFacilityStatusRequest } from "@callibrator/contracts/clientFacilities";

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";

describe("P21-09c — clientFacilityEdit (params + body)", () => {
  it("accepts the id with one field, normalising as the body schema does", () => {
    expect(clientFacilityEdit.parse({ clientFacilityId: F1, name: "  Facility   One ", code: "f-0001" })).toEqual({
      clientFacilityId: F1,
      name: "Facility One",
      code: "F-0001",
    });
  });

  it("refuses the id alone (nothing to change), a bad id, an unknown key and SELF", () => {
    expect(clientFacilityEdit.safeParse({ clientFacilityId: F1 }).success).toBe(false);
    expect(clientFacilityEdit.safeParse({ clientFacilityId: "not-a-uuid", name: "X" }).success).toBe(false);
    expect(clientFacilityEdit.safeParse({ clientFacilityId: F1, name: "X", status: "ended" }).success).toBe(false);
    expect(clientFacilityEdit.safeParse({ clientFacilityId: F1, isSelf: true }).success).toBe(false);
    expect(clientFacilityEdit.safeParse({ clientFacilityId: F1, code: "self" }).success).toBe(false);
  });
});

describe("P21-09c — clientFacilityStatusRequest (params + body)", () => {
  it("accepts the id, a status and a reason", () => {
    expect(clientFacilityStatusRequest.parse({ clientFacilityId: F1, status: "inactive", reason: " paused contract " })).toEqual({
      clientFacilityId: F1,
      status: "inactive",
      reason: "paused contract",
    });
  });

  it("refuses a missing id, an unknown status, a short reason and an unknown key", () => {
    expect(clientFacilityStatusRequest.safeParse({ status: "inactive", reason: "paused" }).success).toBe(false);
    expect(clientFacilityStatusRequest.safeParse({ clientFacilityId: F1, status: "gone", reason: "paused" }).success).toBe(false);
    expect(clientFacilityStatusRequest.safeParse({ clientFacilityId: F1, status: "ended", reason: "no" }).success).toBe(false);
    expect(clientFacilityStatusRequest.safeParse({ clientFacilityId: F1, status: "ended", reason: "left", tenantId: F1 }).success).toBe(false);
  });
});
