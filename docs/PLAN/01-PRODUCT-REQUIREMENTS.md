# 01 — Product Requirements

Requirements are stated as `R<n>` and referenced by that ID from task cards in [`../../TASKS/`](../../TASKS/README.md) and from [`17-ACCEPTANCE-CRITERIA.md`](./17-ACCEPTANCE-CRITERIA.md).

Every requirement below is **implemented**; the "Where" column names the code that implements it. This document maps the built system, not a wish list. Anything not yet built lives in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

---

## Tenancy and Identity

| ID | Requirement | Where |
|---|---|---|
| R1 | A tenant is a first-class record with a plan, status, seat and storage limits, branding, and settings | `backend/src/models/tenant.model.js` |
| R2 | Tenants may nest — a parent tenant such as a hospital group can contain child tenants, with a materialised `path` and `depth` | `tenant_hierarchies`, `routes/api/tenantHierarchy.route.js` |
| R3 | Every tenant-scoped query is filtered by the active tenant **without the caller opting in**; a request with no resolvable tenant sees nothing | `backend/src/utils/tenantScope.util.js` |
| R4 | A user belongs to exactly one tenant and holds exactly one role | `users.tenantId`, `users.roleId` |
| R5 | `SUPERADMIN` operates across tenants and may target one explicitly via `x-tenant-id` or `x-tenant-code` | `middlewares/auth.middleware.js` |
| R6 | A tenant has a lifecycle — active, suspended, deleted — and suspension blocks every request from its users | `routes/api/tenantLifecycle.route.js` |

## Authentication and Session

| ID | Requirement | Where |
|---|---|---|
| R7 | Password login issues a JWT access token plus a persisted, revocable session row | `routes/api/auth.route.js`, `sessions` |
| R8 | Sessions are bound to IP and user agent, carry a hashed token, and can be revoked individually or in bulk | `models/session.model.js`, `session.route.js` |
| R9 | Failed logins are counted and lock the account; OTP requests are separately throttled | `users.failedLoginAttempts`, `users.lockedUntil`, `constants/rateLimitConstants.js` |
| R10 | TOTP MFA and WebAuthn passkeys are both supported as second factors | `users.mfaSecret`, `users.webauthnCredentialId`, `webauthn.route.js` |
| R11 | The platform is both an OIDC **relying party** and an OIDC **provider**, publishing discovery and JWKS at the issuer root | `routes/api/oidc.route.js`, mounted at `/oidc` **and** `/api/v1/oidc` |
| R12 | SCIM 2.0 provisioning is exposed for enterprise directory sync | `routes/api/scim.route.js` at `/api/v1/scim/v2` |

## Authorization

| ID | Requirement | Where |
|---|---|---|
| R13 | Access is resolved at runtime from menu-group permissions (`read` / `write`) mapped per role | `role_menu_permissions`, `dynamicAccess.middleware.js` |
| R14 | A single user may be granted per-user overrides that widen or narrow the role menu access | `user_menu_permissions` |
| R15 | Roles carry a numeric `roleLevel`; role-level gates compare against it rather than matching names | `constants/roleConstants.js` ROLE_LEVELS |
| R16 | `SUPERADMIN` short-circuits every permission check | `dynamicAccess.middleware.js`, `rbac.middleware.js` |

## Device and Calibration

| ID | Requirement | Where |
|---|---|---|
| R17 | Devices carry serial number, manufacturer, model, category, status, location, install date, interval, and an uncertainty budget | `calibration_devices` |
| R18 | `nextCalibrationDate` is maintained from the interval and the last calibration | `services/calibrationScheduler.service.js` |
| R19 | A calibration record stores results as JSONB, measurement uncertainty, the standard applied, a compliance verdict, and the performer | `calibration_records` |
| R20 | Calibration records are append-only for compliance purposes — correction is a new record, never an edit | [`02-BUSINESS-RULES.md`](./02-BUSINESS-RULES.md) BR-7 |
| R21 | The scheduler surfaces due, overdue, and upcoming calibrations | `calibrationScheduler.route.js` |
| R22 | A recommended interval may be derived from history and stored with a human-readable reason | `calibration_devices.recommendedCalibrationInterval`, `.recommendationReason` |

## Certificates and Signatures

| ID | Requirement | Where |
|---|---|---|
| R23 | A certificate moves draft → pending_approval → approved → signed, and may be revoked | `certificates.status` |
| R24 | A certificate cannot be approved from draft; it must be submitted first, and an invalid transition returns **409**, not 500 | `certificates.route.js` POST `/:id/submit` (ADR-035) |
| R25 | Signing produces a detached digital signature bound to a tenant key | `certificates.digitalSignature`, `tenant_keys` |
| R26 | A certificate renders to PDF with a QR code resolving to a public verification page that requires no login | `CERT_VERIFY_BASE_URL`, `CERT_SIGNING_SECRET` |
| R27 | Multi-party signing workflows exist independently of certificates, with ordered steps and per-step signer state | `signature_workflows`, `signature_workflow_steps`, `signature_records` |
| R28 | Every signature event records meaning, authentication method, document hash, IP and user agent — the 21 CFR Part 11 quartet | `e_signature_records` |

