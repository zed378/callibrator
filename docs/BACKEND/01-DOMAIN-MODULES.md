# 01 — Domain Modules

33 functional modules, 53 mounted route modules. The per-module 24-point reference is [`10-MODULE-REFERENCE.md`](./10-MODULE-REFERENCE.md); this document is the map and the conventions that hold across all of them.

---

## Module Index

| # | Module | Code | Route base |
|---|---|---|---|
| 1 | Authentication and Session | `HDC-AUTH` | `/auth`, `/sessions`, `/webauthn` |
| 2 | Identity Federation | `HDC-FED` | `/oidc`, `/scim/v2` |
| 3 | RBAC | `HDC-RBAC` | `/roles`, `/user-permissions`, `/menu-groups` |
| 4 | User Management | `HDC-USER` | `/users` |
| 5 | Tenant Management | `HDC-TENANT` | `/tenants`, `/tenant-hierarchy`, `/custom-domains` |
| 6 | Tenant Lifecycle | `HDC-TLC` | `/tenants/:id/…` |
| 7 | Tenant Backup | `HDC-BAK` | `/tenants/:id/backups` |
| 8 | Warehouse and Inventory | `HDC-WH` | `/warehouses`, `/stocks` |
| 9 | Calibration Devices | `HDC-CDEV` | `/calibration-devices` |
| 10 | Calibration Records | `HDC-CAL` | `/calibration-records`, `/calibration-scheduler` |
| 11 | Certificate and e-Signature | `HDC-CERT` | `/certificates`, `/esignature` |
| 12 | Maintenance | `HDC-MNT` | `/maintenance`, `/predictive-maintenance` |
| 13 | QMS | `HDC-QMS` | `/qms`, `/sop`, `/risk` |
| 14 | Vendor and Scorecard | `HDC-VEN` | `/vendors`, `/supplier-scorecard` |
| 15 | Developer API | `HDC-DEV` | `/api-keys`, `/webhooks` |
| 16 | Billing and Finance | `HDC-BILL` | `/billing`, `/finance`, `/metered-billing`, `/quota` |
| 17 | Notifications | `HDC-NOTIF` | `/notifications` |
| 18 | Workflow Engine | `HDC-WF` | `/workflows` |
| 19 | Audit Trail | `HDC-AUDIT` | `/audit` |
| 20 | Content Management | `HDC-CMS` | `/content` |
| 21 | Attachments | `HDC-ATT` | `/attachments` |
| 22 | Batch Jobs | `HDC-JOB` | `/jobs` |
| 23 | Reporting | `HDC-RPT` | `/reports`, `/dashboard` |
| 24 | GDPR and Retention | `HDC-GDPR` | `/gdpr`, `/tenants/:id/…` |
| 25 | IoT Telemetry | `HDC-IOT` | `/iot` |
| 26 | AI Assistant | `HDC-AI` | `/ai` |
| 27 | Feature Flags | `HDC-FLAG` | `/feature-flags` |
| 28 | Network Security | `HDC-NETSEC` | `/network-security` |
| 29 | Global Search | `HDC-SEARCH` | `/search` |
| 30 | Platform Admin | `HDC-ADMIN` | `/admin`, `/migration` |
| 31 | Kanban | `HDC-KANBAN` | `/kanban` |
| 32 | Support Desk | `HDC-TICKET` | `/tickets` |
| 33 | Object Storage | `HDC-STORAGE` | `/storage`, `/attachments` |

## Anatomy of a Module

```
routes/api/<module>.route.js       mount and middleware composition
validators/<module>.validator.js   Joi schemas
controllers/<module>.controller.js request in, envelope out
services/<module>.service.js       business logic, transactions
models/<entity>.model.js           schema and associations
```

Not every module has all five. Predictive maintenance has **no model** — it computes over `iot_readings`, `maintenance_work_orders` and `calibration_records`. Looking for a table that does not exist is a common first confusion.

## Route Mounting: the surprises

Every one of these looks like a bug on first encounter and is not.

