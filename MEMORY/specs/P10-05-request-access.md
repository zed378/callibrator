# Feature Spec — P10-05 Request Access (public intake + super-admin queue)

**Written:** 2026-09-29 — **before** implementation
**Task:** P10-05 (backend) · P10-06 (the `/request-access` page) · P10-07 (the super-admin queue)
**Author:** technical-writer agent, Phase 10 planning
**Spec refs:** `docs/UI-UX/20-LANDING-AUTH-REVAMP.md` §8 · `docs/UI-UX/research/00-owner-brief-landing-auth.md` (Register, Request-access storage rows) · `docs/UI-UX/research/04-competitor-landing-and-auth.md` §3.4, §6.3 · `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` · `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` · `MEMORY/specs/A-41-audit-inside-transaction.md` · ADR-098


> **As built (2026-09-30), deviations recorded in ADR-108:** migration **0099** (plus 0101 for the menu), not "00NN"; the tenant foreign key is added by the migration, not declared on the model; the invitation token is 256 random bits, and only its hash is kept on the request row (not a JWT purpose token); request budgets (`requestBudget`, ADR-100), not `endpointRateLimiter`; configuration in `config/publicAccess.ts`; the queue page at `/dashboard/access-requests`; no `maxUsers` on approve (A-303); DSAR erasure at `POST /admin/access-requests/erasure`. Record: `MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md`.

---

## Problem

A hospital that wants Callibrator has no way to say so. `/register` calls `POST /auth/register`, which creates a **tenant-less** `USER` (`backend/src/services/auth.service.js:202`) while the page promises "Create your workspace" and the login page links "Create a tenant workspace" (`frontend/src/app/login/page.tsx:177`). Its two 409s ("Email already registered", "Username already used") are an account oracle. The owner chose **Request access**: an institution submits who it is and what it needs; a super admin approves (which creates the tenant) or rejects.

Personas: the hospital's Kepala IPSRS or a calibration-lab manager (requester); the Platform Operator, Andi (`docs/UI-UX/03-PERSONAS.md`), who works the queue.

---

## What `docs/` and the Code Already Decide

| Decision | Source |
|---|---|
| Creating a tenant is a **platform** operation, super admin only | A-76; `backend/src/routes/api/tenant.route.js:376–391` (`superAdminOnly`) |
| The tenant create and its audit row share a transaction; the row is recorded under the **PLATFORM** tenant | A-95, A-125 (ADR-051 Q-14); `backend/src/services/tenant.service.js#createTenant` (line 439) |
| Tenant `code` and `name` are unique; a clash is **409** | `tenant.service.js` lines 473–490 |
| An audit row's actor is `user`, `system` (named from the **closed** `SYSTEM_ACTORS` list) or history-only `unknown` | `backend/src/constants/systemActors.ts` (A-124, ADR-051 Q-13) |
| Platform-only routes live behind `rbac(["SUPER_ADMIN","SUPERADMIN"])` on the admin router, and are allow-listed as `platform` in the two-tenant guard | `backend/src/routes/api/admin.route.js:16–17`; `backend/src/tests/guards/twoTenantRoutes.guard.test.ts` (kind `platform`, lines 29, 471–472) |
| Request validation is Zod through `validate(schema, { from })`; a `.ts` handler reads `validated(req, schema)` | ADR-093; `backend/src/middlewares/validation.middleware.ts` |
| A model is tenant-scoped if and only if it has a `tenantId` (or `tenant_id`) attribute | `backend/src/utils/tenantScope.util.ts#tenantKeyOf` (line 122) |
| New backend files are TypeScript, tests included; a new `.js` fails `npm run ratchet` | ADR-087; CLAUDE.md |
| Raw SQL goes through `sql()` with bound parameters | P9-07; CLAUDE.md |
| Per-IP request quotas use `endpointRateLimiter(<key>)` over `API_ENDPOINTS` | `backend/src/services/rateLimiter.redis.service.js` (~line 590); `backend/src/constants/rateLimitConstants.ts` |
| Email goes through the queue, never inline in the request | `backend/src/services/emailQueue.service.js`, `email.service.js` |
| Status codes: 400 validation, 403 in-tenant permission, 404 not found (incl. cross-tenant), 409 invalid transition | CLAUDE.md |

**Gap, decided here (ADR-098 §6):** `docs/` has no public intake endpoint. A new public, unauthenticated write needs an ADR (template: "Is any endpoint public? That needs an ADR"). ADR-098 is that record.

