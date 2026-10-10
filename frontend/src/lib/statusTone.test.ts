/**
 * P11-05 (ADR-122 §6): the status-tone registry, checked against a table
 * written BY HAND from doc 08 "Status Semantics" (and doc 06's domain list) —
 * not generated from the registry (CLAUDE.md "Evidence": a test generated
 * from the code it tests proves consistency, never correctness).
 *
 * doc 08: current = compliant / active / completed; attention = due soon /
 * in progress / pending approval / maintenance; ALARM = overdue,
 * non-conformant, failed, revoked ONLY ("Red is reserved"); draft = draft /
 * inactive / pending / unfinished; info = informational.
 */
import { STATUS_REGISTRY, TONE_CLASSES, statusOf, toneOf, type StatusDomain, type StatusTone } from "./statusTone";

const EXPECTED: [StatusDomain, string, StatusTone][] = [
  ["upstreamImport", "failed", "alarm"],
  ["upstreamImport", "cancelled", "draft"],
  ["upstreamImport", "transferring", "attention"],
  ["upstreamImport", "completed", "current"],
  // P24-06 — the SQL-dump import: in flight is attention, loaded current, failed the alarm, cancelled a decision
  ["upstreamSqlImport", "uploaded", "draft"],
  ["upstreamSqlImport", "scanning", "attention"],
  ["upstreamSqlImport", "parsing", "attention"],
  ["upstreamSqlImport", "loaded", "current"],
  ["upstreamSqlImport", "failed", "alarm"],
  ["upstreamSqlImport", "cancelled", "draft"],
  // P22-01 — the catalogue: retired and rejected are decisions, never alarms; a waiting proposal needs attention
  ["catalogueLifecycle", "active", "current"],
  ["catalogueLifecycle", "retired", "draft"],
  ["templateVersion", "published", "current"],
  ["templateVersion", "draft", "draft"],
  ["templateVersion", "retired", "info"],
  ["templateVersion", "discarded", "draft"],
  ["templateProposal", "submitted", "attention"],
  ["templateProposal", "accepted", "current"],
  ["templateProposal", "rejected", "draft"],
  ["templateProposal", "withdrawn", "draft"],
  // device — maintenance is attention, never alarm (doc 08); retired is not an alarm
  ["device", "active", "current"],
  ["device", "inactive", "draft"],
  ["device", "maintenance", "attention"],
  ["device", "retired", "draft"],
  // certificate
  ["certificate", "draft", "draft"],
  ["certificate", "pending_approval", "attention"],
  ["certificate", "signed", "current"],
  ["certificate", "revoked", "alarm"],
  // calibration due — overdue is the alarm the product exists for
  ["calibrationDue", "overdue", "alarm"],
  ["calibrationDue", "due_soon", "attention"],
  ["calibrationDue", "current", "current"],
  // P22-05: P19-05 § 6's states — requested needs action, ok is current, nothing scheduled is a draft
  ["calibrationDue", "requested", "attention"],
  ["calibrationDue", "ok", "current"],
  ["calibrationDue", "not_scheduled", "draft"],
  // P22-02: a device's condition — not good and broken need attention (alarm is reserved)
  ["deviceCondition", "good", "current"],
  ["deviceCondition", "not_good", "attention"],
  ["deviceCondition", "broken", "attention"],
  // work order
  ["workOrder", "InProgress", "attention"],
  ["workOrder", "Completed", "current"],
  ["workOrder", "Cancelled", "draft"],
  // transfer
  ["transfer", "pending", "draft"],
  ["transfer", "in_transit", "attention"],
  ["transfer", "completed", "current"],
  // opname
  ["opname", "draft", "draft"],
  ["opname", "in_progress", "attention"],
  ["opname", "completed", "current"],
  // non-conformance / CAPA
  ["quality", "CAPA_REQUIRED", "alarm"],
  ["quality", "UNDER_INVESTIGATION", "attention"],
  ["quality", "CLOSED", "current"],
  ["quality", "DRAFT", "draft"],
  // batch job
  ["job", "PENDING", "draft"],
  ["job", "PROCESSING", "attention"],
  ["job", "COMPLETED", "current"],
  ["job", "FAILED", "alarm"],
  // tickets
  ["ticket", "in_progress", "attention"],
  ["ticket", "resolved", "current"],
  ["ticket", "closed", "draft"],
  // billing
  ["invoice", "Paid", "current"],
  ["invoice", "Uncollectible", "alarm"],
  ["subscription", "PastDue", "attention"],
  ["subscription", "Unpaid", "alarm"],
  // tenant, user — suspension is attention, not alarm
  ["tenant", "active", "current"],
  ["tenant", "suspended", "attention"],
  ["user", "ACTIVE", "current"],
  ["user", "INACTIVE", "draft"],
  ["user", "SUSPENDED", "attention"],
  ["user", "PENDING", "draft"],
  // API key — revoked is alarm, expired is merely inactive
  ["apiKey", "active", "current"],
  ["apiKey", "expired", "draft"],
  ["apiKey", "revoked", "alarm"],
  // webhook delivery
  ["webhookDelivery", "success", "current"],
  ["webhookDelivery", "failed", "alarm"],
  ["webhookDelivery", "exhausted", "alarm"],
  // backups
  ["backup", "completed", "current"],
  ["backup", "failed", "alarm"],
  ["backup", "in_progress", "attention"],
  ["backup", "pending", "draft"],
  // ADR-122 Amendment 1 (2026-10-07) — the inline chips and status tiles.
  // A calibration out of tolerance is non-conformant: the alarm.
  ["calibrationResult", "compliant", "current"],
  ["calibrationResult", "non_compliant", "alarm"],
  // on/off states are current/draft, never alarm (doc 08: inactive is draft)
  ["active", "active", "current"],
  ["active", "inactive", "draft"],
  ["enabled", "disabled", "draft"],
  ["webhook", "disabled", "draft"],
  ["iotIngest", "disabled", "draft"],
  ["consent", "withdrawn", "draft"],
  ["restriction", "unrestricted", "draft"],
  ["setting", "not_set", "draft"],
  ["passkey", "none", "draft"],
  // something in force that changes what may happen: attention
  ["legalHold", "active", "attention"],
  ["recoveryCodes", "low", "attention"],
  ["accessDecision", "blocked", "attention"],
  ["accessDecision", "step_up", "attention"],
  ["stockLevel", "low", "attention"],
  ["stockLevel", "ok", "current"],
  ["wip", "over", "attention"],
  ["duplicate", "suspected", "attention"],
  // documents and approvals: pending approval is attention (doc 08)
  ["sop", "UNDER_REVIEW", "attention"],
  ["sop", "PUBLISHED", "current"],
  ["sop", "DRAFT", "draft"],
  ["approval", "PENDING", "attention"],
  ["vendorApproval", "pending", "attention"],
  ["vendorApproval", "rejected", "alarm"],
  ["menuAssignment", "partial", "attention"],
  ["menuAssignment", "unassigned", "draft"],
  ["restoreGap", "absent", "attention"],
  ["restoreGap", "erased", "info"],
  // system health (F-02): down is failed; not configured / unknown is never green
  ["health", "healthy", "current"],
  ["health", "error", "alarm"],
  ["health", "neutral", "draft"],
  ["healthVerdict", "unhealthy", "alarm"],
  ["healthVerdict", "unknown", "draft"],
  ["intervalAdvice", "shorten", "attention"],
  // audit: a failed signature authentication is failed; a lockout is like a suspension
  ["auditEvent", "SIGNATURE_AUTH_FAILED", "alarm"],
  ["auditEvent", "ACCOUNT_LOCKED", "attention"],
];

