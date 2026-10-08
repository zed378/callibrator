# Phase 9 — Backend TypeScript Migration

**Status: 🟡 STARTED 2026-09-28.** Decided in [ADR-038](../MEMORY/DECISIONS.md) (2026-09-21), superseding ADR-030; the toolchain as built is **ADR-087**.

> **2026-09-29 — 42 modules are TypeScript** (ADR-087 and Amendments 1–5; records under
> `MEMORY/records/2026-09-2[89]-p9-*`). Done: P9-01, P9-01a, **P9-01b**, P9-03, P9-04, P9-05a,
> **P9-08**. Started: P9-02 (helper 1's), P9-05 (`src/types/`: four files), P9-09 (24 of 36
> utils). As-built: all 16 `constants/`, 23 `utils/`, the `activityLog` and `tenantContext`
> middlewares; everything else under `backend/src` is JavaScript. **The P9-00 baseline set passes
> against a converted image** (53/53 specs, 392 tests, identical per-spec counts).
> **The paragraph below is the 2026-09-23 state, kept for the record.**

> **Refreshed 2026-09-23** against the tree as it is now. The card list was written on 2026-09-21
> and the audit remediation of 2026-09-23 changed roughly ninety files under `backend/src`: five
> modules are new, one is deleted, six were substantially rewritten. Every count below was
> re-derived from the code on 2026-09-23; where a card's premise moved it is marked
> **NEEDS EDIT (2026-09-23)** or **NOT DONE — premise changed** with one line saying what changed.
>
> **Nothing in Stage A has been started.** There is no `backend/tsconfig.json`, no `typecheck`
> script in `backend/package.json`, no TypeScript transform in `jest.config.js`, and no `.ts` file
> anywhere under `backend/`. The tooling cards below (P9-01, P9-01a, P9-01b, P9-02, P9-02a, P9-03,
> P9-03a, P9-04) are therefore **not adjustments to a working toolchain — they are the toolchain**,
> and no conversion card can start before them.

The backend moves from JavaScript/CommonJS to **TypeScript with the strictest practical settings**, incrementally, without a behaviour change. The target standard is [`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`](../docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md); the layer templates are in [`docs/ENGINEERING/05-LAYER-TEMPLATES.md`](../docs/ENGINEERING/05-LAYER-TEMPLATES.md).

**Until this phase closes, the backend is JavaScript.** Every backend document carries a banner saying so. Nothing in this file is shipped until its card says `DONE` and its `MEMORY/records/` entry exists.

---

## The Three Rules

These come from ADR-038 and are not renegotiated per task.

1. **Leaf-first order.** A file is converted only when everything it imports is already TypeScript. A `.ts` file never depends on an untyped `.js` one.
2. **The ratchet only goes down.** The number of `.js` files under `backend/src` may never rise. New backend code is TypeScript from P9-04 onward.
3. **Conversion never changes behaviour.** A conversion PR changes types, syntax and imports — nothing else. A bug the compiler exposes is written down and fixed in its **own** PR against [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md). If a conversion cannot compile without a behaviour change, it stops and the fix goes first.

### The three rules, re-checked against the week of 2026-09-23

Stated as rules on 2026-09-21; this is what the first week of real work did to them.

| Rule | How it held | What it needs |
|---|---|---|
| **1 — leaf-first** | **The order written in ADR-038 is not the order the code has.** Of 20 `utils/`, **8 import a layer that is supposed to come after them** — 6 import `middlewares/`, 3 import `models/` (`seedMenuGroups` does both); `config/index.js` imports `utils/dbReady.util`, which imports `middlewares/activityLog.middleware`; `middlewares/` imports `services/` (8 files) while **44 service files import `middlewares/activityLog.middleware`**. Taken literally, rule 1 forbids converting anything | the **Dependency Reality** section below replaces the layer order with the real one. `config/` and `middlewares/` are split across stages rather than converted as layers |
| **2 — the ratchet** | **Violated on its first test, because nothing enforces it.** `bodyDefault.middleware.js`, `health.service.js`, `health.controller.js`, `routes/internal/health.route.js` and `migrations/0019-add-signature-crypto-fields.js` were all written on 2026-09-23 **as JavaScript**. The count went up by 5 and down by 1 | P9-04 is the only card that makes rule 2 real. Until it lands, every remediation PR raises the floor. It is not a Stage A nicety — it is the reason the inventory below is larger than the one it replaces |
| **3 — conversion never changes behaviour** | Held, because no conversion has happened. The remediation did the opposite and correctly: 27 findings fixed **in JavaScript, first**, none of them inside a conversion | the P9-00 baseline must be recorded **after** the remediation, not against the 2026-09-21 tree. A baseline taken before ~90 files changed is an oracle for code that no longer exists |

## Preconditions

| | Why it must come first | State 2026-09-23 |
|---|---|---|
| **AUDIT-2026-09 wave 0 is `DONE`** | the cross-tenant write on `tenant-hierarchy` and the unguarded configuration routes are live holes. A migration measured in months is not a reason to leave them open | **NOT met.** 20 of 27 wave-0 findings are `DONE`; **A-13, A-32, A-37, A-41, A-42, A-48 and A-51 remain open**, and four of those are `high`. A-37 is the cross-tenant oracle `CLAUDE.md` names by name; A-41 and A-48 are now carried as P6-11 and P6-12 |
| **A behaviour baseline exists** | rule 3 needs an oracle. The live E2E suite has never passed in one uninterrupted run (P6-02), so P9-00 records **which specs pass today**; no stage may reduce that set | not met, and the target moved: the suite is **53** specs (`src/tests/e2e/*.test.js`, counted 2026-09-23), not the 51 the Makefile and P6-02 still say |
| **The backend suite is green at 100%** | Conversion that drops a file below 100% is not done | the figure needs restating before it can be a precondition: **309 suites** today (306 under `src/tests/` plus 3 under `backend/__tests__/`), not the 289 of 2026-09-11 or the 290 of 2026-09-21 — and the 100% is measured over six layers only. See P9-03a |
| **A working lint gate** | new — A-34 found the backend lint gate had **never run**. It runs now and reports **1,297 errors and 340 warnings** on `src/` | not met. A migration plan that assumes a passing gate is fiction. See P9-02a |

## Inventory

Re-derived from the tree on **2026-09-23** (`find backend/src -name '*.js'` → **738** files; 363 of
them are tests). The 2026-09-21 column is what this file said before the remediation landed.

| Layer | Files (2026-09-23) | Was (09-21) | Stage |
|---|---|---|---|
| `constants/` | 5 | 5 | B |
| `utils/` | 20 | 20 | B — but see Dependency Reality; 4 of them import `middlewares/` |
| `config/` | 4 | 4 | **split**: `index.js`+`migrate.js` in B, `migrator.js` in E, `socket.js` in D |
| `models/` | 72 | 72 | B |
| `validators/` (Joi → Zod) | 37 | 37 | B |
| `services/` (71 + 6 under `storage/`) | **77** | 76 | C — `health.service.js` is new |
| `middlewares/` | 21 | 21 | **split**: `tenantContext` + `activityLog` in A, the other 19 in D. Composition changed: `sessionSecurity` deleted, `bodyDefault` added |
| `controllers/` | **57** | 56 | D — `health.controller.js` is new |
| `routes/` (53 `api/` + 2 `internal/`) | **55** | 54 | D — `internal/health.route.js` is new; `internal/` is a subtree the old card did not mention |
| `workers/` | 1 | 1 | D |
| `scripts/` | 4 | (unlisted) | D |
| `docs/` (swagger JSDoc source) | 3 | (unlisted) | D |
| `backend/index.js` | 1 | 1 | D — **it is not `src/index.js`**; 90 `require()` calls, and it is the only file that mounts the routers, `db.sync()` and the migrator |
| `migrations/` | **19** | 18 | E — **names frozen**, see P9-23 (**63** at conversion, 2026-09-30; all `.ts`) |
| tests, `src/tests/` | 306 unit + 53 e2e + 4 helpers | 340 | with their module |
| tests, `backend/__tests__/` | 3 | (unlisted) | with their module |

**375 source files** under `backend/src` plus `backend/index.js`, and **366 test files**. The eight
generators in `backend/scripts/` are outside `src` and outside the ratchet; they are converted last
or not at all, and P9-04 must say which.

The sizes below are relative (S/M/L/XL by file count and risk), not calendar estimates: nobody has measured this team's conversion rate yet, and a guessed date is a promise nobody made.

---

## Dependency Reality

**NEEDS EDIT (2026-09-23) applied here.** ADR-038 rule 1 names the order
`types → constants → utils → config → models → validators → services → middlewares → controllers → routes → index`.
The code does not have that shape, and a conversion attempted in that order stops on the first file.

Measured with `grep -rE 'require\("\.\.?/'` over `backend/src`, 2026-09-23:

| Claimed order | What the code does |
|---|---|
| `utils` before `config`, `models`, `middlewares` | `utils/checkMenu.util.js` requires `../config` **and** `../models`; `utils/seedMenuGroups.util.js` requires `../models`; `utils/session.util.js` requires `../models`; `utils/circuitBreaker.util.js`, `dbReady.util.js`, `generateSwagger.util.js` and `upload.util.js` require `../middlewares/activityLog.middleware`; `utils/tenantScope.util.js` requires `../middlewares/tenantContext.middleware` |
| `config` before `models` and `services` | `config/index.js` requires `../utils/dbReady.util`; `config/socket.js` requires `../services/auth.service`, `../services/kanban.service`, `../utils/jwt.util` and `../middlewares/tenantContext.middleware`; `config/migrator.js` requires all 19 migrations |
| `middlewares` after `services` | 8 middlewares require `../services/*` (`auth`, `abac`, `dynamicAccess`, `auditLog`, `enforceQuota`, `calibrationScheduler`, `retentionScheduler`, `sessionCleanup`) while **44 of the 77 service files** require `middlewares/activityLog.middleware`. **This is a cycle, and it is the largest single obstacle in the phase** |

### The real leaves

| Order | Files | Why |
|---|---|---|
| **0** | `constants/*` (5) | require nothing outside `constants/` |
| **0** | `middlewares/tenantContext.middleware.js` | requires `async_hooks` only. It is the AsyncLocalStorage the whole tenant predicate hangs from |
| **0** | `utils/packaged.util.js` → `utils/storagePath.util.js` | `path` + `packaged.util` only |
| **1** | `middlewares/activityLog.middleware.js` | `winston` + `storagePath.util`. **69 non-test files import it.** Nothing above it can be typed until it is |
| **2** | the remaining `utils/` that do not touch `models/` | |
| **3** | `config/index.js` → `models/` (barrel, all-or-nothing) → `validators/` | |
| **4+** | `services/`, then the rest of `middlewares/`, `controllers/`, `routes/`, `config/socket.js`, `index.js` | |

**Consequence for the stages:** `middlewares/tenantContext.middleware.js` and
`middlewares/activityLog.middleware.js` move to **Stage A** (card P9-05a). The rest of
`middlewares/` stays in Stage D. `config/` is split three ways as the inventory table records.

**Consequence for the `models/` barrel:** `models/index.js` holds 78 `require()` calls and
`services/` imports `../models` 118 times. A `.ts` service importing a `.js` barrel gets `any` for
all 72 models, which is rule 1 violated in the one place it matters most. **The barrel and its 72
models convert as one unit or not at all** — P9-10's "batches of ≤ 12 models per PR" is a merge
strategy, not a shipping strategy, and the branch does not merge until all 72 land.

---

## What Changed Since This File Was Written

The remediation of **2026-09-23** (27 audit findings, ~90 files). Every row below is a module this
file's card list did not know about. **Every one of the five new files is JavaScript** — see P9-04.

| Module | What | Where it is handled now |
|---|---|---|
| `services/health.service.js` | **new** — A-15. `/health` checked only the database; it now checks Redis, RabbitMQ, MQTT and ClamAV | **P9-18**, converted last in Platform (widest fan-in) |
| `controllers/health.controller.js` | **new** — A-15/A-06. The response was narrowed to stop disclosing Node version, pid and memory | **P9-20** |
| `routes/internal/health.route.js` | **new** — and with it a `routes/internal/` subtree the old P9-21 did not mention | **P9-21** |
| `middlewares/bodyDefault.middleware.js` | **new** — A-09. Express 5 leaves `req.body` **undefined**; this makes it `{}` before any validator runs | **P9-19** |
| `migrations/0019-add-signature-crypto-fields.js` | **new** — A-47 / ADR-040. Its manifest name is already frozen with `.js` | **P9-23**, and the frozen list there now has 19 entries |
| `middlewares/sessionSecurity.middleware.js` | **deleted** — A-12, dead code whose SQL targeted a nonexistent `"Sessions"` table | **P9-19**, already ticked. Nothing to convert |
| `config/socket.js` | rewritten — A-05 (`origin: "*"`, token in the query string, no suspension check) | **P9-21**; A-52 and A-53 still open against it |
| `services/scim.service.js` | rewritten — A-33 (PATCH ignored `path`) | **P9-12**; A-37, A-38, A-39 and A-49 still open against it |
| `services/eSignature.service.js` | rewritten — A-47 / **ADR-040**; no signature could ever verify before it | **P9-14**; the KMS re-wrap is an open question, so the shape may move again |
| `services/rateLimiter.redis.service.js` | rewritten — A-30 (the limiter never used Redis). Took 12 unexplained coverage exclusions with it | **P9-18**; its tests are now worth relying on |
| `services/rabbitmq.service.js` | rewritten — A-36 (`connection.isOpen` does not exist in amqplib; a connection leak in production) | **P9-18** |
| `utils/jwt.util.js` | rewritten — A-31 (nothing stopped access and refresh secrets being equal) | **P9-12**; A-48 will change the request path again |

---

## Stage A — Foundations

No production module is converted in this stage. Its output is a toolchain in which the first conversion is boring.

### P9-00 — Record the behaviour baseline

| | |
|---|---|
| **Status** | **DONE 2026-09-28** (ADR-092 item 1, `MEMORY/records/P9-00.md`) — taken on commit `35ebd76` (0 `.ts` files), not the working tree, which was mid-conversion and did not build |
| **Depends on** | AUDIT wave 0 |
| **Spec refs** | `docs/TESTING/03-E2E-TESTING.md` · ADR-038 rule 3 |
| **Spec required** | no |
| **Size** | S |

> **What changed:** the remediation of 2026-09-23 altered ~90 files, including `config/socket.js`,
> `services/scim.service.js`, `services/eSignature.service.js`, `services/rateLimiter.redis.service.js`,
> `services/rabbitmq.service.js` and `utils/jwt.util.js`, and added a new `/health` module. A
> baseline taken against the 2026-09-21 tree is an oracle for code that no longer exists. The
> baseline is recorded **after** wave 0 closes, not before.

