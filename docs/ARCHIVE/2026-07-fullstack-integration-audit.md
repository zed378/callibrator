# Full-Stack Integration Audit Report

**Platform:** Callibrator (hospital-device calibration) — Node/Express + Sequelize/Postgres backend, Next.js frontend.
**Method:** Live backend API audit against a running server (`http://localhost:5000`, freshly migrated + seeded) reusing one shared super-admin token, driven by a 16-agent workflow that read each real route/validator/controller and exercised list/get/create/update/delete + key domain actions; plus frontend mock service tests. Broken contracts were then fixed in the main loop and **re-verified live**.
**Scope:** 51 route modules audited · 24 defect entries found · **15 backend defects fixed & verified** · 51/51 FE services covered by mock tests · demo seeder (80 rows) · browser suite validated.

---

## 1. Backend defects fixed (all re-verified live)

| # | Module | Symptom | Root cause | Fix | Verified |
|---|--------|---------|-----------|-----|----------|
| 1 | **AUTH (platform-wide)** | Every token rejected 15 min after login (401), forcing re-login | `jwt.util.verifyAccessToken` verified with `{maxAge:"15m"}` while tokens are signed `expiresIn=1d` | Removed `maxAge` from all 3 verify paths — the token's own `exp` governs | ✅ token TTL now 24h; `/roles` 200 |
| 2 | **workflows** | `POST/PUT /workflows`, submit-action → 500 | `workflow.service` destructured `db` from the models barrel (which exports `sequelize`, not `db`) → `db.sequelize` undefined | Destructure `sequelize`; `sequelize.transaction()` ×3 | ✅ create 201 |
| 3 | **risk** | Risks with no assignee invisible (404 on get/update/delete, absent from list) | `getRisks`/`getRiskById` INNER-JOINed optional `identifier`/`assignee` (missing `required:false` + User default scope) | `required:false` on both includes, both fns | ✅ create→get 200 |
| 4 | **qms** | `GET /qms/nc`,`/capa` → FE renders empty list | `data` returned as object `{total,…,nonConformances:[]}` instead of rows + top-level `meta` | Split `data`=rows, `meta`=pagination | ✅ data is array + meta |
| 5 | **qms** | `PATCH /qms/nc/:id` bad enum → 500 | No body validator; bad enum hit DB | Added `qms.validator` + `validate()` on nc/capa patch (→400) | ✅ 400 on bad enum |
| 6 | **sop** | `GET /sop` → FE renders empty list | Same envelope deviation (`data.documents`) | Split `data`=rows + `meta` | ✅ data is array + meta |
| 7 | **certificates** | `POST /:id/approve` → 500 on a draft; approve unreachable | Model threw plain `Error`; no submit-for-approval transition | Added `submitForApproval` model method + `POST /:id/submit` route/controller/service; approve maps invalid state → 409 | ✅ submit/approve reachable |
| 8 | **feature-flags** | `POST /:tenantId/:flagKey` `{enabled}` → 400 | Validator required `tenantId`/`flagKey` in body; they're path params | Merge `{...req.params, ...req.body}` | ✅ 200 |
| 9 | **tenant-lifecycle** | `POST /tenants/:id/suspend` `{reason}` → 400 | Validated `req.body` for `tenantId` (a path param) | Merge `{...req.params, ...req.body}` | ✅ 200 |
| 10 | **tenant-lifecycle** | suspend/resume/offboard → 500 `invalid enum value "SUSPENDED"` | Service used uppercase status vs lowercase enum `active/suspended/deleted`; `offboarded` absent | Mapped `tenant.status` to enum values (granular state kept in `lifecycle_status` setting) | ✅ suspend/resume/offboard 200 |
| 11 | **data-retention** | `POST /:id/legal-hold` → always 500 | Controller spread a Joi schema into a plain object → `schema.validate is not a function` | Added `legalHoldSchema`; merge params+body | ✅ 200 |
| 12 | **data-retention** | `PUT /:id/policy`, mask-pii, anonymize → 400 | Body validators required `tenantId` (a path param) | Merge `{...req.params, ...req.body}` on all three | ✅ 200 |
| 13 | **data-retention** | `POST /:id/purge` → 500 `column "tenantId" does not exist` (also breaks nightly retention cron) | `Session.destroy({where:{tenantId}})` but the Session model's attribute is `tenant_id` | Use `tenant_id` in the sessions purge case | ✅ 200 |
| 14 | **tenants** | `POST /tenants/create` → 500 notNull violation | Model requires `subdomain` (never collected) + `email` (optional in form); service set neither | Derive `subdomain` from `code`; fall back `email` | ✅ 201 (browser too) |
| 15 | **certificates** | `GET /certificates` returned 0 despite rows existing (found via demo data) | 4 list includes (`device`/`calibratedByUser`/`approvedByUser`/`signedByUser`) defaulted to INNER JOINs; any cert with a null optional FK (every draft) was dropped | `required:false` on all four (LEFT JOINs) | ✅ list returns all 3 |

## 2. Non-defect notes (kept as-is; behaviour documented, not bugs)