**Deliberate difference from the brief I was given:** the task description asked for a `dynamicAccess` gate on the queue routes. This spec uses the admin router's `rbac(SUPER_ADMIN)` instead. `dynamicAccess` grants by menu, which a tenant role can be given; approving an access request creates a tenant, which A-76 made super-admin-only precisely because a menu grant reached tenant administrators. The two-tenant guard's `platform` kind requires `superAdminOnly` or an `rbac` gate in the chain.

---

## Data Model

New table **`access_requests`**, model `AccessRequest` in `backend/src/models/accessRequest.model.ts` (`initModel` + `export =`, registered in the typed barrel `models/index.ts`; 04 § Models).

| Column (DB) | Attribute | Type | Null | Notes |
|---|---|---|---|---|
| `id` | `id` | UUID v4 | no | PK |
| `organisation_name` | `organisationName` | VARCHAR(160) | no | |
| `facility_type` | `facilityType` | ENUM `hospital`, `clinic`, `calibration_lab`, `other` | no | |
| `city` | `city` | VARCHAR(80) | no | |
| `device_count_band` | `deviceCountBand` | ENUM `lt_100`, `100_499`, `500_1999`, `gte_2000`, `unknown` | no | a band, not a number: nobody knows it exactly, and a number invites a false-precision figure on a dashboard |
| `contact_name` | `contactName` | VARCHAR(120) | no | personal data |
| `contact_role` | `contactRole` | VARCHAR(80) | yes | |
| `work_email` | `workEmail` | VARCHAR(254) | no | stored lower-cased; personal data |
| `whatsapp` | `whatsapp` | VARCHAR(20) | no | E.164 (`+62…`); personal data |
| `needs` | `needs` | TEXT | yes | ≤ 2,000 chars (validator) |
| `locale` | `locale` | ENUM `id`, `en` | no | the language the form was filled in; replies use it |
| `consent_version` | `consentVersion` | VARCHAR(32) | no | which consent text was shown (e.g. `2026-09-29`) — proves what was agreed to |
| `consented_at` | `consentedAt` | TIMESTAMPTZ | no | |
| `status` | `status` | ENUM `pending`, `approved`, `rejected`, `spam`, `expired` | no | default `pending`; `expired` is set by the retention job, never by a request |
| `admin_user_id` | `adminUserId` | UUID → `users.id`, `ON DELETE SET NULL` | yes | the invited first administrator |
| `decided_by` | `decidedBy` | UUID → `users.id` | yes | the super admin |
| `decided_at` | `decidedAt` | TIMESTAMPTZ | yes | |
| `decision_note` | `decisionNote` | VARCHAR(1000) | yes | required on reject (validator) |
| `provisioned_tenant_id` | `provisionedTenantId` | UUID → `tenants.id`, `ON DELETE SET NULL` | yes | the tenant approval created. **Deliberately not named `tenantId`**: that attribute would make the global hooks scope the table (`tenantKeyOf`), and a pending request belongs to no tenant |
| `source_ip_hash` | `sourceIpHash` | CHAR(64) | no | `sha256(pepper + ip)`, for abuse review; the raw address is never stored |
| `user_agent` | `userAgent` | VARCHAR(256) | yes | truncated |
| `created_at`, `updated_at` | timestamps | TIMESTAMPTZ | no | |

Answers to the template's questions:

- **No `tenantId`.** A request precedes any tenant; the table is platform-owned, like `tenants` itself. Recorded reason: this line, and ADR-098 §6. It is reached only by the super admin (API below).
- **Not `paranoid`.** A request is not evidence of a regulated act. Retention (below) deletes rows outright.
- **Retention** (working decision Q-42, ADR-098 §8.6, awaiting owner confirmation): a `pending` row nobody decides becomes `expired` after **90 days**; `rejected`, `spam` and `expired` rows are deleted **12 months** after `decided_at` (or the expiry); an `approved` row keeps its link to the tenant it created and is deleted with that tenant's offboarding. The existing retention job does it (`retentionScheduler.middleware.js` → `dataRetention.service.js`), audited under a new `SYSTEM_ACTORS` name. The privacy notice states these periods.
- **Indexes:** `(status, created_at DESC)` — the queue's only query; `(work_email)` — duplicate grouping in the queue view. Nothing else is queried.
- **No uniqueness constraint.** A unique `work_email` would answer "this address already asked" to anyone — an oracle. Duplicates are allowed and grouped in the queue.
- **ENUMs** as listed; `facility_type` values match nothing existing (no neighbouring vocabulary to align with). `status` follows the `pending/approved/rejected` words used by e-signature and approvals.
- **Nothing derived** is stored.
- **DSAR:** the contact fields are personal data of a person who may never hold an account. The DSAR export and erasure paths (`gdpr.route.js`) key on a user; add `access_requests` to the erasure search by email (P10-05 DoD), so a requester's erasure request finds these rows.

