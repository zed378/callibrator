/**
 * P25-03 — the sampled report diff of one transformed upstream run: the IPM
 * report upstream prints (`ipm/pdf_ipm.php`, docs/UPSTREAM/09 § 2.1–2.3) set
 * beside the fields our report document is built from (the imported session,
 * its snapshots and its results), field by field, over a deterministic sample
 * of the run's imported sessions (ADR-129 Am. 13).
 *
 * Aggregates only. Every number is a count; every field is a fixed code. No
 * staged value, no legacy id, no QR, no name, no serial, no note ever leaves
 * the database through this contract — the same rule the reconciliation
 * (P25-01) and the data-quality report (P25-02) live by (ADR-129).
 *
 * Each compared field lands in one of three classes:
 *  - `equal`     — the value upstream prints is the value we hold;
 *  - `explained` — it differs only by a documented transform rule (whitespace
 *                  cleaned, a serial placeholder or a duplicate set to NULL, an
 *                  unknown code left NULL, a departed performer's snapshot, a
 *                  quarantined row) — 04 § 5, 07 § 3, 03 Q-17/Q-18;
 *  - `differs`   — anything else. A field passes when nothing differs.
 */
import { z } from "zod";
import { uuid } from "./fields";

/** The compared fields, in the upstream report's print order (09 § 2.1, § 2.2). */
export const UPSTREAM_REPORT_DIFF_FIELDS = Object.freeze([
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
] as const);
export type UpstreamReportDiffField = (typeof UPSTREAM_REPORT_DIFF_FIELDS)[number];

/** Largest sample one request may ask for. */
export const REPORT_DIFF_SAMPLE_MAX = 2000;
/** The sample when the request names none. */
export const REPORT_DIFF_SAMPLE_DEFAULT = 200;

/** One field's verdict over the sample. Counts only; `compared = equal + explained + differs`. */
export const reportDiffFieldResult = z
    .object({
        field: z.enum(UPSTREAM_REPORT_DIFF_FIELDS),
        status: z.enum(["pass", "fail"]),
        compared: z.number().int().min(0),
        equal: z.number().int().min(0),
        explained: z.number().int().min(0),
        differs: z.number().int().min(0),
        note: z.string().max(280),
    })
    .strict();
export type ReportDiffFieldResult = z.output<typeof reportDiffFieldResult>;

/** `GET /admin/upstream-sql-imports/:id/report-diff?sample=` — the run, and how many sessions to sample. */
export const upstreamReportDiffSchema = z.object({
    id: uuid(),
    sample: z.coerce.number().int().min(1).max(REPORT_DIFF_SAMPLE_MAX).default(REPORT_DIFF_SAMPLE_DEFAULT),
});
export type UpstreamReportDiffInput = z.output<typeof upstreamReportDiffSchema>;

/** The diff: what was sampled, and one verdict per field. */
export const upstreamReportDiffResult = z
    .object({
        runId: uuid(),
        providerTenantId: uuid(),
        sample: z
            .object({
                requested: z.number().int().min(1).max(REPORT_DIFF_SAMPLE_MAX),
                sessions: z.number().int().min(0),
                facilities: z.number().int().min(0),
            })
            .strict(),
        fields: z.array(reportDiffFieldResult).max(50),
    })
    .strict();
export type UpstreamReportDiffResult = z.output<typeof upstreamReportDiffResult>;
