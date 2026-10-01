# 2026-09-29 — Code conventions brought to the as-built architecture

**Task:** owner request "update the code conventions to match the latest architecture" (documentation only; no source changed) · **Agent:** conventions helper (Claude) · **Protocol:** deviation protocol — every doc statement the code contradicted is corrected **citing the existing ADR that decided it**; no new decision is made here, so no new ADR is written.

## Ground truth read

ADR-038, ADR-058, ADR-062, ADR-071, ADR-074, ADR-076, ADR-077, **ADR-087 with Amendments 1–12**, ADR-088, ADR-090, ADR-092; the P9-11 card and `MEMORY/specs/P9-11-validation-error-contract.md`; `MEMORY/records/P9-00.md`. Code: `backend/tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `jest.config.js`, `jest.transform.js`, `scripts/ts-ratchet.ts`, `scripts/build-dist.ts`, `src/types/*`, `src/config/env.ts`, `src/utils/sql.util.ts`, `src/models/initModel.ts`, `src/middlewares/validation.middleware.ts`, `src/validators/{input,fields,warehouse.validator}.ts`, `tests/fixtures/{twoTenantSuite,memoryDb,routeClient}.ts`, `tests/guards/*`, `tests/routes/qms.twoTenant.test.ts`, the root `.nvmrc`, all three `package.json`, the `Makefile`, `.github/workflows/ci.yml`, `scripts/git-hooks/pre-push`, `frontend/src/proxy.ts`, `frontend/src/app/api/v1/[...path]/route.ts`.

**ADR-093** (P9-11, and — per the code comments — also M-11, Q-34, Q-35, Q-36) is cited throughout the code but was **not in `MEMORY/DECISIONS.md`** when this pass ran; the docs cite it by number and say so where it matters (03-VALIDATION banner).

## Documents changed

| Document | What was corrected (ADR) |
|---|---|
| `docs/BACKEND/00-BACKEND-STANDARDS.md` | banner/as-built: mixed JS/TS, tsx required for source runs (087); three instructions incl. tests-are-`.ts` and leaf-first; validator layer is Zod; barrel is `models/index.ts`, 71 models, no `db` key (087 Am. 11); **Validation** rewritten — Zod, `validate()` only, `schemaAsMiddleware.p911`, `validateInput`/`checkInput`, `from: [...]` path-wins, and the old `validate(schema)({...req.params,...req.body})` call corrected (P9-11); bypass table: `skipTenantScope` typing (087 Am. 9), `isSystemTask` only via `jobContext`; **raw SQL through `sql()`** (087 Am. 12); **"no build guard fails a route" corrected** — `routePermissionGuard.p604` (ADR-058) and `twoTenantRoutes.guard`; Style: lint baseline 0, Prettier not a gate (092), `config/env.ts` (087 Am. 6), `noConsole.a42` (076); Before-a-PR list |
| `docs/BACKEND/03-VALIDATION.md` | banner only (the body had been rewritten by the P9-11 helper and matches the code): validators and the middleware are TS, routes/controllers still JS; ADR-093 not yet written. Added rules 8 (no `z.any`/`.passthrough`/`.loose`) and 9 (contract suites; literal change = contract change) |
| `docs/BACKEND/05-TENANT-SCOPING.md` | coding-rule parts only: code paths are `.ts` (087 Am. 2/4/11); deny sentinel is the branded `NO_TENANT_ID`; new § **Raw SQL: `sql()` with a bound tenant predicate** and § **`skipTenantScope` in TypeScript**; hooks-bypass table and review checklist; pointer to `twoTenantSuite` + `memoryDb` |
| `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` | **rule sections only; the lead's banner untouched.** Which compiler (TS7 by path, TS6 API for lint/Next, `npx tsc` is not 7, jest checks nothing); lint table (+ `non-nullable-type-assertion-style` off, shared-type ban, raw-query ban, `ban-ts-comment` allow-with-description); branded ids as-built vs `toTenantId` target; `errorMessage`/`utils/errors.ts` marked target (does not exist); Zod request pattern corrected (flat schemas, `from`, `validated(req, schema)`, `fields.ts`); `express.d.ts` as built; Models (barrel typed, lint rule retired, D-12 brand, four checks, D-27 `z.infer`); new §§ Raw SQL, Configuration, Module shape and CommonJS interop, **Converting a Module** (Am. 1–12); Where Types Live file list; Things That Look Strict rows |
| `docs/ENGINEERING/09-TESTING-CONVENTIONS.md` | layers table with dated counts (Am. 12 gate, ADR-076 frontend, ADR-077/P9-00 E2E green twice) and the ADR-085 coverage scope; rule 3 rewritten for `twoTenantSuite` + `memoryDb` + `routeClient` + the `@two-tenant` marker and its guard; new rules 7 (guards and bite proofs), 8 (live PG as the application role), 9 (validation contract), 10 (P9-00 baseline); "TypeScript (target)" → as-built (no hoisting, `requireActual`, type-level tests) |
| `docs/ENGINEERING/10-TOOLING-LINT-FORMAT.md` | Node 26 and npm/lockfile; command table (tsx, ratchets, TS7, build-dist, `make verify` stages); verified-command block; warnings 237; lint scope (A-284); `.ts` block; P9-02 status; Prettier not a gate and **not clean**, do not sweep; **"there are no hooks and no CI" corrected** (ADR-066, ADR-076); **"no lockfile committed" corrected** (ADR-044) |
| `docs/ENGINEERING/14-CODE-REVIEW-CHECKLIST.md` | added checks: `sql()`, two-tenant marker, p604, `skipTenantScope`/`isSystemTask`, `validate`/`validated`, Zod bans, contract suites, directive reasons, env, brands, `.ts` tests + ratchet floor, TS7 typecheck, conversion proofs, guard bite proofs, live PG role, lint outside `src/`, tsx, frontend CSP/a11y |
| `docs/FRONTEND/00-FRONTEND-STANDARDS.md` | stack line (TS 5 → TS 7 beside TS 6 API; Node 26); typecheck by path and the two type checks (076); no `packages/` yet (P9-22 target); new § **The Next proxy owns `/api/`** (046, 059, 074); new § **Content Security Policy** (071); a11y rules expanded (090, 074); PR block `pnpm` → npm (044) |
| `CLAUDE.md` § Commands, § Code Style | Commands: `make verify` stages and "CI runs the same" (was "no hook or CI runs it"), `make hooks`, the three gate commands, tsx, `npx tsc` wording updated to what was observed. Code Style: mixed JS/TS as-built, tests are `.ts`, the as-built `.ts` conventions list, frontend CSP/a11y. **No other section touched.** |
| `AGENTS.md` | Shared Contract route-gate row (ADR-058); Backend Engineer knows-list (mixed JS/TS, tsx, `sql()`, env, Zod `validate`/`from`, two-tenant suite); Frontend Engineer knows-list (proxy, CSP, a11y, two type checks); `make verify` stages |
| `TASKS/AUDIT-2026-09-REMEDIATION.md` | findings **A-283**, **A-284** (below) |

## Commands verified (2026-09-29, Node v26.10.0, Windows 11, Git Bash)

| Command | Result |
|---|---|
| `cd backend && npm run typecheck` | exit 0 (TypeScript 7.0.2) |
| `cd frontend && npm run typecheck` | exit 0 |
| `node ../node_modules/@typescript/native/bin/tsc --version` | `Version 7.0.2` |
| `npx tsc --version` (root and `backend/`) | **fails**, `MODULE_NOT_FOUND …node_modules/typescript/bin/tsc` — the TS6 package's bin is `tsc6`. Docs now say "not TypeScript 7" rather than "silently 6" |
| `cd backend && npm run ratchet -- --list` | 1,050 files, none unlisted |
| `cd backend && npm run ratchet` | exit 0, **"floor lowered 1050 -> 1048 (2 .js file(s) gone)"** — `src/services/session.service.js` and `src/utils/jwt.util.js` had been converted by the Phase 9 lead between the list and the check. The ratchet rewrote `backend/.ts-ratchet.json` as designed; the lead's commit should carry it. Reported to the caller |
| `node scripts/ci/eslint-ratchet.js` (repo root) | exit 0, "backend eslint: 0 error(s), 237 warning(s); baseline 0." (87 s) |
| `cd backend && npm run lint` | exit 0, 0 errors, 237 warnings |
| `cd backend && npm run prettier` | exit 2, ~1,108 files flagged — documented as "not a gate, not clean" |
| `npx prettier --find-config-path index.js` (backend) / a frontend file | `.prettierrc` / `../.prettierrc.js` |
| `npm test -- src/tests/guards/twoTenantRoutes.guard src/tests/guards/schemaAsMiddleware.p911 src/tests/utils/sql.p907 src/tests/utils/rawSqlTenantPredicate.d05 src/tests/guards/noConsole.a42 src/tests/guards/nodeVersion.a257 src/tests/routes/routePermissionGuard.p604 src/tests/models/modelTypes.p910 --coverage=false` | 7 of 8 suites passed; **`twoTenantRoutes.guard` failed 3 tests** because an `@two-tenant` marker names `POST /:certificateId/pdf`, which the fixes agent's in-flight certificate-PDF change replaced with `GET /:certificateId/document`. The guard is biting as designed; not filed (in another agent's lane) |
| `make …` | **`make` is not installed** on this workstation; each target used in the docs was run as the command it wraps (`Makefile` lines 280–345 read) |

## Findings filed

- **A-283** — live PostgreSQL suites: 15 of 21 never switch to `callibrator_app`; 12 distinct enable flags; none in CI.
- **A-284** — the backend lint gate lints `backend/src/` only; `index.js` carries an error no gate sees.

## Left open (not in this pass's scope, or another agent's)

- `CLAUDE.md` outside Commands/Code Style still carries stale convention text: § The Non-Negotiables "Nothing in the build enforces this" (route gates — ADR-058 guard exists) and § The Traps' `schema.validate` row (now Zod); "What This Is" backend row ("JavaScript/CommonJS today") is the lead's.
- `AGENTS.md` Security Engineer "current gaps" table and QA counts are stale (P6-03, P6-04, P6-06, P6-10 closed by ADR-062/058/049).
- `docs/BACKEND/05-TENANT-SCOPING.md` § "The one existing oracle" still describes the global serial unique that ADR-049 replaced (outside the coding-rule scope asked for).
- `backend/src/types/README.md`'s file table still says `express.d.ts` / `ids.ts` "not written yet" — the lead's directory.
- ADR-093 to be written by the P9-11 helper; the docs cite it by number.
