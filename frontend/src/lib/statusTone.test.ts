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
