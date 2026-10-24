/**
 * P25-02 — the data-quality contract (@callibrator/contracts/upstreamDataQuality):
 * the sections, the quarantine groups and findings, written from the rules
 * (docs/UPSTREAM/05 § 7; docs/UPSTREAM/03 § 7), not read back from the
 * module: a section deleted from the list fails here.
 */
import {
    UPSTREAM_DATA_QUALITY_SECTIONS,
    dataQualityFacilityRow,
    dataQualityFinding,
    dataQualityQuarantineGroup,
    upstreamDataQualityResult,
} from "@callibrator/contracts/upstreamDataQuality";

describe("P25-02 @callibrator/contracts/upstreamDataQuality — the report", () => {
    it("the sections: quarantine, duplicates, orphans, dates, files, users", () => {
        expect([...UPSTREAM_DATA_QUALITY_SECTIONS]).toEqual([
            "quarantine",
            "duplicates",
            "orphans",
            "dates",
            "files",
            "users",
        ]);
        expect(new Set(UPSTREAM_DATA_QUALITY_SECTIONS).size).toBe(UPSTREAM_DATA_QUALITY_SECTIONS.length);
        expect(Object.isFrozen(UPSTREAM_DATA_QUALITY_SECTIONS)).toBe(true);
    });

    it("a quarantine group: the source table, the reason, and how many rows", () => {
        const parsed = dataQualityQuarantineGroup.parse({
            sourceTable: "trx_inventory",
            reason: "facility_not_imported",
            rows: 2,
        });
        expect(parsed.rows).toBe(2);
    });

    it("a finding: its 03 § 7 number, pass / flagged / manual, and a short note", () => {
        const parsed = dataQualityFinding.parse({
            finding: "Q-18",
            status: "flagged",
            count: 3,
            note: "duplicate serial groups inside the facility",
        });
        expect(parsed.status).toBe("flagged");
        expect(() => dataQualityFinding.parse({ ...parsed, note: "x".repeat(281) })).toThrow();
    });

    it("a facility row names the facility by id and code only — never its name", () => {
        const parsed = dataQualityFacilityRow.parse({
            clientFacilityId: "a2502000-0000-4000-8000-0000000000f1",
            facilityCode: "F-0001",
            quarantine: [],
            findings: [],
        });
        expect(parsed).not.toHaveProperty("name");
        expect(parsed).not.toHaveProperty("facilityName");
    });

    it("the answer: the run, its provider tenant, per-facility rows and run-level totals", () => {
        const parsed = upstreamDataQualityResult.parse({
            runId: "a2502000-0000-4000-8000-0000000000e1",
            providerTenantId: "a2502000-0000-4000-8000-0000000000a1",
            facilities: [],
            totals: [],
        });
        expect(parsed.facilities).toEqual([]);
        expect(parsed.totals).toEqual([]);
    });
});
