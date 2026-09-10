# 04 — Feature Specification

The catalogue of shipped functionality, organised by the 33 backend modules. Each entry names its module code, its route base, the frontend surface that consumes it, and the deep reference.

For the 24-point per-module breakdown — endpoints, models, validators, business rules, config keys — see [`../BACKEND/10-MODULE-REFERENCE.md`](../BACKEND/10-MODULE-REFERENCE.md). This document is the index and the "why it exists" layer.

---

## Identity and Access

| # | Module | Code | Route base | Frontend surface |
|---|---|---|---|---|
| 1 | Authentication and Session Management | `HDC-AUTH` | `/auth`, `/sessions`, `/webauthn` | `/login`, `/register`, `/dashboard/session-management`, `/dashboard/mfa` |
| 2 | Identity Federation and Provisioning | `HDC-FED` | `/oidc`, `/scim/v2` | `/dashboard/oidc`, `/dashboard/scim` |
| 3 | RBAC — Roles, Permissions and Menus | `HDC-RBAC` | `/roles`, `/user-permissions`, `/menu-groups` | `/dashboard/roles`, `/dashboard/permissions`, `/dashboard/user-permissions`, `/dashboard/menu-groups` |
| 4 | User Management | `HDC-USER` | `/users` | `/dashboard/users`, `/dashboard/profile`, `/dashboard/change-password` |

**Why it is shaped this way:** authentication issues a JWT *and* a database-backed session row. The token alone would be cheaper, but a compliance platform must be able to answer "revoke this person now" and "which sessions were live on 14 March", which a stateless token cannot. The session row is the answer to both.

## Tenancy

| # | Module | Code | Route base | Frontend surface |
|---|---|---|---|---|
| 5 | Tenant Management | `HDC-TENANT` | `/tenants`, `/tenant-hierarchy`, `/custom-domains` | `/dashboard/tenants`, `/dashboard/tenant-hierarchy`, `/dashboard/custom-domains` |
| 6 | Tenant Lifecycle Management | `HDC-TLC` | `/tenants/:id/lifecycle` | `/dashboard/tenant-lifecycle` |
| 7 | Tenant Backup and Disaster Recovery | `HDC-BAK` | `/tenants/:id/backups` | inside `/dashboard/tenants/[tenantId]` |

**Mount surprise:** lifecycle and data-retention routers are mounted under `/api/v1/tenants/...`, not at `/api/v1/tenant-lifecycle` or `/api/v1/data-retention` as their file names suggest. See [`../API/00-API-STANDARDS.md`](../API/00-API-STANDARDS.md).

## Inventory

| # | Module | Code | Route base | Frontend surface |
|---|---|---|---|---|
| 8 | Warehouse and Inventory Management | `HDC-WH` | `/warehouses`, `/stocks` | `/dashboard/stock` |

Covers warehouses, storage locations, stock rows, adjustments, transfers and opname. Warehouse location CRUD is **flat** at `/warehouses/locations` rather than nested under a warehouse id; stock update, transfer and opname use `PATCH`.

## Calibration Core

| # | Module | Code | Route base | Frontend surface |
|---|---|---|---|---|
| 9 | Calibration Device Management | `HDC-CDEV` | `/calibration-devices` | `/dashboard/devices` |
| 10 | Calibration Records and Scheduling | `HDC-CAL` | `/calibration-records`, `/calibration-scheduler` | `/dashboard/calibration`, `/dashboard/calibration-scheduler` |
| 11 | Certificate and e-Signature | `HDC-CERT` | `/certificates`, `/esignature` | `/dashboard/esignature`, public `/verify/[certificateNumber]` |

This is the reason the product exists; everything else is support. See [`07-CALIBRATION-PROGRAM.md`](./07-CALIBRATION-PROGRAM.md) for the end-to-end flow.

## Maintenance and Quality

| # | Module | Code | Route base | Frontend surface |
|---|---|---|---|---|
| 12 | Maintenance and Predictive Maintenance | `HDC-MNT` | `/maintenance`, `/predictive-maintenance` | `/dashboard/maintenance`, `/dashboard/predictive-maintenance` |
| 13 | Quality Management System | `HDC-QMS` | `/qms`, `/sop`, `/risk` | `/dashboard/qms`, `/dashboard/sop`, `/dashboard/risk` |
| 14 | Vendor and Supplier Scorecard | `HDC-VEN` | `/vendors`, `/supplier-scorecard` | `/dashboard/supplier-scorecard` |

