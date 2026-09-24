# Audit 2026-09 — Remediation

Tasks for every defect and gap found in the backend audit of **2026-09-21** (and the deployment audit of 2026-09-10/11 where it is still open). The findings and their evidence are recorded in [`../MEMORY/records/2026-09-21-backend-audit.md`](../MEMORY/records/2026-09-21-backend-audit.md).

Task ids are `A-nn`. They are referenced from [`PHASE-9-TYPESCRIPT-MIGRATION.md`](./PHASE-9-TYPESCRIPT-MIGRATION.md) and from `BACKLOG.md`.

---

## How These Are Ordered

| Wave | Rule | Why |
|---|---|---|
| **0 — security** | fix **now, in JavaScript**, before Phase 9 starts | live holes on a production deployment. A months-long migration is not a reason to leave them open (ADR-038) |
| **1 — correctness** | fix before or alongside the Phase 9 stage that converts the module | a defect the type checker will expose anyway should get its own PR, not ride inside a conversion (ADR-038 rule 3) |
| **2 — hygiene and gaps** | schedule freely | real, but nothing is broken for a user today |

**Evidence standard.** Every card names the file, the route, or the command that shows the defect. "Verified from code" means read, not exploited; nothing here was attacked on the live system. Where a finding is **unverified**, the card says so and its first checkbox is the verification.

## Summary

| Id | Finding | Severity | Wave | Status |
|---|---|---|---|---|
| A-01 | `tenant-hierarchy` lets any authenticated principal write **other tenants** | **critical** | 0 | **DONE** 2026-09-23 |
| A-02 | webhook, storage-settings and custom-domain routes are guarded only by `auth` | **high** | 0 | **DONE** 2026-09-23 |
| A-03 | API keys ignore their scopes on every route without `dynamicAccess` | **high** | 0 | **DONE** 2026-09-23 |
| A-04 | `/search` returns records the caller's role cannot list | medium | 0 | **DONE** 2026-09-23 |
| A-05 | Socket.IO: `origin: "*"`, token in the query string, no status or suspension check | medium | 0 | **DONE** 2026-09-23 |
| A-06 | public `/health` discloses Node version, pid and memory | low | 0 | **DONE** 2026-09-23 |
| A-07 | `dynamicAccess` resource names that match no menu slug — **verified: asset finance was SUPERADMIN-only for users while API keys passed**; 31 gates normalised to slugs; five slugs reachable by no seeded role → Q-20 | **high** | 1 | **DONE** 2026-09-24 |
| A-08 | metered billing read every tenant's usage as **zero** | high | — | **DONE** 2026-09-21 |
| A-09 | Express 5 undefined `req.body` → 500 — and `validate(schema)` let an absent body straight through | medium | 1 | **DONE** 2026-09-23 |
| A-10 | webhook delivery: retries lost on restart, ~15 s window, no replay protection | medium | 1 | **DONE** 2026-09-24 — DB outbox (ADR-054), not RabbitMQ; signature v1 is a breaking change for receivers |
| A-11 | only two domain events are ever emitted to webhooks | medium | 1 | **DONE** 2026-09-24 — ten events, emitted from `afterCommit` |
| A-12 | `sessionSecurity.middleware.js` is dead and its SQL is broken | medium | 1 | **DONE** 2026-09-23 |
| A-13 | raw internal error messages reach clients in production | medium | 0 | **DONE** 2026-09-24 (asyncHandler half under A-132) |
| A-14 | production logging: no stdout, per-request lines dropped, unbounded files | medium | 1 | **DONE** 2026-09-24 |
| A-15 | `/health` checks only the database | medium | 1 | **DONE** 2026-09-23 |
| A-16 | whether `req.ip` is the client through a three-proxy chain | **unverified** | 1 | **DONE** 2026-09-24 — verified on the VM: session and audit rows record the real client IP |
| A-17 | MQTT: public port with nothing behind it; the MQTT path authenticates nobody | low | 0 | **DONE** 2026-09-23 |
| A-18 | dead code and unused dependencies | low | 2 | **PARTIAL** 2026-09-25 — dead `paginated` and `inputValidation.middleware` removed; unused deps (`aedes`, `aedes-server-factory`, `clamdjs`, `fs-extra`, `randomstring`) listed, not yet removed |
| A-19 | no secret scanner, no hook, no gate of any kind | medium | 2 | TODO |
| A-20 | the `automate/` Playwright suite is not in the repository | medium | 2 | TODO |
| A-21 | no lockfile is committed | medium | 2 | **DONE** 2026-09-23 (ADR-044) |
| A-22 | one React Compiler lint error in `GlobalSearch.tsx` | low | 2 | **DONE** 2026-09-24 |
| A-23 | search runs one query per type, sequentially, and logs a warning per call | low | 2 | **DONE** 2026-09-24 |
| A-24 | every `redis.service` helper was a no-op: **registration, passkeys and the OIDC provider broken** | **high** | — | **DONE** 2026-09-21 |
| A-25 | Stripe `upsertInvoice` never updates: an invoice that failed and was later paid stays **Open** | medium | 1 | **DONE** 2026-09-23 |
| A-26 | no consumer deduplicates: a redelivered email is sent twice (documented "idempotency claims" do not exist) | medium | 1 | **DONE** 2026-09-23 |
| A-27 | **any account could mint a `*` API key and have SCIM make it SUPERADMIN** | **critical** | 0 | **DONE** 2026-09-23 |
| A-28 | evidence and controlled documents mutable by any role (attachments, signing keys, SOP, risks) | **high** | 0 | **DONE** 2026-09-23 |
| A-29 | IoT ingest cannot be provisioned; its token would leak in list responses | medium | 1 | **DONE** 2026-09-24 |
| A-30 | the rate limiter never uses Redis — lockouts reset on every deploy | **high** | 0 | **DONE** 2026-09-23 |
| A-31 | nothing stops JWT access and refresh secrets being equal | low | 1 | **DONE** 2026-09-23 |
| A-32 | the 100% coverage figure includes 58 `istanbul ignore` exclusions | low | 2 | **DONE** 2026-09-25 — 43 → 31 directives, every one with a reason; ratchet `istanbulIgnore.a32.test.js` |
| A-33 | SCIM PATCH ignores `path`: a standards-compliant deprovision returns 200 and does nothing | medium | 1 | **DONE** 2026-09-23 |
| A-34 | **the backend lint gate has never run** — a version mismatch crashed ESLint; behind it, 1,319 errors | medium | 0 | partly DONE 2026-09-23 |
| A-35 | **every per-user permission override silently did nothing** — including a `none` revocation | **high** | 0 | **DONE** 2026-09-23 |
| A-36 | RabbitMQ connections are never reused and never closed: `connection.isOpen` does not exist in amqplib | **high** | 0 | **DONE** 2026-09-23 |
| A-37 | **SCIM user creation is a cross-tenant existence oracle** — global unique email, tenant-scoped duplicate check | **high** | 0 | **PARTIAL** 2026-09-24 — signal hidden; the constraint is Q-18 |
| A-38 | SCIM Groups are global roles: every tenant's groups are listed, and a delete removes one for everyone | medium | 1 | **DONE** 2026-09-24 — groups are a tenant-owned `scim_groups` table (ADR-053, migration 0042) |
| A-39 | a SCIM-provisioned group grants nothing, silently — `roleLevel` defaults to 1 and it gets no menu permissions | medium | 1 | **DONE** 2026-09-24 — a group maps to an existing role that grants something; unmapped says so and refuses members (ADR-053) |
| A-40 | storage: the driver cache is per process, and a null-checksum migration reports `migrated` unverified | low | 2 | **DONE** 2026-09-25 — cross-replica driver invalidation via Redis generation; migration verifies every copy (ADR-057); `storage.index.test.js`, `storageMigration.service.test.js` |
| A-41 | **audit rows are written after the response, outside the transaction** — the rule `CLAUDE.md` calls non-negotiable | **high** | 0 | **DONE** 2026-09-24 for the 25 mutations named in the spec; the rest stay on the middleware |
| A-42 | a failed audit write is reported to `console.error` only — and production writes no stdout anywhere | **high** | 0 | **PARTIAL** 2026-09-24 — audit path done; 24 other `console.*` sites remain |
| A-43 | `auditAction` logs full request and response bodies, unredacted — dead code, and a loaded gun | medium | 1 | **DONE** 2026-09-24 — deleted |
| A-44 | the access log was never pruned: `history` is a filename, not a retention period | medium | 0 | **DONE** 2026-09-23 |
| A-45 | a soft-deleted IoT device still ingested; one bad MQTT message shut the server down | **high** | 0 | **DONE** 2026-09-23 |
| A-46 | IoT anomaly detection is structurally dead — `readingTolerance` cannot be set | medium | 1 | **DONE** 2026-09-24 |
| A-47 | **no electronic signature could ever verify** — `Date.now()` was inside the hashed payload, and the key pairs signed nothing | **critical — compliance** | 0 | **DONE** 2026-09-23 (ADR-040) |
| A-48 | **revocation does not revoke**: nothing in the request path reads `sessions`, and production issues 24-hour access tokens | **high** | 0 | **DONE** 2026-09-24 — tokens without `sid` still accepted, see A-59 |
| A-49 | SCIM leftovers: a case-sensitive `displayName` oracle, unvalidated patch values, and an e2e spec that cannot pass | medium | 1 | **DONE** 2026-09-24 — case-insensitive per tenant, ids UUID-checked, spec reads the as-built envelope; the envelope itself stays open |
| A-50 | webhook deliveries followed redirects, so a 302 walked past the SSRF check | **high** | 0 | **DONE** 2026-09-23 |
| A-51 | webhook routes have **no validator at all**: the signing secret is caller-supplied, unvalidated, plaintext, and unrotatable | **high** | 0 | **DONE** 2026-09-24 |
| A-52 | the socket token's `purpose: "socket"` claim is read nowhere — it is an ordinary access token | medium | 1 | **DONE** 2026-09-24 (with A-59) |
| A-53 | a reconnected socket never re-joins its board rooms: live updates stop, silently | medium | 1 | **DONE** 2026-09-24 |
| A-54 | no Socket.IO adapter — a second replica splits the fan-out | medium | 2 | **DONE** 2026-09-24 |
| A-55 | `createTwoTenants()` does not exist. `CLAUDE.md` and eight documents cite it as the fixture that makes the 404 test one line | medium | 0 | **corrected** 2026-09-23 |
| A-56 | search swallows every query error into an empty list | low | 1 | **DONE** 2026-09-24 — a failing type now fails the request (500) |
| A-57 | the **public** verification endpoint returns the PDF path of a `draft` certificate | **high** | 0 | **DONE** 2026-09-24 |
| A-58 | five workflow routes gate on `"workflow"`; the slug is `"workflows"` — they deny everyone but SUPERADMIN | **high** | 0 | **DONE** 2026-09-24 |
| A-59 | the **email activation token** and the MFA-pending token are full bearer access tokens; SSO tokens cannot be revoked | **high** | 0 | **DONE** 2026-09-24 — sid-less tokens still accepted until the switch is flipped |
| A-60 | SSO tokens travel in the redirect URL; `/auth/sso-session` stores any posted token unverified; login never checks `isEmailVerified` | **high** | 0 | **PARTIAL** 2026-09-24 — items 1 and 2 done; item 3 is Q-11 |
| A-61 | **every e-signature signing and revocation failed its audit insert** — out-of-ENUM actions, non-existent columns — after the signature had committed | **critical** | 0 | **DONE** 2026-09-24 |
| A-62 | `approveCertificate` takes `approvedBy` from the request body, so the recorded approver can differ from the caller | **high** | 0 | **DONE** 2026-09-24 |
| A-63 | **any authenticated user can edit — or suspend — any tenant**: the `checkSelf` bypass trusts a body `userId` and returns before the tenant check | **critical** | 0 | **DONE** 2026-09-24 — not yet verified on a running server |
| A-64 | `PUT /certificates/:id` accepts `status: "approved"` / `"signed"`, bypassing re-authentication and the e-signature | **critical** | 0 | **DONE** 2026-09-24 |
| A-65 | `signDocument` never checks the signer is the step's signer, does no re-authentication, and takes the Part 11 IP and user agent from the body | **high** | 0 | **DONE** 2026-09-24 — see ADR-047 |
| A-66 | the QMS routes have no permission gate and write no audit row | **high** | 0 | **DONE** 2026-09-24 |
| A-73 | NC and CAPA numbers are `count()+1` — concurrent creates collide, and nothing enforces per-tenant uniqueness | medium | 0 | **DONE** 2026-09-24 — verified on PostgreSQL 18 |
| A-74 | `POST /qms/nc` and `/qms/capa` have no validator — bad input is a 500 | medium | 0 | **DONE** 2026-09-24 |
| A-75 | `createNC`/`createCapa` store a `deviceId`/`assignedTo` from another tenant unchecked; their list includes lack `required: false` | **high** | 0 | **DONE** 2026-09-24 — verified on PostgreSQL 18 |
| A-76 | a tenant admin can probably **create tenants, list every hospital, and delete their own tenant** — the `Management` slug gates platform operations | **critical** | 0 | **DONE** 2026-09-24 — confirmed against the real seed, then fixed |
| A-77 | user edits (`/users/edit`, profile) write no audit row | **high** | 0 | **DONE** 2026-09-24 |
| A-78 | `checkTenant` cannot see a multipart `tenantId` on any route where `upload()` runs after the gate | **high** | 0 | **DONE** 2026-09-24 |
| A-79 | tenant edit leaves the uploaded logo on a refused request, and deletes the old logo before commit | low | 0 | **DONE** 2026-09-24 |
| A-80 | the profile slug is `profile` in `ROLE_MENU_ASSIGNMENTS` and `profile-page` in the seed | medium | 0 | **DONE** 2026-09-24 |
| A-81 | `/auth/mfa/login` has no rate limit — the TOTP is brute-forceable inside the 5-minute MFA token | **high** | 0 | **DONE** 2026-09-24 |
| A-82 | impersonation creates a session with no audit row | **high** | 0 | **DONE** 2026-09-24 |
| A-83 | login does not check tenant status; `loginMfa` ignores `lockedUntil`; SSO exchange does not re-check user status at redemption | medium | 0 | **DONE** 2026-09-24 |
| A-84 | `POST /esignature/sign` has no `dynamicAccess` gate | medium | 0 | **DONE** 2026-09-24 |
| A-85 | a non-pending signature step and a `PUT` on a signed or revoked certificate answer 400 where the rule is 409 | low | 0 | **DONE** 2026-09-24 — three more are A-92 |
| A-86 | external (email-only) signers have no way to sign — a workflow naming one can never complete | medium | 0 | **DONE** — refused at creation since A-130 (ADR-051); verified by `eSignature.a129a130.test.js` |
| A-87 | **the global tenant hooks never filter an include** — every include of a tenant-scoped model can reach other tenants' rows; and an include of a `defaultScope`d model is an INNER JOIN even without a `where` | **critical** | 0 | **DONE** 2026-09-24 (mechanism, ADR-048) — implicit-INNER call sites are A-90 |
| A-88 | several associations declare `foreignKey: "tenant_id"` (the column), adding a second, **nullable** `tenant_id` attribute with `ON DELETE SET NULL` on synced databases | **high** | 0 | **DONE** 2026-09-24 for tenant and regulated user FKs — 64 others are A-148 |
| A-89 | the QMS form sends `description` / `actionPlan` as optional; both are NOT NULL, so creation now gets a 400 (it used to be a 500) | low | 0 | **DONE** 2026-09-24 — QMS form requires description and action plan (`qms/__tests__/page.a89.test.tsx`) |
| A-90 | ~20 implicit-INNER includes (`defaultScope`) silently drop rows — and since A-87, also rows that reference a super-admin identity | **high** | 0 | **DONE** 2026-09-24 — sites in user/auth/certificate files are A-109 |
| A-91 | **most signers cannot reach the signing UI** — the page loads workflows through routes gated on `qms:read` | **high** | 0 | **DONE** 2026-09-24 |
| A-92 | more state conflicts answering 400 (workflow update and cancel, deleting a signed certificate) and in-tenant unique violations answering 500 (device serial on update, re-creating a soft-deleted serial) | medium | 0 | **DONE** 2026-09-24 |
| A-93 | `dynamicAccess` skips the owner check whenever a `tenantId` equal to the caller's own is present in the body or query | **high** | 0 | **DONE** 2026-09-24 |
| A-94 | `POST /ai/ocr` has no permission gate | medium | 0 | **DONE** 2026-09-24 |
| A-95 | `createTenant` and `deleteTenant` write no audit row; `deleteTenant` takes `deletedBy` from the body or query | **high** | 0 | **DONE** 2026-09-24 |
| A-96 | the tenant-logo and avatar routes: no audit row, old file deleted before the update, refused uploads left on disk | medium | 0 | **DONE** 2026-09-24 |
| A-97 | `POST /attachments` does not check `resourceId` against the tenant (a dangling in-tenant reference only) | low | 0 | **DONE** 2026-09-24 |
| A-98 | roles without `account` have no Change Password menu entry | low | 0 | **DONE** 2026-09-25 with A-131 — Change Password for every role |
| A-99 | **MFA does not work in production:** `otplib` 13 has no `authenticator` export, and a global jest mock that accepts any code hides it | **critical** | 0 | **DONE** 2026-09-24 — MFA setup verified in the deployed pkg binary |
| A-100 | `ssoExchange` counts failures per IP regardless of `AUTH_RATE_LIMIT_BY_IP` — a shared lockout of SSO until A-16 is deployed | **high** | 0 | **DONE** 2026-09-24 |
| A-101 | the `auth` middleware admits a user whose tenant was soft-deleted | medium | 0 | **DONE** 2026-09-24 |
| A-102 | on the VM, nginx sends `X-Forwarded-Proto: http` because Cloudflare terminates TLS; `req.secure` is wrong | low | 0 | **DONE** 2026-09-24 — `vm-http.conf` takes the scheme from `CF-Visitor` only when the peer is the tunnel gateway (ADR-050 rule), else `$scheme`; verified on real nginx 1.27.5 before/after. **Not yet deployed** — check on the VM |
| A-103 | `certificate.controller` sends every returned service result through `success()` — a returned 404 goes out with `success: true` | **high** | 0 | **DONE** 2026-09-24 for certificates — the same pattern in three other controllers is A-112 |
| A-104 | e-signature `updateWorkflow`, `cancelWorkflow` and `deleteWorkflow` write no audit row and use no transaction | **high** | 0 | **DONE** 2026-09-24 |
| A-105 | `eSignature.service#getWorkflow` swallows every error as `null`, so a database failure reads as a 404 | medium | 0 | **DONE** 2026-09-24 |
| A-106 | `GET /workflows` and `/history` wrap rows in `data.workflows` / `data.signatures`, breaking the envelope | low | 0 | **DONE** 2026-09-24 |
| A-107 | a revoked certificate can be deleted; `cancelWorkflow` and `revokeSignature` have handlers but no routes | medium | 0 | **DONE** 2026-09-25 — revoked delete 409 (A-130), `cancelWorkflow` routed (A-130), `revokeSignature` removed (ADR-055); `esignature.noRevocation.a107.test.js` |
| A-108 | **tenant backup was broken on every call** (an undefined `creator` association) | **critical** | 0 | **DONE** 2026-09-24, under A-90 |
| A-109 | more implicit INNER JOINs on Role: the user list drops users with no role, and they cannot finish MFA login or be impersonated; `certificate.service` stats `device` | medium | 0 | **DONE** 2026-09-24 |
| A-110 | `tenantHierarchy#getUserRolesAcrossTenants` uses aliases `"Role"` and `"Tenant"` where the associations are `role` and `tenant` — it always throws and returns `[]` | medium | 0 | **DONE** 2026-09-24 |
| A-111 | `GET /sessions` returns `{ sessions, meta }` inside `data`, breaking the envelope | low | 0 | **DONE** 2026-09-24 |
| A-112 | `calibrationDevices`, `calibrationRecords` and `tenant` controllers send non-2xx service results with `success: true` — switch to `sendResult` | **high** | 0 | **DONE** 2026-09-24 |
| A-113 | `GET /key-pairs` wraps rows as `data.keyPairs`; `deleteWorkflow` soft-deletes a completed (signed) workflow with no state check | medium | 0 | **DONE** 2026-09-24 |
| A-114 | `setupMfa` on an account that already has MFA **overwrites the live secret** with no re-authentication — a stolen session can replace the second factor | **high** | 0 | **DONE** 2026-09-24 |
| A-115 | no TOTP replay protection — a code can be reused within its ~90-second window | medium | 0 | **DONE** 2026-09-24 |
| A-116 | the global `uuid` mock also replaces Sequelize's internal uuid: every `UUIDV4` default is **one constant** in unit runs, and `UUIDV1` throws | medium | 0 | TODO |
| A-117 | `createAttachment` and `updateTenantSettings` write no audit row | medium | 0 | **DONE** 2026-09-24 |
| A-118 | the AI assistant page has no menu entry and now 403s for roles without `certificate` write / `sop` read; the attachment modal offers "General" with a record id, which now 400s | low | 0 | **DONE** 2026-09-24 — AI Assistant menu entry (migration 0038, PG18-checked); 403 shows a permission notice; the upload form hides the record id for General |
| A-119 | **workflow signing refused every real user**: `status !== "active"` against a stored `"ACTIVE"` — seven test files encoded the lowercase fixture | **critical** | 0 | **DONE** 2026-09-24 |
| A-120 | a backup restore re-creates a GDPR-erased person from the archive (F-1); ADR-051 Q-09: never re-create | **critical** | 0 | **DONE** 2026-09-24 |
| A-121 | audit rows are purgeable: the dead second engine (F-4), `setRetentionPolicy` accepts `audit_logs` (F-5), CASCADE on tenant delete; ADR-051 Q-10 and Q-12 | **critical** | 0 | **DONE** 2026-09-24 — FK half is A-122; REVOKE/trigger and partitioning later |
| A-122 | hard-deleting a user cascades to every calibration record they performed (F-6); ADR-051 Q-16 — the RESTRICT migration | **critical** | 0 | **DONE** 2026-09-24 — verified on PostgreSQL 18.6 |
| A-123 | an admin-chosen password is never forced to change, and a password signs (F-3); `is_email_verified` is dropped (F-2); ADR-051 Q-11 | **high** | 0 | **DONE** 2026-09-24 |
| A-124 | system actor columns on `audit_logs`; `logAction` requires a user or a system actor; ADR-051 Q-13 | medium | 0 | **DONE** 2026-09-24 — verified on PostgreSQL 18.6 |
| A-125 | PLATFORM tenant for platform operations (F-7); ADR-051 Q-14 | **high** | 0 | **DONE** 2026-09-24 — verified on PostgreSQL 18.6 |
| A-126 | `ACCOUNT_LOCKED` and `SIGNATURE_AUTH_FAILED` audit rows; password change audited (F-12); ADR-051 Q-15 and A-98 | medium | 0 | **DONE** 2026-09-24 — both ENUM values (migration `0049`, verified on PostgreSQL 18.6); a lockout is audited with the lock, a wrong signing credential in its own transaction |
| A-127 | operators may not author Part 11 records inside a tenant; impersonator on audit rows (F-8, in progress); ADR-051 Q-17 | **high** | 0 | **DONE** 2026-09-24 (ADR-052) — refresh-token carry-over done under A-146 |
| A-128 | a tenant admin's user-create conflicts are rate-limited and audited (the residual oracle); ADR-051 Q-18 | low | 0 | **DONE** 2026-09-24 — create and identity edit: global exact check, 409 (was 500), 10 per admin per hour, one audit row each |
| A-129 | signing restricted to technical roles; eligibility at creation; signer identity from the user record; meaning mandatory; `/history` exposure (F-9, F-10); ADR-051 Q-19 | **high** | 0 | **DONE** 2026-09-24 |
| A-130 | deletion refused for approved, signed and revoked certificates and signed workflows; verification reads deleted rows (F-11); cancel route; email-only signers refused; ADR-051 A-107 and A-86 | **high** | 0 | **DONE** 2026-09-24 |
| A-131 | change password for every user outside the matrix; the signing email links to a hard-coded `app.callibrator.io`; the completion email looks up a non-existent `role` column | medium | 0 | **DONE** 2026-09-25 — links and completion email fixed by A-158/A-170; Change Password always in the user menu; `UserDropdown.changePassword.a131.test.tsx` |
| A-132 | **production hides every thrown 4xx explanation**: `fileValidation.util.js#sanitizeError` replaces any thrown error's message with "An unexpected error occurred…", so today's 409 state explanations never reach a user | **high** | 0 | **DONE** 2026-09-24 |
| A-133 | calibration-device create, update, delete and bulk import write no audit row; a soft-deleted device cannot be restored (no route calls `restoreStatic`) | **high** | 0 | **PARTIAL** 2026-09-24 — audit rows done; device restore is a decision |
| A-134 | `tenantHierarchy#cascadeRoles` has never worked (an alias-less include and a `level` attribute that does not exist, the throw swallowed as "non-fatal"); `getUserRolesAcrossTenants` can return at most one row | medium | 0 | **DONE** 2026-09-24 — **decision: removed, not fixed**: roles are global (no `tenantId`, platform-unique `name`), so a child tenant already has every role; `HIERARCHY_CASCADE_ROLES` no longer read, `getStatus` drops `cascadeRoles`. One row is by design (a user has one tenant). Found: `createSubOrganization` itself fails on the real `Tenant` model (A-134 section) |
| A-135 | the frontend retention page uses keys the backend has never accepted and still offers an "Audit Logs" row; `maskPII("audit_logs")` has never worked (it looks up a model `Audit_log`) — and Q-12 relies on masking | **high** | 0 | **DONE** 2026-09-24 |
| A-136 | `GET /data-retention/:tenantId/policy` and `/legal-hold` have no permission gate | medium | 0 | **DONE** 2026-09-24 |
| A-137 | the `data_retention_policies` table and model serve only the removed engine — drop them through a migration that refuses if rows exist | low | 0 | **DONE** 2026-09-24 — migration `0047-drop-data-retention-policies` (refuses on any row, under lock, one transaction; `down` recreates the shape); model and barrel entries removed; verified on PostgreSQL 18.6 (upgrade, refusal, re-run, down, fresh build from 0001) |
| A-138 | **`GET /users` and `GET /users/:id` returned every user's TOTP secret**, email OTP, lockout counters and WebAuthn key — the exclusion list named columns, not attributes | **critical** | 0 | **DONE** 2026-09-24 |
| A-139 | **tenant backup archives contain second-factor secrets** (`mfaSecret`, `mfaPendingSecret`, `otpCode`, `webauthnPublicKey`) — only the password is excluded | **critical** | 0 | **DONE** 2026-09-24 |
| A-140 | the GDPR profile export always throws (`include: [Role]` with no alias) | **high** | 0 | **DONE** 2026-09-24 |
| A-141 | no endpoint to disable MFA and no recovery path — a lost authenticator locks the user out; replacing an authenticator does not sign out other sessions | **high** | 0 | **DONE** 2026-09-24 |
| A-142 | `/auth/mfa/setup` and `/auth/mfa/verify` are not rate-limited | medium | 0 | **DONE** 2026-09-24 |
| A-143 | `auth.middleware.js:237` compares `tenant.status === "ACTIVE"` against a lowercase enum, so the super admin's `x-tenant-id` override **never applies** (it fails closed) | medium | 0 | **DONE** 2026-09-24 — x-tenant-id override compares the lowercase status (`constants/tenantStatus.js`); `auth.tenantOverride.a143.test.js` — ADR-052 guard now live |
| A-144 | an `in_progress` workflow with some steps signed can be deleted, hiding those signatures | **high** | 0 | **DONE** 2026-09-24 |
| A-145 | writes outside Q-17's list left unguarded pending review: SOP publish and training acknowledge (arguably Part 11), workflow instance action, predictive-maintenance approve, certificate create/update/delete | medium | 0 | **DONE** 2026-09-24 — `denyPlatformAuthoring` on certificate create/update/delete, SOP publish/acknowledge, workflow action; predictive approve and e-sign cancel reviewed as not guarded; in-transaction audit rows; `partElevenAuthoring.a145.test.js`, `certificates.twoTenant.a145.test.js` |
| A-146 | a refreshed impersonation token would lose `impersonatorId` — the session row does not store the impersonator | low | 0 | **DONE** 2026-09-24 — `sessions.impersonator_id` (migration `0040`, verified on PostgreSQL 18.6); the claim, F-8 attribution and the A-127 refusal survive a refresh |
| A-147 | migration `0011` has a blanket `.catch(() => {})` on `dropTable`, and drops and recreates `e_signature_records` over what `sync()` built | medium | 0 | **DONE** 2026-09-24 — 0011 catch removed; refuses a table that holds rows (PG18-checked) |
| A-148 | 64 more duplicate attributes of the A-88 shape on FKs outside Q-16 (e.g. `calibration_records.device_id`, `certificates.calibration_record_id`) | medium | 0 | **DONE** 2026-09-24 — migration 0037: 66 reviewed FK decisions, one attribute per column; fresh = migrated catalog on PG18 (156 FKs); `associationForeignKeys.a148.test.js`. **Deploy:** 0037 refuses on NULLs in NOT NULL targets — run its orphan check first |
| A-149 | `signature_records.revoked_by` and `signature_workflow_steps.signer_id` have no foreign key at all | medium | 0 | **DONE** 2026-09-24 — `signature_records.revoked_by`, `signature_workflow_steps.signer_id` → users RESTRICT (0037) |
| A-150 | **`updateTenantSettings` copies decrypted secrets into `tenants.settings` in plaintext**, undoing KMS encryption at rest; APIs returning the tenant row probably expose them; `ai_api_key` is not on the encrypted-keys list | **critical** | 0 | **DONE** 2026-09-24 — `updateTenantSettings` no longer writes `tenants.settings`; one secret definition (`constants/tenantSecretSettings.js`); responses redact, only `sso.controller` asks `includeSecrets`; Redis settings cache dropped; nested `{settings}` body read; migration `0035` strips/encrypts (fake-DB tested — PG18 run pending); `tenant.settingsSecrets.a150.test.js` 10/13 and `tenantSettings.secrets.a150.test.js` 12/33 fail at baseline. **Ops:** rotate any secret that was ever in `tenants.settings`; flush `tenant:*`/`tenants:*` |
| A-151 | a GDPR subject export includes whole-tenant tables (stocks, calibration records, certificates, notifications) — other people's data; a 404 becomes a 500 | **high** | 0 | **DONE** 2026-09-24 — `exportSubjectRecords` filters by tenant + subject columns; a table read failure fails the export; missing subject 404 (`gdpr.subject.a151.a154.test.js`, 19/19 fail at baseline) |
| A-152 | `anonymizeDataset("users")` overwrites every text column (password, username, email) with no transaction or audit row, and the page still offers it | **high** | 0 | **DONE** 2026-09-24 — **decision:** `anonymizeDataset` refused for every entity (400 → `mask-pii`); UI button removed |
| A-153 | legal-hold enable/release and `setRetentionPolicy` write no audit row; `rectifyData` audits outside its transaction and writes the new value into the permanent trail | medium | 0 | **DONE** 2026-09-24 — legal hold, retention policy, rectification and erasure audited in-transaction; rectification records changed field names, never values |
| A-154 | `anonymizeUser` leaves avatar, sessions and second-factor secrets untouched | **high** | 0 | **DONE** 2026-09-24 — avatar reset, MFA/WebAuthn/OTP cleared, `isActive=false`, sessions revoked, all in one transaction with the audit row |
| A-155 | more ungated reads: `tenantLifecycle GET /:tenantId/status`, `featureFlags GET /:tenantId/:flagKey`, the `networkSecurity` GETs | **high** | 0 | **DONE** 2026-09-24 — lifecycle status, feature-flag (incl. list) and network-security GETs gated, cross-tenant 404 (`readGates.a155.test.js`, 47/58 fail at baseline) |
| A-156 | the backup screen does not show the restore's `notRestored` list | low | 0 | **DONE** 2026-09-24 — service keeps the restore outcome; the page lists each skipped account with its reason (`page.a156.test.tsx`, 2/3 fail at baseline) |
| A-157 | `deleteCertificate` reads the status outside its transaction with no lock — a concurrent approval can still be deleted | medium | 0 | **DONE** 2026-09-24 |
| A-158 | the signing-request email links a hard-coded `https://app.callibrator.io/sign/:id`, and the email-queue export it calls does not exist — **every signing email fails silently** | **high** | 0 | **DONE** 2026-09-24 |
| A-159 | nothing ever sets a workflow to `expired` or `in_progress`; `signDocument` repeats the pending check (dead code) | low | 0 | **DONE** 2026-09-24 |
| A-160 | there is no tenant "MFA required" policy — after an admin MFA reset nothing makes the user re-enrol | medium | 0 | **DONE** 2026-09-24 — tenant `mfa_required` / `mfa_required_min_role_level`; 403 `MFA_ENROLMENT_REQUIRED`; frontend redirect + policy panel. Owner questions: passkeys as MFA, SSO users |
| A-161 | `revokeAllSessions` does not pass `skipTenantScope`; for a principal with no tenant it may revoke nothing | medium | 0 | **DONE** 2026-09-24 — `revokeAllSessions` scoped by `user_id` only (`session.revokeAll.a161.test.js`, PG18-checked) |
| A-162 | no frontend screen for the admin MFA reset; no admin password-reset endpoint exists | low | 0 | **DONE** 2026-09-24 — `POST /users/:userId/password/reset` + UI for MFA/password reset (`user.passwordReset.a162.test.js`) |
| A-163 | accounts an admin created **before** A-123 are not flagged. **Decision (orchestrator, per standing instruction):** a migration flags existing accounts that have **never signed in** (`last_login_at IS NULL`) — they certainly still hold an admin-chosen password; accounts that have signed in are not flagged, since whether they changed it is unknowable | medium | 0 | **DONE** 2026-09-24 — migration 0036 flags never-signed-in admin-created accounts (PG18: 3 of 15 fixtures, re-run 0) |
| A-164 | a non-super-admin could be placed in, or create a user in, the PLATFORM tenant (`createUser` takes `tenantId` from the body when the actor has none; `tenantRefusal` does not refuse PLATFORM) | **high** | 0 | **DONE** 2026-09-24 — `tenantRefusal` refuses a PLATFORM home tenant; non-super-admins create users only in their own tenant (`user.create.tenant.a125.test.js`). **Also fixed:** admin-created users were stored with no role (`role_id` vs `roleId`) |
| A-165 | `admin.service#updateTenantStatus` / `updateTenantFlags` and global menu create/update/delete write no audit row; no frontend toggle for the platform audit scope | medium | 0 | **DONE** 2026-09-24 — in-transaction rows (PLATFORM + affected tenant for status/flags; PLATFORM for menus), secret-named flag keys masked, menu delete's grant revocation moved into the transaction; "My tenant / Platform" toggle; `admin.service.audit.a165.test.js` (20), `roles.menuAudit.a165.test.js` (14), audit `page.test.tsx` (4); 22/32 + 3/4 fail at baseline |
| A-166 | `customDomains.service` calls the same non-existent `emailQueueService.queueEmail` — custom-domain e-mails fail silently; its test mocks the invented export | **high** | 0 | **DONE** 2026-09-24 — custom-domain email through the real `queueNotificationEmail` |
| A-167 | `approveCertificate` reads the status without a lock — an approval can update a certificate a concurrent delete just removed | medium | 0 | **DONE** 2026-09-24 — certificate transitions read status under a row lock; 404/409 (`certificate.transitionLock.a167.test.js`) |
| A-168 | expired workflows can still be edited (even `expiresAt` extended) and cancelled. **Decision (orchestrator):** expiry is terminal for signing **and editing** — 409; cancelling an expired workflow stays allowed so it can be closed with an audit row; a new workflow is the way to re-request | medium | 0 | **DONE** 2026-09-24 — expired workflow edits 409; cancel allowed and audited |
| A-169 | the "To sign" list still shows steps of workflows past `expiresAt` that are not yet marked expired | low | 0 | **DONE** 2026-09-24 — expired workflows left out of the To-sign list; `expired` flag |
| A-170 | a workflow records no requester, so the completion e-mail cannot reach its creator (`requestedBy` column + migration) | medium | 0 | **DONE** 2026-09-24 — `requestedBy` + migration 0039 with audit backfill. **Boot fix (orchestrator):** the model no longer declares the index — sync() ran before 0039 and failed on existing databases |
| A-171 | `FRONTEND_URL` is missing from both env templates — in local dev e-mail links point at the backend | low | 0 | **DONE** 2026-09-24 — `FRONTEND_URL` in both env templates |
| A-172 | `sendNotificationEmail` hard-codes the footer "Calibration Management System" instead of the tenant brand | low | 0 | **DONE** 2026-09-24 — email footer uses `APP_NAME` |
| A-173 | the second global-menu write path — `menuGroup.service` create/update/delete (`/menu-groups`, SUPERADMIN) — writes no audit row and no transaction; `deleteMenuGroup` removes grants and child menus in separate autocommits (found by A-165) | medium | 0 | **DONE** 2026-09-24 — create/update/delete take `auditActor(req)`, run in one `db.transaction` and write one PLATFORM row (`resourceType: MenuGroup`, the A-165 operation names); delete revokes the grants of the group AND its children and removes the children inside that transaction, recording `revokedGrants` and `deletedChildren`; `permissions:role:*` cleared after commit (create only for a child, as A-165). `menuGroup.audit.a173.test.js` (17), `menuGroup.controller.test.js` "A-173 — the request's actor reaches the audit row" (1); `menuGroup.service.test.js` / `menuGroup.controller.test.js` updated for the transaction argument; 13/17 fail at baseline (the 4 that pass are the negative rollback/404 cases). Open: deleting a group still re-parents its grandchildren to top level (FK `SET NULL`), and assign/revoke/bulk grant writes on this path remain unaudited |
| A-174 | `updateTenantFlags` merges any key into `tenants.settings`, including secret-named keys — a super admin can re-plant the plaintext secrets A-150 moves out; `PATCH /admin/tenants/:id/flags` has no validator (a string is spread key by key) | medium | 0 | **DONE** 2026-09-24 — `validators/admin.validator.js#updateTenantFlagsSchema` on the route via `validate(schema)`; the service refuses too (`flagsToMerge`): `flags` must be a plain object of ≤50 identifier-shaped keys with scalar values (bool, finite number, null, string ≤1000), never an `isRedactedSettingKey` key → 400 naming it; A-165 audit rows unchanged (mask kept as defence in depth). `admin.flags.a174.test.js` 24/25 and `admin.service.flags.a174.test.js` 8/11 fail at baseline |
| A-175 | admin status/flag changes never invalidate `cacheKeys.tenant(id)` — tenant reads show the old status for up to 600 s (sign-in enforcement reads the DB and is unaffected) | low | 0 | **DONE** 2026-09-24 — after the commit both functions clear `tenant:<id>`, `tenant:code:<code>`, `tenant:branding:<id>` and `tenants:*` (`tenantSettings` is the separate TenantSettings table, not this row, so it is left alone); a rolled-back or 404 change touches no cache. `admin.service.cache.a175.test.js` (5); 2/5 fail at baseline (the 3 that pass are the negative rollback/404 cases) |
| A-176 | `PATCH /tenants/settings` accepts **any key** — Management write can set `legal_hold_enabled`, `retention_policy_*` (below the minimum), `lifecycle_status`, `feature_flag_*`, `ip_allowlist`, `geofence`, `oidc_rp_*`, `storage_*`, bypassing super-admin-only controls (found by A-150) | **high** | 0 | **DONE** 2026-09-24 — allow-list `constants/tenantAdminSettings.js` (15 keys: the SSO form's six `sso_*`, `oidc_client_id/_secret/_redirect_uri/_authority`, `mfa_required`, `mfa_required_min_role_level` (A-160 panel), `ai_vendor/_base_url/_api_key`), derived from every frontend writer and backend reader; `updateTenantSettings` refuses any other key, or a non-scalar value, with a 400 naming it before opening a transaction — no partial save. Gated keys stay writable only through their own endpoints. `tenantSettings.allowList.a176.test.js` (real route) 22/23 fail at baseline (+3 MFA-panel acceptance tests). **Open:** `ai_base_url` / `oidc_authority` are tenant-chosen URLs the server calls (SSRF surface, pre-existing) |
| A-177 | `tenantSettings` encryption hook runs only on instance saves — a static `upsert`/`Model.update` of a secret key stores plaintext (latent) | medium | 0 | **DONE** 2026-09-24 — model hooks: `beforeValidate` encrypts the `upsert` instance (Sequelize snapshots values before `beforeUpsert`), `beforeUpsert` refuses plaintext left by `validate:false`, `beforeBulkCreate` per row, `beforeBulkUpdate` encrypts `attributes.value` under the one `where.tenantId` for secret keys and refuses an ambiguous statement; a secret with no tenant id is refused. `tenantSettings.bulkPaths.a177.test.js` (real Sequelize statics, QueryInterface spied) 15 fail at baseline; also verified on PostgreSQL 18 (upsert/bulkCreate/update stored `v1:` envelopes that read back). Only `hooks:false` bypasses, as for tenant scoping |
| A-178 | `sso_idp_cert` is a public certificate classified as secret — the SSO form shows `[REDACTED]` | low | 0 | **DONE** 2026-09-24 — `sso_idp_cert` removed from `SECRET_SETTING_KEYS` (not matched by the name pattern), so it is stored, copied and returned as given; `LEGACY_ENCRYPTED_SETTING_KEYS` lets the model still decrypt a pre-A-178 envelope. Migration `0035` (unshipped) now keeps it in `tenants.settings` and leaves it plaintext; its header query updated. **0035 run on PostgreSQL 18.6** (`pgvector/pgvector:pg18`, schema via `db.sync()` + the project migrator 0001→0034, then 0035 through the migrator): secrets gone from `tenants.settings`, plaintext secrets enveloped under their own tenant, non-secret keys and an existing envelope untouched, second run byte-identical (md5 of both tables) |
| A-179 | `tenantLifecycle.exportTenantData` returns decrypted settings and full `User.toJSON()` rows (password/MFA fields unchecked); `POST /network-security/evaluate-login` has no permission gate | **high** | 0 | **DONE** 2026-09-24 — (a) the export leaked every account's `password`, `mfaSecret`/`mfaPendingSecret`, `mfaRecoveryCodes`, `webauthnCredentialId`/`PublicKey`, `otpCode` and lockout state, the DECRYPTED `tenant_settings` secrets, and `tenants.settings` credential keys — on `GET /:tenantId/export` and in every offboarding response. Users are now read through an explicit allow-list (`EXPORTED_USER_ATTRIBUTES`: SELECT + projection); a `tenant_settings` row whose key `isRedactedSettingKey` keeps its key with value `[REDACTED]`; redacted keys are dropped from `tenant.settings` (`tenantLifecycle.export.a179.test.js`, real models, every real `User` attribute populated; 7/8 fail at baseline). (b) `evaluate-login` is not a login-time call (no sign-in path calls it; it needs a token) — it is the network-security screen's dry run and discloses the policy, so it takes the A-155 gate `network-security: read` + `checkTenant` (`networkSecurity.evaluateLogin.a179.test.js`, 11/12 fail at baseline); `assertStaticAuthorizationWiring()` passes |
| A-180 | GDPR gaps: Art. 15 export omits consent history, DSARs and sessions; `maskPII("users")` leaves username/avatar; `erased` status not in auth's refused list; rectifying `email` unverified and a duplicate gives 500 | medium | 0 | **DONE** 2026-09-24 — Art. 15 export writes `privacy_records.json`: consent history, DSARs and sessions (unscoped, soft-deleted included), each filtered by tenant AND subject; sessions via an allow-list (no `token_hash`), an impersonated session withholds the impersonator's IP/agent/device/id; a failed read fails the export. `maskPII("users")` also masks `username` (`redacted_<id>`) and `avatarUrl` (placeholder; file deleted after commit). `erased` added to `REFUSED_STATUSES` (login/MFA) and to the auth.middleware/socket status checks; a refresh now refuses what a sign-in refuses (it checked no status at all) and revokes the presented session. Rectifying `email`: Joi-validated + lower-cased (400), taken address (case-insensitive, platform-wide, soft-deleted included) or a unique-index race → 409 with a state message; a changed address sets `isEmailVerified=false`, and after commit an activation link (`queueActivationEmail`, FRONTEND_URL/HOST_URL origin) goes to the new address and a notice (`queueNotificationEmail`) to the old. Tests: `gdpr.a180.test.js` (19/22 fail at baseline), `auth.erasedStatus.a180.test.js` (5/6 fail), `dataRetention.service.test.js` maskPII A-180 cases, `auth.test.js`/`socket.test.js` `erased` cases. No migration |
| A-181 | `menuGroup.service` grant writes — assign, revoke, bulk-assign, bulk-revoke — write no audit row (found by A-173); deleting a group moves its grandchildren to the top level (`SET NULL`) | medium | 0 | **DONE** 2026-09-25 — grant writes audited, all-or-nothing, cache cleared; delete with children 409 (ADR-056); `menuGroup.grants.a181.test.js` |
| A-182 | a Certificate workflow's final approval (`POST /workflows/instances/:id/action`) sets APPROVED **without the re-authentication** A-62 requires; a rejection resets a certificate to DRAFT from any state (found by A-145) | **high** | 0 | **DONE** 2026-09-25 — re-auth on every Certificate approval, state-machine final approval, 409 rejections (ADR-055); `workflows.decision.a182a183.test.js` |
| A-183 | `POST /workflows/instances/:instanceId/action` and `GET /instances/pending` have no `dynamicAccess`; `submitAction` reads "already acted" and the approval count outside the transaction, unlocked (double-count race) | **high** | 0 | **DONE** 2026-09-25 — gated, instance locked FOR UPDATE, double-count refused 409; `workflows.decision.a182a183.test.js` |
| A-184 | `signDocument` reads the workflow before its transaction without a lock — the e-signature form of A-167 | medium | 0 | **DONE** 2026-09-25 — workflow then step locked inside the signing transaction; `esignature.signLock.a184.test.js` |
| A-185 | login answers 423 only for a real, locked account and 401 for an unknown one — an existence oracle that also lets anyone lock an owner out (found by A-126) | **high** | 0 | **DONE** 2026-09-25 — throttle per identifier+address, never an anonymous lock, one 401 for every failure (ADR-059); `auth.loginOracle.a185.test.js` |
| A-186 | `emailQueue.service` logs recipient addresses (info and error); the custom-domain email goes to the tenant's oldest user; `addDomain`/`verifyDomain` write no audit rows | medium | 0 | **DONE** 2026-09-25 — addresses redacted; domain email to requester + tenant admins; domain writes audited; `emailQueue.redaction.a186.test.js`, `customDomains.audit.a186.test.js` |
| A-187 | `tenantHierarchy#createSubOrganization` always fails on the real models (NOT NULL `subdomain`/`email` unset → 500); no transaction, no audit row | medium | 0 | **DONE** 2026-09-25 — sub-org created in one transaction with audit row; 409s before writes; `tenantHierarchy.createSub.a187.test.js`, `tenantHierarchy.children.a187.test.js` |
| A-188 | OIDC: no discovery — Entra ID's JWKS path and tenant-specific issuer unsupported; a public client sends `client_secret=undefined`; callback refusals render JSON instead of `/login?error=`; SSO sign-in never sets `last_login_at` | medium | 0 | **DONE** 2026-09-25 — discovery, public clients, `/login?error=` redirects, `last_login_at` (ADR-059); `oidcJwks.discovery.a188.test.js`, `sso.callbackRefusal.a188.test.js` |
| A-189 | the Next catch-all drops `Host`, so `baseUrlOf(req)` builds `https://backend:3000/...` for certificate QR links unless `CERT_VERIFY_BASE_URL`/`PUBLIC_BASE_URL` is set | medium | 0 | **DONE** 2026-09-25 — configured origin, forwarded headers only through the trusted hop (ADR-056); `publicBaseUrl.a189.test.js`, `route.origin.a189.test.ts` |
| A-190 | `maintenance.service` writes work orders with no transaction and no audit row; `POST /predictive-maintenance/analyze/:deviceId` mutates unaudited; `createCertificate` starts its workflow after commit (a failure leaves a certificate without one) | medium | 0 | **DONE** 2026-09-25 — work orders and analyze audited in transactions; certificate workflow starts inside its transaction; `maintenance.audit.a190.test.js`, `certificate.audit.a41.test.js` |
| A-191 | an unused activation link verifies a later rectified email (token not bound to the address); login never checks `isEmailVerified` (owner decision) | low | 0 | **DONE** 2026-09-25 — activation token bound to the address; login verification not enforced (ADR-059, ADR-051 Q-11); `auth.activationBinding.a191.test.js` |
| A-200 | the workflow's final approval wrote `APPROVED`/`DRAFT` (not in the certificate ENUM) and `approvedById`/`approvedAt` (not attributes) — a workflow-approved certificate recorded no approver (found by A-182) | high | 0 | **DONE** 2026-09-25 with A-182 |
| A-201 | a final StockTransfer workflow decision writes `Approved`/`Rejected`, not values of its ENUM — every such decision would 500 on PostgreSQL; a MaintenanceWorkOrder rejection changes nothing | medium–high | 0 | TODO — needs the status mapping decided |
| A-202 | `stock.service#createTransfer` starts its workflow after commit, fail-soft — the A-190 shape for transfers | medium | 1 | TODO |
| A-203 | a certificate with a PENDING workflow instance can be approved directly via `POST /certificates/:id/approve`, bypassing the chain | medium | 0 | TODO — owner: is the workflow mandatory? |
| A-204 | workflow definition writes were unaudited; replacing steps cascaded into `workflow_actions` and erased approval history; deleting a workflow with pending instances broke the inbox | high | 0 | **DONE** 2026-09-25 (ADR-055) — `workflow.service.test.js` › A-204 |
| A-210 | a tenant admin controls its own IdP and could assert the super admin's email through SSO to get a platform session | high | 0 | **DONE** 2026-09-25 — operators refused SSO (ADR-059) |
| A-211 | `loginUser` sets `lastLoginAt` at the password step, before MFA completes | low | 2 | TODO |
| A-212 | E2E expected 404/500 for an invalid activation token; the backend answers 400 | low | 2 | **DONE** 2026-09-25 |
| A-213 | WebAuthn disable has no re-authentication and no audit row | medium | 0 | TODO |
| A-214 | GDPR email rectification needs no re-authentication — stolen session → rectify → reset → takeover | medium | 0 | TODO |
| A-215 | temporary passwords from admin create or reset never expire | low | 1 | TODO |
| A-216 | JIT-SSO users cannot use Change Password; "point SSO users to the IdP" is not implemented | low | 1 | TODO |
| A-220 | work orders accepted another tenant's `deviceId`/`vendorId`/`assigneeId` | medium | 0 | **DONE** 2026-09-25 — 404; `maintenance.audit.a190.test.js` |
| A-221 | menu grant/revoke never cleared `permissions:role:<id>` — a revoked menu stayed usable for the cache TTL | medium | 0 | **DONE** 2026-09-25 with A-181 |
| A-222 | the email queue's failure line logged the whole job, including the activation link and token | medium–high | 0 | **DONE** 2026-09-25 with A-186 |
| A-223 | a removed custom domain keeps its globally unique `domain`; re-adding it is a 500 | low | 1 | TODO |
| A-224 | `updateTenantParent`/`removeTenantParent`: no transaction, no audit row, no cycle check, descendants' paths not updated, "already root" is 404 not 409 | medium | 0 | TODO |
| A-225 | `PATCH /billing/subscription` sets `status`/`planId` directly, bypassing payment, unaudited (SUPERADMIN-only) | medium | 0 | TODO |
| A-226 | `updateMenuGroup` accepts any `parentId`, including itself or a descendant — a menu cycle | low | 1 | TODO |
| A-227 | `CLAUDE.md` called `maintenance_work_orders` latent for the `required: false` trap; it is not | doc | — | **DONE** 2026-09-25 — corrected; pinned by `maintenance.includes.a190.test.js` |
| A-228 | the log redaction format has no rule for email addresses or `*Link` keys | low | 2 | TODO |
| A-230 | the verification page's certificate `<iframe>` could never render: `frame-ancestors 'none'` globally | medium | 0 | **DONE** 2026-09-25 (ADR-057) — not browser-verified |
| A-231 | the tenant edit-logo preview URL missed the `tenant/` folder | low | 2 | **DONE** 2026-09-25 |
| A-232 | any user with `equipment:read` could publish arbitrary files at a permanent public URL via `POST /attachments` with `resourceType:"post"` | medium | 0 | **DONE** 2026-09-25 — CMS media needs `content:create`, audited; `content.media.s01.test.js` |
| A-250 | SCIM accepted any API key whatever its scopes — a `stock:read` key could provision users | high | 0 | **DONE** 2026-09-25 (ADR-058) — `scim.route.test.js` › A-250 |
| A-251 | `POST /notifications/test {scope:"tenant"}` let any role broadcast "SYSTEM" notices to the tenant | medium | 0 | **DONE** 2026-09-25 — `readGates.p604.test.js` |
| A-252 | `GET /gdpr/erasure/:id` returned any member's erasure request; 200 null for an unknown id | medium | 0 | **DONE** 2026-09-25 — `gdpr.erasureStatus.a252.test.js` |
| A-253 | `index.js` serves `/error`, `/documentation`, `/standards`, `/tab-permissions` unauthenticated in production | low | 1 | TODO |
| A-254 | the `dynamicAccess` error path logged `JSON.stringify(req.user)` — password hash, MFA secret, recovery codes — inside the message, beyond key redaction | high | 0 | **DONE** 2026-09-25 — `dynamicAccess.test.js` › A-254 |
| A-255 | seven `tenantHierarchy.controller` handlers unrouted, including `assignRoleAcrossHierarchy` | low | 2 | TODO |
| A-256 | `resolveTenantByDomain` / `provisionTLSCertificate` have no callers — custom domains never resolve | medium | 1 | TODO |
| A-257 | backend jest cannot load ESM-only dependencies under Node 22; the project targets Node 24 | tooling | 2 | known — pin Node 24 |
| A-258 | `username-check` uses `Op.like` on raw input, tenant-scoped against a globally unique column | low | 1 | TODO |
| A-67 | the rate limiter's failure recording on login, register, OTP and reset **never runs** — it is mounted before the handler | **high** | 0 | **DONE** 2026-09-24 — `AUTH_RATE_LIMIT_BY_IP=true` enabled on the VM after A-16 was verified |
| A-68 | OIDC has no `state`, `nonce` or PKCE check — login CSRF and code injection. Now: one-time `state` bound to the browser by an httpOnly cookie, `nonce` checked in the ID token, PKCE S256; also the GET callback route and the SSO-start `validate()` 500 | **high** | 0 | **DONE** 2026-09-24 |
| A-69 | SSO through the Next `/api` proxy cannot work: the proxy follows the backend's 302 server-side. Now: `redirect: "manual"`, and the OIDC binding cookie is carried both ways. Not yet seen with a live IdP | **high** | 0 | **DONE** 2026-09-24 |
| A-70 | SSO provisioning signs in a suspended or inactive user (a session and a LOGIN row are created) | medium | 0 | **DONE** 2026-09-24 |
| A-71 | the login response returns the access token to browser JavaScript, beside the httpOnly cookie | medium | 0 | **DONE** 2026-09-25 — the Next proxy strips `token`/`refreshToken` before the browser (ADR-059); `route.tokenStrip.a71.test.ts` |
| A-72 | password and MFA login write no `LOGIN` audit row | medium | 0 | **DONE** 2026-09-24 |

---

## Wave 0 — Security

### A-01 — Cross-tenant write on `tenant-hierarchy`

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **critical** |
| **Evidence** | `backend/src/routes/api/tenantHierarchy.route.js`: `router.post("/:parentId/children", auth, addChildTenant)`, `router.put("/:tenantId/parent", auth, …)`, `router.delete("/:tenantId/parent", auth, …)` — no role, scope or ownership gate. `tenantHierarchy.controller.js#updateTenantParent` calls `Tenant.findByPk(tenantId)` and `Tenant.update({ parentId }, { where: { id: tenantId } })`. The `Tenant` model has no `tenantId` attribute, so the global scoping hooks **do not apply to it**. |
| **Spec refs** | `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` · `docs/MULTI-TENANCY/08-CROSS-TENANT-PROTECTION.md` · `roleConstants.js` `ROLE_MENU_ASSIGNMENTS` (tenant-hierarchy: **write = SUPERADMIN only**) |
| **Spec required** | no — the intended access is already encoded in the menu matrix |

**Why:** any authenticated user of any tenant — or any API key, whatever its scope — can create a sub-organisation under another tenant, and re-parent or detach another tenant. The menu matrix says only `SUPERADMIN` may write here; the backend enforces nothing. It is hidden in the UI, which is not a control.

**Definition of Done**
- [ ] every mutating `tenant-hierarchy` route is `superAdminOnly` and `denyApiKey`
- [ ] read routes return only the caller's own subtree unless the caller is `SUPERADMIN`; another tenant's id returns **404**, not 403
- [ ] tests: a `USER` in tenant A attempting each mutation on tenant B gets 403/404 **and nothing changes in the database**; an API key gets 403; `SUPERADMIN` succeeds
- [ ] the same audit applied to every other route that loads `Tenant` by a path id — the unscoped model is the root cause, and it may not be the only instance

**Abuse cases**
- Hiding the menu harder instead of gating the route
- Testing only that the response is an error, not that the row is unchanged

---

**What was changed (2026-09-23)** — `routes/api/tenantHierarchy.route.js`

| Route | Gate |
|---|---|
| `GET /:tenantId/children`, `/parent`, `/descendants`, `/ancestors` | `ownTenantGuard` — the id must be the caller's own tenant, or the caller is SUPERADMIN. A cross-tenant id is **404**, not 403 |
| `POST /:parentId/children`, `PUT` and `DELETE /:tenantId/parent`, `GET /cross-tenant-roles` | `[auth, denyApiKey, superAdminOnly]` — re-parenting a tenant is a platform operation, and `cross-tenant-roles` reads role assignments for an arbitrary user id |

The handlers themselves are unchanged: they call `Tenant.findByPk` / `Tenant.update`, which the
global hooks do not scope because the `Tenant` model has no `tenantId` attribute. The gate is what
constrains them.

**Verification** — `npx jest src/tests/routes/tenantHierarchy` → 23 tests, including
`tenantHierarchy.guards.test.js` "answers 404 for another tenant" (one per read route) and
"requires auth, denies API keys and requires SUPERADMIN" (one per mutation). Still open: a live
two-tenant reproduction against a running server.

---

### A-02 — Tenant configuration guarded only by `auth`

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high** |
| **Evidence** | `webhooks.route.js` (7 routes: `auth` + `requireFeature("webhooks")`); `storage.route.js` (`PUT/DELETE /settings`, `POST /settings/test`: `auth` only); `customDomains.route.js` (7 routes: `auth` only). Their controllers contain no role or API-key check. |
| **Spec refs** | `docs/SECURITY/04-AUTHORIZATION-RBAC.md` · `docs/WEBHOOK/03-WEBHOOK-SECURITY.md` · `docs/STORAGE/04-TENANT-STORAGE.md` |
| **Spec required** | **yes** — `MEMORY/specs/A-02-tenant-config-access.md`: who may configure webhooks, storage and domains. The menu matrix gives `custom-domains` write to `SUPERADMIN` only; webhooks and storage have no menu slug at all |

**Why:** the lowest-privilege account in a tenant can:
- point the **tenant's object storage at a bucket it controls**, so every later upload lands with the attacker;
- register a webhook that ships device events to an address it chose;
- add, remove or change the default custom domain.

**Definition of Done**
- [ ] the access decision recorded in the spec, then enforced at the route (`rbac` or `dynamicAccess`) **and** `denyApiKey` on storage settings
- [ ] webhooks and storage get menu slugs so the matrix can express them
- [ ] negative tests per route: a `USER` gets 403 and the configuration is unchanged

**Abuse cases**
- Gating the GET routes and forgetting `POST /settings/test`, which makes the server connect to a caller-supplied endpoint

---

**What was changed (2026-09-23)**

| Router | Gate |
|---|---|
| `webhooks.route.js` (7 routes) | `[auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])]` — a webhook decides where the tenant's events are POSTed and its secret signs them |
| `storage.route.js` `/settings*` (4 routes) | `[auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])]` — these hold the tenant's object-storage credentials. `GET /object` is deliberately left out: it is the read path for stored files |
| `customDomains.route.js` (7 routes) | `dynamicAccess(MENU_SLUGS.CUSTOM_DOMAINS, read\|write)`, plus `denyApiKey` on writes. The slug already exists with WRITE for the admin roles and READ below them |

**Verification** — `npx jest src/tests/routes/routeGuards.a02` → 21 tests, one per route, plus
"leaves no route on auth alone" for the webhook and custom-domain routers.

---

### A-03 — API keys ignore their scopes on ungated routes

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high** |
| **Evidence** | `auth.middleware.js#tryApiKeyAuth` admits the key; scopes are enforced **only** in `dynamicAccess` (`checkApiKeyScope`). 16 of 53 route files use `dynamicAccess`; 31 use neither it nor `rbac`; only 4 (`apiKeys`, `eSignature`, `qms`, `supplierScorecard`) use `denyApiKey`. A key scoped `warehouse:read` therefore reaches every route in those 31 files. Header verified to traverse Cloudflare → nginx → Next.js → backend (an invalid key returns `Invalid or expired API key`). |
| **Spec refs** | `docs/DEVELOPER/02-AUTHENTICATION.md` · `docs/API/13-INTEGRATION-API.md` |
| **Spec required** | no |

**Why:** a scope that is only checked on some routes is not a scope.

**Definition of Done**
- [ ] **default-deny for API keys**: `auth` rejects an API-key principal on any route that does not declare a scope, via an explicit `apiKeyScope(resource, action)` or `dynamicAccess`
- [ ] every route that should be reachable by keys declares its scope; the list is in `docs/DEVELOPER/02-AUTHENTICATION.md`
- [ ] a test enumerates the router stack and fails if a route accepts an API key without a declared scope

**Abuse cases**
- Adding `denyApiKey` to the routes someone happened to think of

---

**What was changed (2026-09-23)** — authorization for API keys is now deny-by-default.

| Piece | File |
|---|---|
| a gate that has read the key's scopes and allowed it sets `req.apiKeyAuthorized` | `middlewares/dynamicAccess.middleware.js` |
| `allowApiKey` — the explicit opt-in for endpoints meant for service accounts | `middlewares/auth.middleware.js` |
| SCIM opts in inside `requireApiKeyOrAdmin` (it authorizes the key itself rather than by scope) | `routes/api/scim.route.js` |
| the chokepoint: an API-key principal that reaches a wrapped controller without that flag gets **403** | `utils/controllerWrapper.util.js` (`asyncHandler`, `asyncHandlerWithMapping`) |

**Why the controller wrapper.** Express has no hook that runs after the middleware chain but
before the handler, and the gate is not always in the route's own stack (several routers apply
`auth` with `router.use`). Every controller but two is wrapped, so the wrapper is the one place
that sees every request after every gate has run.

**Residual risk — named, not hidden:** `iot.controller.js` and `predictiveMaintenance.controller.js`
do not use the wrapper. IoT ingest authenticates by device token, not API key; predictive
maintenance is behind `dynamicAccess`, which sets the flag. Any new controller written without the
wrapper is outside this guard — folded into A-07's sweep.

**Verification** — `npx jest src/tests/utils/controllerWrapper.apiKey` → 7 tests
("refuses an API key that no gate authorized", "runs the controller when a gate authorized the
key", plus the ordinary-user, unauthenticated and no-request cases) and
`src/tests/middlewares/auth.test.js` § "allowApiKey (A-03)".

---

### A-04 — `/search` bypasses read permissions

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium |
| **Evidence** | `search.route.js`: `router.get("/", auth, searchController.search)`. `search.service.js` returns devices, stock and certificates for the tenant with no permission filter. |
| **Spec refs** | `docs/SEARCH/01-GLOBAL-SEARCH.md` |

**Why:** a role with no `warehouse` or `certificate` read permission can list stock and certificates through search. Tenant isolation holds (the raw SQL carries `tenant_id` explicitly); authorisation inside the tenant does not.

**Definition of Done**
- [ ] each result type is included only if the caller holds `read` on its menu slug (`equipment`, `warehouse`, `certificate`)
- [ ] API keys limited to their scopes the same way
- [ ] tests per role

---

**What was changed (2026-09-23)**

| Piece | File |
|---|---|
| the route is gated: `dynamicAccess(SEARCH_MENUS, "read")` over `["calibration", "warehouse", "certificate"]` — OR-logic, so a caller with read on any searchable menu gets in and one with none gets 403 | `routes/api/search.route.js` |
| each type is filtered by **running the same gate its own list route runs**, rather than a second copy of the permission rules; a denied type is dropped from the result, not turned into a 403 for the whole search | `controllers/search.controller.js` |
| each type config carries the menu slug its list route gates on, so search can never surface a row that resource's own endpoint would refuse | `services/search.service.js` |

Also closed a footgun in the same file: `types: []` used to mean **every type**. With a permission-filtered list now passed in, an empty allow-list would have handed a principal permitted nothing the entire tenant. An explicit list is honoured as given; only an absent list means "all".

**Verification** — `npx jest src/tests/services/search src/tests/controllers/search src/tests/routes/search` → 5 suites, 39 tests. The new suite `controllers/search.permissions.a04.test.js` runs the REAL controller, service, `dynamicAccess` and `scopeAllows`, mocking only `db.query` and the permission stores, and asserts which tables were queried: "gives a warehouse-only role stock rows and no devices or certificates", "honours a per-user 'none' override that revokes a menu the role grants", "a `warehouse:read` key sees stock only".

**Behaviour change to know about:** a principal with none of the three menus (a plain `USER`) now gets **403** where it used to get a list. `GlobalSearch.tsx` will render that as an error rather than "no results"; the frontend was not changed.

**Residual:** not verified live. The claim that `equipment:read` inherits to `calibration` and `certificate` is read from `seedMenuGroups.util.js`, not confirmed against `menu_groups` in psql.

---

### A-05 — Socket.IO hardening

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium |
| **Evidence** | `src/config/socket.js`: `cors: { origin: "*" }` with the comment "Adjust for production"; token read from `handshake.auth.token` **or** `handshake.query.token`; the middleware checks only that the user exists — not account status, tenant suspension, or session revocation. |
| **Spec refs** | `docs/ARCHITECTURE/10-REALTIME-ARCHITECTURE.md` · `docs/MULTI-TENANCY/06-REALTIME-ISOLATION.md` |

**Definition of Done**
- [ ] CORS origin from `CORS_ORIGIN`, as on the HTTP layer
- [ ] query-string tokens rejected — they land in proxy access logs
- [ ] handshake rejects inactive users, suspended tenants and revoked sessions, matching `auth.middleware.js`
- [ ] tests for each rejection

---

**What was changed (2026-09-23)** — `config/socket.js`

| Before | After |
|---|---|
| `origin: "*"` | the same `CORS_ORIGIN` allow-list the HTTP layer uses (`index.js`), plus `credentials: true` — which is precisely why the wildcard could not stay |
| token from `handshake.query.token` | `handshake.auth.token` only. A query-string token is now an explicit rejection with its own server-side log line, so the failure is diagnosable without the token ever being parsed |
| `User.findByPk` with an ad-hoc include | `authService.getAuthUserWithTenant`, the loader the HTTP `auth` middleware uses — MFA-pending tokens, inactive or deleted users and suspended or deleted tenants are all refused, as they are over HTTP |
| rejection said "User not found" / "Token missing" | one constant `Authentication error`; the reason goes to the server log |

It also closed a real isolation gap the card did not name: `kanban:join` → `kanban.assertAccess` ran with **no AsyncLocalStorage context**, which `tenantScope.util.js` resolves to `mode: "skip"` — no tenant predicate at all. Socket handlers now run inside `tenantStorage.run(...)` with the same context shape `tenantContext.middleware` builds.

**Verification** — `npx jest src/tests/config/socket.test.js` → 39 tests, including "rejects a valid token whose tenant is suspended" (×4 spellings, asserting `socket.user` is never set), "rejects a token supplied in the query string" (asserting `verifyAccessToken` is never called), "rejects an origin outside the allow-list in production", and "joins a kanban board room inside the tenant context after an access check" (asserting the CLS store seen *inside* `assertAccess`). Regression: 7 suites, 315 tests.

**No frontend change was needed** — `frontend/src/lib/socket.ts` already connects with `auth: { token }`.

**Residual risk**
- `src/config/` is in `coveragePathIgnorePatterns`, so `socket.js` does **not** count toward the 100 % gate. Its 100 % figure comes from an explicit override run (see A-32).
- The checks are **connect-time only**. A tenant suspended after the handshake keeps its live socket until it disconnects.
- Session revocation is still not checked — over HTTP either (`auth.middleware.js` says so explicitly). Making sockets stricter than HTTP is a decision the owner has not made: Open Question, not a judgement call.
- Outside production any origin is still allowed, deliberately mirroring the HTTP layer.

---

### A-06 — `/health` information disclosure

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | low |
| **Evidence** | `backend/index.js` `GET /health` returns `node: process.version`, `pid`, `memory`, `uptime` — routed publicly by nginx. |

**Definition of Done**
- [ ] public `/health` returns status and dependency state only; runtime detail moves behind authentication or off the public route

---

**What was changed (2026-09-23)** — fixed together with A-15; see that card for the full shape.

`/health` now answers `{"status":"ok"}` — one key. No Node version, pid, memory, uptime, hostname or dependency detail. The status-code contract (200 / 503) is unchanged, because nginx and the compose and Helm probes point at this path.

**Verification** — `controllers/health.controller.test.js` "publishes no runtime or dependency detail — A-06" asserts `Object.keys(body)` is exactly `["status"]`, that 11 named keys are absent, and that the literal `process.version` and `process.pid` values do not appear anywhere in the body.

---

### A-13 — Raw error messages reach clients in production

| | |
|---|---|
| **Status** | **PARTIAL** 2026-09-24 |
| **Severity** | medium |
| **Evidence** | `utils/controllerWrapper.util.js#asyncHandler` (used by **44** controllers) calls `sendError(res, error.message, status, …)` **before** the central `errorHandler` can sanitise, then calls `next(error)` anyway, so the handler runs after headers are sent. Observed on production: `Cannot read properties of undefined (reading 'roleId')` returned verbatim. `dynamicAccess.middleware.js` returns `{ success: false, message: error.message }` with a 500 and no envelope. |
| **Spec refs** | `docs/ENGINEERING/06-ERROR-RESPONSE-STANDARDS.md` · `docs/API/00-API-STANDARDS.md` |

**Why:** a raw PostgreSQL message carries SQL and schema names; a raw Node message carries internals. `P0-12` claims "the error mapper forwards recognised types only" — true of the mapper, and bypassed by the wrapper in front of it.

**Definition of Done**
- [ ] `asyncHandler` forwards to `next(error)` only; the central handler alone writes error responses
- [ ] non-`AppError` errors return a generic message with the request id in production
- [ ] `dynamicAccess` errors go through the same path
- [ ] a test throws a raw `Error("SELECT secret FROM …")` in a wrapped controller and asserts the text does not appear in the production response

**What was changed (2026-09-24) — the `dynamicAccess` half only.** Its catch now does
`return next(error)`, so an internal error reaches the client only through the global handler, which
sanitises it. This could not land alone, and the earlier attempt was reverted because of that:
`search.controller.js` probes `dynamicAccess` and treated **any** call to `next` as "allowed", so
forwarding an error would have made search fail **open** — the menus a caller cannot read would have
been searched whenever the permission lookup failed. The probe is now `(err) => resolve(!err)`, and
both changes land together. Tests: `dynamicAccess.test.js` › *"A-13: an internal error reaches the
client only through the global error handler"*; `search.permissions.a04.test.js` has the
lookup-failure case, which now denies.

**Still open:** `asyncHandler` in `controllerWrapper.util.js`, which is used by 44 controllers and
writes `error.message` itself before the central handler can run. That is the larger half, and the
boxes above stay unticked until it is done.

---

### A-17 — MQTT exposure

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | low |
| **Evidence** | `docker-compose.vm.yml` publishes `0.0.0.0:19883:1883` on the backend; nothing listens there (the backend is an MQTT **client**, and MQTT is off on this deployment). `iot.service.js` takes device and tenant ids from the topic; there is no publisher authentication beyond the external broker's ACLs. `ingestReading` does require the pair to match an IoT-enabled device. |

**Definition of Done**
- [ ] the port mapping removed from the vm and dev overlays unless a broker sidecar is added
- [ ] `docs/DEVELOPER/07-IOT-INGEST.md` states the broker ACL requirement plainly: a publisher allowed on `device/#` can post readings for any device whose id and tenant id it knows

---

**What was changed (2026-09-23):** the `1883` port mapping is removed from
`docker-compose.vm.yml` (where it was published on `0.0.0.0` as `19883`) and from
`docker-compose.dev.yml`. Nothing listened on it — the backend is an MQTT *client* — so it
published a public port with nothing behind it. If a sidecar broker is ever added, its own port is
published, bound to `127.0.0.1` unless devices really must reach it from outside.

The broker-ACL point is documented in `docs/DEVELOPER/07-IOT-INGEST.md`: a publisher allowed on
`device/#` can post readings for any device whose id and tenant id it knows, because the topic is
the only thing identifying them. The ingest path itself was hardened separately — see A-45.

---

### A-27 — Any account could mint an unrestricted API key, and SCIM would make it SUPERADMIN

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **critical — full platform takeover by the lowest-privilege account** |
| **Verified** | from code, 2026-09-21; **corrected 2026-09-23** (see below). **Not exploited**: doing so on the reference deployment would change real privileges |
| **Spec refs** | `docs/API/13-INTEGRATION-API.md` § SCIM · `docs/DEVELOPER/09-SCIM-PROVISIONING.md` · `docs/SECURITY/04-AUTHORIZATION-RBAC.md` |

> **Correction to the 2026-09-21 write-up.** It said every SCIM route is guarded by `auth` alone.
> That is wrong: `scim.route.js:38–45` also applies `requireApiKeyOrAdmin`, so a plain user JWT
> gets 403. The escalation was real, but it ran **through API-key issuance**, which was open to
> every authenticated user. The original text is kept below the line so the correction is visible.

**Root cause — four facts that combined**

| # | Fact | Where |
|---|---|---|
| 1 | `POST /api/v1/api-keys` was guarded by `auth` + `denyApiKey` only — **any** authenticated user, of any role, could mint a key | `routes/api/apiKeys.route.js` |
| 2 | the key's scopes were whatever the caller sent: `Array.isArray(scopes) ? scopes : []`, no allow-list — `["*"]` was accepted | `services/apiKey.service.js#createApiKey` |
| 3 | SCIM accepts **any** API key as a service account (`req.user.isApiKey`), regardless of its scopes | `routes/api/scim.route.js:38–45` |
| 4 | SCIM wrote a caller-chosen `roleId`, and the SUPERADMIN role id is a **committed constant** — `ROLE_IDS.SUPER_ADMIN = "9be20605-cc6a-4d91-8246-9756b4a1754b"` — which skips every permission gate and every tenant predicate | `services/scim.service.js` `createUser` / `updateUser` / `patchUser` · `constants/roleConstants.js` · `utils/tenantScope.util.js` |

**Reproduction** — on a **disposable local stack only**:

```http
POST /api/v1/auth/login                          # as any user, e.g. role USER
POST /api/v1/api-keys                            # step 1: mint an unrestricted key
Authorization: Bearer <that user's access token>
{ "name": "x", "scopes": ["*"] }

POST /api/v1/scim/v2/Users                       # step 2: provision a platform operator
X-API-Key: <the key from step 1>
{ "userName": "me@evil.test", "roleId": "9be20605-cc6a-4d91-8246-9756b4a1754b" }
```

Before the fix: 201, and that account is SUPERADMIN. Note the SCIM **PATCH** form — `patchUser`
reads `op.value` as an object and **ignores `op.path`** (A-33), so the escalating patch is
`{ "op": "replace", "value": { "roleId": "<id>" } }`, not the path-based form the 2026-09-21
write-up showed.

**Three more paths through the same module**

| Path | Effect |
|---|---|
| `PATCH /Groups/<SUPERADMIN id>` with `op: add, members: [<own id>]` | `Users.update({ roleId: groupId })` — the same escalation via membership |
| `PUT` / `PATCH /Groups/<any role id>` with a new `displayName` | renames a **global** role, including system roles; code that compares role **names** (`ROLE_LEVELS`, `role.name === "SUPERADMIN"`) then misbehaves for **every tenant** |
| `DELETE /Groups/<any role id>` | `role.destroy()` with no `isSystem` check — deletes a global role out from under every tenant |

**Impact:** any authenticated principal — a room user, a warehouse clerk — could become platform
operator, read and modify every hospital's data, and delete or rename the roles every tenant
depends on.

**What was changed (2026-09-23)**

| Change | File |
|---|---|
| API-key management is `TENANT_ADMIN`-only (`const adminOnly = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])]`), applied to all four routes | `routes/api/apiKeys.route.js` |
| `assertScopes()` — scopes must be a non-empty list of `<menu slug>:<read\|write>`; `*` in either position, unknown resources and unknown actions are 400; stored lower-cased | `services/apiKey.service.js` |
| `assertAssignableRole()` — refuses `ROLE_IDS.SUPER_ADMIN`, any role named SUPERADMIN, and unknown role ids (400). Called at all five sites that assign a role: `createUser`, `updateUser`, the two `patchUser` branches, and group membership | `services/scim.service.js` |
| `assertMutableGroup()` — `isSystem` roles cannot be renamed, patched or deleted through SCIM | `services/scim.service.js` |

**Verification** — `npx jest src/tests/services/scim src/tests/services/apiKey src/tests/routes/scim src/tests/routes/apiKey` → 6 suites, 166 tests, all passing. The new cases are in
`src/tests/services/scim.service.test.js` § "scim.service — privileged role guards (A-27)"
(7 tests: create/update/patch into SUPERADMIN, unknown roleId, rename/delete/patch a system role)
and `src/tests/services/apiKey.service.test.js` (wildcard scopes, unknown resource, unknown action,
empty list, non-array, lower-casing).

**Not covered by this fix — still open**
- [ ] SCIM mutations write no audit row attributed to the IdP credential (folded into A-33)
- [ ] roles are **global**, not per-tenant; SCIM group management therefore edits rows every tenant shares. That is a data-model question, not a guard — Open Question in `TASKS/BACKLOG.md`
- [ ] a live two-account reproduction on a disposable stack (unit tests only so far)

**Abuse cases covered by the tests**
- Blocking the role id while `members` still assigns it — membership goes through the same guard
- Filtering the constant but not a renamed SUPERADMIN row — the guard checks `role.name` too

---

### A-28 — Evidence and controlled documents can be changed by any role

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high — compliance** (ISO 13485 document control, 21 CFR Part 11 records) |
| **Verified** | from code, 2026-09-21 |

**Root cause:** the routes below carry `auth` and nothing else, and their services check tenant only — never role or ownership.

| Route | Service | What any role can do |
|---|---|---|
| `DELETE /api/v1/attachments/:id` (`attachments.route.js:204`) | `attachment.service.js#deleteAttachment` (`:172`) — `(tenantId, id)` only | delete any attachment in the tenant, including calibration evidence and certificate support files |
| `DELETE /api/v1/esignature/key-pairs/:keyPairId` | `eSignature.service.js#deleteKeyPair` (`:161`) — `where: { id, tenantId }` | delete the tenant's signing keys. **Creating** a key pair is `denyApiKey` (`:125`); **deleting** one is not, so any API key can |
| `POST / PUT / DELETE /api/v1/esignature/workflows` | workflow CRUD | create, change or delete multi-party signing workflows, including in-flight ones |
| `POST /api/v1/sop`, `PATCH /api/v1/sop/:id/publish` (`sop.route.js:56`, `:104`) | `sop.service.js#publishDocument` (`:46`) — sets `PUBLISHED`, no approver | author **and publish** a controlled procedure with no review. The service comment reads "in a real app, this might be filtered by role" |
| `POST / PUT / DELETE /api/v1/risks` (`risk.route.js:56`, `:170`, `:195`) | `risk.service.js` — tenant only | create, rescore or delete entries in the risk register |

**Impact:** an auditor asks who approved SOP rev 3, or why a calibration's evidence file is missing. Today the honest answer is "any account could have". Deletion of signing keys may also make past signatures unverifiable, depending on where public keys are kept — verify before assuming either way.

**Fix direction:** gate each with `dynamicAccess` on its menu slug (`attachments`, `qms`, `sop`, `risk` exist in `MENU_SLUGS`) and `denyApiKey` for key and workflow management; SOP publish requires a role distinct from the author (separation of duties); deletion of evidence-bearing attachments becomes a soft delete with an audit row, or is refused once the parent record is signed.

**Verification (DoD)**
- [ ] per route: a `USER` gets 403 and the row is unchanged
- [ ] an API key cannot delete a key pair
- [ ] SOP publish by its author is refused; by a second authorised role succeeds and is audited
- [ ] a decision recorded on whether deleting a key pair breaks verification of existing signatures

---

**What was changed (2026-09-23)**

| Route | Gate now |
|---|---|
| `DELETE /attachments/:id` | `dynamicAccess(EQUIPMENT, "write")` — and the delete is now a **soft delete** (`isDeleted`) with an audit row, in one transaction |
| attachment reads and upload | `dynamicAccess(EQUIPMENT, "read")` — every seeded role holds it, so a technician can still attach and read its own calibration evidence |
| e-signature key pairs and workflows: writes | `denyApiKey` + `dynamicAccess(QMS, "write")`; reads `QMS:read` |
| `POST /sop`, `GET /sop` | `dynamicAccess(SOP, "write" / "read")` |
| `PATCH /sop/:id/publish` | `denyApiKey` + `SOP:write` **plus separation of duties in the service**: publishing your own SOP is a **409 with a state explanation**, and the status change, training fan-out and audit row are in one transaction |
| risk register | `dynamicAccess(RISK, "write" / "read")` |

**Deliberately left on `auth`, with the reason in the code:** `POST /esignature/sign`, `/verify`,
`/history` — a signer is whoever the workflow names, commonly a technician with no `qms` menu, so
gating `/sign` on `qms:write` would make workflows unsignable — and `POST /sop/:id/acknowledge`,
which is self-service on the caller's own row.

**Deleting a key pair does NOT break verification of existing signatures.** `verifySignature`
reads no key at all: it recomputes a hash. That is not reassurance, it is A-47 — see that card.
`TenantKey` is also `paranoid`, so the row and its public key survive the delete.

**`attachments` is NOT a menu slug.** This card claimed it was; it is not in `MENU_SLUGS`.
`equipment` is used as a stand-in, which means evidence retention cannot be granted independently
of equipment editing. That is an Open Question for `TASKS/BACKLOG.md`, not a decision to make in a
bug fix — and inventing a slug would have created another A-07 instance.

**Verification** — `npx jest src/tests/routes/routeGuards.a28.test.js` → 22 tests, running the
**real** `dynamicAccess` against the **real** role matrix, with only `auth` stubbed; every refusal
asserts the service was never called. Named: "refuses an API key — creating a key pair was
denyApiKey, deleting one was not", "refuses publication by the SOP's own author with a 409 that
explains the state", "lets a second authorised user publish it, and writes the audit row",
"refuses an ENGINEERING MANAGER rescoring a risk — it holds read, not write". Adjacent suites:
18 suites, 293 tests. 100 % on the eight changed files.

**Residual:** risk-register mutations and key-pair/workflow deletion still write no audit row. The
certificate parent-state check covers `resourceType === "certificate"` only. `/verify` returns
`biometricData` and `polygon` to any authenticated caller who knows a signature id — its own card.
Existing API-key integrations on attachment, e-signature and risk reads now authorize by scope
rather than passing on `auth` alone: intended under A-03, but a behaviour change in the field.

---

### A-29 — IoT ingest cannot be provisioned, and its credential would leak if it could

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium — a shipped feature that cannot receive data; a latent credential leak |
| **Verified** | from code and the reference database (`0` devices with `iot_enabled`, `0` with a token) |

**Root cause**
- Nothing sets `iotDeviceToken`, and nothing but the demo seeder sets `iotEnabled`
  (`migration.service.js` sets `iotEnabled` on one demo device; corrected 2026-09-23 — the
  original wording said nothing sets either): no service assigns them, no validator accepts them (`calibrationDevices.validator.js` has no IoT field), no frontend surface shows them. The only reference is the lookup in `iot.controller.js:21`.
- `POST /api/v1/iot/ingest` therefore returns 401 for every device unless a token is written into the database by hand. MQTT ingest (off on the reference deployment) authenticates by topic and needs the same flag.
- Predictive maintenance, documented as deriving risk "from IoT readings", has no readings to derive from.
- `calibrationDevice.model.js` `defaultScope` excludes nothing: once a token exists it is returned in every device list and detail response — the leak `PHASE-3` P3-01 warns about ("a token in the device register is a leak to everyone who can read it").

**Documentation impact:** `PHASE-5` marks P5-02 IoT telemetry "✅ DONE". Built, tested with mocks, and **unreachable**.

**Fix direction:** an admin-only endpoint that issues a random token (≥ 32 bytes, stored **hashed**, shown once — as API keys already are) and toggles `iotEnabled`; the token excluded from default attributes; a UI surface; a rate limit on `/iot/ingest`.

**Verification (DoD)**
- [x] a device can be provisioned end to end through the API and ingest succeeds
- [x] no device response contains the token
- [x] tokens are hashed at rest

---

**What was changed (2026-09-24)**

| | |
|---|---|
| provisioning | `routes/api/iot.route.js` → `controllers/iot.controller.js` → new `services/iotDevice.service.js`, validated by new `validators/iot.validator.js`: `GET /iot/devices/:deviceId` (`calibration` read); `PATCH /iot/devices/:deviceId` and `POST`/`DELETE /iot/devices/:deviceId/token` (`auth` + `denyApiKey` + `rbac(TENANT_ADMIN)` + `dynamicAccess("calibration", "write")`). Issue/rotate returns the token **once** (201; `iot_` + 32 random bytes, base64url) and enables ingest; revoke clears it and disables ingest (409 when there is none). Every lookup carries the tenant id and `isDeleted: false`; another tenant's, a deleted and a missing device all answer the same 404. Each mutation locks the row and writes its audit row (`UPDATE` / `CalibrationDevice`, `changes.iot`) in the same transaction, never carrying the token or its hash |
| hashed at rest | migration **0044-iot-device-token-hash**: adds `iot_token_hash` VARCHAR(64) and `iot_token_issued_at`; hashes any pre-existing plaintext token **deliberately** in SQL (`encode(sha256(convert_to(t, 'UTF8')), 'hex')`, identical to Node's `createHash("sha256")`, so a hand-provisioned device keeps ingesting — '' maps to no token, as it authenticated nothing); refuses if a row already carries a different hash; drops `iot_device_token` and its unique constraint; adds UNIQUE `calibration_devices_iot_token_hash_unique` (global, but over server-generated random values — no caller can probe it). `down` refuses while any device holds a hash. Ingest looks up `iotTokenHash = sha256(token)`; a non-string token is 401, not 500 |
| no leak | `calibrationDevice.model.js`: `iotDeviceToken` replaced by `iotTokenHash` / `iotTokenIssuedAt`; `defaultScope.attributes.exclude: ["iotTokenHash"]`; `toJSON()` strips it even from an unscoped row |
| rate limit | `/iot/ingest` has `endpointRateLimiter("iotIngest")`, 600/min per client address, on top of the global limiter |
| UI | devices page: an IoT action per row opens `IotDeviceModal` (issue/rotate with a one-time copy box, enable/disable, revoke, tolerance editor); `frontend/src/api/services/iot.service.ts` |
| docs | `docs/DEVELOPER/07-IOT-INGEST.md` — status banner, § Provisioning A Device, tests table; the hand-written-SQL recipe is gone |

**Verification**
- Backend (`npm test -- <path>`): `src/tests/routes/iot.provisioning.a29.test.js` (34), `src/tests/services/calibrationDevices.tokenLeak.a29.test.js` (3), `src/tests/services/iotDevice.service.test.js` (3), `src/tests/migrations/0044-iot-device-token-hash.test.js` (8), `src/tests/routes/iot.route.test.js` (6), with the existing `iot.controller`, `iot.service` and `bodyless.a09` suites: 100 % on all four measures for `iot.controller.js`, `iot.route.js`, `iot.service.js`, `iotDevice.service.js`, `iot.validator.js`. Named: *"returns the token once and stores only its SHA-256 hash"*, *"a device provisioned through the API ingests with its token (end to end)"*, *"rotating replaces the hash: the old token is refused 401, the new one ingests"*, *"revoking clears the hash and disables ingest; the token is refused 401"*, *"get/patch/post/delete on another tenant's device answers 404, and the device is unchanged (two-tenant)"* (principals from `createTwoTenants()`), *"… on a soft-deleted device answers the same 404 as another tenant's"*, *"the device LIST response never contains the token or its hash"*, *"the device DETAIL response never contains the token or its hash"*, *"every mutation writes its audit row in the same transaction, without the token or its hash"*, *"an API key cannot mint a device token, even one scoped to calibration write"*. Frontend: `src/api/services/iot.service.test.ts`, `src/app/dashboard/devices/components/__tests__/IotDeviceModal.a29.test.tsx` (*"issues a token and shows it once; …"*); `tsc --noEmit` clean.
- **Fail-before:** the new backend suites copied into `git worktree add <scratchpad>/wt-iot HEAD` (05985ef) — 33 of 43 fail (worktree removed). The list/detail tests fail at HEAD on the real leak: the serialized response contains `"iotDeviceToken":"iot_plaintext-…"`.
- **PostgreSQL 18.6** (`pgvector/pgvector:pg18`, throwaway container, removed): a table built by the PRE-change model's `sync()` with three rows (a non-ASCII plaintext token, NULL, ''); `up` → `\d calibration_devices` shows `iot_token_hash`, `iot_token_issued_at`, UNIQUE `calibration_devices_iot_token_hash_unique` and no `iot_device_token`; the hashed row is found by Node's `sha256` and by the NEW model's ingest lookup; `findAll()` JSON carries neither hash nor plaintext; the NULL and '' rows have no hash; a re-run is a no-op; `down` refused while the token was held and succeeded after revocation (restoring the 0010 column and its constraint); `up` again clean. The fresh-database path (new model `sync()` → 0010 → 0044) ends with the same columns and index.

**Residual:** the IoT dialog shows its write actions to anyone with `calibration` write, while the backend also requires tenant-admin level — a technician gets the 403 message. The MQTT path still authenticates by topic alone (A-17). Ingest still writes no `audit_logs` row. Nothing here was exercised against a running server or a live broker.

---

### A-30 — The rate limiter never uses Redis

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high** — brute-force protection resets on every deploy |
| **Verified** | from code |

**Root cause:** `rateLimiter.redis.service.js` constructs its Redis client inside `getRedis()` (`:34`), which is **not exported and never called**. `redisReady` is never true, so every counter lives in the in-process `Map`. Twelve `istanbul ignore` comments in the file mark the Redis branches as unreachable — the dead path was excluded from coverage rather than wired in or deleted.

**Consequences**

| | |
|---|---|
| counters reset on **every restart and deploy** | an attacker waits for the next deploy — or triggers a crash — and the 5-attempt login lockout starts again |
| per replica | with N replicas the effective limit is N × the configured one |
| keyed by `req.ip` (`:344`, `:544`) | if `req.ip` is a proxy address rather than the client (A-16, unverified), **every user shares one bucket**: one attacker's five failures lock everyone out |

**Documentation impact:** ARCHITECTURE/06 ("Redis-backed endpoint limiters"), ENGINEERING/08 and several SECURITY documents describe Redis-backed limiting. Corrected alongside this card.

**Fix direction:** initialise the client at startup (or reuse the shared, now-working `redis.service` client), keep the memory fallback for outages only, and resolve A-16 before trusting any per-IP key.

**Verification (DoD)**
- [ ] a lockout survives a backend restart
- [ ] two replicas share one counter
- [ ] the `istanbul ignore` markers on the Redis path removed and the path covered

---

**What was changed (2026-09-23)**

The service no longer constructs a client. `readyRedis()` takes the **shared** client from
`redis.service.getRedisConnection()` and uses it only when `client.status === "ready"` — the
property ioredis actually has (A-24). `index.js` already calls `initRedis()` at startup.

The increment is a single Lua `EVAL` that reads, increments, preserves `firstAttempt` and sets the
TTL in **one** operation. The old code did `INCR` and `PEXPIRE` separately: a process dying between
them left a counter with no TTL — a lockout that never lifts.

**A parity bug had to be fixed on the way in**, and it is the interesting part: `isTokenBlocked`,
`isUserLockedOut` and `getRateLimitStatus` all compare `now < entry.expiresAt`, while the old Redis
writes stored no `expiresAt` and the old `INCR` stored a bare integer with no `.count`. Wiring
Redis in unchanged would have made **every blocked token read as not blocked**. The dead path was
not merely unused; it was wrong, and it had been excluded from coverage rather than run.

**Outage behaviour — decided and written into the file:** fail over to the in-process Map, never
fail open. A request is still counted, just no longer counted globally (N replicas ⇒ N × the limit
during the outage). Failing *closed* on a read would turn a Redis hiccup into a total
authentication outage; failing *open* hands an attacker the control itself.

**Verification**
- `src/tests/services/rateLimiter.redis.path.test.js` — 22 tests with a mocked client, including
  "never reads a `connected` property — ioredis has none", "locks the account out on the fifth
  failure even when the first four were another replica's", and "writes an absolute expiresAt to
  Redis so a blocked token reads as blocked on either backend".
- `src/tests/services/rateLimiter.redis.live.test.js` — 6 tests against a **real Redis**
  (7.4.11), opt-in behind `REDIS_LIVE_TEST=1`: a lockout survives the process that recorded it,
  two simulated replicas lock out on the fifth failure rather than the tenth, and 40 concurrent
  requests across two replicas store exactly 40.
- **Falsifiability check**, which is why the live suite is worth anything: pointed at a dead port,
  all six fail, and they fail exactly as the finding describes.
- **12 `istanbul ignore` directives removed, none left in the file**; 100 % with no exclusions.

**Residual, stated plainly:** the live suite runs two module graphs in one Node process against a
local Redis. That proves the key design, the script and the shared counter. It does **not** prove
a deployed container restart or two pods on the VM — those DoD boxes stay open. Per-IP keys remain
only as trustworthy as `req.ip` (A-16, untouched).

---

### A-31 — Nothing stops access and refresh tokens sharing a secret

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | low–medium |
| **Evidence** | `utils/jwt.util.js:8–17` requires both secrets to exist but never compares them. `docs/BACKEND/11-CONFIGURATION.md` says "the config should reject that rather than trusting whoever wrote the `.env`" — it does not. `JWT_ALGORITHM` is also read from the environment (`:24`). |

**Why it matters:** with equal secrets, whether a refresh token is accepted as an access token depends only on claim checks in the verifier, not on cryptography.

**Fix direction:** refuse to start when the secrets are equal; pin the verification algorithm list in code rather than in the environment.

**Verification (DoD):** [ ] startup fails with equal secrets · [ ] a refresh token presented as a bearer token is rejected, with a test

---

**What was changed (2026-09-23)** — and the card understated the defect.

`JWT_REFRESH_SECRET` signed **nothing**. The key registry holds `ACCESS_SECRET` alone, and
`generateRefreshToken` signed from that registry, so the legacy JWT refresh token was signed with
the **access** secret and `verifyAccessToken` — which walks the same registry — would have accepted
it. The two secrets were not "allowed to be equal"; for that code path they already were.

What saves the deployment is that nothing issues one: every refresh token this application hands
out is opaque (`generateOpaqueRefreshToken`, 32 random bytes, stored). The JWT flavour is legacy
and unused.

| Change | File |
|---|---|
| startup refuses when `JWT_ACCESS_SECRET === JWT_REFRESH_SECRET` | `utils/jwt.util.js` |
| `JWT_ALGORITHM` is validated against a list pinned in code; an unsupported value refuses to start | `utils/jwt.util.js` |
| tokens carry `typ: "access"` / `typ: "refresh"`, and each verifier refuses a token whose claim names the other type | `utils/jwt.util.js` |
| refresh tokens are signed and verified with `REFRESH_SECRET` and HS256 alone — out of the access-key rotation registry entirely | `utils/jwt.util.js` |

A token with **no** `typ` is still accepted on the access path, deliberately: nothing issues a
typ-less refresh JWT any more, and refusing them would have invalidated every access token in
flight at deploy time.

**Verification** — `npx jest src/tests/utils/jwt` → 71 tests. The new `utils/jwt.a31.test.js` has
"refuses to start when the access and refresh secrets are equal", "refuses an algorithm that is not
on the pinned list", "refuses a refresh token presented as a bearer token", "refuses an access
token presented to the refresh path", and "still accepts a legacy access token that carries no type
claim". `services/auth`, `controllers/auth`, `controllers/sso` and `middlewares/auth` — 195 tests —
still pass.

**Before deploying:** the running `.env` must not have the two secrets equal, or the backend will
refuse to start. `deploy/compose/.env.example` already says they must differ; the VM's own file
has not been checked.

---

### A-32 — The 100% coverage figure includes 58 exclusions

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low — a trust problem with the gate, not a runtime defect |
| **Evidence** | 58 `istanbul ignore` directives in `backend/src` (non-test), **31 with no reason**. Concentrated in `migration.service.js` (15) and `rateLimiter.redis.service.js` (12). Several mark code as "unreachable" — `transformTenants is never referenced`, `decryptPrivateKey is not exported`, `getRedis() is not exported and has no caller` — i.e. **dead code kept and hidden** rather than deleted, and in one case a whole feature (A-30). |

**Fix direction:** every directive carries a reason; dead code is deleted, not ignored; a reviewer treats a new `istanbul ignore` like a new `eslint-disable`.

**Verification (DoD):** [ ] zero unexplained directives · [ ] no directive on code described as unreachable

---

## Wave 1 — Correctness

**Addendum (2026-09-23):** `coveragePathIgnorePatterns` also excludes **`src/config/`** entirely.
That is how `config/socket.js` — which holds the Socket.IO authentication gate — sits outside the
100 % gate. Its coverage after the A-05 fix is 100 %, but only under an explicit override run, not
under `make verify`. A directory-level exclusion hides more than an `istanbul ignore` does, and
this one hides an authentication boundary.

### A-07 — `dynamicAccess` names that match no menu slug

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** — verified 2026-09-24: one live lockout (asset finance), the rest latent |
| **Evidence** | Resources passed to `dynamicAccess`: `"Management"` (×10), `"Maintenance"` (×7), `"Finance"` (×6), `"Vendors"` (×6), `"Billing"` (×3), `"AuditLogs"` (×1) — beside lowercase slugs `warehouse`, `calibration`, `certificate`. Menu slugs are lowercase (`maintenance`, `finance`, `vendors`, `billing`, `audit`, `management`). `scopeAllows` lower-cases both sides, so API keys match case-insensitively; **whether `checkMenuPermission` does the same for users has not been checked.** `AuditLogs` matches no slug in any case. |

**Definition of Done**
- [x] **verify first**: as a `HEALTHCARE ADMIN` (not super-admin), call one route per mismatched name; record 200 or 403 — done as a test against the real middleware and the real matrix builder, not a live call (below)
- [x] if any is denied: normalise every resource to its slug; add a test that every `dynamicAccess` name exists in ~~`MENU_SLUGS`~~ **the seed's slugs** (why: below)
- [ ] Phase 9 P9-19 types the argument as the slug union so this cannot recur

---

**Addendum (2026-09-23, from the A-04 work):** `calibration` and `certificate` are real menu
groups in the database seed (`seedMenuGroups.util.js`) but are **not** in `MENU_SLUGS`
(`constants/roleConstants.js`). Since `apiKey.service.js#assertScopes` validates issued scopes
against `MENU_SLUGS` (A-27), a newly issued API key **cannot** be scoped to `calibration:read` or
`certificate:read` at all — so of the three searchable types a key can only ever reach stock. The
same mismatch is what this card is about; adding the two slugs widens API-key issuance and belongs
here, with a deliberate decision, not in a search fix.

**What was verified and changed (2026-09-24).**

How the check works, read from the code: `checkMenuPermission` looks the resource up **verbatim,
case-sensitively** in a matrix keyed by each granted menu's **name and slug**, with the grant
inherited by **direct children only** (`roles.service.js#getRolePermissionsMatrix`). API keys go
through `scopeAllows`, which **lower-cases** the resource. So a gate naming a menu by its name works
for users only by that coincidence, and a gate naming nothing is in nobody's matrix — while an API
key can still pass it if the lower-cased name happens to be a slug. Two principal types, two
vocabularies, one gate.

What each non-slug name did (154 gates enumerated; 31 gates in 7 files named something other than a
seeded slug):

| Gate | Files (gates) | Matched | Effect | Changed to |
|---|---|---|---|---|
| `["Finance", "Billing"]` | `finance.route.js` (6) | nothing / a name no seeded role holds | **DENY — live.** The menu is name *"Asset Finance"*, slug `finance`. HEALTHCARE ADMIN, CALIBRATOR ADMIN and ENGINEERING MANAGER hold `finance: read` and were refused on all six routes (SUPERADMIN-only). An API key scoped `finance:read` **passed** (`"Finance"` lower-cases to the slug), and a `billing` grant stood in for `finance` | `"finance"` |
| `["AuditLogs", "Audit Logs", "audit"]` | `audit.route.js` (1) | name + slug of one menu; `AuditLogs` dead | none (dead alias) | `"audit"` |
| `"Management"` | `tenant.route.js` (7) | menu name | none — same menu as slug `management` | `"management"` |
| `"Maintenance"` | `maintenance.route.js` (5) | menu name | none | `"maintenance"` |
| `"Maintenance"` | `calibrationScheduler.route.js` (2) | menu name | none — kept on `maintenance` because the route's own swagger says "Requires read access to the Maintenance resource"; `calibration-scheduler` is a separate seeded menu that therefore still gates nothing server-side (left open, below) | `"maintenance"` |
| `"Vendors"` | `vendor.route.js` (6) | menu name | none from the name — but see Q-20 | `"vendors"` |
| `"Billing"` | `billing.route.js` (3) | menu name | none from the name — but see Q-20 | `"billing"` |

No grant had to be created: the finance fix makes the existing `finance` grant effective, so **no
migration**. Each route file was changed in the resource string only.

**Why the guard checks the seed's slugs, not `MENU_SLUGS`:** `MENU_SLUGS` holds 33 of the seed's 60
slugs — `users`, `calibration`, `certificate`, `audit`, `vendors`, `billing`, `maintenance` and
others are seeded and gated on but absent from it. A `MENU_SLUGS` check would fail on correct gates.
Closing that gap widens API-key issuance (`assertScopes`, A-27) and is the addendum's decision —
**left open**.

**Tests (named):**

- `src/tests/routes/dynamicAccessSlugs.a07.test.js` (6) — **the permanent guard.** Replaces
  `dynamicAccess` with a recorder and requires **every** module under `src/routes`, so each gate is
  seen with its evaluated argument (including `search.route.js`'s computed `SEARCH_MENUS`); then
  cross-checks with the boot scanner's `collectRouteGates` (file:line), and asserts both counts agree
  (154). Fails if any gate names anything but a seeded slug.
- `src/tests/routes/finance.access.a07.test.js` (22) — real `dynamicAccess` **and** real
  `getRolePermissionsMatrix` over rows built from `ROLE_MENU_ASSIGNMENTS` and the seed's menu tree:
  the three roles holding `finance: read` reach the three reads and get 403 on the three writes; a
  role without the grant gets 403 on all six; a `finance:read` key agrees with the users; a
  `billing:*` key no longer reaches asset finance.
- `src/tests/routes/dynamicAccessReach.a07.test.js` (2) — pins the gates **no** seeded role can pass
  to a reviewed list (below), so a new one fails and a fixed one forces the list to shrink.
- `src/tests/utils/authorizationWiring.util.test.js` — "reports the computed gate as a warning, and
  no dead alias remains (A-07)": the boot check's warnings drop from 8 to 1 (the computed search gate).

**Fail-before**, in a worktree of HEAD with only the tests copied in: **13 fail** — both guard tests
(the 31 gates named by file and line), all 9 admin-read finance tests (403), the `billing:*` key
test, and the wiring-warning test. The `finance:read` API-key test **passed** before the fix, which is
the asymmetry itself.

**Found on the way, left open:**

- **Q-20 — five seeded slugs no seeded role can reach.** `audit`, `billing`, `content`, `users`,
  `vendors` sit two levels under `management`; `ROLE_MENU_ASSIGNMENTS` grants `management` and the
  matrix inherits one level. So on a fresh seed `/users`, `/vendors`, `/billing`, `/content` and
  `/audit` are SUPERADMIN-only — HEALTHCARE ADMIN cannot manage its own users. Correcting a name
  cannot fix that; who should hold these is a privilege decision (BACKLOG Q-20).
- `calibration-scheduler` is a seeded, assigned menu that no route gates on.
- The comment above the `audit.route.js` gate still describes the old three-name list, and that
  file's pre-existing `comma-dangle` lint error at the controller line is untouched — both outside
  "the resource string only".
- `abac.middleware.js` falls back to `matrix["Management"]` — a name lookup of the same shape, not a
  `dynamicAccess` gate, harmless while the name and slug belong to one menu.
- The boot check still accepts a menu **name**; the test is the strict guard. Tightening the boot
  check is a one-line change in `checkRouteGates` if wanted.

### A-09 — Undefined `req.body` under Express 5

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Evidence** | Fixed: `menuGroup.controller.js` (the production 500 on `/menu-groups/menu-groups/admin`). Remaining unguarded `req.body.x` reads on POST/PATCH handlers: `apiKey`, `attachment`, `calibrationScheduler`, `iot`, `kanban`, `ticket` controllers. |

**Definition of Done**
- [ ] a middleware defaults an absent body to `{}` for every route (BACKLOG M-10), or every read is guarded
- [ ] a bodyless POST to each listed route returns 400, not 500

---

**What was changed (2026-09-23) — and the finding was bigger than this card said.**

The card assumed a route behind `validate(schema)` was safe. **It was not.**
`validation.middleware.js` called `schema.validate(req.body, …)`, and Joi treats `undefined` as
**valid** against a non-required object schema — measured, not assumed:

```
Joi.object({ a: Joi.string().required() }).validate(undefined) -> no error, value undefined
Joi.object({ a: Joi.string().required() }).validate({})        -> "a" is required
```

So the gate opened, the middleware then assigned `req.body = undefined`, and the controller's first
read threw. `validate(schema)` was not a safe harbour — it was a **second instance of the same
bug**, and so were the 30 in-controller `validate(body, schema)` helpers in `src/validators/`.

| Layer | Change |
|---|---|
| request | `middlewares/bodyDefault.middleware.js` (new), mounted in `index.js` immediately after the body parsers and before the sanitizer, swagger and every router: fills `req.body` **only** when it is `undefined`; an object, array, string or Buffer is untouched |
| the Joi gates | `validation.middleware.js` coerces `req.body ?? {}`, so required-field rules fire and a bodyless request gets **400 with the field list**. All **31** `validate` helpers in `src/validators/` do the same — including `scim.validator.js`, the last one, whose routes mount no body validator at all |
| at the read | 69 sites across 23 controllers on routes with no body validator: `req.body || {}`, so each handler reaches its own 400 (or its service) instead of throwing |

**Triage:** 193 `req.body` sites outside tests; ~118 safe once the two shared helpers were fixed; 6
already guarded by the earlier partial fix; 69 fixed here.

**Verification** — 103 new tests in 4 suites, and **they were proved to fail without the fix**:
reverting four guards turned exactly the five corresponding cases red. Named:
"replaces an absent body with {} — the Express 5 regression itself", "leaves a Buffer body
untouched (raw-body / webhook routes)", "validates `undefined` against a required-field object
schema WITHOUT an error" (which pins the Joi behaviour so a future upgrade reports it rather than
hiding it), "`<file>.validator.js`: validate(undefined, <required schema>) is refused, not passed
through" — data-driven over the whole directory, so a **new** validator written the old way fails
this suite — and "the public IoT ingest endpoint answers 401 … not 500".

**Residual:** `bodyDefault` is mounted in `index.js`, which is excluded from coverage collection,
so its behaviour is tested but **nothing proves it is still mounted**. `supertest` is not
installed, so none of this is proved over real HTTP.


---

### A-10 — Webhook delivery durability

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Evidence** | `webhook.service.js#deliverWithRetry` runs in-process with `setTimeout` backoff `min(2^n × 500 ms, 30 s)` for `WEBHOOK_MAX_ATTEMPTS` = 5 — four waits of 1, 2, 4, 8 s, **about 15 s end to end**. A restart loses every pending retry and leaves the row `pending` or `failed` forever. The signature is `HMAC-SHA256(secret, body)` with no timestamp. |
| **Spec refs** | `docs/WEBHOOK/04-WEBHOOK-RETRY.md` · `docs/WEBHOOK/03-WEBHOOK-SECURITY.md` |

**Definition of Done**
- [x] ~~delivery moves onto RabbitMQ with a dead-letter queue~~ — **amended by ADR-054**: a database outbox (`webhook_deliveries` + `next_attempt_at`, claimed `FOR UPDATE SKIP LOCKED`), dead letter = `exhausted`
- [x] a retry schedule measured in hours, not seconds — 12 attempts, ~20.5 h
- [x] a signed timestamp header, and receivers told to reject stale ones
- [x] a restart during delivery resumes it — tested

---

**Correction (2026-09-23), from documenting the module:** this card says there is no replay
protection *and* implies there is no delivery id. There **is** one — `X-Webhook-Delivery` carries
`webhook_deliveries.id`, and the same id is inside the signed body, byte-identical across every
retry, so a receiver can deduplicate today. What is genuinely missing is a **timestamp**: none in
the headers, none in the body, none signed, so a captured delivery can be replayed forever.

The retry arithmetic also needed a correction. 1-2-4-8 s is the **backoff** total (~15 s); each
attempt additionally carries `WEBHOOK_TIMEOUT_MS` (default 8 s), so the wall clock to `exhausted`
is up to **~55 s**. And the 30 s backoff cap is dead code at the default `MAX_ATTEMPTS = 5` —
`2**attempt * 500` first exceeds 30,000 at attempt 6.

**What was changed (2026-09-24, ADR-054).** Migration `0043-webhook-durable-delivery` adds
`webhook_deliveries.next_attempt_at` and the partial index `webhook_deliveries_due`; it resumes
pre-0043 `pending`/`failed` rows under 24 h old and dead-letters older ones with the reason in
`last_error`. `webhook.service.js`: a row per webhook per event is the outbox; `claim` is one
`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING` that leases the row
(`WEBHOOK_LEASE_MS`, 5 min); backoff `min(1 min × 2^(n−1), 6 h)`, 12 attempts (~20.5 h), then
`exhausted`; the webhook is re-read before every attempt (deleted/deactivated → dead letter); a
`webhook.test` delivery gets one attempt. `webhookDeliveryScheduler.middleware.js` runs a pass at
boot and every 15 s (`WEBHOOK_DISPATCH_SCHEDULER`), wired in `index.js`. Signing is now
`X-Webhook-Signature: v1=HMAC(secret, "<X-Webhook-Timestamp>.<body>")`; the receiver recipe (reject
more than 5 min of skew, constant-time compare, dedupe on `X-Webhook-Delivery`) is in
`docs/WEBHOOK/03-WEBHOOK-SECURITY.md` and is the code of `tests/fixtures/webhookReceiver.js`.

**Tests** (fail-before: run against HEAD in a worktree, every one below failed; after: all pass):
`tests/services/webhook.delivery.a10.test.js` — a real in-process HTTP receiver verifying every
request: "the receiver's recipe accepts the signed delivery…", "replay protection: a captured request
replayed later is stale; with a swapped timestamp its signature fails; resent at once it is a
duplicate", "a receiver holding the wrong secret rejects the delivery, and the failure is scheduled
for retry", "restart survival: a retry the first process scheduled is sent by a freshly loaded one,
same delivery id", "dead letter: … 12 attempts, then the row is exhausted", "two tenants: each event
reaches only its own tenant's receiver, and B cannot claim or test A's".
`tests/services/webhook.durable.a10.live.test.js` — **PostgreSQL 18.6** (`pgvector/pgvector:pg18`,
opt-in `WEBHOOK_PG_LIVE_TEST=1`): "a retry scheduled before a restart is delivered by the next
process…", "two replicas dispatching concurrently send each of 30 due deliveries exactly once (SKIP
LOCKED)", "a claimed (leased) row is invisible to every claimer until the lease expires", "two
tenants: an event reaches only its own tenant's webhook, and a claim by id is bound to the tenant",
"emitAfterCommit: a rolled-back transaction emits nothing; a committed one emits exactly once".
Plus `webhook.service.test.js` (47), `webhookDeliveryScheduler.middleware.test.js` (9),
`migrations/0043-webhook-durable-delivery.test.js` (6); `webhook.secret.a51.test.js` updated to the
v1 signature. Migration verified on PG 18.6: up, re-run (no change), down, down again, up after down,
`\d webhook_deliveries` checked each time.

**Left open.** (1) **Breaking change**: a receiver still verifying `sha256=<HMAC(body)>` rejects every
delivery — there is no dual-signing window; tenants must update receivers. (2) A crash between the
business COMMIT and the delivery-row insert loses that event (afterCommit is in-process); closing it
needs a transactional outbox with a savepoint per emit (ADR-054, alternatives). (3) Delivery is
at-least-once. (4) No metric/alert on the dead-letter count and no manual redelivery endpoint.


---

### A-11 — The webhook event catalogue is two events

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Evidence** | The only `emitEvent` call site is `calibrationScheduler.service.js`: `device.calibration_due` and `device.overdue`. Plus the synthetic `webhook.test`. Certificates, work orders, stock transfers and CAPA emit nothing. |
| **Spec required** | **yes** — which events, with which payloads, before anyone subscribes |

**Definition of Done**
- [x] catalogue agreed in `docs/WEBHOOK/01-EVENT-CATALOG.md`
- [x] each event emitted **after** the transaction commits, never inside it — a webhook for a rolled-back change announces something that did not happen

**What was changed (2026-09-24).** The catalogue is `backend/src/constants/webhookEvents.js`, and the
offered list (`WebhookModal.tsx` `PREDEFINED_EVENTS`) now equals `*` plus it. New emit sites, each one
`webhookService.emitAfterCommit(transaction, …)` call next to the audit row: `certificate.approved`,
`certificate.signed`, `certificate.revoked` (`certificate.service.js`, inside `runTransition`'s
mutate); `stock_transfer.completed` (`stock.service.js#updateTransferStatus`, unmanaged transaction);
`capa.created`, `capa.closed` (`qms.service.js`). `work_order.created` / `work_order.completed`
(`maintenance.service.js`) emit with `null` because that service opens no transaction — the write has
already autocommitted. `emitAfterCommit` registers on `transaction.afterCommit`, so a rollback or a
failed COMMIT discards the emit. Payloads are identifiers, numbers, statuses and the actor's UUID —
no free text (the revocation reason is deliberately left out).

**Removed from the catalogue:** `webhook.test` — offered by the UI, but it never matched a
subscription (the test endpoint bypasses matching), so subscribing to it did nothing.

**Tests** (fail-before: against HEAD, 25 of them failed; after: 29/29 pass):
`tests/services/webhookEmit.a11.test.js` — per event "… is emitted after the … commits", "a
certificate transition whose COMMIT fails emits nothing", "a transfer whose COMMIT fails emits
nothing", "a CAPA create whose COMMIT fails emits nothing", "a refused transition (409) emits
nothing", "editing an already-completed work order, or any other status change, emits nothing",
"re-saving a CLOSED CAPA, or moving to another status, emits nothing", one "<KEY> has an emit site in a
service" per catalogue name, and "the frontend offers exactly `*` and the catalogue — and no longer
the inert webhook.test". On real PostgreSQL: `webhook.durable.a10.live.test.js` "emitAfterCommit: a
rolled-back transaction emits nothing; a committed one emits exactly once".

**Left open.** Not emitted, by choice (each is a new public contract and data-export decision):
certificate create/update/delete/submit, NC create/update, stock adjust/opname, e-signature
workflows, tickets. `maintenance.service` still has no transaction and no audit row on work-order
writes — its emits are correct because its writes autocommit, but that is a separate defect.

---

### A-12 — `sessionSecurity.middleware.js`

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium |
| **Evidence** | Imported by nothing. Its raw SQL targets `"Sessions"` with camelCase columns (`"isRevoked"`, `"userId"`), while the table is `sessions` with snake_case attributes, and passes `$1` placeholders as `replacements` — each query would fail if the file were ever wired in. Its tests exist, so it is counted as covered. |

**Why:** a documented control — session fixation protection, concurrent-session limits, IP binding — that is not installed. Coverage of dead code is a green tick for an absent control.

**Definition of Done**
- [ ] decide: delete, or rewrite against the real `sessions` model and wire it in
- [ ] every document that claims these protections checked against the decision

---

**Decision and what was done (2026-09-23): deleted, not wired in.** Wiring it in would have changed
authentication behaviour on a judgement nobody made — IP binding logs people out when a mobile
network or hospital wifi rotates an address, and a concurrent-session cap means one login silently
kills another. That is **Q-08** in `TASKS/BACKLOG.md` (superseding Q-04, which asked *how strict*
the binding should be — a question resting on a premise that was never true).

**The breakage was worse than the card said.** Besides `"Sessions"` versus `sessions`, the
camelCase columns and `$1` passed as `replacements`, two columns it reads — `expiresAt` and
`lastActivity` — have **no counterpart under any casing** (the model has `expired_at` and
`last_activity_at`). Even a correct snake_case rewrite would have had to rename them.

**Eleven documents said these controls existed.** They were corrected, and the origin is worth
naming: **ADR-017 "User Sessions Bound to IP and User Agent", status Accepted** — a decision
recorded, propagated into six `docs/` files as fact, and never implemented. That is the PR-4 shape
exactly. ADR-017, ADR-005, ADR-034 and ADR-039 now carry the correction; so do
`ARCHITECTURE/03`, `BACKEND/04`, `BACKEND/10`, `DATABASE/03`, `SECURITY/00`, `SECURITY/01` (T2
listed IP/UA binding as a *control*), `SECURITY/03`, `PLAN/01`, `PLAN/18` (PR-3 listed it under
*mitigation in place*), `DEVOPS/03`, `DEVOPS/09` and `deploy/README.md`.

**Verification** — `npx jest src/tests/middlewares` → 23 suites, 375 tests; nothing referenced the
deleted files. The two test files went with the middleware: a passing test over an uninstalled
control is a green tick for nothing.

**It opened a bigger one:** with binding, fixation protection and the session cap all confirmed
absent, the `sessions` table is read by **nothing** in the request path. See A-48.


---

### A-14 — Production logging

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Evidence** | `activityLog.middleware.js` adds the Console transport only outside production → `docker logs` has **0 lines** on the reference deployment. Per-request lines use `logger.http`, below the production level `info` → **0 `http` lines in 640 combined-log lines**. Exception and rejection transports have no `maxFiles`. |
| **Spec refs** | `docs/OBSERVABILITY/01-LOGGING.md` · `docs/DEVOPS/06-LOGGING.md` |

**Definition of Done**
- [x] JSON logs to stdout in production (files optional)
- [x] per-request completion logged at `info`, with request id, status and a **numeric** duration
- [x] every file transport bounded

**What was changed (2026-09-24)** — all in `backend/src/middlewares/activityLog.middleware.js`; `index.js` untouched.

| Piece | Behaviour |
|---|---|
| Console transport in **every** environment | production: the logger's JSON format, one object per line, to stdout; development: the colourised one-liner. It sets `handleExceptions` and `handleRejections`, so an uncaught throw at boot (the `KMS_MASTER_KEY` crash loop) now appears in `docker logs` |
| file logging optional | `LOG_TO_FILE=true`/`false`; **unset → files outside production, stdout only in production**. Every file transport, including the exception and rejection handlers, is daily, 20 MB, gzip, `maxFiles: "30d"` |
| `LOG_LEVEL` | overrides the default (`info` in production, `debug` elsewhere) |
| per-request line | the `RESPONSE` record is written at **`info`** with `message: "request completed"`, `requestId`, `method`, `url`, `statusCode`, numeric `durationMs` (hrtime, 2 decimals), `ip`, `userId`, `tenantId`. The arrival record stays at `http`; it now carries a `message`, which fixes it printing `[object Object]` (winston treats a lone object without `message` as the message) |
| redaction — a winston format ahead of every transport | key-name walk at any depth (lower-cased, `-`/`_` removed): password/passwd/passphrase, secret, token, authorization, cookie, api key, private/public/master/encryption key, credential, otp/totp, mfa/recovery/backup code, session id. `code`/`pin` redacted when the value looks like a one-time code (4–10 digits), so `err.code = "ECONNREFUSED"` survives. `Bearer …`/`Basic …` and JWT-shaped strings are scrubbed from **values and the message**. Errors, `toJSON` (Sequelize instances), arrays, cycles and depth (8) are handled, and the caller's object is **never mutated** |
| URL | `?token=`, `?code=`, `?state=`, `?api_key=` … are redacted in the logged URL; the path and other parameters are kept |
| timestamp | ISO-8601 UTC instead of offset-less local time |

**Verification** (named tests, all passing, 100 % on all four measures for `activityLog.middleware.js` and `auditLog.middleware.js`):

- `src/tests/middlewares/activityLog.a14.stdout.test.js` (7) — each case runs the **real** logger and real `activityLogger` on a real Express app in a child process with `NODE_ENV=production`, sends one real HTTP request, and reads the child's **stdout**: "A-14: stdout is not empty in production, and every line is a JSON object"; "A-14: the per-request completion line is emitted at info with request id, status and a NUMERIC duration"; "A-14: the logged URL keeps its path and harmless parameters but redacts ?token="; "A-14: no password, TOTP code, bearer token, JWT, cookie or refresh token reaches stdout" (secrets are an independently written list, not the redactor's key set); "A-14: production writes no log files unless LOG_TO_FILE=true"; "A-14: LOG_TO_FILE=true writes the rotated combined file as well as stdout"; "A-14: an uncaught exception is written to stdout as JSON, redacted, and the process exits non-zero".
- `src/tests/middlewares/activityLog.test.js` (rewritten, 24, real winston) — configuration, bounded file transports and handlers, redaction branches, `sanitizeUrl`, and the middleware.

**Fail-before:** the three suites run against `HEAD` in a scratch worktree: 25 of 50 fail, including every A-14 stdout case — "stdout is not empty…" receives **0 lines**.

**pkg:** nothing new is bundled — the Console transport and the logform formats are reached through static `require('./console')` / `require('./errors')` in winston and logform. A probe built with `@yao-pkg/pkg` for `node24-win-x64` printed the redacted JSON lines to stdout and created no storage directory.

**Deployment note:** with `LOG_TO_FILE` unset, a production container **stops writing** `log/activity/*`; stdout is the record (bounded by the compose `json-file` driver in `docker-compose.prod.yml`). Set `LOG_TO_FILE=true` to keep the files. The morgan access log (`log/access/`, A-44) is unchanged.

**Left open:** `docs/OBSERVABILITY/01-LOGGING.md` and `docs/DEVOPS/06-LOGGING.md` still describe the file-only logger and "no redactor" as as-built; they need correcting under the deviation protocol (outside this change's boundary). The 25 `console.*` call sites are unchanged and still bypass the redactor.

---

### A-15 — Health checks that check health

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Evidence** | `/health` and `/ready` call only `db.authenticate()`. With Redis down, rate limiting and brute-force lockout stop working while `/health` returns 200. |

**Definition of Done**
- [ ] `/ready` reports database, Redis and RabbitMQ separately; Redis down is **not ready**
- [ ] `/live` stays dependency-free

---

**What was changed (2026-09-23)**

| Piece | File |
|---|---|
| dependency probes with a deadline (`HEALTH_PROBE_TIMEOUT_MS`, 2 s) and a cached aggregate (`HEALTH_CACHE_TTL_MS`, 5 s) so a load-balancer poll does not re-probe three services per hit | `services/health.service.js` (new) |
| `liveness` (touches nothing), `health` (verdict only), `readiness`, `readinessDetail` (per-dependency breakdown, kept even on a 503) | `controllers/health.controller.js` (new) |
| `/health`, `/live`, `/ready` public; `GET /api/v1/health` behind `[auth, denyApiKey, superAdminOnly]` | `routes/internal/health.route.js` (new), mounted in `index.js` |

Required: PostgreSQL, Redis, RabbitMQ. Optional: MQTT — **"not configured"** unless `MQTT_HOST` and `MQTT_PORT` are both set, matching the gate in `index.js` — and ClamAV, which reports **`unknown`, never `healthy`**, because `clamAv.service` exposes no reachability probe and scanning a file on a probe endpoint would be a real side effect. Only required dependencies move the verdict.

**Verification** — 43 tests across `services/health.service.test.js` (27), `controllers/health.controller.test.js` (8) and `routes/health.route.test.js` (8, driven over real HTTP on an ephemeral port). Named cases include "is NOT ready when Redis is down — the defect A-15 describes", "stays ready when only an OPTIONAL dependency is down", "serves a cached aggregate so a load balancer does not re-probe every hit", and "GET /api/v1/health is refused for an API key".

**Deployment note, deliberate:** RabbitMQ counts as required, so a broker that is down **at boot** would now fail the Helm `startupProbe` (30 × 10 s) and restart the pod where it previously started. Compose already orders `rabbitmq: service_healthy` before the backend, so this bites only a degraded cluster. Changing it is one line in `health.service.js`; no configuration flag was invented for it.

**Stale documentation to correct (outside the change):** `deploy/README.md` still says `/health` returns `database: "connected"`, and five comments in `deploy/compose/docker-compose.yml`, the Helm values and `NOTES.txt` still describe `/health` as "calls db.authenticate()".

---

### A-16 — Is `req.ip` the client?

| | |
|---|---|
| **Status** | **DONE** in code 2026-09-24 — deploy check open |
| **Severity** | **unverified** — compliance-relevant |
| **Evidence** | `app.set("trust proxy", 1)`. Browser API traffic passes Cloudflare → `cloudflared` → nginx → **Next.js** → backend: three hops behind the first. The morgan access log shows real client addresses via `cf-connecting-ip`; what `req.ip` resolves to — the value in `audit_logs`, `sessions` and **`e_signature_records.ipAddress`** (21 CFR Part 11 evidence) — has not been checked. |

**Definition of Done**
- [ ] **verify**: sign in through the public domain and compare the stored session and audit IP with the client's real address
- [ ] if wrong: derive the client IP from a trusted header set explicitly by the edge, configured per deployment, and never from a header a client can send directly to nginx on `:19080`

### A-25 — Stripe invoices that were paid after a failure stay "Open"

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium — billing records wrong, money correct |
| **Evidence** | `stripeWebhook.service.js#upsertInvoice` uses `Invoice.findOrCreate({ where: { stripeInvoiceId } })` with the status in `defaults` — it **never updates** an existing row. Stripe's usual retry path is `invoice.payment_failed` (row created as `Open`) then `invoice.paid` (row found, not changed). The subscription moves to `Active`; the invoice stays `Open` with `amountPaid: 0`. |
| **Spec refs** | `docs/API/11-BILLING-FINANCE-API.md` · `docs/DATABASE/11-BILLING-TABLES.md` |

**Definition of Done**
- [ ] a real upsert that updates status and amounts on an existing invoice
- [ ] a monotonic rule: `Paid` is never downgraded by a late `payment_failed` — Stripe does not guarantee event order
- [ ] tests for failed-then-paid, paid-then-late-failed, and a duplicated `invoice.paid`

**What was changed (2026-09-23)** — `services/stripeWebhook.service.js`

`upsertInvoice` was `Invoice.findOrCreate({ where, defaults })`, which only ever inserts: the
`defaults` are ignored when the row exists. It is now `findOne` → `create` or `instance.update`,
keyed on `stripeInvoiceId`, with two rules a plain upsert would not give — and both matter because
**Stripe does not guarantee event order**:

| Rule | Why |
|---|---|
| `Paid` is terminal | a late `invoice.payment_failed` must not downgrade a settled invoice |
| `amountPaid` never decreases (`Math.max`) | that same late failure carries `amount_paid: 0` and would erase a recorded payment |

`Number(existing.amountPaid)` first, because Sequelize `DECIMAL` comes back from pg as a **string**
and `Math.max` on a string is a silent wrong answer.

**Verification** — `services/stripeWebhook.upsert.a25.test.js`, 8 tests with `Invoice` backed by an
in-memory store so the assertions are on the stored **row**, not on ORM calls: "an invoice that
failed and was then paid ends up Paid, with ONE row", "a late payment_failed does not downgrade a
Paid invoice or erase amountPaid", "does not lower amountPaid when a DECIMAL comes back from pg as
a string".

**Residual:** the `invoices` model has **no** paid-at column, so only `updatedAt` moves when an
invoice settles. Writing `paidAt` would have been silently dropped by Sequelize — the same trap
shape as `is_deleted`. A `paid_at` column needs a migration and is not done.

**What was changed (2026-09-24, ADR-050).** Every proxy in front of the backend now sends exactly
**one** `X-Forwarded-For` entry — the client address as resolved at the edge — and the backend trusts
exactly one hop (`TRUST_PROXY_HOPS`).

| Layer | Change |
|---|---|
| **VM nginx** | `real_ip_header CF-Connecting-IP` trusted **only** from the compose gateway `172.30.19.1`, where the host-side cloudflared arrives. `X-Forwarded-For` is overwritten, never appended, and `CF-Connecting-IP` is cleared. The compose network is pinned so that address is stable |
| **`default.conf`** | nginx is the edge and overwrites the header |
| **Both configs, Socket.IO location** | the headers are repeated there. It had reached the backend with **no** `X-Forwarded-For` at all |
| **Next** | `lib/clientIp.ts` forwards only the rightmost entry, and only if it is a valid IP. The catch-all proxy drops every client-address header a browser could send |
| **Backend** | three places that read a forgeable header now use `req.ip`: the rate limiter, the audit middleware and the access log |

**Verified against real nginx 1.27 in Docker:**
- **Before:** the old VM config gave the backend `xff=[6.6.6.6, 172.30.19.1]` for a forged request, so
  every browser was the gateway.
- **After:** the backend gets the Cloudflare client address. A forged header is ignored, and a
  direct client on the network gets its own address.

**Tests:**
- **Frontend,** *"the proxy does not forward a browser-supplied X-Forwarded-For verbatim"*: 6 of 18
  tests failed against the old routes.
- **Backend,** `clientIp.a16.test.js`.

**To close — on the VM:**
- **Recreate the network.** A full `down` and `up` is needed for the pinned subnet. If it fails with
  "Pool overlaps", change the subnet in both `docker-compose.vm.yml` and `vm-http.conf`.
- **Check a real sign-in.** `sessions.ip_address` and the `LOGIN` audit row must show a real public
  IP, not `172.30.19.1`.
- **Then** `AUTH_RATE_LIMIT_BY_IP=true` is safe.

---

### A-26 — Nothing deduplicates at-least-once delivery

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium |
| **Evidence** | Documentation across ARCHITECTURE, DEVOPS and SECURITY described Redis-held "worker idempotency claims". None exists: the only `SET NX` is the registration lock. `emailQueue.service.js` re-sends a redelivered message; webhook retries have no receiver-side idempotency key. |

**Definition of Done**
- [ ] each consumer claims a message id with `SET NX` before acting and releases the claim on failure
- [ ] outbound webhooks carry a stable `X-Webhook-Delivery` id receivers are told to deduplicate on (the header exists; the guidance does not)
- [ ] a test delivers the same message twice and asserts one effect

---

## Wave 2 — Hygiene and Gaps

**What was changed (2026-09-23)**

| Piece | File |
|---|---|
| `claimMessage(identity, ttl)` — a Redis `SET NX EX` on `dedup:msg:<identity>`, returning `{ claimed, deduplicated, release }` | `services/rabbitmq.service.js` |
| the email consumer claims `email:<job.id>` before sending; a lost claim logs and **ACKs** (nacking would redeliver work already done), and the claim is **released in the catch** so the existing retry is not read as a duplicate | `services/emailQueue.service.js` |
| the batch worker claims `batch:<payload.jobId>`, acks a duplicate, and releases the claim when the job throws so a DLQ replay can still run it | `workers/batchJob.worker.js` |

**The identity, and why it survives a redelivery:** `job.id` is minted once in `addEmailJob` and
written into the **persisted message body**, so a redelivery replays the identical body. The AMQP
**delivery tag is not stable** — it is per-channel and changes on redelivery — which is why the
identity is read from the payload, never from `msg.fields`. For batch jobs it is the `BatchJob`
row's UUID, which is additionally a natural key.

`acquireLock` from `redis.service` was deliberately **not** reused: it returns `null` both when the
lock is held and when Redis is down, and those two cases must behave in opposite ways here.

**Verification** — 111 tests across 8 suites. Named: "sends ONE email when the same message is
delivered twice, and ACKs the redelivery", "releases the claim when the send fails, so the retry is
not read as a duplicate", "runs the job ONCE when the same message is delivered twice, and ACKs
both" (in `workers/batchJob.worker.test.js` — the **first test this worker has ever had**), and
"FAILS OPEN when the Redis client is not ready — the work still happens".

**Residual risk, stated in the code as well as here:** this is **at-least-once with a dedup claim,
not exactly-once**. The claim is taken *before* the send, so a worker that dies between claiming
and sending means that email is never sent until the 24-hour TTL expires; a send that reaches SMTP
and then throws releases the claim and the retry sends a second copy. Both windows are real.
Redis down means no deduplication at all — fail open, logged, and `claim.deduplicated` is `false`
so a caller can tell; a duplicate email is recoverable, a silently dropped one is not.

**Not done:** outbound webhooks still carry no stable delivery id (that DoD box stays open), and
`QUEUE_DEDUP_TTL_SECONDS` is a new environment variable that is not yet in `.env.example`.

---

### A-18 — Dead code and unused dependencies

| | |
|---|---|
| **Status** | TODO |
| **Evidence** | `response.util#paginated` (no callers; reads `res.query`); `aedes`, `aedes-server-factory` (referenced by no code); `build:bun` script; `backend/.eslintrc.js` (ignored by ESLint 9); `package.json` `name: "express-boilerplate"`; `ai.service#chunkText` documents "overlapping chunks" and implements none. |

**Definition of Done**
- [ ] each removed or corrected; the full suite still at 100%

### A-19 — No automatic gate of any kind

| | |
|---|---|
| **Status** | TODO |
| **Evidence** | No CI, no hook tooling, no secret scanner. Documents claimed a `pre-push` hook, a secret scanner and an IDOR enforcement script; none exist. |

**Definition of Done**
- [ ] gitleaks (or equivalent) configured and run in a committed hook and in CI (P7-01)
- [ ] the hook installed by `npm install`, not by instructions

### A-20 — The browser suite is missing

**Evidence:** `docs/TESTING/06-BROWSER-TESTING.md` describes `automate/` with 71 Playwright tests; the directory is untracked and absent (BACKLOG U-07).
**Definition of Done:** restore it to the repository, or withdraw the claim everywhere it appears.

### A-21 — Commit a lockfile

**Evidence:** `.gitignore` excludes `pnpm-lock.yaml`, `package-lock.json` and `bun.lock` (BACKLOG W-11). Every build resolves dependencies fresh.
**Definition of Done:** one package manager chosen; its lockfile committed; images install with the frozen-lockfile flag.

**What was changed (2026-09-23)**

`package-lock.json` is committed, `make install` is now `npm ci`, and every `Makefile` target uses
one package manager instead of two. `pnpm-lock.yaml`, `bun.lock` and nested workspace lockfiles
stay ignored — a lockfile inside `backend/` produces a different tree from the hoisted root one,
and a stale one dated 2026-07-28 was sitting there.

**npm was chosen on evidence rather than preference:** the committed tree is the one **6,128 tests
and the lint gate are actually proven against**. Nothing in this repository has ever been verified
under pnpm's non-hoisted layout, and this is a codebase with a packaged binary build, Puppeteer and
native dependencies — the set most sensitive to it. The pnpm question is not closed, it is
sequenced: it belongs with P7-01, where CI can prove it.

**This finding had already cost a gate.** A-34 — ESLint crashing before it linted a file — was a
floating-tree defect: the backend asked for `eslint ^10`, the root pinned `9.22.0`, and hoisting
produced a combination where the recommended config enabled a rule the installed core did not have.
That is what "no lockfile" costs, and it is why this is a Phase 0 card rather than a Wave 2 one.

**Still open, deliberately:** `pnpm-workspace.yaml` remains and now contradicts ADR-044. Removing it
is a one-line change that reviews better on its own — Open Question in `BACKLOG.md`.


---

### A-22 — React Compiler error in `GlobalSearch.tsx`

**Evidence:** `react-hooks/set-state-in-effect` at line 101 — synchronous `setState` inside an effect. Pre-existing since the first commit.
**Definition of Done:** fixed by restructuring the component, not by disabling the rule (`CLAUDE.md`).

**Done 2026-09-24.** The reset that ran when the query dropped below two characters (four `setState`
calls in the debounce effect's body) moved into the input's change handler, `handleQueryChange`: the
event that causes the reset now performs it. The effect only schedules the debounce timer, and every
state update happens in the timer callback. `handleSelect` clears through the same handler, so it now
also invalidates an in-flight request (before, a late response could repopulate the list after a
selection). No rule disabled. Evidence: `npx eslint src/components/layouts/GlobalSearch.tsx` gives 1 error
(`react-hooks/set-state-in-effect`, 101:7) on a `git worktree` of HEAD `05985ef`, 0 after. Behaviour
pinned by `frontend/src/components/layouts/__tests__/GlobalSearch.a56.test.tsx` › "A-22 reset on a short
query": *closes the dropdown when the query is cut below two characters*, *drops a response still in
flight when the query is cleared*, *does not search at all for a one-character query*. All three pass
before and after, which is the point: the move changes no behaviour.

### A-23 — Search efficiency

**Evidence:** `search.service.js` runs one query per requested type, sequentially, and logs a warning on every call where the FTS column is missing (always, in the unit-test database).
**Definition of Done:** the three queries run concurrently or as one `UNION ALL`; the fallback warning logged once per process.

**Done 2026-09-24.** `search.service.js` issues the per-type statements with `Promise.all`. The bound is
structural: the requested list is a de-duplicated subset of `TYPES` (new; `types=device,device` used to
run and return the type twice), so at most three statements are in flight per request, well inside the
pool. Not `UNION ALL`: the three SELECT lists differ in shape and each type keeps its own FTS → ILIKE
fallback, which one statement cannot. The fallback warning is logged once per table per process (a
module-level set); later fallbacks for that table log at `debug`. Tests in
`backend/src/tests/services/search.service.test.js`: *A-23: runs the per-type queries concurrently, not one
after another*, *A-23: a duplicated type is searched once*, *A-23: warns about the ILIKE fallback once per
table per process, then logs at debug*. All three fail on a worktree of HEAD `05985ef` and pass after.
The controller's per-type permission probes (`permittedTypes`) are still sequential; they hit the
permission cache, not a search statement, and were left alone.

---

## Already Done in This Audit

| Id | What | Where |
|---|---|---|
| A-08 | metered billing zero usage — `$1` placeholders passed as `replacements` | commit `9745f01`, ADR-039 |
| A-24 | `redis.service` guarded every helper on `client.connected`, a property ioredis does not have — registration answered 429 to everyone, passkeys 503, the OIDC provider could not complete an authorisation; the test mock fabricated `connected`, so the suite was green | this commit |
| A-09 (part) | `/menu-groups/menu-groups/admin` 500 | commit `f3d323e` |
| — | avatar and tenant-logo broken images; email templates carrying another company's branding and a broken Outlook CTA | commits `78028b0`, `582e24b`, `6621722` |
| — | `npm test` could not run under a hoisted workspace install | commit `78028b0` |
| — | MySQL support removed — it never worked | ADR-039 |

---

### A-33 — SCIM PATCH ignores `path`: standard IdP patches silently do nothing

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium — a shipped integration that no standards-compliant IdP can drive |
| **Verified** | from code, 2026-09-23, while fixing A-27 |

**Root cause:** `scim.service.js#patchUser` handles an operation by iterating
`Object.entries(op.value)` — it reads `op.path` only in the `remove` branch, and there it treats
it as an **array of keys**. RFC 7644 § 3.5.2 defines `path` as a **string** attribute path, and
the normal form of a patch is `{ "op": "replace", "path": "active", "value": false }`.

Given that operation, the code evaluates `Object.entries(op.value || {})` where `op.value` is the
scalar `false` — `Object.entries(false)` is `[]`, so the loop body never runs. The operation is
silently dropped and the endpoint returns **200 with the user unchanged**.

Only the non-standard shape `{ "op": "replace", "value": { "active": false } }` works.

**Impact:** Okta, Entra ID and OneLogin all send path-based operations for the common cases
(deactivate a user, change a group membership). Against this endpoint they get 200 and nothing
happens — deprovisioning appears to succeed while the account stays active. That is the worst
failure mode available: a silent no-op on the operation that removes access.

**Also missing:** no SCIM mutation writes an audit row, so there is no record of what the IdP
changed (carried over from A-27).

**Fix direction:** parse `path` per RFC 7644 (at minimum the simple `attr` and `attr.sub` forms)
and route it through the same assignment code — including `assertAssignableRole` — as the value
form; reject an operation whose `path` is present but unparseable with 400 rather than ignoring
it; write an audit row per mutation, attributed to the API key.

**Verification (DoD)**
- [ ] `{ "op": "replace", "path": "active", "value": false }` deactivates the user
- [ ] `{ "op": "replace", "path": "roleId", "value": "<superadmin id>" }` returns 403, not 200
- [ ] an unparseable `path` returns 400 and changes nothing
- [ ] an audit row exists for every accepted SCIM mutation

---

**What was changed (2026-09-23)** — and the fix needed one change the card did not anticipate.

| Piece | File |
|---|---|
| `patchUser` resolves `path` through a case-insensitive attribute map (`active`, `userName`, `name.givenName`, `name.familyName`, `roleId`), stripping the core-schema URN prefix Entra ID sends; the path form and the value-object form now funnel through **one** assignment function | `services/scim.service.js` |
| `patchGroup` does the same for `displayName` and `members`, including Okta's `members[value eq "<id>"]` filter form on `remove` | `services/scim.service.js` |
| `remove` **requires** a path (the RFC makes it REQUIRED), supports `roleId`, and returns 400 for anything else — the old branch iterated `op.path` as an array against a `Joi.string()` and could never fire | `services/scim.service.js` |
| `GET /Users` parses `userName eq`, `email eq`, `emails.value eq` and `active eq` joined by ` and `; an **unsupported filter is a 400**, not the whole tenant | `services/scim.service.js` |
| the Joi schema accepts boolean and numeric values | `validators/scim.validator.js` |

**The change the card missed:** `scimPatchSchema` declared `value` as object-array-or-string, so
`{"op":"replace","path":"active","value":false}` — a **boolean** — was rejected at validation
*before the service ran*. Fixing only the service would have turned a silent 200 into a 400 on the
exact payload Okta sends.

**A guard gap closed on the way through:** `patchGroup`'s member-assignment branch had **no**
`assertAssignableRole` (A-27) at all. It was unreachable only because `assertMutableGroup` happens
to fire first for system roles — an accident of ordering, not a control. Adding path-based member
patching would have widened it. It now calls the guard before every member assignment, with tests
for both the path and value forms.

**Verification** — `npx jest src/tests/services/scim src/tests/controllers/scim src/tests/routes/scim src/tests/validators/scim` → 5 suites, **195 tests**, 100 % on all three files. Named:
"deactivates the user given the standard IdP deprovision operation" (asserting
`update({ isActive: false, status: "SUSPENDED" })`), "refuses a path-form roleId naming SUPERADMIN
with 403 and writes nothing", "rejects an unsupported path with 400 rather than ignoring it",
"narrows to one user on a userName eq filter", "rejects an unsupported filter with 400 instead of
returning the tenant", "runs a path-form member add through the A-27 role guard".

**Behaviour changes an IdP will observe:** unsupported filters, unsupported paths and `remove` on
anything but `roleId` are now **400s** where they used to be a misleading 200. `replace` on
`members` is deliberately **additive** — it assigns the listed members and does not demote omitted
ones, matching the PUT semantics — so an IdP expecting an exact sync will find omitted members
still in the group.

**Still open, and the largest remaining SCIM gap:** no SCIM mutation writes an audit row, and
`patchGroup` issues several `Users.update` calls **outside any transaction**, so a mid-loop failure
leaves partial membership. `GET /Groups` still ignores an unsupported filter and returns every role
on the platform, which is now inconsistent with `GET /Users`. `src/tests/e2e/modules/scim.e2e.test.js`
has no PATCH or filter coverage, so the live suite would not catch a regression here.


---

### A-34 — The backend lint gate has never run

| | |
|---|---|
| **Status** | **partly DONE** 2026-09-23 — ESLint runs again; the 1,319 findings behind it are not yet fixed |
| **Severity** | medium — a gate in `make verify` that could not have passed |
| **Verified** | 2026-09-23, by running it |

**Root cause:** `backend/package.json` asked for `eslint ^10.10.0` and `@eslint/js ^10.0.1`, while
the workspace root pins `eslint 9.22.0`. npm hoisting gave the backend **ESLint 9.22.0 with
`@eslint/js` 10.0.1**, and `js.configs.recommended` from 10.x enables `no-unassigned-vars`, a rule
9.22 does not have. Every invocation died before linting a single file:

```
TypeError: Key "rules": Key "no-unassigned-vars": Could not find "no-unassigned-vars" in plugin "@".
```

`make verify` runs lint first. It has therefore never passed on this machine, and nothing in CI
runs it either (there is no CI gate — A-19).

**What was changed**

| Change | File |
|---|---|
| backend pinned to the same ESLint the workspace root pins (`9.22.0`, both packages) | `backend/package.json` |
| `test`, `fetch`, `AbortController`, `AbortSignal`, `global`, `TextEncoder`, `TextDecoder`, `structuredClone` added to `globals` — the missing `test` alone produced **385** `no-undef` errors | `backend/eslint.config.js` |
| `eqeqeq` now `{ null: "ignore" }` — `x == null` is the deliberate "null or undefined" idiom in `kanban.service.js`; requiring `===` would have changed behaviour for `undefined` | `backend/eslint.config.js` |
| `no-redeclare` now `{ builtinGlobals: false }` — `webhook.service.js` declares `/* global fetch, AbortController */` for readers | `backend/eslint.config.js` |

**What is left:** **1,297 errors and 340 warnings** as re-measured on 2026-09-23 after the day's
commits (the first measurement, earlier the same day, was 1,319 and 346 — the drop is the
remediation work, not a fix to the lint debt). Of these, roughly 1,300 are auto-fixable
(`indent` 392, `quotes` 296, `comma-dangle` 266, `curly` 243, `no-trailing-spaces` 87,
`eol-last` 19). None of them is a logic defect — the three that looked like one
(`eqeqeq` ×2, `no-redeclare` ×2) were the linter being wrong about deliberate code, which is why
they are config changes above rather than code changes. The remaining `no-unused-vars` (303) and
`no-console` (24) warnings need reading one by one; an unused variable is occasionally a real bug.

**Why the fix is not "run `--fix` and commit":** it rewrites nearly every file in `backend/src`,
which would collide with the authorization work in flight and bury it in a 1,300-line diff. It is
its own commit, taken once the security waves land, with the full suite as the check.

**Verification (DoD)**
- [x] `npx eslint src/ --ext .js` runs to completion
- [ ] zero errors
- [ ] `make verify` reaches the typecheck step
- [ ] a CI job runs it (A-19)

---

### A-35 — Every per-user permission override silently did nothing

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high — a revocation that did not revoke** |
| **Verified** | from code, 2026-09-23, while fixing A-04 |

**Root cause:** `userPermission.service.js#getUserOverrideMatrix` keyed the matrix by menu
**name** — `matrix[p.menu.name]`, e.g. `"Warehouse"` — while `dynamicAccess.middleware.js` looks
an override up as `overrides[menuName]`, where `menuName` is whatever the route passed. Every
route passes a lowercase **slug** (`"warehouse"`). `hasOwnProperty` therefore never matched, on
any route, and the override branch never ran.

`roles.service.js#getRolePermissionsMatrix` indexes by **both** name and slug — which is why role
permissions work and overrides did not.

**Impact:** an administrator granting a single user extra access saw it do nothing. Worse in the
other direction: an override of `"none"` is a **revocation**, and it also did nothing — the user
kept whatever the role granted while the UI showed the access as removed. That is a security
control that reported success and took no effect.

**Fix:** the override matrix is now indexed by name **and** slug, so either key resolves.

**Verification** — `npx jest src/tests/services/userPermission` → 16 tests still pass, and
A-04's `controllers/search.permissions.a04.test.js` "honours a per-user 'none' override that
revokes a menu the role grants" exercises the path end to end through the real middleware.

**Residual:** the cached matrix (`cacheKeys.userPermissions`) may hold name-only entries written
before this change until it expires; `removeUserPermission` and the setter already invalidate it.
Not verified against a live database.

---

### A-36 — RabbitMQ connections are never reused and never closed

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high — a connection leak against the broker, in production** |
| **Verified** | from code and `node_modules`, 2026-09-23, while building the health probes |

**Root cause:** `rabbitmq.service.js:26` and `:57`, and `emailQueue.service.js:19` and `:54`,
cache on `connection.isOpen` / `channel.isOpen`. **amqplib 2.0.1 defines no `isOpen`** — the
property does not exist anywhere in `node_modules/amqplib/lib/`.

The guard is therefore always false, so every call to `getConnection()`,
`getRabbitMQConnection()` or `getChannel()` opens a **new** AMQP connection or channel, and
nothing ever closes it. Under load the process accumulates broker connections until the broker's
limit is reached.

**This is the third instance of one shape:** a liveness guard on a property the driver does not
have. `redis.service` guarded on ioredis's non-existent `.connected` (A-24, fixed 2026-09-21) and
its test mock **fabricated** the property, which is why the suite stayed green. Check the amqplib
mocks for the same fabrication before trusting any test here.

**Fix direction:** cache the connection and channel and clear the cached reference on amqplib's
real `"close"` and `"error"` events; reconnect when the reference is gone.

**Verification (DoD)**
- [ ] two `getConnection()` calls result in **one** `amqplib.connect`
- [ ] a `"close"` event forces the next call to reconnect
- [ ] the amqplib test mock exposes only what amqplib exposes — no invented `isOpen`
- [ ] broker connection count stays flat under repeated publishes (live check)

---

**What was changed (2026-09-23)** — `rabbitmq.service.js` and `emailQueue.service.js`

Liveness now comes from the `"close"` and `"error"` events amqplib really emits, with an identity
guard so a late event from a **superseded** connection cannot evict its replacement. Channel-level
handlers were added — there were none. `closeRabbitMQ` clears the cache in a `finally`, which it
never had to do before **because the cache never hit**.

**The test mocks fabricated `isOpen`** — exactly as the ioredis mock fabricated `connected` in
A-24. Both harnesses now expose only what amqplib exposes, and `amqplib.connect` returns a
**distinct** object per call, because otherwise a test cannot tell a reused cache from a fresh
connection.

**Verification** — "reuses one connection across calls instead of opening a new one each time"
asserts `amqp.connect` was called **once** across two `getConnection()` and two `getChannel()`
calls; "reconnects after the connection emits close"; "a close from a superseded connection does
not evict the live one"; and, in `emailQueue.service.test.js`, "should open exactly ONE connection
and channel across many queued emails". 100 % on both files.

**Note for A-32:** this is the third instance of one shape — a liveness guard on a property the
driver does not have, kept green by a mock that invented it. Worth a lint rule or a review habit,
not just three fixes.

---

### A-37 — SCIM user creation is a cross-tenant existence oracle

| | |
|---|---|
| **Status** | **PARTIAL** 2026-09-24 |
| **Severity** | **high — the trap `CLAUDE.md` names by name** |
| **Verified** | from code, 2026-09-23 (found during the documentation sweep, confirmed by the orchestrator) |

**Root cause:** `user.model.js` declares **global** unique indexes on `username` and `email`
(`{ fields: ["username"], unique: true }`, `{ fields: ["email"], unique: true }`), while the
duplicate check in `scim.service.js#createUser` is `Users.findOne({ where: { email } })` — which
the global tenant hooks narrow to the **caller's own tenant**.

So for an address already used by **another** tenant: the 409 check passes, the insert is
attempted, and the database constraint rejects it. The caller gets a different failure for
"exists elsewhere on the platform" than for "does not exist", which is exactly the membership
oracle the 404 rule exists to prevent — here reached with nothing but an API key.

**Also:** the same shape applies to `createGroup`, because role `name` is globally unique
(`role.model.js`) — see A-38.

**Fix direction:** this needs a decision, not a patch. Either
(a) make `username`/`email` unique **per tenant** — a migration and an ADR, and it changes what
"an account" means across the platform, or
(b) keep global uniqueness and make both paths answer **identically** (the same 409 with the same
body whether the collision is inside the tenant or outside it), which hides the oracle but keeps
an address unusable in a second hospital for reasons the admin cannot see.
Open Question for `TASKS/BACKLOG.md` either way; do not pick one in a bug fix.

**Verification (DoD)**
- [ ] creating a user whose email exists in ANOTHER tenant is indistinguishable from creating one with a fresh email failing for any other reason
- [ ] a two-tenant test asserts the two responses are byte-identical
- [ ] whichever route is chosen is recorded as an ADR

**What was changed (2026-09-24) — the minimal fix.** Every failure of `Users.create` in SCIM
`createUser` now answers one fixed `500 "The user could not be provisioned"`. A unique violation
against another tenant's row is **byte-identical** to a lost connection. The reason is logged without
the address. A duplicate inside the caller's own tenant still answers 409, which discloses nothing the
caller cannot list.

**Test:** `scim.crossTenantOracle.a37.test.js` › *"SCIM create for an email that exists in another
tenant is indistinguishable from a fresh email whose insert fails for any other reason"*. 4 of its 6
tests failed against the old code, which answered *"Validation error"* with a
`SequelizeUniqueConstraintError` stack.

**What this does not close:** an address that fails on every attempt is still a statistical hint,
and timing is not addressed. Only per-tenant uniqueness removes the oracle — D-06, owner question
**Q-18**.

---

### A-38 — SCIM Groups are global roles

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium — cross-tenant disclosure and availability, not data leakage |
| **Verified** | from code, 2026-09-23 |

Roles have no `tenantId` (`role.model.js`), so through SCIM Groups:

| Operation | Effect |
|---|---|
| `GET /Groups` | lists **every** role on the platform, including groups another tenant's IdP created |
| `POST /Groups` | 409 when the name is already taken **by another tenant** — the same oracle as A-37 |
| `DELETE /Groups/:id` | destroys a non-system role for **every** tenant whose users hold it |

Membership is tenant-scoped, so the users themselves are not disclosed. `assertMutableGroup`
(A-27) already refuses system roles, which is what keeps this from being critical.

**Fix direction:** roles need tenant ownership, or SCIM Groups need to be backed by something
that has it. That is a data-model decision — ADR, not a patch.

**Decision — ADR-053.** SCIM Groups are backed by something that has tenant ownership: a new table,
`scim_groups` (`tenant_id` NOT NULL RESTRICT, `display_name`, nullable `role_id` RESTRICT). SCIM
never creates, renames or deletes a role any more. Tenant-owning `roles` itself was rejected: the
global hooks would hide every seeded (NULL-tenant) role from every tenant user. The A-39 half of the
decision — what a group grants — is recorded under A-39.

**What was changed (2026-09-24)**

| Change | Where |
|---|---|
| `ScimGroup` model, registered in the barrel | `models/scimGroup.model.js`, `models/index.js` |
| Migration **0042**: creates `scim_groups` when absent, **refuses** (naming them) while duplicates exist, then `UNIQUE (tenant_id, lower(display_name))` and `UNIQUE (tenant_id, role_id)` | `migrations/0042-scim-groups-per-tenant.js`, `config/migrator.js` |
| Every group read and write is `where: { tenantId }` explicitly (super admins skip the hooks) and goes through `findGroup`: another tenant's id, a missing id and a malformed id are the same 404 | `services/scim.service.js` |
| `POST /Groups` checks the name only inside the caller's tenant; the unique index backs it, and a lost race is the same 409 | same |
| `DELETE /Groups/:id` deletes the tenant's row and demotes its members in that tenant; no role is touched | same |
| Every multi-step group write runs in one transaction (closes the "`PATCH /Groups` is not atomic" warning in the SCIM document) | same |
| A tenant-less principal gets 403 from the group endpoints instead of a 500 from `where: { tenantId: undefined }` | same |

**Verification**

- `src/tests/routes/scim.groups.tenantOwned.a38.test.js` — real route → controller → service, tenants
  from `createTwoTenants()`, an in-memory double that behaves as the 0042 schema does (tenant filter,
  both unique indexes, transaction rollback). 45 tests. The A-38 ones:
  *"GET /Groups lists only the caller's tenant's groups"*;
  *"every :id route answers 404 for another tenant's group, byte-identical to an id that does not exist"*
  (GET, PUT, PATCH, DELETE; tenant B's group and tenant A's user unchanged afterwards);
  *"POST /Groups with a name another tenant already uses is 201 — not the 409 that disclosed it"*;
  *"DELETE /Groups/:id removes the tenant's group and no role — another tenant's members keep their role"*;
  *"SCIM never creates, renames or deletes a role"*;
  *"a principal with no tenant is refused rather than reaching the database with an undefined tenant"*.
- `src/tests/migrations/0042-scim-groups-per-tenant.test.js` — 8 tests (manifest, no try/catch,
  create-when-absent, sync-built table, re-run no-op, both refusals, down).
- `src/tests/models/tenantForeignKeys.a88.test.js` picks the new table up: `scim_groups.tenant_id`
  renders `ON DELETE RESTRICT ON UPDATE CASCADE`, NOT NULL.
- **PostgreSQL 18.6** (`pgvector/pgvector:pg18`, throwaway, removed): `up` on an empty database →
  both unique indexes and both FKs in `pg_indexes` / `pg_constraint`; `up` again → still 5 indexes;
  a case variant in one tenant → 23505 on `scim_groups_tenant_id_lower_display_name_unique`; the same
  name in the other tenant → inserted; a second group on one role → 23505 on
  `scim_groups_tenant_id_role_id_unique`; two unmapped groups → inserted; tenant delete → 23001;
  `up` over an in-tenant case duplicate (index dropped) → refused, naming tenant and name; `down` →
  table gone; a table built by the **real model's** `sync()`, then `up` → same catalog, re-run no-op.
  The service's `lower("display_name") = …` query was run against it too.

**Fail-before** (a `git worktree` of HEAD `05985ef`, removed afterwards): all 45 route tests fail
against the old code — but mostly as 500s, because the old code calls `Role.findAndCountAll` /
`Role.create`, which the new double does not model, and that alone proves nothing. The honest
fail-before was a scratch probe with a double of the **old** schema (global roles) through the same
route: tenant B creates "Engineers" → tenant A's `GET /Groups` lists `ENGINEERS`; A's `POST`
"Engineers" → **409 Group already exists**; A's `DELETE` of B's group id → **204, role destroyed**.

**Not closed:** roles an IdP created through the old code are left as global roles — nothing records
which tenant made them. See ADR-053.

---

### A-39 — A SCIM-provisioned group grants nothing, silently

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium — the `ROLE_LEVELS` trap, reached from the IdP side |
| **Verified** | from code, 2026-09-23 |

`scim.service.js#createGroup` creates the role with no `roleLevel` and no menu-group permissions,
so it takes the model default. Members of that group pass neither `rbac()` — which compares
`role.role_level` — nor `dynamicAccess`, which reads the role→menu matrix.

The IdP is told "group created". An administrator reads that as "access granted". Every member
gets nothing, and nothing says so.

This is the trap `CLAUDE.md` lists as "a new role without a `ROLE_LEVELS` entry fails every
privileged gate, **silently**" — the SCIM endpoint is a way to create exactly that role from
outside the codebase.

**Fix direction:** either refuse to create a group that carries no permission mapping, or give a
SCIM-created group an explicit, documented level and an empty-but-real permission set, and return
something in the response that says what it grants.

**The two sides.**

- *Map to an existing role by an explicit mapping.* Nothing new is invented: a group grants exactly
  what a role an administrator already configured grants, `roleLevel` and menu matrix included, so the
  `ROLE_LEVELS` trap cannot be reached from the IdP. Against it: a standard IdP pushes a group with
  `displayName` only, so if the mapping is required at creation, group push fails for Okta, Entra ID
  and OneLogin alike — and someone has to create the mapping.
- *Create a tenant-scoped group with no grants, and say so.* Every IdP works unchanged and the
  response is honest. Against it: "created, grants nothing" is still the state this card complains
  about — the admin must read an extension attribute to notice — and a membership write that
  succeeds while granting nothing is the silent failure again, one step later.

**Decision — ADR-053, a combination.** A group maps to an existing role (`roleId`) and may be created
unmapped; but an unmapped group **refuses** membership with a 409 that names the fix, and every group
response states `{ roleId, roleName, grantsAccess }` in
`urn:ietf:params:scim:schemas:extension:callibrator:2.0:Group`. A role can back a group only if it
exists, is not SUPERADMIN (A-27), is not the default USER role (removing a member demotes to it, so
removal would be a no-op), and holds at least one `role_menu_permissions` row — otherwise 400. A group
never grants nothing without saying so, and a member is never "added" to nothing.

**Verification** — `src/tests/routes/scim.groups.tenantOwned.a38.test.js`, `describe` *"A-39 — a SCIM
group says what it grants, and never grants nothing silently"*:
*"an unmapped group is created, and its response says it grants nothing"*;
*"adding a member to an unmapped group is a 409 naming the fix, and changes no one's role"*;
*"POST /Groups with members but no roleId is a 409, and no group is created"*;
*"a group mapped to a role grants it: members take the role and the response names it"*;
*"mapping to a role that grants no menu permission is refused with 400 — the A-39 role by another route"*;
*"mapping to SUPERADMIN is 403 (the A-27 guard), to the default USER role 400, to an unknown role 400"*;
*"an unmapped group can be mapped by PATCH path roleId, then accepts members in the same request"*;
*"re-mapping a group moves its members to the new role; removing roleId demotes them"*;
*"PUT without roleId keeps the mapping — an IdP rename never demotes the members"*;
*"a role backs at most one group per tenant: a second mapping is a 409 naming the first group"*.
Fail-before: the old-schema probe shows `createGroup` writing a role with no `roleLevel` and no
permission rows, answered 201.

---

### A-40 — Storage: per-process driver cache, and an unverified copy reported as migrated

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code, 2026-09-23 |

| | |
|---|---|
| `services/storage/index.js` invalidates the driver cache by deleting from an **in-process** `Map`. On more than one replica, the others keep the stale driver — including after credentials are rotated or revoked — until restart | a revoked key keeps working on replicas that did not handle the settings change |
| `storageMigration.service.js` verifies the copy only `if (attachment.checksum && …)`. A row with no checksum is copied **unverified** and reported `status: "migrated", verified: false` | the operator-facing claim is "verified copy"; for those rows it is not |

**Fix direction:** invalidate across replicas (the Redis client is available and now works), and
either compute a checksum before copying or report the row as `migrated-unverified` in a way the
operator cannot miss.

---

### A-41 — Audit rows are written after the response, outside the transaction

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — for the covered set |
| **Severity** | **high — compliance evidence that does not match what happened** |
| **Verified** | from code, 2026-09-23 |

`CLAUDE.md` states the rule without qualification: *every mutation writes an audit row, inside the
transaction.* `auditLog.middleware.js#recordAudit` registers itself on `res.on("finish")`, and its
own JSDoc describes it as "best-effort and non-blocking".

So it runs **after** the response is sent, outside any transaction:

| Case | Result |
|---|---|
| the action rolls back after the response is queued | an audit row records something that did not happen |
| the audit insert fails | the action is committed and unattributable |

Both are exactly the two failures the rule exists to prevent, and the second is invisible (A-42).

**Fix direction:** mutations that carry compliance weight write their audit row inside the same
transaction as the change — services, not middleware. The middleware can stay for the rest, but it
must not be what ISO 17025 / 21 CFR Part 11 attribution depends on. This needs a decision about
which mutations are in that set, so it starts as a spec, not a patch.

**Verification (DoD)**
- [x] a rolled-back mutation leaves **no** audit row (test with a forced rollback)
- [x] a failing audit insert rolls the mutation back
- [x] the list of mutations covered is written down, not implied

**What was changed (2026-09-24).** The spec came first:
[`MEMORY/specs/A-41-audit-inside-transaction.md`](../MEMORY/specs/A-41-audit-inside-transaction.md).
It names **25 mutations**, and each now writes its row through
`auditService.logAction(entry, { transaction })` in the same transaction as the change:

- **certificates:** create, update, delete, submit, approve, sign, revoke. For approve, sign and
  revoke, the `ESignatureRecord` is in the transaction too.
- **calibration records:** create, update, delete. The create includes the device's
  `nextCalibrationDate`.
- **e-signatures:** sign and revoke.
- **attachment delete, SOP publish and tenant restore:** these were already transactional and are
  now on the same call.
- **roles:** all seven role and menu operations.
- **user permission overrides:** set and remove.
- **the retention purge** — W-04.

Operations with no action value of their own (revoke, sign, submit, restore, purge) are recorded
under the nearest one, with `changes.operation` naming them. The action list now lives in one place,
`constants/auditActions.js`. Cache invalidation happens **after** commit.

**Found while fixing — A-61.**

**Tests.** They run against `tests/fixtures/auditLedger.js`, a transactional ledger that reads the
**real** ENUM and NOT NULL columns from `auditLog.model.js`. It rolls back on `COMMIT` of an aborted
transaction, as PostgreSQL does. The tests are `certificate.audit.a41.test.js`,
`calibrationRecords.audit.a41.test.js`, `esignature.audit.a41.test.js` and
`roles.audit.a41.test.js`. Of their 81 tests, **58 failed against the old code**.

**Not covered:**
- **Still best-effort through the middleware:** user create, update and delete.
- **Still writing no audit row at all:** menu groups, e-signature key pairs, workflows, SOP create
  and update, training acknowledgement.
- **Written outside the transaction:** GDPR erasure and rectification.
- **Open questions:** Q-12 to Q-14.

---

### A-42 — A failed audit write is announced only to stdout, which production discards

| | |
|---|---|
| **Status** | **PARTIAL** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-23 |

`audit.service.js#logAction` catches a failed insert, calls
`console.error("Failed to write audit log (CRITICAL):", error)` and returns `null`.

Two things make that worse than it looks:
1. the logger's Console transport is **development-only**, so in production the message goes to a
   stream nothing collects — `docker logs` shows it, the log files do not;
2. there are **25 `console.*` call sites** in runtime backend code, all with the same property.
   `docs/ENGINEERING/12-LOGGING-CONVENTIONS.md` claims `config/socket.js` is "the only application
   output that reaches stdout in production" — corrected 2026-09-23.

A compliance record that fails to write therefore fails **silently and durably**.

**Fix direction:** route it through winston at `error` level so it lands in the file sinks; decide
whether a failed audit write should also fail the request (see A-41). Sweep the other 24 sites.

**What was changed (2026-09-24).** `logAction` reports a failed write through winston at `error`,
with the tenant, user, action, resource and stack, and `console.error` is gone.

- **Inside a transaction,** the failure is **re-thrown**, so the mutation rolls back and the client
  gets an error.
- **Outside a transaction** (the after-response middleware), it is logged and returns `null`,
  because the change has already committed.
- **An out-of-ENUM action** is refused before the insert.

Tests: `audit.service.a42.test.js`. 4 of its tests failed against the old code, including *"inside a
transaction, a failed write is re-thrown"* and *"out-of-ENUM action (RESTORE) is refused"*.

**Still open:** the sweep of the other 24 `console.*` call sites.

---

### A-43 — `auditAction` logs full request and response bodies, unredacted

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — deleted |
| **Severity** | medium — no live leak, because it has no caller |
| **Verified** | from code, 2026-09-23 |

`auditLog.middleware.js#auditAction` logs `body: req.body` and `response: body` at `info` into
`log/activity/combined/`. There is no redactor anywhere in `backend/src` — the only `redact`-shaped
code is GDPR anonymisation and per-response secret hiding. On a login route this writes plaintext
passwords to disk.

It has **no caller outside its own tests**. That is the only reason this is not an active leak,
and it is also why nobody has noticed: it is a loaded gun, covered by tests, waiting to be wired up.

**Fix direction:** delete it, or give it a redaction allow-list and a reason to exist. Do not leave
it as is. `docs/DEVOPS/06-LOGGING.md` § Redaction describes a redactor as as-built; that is a target
and is corrected.

**What was changed (2026-09-24) — deleted.** A repository-wide search (routes, controllers,
services, `index.js`, every test, the `jest.mock` factories of `auditLog.middleware`) found no
reference to `auditAction` outside its own two tests. It is removed from
`backend/src/middlewares/auditLog.middleware.js` and from the exports, which are now
`{ withAudit, recordAudit }`. Its two tests in `src/tests/middlewares/auditLog.test.js` were
replaced by "A-43: is no longer exported — the body-logging helper was deleted", which fails
against `HEAD`. `withAudit` (actor, ip and user agent, no bodies) also has no caller and was left
as is. Independently, every winston line now passes through the A-14 redactor, so a body logged by
any future helper is redacted on its way to stdout or file.

---

### A-44 — The access log was never pruned

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium — unbounded disk growth on the deployment |
| **Verified** | against the installed library, 2026-09-23 |

`accessLog.middleware.js` passed `{ interval: "1d", compress: "gzip", history: "30d" }` to
`rotating-file-stream`. In that library `history` is **the name of the rotation-history file**
("Specifies the history filename", its README § history) — retention is `maxFiles` / `maxSize`.

So nothing pruned the access log, and a bookkeeping file literally named `30d` was created in
`log/access/`. `docs/DEVOPS/06-LOGGING.md` recorded this as "30 days" retention.

**Fix:** `maxFiles: 30` with the daily interval, and the misleading `history` option removed. The
stale `30d` file on any existing deployment can be deleted by hand.

---

### A-45 — A decommissioned IoT device still ingested, and one bad message shut the server down

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high** — an availability defect reachable from an unauthenticated MQTT topic |
| **Verified** | from code, 2026-09-23 |

Two defects in the same module, both found while documenting it:

| | |
|---|---|
| `iot.controller.js` and `iot.service.js` look the device up with `.unscoped()` — needed to cross tenants, since ingest arrives with a device token rather than a session — which also drops the `defaultScope` that excludes soft-deleted rows. **A device that was decommissioned kept ingesting.** | the soft-delete predicate is now carried explicitly: `isDeleted: false` |
| the MQTT message handler called `this.ingestReading(...)` **unawaited and uncaught**; its `try` covers only `JSON.parse`. An unknown or disabled device id rejected, reached the process-level `unhandledRejection` handler in `index.js` — which calls `shutdown()`. **One stale retained message on the broker shut the backend down.** | the call now has a `.catch` that logs and continues |

**Verification** — `npx jest src/tests/services/iot src/tests/controllers/iot` → 68 tests, 100 % on
both files. Named: "carries the soft-delete predicate explicitly on the unscoped lookup" and
"logs a failed ingest instead of taking the process down" (which asserts no `unhandledRejection`
fires).

**Residual:** the MQTT path is off on the reference deployment (`MQTT_HOST`/`MQTT_PORT` unset), so
the shutdown defect was never reachable there. Not verified against a live broker.

---

### A-46 — IoT anomaly detection is structurally dead

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium — a documented feature that cannot fire |
| **Verified** | from code, 2026-09-23 |

`readingTolerance` is as unprovisionable as the device token A-29 describes: it is absent from both
Joi schemas in `calibrationDevices.validator.js`, which strip unknown keys, and there is no route
and no UI that sets it. It is therefore always `null`, the comparison in `iot.service.js` never
runs, `isAnomaly` is always `false`, and **no anomaly notification can ever fire**.

A-29 covers the token; this is the second half of the same hole, and predictive maintenance —
documented as deriving risk "from IoT readings" — sits downstream of both.

**Fix direction:** provision it with the token, in one admin surface; until then the feature is
described as planned, not built.

**Also open (same module, lower severity):** ingest writes no `audit_logs` row; the anomaly log line
inlines the whole payload, against the "no full bodies" rule; and
`src/tests/e2e/modules/iot.e2e.test.js` expects **400** for an empty body where the code throws
**401** first — an E2E assertion that looks like it cannot pass, unverified because the live suite
has never completed a run (P6-02).

**What was changed (2026-09-24)** — with A-29, in the one admin surface the fix direction asked for.
`PATCH /api/v1/iot/devices/:deviceId` accepts `readingTolerance` (`validators/iot.validator.js`:
`{ metric: { min?, max? } }`, at least one bound, `min <= max`, metric names `[A-Za-z0-9_.-]{1,64}`,
at most 50; `null` clears it; a bad name or a misspelt bound is **refused**, not stripped — a
tolerance that silently lost a bound would never fire) and `iotEnabled` (enabling a device with no
token is a 409 state explanation). The devices page's IoT dialog edits it. Of the "also open" items:
the anomaly log line now carries the metric names and findings, not the payload; the E2E assertion is
corrected to **401**, with a 401 case for an unknown token added — still not run live (P6-02).
Ingest still writes no `audit_logs` row (left open).

**Verification** — `src/tests/routes/iot.provisioning.a29.test.js`: *"PATCH sets readingTolerance; an
out-of-tolerance reading is flagged and notifies (end to end)"* (PATCH, then ingest
`{ temperature: 42 }` against `max: 30` through the real controller and `iot.service` →
`isAnomaly: true`, an `IotReading` stored with `isAnomaly`, a `system` notification naming the
breach), *"a below-min reading is flagged; an in-tolerance reading is not"*, eight *"an invalid PATCH
is 400 and changes nothing: …"* cases, *"enabling ingest on a device with no token is a 409 state
explanation"*; frontend `IotDeviceModal.a29.test.tsx` *"A-46: saves the reading tolerance through
the API"*. Fail-before as A-29 — the route did not exist at HEAD.

---

### A-47 — No electronic signature can ever verify

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 — [ADR-040](../MEMORY/DECISIONS.md) |
| **Severity** | **critical — the evidence the 21 CFR Part 11 and ISO 13485 claims rest on** |
| **Verified** | from code, 2026-09-23, by the orchestrator |

**Root cause:** `eSignature.service.js#generateSignatureHash(documentId, userId, tenantId)` hashes
`${documentId}:${userId}:${tenantId}:${Date.now()}`. `verifySignature` recomputes that **same
function** and compares it to the stored hash. Because `Date.now()` is inside the payload, the two
values can never be equal: **`verifySignature` returns `valid: false` for every genuine
signature.**

And there is nothing behind it. `verifySignature` reads **no key**. The tenant RSA key pairs are
generated, stored encrypted, listed and deleted through the API — and used to sign nothing. The
"electronic signature" is a SHA-256 of a timestamp. It binds no document, identifies no signer and
cannot be verified by anyone, including this system.

**What this means for the compliance claims:** 21 CFR Part 11 § 11.70 requires the signature to be
linked to its record so it cannot be excised, copied or transferred. A hash that includes the
current time is linked to nothing. Any audit of this feature ends here.

**In progress:** a real RSA-SHA256 signature over a deterministic canonical payload, verified with
the tenant public key, with soft-deleted keys still loadable so a key deletion does not invalidate
past signatures, and existing records marked distinguishably rather than reported as forgeries.
That is a design change, so it lands with an ADR.

**Verification (DoD)**
- [ ] a genuine signature verifies as **valid** — the case that fails today
- [ ] a record tampered with after signing verifies as invalid
- [ ] a signature whose key was soft-deleted still verifies
- [ ] a record signed under the old scheme is distinguishable from both a valid and a forged one
- [ ] an ADR records the decision and what happens to the signatures already stored

---

**What was changed (2026-09-23) — ADR-040**

`generateSignatureHash` is **deleted**. Signing now produces an RSA-SHA256 signature with the
tenant's private key over a canonical payload binding scheme, algorithm, tenant, document,
workflow, workflow step, signer, `signedAt`, authentication method and the signature's *meaning*.
The payload is a JSON **array of `[name, value]` pairs** in a fixed order, so key ordering cannot
drift and a NULL column cannot diverge from an empty string. `signedAt` is fixed **once**, before
signing, and verification reads it from the stored column — nothing is ever derived from the
verification-time clock.

Verification loads the key with `paranoid: false`, so a **soft-deleted key still verifies its past
signatures**, and returns a `verificationStatus` enum rather than a bare boolean. Signing with no
key pair provisioned is a **409** with a remedy, not a 500. Migration `0019` adds
`signature_value`, `signing_key_id`, `signature_scheme` and `signature_reason` — nullable, and
**no backfill**: signing an old record today would assert a property it never had, which is
falsifying a Part 11 record.

**Records already signed** are reported `unverifiable_legacy` — never valid, never a forgery,
because the original scheme bound nothing and cannot tell them apart. **On the reference
deployment this is moot: `signature_records` is empty** (checked 2026-09-23 — 0 signatures, 0
workflows, 0 tenant keys). The feature was never used, which is the only reason this is a bug fix
rather than an archive recovery.

**Verification** — 6 suites, 116 tests, 100 % on `eSignature.service.js`. The new suite uses a
**real** RSA key and the real at-rest wrapper, not a mocked signer — a mocked signer is the class
of test that let this live. Named: "verifies as valid — the case that could never pass before
ADR-040", "verifies as INVALID when the signing timestamp is changed after signing", "still
verifies a signature whose key has been soft-deleted", "is reported as unverifiable_legacy —
neither valid nor a forgery", "fails with 409 and an actionable message when no key pair is
provisioned".

**Not done, and named rather than buried**
- **Migration 0019 has not been run.** No database was reachable from the machine that wrote it.
  Confirm the four columns in `psql` after `make migrate` — the log is not evidence.
- `signature_reason` is bound but the controller and validator do not accept a `reason`, so it is
  always NULL: signatures currently bind an **empty meaning**. Residual § 11.50(a)(3) gap.
- The e-signature private keys are wrapped with `ENCRYPT_KEY` directly rather than through
  `kms.service.js` like every other tenant secret — now the weakest link in the chain.
- Key rotation is undesigned; a **hard** delete of a key makes its signatures permanently
  unverifiable; there is no trusted timestamp; and per-tenant keys prove the *service* signed, not
  the person.


---

### A-48 — Revocation does not revoke

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code and the **running deployment's** configuration, 2026-09-23 |

**Root cause:** `auth.middleware.js` states its own scope in a comment — *"RBAC Only - No Session
Validation"* — and it means it. It verifies the JWT and loads the user. It never reads the
`sessions` table. Nothing else in the request path does either, now that the dead
`sessionSecurity.middleware.js` is gone (A-12).

So revoking a session, logging out, or an administrator terminating someone's access changes a row
that **no request ever consults**. The access token keeps working until it expires on its own.

**How long is "until it expires":** `.env.example` says `JWT_ACCESS_EXPIRED=15m`. The running
deployment on 10.1.200.13 is configured `JWT_ACCESS_EXPIRED=1d`, and so is the local `.env`. So a
revoked session stays usable for up to **24 hours**, not fifteen minutes — and the documented
figure is the one nobody is running.

**Why it matters here specifically:** this is the control an administrator reaches for when
credentials are suspected stolen, when someone leaves, or when a tenant is suspended mid-session.
It reports success and does nothing for a day. `docs/BACKEND/10-MODULE-REFERENCE.md` § 23 already
recorded the gap as "~15 minutes"; the real window is the deployed token lifetime.

**Fix direction:** check the session on each request — the token already carries enough to find it,
and the lookup is cacheable in Redis (now working, A-24) so it need not be a database read per
request. Failing that, shorten `JWT_ACCESS_EXPIRED` to the documented 15 minutes and say plainly
that revocation is eventual, with the window named. The first is the control; the second is an
honest mitigation. Either way, the deployed value and the documented value must be the same number.

**Verification (DoD)**
- [ ] a revoked session's access token is rejected on the next request
- [ ] a suspended tenant's live sessions stop working without waiting for expiry
- [ ] `JWT_ACCESS_EXPIRED` is the same in `.env.example`, the VM and the documentation
- [ ] the same question answered for Socket.IO, whose checks are connect-time only (A-05, Q-08)

---

**What was changed (2026-09-24) — and this card's own fix direction was wrong.** It said *"the token
already carries enough to find it"*. It did not: the access token was `{id, email}`, with **no
session identifier**, and the session row held only the hash of the opaque refresh token. Nothing
connected the two, so revocation could not have been checked however it was cached.

Access tokens now carry `sid`. Login, MFA login, refresh and impersonation create the session
**first** and sign its id into the token. On each request the middleware checks that session is live
through `session.service.isSessionLive`, which reads Redis and falls back to one primary-key read,
filtering on the **snake_case** `is_revoked` and `is_active` columns. Revocation deletes the cache
entry — through model hooks, so the admin path in `session.controller.js`, which updates the model
directly, is covered too. A refresh revokes the previous session, so the old access token dies on its
next request. An impersonation token is now bounded by its session's one-hour expiry instead of the
full day.

**Redis down:** every request reads the database and revocation is **still enforced**. It does not
fail closed — a Redis outage should not sign every user out.

**Logout had never worked server-side**, found while fixing this. `auth.controller.logout` called
`authService.logoutSession()` with **no argument**, so it threw a TypeError and returned a 500 — which
the frontend's logout route swallowed. And even given a request, it hashed the **access** token and
compared it with **refresh**-token hashes, which matches no row. So every logout in this system's
history revoked nothing.

**Proof** — `auth.sessionRevocation.a48.test.js` runs the real middleware, service, JWT signing and
the Session model through Sequelize's PostgreSQL SQL generation, against a fake table with
hardcoded snake_case columns that **rejects unknown columns the way PostgreSQL does** — so a
camelCase slip fails the test instead of passing it. 29 tests failed against the old code. Named:
*"a revoked session's access token is rejected on the next request"*, *"a logged-out user's token
stops working"*, *"Redis down: every request reads the database, and revocation is still enforced"*.

**The suspended-tenant item was already covered** and is unchanged: the user and tenant are read from
the database on every request with no cache, and a suspended tenant is refused.

**Not closed — A-59:** tokens without a `sid` are still accepted, for compatibility with tokens
issued before the deploy. That leaves every SSO token unrevocable (`sso.controller.js` signs
`{id, email}` and discards the session) and the activation-token hole below.


### A-49 — SCIM leftovers after A-33

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23, while amending `docs/DEVELOPER/09-SCIM-PROVISIONING.md` |

Four things the A-33 work did not cover, found by reading the module against its own document:

| | |
|---|---|
| **`GET /Groups` `displayName eq` is case-sensitive against an uppercased column.** The filter assigns the value raw while `createGroup` stores `displayName.toUpperCase()`. An IdP probing `displayName eq "Engineers"` gets zero results, POSTs, and gets **409 Group already exists** | the same existence-oracle shape as A-37, reached a different way |
| **A patch `value` is never UUID-validated.** `scimUserSchema.roleId` and `scimGroupSchema.members[].value` are `Joi.string().uuid()`, but `scimPatchSchema.value` accepts any object, array, string, boolean or number. A path-form `roleId` carrying a malformed id reaches `Role.findOne({ where: { id } })` against a `UUID` column | a driver error rendered as a **500** where a 400 is owed. Inferred from the schema, not observed live — worth confirming before fixing |
| **`src/tests/e2e/modules/scim.e2e.test.js` cannot pass as written.** Its header asserts SCIM endpoints return the SCIM envelope "NOT the platform envelope — this is by spec", and it reads `body.Resources` / `body.id`. The controller wraps everything in `success()`, and the e2e setup does no unwrapping, so the real paths are `body.data.Resources` / `body.data.id` | two of the four live specs would fail. Either the envelope is fixed (the document says no compliant SCIM client can parse it today) or the spec is — and the choice is the same one A-33's "still open" list names |
| **`userName eq` filters on `email` only** | a user whose `username` differs from their email is unfindable by the filter an IdP uses to decide whether to create them |

`GET /Groups` also still ignores an unsupported filter and returns every role on the platform,
which is now inconsistent with `GET /Users`, and its `count` is unbounded.

**Fix direction:** lower-case the `displayName` comparison (or store it as given and compare
case-insensitively — pick one and record it); validate patch values against the same UUID rule the
other schemas use; and decide the envelope question, because the e2e spec and the document
currently disagree about what this endpoint is supposed to return.

**What was changed (2026-09-24)**

| Item | Resolution |
|---|---|
| `displayName` oracle | **stored as given, compared case-insensitively, per tenant** (ADR-053): `lower(display_name)` in the filter and the duplicate check, `UNIQUE (tenant_id, lower(display_name))` in migration 0042. The probe and the create now agree, and another tenant's name is invisible |
| patch values | every id in a patch value — `roleId` on a user or a group, each member id, the id inside Okta's `members[value eq "…"]` — is UUID-checked in the service before any query: **400** `SCIM … must be a UUID`. Confirmed first on PostgreSQL 18: comparing a UUID column with `'not-a-uuid'` raises **22P02**, which surfaced as a 500. A malformed group id in the URL is the ordinary 404 |
| e2e spec | fixed to the **as-built** envelope (`body.data.Resources`, `body.data.id`), and extended to assert that an unmapped group says it grants nothing and that an upper-case `displayName eq` finds it. **Not run** — it needs a live server |
| `userName eq` | matches `email` **or** `username` |
| `GET /Groups` filter and `count` | an unsupported filter is **400**, as on `/Users`; `count` is capped at 200 |
| member removal | a `remove` naming a user demotes them **only if they are a member**. Before, removing someone from a group they were not in stripped whatever role they held |

**The envelope is not decided here — Open.** Raw RFC 7644 bodies (and SCIM `Error` bodies) are the
right target, since no compliant SCIM client can parse the platform envelope, but that changes every
SCIM response and the error output for these routes; it is not a leftover fix. The spec now tests
what the server sends; `docs/API/13-INTEGRATION-API.md` still claims otherwise.

**Verification** — `src/tests/routes/scim.groups.tenantOwned.a38.test.js`, `describe` *"A-49 — …"*:
*"displayName eq finds a group however the IdP capitalises it"*;
*"a case variant of the caller's own group is a 409 — the probe and the create now agree"*;
*"a rename onto another group's name is a 409; a rename onto its own name in another case is allowed"*;
*"an unsupported group filter is a 400, as it is on /Users — not every group"*;
*"count is bounded at 200"*;
*"a malformed member id in a patch value is a 400, not a driver error"*;
*"a malformed roleId in a user patch is a 400, not a driver error"*;
*"removing a user who is not a member leaves their real role alone"*;
*"a multi-operation PATCH that fails partway changes nothing"*;
*"losing the race to the unique index is the same 409, not a 500"*.
`src/tests/services/scim.service.test.js` › *"narrows to one user on a userName eq filter"* now asserts
the `email`-or-`username` predicate. Fail-before (old-schema probe on HEAD): `displayName eq
"Engineers"` → **0 results** while `ENGINEERS` existed; `filter=externalId eq "x"` → **200 with every
group**.

Coverage: `scim.service.js` and `scim.validator.js` at 100 % statements, functions and lines, and
`scim.service.js` 100 % branches, across the SCIM suites plus the FK guard and the 0042 test (9 suites,
464 tests).

---

### A-50 — Webhook deliveries followed redirects, walking past the SSRF check

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high — SSRF from inside the deployment** |
| **Verified** | from code, 2026-09-23, while documenting the module |

**Root cause:** `webhook.service.js` called `fetch(webhook.url, { … })` with no `redirect` option, so
Node's default (`follow`) applied. The SSRF defences are real and well placed —
`assertSafeUrl` on create and update, and `assertResolvedHostIsPublic` immediately before **every**
attempt, retries included — but they validate the **registered** URL.

A host that passes both layers can answer `302 Location: http://169.254.169.254/latest/meta-data/`
and this process fetches cloud metadata from inside the deployment, signs nothing about it, and
records the result. Registering a webhook is now tenant-admin-only (A-02), which narrows who can
do it; it does not make the request safe.

**Fix:** `redirect: "manual"`, and a 3xx is recorded as a delivery failure with a message telling
the operator to re-register at the new URL. A receiver that wants to move must say so through the
API, not through a redirect.

**Verification** — `npx jest src/tests/services/webhook` → 26 tests, 100 % on the file. Named:
"does not follow a redirect, and records it as a delivery failure", which asserts both the
`redirect: "manual"` option and the recorded `lastError`.

---

### A-51 — Webhook routes have no validator, and the signing secret is caller-supplied

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-23 |

Four problems with one root: **none of the seven webhook routes mounts `validate(schema)`.**

| | |
|---|---|
| the controller spreads `{ ...req.body }` into `createWebhook`, which honours a caller-supplied `secret` | `{"secret":"a"}` creates a webhook whose HMAC signatures are trivially forgeable. The secret is never displayed again and nothing warns |
| `url`, `events` and `isActive` are unvalidated beyond the service's own two checks | shape errors surface as 500s or as silently inert subscriptions |
| `webhooks.secret` is stored **in plaintext** — no KMS, not in `SENSITIVE_KEYS`, unlike tenant storage credentials | a database read or a backup yields every tenant's signing key |
| `updateWebhook` patches only `url`, `events`, `description`, `isActive` — there is **no rotation** | a leaked secret can only be replaced by delete + re-register, with a new id and a delivery gap. Worse: patching the `url` keeps the old secret, so the new host is signed with a key the old host still holds |

**Fix direction:** a Joi schema on every route; the secret is generated server-side only and never
accepted from a caller; store it through `kms.service.js` like the other tenant secrets; add a
rotation endpoint that returns the new secret once, with an overlap window if receivers need one.

**What was changed (2026-09-24).** `validators/webhook.validator.js` mounts on every webhook route,
and a `secret` key in the body is **stripped** (the validator runs with `stripUnknown: true`), so
a caller can no longer choose the key. The
secret is generated server-side, returned exactly once, and stored through `kms.service.js`.
Migration `0022-encrypt-webhook-secrets` re-encrypts the existing plaintext rows, and it fails loudly
rather than being skipped. `POST /webhooks/:id/rotate-secret` issues a new secret. **Changing the
`url` now rotates the secret too**, because a new host must not be signed with a key the old host
still holds. Tests: `webhook.validator.test.js`; `webhook.service.test.js` › *"creates a webhook and
returns the server-generated secret"*, *"updates webhook parameters (a url change also rotates the
secret)"*.

**Not done:** there is no overlap window, so receivers must switch to the new secret at the moment
of rotation. The frontend `WebhookModal` does not yet show a rotated secret or offer a rotate button
(**F-18** on the frontend board).

---

### A-52 — The socket token's `purpose` claim is read nowhere

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — fixed under A-59 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

`auth.controller.js` mints the socket token as `jwt.sign({ id, purpose: "socket" }, …)`. Nothing
reads `purpose` — `jwt.util.js` enforces only the `typ` claim (A-31), which this token does not
set, and the socket handshake calls the same `verifyAccessToken` the HTTP layer does.

So **a socket token is a valid HTTP access token** for its 300 seconds, and any ordinary access
token is a valid handshake token. The 5-minute lifetime is shorter than `JWT_ACCESS_EXPIRED`, so
this narrows rather than widens — but the claim reads as a control and is not one, which is the
kind of thing a reviewer relies on.

It also signs with `process.env.JWT_ACCESS_SECRET` directly, bypassing the key registry that
exists to support rotation: after a rotation the minted token and the verifier can disagree.

**Fix direction:** give it `typ: "socket"` and enforce it in the handshake (the A-31 machinery is
already there), and mint it through the same registry as every other token.

---

### A-53 — A reconnected socket never re-joins its board rooms

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium — user-visible, and silent |
| **Verified** | from code, 2026-09-23 |

`frontend/.../useBoard.ts` emits `kanban:join` once, from a `useEffect` keyed on `projectId`. The
client has `reconnection: true`, and a reconnect produces a **new socket id with empty server-side
room membership** — so after any reconnect, live board updates stop. REST data stays correct,
which is exactly what makes it hard to notice: the board looks fine and quietly stops moving.

It also passes **no ack callback**, and the server supports one, so a refused join is invisible too.

**Also found in the same sweep:** `super_admins` is a room nothing emits to any more; a tenantless
principal joins a literal `tenant_null` room; and of eighteen `kanban:*` server events, six are
emitted and listened to by nobody.

**Fix direction:** re-emit `kanban:join` on the client's `connect` event, and pass the ack so a
refusal surfaces.

**What was changed (2026-09-24)** — client side; the server contract is unchanged.

- `frontend/src/lib/socket.ts` gains `joinBoardRoom(socket, projectId, onRefused)`. It records the
  subscription in a module-level set, joins now if connected, and the singleton's `connect`
  handler — which fires on the first connection **and every reconnection** — replays `kanban:join`
  for every recorded subscription. The join passes the ack; `{ ok: false }` calls `onRefused`. The
  returned unsubscribe emits `kanban:leave` only when the last subscriber for that board goes and
  the socket is connected. `disconnectSocket()` clears the set, so the next principal inherits no
  subscriptions (F-01), and a `connect` on a socket from an ended session replays nothing.
- `frontend/src/app/dashboard/kanban/[projectId]/hooks/useBoard.ts` uses it instead of a single
  `emit`; a refusal sets the board error "Live updates are unavailable: …".

**Verification** — against a **real** in-process Socket.IO server and the real `socket.io-client`
(not a mock): `useBoard.realtime.test.ts` —
"A-53: re-joins the board room after a reconnect, so a later board event still arrives" (drops the
engine with `client.io.engine.close()`, waits for the client's own reconnect, asserts the new
server-side socket is back in `board_<id>` and that a `kanban:card:created` emitted to the room
reaches the store), "A-53: a refused join surfaces as a board error instead of silence", and
"A-53: an unmounted board leaves its room and is not re-joined on reconnect". Bookkeeping branches:
seven `lib/socket joinBoardRoom (A-53)` cases in `src/lib/socket.test.ts`. **Fail-before**, same
test file on a `git worktree` of HEAD `05985ef`: the first two fail (room membership after
reconnect `0`, expected `1`; board error `null`); the third passes on both, as it should.

Not addressed (recorded above, out of this row's scope): the `super_admins` room nothing emits to,
the `tenant_null` room, and the six `kanban:*` events nobody listens to.

---

### A-54 — No Socket.IO adapter: a second replica splits the fan-out

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium — an architectural constraint, not a live defect |
| **Verified** | from code and the Helm values, 2026-09-23 |

The server is constructed with the default in-memory adapter; neither `@socket.io/redis-adapter`
nor `socket.io-redis` is a dependency. That is consistent with `backend.replicaCount: 1` in the
Helm values, and it is a **hard blocker on ever raising it**: with two replicas, a notification or
board update reaches only the users connected to the process that emitted it. Sticky sessions do
not fix this — the emit happens server-side, not per client.

Worth recording next to A-30, which made the rate limiter replica-safe: the limiter is ready for
more than one replica now, and the realtime layer is not.

**What was changed (2026-09-24)**

- Dependency: `@socket.io/redis-adapter` `^8.3.0` in `backend/package.json`, installed from the root
  (`npm install @socket.io/redis-adapter@latest --workspace backend`). Root `package-lock.json`
  gained exactly four packages: `@socket.io/redis-adapter@8.3.0`, its nested
  `debug@4.3.7`, `notepack.io@3.0.1` and `uid2@1.0.0`. None has an install script, so
  `allowScripts` is unchanged; `npm audit` → 0 vulnerabilities. The `pkg` build needs no config
  change: the adapter is plain CommonJS reached by a literal `require`, which pkg follows.
- `backend/src/config/socket.js` — `attachAdapter(io)`, called by `initSocket`. When the shared
  client from `redis.service.js` is `ready` (index.js awaits `initRedis()` before `initSocket()`),
  it installs `createAdapter(pub, sub)` on two `duplicate({ lazyConnect: false })` connections,
  which inherit the URL, credentials and `protocol: 2`, each with an `error` listener. Otherwise —
  no client, client not ready, or client construction throwing — it keeps the in-memory adapter
  and logs `IN_MEMORY_WARNING` ("… run exactly one backend replica until Redis is configured").

**Verification** — `socket.redisAdapter.live.test.js` (opt-in, `REDIS_LIVE_TEST=1`, the A-30
convention), run against a real `redis:8.6-alpine` (Redis 8.6.7, ioredis 6.0.0), container removed
afterwards: "A-54: an emit on replica A reaches a client connected only to replica B" — two
separately loaded copies of `config/socket.js` + `redis.service.js` on two ports, a real
`socket.io-client` on B joins a board through the real `kanban:join` handler, `emitToBoard` on A,
the event arrives; and "A-54: falls back to the in-memory adapter, with a warning, when Redis is not
ready". Unit branches: six `attachAdapter (A-54)` cases in `socket.test.js`. **Fail-before**, on a
`git worktree` of HEAD `05985ef`: the adapter is `Adapter`, not `RedisAdapter`; with the adapter
assertions removed, the event emitted on A **never arrives** at the client on B (3 s timeout).

**Still open:**
- `backend.replicaCount` stays `1`. Raising it also needs **sticky sessions** at the ingress: the
  client allows the long-polling transport as a fallback, and Engine.IO polling requests must land
  on the replica that holds the session. The adapter fixes the fan-out, not that.
- The adapter's two connections are not closed on graceful shutdown (index.js is outside this
  change); process exit ends them.
- A Redis outage after startup is ridden out by ioredis reconnecting the duplicates; events emitted
  during the outage are lost, which is the same best-effort contract `emitToBoard` already had.

---

### A-55 — `createTwoTenants()` does not exist

| | |
|---|---|
| **Status** | **corrected** 2026-09-23 |
| **Severity** | medium — it is the reason a non-negotiable is not being followed |
| **Verified** | repo-wide grep, 2026-09-23 |

`CLAUDE.md` states: *"Every new `:id` route needs a two-tenant test asserting 404 … `createTwoTenants()`
is a one-line fixture precisely so this gets written."* The helper appears in `CLAUDE.md` and eight
`docs/` files and in **zero** code files.

So the instruction that is supposed to make the test cheap points at something that does not exist,
and the test that `CLAUDE.md` calls mandatory is written for almost no route. This is the PR-4 shape
in the file that opens by warning about the PR-4 shape.

**Corrected in `CLAUDE.md`** on 2026-09-23 to say the fixture does not exist and that writing it is
the first step. The fixture itself is not written yet — that is the open half.

**Verification (DoD)**
- [x] `CLAUDE.md` no longer cites a helper that does not exist
- [ ] the fixture exists, and one `:id` route uses it
- [ ] the eight documents that cite it are corrected or point at the real thing

---

### A-56 — Search swallows every query error into an empty list

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | low |
| **Verified** | from code, 2026-09-23 |

`search.service.js` catches broadly around the full-text query, retries as `ILIKE`, and on a second
failure returns `[]`. So a statement failing for any reason — a missing column, a type error, a
permission problem — renders as **"no results"**.

That is the failure shape `CLAUDE.md` calls the most repeated defect in this codebase: a list that
silently returns nothing. The fallback itself is reasonable; swallowing the second failure is not.

**Fix direction:** keep the FTS → ILIKE fallback, but let a second failure surface as a 500 with the
request id, and log both causes.

**Done 2026-09-24. Decision: fail the request (500), not partial results.**

A type that fails on both FTS and ILIKE now throws `AppError(500, "Search failed for <type>",
isOperational=false)` after logging both causes (`ftsError`, `ilikeError`) with the type. The
controller's `asyncHandler` answers it: outside production with that message; in production with the
generic message plus `requestId`, never the SQL text (the A-132 rule). The frontend (`GlobalSearch.tsx`,
via `searchErrorMessage` in `api/services/search.service.ts`) shows "Search failed: … (reference <id>)",
not "No results".

*Alternatives considered:*

- **Partial results with a per-type error marker in `meta`** (e.g. `meta.failedTypes: ["certificate"]`
  on a 200). Better availability: a broken certificates table would not take device search down with it.
  Rejected because every consumer has to learn to read the marker, and one that does not (the E2E spec,
  an API client, a future screen) reads a partial list as complete. That is the silent-empty shape this
  card exists to remove. A statement failing here is a defect (missing column, missing grant), not a
  runtime condition to degrade around, so it should be loud until fixed.
- **Keep `[]` and log louder.** Rejected: the user still sees "no results" for a broken query.
- **Surface the first (FTS) failure too.** Rejected: FTS failing is expected on a database without
  `search_vector`, and the ILIKE fallback is the designed behaviour.

*Bad implication, accepted:* one broken type fails the whole search, including the types that worked.

*Evidence.* `backend/src/tests/services/search.service.test.js`: *A-56: fails the search with a
non-operational 500 when BOTH FTS and ILIKE fail, logging both causes* (replaces "degrades to no results
for a type when BOTH FTS and ILIKE fail", which pinned the defect) and *A-56: one failing type fails the
whole search instead of returning the others as a complete answer*.
`backend/src/tests/controllers/search.twoTenants.a56.test.js`: *answers 500 with success:false when a type
fails on both FTS and ILIKE* and *in production shows the generic message and the request id, never the
SQL error*. `frontend/src/components/layouts/__tests__/GlobalSearch.a56.test.tsx`: *shows the failure and
the request id when the backend answers 500*, *shows the failure without a reference when the body has no
request id*, *still says 'No results' for a search that succeeded with nothing*; and
`frontend/src/api/services/search.service.test.ts` › `searchErrorMessage` (3 cases). Every A-56 case
fails on a `git worktree` of HEAD `05985ef` and passes after, except the "still says 'No results'"
control, which passes on both.

*Two tenants.* Search is raw SQL, so its `tenant_id = :tenantId` predicate is the only isolation.
`search.twoTenants.a56.test.js` › "search — two tenants" runs the real controller, service and
`dynamicAccess` with `createTwoTenants()` principals against a database double that returns every
tenant's rows unless the statement carries the predicate: *returns only tenant A's rows to a tenant-A
principal, on every type*, *returns only tenant B's rows to a tenant-B principal*, *keeps tenant B out on
the ILIKE fallback path too*, *ignores a tenantId supplied in the query string*, *scopes a super admin to
its home tenant, not every tenant*. These pass on HEAD because the predicate was already there. Mutation
on the worktree showed they catch its removal: deleting the predicate from the FTS statement fails four
of them, deleting it from the ILIKE statement fails the fallback case. Live check against
`pgvector/pgvector:pg18` (PostgreSQL 18.6, throwaway container, since removed), with three tables holding
rows in both tenants and `stocks` without `search_vector`: tenant A got `cert-A, dev-A, stk-A` and tenant B
got `cert-B, dev-B, stk-B`; three searches logged one `warn` and two `debug`; renaming `certificates`
away made the search reject with 500 "Search failed for certificate", with both causes logged.

Coverage: `search.service.js`, `search.controller.js` and `search.route.js` are at 100% on all four
measures (subset run). The full-suite gate was not run for this change.

---

### A-57 — The public verification endpoint publishes a draft certificate's PDF

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-23, during the file-serving debate |
| **Decision** | [ADR-042](../MEMORY/DECISIONS.md) |

`GET /certificates/verify/:certificateNumber` is deliberately unauthenticated — a third party
scanning a QR code must be able to check a certificate without an account. That is correct, and it
is the point of third-party-verifiable evidence.

But `certificatePdf.service.js` computes the verdict at `:286`:

```js
const valid = signed && !revoked && !expired;
```

and then, twenty-five lines later, returns the document regardless:

```js
documentUrl: cert.filePath || null,
```

So an **unissued draft** — and a **revoked** certificate — has its PDF path published to anyone who
walks the certificate number, which is a sequential counter
(`CERT-<YYYYMMDD>-<tenantCode>-<sequence>`). Combined with the unauthenticated `/uploads` mount
(S-01), the document itself is then fetchable.

A draft is a calibration result that has not been approved. Publishing it is worse than publishing
a finished one: it is evidence the tenant has explicitly not stood behind yet.

**Fix direction:** return `documentUrl` only when the certificate is in a state whose document is
meant to be public, and decide deliberately what a revoked certificate returns — a revoked
certificate's document arguably *should* remain fetchable so a holder can see it was revoked, but
that is a decision to record, not to infer. The status gate already exists one line above.

**Definition of Done**
- [ ] a `draft` certificate returns `documentUrl: null` from the public endpoint, proven by a named test
- [ ] the behaviour for `revoked` is decided and recorded, not left implicit
- [ ] the response for a nonexistent and an unissued number are indistinguishable beyond `found`

---

**What was changed (2026-09-24)** — ADR-042 steps 1 and 2, `certificatePdf.service.js`, 41 tests, 100 %.

The public verification endpoint returns `documentUrl` **only for a `signed` certificate**. A `draft`
returns `null`; so does a **revoked** one — the decision recorded in a comment at
`verifyByCertificateNumber` is that the PDF on disk is the unwatermarked signed version, so
publishing it would present a revoked certificate as valid, while `status`, `revoked` and `valid`
already say it was revoked. Expired certificates still return their document.

The certificate filename is no longer the sequential certificate number: it is a random UUID, so
enumeration no longer works. **The half-finished version of this fix could never have passed** — it
used the `uuid` package, and the Jest setup replaces that package with a constant
(`__mocks__/uuid.js`), so "two filenames differ" was unsatisfiable. It now uses
`crypto.randomUUID()`. Against the pre-fix service, 13 tests fail.

### A-58 — Five workflow routes gate on a slug that does not exist

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high — a live lockout, and the proof that A-07 is not theoretical** |
| **Verified** | 2026-09-23, by executing the constant rather than reading it |
| **Decision** | [ADR-043](../MEMORY/DECISIONS.md) |

`workflows.route.js` lines 149, 215, 252, 316 and 354 gate on:

```js
dynamicAccess("workflow", "read")   // and "write"
```

**singular.** The slug in `MENU_SLUGS` is `workflows`, and the seeded menu row
(`seedMenuGroups.util.js:277`) is `workflows`. Checked by running the constant:

```
workflow  -> false
workflows -> true
```

A `dynamicAccess` name that matches no menu group grants nobody. So those five routes — the
approval-workflow engine — have been **SUPERADMIN-only**, silently, despite
`roleConstants.js:254` granting the permission to the admin roles. Nobody saw a misconfiguration;
they saw a 403 and assumed a permission decision.

This is finding A-07 with a concrete instance attached, and it is the evidence behind ADR-043's
central point: the defect is **unvalidated authorization data**, not the choice between `rbac` and
`dynamicAccess`. One character.

**Fix direction:** correct the five call sites, and — more importantly — add the startup assertion
ADR-043 step 5 describes, so that a `dynamicAccess` name matching no seeded slug refuses to boot
and names itself. Correcting these five without the assertion leaves the next typo to be found the
same way.

**Definition of Done**
- [ ] the five routes use `workflows`, and a named test proves an admin role reaches them
- [ ] a startup assertion fails, naming the offender, when any `dynamicAccess` name matches no seeded slug
- [ ] the assertion is proven by temporarily reintroducing the typo — a check nobody has watched fail is not a check

**What was changed (2026-09-24)** — the typo and, more importantly, the check that makes the next one loud.

All five gates in `workflows.route.js` now read `workflows`. `workflows.access.a58.test.js` (17 tests)
drives the **real** `dynamicAccess` against the matrix built from `ROLE_MENU_ASSIGNMENTS`: both admin
roles reach all five routes, ENGINEERING MANAGER gets reads only, a role without the grant gets 403.
With the typo restored, **12 of 17 fail**.

**The boot assertion (ADR-043 step 5) is wired into `backend/index.js`, in two phases**:

| Phase | Runs | Refuses to start when |
|---|---|---|
| 1 | **before** the database connection — it reads route source and constants only, so it cannot fail for a database reason | a `dynamicAccess` name matches no seeded menu name or slug, or a `ROLE_NAMES` key has no `ROLE_LEVELS` entry |
| 2 | **after** `db.sync()` and migrations, so migration 0020 has already backfilled levels | a seeded role's `role_level` disagrees with `ROLE_LEVELS` |

If phase 2 **cannot** run — the query throws, or nothing is seeded yet — it warns and boot continues,
because refusing there would make the seeding endpoint unreachable and deadlock a fresh install. Only a
check that ran **and found a disagreement** refuses. That distinction is recorded in the code.

**Both phases were watched failing**, against a throwaway PostgreSQL with seeded data:

```
[error]: AUTHZ_WIRING_FAILURE: refusing to start — 5 authorization wiring defect(s):
  - src/routes/api/workflows.route.js:149 dynamicAccess("workflow", …) matches no seeded menu
    group name or slug — the gate grants nobody but SUPERADMIN, silently (A-58)
  …
```

and, with `HEALTHCARE ADMIN` set to `role_level = 1`, boot exits on
`roles."HEALTHCARE ADMIN".role_level is 1, ROLE_LEVELS.HEALTCARE_ADMIN is 8`. Restored, it boots and
logs `133 dynamicAccess gate(s), 12 role name(s)` and `roles table agrees with ROLE_LEVELS for 11
seeded role(s)` — a silent pass is indistinguishable from a check that never ran, so it says so.

**What the scan surfaced, left unchanged by decision:** `"AuditLogs"` and `"Finance"` match nothing,
but each sits in an OR gate that still resolves through another name, so they warn rather than
refuse. `search.route.js` passes a computed list and cannot be checked statically; resolved by hand,
all three are seeded.

**Known limits, stated in the code:** under a packaged binary (`pkg` bytecode or `bun --compile`)
the source scan cannot run, so phase 1 **only warns** — a packaged deploy runs with the gate check
off, said loudly in the log. The check validates against the seed file, not the live `menu_groups`
table. Two workflow routes (`GET /instances/pending`, `POST /instances/:instanceId/action`) carry
`auth` alone — the P6-04 class, unchanged here.

---

### A-59 — Tokens that are not access tokens are accepted as access tokens

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, while fixing A-48 |

`auth.service.js:123` mints the account-activation token — the one sent **by email** — with
`generateAccessToken({ id: user.id })`. Since A-31, `generateAccessToken` stamps `typ: "access"`. So
the activation link carries a token **indistinguishable from a real access token**: the `auth`
middleware accepts it as a bearer, for the full `JWT_ACCESS_EXPIRED` — a day on the running
deployment. Activation emails are forwarded, archived and logged. `:241` does the same for the
MFA-pending token, which exists precisely to represent a login that is **not yet** authenticated.

Neither carries a `sid`, so A-48's revocation check does not apply to them — tokens without `sid` are
still accepted, for compatibility with tokens issued before that change. The same compatibility gap
leaves **every SSO token unrevocable**: `sso.controller.js:65` and `:175` sign `{id, email}` and
discard the session they could have bound to.

The machinery to fix this already exists: A-31 introduced the `typ` claim and `assertTokenType`.

**Fix direction:** mint the activation token as `typ: "activation"` and the MFA token as
`typ: "mfa"`, and accept each only on the one route that consumes it; give SSO tokens a `sid`; then,
once every issuer sets one, refuse an access token with no `sid`.

**Definition of Done**
- [x] an activation token presented as a bearer to an ordinary route is rejected, by a named test
- [x] an MFA-pending token is accepted only by the MFA completion route
- [x] an SSO token is revocable
- [ ] an access token without `sid` is refused — and the change is announced, because it signs out every session issued before it

**What was changed (2026-09-24).** `jwt.util.js` gained `generatePurposeToken` and
`verifyPurposeToken`, built on the same `typ` machinery A-31 introduced. They sign with the same key
registry, and each accepts **only** its own purpose; a token with no `typ` is refused. The
activation token is now `typ: "activation"`, 24h. The MFA-pending token is `typ: "mfa"`, 5 minutes,
and is issued **before** any session exists. Previously `loginUser` created a live session and
access token for an MFA account and then discarded them. The socket token is `typ: "socket"`, which
also closes **A-52**: it goes through the registry instead of `process.env`, and the handshake
accepts only a socket token and checks that its session is live. `verifyAccessToken` already
refused any `typ` other than `access`, so all three are refused as bearers. Both SSO callbacks now
create the session first and sign `sid`, the same order login uses.

**Every access-token issuer now sets `sid`.** `auth.middleware.js` exports
`SIDLESS_ACCESS_TOKENS_ACCEPTED = true`. Setting it to `false` is safe once one
`JWT_ACCESS_EXPIRED` has passed since the deploy, which is 1 day on the VM. After that, no valid
sid-less token remains, so the switch signs nobody out.

**Behaviour at deploy:** activation links emailed before it are refused with a 400. There is no
resend endpoint, and `loginUser` never checks `isEmailVerified`, so activation gates nothing today
(**A-60**).

**Tests.** Nine tests failed against the old code; all pass now. They are in
`auth.tokenPurpose.a59.test.js` and `jwt.purpose.a59.test.js`:
- *"an activation token presented as a bearer is rejected"*
- *"an MFA-pending token is accepted only by MFA completion"*
- *"a socket token presented as a bearer is rejected"*
- *"an SSO-issued token is revoked when its session is revoked (saml)"*, and the same for *(oidc)*
- *"logging out of an SSO session stops its token"*

Full backend suite: 331 suites, 6,586 tests.

---

### A-60 — The SSO hand-off, and an activation step that gates nothing

| | |
|---|---|
| **Status** | **PARTIAL** 2026-09-24 — items 1 and 2 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, while fixing A-59 |

1. **Tokens in the URL.** Both SSO callbacks redirect to `/sso-callback?token=…&refreshToken=…`,
   which puts an access token and a refresh token into proxy logs, browser history and `Referer`
   headers. The frontend page then posts only `token` to `/api/v1/auth/sso-session`, so the refresh
   token and the session behind it are dropped.
2. **`/api/v1/auth/sso-session` stores whatever it is given.** It writes the posted token into the
   httpOnly auth cookie **without verifying it** — the shape of a session-fixation endpoint. The JSON
   content type and `SameSite=Lax` limit how it can be reached; they do not make it correct.
3. **Activation gates nothing.** `loginUser` never checks `isEmailVerified`, so an account logs in
   whether or not the emailed link was ever used. There is also no endpoint to resend it.

**Fix direction:** a one-time code in the redirect, exchanged server-to-server for the tokens; verify
before setting the cookie; decide — owner question — whether unverified accounts may log in.

**Definition of Done**
- [x] no token appears in any redirect URL
- [x] `sso-session` refuses a token that does not verify, by a named test
- [ ] the email-verification policy is decided and enforced, or explicitly recorded as not required

**What was changed (2026-09-24) — items 1 and 2.**

Both callbacks now redirect to `/sso-callback?code=<43-char base64url>`. What is stored under
`sso:handoff:<sha256(code)>` for 60 seconds is the **verified identity** — never tokens.
`POST /api/v1/auth/sso/exchange` redeems it:

- **Single use:** it reads with Redis `GETDEL`, so a code works once even across replicas. If Redis
  is down, it falls back to process memory with the same TTL and single use. That fallback is correct
  on one replica, and on several it refuses an exchange that lands on another process — it never
  admits an unknown code.
- **Session and audit:** it creates the session and writes a `LOGIN` audit row in one transaction,
  then answers in `/auth/login`'s shape.
- **Refusals:** an unknown, expired or used code gets one 401. There is an IP lockout at 30 failures
  in 5 minutes.

The frontend's `sso-session` route accepts only `{code}`. It exchanges the code server-to-server and
sets exactly the cookies login sets; a posted raw token gets a 400 and no cookie. The callback page
removes the code from history and cannot spend it twice under React's double effects.

**Tests.** Backend: `sso.controller.test.js` › *"A-60: the SSO hand-off"*, which includes
*"no token appears in the SSO redirect URL (saml)"* and *"(oidc)"*, *"a one-time code can be
exchanged once only"* and *"an expired or unknown code is refused"*; and
`auth.ssoExchange.a60.test.js`. Frontend: `sso-session/route.test.ts` › *"sso-session refuses a
posted raw token"*. Full suites: backend 336 suites and 6,667 tests at 100 %; frontend 77 suites and
733 tests.

**At deploy:** both halves must ship together. SSO sign-ins in flight at that moment fail once.

**Still open:** item 3, which is the owner's decision (Q-11). Also A-69: **SSO has probably never
worked through the Next `/api` proxy on this deployment**, and this change does not fix that.
*(2026-09-24: A-69 is fixed in the proxy, and A-68 found three more reasons OIDC never worked. See
both sections. Neither has yet been seen with a live IdP.)*

---

### A-61 — Every e-signature was committed without its audit row, and returned a 500

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **critical** — a 21 CFR Part 11 signature with no audit trail |
| **Verified** | against the real schema by the A-41 ledger fixture, 2026-09-24 |

`eSignature.service#signDocument` and `#revokeSignature` wrote an audit row with action
`"DOCUMENT_SIGNED"` / `"SIGNATURE_REVOKED"`, and neither value is in the `audit_logs` ENUM. The row
also named columns that do not exist (`entityType`, `entityId`, `before`, `after`) and omitted
`resourceType`, which is NOT NULL. With no transaction, the `SignatureRecord` and the workflow step
had **already committed** when the insert threw. The signer got a 500, the signature stood, and
`audit_logs` never recorded it — on every call.

`esignature.signing.test.js` asserted `"DOCUMENT_SIGNED"` against a mock that accepted any value, so
it passed. That is the fifth instance this month of a mock inventing the contract, and the second
inside a single ENUM (S-02's `"RESTORE"` was the first).

**Fixed under A-41:** both are transactional, write valid rows, and send email only after commit.
Test: `esignature.audit.a41.test.js` — 6 of 8 failed against the old code, the sign path with
*"Failed to sign document"*.

---

### A-62 — The approver of a certificate is whoever the request body says

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, during A-41 |

`certificate.controller#approveCertificate` reads `approvedBy` from `req.body`. The re-authentication
step checks **that** user's credentials, so a caller who knows another approver's password can
record the approval in that person's name. It also means the audit row and the certificate can
name different people for the same act.

**Fix direction:** the approver is `req.user.id`, always; re-authentication checks the caller's own
credentials; a body `approvedBy` is stripped by the validator.

**Definition of Done**
- [x] a body `approvedBy` naming another user has no effect, by a named test
- [x] the certificate's approver and the audit row's `userId` are the same id

**What was changed (2026-09-24).** `approveCertificate` passes `req.user.id` and nothing else, and
the service re-authenticates, stamps, signs and audits that one id. `approvedBy` is removed from the
approve schema **and from the update schema** — a plain `PUT` could name anyone as approver with no
re-authentication at all. The approve route now mounts `validate(approveCertificateSchema)`. QMS CAPA
approval had the same shape (`qms.service#updateCapa` copied a body `approvedBy`), so it now records
the caller.

Test: `certificates.approve.a62.test.js`, which drives the real route, validator, controller and
service against the audit ledger. It includes *"a body approvedBy naming another user has no
effect"*, *"re-authentication checks the caller's own credentials"* and *"the certificate's approver
and the audit row's userId are the same id"*. 4 of its 5 tests failed against the old code.

**Found while fixing:** A-63, A-64, A-65 and A-66.

---

### A-63 — Any authenticated user can edit, or suspend, any tenant

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — server check open |
| **Severity** | **critical** — cross-tenant write |
| **Verified** | from code, 2026-09-24. Not yet exercised against a running server |

`PATCH /api/v1/tenants/edit` (`tenant.route.js`) is gated by
`dynamicAccess("Management", "update", { checkSelf: true, checkTenant: true })`. In
`dynamicAccess.middleware.js`, the self-service bypass runs **first**. It takes the owner id from
`req.params.userId || req.body.userId || …`, and if that equals the caller's id it calls `next()`.
**The tenant-isolation check below it never runs.**

JSON bodies are parsed globally, so a caller sends:

```json
{ "userId": "<their own id>", "tenantId": "<any tenant>", "status": "suspended", "maxUsers": 1 }
```

The controller merges params and body, and `tenantService.updateTenant` loads the tenant with
`findByPk(tenantId)` — `tenants` is not itself tenant-scoped — then applies name, status, `maxUsers`
and the rest. Any user holding any token can rename, re-brand or **suspend another hospital**. Within
their own tenant, the same request lets an ordinary user change the tenant's own plan limits and
status.

`checkSelf` is meaningless on this route: a tenant is not a user's own resource. The deeper defect
is that the bypass trusts a **body** field to establish ownership, and that it short-circuits every
check that follows.

**Fix direction:** remove `checkSelf` from the tenant route. In the middleware, derive ownership only
from the path, never the body or query, and never let the self bypass skip the tenant check.
`/users/edit` relies on the body `userId`, so it must move to the authenticated id. Add the two-tenant
404 test CLAUDE.md requires.

**Definition of Done**
- [x] a user of tenant A sending tenant B's id with their own `userId` gets 404, and tenant B is unchanged
- [x] an ordinary user cannot change their own tenant's `status` or `maxUsers`
- [x] the self bypass reads no body or query field, by a named test
- [ ] verified against the running server

**What was changed (2026-09-24).**

`dynamicAccess`'s self bypass now runs **after** the tenant check, and takes ownership from the
path only (`selfOwnerIdFromPath`: `:userId` or `:id`). `abac` gets the same rule.

`checkSelf` is removed from `PATCH /tenants/edit` and from `PATCH /users/edit`, which now needs
`users` update access. Self-service moves to a new route, `PATCH /users/:userId/profile`:
- username and names only;
- the path wins over the body;
- the frontend's `updateProfile` calls it.

**The gate cannot be the real control on the tenant edit.** The frontend sends multipart, and
multer parses the body after the gate — so `checkTenant` never sees the `tenantId` (A-78). So
`tenantService.updateTenant` enforces it:
- a non-super-admin may update only their own tenant;
- any other id is a 404 identical to a missing tenant;
- only a super admin may change `status` or `maxUsers`. Suspending your own tenant locks you out,
  and `maxUsers` is the seat limit.

`updateTenant` now writes its audit row inside the transaction. It wrote none before.

**`createTwoTenants()` now exists:** `tests/fixtures/twoTenants.js`. `CLAUDE.md` is corrected.

**Tests:**
- `tenant.edit.a63.test.js`, including *"a user of tenant A sending tenant B's id with their own
  userId gets 404, and tenant B is unchanged"* and *"an ordinary user cannot change their own
  tenant's status or maxUsers"*.
- `user.profile.a63.test.js`.
- `dynamicAccess.test.js` › *"the self bypass reads no body or query field"*.

**Fail-before:** 16 of these tests failed against `HEAD`. Against the old code, the cross-tenant
edit returned **200**.

**Still open:** verification against a running server.

**Found while fixing:** A-76 to A-80.

---

### A-64 — A certificate can be approved or signed by editing its status

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **critical** — a 21 CFR Part 11 bypass |
| **Verified** | from code, 2026-09-24, during A-62 |

`updateCertificateSchema.status` accepts `approved` and `signed`. A `PUT /certificates/:id` therefore
moves a certificate into an approved or signed state with no re-authentication, no e-signature
record and — since A-62 — no approver. The state machine exists in the model
(`submitForApproval`, `approve`, `sign`, `revoke`), and `update` walks around it.

**Fix direction:** `status` is not updatable through `PUT`. Transitions happen only through their
routes, and an invalid one is a 409 with a state explanation.

**Definition of Done**
- [x] a `PUT` carrying `status` does not change the status, by a named test
- [x] every transition goes through its route and writes its audit row

**What was changed (2026-09-24).** A `PUT` that tries to change `status` is a **409** that explains the
state, for example: *This certificate is in "draft" and editing it cannot change its status. Submit it
for approval with POST /certificates/:id/submit.* The request is refused rather than the field
stripped, because stripping would silently discard what the client meant.

- Repeating the **current** status is not a transition: it is dropped and the rest of the edit
  applies.
- Not-found runs first, so another tenant's certificate is still a 404.
- The audit row's `after` never carries `status`.
- No frontend code used `PUT` to change status.

**Test:** `certificate.statusLock.a64.test.js` › *"a PUT carrying status does not change the status"*,
across 7 transitions. Every one of them failed against the old code.

---

### A-65 — Anyone in the tenant can sign someone else's step

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, during A-62 |

`eSignature.service#signDocument` does three things wrong:

- It never checks that `step.signerId === userId`, so any user in the tenant can complete another
  signer's pending step.
- Its "re-authentication" checks only that the user is active.
- It takes the Part 11 `ipAddress` and `userAgent` from the request body, and uses the connection's
  values only as a fallback.

A signature is supposed to be attributable, intentional and non-repudiable. As built, it is none of
the three.

**Definition of Done**
- [x] a user who is not the step's signer gets 403 inside their own tenant, by a named test
- [x] signing requires the signer's password (or MFA code), the way certificate approval does
- [x] the IP address and user agent come from the connection only

**What was changed (2026-09-24).**

- **Signer check.** A caller who is not `step.signerId` gets **403**. The check runs before the
  pending check, so a non-signer learns nothing about the step. Another tenant's step is still a 404.
- **Real re-authentication.** The credential check was extracted from certificate approval as
  `verifySignerCredentials` in `certificate.service.js`. Certificate approve, sign and revoke and
  workflow signing all use it. `REQUIRE_REAUTHENTICATION` no longer switches it off — **ADR-047**.
- **The IP address and user agent** come from the connection only.
- **Validator.** `authPayload` is required, and the method is `password` or `mfa`. `webauthn` and
  `totp` are refused, because nothing can verify them at signing time. `reason` is now accepted: the
  service signed over it, but the validator had been dropping it.
- **Frontend.** The e-signature page shows *Sign* only on the caller's own step, with a password or
  MFA form. Its types now match the real response: steps carry `signerId`, not `userId`.

**Tests.** `esignature.signer.a65.test.js` › *"a user who is not the step's signer gets 403"*,
*"signing requires the signer's password"* and *"the IP address and user agent come from the
connection only"*. 11 of the file's 13 tests failed against the old code. There is also a new
frontend page test, whose 4 tests all failed against the old page.

**Consequence:** a step whose signer is external (email only, no `signerId`) can no longer be signed
by anyone. No route has ever existed for external signers (A-86).

---

### A-66 — QMS has no permission gate and no audit trail

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, during A-62 |

`qms.route.js` mounts `auth` and `denyApiKey`, and no `dynamicAccess`. Any authenticated user in a
tenant can create, change and approve CAPAs and quality records, and none of it writes an audit row.
CLAUDE.md names a missing permission gate as the single most likely authorization defect in the
codebase — this is one, on a quality-management surface. `frontend qmsService.approveCapa` also sends
`status: "APPROVED"`, which the backend enum does not contain; nothing calls it today.

**Definition of Done**
- [x] every QMS route has a `dynamicAccess` gate whose slug is seeded (the A-58 boot assertion checks it)
- [x] QMS mutations write audit rows inside their transactions

**What was changed (2026-09-24).** All six QMS routes are gated on the `qms` slug:

- reads need `read`;
- creates and updates need `write`.

The slug was already in `MENU_SLUGS`, the seed and the role assignments, so no migration was needed.

**Who has access now:**

| Role | Access |
|---|---|
| HEALTHCARE ADMIN, CALIBRATOR ADMIN | keep full access |
| ENGINEERING MANAGER | read only |
| every other seeded role | **loses QMS access it should never have had** |

**This is a visible behaviour change for technicians and users.**

`createNC`, `updateNC`, `createCapa` and `updateCapa` each run in one transaction with their audit
row: `CREATE`, `UPDATE` (changed fields only), or `APPROVE` for a CAPA approval.

**The QMS screen had been empty since it was built.** It read `data.nonConformances` and
`data.capas`, while the envelope puts rows in `data` — the CLAUDE.md trap, a fourth time. The
frontend now reads the envelope, and its status vocabularies match the backend enums. `approveCapa`
had been sending `"APPROVED"`, a value the validator rejects.

**Tests:**

- **`routeGuards.a66.test.js`** (44 tests), including *"every QMS route has a dynamicAccess gate
  whose slug is seeded"* and *"a user without QMS permission gets 403 in their own tenant"*.
- **`qms.audit.a66.test.js`** (22 tests), including *"a CAPA update writes its audit row in the
  transaction"* and *"a failing audit insert rolls the QMS change back"*.
- **Frontend `qms.service.test.ts`**, including *"lists NCs from the house envelope"*.

**Fail-before:** 41 backend and 9 frontend tests failed against the old code.

---

### A-67 — The login rate limiter records no failures

| | |
|---|---|
| **Status** | **PARTIAL** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, during A-60 — not yet on a running server |

In `auth.route.js`, `authPostFailure` is mounted **before** the handler, while the response status is
still 200, so it never sees a failure. `authPostSuccess` is mounted after a handler that never calls
`next`, so it never runs. The limiter's lockouts on login, register, send-OTP and password reset are
therefore **no-ops**; only the database `failedLoginAttempts` counter locks anything, and that works
per account, not per source. Credential stuffing across many accounts is unthrottled by the layer
that exists to throttle it. The new `/sso/exchange` records its failures explicitly for this reason.

**Definition of Done**
- [ ] N failed logins from one IP lock that IP, by a test that drives the real router

**What was changed (2026-09-24).** The broken `authPostFailure` and `authPostSuccess` middlewares are
gone. The login, register, send-OTP and reset handlers record their own outcome through
`withAuthOutcome` and `noteAuthFailure`/`noteAuthSuccess`, following the A-60 `ssoExchange`
pattern:

- any 4xx except 429 counts as a failure, and a 5xx never does;
- a success clears only the per-user and per-token counters;
- each failure is logged at `warn` with its real reason.

**Per-IP counting ships switched OFF**, behind `AUTH_RATE_LIMIT_BY_IP=true`. This was decided by the
orchestrator after the fix agent's warning. Behind the Next proxy, `req.ip` is one shared hop for
every browser (A-16), so turning it on today would let **15 failed logins from anyone lock login for
everyone**, indefinitely. That is a worse defect than the one being fixed.

**Tests** are in `auth.rateLimit.a67.test.js`, which drives the real router:
- with the switch on: *"N failed logins from one IP lock that IP"* and the register, OTP and reset
  cases. These failed against the old code with 401 instead of 429;
- with it off: *"with AUTH_RATE_LIMIT_BY_IP unset, failures never lock the shared proxy address"*.

**To close:** fix A-16 so the backend sees the real client IP. `trust proxy` is 1 today, but the chain
has more hops than that: Cloudflare tunnel, nginx, then Next. The edge must overwrite
`X-Forwarded-For`, since the proxy passes the client's value through. Then set the switch on the VM.

---

### A-68 — OIDC has no `state`, `nonce` or PKCE check

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, during A-60; fixed and proved against a real in-process IdP, 2026-09-24. **Not seen with a live IdP** |

`sso.service.js` generates a `state` and stores it nowhere. `oidcCallback` only splits it to recover
the tenant code, and no `nonce` or PKCE verifier exists. So the callback accepts any authorization
code with any `state` — login CSRF (the victim is signed into the attacker's account) and code
injection.

**Definition of Done**
- [x] `state` is bound to the initiating browser and checked once; `nonce` is checked in the ID token; PKCE is used
- [x] a callback with a forged `state` is refused, by a named test

**Resolution.** `sso.controller.oidcLogin` now mints four 32-byte random values (Node `crypto` only,
no new dependency):

| Value | Goes to | Checked |
|---|---|---|
| `state` | the IdP, and back | the store key (its SHA-256), consumed with one `GETDEL` |
| `nonce` | the IdP | must equal the ID token's `nonce` claim (`oidcJwks.verifyOidcCallback`) |
| `code_verifier` | stays on the server | the IdP gets only `code_challenge` = S256 of it; the token request sends the verifier |
| binding | the **browser only**, httpOnly cookie `sso_oidc_binding` | its SHA-256 must equal the one stored with the state |

The entry — tenant, `redirect_uri`, nonce, verifier, binding hash — lives 600 s under
`sso:oidc:state:<sha256(state)>`. With Redis down it is held in process memory with the same TTL and
single use, exactly like the A-60 hand-off codes. The callback refuses with **401 "Invalid or expired
SSO sign-in state"** when the state is unknown, expired, already used, presented without the binding
cookie or with another browser's, or started for another tenant than the callback URL names. It is
refused **before the code is sent to the IdP**. The binding cookie is cleared on every callback.
`verifyOidcCallback` also refuses (401) when it is not given a nonce and a verifier, so no caller can
skip the check by omission.

The tenant now comes from the stored entry, not from `state.split("_")[1]`. The `redirect_uri` is
fixed at the start and stored, so the token request sends exactly what the authorize request did.
Before, the authorize URL fell back to `http://localhost:5000/…` while the callback used `HOST_URL`,
so a tenant without `oidc_redirect_uri` would have failed the exchange with a `redirect_uri` mismatch.

**Found and fixed while doing this. OIDC has never worked, for three reasons besides A-69:**

1. **Every SSO start was a 500, SAML as well as OIDC.** `ssoLogin` and `oidcLogin` did
   `const { tenantCode } = validate(req.body, ssoLoginSchema)`, but `validate` returns Joi's
   `{ value, error }`, so `tenantCode` was always `undefined`. Sequelize 6 throws
   `WHERE parameter "code" has invalid "undefined" value` (reproduced against the real model). Both now
   read `value` and answer 400 "Tenant code is required" on a bad body. The unit tests mocked
   `Tenants.findOne`, so they never saw it.
2. **The callback had no GET route.** The authorize request asks for `response_mode=query`, so the IdP
   returns the browser with a GET, but only `POST /sso/oidc/callback[/:tenantCode]` existed. GET routes
   are added, and the controller reads `code` and `state` from the query or the body.
3. The `redirect_uri` mismatch described above.

**Design decision: the binding cookie.** A `state` checked only against the server store stops a
forged state. It does not stop login CSRF: the attacker's own valid state and code, opened in the
victim's browser, would pass. So the state is bound to the browser that started the sign-in.
Alternatives considered:
- *Put the state itself in the cookie and compare* (the "double-submit" pattern): this also works,
  but the store is still needed for nonce and verifier, so a separate random binding keeps the cookie
  meaningless on its own. The state travels through the IdP's logs and the binding never leaves the
  browser.
- *Bind to the Next session:* there is no session before sign-in, which is the point.
- *Let Next own the binding:* possible, but the backend would then have to trust a header from Next
  saying the browser matched. The backend enforcing its own cookie keeps the check where the state
  lives. The cost is that the Next proxy must carry this one cookie both ways (A-69).

**SameSite=Lax, which rules out `form_post`.** The IdP's return is a cross-site top-level GET, and
Lax cookies go with that. A `response_mode=form_post` return is a cross-site POST, which would arrive
without the cookie and be refused. The POST routes remain, but through a browser they only work for a
same-site POST. `SameSite=None` would allow `form_post`, but it gives up Lax's CSRF protection for a
mode this app does not ask for.

**Tests** (fail-before shown in a baseline worktree at `05985ef`):
- `src/tests/routes/sso.oidcRoundTrip.a68.test.js`: a **real** IdP on an ephemeral port. It has an
  RSA JWKS, enforces PKCE S256 at `/token` the way RFC 7636 requires, and signs RS256 ID tokens with
  jsonwebtoken. The backend runs the real auth router, controller, `sso.service`, `oidcJwks` (real
  axios) and `redis.service` (memory fallback). Tests: *"completes: state, nonce and PKCE S256
  round-trip, and the browser lands on /sso-callback with a one-time code"*, *"a callback with a
  forged state is refused, and the code never reaches the IdP"*, *"a callback with no state is
  refused"*, *"a replayed callback is refused — the state is single-use"*, *"login CSRF: the
  attacker's callback URL opened in the victim's browser is refused"*, *"a state bound to another
  browser is refused even when that browser has a binding cookie of its own"*, *"an ID token whose
  nonce does not match the sign-in is refused"*. **All 7 failed at the baseline:** the start answered
  404/500 and the GET callback did not exist. A baseline probe (not kept) also POSTed a callback with
  a forged `state` and an IdP-issued code. The baseline sent that code to the IdP's token endpoint
  with no `code_verifier`, which shows the state was never checked.
- `sso.controller.test.js` › *"A-68: OIDC state, nonce and PKCE"*: *"a callback with a forged state
  is refused"*, *"a replayed state is refused — it is consumed on first use"*, *"a state presented by
  a browser that did not start the sign-in is refused (login CSRF)"*, *"a state with no binding cookie
  at all is refused"*, *"a state started for one tenant is refused at another tenant's callback URL"*,
  *"with Redis down the state is held in memory — still single-use, still bound"*, *"… an expired
  state is refused …"*, *"oidcLogin stores the state, sends an S256 challenge of a verifier it keeps,
  and sets the binding cookie"*, *"%s answers 400 without a tenant code, and looks the tenant up by
  the code it was sent"*. Also: *"reads code and state from the query string — the IdP's GET
  return"* and *"the callback sends the redirect_uri stored at the start, not one derived again"*.
- `oidcJwks.test.js` › *"A-68: nonce and PKCE"*: *"an id_token whose nonce does not match the
  sign-in is refused"*, *"an id_token with no nonce is refused"*, *"sends the PKCE code_verifier to the
  token endpoint"*, *"refuses a callback with no flow at all / no nonce / no code_verifier before any
  request to the IdP"*. All 6 failed at the baseline.
- `sso.service.test.js` › *"A-68: sends the stored state, the nonce and an S256 PKCE challenge — never
  a verifier"*.
- Updated for the new contract: `sso.suspendedUser.a70.test.js` and `auth.tokenPurpose.a59.test.js`.
  Their OIDC callbacks now begin a real flow.

`sso.controller.js`, `sso.service.js`, `oidcJwks.js` and `auth.route.js` are at 100 % on all four
measures.

**Still open. Only a live IdP can show these:**
- **The JWKS location.** `oidcJwks` fetches `${oidc_authority}/.well-known/jwks.json` and posts to
  `${oidc_authority}/token`. Entra ID publishes its keys at `…/discovery/v2.0/keys`, not there. With
  the default `common` authority the issuer is also tenant-specific. Discovery
  (`/.well-known/openid-configuration`) is not implemented. This predates A-68.
- **A public client.** A tenant with no `oidc_client_secret` sends the literal `client_secret=undefined`
  (A-150 territory).
- **The refusals render as JSON** in the browser, because the callback is a navigation. Redirecting
  them to `/login?error=…` would be kinder, and is not done here.

---

### A-69 — SSO through the Next proxy follows the redirect on the server

| | |
|---|---|
| **Status** | **DONE** 2026-09-24. The proxy's behaviour is proved against a real HTTP backend. **Not seen with a live IdP** |
| **Severity** | **high** — SSO likely does not work on this deployment at all |
| **Verified** | from code and the deployment notes, 2026-09-24. **Not observed** — no IdP is configured |

On this deployment `/api/` is served by the frontend (ADR-046). If an IdP's ACS or redirect URL
points at `https://<host>/api/v1/auth/sso/...`, the `[...path]` proxy's `fetch` follows the backend's
302 **on the server**, so the browser never receives `/sso-callback?code=…`. This predates A-60.

**Fix direction:** the proxy passes redirects through (`redirect: "manual"`), or the SSO callback
paths are routed to the backend directly in nginx. Decide which, and test with a real IdP.

**Resolution.** Two changes to `frontend/src/app/api/v1/[...path]/route.ts`:

1. **`redirect: "manual"` on every proxied fetch.** A 3xx and its `Location` go back to the browser.
   A reverse proxy should not follow redirects for its client. The backend has two redirecting
   handlers, the SSO callbacks and `oidcProvider.controller` (consent). Both are browser navigations
   that were broken the same way. An XHR that receives a 3xx is followed by the browser itself.
2. **The OIDC binding cookie (A-68) is carried both ways, and nothing else is.** The browser's
   `sso_oidc_binding` goes to the backend as `Cookie`, and only on `auth/sso/oidc/*` paths. Of the
   backend's `Set-Cookie` headers, only that cookie passes. All other backend cookies are still
   dropped, and Next still owns `auth_token`/`auth_session`.

**Decision: pass redirects through in the proxy, instead of routing the SSO paths to the backend in
nginx.** The nginx route would need a rule in every nginx config and in Helm, and it would break for
anyone running without the bundled nginx (`next dev`, another ingress). It would also split `/api/`
between two upstreams, which ADR-046 chose not to do. The cost of the chosen route is that the proxy
now knows one backend cookie by name.

**The round trip, checked on paper against the code:**
1. The login page XHRs `POST /api/v1/auth/sso/oidc/login` → Next proxy → backend. The backend
   stores the state and answers 200 `{redirectUrl}` with `Set-Cookie: sso_oidc_binding` (Path
   `/api/v1/auth/sso/oidc`, httpOnly, Lax). The proxy passes that one cookie through, and the browser
   stores it for the public origin.
2. The browser navigates to `redirectUrl`: the IdP's `/authorize`, with `state`, `nonce` and an S256
   `code_challenge`.
3. The IdP sends the browser back with a top-level GET to `redirect_uri`. That is `oidc_redirect_uri`,
   or else `${HOST_URL}/api/v1/auth/sso/oidc/callback/<tenant>`. On the VM `HOST_URL` is the public
   origin, so the request reaches Next, and the Lax cookie is sent.
4. The proxy forwards it with the binding cookie. The backend consumes the state, checks the binding,
   exchanges the code with its `code_verifier`, verifies the ID token and its nonce, provisions the
   user, and answers **302 → `${FRONTEND_URL}/sso-callback?code=…`**, clearing the binding cookie.
5. The proxy, now `manual`, returns that 302 and its `Set-Cookie` to the browser.
6. `/sso-callback` posts the code to Next's own `POST /api/v1/auth/sso-session`. That route is more
   specific than `[...path]`, so it is unchanged. It redeems the code server-to-server and sets the
   httpOnly `auth_token`/`auth_session` (A-60).

**Configuration it depends on:** `HOST_URL`, or the tenant's `oidc_redirect_uri`, must be the
**public** origin that also served step 1. Otherwise the binding cookie is not sent at step 3 and the
callback is refused. In local development, cookies ignore the port, so `:3000` → `:5000` still works.

**Tests.** `frontend/src/app/api/v1/[...path]/route.redirect.a69.test.ts`. The "backend" is a real
HTTP server, so what is asserted is what undici does, with no fetch mock:
- *"the proxy hands the backend's 302 to the browser instead of following it"*
- *"forwards the browser's sign-in binding — and no other cookie — to the OIDC callback"*
- *"passes the backend's binding Set-Cookie to the browser and drops every other backend cookie"*
- *"passes the callback's clearing of the binding cookie through with the redirect"*

These four failed at the baseline. At the baseline the 302 came back as 200, with the landing page's
body fetched on the server. *"never forwards the binding cookie to any other route"* is a guard and
passes either way. The backend half of the round trip is `sso.oidcRoundTrip.a68.test.js` (A-68).

**Still open:** a sign-in with a real IdP through the VM's Cloudflare tunnel → nginx → Next chain.
The JWKS location noted under A-68 must be solved first for Entra ID.

---

### A-70 — SSO signs in a suspended user

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24, during A-60 |

`provisionUser` does not check `isActive` or `status`. A suspended user's SSO sign-in creates a
session and a `LOGIN` audit row. The auth middleware refuses the token on every request, so no data
is reached, but the audit trail records a login that should have been refused.

**What was changed (2026-09-24).**

- **The card was partly wrong:** `status` was already checked, and only `isActive` was missing.
  `provisionUser` now refuses both with a 403, so no code, session or `LOGIN` row is created.
- **Password login** now also refuses a user whose `status` is `INACTIVE` or `SUSPENDED`. Before, a
  user deprovisioned through SCIM could still sign in.
- **`loginMfa`** now checks status too; it checked nothing before.

**Test:** `sso.suspendedUser.a70.test.js` › *"a suspended user's SSO sign-in creates no session"*. It
returned a 302 with a code on the old code.

---

### A-71 — The login response hands the access token to JavaScript

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24, during A-60 |

The Next login route sets the httpOnly `auth_token` cookie **and** returns the access token in its
JSON body, and the generic proxy passes through any `token` field. The httpOnly cookie exists so
script cannot read the token; the response body gives it to script anyway. An XSS anywhere in the app
therefore yields a bearer token.

**Definition of Done**
- [ ] no response reaching the browser contains an access token

---

### A-72 — Password and MFA login write no audit row

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24, during A-60 |

Since A-60, SSO sign-in writes a `LOGIN` audit row. Password and MFA login write none, so *who
accessed the system, when* — basic Part 11 and ISO 27001 evidence — exists for SSO users only.

**What was changed (2026-09-24).** Password login and MFA login write a `LOGIN` / `Session` row, with
`changes.method` set to `password` or `password+totp`, in the same transaction that creates the
session. If the audit insert fails, the login fails.

**Failed logins write no audit row.** The ENUM has no `LOGIN_FAILED`, and an unknown username has no
tenant. They are logged at `warn`. Whether to add the ENUM value is **Q-15**.

**Tests:** `auth.loginAudit.a72.test.js` › *"a successful password login writes one LOGIN audit row"*
and *"an MFA login writes one LOGIN audit row"*. Each found 0 rows on the old code.

---

### A-73 — NC and CAPA numbers can collide

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-66) |

Numbers are `count() + 1`. Two concurrent creates read the same count and issue the same number, and
no per-tenant unique constraint stops it. A transaction does not serialise a `count()`. **Fix
direction:** a per-tenant sequence or a locked counter row, plus a composite unique on
`(tenant_id, number)`. The unique constraint must be per tenant, never global — a global one is an
existence oracle.

**What was changed (2026-09-24).**

**How a number is claimed.** One upsert, run inside the create's transaction:
`INSERT INTO qms_counters … ON CONFLICT (tenant_id, kind) DO UPDATE SET seq = GREATEST(seq + 1, …)
RETURNING seq`. It follows the existing `ticket_counters` pattern.
- The counter row stays locked until commit, so concurrent creates in one tenant queue.
- A rollback releases the number.
- The first value continues from the tenant's highest existing number.

**Migration `0024-qms-number-uniqueness`** creates `qms_counters` and **per-tenant** unique indexes
on `(tenant_id, nc_number)` and `(tenant_id, capa_number)`. If any tenant already has a duplicate, it
**refuses**, naming every one, rather than renumbering. These are ISO 13485 record identifiers, and
a migration should not rewrite them on its own authority. **Consequence:** migrations run at boot,
so a database holding duplicates refuses to boot until they are resolved by hand.

**Verified on real PostgreSQL 18:**
- **The defect:** the old logic issued `NC-00001` twice from two overlapping transactions.
- **The refusal:** the migration refused the duplicate and changed nothing.
- **After the fix:**
  - 25 concurrent NCs in each of two tenants came out distinct and gap-free, and 10 concurrent CAPAs
    did too;
  - a direct duplicate insert was refused with 23505;
  - `down`, `up`, `down` ran clean.

**Test:** `qms.numbering.a73.test.js` › *"two concurrent creates get distinct numbers"*. On the old
code both creates got `NC-00001`.

---

### A-74 — The QMS create routes have no validator

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-66) |

`POST /qms/nc` and `POST /qms/capa` mount no `validate(schema)`. An out-of-enum `severity` or a
missing `title` reaches the database and returns a 500, although Swagger documents a 400.

**What was changed (2026-09-24).** `createNCSchema` and `createCapaSchema` are mounted on the routes.
They validate the required NOT NULL fields and take their enums from `constants/qmsConstants.js`,
which the models also read. `tenantId` and `status` are stripped. `rootCause` is now stored — Swagger
documented it, and the service had been dropping it.

**Test:** `qms.tenancy.a75.test.js` › *"POST /nc with an invalid severity is a 400"*. On the old code
it returned 201.

---

### A-75 — QMS records can reference another tenant's device or user

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-66). The include behaviour is unverified |

`createNC` never checks that `deviceId` belongs to the caller's tenant, and `createCapa` never checks
`assignedTo`, so a foreign id is stored. `getNCs` and `getCapas` include `CalibrationDevice` and
`User` (as `assignee`) with no `required: false`. If the tenant hooks apply to the include, rows with
a foreign or deleted reference **vanish from the list** (the INNER JOIN trap). If they do not, another
tenant's device name or user **leaks**. Either is wrong.

**Definition of Done**
- [x] a foreign `deviceId` / `assignedTo` is refused with 404, by a two-tenant test
- [x] both includes are `required: false`, and a test shows no foreign attribute is returned

**What was changed (2026-09-24).**

- **Foreign references refused.** A foreign `deviceId` or `assignedTo` gets a 404 on create, and on
  `updateCapa`. The body is identical to the one for a missing id.
- **List includes.** Every include in the lists is `required: false` and carries an explicit
  `where: { tenantId }`.

**Verified on real PostgreSQL 18:**
- the lists return NCs that have no device, which the old INNER JOIN dropped;
- a reference to another tenant's device comes back as `device: null`.

**Tests:**
- `qms.tenancy.a75.test.js` › *"a foreign deviceId is refused with 404"* and *"a foreign assignedTo
  is refused with 404"*. Both returned 201 on the old code.
- `qms.includes.a75.test.js` › *"both QMS includes are required:false"*.

**What checking the includes uncovered is bigger than QMS — A-87.**

---

### A-76 — Tenant administrators hold platform operations

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — server check open |
| **Severity** | **critical** — if confirmed |
| **Verified** | from code, 2026-09-24 (A-63). **Not exercised against a server** |

`POST /tenants/create`, `GET /tenants/all` and `DELETE /tenants/delete` are gated on the `Management`
slug. The seed gives `management` to both HEALTHCARE ADMIN and CALIBRATOR ADMIN, and Engineering
Manager holds `read`. `tenants` is not tenant-scoped. So, as read from the code:
- a hospital's own admin can create tenants;
- anyone with `Management` read can list every hospital on the platform;
- a tenant admin can delete their own tenant, since only `checkTenant` applies.

**Fix direction:** these are platform operations — `superAdminOnly`, like
`PATCH /admin/tenants/:id/status` already is.

**Definition of Done**
- [x] a tenant admin gets 403 on create, list-all and delete, by a named test driving the real seed matrix
- [ ] verified against the running server

**Confirmed, then fixed (2026-09-24).** `tenant.platform.a76.test.js` builds the permission matrix from
the **real** seed (new fixture `seededAuthorization.js`) and drives the real `dynamicAccess`. Seven
tests failed against the old code:

| Caller | Request | Old answer |
|---|---|---|
| HEALTHCARE ADMIN, CALIBRATOR ADMIN | create a tenant | **201** |
| HEALTHCARE ADMIN, CALIBRATOR ADMIN | list every tenant | **200** |
| HEALTHCARE ADMIN, CALIBRATOR ADMIN | delete their own tenant | **200** |
| ENGINEERING MANAGER | list every tenant | **200** |

**The fix.** `/all`, `/create` and `/delete` are `superAdminOnly`. On `/create` the gate runs before
`upload()`, so a refused request writes no file. A tenant admin still reads and edits their own
tenant.

**The frontend follows:**
- tenant admins list only their own tenant;
- create and delete are shown only to the super admin;
- status and `maxUsers` are read-only for tenant admins, matching A-63.

---

### A-77 — User edits are unaudited

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-63) |

`userService.editUser` writes no audit row, and `/users/edit` has no `recordAudit`. A change to a
user's role or status — an authorization change — leaves no attributable record. The new profile
route inherits the gap.

**What was changed (2026-09-24).** User create, edit, role update and delete write their audit row
inside their transaction. `deleteUser` had no transaction at all, and the avatar file is now removed
only after the commit. The route-level `recordAudit` is removed, so each change gets one row, not
two. **Found while fixing:** the service's Joi schemas strip `createdBy` and `updatedBy`, so the
service had never known who made a change.

**Test:** `user.audit.a77.test.js`. 8 of its 10 tests failed against the old code.

---

### A-78 — `checkTenant` is blind to multipart bodies

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-63) |

`dynamicAccess`'s `checkTenant` reads `req.body.tenantId`. On a route where `upload()` (multer) runs
**after** the gate, a multipart body has not been parsed yet, so the check sees nothing and passes.
Every such route must enforce tenant ownership in its service. Enumerate them, and either move the
check into the service or parse before the gate.

**What was changed (2026-09-24).** `uploadAfterGate.a78.test.js` scans the route sources and **fails
if any route that runs `upload()` after `dynamicAccess` is missing from a reviewed list**. It found
five. Only `PATCH /tenants/edit` is truly blind, and its service enforces ownership (A-63). The other
four take the tenant from a path parameter or from the principal. The list, with the reason for
each, is in the test.

---

### A-79 — Tenant edit mishandles logo files

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | low |
| **Verified** | from code, 2026-09-24 (A-63) |

A refused edit (404, 403 or 409) leaves the uploaded logo on disk, which `createTenant` cleans up and
`updateTenant` does not. And the old logo is deleted **before** the commit, so a rollback — including
a failed audit insert — loses it.

**What was changed (2026-09-24).** A refused or failed tenant edit deletes the file it uploaded. The
old logo is deleted only after commit, in both `updateTenant` and `deleteTenant`.

**Found while fixing:** the logo could be set from the request body. A tenant admin could point
their logo at **another tenant's file**, and their next upload would then delete that file as "the
old logo". Only an uploaded file sets the logo now.

**Test:** `tenant.logo.a79.test.js`. 6 of its 12 tests failed against the old code.

---

### A-80 — The profile slug differs between assignment and seed

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-63) |

`ROLE_MENU_ASSIGNMENTS` grants `profile`; `seedMenuGroups` seeds `profile-page`. This is the A-58
shape: one of the two names matches nothing. Check whether the A-58 boot assertion covers
assignments, and extend it if not.

**What was changed (2026-09-24).** `MENU_SLUGS.PROFILE` is now `profile-page`, the seeded slug the
sidebar uses. The seed had been logging *"Menu group not found: profile"* for all 11 roles, so no
role ever received the profile grant.

Migration `0027-profile-page-grants` backfills seeded databases. It was verified on PostgreSQL 18.6
against a minimal schema, **not** the real DDL.

**The boot assertion now also refuses to start** if any `ROLE_MENU_ASSIGNMENTS` key is not a seeded
slug. Tests: `profileSlug.a80.test.js`, all 13 of which failed against the old code, and
`authorizationWiring.util.test.js` › *"boot's static phase REFUSES to start on a mismatched
assignment"*.

**Side effect:** API-key scopes follow `MENU_SLUGS`, so `profile` is no longer an accepted scope and
`profile-page` is. No gate uses either.

---

### A-81 — MFA verification is not rate-limited

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-67) |

`/auth/mfa/login` mounts no limiter. A 6-digit TOTP has 10⁶ values, and the MFA token lives for 5
minutes. A fresh token costs only the correct password, so a stolen password and an unthrottled
endpoint defeat the second factor.

**Definition of Done**
- [ ] N wrong TOTP codes for one MFA token or user lock further attempts, by a named test

**What was changed (2026-09-24).** `mfaLoginPreCheck` puts three counters on `/auth/mfa/login`:
- **per user:** 5 attempts per 15 minutes. It survives minting a new token and persists `locked_until`;
- **per token:** the token is revoked after 3 failures;
- **per IP:** only when `AUTH_RATE_LIMIT_BY_IP` is on.

**Test:** `auth.mfaRateLimit.a81.test.js` › *"N wrong TOTP codes lock further attempts"*.

**Moot until A-99 is fixed:** MFA login does not work at all in production.

---

### A-82 — Impersonation is unaudited

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-67) |

`impersonateUser` creates a session as another user and calls only `logger.info`. A super admin acting
as a hospital user is precisely what an audit trail exists to record.

**What was changed (2026-09-24).** Impersonation creates its session and a `LOGIN` / `Session` row,
with `changes.operation: "impersonate"`, in one transaction. The row names the super admin as the
actor and the target's tenant. If the audit insert fails, the impersonation fails.

**Test:** `auth.impersonation.a82.test.js`.

---

### A-83 — Status checks missing at three sign-in points

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-67) |

- Password login does not check the **tenant's** status; only the per-request middleware does.
- `loginMfa` ignores `lockedUntil`.
- `ssoExchange` does not re-check the user's status when the code is redeemed, which leaves a
  60-second window.

In each case the middleware refuses the token afterwards, but a session and a `LOGIN` row are written
for a sign-in that should have been refused.

**What was changed (2026-09-24).**
- **Password login** refuses a suspended, deleted or missing tenant with 403. The check comes after
  the password, so a tenant's status is disclosed only to someone holding the password, and before
  any session or row is written.
- **`loginMfa`** honours `lockedUntil` with a 423, checked before the code.
- **`ssoExchange`** re-reads the user and the tenant at redemption.

**Tests:** `auth.signInStatus.a83.test.js` and `sso.exchangeStatus.a83.test.js`. 19 of the tests for
A-81, A-82 and A-83 failed with the fixes disabled.

**Still open (A-101):** the per-request `auth` middleware still admits a user whose tenant has been
soft-deleted.

---

### A-84 — The signing route has no permission gate

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium — A-65's signer check limits it |
| **Verified** | from code, 2026-09-24 (A-65) |

`POST /esignature/sign` mounts `auth` and `denyApiKey` only. CLAUDE.md: every route needs a gate.

**What was changed (2026-09-24).** Three of the eleven e-signature routes had no gate:
`POST /sign`, `POST /verify` and `GET /history`. They now use a new `esignature` slug — `write` to sign,
`read` to verify and read history.

**Why a new slug rather than `qms`:** a signer is whoever the workflow names, and most roles have no
`qms` menu.

**Default grant: every seeded role gets `esignature: write`.** A-65 already refuses anyone but the
named signer, so the gate adds what was missing:
- a tenant can withdraw signing per role, or per user;
- an API key needs an explicit scope.

The default is recorded in ADR-049.

**Migration `0025-esignature-menu-grants`** backfills seeded databases. It never overwrites an
existing grant, and does nothing on an unseeded database. It was verified on PostgreSQL 18.

**At deploy:** each role's permission matrix is cached in Redis for up to an hour. Flush
`permissions:*`, or non-admin signers get 403 for up to an hour.

**Test:** `eSignature.gate.a84.test.js`, which runs the real router against the real seed matrix. It
includes a withdrawn grant (403) and a read-only role that can verify but not sign. The A-58 check
reports 140 gates and 0 errors.

---

### A-85 — Two state conflicts answer 400

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | low |
| **Verified** | from code, 2026-09-24 (A-65) |

Signing a step that is not pending, and editing a signed or revoked certificate, are state conflicts:
**409 with a state explanation**, per CLAUDE.md. Both return 400.

**What was changed (2026-09-24).** Both conflicts now answer 409 with a state explanation instead of
400:

- **Signing a step that is not pending.** The explanation depends on the state: *waiting for an
  earlier signer*, *already signed*, or *declined*.
- **Editing a signed or revoked certificate.** A signed one names the revoke route and says to issue a
  new certificate; a revoked one says revocation is final.

**Tests:**
- `esignature.service.coverage.test.js` › *"A-85: signing a step that is not pending is 409 with a
  state explanation"*
- `certificate.service.test.js` › *"A-85: a PUT on a signed certificate is 409…"*

---

### A-86 — External signers cannot sign

| | |
|---|---|
| **Status** | TODO — **owner decision** |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-65) |

A workflow step can name a signer by email alone (`signerId` null). No route authenticates such a
signer, and since A-65 nobody else may sign in their place — so such a workflow can never complete.
Either external signing gets a real identity mechanism (an emailed one-time link and a
re-authentication step), or workflows refuse external signers at creation.

---

### A-87 — The tenant hooks do not reach includes

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — mechanism; call sites under A-90 |
| **Severity** | **critical** — a codebase-wide cross-tenant read path |
| **Verified** | against Sequelize's real PostgreSQL SQL generation, with the real models and hooks, 2026-09-24 (A-75). Pinned in `qms.includes.a75.test.js` |

CLAUDE.md says tenant isolation is enforced by global hooks, deny-by-default, and that "you do not
opt in". **That is true of the root query only.** `beforeFind` fires once, for the model `findAll`
is called on, and it adds the tenant predicate to that model's `WHERE`. An `include` of another
tenant-scoped model gets **no** tenant predicate. Any include whose foreign key can point at another
tenant's row returns that row's attributes. Rows are pointed that way today: A-75 found QMS storing
unchecked foreign ids, and there is no reason to believe it was the only writer that trusted a body
id.

Second finding, same test: including `User` or `CalibrationDevice` — both have a `defaultScope`
`where` (`is_deleted = false`) — is treated as **required**, an INNER JOIN, even when the include
names no `where`. So the most repeated defect in this codebase, the one CLAUDE.md's trap table puts
first, has a trigger nobody had written down.

**Fix direction:** decide the mechanism once, not per query. Either a hook that walks
`options.include` recursively and adds the tenant predicate to every tenant-scoped model, or a lint
or test that refuses an include without an explicit tenant `where`. Then audit every include of a
tenant-scoped model — `User` and `CalibrationDevice` first — for both the leak and the INNER JOIN.
This is an architectural change to ADR-029's mechanism, so it needs an ADR.

**Definition of Done**
- [x] a test proves an include of a tenant-scoped model carries the tenant predicate, for every include in the codebase — data-driven, not per query
- [ ] every include of a `defaultScope`d model is `required: false` unless an INNER JOIN is intended and commented
- [x] an ADR amends ADR-029, and CLAUDE.md's "you do not opt in" is corrected

**What was changed (2026-09-24, ADR-048).** `tenantScope.util.js#applyTenantToIncludes` runs in
`beforeFind` and `beforeCount`:

- It normalises the includes with Sequelize's own helpers, then walks the tree, `through` models
  included.
- It adds the root's tenant predicate to every tenant-scoped include's ON clause, resolved by the
  same `resolveScope`, with the same super-admin and system exemptions.
- It first pins `required` to Sequelize's own default, so **a join type never changes**: LEFT stays
  LEFT, and a cross-tenant related row joins as `null`.
- `separate` includes are scoped by their own `findAll`.
- `skipTenantScope: true` on an include is the only opt-out.

**Tests** are in `tenantScope.includes.a87.test.js`, 743 of them:
- **Data-driven:** every one of the 245 associations in the models barrel, with implicit,
  `required: false` and `required: true` includes. The join type must equal the no-hook baseline,
  and a tenant-scoped target must carry the predicate.
- **343 failed** with the hook call disabled.
- **A mutation test:** the naive `include.where = { tenantId }` breaks 50 of them, 46 of which turn a
  LEFT JOIN into an INNER JOIN.

**Verified on PostgreSQL 18.6:**

| Query, run as tenant A | Before | After |
|---|---|---|
| NC list whose NC points at tenant B's device and user | returned `B SECRET DEVICE` and `secret-b-user@b` | both `null`; no rows lost |
| CAPA with a LEFT include of B's NC | returned tenant B's NC | `null` |

**Not done here:** the `defaultScope` INNER JOIN (DoD 2) is deliberately **not** forced by the hook,
because join semantics are a query-author decision. Those sites are **A-90**.

**The risk:** the fix relies on private Sequelize statics. The data-driven test fails if an upgrade
changes them.

---

### A-88 — Associations that create a second, nullable `tenant_id`

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | on PostgreSQL 18, `\d non_conformances`, 2026-09-24 (A-75) |

`NonConformance` and `Capa` associate to `Tenant` with `foreignKey: "tenant_id"` — the column name,
not the attribute name. Sequelize adds a second attribute. On a database built by `sync()`, the
column comes out **nullable with `ON DELETE SET NULL`**: a deleted tenant leaves orphaned rows that
belong to nobody, and the tenant hooks' predicate cannot match them. The same shape exists on other
associations. **Fix direction:** find every `foreignKey: "tenant_id"`, use the attribute name, and
verify the column in psql on a fresh database.

---

### A-89 — The QMS form lets required fields be empty

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code, 2026-09-24 (A-74) |

`dashboard/qms/page.tsx` treats `description` and `actionPlan` as optional. Both are NOT NULL. Since
A-74 the API answers with a 400 instead of a 500, but the form should mark them required.

---

### A-90 — Implicit INNER JOINs at about twenty call sites

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code and SQL generation, 2026-09-24 (A-87) |

Includes of `User`, `CalibrationDevice` and `Warehouse` with no `required` are INNER JOINs, because
those models have a `defaultScope` `where` (A-75). They drop parent rows whose reference is null or
soft-deleted. `calibrationDevices.service.js` states that a device may have no warehouse, yet its list
query drops every such device.

Since A-87, they also drop rows whose reference points outside the tenant. The realistic case is the
super admin acting inside a tenant: calibration performer, stock adjuster, SOP author, backup creator,
session user.

Sites, from A-87:

| File | Includes |
|---|---|
| `calibrationRecords.service.js` | `device`, `performer` |
| `calibrationDevices.service.js` | `warehouse` |
| `stock.service.js` | seven sites: Warehouse, `adjuster`, `requester`, `approver`, `performer` |
| `sop.service.js` | `author` |
| `supplierScorecard.service.js` | `evaluator` |
| `tenantBackup.service.js` and its controller | `creator` |
| `session.controller.js` | `user` |
| `certificate.service.js` | `device` |

**Definition of Done**
- [x] every listed include is `required: false`, or carries a comment saying why an INNER JOIN is intended
- [x] a test per service shows a row with a null or foreign reference is still listed

**What was changed (2026-09-24).**

**Fixed with `required: false` and a comment:** all 12 listed sites, plus 5 more:
- a published CMS post with no category returned 404 by its slug;
- a user whose role had been deleted returned 404 for their permissions;
- a workflow step whose role had been deleted silently vanished from its workflow.

**Left INNER deliberately, with a comment saying why:**
- `verifyApiKey`'s tenant include. A LEFT JOIN would let a key whose tenant was soft-deleted
  authenticate. A test pins it.
- The role filters in `roles.service`.
- The tenant tree.

**Found and fixed while doing this — tenant backups had never worked against the real models.**
`TenantBackup` had no `creator` association, yet `createBackup`, `downloadBackup` and `getBackup` all
included it. Every backup wrote its archive, then threw *"User is not associated to TenantBackup!"*,
was marked FAILED, and returned 500. The unit tests mocked the models. The association is added; the
column already existed.

**Tests:** `includes.a90.test.js`. It uses the real models and hooks to generate the SQL, and asserts
a LEFT OUTER JOIN with the tenant predicate still in the ON clause. **11 of its 12 tests failed**
against the old code, including the two backup tests. Behavioural tests were added in the
calibration-record and device services.

---

### A-91 — Signers cannot open the workflow they are asked to sign

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-84) |

`/dashboard/esignature` loads workflows through `GET /workflows` and `GET /workflows/:id`, which are
gated on `qms:read`. Technicians and every other role without a `qms` menu can be named as signers
(A-84 grants them `esignature: write`), but cannot open the workflow to sign it. A-65 made them the
only people who can sign their step. So a workflow naming a technician cannot complete.

**Fix direction:** a signer can read the workflows in which they are named, through the
`esignature` slug, or through a "my pending signatures" route. Workflow **management** stays on `qms`.

**What was changed (2026-09-24).** Two signer-scoped routes are gated on `esignature` read, not `qms`:

- **`GET /esignature/my-workflows?stepStatus=…`** returns only the workflows in which the caller is a
  named signer. It uses the house envelope, and returns no signer's recorded IP address or user agent.
- **`GET /esignature/my-workflows/:workflowId`** returns **404** — byte-identical — whether the
  workflow is missing, belongs to another tenant, or does not name the caller. A 403 would let any
  user in the tenant probe which workflow ids exist.

Every query carries an explicit tenant predicate on top of the hooks. Management stays on `qms`.

**Also changed:** the management route `GET /workflows/:id` now answers 404 where it used to answer
`200` with `data: null`.

**Frontend.** A new default **To sign** tab lists the caller's workflows, opens one and signs it. The
management tabs load lazily and show a permission notice on a 403.

**Test:** `eSignature.signer.a91.test.js`, run on the real router against the seeded matrix, with
`createTwoTenants()`. It includes *"a technician named as signer can open and sign their step"*,
*"a user not named as signer cannot read the workflow"*, and a two-tenant 404. **10 of its 11 tests
failed against the old code.**

**At deploy:** flush `permissions:*` (ADR-049).

---

### A-92 — More conflicts with the wrong status

| | |
|---|---|
| **Status** | **PARTIAL** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-85) |

These state conflicts answer 400 where the rule is 409 with a state explanation:
- `eSignature.service#updateWorkflow`
- `eSignature.service#cancelWorkflow`
- `certificate.service#deleteCertificate` on a signed certificate

These in-tenant unique violations answer 500 where the rule is 409:
- changing a device's serial to one another device in the tenant holds;
- re-creating the serial of a soft-deleted device, because the duplicate pre-check does not see
  soft-deleted rows.

`calibration_devices.iot_device_token` is also globally unique. It is a token, not a guessable
identifier, so the risk is low.

**What was changed (2026-09-24).** These now answer **409** with a state explanation:

- `updateWorkflow` on a completed or cancelled workflow;
- `cancelWorkflow` on a completed workflow;
- `deleteCertificate` on a signed certificate — *"Revoke it … instead"*.

**Still open:** the two device-serial 500s in `calibrationDevices.service.js`.

---

### A-93 to A-98 — Found while fixing A-76 to A-80

| | |
|---|---|
| **Status** | TODO |
| **Verified** | from code, 2026-09-24 |

- **A-93:** in `dynamicAccess`, when the request carries any `tenantId` (body or query) equal to the
  caller's own, the tenant branch runs and the `userId` owner check never does. Routes such as
  `/users/:userId/avatar` then rely on the global hooks alone.
- **A-94:** `POST /ai/ocr` mounts only `auth` (P6-04).
- **A-95:** `createTenant` and `deleteTenant` write no audit row, and `deleteTenant` reads `deletedBy`
  from the body or query.
- **A-96:** the two `/tenants/:tenantId/logo` routes and the avatar routes write no audit row, delete
  the old file **before** the update, and leave a refused upload on disk.
- **A-97:** `POST /attachments` accepts any `resourceId`. It cannot cross tenants, but it can dangle.
- **A-98:** `change-password` is a sibling of `profile-page` under Account, and five roles have no
  `account` grant, so they have no Change Password entry in the menu. This is a product decision.

---

### A-99 — MFA has never worked on this dependency version

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — deployed-binary check open |
| **Severity** | **critical** — every MFA-enabled account is locked out, and MFA cannot be set up |
| **Verified** | `node -e` in this repo, 2026-09-24: `otplib` **13.5.0** exports `TOTP`, `verify`, `generateSecret`, … and **no `authenticator`** |

`auth.service.js` (three sites) and `mfa.service.js:1` destructure `authenticator` from `otplib`. On
13.x that is `undefined`, so setting up MFA, verifying setup and logging in with MFA all throw a
`TypeError`. `jest.config.js` maps `otplib` to `__mocks__/otplib.js`, whose `check()` returns `true`
**for any code**. So every MFA test passed, and each one proved only that the mock agrees with
itself.

This is the **sixth** instance this month of a mock inventing a contract: `connected`, `isOpen`,
`"RESTORE"`, `"DOCUMENT_SIGNED"`, a constant `uuid`, and now a whole missing export — this time
behind a global `moduleNameMapper` that no test file names.

**Definition of Done**
- [x] MFA setup, verification and login work with the **real** `otplib`, by named tests
- [x] no global mock remains for a library whose real API the code has not been checked against

**What was changed (2026-09-24).** All TOTP work now lives in `mfa.service.js`, on the otplib 13 API:

| Operation | Implementation |
|---|---|
| create a secret | `generateSecret`: 20 bytes |
| build the setup URI | `generateURI` |
| check a code | `verifySync` with `epochTolerance: 30`, which accepts exactly one step either side |

`checkCode` never throws: a malformed code is `false`, and a secret that cannot be decoded is
logged and refused.

**Old 80-bit secrets still verify.** otplib 13's default minimum would have locked them out, so
verification lowers the minimum while new secrets stay at 20 bytes.

**The global mock is deleted.** The file in `__mocks__/` mocked `otplib` for every test by itself —
removing the `moduleNameMapper` line alone changed nothing.

**Tooling.** otplib 13's CommonJS build requires ES-module-only dependencies. Jest therefore runs
with `--experimental-vm-modules` through the npm scripts, and a bare `npx jest` on the four
real-otplib suites fails. `CLAUDE.md` now says so.

**Test:** `mfa.realOtplib.a99.test.js`, 21 tests with no mock. It includes *"MFA setup, verify and
login work with the real otplib"* and *"a wrong TOTP code is refused by the real otplib"*. Against
the old service the setup test failed with `TypeError: Cannot read properties of undefined (reading
'generateSecret')`.

**Open:** whether the production pkg binary loads otplib's ES-module dependencies. The old code
required otplib at startup and the app booted, which suggests it does; that is an inference. MFA
setup must be exercised against the deployed server.

---

### A-103 to A-106 — What was changed (2026-09-24)

**A-103.** A new `response.util.js#sendResult` sends any result with a status of 400 or more, or with
`success: false`, through `error()`. All ten certificate handlers use it, and the list handler now
puts `meta` at the top level.

Test: `certificate.controller.envelope.a103.test.js`. **17 of its 27 tests failed** against the old
code — every 404 and 409 had gone out as `success: true`.

**A-104.** Workflow update, cancel and delete lock the row, then write the change and its audit row in
one transaction. An update that changes nothing writes nothing.

Test: `esignature.workflowAudit.a104.test.js`, on the audit ledger. **8 of its 12 tests failed**
against the old code.

**A-105.** `getWorkflow` no longer swallows errors: a database failure is a 500, not a 404. It is
tenant-scoped explicitly, its include is `required: false`, and the step order now actually applies.

**A-106.** `GET /workflows` and `/history` now use the house envelope, and the frontend reads it.

Test: `eSignature.envelope.a105a106.test.js`. The frontend service and page tests failed 6 of their
tests against the old service.

---

### A-93 to A-97 — What was changed (2026-09-24)

**A-93.** `dynamicAccess`'s tenant check and owner check are now independent, and both run whenever
`checkTenant` is set.

- **Tenant check:** every `tenantId` the request names must be the caller's own.
- **Owner check:** every `userId` it names must be a user in the caller's tenant.
- A body or query value can **only refuse, never allow**.

Before, a request carrying the caller's own `tenantId` skipped the owner check, so
`DELETE /users/<tenant B user>/avatar?tenantId=<own>` returned **200**.

Tests: `dynamicAccess.test.js` › *"A-93 — checkTenant: tenant and owner checks are independent"*, and
`user.avatar.a93.test.js`. All 7 of the former, and 4 of the latter, failed against the old code.

**A-94.** Both AI routes are gated on existing slugs:

| Route | Needs | Roles that keep access |
|---|---|---|
| `POST /ai/ocr` | `certificate` write, checked before multer | HEALTHCARE ADMIN and CALIBRATOR ADMIN |
| `POST /ai/query` | `sop` read | the two admins and ENGINEERING MANAGER |

Test: `ai.gate.a94.test.js`, run against the real seeded matrix. **17 of its 24 tests failed**
against the old code: every non-admin role had received 200.

**A-95.** Tenant create and delete write their audit row in the transaction. The actor comes from
`req.user`, and `deletedBy` is stripped from the body. Test: `tenant.audit.a95.test.js`, 10 of 13
failed against the old code.

**A-96.** The logo and avatar changes write the row update and the audit row in one transaction,
and delete the old file only after commit. Each service checks the tenant itself, and a refused
upload is deleted. Test: `user.avatar.a96.test.js`, 15 of 20 failed against the old code.

**A-97.** An attachment's `resourceId` must be a live record in the caller's tenant for its type:
404 otherwise, 400 for a type that cannot be linked. Test: `attachment.link.a97.test.js`, 16 of 19
failed against the old code.

---

### A-119 to A-131 — Implementing ADR-051

| | |
|---|---|
| **Status** | TODO |
| **Decided by** | ADR-051, from two debate papers, on the owner's standing instruction |

Each row's decision is in ADR-051, and its evidence is in the papers' §0 tables (A: F-1 to F-12;
B: F-1 to F-4). Every fix follows the usual rules:
- a named test that fails on the old code;
- a two-tenant test where an id is involved;
- audit rows inside the transaction;
- migrations that **refuse** rather than guess.

**Rollout order** (from paper B, adopted):
1. **A-121**, before any audit row reaches 365 days.
2. **A-122**, the RESTRICT migration.
3. **A-120** and **A-123**.
4. The rest.

---

### A-92 (rest), A-110, A-111 — What was changed (2026-09-24)

**A-92, device serials.** A serial held by another device in the tenant is a **409 that explains**
the conflict — live or deleted, on create, update and bulk import. A unique violation that races past
the check is mapped to 409 as well. A create does not silently resurrect a deleted device, because
that would re-attach an old history with no audit trail. `""` is stored as NULL, since two serial-less
devices had collided on the index. The controller now sends non-2xx results with `success: false`.

Test: `calibrationDevices.serial.a92.test.js`. **11 of its original 14 tests failed** against the old
code — every one of them a 500 from the index.

**A-110.** The aliases are fixed, and so is a second latent defect: the query read `role.level`, but
the attribute is `roleLevel`. The query had also selected `password`, `mfa_secret` and `otp_code`.
Errors are no longer swallowed as `[]`. Test: `tenantHierarchy.userRoles.a110.test.js`, which failed
3 of 3 against the old code.

**A-111.** `GET /sessions` uses the house envelope, and the frontend reads it. The frontend test
failed 3 of its tests against the old code.

---

### F-8 / A-127 (first half), A-112 — What was changed (2026-09-24)

**F-8 — audit rows name the impersonator.** The `auth` middleware reads `impersonatorId` from the
**verified token only**. It runs the request inside an impersonation context, and
`audit.service#logAction` falls back to that context. So **every** audit row written during an
impersonated request names the operator, including the rows of services that copy actor fields one
by one — with no change to any of them.

Migration `0029-audit-log-impersonator` adds `audit_logs.impersonator_id`. **It has not yet run on
PostgreSQL** — check it at deploy with `\d audit_logs`. The audit API returns `impersonator`, but the
frontend does not show it yet.

**Test:** `auth.impersonator.f8.test.js` › *"a change made while impersonating records the
impersonating super admin"*. **All 12 of its tests failed** against the old code.

**Still open:**
- **A-127:** refusing Part 11 acts while impersonating (ADR-051 Q-17).
- `refreshUserToken` drops the claim. It is safe today only because the impersonation response never
  hands out a refresh token.

**A-112.** `calibrationRecords` and `tenant` controllers use `sendResult`; the device controller got
a local equivalent under A-92. Test: `envelope.a112.test.js`. **31 of its 55 tests failed** against
the old code.

---

### A-121, A-132 — What was changed (2026-09-24)

**A-121 — audit rows are never purged (ADR-051 Q-10 and Q-12).**

- `audit_logs` is gone from the retention defaults and from the purge. A stored override is
  ignored.
- The dead second engine in `gdpr.service` is deleted.
- `setRetentionPolicy` answers **400** for:
  - `audit_logs`;
  - a policy with no tenant;
  - an unknown key;
  - a value below a per-entity floor, which is documented in code: notifications and sessions 30
    days. `0`, meaning keep forever, is always allowed.
- The purge also applies the floor to values already stored.
- The model refuses a tenant-less row.

**Test:** `dataRetention.a121.test.js` › *"the retention purge never deletes an audit row"*, *"a
retention policy for audit_logs is refused"*, *"a policy below the minimum is refused"* and *"a
global retention policy cannot be created"*. **14 of its 16 tests failed** against the old code — one
with `AuditLog.destroy` called with a cutoff a year back.

**A-132 — 4xx explanations shown, 5xx internals hidden.** The card was only half right:

- the `next(err)` path hid **every** 4xx message in production;
- and the `asyncHandler` path — 44 controllers — sent **raw 500 messages, including database and
  host internals**, in production.

One rule now serves every path. **Shown:** an operational 4xx `AppError`, a plain `{status, message}`
validator throw, or an `expose` error. **Generic with a request id:** everything else.

**Also fixed:**
- the global handler wrote to responses that had already been sent (`ERR_HTTP_HEADERS_SENT`);
- `roles.service`'s eleven hand-built errors are now `AppError`.

**Test:** `errorHandlers.a132.test.js`, a real Express app with `NODE_ENV=production`, over HTTP.
**6 tests failed** against the old code; one of them received `relation "secret_table" does not exist
on db.internal:5432`.

**This also completes A-13's `asyncHandler` half:** wrapped controllers now take the same
sanitised path.

---

### A-109, A-113 to A-115, A-117, A-119, A-138, F-2 — What was changed (2026-09-24)

**A-138 — found and fixed while doing A-109.** `user.service#safeUserAttributes` excluded
`otp_code`, `locked_until` and so on — **column** names. Sequelize matches exclusions against
**attribute** names, so it excluded nothing, and it never named `mfaSecret` at all. `GET /users`
returned every user's TOTP secret, so anyone allowed to list users could generate their codes. The
list now uses attribute names. Test: `user.safeAttributes.test.js`. **Both tests failed** against the
old code, whose SELECT carried `mfa_secret`, `otp_code`, `webauthn_public_key` and 13 other secret
columns.

**A-114.** On an MFA-enabled account, a rotation needs the current password **and** a current code;
otherwise it is a 409. The new secret is held **pending** in a database column (migration
`0028-user-mfa-pending-and-replay`) for 15 minutes. It replaces the live secret only when a code from
it verifies, in one transaction with an audit row (`MFA_ENABLE` or `MFA_ROTATE`).

A database column rather than Redis, because the promotion must share a transaction with the audit
row, and Redis is optional in this deployment.

Test: `mfa.rotation.a114.test.js`, run with the real otplib.

**A-115.** `consumeCode` records the time step of each accepted code with a conditional update, so a
code cannot be used twice — **not even by two racing requests**. It applies to login, rotation, setup
and signing.

Test: *"a TOTP code cannot be used twice"*.

**A-119.** Signing requires `isActive` and `status === USER_STATUS.ACTIVE`. Test:
`esignature.signerStatus.test.js` › *"a real ACTIVE user (as stored by the model default) can sign
their step"*. It builds the user from the real model's defaults, and it failed against the old code.

**F-2.** `userCreate` writes `isEmailVerified`. A data-driven test checks that every key it writes is
a model attribute.

**A-109.** The remaining implicit INNER JOINs on Role and Device are fixed. A second cause was found:
`role_id NOT IN (…)` is NULL for a user with no role, so those users vanished even after the join fix.

**A-113.** `/key-pairs` uses the house envelope; deleting a completed workflow is a 409.

**A-117.** Attachment create and tenant-settings update write audit rows. The settings row records
**which keys** changed, never their values.

**Migration `0028` has not run on PostgreSQL.** Check `\d users` at deploy.

---

### A-127, A-133 — What was changed (2026-09-24)

**A-127 (ADR-051 Q-17, ADR-052).** `denyPlatformAuthoring` answers **403 with an explanation** in
three cases:
- the request is impersonated;
- a super admin is acting in another tenant through a header override;
- a super admin has no home tenant.

It is mounted on:
- `POST /esignature/sign`;
- certificate approve, submit, sign and revoke;
- calibration-record create, update and delete.

**A super admin acting in their own home tenant runs those routes as an ordinary member** (ADR-052).
Otherwise the tenant scope skips super admins entirely, and one could sign another tenant's record by
its id with **no header at all**.

**Tests.** `denyPlatformAuthoring.a127.test.js` runs every such route three ways and **scans the route
sources**. Every write matching sign, approve, revoke, submit, publish and so on must be guarded or
listed in `NOT_GUARDED` with a reason. **28 of its 42 tests failed** against the old code, among them
*"signing while impersonating is refused"* and *"approving a certificate as a super admin in another
tenant is refused"*.

The audit viewer shows *"impersonated by …"* and *"Platform operator"*. A soft-deleted user also
reads as null, so the tooltip says so.

**A-133.** Device create, update and delete each write their audit row in the transaction. Bulk import
writes one summary row. Test: `calibrationDevices.audit.a133.test.js`, **8 of its 10 tests failed**
against the old code. **Restoring a device** remains a decision — its 409 message already says
restoring is unavailable.

---

### A-122 / A-88 / W-20 — What was changed (2026-09-24, ADR-051 Q-16)

**Migration `0030-tenant-foreign-keys-restrict`.**

- **Finds constraints by column** in `pg_constraint`, so it works on any database `sync()` ever
  built, duplicate constraints included.
- **Refuses before changing anything** if a column that must become NOT NULL holds NULLs, or holds
  ids pointing at nothing. It lists table, column, count and samples, and never deletes or reassigns
  a row.
- **One transaction**, with a lock timeout.
- **Reversible and idempotent:** `down` restores the previous constraints verbatim.

**Decisions:**

| Scope | Behaviour |
|---|---|
| Tenant FKs, 38 tables, **including `audit_logs`** (W-20), users, invoices and legal-hold settings | `RESTRICT` |
| 15 derived or integration tables (sessions, notifications, usage metrics, webhooks, API keys, counters…), each with its reason in code | `CASCADE` |
| Tenant columns everywhere except `users`, `sessions` and `data_retention_policies`, where NULL means something | NOT NULL |
| Regulated user FKs: `calibration_records.performed_by` (F-6), certificate calibrator, approver and signer, e-signature and signature records, audit user and impersonator, SOP acknowledgement and author, CAPA approver | `RESTRICT` |

**A-88:** about 50 models now use the attribute name as the foreign key, with explicit `onDelete`, so
a **fresh `sync()` builds the same schema the migration produces.**

**Verified on PostgreSQL 18.6.** The old schema was built from the pre-change models with sample
data.

| | Before | After booting the new code |
|---|---|---|
| Delete the user who performed a calibration | NULLed `performed_by` and the audit `user_id` | refused on `calibration_records_performed_by_fkey` |
| Delete tenant A | **deleted all its audit rows** | refused on `audit_logs_tenant_id_fkey` |

- A tenant holding only notifications still deletes.
- `up` twice is a no-op, and `down` restores the old catalog exactly.
- The refusal fires on orphans and changes nothing.
- **A migrated old database and a fresh one have identical FK catalogs (154) and nullability.**

**Tests:**
- `tenantForeignKeys.a88.test.js` renders every model's DDL. **213 of its 334 cases failed** against
  the old models.
- `0030-…test.js`: mutation checks confirm the refusal and the `audit_logs` rule are load-bearing.

**Consequences:**
- The dev unseed tools and the unrouted `hardDeleteOffboardedTenant` are now refused wherever
  regulated rows exist. **That is the intent.**
- The migration runs at boot, so **run the orphan query by hand before a planned deploy.**

---

### A-120, A-135, A-136, A-139, A-140 — What was changed (2026-09-24)

**A-139.** The backup exports an **allow-list** of user fields and of tenant fields. Each list is
applied in the SELECT and again when the archive is written.

- The tenant's `settings` column is no longer exported: the restore needs only the tenant id, and
  that column held plaintext credentials (A-150).
- The new `mfaRecoveryCodes` column is excluded automatically; a deny-list would have exported it.

Test: `tenantBackup.secrets.a139.test.js` › *"a tenant backup archive contains no second-factor or
credential field"*. **4 of its 5 tests failed** against the old code — `mfaSecret` was in the
archive.

**A-120 (ADR-051 Q-09).** A restore never creates an account. A missing account is reported as
`notRestored`, with `erased` or `absent`. **The audit row lists archive entry numbers, not
usernames**: an erased person's username must not be written into a table that is never purged.
Test: *"a restore never re-creates an account missing from the tenant (e.g. GDPR-erased)"*.

**A-140.** The profile export joins `role` by its alias. The audit part of the export filtered on a
column that does not exist, so a subject received an error object instead of their audit rows; that
is fixed too. Test: `gdpr.exportProfile.a140.test.js`, **4 of its 6 tests failed** against the old
code.

**A-135.** Audit rows are masked **per data subject** (`subjectIds`), never per row id. Otherwise an
operator could blank the IP address of chosen rows.

- On rows the subject performed, the IP address and user agent are masked.
- On rows about the subject, their personal data inside `changes` is masked.
- **No row is deleted**, and who, what and when are untouched.
- It runs in a transaction with its own audit row, and is refused under legal hold.
- User masking now writes a unique valid address per user. It used to write one shared
  `[REDACTED]` value, which would collide on the unique index.

The frontend retention page now uses the backend's real keys, and the "Audit Logs" row is gone.

**A-136.** Both reads require `data-retention` read, and another tenant's id answers 404. Test:
`dataRetention.gate.a136.test.js`, **18 of its 24 tests failed** against the old code.

---

### A-129, A-130, A-144 — What was changed (2026-09-24, ADR-051 Q-19, A-107, A-86)

**Who can sign.** USER, ROOM USER and WAREHOUSE STAFF lose the default `esignature` grant. Migration
`0032-esignature-technical-roles-only` removes the grant **only where it is still the untouched
default**: `write`, never updated, and with no audited assign or remove. It reports any grant it keeps
and any open workflow naming such a signer.

**Workflow creation (`resolveSigners`).**

| Signer | Answer |
|---|---|
| no `userId`, e-mail only (A-86) | 400 |
| not a user of this tenant — missing, deleted or another tenant's | **404**, the same for all three |
| inactive, or lacking `esignature: write` | 400, naming the signer |

- The signer's name and e-mail come from the user row (F-10).
- The workflow, its steps and a `CREATE` audit row are written in one transaction.

**Signing.** The meaning is mandatory. A cancelled workflow cannot be signed (409).

**History (F-9).** Without `qms` read, only the caller's own signatures are returned, with no IP
address, user agent or biometric data.

**Deletion (A-107, A-144).**
- A workflow with **any** signature, revoked or soft-deleted included, answers **409**.
- An approved, signed or revoked certificate answers **409**, with an explanation per status.
- A new `POST /workflows/:id/cancel` answers 409 when the workflow is already cancelled.
- Public verification reads soft-deleted rows, so a deleted certificate reports **withdrawn**, not
  "no certificate matches" (F-11).

**Frontend.** Signers are picked from `GET /signers`, not typed as e-mail addresses. There is a Cancel
action, and 409 explanations are shown as warnings. The verify page has a "withdrawn" verdict.

**Tests.** `eSignature.a129a130.test.js`, 29 tests on the real router with `createTwoTenants`, and
`esignature.a129a130.service.test.js`. **46 backend and 13 frontend tests failed at `2a157f1`.**

**Migration `0032`** was verified on a throwaway PostgreSQL. Flush `permissions:*` at deploy.

---

### A-123, A-141, A-142 — What was changed (2026-09-24, ADR-051 Q-11, A-98)

**A-123.** Migration `0031` adds `users.must_change_password`, which `userCreate` sets. While the flag
is set, the auth middleware answers every route **403 `PASSWORD_CHANGE_REQUIRED`**, except these:
- change password;
- logout, and logout from all sessions;
- `/verify`.

Changing the password clears the flag and is audited as `PASSWORD_CHANGE` in its transaction. A new
password identical to the current one is refused. An e-mail-code reset marks the address verified
(Q-11) and is audited. The frontend redirects on the 403, and signs the user out after the change.

**A-141.**
- **Recovery codes.** Enabling or replacing an authenticator issues 10 single-use codes, stored only
  as salted hashes. A code is spent atomically: live on PostgreSQL, two concurrent uses updated 1
  row and 0 rows. It is accepted at MFA login.
- **Disabling MFA** needs the password plus a current code or a recovery code, and revokes the user's
  other sessions in one audited transaction. So does replacing an authenticator.
- **Admin reset:** `POST /users/:userId/mfa/reset` requires a tenant admin.

  | Target | Answer |
  |---|---|
  | another tenant's user | 404 |
  | the caller's own account | 400 |
  | a user with a higher role | 403 |
  | a user without MFA | 409 |
- **Frontend:** a turn-off control, the codes shown once, and a "use a recovery code" option at login.
- `/auth/verify` now returns `mfaEnabled`. It had been missing, so the MFA page thought MFA was off
  after every reload.

**A-142.** Setup, verify and disable share one budget per user: 5 failures per 15 minutes, then 429.
It never writes `locked_until`, so it cannot lock anyone out of signing in.

**Tests.** 8 new backend suites and 6 new frontend suites, including two-tenant 404 on the reset
route and the real otplib. **At `2a157f1`, all 14 new suites failed**: 68 of 81 backend tests and 22
of 28 frontend tests.

---

### A-124, A-125 — What was changed (2026-09-24, ADR-051 Q-13, Q-14)

**A-124 — migration `0033-audit-log-actor`.** It adds `actor_type` (`user`, `system` or `unknown`,
NOT NULL, **no default**) and `actor_name`, and backfills honestly:

| Existing row | Backfilled as |
|---|---|
| has a `user_id` | `user` |
| no user, and a `system:` name in `changes.actor` | `system`, with that name |
| anything else | `unknown` |

A **CHECK constraint** holds the rule in the database itself:
- a `user` row has a user and no name;
- a `system` row has no user and a registered `system:` name;
- `unknown` is allowed **only on rows created before the migration** — the migration's own
  timestamp is written into the CHECK as a literal.

`logAction` requires exactly one of a user or a registered system actor (`constants/systemActors.js`),
and refuses anything else with the A-42 semantics. The audit viewer shows "Retention purge", "Tenant
lifecycle" and "Unknown (not recorded)".

**A-125 — migration `0034-platform-tenant`.** It creates the reserved PLATFORM tenant, and refuses on a
code or id collision; `down` refuses while anything references the row.

- **Tenant model hooks** exclude PLATFORM from every query, count, bulk update and bulk destroy unless
  a query passes `includePlatformTenant: true`. Hooks were used rather than a default scope, because a
  query's own `id` would override a scope.
- **Where platform operations are recorded:** tenant create and delete, and the six global role and
  grant operations, are audited **under PLATFORM**, not in "Default Hospital Tenant" (F-7).
- **Reading the platform trail:** `GET /audit?scope=platform` is for a super admin only.

**Verified on PostgreSQL 18.6.** The backfill split 10 sample rows as expected. Every CHECK probe was
refused or accepted as intended. `Tenant.count()` returned 1 against a raw count of 2. A bulk
suspension left PLATFORM active. Both migrations are idempotent, and `0034`'s `down` refused while an
audit row referenced PLATFORM.

**Tests:**
- *"a tenant creation is audited under the PLATFORM tenant, not the super admin's home tenant"*;
- *"a hospital admin cannot read platform audit rows"*;
- *"the PLATFORM tenant is absent from tenant listings"* (real SQL generation);
- `audit.actor.a124.test.js`;
- a test that every `system:` name in the source is registered.

**33 tests failed at `2a157f1`.**

**Still open:** A-164, and A-165.

---

### A-157, A-158, A-159 — What was changed (2026-09-24)

**A-158 — signing e-mails.** Every signing request had thrown a `TypeError`, logged at warn, because
the code called `emailQueueService.queueEmail`, **which has never existed**. It now sends through the
real `queueNotificationEmail`, the same path notifications use.

- **The link** is `${FRONTEND_URL || HOST_URL}/dashboard/esignature`, which opens on the "To sign"
  tab.
- **A failure is logged at error,** with ids only and no e-mail addresses.
- **The completion e-mail** looked up a `role` column that does not exist. It now goes to the
  workflow's signers.
- **`addEmailJob`** had returned `true` even when its direct-send fallback failed.

The test requires `emailQueue.service` and `email.service` **unmocked**, and doubles only
`amqplib` and `nodemailer`. It also asserts the real export surface.

**A-157.** `deleteCertificate` reads the certificate `FOR UPDATE` inside its transaction.

**A-159.** The dead duplicate check is removed.
- The first signature moves a multi-signer workflow to `in_progress`.
- A signature after `expiresAt` marks the workflow `expired`, with an audit row, and answers 409.

**Tests.** 20 tests failed against `05985ef`, among them all 9 of the A-158 e-mail tests; they had
recorded no SMTP send and no queue publish.

---

### A-102, A-156 — What was changed (2026-09-24)

**A-156 — the restore's `notRestored` list.** The backend already returned it (`restoreBackup`,
`tenantBackup.service.js`): `data` holds `tenantId`, `recordsProcessed`, `updated`, `unchanged`,
`skippedDeleted`, `retained`, `notRestored: [{ entry, username, reason }]` and `restoredAt`. There is
**no `meta`**. The frontend service kept only `success` and `message`, so the page said "Backup
restored successfully" and nothing else.

- `tenantBackupService.restore` now returns `outcome` as well (`RestoreOutcome`, `NotRestoredEntry`).
- The hook keeps the last outcome. The new `RestoreOutcomePanel` shows the counts and each skipped
  account with its reason:
  - `absent`: re-invite through Users if the person still needs access.
  - `erased` (GDPR): do not re-invite.
- No backend change.

Tests:
- `frontend/src/app/dashboard/tenants/[tenantId]/backup/__tests__/page.a156.test.tsx`. It runs the
  real page, hook and service; only the HTTP client is mocked, and it answers with the backend's
  exact envelopes.
  - *"lists each account that was not restored, with its reason and what to do"*
  - *"says every account was matched when notRestored is empty"*
  - *"shows no restore result before a restore, and none after a failed one"*
- `tenantBackup.service.test.ts` › *"A-156: returns the restore outcome including notRestored from
  the real envelope"*. The existing restore test now expects `outcome: null`.

At baseline `05985ef` (worktree), **4 of 13 failed**: the first two page tests and both service
tests. The third page test passes at baseline, since nothing was shown then either.

**A-102 — the scheme behind Cloudflare.** `deploy/compose/nginx/vm-http.conf` now forwards
`X-Forwarded-Proto: $client_proto`, in the server block and in `/socket.io/`.

- **The trust rule is ADR-050's.** A map on `$realip_remote_addr` (the peer, before realip rewrites
  it) takes the scheme from Cloudflare's `CF-Visitor` **only** when the peer is `172.30.19.1`, the
  tunnel gateway. Every other peer gets its real `$scheme`.
- **An inbound `X-Forwarded-Proto` is never trusted.**
- `CF-Visitor` is stripped downstream, like `CF-Connecting-IP`.
- **`172.30.19.1` now appears twice** in the config and must change together with
  `set_real_ip_from` and `docker-compose.vm.yml`.

What reads the scheme:
- **Backend** (`trust proxy` = 1): `req.protocol` builds the QR verify URL
  (`certificatePdf.controller`, when `CERT_VERIFY_BASE_URL` is unset) and signed attachment URLs
  (`attachment.controller`). The `FORCE_HTTPS` redirect in `index.js` reads it too, and is `false`
  on the VM.
- **Next 16** keeps an inbound `x-forwarded-proto` (`base-server.js`: `??=`), and the `/api/`
  catch-all copies it to the backend. So the value crosses the Next hop, and `request.url` in
  `proxy.ts` redirects becomes `https` as well.
- **No cookie depends on it.** Every `secure` flag, in the backend (`sso.controller`) and in Next
  (login, sso-session, the catch-all, `proxy.ts`), is `NODE_ENV === "production"`.

**Evidence: real `nginx:1.27-alpine` (1.27.5), `nginx -t` OK.** The HEAD and the new config each ran
against an nginx echo upstream aliased `backend`/`frontend`, on a network pinned to
`172.30.19.0/24`. Requests from the host through the published port arrive from the gateway, which
is the tunnel path; `xff=203.0.113.7` proves realip trusted them.

| request | before | after |
|---|---|---|
| tunnel, `CF-Visitor: https`, on `/api/`, `/socket.io/`, `/uploads/`, `/` | `xfp=http`, CF-Visitor leaked | `xfp=https`, CF-Visitor stripped |
| tunnel, no `CF-Visitor` | `http` | `http` |
| tunnel, `CF-Visitor: http` | `http` | `http` |
| direct peer `172.30.19.5`, spoofing `CF-Visitor: https` + `X-Forwarded-Proto: https` + `CF-Connecting-IP` | `xfp=http`, `xff=172.30.19.5` | `xfp=http`, `xff=172.30.19.5` |

The containers and the network were removed afterwards. **The VM was not touched.**

**Open: must be verified on the VM after deploy.**
- nginx must be restarted to pick the file up.
- Through `https://kalibrasi.zedth.my.id`, a backend request should see `req.protocol === "https"`.
  For example, a certificate PDF's QR URL should start with `https://` when `CERT_VERIFY_BASE_URL`
  is unset.
- `http://10.1.200.13:19080` directly should still see `http`.
- Confirm cloudflared really delivers `CF-Visitor`. If it does not, the result is still `http`,
  which is safe.

**Also open (not fixed):** the Next catch-all drops `Host`. The backend's `req.get("host")` is
therefore the internal backend host, so `baseUrlOf(req)` builds `https://backend:3000/...` unless
`CERT_VERIFY_BASE_URL` / `PUBLIC_BASE_URL` are set. **A-102 fixes only the scheme.**

### A-134, A-137 — What was changed (2026-09-24)

**A-134 — fix or remove `cascadeRoles`? Removed.**

- *For fixing it:* a child business unit should start with its parent's roles and menu grants, so
  a new branch works on day one.
- *For removing it:* **that is already true.** Roles are global. `role.model.js` has no `tenantId`,
  `name` is unique across the platform, and `role_menu_permissions` hangs off `roleId` alone. Every
  role and every grant already applies in every tenant. "Cascading" would have meant creating a
  second `Role` with the same `name` (a unique violation) carrying a `tenantId` column that does not
  exist. No route, screen or deployment sets `HIERARCHY_CASCADE_ROLES`. A "working" cascade would
  first need tenant-scoped roles, which is an architecture change (an ADR) and not a bug fix.
- *Decision:* removed. `cascadeRoles` and `HIERARCHY_CASCADE_ROLES` are gone, and `getStatus` no
  longer reports `cascadeRoles`. No mutation remains, so there is nothing to audit.
  `getUserRolesAcrossTenants` returning at most one row is **by design**: a user belongs to one
  tenant (`users.tenant_id`). The name promises more than the model has, and A-110 already made it
  honest (real aliases, LEFT joins, a 500 on failure).

**Found while testing, not fixed (outside the card):** `createSubOrganization` cannot create a
tenant on the real models. `Tenant.subdomain` and `Tenant.email` are NOT NULL, the function sets
neither, and the catch turns the validation error into a 500 "Failed to create sub-organization".
It also writes no audit row and uses no transaction; its max-depth rollback is a manual
`destroy()`. The only caller of the removed cascade was therefore unreachable too. This needs its
own card.

**A-137.** Migration **`0047-drop-data-retention-policies`** runs in one transaction. It takes
`LOCK TABLE … IN ACCESS EXCLUSIVE MODE`, counts rows per tenant, and **refuses** if any exist. The
refusal names the count and the tenants (a null tenant is shown as a global row) and says what to
do: carry the intent into `PUT …/:tenantId/policy` or record that it is discarded, export, delete,
re-run. Only then does it run `DROP TABLE` without CASCADE. A missing table is a no-op. There is no
try/catch. `down` recreates the empty table exactly as `db.sync()` built it, including the PK, both
indexes and the `ON UPDATE CASCADE ON DELETE RESTRICT` tenant FK, with `tenant_id` nullable.

`dataRetentionPolicy.model.js` is deleted, along with its two barrel keys and its association (in
the model). The A-121 model-validation test went with the model.

Migration 0030 **still names** `data_retention_policies` in `TENANT_NULLABLE`, deliberately: on an
upgraded database 0030 runs before 0047 while the table exists. On a fresh one the name matches no
constraint and does nothing. `tenantForeignKeys.a88.test.js` exempts that one name from its "every
listed table has a model" check, reading the name from 0047.

**Tests.**

- `tenantHierarchy.cascade.a134.test.js` (4 tests) runs the real models barrel on an unconnected
  PostgreSQL Sequelize. Role has no `tenantId` and no `level`, and its `name` is unique. The former
  `User.findAll({ include: [Role] })` throws on the alias before any SQL. With
  `HIERARCHY_CASCADE_ROLES=true`, `createSubOrganization` calls no User/Role/RoleMenuPermission
  method and sends no SQL to those tables. `getStatus` has no `cascadeRoles`.
- `tenantHierarchy.service.coverage.test.js`: 4 mocked tests that asserted the broken call shape
  (`include: [Role]`, `level`, `tenantId` on Role) were replaced by one.
  `tenantHierarchy.service.test.js` and `tenantHierarchy.controller.test.js` were adjusted for
  `getStatus`.
- `0047-drop-data-retention-policies.test.js` (12 tests) checks: registered; no try/catch; lock,
  count and drop in one transaction; refusal naming count and tenants, with nothing dropped; the
  >20-tenant summary; absent-table no-op; idempotent; failure propagates; `down` DDL; `down` no-op;
  up/down/up. It also checks that no model file mentions the table.
- `tenantHierarchy.service.js` and `0047` are at 100% on all four measures.

**Fail-before** (`git worktree add` at `05985ef`, new tests copied in): **5 tests failed and 1 suite
could not load** (0047 absent).

- a134: `createSubOrganization …` failed. `User.findAll` was called with
  `{"include":[Role],"where":{"tenantId":…}}`.
- a134: `getStatus no longer reports a cascade flag` failed. It received `cascadeRoles: true`.
- The coverage test's A-134 case and both `getStatus` cases failed.

**PostgreSQL 18.6 evidence** (`pgvector/pgvector:pg18`, throwaway container, removed):

1. **Upgrade path.** `05985ef` booted from 0001 (`db.sync()` plus migrations 0001–0034) built
   `data_retention_policies` with `tenant_id uuid` nullable and the FK
   `ON UPDATE CASCADE ON DELETE RESTRICT`. One row was inserted.
2. **Refusal.** This tree's `migrator.up()` applied 0035–0044, then stopped at 0047:
   `Migration 0047 refused: data_retention_policies has 1 row(s) … tenant 00000000-…-000000000001:
   1 row(s)`. Afterwards the table still had 1 row and 0047 was not recorded.
3. **Empty table.** After `DELETE`, the re-run executed `LOCK TABLE …`, then the `SELECT … COUNT`,
   then `DROP TABLE data_retention_policies`, and 0047 was recorded.
   `to_regclass('public.data_retention_policies')` is NULL.
4. **Re-run.** `migrator.up()` found nothing pending. Calling `0047.up()` directly on the absent
   table was a no-op.
5. **Down.** `migrator.down({ migrations: ["0047-…"] })` recreated the table. Its `\d` matches
   step 1 column for column: defaults 365/true, PK, `…_is_active` and `…_tenant_id` indexes, and the
   FK. The 0047 record was removed. `up` dropped it again.
6. **Fresh build from 0001 with this tree.** `db.sync()` plus all 45 migrations: 0030 migrated,
   then 0047 migrated as a no-op, and the table is absent.

**Open (not mine):** on the step-1 database, this tree's `db.sync()` fails with
`column "requested_by" does not exist` before any migration runs. A model index needs a column
that only migration 0039 adds, so an upgrade from `05985ef` through the real boot order
(sync, then migrate) currently fails. Step 2 therefore ran `migrator.up()` alone. The fresh build
(step 6) is unaffected. The docs still describe `data_retention_policies`
(`docs/DATABASE/02-TENANCY-TABLES.md`, `00-DATA-MODEL.md`, `SECURITY/09-PRIVACY-DATA-PROTECTION.md`,
`PLAN/01`, `06`, `15`, `TESTING/07`) and the role cascade and `HIERARCHY_CASCADE_ROLES`
(`docs/BACKEND/10-MODULE-REFERENCE.md:763,806`). Amending them is a deviation-protocol change
(ADR, then the docs), and was out of this change's boundary.

---

### A-126 (rest), A-128, A-146 — What was changed (2026-09-24, ADR-051 Q-15, Q-18)

**A-126 — `ACCOUNT_LOCKED` and `SIGNATURE_AUTH_FAILED`.** Both are new `audit_logs.action` values,
in the model, `AUDIT_ACTIONS` and `docs/DATABASE/10-AUDIT-LOGS.md` § The Eight Actions.

- **Migration `0049-audit-actions-lockout-signature`** appends the two labels. It refuses a type that
  is absent or does not start with the six known labels. `down` refuses while any row carries a new
  label, because audit rows are never rewritten (Q-12). Otherwise it rebuilds the type.
  **`db.sync()` does not add ENUM labels to an existing type** (checked on PostgreSQL 18), so on an
  existing database this migration is required.
- **Lockout.** A lock engages in two places: the fifth wrong password in `loginUser`, and the per-user
  budget of an endpoint that persists the sign-in lock (the MFA step) in `recordAuthFailure`. Both go
  through `audit.service#recordAccountLock`, which writes the lock and the row in one transaction.
  - **The actor is `system:auth-lockout`**, a new registered system actor. The locked account is the
    resource, never the actor.
  - **The row goes in the account's own tenant**, or PLATFORM if it has none.
  - **The limiter audits only the attempt that reaches the budget.** A racing attempt past it still
    writes the lock, but no row.
  - The row records the request's IP address and user agent. `ip` is only a counting key, and is
    null unless `AUTH_RATE_LIMIT_BY_IP` is set.
- **Signing.** `certificate.service#verifySignerCredentials` handles every signature: certificate
  approve, sign and revoke, and workflow signing. A wrong password or MFA code now writes one row.
  - The actor is the signed-in caller. The resource is the certificate or the workflow step, and
    `changes.method` and `changes.operation` are recorded. The credential is never recorded.
  - A missing credential, or MFA requested for an account without it, writes no row: these are not
    attempts on a credential.

**Decision (A-126): the lock does not depend on the audit row, but an unrecorded signing attempt gets
no answer.**

| Case | If the audit row cannot be written | Why |
|---|---|---|
| Lockout | The error is logged, and **the lock is still persisted** without its row | Rolling the lock back would turn off brute-force protection while audit writes fail |
| Signing | **The audit error propagates** (500), not the 401 | While attempts cannot be recorded, a guesser learns nothing from them |

*Alternatives considered:*
- Write the signing row inside the transition's transaction. Rejected: the 401 rolls it back.
- Write both rows best-effort, with no transaction. Rejected: an unaudited signing attempt would
  still be answered.
- Make the account holder the actor of a lockout row. Rejected: the attempts may not be theirs.

**Decision (A-126): lockout rows are not an enumeration oracle.**
- A row is written only for an account that exists: `loginUser` found the row, or the limiter's user
  id came from a verified token, never from a typed name.
- An unknown account is never locked and gets no row.
- The row goes in that account's tenant, where the person guessing cannot read it.
- The HTTP answer does not change.

**Found, not fixed:** the answers themselves are already an oracle. The fifth wrong password for a
**real** username answers 423, while an unknown username always answers 401. That lets anyone confirm
an account exists and lock it out, which is a denial of service. It predates this card; see *Still
open* below.

**A-128 — the residual oracle, rate-limited and audited (Q-18).** This applies to `userCreate`, and to
`editUser` when it changes a username or an email address. Without the edit path, a limit on create
alone would be pointless.
- **The check is now global** (`skipTenantScope`). It includes soft-deleted accounts (`paranoid:
  false`, with the defaultScope's `is_deleted` key overridden). It is an exact, case-insensitive match
  (`ILIKE` with `\`, `%` and `_` escaped).
  - It had been tenant-scoped. Another tenant's holder passed it, and the insert failed on the global
    unique index with a **500**: the same oracle, unlimited and unaudited.
  - It had been a `LIKE` on raw input. As a global probe, `%@hospital-b…` would have answered whether
    any such address exists.
- **A unique violation that races past the check** also becomes the same 409.
- **Each conflict answered to a non-super-admin**:
  - is counted against a budget of **10 per administrator per hour** (`userIdentityConflict`, with
    `persistUserLockout: false`, so it never touches sign-in);
  - writes one audit row in the administrator's tenant, in its own transaction. The row is `CREATE`
    or `UPDATE` with `changes: {operation: "IDENTITY_CONFLICT", outcome: "refused", field}` and a null
    `resourceId` on create.
- **Once the budget is spent**, every create, and every edit that changes an identity, answers **429
  before any lookup**.
- **A super admin** is neither counted nor audited, because they can read every tenant anyway.
- **Also fixed:** the actor ids come from `input`. Joi strips `createdBy` and `updatedBy`, so the
  validated values were always undefined.

**Decision (A-128).**
- **The row and the 409 say only the field.** They never include the value, which tenant holds it,
  or whether it was this tenant. This tenant's administrators can read the row, and a "held by
  another tenant" marker would move the oracle into the audit trail.
- **The action is the nearest ENUM member** (`CREATE` or `UPDATE`) with `changes.operation`, as
  `constants/auditActions.js` prescribes. Q-15 fixed the new ENUM set, so a new member would need an
  ADR.

*Alternatives considered:*
- A budget per tenant. Rejected: one administrator's typos would lock their colleagues.
- Also counting successful creates. Rejected: it would limit ordinary work, not probing.
- A generic 500 for every conflict, as SCIM does since A-37. Rejected: Q-18 chose an honest 409.

**A-146 — impersonation survives a refresh.** Migration **`0040-session-impersonator`** adds
`sessions.impersonator_id`: uuid, nullable, a foreign key to users `ON DELETE CASCADE`, and an index.
Its `down` first revokes every open impersonation session (`MIGRATION_0040_DOWN`), so a rollback
cannot reopen the defect.
- `impersonateUser` stores the operator on the session row. `refreshUserToken` reads it back:
  - it re-issues the `impersonatorId` claim;
  - it records it on the new session, so the next refresh keeps it too;
  - it **does not extend the hour**. The new session keeps the old `expired_at`, where a refresh used
    to grant seven days.
- A refresh is refused with 401, and the session revoked (`IMPERSONATOR_REVOKED`), unless the operator
  is still an active `SUPER_ADMIN` or `SUPERADMIN`.
- The impersonation **response** still carries no refresh token (`login(res, …)` drops it). Handing
  one out is a product decision, not taken here.

**Tests** — every one ran against baseline `05985ef` in a separate worktree:

| Suite | Tests | Failed at `05985ef` |
|---|---|---|
| `auth.accountLocked.a126.test.js` | 11 | 7 |
| `esignature.signatureAuthFailed.a126.test.js` | 8 | 6 |
| `user.identityConflict.a128.test.js` | 14 | 10 |
| `auth.impersonationRefresh.a146.test.js` | 12 | 11 |
| `0049-audit-actions-lockout-signature.test.js` | 12 | cannot load |
| `0040-session-impersonator.test.js` | 13 | cannot load |

The tests that passed at baseline are guards: a wrong password below the threshold, an unknown
account, a correct credential, an ordinary refresh.

Tests that failed at baseline include:
- *"the fifth wrong password writes one ACCOUNT_LOCKED row, committed with the lock"*;
- *"a wrong password on certificate approval writes one row that survives the refused transition"*;
- *"an email another tenant holds answers 409 (was 500) … and writes one audit row in the admin's
  tenant"*;
- *"inside tenant A's context the SELECT carries no tenant predicate, no soft-delete filter, and
  escapes `_` and `%`"*: real models, and the SQL is captured;
- *"a refreshed impersonation token still carries impersonatorId"*;
- *"signing with the refreshed token is still refused (A-127, ADR-052)"*;
- *"an audit row written with the refreshed token names the impersonating super admin"*.

The last two run the real auth middleware and `denyPlatformAuthoring` with really signed tokens.

**Existing tests adjusted to the new contract:**
- `certificates.approve.a62` and `esignature.signer.a65`: a wrong credential now writes exactly one
  `SIGNATURE_AUTH_FAILED` row;
- `auth.mfaRateLimit.a81`: engaging the lock loads the account once more;
- `auth.sessionRevocation.a48` and `auth.tokenPurpose.a59`: the column lists gain `impersonator_id`;
- `auditLedger.fixture`, `systemActors.a124` and `auth.service.coverage`.

The full backend suite was 10,479 tests, with 1 failure (a62, since adjusted). `audit.service`,
`certificate.service`, `user.service`, `auth.service`, `session.service`, `rateLimiter.redis.service`
and `eSignature.service` are at 100/100/100/100.

**PostgreSQL 18.6** (`pgvector/pgvector:pg18`, throwaway, removed):
- **`0049`:**
  - before `up`, an `ACCOUNT_LOCKED` insert is refused (`invalid input value for enum`); after it,
    both labels are appended in order;
  - a second `up` is a no-op;
  - `down` refuses while 2 rows carry the labels, and leaves the type untouched;
  - with those rows gone (throwaway database only), `down` restores the six labels, keeps the `LOGIN`
    row, and the `audit_logs_action` index survives the rebuild;
  - a second `down` is a no-op;
  - a type with an extra `RESTORE` label is refused;
  - `AuditLog.sync()` on the existing table **left the six labels**, which is why the migration is
    needed.
- **`0040`:**
  - `impersonator_id uuid NULL`, `sessions_impersonator_id_fkey … REFERENCES users(id) ON UPDATE
    CASCADE ON DELETE CASCADE`, and the index;
  - a second `up` is a no-op;
  - `down` revoked the impersonation session and left the ordinary one live; a second `down` is a
    no-op;
  - hard-deleting the operator deleted their session.
- **`ILIKE` escaping:** `'axb@…' ILIKE 'a\_b@…'` is false, `'A_B@…'` is true, and `'abc' ILIKE 'a\%c'`
  is false.

**Migration numbering:** `0039` was first used here, and collided with `0039-signature-workflow-
requested-by` (A-170). It was renamed to `0049` and registered last.

**Still open:**
- **Login answers 423 only for a real account.** That confirms the account exists and lets anyone
  lock it. It needs its own card. **Fix:** throttle unknown accounts the same way, or answer 401
  until the correct password is given.
- **SCIM create (A-37)** still answers its generic 500 with no limit and no audit row. An API key
  holds tenant-admin power, so Q-18 arguably covers it too.
- **Guessing a password at signing has no limit.** Each attempt is now audited, but a session holder
  can still guess without a lockout. The `mfaManage`-style budget is the obvious model.
- `auth.controller.js` still says the ENUM has no failure action. Individual failed logins are still
  not audit rows, so the comment is only partly stale. The file belongs to another agent.
