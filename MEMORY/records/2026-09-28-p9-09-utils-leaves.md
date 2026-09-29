# 2026-09-28 — Phase 9: the twelve true-leaf `utils/` modules are TypeScript (P9-09, part)

**ADR:** [ADR-087 Amendment 3](../DECISIONS.md) · **Card:** P9-09 started (12 leaves) · **Tree:** HEAD `35ebd76` plus the shared working tree. Three other agents were editing it at the same time: the Phase 9 lead, helper 1 (lint debt) and helper 3 (validators). Continues [`2026-09-28-p9-ratchet-constants-paths.md`](./2026-09-28-p9-ratchet-constants-paths.md).

## Which files, and why these

A file is a **true leaf** when it requires none of `middlewares/activityLog.middleware`, `middlewares/tenantContext.middleware` or `../models`, either directly or through another unconverted module. The evidence is every `require("…")` in each `src/utils/*.js`, lazy ones included. No non-literal `require(` exists in `utils/`.

| File | Requires | Converted |
|---|---|---|
| `activationToken` | `crypto` | yes |
| `appError` | nothing | yes |
| `auditActor` | `async_hooks` | yes |
| `auditRedaction` | nothing | yes |
| `csp` | nothing | yes |
| `dbRole` | nothing | yes |
| `env` | `path`, `dotenv`, `./packaged.util` (`.ts` already) | yes |
| `fileResponse` | `path`, `./appError.util` (converted first) | yes |
| `keyring` | `crypto` | yes |
| `mfaPolicy` | nothing | yes |
| `password` | `bcryptjs` | yes |
| `schemaVerify` | nothing | yes |
| `fileValidation`, `otp`, `response`, `ssrf`, `migrationLock` | leaves | **no**: each has another agent's uncommitted lint-debt diff (curly braces, `git diff --stat`) |
| `controllerWrapper` | `appError`, `fileValidation`, `response` | **no**: two of its dependencies are still `.js` (rule 1) |
| `jsonShape` | `joi`, `validators/iot.validator.js` | **no**: that validator is P9-11 |
| `jwt` | `crypto`, `jsonwebtoken`, `./keyring.util` | **no**: the plan gives it to P9-12, which waits for A-48, and `@types/jsonwebtoken` is not installed |
| `authorizationWiring`, `publicBaseUrl`, `schedulerSwitch` | `activityLog.middleware` | no (not leaves) |
| `jobContext` | `tenantContext.middleware` | no (not a leaf) |
| `kmsVerify` | `services/keyRotation`, `services/kms` | no (not a leaf) |
| `packaged`, `appPath`, `storagePath`, `circuitBreaker`, `dbReady`, `generateSwagger`, `upload`, `tenantScope`, `checkMenu`, `session`, `seedMenuGroups` | — | the lead's |

Before each `.js` file was deleted, `git diff --quiet HEAD` confirmed it was unchanged from HEAD.

## How they were converted

- **Export order is kept.** Each file ends with an `export { … }` list in the old `module.exports` order, or its `export const` declarations follow that order. The emitted `exports.a = exports.b = … = void 0` line was checked to recreate the same key order.
- **Named imports**, for example `import { createHash } from "crypto"` and `import { hash, compare } from "bcryptjs"`. Babel and TypeScript both compile a call to a live property read (`(0, _m.f)(…)`), so `jest.spyOn(crypto, "createHash")` and `jest.mock("bcryptjs", factory)` still apply. `bcryptjs`'s `hash`/`compare` do not read `this` at their top level (checked in `node_modules`).
- **`AppError`'s fields use `declare`.** No class field is emitted, so the own-property order stays `message` → `status` → `isOperational` → `details` → `stack`. `toJSON()` returns the module-local `AppErrorBody`, as agreed with the lead: no file in `src/types/`.
- **Dependencies are typed by the members used.** `dbRole` and `schemaVerify` get local structural interfaces for the Sequelize instance and the logger (`AppRoleSequelize`, `SchemaSequelize`, …), and `auditActor` gets `AuditActorRequest`, a structural request type. `auditActor` does not use `src/types/express.d.ts`, because that file does not declare `req.impersonatorId`. Raw-SQL rows are typed once, at the query boundary (`as ColumnRow[]` from `unknown[]`). The one-row `pg_roles` check is typed as a non-empty tuple, so `check.currentUser` keeps its old failure mode.
- **As-built expressions are kept, with line-level directives.** Where the JavaScript used `||` (empty means unset) or `String(x)`/`Number(x)` (coercing what a JavaScript caller passes), the expression is unchanged. It carries an `eslint-disable-next-line` naming the rule and "as-built (ADR-038 rule 3)". The three `process.env` reads (`appError#toJSON`, the `dbRole` and `schemaVerify` defaults) do the same, pointing to P9-06.
- **Three equivalent rewrites.** Each one gives the same value for every input:
  - `fileResponse#baseType`: `split(";")[0]` became `split(";", 1).join("")`. The old form left an uncoverable `?? ""` and dropped branch coverage to 99.99%.
  - `sendStoredFile`'s callback: `return resolve()` became `resolve(); return;`. The callback's return value was always `undefined`, and the check below proves it still is.
  - `a && a.b` became `a?.b` wherever the result is only tested for truth or passed on to `|| null`.
