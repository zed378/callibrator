# P9-25 — API contract, code-first: the foundation (2026-09-29/30)

**Card:** P9-25 (WIP — foundation done) · **ADR:** ADR-103 · **Spec:** `MEMORY/specs/P9-25-api-contract-code-first.md` · **Owner brief:** `MEMORY/specs/P9-25-owner-brief-api-contract.md`

## What changed

**Backend**
- `src/docs/openapi/envelope.ts`: the envelope, the list envelope (top-level `meta`) and the standard 400/401/403/404/409/429 responses. `src/docs/openapi/operation.ts`: `defineRouteDocs`, `toOperation`, `toPathItems`, `DEFAULT_RATE_LIMIT`. The Phase 10 lane widened `Success` with a 202 empty (kept).
- `src/routes/api/vendor.openapi.ts` (pilot, 6 operations). The 6 `@swagger` blocks in `vendor.route.js` are deleted; it's a comment-only change plus a pointer.
- `scripts/openapi/build.ts` (`buildDocument`: code-first ∪ JSDoc, 3.0→3.1 normalisation, double documentation and conflicting components refused, `failOnErrors` on JSDoc YAML) and `scripts/openapi.ts` (`openapi:generate|check|lint|breaking`).
- `backend/openapi.json` (committed, OpenAPI 3.1: 414 operations, 12 code-first on 2026-09-30). `backend/.spectral.yaml` and `backend/openapi.spectral-baseline.json` (18 legacy errors, shrink-only).
- `src/routes/internal/apiDocs.route.ts` (Scalar page, bundle, init script, spec; `auth → denyApiKey → rbac([TENANT_ADMIN])`) and `src/docs/apiDocs.ts` (mounts `/docs`, `/docs.json` and `/api/v1/docs` under `SWAGGER_ENABLED`). `index.js` calls `apiDocs(app)`.
- `utils/csp.util.ts`: `SWAGGER_CSP_DIRECTIVES`/`swaggerCsp` became `API_DOCS_CSP_DIRECTIVES`/`apiDocsCsp` (same-origin only).
- Removed: `src/docs/swagger.js`, `src/utils/generateSwagger.util.js`, `src/tests/utils/generateSwagger.test.js`, the `swagger:generate` script, and `swagger-ui-dist` from the pkg assets. The ratchet floor dropped by one (`npm run ratchet`: 949 → 948).
- `package.json`: `zod-openapi` ^6.0.2 and `@scalar/api-reference` ^1.72.2 (deps); `@stoplight/spectral-cli` ^6.16.3 and `@types/swagger-jsdoc` (dev). `build` = `openapi:check` → `build:dist` → `pkg`.
- `Dockerfile`: `RUN npm run openapi:check` (was `swagger:generate`), ships `openapi.json` and `docs-ui/scalar.standalone.js`. `.env.example`: the `SWAGGER_ENABLED` text.
- Legacy JSDoc fixes (comments only): four dangling `$ref`s in `stock.route.js`/`warehouse.route.js` (`Adjustment`/`Transfer`/`Opname`/`Location` → the `Stock*`/`StorageLocation` components that exist; oasdiff could not load the document without this), and the `PATCH /tenants/edit` description in `tenant.route.js` folded (`>-`). A `: ` inside it made swagger-jsdoc drop the whole block silently.
- Tests: new `tests/guards/openapiRoutes.p925.test.ts` (+ `openapiRoutes.undocumented.json`, 76 pinned) and `tests/routes/apiDocs.p925.test.ts`. Updated `routePermissionGuard.p604` (skips `*.openapi.ts`/`.d.ts`, knows the `apiDocs.ts` mounts), `swaggerValidatorAlignment.p608` (builds the merged document, checks the committed `openapi.json` is current, vendor `KNOWN_DRIFT` entries deleted; the Phase 10 lane then fixed its `.ts` mount lookup and path-param omission), `csp.p708` and `appRoutes.a253` (a test KMS key for the production cases; 60 s timeout). `routeGateExemptions.ts`: the `docs/swagger.js` entries became `docs/apiDocs.ts` (`/documentation`, `/standards` only).

**Frontend**
- `openapi-fetch` ^0.17.0 (dep), `openapi-typescript` ^7.13.0 and `undici` (dev). Scripts `api:types` and `api:types:check`. `src/api/generated/schema.d.ts` (generated; eslint-ignored).
- `src/api/typed.ts`: `typedApi` (openapi-fetch; the transport is `api.*`, so the refresh/redirect/error behaviour is unchanged), `keepQuery`, `apiFetch`, `unwrap`.
- `src/api/services/vendor.service.ts` is on `typedApi`, with request types from the contract and a compile-time check that the contract's `Vendor` is the UI's `Vendor`. The public interface is unchanged.
- `jest.setup.ts`: WHATWG Request/Response (undici) polyfilled only where jsdom lacks them.

