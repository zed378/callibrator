# 03 — Naming Conventions

What things are called, as they are called today. Where the codebase is inconsistent, this says so rather than inventing a rule nobody follows.

---

## Files

| Layer | Pattern | Example |
|---|---|---|
| route | `<module>.route.js` | `calibrationDevices.route.js` |
| controller | `<module>.controller.js` | `certificate.controller.js` |
| service | `<module>.service.js` | `meteredBilling.service.js` |
| model | `<entity>.model.js` | `stockTransfer.model.js` |
| validator | `<module>.validator.js` | `stock.validator.js` |
| middleware | `<concern>.middleware.js` | `tenantContext.middleware.js` |
| util | `<concern>.util.js` | `storagePath.util.js` |
| test | `<file>.test.js`, or `<file>.<angle>.test.js` for additional suites | `tenant.service.coverage.test.js` |

camelCase before the layer suffix. Under TypeScript the extension becomes `.ts` and nothing else changes.

**Singular or plural is not consistent** — `calibrationDevices.route.js` beside `certificate.controller.js`. Match the existing module when adding a file to it; do not rename files to fix it (it churns every import for no behavioural gain).

## URLs

- `/api/v1/<kebab-case-plural>` — `/api/v1/calibration-devices`, `/api/v1/tenant-hierarchy`.
- Sub-resources nest: `/warehouses/:warehouseId/locations`.
- Path parameters name their entity: `:deviceId`, never `:id` in new routes — the validator and the two-tenant test both need to know what it is.

Known exceptions, kept because changing them breaks the API contract: `POST /users/detail`, `DELETE /users/delete?userId=`, `/menu-groups/menu-groups/admin` (a genuinely doubled path). They are listed in `TASKS/BACKLOG.md` W-01 … W-06.

## Database

| Thing | Convention | Exception |
|---|---|---|
| table | snake_case plural | **`UsageMetrics`** — camelCase, quote it |
| column | snake_case | `UsageMetrics` columns are camelCase too (`"tenantId"`, `"periodStart"`) |
| model attribute | camelCase, mapped with `underscored: true` | **`sessions`**: attributes are snake_case (`tenant_id`, `is_revoked`) |
| soft-delete flag | attribute `isDeleted`, column `is_deleted` | writing `is_deleted` in code silently does nothing |
| migration file | `NNNN-verb-object.js` | the recorded name includes `.js` and is frozen |

## Identifiers in Code

| Kind | Convention |
|---|---|
| variables, functions | camelCase |
| classes, TS types | PascalCase |
| constants objects | SCREAMING_SNAKE (`ROLE_NAMES`, `MENU_SLUGS`) |
| branded ids (target) | `<Entity>Id` — `TenantId`, `DeviceId` |
| environment variables | SCREAMING_SNAKE, grouped by prefix (`DB_`, `STORAGE_`, `WEBAUTHN_`) |

## Roles and Permissions

- Role names are stored with spaces: `HEALTHCARE ADMIN`, `CALIBRATOR ADMIN`, `WAREHOUSE STAFF`. `TENANT_ADMIN` is a **logical tier** in `ROLE_LEVELS`, not a stored role.
- Menu slugs are kebab-case: `custom-domains`, `tenant-hierarchy`, `tickets-response`.
- `dynamicAccess(resource, action)` must be passed a **menu slug**. Several routes pass capitalised names (`"Maintenance"`, `"Finance"`, `"AuditLogs"`) that match no slug exactly — whether they work for non-super-admin users is unverified (A-07). New routes use the slug.
- Actions: `read` or `write`. Richer verbs normalise to `write`.

## Events and Queues

| Kind | Convention | Example |
|---|---|---|
| webhook event | `<aggregate>.<event>` | `device.calibration_due`, `device.overdue`, `webhook.test` |
| RabbitMQ queue | snake_case | `batch_jobs`, `email_queue` |
| dead-letter queue | declared beside its queue | `batch_jobs_dlq`, `email_dlq` |
| Socket.IO room | `<scope>_<id>` | `tenant_<id>`, `user_<id>`, `board_<projectId>`, `super_admins` |
| Socket.IO event | `<feature>:<verb>` | `kanban:join` |
| Redis key | `<purpose>:<parts>` | `lock:register:<email>:<username>`, `webauthn:challenge:<userId>`, `oidc:code:<code>` |

A Socket.IO room join takes the **raw id**; the server builds the prefix. A client that sends `board_<id>` joins a room nobody publishes to, and the symptom is silence.