**Migration** `backend/src/migrations/00NN-access-requests.ts` — the **next free number at implementation time** (0093 is the highest on 2026-09-29; 0092 is unassigned in the tree, so check `ls` and the manifest in `backend/src/config/migrator.js` rather than guessing). Added to the static manifest in `migrator.js`. `up` creates the ENUM types and the table in one transaction; `down` drops them. **No blanket `try/catch`** (CLAUDE.md trap). `make migrate-verify` and a `\d access_requests` inspection go in the record.

---

## API

| Method | Path | Gate | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/access-requests` | **public**; `endpointRateLimiter("accessRequest")` | submit a request |
| `GET` | `/api/v1/admin/access-requests` | `auth` + `rbac(SUPER_ADMIN)` (admin router) | the queue: `?status=pending|approved|rejected|spam&page&limit` |
| `GET` | `/api/v1/admin/access-requests/:id` | same | one request, with other requests from the same `workEmail` |
| `POST` | `/api/v1/admin/access-requests/:id/approve` | same | create the tenant and mark approved |
| `POST` | `/api/v1/admin/access-requests/:id/reject` | same | mark rejected or spam |

Files: `backend/src/routes/api/accessRequests.route.ts` (the public route — a **new** route module, so TypeScript; registered wherever `routes/api/index` mounts modules), the four admin routes **added to the existing** `admin.route.js` (editing an existing `.js` file is allowed; do not half-convert it), `backend/src/controllers/accessRequest.controller.ts`, `backend/src/services/accessRequest.service.ts`, `backend/src/validators/accessRequest.validator.ts`.

### `POST /access-requests`

Chain: `endpointRateLimiter("accessRequest")` → `validate(submitAccessRequestSchema)` → controller.

- **Rate limit:** new `API_ENDPOINTS.accessRequest = { maxRequests: 5, windowMs: WINDOW.HOUR }` (per IP; `endpointRateLimiter` keys by IP when there is no user). Plus a service-level cap: **3 per `workEmail` per 24 h** — beyond it the request is not stored, and the answer is still the neutral 202.
- **Body (Zod):** the fields in the table above (camelCase), `consent: z.literal(true)`, `consentVersion`, `locale`, and the honeypot `website`. Strings trimmed; `workEmail` lower-cased; `whatsapp` normalised (`0812…` → `+62812…`) then checked against `^\+[1-9]\d{7,14}$`. **Any `tenantId`, `status`, `decidedBy` or `provisionedTenantId` in the body is stripped by the schema** (`z.object(...).strict()` would 400 on it; use `.strip()` so a probe learns nothing) — the server never reads them from a body.
- **Honeypot:** if `website` is non-empty, **store nothing**, log at `info` with the IP hash, and return the neutral 202. (Storing spam as `status: spam` would let a bot fill the table.)
- **Transaction:** create the row and write the audit row **in one transaction** (A-41):
  `auditService.logAction({ tenantId: PLATFORM_TENANT_ID, systemActor: "access-request-intake", action: "CREATE", resourceType: "AccessRequest", resourceId, changes: { after: { status: "pending", facilityType, deviceCountBand } } }, { transaction })`.
  **No personal data in `changes`** (not the name, email or phone): `audit_logs` is append-only (0091) and would then hold personal data the retention sweep cannot remove. Add `"access-request-intake"` to `SYSTEM_ACTORS` in review (`audit.service.js#resolveActor` refuses a name not on the closed list).