- **`auditRedaction`** still reads `value.toJSON` twice and calls it as a method. The check below counts the getter reads.
- **Tests are unchanged.** No test in scope spawns plain `node` or reads one of these files as text.
- **`catch (e: unknown)`:** none of the twelve contains a `catch`.

## Evidence

| Check | Result |
|---|---|
| `npm run typecheck` (TypeScript 7) | exit 0 |
| `npx eslint` on the 12 `.ts` files | 0 problems |
| `npm run build:dist` | "446 JavaScript files copied, 35 TypeScript files compiled -> dist/" (the counts include the lead's concurrent conversions) |
| Identity: originals (`git show HEAD:backend/src/utils/<f>.util.js`) against `dist/src/utils/<f>.util.js`, scratch `p9h2/compare.js` | **1,197 checks; 1,195 identical.** The checks cover: export names and order; `typeof`, arity and deep-equal values of every export, including freeze state at every depth; every function over representative inputs, with thrown errors compared by class, message, own keys and first stack line; `AppError` × 9 classes × 5 argument sets × `NODE_ENV` unset/production/development; `auditActor` inside and outside `runWithImpersonator`, sync and async; `dbRole` hook idempotence and `enterApplicationRole` over 4 check rows × 3 environments (logger calls included); `fileResponse` headers, `sendStoredFile` over 9 callback shapes and the callback's return value; `schemaVerify` over 5 schema scenarios × 4 modes × `SCHEMA_VERIFY` unset/warn; `env`'s `dotenv.config` arguments relative to each module's own root |
| …the 2 differences | `password.hashPassword.name` and `comparePassword.name` were `""`: `exports.x = async () => …` gives no name, while `export const x = …` does. Nothing reads them: no `hashPassword.name` or `comparePassword.name` anywhere in `backend/`. No other function's `name` or `length` changed |
| `npm run ratchet` | "floor lowered 1197 -> 1183 (14 .js file(s) gone)": the 12 here plus 2 of the lead's concurrent deletions |
| Own tests, `npm test -- …` | 14 suites, 146 tests passed: `appError.test.js`, `auditActor.util.test.js`, `auditRedaction.d27.test.js`, `csp.p708.test.js`, `dbRole.util.p603.test.js`, `env.test.js`, `fileResponse.util.test.js`, `keyring.util.p610.test.js`, `mfaPolicy.a160.test.js`, `password.test.js`, `schemaVerify.util.p605.test.js`, `jwt.keyring.s26.test.js`, `maxFileSize.envFallback.p701.test.js`, `services/auth.activationBinding.a191.test.js` (the `activationToken` consumer) |
| First full run, `npm run test:coverage -- --ci --forceExit` | every test passed, but exit 1: branches 99.99% (`fileResponse.util.ts` line 96, the `?? ""` above). Fixed as described |
| Final full run, same command | **exit 0 — 642/666 suites (24 skipped), 12,808 tests (155 skipped), 100/100/100/100**, 143 s. All 12 files at 100/100/100/100 |

## Found, not fixed (for the coordinator)

**Source-walking guard tests skip `.ts` files.** They walk directories with `entry.name.endsWith(".js")`, so each conversion silently takes the converted file out of the guard. None of them fails, so nothing announces the loss. Affected:

- `utils/rawSqlTenantPredicate.d05` (scans `utils/`, `services/`, …; `dbRole` and `schemaVerify` hold raw SQL, today against `pg_roles`/`information_schema` only)
- `utils/istanbulIgnore.a32`
- `utils/jobContext.w12`
- `utils/schedulerSwitch.w02`
- `constants/systemActors.a124`
- `guards/auditInTransaction.p611`
- `routes/routePermissionGuard.p604`, `routes/uploadAfterGate.a78` and other route/service walkers

Only `routes/tenantHierarchy.visibility.q05` accepts `.ts`. Fixing them changes tests, so it belongs in its own change. ADR-087 Amendment 2 records the full list (16+ suites) and makes "the guard accepts `.ts`" a precondition for each later layer.

**Emitted modules gain `"use strict"`.** None of the twelve depends on sloppy mode: none assigns an undeclared name, uses `this` in a plain function, or writes to a frozen object.

## Left open

- `ApiResponse<T>`: lands as `src/types/apiResponse.ts` with `response.util`'s conversion, asking the lead first (agreed 2026-09-28).
- `response.util#paginated`: **already deleted** in `244b63b` (2026-09-24). The card's box is ticked with that evidence.
- `fileValidation`, `otp`, `response`, `ssrf`, `migrationLock`: convert once helper 1's diffs are committed. Then `controllerWrapper`.
- Not updated here: `MEMORY-INDEX.md`, `CHANGELOG.md`, `TASKS/PROGRESS.md` (the coordinator's, with the commit). `backend/.ts-ratchet.json` was rewritten by the ratchet and is not committed.
