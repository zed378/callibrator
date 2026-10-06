/**
 * P11-05 (ADR-122 §6, spec P11-00 §5): ONE registry of what every domain
 * state means, replacing the local status→colour maps that each page kept
 * (research 01 §5.3: `warning` meant six things, `danger` three).
 *
 * Each state maps to one of FIVE tones — doc 08 "Status Semantics"; a sixth
 * needs a design decision, not an entry here. Each tone has a fixed SHAPE and
 * ICON (rendered by `Badge tone`), so status survives colour blindness and
 * greyscale print; colour is the third channel, not the first:
 *
 *   alarm      solid fill            octagon-alert   overdue, non-conformant, failed, revoked — and nothing else
 *   attention  /10 tint + /40 border triangle-alert  due soon, in progress, pending approval, maintenance
 *   current    /10 tint              circle-check    current, active, completed, valid
 *   draft      dashed outline        circle-dashed   draft, inactive, pending, cancelled
 *   info       /10 tint              info            informational
 *
 * Copper (the primary) and the tenant brand never appear here.
 * The labels are the words each page already showed (copy unchanged).
 */

export type StatusTone = "alarm" | "attention" | "current" | "draft" | "info";

export interface StatusEntry {
  tone: StatusTone;
  label: string;
}

type Domain = Record<string, StatusEntry>;

const e = (tone: StatusTone, label: string): StatusEntry => ({ tone, label });

