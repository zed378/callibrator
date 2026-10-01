# 2026-09-29 — P9-19 round 1: ten middlewares are TypeScript, three of them under the four gates

**ADR:** ADR-087 and its amendments (conversion rules; no new decision) · **Card:** P9-19 IN PROGRESS (10 of 25) · **Tree:** HEAD `ce74932` plus the uncommitted Phase 9 work. Other agents were working in parallel on P9-12 (lead), migrations (P9-23), the UI-correctness fixes and the security fixes.

## What changed

| Area | Files |
|---|---|
| Converted (`.js` removed after `cmp` against a working-copy snapshot) | `src/middlewares/notFound`, `validateUuid`, `requestTimeout`, `globalSanitizer`, `accessLog`, `createFolder`, `errorHandlers` |
| Converted under the four gates | `src/middlewares/metricsAuth`, `rbac`, `denyPlatformAuthoring` |
| New test | `src/tests/middlewares/rbac.lowestBar.p919.test.ts` (3 tests; see gate (a)) |
| Shared types (written by the P9-12 lead on request) | `src/types/express.d.ts`: `Request.impersonatorId?: string \| null`; `AuthenticatedPrincipal.role.roleLevel` / `role_level` |
| Packages | `@types/morgan` `^1.9.10`, a new devDependency (none → 1.9.10), because `accessLog` imports morgan. `npm audit` reports 0. It has no install scripts, and its only dependency is `@types/node`. The `package.json` and lockfile diff is this one package |
| Ratchet | `backend/.ts-ratchet.json` floor 1006 → 1002 at this boundary. Other agents' ratchet runs had already dropped part of the ten; none of the ten is listed now |

**Existing tests: unchanged.**

## How the conversions keep behaviour

- **Load-time capture.** Wherever the `.js` destructured a module at load, a `const` still captures it at load. That covers `response.util`'s `notFound`, `error` and `forbidden`; the logger; `sanitizeError`; `isPackaged`; `tenantStorage`; `currentImpersonatorId`; and the constants in rbac.
- **CommonJS packages.** `fs`, `path`, `crypto`, `xss`, `morgan` and `moment-timezone` are default imports of the module object, so `fs.existsSync` is still read at call time and the tests' spies still reach it.
- **ESM-typed packages** are loaded by `require` with a type-only import, following the `upload.util` precedent:
  - `uuid`, which is ESM-only;
  - `rotating-file-stream`, whose types are ESM while its CommonJS build sits behind `require`.
  - Consequence: under Babel, `rotating-file-stream` now loads after `moment-timezone` instead of before it. Neither has a load-time effect on the other.
- **Unused import kept.** `accessLog` required `path` without using it; a bare `import "path"` keeps that load (the `dbReady` precedent).
- **Environment reads.** `process.env` is read through `src/config/env`:
  - `errorHandlers` uses `isProduction()`.
  - `metricsAuth` uses `envOr("METRICS_TOKEN", "")`. The `.js` wrapped that in `String()`, which changed nothing because the environment holds only strings. The `String()` around the header stays, because a JavaScript caller may pass a non-string.
- **Return values and expressions are as built.**
  - `return next()`, `return res…json()` and `return tenantStorage.run(…)` are kept, each with a line directive giving the reason.
  - `||`, `a && a.b` and property re-reads are kept where the JavaScript had them. For example, `globalSanitizer` still reads `req.body` twice.
- **rbac's exports stay plain, writable `exports.*` properties.** p604 and `twoTenantRoutes.guard` reassign `rbac` before any router loads.
- **Key order** of every module's exports is unchanged (checked in gate (b)).

## Evidence

### The seven ordinary middlewares

- **Suites:** their 9 suites passed, 89 tests, unchanged. Each file is at 100/100/100/100.
- **Identity: 853 checks, all identical**, comparing the working-copy original with the TypeScript 7 emit. Both ran against the same compiled dependencies (scratch `p9mw/probe1.js`, `cmp.js`, `cmp2.js`). The checks were run twice: against `build:dist` output, and against a TS7 emit using `tsconfig.build.json`'s options.