**CI / make**
- `.github/workflows/ci.yml` job `api-contract`: `openapi:check`, `openapi:lint`, `api:types:check`, oasdiff 1.32.1 (sha256 `7c8939fc…ee7f`, verified on download here), then `openapi:breaking` against `origin/main`.
- `Makefile`: `openapi` target, and `verify` = `lint ts-ratchet openapi typecheck test build`.
- Root `package.json`: `overrides` scoped to `@scalar/api-reference` (`ai`, `@ai-sdk/*`, `undici`), and to `openapi-typescript` (its `typescript` peer → the TS 6 compat package). `allowScripts` gains `vue-demi: false`.

## Evidence (named)

| Check | Result |
|---|---|
| `npm audit` (root) | **0 vulnerabilities** after the scoped overrides. Before them: 14 (4 low, 10 moderate), all via `@scalar/api-reference` → `@scalar/agent-chat` → `ai` 6.0.33 / `@ai-sdk/provider-utils` 4.0.5 (GHSA-866g-f22w-33x8) and `@scalar/json-magic` → `undici` 7.29.0 (GHSA-3wwx-pv8p-q78v) |
| backend `npm run typecheck` | no error in any P9-25 file. The run has errors in other lanes' in-flight files: migrations 0020/0095/0097, `effectivePermission.service.ts`, `certificate.separationOfDuties.adr101.test.ts`, `effectivePermission.adr102.test.ts`, `menuEffectiveAccess.adr102.test.ts` |
| `npx eslint` on every changed backend file | 0 errors |
| `npm run ratchet` | pass; floor lowered 949 → 948 |
| `tests/guards/openapiRoutes.p925.test.ts` | 11/11 (includes the both-directions checks: a false `x-permission` and a false public claim fail; a missing operation and an orphan code-first operation are reported). Re-run after the Phase 10 modules landed: the only unpinned route was `PATCH /api/v1/tenants/edit`, which is the silent-YAML defect above; fixed |
| `tests/routes/apiDocs.p925.test.ts` | 10/10. `apiDocs.route.ts` at **100 %** statements/branches/functions/lines. Anonymous → 401 on 7 paths; technician and API key → 403; tenant admin and super admin → 200; the page's CSP, no inline script, mount-relative URLs, no URL echo; spec == committed; 503 without the spec or the bundle |
| `swaggerValidatorAlignment.p608` | vendor compares clean with **no** `KNOWN_DRIFT` entry. The remaining failures belong to other lanes (the Phase 10 admin/access-request JSDoc, then `PATCH /api/v1/roles/:id`) |
| `routePermissionGuard.p604` | the P9-25 changes pass. It still fails on other lanes' routes: `auth.route.js POST /first-sign-in/password` (no gate or exemption) and `accessRequests.route.ts POST /` (no exemptions entry) |
| `csp.p708`, `appRoutes.a253` | 9 + 4 pass |
| `npm run test:coverage -- --ci` (2026-09-30, busy tree) | 752 suites passed, **12 failed** (17 tests); 14,042 tests passed; All files 98.95 % statements. Every failing suite is another lane's in-flight work, or the P6-04/P6-08 entries above: `unboundedFindAll.d24`, `admin.route`, `denyPlatformAuthoring.a127`, `apiKeyAuditPrincipal.a282.guard`, `networkSecurity.selfService.q38`, `schedulerSwitch.w02`, `admin.service`, `admin.service.audit.a165`, `tenant.validator`, plus P6-04, P6-08 and `openapiRoutes.p925`. The p925 failure was the tenants/edit YAML defect (fixed); P6-04 and P6-08 are listed above. **The 100 % gate is not met on this tree**, and not because of P9-25 files (`apiDocs.route.ts` is at 100 %) |
| `npm run openapi:check` | `backend/openapi.json is current` |
| `npm run openapi:lint` | **my part:** 0 new errors, 18 baselined, 936 warnings. The baseline refused 4 stale entries after the `$ref` fix. Latest run: **1 new error in the Phase 10 lane's `authPublic.openapi.ts`** (`oas3-valid-schema-example` on `SsoRedirect.example.redirectUrl`, format uri). Reported to that lane; open until they fix the example |
| Spectral bite test | a copy of the document with the vendor GET's operationId, 404, `x-permission`, `x-audited` and path example removed, and `security: []`, fails `cf-operation-id`, `cf-404-on-path-parameter`, `cf-public-is-explicit`, `cf-audited-declared`, `cf-path-parameter-example` |
| oasdiff 1.32.1 (Windows binary, sha256 `4d0758b3…7f28`) | `breaking openapi.json broken.json --fail-on ERR` → exit 1, 2 errors (`request-property-became-required`, `api-path-removed-without-deprecation`); identical documents → "No changes detected", exit 0. `openapi:breaking` → SKIPPED (origin/main has no `openapi.json` yet) |
| frontend `npm run typecheck` | 0 errors |
| frontend `npm run lint` | 0 errors (45 warnings, none in P9-25 files) |
| frontend `npx jest src/api/typed.test.ts src/api/services/vendor.service.test.ts src/app/dashboard/{vendors,maintenance,supplier-scorecard}` | 7 suites, **65/65**. `typed.ts` at 100 %; `vendor.service.ts` 96.66 % statements / 100 % lines |
| frontend full `jest --coverage` | 274 suites passed, 2 failed (`risk/__tests__/page`, `supplier-scorecard/__tests__/page`: 3 tests). Neither is in the vendor path, and supplier-scorecard passes in the targeted run above, so they are other lanes' in-flight work. Global 93.29 / 83.82 / 88.94 / 93.98 — above the 90/81/86/91 gate |
| `npm run api:types:check` | current |
| **Live, via tsx** (this tree; disposable PG 18.6 `p925-pg18` + Redis `p925-redis`, port 5099, seeded) | **Anonymous:** `/docs`, `/docs/`, `/docs.json`, `/docs/openapi.json`, `/docs/assets/scalar.js`, `/api/v1/docs`, `/api/v1/docs/openapi.json` → **401** envelope. **Super admin** (bootstrap one-time password → first-sign-in → login; the tenant's MFA policy answered `403 MFA_ENROLMENT_REQUIRED` on every route until TOTP was enrolled) → **200** on all 7 paths. The page carries the docs CSP (`script-src 'self'`, `connect-src 'self'`, no `https:`) and only two `<script src>` tags, mount-relative. `/docs/openapi.json` byte-equals the committed file (3.1.0, 317 paths). A bogus `ApiKey` → 401 |
| **Headless Chrome** (puppeteer-core, Bearer header) | Scalar **renders** ("Callibrator API", the Vendors tag, ~13 k chars of text). **Found:** the bundle still asked for 14 fonts from `fonts.scalar.com` despite `withDefaultFonts: false`, and the CSP **blocked every one**. Fix: `customCss` with system fonts `!important` (Scalar appends its theme CSS after `customCss`). **The re-render after that fix could not run:** the tree no longer booted, because another lane's in-flight `webauthn.service.ts` fails with `webauthn_service_module is not defined` (and earlier `certificate.model.ts`: `jsonShape is not defined`). The favicon answers 404 (cosmetic) |

The bootstrap password file the seed wrote to `backend/.bootstrap/` (git-ignored, `.gitignore:97`) was deleted after use.

## Not verified

- The browser path **through the frontend proxy** (`<frontend>/api/v1/docs` with the session cookie) was not exercised; the frontend was not running against this backend. Neither were the tenant-admin and technician principals live (they are covered over HTTP by `apiDocs.p925`).
- The font fix has no live proof yet (see above).
- The Docker image was not built (`openapi:check` and the Scalar COPY in the Dockerfile are unexercised), and `pkg` was not run.
- CI has never run on GitHub (P7-01), so the `api-contract` job is YAML-parsed only (`node -e yaml.parse`: 9 jobs, 8 steps in `api-contract`).

## Findings

- **Q-52:** vendor `notes` is accepted and never stored (no column).
- **Q-53:** the global limiter's 429 is not the envelope.
- JSDoc documented under the wrong path (`/api/v1/e-signature` vs the `/api/v1/esignature` mount; `/api/v1/oidc` vs `/oidc`). Pinned in the undocumented list.
- Silent YAML drop in swagger-jsdoc (fixed by `failOnErrors`), and dangling `$ref`s (fixed).

## For the Phase 9 lead (coordination)

Files a converting agent will meet:
- `vendor.route.js` has no `@swagger` blocks left; its contract is `vendor.openapi.ts`. When you convert the route, keep that file and do not re-add JSDoc.
- I edited these with minimal changes (comments or single entries): `stock.route.js`, `warehouse.route.js`, `tenant.route.js` (JSDoc text only), `index.js` (the `apiDocs` require and call), `routeGateExemptions.ts` (the `docs/apiDocs.ts` entry), and the tests `routePermissionGuard.p604.test.js`, `swaggerValidatorAlignment.p608.test.js`, `csp.p708.test.js` and `appRoutes.a253.test.js`.
- When a route module converts under P9-20/P9-21, follow the spec's "Rules for moving a route module".
