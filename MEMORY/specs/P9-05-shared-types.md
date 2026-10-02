# Feature Spec — P9-05 Shared types: the Request augmentation, branded ids, state unions

**Written:** 2026-10-02. The card has said "Spec required" since it was written, but the file did not exist; parts of the card (the Request augmentation, `TenantId`, `UserId`) shipped with the modules that needed them (ADR-087 Amendments 2, 5, 11) without one. This spec records what shipped, and decides the open part implemented with it: **the state-machine unions**.
**Task:** P9-05 (`TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md` § P9-05)
**Author:** Claude (agent, P9-22 helper), for Zed, assigned by the coordinator under the owner's delegation
**Spec refs:** `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` §§ branded ids, state machines · ADR-087 · ADR-097 (`packages/contracts`) · ADR-103 (code-first API contract)

---

## Problem

Three kinds of value are passed around the backend as bare strings, so the compiler cannot tell them apart:

1. **Identifiers.** `tenantId` and `userId` are both UUID strings and both everywhere; swapping them is the most dangerous argument mistake this codebase can make (it crosses the tenant boundary).
2. **The request's principal and tenant.** Handlers used to cast `req as AuthedRequest` to reach `req.user`, so a missing `auth` middleware was invisible to the type checker.
3. **State-machine values.** A certificate, a stock transfer, an opname, a CAPA, a work order, a tenant, a webhook delivery and a workflow instance each move through a fixed set of statuses. Each list was written **more than once**: in the model (the database ENUM), in `packages/contracts` (the request and response schemas), sometimes again inline (`z.enum([...])`), and once as an object (`Certificate.STATUS`, `TENANT_STATUS`). Nothing kept the copies equal, and a `switch` over a status typed `string` has no exhaustiveness check: a new status falls through silently.

## What already shipped (recorded, not changed here)

| Item | Where | Since |
|---|---|---|
| `Request` augmentation: `requestId`, `user` (`AuthenticatedPrincipal`), `tenantId: TenantId \| null`, `impersonatorId`, `apiKeyAuthorized`, the upload fields, `validated` | `backend/src/types/express.d.ts` | ADR-087 Am. 2, 5; P9-11 |
| `Brand<T, B>`, `TenantId`, `UserId`, with validating constructors `toTenantId` / `toUserId` (they throw on a non-UUID) | `backend/src/types/ids.ts` | ADR-087 Am. 5, 11 |
| The deny sentinel: `NO_TENANT_ID` in `types/ids.ts`, `NO_TENANT_UUID: TenantId` in `utils/tenantScope.util.ts` | as left | ADR-087 Am. 11 |
| `switch-exhaustiveness-check` as an **error** for every `.ts` file | `backend/eslint.config.js` | P9-02 |

So the exhaustiveness rule was already on; what it lacked was **unions to be exhaustive over**.

## Decision — the state unions (implemented with this spec)

1. **One module holds every state machine's values: `packages/contracts/src/states.ts`** (`@callibrator/contracts/states`). Each machine is a frozen `as const` tuple, in the database ENUM's order (the order is what `sync` creates the type from, so it is part of the schema), and a union type derived from it:

   | Machine | Tuple | Union | Values |
   |---|---|---|---|
   | Certificate | `CERTIFICATE_STATUSES` (+ `CERTIFICATE_STATUS` object) | `CertificateStatus` | draft, pending_approval, approved, signed, revoked |
   | Stock transfer | `STOCK_TRANSFER_STATUSES` | `StockTransferStatus` | pending, in_transit, completed, cancelled |
   | Stock opname | `STOCK_OPNAME_STATUSES` | `StockOpnameStatus` | draft, in_progress, completed |
   | CAPA | `CAPA_STATUSES` (re-exported from `qmsValues`, already the single source) | `CapaStatus` | DRAFT, OPEN, IN_PROGRESS, VERIFICATION, CLOSED |
   | Work order | `WORK_ORDER_STATUSES` | `WorkOrderStatus` | Open, InProgress, Completed, Cancelled |
   | Tenant lifecycle | `TENANT_LIFECYCLE_STATUSES` (+ `TENANT_LIFECYCLE_STATUS` object) | `TenantLifecycleStatus` | active, suspended, deleted |
   | Webhook delivery | `WEBHOOK_DELIVERY_STATUSES` | `WebhookDeliveryStatus` | pending, success, failed, exhausted |
   | Workflow instance | `WORKFLOW_INSTANCE_STATUSES` | `WorkflowInstanceStatus` | PENDING, APPROVED, REJECTED, CANCELLED |

