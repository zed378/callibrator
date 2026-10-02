/**
 * P9-05 (MEMORY/specs/P9-05-shared-types.md) — every state machine's statuses, written ONCE.
 *
 * Each machine is a frozen tuple in its database ENUM's order (the order is what `sync` creates
 * the type from, so it is part of the schema) and the union derived from it. The backend models'
 * `DataTypes.ENUM(...)`, the request and response schemas in this package, and the backend
 * constants all import these; `backend/src/tests/guards/stateUnions.p905.guard.test.ts` holds
 * every one of them equal to the tuple here. A `switch` over one of these unions is checked for
 * exhaustiveness (`@typescript-eslint/switch-exhaustiveness-check`, an error in the backend).
 *
 * Changing a tuple changes what `sync` would create: it needs a migration, as before.
 */
import { CAPA_STATUSES, type CapaStatus } from "./qmsValues";

/** A certificate: draft → pending_approval → approved → signed; revoked from approved or signed. */
export const CERTIFICATE_STATE = Object.freeze({
  DRAFT: "draft",
  PENDING_APPROVAL: "pending_approval",
  APPROVED: "approved",
  SIGNED: "signed",
  REVOKED: "revoked",
} as const);
export const CERTIFICATE_STATUSES = Object.freeze([
  CERTIFICATE_STATE.DRAFT,
  CERTIFICATE_STATE.PENDING_APPROVAL,
  CERTIFICATE_STATE.APPROVED,
  CERTIFICATE_STATE.SIGNED,
  CERTIFICATE_STATE.REVOKED,
] as const);
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

/** A stock transfer between warehouses. */
export const STOCK_TRANSFER_STATUSES = Object.freeze(["pending", "in_transit", "completed", "cancelled"] as const);
export type StockTransferStatus = (typeof STOCK_TRANSFER_STATUSES)[number];

/** A stock opname (cycle count). */
export const STOCK_OPNAME_STATUSES = Object.freeze(["draft", "in_progress", "completed"] as const);
export type StockOpnameStatus = (typeof STOCK_OPNAME_STATUSES)[number];

/** A CAPA. Its single source is `qmsValues` (ADR-097); listed here so this module names every machine. */
export { CAPA_STATUSES, type CapaStatus };

/** A maintenance work order. */
export const WORK_ORDER_STATUSES = Object.freeze(["Open", "InProgress", "Completed", "Cancelled"] as const);
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/**
 * `tenants.status` — the tenant's lifecycle (lower case). NOT the tenant request body's `status`
 * field (`tenant.ts`: ACTIVE / INACTIVE / SUSPENDED, case-insensitive), which is a different field.
 */
export const TENANT_LIFECYCLE_STATE = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DELETED: "deleted",
} as const);
export const TENANT_LIFECYCLE_STATUSES = Object.freeze([
  TENANT_LIFECYCLE_STATE.ACTIVE,
  TENANT_LIFECYCLE_STATE.SUSPENDED,
  TENANT_LIFECYCLE_STATE.DELETED,
] as const);
export type TenantLifecycleStatus = (typeof TENANT_LIFECYCLE_STATUSES)[number];

/** One webhook delivery's attempts (ADR-054). */
export const WEBHOOK_DELIVERY_STATUSES = Object.freeze(["pending", "success", "failed", "exhausted"] as const);
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

/** A workflow (approval chain) instance. */
export const WORKFLOW_INSTANCE_STATUSES = Object.freeze(["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const);
export type WorkflowInstanceStatus = (typeof WORKFLOW_INSTANCE_STATUSES)[number];