| Middleware | Checks | What was compared |
|---|---|---|
| `validateUuid` | 385 | 12 values × 4 parameter sets × 4 second-parameter values × 2 `next` results. The random example uuid was normalised |
| `errorHandlers` | 331 | 11 error shapes × 5 `NODE_ENV` values × 3 request ids × `headersSent`, including the log calls |
| `accessLog` | 53 | The rotating-stream options and file names; the three tokens over 10 request shapes; 15 real HTTP requests through express, with the written lines compared (the skip list, 4xx and 5xx) |
| `globalSanitizer` | 49 | 12 bodies (nested values, excluded keys, prototype chains, null-prototype objects, primitives) × 4 query shapes (including a getter-only one), with object identity kept |
| `requestTimeout` | 25 | Error and `headersSent` combinations |
| `createFolder` | 6 | Every `existsSync` and `mkdirSync` call, the logs and `process.exit`, including a thrown `null` |
| `notFound` | 4 | — |

### The security-critical three, under the four `tenantContext` gates

**(a) The watching suites bite on the `.ts`.** Each plant went into the `.ts`, the watching suite was run, and the file was restored byte for byte (`cmp`; scratch `p9mw/bite.sh`).

| Plant | Result |
|---|---|
| deny: the rebind keeps `isSuperAdmin: true` | `denyPlatformAuthoring.test` 1 failed; `denyPlatformAuthoring.a127` 14 failed |
| deny: the no-home-tenant refusal removed | `denyPlatformAuthoring.test` 1 failed |
| deny: `isSystemTask: true` | `jobContext.w12` 1 failed |
| deny: `console.log` | `noConsole.a42` 1 failed |
| rbac: a USER bypass | `rbac.test` 2 failed |
| rbac: `module.exports` frozen, so p604 cannot tag the factory | `routePermissionGuard.p604` 3 failed; `twoTenantRoutes.guard` failed to load |
| metrics: a short token accepted | `metricsAuth.p702` 3 failed |
| metrics: the token not compared | `metricsAuth.p702` 5 failed |
| rbac: `Math.min` → `Math.max`, which raises the bar to the highest listed role | **no suite failed** |

**Finding:** no test pinned rbac's documented "lowest listed level" rule. `rbac.lowestBar.p919.test.ts` now pins it, and it failed 2 of 3 on that plant.

**(b) Identity: 11,053 checks, all identical** (scratch `p9mw/probe2.js`), comparing the original with the TS7 emit in the same world.

| Middleware | Checks | Shapes |
|---|---|---|
| `rbac` | 9,703 | **`rbac`:** 10 role lists × 4 option shapes × 109 principals (none; null; no role; 13 role names including `superadmin`, `""` and unknown, each with 8 level shapes). `next` both returns and throws.<br>**`checkRoleLevel`:** 7 minimum levels.<br>**`notSuperAdmin`:** covered too.<br>**Also:** a thrown `null`, and export descriptors |
| `denyPlatformAuthoring` | 1,250 | 13 principals × 6 effective tenants (none, null, `""`, own, other, PLATFORM) × 4 `impersonatorId` values × 4 contexts (none, tenant, super-admin, impersonation context). Compared: the 403, the store `next` sees, the store after, and `platformAuthoringRefusal`.<br>**Outcomes covered:** 708 refused; 216 rebound to the home tenant; 36 rebound to PLATFORM; 144 passed with no store; the rest passed inside a super-admin context |
| `metricsAuth` | 100 | 7 `METRICS_TOKEN` values (unset, empty, short, 31, 32, 64, spaces) × 14 headers (none, null, empty, correct, lower-case scheme, double space, wrong, spaces, 31 characters, a number, an array, Basic) |

**(c) The authz and isolation suites: 88 suites, 2,147 tests; 86 suites passed.** They included:
- `routePermissionGuard.p604`, `readGates.a155` and `readGates.p604`;
- `denyPlatformAuthoring.a127` and `partElevenAuthoring.a145`;
- `twoTenantRoutes.guard` and every `*.twoTenant*` suite;
- the `tenantScope*`, `includes*` and `tenantHierarchy*` suites;
- `routeGuards.a02`, `a28` and `a66`; `admin.flags.a174`; `dynamicAccess*`; `jobContext.w12`; `noConsole.a42`; and `istanbulIgnore.a32`.

