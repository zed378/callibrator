# 2026-10-05 — W-10: bodyless and wrong-shape request bodies, probed

**Backlog:** W-10 (Known Warts) and M-10 in `TASKS/BACKLOG.md`. **Decision record:** none. No architecture changed: one route gained the `validate()` the as-built conventions already require, and two tests were added.

## 1. The question

W-10 said several controllers read `req.body.x` unguarded, so a bodyless POST/PATCH answered **500** instead of 400. M-10 had since added `bodyDefault`. Was W-10 still live? This record answers from the running code, not from reading.

## 2. What a route can receive

`index.ts` parses with `express.json({ limit: "10mb", verify })` (strict, the default), then `express.urlencoded({ extended: true })`, then `app.use(bodyDefault)`. `backend/src/tests/middlewares/bodyShapes.w10.test.ts` builds that same stack, with the real `bodyDefault` and the real `errorHandler`, and sends it real HTTP:

| Sent | The route sees |
|---|---|
| no body; `""` as JSON; `text/plain`; `application/xml` | `{}` |
| a JSON object / a JSON array / a form | that object / that array / an object |
| JSON `null`, `"x"`, `5`, `true`; malformed JSON | nothing: **400** from the parser, before any route |

The suite also reads `index.ts`: a single `express.json(` with no `strict:` option, before `urlencoded`, before `app.use(bodyDefault)`. **12 tests.** So the root cause W-10 described, an absent or non-object body, is already handled centrally. The only shapes left to probe are `{}` and `[]`.

## 3. The enumeration

Every module under `src/routes` was required. Its Express stack was walked (as `routePermissionGuard.p604` does), with `validate()` tagged when it reads the body (`from` is `body` or includes it).

| | Count |
|---|---|
| Routes (method × path) | **454** |
| … mounting a body `validate()` | **87** |
| Mutating (POST/PUT/PATCH/DELETE) with **no** body `validate()` | **196** |

Each of the 196 was called through its **real** chain: `fixtures/routeClient` replaces only `auth`, and `fixtures/memoryDb` supplies the real models and tenant hooks. Each was called with `{}` and with `[]`, first as a tenant admin and then as the super admin. The admin run left 35 routes at 403 or 402, because their gates are platform-only. Path parameters were filled with the principal's tenant id, the principal's user id, or a non-existent id. A Proxy on the body recorded which fields each handler read.

Super-admin run, 392 calls: **58 × 200, 2 × 201, 8 × 302** (SSO callbacks redirect to the error page), **173 × 400, 2 × 401** (IoT ingest without a device token), **125 × 404, 14 × 409, 2 × 500, 6 × 503**, plus 2 refused by the test client's secret scan.

- **2 × 500: `POST /api/v1/sop`**, with `{}` and with `[]`. The handler read `title`, `version`, `contentUrl` and `requiresTraining`, and the service passed them to `SopDocument.create`. The result was `notNull Violation: SopDocument.title cannot be null`. **This is the one live W-10 site.** `requiresTraining: null` reached the same NOT NULL constraint.
- **6 × 503**: `POST /auth/passkey/options`, `/webauthn/registration-options` and `/webauthn/login-options`. Each answered "temporarily unavailable" because the fixture has no Redis to store the challenge, not because of the body. With an in-memory Redis (the guard below), they answer 200.
- **2 refused: `POST /auth/mfa/setup`.** It answers 200 with a fresh TOTP secret, because MFA is off for the fixture principal, so no re-authentication is asked. `routeClient`'s S-20 scan refuses to return credential material to a test. This is not a 5xx.

**Not driven past the lookup:** 125 calls answered 404 for the missing id. Most were DELETEs that read no body. The 404s that read nothing before the lookup and might read the body afterwards were read by hand: `PUT /esignature/workflows/:workflowId`, which uses `req.body || {}` and copies only allowed fields; `PATCH /roles/menus/:id`, which uses `bodyOrEmpty`; `PATCH /sop/:id/publish` and `POST /sop/:id/acknowledge`, which read no body; `POST /tenant-lifecycle/:tenantId/grace-period`, which reads params only; and `POST /admin/access-requests/:id/resend-invitation`. None of them dereferences a body field. Handlers that pass the body to `validateInput`/`checkInput` (the as-built rule for controllers) answered 400.

## 4. The fix

- `packages/contracts/src/sop.ts` adds `createSopDocument`. `title` is trimmed, 1–255 characters. `version` and `contentUrl` are optional text, trimmed and nullable, max 20 and 255: the columns' lengths. An empty or null `version` still becomes "1.0" in the service, as before. `requiresTraining` is a boolean or "true"/"false", and is **not** nullable, because the column is NOT NULL. Every other key is stripped: status, number, author and tenant stay server-owned, as they already were.
- `backend/src/validators/sop.validator.ts` re-exports it, and `routes/api/sop.route.ts` mounts `validate(createSopDocument)` after the gate.
- `routes/api/sop.openapi.ts` uses the same schema as the body, so the contract is the validator. `openapi.json` was regenerated: `minLength`/`maxLength` were added, `requiresTraining` is no longer nullable, and the "not validated" note is gone. The frontend's `src/api/generated/schema.d.ts` was regenerated too, with `requiresTraining?: boolean`. The SOP page already sends a boolean.