- **After commit:** enqueue one internal notification email to `ACCESS_REQUEST_NOTIFY_EMAIL` (new variable in `backend/src/config/env.ts` via `envOr`; unset → no email, a `warn` log once at boot). The email carries the organisation name and a link to the queue, **not** the requester's contact details (a mailbox is a weaker store than the database). **No email to the requester** — otherwise anyone can make us email any address.
- **Response, always the same:** `202 { success: true, status: 202, message: "Request received", data: null }` — for a new request, a duplicate, an over-cap email and a honeypot hit. Only malformed input answers 400, and the 400 is about the **shape** of what was typed, never about existing records. Timing: the duplicate/cap branch still runs the same validation and one indexed count, so its latency is in the same class; do not add artificial sleeps.

### `GET /admin/access-requests`

Envelope: rows in `data`, pagination in a **top-level `meta`** (`{ total, page, limit }`). Default `status=pending`, sorted `created_at DESC`. Each row carries `duplicateCount` (other requests with the same `workEmail`), computed in the same query (a correlated count or a window function through `sql()` with bound parameters — **no tenant predicate applies**, because the table has no tenant; say so in a comment).

### `GET /admin/access-requests/:id`

404 if the id does not exist (UUID shape checked by `validateUuid` first → 400 on a malformed id). Returns the row, the `decidedBy` user's display name (include with **`required: false`** — the decider may be deleted; and `User` has a `defaultScope`, so a missing `required: false` would make the row vanish, CLAUDE.md trap A-75), the provisioned tenant's `code` and `name` if any, and the other requests from the same email.

### `POST /admin/access-requests/:id/approve`

Body (Zod, `from: ["params", "body"]` so the validator sees `id`): `{ tenantCode, tenantName?, maxUsers?, adminFirstName?, adminLastName? }`. `tenantName` defaults to `organisationName`; the administrator's name defaults to a split of `contactName` and the address is always the request's `workEmail` (not editable here, so an approval cannot invite a different person than the one who asked).

1. Open a transaction. Load the request **`FOR UPDATE`** (`lock: transaction.LOCK.UPDATE`) — two super admins approving at once must not create two tenants.
2. Not found → **404**. `status !== "pending"` → **409** with a state explanation: *"This request was already {approved|rejected} on {date} by {name}."* (CLAUDE.md § Status Codes That Carry Meaning).
3. Create the tenant **through `tenant.service.js#createTenant`**, not a second implementation. It opens its own transaction today; P10-05 adds an optional `{ transaction }` argument: when given, `createTenant` uses it and neither commits nor rolls back, and moves its cache writes to `transaction.afterCommit(...)`. When absent, behaviour is unchanged (proved by the existing `tenant.service` tests passing unmodified). `createTenant`'s own 409s (code or name taken) propagate as 409 and roll the whole approval back. `email` for the tenant = the request's `workEmail`; `city` = `city`.
4. Create the **first tenant administrator** in the same transaction (working decision Q-45, ADR-098 §8.4): a user in the new tenant with the tenant-administrator role, the request's `workEmail`, **no usable password** (a random hash nobody holds, as ADR-051 Q-09's restored accounts), `isEmailVerified: false`. Use or extract a `user.service` function that accepts the outer `{ transaction }` and runs the existing identity checks: an address that already belongs to a user → **409** with a state explanation (*"An account with this address already exists — resolve it before approving"*) through the rate-limited, audited identity-conflict path (A-128), and the whole approval rolls back. Issue a single-use, time-limited **invitation** purpose token (the pattern of `generatePurposeToken` / `activationClaims`, `auth.service.js:262–265`; purpose `invitation`, TTL 7 days, its hash stored so it can be consumed once). **No temporary password**: the random one-time password is for the super-admin bootstrap only.
5. Update the request: `status: "approved"`, `decidedBy`, `decidedAt`, `provisionedTenantId`, `adminUserId`.
6. Audit rows, same transaction: `{ tenantId: PLATFORM_TENANT_ID, userId: actor, action: "APPROVE", resourceType: "AccessRequest", resourceId, changes: { before: { status: "pending" }, after: { status: "approved", provisionedTenantId, adminUserId } } }`; `createTenant` writes its own `CREATE Tenant` row; the user creation writes `CREATE User` under the **new** tenant (A-41, ADR-051 Q-14). `APPROVE` is already in `backend/src/constants/auditActions.ts`.
7. Commit. After commit: enqueue the **invitation email** in the requester's `locale` — a link to `/invitation?token=…` built from the configured public origin (never a request header, A-289). No credentials in the email. A failed enqueue is logged and the queue shows *Invitation not sent — resend*; re-issuing mints a new token and invalidates the old one, audited.
8. Response `200` with `data: { request, tenant, adminUser: { id, email } }` — never the token.

