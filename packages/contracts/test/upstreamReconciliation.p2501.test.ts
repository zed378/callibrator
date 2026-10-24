/**
 * P25-01 — the reconciliation contract (@callibrator/contracts/upstreamReconciliation):
 * the checks R-1 … R-12 and RC-F1 … RC-F5, written from the rules
 * (docs/UPSTREAM/05 § 7; threat model § 11, G-30), not read back from the
 * module: a check deleted from the list fails here.
 */
import {
    UPSTREAM_RECONCILIATION_CHECKS,
    reconciliationCheckResult,
    reconciliationFacilityRow,
    upstreamReconciliationResult,
} from "@callibrator/contracts/upstreamReconciliation";

describe("P25-01 @callibrator/contracts/upstreamReconciliation — the checks", () => {
    it("the checks: R-1 … R-12 with the facility checks RC-F1 … RC-F5 beside R-11", () => {
        expect([...UPSTREAM_RECONCILIATION_CHECKS]).toEqual([
            "R-1",
            "R-2",
            "R-3",
            "R-4",
            "R-5",
            "R-6",
            "R-7",
            "R-8",
            "R-9",
            "R-10",
            "R-11",
            "RC-F1",
            "RC-F2",
            "RC-F3",
            "RC-F4",
            "RC-F5",
            "R-12",
        ]);
        expect(new Set(UPSTREAM_RECONCILIATION_CHECKS).size).toBe(UPSTREAM_RECONCILIATION_CHECKS.length);
        expect(Object.isFrozen(UPSTREAM_RECONCILIATION_CHECKS)).toBe(true);
    });

    it("a check result: counts only, the delta, and a short note", () => {
        const parsed = reconciliationCheckResult.parse({
            check: "R-1",
            status: "pass",
            expected: 3,
            actual: 3,
            delta: 0,
            quarantined: 0,
            note: "devices with a QR per facility",
        });
        expect(parsed.delta).toBe(0);
        expect(() => reconciliationCheckResult.parse({ ...parsed, note: "x".repeat(281) })).toThrow();
    });

    it("a facility row names the facility by id and code only — never its name", () => {
        const parsed = reconciliationFacilityRow.parse({
            clientFacilityId: "a2501000-0000-4000-8000-0000000000f1",
            facilityCode: "F-0001",
            checks: [],
        });
        expect(parsed).not.toHaveProperty("name");
        expect(parsed).not.toHaveProperty("facilityName");
    });

    it("the answer: the run, its provider tenant, per-facility rows and run-level checks", () => {
        const parsed = upstreamReconciliationResult.parse({
            runId: "a2501000-0000-4000-8000-0000000000e1",
            providerTenantId: "a2501000-0000-4000-8000-0000000000a1",
            transformSummary: { durationMs: 12, steps: 13 },
            facilities: [],
            runChecks: [],
        });
        expect(parsed.facilities).toEqual([]);
        expect(parsed.transformSummary).toEqual({ durationMs: 12, steps: 13 });
    });
});
