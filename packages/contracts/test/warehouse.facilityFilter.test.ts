/**
 * The warehouse list's `clientFacilityId` filter (@callibrator/contracts/warehouse): optional,
 * and a UUID when given — the field app asks for one facility's rooms.
 */
import { getWarehousesQuery } from "@callibrator/contracts/warehouse";

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";

describe("@callibrator/contracts/warehouse — the list's facility filter", () => {
  it("is optional, and passes a UUID beside the kind", () => {
    expect(getWarehousesQuery.parse({}).clientFacilityId).toBeUndefined();
    expect(getWarehousesQuery.parse({ kind: "room", clientFacilityId: F1 })).toMatchObject({ kind: "room", clientFacilityId: F1 });
  });

  it("refuses anything that is not a UUID", () => {
    expect(getWarehousesQuery.safeParse({ clientFacilityId: "facility-1" }).success).toBe(false);
    expect(getWarehousesQuery.safeParse({ clientFacilityId: "" }).success).toBe(false);
  });
});