Accepting the invitation (setting the password) is **P10-15**: `POST /auth/invitation/accept`.

**Why the administrator is created inside the approval:** an approved tenant with nobody able to sign in is an unfinished approval, and a separate manual step invites the super admin to type a different address. The cost is a second service in the transaction, which is why step 4 requires a `user.service` function that takes the outer transaction rather than calling the controller-level create.

### `POST /admin/access-requests/:id/reject`

Body: `{ reason (1–1000), spam?: boolean }`. Lock `FOR UPDATE`; 404 / 409 as above; set `rejected` (or `spam`), `decidedBy`, `decidedAt`, `decisionNote = reason`; audit in the transaction as `UPDATE` with `changes: { before: { status: "pending" }, after: { status: "rejected"|"spam" } }` — `AUDIT_ACTIONS` (`backend/src/constants/auditActions.ts`) has `APPROVE` but no `REJECT`, and adding one means an ENUM migration plus an `AUDIT_ACTIONS` change for no gain in what the row records. No email to the requester on reject by default (owner may want one: noted in Open Questions).

---

## Business Rules

| # | Rule | Enforcement point |
|---|---|---|
| BR-P10-1 | A request is created only with consent `true` and a recorded consent version | Zod schema (middleware) + NOT NULL columns (constraint) |
| BR-P10-2 | The public endpoint answers identically for new, duplicate, capped and honeypot submissions | service (convention, pinned by a test that compares the four responses byte for byte) |
| BR-P10-3 | Only `pending` requests may be approved or rejected | service check under `FOR UPDATE` → 409 (service); a CHECK constraint that `decided_at` is set iff `status <> 'pending'` (database) |
| BR-P10-4 | Approval creates exactly one tenant | row lock (database) + `provisioned_tenant_id` set in the same transaction |
| BR-P10-5 | No request body can set `status`, `decidedBy`, `provisionedTenantId` or any tenant id | Zod `.strip()` (middleware) |
| BR-P10-6 | No personal data in audit `changes` | convention, pinned by a test that inspects the written audit row |
| BR-P10-7 | The queue is super-admin only | `rbac(SUPER_ADMIN)` on the admin router (middleware) + guard allow-list kind `platform` |

---

## Security

- **Tenant isolation:** the table has no tenant, deliberately; nothing tenant-owned is read except through `createTenant`. No `skipTenantScope` is needed (the model is unscoped by construction). The raw count in the list uses `sql()` and carries a comment saying why there is no tenant predicate.
- **Enumeration:** no global unique constraint; neutral 202; no requester email; 400s describe shape only.
- **Abuse:** per-IP quota, per-email cap, honeypot, 2,000-char limit on free text, all strings rendered as text (React escapes; the internal email uses `escapeHtml` as `email.service.js` does).
- **Spam into a human's inbox:** the notification email carries no requester-supplied link or HTML.
- **Secrets:** the IP pepper is a new secret — `ACCESS_REQUEST_IP_PEPPER` in `config/env.ts`, required in production (refuse to boot without it, as other production-required variables do).
- **Fail direction:** Redis down → `endpointRateLimiter`'s existing behaviour (check and record which way it fails; if it fails open, the per-email cap in PostgreSQL still bounds a flood per address). Mail queue down → the request is still stored (the notification is best-effort; the queue is the source of truth).
- **List response:** carries contact details — acceptable because only the super admin reaches it; never cached in a shared key.

## Compliance

- Not evidence (no calibration, certificate or signature). Audit rows for create, approve, reject, and the retention sweep's deletes.
- Personal data: covered by the retention rule and added to DSAR erasure search (above).

## UI (P10-06 and P10-07)

- **P10-06 `/request-access`:** `docs/UI-UX/20-LANDING-AUTH-REVAMP.md` §8. `/register` becomes a permanent redirect (308) to `/request-access`; the login link *Create a tenant workspace* becomes *Belum punya akses? Minta akses*.
- **P10-07 queue:** a new dashboard page `/dashboard/admin/access-requests`, a **worklist** (research 02 §1.1): tabs by status with counts, a table (organisation, facility type, city, device band, contact, received, duplicates), a side panel for one request (NN/g, research 02 §2.3) with **Approve** (a form: tenant code — suggested from the name, editable; tenant name; max users; the administrator's name, prefilled; the invitation goes to the request's email) and **Reject** (reason; "mark as spam"). A 409 shows its state explanation inline. Three list states (loading, empty *Tidak ada permintaan baru*, failed with retry). Menu: add the slug under the platform group so only `SUPERADMIN` receives it (`MENU_SLUGS` + `ROLE_MENU_ASSIGNMENTS`, and a migration for existing databases — the seed never updates an existing database, see 0021). The dashboard is English today (00 § Language); the page follows the dashboard, not the public i18n (Phase 11 decides dashboard language).

