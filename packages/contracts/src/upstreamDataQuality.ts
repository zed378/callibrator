/**
 * P25-02 — the quarantine review and per-tenant data-quality report of one
 * transformed upstream run (docs/UPSTREAM/05 § 7; docs/UPSTREAM/03 § 7, the
 * Q-findings it names; threat model § 11, G-30 RC-F5).
 *
 * Aggregates only. Every number is a count; every reason is a fixed code
 * from `UPSTREAM_IMPORT_QUARANTINE_REASONS`. No staged value, no legacy id,
 * no name, no serial, no room, no hash ever leaves the database through this
 * contract — the same rule the reconciliation (P25-01) and the import's own
 * views live by (ADR-129).
 *
 * UPSTREAM_DATA_QUALITY_SECTIONS is the TARGET of 03 § 7. As built (P25-02 review,
 * 2026-10-24) the report computes the quarantine groups and Q-12, Q-13, Q-18
 * and Q-19 per facility; since 2026-10-27 also Q-4, Q-14 and Q-28's missing
 * files (`manual` when none, the unreferenced half being the manifest's); since
 * 2026-10-28 the duplicates Q-8, Q-9 and the orphans Q-2, Q-3, Q-10; the orphan,
 * file and user sections are not built (services/upstreamDataQuality.service.ts).
 *
 * A section that needs a human (a sampled field-by-field diff is P25-03)
 * answers `manual`, never a guessed pass.
 */
import { z } from "zod";
import { uuid } from "./fields";

/**
 * The report's sections. `quarantine` is the review itself; the rest are the
 * data-quality findings of 03 § 7, grouped by what the operator decides.
 */
export const UPSTREAM_DATA_QUALITY_SECTIONS = Object.freeze([
    "quarantine",
    "duplicates",
    "orphans",
    "dates",
    "files",
    "users",
] as const);
export type UpstreamDataQualitySection = (typeof UPSTREAM_DATA_QUALITY_SECTIONS)[number];

/** One quarantine group: the source table, the reason, and how many rows. Counts only. */
export const dataQualityQuarantineGroup = z
    .object({
        sourceTable: z.string().min(1).max(64),
        reason: z.string().min(1).max(64),
        rows: z.number().int().min(0),
    })
    .strict();
export type DataQualityQuarantineGroup = z.output<typeof dataQualityQuarantineGroup>;

/** One finding: its 03 § 7 number, what it counts, and how many. Counts only. */
export const dataQualityFinding = z
    .object({
        finding: z.string().min(1).max(16),
        status: z.enum(["pass", "flagged", "manual"]),
        count: z.number().int().min(0),
        note: z.string().max(280),
    })
    .strict();
export type DataQualityFinding = z.output<typeof dataQualityFinding>;

/** One facility's row: the facility's id and code only — never its name. */
export const dataQualityFacilityRow = z
    .object({
        clientFacilityId: uuid(),
        facilityCode: z.string().min(1).max(16),
        quarantine: z.array(dataQualityQuarantineGroup).max(200),
        findings: z.array(dataQualityFinding).max(50),
    })
    .strict();
export type DataQualityFacilityRow = z.output<typeof dataQualityFacilityRow>;

/** `GET /admin/upstream-sql-imports/:id/data-quality` — the run to report. */
export const upstreamDataQualityIdSchema = z.object({ id: uuid() });
export type UpstreamDataQualityIdInput = z.output<typeof upstreamDataQualityIdSchema>;

/** The report: per-facility rows plus the run-level quarantine totals. */
export const upstreamDataQualityResult = z
    .object({
        runId: uuid(),
        providerTenantId: uuid(),
        facilities: z.array(dataQualityFacilityRow).max(1000),
        totals: z.array(dataQualityQuarantineGroup).max(200),
    })
    .strict();
export type UpstreamDataQualityResult = z.output<typeof upstreamDataQualityResult>;