**Why:** "No behaviour change" is unfalsifiable without a baseline. The unit suite mocks the database and the HTTP layer; the live E2E suite is the only thing that exercises real contracts, and it has never been green in one run.

**Definition of Done**
- [x] the **53** E2E specs (`src/tests/e2e/*.test.js`, counted 2026-09-23 — the Makefile's "51" is stale) run against a fresh stack; the passing set is recorded by spec name in `MEMORY/records/P9-00.md` — **53 of 53 passed, in two consecutive runs** (392 tests; `liveContract.smoke` opt-in, skipped), 0 × 429 in the server log
- [x] every failing spec has a one-line reason (known defect with an audit task id, flake, environment) — none failed; `ai` passes only because its spec accepts the no-provider 500, recorded as environment-dependent
- [x] the run command and stack commit are recorded, so the baseline can be reproduced
- [x] the SCIM e2e spec that **cannot pass** (A-49) is named as such, not counted as a failure to be fixed later — A-49 closed 2026-09-24 and `scim.e2e.test.js` **passes** (4/4); it is in the set

**Abuse cases**
- Recording a baseline from a run where failing specs were skipped rather than failed
- Taking the baseline *after* the first conversion

---

### P9-01 — The compiler: `backend/tsconfig.json`

| | |
|---|---|
| **Status** | **DONE 2026-09-28** (ADR-087) — `target`/`lib` are ES2025, not ES2023 (Node 26; ADR-087 item 1) |
| **Depends on** | P9-00 |
| **Spec refs** | ADR-038 · `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` |
| **Spec required** | no |
| **Size** | S |

> **What changed:** this card bundled the compiler, the script wiring, the binary build and the
> image into one `M`. Checked against the tree on 2026-09-23, each of those is absent rather than
> wrong, and they fail for different reasons. The build and the script wiring are now P9-01b and
> P9-01a. This card is the compiler alone.

**Why:** the compiler settings are the migration. Weakening them later is far harder than starting strict.

**State 2026-09-23:** there is no `backend/tsconfig.json`. The **root** `tsconfig.json` has
`"include": []`, excludes `backend`, and carries a comment saying *"TypeScript is meaningful only
in `frontend/`. The backend is JavaScript, CommonJS (ADR-030); there is nothing to type-check
there"* — **ADR-030 is superseded by ADR-038**, so that comment is PR-4 living inside the tooling.
`typescript@5.9.3` is present at the repository root, hoisted from `frontend`'s `^5.8.0`; nothing
pins it for the backend.

**Definition of Done**
- [x] `backend/tsconfig.json` with every flag in the standards document (`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride` + `noImplicitReturns` + `noFallthroughCasesInSwitch` + `noPropertyAccessFromIndexSignature` + `noUnusedLocals` + `noUnusedParameters` + `isolatedModules` + `forceConsistentCasingInFileNames`), `allowJs: true`, `checkJs: false`, `module: Node16`, `moduleResolution: Node16`, `target: ES2023` (**as built: ES2025**, ADR-087), `outDir: dist`, `rootDir: "."`
- [x] `verbatimModuleSyntax` **off** — it is incompatible with the CommonJS emit ADR-038 requires. If a future editor turns it on, the build breaks silently in `pkg`, not in `tsc`
- [x] `skipLibCheck: true` is the **only** relaxation, and a comment says it covers third-party `.d.ts` and never our code
- [x] `tsconfig.build.json` extends it and excludes `src/tests/**` and `__tests__/**` — and sets `allowJs: false`, so a `.ts` → `.js` import fails the build (TS7016, proved)
- [x] the root `tsconfig.json` comment corrected: it cites a superseded ADR
- [x] `typescript`, `@types/node`, `@types/express` (v5) pinned **in `backend/package.json`** (TypeScript 7 as `@typescript/native`, the TypeScript 6 API as `typescript` — ADR-076), not inherited from the frontend's hoist

**Abuse cases**
- Starting with `strict: false` "for now"
- Adding `skipLibCheck` to hide a real type conflict rather than as the documented default
- Declaring the card done because `tsc` exits 0 on a tree with zero `.ts` files — with `include`
  unset and no `.ts` files, `tsc` exits 0 on **any** configuration, including an empty one

---

### P9-01a — A backend `typecheck` that runs, and a `verify` that fails without it

| | |
|---|---|
| **Status** | **DONE 2026-09-28** (ADR-087) — through `make typecheck` directly, not turbo (below) |
| **Depends on** | P9-01 |
| **Spec refs** | ADR-038 · `docs/DEVOPS/11-MAKEFILE-REFERENCE.md` · `00-TASK-CONVENTIONS.md` § Build |
| **Spec required** | no |
| **Size** | S |

**Why:** **`make verify` does not type-check the backend, and will not start to just because a
`tsconfig.json` appears.** Read the chain as it is on 2026-09-23:

| Link | State |
|---|---|
| `Makefile: typecheck` | `pnpm typecheck`, with the comment *"frontend only — the backend is JavaScript, ADR-030"* |
| root `package.json: typecheck` | `turbo run typecheck` |
| `turbo.json` | declares a `typecheck` task with `"cache": true` |
| `backend/package.json` | **has no `typecheck` script at all** |

Turbo skips a package that does not declare the task, and **exits 0**. So the day the first `.ts`
file lands, `make verify` still reports a green typecheck having compiled nothing. This is the same
shape as A-34 — a gate in `make verify` that could not have run — and it is worth writing down that
it was found before it cost anything rather than after.

`00-TASK-CONVENTIONS.md` § Build says `pnpm typecheck — frontend; the backend is JavaScript
(ADR-030)`. That line is the Definition of Done for every task in the repository and it cites a
superseded ADR; correcting it is part of this card.

**Definition of Done**
- [x] `backend/package.json` gains `"typecheck"` — TypeScript 7 by path, `-p tsconfig.json --noEmit` (ADR-076)
- [x] ~~`turbo run typecheck` is observed to **run it**~~ **replaced**: `turbo run typecheck` at the root refuses to run at all on 2026-09-28 ("Missing `packageManager` field"), and skips silently when it does run. `make typecheck` now runs `npm run typecheck` in each workspace directly; CI's backend-lint job and the pre-push hook call it too — recorded by a run whose output names `backend`, not by reading `turbo.json`
- [x] the Makefile comment on the `typecheck` target corrected (it cites ADR-030)
- [x] **tested in the failing direction** (the backend step of `make typecheck`; no `make` on the machine that ran it): `src/utils/zzP9probe.a087.ts` with `const x: number = "x"` → `npm run typecheck` exit 1, TS2322; removed → exit 0. A deliberate type error in a `.ts` file makes `make verify` exit non-zero. A gate never seen to fail is not known to work
- [x] `00-TASK-CONVENTIONS.md` § Build updated once the backend is in the task

**Abuse cases**
- The script is added and never observed to run, because turbo's skip is silent
- `--noEmit` is dropped, so `typecheck` writes `dist/` as a side effect and a stale `dist` is shipped

---

### P9-01b — The binary build: `tsc` → `dist` → `pkg`, and the image

| | |
|---|---|
| **Status** | **DONE 2026-09-29** (ADR-087 Amendment 5) — the P9-00 baseline set passes against the converted image; the `/health` dependency block was verified on the P9-00 compose stack (PostgreSQL 18.6, Redis 8.6, RabbitMQ 3.13 — no separate staging host exists) |
| **Depends on** | P9-01 |
| **Spec refs** | ADR-038 (build row) · `docs/DEVOPS/02-CONTAINERIZATION.md` |
| **Spec required** | no |
| **Size** | M |

**Why:** **`@yao-pkg/pkg` cannot read TypeScript, and the current configuration is `.js`-shaped in
four places at once.** From `backend/package.json` and `backend/Dockerfile`, 2026-09-23:

| Setting | Today | Why TypeScript breaks it |
|---|---|---|
| `"bin": "index.js"`, `"main": "index.js"` | the source entry point | after `tsc`, the entry is `dist/index.js` |
| `pkg.scripts: ["src/**/*.js"]` | globs the **source** tree | `dist/src/**/*.js` after compilation; a glob that matches nothing means `pkg` embeds no modules and the binary throws at first `require` |
| `pkg.assets` includes `src/templates/**/*`, `swagger.json`, `docs` | source-relative | `rootDir: "."` puts the emit at `dist/index.js` + `dist/src/**`; the asset paths must be re-based or the templates and the API spec vanish from the binary |
| `Dockerfile` runs `npx @yao-pkg/pkg .` on the copied source | no compile step | `tsc -p tsconfig.build.json` has to run first, and the `COPY --from=builder` lines for `src/templates`, `docs` and `public` follow the new layout |

There is also a **second, unmaintained build path**: `build:bun` (`bun build --compile`), which
ADR-038 removes. Leaving it means a TypeScript tree with one build that is maintained and one that
is not, and the unmaintained one is the one nobody notices breaking.

**Definition of Done**
- [x] `npm run build` = `swagger:generate` → `build:dist` (JavaScript **copied**, TypeScript compiled with `tsconfig.build.json` — ADR-087 item 3) → `pkg .` on `bin: dist/index.js`
- [x] `pkg.scripts` re-based on `dist/`; `bin` and `main` repointed. `pkg.assets` stay source-relative: templates, `swagger.json` and `docs/` are not compiled, and the runtime reads them next to the binary (`appPath`)
- [x] `build:bun` removed (the `bun.lock` file itself is ignored by the image build; deleting it is left with A-18)
- [x] `tsx` for `dev` and every script entry; `nodemon` removed (`tsx watch` restarts on a file change too, so the flake's cause is unchanged) (and with it the flake in `make test-browser` that a nodemon restart causes mid-run)
- [x] the backend Dockerfile compiles before packaging; the image boots (record: `2026-09-28-p9-toolchain-and-first-leaves.md`)
- [x] `/health` returns 200 **and its dependency block is correct** on a staging stack (the P9-00 compose stack: `/health` 200 with all three datastores up, `[schema-verify] OK: 72 tables, 867 columns`; no staging host exists) — `services/health.service.js` now checks Redis, RabbitMQ, MQTT and ClamAV as well as the database (A-15), so a 200 from the binary is a stronger statement than it was on 2026-09-21
- [x] the templates, `swagger.json`, `docs/` and `public/` are **verified present inside the container**, by listing them — the missing `public/` COPY shipped a 404 on every `/public` request in every container and was invisible from a source checkout
- [x] **the binary behaves identically**: the P9-00 baseline set still passes against the new image — three runs, each 53/53 specs and 392 tests; run C's per-spec counts equal P9-00's; access log 0 × 429 and the same 2 × `ai/query` 500 (ADR-087 Amendment 5)

**Abuse cases**
- `pkg` succeeds on an empty `scripts` glob and the failure surfaces at runtime, in the container
- The image is declared good because it starts, without checking that the assets are in it

---

### P9-02 — Lint and format: one config each, strict

| | |
|---|---|
| **Status** | **DONE 2026-09-28** — the TypeScript rules (ADR-087 item 6); the legacy config, global `ignores` and the Prettier scope (ADR-092 item 2) |
| **Depends on** | P9-01, **P9-02a** |
| **Spec refs** | ADR-038 · `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` § The Lint Rules · `docs/ENGINEERING/10-TOOLING-LINT-FORMAT.md` |
| **Spec required** | no |
| **Size** | S |

> **What changed:** A-34 found the gate had **never run** and made ESLint execute again on
> 2026-09-23. Both premises this card was written on are still true — `backend/.eslintrc.js` and
> the two Prettier configs are all still present, verified 2026-09-23 — but the card now has a
> hard precondition it did not have: **1,297 errors are behind the gate** (P9-02a). Adding
> `strictTypeChecked` on top of a config that already fails 1,297 times produces a number nobody
> reads.

**Why:** the audit found **two** ESLint configs in `backend/` (legacy `.eslintrc.js`, ignored by ESLint 9, beside `eslint.config.js`) and **two conflicting Prettier configs** (`backend/.prettierrc`: double quotes, width 80; root `.prettierrc.js`: single quotes, width 100). A rule nobody can find is not a rule.

**One more structural defect, found 2026-09-23:** in `backend/eslint.config.js` the `ignores` key
sits in the **same config object** as `rules`. In ESLint 9 flat config, `ignores` beside other keys
scopes *that object* rather than ignoring files globally — so `dist/`, `coverage/` and `build/` are
not globally ignored, and `*.config.js` excludes itself from its own rules. A global ignore needs
its own `{ ignores: [...] }` entry.

**Definition of Done**
- [x] `backend/.eslintrc.js` deleted; `eslint.config.js` is the only config
- [x] `ignores` moved into a config object of its own, and the effect confirmed by listing the files ESLint actually visits (`--debug` or `eslint --print-config`), not by reading the file — `ESLint#isPathIgnored` over every file: before, 474 `dist/` + 6 `coverage/` files visited and `jest.config.js` without the house rules; after, all ignored, `src/` unchanged at 1,206
- [x] `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` with every rule in the standards document as an **error** — `no-explicit-any`, the five `no-unsafe-*`, `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, `no-non-null-assertion`, `ban-ts-comment`, `consistent-type-assertions` (`objectLiteralTypeAssertions: "never"`), `explicit-module-boundary-types`, `consistent-type-imports`, `no-restricted-syntax` on `enum`
- [x] `no-restricted-properties` bans `process.env` outside `src/config/`
- [x] `typescript-eslint` added to `backend/package.json` — it is not installed anywhere in the repository today
- [x] one Prettier configuration governs `backend/`; the conflicting one is deleted or scoped with a written reason — `backend/.prettierrc` (`--find-config-path backend/index.js`); the root `.prettierrc.js` carries a header saying it does not govern `backend/`. Its `singleQuote` against a double-quoted `frontend/` is left to the frontend owner (ADR-092)
- [x] lint covers `.ts` **and** the remaining `.js` (before this, ESLint matched no `.ts` file at all)

**Abuse cases**
- Rules set to `warn` so the build passes
- A blanket `eslint-disable` at the top of a converted file
- The TypeScript rules are added while the 1,297 JavaScript errors are still there, so "lint is red" becomes the normal state and the new rules are invisible inside it

---

### P9-02a — Clear the 1,297 lint errors the gate was hiding

| | |
|---|---|
| **Status** | **DONE except the separate formatting commit (2026-10-02, ADR-087 Am. 30)** — 0 errors, **0 warnings**; `no-unused-vars`, `no-console`, `prefer-arrow-callback` at `error`; record `MEMORY/records/2026-10-02-p9-02a-lint-triage.md` |
| **Depends on** | — (independent of the compiler; do it in parallel with P9-01) |
| **Spec refs** | [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) A-34 · `docs/ENGINEERING/10-TOOLING-LINT-FORMAT.md` |
| **Spec required** | no |
| **Size** | M |

**Why:** A-34 is `partly DONE` — ESLint runs again, and what it reports is a gate that has never
passed. Measured 2026-09-23 with `npx eslint src/ --ext .js -f json`:

```
errors 1297   warnings 340
indent 392 · no-unused-vars 298 · quotes 291 · comma-dangle 259 · curly 239
no-trailing-spaces 86 · no-console 24 · eol-last 17 · unused-disable 12 · …
```

Two things this changes for Phase 9:

1. **`make verify` cannot pass today.** `verify: lint typecheck test build`, and `lint` exits
   non-zero. Every card in this file whose Definition of Done ends "and `make verify` passes" is
   unachievable until this lands. So is P9-04, which wires the ratchet into `make verify`.
2. **Most of it is mechanical, and that is the risk.** `indent`, `quotes`, `comma-dangle`,
   `no-trailing-spaces` and `eol-last` — 1,045 of the 1,297 — are Prettier's job, and a
   `--fix` sweep resolves them. But a formatting sweep across 738 files destroys `git blame` for
   the whole backend in the same week the audit trail of ~90 changed files is what reviewers need.
   It goes in **one** commit, on its own, touching nothing else, and the commit message says so.

The residue is what matters: **298 `no-unused-vars`** is a real signal — unused imports, unused
`catch` bindings, parameters left after a signature changed — and **24 `no-console`** overlaps
exactly with A-42's finding that 25 runtime `console.*` sites write to a stream production
discards. Those two are read, not swept.

**Definition of Done**
- [x] the Prettier-owned rules resolved by a **single** formatting commit, after P9-02 settles which Prettier config governs `backend/` — sweeping to the wrong config means doing it twice — fixed by ESLint's fixers for the nine error-level rules only, 127 files, each AST-identical to `HEAD` (one hand `prefer-const`); **not yet committed: it must be committed alone** (file list in `MEMORY/records/2026-09-28-p9-helper-lint-baseline-coverage.md`)
- [x] the 298 `no-unused-vars` triaged by hand: each is a deletion or a `_`-prefix with a reason, never a rule downgrade — **2026-10-02:** the last 126 (all in tests), by shape; the full suite (860 suites) proves them
- [x] the 24 `no-console` sites cross-checked against A-42; runtime sites move to the winston logger, script sites are exempted explicitly — **2026-10-02:** no runtime site; a reasoned allow-list (scripts/, the e2e harness, the dead checkMenu.util)
- [x] the 12 unused `eslint-disable` directives removed — each one is a claim about a problem that no longer exists
- [x] `npm run lint` exits 0 in `backend/`, and the exit code is recorded in the change record — exit 0, 0 errors, 287 warnings (2026-09-28)
- [x] `no-unused-vars` raised from `warn` to `error` once the count is zero, so it cannot silently return — **2026-10-02**, with `no-console` and `prefer-arrow-callback`

**Abuse cases**
- The formatting sweep is mixed into a conversion PR, and neither can be reviewed
- A rule is downgraded to `warn` instead of the code being fixed — which is how 1,297 accumulated
- `--fix` is run across the residue too, and an unused variable is deleted that was load-bearing

---

### P9-03 — Tests run TypeScript; the gate stays at 100%

| | |
|---|---|
| **Status** | **DONE 2026-09-28** (ADR-087) — babel-jest, not `@swc/jest`; the before/after duration was not measured |
| **Depends on** | P9-01, **P9-03a** |
| **Spec refs** | `docs/ENGINEERING/09-TESTING-CONVENTIONS.md` · `docs/BACKEND/09-TESTING.md` |
| **Spec required** | no |
| **Size** | S |

> **What changed:** `backend/jest.config.js` sets `transform: {}` — transformation is switched off
> explicitly, not merely unconfigured — and `moduleFileExtensions: ["js", "json"]`. `@swc/jest` is
> not installed anywhere in the repository. So this card is four edits, and **one of them makes a
> silent failure possible**: a `.ts` test file that `testMatch` does not match is not a failing
> test, it is an absent one.

**Definition of Done**
- [x] ~~`@swc/jest`~~ **babel-jest + `@babel/preset-typescript`** (ADR-087: SWC's getter exports break `jest.spyOn`) added to `backend/package.json` and wired into `transform` (it is absent today; `transform: {}` currently disables transformation outright)
- [x] `moduleFileExtensions` gains `"ts"`; `testMatch` gains `**/tests/**/*.test.ts` and `**/__tests__/**/*.ts`
- [x] **the match is proved in the failing direction** (`src/tests/p9probe/probe.a087.test.ts` failed, then was deleted): a `.ts` test containing `expect(true).toBe(false)` is observed to fail. A `.ts` test that is never collected reports as nothing at all
- [x] `collectCoverageFrom` includes `.ts` for every layer it already lists — and `jest.e2e.config.js` gets the same transform, or the e2e suite stops running the moment its first spec is converted
- [x] thresholds unchanged at 100%
- [x] one trivial util converted as a canary (`utils/packaged.util.ts`; its test stays `.js` — rule 3, tests unchanged — and it reports 100% as a `.ts` file in the full run), with its test, proving `.ts` source + `.ts` test + coverage work end to end. **`utils/packaged.util.js` is the right canary** — it is a true leaf (see Dependency Reality) and nothing else can be converted without it
- [ ] suite duration recorded before and after; a regression over 25% is investigated, not accepted

**Abuse cases**
- Excluding converted files from coverage "until the migration settles"
- The canary passes because its `.ts` test was never collected

---

### P9-03a — The coverage configuration measures less than it claims

| | |
|---|---|
| **Status** | **DONE 2026-09-28** — items 1–3, 5, 6 by P6-14/A-32 (ADR-085); the models item and the `.ts` hole by ADR-092 item 4 |
| **Depends on** | — |
| **Spec refs** | `docs/BACKEND/09-TESTING.md` · `docs/TESTING/01-UNIT-TESTING.md` · [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) A-32 |
| **Spec required** | no |
| **Size** | S |

**Why:** every card in Stages B–D ends with *"tests converted with the module and still at 100%"*.
That sentence has to mean something before it is repeated seventeen times. Read
`backend/jest.config.js` as it is on 2026-09-23:

| Finding | Consequence |
|---|---|
| `collectCoverageFrom` begins `"src/app.js"` — **there is no `src/app.js`** | the entry point is not measured. The real one is `backend/index.js`: 90 `require()` calls, every router mount, `db.sync()`, the migrator bootstrap and the socket server. **It has no coverage at all**, and no card in this file converts it under a gate |
| `coveragePathIgnorePatterns` excludes `src/config/`, `src/constants/`, `src/models/`, `src/scripts/`, `src/docs/` | "100% across the board" covers six layers: controllers, middlewares, routes, services, utils, validators. **All 72 models are outside it** — so P9-10's "still at 100%" is satisfied by a model file with no test whatsoever |
| 46 `istanbul ignore` directives remain in non-test `src` (A-32 counted 58 before the remediation), **25 of them with no reason**, 14 of those in `migration.service.js` | a converted file that keeps a bare `istanbul ignore next` carries the exclusion into TypeScript, where the compiler might have proved the branch unreachable properly |

None of this is new breakage — it is the gate meaning less than the number suggests, which is A-32's
finding applied to the migration. It is listed here rather than duplicated: the audit card owns the
cleanup, this card owns making the Phase 9 Definition of Done checkable.

**Definition of Done**
- [x] `collectCoverageFrom` names files that exist; the nonexistent `src/app.js` entry is removed (P6-14; pinned by `guards/coverageScope.p614.test.js`, which checks the `.js` patterns — the `.ts` twins are deliberately ahead of the files, ADR-087)
- [x] `backend/index.js` is either measured, or **excluded with a written reason and a named E2E spec that covers its boot path** — an entry point nothing measures is where a conversion breaks invisibly
- [x] the six-layer scope is stated in `docs/BACKEND/09-TESTING.md` wherever "100%" appears, so the figure is not read as the whole backend
- [x] `models/` is either brought into the gate before P9-10, or P9-10's "still at 100%" line is replaced with a check that means something for models — replaced (ADR-092 item 4): models measure 93.5 / 65.58 / 93.17 / 93.39 today; P9-10 is checked by typecheck + a definition-equality check per model + the model guard suites + that figure not falling
- [x] the 25 unexplained `istanbul ignore` directives are resolved under A-32 **before** their files convert — 30 remain, every one with a reason; the A-32 guard now scans `.ts` too (probe proved), ceiling 31 → 30
- [x] a reviewer rule written down: a new `istanbul ignore` is treated like a new `eslint-disable`

**Abuse cases**
- The exclusions are widened so the converted files stay green
- `backend/index.js` is added to `collectCoverageFrom` and the threshold dropped for it alone

---

### P9-04 — The ratchet

| | |
|---|---|
| **Status** | **DONE 2026-09-28** (ADR-087 Amendment 1) — the floor is a list of file names, not a count; the hook is `make hooks` (opt-in), not `npm install` |
| **Depends on** | P9-01, P9-02a (it is wired into `make verify`, which cannot pass until the lint debt clears) |
| **Spec refs** | ADR-038 rule 2 · [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) A-19 |
| **Spec required** | no |
| **Size** | S |

**Why:** without it, "new code is TypeScript" is a sentence in a document — the exact failure the audit found with the non-existent `pre-push` hook.

> **What changed, and it is the point of the card:** between 2026-09-21 and 2026-09-23 the backend
> gained **five new `.js` files** (`middlewares/bodyDefault.middleware.js`,
> `services/health.service.js`, `controllers/health.controller.js`,
> `routes/internal/health.route.js`, `migrations/0019-add-signature-crypto-fields.js`) and lost one
> (`middlewares/sessionSecurity.middleware.js`). **Net +4 in two days**, written by people who had
> read ADR-038. That is not carelessness — it is rule 2 being a sentence with no mechanism, exactly
> as this card predicted. Every further remediation PR raises the floor until it lands.

**Baseline, measured 2026-09-23:** `find backend/src -name '*.js' | wc -l` → **738** (375 source,
363 test). `backend/index.js` sits outside `src` and must be counted separately or it is a
permanent blind spot.

**Definition of Done**
- [x] `scripts/ts-ratchet` counts `.js` under `backend/src` **plus `backend/index.js`** against `backend/.ts-ratchet` and **fails if the count rose**
- [x] ~~the **19 migration files are excluded from the floor, not from the count**~~ **decided otherwise**: migrations are counted and sit in the floor like any file; P9-23 decides how they leave it. The — their names are frozen with the `.js` suffix in `config/migrator.js` (P9-23), so their *filenames* may end up `.ts` while their manifest strings do not. Whichever the decision, a ratchet that can never reach its floor is a ratchet nobody finishes
- [x] `backend/scripts/` (8 documentation generators, outside `src`) is named as in or out, with a reason — **in**: they are JavaScript someone maintains; the backend-root tool files (`jest*.js`, `eslint.config.js`) are out
- [x] when the count falls, the script rewrites the baseline, so the new floor is committed with the conversion
- [x] wired into `make verify` (`ts-ratchet`) **and** into CI (backend-lint job) and the committed pre-push hook (installed by `make hooks`, not by `npm install`) when P7-01 lands — and, until CI exists, into a real `pre-push` hook that is committed and installed by `npm install` (A-19: no hook tooling of any kind exists — no `.husky/`, no `lefthook`, no `core.hooksPath`)
- [x] tested both ways: adding a `.js` file fails (`zzRatchetProbe.a087.js` → exit 1, named); converting one passes and lowers the floor (1208 → 1199 over this pass)

**Abuse cases**
- Raising the baseline by hand in the same PR that adds a `.js` file
- Renaming `.js` to `.ts` with `// @ts-nocheck` at the top
- The hook is documented rather than installed — which is precisely what A-19 found had already happened once

---

### P9-05 — Shared types: Express augmentation, branded ids, state unions

| | |
|---|---|
| **Status** | **STARTED** — **2026-10-02: the state unions DONE** (`@callibrator/contracts/states`, spec `MEMORY/specs/P9-05-shared-types.md`, record `MEMORY/records/2026-10-02-p9-05-state-unions.md`, ADR-087 Am. 30). `backend/src/types/` holds `node-process.d.ts`, `express.d.ts` (`requestId`, `user`, `tenantId`, `apiKeyAuthorized`, the upload fields; `isApiKey` on the principal), `ids.ts` (`TenantId`) and **`apiResponse.ts` (`ApiResponse<T>`)** — each added with the converted module that reads it (ADR-087 Amendments 2, 5). Open: `toTenantId` and the other brands, `tenant`/`validated` on `Request`, the state-machine unions |
| **Depends on** | P9-03 |
| **Spec refs** | `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` §§ branded ids, state machines |
| **Spec required** | **yes** — `MEMORY/specs/P9-05-shared-types.md` |
| **Size** | M |

**Why:** the most dangerous argument swap in this codebase is `tenantId` for `userId` — both UUID strings, both everywhere. A branded `TenantId` makes it a compile error.

**Definition of Done**
- [ ] `src/types/express.d.ts` augments `Request` with `user`, `tenantId`, `tenant`, `requestId`, `validated` — no `as AuthedRequest` casts anywhere
- [ ] branded `TenantId`, `UserId`, `DeviceId`, `CertificateId` (and the rest of the aggregate roots) with a single validating constructor each
- [x] every state machine is a string-literal union exported once: certificate, stock transfer, opname, CAPA, work order, tenant status, webhook delivery — **2026-10-02:** `@callibrator/contracts/states` (+ workflow instance); `stateUnions.p905.guard` holds every model ENUM, schema and object to it
- [ ] `NO_TENANT_UUID` is a `TenantId`, typed as the deny sentinel

**Abuse cases**
- Brands that any `string` can be assigned to

---

### P9-05a — The two infrastructure middlewares, out of Stage D

| | |
|---|---|
| **Status** | **DONE 2026-09-28** (ADR-087 Amendment 2) — all four modules are `.ts`; `tenantContext` passed the orchestrator's four gates (q05 guard both ways, 80-check identity, 39 isolation suites / 1,192 tests, a live PostgreSQL 18.6 two-tenant check as `callibrator_app`, 13/13) |
| **Depends on** | P9-03, P9-05 |
| **Spec refs** | ADR-029 (tenant context) · `docs/BACKEND/05-TENANT-SCOPING.md` · `docs/ENGINEERING/12-LOGGING-CONVENTIONS.md` |
| **Spec required** | no |
| **Size** | S |

**Why:** these two live in `middlewares/`, which P9-19 places in Stage D behind all of Stage C —
and **everything in Stages B and C imports them**, so rule 1 makes Stage B unreachable until they
move. They are not middlewares in the dependency sense; they are the logger and the request
context, filed under the wrong directory.

| File | Imports | Imported by |
|---|---|---|
| `middlewares/tenantContext.middleware.js` | `async_hooks` **only** — a true leaf | `utils/tenantScope.util.js`, `config/socket.js`, and the AsyncLocalStorage every tenant predicate reads |
| `middlewares/activityLog.middleware.js` | `winston`, `winston-daily-rotate-file`, `utils/storagePath.util` | **69 non-test files** |

`utils/packaged.util.js` → `utils/storagePath.util.js` come first, as P9-03's canary.

> **2026-09-28.** Two tests hold the middlewares to their `.js` form, and each needs its own change
> with the conversion: `activityLog.a14.stdout.test.js` spawned plain `node` (fixed — it now uses
> `--import tsx`), and `tenantHierarchy.visibility.q05.test.js` reads `tenantContext.middleware.js`
> **as text**. The tenantContext conversion is written and passed a 13-shape identity comparison; it
> lands only with that guard test updated and a reviewed diff, because it is the root of tenant
> isolation. **Decided 2026-09-28 (ADR-087 Amendment 1, the code wins):** the store keeps holding
> `null` for "no tenant", and `tenantScope.util` keeps mapping it to the deny sentinel — a
> conversion never changes behaviour. The DoD line below is amended accordingly.

**Definition of Done**
- [x] `utils/packaged.util`, `utils/storagePath.util`, `middlewares/tenantContext.middleware` and `middlewares/activityLog.middleware` are `.ts`, with their tests (tests stay `.js`; two changed: a14's child launch, q05's file name)
- [ ] the AsyncLocalStorage store is a **named type** (`TenantContextStore`), and its no-tenant value is typed `TenantId | null` — **amended 2026-09-28 (ADR-087 Amendment 1):** it stays `null`, as built; `tenantScope.util` maps `null` to the branded deny sentinel `NO_TENANT_UUID`. Returning the sentinel from the store would change what every reader of the store sees
- [ ] the logger's exported surface has explicit return types; `logger.error(msg, meta)` types `meta` rather than accepting anything (A-42 turns on routing failures through this logger, so its signature stops being cosmetic)
- [ ] **no behaviour change**: log file names, rotation settings and the `docs/ENGINEERING/12` claims about what reaches stdout are unchanged by this card
- [ ] P9-19's file count drops from 21 to 19, in the same PR

**Abuse cases**
- The store is typed `Record<string, unknown>`, which is the `any` this phase exists to remove
- A "small tidy" to the rotation settings rides along — rule 3

---

### P9-06 — Configuration parsed once, typed everywhere

| | |
|---|---|
| **Status** | IN PROGRESS — **part 1 done 2026-09-29** (ADR-087 Amendment 6): `src/config/env.ts` holds the accessors (`env`, `envOr`, `environment`, `isProduction`), each reproducing the expression it replaced and reading at call time; every converted module reads through them, and the `no-restricted-properties` directives written in Stage B are gone (0 left outside `src/config/`). **Part 2 done 2026-10-02** (ADR-087 Am. 30, record `MEMORY/records/2026-10-02-p9-06-env-schema.md`): `environmentSchema` + `validateEnvironment`, called by `index.ts` after dotenv — exactly the refusals the modules already made, listed together; proved verdict-identical over 158 configurations and boot-identical on PG18 |
| **Depends on** | P9-05 |
| **Spec refs** | `docs/BACKEND/11-CONFIGURATION.md` · ADR-039 |
| **Spec required** | no |
| **Size** | M |

**Why:** `KMS_MASTER_KEY` crash-looped a deployment because no list named it; `docs/BACKEND/11` rule 3 already demands "exit naming **every** missing variable at once, not one per restart". A Zod schema over the environment is that rule made mechanical.

**Definition of Done**
- [ ] `src/config/env.ts`: one Zod schema for every variable in `.env.example`; startup fails listing **all** failures at once — **2026-10-02: the schema covers every variable the boot REQUIRES (17) and fails listing all at once; the optional rest of `.env.example` is not yet in it**
- [ ] cross-field rules from `docs/BACKEND/11` (JWT secrets differ; Stripe key environment matches `NODE_ENV`; production ACME directory) are refinements in that schema
- [x] `DB_DIALECT`: optional, `postgres` only (ADR-039) — in the schema, 2026-10-02
- [ ] no `process.env` read outside `src/config/` (enforced by P9-02) — **true of every converted `.ts` module since 2026-09-29** (part 1); the unconverted `.js` still read it directly and move as they convert
- [ ] `.env.example` and `docs/BACKEND/11` generated from, or checked against, the schema — they cannot drift

**Abuse cases**
- `.optional()` on a required secret to make a local run start

---

### P9-07 — A typed SQL helper that only accepts bind parameters

| | |
|---|---|
| **Status** | **DONE 2026-09-29** (ADR-087 Amendment 12) |
| **Depends on** | P9-06 |
| **Spec refs** | ADR-038 (raw SQL row) · ADR-029 raw-SQL rule · `docs/ENGINEERING/07-DATABASE-ACCESS-STANDARDS.md` |
| **Spec required** | no |
| **Size** | S |

**Why:** `$1` placeholders passed as `replacements` read every tenant's usage as zero in production (fixed 2026-09-21, ADR-039). An options bag typed as "anything" is what let it through.

> **As-built 2026-09-29.** The helper is `src/utils/sql.util.ts`. Its signature is `sql<Row>(runner, text, bind, { transaction })`: the Sequelize instance is **passed in**, not imported. This deviates from `sql(text, bind)`; ADR-087 Amendment 12 records why and what was considered.

**Definition of Done**
- [x] `sql<Row>(runner, text, bind)` accepts positional `bind` only and returns `Row[]`. `replacements` cannot be passed, neither by type nor at run time (a `TypeError`), and a `$n` with no bound value is refused before the database is reached.
- [x] A lint rule bans a direct `.query(` in TypeScript source outside the helper; bite-tested, and the one exemption, the `dbReady` ping, carries its reason. The call sites in converted modules are migrated (`authorizationWiring`, `dbRole`, `schemaVerify`). JavaScript sites (19 calls in 11 files) migrate as their modules convert, under the Stage C DoD line.
- [x] A raw query that touches tenant data must **bind** `tenant_id = $n`, and `rawSqlTenantPredicate.d05` enforces this for every helper call. `sql.p907.test.ts` asserts the bound value. It was proved live on PG 18.6 as `callibrator_app` (`p9/live-p907.js`, 10/10).

**Abuse cases**
- `sql<any>()`: a lint error (`no-explicit-any`, bite-tested). A primitive `Row` is a compile error.

---

## Stage B — Leaf Layers

### P9-08 — `constants/`

| | |
|---|---|
| **Status** | **DONE 2026-09-29** — all 16 files (ADR-087 item 8, Amendments 1 and 5; `routeGateExemptions` last) · **Depends on** P9-05 · **Size** S |
| **Spec refs** | `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` |

> **As-built 2026-09-28.** The directory holds **16** files, not 5. **15 are `.ts`**: `appConstants`,
> `attachmentResources`, `auditActions`, `index`, `platformTenant`, `qmsConstants`,
> `rateLimitConstants`, `roleConstants`, `systemActors`, `tenantAdminSettings`, `tenantConstants`,
> `tenantLogo`, `tenantSecretSettings`, `tenantStatus`, `webhookEvents`. Left: `routeGateExemptions`
> (another agent's uncommitted change; its guard test names the `.js` file in a failure message
> only, so the conversion is safe when the file is clean). `PLATFORM_TENANT_ID` stays a `string`
> until P9-05's `TenantId` lands.

**Definition of Done**
- [x] ~~5~~ 16 files; every constant object `as const`; types derived from values (`typeof ROLE_NAMES[keyof typeof ROLE_NAMES]`), never duplicated by hand
- [x] `ROLE_LEVELS` typed so a role absent from it is a **compile error** (`satisfies Record<keyof typeof ROLE_NAMES, number>`; probed: TS2741) — today it silently resolves to the lowest privilege

---

### P9-09 — `utils/`

| | |
|---|---|
| **Status** | **STARTED** — **30 of 36** `utils/` are `.ts`: 12 leaves (helper 2), `dbReady`, `circuitBreaker`, `tenantScope` (lead), then `otp`, `ssrf`, `fileValidation`, `response`, `controllerWrapper`, `upload` (lead, 2026-09-29, ADR-087 Amendment 5), then `authorizationWiring`, `publicBaseUrl`, `schedulerSwitch`, `jobContext`, `migrationLock`, `jsonShape` (lead, 2026-09-29, ADR-087 Amendment 6) — plus the three path utils under P9-05a. **Left (6), none convertible yet:** `kmsVerify` (P9-18), `jwt` (P9-12), `generateSwagger` (P9-21), `checkMenu`/`session`/`seedMenuGroups` (after P9-10) · **Depends on** P9-08, P9-05a · **Size** M |
| **Spec refs** | `docs/ENGINEERING/06-ERROR-RESPONSE-STANDARDS.md` |

> **As-built 2026-09-28 (helper 2).** `utils/` now holds **34** files, not 20. The true leaves —
> files that require none of `middlewares/activityLog`, `middlewares/tenantContext` or `../models`,
> directly or through another unconverted module — are converted: **`activationToken`, `appError`,
> `auditActor`, `auditRedaction`, `csp`, `dbRole`, `env`, `fileResponse`, `keyring`, `mfaPolicy`,
> `password`, `schemaVerify`** (`.ts`, `.js` removed; identity-checked against `HEAD`, 1,197
> checks, 1,195 identical; the 2 others are `Function.name` only, see the record). Leaves **not**
> converted, and why:
>
> | File | Why it waits |
> |---|---|
> | `fileValidation`, `otp`, `response`, `ssrf`, `migrationLock` | uncommitted lint-debt edits from another agent (curly braces). Convert when clean |
> | `controllerWrapper` | requires `fileValidation` and `response` (rule 1) |
> | `jsonShape` | requires `validators/iot.validator.js` (P9-11) |
> | `jwt` | P9-12 owns it (and waits for A-48); also needs `@types/jsonwebtoken`, which is not installed |
> | `kmsVerify`, `authorizationWiring`, `publicBaseUrl`, `schedulerSwitch`, `jobContext` | require `services/` or one of the two middlewares |

> **What changed:** `utils/` is not one batch. **8 of its 20 files import a layer that this plan
> places after them**, so converting `utils/` as a layer violates rule 1 eight times:
>
> | Group | Files | Order |
> |---|---|---|
> | true leaves, converted under **P9-03**/**P9-05a** | `packaged`, `storagePath` | first — they unblock the logger |
> | require `middlewares/activityLog.middleware` | `circuitBreaker`, `dbReady`, `generateSwagger`, `upload` | after **P9-05a** |
> | requires `middlewares/tenantContext.middleware` | `tenantScope` | after **P9-05a** |
> | require `../models` | `checkMenu`, `session`, and `seedMenuGroups` (which also requires the logger) | **after P9-10**, not before it |
> | the remaining 12 | — | the body of this card |

**Definition of Done**
- [ ] the 20 files split into three PRs by the dependency order above; the three model-dependent utils are explicitly **deferred to after P9-10** and the card says so rather than discovering it mid-branch
- [ ] `ApiResponse<T>` models the envelope (`data` + top-level `meta`) so `data.rows` is unrepresentable — **lands with `response.util`'s conversion** as `src/types/apiResponse.ts` (agreed with the P9 lead 2026-09-28: no speculative types; `response.util` is its only builder and is not yet clean)
- [ ] `AppError` hierarchy typed; `catch (e: unknown)` narrowed with a type guard — **hierarchy typed 2026-09-28** (`utils/appError.util.ts`; `toJSON()` returns the module-local `AppErrorBody`). No converted util contains a `catch`; the narrowing lands with the first one that does (`controllerWrapper`, `upload`…)
- [x] `response.util#paginated` — **dead code** (no callers, and it reads `res.query`) — deleted rather than typed — **already gone**: removed in commit `244b63b` (2026-09-24, "batch 6"). Checked 2026-09-28: `response.util.js` exports `success, error, notFound, badRequest, unauthorized, forbidden, paginate, login, sendResult`; no `paginated(` call exists under `backend/src` (`paginate` is a different, live helper)
- [ ] `asyncHandler`'s behaviour is **preserved** here; its defects (it sends the raw error message before the central handler can sanitise it, then calls `next` anyway) are fixed in AUDIT task A-13, not in this conversion


> **Group (b) — the logger- and context-dependent utils (lead, ADR-087 Amendment 2).**
> `dbReady` and `circuitBreaker` are `.ts` (identity: 15 checks and a 22-step trace; 100%).
> `generateSwagger` waits for `docs/components` and `docs/tags` (JavaScript, P9-21);
> **`upload`, `fileValidation`, `response` (+ `ApiResponse<T>`), `controllerWrapper`, `otp`, `ssrf`
> are `.ts`** (2026-09-29, ADR-087 Amendment 5; 695 + 41 identity checks against the working copy).
> **Left (12):** `authorizationWiring`, `jobContext`, `publicBaseUrl`, `schedulerSwitch` (their
> imports are all TypeScript now — next); `migrationLock` (its live test now launches with
> `--import tsx`); `kmsVerify` (imports services — P9-18); `jwt` (P9-12, A-48); `jsonShape`
> (with `validators/iot.validator` — the ordering gap below); `generateSwagger` (`docs/*`, P9-21);
> `checkMenu`, `session`, `seedMenuGroups` (models — after P9-10);
> **`tenantScope` is `.ts`** (ADR-087 Amendment 4) — after the guard sweep (20 source-scanning
> guards read `.ts`, each proved to bite on a planted `.ts` file), under the four gates:
> the q05 and d05 guards bite on it, 2,810 identity checks, 40 isolation suites (1,196 tests,
> 100%), and a live PostgreSQL 18.6 two-tenant check as `callibrator_app` (18/18, includes and
> hookless statics among them).
>
> **Ordering gap (helper 3, 2026-09-28):** `utils/jsonShape.util` imports
> `validators/iot.validator`, so both must be `.ts` before the first model with a JSON column
> converts (P9-10) — `jsonShape` cannot wait for P9-11 to reach `iot.validator` in order.
> **Closed 2026-09-29** (ADR-087 Amendment 6): both are `.ts`, still Joi (266 identity checks;
> `iot.validator.contract.test.ts` passes unchanged). P9-11 keeps the Joi → Zod move for it.
>
> **Round 6 (lead, 2026-09-29, ADR-087 Amendment 6):** `authorizationWiring`, `publicBaseUrl`,
> `schedulerSwitch` (150 identity checks); `jobContext` under the tenant-isolation gates (the w12
> guards bite on the `.ts`; 141 identity checks; 71 suites / 1,563 tests at 100%; live PostgreSQL
> 18.6 as `callibrator_app`, 15/15: a `runForTenant(A)` job never reads or writes B, and
> `runAsSystem` refuses an unlisted reason); `migrationLock` (21 identity checks; the p803 live
> suite 4/4 on PostgreSQL 18 including "npm run migrate WAITS for a held lock").
> `authorizationWiring` still scans `routes/api/*.route.js` and reads `seedMenuGroups.util.js`
> by name — both must learn `.ts` before P9-21 (routes) and after P9-10 (`seedMenuGroups`).

---

### P9-10 — `models/`

| | |
|---|---|
| **Status** | **DONE 2026-09-29** — **71 of 71 models are `.ts`, and the barrel `models/index.ts`**, in nine domain batches (ADR-087 Amendments 7–11): Kanban (9), inventory (6), workflow/QMS/suppliers (11), billing/usage/notifications/operations (10), calibration/certificates (6), signatures (4), content/tickets/GDPR (8), platform (5), and the tenant-isolation-critical batch (12: `session`, `user`, `tenant`, `role`, `auditLog`, `apiKey`, `tenantKey`, `tenantSettings`, `tenantHierarchy`, `userMenuPermission`, `roleMenuPermission`, `menuGroup`) **in the same merge as the barrel**. Every model and the barrel definition- and behaviour-identical to the JavaScript originals (full-barrel harness: definitions, getters, validators, methods, hooks, barrel keys/order/global hooks). Closing boundary: 701 suites / 13,076 tests / 100%; live PG 18.6 as `callibrator_app` 54/54 + isolation live suites; the converted image boots and the P9-00 E2E baseline passes twice (53 specs, per-spec identical). Records: `MEMORY/records/2026-09-29-p9-10-models-*.md` (four) and `2026-09-29-p9-10-done-barrel.md`. **The spec pattern is amended** (TS2502): module-level row interface + statics interface + explicitly typed factory + `initModel<M, S, Auto>(class extends Model {}, …)` · **spec written** (`MEMORY/specs/P9-10-model-typing-pattern.md`, helper 3) · **Depends on** P9-09, P9-03a, and `jsonShape.util` + `validators/iot.validator` as `.ts` · **Size** XL |
| **Spec refs** | `docs/DATABASE/*` · ADR-038 (models row) · `docs/BACKEND/05-TENANT-SCOPING.md` |
| **Spec required** | **yes** — the association typing pattern, before 72 models copy a wrong one |
| **Spec** | **Written 2026-09-28** — [`MEMORY/specs/P9-10-model-typing-pattern.md`](../MEMORY/specs/P9-10-model-typing-pattern.md): class inside the factory + `export =`; timestamps left to Sequelize via one `initModel()` helper (declaring them in `init` drops `allowNull: false`, probed); defaultScope `where` keeps the COLUMN key `is_deleted` and `includeDeleted` keeps `where: null` (both load-bearing, probed); phantom `DefaultScoped` brand + D-12 rule extended to `.ts`; `jsonShape.util` + `iot.validator` must be `.ts` before the first JSON-column model. Coverage per ADR-092 item 4. Record: `MEMORY/records/2026-09-28-p9-10-p9-11-specs.md` |

> **What changed:** two things the 2026-09-21 card did not account for.
> **(a)** `models/index.js` is a barrel with 78 `require()` calls, imported as `../models` by 118
> service files. A `.ts` service importing a `.js` barrel gets `any` for all 72 models — rule 1
> broken where it costs most — so the 72 models and the barrel are **one merge**, whatever the PR
> split.
> **(b)** `src/models/` is in `coveragePathIgnorePatterns`, so "tests converted and still at 100%"
> is **vacuously true for every model**. P9-03a has to settle what the gate means here first.

> **Follow-up for this card (ADR-087 Amendment 4):** when the models are typed,
> `includeRequired.d12` asserts that the BRANDED default-scoped set equals the runtime set, so a
> model gaining a `defaultScope` without its brand fails (the P9-10 spec asks for this).
> **Done 2026-09-29** (Amendment 7): among the converted `.model.ts` files the branded set equals
> the runtime set (`Stock`, `Warehouse` so far); proved both ways (a stray brand and a removed
> brand each fail it); a brand in a comment does not count.

**Definition of Done**
- [x] 72 models as `Model<InferAttributes<M>, InferCreationAttributes<M>>` with `declare` fields; associations typed — **71 of 71 done** (the card's "72" counted the barrel) (all nine domains); fields live on a module-level interface, not `declare` (Amendments 7–11)
- [x] `models/index.js` converted **in the same merge** as the last model batch; no `.ts` consumer imports a `.js` barrel at any point that reaches `main` — `models/index.ts` (Amendment 11); the interim lint rule (Amendment 7) held it and is retired
- [x] **`sessions` keeps its snake_case attributes and the type says so** — `tenantId` on `Session` becomes a compile error, which is the bug that broke the nightly retention purge — pinned in `modelTypes.p910.test.ts` (where, update, instance: TS2551)
- [x] `tenantScope.util` typed; the deny branch returns `TenantId` (`NO_TENANT_UUID`), not `string` — `NO_TENANT_UUID: TenantId = NO_TENANT_ID` (branded in `src/types/ids.ts`, the same string)
- [x] `defaultScope` models flagged in a type so an include on them without `required: false` is caught by a lint rule — the most repeated defect shape in this codebase — **the brand exists (`DefaultScoped`, `src/types/models.ts`) and D-12 holds it to the runtime set; the rule itself stays the D-12 source test (spec item 6)**; D-12 now asserts all 71 files and the whole 13-model runtime set
- [x] converted in domain batches of ≤ 12 models per PR — batches 1 (9), 2 (6), 3 (11), 4 (10), 5 (6), 6 (4), 7 (8), 8 (5), 9 (12 + the barrel)

**Abuse cases**
- `declare foo: any` on a column "to be typed later"

---

### P9-11 — `validators/`: Joi → Zod, with the contract preserved

| | |
|---|---|
| **Status** | **DONE 2026-09-29** (ADR-093; record [`MEMORY/records/2026-09-29-p9-11-validators-zod.md`](../MEMORY/records/2026-09-29-p9-11-validators-zod.md)) — every validator is Zod `.ts` (39 modules + `fields.ts` + `input.ts`), `validation.middleware` is `.ts`, **`joi` is uninstalled**. The owner lifted the byte-compatible `details` requirement (ADR-093): status, envelope, top-level `message` and details-only-outside-production stay; the wording inside `details` is Zod's, every changed string listed in ADR-093 · **Depends on** P9-10 · **Size** L |
| **Spec refs** | `docs/BACKEND/03-VALIDATION.md` (amended by ADR-093) · `docs/API/00-API-STANDARDS.md` § Validation |
| **Spec required** | **yes** — the error shape Zod must reproduce |
| **Spec** | **Written 2026-09-28** — [`MEMORY/specs/P9-11-validation-error-contract.md`](../MEMORY/specs/P9-11-validation-error-contract.md): five validation-400 surfaces, not one. Open questions 1 (answered by the owner: wording may change), 2 (surface B folded into `validate()`) and 4 (03-VALIDATION amended) are settled by ADR-093; 3 is A-272. Record of the spec: `MEMORY/records/2026-09-28-p9-10-p9-11-specs.md` |

**Why:** a Joi schema's type does not reach the handler, so `req.body` stays unchecked at compile time. A Zod schema is the runtime check **and** the type.

> **Orchestrator decisions, 2026-09-28:** the validation error `details` stay **fully
> byte-compatible** (the spec's recommended option); folding metered billing's own
> `validateBody`/`validateQuery` (surface B) into `validate()` is **deferred to this card's
> conversion itself**, not done before it.
>
> **Owner decision, 2026-09-29 (supersedes the first half above; ADR-093):** replace Joi with Zod in
> every validator in one change and remove `joi`; the wording inside `details` may change; keep the
> status, envelope, top-level message and the production rule. Surface B is folded (done).

**Definition of Done**
- [x] every validator → Zod (37 in the card's count; 40 files as built: 38 converted, `audit` and `webauthn` deleted — they exported only the dropped helper — and `calibrationDeviceReinstate.validator` new); `validate(schema, { from })` merges declared sources with **the path winning**, and writes a typed `req.validated` (`validated(req, schema)`)
- [x] **the 400 response keeps its status, envelope and message format** — asserted by a contract test per validator (`src/tests/contracts/validation`, 39 suites, 45 tests); the `details` wording changed by the owner's decision, listed string by string in ADR-093
- [x] `joi` removed from `package.json` after the last validator moved (`npm uninstall joi --workspace backend`; nothing else imported it; `npm audit` 0)
- [x] the `schema.validate`-passed-to-Express trap is unrepresentable: `validate()` is the only exported way to use a schema as middleware; `schema.parse` as a handler is TS2769 in `.ts` routes and refused in `.js` routes by `tests/guards/schemaAsMiddleware.p911.test.ts` (with a bite test)

**Abuse cases**
- `z.any()` or `.passthrough()` to make a legacy payload validate — none added; the roles menu bodies stay `z.looseObject({})` because they were always an open object (declaring them is its own change)

**Left open, as audit items:** A-272 (surface D drops the field list on the wire), A-273 (three body-wins params merges), A-274 (unused `includeDeleted` scopes).

---

## Stage C — Services, by Domain

One card per domain. Each follows the same Definition of Done, stated once here:

- [ ] every file in the domain is `.ts`; public functions have explicit return types
- [ ] raw SQL uses the P9-07 helper
- [ ] tests converted with the module and still at 100%
- [ ] the P9-00 baseline set still passes against a stack built from the branch
- [ ] every compiler-exposed defect has an AUDIT task id, and **none is fixed in the conversion PR**

| Card | Domain | Services | Size | Depends on |
|---|---|---|---|---|
| **P9-12** | Identity & access | auth, user, role, session, jwt, webauthn, oidc, sso, scim, apiKey | L | P9-11 |
| **P9-13** | Tenancy | tenant, tenantLifecycle, tenantHierarchy, tenantBackup, tenantUpload, customDomains, featureFlag, networkSecurity, dataRetention | L | P9-12 |
| **P9-14** | Calibration core | calibrationDevice, calibrationRecord, certificate, certificatePdf, eSignature, calibrationScheduler, maintenance, predictiveMaintenance, iot | XL | P9-13 |
| **P9-15** | Warehouse | warehouse, stock | M | P9-13 |
| **P9-16** | Quality | qms, capa, sop, risk, vendor, supplierScorecard, workflow | L | P9-14 |
| **P9-17** | Commercial | billing, meteredBilling, stripeWebhook, finance, quota | M | P9-13 |
| **P9-18** | Platform | notification, email, emailQueue, webhook, search, ai, storage/*, attachment, batchJob, rabbitmq, redis, rateLimiter.redis, gdpr, audit, content, kanban, ticket, dashboard, report, kms, **health** | XL | P9-12 |

> **P9-13 CONVERTED (2026-09-30, P9-13 helper; record `MEMORY/records/2026-09-30-p9-13-tenancy.md`; the ADR-087 amendment is with the lead).**
> - **Every module on the card is `.ts`:**
>   - this round: networkSecurity, tenantHierarchy, customDomains, dataRetention, tenantLifecycle, tenant and tenantUpload;
>   - earlier: featureFlag, admin and tenantBackup, from the leaf helper.
> - **Evidence:** each is surface-identical and at 100%, with 570,332 identity checks against the working-copy JavaScript.
> - **tenantHierarchy, tenantLifecycle and tenant** passed the four gates:
>   - (a) 29 planted defects, all caught;
>   - (b) identity;
>   - (c) 127 isolation and referencing suites, 2,458 tests;
>   - (d) a live PostgreSQL 18 two-tenant probe as callibrator_app, 41/41, plus 3 live repository suites, 14/14.
> - **Findings:** A-326 (medium, measured), A-327, A-328 and A-329, recorded and not fixed.
> - **DONE awaits** the full gate on a quiet tree and the P9-00 image baseline.

> **P9-20 / P9-21 lane assignment (2026-09-30, the Phase 9 lead, on the coordinator's instruction that no module sits unowned).** For each module: the controller and route go to `.ts`, the `@swagger` JSDoc moves into `routes/api/<m>.openapi.ts` in the same change (P9-25, ADR-103 item 12), and gates are converted as-is. The P9-21 permission-gate/`public()` helper is not built. The evidence is working-copy identity, a mounted-route-table identity (method, path, middleware names in order), a sampled controller harness, an atomic swap, and `load:check` in both modes. The four gates apply to the isolation-critical modules.
>
> **P9-20 / P9-21 tenancy + identity CONVERTED (2026-10-01, P9-20/21 helper; record `MEMORY/records/2026-10-01-p9-20-21-tenancy-identity.md`; the ADR-087 amendment text is in the record, for the lead to place).**
> - **Controllers (19):** tenant, tenantLifecycle, tenantHierarchy, tenantBackup, customDomains, featureFlag, networkSecurity, dataRetention, admin, auth, user, userPermission, session, ownSessions, webauthn, oidcProvider, sso, scim, apiKey.
> - **Routes (17), each with its `.openapi.ts`:** tenant, tenantLifecycle, tenantHierarchy, tenantBackup, customDomains, featureFlags, networkSecurity, dataRetention, admin, auth, user, userPermissions, session, webauthn, oidc, scim, apiKeys.
> - **Evidence:** route-table and module-text identity 17/17; four gates on the nine isolation-critical routes (17/17 plants, 303 suites, live HTTP on PG18 57/57); A-334 fixed; A-338, A-339 found.
>
> | Lane | Modules |
> |---|---|
> | P9-22 helper (`ae031334c6dbf7c15`) | warehouse, stock, roles, maintenance, qms (+ response schemas in `@callibrator/contracts`); **2026-10-01, released by the services helper on the coordinator's instruction:** vendor, risk, supplierScorecard, finance, billing, meteredBilling (controllers and routes; their services stay as they are) |
> | P9-13 helper (`a7df5efb63840929a`) | tenancy: tenant, tenantLifecycle, tenantHierarchy, tenantBackup, customDomains, featureFlag(s), networkSecurity, dataRetention, admin · identity: auth, user, userPermission(s), session, ownSessions, webauthn, oidcProvider (oidc), sso, scim, apiKey(s) |
> | Leaf helper (`a202e99c71160573c`) | platform: notification(s), webhook(s), search, ai, storage, attachment(s), batchJob(s), gdpr, audit, content, kanban, ticket(s), dashboard, reporting (reports), health, migration, menuGroup(s), iot, predictiveMaintenance (after its service) |
> | Services helper (`acdeaeffc1ddaed5d`) | the P9-14 services first (calibrationDevices, calibrationRecords, calibrationScheduler, certificate, certificatePdf, eSignature, maintenance, predictiveMaintenance), then the controllers and routes for calibrationDevices (+ reinstate), calibrationRecords, calibrationScheduler, certificate(s), certificatePdf, eSignature, quota, sop, workflow(s) (billing, meteredBilling, finance, risk, supplierScorecard and vendor moved to the P9-22 helper on 2026-10-01) |
>
> **Census 2026-10-01 (P9-22 helper, on the coordinator's instruction): every controller and route still `.js` has an owner.** Nothing is left unassigned, so the P9-22 helper takes none.
> - **Services helper:** `eSignature`, `quota`, `sop` and `workflow`, controller and route each.
> - **P9-13 helper (11 routes, no controllers left):** `admin`, `auth`, `networkSecurity`, `oidc`, `scim`, `session`, `tenant`, `tenantBackup`, `tenantHierarchy`, `user`, `webauthn`.
> - **Leaf helper (19 modules):**
>   - Controller and route: `ai`, `attachment`(s), `audit`, `batchJob`(s), `content`, `dashboard`, `gdpr`, `iot`, `kanban`, `menuGroup`(s), `notification`(s), `predictiveMaintenance`, `reporting`/`reports`, `search`, `storage`, `ticket`(s), `webhook`(s).
>   - Under `routes/internal/`: `health` and `migration`.
> - **The whole list (23 controllers, 34 routes):** each one above, and no others.
>
> **Claimed 2026-10-01 by the P9-22 helper (`ae031334c6dbf7c15`), assigned by the coordinator, in this order:**
> 1. **P9-19:** the 13 unblocked middlewares.
>    - `abac`, `auth`, `dynamicAccess`, `enforceQuota`, `bodyDefault`.
>    - The schedulers: `attachmentFileSweepScheduler`, `backup`, `calibrationScheduler`, `quarantineSweepScheduler`, `retentionScheduler`, `sessionCleanup`, `tenantLifecycleScheduler`, `webhookDeliveryPurgeScheduler`.
>    - `auth`, `dynamicAccess` and `abac` under the four gates.
>    - The DoD items A-07 (the slug union) and `bodyDefault`'s object type.
> 2. `src/workers/batchJob.worker.js`.
> 3. The P9-12 lead's five services, released: `redis`, `audit` (four gates, live as `callibrator_app`), `mfa`, `rateLimiter.redis` (the ADR-100 Am. 5 file as baseline) and `emailQueue`.
> 4. Then `auditLog.middleware` (after `audit.service`) and `webhookDeliveryScheduler.middleware` (after the leaf helper's `webhook.service`, if it agrees).
>
> **All four DONE 2026-10-01** (ADR-087 Am. 27, record `MEMORY/records/2026-10-01-p9-19-middlewares-core-services.md`); the claims are released.

> **Claimed 2026-10-01 (round 3) by the P9-22 helper (`ae031334c6dbf7c15`), assigned by the coordinator:**
> 1. **A-340:** remove `rateLimiter.redis.service#revokeTokenByHash` / `revokeAllUserTokens` (dead), as its own change.
> 2. **`auditLog.middleware`:** dead in production; removed with its tests.
> 3. **The last four `.js` services:** `attachment` and `migration` (four gates each), `menuGroup`, `maintenance` (if the services helper is not holding it).
>    Their controllers and routes are in the leaf helper's census (`menuGroup`, `migration`, `attachment`) and stay there.
>
> **All three DONE 2026-10-02** (ADR-087 Am. 29; record `MEMORY/records/2026-10-01-p9-19-middlewares-core-services.md` § Round 3): `src/services/` holds no `.js`; claims released.

> **Round 4 DONE 2026-10-02** (ADR-087 Am. 30; records `2026-10-02-p9-02a-lint-triage.md`, `-p9-05-state-unions.md`, `-p9-06-env-schema.md`): claims released.
> **Claimed 2026-10-02 (round 4) by the P9-22 helper (`ae031334c6dbf7c15`), assigned by the coordinator:** **P9-02a** (the `no-unused-vars` / `no-console` warnings to 0 or a reasoned allow-list; dead code removed only where tests prove it unused), **P9-05** (the state-machine unions from one source, `switch-exhaustiveness-check`; `MEMORY/specs/P9-05-shared-types.md`), **P9-06 part 2** (the Zod environment schema, fail-listing boot, production-only requirements; boot identity on a valid env).

> **Claimed 2026-10-01 by the services helper (`acdeaeffc1ddaed5d`), assigned by the coordinator: P9-21's non-route files, in this order.**
> 1. **utils:** `kmsVerify`, `seedMenuGroups`, `session`. `checkMenu.util.js` is left alone: its deletion awaits the owner (A-18).
> 2. **`src/scripts`** (7 CLIs): `backfillEmbeddings`, `breakGlassMfaReset`, `migrate`, `migrateStorage`, `rotateKeys`, `seedDemo`, `verifySchema` — CLI behaviour, exit codes and output identical, proved by running each with its documented arguments (against a disposable PostgreSQL 18 where it needs one).
> 3. **`backend/scripts/*.js`** (8): the doc/HTML generators and `rotate-default-credentials`. *(2026-10-01: the 7 generators converted; `rotate-default-credentials.js` never loaded and was deleted — A-344.)*
> 4. **`src/config`:** `index`, `migrate`, then `migrator` (the frozen manifest names exact; `manifestNames.p923` green); `socket` only after the leaf helper converts `kanban.service`, minding A-52/A-53.
> 5. **`backend/index.js`** last, with boot identity: `load:check` boot order, a live boot to readiness, and the same mounted route table.
> Not touched: middlewares and the core services (`redis`, `audit`, `mfa`, `rateLimiter`, `emailQueue`) — the P9-22 helper's. Plants in a scratch copy only (ADR-087 Am. 25 rule 6).

> **P9-12 CONVERTED (2026-09-30, ADR-087 Amendments 13–14).**
> - **Every module on the card is `.ts`:** jwt.util and the session, webauthn, userPermission, roles, user, auth, apiKey, sso, scim and oidcProvider services, plus oidcJwks.
> - **Evidence:** each is surface-identical to its JavaScript and at 100%.
> - **Compiler-exposed defects:** A-285/286/287 (fixed, with A-294) and A-295 (open).
> - **DONE awaits** the full gate on a quiet tree and the P9-00 image baseline.
>
> **P9-12 (earlier note) (2026-09-29, ADR-087 Amendment 13).**
> - **Batch 1 done:** `utils/jwt.util`, and the `session`, `webauthn`, `userPermission` and `roles` services, surface-identical and each at 100%.
> - **Next:** `user` and `auth` (batch 2), then `apiKey`, `sso`, `scim` and `oidcProvider` (batch 3, released after A-275/A-278/A-280).
> - **The module pattern every Stage C card follows** (Amendment 13 §2): `export =` of the original object, internal calls through it, load-time destructures kept, and still-JavaScript dependencies through a sibling `.d.ts` guarded by `declarationDrift.p912`.
> - **Compiler-exposed defects:** A-285, A-286, A-287 (recorded, not fixed).

> **Stage C leaf services, ahead of their cards (2026-09-29/30, leaf-services helper; record `MEMORY/records/2026-09-30-p9-stage-c-leaf-services.md`).**
> Converted where every import was already `.ts`, a package, or a `.js` with a sibling `.d.ts`, and no other agent owned the file. Each: `export =` of the original object (key order kept), `.js` deleted, identity against the working-copy `.js` (compiled with TypeScript 7), own suites unchanged and green, each file at 100%, lint 0.
> - **P9-12 area (released by the lead):** `ownSessions`.
> - **P9-13 (part):** `featureFlag`, `admin`, `tenantBackup` (under the four isolation gates, including a live two-tenant restore probe on PostgreSQL 18, 24/24).
> - **P9-14 (part):** `iotDevice`, `iot`.
> - **P9-16 (part):** `sop`.
> - **P9-17 (part):** `quota`.
> - **P9-18 (part):** `storage/signing`, `storage/keys`, `storage/config.service`, `quarantineSweep`, `email`, `reporting` (the card's "report"), `content` (then A-297 as its own change), `contentMedia`, `alert`, `notificationChannels`, `webhookDeliveryPurge`, `jobMonitor`, and in the P9-18 round `kms`, `signingKeyWrap`, `keyRotation` (four gates; its SQL moved to `sql()` first as its own change), `scheduledBackup`, `clamAv`, `virusScan`, `health`, `search` (its SQL moved to `sql()`/bind first, as its own change with a fail-before test), `storage/local.driver` (four gates), `rabbitmq` (released by the lead), `batchJob`, `notification` (with `config/socket.d.ts`; the interim `notification.service.d.ts` retired), `gdpr` (four gates; A-333 fixed by removal), `storage/s3.driver` (gates a to c; d blocked because no MinIO image was available), `storage/index`, `storageSettings`, `storageMigration`, `attachmentFileSweep` (four gates), `predictiveMaintenance`, `dashboard`, `ai` (SQL move first; four gates), `webhook` (claim SQL move first; four gates), `ticket` (counter SQL move first; four gates), `kanban` (card_seq SQL move first; four gates; three access guards pinned by a new test). P9-18 controllers and routes with code-first `.openapi.ts`: ai, attachments, audit, batchJobs, content, dashboard, gdpr, iot, kanban, menuGroups, notifications, predictiveMaintenance, reports, search, storage, tickets, webhooks, and internal health and migration (controller harness, mounted route table and module text identical, each bitten; live 47/47 over HTTP on PostgreSQL 18 with two tenants; `openapi.json` now 448/448 code-first; A-342 and A-343 recorded).
> - **Not converted, with the reason:** `redis`, `audit`, `mfa`, `rateLimiter.redis`, `emailQueue` (P9-12 lead's `.d.ts` dependencies — ask first); every file another agent had modified.
> - **Next:** `predictiveMaintenance` and `tenantUpload` once their other agent is done.

> **NEEDS EDIT (2026-09-23) — the services layer moved under this table.**
>
> | Card | What changed |
> |---|---|
> | count | **77 service files** (71 top-level + 6 under `storage/`), not 76 |
> | **P9-18** | `services/health.service.js` is **new** (A-15). It requires `amqplib`, `../config`, `redis.service`, `iot.service` and `clamAv.service` — a fan-in wider than anything else in Platform, so it converts **last** in P9-18, not first |
> | **P9-12** | `services/scim.service.js` was substantially rewritten (A-33) and has **four findings still open against it** — A-37 (cross-tenant existence oracle), A-38, A-39, A-49. Converting it while those are open means converting it twice. **Wave-0 A-37 goes first** |
> | **P9-12** | `utils/jwt.util.js` was rewritten (A-31), and A-48 will change the request path again: session revocation needs a `sessions` read per request. **P9-12 must not start before A-48 is decided**, because the fix changes the shape of the authenticated principal this card types |
> | **P9-14** | `services/eSignature.service.js` was rewritten under **ADR-040** — RSA signing over a canonical payload. Its key material is the only tenant secret still wrapped with `ENCRYPT_KEY` directly, and moving it under `kms.service.js` is an **open question** in `MEMORY/DECISIONS.md`. A conversion that lands before that decision types a shape that is about to change |
> | **P9-18** | `services/rabbitmq.service.js` (A-36) and `services/rateLimiter.redis.service.js` (A-30) were rewritten. A-30 removed the 12 unexplained `istanbul ignore` directives the audit counted there — that layer is now genuinely covered, and the conversion can rely on its tests |
> | **P9-18** | `services/webhook.service.js` has **A-51 open** (no validator on any of the seven routes; caller-supplied plaintext signing secret). It is now carried as **P6-13**. Convert after it |
>
> **The pattern:** five of the seven Stage C cards have an open audit finding inside them, and
> ADR-038 rule 3 forbids fixing one during a conversion. The waves are not advisory — they are what
> keeps a conversion PR reviewable.

**P9-14 is the domain core** (`CLAUDE.md`: "if a change threatens anything here, it needs an ADR before it needs a branch"). Its state machines must use the P9-05 unions with `switch-exhaustiveness-check`, so adding a certificate state fails compilation everywhere it is not handled.

---

## Stage D — The HTTP Layer

### P9-19 — `middlewares/`

| | |
|---|---|
| **Status** | **CONVERTED (2026-10-01)** — all 25 in scope are `.ts`; `src/middlewares/` holds no `.js` (round 1: `MEMORY/records/2026-09-29-p9-19-middlewares-round1.md`; round 2: `MEMORY/records/2026-10-01-p9-19-middlewares-core-services.md`, ADR-087 Am. 27). DONE waits on the full gate on a quiet tree · **Depends on** Stage C, P9-05a · **Size** M |

> **Round 1 (2026-09-29, P9-19 helper):** the directory now holds 28 middlewares: 3 were already
> `.ts` (`activityLog`, `tenantContext` under P9-05a; `validation` under P9-11), which leaves
> **25 in this card**, not 19. Newer files — `requestTimeout`, `enforceQuota`, `validateUuid`,
> `metricsAuth` and nine schedulers — joined after the count below was written.
>
> - **Converted, each `.js` deleted after `cmp` against a snapshot of the working copy:** `notFound`,
>   `validateUuid`, `requestTimeout`, `globalSanitizer`, `accessLog`, `createFolder`,
>   `errorHandlers`. The security-critical three went through the four `tenantContext` gates:
>   `metricsAuth`, `rbac` and `denyPlatformAuthoring`.
> - **Blocked, each by a JavaScript import it cannot yet take:**
>   - `auth` needs `services/auth`, `tenant` and `apiKey`.
>   - `dynamicAccess` needs `services/apiKey`; the UI-correctness agent is also editing it.
>   - `abac` needs `services/tenant`.
>   - `enforceQuota` needs `services/quota`.
>   - All nine schedulers need `services/jobMonitor`: `attachmentFileSweep`, `backup`,
>     `calibration`, `quarantineSweep`, `retention`, `sessionCleanup`, `tenantLifecycle`,
>     `webhookDelivery` and `webhookDeliveryPurge`. Most also need their own service.
> - **Held back:**
>   - `bodyDefault` carries another agent's uncommitted change.
>   - `auditLog` waits for A-41, as the card below says.
>
> **Round 2 (2026-10-01, P9-22 helper, ADR-087 Am. 27):** the other 15 converted once their services were TypeScript: `auth`,
> `dynamicAccess` and `abac` under the four gates (live HTTP 17/17 on PG18), `enforceQuota`, `bodyDefault`,
> `auditLog` (A-41 is DONE) and the nine schedulers, `webhookDeliveryScheduler` last, with the leaf helper's
> agreement. Identity 0 different in every module, every module at 100%. Record: `MEMORY/records/2026-10-01-p9-19-middlewares-core-services.md`.
>
> **What changed (2026-09-23):** the directory still holds 21 files, but not the same 21.
> `sessionSecurity.middleware.js` was **deleted** and `bodyDefault.middleware.js` **added**; and
> P9-05a takes `tenantContext` and `activityLog` out of this card into Stage A, because everything
> in Stages B and C imports them. **19 files remain here.**

**Definition of Done**
- [x] **25** files typed against the P9-05 `Request` augmentation. The count was 19; round 1 above explains why it is now 25. **25 of 25 done** (10 in round 1, 15 in round 2). The augmentation gained `impersonatorId` and `role.roleLevel` / `role_level` for `denyPlatformAuthoring` and `rbac`, added by the P9-12 lead on request
- [x] Security-critical middlewares converted under the four `tenantContext` gates, evidence in the round-1 record:
  - (a) the watching suites bite on the `.ts`;
  - (b) identity checks over request shapes and roles;
  - (c) the authz and isolation suites;
  - (d) a live stack.
  - The gates found that no test pinned rbac's "lowest listed level" rule. `tests/middlewares/rbac.lowestBar.p919.test.ts` now does, and it bites on a planted `Math.max`
- [x] `sessionSecurity.middleware.js` is not in scope: **deleted 2026-09-23** under AUDIT task A-12 as dead code (imported by nothing; its SQL targeted a nonexistent `"Sessions"` table). Nothing to convert
- [x] `bodyDefault.middleware.js` (**new 2026-09-23**, A-09) converted with it — **done 2026-10-01:** an assertion signature, `asserts req is DefaultedBodyRequest` (body never `undefined`), pinned at compile time by `bodyDefault.type.p919.test.ts`. It exists because Express 5 leaves `req.body` **undefined** where Express 4 gave `{}`. Under `@types/express` 5 that is `unknown`, so the middleware's guarantee — *every downstream handler sees an object* — is the thing the type system should be told, not a runtime fact the types contradict. Typing it as `Request["body"]` narrowing is the point of the file
- [x] **Done 2026-10-01:** `menuGroup: SeededMenuSlug | readonly SeededMenuSlug[]` (`constants/seededMenuSlugs.ts`, the 63 seeded slugs, pinned equal to the seed by `seededMenuSlugs.p919.test.ts`). `dynamicAccess` resource names typed as the menu-slug union, so `dynamicAccess("AuditLogs", …)` — a slug that does not exist — is a compile error (see AUDIT A-07, still open and still **unverified**: its first checkbox is the verification, and this card cannot type the union until someone has enumerated it)
- [x] **Converted 2026-10-01**, after A-41 was DONE and after `audit.service`. It has no production caller (only tests load it); deleting it is not decided here. `auditLog.middleware.js` is **not** converted before A-41 is decided (P6-11). Its `res.on("finish")` registration is the defect; typing it first preserves the shape the fix removes

### P9-20 — `controllers/`

| | |
|---|---|
| **Status** | **IN PROGRESS (2026-10-01)** — warehouse, stock, roles, maintenance and qms controllers converted (P9-22 helper, ADR-097 Am. 3; identity per module); other lanes convert the rest · **Depends on** P9-19 · **Size** L |

> **What changed:** **57** controllers, not 56 — `health.controller.js` is new (A-15).

**Definition of Done**
- [ ] 57 controllers as `RequestHandler<Params, ApiResponse<T>, Body, Query>`; body and query come from `req.validated`, never raw `req.body`
- [ ] `req.body?.x` guards disappear because the typed body makes the undefined-body case explicit (the class of bug behind the 2026-09 `menu-groups` 500)
- [ ] `health.controller.js` included; its response shape is the one A-06 deliberately narrowed (no Node version, pid or memory to an unauthenticated caller), and the type is what stops that widening again

### P9-21 — `routes/`, `index.js`, socket, workers, scripts

| | |
|---|---|
| **Status** | **IN PROGRESS (2026-10-01)** — warehouse, stock, roles, maintenance and qms routes converted, each with its code-first `.openapi.ts` (ADR-097 Am. 3); vendor, risk, supplierScorecard, finance, billing and meteredBilling likewise (ADR-097 Am. 5); the A-58 gate scan reads `.ts` routes and the dist emit; the route helper (permission gate or `public()`) is NOT built yet · **Depends on** P9-20 · **Size** M |

> **What changed, and one of these is a wrong file path:**
> **(a)** **55** route files, not 54 — and they are not flat. `routes/api/` holds 53,
> `routes/internal/` holds 2 (`migration.route.js` and the new `health.route.js`). The
> `internal/` subtree did not exist in the 2026-09-21 card.
> **(b)** **the entry point is `backend/index.js`, not `src/index.js`.** It is outside `src`, which
> means it is outside the ratchet's default scope (P9-04), outside `collectCoverageFrom`
> (P9-03a), and outside every count in the Inventory table until it is named explicitly.
> **(c)** `config/socket.js` was substantially rewritten under A-05 and now requires
> `services/auth.service` and `services/kanban.service` — it is a Stage D file with Stage C
> dependencies, and A-52 (the `purpose` claim read nowhere) and A-53 (a reconnected socket never
> re-joins its rooms) are both open against it.

**Definition of Done**
- [ ] **55** route files — `routes/api/` (53) and `routes/internal/` (2) — with a route helper that **requires** a permission gate argument (or an explicit `public()` marker), P6-04 made structural rather than a lint check
- [ ] the `public()` marker's exemption list is the **same list** P6-04 documents, not a second one
- [ ] `backend/index.js` → `backend/index.ts`, named explicitly in the ratchet and the coverage config
- [ ] `config/socket.js` and `workers/batchJob.worker.js` typed; A-52 and A-53 fixed **before** this card, not inside it
- [ ] `src/scripts/` (4) and `src/docs/` (3, the swagger JSDoc source) converted or explicitly deferred with a reason
- [ ] `pkg` still produces a working binary and the Docker image boots — verified against P9-01b's re-based asset paths, not the old ones

---

## Stage E — Contracts and Close-Out

### P9-22 — `packages/contracts`: one schema, both ends

| | |
|---|---|
| **Status** | **IN PROGRESS** — the workspace and its build are done, and the **first slice** (`fields`, `vendor`, `calibrationDevices`) moved on 2026-09-29 (**ADR-097**, record [`2026-09-29-p9-22-contracts.md`](../MEMORY/records/2026-09-29-p9-22-contracts.md)). Proven so far: both images build from the root, the backend binary boots (schema OK), `dist` resolves the compiled package, `next build` bundles value imports, and the vendors + calibration-devices E2E pass (16/16). **The full E2E set against this change has not had a clean run** (degraded Docker host; see the record) · **Depends on** P9-11 (DONE) · **Size** L |
| **Spec refs** | ADR-038 (shared contracts row) · ADR-087 decision 7 · ADR-044 / ADR-046 · `docs/FRONTEND/03-API-CLIENT.md` |
| **Spec required** | **yes** — the design is **ADR-097** (below, in short) |
| **Open** | **Q-48**: `packages/contracts` (ADR-038/087, as built) vs ADR-089's planned `shared/contracts`. Not settled here; consumers import by package name, so a move changes no import. **Settled 2026-10-08 by ADR-134 (plan): `packages/contracts` stays; no root `shared/`** |

**Why:** the frontend's API types are hand-written, and an earlier audit found services calling endpoints that did not exist while their tests mocked the fabrication. A shared Zod schema makes a contract break a compile error in `frontend/`. (It did, on the first compile: the vendor create call sent a `rating` the API has always stripped. That is Q-37.)

**The design (ADR-097)**

| | |
|---|---|
| Layout | `packages/contracts/src/<domain>.ts`: request schemas plus `z.input` (client) and `z.output` (handler) types. `src/fields.ts` holds the shared field schemas, and `src/index.ts` is a barrel of **named** re-exports. A module imports only `zod` and its siblings, with no Node, DOM or environment (lint + `types: []`) |
| Resolution | the package **ships TypeScript source** (`exports` → `./src/*.ts`). Both typechecks, backend jest, tsx and Next all read it, so there is no package `dist/` to go stale |
| Release build | `backend/scripts/build-dist.ts` step 4 compiles it (TypeScript 7, CJS) into `backend/dist/node_modules/@callibrator/contracts`. `node dist/index.js` and pkg find that before the workspace symlink |
| Backend | the validators **re-export the same schema objects under the same names**, as named re-exports (never `export *`, whose interop branches break the 100% gate) |
| Frontend | the service request types are `z.input` of the contract. Response types are still hand-written. `transpilePackages` in `next.config.ts` |
| One Zod | the package declares `zod ^4.6.5`, the backend's range. `test/package.test.ts` asserts that the package, backend and frontend resolve one `zod` file |
| Workspaces | root `workspaces` already had `packages/*`, and npm is authoritative (ADR-044). `pnpm-workspace.yaml` now lists it too, so the two agree; deleting it is still G-09 |
| Images | both Dockerfiles copy the package manifest before `npm ci` and its source before the build, and both allow-lists re-include `packages/contracts` |
| Gates | the package's own `lint` / `typecheck` / `test` (100%, from the repository-root `rootDir`, because backend jest cannot instrument outside `backend/`), wired into `make lint`, `make typecheck`, `make test` and CI's backend-lint job |

**Definition of Done**
- [x] a `packages/contracts` workspace (the `packages/*` glob finally matches something) exporting request ~~and response~~ schemas — **request schemas for the first slice; response schemas are the next step** (below)
- [ ] backend validators import from it; frontend `api/services/*` infer types from it — **40 of 42 validator modules** (all but `networkSecurity` and `admin`, which stay backend-only on purpose: ADR-097 Am. 2) plus `fields`, and the envelope and three constant sets are canonical here (ADR-097 Am. 1). **Frontend (the coordinator ruled 2026-10-01, ADR-097 Am. 1 → ADR-103 item 11):** a service's canonical request types are the generated OpenAPI `paths` types once its route is code-first. `z.input` was the interim form (8 services); since 2026-10-02 none is left — every service is on the generated types (P9-25 item 11)
- [ ] hand-written duplicates in `frontend/src/types` deleted as each service moves — the slice's duplicates lived in the service files (`VendorCreateInput`, `VendorUpdateInput`, `VendorQualifyInput`, `DeviceCreateInput`, `DeviceUpdateInput`, the status/type unions) and are replaced; `frontend/src/types/index.ts` held none of them

**Plan for the remaining domains** (one PR per domain or small group, in this order: the frontend services that already exist first, then the rest)
1. For each domain, move `validators/<domain>.validator.ts`'s schemas to `packages/contracts/src/<domain>.ts` with named re-exports in the backend (the same objects under the same names). Add the domain's validator test to the package's `jest.config.js` `testMatch`, then run the contract suite, `enumMirrors.d26` and `swaggerValidatorAlignment.p608`.
2. ~~Replace the matching frontend service's request interfaces with `z.input` types~~ — **superseded 2026-10-01 (ADR-097 Am. 1):** the frontend moves to ADR-103's generated `paths` types when the route goes code-first (P9-25 with P9-20/P9-21), and those are generated from these same schemas. Record each drift found as an Open Question, never as a silent backend change.
3. Order: `warehouse`, `stock`, `maintenance`, `calibrationRecords`, `certificate`, `qms`, `tenant`, `user`, `roles`, `menuGroup`, `content`, `ticket`, `kanban`, `notification`, `webhook`, `workflow`, then the platform and identity domains (`auth`, `sso`, `scim`, `oidc`, `session`, `billing`, `meteredBilling`, `storage`, `customDomains`, `networkSecurity`, `featureFlag`, `dataRetention`, `gdpr`, `tenantHierarchy`, `tenantLifecycle`, `tenantBackup`, `eSignature`, `iot`, `finance`, `admin`, `calibrationDeviceReinstate`).
4. **Response schemas** after the request side. **The envelope is done** (`envelope.ts`, the single definition, shared with P9-25's OpenAPI document). They start with the envelope (`{ success, status, message, data, meta }`, CLAUDE.md), which ADR-087 decision 7 placed in `backend/src/types/` as `ApiResponse<T>`. A cross-workspace envelope belongs here instead, which needs an ADR-087 amendment first. Each service's `Backend*Response` interface then becomes `z.infer` of a response schema, which would pin shapes such as the device list's `data.rows` fallback.

### P9-23 — Migrations: convert the files, freeze the names

| | |
|---|---|
| **Status** | **DONE 2026-09-30** (ADR-087 amendment, `MEMORY/records/2026-09-30-p9-23-migrations.md`) · **Depends on** P9-21 (did not wait: the migrations import only leaves, and four keep typed lazy/top-level `require`s of JavaScript services) · **Size** S |
| **Spec refs** | `docs/DATABASE/13-MIGRATIONS.md` · `backend/src/migrations/README.md` |

> **What changed (2026-09-30):** the frozen set is **63** migrations, not 19 — 0001…0090 as they
> stood when conversion began (the manifest had grown since 2026-09-23). The list lives, typed by
> hand, in `backend/src/tests/migrations/manifestNames.p923.test.ts`; it equals the first 63
> `schema_migrations` rows of a PostgreSQL 18 database migrated by the JavaScript migrations. The
> 19-name list this card used to carry is its first 19 entries. Migrations 0091+ were written
> TypeScript-first by other lanes, with `.js` names, and are outside the frozen list but inside
> its rules.

**Why:** `schema_migrations` records names **with the `.js` suffix** (`0001-underscore-class-models.js`, verified on the reference deployment), and `src/config/migrator.js` registers them from a static manifest — one `require()` per file, because Umzug's glob resolver finds nothing inside a `pkg`-compiled binary. Change a name string and Umzug treats the migration as new — and runs it again against production.

**How it was done:** the manifest was not touched (two comments only). Its names end `.js` and its `require`s are extensionless, so tsx and jest resolve the `.ts` source and `dist/` the compiled `.js`. Each file was converted with type-only changes, plus a short list of runtime-neutral ones (`module.exports` → `export =` with the same object; in-function `require("sequelize")` → top-level import; `process.env.X` → `env("X")`), and proved identical — see the record.

**Definition of Done**
- [x] migration files may become `.ts`, but **every manifest name string stays exactly as recorded**, `.js` suffix included — including `0019` (all 63 are `.ts`; `migrator.js` names unchanged)
- [x] a test asserts the manifest names equal a frozen list of the historical names, in order — **63**, not 19 (`manifestNames.p923.test.ts`, 5 tests, via Umzug's own `migrations()`)
- [x] the test is written **before** any file in `src/migrations/` is renamed, and is seen to fail when a name is altered (dropping `.js` from 0019's name: 2 of 5 failed; the file was restored byte-identical)
- [x] the `context` passed to Umzug stays the **QueryInterface itself**, not `{ queryInterface }` (asserted by the same test and by `0019-signature-crypto-fields.d29.test.ts`; the 16 frozen `context.queryInterface || context` fallbacks kept literally)
- [x] new migrations are TypeScript from the start; their recorded name is fixed when first applied and never changes (0091–0102 are `.ts` with `.js` names; README and `migrator.js` say so)
- [x] dialect guards inside applied migrations are left alone (ADR-039)
- [x] P6-05's column verification runs against the result — fresh and upgraded PostgreSQL 18 databases booted through `runSchemaSetup` + `assertSchemaMatchesModels`: OK, 73 tables / 905 columns / 10 control objects; `pg_dump --schema-only` and grants identical to a database built by the `.js` migrations

**Abuse cases**
- "Tidying" the manifest names to drop `.js`
- The frozen list is generated **from** `migrator.js`, which proves the file equals itself and nothing else (`00-TASK-CONVENTIONS.md` § Evidence)

### P9-24 — Close-out

| | |
|---|---|
| **Status** | TODO · **Depends on** everything above · **Size** S |
| **Scope amended 2026-09-30** | **ADR-109 §5** (working decision under the owner's delegation, awaiting the owner's confirmation), amending ADR-087's exit. **Phase 9 exits when every non-test backend source module is TypeScript and the build/source config has `allowJs: false`.** The existing `.js` **test** files (696 under `src/tests/` and `__tests__/` on 2026-09-30, 684 of them `*.test.js`; a moving count) are **not** part of this exit — they move to **P9-26**. The ratchet **stays** and still refuses any **new** `.js` file, tests included |

**Definition of Done**
- [ ] ~~ratchet at zero; `allowJs: false`; the ratchet script and baseline removed~~ *(superseded by ADR-109 §5)*
- [ ] *(2026-10-02: one left — `utils/checkMenu.util.js`, dead, its deletion awaiting the owner's OK (A-18); `noSourceJs.p924.guard` pins it)* **no non-test `.js` file** under `backend/` in the ratchet's counted set (`index.js`, `src/**` outside `src/tests/`, `scripts/**`); the ratchet list holds test files only
- [x] *(2026-10-02, P9-21 helper: the reason is written beside the flag in `backend/tsconfig.json`; `noSourceJs.p924.guard.test.ts` fails on a non-test `.js` outside its PENDING list, now only `utils/checkMenu.util.js`)* `allowJs: false` for **source**: `tsconfig.build.json` already has it (ADR-087 item 3); the base `tsconfig.json` keeps `allowJs` **only** so `typecheck` can resolve `.js` tests importing `.ts` source — the reason is written beside the flag, and a guard fails if a non-test `.js` file appears
- [x] *(kept: `npm run ratchet` holds 695 `.js` files — the 694 legacy test-tree files and `checkMenu.util.js` — shrink-only)* the ratchet script and baseline **kept** (they are what makes P9-26 shrink-only), not removed
- [x] unused dependencies removed: `joi`, `aedes`, `aedes-server-factory`, `nodemon`, the Bun build path (A-18) *(2026-10-02, P9-21 helper: none is declared, locked or installed; `build:bun` already gone; the stray `backend/bun.lock` deleted; `npm audit` 0. The frontend's opt-in `next-bun-compile` binary is a product path (PRD N7), not unused, and is **kept by decision** (main session, 2026-10-02). Record `2026-10-01-p9-21-non-route-files.md`)*
- [x] *(2026-10-02, P9-21 helper: `docs/BACKEND/00`–`11`, `ARCHITECTURE/03`, `ENGINEERING` README, 00, 01, 04, 05 (its as-built notes rewritten to the TypeScript/Zod code, and the route/validator/SQL templates corrected to what mounts), `00-TASK-CONVENTIONS` § Build. Each banner now states the as-built TypeScript, the one remaining source `.js`, and the 694 legacy `.js` test-tree files (P9-26). In the same documents, 230 `.js` file references were renamed to the `.ts` module that exists (tests, migration names, `dist/index.js`, `checkMenu.util.js` left). `CLAUDE.md`, `AGENTS.md` and the root README are the main session's, at close)* the target-vs-current banner removed from every backend document, each checked against the code as it is removed
- [ ] `CLAUDE.md`, `AGENTS.md`, `docs/ENGINEERING/00-CODING-CONTEXT.md` state TypeScript as **fact**
- [x] *(2026-10-02: the four named places cite no ADR-030; five more live documents corrected — see the P9-21 record)* the four places that still describe the backend as untypeable are corrected — **they cite ADR-030, which ADR-038 superseded**: the root `tsconfig.json` comment, the `Makefile: typecheck` target comment, `00-TASK-CONVENTIONS.md` § Build, and `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`'s target banner. Three of the four are corrected earlier, under P9-01 and P9-01a; this is the sweep that confirms none was missed
- [ ] `CLAUDE.md`'s counts are re-derived rather than copied: it says **53 route modules** and **342 test files**; the tree on 2026-09-23 has **55** route files and **366** test files
- [ ] ADR-038 gets a completion note; `MEMORY/records/P9-24.md` written

### P9-26 — The existing `.js` test files, converted opportunistically

| | |
|---|---|
| **Status** | TODO — created 2026-09-30 by **ADR-109 §5** (working decision, awaiting the owner's confirmation) · **Depends on** nothing (a test may convert whenever its module has) · **Size** XL, spread thin · **Not** a Phase 9 exit item |

**Why:** P9-24 as first written counted the 693–696 existing `.js` test files, which made the phase
exit weeks of conversion that changes no production behaviour. The source is what runs; a `.js`
test that exercises a `.ts` module still proves the module. The tests move out of the exit, not out
of the plan.

**Rules**
- The ratchet stays on: **no new `.js` file, tests included** (ADR-087 Amendment 1). A new test is `.ts`.
- A `.js` test is converted when someone **already edits it** for another reason, or when its module's conversion needs it; never as a drive-by that also changes assertions. A conversion of a test changes no assertion (the P9 identity rule applied to tests: same case names, same count, same pass/fail).
- Each conversion lowers the ratchet floor in the same change.

**Definition of Done**
- [ ] the ratchet list is empty — every test is `.ts`
- [ ] then, and only then, the base `tsconfig.json` drops `allowJs`, and the ratchet script and baseline are removed
- [ ] `MEMORY/records/P9-26.md` names the final counts from a run

### P9-25 — API contract, code-first: one schema, the published contract, behind sign-in

| | |
|---|---|
| **Status** | **WIP** — foundation DONE 2026-09-30 (ADR-103); per-route migration rides with P9-20/P9-21 · **Depends on** P9-11 (Zod validators), P9-22 (contracts) · **Size** L |
| **Spec refs** | `MEMORY/specs/P9-25-owner-brief-api-contract.md` (binding) · `MEMORY/specs/P9-25-api-contract-code-first.md` · `docs/API/00-API-STANDARDS.md` · `docs/BACKEND/03-VALIDATION.md` · ADR-103 |
| **Spec required** | **yes** (written) |

**Why:** every request shape was written twice — a Zod validator that runs, and uncompiled `@swagger` YAML that does not. P6-08 kept finding the two apart. The contract was published unauthenticated wherever mounted, a broken YAML block silently removed its route from it, and nothing failed when a route had no document at all.

**Definition of Done — foundation (done)**
- [x] ADR (decision, alternatives, bad implications), spec, this card; `docs/API/00`, `docs/BACKEND/03/04/06/09/10`, `docs/ENGINEERING/10` amended citing ADR-103
- [x] `zod-openapi` builder: per-route `*.openapi.ts` (`defineRouteDocs`), envelope + standard errors, `x-permission` / `x-audited` / `x-rate-limit` / tenant-404 / 409 notes, merged with the remaining JSDoc (3.0 → 3.1), double documentation and broken YAML refused
- [x] pilot `vendor` end to end: JSDoc deleted, `vendor.openapi.ts`, P6-08 green with **no** vendor `KNOWN_DRIFT` entry
- [x] Scalar at `/docs` and `/api/v1/docs` (+ `/docs.json`), self-hosted, own CSP, `auth → denyApiKey → rbac([TENANT_ADMIN])`; `SWAGGER_ENABLED` semantics recorded; Dockerfile ships `openapi.json` + the bundle; pkg assets updated
- [x] committed `backend/openapi.json`; `openapi:check` in build, image, `make openapi` (in `verify`) and CI; Spectral ruleset + shrink-only baseline; oasdiff script + checksum-pinned CI step; route-without-doc guard with a shrink-only list
- [x] frontend: `openapi-typescript` + `openapi-fetch`, `src/api/typed.ts` over `api.*`, `vendor.service` migrated, `api:types:check` in CI and `make`

**Definition of Done — the card (open)**
- [ ] every route module moved to `*.openapi.ts` as P9-20/P9-21 convert it; JSDoc, `docs/components.js`, `docs/tags.js` and `swagger-jsdoc` removed with the last one
- [ ] `openapiRoutes.undocumented.json`, P6-08's `KNOWN_DRIFT` and `openapi.spectral-baseline.json` are empty
- [x] frontend `api/services/*` on `typedApi`, module by module, each with tests — **all 54 services, 2026-10-02** (item 11): 53 send their JSON calls through `typedApi` with the contract's types; `health` takes its types from `paths` and stays on `api` for `validateStatus`. What stays on `api`, by design: multipart uploads, blob/text downloads, and the Next-owned auth routes (`login`, `logout`, `logout-all`, `refresh`, `passkey/verify`), whose answer is the Next route's. No service imports a `z.input` type any more (the 8 interim ones moved). Contract fixes doc-only; real mismatches A-349…A-363. Record: `MEMORY/records/2026-09-30-p9-stage-c-leaf-services.md` § P9-25 item 11
- [ ] oasdiff has run in CI against a `main` that has an `openapi.json` (P7-01)
- [ ] a live check of `/api/v1/docs` through the frontend proxy as a signed-in tenant admin, in a browser

**Abuse cases**
- A route moved to `.openapi.ts` whose `body` is a hand-written copy instead of the validator's own schema object — the contract is generated, but from a second source
- `x-permission` "fixed" by editing the guard's expectation instead of the declaration or the chain
- A new undocumented route, a new Spectral error or a P6-08 divergence made green by adding it to the shrink-only list
- `openapi.json` edited by hand, or regenerated without committing the frontend types
- `openapi:breaking` reported as passing when it printed SKIPPED (no oasdiff, no base)
- The docs gate loosened (public, or any authenticated role) "so the page loads in the browser" — the browser path is `/api/v1/docs` through the proxy
- Scalar loaded from a CDN, or the CSP widened to let it call out

---

## Order at a Glance

Redrawn 2026-09-23. The tooling cards are on the critical path, and **P9-02a is on it twice** —
`make verify` cannot pass while 1,297 lint errors stand, and P9-04 wires the ratchet into
`make verify`.

```
AUDIT wave 0 (7 open: A-13 A-32 A-37 A-41 A-42 A-48 A-51)
     │
     ├──▶ P9-02a  clear 1,297 lint errors ──┐      (independent of the compiler;
     ├──▶ P9-03a  fix the coverage config ──┤       start both immediately)
     │                                      │
     └──▶ P9-00  behaviour baseline         │
             │                              │
             ▼                              │
          P9-01  tsconfig                   │
             ├──▶ P9-01a  typecheck script ─┤
             ├──▶ P9-01b  tsc → dist → pkg  │
             ├──▶ P9-02   lint rules ◀──────┤
             ├──▶ P9-03   jest TS  ◀────────┘
             └──▶ P9-04   the ratchet ◀── P9-02a (make verify must pass)

P9-03 ──▶ P9-05 ──▶ P9-05a (packaged · storagePath · tenantContext · activityLog)
                       └──▶ P9-06 ──▶ P9-07
P9-07 ──▶ P9-08 ──▶ P9-09(a,b) ──▶ P9-10 ──▶ P9-09(c) the 3 model-dependent utils
                                      └──▶ P9-11 ──┬──▶ P9-12 ──▶ P9-13 ──┬──▶ P9-14 ──▶ P9-16
                                                    │                       ├──▶ P9-15
                                                    │                       └──▶ P9-17
                                                    │        P9-12 ──▶ P9-18
                                                    └──▶ P9-22
Stage C ──▶ P9-19 ──▶ P9-20 ──▶ P9-21 ──▶ P9-23 ──▶ P9-24
```

**Nothing in Stage B may start before P9-04.** Not because the ratchet types anything, but because
four `.js` files were added in the two days after ADR-038 was accepted, and a floor that rises
faster than the conversions lower it is a migration that never ends.

## What Would Make This Phase Fail

| Failure | Its signature |
|---|---|
| strictness eroded under deadline | `warn` instead of `error`; `skipLibCheck` hiding a real conflict; `any` behind `unknown as` |
| behaviour changed silently | a baseline E2E spec starts failing and the conversion PR is where it happened |
| the dual state never ends | the ratchet flat for weeks; new `.js` justified as "just a small script" |
| documents claiming it finished early | a backend document without its banner while its module is still `.js` — PR-4 again |
| **a gate that reports green having run nothing** | added 2026-09-23. It has now happened twice here: A-34 (lint crashed on a version mismatch and the failure looked like success) and the `typecheck` chain in P9-01a (turbo skips a package with no such script, and exits 0). **Every gate in this phase is proved in the failing direction before it is trusted** — break the thing, watch the right gate fail |
| **the plan drifting from the tree** | added 2026-09-23. This file was two days old and already wrong about the count of routes, controllers, services, migrations and middlewares, and about which files existed. The Inventory is re-derived from the tree at the start of each stage, not carried forward |
