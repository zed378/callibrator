/**
 * P21-07 (ADR-126 Am. 6) — the "due" reference month: `GET /ipm/due?month=YYYY-MM` and
 * `ipmDueReference`, the one rule the server (and later the PWA) uses to turn it into the `today`
 * that `computeIpmDue` reads.
 */
import { IPM_DUE_MONTH_HORIZON, IPM_DUE_MONTH_OUT_OF_RANGE, computeIpmDue, ipmDueReference } from "@callibrator/contracts/inspectionValues";
import { IPM_DUE_MONTH_PATTERN, ipmDueQuery } from "@callibrator/contracts/inspectionSessions";

describe("P21-07 — ipmDueQuery.month", () => {
  it("accepts YYYY-MM and leaves it absent by default", () => {
    expect(ipmDueQuery.parse({ month: "2026-11" }).month).toBe("2026-11");
    expect(ipmDueQuery.parse({}).month).toBeUndefined();
  });

  it.each(["2026-13", "2026-00", "2026-1", "26-01", "2026-01-01", "next"])("refuses %s", (month) => {
    expect(ipmDueQuery.safeParse({ month }).success).toBe(false);
    expect(IPM_DUE_MONTH_PATTERN.test(month)).toBe(false);
  });
});

describe("P21-07 — ipmDueReference", () => {
  // 2026-10-31 18:00 UTC is 2026-11-01 01:00 in Jakarta: the current month is November there.
  const today = new Date("2026-10-31T18:00:00Z");

  it("the current month (in the zone) up to the horizon is in range: the 15th, 12:00 UTC", () => {
    expect(ipmDueReference("2026-11", today, "Asia/Jakarta")).toEqual(new Date("2026-11-15T12:00:00Z"));
    expect(ipmDueReference("2028-11", today, "Asia/Jakarta")).toEqual(new Date("2028-11-15T12:00:00Z"));
    expect(ipmDueReference("2026-10", today, "UTC")).toEqual(new Date("2026-10-15T12:00:00Z"));
    expect(IPM_DUE_MONTH_HORIZON).toBe(24);
    expect(IPM_DUE_MONTH_OUT_OF_RANGE).toBe("IPM_DUE_MONTH_OUT_OF_RANGE");
  });

  it("a past month or one beyond the horizon is null", () => {
    expect(ipmDueReference("2026-10", today, "Asia/Jakarta")).toBeNull();
    expect(ipmDueReference("2028-12", today, "Asia/Jakarta")).toBeNull();
    expect(ipmDueReference("2025-12", today, "UTC")).toBeNull();
  });

  it("read by computeIpmDue, the reference month decides due vs ok", () => {
    const base = { status: "active", intervalOverride: null, tenantInterval: 3, timeZone: "Asia/Jakarta" };
    const last = new Date("2026-09-10T03:00:00Z"); // due 2026-12
    const now = computeIpmDue({ ...base, lastEffectivePerformedAt: last, today });
    expect(now).toMatchObject({ state: "ok", dueMonth: "2026-12" });
    const december = ipmDueReference("2026-12", today, "Asia/Jakarta") as Date;
    expect(computeIpmDue({ ...base, lastEffectivePerformedAt: last, today: december })).toMatchObject({ state: "due", dueMonth: "2026-12" });
  });
});
