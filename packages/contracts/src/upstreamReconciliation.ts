/**
 * P25-01 — the automated reconciliation of one transformed upstream run
 * (docs/UPSTREAM/05 § 7, R-1 … R-12; threat model § 11, G-30 RC-F1 … RC-F5).
 *
 * Aggregates only. Every number is a count; every reason is a fixed code.
 * No staged value, no legacy id, no name, no serial, no hash ever leaves
 * the database through this contract — the same rule the import's own
 * views live by (ADR-129).
 *
 * R-12 (the app-level smoke) is not a count: it names the suites that must
 * have passed on the dry-run database, and whether each did. The live E2E
 * run itself is P21-10's spec on the dry-run stack, recorded in P25-04.
 */
import { z } from "zod";
import { uuid } from "./fields";

/**
 * The reconciliation checks. R-1 … R-11 compare source aggregates
 * (staging) with target aggregates (the application's tables) per tenant
 * and per facility; RC-F1 … RC-F5 prove every imported row landed in the
 * facility the transform decided (G-30); R-12 names the smoke suites.
 */
export const UPSTREAM_RECONCILIATION_CHECKS = Object.freeze([
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
] as const);
export type UpstreamReconciliationCheck = (typeof UPSTREAM_RECONCILIATION_CHECKS)[number];

/** One check's verdict. Counts only; `delta` is `actual - expected`. */
export const reconciliationCheckResult = z
    .object({
        check: z.enum(UPSTREAM_RECONCILIATION_CHECKS),
        status: z.enum(["pass", "fail", "manual"]),
        expected: z.number().int().min(0),
        actual: z.number().int().min(0),
        delta: z.number().int(),
        quarantined: z.number().int().min(0),
        note: z.string().max(280),
    })
    .strict();
export type ReconciliationCheckResult = z.output<typeof reconciliationCheckResult>;

/** One facility's row: the facility's id and code only — never its name. */
export const reconciliationFacilityRow = z
    .object({
        clientFacilityId: uuid(),
        facilityCode: z.string().min(1).max(16),
        checks: z.array(reconciliationCheckResult).max(50),
    })
    .strict();
export type ReconciliationFacilityRow = z.output<typeof reconciliationFacilityRow>;

/** `GET /admin/upstream-sql-imports/:id/reconciliation` — the run to check. */
export const upstreamReconciliationIdSchema = z.object({ id: uuid() });
export type UpstreamReconciliationIdInput = z.output<typeof upstreamReconciliationIdSchema>;

/** The reconciliation answer: per-facility rows plus the run-level checks. */
export const upstreamReconciliationResult = z
    .object({
        runId: uuid(),
        providerTenantId: uuid(),
        transformSummary: z
            .object({ durationMs: z.number().int().min(0), steps: z.number().int().min(0) })
            .strict()
            .nullable(),
        facilities: z.array(reconciliationFacilityRow).max(1000),
        runChecks: z.array(reconciliationCheckResult).max(50),
    })
    .strict();
export type UpstreamReconciliationResult = z.output<typeof upstreamReconciliationResult>;