## Warehouse and Stock

| ID | Requirement | Where |
|---|---|---|
| R29 | Warehouses contain storage locations; stock rows reference both | `warehouses`, `storage_locations`, `stocks` |
| R30 | Stock supports adjustment (addition, subtraction, write_off) with a reason and an actor | `stock_adjustments` |
| R31 | Stock transfers between warehouses are a state machine: pending, in_transit, completed, or cancelled | `stock_transfers` |
| R32 | Stock opname (physical count) is a scheduled, completable process | `stock_opnames` |
| R33 | Stock rows carry `minQuantity` so low stock can be surfaced | `stocks.minQuantity` |

## Maintenance and Quality

| ID | Requirement | Where |
|---|---|---|
| R34 | Maintenance work orders are typed (Preventative, Breakdown, Repair), prioritised, assignable, and vendor-linkable | `maintenance_work_orders` |
| R35 | Predictive maintenance derives risk signals from IoT readings and maintenance history | `predictiveMaintenance.route.js`, `iot_readings` |
| R36 | Non-conformances are raised, investigated, and either closed or escalated to a CAPA | `non_conformances`, `capas` |
| R37 | SOPs are versioned documents with a publication state and an optional training-acknowledgement requirement | `sop_documents`, `sop_training_acknowledgments` |
| R38 | Risks carry severity and likelihood, with RPN computed rather than stored | `risks.rpn` is a VIRTUAL column |
| R39 | Vendors are qualified, rated, audited on a schedule, and scored periodically | `vendors`, `supplier_scorecards` |

## Platform Services

| ID | Requirement | Where |
|---|---|---|
| R40 | Every mutation writes an audit row with action, resource, before and after changes, actor, IP and user agent | `audit_logs`, `auditLog.middleware.js` |
| R41 | Approval workflows can gate Certificate, StockTransfer and MaintenanceWorkOrder with ordered, role-gated steps | `workflows`, `workflow_steps`, `workflow_instances` |
| R42 | Notifications are typed, per-user, and delivered in-app in realtime plus by email | `notifications`, `notification_states`, Socket.IO |
| R43 | Attachments are tenant-scoped, checksummed, virus-scannable, and served through signed URLs | `attachments`, `ATTACHMENT_URL_SECRET` |
| R44 | Object storage is pluggable — local, s3, or nfs — globally and per tenant, with tenant credentials encrypted at rest | `services/storage/`, `STORAGE_DRIVER` |
| R45 | Long-running work runs as tracked batch jobs with progress, either inline or over RabbitMQ | `batch_jobs`, `BATCH_JOBS_INLINE` |
| R46 | Usage is metered per tenant per period and can raise threshold alerts | `UsageMetrics`, `usage_alerts`, `plan_quotas` |
| R47 | Tenants can be backed up and restored, on demand or on a cron schedule, with retention | `tenant_backups` |
| R48 | Data-retention policies purge per entity type on a schedule, with legal hold, PII masking and anonymisation | `data_retention_policies`, `RETENTION_SCHEDULER` |
| R49 | GDPR DSARs (export, erasure, rectification, restriction) are tracked to completion, and consent is versioned | `dsar_requests`, `consent_records` |
| R50 | Third parties integrate via scoped API keys and signed webhooks with delivery retry and exhaustion | `api_keys`, `webhooks`, `webhook_deliveries` |
| R51 | Custom domains can be registered, DNS-verified, and TLS-provisioned over ACME | `custom_domains`, `ACME_DIRECTORY_URL` |
| R52 | Full-text search spans the major domain entities | `search.route.js`, migration `0003-add-search-vectors` |
| R53 | An AI assistant answers over tenant documents using pgvector-backed retrieval | `document_chunks` with `vector(1536)`, migration `0018` |
| R54 | A Kanban project tracker with sprints, labels, card relations and stable card keys is available per tenant | nine `kanban_*` tables |
| R55 | A support desk lets tenants raise tickets and platform responders answer them cross-tenant | `tickets`, `ticket_comments`, `ticket_counters` |

## Cross-Cutting Non-Functional Requirements

| ID | Requirement | Where |
|---|---|---|
| N1 | One response envelope for every endpoint: `success`, `status`, `message`, `data`, and optional `meta` | `backend/src/utils/response.util.js` |
| N2 | Every request carries a correlation id, returned as `X-Request-Id` and exposed through CORS | `backend/index.js` |
| N3 | Requests time out at 30s and return **408** rather than hanging | `express-timeout-handler` |
| N4 | Bodies are capped at 10 MB; the Stripe webhook path preserves the raw body for signature verification | `backend/index.js` |
| N5 | Input is globally sanitised before any handler sees it | `globalSanitizer.middleware.js` |
| N6 | The system runs on PostgreSQL **or** MySQL with no engine-specific isolation mechanism | ADR-029 |
| N7 | Both backend and frontend compile to standalone binaries for distribution | pkg and `bun build --compile` |