## Tests

Name them before writing them; all `.ts`.

- **Unit / service** `accessRequest.service.p1005.test.ts`: create writes row + audit in one transaction and a forced audit failure leaves **no** row; honeypot stores nothing; per-email cap stores nothing after 3; approve on `pending` creates one tenant, sets `provisionedTenantId`, writes `APPROVE` + `CREATE Tenant`; approve on `approved`/`rejected` → 409 with the state text; approve with a taken tenant code → 409 and the request stays `pending` (rollback); reject requires a reason; audit `changes` contain no email, phone or name.
- **Neutrality** `accessRequest.neutral.p1005.test.ts`: the responses for new, duplicate, over-cap and honeypot submissions are deep-equal (status, body, and no differing headers except `X-Request-Id`).
- **Route / authorization** `accessRequest.route.p1005.test.ts` (over `memoryDb` + `routeClient`): the public POST works with no token; each admin route answers **401** with no token, **403** for a `HEALTHCARE ADMIN` and for a tenant `ADMIN` (in their own tenant — a permission failure), **200** for the super admin; a body carrying `tenantId`/`status` is stripped (the stored row is `pending`, no tenant).
- **Two-tenant guard:** the admin `:id` routes are added to `NOT_TENANT_ADDRESSED` in `twoTenantRoutes.guard.test.ts` as `{ kind: "platform", reason: "the platform's access-request queue: super admin only (rbac on the admin router); the table has no tenant and no tenant principal reaches it" }`. The guard itself verifies the chain carries the `rbac` gate. A two-tenant 404 test is **not** applicable (no tenant owns the row); the allow-list entry is the reviewed reason.
- **createTenant regression:** existing `tenant.service` tests pass **unmodified** after the `{ transaction }` option is added; a new test proves that with an outer transaction that later rolls back, no tenant and no cache entry remain.
- **Migration:** `make migrate` on a clean database **and** on a copy of production-shaped data; `\d access_requests` pasted into the record; `down` run and re-`up`.
- **Live E2E:** submit → appears in the queue → approve → tenant exists and is listed under `/admin/tenants`; reject path; rate-limit path (6th submission from one IP → 429).
- **Mutation checks:** remove the `FOR UPDATE` lock and show the concurrent-approve test creates two tenants; remove `.strip()` handling and show the body-tenant test fails.

## Traps to Avoid

- [ ] Naming the tenant link `tenantId` — the hooks would scope the table (`tenantKeyOf`).
- [ ] `required: false` on the `decidedBy` user include — `User` has a `defaultScope` (A-75).
- [ ] `validate(schema)`, never `schema.validate`; `from: ["params", "body"]` on approve/reject so `id` is validated.
- [ ] `const { sequelize } = require("../models")` in any remaining `.js` — never `db` from the barrel.
- [ ] A migration without a blanket `try/catch`.
- [ ] `createTenant` committing an outer transaction it does not own.
- [ ] Cache writes inside the transaction (a rolled-back approval must not leave a cached tenant).
- [ ] Emailing the requester at submit.

## Open Questions

- The working decisions this spec follows (Q-42 retention, Q-45 invitation) await the owner's confirmation (ADR-098 §8).
- The consent text and privacy notice need legal review before go-live (Q-42).
- Whether a rejected requester is told (email on reject) — default **no**.
- The notify address — `ACCESS_REQUEST_NOTIFY_EMAIL`; it may be the same inbox as `NEXT_PUBLIC_CONTACT_EMAIL` (Q-41).

## Rollout

- Additive: a new table and new routes; nothing existing changes shape. `createTenant`'s new option defaults to today's behaviour.
- `down` drops the table and types; tested.
- No feature flag: the page links to the endpoint only once both ship (P10-06 depends on P10-05).
- Rollback: revert the frontend link to the contact CTAs; the table can stay.
