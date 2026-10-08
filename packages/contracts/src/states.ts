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

/**
 * A client facility (ADR-124 § 2; P19-04 spec § 4.1): what kind of health facility a calibration
 * company serves. The self facility of every tenant is `other`.
 */
export const CLIENT_FACILITY_KINDS = Object.freeze([
  "hospital",
  "clinic",
  "health_centre",
  "district_office",
  "laboratory",
  "other",
] as const);
export type ClientFacilityKind = (typeof CLIENT_FACILITY_KINDS)[number];

/**
 * A client facility's lifecycle (ADR-124 Am. 2; P19-04 spec § 4.4): `active` ⇄ `inactive`
 * (bound users refused, provider staff work), either → `ended` (the client left: no new rows),
 * `ended` → `active` only by a tenant administrator. A tenant's self facility is always `active`
 * — held by the database (migration 0117's CHECK). Nothing is deleted by ending.
 */
export const CLIENT_FACILITY_STATUSES = Object.freeze(["active", "inactive", "ended"] as const);
export type ClientFacilityStatus = (typeof CLIENT_FACILITY_STATUSES)[number];

/**
 * A device move between facilities (ADR-124 Am. 2 § 2; P19-04 spec § 5.5, § 11): written
 * `in_progress` by the moving transaction and `completed` before it commits — the database
 * refuses a commit that leaves it `in_progress` (migration 0117).
 */
export const CLIENT_FACILITY_MOVE_STATUSES = Object.freeze(["in_progress", "completed"] as const);
export type ClientFacilityMoveStatus = (typeof CLIENT_FACILITY_MOVE_STATUSES)[number];

/**
 * An IPM session (ADR-126 § 3, Am. 1; P19-02 spec § 7): `draft` → `submitted` | `discarded`,
 * `submitted` → `voided`. "Superseded" is `submitted` with `superseded_by_id`. `voided` and
 * `discarded` are final — held by the database (migration 0127's trigger), for every role.
 */
export const INSPECTION_SESSION_STATUSES = Object.freeze(["draft", "submitted", "voided", "discarded"] as const);
export type InspectionSessionStatus = (typeof INSPECTION_SESSION_STATUSES)[number];

/**
 * An idempotency key (ADR-127 § 7, ADR-126 Am. 1 § 8; P19-02 spec § 9.1): written `in_flight`
 * before the route runs, `completed` in the route's own transaction.
 */
export const IDEMPOTENCY_KEY_STATUSES = Object.freeze(["in_flight", "completed"] as const);
export type IdempotencyKeyStatus = (typeof IDEMPOTENCY_KEY_STATUSES)[number];
