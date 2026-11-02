/**
 * P25-03 — the report-diff contract (@callibrator/contracts/upstreamReportDiff):
 * the fields in the upstream report's print order (docs/UPSTREAM/09 § 2.1, § 2.2)
 * and the aggregate-only rule (ADR-129), written from the rules, not read back
 * from the module: a field deleted from the list fails here.
 */
import {
    REPORT_DIFF_SAMPLE_DEFAULT,
    REPORT_DIFF_SAMPLE_MAX,
    UPSTREAM_REPORT_DIFF_FIELDS,
    reportDiffFieldResult,
    upstreamReportDiffResult,
    upstreamReportDiffSchema,
} from "@callibrator/contracts/upstreamReportDiff";

const RUN = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const field = { field: "device.name", status: "pass", compared: 3, equal: 2, explained: 1, differs: 0, note: "" };

describe("P25-03 @callibrator/contracts/upstreamReportDiff", () => {
    it("the fields, in the upstream report's print order", () => {
        expect([...UPSTREAM_REPORT_DIFF_FIELDS]).toEqual([
            "device.name",
            "facility",
            "ipm.date",
            "room",
            "device.qr",
            "device.brand",
            "device.serial",
            "device.model",
            "visit",
            "results.rows",
            "results.values",
            "inspection.result",
            "maintenance.result",
            "recommendation",
            "notes",
            "technician",
        ]);
    });

    it("the request: the sample defaults to 200, coerces from a query string, and is capped at 2000", () => {
        expect(REPORT_DIFF_SAMPLE_DEFAULT).toBe(200);
        expect(REPORT_DIFF_SAMPLE_MAX).toBe(2000);
        expect(upstreamReportDiffSchema.parse({ id: RUN }).sample).toBe(200);
        expect(upstreamReportDiffSchema.parse({ id: RUN, sample: "50" }).sample).toBe(50);
        expect(upstreamReportDiffSchema.safeParse({ id: RUN, sample: 2001 }).success).toBe(false);
        expect(upstreamReportDiffSchema.safeParse({ id: RUN, sample: 0 }).success).toBe(false);
        expect(upstreamReportDiffSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    });

    it("a field verdict is counts and a fixed code: an unknown field or an extra key is refused", () => {
        expect(reportDiffFieldResult.parse(field)).toEqual(field);
        expect(reportDiffFieldResult.safeParse({ ...field, field: "device.owner" }).success).toBe(false);
        expect(reportDiffFieldResult.safeParse({ ...field, value: "a staged value" }).success).toBe(false);
        expect(reportDiffFieldResult.safeParse({ ...field, differs: -1 }).success).toBe(false);
    });

    it("the result carries no key beyond the counts: staged values cannot leave through it", () => {
        const result = {
            runId: RUN,
            providerTenantId: TENANT,
            sample: { requested: 200, population: 8153, sessions: 200, facilities: 4 },
            fields: [field],
        };
        expect(upstreamReportDiffResult.parse(result)).toEqual(result);
        expect(upstreamReportDiffResult.safeParse({ ...result, rows: [] }).success).toBe(false);
        expect(upstreamReportDiffResult.safeParse({ ...result, sample: { ...result.sample, legacyIds: [] } }).success).toBe(false);
    });
});