QMS covers non-conformances and CAPA; SOP covers controlled documents and training acknowledgement; risk covers the register with derived RPN.

## Commercial

| # | Module | Code | Route base | Frontend surface |
|---|---|---|---|---|
| 16 | Billing, Subscription and Finance | `HDC-BILL` | `/billing`, `/finance`, `/metered-billing`, `/quota` | `/dashboard/billing`, `/dashboard/finance`, `/dashboard/metered-billing` |

Stripe-backed subscriptions and invoices, asset finance and depreciation, usage metering with threshold alerts, and plan quota enforcement. The Stripe webhook is the one endpoint that needs the unparsed request body — the JSON parser stashes raw bytes on `req.rawBody` only for `/api/v1/billing/webhook`.

## Platform Services

| # | Module | Code | Route base | Frontend surface |
|---|---|---|---|---|
| 15 | Developer API, Webhooks and Integrations | `HDC-DEV` | `/api-keys`, `/webhooks` | `/dashboard/api-keys` |
| 17 | Notifications | `HDC-NOTIF` | `/notifications` | `/dashboard/notifications` + global toast/socket |
| 18 | Workflow Engine | `HDC-WF` | `/workflows` | inside the gated resource screens |
| 19 | Audit and Compliance Trail | `HDC-AUDIT` | `/audit` | `/dashboard/audit` |
| 20 | Content Management | `HDC-CMS` | `/content` | `/dashboard/content`, public `/blog` |
| 21 | Attachment and Document Management | `HDC-ATT` | `/attachments` | `/dashboard/attachments` |
| 22 | Batch Jobs and Background Processing | `HDC-JOB` | `/jobs` | `/dashboard/batch-jobs` |
| 23 | Reporting and Dashboard Analytics | `HDC-RPT` | `/reports`, `/dashboard` | `/dashboard`, `/dashboard/reports` |
| 24 | GDPR and Data Retention | `HDC-GDPR` | `/gdpr`, `/tenants/:id/data-retention` | `/dashboard/gdpr`, `/dashboard/data-retention` |
| 25 | IoT Telemetry | `HDC-IOT` | `/iot` | feeds device and predictive screens |
| 26 | AI Assistant Services | `HDC-AI` | `/ai` | `/dashboard/ai-assistant` |
| 27 | Feature Flags | `HDC-FLAG` | `/feature-flags` | `/dashboard/feature-flags` |
| 28 | Network Security | `HDC-NETSEC` | `/network-security` | `/dashboard/network-security` |
| 29 | Global Search | `HDC-SEARCH` | `/search` | global command palette |
| 30 | Platform Administration and Migration | `HDC-ADMIN` | `/admin`, `/migration` | internal only |
| 31 | Kanban Project Tracker | `HDC-KANBAN` | `/kanban` | `/dashboard/kanban` |
| 32 | Support Desk | `HDC-TICKET` | `/tickets` | `/dashboard/tickets/raise`, `/dashboard/tickets/response` |
| 33 | Pluggable Object Storage | `HDC-STORAGE` | `/storage`, `/attachments` | `/dashboard/storage` |

## Feature Flags and Optional Backends

Several modules degrade rather than fail when their backing service is absent. This is deliberate: a developer must be able to run the platform with Postgres and nothing else.

| Feature | Env switch | Behaviour when unset |
|---|---|---|
| Virus scanning | `VIRUS_SCAN_PROVIDER` | `none` — uploads unscanned. Set `clamav` to enforce. On scanner error the default is **fail-closed** |
| Batch jobs | `BATCH_JOBS_INLINE` | in-process, no broker needed |
| WebAuthn | `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` | passkey registration unavailable |
| AI / RAG | `OPENAI_API_KEY` | AI query and GDPR export return errors — environment, not a code defect |
| Custom domain TLS | `CUSTOM_DOMAINS_ENABLED`, `TLS_AUTO_PROVISION` | domains can be registered, not provisioned |
| Retention purge | `RETENTION_SCHEDULER` | no scheduled purge; manual purge still works |
| Object storage | `STORAGE_DRIVER` | `local` — the app server disk |

Full list with defaults: [`../BACKEND/11-CONFIGURATION.md`](../BACKEND/11-CONFIGURATION.md).
