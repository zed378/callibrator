/**
 * Q-55 (ADR-097 Am. 4) — the work-order bounds the contract enforces, matching
 * migration 0107's columns: a cost is NUMERIC(14,2) ≥ 0, resolution notes are
 * at most 5000 characters, and a completion is not before the schedule when the
 * same request gives both. Before Q-55 each over-bound value was accepted (and
 * then dropped, there being no column).
 */
import { MAX_COST, MAX_RESOLUTION_NOTES, createWorkOrder, updateWorkOrder } from "@callibrator/contracts/maintenance";

const DEVICE = "a0550000-0000-4000-8000-000000000001";

describe("@callibrator/contracts/maintenance — Q-55 bounds", () => {
  it("costs: 0 and the NUMERIC(14,2) maximum pass; negative and over the maximum fail", () => {
    expect(MAX_COST).toBe(999_999_999_999.99);
    expect(updateWorkOrder.safeParse({ actualCost: 0 }).success).toBe(true);
    expect(updateWorkOrder.safeParse({ actualCost: MAX_COST }).success).toBe(true);
    expect(updateWorkOrder.safeParse({ actualCost: -0.01 }).success).toBe(false);
    expect(createWorkOrder.safeParse({ deviceId: DEVICE, title: "PM", type: "Repair", estimatedCost: 1e12 }).success).toBe(false);
    expect(updateWorkOrder.parse({ estimatedCost: "1250.5" }).estimatedCost).toBe(1250.5);
  });

  it("resolution notes: 5000 characters pass, 5001 fail", () => {
    expect(MAX_RESOLUTION_NOTES).toBe(5000);
    expect(updateWorkOrder.safeParse({ resolutionNotes: "x".repeat(5000) }).success).toBe(true);
    expect(updateWorkOrder.safeParse({ resolutionNotes: "x".repeat(5001) }).success).toBe(false);
  });

  it("a completion before the schedule fails on completedDate; the same day, or only one of the two, passes", () => {
    const early = updateWorkOrder.safeParse({ scheduledDate: "2026-11-05", completedDate: "2026-11-04" });
    expect(early.success).toBe(false);
    expect(early.error?.issues[0]?.path).toEqual(["completedDate"]);
    expect(updateWorkOrder.safeParse({ scheduledDate: "2026-11-05", completedDate: "2026-11-05" }).success).toBe(true);
    expect(updateWorkOrder.safeParse({ completedDate: "2026-11-04" }).success).toBe(true);
    expect(updateWorkOrder.safeParse({ scheduledDate: "2026-11-05", completedDate: null }).success).toBe(true);
  });
});