The two failing suites are `audit.platform.a125` (6 tests, `AuditLog.findAll is not a function`) and `kanban.twoTenant` (1 test, a memoryDb grouped aggregate). **They fail identically with the ten JavaScript originals copied back**, so they come from the in-flight `audit.service.js` and `kanban.service.js` edits, not from this card.

**(d) Live:** a disposable PostgreSQL 18.6 with pgvector, and Redis 8.6. The backend booted from source with `node --import tsx index.js`: schema-verify OK (72 tables), 66 migrations, authorization wiring validated for 171 gates, "Server running". The requests, with the result of each:

- **notFound:** an unknown route → 404 `Route not found`.
- **requestTimeout:** a 30-second seeding call → 408 in the envelope.
- **errorHandlers:** malformed JSON → 400, with a sanitized production body.
- **validateUuid:** a bad `:userId` → 400.
- **globalSanitizer:** a JSON `firstName` with `<script>` → stored escaped.
- **accessLog:** lines written, carrying request-id, user-id, IP and the Jakarta date.
- **metricsAuth:** 401 without a token, 401 with a wrong one, 200 (Prometheus text) with the right one.
- **rbac:**
  - super admin on `/admin/tenants`: 200;
  - a level-8 tenant admin: 200 on `/api-keys` (TENANT_ADMIN) and 403 on `/admin/tenants`;
  - a USER: 403 on both.
- **denyPlatformAuthoring:** on `POST /certificates`:
  - super admin with `x-tenant-id` or `x-tenant-code` of another tenant → 403 OTHER_TENANT;
  - own tenant, or no header → the request reaches validation (400);
  - impersonating the tenant admin → 403 IMPERSONATING, while the same impersonation token still gets 200 on `/api-keys`;
  - the tenant admin itself → through to validation.
- **Cleanup:** the containers were removed afterwards and the scratch secrets deleted.

### Boundary checks

- **Typecheck:** TypeScript 7 is clean on every file here. The typecheck run's only error was in another agent's in-flight `migrations/0019-*.ts`.
- **ESLint:** 0 problems on the 10 files and the new test.
- **`npm run ratchet`:** the floor was lowered and the check passed.
- **`build:dist`:** "304 JavaScript files copied, 187 TypeScript files compiled" after the first seven. After that it refused because of the P9-23 migrations in flight (`.js` and `.ts` side by side). That is why gate (b) used a TS7 emit with the build config's options.

### Full `npm run test:coverage` at this boundary (not green; nothing here causes it)

- **Result:** 672 of 754 suites passed, 56 failed, 26 skipped; 13,379 tests passed, 189 failed; 99.45 / 98.65 / 98.67 / 99.44. All ten files are at 100/100/100/100.
- **A/B:** the 56 failing suites were run again with the ten originals copied back. 55 failed then, against 54 with the `.ts`. **No test fails only with the `.ts`.** The extra failures in the originals run were A-288 (`signInPolicy`), which another agent was editing at that moment.
- **Where the failures come from:** other agents' in-flight work: new routes (`first-sign-in`), sign-in policy, controllers, migrations 0019 and 0067, `manifestNames.p923`, and CSP / `requestBudget` / `selfRegistration`.
- **Where the coverage gaps are:** only in those agents' files.

## Found, not fixed

- **The sanitizer never sees multipart bodies (as built).** `globalSanitizer` runs app-wide before multer parses a multipart body inside a route. A tenant created with `--form-string name=…<script>…` is stored unescaped (checked live). A conversion does not change it; it needs a decision, since output encoding may be the intended defence.
- **`errorLog` is never mounted.** `accessLog` exports it, but `index.js` does not use it, so 4xx and 5xx get no second line. This is dead code, as built.

## Blocked (left for later rounds)

| Middleware | Blocked by |
|---|---|
| `auth` | the `auth`, `tenant` and `apiKey` services (`session` and `jwt` are `.ts`) |
| `dynamicAccess` | the `apiKey` service; the UI-correctness agent is also editing it |
| `abac` | the `tenant` service |
| `enforceQuota` | the `quota` service |
| The 9 schedulers | `jobMonitor.service`, and most also their own service |
| `bodyDefault` | another agent's uncommitted change |
| `auditLog` | A-41 (card rule) |