2. **Contracts, not `backend/src/constants`.** The frontend reads these values too (filters, badges), and `packages/contracts` is already the cross-workspace source for request values (ADR-097: `qmsValues`, `accessRequestValues`). The backend constants that exist for a reason of their own stay, built from the tuple: `constants/tenantStatus.ts` (`TENANT_STATUS`, kept in its own module so a test mocking the constants barrel cannot empty it, A-143) re-exports the contracts object.
3. **Every copy is replaced by an import**: the models' `DataTypes.ENUM(...)`, the contracts domain files (`certificate.ts`, `stock.ts`, including its two inline `z.enum([...])` lists, `maintenance.ts`), and `Certificate.STATUS` (now the contracts object; the model still exposes it as a static, unchanged in shape).
4. **Two different "tenant statuses" are NOT merged.** `tenants.status` (the lifecycle, lower case: active / suspended / deleted) is a state machine and lives in `states.ts`. The tenant *request body's* `status` field in `contracts/tenant.ts` (`ACTIVE` / `INACTIVE` / `SUSPENDED`, case-insensitive) is a different, older field; how it maps to the lifecycle is the tenant service's business, and it is left as it is. The name `TENANT_LIFECYCLE_STATUSES` exists to keep the two apart. (Recorded as an observation for the tenant lane, not changed here.)
5. **A guard keeps it one source** (`backend/src/tests/guards/stateUnions.p905.guard.test.ts`): every model's ENUM equals its `states.ts` tuple (read from the model's `rawAttributes`, so it is the real column definition), the contracts Zod enums accept exactly those values, and the backend constants objects equal them.

**Alternatives considered.**
- *Backend `constants/` as the source.* Rejected: the frontend could not import it, and the request values already moved to contracts under ADR-097. Two sources is the problem being fixed.
- *TypeScript `enum`s.* Rejected: `docs/ENGINEERING/04` bans them (`as const` + union), and the lint rule enforces the ban.
- *Generate the tuples from the database.* Rejected: the models define the ENUMs (sync and migrations read the models), so the database is downstream of this list, not upstream.

**Implications, including the bad ones.**
- The models now import from `@callibrator/contracts`, a workspace package. That was already true of `constants/` (and so, transitively, of every model); `build:dist` copies the compiled package into `dist/node_modules`, and `load:check` proves both trees load.
- A status change is now ONE edit plus a migration — but it is still a migration: changing the tuple changes what `sync` would create, and an existing database's ENUM type does not follow by itself.
- The tuples are frozen. Code that mutated a status list in place (none found) would now throw.

## Still open on the card (not decided here)

- Brands for the other aggregate roots (`DeviceId`, `CertificateId`, …) with their constructors.
- `tenant` on `Request`, and the last `req as AuthedRequest` cast (`routes/api/scim.route.ts`).
- Whether `NO_TENANT_UUID` and `NO_TENANT_ID` become one exported constant.

## Verification

- The guard above (fails on a planted extra value in a model ENUM, or a contracts list, in a scratch mirror).
- `npm run typecheck`, `build:dist`, `load:check` (dist and src), the full backend suite and the contracts package tests (`packages/contracts`, `npm test`).
- No behaviour changes: every tuple keeps its values and order, so the database ENUMs, the validators and the responses are unchanged.
