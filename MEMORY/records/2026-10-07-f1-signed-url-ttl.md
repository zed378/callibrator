# A-365 — signed attachment links bounded and bound (F-1), socket scope drift (F-2), bulk-update tenant values (F-4); threat-model open questions as working decisions

**Date:** 2026-10-07 · **Agent:** application-security agent of the coordinating session (under the owner's delegation) · **Found by:** P17-06, `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` § 9 · **ADR:** [ADR-128](../DECISIONS.md) (client-visible behaviour changed) · **Item:** A-365 (`TASKS/AUDIT-2026-09-REMEDIATION.md`)

## Task A — the code

### F-1: signed attachment links (fixed for today's tenants)

**Defect.** `POST /api/v1/attachments/:id/signed-url` had no schema; `attachment.service#generateSignedUrl` took `expiresInSec` from the body with no upper bound; the token was `<exp>.<hmac(id.exp)>`; `getSignedDownload` loaded the row with `findByPk` alone (public route, no context). A member could mint a link valid for years, which outlived the member's account, the tenant's suspension, and followed the row into another tenant.

**Fix (ADR-128).**

- `backend/src/config/signedUrl.ts` (new): `SIGNED_URL_MIN_TTL_SEC` 30, `SIGNED_URL_HARD_MAX_TTL_SEC` 3600, `signedUrlMaxTtlSec()` = `ATTACHMENT_URL_MAX_TTL_SEC` (default 900) clamped into [30, 3600], `signedUrlDefaultTtlSec()` = `ATTACHMENT_URL_TTL_SEC` (default 300) clamped into [30, cap], `isAllowedSignedUrlTtl`, `boundedSignedUrlTtlSec` (the storage layer's clamp). Read at call time.
- `backend/src/validators/attachment.validator.ts` (new): `createSignedUrlSchema` — `expiresInSec` optional integer, min 30, static max 3600 (published), `superRefine` against the cap read per request. Kept out of `@callibrator/contracts` (server configuration; the frontend sends no lifetime; and that package was being edited by the P20 agent).
- `routes/api/attachments.route.ts`: `validate(createSignedUrlSchema)` on `POST /:id/signed-url`. `controllers/attachment.controller.ts`: reads `validated(req, schema)` and passes the issuer from `auditPrincipal(req)`.
- `services/attachment.service.ts`: the lifetime refused (400) outside [30, cap] for any caller; the token `<exp>.<tenantId>.<issuer>.<hmac("attachment-link/v2|id|tenant|issuer|exp")>`, issuer `u<userId>` / `k<apiKeyId>`; the old two-part shape refused; a claimed lifetime above 3600 s refused. Redemption: bad/tampered/expired → **403 before any read**; then `Attachment.findOne({ where: { id, tenantId: <token's> } })` (default scope: not deleted), the tenant (`Tenant.findByPk`, not suspended/deleted), the issuer (user `isActive` and not `INACTIVE`/`SUSPENDED`/`erased`; key active and unexpired) — any failure the **same 404**. A mint is logged (attachment, tenant, issuer tag, lifetime).
- `services/storage/index.ts` `ScopedStorage#signedUrl`: the lifetime clamped by `boundedSignedUrlTtlSec` for both drivers (FT-78). No production caller passes one today.
- `routes/api/attachments.openapi.ts`: the body is the schema; descriptions state the bounds and the 403/404 split; `backend/openapi.json` and `frontend/src/api/generated/schema.d.ts` regenerated (only the attachments operations changed).
- Frontend: `kanban/[projectId]/components/CardModal.tsx` no longer asks 3600 s for thumbnails (server default). The attachments page already sent none.
- `tests/guards/twoTenantRoutes.guard.test.ts`: `GET /:id/signed` left the `capability` allow-list — it now has a two-tenant test.
- Docs: `backend/.env.example` (two commented variables), `docs/BACKEND/10-MODULE-REFERENCE.md` § 18.

**Usage check (no flow broken).** Callers of `getSignedUrl`: the attachments page (`useAttachments.handleDownload`, no lifetime → 300 s, opened in a new tab — a shareable, session-less link stays shareable) and the kanban card (thumbnails; now the default). The issuer binding does not require the redeemer to sign in.

### F-2: socket re-check ignores a scope change (fixed for today)

`config/socket.ts#scopeDrift`: the 60 s re-check now also disconnects a socket whose principal's **tenant**, **super-admin status** or **role** differs from what the handshake built; the next handshake rebuilds context and rooms. Today's real case: a super admin demoted to a tenant role kept the `super_admins` room (every tenant's notifications) for the socket's lifetime. The client does not auto-reconnect after a server disconnect; realtime resumes on the next page load — acceptable for a scope change. AM-20 (the facility) stays P21-09's.

### F-4: bulk update values (tenant case fixed)

`utils/tenantScope.util.ts#refuseBulkTenantReassign` in `beforeBulkUpdate`: inside a **filter** scope, a value for the tenant column other than the context's tenant throws `Security Violation: …` before any statement. Skip scopes (no context, system task, super admin) and the deny scope (its WHERE reaches no row) are unchanged; the context's own tenant passes. AM-6 is its facility twin.

### Deferred (faskes-only, to their building cards)

F-3 (dashboard cache key — no facility today), F-5 (JIT/SCIM unbound users — correct today), F-6 (tenant room — correct today), F-7 (bound admin passing `rbac` — no bound users today), F-8 (`sql()` shape — design), F-9 (memoryDb limits — test design). F-10 is a doc fix (Task B).

### Tests (named)

- `backend/src/tests/routes/attachmentSigned.a365.test.ts` — 36 cases, `@two-tenant api/attachments.route.ts GET /:id/signed`; REAL router/validate/controller/service/models over `fixtures/memoryDb`: default 300 s; 900 accepted; 901, 3600, years, 29, 0, −5, 120.5, `"600"` → 400; cap configurable and read per request (120 → 300 refused, default clamped to 120); cap never above 3600; a fresh link serves; the token names tenant and issuer; **moved to tenant B → 404, identical to deleted**; A's token on B's id → 403; tenant segment tampered → 403; expiry tampered → 403; the old shape (validly signed, 10 years) → 403; expired → 403; issuer deactivated → 404; issuer suspended → 404; tenant suspended → 404. Then 13 service-path cases (written after the first coverage run showed the API-key branch untaken): a key-minted link names `k<id>` and works while the key is live (also with a future expiry); key revoked, expired or gone → 404; no principal → 401; a deleted tenant → 404; a tenant row with no status is not refused; a non-numeric expiry, empty tenant, unknown issuer kind or empty signature → 403; a claimed lifetime above 3600 s fails verification.
- `backend/src/tests/config/socket.scopeDrift.a365.test.ts` — 6 cases (demotion, promotion, tenant change, role change → disconnected; unchanged kept; empty tenant id).
- `backend/src/tests/utils/tenantScope.bulkUpdateValues.a365.test.ts` — 5 cases on the real Sequelize model class and PostgreSQL query generator (another tenant refused with no statement sent; own tenant allowed and scoped; untouched column; system task; no context).
- **Fail-before** (the first 34 cases): with the five source files reverted to `HEAD` (`attachment.service.ts`, `attachment.controller.ts`, `attachments.route.ts`, `socket.ts`, `tenantScope.util.ts`), **22 of these 34 cases failed** (the 400 cases, the old-shape refusal, every redemption 404 — the moved row answered 200 with the file — the four socket disconnects, the bulk-update refusal); the passing 12 are the positive controls and the 403s the old signature already refused.
- Legacy suites adjusted to the new behaviour, assertions changed only where the behaviour did: `services/attachment.service.coverage.test.js` (models mock gains `Tenant`/`User`/`ApiKey`; the redemption reads `findOne`; "uses the default TTL when expiresInSec is zero or negative / not a number" became "refuses … (A-365)" → 400, plus "uses the default TTL when expiresInSec is absent"), `services/attachment.service.test.js` (issuer passed), `controllers/attachment.controller.test.js` (body through the schema; 3600 → 600; issuer in the call), `config/socket.test.js` (the socket fixtures carry the role/context the handshake sets), `routes/fileServing.s01.test.js` and `routes/storedFiles.identity.p801.test.ts` (both mint links through the service: an issuer is passed and their model doubles answer `Tenant.findByPk`/`User.findByPk`; they failed in the first full run). Frontend `CardModal.test.tsx` (no lifetime sent).

### Gates (2026-10-07, Node 26, a tree also being edited by the P20-01/03 agent)

- `npx eslint` on every changed backend file: 0 errors, 0 warnings; frontend `npx eslint` on `CardModal.tsx` and its test: clean.
- `npm run typecheck` (backend, frontend): 0 errors. `npm run ratchet`: 695 `.js`, at the floor. `npm run build:dist`: OK (624 TypeScript files + contracts 54). `TSX_DISABLE_CACHE=1 npm run load:check`: OK (614 modules, 105 in boot order); `-- --src`: OK.
- `openapi:generate` → `openapi:check` current; `openapi:lint` no new error (15 warnings, baselined); frontend `api:types:check` current.
- `oasdiff breaking` (tufin/oasdiff:v1.32.1, the CI version, pulled for this and removed) `origin/main` vs the working tree: **2 errors, both intended** — `request-property-max-decreased` (to 3600) and `request-property-min-increased` (to 30) on `POST /api/v1/attachments/{id}/signed-url` `expiresInSec` (ADR-128). A pull request fails `openapi:breaking` until this is accepted; a direct push to `main` passes.
- Suites: `tests/routes/attachmentSigned*`, `tests/guards/twoTenantRoutes` (34 passed); `tests/config/socket*` (64 passed, 2 skipped); `tests/utils/tenantScope*` (1,005 passed incl. the socket set run together); `tests/services/attachment.service*` (76 passed); attachments controller/routes/denyPlatform/storage/guards (559 passed, 17 skipped); frontend CardModal + attachment service + attachments page (6 suites, 80 passed).
- Full `npm run test:coverage -- --ci`: see § Coverage below.

## Task B — documents (working decisions, docs only)

- `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md`: § 13 "Who / where" cells point to the new **§ 13.1 Working decisions (2026-10-07)** — OQ-1 … OQ-12 as delegated by the coordinator, marked "WORKING DECISION 2026-10-07, coordinating session under the owner's delegation; owner may revise". **Where ADR-124 Amendment 1 differs, Am. 1 wins and the difference is noted:** OQ-2 (the coordinator's "bound users may not create devices" → Am. 1 § 9: bound technicians create/edit devices in their facility subject to UD-4 (b); QR codes not settable by them — agreed); OQ-9 (the coordinator's "tickets: yes, scoped to their faskes" → Am. 1 § 9: tickets later). OQ-8 consistent. AM-8 and AM-11 marked answered by Am. 1 § 5 / § 4; **AM-11, FT-37 and G-09 no longer list `denyPlatformAuthoring`** as a refusal criterion (Am. 1 § 4). § 9 F-1/F-2/F-4 marked fixed for today (A-365), F-10 corrected; FT-75, FT-105, S7, AM-22 updated.
- `docs/UPSTREAM/05-DATA-MIGRATION.md` § 3.1 step 1: `tenants ← mst_faskes (+ the provider tenant)` → `client_facilities ← mst_faskes (in the provider tenant; ADR-124 …)` — minimal edit (F-10/FT-105; the decision is ADR-124's, so no new ADR).
- `TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md` § 3: UD-4 state → working decision; a "WORKING DECISIONS 2026-10-07" block: UD-4 (a) first `client` account per facility → bound `HEALTHCARE ADMIN` (read-only, Am. 1), the rest bound `ROOM USER`; (b) **YES** — `TECHNICIAN` and `HEALTHCARE TECHNICIAN` get `calibration` write in every tenant, **flagged: changes existing tenants' technician permissions, needs the owner's confirmation before the seed migration ships**; (c) **NO** facility-admin user management in this phase; and the OQ-1 … OQ-12 list. Index row and total: Phase 18 1 DONE · 3 TODO; group 17 DONE · 1 WIP · 7 TODO · 71 BLOCKED.
- `TASKS/PHASE-18-UPSTREAM-ROLES-PERMISSIONS.md`: P18-01 and P18-02 **TODO** (UD-4 was their only blocker; P18-02 follows P18-01 and its (b) seed migration waits on the owner). `TASKS/PROGRESS.md` Phase 18 row and total updated. `TASKS/BACKLOG.md` Q-57·UD-4: the working decision appended; open only for the owner's confirmation of (b).

## Coverage

`npm run test:coverage -- --ci`, Node 26.10.0, 2026-10-07 — the tree also held the P20-01/03 agent's uncommitted migrations, models and tests, so this is **not** a quiet-tree figure:

- **First run:** 2 suites failed (`routes/fileServing.s01.test.js`, `routes/storedFiles.identity.p801.test.ts` — they minted links without an issuer, 401) and `attachment.service.ts` was below 100% (the API-key issuer branch, a deleted tenant, malformed 4-part tokens). Both suites fixed and 13 service-path cases added; `user.status ?? ""` simplified (the set is typed to hold null).
- **Second run:** **898 suites passed, 38 skipped, 0 failed; 15,333 tests passed, 261 skipped; 100 % statements / branches / functions / lines**, in 523 s, exit 0. Afterwards `npm run ratchet` (695, at the floor) and `openapi:check` (current) re-run clean.

**Not run:** `services/attachmentService.p918.live.test.ts` (PostgreSQL 18 scratch database; adjusted: the link names its issuer, and the seeded user row sets `is_active = true` explicitly, since redemption now reads it) and the live E2E suite (no running stack) — `make test-e2e` has signed-link specs (`e2e/modules/attachments.e2e.test.js`) that should be run before release; the frontend full jest and `next build` (only the changed suites ran).

## Owner-visible notes

- ADR-128 changes what an integrator sees (400 above 900 s; links die with their issuer; old links refused at deploy).
- UD-4 (b) is a **working decision that must not ship as a seed migration until the owner confirms it**.
- CLAUDE.md's "150 covered / 51 allow-listed" two-tenant figure is a dated snapshot; `GET /attachments/:id/signed` moved from the allow-list to covered here.