| Surprise | Reality |
|---|---|
| `/api/v1/menu-group-roles` | **the same router** as `/api/v1/menu-groups` |
| `/api/v1/tenant-lifecycle` | **does not exist** — mounted at `/api/v1/tenants/:tenantId/…` |
| `/api/v1/data-retention` | **does not exist** — same |
| Tenant backups | also under `/api/v1/tenants/:tenantId/backups` |
| OIDC | mounted **twice**: `/api/v1/oidc` **and** `/oidc` at the host root |
| SCIM | `/api/v1/scim/v2`, with SCIM-cased paths (`/Users`, `/Groups`) |
| `DELETE /users/delete` | reads `userId` from the **query string** |
| `POST /users/detail` | detail by POST, id in the body |
| Warehouse locations | **flat** at `/warehouses/locations` |
| Stock update, transfer, opname | **`PATCH`**; devices and calibration records use `PUT` |
| Migration router | the only one under `routes/internal/` |

**Four routers share `/api/v1/tenants`**: core, backups, lifecycle and data retention.

OIDC is mounted twice because the discovery document advertises endpoints at `<issuer>/oidc/…` where the issuer is the host root. Relying parties fetch them there, not under the API prefix — serving it only under `/api/v1` produces a discovery document nobody can follow.

## Conventions Every Module Inherits

| Concern | Mechanism |
|---|---|
| Authentication | JWT Bearer → `req.user`, `req.tenantId` |
| Tenant isolation | `AsyncLocalStorage` + global Sequelize hooks, **deny by default** |
| Authorization | `dynamicAccess(resource, action)`, `rbac([roles])`, `abac` |
| Validation | Joi via `validate(schema)` |
| Envelope | `{ success, status, message, data, meta? }` |
| Errors | `AppError(status, message)` → central mapper |
| Audit | `audit_logs`, written in the action's transaction |
| Soft delete | `paranoid` + `isDeleted` on most models |
| Rate limiting | global, plus auth and OTP limiters |

## Modules That Degrade Rather Than Fail

Deliberate: a developer must be able to run the platform with Postgres and nothing else.

| Module | Switch | Unset behaviour |
|---|---|---|
| Attachments (scanning) | `VIRUS_SCAN_PROVIDER` | `none` — unscanned; scanner **error** rejects |
| Batch jobs | `BATCH_JOBS_INLINE` | in-process, no broker |
| WebAuthn | `WEBAUTHN_RP_ID`, `_ORIGIN` | passkeys unavailable |
| AI | `OPENAI_API_KEY` | `/ai` and GDPR export error — environment, not a defect |
| Custom domains | `CUSTOM_DOMAINS_ENABLED`, `TLS_AUTO_PROVISION` | registerable, not provisioned |
| Retention | `RETENTION_SCHEDULER` | no scheduled purge; manual still works |
| Storage | `STORAGE_DRIVER` | `local` |

## Modules With Unusual Shapes

| Module | Unusual because |
|---|---|
| **Predictive maintenance** | no model of its own |
| **SCIM** | its own response envelope — SCIM clients parse nothing else |
| **OIDC** | mounted twice; discovery and JWKS are public |
| **Billing** | one endpoint needs the **unparsed** request body for Stripe signature verification |
| **IoT** | ingest over an **embedded aedes MQTT broker** as well as HTTP |
| **AI** | PostgreSQL-only — `vector(1536)` via pgvector |
| **Content** | **not tenant-scoped** — platform marketing, not tenant data |
| **Migration** | under `routes/internal/`; runs schema operations over HTTP because the binary has no shell |
| **Tickets** | two menu slugs; the response side is **cross-tenant** |
| **Kanban** | only two of nine tables carry `tenantId` — the rest inherit through `projectId` |

## Adding a Module

1. Route file in `routes/api/`, mounted in `index.js`.
2. Joi validators — and merge `{ ...req.params, ...req.body }` where identifiers arrive in the path.
3. Controller, thin: request in, envelope out.
4. Service, with transactions.
5. Models, `paranoid`, with `tenantId` unless there is a recorded reason not to.
6. **A permission gate on every route.** Nothing enforces this.
7. A menu slug in `MENU_SLUGS` plus `ROLE_MENU_ASSIGNMENTS` entries — a menu group nobody is granted is invisible.
8. Audit logging on every mutation.
9. Unit tests, **plus a two-tenant test on every `:id` route asserting 404**.
10. A live E2E spec in `src/tests/e2e/modules/`.
11. A `MEMORY/records/` entry.