**Tests:**
- `backend/src/tests/routes/sop.create.w10.test.ts`, **9**, on the real router and memoryDb. Seven bodies → 400 "Validation Error" with no committed write: `{}`, `[]`, a blank title, a numeric title, `requiresTraining: null`, `requiresTraining: "maybe"` and an over-long version. A valid body → 201 DRAFT with `SopDocument` and `AuditLog` written and the server-owned keys stripped. An empty or null version → "1.0". **Fail-before:** with the `validate()` removed, 8 of the 9 fail.
- `backend/src/tests/validators/sop.validator.w10.test.ts`, **12**. It also runs in the contracts package's suite: `sop.ts` is at 100 %, 48 suites, 1,097 tests.

## 5. The guard

`backend/src/tests/guards/bodylessRequests.w10.guard.test.ts`. It walks every route module, tags body-reading `validate()`, and calls every unvalidated POST/PUT/PATCH/DELETE through its real chain with `{}` and `[]`, as a tenant admin and as the super admin. Each call must answer below 500 (a timeout fails too), unless the route is in `REVIEWED` with the exact outcome it must keep. A stale entry fails. Redis is an in-memory map installed per call, because `jest.config`'s `restoreMocks` resets spies made at load. **Fail-before:** with the SOP `validate()` removed, the guard names `api/sop.route.ts POST /` four times. The check is also tested in both directions on a planted router: a crashing handler fails, a validated one is skipped, a tolerant one passes, and a moved or stale reviewed entry fails. **4 tests, about 20 s.**

**Why behavioural, not a source scan.** The card asked for a guard that fails when a mutating route "reads `req.body` with neither `validate()` nor a reviewed exemption". A source scan cannot decide "reads `req.body`". Handlers read it through helpers (`bodyOf`, `bodyOrEmpty`), hand it whole to services, or validate it inline with `validateInput`/`checkInput`, which the conventions allow. Such a scan would need about 100 exemptions that say nothing. What the guard asserts instead is the defect itself: no 5xx for a body without its fields. **Limits:** a handler that answers 404 for the missing id before it reads the body is not driven past the lookup (§ 3). Wrong types *inside* a body, such as `{ "title": 5 }`, are each route's schema's job, not this guard's.

## 6. Gates (2026-10-05, a shared tree with U-06, U-09 and the CI agent working)

- `npx eslint` on every changed backend file, and on `packages/contracts/src/sop.ts` from its workspace: clean.
- `npm run typecheck`: backend, frontend and `packages/contracts`, 0 errors.
- `npm run ratchet`: 695 `.js`, at the floor.
- `npm run build:dist`: 610 TypeScript files plus contracts 53.
- `TSX_DISABLE_CACHE=1 npm run load:check`: OK in both modes, dist and `-- --src`.
- `npm run openapi:check`: current. `openapi:lint`: no new error.
- Related suites: guards, contracts, the SOP route, controller, a28/a127/a145 and `routePermissionGuard`: 70 suites, 406 passed.
- Full coverage: § 7. It is **not** 100 % on this shared tree, and the gaps are in other agents' files.

## 7. Full coverage run

`npm run test:coverage -- --ci` was run twice on Node 26.10.0. Neither run was on a quiet tree: other agents were editing gdpr, storage, attachments and backups throughout.

- **Run 1:** 874 suites passed and 6 failed, all six of them gdpr suites. 14,915 tests passed and 29 failed. The gdpr service and its tests were being edited at that moment: `gdpr.service.test.js` alone passed 32/32 minutes later.
- **Run 2:** 878 suites passed and 2 failed (37 skipped). 14,942 tests passed and 2 failed (246 skipped), in 411 s. The two failures:
  - `unboundedFindAll.d24`: a new unbounded `findAll` (the U-06 area).
  - `auditCoverage.p611`: `storageMigration.service#migrateAll/migrateBackups/migrateEverything` are unaudited (the U-09 area).
- **Coverage below 100 %:** global 99.3 / 99.14 / 99.31 / 99.34. Every file under 100 % is one this change does not touch and other agents have open: `storageMigration.service` 47.87 %, plus `attachment`, `certificatePdf`, `storage`, `tenantBackup`, `gdpr`, `scheduledBackup`, `storedFile`, `local.driver` and `upload.util`.

Every file this change touches is at **100 / 100 / 100 / 100**: `sop.route.ts`, `sop.validator.ts`, `sop.controller.ts` and `sop.service.ts`, with `contracts/sop.ts` at 100 in the contracts suite. None of the failing suites loads the SOP files or the new tests.

**Still owed:** the 100 % gate on a quiet tree, once U-06 and U-09 land.
