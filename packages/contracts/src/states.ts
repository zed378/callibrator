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

/**
 * The inspection catalogue (P19-01 spec § 7, ADR-125 Amendment 1; tables of migrations 0111 and
 * 0112). Device types, item definitions and templates share one lifecycle, `active` ⇄ `retired`:
 * nothing in the catalogue is deleted, `retired` is the only removal (G-4).
 */
export const CATALOGUE_LIFECYCLE_STATUSES = Object.freeze(["active", "retired"] as const);
export type CatalogueLifecycleStatus = (typeof CATALOGUE_LIFECYCLE_STATUSES)[number];

/** A device type (`device_types.status`). */
export const DEVICE_TYPE_STATUSES = CATALOGUE_LIFECYCLE_STATUSES;
export type DeviceTypeStatus = CatalogueLifecycleStatus;

/** A library item definition (`inspection_item_definitions.status`). */
export const INSPECTION_ITEM_DEFINITION_STATUSES = CATALOGUE_LIFECYCLE_STATUSES;
export type InspectionItemDefinitionStatus = CatalogueLifecycleStatus;

/** A template (`inspection_templates.status`); a retired template has no published version. */
export const INSPECTION_TEMPLATE_STATUSES = CATALOGUE_LIFECYCLE_STATUSES;
export type InspectionTemplateStatus = CatalogueLifecycleStatus;

/**
 * A template version: draft → published → retired, or draft → discarded (G-6). Exactly one
 * published and at most one draft per template; published content is immutable, and `retired`
 * and `discarded` are final — held by the database (migration 0112's trigger), not only the service.
 */
export const TEMPLATE_VERSION_STATUSES = Object.freeze(["draft", "published", "retired", "discarded"] as const);
export type TemplateVersionStatus = (typeof TEMPLATE_VERSION_STATUSES)[number];

/** A tenant's proposal: submitted → accepted | rejected | withdrawn, each terminal. */
export const TEMPLATE_PROPOSAL_STATUSES = Object.freeze(["submitted", "accepted", "rejected", "withdrawn"] as const);
export type TemplateProposalStatus = (typeof TEMPLATE_PROPOSAL_STATUSES)[number];

/**
 * An upstream image import over rsync (ADR-130): pending → transferring → ingesting → completed; failed or cancelled from any
 * non-terminal state. `completed`, `failed` and `cancelled` are terminal, and every terminal
 * transition erases the stored credential in the same transaction.
 */
export const UPSTREAM_FILE_IMPORT_STATUSES = Object.freeze([
  "pending",
  "transferring",
  "ingesting",
  "completed",
  "failed",
  "cancelled",
] as const);
export type UpstreamFileImportStatus = (typeof UPSTREAM_FILE_IMPORT_STATUSES)[number];

/**
 * The SQL-dump import (ADR-129;
 * P24-06): uploaded → scanning → parsing → loaded; failed or cancelled from any non-terminal
 * state, and a failed run whose file is still kept may be retried (failed → uploaded). `loaded`
 * and `cancelled` are terminal. The uploaded file is never executed — it is parsed.
 */
export const UPSTREAM_SQL_IMPORT_STATUSES = Object.freeze([
  "uploaded",
  "scanning",
  "parsing",
  "loaded",
  "failed",
  "cancelled",
] as const);
export type UpstreamSqlImportStatus = (typeof UPSTREAM_SQL_IMPORT_STATUSES)[number];
