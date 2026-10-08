/**
 * P21-09d — the device move contract (spec MEMORY/specs/P19-04-client-facilities.md § 11.2):
 * params and body together, strict, a reason required; the moves list's params; the count keys.
 */
import { DEVICE_MOVE_COUNT_KEYS, deviceMove, deviceMovesParams } from "@callibrator/contracts/clientFacilities";

const D = "d1d1d1d1-0000-4000-8000-000000000001";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const ROOM = "a0000000-0000-4000-8000-000000000002";

describe("P21-09d — deviceMove (params + body)", () => {
  it("accepts the device, the target, a trimmed reason, and an optional or null location", () => {
    expect(deviceMove.parse({ calibrationDeviceId: D, targetClientFacilityId: F2, reason: "  handed over " })).toEqual({
      calibrationDeviceId: D,
      targetClientFacilityId: F2,
      reason: "handed over",
    });
    expect(deviceMove.parse({ calibrationDeviceId: D, targetClientFacilityId: F2, targetLocationId: ROOM, reason: "moved" }).targetLocationId).toBe(ROOM);
    expect(deviceMove.parse({ calibrationDeviceId: D, targetClientFacilityId: F2, targetLocationId: null, reason: "moved" }).targetLocationId).toBeNull();
  });

  it("refuses a missing or short reason, a bad id, and an unknown key (tenantId, clientFacilityId)", () => {
    expect(deviceMove.safeParse({ calibrationDeviceId: D, targetClientFacilityId: F2 }).success).toBe(false);
    expect(deviceMove.safeParse({ calibrationDeviceId: D, targetClientFacilityId: F2, reason: "x" }).success).toBe(false);
    expect(deviceMove.safeParse({ calibrationDeviceId: "nope", targetClientFacilityId: F2, reason: "moved" }).success).toBe(false);
    expect(deviceMove.safeParse({ calibrationDeviceId: D, targetClientFacilityId: F2, reason: "moved", tenantId: F2 }).success).toBe(false);
    expect(deviceMove.safeParse({ calibrationDeviceId: D, targetClientFacilityId: F2, reason: "moved", clientFacilityId: F2 }).success).toBe(false);
  });

  it("deviceMovesParams takes the device id; the count keys are the children and the re-keyed files", () => {
    expect(deviceMovesParams.parse({ calibrationDeviceId: D })).toEqual({ calibrationDeviceId: D });
    expect(deviceMovesParams.safeParse({ calibrationDeviceId: "x" }).success).toBe(false);
    expect(DEVICE_MOVE_COUNT_KEYS).toEqual(["calibration_records", "certificates", "maintenance_work_orders", "iot_readings", "non_conformances", "attachments_rekey"]);
  });
});
