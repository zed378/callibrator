# CLAUDE.md — Operating Instructions for AI Agents

How Claude and other AI agents work in this repository.

---

## Read This First

**The previous version of this file was wrong in a way that produced confidently wrong work.**

It instructed agents to write strict TypeScript with no `any` — for a backend that is **JavaScript, CommonJS**. It pointed at a task board listing foundation work as TODO that had shipped months earlier.

That is recorded as PR-4 in [`docs/PLAN/18-RISK-REGISTER.md`](docs/PLAN/18-RISK-REGISTER.md), and it is the single most important thing to know about this project's history: **an instruction document that disagrees with the code produces confidently wrong work, and the confidence is the dangerous part.**

Everything below is grounded in the code or a dated record as of 2026-10-02. If you find a claim here that the code contradicts, **the code wins** — and correcting this file is part of the fix.

## What This Is

**Callibrator** — multi-tenant SaaS for hospital medical-device calibration, maintenance and lifecycle management.

| | |
|---|---|
| Backend | **Dual-Backend Target Architecture (ADR-089)** — Express/Sequelize existing backend (`backend/`, entry `backend/index.ts`) in **strict TypeScript, compiled to CommonJS** (ADR-038; toolchain ADR-087). The one source `.js` file left is the dead `src/utils/checkMenu.util.js`, whose deletion awaits the owner (A-18). The 694 `.js` files in the test trees are legacy, converted opportunistically (P9-26). Future Go backend engine (`backend-go/`) planned for **Phase 999** (strictly after Phase 9 & Upstream PHP Feature Adoption) |
| Database | **PostgreSQL 18 + pgvector, only** (ADR-039 for the engine, **ADR-041** for the version) — MySQL support was removed. The repository and the reference deployment are both on 18: the VM runs **PostgreSQL 18.6** since the closing deploy of 2026-10-02, which wiped the stack and started fresh volumes (the owner's wipe decision in [`TASKS/RUNBOOK-POSTGRES-18-UPGRADE.md`](TASKS/RUNBOOK-POSTGRES-18-UPGRADE.md); [record](MEMORY/records/2026-10-02-closing-deploy-vm.md)). A data directory written by 17 still will not start under 18, so any other 17 deployment needs the runbook's dump-and-restore |
| Frontend | Next.js 16 · React 19 · TypeScript · Tailwind 4 · Zustand · **Multi-Frontend & Shared Component Architecture** as the *target* — the root-level `shared/` area does not exist yet (2026-10-02) |
| Realtime | Socket.IO, both ends (ADR-031) |
| Infra | Redis · RabbitMQ · MQTT client (external broker, optional) · ClamAV · pgvector |
| Scale | **55** route modules (+3 internal) · **73** models · **950** backend test files · **603** backend source files (counted 2026-10-02: `routes/api/*.route.ts`, and `routes/internal/*.route.ts` for the internal three; `models/*.model.ts`, not `models/index.ts`; `*.test.js`/`*.test.ts` under `backend/src/tests` — 679 `.js`, 271 `.ts` — with 3 more legacy `.js` tests in `backend/__tests__`; every non-test `.js`/`.ts` under `backend/src`, `.d.ts` excluded, migrations and scripts included — 1 of them `.js`, `utils/checkMenu.util.js`). Backend source runs through `tsx` or the built `dist/`, never plain `node src/…`, and **a new backend `.js` file — test files included — fails `npm run ratchet`** (in `make verify`, CI and the pre-push hook). The previous row said 53 / 71 / 674 / 467 on 2026-09-27; counts are dated snapshots, re-count before quoting |
| Compliance | ISO 17025 · FDA 21 CFR Part 11 · ISO 13485 · GDPR · KARS · SNARS. SNARS stays a compliance target in these documents until its ADR, but **public copy never names it** (Q-39, ADR-098 §8, a working decision awaiting the owner's confirmation: "supports hospital accreditation readiness (Ministry of Health standards)") |

## Before You Start

1. **[`docs/README.md`](docs/README.md)** — the map.
2. **[`docs/PLAN/00-PROJECT-OVERVIEW.md`](docs/PLAN/00-PROJECT-OVERVIEW.md)** — what this is and what it deliberately is not.
3. **[`docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`](docs/SECURITY/05-MULTI-TENANCY-SECURITY.md)** — **mandatory, no exceptions.**
4. **[`MEMORY/DECISIONS.md`](MEMORY/DECISIONS.md) Part II** — nine ADRs recording what was built differently from what was planned. Read Part II before acting on Part I.
5. **[`TASKS/PROGRESS.md`](TASKS/PROGRESS.md)** — what is actually shipped.
6. **[`TASKS/00-TASK-CONVENTIONS.md`](TASKS/00-TASK-CONVENTIONS.md)** — the Definition of Done.

## The Non-Negotiables

### Tenant isolation

Enforced by global Sequelize hooks reading an `AsyncLocalStorage` context, **deny-by-default**. You do not opt in.

```js
// You write this:
const devices = await Device.findAll();
// The hooks add the tenant predicate. A principal with no resolvable
// tenant matches NO_TENANT_UUID and sees NOTHING.
```

**Includes too, since 2026-09-24 (ADR-048).** Before that, the hooks scoped only the **root**
model, and an include could join another tenant's row (A-87, proven on PostgreSQL 18). The hooks now
add the predicate to every tenant-scoped include's ON clause **without changing its join type** — so a
cross-tenant reference reads as `null` on a LEFT include and drops the row on an INNER one.
`skipTenantScope: true` is the only opt-out, at either level.

**Never** read `tenantId` from a request body. It is stamped from the context.

**Raw SQL bypasses the hooks entirely.** It goes through `sql()` (`utils/sql.util.ts`, P9-07) with the tenant predicate **bound** (`tenant_id = $n`); a direct `.query(` in source is a lint error, `rawSqlTenantPredicate.d05` checks every statement naming a tenant-scoped table, and every new statement is a review item.

### Cross-tenant returns 404, never 403

A 403 says "this exists and you may not have it" — which turns id enumeration into a tenant-membership oracle. Non-existent, soft-deleted and not-yours must be **indistinguishable**.

### Every route needs a permission gate

```js
router.post("/", auth, dynamicAccess("equipment", "write"), validate(schema), ctrl.create);
```

**The build enforces it** (P6-04, DONE 2026-09-25): `routePermissionGuard.p604` fails on a route with neither a gate nor a reviewed exemption in `constants/routeGateExemptions.ts`. A route without one would work for everyone with a token — the single most likely authorization defect in a codebase like this, which is why the guard exists.

### Every mutation writes an audit row, inside the transaction

An audit row that survives a rolled-back action records something that did not happen. An action that commits without one is unattributable.

### Every new `:id` route needs a two-tenant test asserting 404

Not 403. Not 200.

**`createTwoTenants()` exists since 2026-09-24** — `backend/src/tests/fixtures/twoTenants.js` (A-63).
For about a month this file called it "a one-line fixture" while it existed in no code file (A-55).
It gives two tenants, principals by role in either, and a transaction double. Its first users are
`tenant.edit.a63.test.js` and `user.profile.a63.test.js`, which show how to wire it.

**Every `:id` route is now accounted for, and a guard keeps it so** (2026-09-29). Of the **201**
routes with a path parameter, **150** have a two-tenant test asserting 404 and **51** are on a
reviewed allow-list (platform-only, public, capability-token or not-tenant-owned, each checked
against the route's chain or model) — `backend/src/tests/guards/twoTenantRoutes.guard.test.ts`
fails the build on a new `:id` route with neither. Write the test with `fixtures/twoTenantSuite.ts`
over `fixtures/memoryDb.ts` (the REAL models and tenant hooks in memory; `vendor.twoTenant.test.js`,
`qms.twoTenant.test.ts`) and mark it `@two-tenant <route file> <METHOD> <path>`.

## The Traps

Every one of these has caused a production defect here. They are structural, not careless.

| Trap | What happens |
|---|---|
| An optional include without **`required: false`** | INNER JOIN — the list silently returns **nothing** |
| An include of a model with a **`defaultScope`** (`User`, `CalibrationDevice`) | an **INNER JOIN even with no `where`** — rows whose reference is null or deleted vanish (A-75) |
| An INNER include (explicit, or implicit via `defaultScope`) of a row authored by the **super admin** inside a tenant | since ADR-048 the parent row **disappears** for tenant users — the referenced user is in another tenant (A-90, Q-17) |
| **`schema.validate`** passed to Express | **500 on every request** to that route |
| A path parameter the validator never sees | **400 on every request** — name the source: `validate(schema, { from: ["params", "body"] })` |
| **`db`** destructured from the models barrel | it exports `sequelize`; you get `undefined`, then a throw |
| **`is_deleted`** written in code | silently does nothing — the attribute is `isDeleted` |
| **`tenantId`** on the `sessions` model | `column "tenantId" does not exist` — it uses snake_case |
| A new role without a **`ROLE_LEVELS`** entry | fails every privileged gate, **silently** |
| A migration with a blanket **`try/catch`** | **recorded as applied while doing nothing** |
| A **global** uniqueness constraint | a cross-tenant existence oracle |
| Suspending the **default tenant** in a test | 403s every later request; recovery is a direct database update |
| A model **index on a column that a later migration adds** | the **upgrade boot fails**: `db.sync()` builds a model's missing indexes before the migrator adds the column (ADR-100 Am. 3; `modelIndexColumns.am3.guard`, `upgradeBoot.am3.live`). The index belongs to the migration |
| An **`export interface`** (or any named export) beside **`export =`** | typecheck and jest pass, then the module **throws at load** under tsx (`<file>_module is not defined`). `export =` stands alone (ADR-087 Am. 15; lint `EXPORT_EQUALS_ALONE`, `npm run load:check`) |

The first one is the most repeated defect shape in this codebase. It has hit certificates and risks. `maintenance_work_orders` was long listed here as latent; it is not — every include there carries `required: false`, pinned by `maintenance.includes.a190.test.js` (A-227, 2026-09-25).

## The Response Envelope

```json
{ "success": true, "status": 200, "message": "...", "data": [], "meta": { "total": 0 } }
```

**Rows in `data`. Pagination in a top-level `meta`, a sibling of `data`.** Never `data.rows`, never `data.items`, never `data.meta`.

Violating it renders an empty list with **no error**. Three screens did exactly that for weeks.

This is the rule for **list** endpoints. A single report document — `GET /api/v1/reports/overdue-devices` and `/inventory` — is one object in `data` that may hold arrays of its own (`data.rows`); it has no paging to put in `meta` (A-343, closed as designed 2026-10-02).

## Status Codes That Carry Meaning

| Code | Use |
|---|---|
| 400 | validation |
| 403 | permission failure **inside the caller's own tenant** |
| **404** | not found — **including belonging to another tenant** |
| **409** | invalid state transition |

A 409 surfaces as a **state explanation** — "this certificate is in `draft` and must be submitted first" — never a generic error. Reporting a conflict as a 500 hides a design gap behind a stack trace, which is exactly what made certificate approval unreachable.

## When to Act, and When Not To

**Act on:** an assigned task, a bug found during work, a question about the codebase, documentation that disagrees with the code.

**Do not:**

- start a task that is not assigned or next in the queue,
- change architecture without an ADR,
- **amend `docs/` quietly** — that is the deviation protocol, and it needs a record,
- mark something done without its `MEMORY/records/` entry,
- claim a test passed without **naming it**.

## The Deviation Protocol

When implementation reveals `docs/` is wrong, incomplete, or contradictory:

1. **Stop.** Do not quietly implement something different — that is how the specification drifted the first time.
2. Write an **ADR** in `MEMORY/DECISIONS.md`: decision, rationale, **alternatives considered**, implications **including the bad ones**.
3. Amend the `docs/` document, referencing the ADR.
4. Note both in the change record.

**A documented deviation is a decision. An undocumented one is a bug nobody has found yet.**

If it needs a decision the owner has not made, it is an **Open Question** in `TASKS/BACKLOG.md`, not a judgement call.

## Evidence

> **An assertion that a test passed is not evidence. Name the test.**

"IDOR tested, all good" with no test named is **worse than saying nothing**, because it stops anyone looking again.

Three rules that catch a worthless test:

- **Test database grants as the application role**, not the owner. As the owner it passes whether the grant exists or not.
- **A test generated from the code it tests verifies consistency, never correctness.** A redaction test iterating the redactor's own key set cannot catch a key being deleted from it.
- **A mock proves the client, not the contract.** 3,863 tests passed here while 13 endpoints were broken.

## Distinguish "Renders" From "Works"

Two claims currently live in this repository, and both are stated carefully on purpose:

- The Helm charts **install, upgrade and serve on ONE local kind cluster** (P7-06, ADR-106, 2026-09-30): a single node, kindnet, local-path volumes, ingress-nginx and throwaway datastores, with the backend image built from `ce74932`. That is **not a production cluster**: no managed CNI, real StorageClass, second node, cert-manager or external secrets was involved, and the prod/staging values files were only rendered. They are **not known to deploy to production**. With the shipped `FORCE_HTTPS: "true"`, browser sign-in through the frontend failed there (A-310); the fix is **in code** since 2026-09-30 (`frontend/src/lib/backendHeaders.ts`, tested by `backendHeaders.a310.test.ts`) and has **not been re-run on a cluster**.
- The E2E suite **passed in one uninterrupted run, twice back to back, on 2026-10-02 on the final Phase 9–10 tree** (runs Q and R, `MEMORY/records/2026-10-02-closing-gates-qr.md`): 433 tests passed, 0 failed (5 skipped), with smoke 7/7, accessibility 80/80, responsive 45/45 and Phase 10 browser 12/12, in production mode on a disposable compose stack, by hand, 0 × 5xx. Earlier pairs: G/H 2026-10-01, and the first on 2026-09-28 (P6-02, ADR-077). **CI does not run it** (A-19), so a later change can break it unnoticed.

Do not round these up. `TASKS/BACKLOG.md` § Unverified Claims lists all six of them.

## Workflow

```
1. read the task and every document in its Spec refs
2. if "Spec required", write MEMORY/specs/<task-id>-<slug>.md FIRST
3. branch:   feat/P6-04-route-permission-guard
4. implement
5. verify:   make verify      (lint · typecheck · test · build · load-check)
             make test-e2e    (against a running server)
6. record:   MEMORY/records/  + MEMORY-INDEX + CHANGELOG + ADR if a decision
7. update:   TASKS/PROGRESS.md — in the SAME commit
8. PR:       P6-04: <description>
```

`make verify` does **not** cover the live or browser suites. A green `verify` is not a green release.

## Commands

```bash
make help          # every target
make dev           # local stack
make verify        # lint · ts-ratchet · typecheck · test · build · load-check — by hand; CI runs the same stages
cd backend && npm run load:check [-- --src]  # every module loads: dist/ under node, src/ under tsx (ADR-087 Am. 15)
make test-e2e      # 57 live spec files, running server required (not in verify, not in CI)
make migrate       # then: make migrate-verify — the log is not evidence
make hooks         # opt in to the pre-push hook (gitleaks, lint ratchet, typecheck, ts-ratchet)

node scripts/ci/eslint-ratchet.js        # backend lint gate, from the repo root: baseline 0 errors (ADR-092)
cd backend && npm run typecheck          # TypeScript 7 (frontend: the same script)
cd backend && npm run ratchet            # fails on any new .js file, tests included (ADR-087)
cd backend && npx eslint <file>          # on every file you change — the gate lints src/ only
```

`make` is not installed on every workstation; each target is one or two commands in the `Makefile`, runnable directly. **Backend source runs through `tsx`** (`npm start` = `node --import tsx index.ts`, `npm run dev`, the `migrate*` scripts; the release build compiles `index.ts` to `dist/index.js`): plain `node` on backend source fails with `MODULE_NOT_FOUND` at the first `.ts` module (ADR-087). Full command table: [`docs/ENGINEERING/10-TOOLING-LINT-FORMAT.md`](docs/ENGINEERING/10-TOOLING-LINT-FORMAT.md).

**Run backend tests through the npm scripts** (`npm test`, `npm run test:coverage`), not bare
`npx jest`. Since A-99 the scripts pass `--experimental-vm-modules`, because the real `otplib` 13
needs ES-module-only dependencies. A bare `npx jest` on the suites that use it fails with "Must use
import to load ES Module".

**Type-check with `npm run typecheck`, never bare `npx tsc`** (ADR-076). Two TypeScripts are
installed: `@typescript/native` is TypeScript 7.0.2, the compiler, and `typescript` is the TypeScript 6
compatibility package that typescript-eslint, `next build` and ts-jest need for its API. `npx tsc` is
**not** TypeScript 7: ADR-076 found it resolving to 6, silently, and on 2026-09-29 it failed outright
with `MODULE_NOT_FOUND` (the 6 package's binary is `tsc6`). Jest type-checks nothing, so the typecheck
is the only type gate. Node is **26**, pinned by the root `.nvmrc`.

## Code Style

Match the surrounding code. Both workspaces have standards documents:

- [`docs/BACKEND/00-BACKEND-STANDARDS.md`](docs/BACKEND/00-BACKEND-STANDARDS.md)
- [`docs/FRONTEND/00-FRONTEND-STANDARDS.md`](docs/FRONTEND/00-FRONTEND-STANDARDS.md)

Also [`docs/ENGINEERING/09-TESTING-CONVENTIONS.md`](docs/ENGINEERING/09-TESTING-CONVENTIONS.md), [`10-TOOLING-LINT-FORMAT.md`](docs/ENGINEERING/10-TOOLING-LINT-FORMAT.md) and the PR checklist [`14-CODE-REVIEW-CHECKLIST.md`](docs/ENGINEERING/14-CODE-REVIEW-CHECKLIST.md).

**The backend source is TypeScript, compiled to CommonJS** (ADR-038, ADR-087), checked strict by TypeScript 7. The one source `.js` file left is the dead `utils/checkMenu.util.js` (A-18); `noSourceJs.p924.guard` fails on any other. **The 694 `.js` files in the test trees are legacy** (P9-26): convert one only when you already edit it for another reason or its module's change needs it, and never change an assertion while doing so — same case names, same count.

**All new backend code is TypeScript — tests included — held to [`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`](docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md)**: `strict` plus the ADR-038 flags, no `any`, reasons on every `@ts-expect-error` and `eslint-disable`. `npm run ratchet` fails on a new `.js` file. A conversion never changes behaviour — it is proved by an identity check, not asserted (04 § Converting a Module).

The as-built conventions a new `.ts` file follows (each is a lint error, a guard or a compile error, not a preference):

- **Raw SQL through `sql()`** (`utils/sql.util.ts`, P9-07): bind parameters only, the tenant predicate **bound** (`tenant_id = $n`). A direct `sequelize.query` in `.ts` is a lint error.
- **Validation through `validate(schema, { from })`** (Zod, P9-11): the only middleware form; a `.ts` handler reads `validated(req, schema)`. Controllers and services use `validateInput` / `checkInput` from `validators/input.ts`.
- **Configuration through `config/env.ts`** (`env`, `envOr`, `isProduction`); `process.env` outside `src/config/` is a lint error.
- **Shared types in `src/types/`**; a brand assertion (`as TenantId`) only in `src/types/ids.ts`; `skipTenantScope` is typed there too (`sequelize.d.ts`).
- **Models** follow `initModel` with `export =` (04 § Models); the barrel is typed.
- **Module shape:** `export =` of one object, in the key order its callers see, or named exports — never a named export beside `export =` (ADR-087 Am. 15, 28). A load whose position matters stays a literal `require`, typed through `import type` (Am. 28).
- **Routes** `export = router` and import an ES-module controller's handlers by name, not `import * as` (its interop helper adds branches jest counts and no test takes); a route's contract is its `*.openapi.ts` module (ADR-103) — a `@swagger` JSDoc block is refused by the OpenAPI build.
- **Logging** through the winston `logger`; `console.*` only in the six CLIs of `src/scripts/`.
- **Tests:** a new `:id` route gets `twoTenantSuite` + `memoryDb` and an `@two-tenant` marker; a grant or trigger test on PostgreSQL runs as `callibrator_app`.

**State as fact only what the code does.** Backend documents describe the as-built TypeScript (the P9-24 sweep, 2026-10-02); anything not built yet is labelled *target*. Writing a target as fact is PR-4, the failure this file opens with.

Frontend (ADR-071, ADR-090): pages render per request under a nonce CSP — no inline `<script>`, no `<style>` element without the nonce, no third-party image origin; one `<main>` and one `<h1>` per page; icon-only controls named after their object; colours from the theme tokens. Do not disable React Compiler lint rules to make a build pass. The rule is usually right about the component.

## What Is Currently Failing

Stated here because an agent reading a green board and finding a red gate wastes an afternoon. Refreshed 2026-10-05 from runs and records named in each row. (This section was "Two Things Currently Failing"; ADR-088 records the first refresh.)

| | |
|---|---|
| Backend unit coverage gate (100%) | **100% statements / branches / functions / lines** on 2026-10-05 (`npm run test:coverage -- --ci`, Node 26.10.0, a tree quiet for code, the closing gates before the commit of the work since `dded70c`): **890 suites passed, 37 skipped, 0 failed; 15,054 tests passed, 247 skipped**, in 371 s ([record](MEMORY/records/2026-10-05-closing-gates-st.md)). Jest recycles a worker whose heap passes 2 GB (`workerIdleMemoryLimit`, ADR-117). Run it on the Node major pinned in the root `.nvmrc` (26, A-257/ADR-076): a global setup refuses any other major. **Models are outside the 100% figure** (ADR-085, ADR-092) — measured separately at 93.5% statements, 65.58% branches on 2026-09-28. Quote a count only from a run on a quiet tree |
| Backend lint | **0 errors, 0 warnings**, ratchet baseline **0** (ADR-092; P9-02a, ADR-087 Am. 30 raised `no-unused-vars`, `no-console` and `prefer-arrow-callback` to errors), re-run 2026-10-05 on the closing tree (`node scripts/ci/eslint-ratchet.js`: "0 error(s), 0 warning(s); baseline 0"; `npm run lint` exit 0). Every change must lint clean: run `npx eslint <file>` in `backend/` |
| Typecheck, build, load | 2026-10-05, closing tree ([record](MEMORY/records/2026-10-05-closing-gates-st.md)): `npm run typecheck` 0 errors (backend, frontend, `packages/contracts`, `automate`); `npm run ratchet` 695 `.js`, at the floor; `npm run build:dist` OK (612 TypeScript files); `load:check` OK in both modes (602 modules, 105 in boot order); `openapi:check` current, `openapi:lint` no new error; contracts 48 suites, 1,097 tests at 100%; `next build` OK, bundle budget 10/10 within (`/` gzip 148.7 of 150 KB); frontend jest 297/297 suites at 93.94 / 84.77 / 89.63 / 94.6 (gate 90/81/86/91); `npm audit --omit=dev` 0, `npm-audit-gate.js` 0 failing. **`openapi:breaking` against `origin/main` fails: 3 errors, all `POST /api/v1/sop`** (W-10's new validation) — passes on a direct push to `main`, fails a pull request until recorded (record § 2) |
| Live E2E in one uninterrupted run | **achieved again 2026-10-05 on the tree of the work since `dded70c`, twice back to back** (runs S and T): 56 of 57 spec files (1 skipped), **433 passed, 0 failed** each, plus smoke 7/7, accessibility 80/80, responsive 45/45 and Phase 10 browser 12/12, **0 × 5xx**, six 429s all asserted by the specs, in production mode on a disposable compose stack built from a snapshot of the tree; migrations 0109–0110 also proved on an upgrade boot from `dded70c`'s image, and `db-backup` passed its first verification ([record](MEMORY/records/2026-10-05-closing-gates-st.md)). Earlier: Q and R, 2026-10-02 (`MEMORY/records/2026-10-02-closing-gates-qr.md`). First achieved 2026-09-28 (P6-02, ADR-077). **Not in CI**, and never run against the reference deployment |
| CI on GitHub | **has run, never fully green** (P7-01). On `1100658` (run 36954054620) three causes failed it; fixed in `dded70c` ([record](MEMORY/records/2026-10-02-ci-first-push-fixes.md)). **The second run, on `dded70c` (run 37268522297, 2026-10-05): 9 of 11 jobs green**; backend coverage and npm audit failed ([record](MEMORY/records/2026-10-05-ci-second-run.md), ADR-117). Fixed in the working tree, not yet pushed: the audit job now runs the production audit strictly and the whole tree through an expiring GHSA allow-list (`scripts/ci/npm-audit-gate.js`; `braces` GHSA-vfj7-8cjw-p6xm is dev-only with no fix); the coverage failure did not reproduce on Linux, a measured worker heap leak is bounded by `workerIdleMemoryLimit: "2GB"`, and failing suites now annotate themselves (`scripts/ci/jest-annotate.js`). A green run awaits the next push |
| Helm | proven on **one local kind cluster**, not a production cluster (P7-06, ADR-106); A-310 is fixed in code but not re-run on a cluster (§ Distinguish "Renders" From "Works") |

## If You Are Unsure

Read the code. `docs/` names its source files precisely so you can check it rather than trust it.

If the code and this file disagree, **the code wins, and this file gets fixed** — in the same change, with a record.