- **Mount aliases / surprises (by design):** `menu-group-roles` serves the same router as `menu-groups`; `tenant-lifecycle` and `data-retention` are mounted under `/api/v1/tenants/...` (not `/tenant-lifecycle` / `/data-retention`).
- **users:** `DELETE /users/delete` reads `userId` from the query string; `role-update` correctly 400s "User already has this role" when reassigning the same role.
- **ai `/query`, gdpr `/export`:** 500 in this environment because the AI/embeddings provider isn't configured — environment, not a code defect. gdpr swagger bodies also diverge from the enforced Joi validators (doc drift). *(Left for a follow-up doc/validator alignment.)*
- **auth error text:** an aged/expired token maps to "Invalid token" rather than a distinct "token expired". Cosmetic; not changed to avoid churn in the 100%-coverage unit tests.

## 3. Test-harness fixes made during verification

- Updated agent-written e2e specs that **documented the old bug** to assert the corrected contract (qms/sop envelope, feature-flags/tenant-lifecycle/data-retention now succeed; qms bad-enum now 400).
- **Safety fix:** `tenant-lifecycle`, `data-retention`, `feature-flags` e2e `beforeAll` now create a **disposable** tenant instead of grabbing the default (`/tenants/all` `data[0]`). Suspending the default tenant — the super-admin's own — 403s every later request ("Tenant account is suspended"). This was hit live and recovered via a direct DB reactivation.

## 4. Frontend mock service tests (Phase 2 — complete)

- **51/51** `src/api/services/*.service.ts` now have a matching `*.service.test.ts` (32 written this pass), each asserting exact `/api/v1/...` path, method, payload, and envelope unwrap (incl. `[]`/`null` fallbacks + top-level `meta`).
- Validated under the **repo's own jest config** (sampled: 96 tests across 6 services green). The earlier "broken toolchain" claim was a false alarm (a harmless `ts-jest`-vs-jest30 warning).
- Behaviour observations captured by the tests: `menuGroupRole.getAdminMenuGroups` hits a doubled path `/menu-groups/menu-groups/admin`; `warehouse` location CRUD is flat (`/warehouses/locations`); `stock` update/transfer/opname use PATCH.

## 5. Artifacts

- **Backend e2e:** 51 live-server specs at `backend/src/tests/e2e/modules/<module>.e2e.test.js` (harness `setup.js` + shared login). Run: `npm run test:e2e` (no coverage gate).
- **Frontend mock:** 51 specs at `frontend/src/api/services/<name>.service.test.ts`.

## 6. Phase 0 — demo seeder (complete)

- Flag-gated `seedDemoData()`/`unseedDemoData()` in `migration.service.js`, a `seedDemo` controller, `GET /api/v1/migration/seed-demo` (gated by `SEED_DEMO=true`), and standalone `src/scripts/seedDemo.js`.
- Verified: first run **80 rows** across all business modules (0 errors), second run fully **idempotent**, teardown removes 78 rows cleanly. Seeds via models directly (no HTTP). Only skip: predictive-maintenance (no dedicated model; covered by seeded IoT readings incl. an anomaly).

## 7. Phase 3 — browser integration (validated)

- App login works; the `automate/` Playwright suite passes **71 tests** across auth, navigation, tenants, roles, users, kanban, notifications, account, profile, module-health, dark/light mode.
- **Tenant create now works end-to-end in the browser** — the `test.fail("a tenant can be created")` marker flipped to a real passing test (its own comment predicted this on the fix).
- Defect #15 (certificate list) was discovered here (demo data made it visible) and fixed.
- Pre-existing expected-failures left as-is (out of scope): user-edit modal fuller-payload persistence marker (backend verified to persist; UI marker retained), a role display-name marker.
- Transient flakes seen during a long run were **self-inflicted** (editing a backend file → nodemon restart → ECONNRESET mid-test); clean re-runs pass.

## 8. Regression status (Phase 4)

- **Frontend mock suite:** validated green under the repo jest config (sampled).
- **Backend unit suite (100% gate):** the new code — `seedDemoData()` + its helpers (dev/demo tooling in `migration.service.js`), certificate submit-for-approval (service/controller), `qms.validator`, dataRetention `legalHoldSchema`, tenant subdomain-derivation branch, and the param-merge branches — needs unit-test coverage (or the demo seeder isolated to an ignored path) to restore the 100% threshold. This is the main open Phase-4 item; the exact uncovered-line list is being captured from a full `npm test` run.
- **Full `npm run test:e2e`** (all 51 live specs) + **full Playwright** should each get one clean pass with no concurrent source edits.

## 9. Remaining / next

- **Final consolidated e2e green run** is pending a rate-limit window reset (global limiter is 500 req/15 min; repeated verification runs exhausted it). Each fix is individually verified live; a single clean full-suite pass is a Phase-4 step.
- **Phase 0 (demo seeder):** flag-gated `seedDemoData()` so the UI/browser has data (grounded in the valid create-payloads discovered here).
- **Phase 3 (browser):** Playwright per-module UI specs + browser-MCP triage; fix UI↔API gaps.
- **Phase 4 (regression):** backend `npm test` (100% gate — re-verify unit tests after these controller/service changes) · full `npm run test:e2e` · frontend `npm test` (70%) · `npx playwright test`.
- **Follow-ups (noted, not code-broken):** gdpr swagger↔validator doc alignment; configure AI/embeddings provider for `ai`/`gdpr` in this env; optional distinct "token expired" auth message.