/** Every state that may be an alarm: overdue, non-conformant (CAPA required, disqualified), failed (incl. uncollectible/unpaid/exhausted), revoked. */
const ALARM_ALLOWED = new Set([
  "calibrationDue.overdue",
  "certificate.revoked",
  "apiKey.revoked",
  "quality.CAPA_REQUIRED",
  "supplier.DISQUALIFIED",
  "job.FAILED",
  "backup.failed",
  "webhookDelivery.failed",
  "webhookDelivery.exhausted",
  "customDomain.failed",
  "invoice.Uncollectible",
  "subscription.Unpaid",
  // Amendment 1: non-conformant (a calibration out of tolerance, a vendor that failed qualification) and failed (a dependency down, a signature authentication)
  "calibrationResult.non_compliant",
  "vendorApproval.rejected",
  "health.error",
  "healthVerdict.unhealthy",
  "auditEvent.SIGNATURE_AUTH_FAILED",
  // The rsync image import: a failed import is a failure.
  "upstreamImport.failed",
  // P24-06: a failed SQL-dump import is a failure.
  "upstreamSqlImport.failed",
]);

describe("statusTone registry (P11-05)", () => {
  it.each(EXPECTED)("%s %s is %s", (domain, state, tone) => {
    expect(toneOf(domain, state)).toBe(tone);
  });

  it("only overdue / non-conformant / failed / revoked states are alarm", () => {
    const alarms = Object.entries(STATUS_REGISTRY).flatMap(([d, states]) =>
      Object.entries(states as Record<string, { tone: StatusTone }>)
        .filter(([, v]) => v.tone === "alarm")
        .map(([s]) => `${d}.${s}`),
    );
    for (const a of alarms) expect(ALARM_ALLOWED).toContain(a);
    expect(alarms.length).toBeGreaterThan(0);
  });

  it("there are exactly five tones, each with a shape, and none uses the brand (primary) or a raw colour", () => {
    expect(Object.keys(TONE_CLASSES).sort()).toEqual(["alarm", "attention", "current", "draft", "info"]);
    for (const c of Object.values(TONE_CLASSES)) {
      expect(c).not.toMatch(/primary|accent|brand|#|white|black/);
      expect(c).toMatch(/text-status-/);
    }
    expect(TONE_CLASSES.alarm).toMatch(/bg-status-alarm\b(?!\/)/); // solid fill
    expect(TONE_CLASSES.draft).toMatch(/border-dashed/); // dashed outline
    expect(TONE_CLASSES.attention).toMatch(/border-status-attention\/40/);
  });

  it("an unknown state is a draft badge that shows the state itself", () => {
    expect(statusOf("device", "decommissioned")).toEqual({ tone: "draft", label: "decommissioned" });
    expect(statusOf("device", null)).toEqual({ tone: "draft", label: "" });
  });

  it("labels are the words the pages showed before the registry (copy unchanged)", () => {
    expect(statusOf("certificate", "signed").label).toBe("Signed & Locked");
    expect(statusOf("transfer", "in_transit").label).toBe("IN TRANSIT");
    expect(statusOf("subscription", "PastDue").label).toBe("Past Due");
    expect(statusOf("ticket", "in_progress").label).toBe("In progress");
  });
});