export const STATUS_REGISTRY = {
  device: {
    active: e("current", "Active"),
    inactive: e("draft", "Inactive"),
    maintenance: e("attention", "Maintenance"),
    retired: e("draft", "Retired"),
  },
  certificate: {
    draft: e("draft", "Draft"),
    pending_approval: e("attention", "Pending Approval"),
    approved: e("info", "Approved"),
    signed: e("current", "Signed & Locked"),
    revoked: e("alarm", "Revoked"),
  },
  calibrationDue: {
    overdue: e("alarm", "Overdue"),
    due_soon: e("attention", "Due soon"),
    current: e("current", "Current"),
  },
  workOrder: {
    Open: e("info", "Open"),
    InProgress: e("attention", "In Progress"),
    Completed: e("current", "Completed"),
    Cancelled: e("draft", "Cancelled"),
  },
  transfer: {
    pending: e("draft", "PENDING"),
    in_transit: e("attention", "IN TRANSIT"),
    completed: e("current", "COMPLETED"),
    cancelled: e("draft", "CANCELLED"),
  },
  opname: {
    draft: e("draft", "DRAFT"),
    in_progress: e("attention", "IN_PROGRESS"),
    completed: e("current", "COMPLETED"),
  },
  ticket: {
    open: e("info", "Open"),
    in_progress: e("attention", "In progress"),
    resolved: e("current", "Resolved"),
    closed: e("draft", "Closed"),
  },
  /** QMS records: non-conformances, CAPAs and controlled documents share these. */
  quality: {
    DRAFT: e("draft", "DRAFT"),
    OPEN: e("attention", "OPEN"),
    UNDER_INVESTIGATION: e("attention", "UNDER_INVESTIGATION"),
    IN_PROGRESS: e("attention", "IN_PROGRESS"),
    VERIFICATION: e("attention", "VERIFICATION"),
    CAPA_REQUIRED: e("alarm", "CAPA_REQUIRED"),
    CLOSED: e("current", "CLOSED"),
  },
  risk: {
    OPEN: e("attention", "OPEN"),
    MITIGATED: e("info", "MITIGATED"),
    CLOSED: e("current", "CLOSED"),
  },
  job: {
    PENDING: e("draft", "PENDING"),
    PROCESSING: e("attention", "PROCESSING"),
    COMPLETED: e("current", "COMPLETED"),
    FAILED: e("alarm", "FAILED"),
  },
  invoice: {
    Paid: e("current", "Paid"),
    Open: e("info", "Open"),
    Draft: e("draft", "Draft"),
    Uncollectible: e("alarm", "Uncollectible"),
    Void: e("draft", "Void"),
  },
  subscription: {
    Active: e("current", "Active"),
    PastDue: e("attention", "Past Due"),
    Canceled: e("draft", "Canceled"),
    Unpaid: e("alarm", "Unpaid"),
  },
  tenant: {
    active: e("current", "active"),
    suspended: e("attention", "suspended"),
  },
  tenantLifecycle: {
    ACTIVE: e("current", "ACTIVE"),
    SUSPENDED: e("attention", "SUSPENDED"),
    OFFBOARDED: e("draft", "OFFBOARDED"),
  },
  user: {
    ACTIVE: e("current", "ACTIVE"),
    INACTIVE: e("draft", "INACTIVE"),
    SUSPENDED: e("attention", "SUSPENDED"),
    PENDING: e("draft", "PENDING"),
  },
  apiKey: {
    active: e("current", "Active"),
    expired: e("draft", "Expired"),
    revoked: e("alarm", "Revoked"),
  },
  webhookDelivery: {
    success: e("current", "success"),
    pending: e("attention", "pending"),
    failed: e("alarm", "failed"),
    exhausted: e("alarm", "exhausted"),
  },
  warehouse: {
    active: e("current", "ACTIVE"),
    inactive: e("draft", "INACTIVE"),
  },
  vendor: {
    Active: e("current", "Active"),
    Inactive: e("draft", "Inactive"),
  },
  supplier: {
    APPROVED: e("current", "APPROVED"),
    PROBATION: e("attention", "PROBATION"),
    DISQUALIFIED: e("alarm", "DISQUALIFIED"),
  },
  accessRequest: {
    pending: e("attention", "pending"),
    approved: e("current", "approved"),
    rejected: e("draft", "rejected"),
    spam: e("draft", "spam"),
  },
  esignature: {
    pending: e("attention", "pending"),
    in_progress: e("attention", "in_progress"),
    completed: e("current", "completed"),
    cancelled: e("draft", "cancelled"),
    expired: e("draft", "expired"),
  },
  customDomain: {
    active: e("current", "active"),
    pending: e("attention", "pending"),
    failed: e("alarm", "failed"),
  },
  post: {
    PUBLISHED: e("current", "PUBLISHED"),
    DRAFT: e("draft", "DRAFT"),
  },
  sprint: {
    active: e("current", "active"),
    planned: e("info", "planned"),
    completed: e("draft", "completed"),
  },
  /** A sign-in session: "this is you" is information; ended sessions are inactive, not alarms. */
  session: {
    current: e("info", "CURRENT"),
    revoked: e("draft", "REVOKED"),
    expired: e("draft", "EXPIRED"),
  },
  backup: {
    completed: e("current", "completed"),
    failed: e("alarm", "failed"),
    in_progress: e("attention", "in_progress"),
    pending: e("draft", "pending"),
    deleted: e("draft", "deleted"),
  },
} satisfies Record<string, Domain>;

export type StatusDomain = keyof typeof STATUS_REGISTRY;

/** The tone and label of a state; an unknown state is a draft-toned badge showing the state itself. */
export const statusOf = (domain: StatusDomain, state: string | null | undefined): StatusEntry => {
  const entries: Domain = STATUS_REGISTRY[domain];
  const key = state ?? "";
  return entries[key] ?? e("draft", key);
};

/** Just the tone. */
export const toneOf = (domain: StatusDomain, state: string | null | undefined): StatusTone => statusOf(domain, state).tone;

/** The shape of each tone (Badge `tone`): fill, tint, border style. Semantic tokens only. */
export const TONE_CLASSES: Record<StatusTone, string> = {
  alarm: "bg-status-alarm text-status-alarm-foreground border border-transparent",
  attention: "bg-status-attention/10 text-status-attention border border-status-attention/40",
  current: "bg-status-current/10 text-status-current border border-transparent",
  draft: "bg-transparent text-status-draft border border-dashed border-status-draft",
  info: "bg-status-info/10 text-status-info border border-transparent",
};
