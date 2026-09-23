# Phase 9 — Backend TypeScript Migration

**Status: 🔴 NOT STARTED.** Decided in [ADR-038](../MEMORY/DECISIONS.md) (2026-09-21), superseding ADR-030.

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
| `migrations/` | **19** | 18 | E — **names frozen**, see P9-23 |
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
| **Status** | TODO — **NEEDS EDIT (2026-09-23)** |
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
- [ ] the **53** E2E specs (`src/tests/e2e/*.test.js`, counted 2026-09-23 — the Makefile's "51" is stale) run against a fresh stack; the passing set is recorded by spec name in `MEMORY/records/P9-00.md`
- [ ] every failing spec has a one-line reason (known defect with an audit task id, flake, environment)
- [ ] the run command and stack commit are recorded, so the baseline can be reproduced
- [ ] the SCIM e2e spec that **cannot pass** (A-49) is named as such, not counted as a failure to be fixed later

**Abuse cases**
- Recording a baseline from a run where failing specs were skipped rather than failed
- Taking the baseline *after* the first conversion

---

### P9-01 — The compiler: `backend/tsconfig.json`

| | |
|---|---|
| **Status** | TODO — **NEEDS EDIT (2026-09-23)**, split |
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
- [ ] `backend/tsconfig.json` with every flag in the standards document (`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noImplicitOverride` + `noImplicitReturns` + `noFallthroughCasesInSwitch` + `noPropertyAccessFromIndexSignature` + `noUnusedLocals` + `noUnusedParameters` + `isolatedModules` + `forceConsistentCasingInFileNames`), `allowJs: true`, `checkJs: false`, `module: Node16`, `moduleResolution: Node16`, `target: ES2023`, `outDir: dist`, `rootDir: "."`
- [ ] `verbatimModuleSyntax` **off** — it is incompatible with the CommonJS emit ADR-038 requires. If a future editor turns it on, the build breaks silently in `pkg`, not in `tsc`
- [ ] `skipLibCheck: true` is the **only** relaxation, and a comment says it covers third-party `.d.ts` and never our code
- [ ] `tsconfig.build.json` extends it and excludes `src/tests/**` and `__tests__/**`
- [ ] the root `tsconfig.json` comment corrected: it cites a superseded ADR
- [ ] `typescript`, `@types/node`, `@types/express` (v5) pinned **in `backend/package.json`**, not inherited from the frontend's hoist

**Abuse cases**
- Starting with `strict: false` "for now"
- Adding `skipLibCheck` to hide a real type conflict rather than as the documented default
- Declaring the card done because `tsc` exits 0 on a tree with zero `.ts` files — with `include`
  unset and no `.ts` files, `tsc` exits 0 on **any** configuration, including an empty one

---

### P9-01a — A backend `typecheck` that runs, and a `verify` that fails without it

| | |
|---|---|
| **Status** | TODO — **new 2026-09-23** |
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
- [ ] `backend/package.json` gains `"typecheck": "tsc -p tsconfig.json --noEmit"`
- [ ] `turbo run typecheck` is observed to **run it** — recorded by a run whose output names `backend`, not by reading `turbo.json`
- [ ] the Makefile comment on the `typecheck` target corrected (it cites ADR-030)
- [ ] **tested in the failing direction**: a deliberate type error in a `.ts` file makes `make verify` exit non-zero. A gate never seen to fail is not known to work
- [ ] `00-TASK-CONVENTIONS.md` § Build updated once the backend is in the task

**Abuse cases**
- The script is added and never observed to run, because turbo's skip is silent
- `--noEmit` is dropped, so `typecheck` writes `dist/` as a side effect and a stale `dist` is shipped

---

### P9-01b — The binary build: `tsc` → `dist` → `pkg`, and the image

| | |
|---|---|
| **Status** | TODO — **new 2026-09-23** (split out of P9-01) |
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
- [ ] `npm run build` = `swagger:generate` → `tsc -p tsconfig.build.json` → `pkg dist/index.js`
- [ ] `pkg.scripts` and `pkg.assets` re-based on `dist/`; `bin` and `main` repointed
- [ ] `build:bun` and the `bun.lock` build path removed
- [ ] `tsx` for `dev` and every script entry; `nodemon` removed (and with it the flake in `make test-browser` that a nodemon restart causes mid-run)
- [ ] the backend Dockerfile compiles before packaging; the image boots
- [ ] `/health` returns 200 **and its dependency block is correct** on a staging stack — `services/health.service.js` now checks Redis, RabbitMQ, MQTT and ClamAV as well as the database (A-15), so a 200 from the binary is a stronger statement than it was on 2026-09-21
- [ ] the templates, `swagger.json`, `docs/` and `public/` are **verified present inside the container**, by listing them — the missing `public/` COPY shipped a 404 on every `/public` request in every container and was invisible from a source checkout
- [ ] **the binary behaves identically**: the P9-00 baseline set still passes against the new image

**Abuse cases**
- `pkg` succeeds on an empty `scripts` glob and the failure surfaces at runtime, in the container
- The image is declared good because it starts, without checking that the assets are in it

---

### P9-02 — Lint and format: one config each, strict

| | |
|---|---|
| **Status** | TODO — **NEEDS EDIT (2026-09-23)** |
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
- [ ] `backend/.eslintrc.js` deleted; `eslint.config.js` is the only config
- [ ] `ignores` moved into a config object of its own, and the effect confirmed by listing the files ESLint actually visits (`--debug` or `eslint --print-config`), not by reading the file
- [ ] `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` with every rule in the standards document as an **error** — `no-explicit-any`, the five `no-unsafe-*`, `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`, `no-non-null-assertion`, `ban-ts-comment`, `consistent-type-assertions` (`objectLiteralTypeAssertions: "never"`), `explicit-module-boundary-types`, `consistent-type-imports`, `no-restricted-syntax` on `enum`
- [ ] `no-restricted-properties` bans `process.env` outside `src/config/`
- [ ] `typescript-eslint` added to `backend/package.json` — it is not installed anywhere in the repository today
- [ ] one Prettier configuration governs `backend/`; the conflicting one is deleted or scoped with a written reason
- [ ] lint covers `.ts` **and** the remaining `.js`

**Abuse cases**
- Rules set to `warn` so the build passes
- A blanket `eslint-disable` at the top of a converted file
- The TypeScript rules are added while the 1,297 JavaScript errors are still there, so "lint is red" becomes the normal state and the new rules are invisible inside it

---

### P9-02a — Clear the 1,297 lint errors the gate was hiding

| | |
|---|---|
| **Status** | TODO — **new 2026-09-23** |
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
- [ ] the Prettier-owned rules resolved by a **single** formatting commit, after P9-02 settles which Prettier config governs `backend/` — sweeping to the wrong config means doing it twice
- [ ] the 298 `no-unused-vars` triaged by hand: each is a deletion or a `_`-prefix with a reason, never a rule downgrade
- [ ] the 24 `no-console` sites cross-checked against A-42; runtime sites move to the winston logger, script sites are exempted explicitly
- [ ] the 12 unused `eslint-disable` directives removed — each one is a claim about a problem that no longer exists
- [ ] `npm run lint` exits 0 in `backend/`, and the exit code is recorded in the change record
- [ ] `no-unused-vars` raised from `warn` to `error` once the count is zero, so it cannot silently return

**Abuse cases**
- The formatting sweep is mixed into a conversion PR, and neither can be reviewed
- A rule is downgraded to `warn` instead of the code being fixed — which is how 1,297 accumulated
- `--fix` is run across the residue too, and an unused variable is deleted that was load-bearing

---

### P9-03 — Tests run TypeScript; the gate stays at 100%

| | |
|---|---|
| **Status** | TODO — **NEEDS EDIT (2026-09-23)** |
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
- [ ] `@swc/jest` added to `backend/package.json` and wired into `transform` (it is absent today; `transform: {}` currently disables transformation outright)
- [ ] `moduleFileExtensions` gains `"ts"`; `testMatch` gains `**/tests/**/*.test.ts` and `**/__tests__/**/*.ts`
- [ ] **the match is proved in the failing direction**: a `.ts` test containing `expect(true).toBe(false)` is observed to fail. A `.ts` test that is never collected reports as nothing at all
- [ ] `collectCoverageFrom` includes `.ts` for every layer it already lists — and `jest.e2e.config.js` gets the same transform, or the e2e suite stops running the moment its first spec is converted
- [ ] thresholds unchanged at 100%
- [ ] one trivial util converted as a canary, with its test, proving `.ts` source + `.ts` test + coverage work end to end. **`utils/packaged.util.js` is the right canary** — it is a true leaf (see Dependency Reality) and nothing else can be converted without it
- [ ] suite duration recorded before and after; a regression over 25% is investigated, not accepted

**Abuse cases**
- Excluding converted files from coverage "until the migration settles"
- The canary passes because its `.ts` test was never collected

---

### P9-03a — The coverage configuration measures less than it claims

| | |
|---|---|
| **Status** | TODO — **new 2026-09-23** |
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
- [ ] `collectCoverageFrom` names files that exist; the nonexistent `src/app.js` entry is removed
- [ ] `backend/index.js` is either measured, or **excluded with a written reason and a named E2E spec that covers its boot path** — an entry point nothing measures is where a conversion breaks invisibly
- [ ] the six-layer scope is stated in `docs/BACKEND/09-TESTING.md` wherever "100%" appears, so the figure is not read as the whole backend
- [ ] `models/` is either brought into the gate before P9-10, or P9-10's "still at 100%" line is replaced with a check that means something for models
- [ ] the 25 unexplained `istanbul ignore` directives are resolved under A-32 **before** their files convert
- [ ] a reviewer rule written down: a new `istanbul ignore` is treated like a new `eslint-disable`

**Abuse cases**
- The exclusions are widened so the converted files stay green
- `backend/index.js` is added to `collectCoverageFrom` and the threshold dropped for it alone

---

### P9-04 — The ratchet

| | |
|---|---|
| **Status** | TODO — **NEEDS EDIT (2026-09-23)**, and it is now the most urgent card in Stage A |
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
- [ ] `scripts/ts-ratchet` counts `.js` under `backend/src` **plus `backend/index.js`** against `backend/.ts-ratchet` and **fails if the count rose**
- [ ] the **19 migration files are excluded from the floor, not from the count** — their names are frozen with the `.js` suffix in `config/migrator.js` (P9-23), so their *filenames* may end up `.ts` while their manifest strings do not. Whichever the decision, a ratchet that can never reach its floor is a ratchet nobody finishes
- [ ] `backend/scripts/` (8 documentation generators, outside `src`) is named as in or out, with a reason. Today it is neither
- [ ] when the count falls, the script rewrites the baseline, so the new floor is committed with the conversion
- [ ] wired into `make verify` **and** into CI when P7-01 lands — and, until CI exists, into a real `pre-push` hook that is committed and installed by `npm install` (A-19: no hook tooling of any kind exists — no `.husky/`, no `lefthook`, no `core.hooksPath`)
- [ ] tested both ways: adding a `.js` file fails; converting one passes and lowers the floor

**Abuse cases**
- Raising the baseline by hand in the same PR that adds a `.js` file
- Renaming `.js` to `.ts` with `// @ts-nocheck` at the top
- The hook is documented rather than installed — which is precisely what A-19 found had already happened once

---

### P9-05 — Shared types: Express augmentation, branded ids, state unions

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P9-03 |
| **Spec refs** | `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` §§ branded ids, state machines |
| **Spec required** | **yes** — `MEMORY/specs/P9-05-shared-types.md` |
| **Size** | M |

**Why:** the most dangerous argument swap in this codebase is `tenantId` for `userId` — both UUID strings, both everywhere. A branded `TenantId` makes it a compile error.

**Definition of Done**
- [ ] `src/types/express.d.ts` augments `Request` with `user`, `tenantId`, `tenant`, `requestId`, `validated` — no `as AuthedRequest` casts anywhere
- [ ] branded `TenantId`, `UserId`, `DeviceId`, `CertificateId` (and the rest of the aggregate roots) with a single validating constructor each
- [ ] every state machine is a string-literal union exported once: certificate, stock transfer, opname, CAPA, work order, tenant status, webhook delivery
- [ ] `NO_TENANT_UUID` is a `TenantId`, typed as the deny sentinel

**Abuse cases**
- Brands that any `string` can be assigned to

---

### P9-05a — The two infrastructure middlewares, out of Stage D

| | |
|---|---|
| **Status** | TODO — **new 2026-09-23** |
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

**Definition of Done**
- [ ] `utils/packaged.util`, `utils/storagePath.util`, `middlewares/tenantContext.middleware` and `middlewares/activityLog.middleware` are `.ts`, with their tests
- [ ] the AsyncLocalStorage store is a **named type**, and the no-tenant branch returns the branded `NO_TENANT_UUID` from P9-05 — not `string | undefined`, which is what makes a missing context look like a valid one
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
| **Status** | TODO |
| **Depends on** | P9-05 |
| **Spec refs** | `docs/BACKEND/11-CONFIGURATION.md` · ADR-039 |
| **Spec required** | no |
| **Size** | M |

**Why:** `KMS_MASTER_KEY` crash-looped a deployment because no list named it; `docs/BACKEND/11` rule 3 already demands "exit naming **every** missing variable at once, not one per restart". A Zod schema over the environment is that rule made mechanical.

**Definition of Done**
- [ ] `src/config/env.ts`: one Zod schema for every variable in `.env.example`; startup fails listing **all** failures at once
- [ ] cross-field rules from `docs/BACKEND/11` (JWT secrets differ; Stripe key environment matches `NODE_ENV`; production ACME directory) are refinements in that schema
- [ ] `DB_DIALECT`: optional, `postgres` only (ADR-039)
- [ ] no `process.env` read outside `src/config/` (enforced by P9-02)
- [ ] `.env.example` and `docs/BACKEND/11` generated from, or checked against, the schema — they cannot drift

**Abuse cases**
- `.optional()` on a required secret to make a local run start

---

### P9-07 — A typed SQL helper that only accepts bind parameters

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P9-06 |
| **Spec refs** | ADR-038 (raw SQL row) · ADR-029 raw-SQL rule · `docs/ENGINEERING/07-DATABASE-ACCESS-STANDARDS.md` |
| **Spec required** | no |
| **Size** | S |

**Why:** `$1` placeholders passed as `replacements` read every tenant's usage as zero in production (fixed 2026-09-21, ADR-039). An options bag typed as "anything" is what let it through.

**Definition of Done**
- [ ] `sql<Row>(text, bind)` accepts positional `bind` only and returns `Row[]`; `replacements` cannot be passed
- [ ] every existing `db.query` call site migrated to it as its module converts; a lint rule bans `db.query` outside the helper
- [ ] each raw query that touches tenant data carries `tenant_id = $n` explicitly; a test asserts the bound value

**Abuse cases**
- `sql<any>()`

---

## Stage B — Leaf Layers

### P9-08 — `constants/`

| | |
|---|---|
| **Status** | TODO · **Depends on** P9-05 · **Size** S |
| **Spec refs** | `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` |

**Definition of Done**
- [ ] 5 files; every constant object `as const`; types derived from values (`typeof ROLE_NAMES[keyof typeof ROLE_NAMES]`), never duplicated by hand
- [ ] `ROLE_LEVELS` typed so a role absent from it is a **compile error** — today it silently resolves to the lowest privilege

---

### P9-09 — `utils/`

| | |
|---|---|
| **Status** | TODO — **NEEDS EDIT (2026-09-23)** · **Depends on** P9-08, P9-05a · **Size** M |
| **Spec refs** | `docs/ENGINEERING/06-ERROR-RESPONSE-STANDARDS.md` |

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
- [ ] `ApiResponse<T>` models the envelope (`data` + top-level `meta`) so `data.rows` is unrepresentable
- [ ] `AppError` hierarchy typed; `catch (e: unknown)` narrowed with a type guard
- [ ] `response.util#paginated` — **dead code** (no callers, and it reads `res.query`) — deleted rather than typed
- [ ] `asyncHandler`'s behaviour is **preserved** here; its defects (it sends the raw error message before the central handler can sanitise it, then calls `next` anyway) are fixed in AUDIT task A-13, not in this conversion

---

### P9-10 — `models/`

| | |
|---|---|
| **Status** | TODO — **NEEDS EDIT (2026-09-23)** · **Depends on** P9-09, P9-03a · **Size** XL |
| **Spec refs** | `docs/DATABASE/*` · ADR-038 (models row) · `docs/BACKEND/05-TENANT-SCOPING.md` |
| **Spec required** | **yes** — the association typing pattern, before 72 models copy a wrong one |

> **What changed:** two things the 2026-09-21 card did not account for.
> **(a)** `models/index.js` is a barrel with 78 `require()` calls, imported as `../models` by 118
> service files. A `.ts` service importing a `.js` barrel gets `any` for all 72 models — rule 1
> broken where it costs most — so the 72 models and the barrel are **one merge**, whatever the PR
> split.
> **(b)** `src/models/` is in `coveragePathIgnorePatterns`, so "tests converted and still at 100%"
> is **vacuously true for every model**. P9-03a has to settle what the gate means here first.

**Definition of Done**
- [ ] 72 models as `Model<InferAttributes<M>, InferCreationAttributes<M>>` with `declare` fields; associations typed
- [ ] `models/index.js` converted **in the same merge** as the last model batch; no `.ts` consumer imports a `.js` barrel at any point that reaches `main`
- [ ] **`sessions` keeps its snake_case attributes and the type says so** — `tenantId` on `Session` becomes a compile error, which is the bug that broke the nightly retention purge
- [ ] `tenantScope.util` typed; the deny branch returns `TenantId` (`NO_TENANT_UUID`), not `string`
- [ ] `defaultScope` models flagged in a type so an include on them without `required: false` is caught by a lint rule — the most repeated defect shape in this codebase
- [ ] converted in domain batches of ≤ 12 models per PR

**Abuse cases**
- `declare foo: any` on a column "to be typed later"

---

### P9-11 — `validators/`: Joi → Zod, with the contract preserved

| | |
|---|---|
| **Status** | TODO · **Depends on** P9-10 · **Size** L |
| **Spec refs** | `docs/BACKEND/03-VALIDATION.md` · `docs/API/00-API-STANDARDS.md` § Validation |
| **Spec required** | **yes** — the error shape Zod must reproduce |

**Why:** a Joi schema's type does not reach the handler, so `req.body` stays unchecked at compile time. A Zod schema is the runtime check **and** the type.

**Definition of Done**
- [ ] 37 validators → Zod; `validate(schema)` merges `{ ...req.params, ...req.body }` (the trap that 400ed every request on several routes) and writes a typed `req.validated`
- [ ] **the 400 response is byte-compatible**: same status, same envelope, same message format — asserted by a contract test per validator, since the frontend parses it
- [ ] `joi` removed from `package.json` only after the last validator moves
- [ ] the `schema.validate`-passed-to-Express trap becomes unrepresentable: `validate()` is the only exported way to use a schema as middleware

**Abuse cases**
- `z.any()` or `.passthrough()` to make a legacy payload validate

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
| **Status** | TODO — **NEEDS EDIT (2026-09-23)** · **Depends on** Stage C, P9-05a · **Size** M |

> **What changed:** the directory still holds 21 files, but not the same 21.
> `sessionSecurity.middleware.js` was **deleted** and `bodyDefault.middleware.js` **added**; and
> P9-05a takes `tenantContext` and `activityLog` out of this card into Stage A, because everything
> in Stages B and C imports them. **19 files remain here.**

**Definition of Done**
- [ ] **19** files typed against the P9-05 `Request` augmentation (21 in the directory, minus the two moved to P9-05a)
- [x] `sessionSecurity.middleware.js` is not in scope: **deleted 2026-09-23** under AUDIT task A-12 as dead code (imported by nothing; its SQL targeted a nonexistent `"Sessions"` table). Nothing to convert
- [ ] `bodyDefault.middleware.js` (**new 2026-09-23**, A-09) converted with it. It exists because Express 5 leaves `req.body` **undefined** where Express 4 gave `{}`. Under `@types/express` 5 that is `unknown`, so the middleware's guarantee — *every downstream handler sees an object* — is the thing the type system should be told, not a runtime fact the types contradict. Typing it as `Request["body"]` narrowing is the point of the file
- [ ] `dynamicAccess` resource names typed as the menu-slug union, so `dynamicAccess("AuditLogs", …)` — a slug that does not exist — is a compile error (see AUDIT A-07, still open and still **unverified**: its first checkbox is the verification, and this card cannot type the union until someone has enumerated it)
- [ ] `auditLog.middleware.js` is **not** converted before A-41 is decided (P6-11). Its `res.on("finish")` registration is the defect; typing it first preserves the shape the fix removes

### P9-20 — `controllers/`

| | |
|---|---|
| **Status** | TODO — **NEEDS EDIT (2026-09-23)** · **Depends on** P9-19 · **Size** L |

> **What changed:** **57** controllers, not 56 — `health.controller.js` is new (A-15).

**Definition of Done**
- [ ] 57 controllers as `RequestHandler<Params, ApiResponse<T>, Body, Query>`; body and query come from `req.validated`, never raw `req.body`
- [ ] `req.body?.x` guards disappear because the typed body makes the undefined-body case explicit (the class of bug behind the 2026-09 `menu-groups` 500)
- [ ] `health.controller.js` included; its response shape is the one A-06 deliberately narrowed (no Node version, pid or memory to an unauthenticated caller), and the type is what stops that widening again

### P9-21 — `routes/`, `index.js`, socket, workers, scripts

| | |
|---|---|
| **Status** | TODO — **NEEDS EDIT (2026-09-23)** · **Depends on** P9-20 · **Size** M |

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
| **Status** | TODO · **Depends on** P9-11 · **Size** L |
| **Spec refs** | ADR-038 (shared contracts row) · `docs/FRONTEND/03-API-CLIENT.md` |
| **Spec required** | **yes** |

**Why:** the frontend's API types are hand-written, and an earlier audit found services calling endpoints that did not exist while their tests mocked the fabrication. A shared Zod schema makes a contract break a compile error in `frontend/`.

**Definition of Done**
- [ ] a `packages/contracts` workspace (the `packages/*` glob finally matches something) exporting request and response schemas
- [ ] backend validators import from it; frontend `api/services/*` infer types from it
- [ ] hand-written duplicates in `frontend/src/types` deleted as each service moves

### P9-23 — Migrations: convert the files, freeze the names

| | |
|---|---|
| **Status** | TODO — **NEEDS EDIT (2026-09-23)** · **Depends on** P9-21 · **Size** S |
| **Spec refs** | `docs/DATABASE/13-MIGRATIONS.md` |

> **What changed:** **nineteen** migrations, not eighteen.
> `0019-add-signature-crypto-fields.js` was added on 2026-09-23 under A-47 / ADR-040, and its
> manifest entry in `src/config/migrator.js` already carries the frozen `.js` suffix. The frozen
> list below is the current one and must be copied into the test verbatim.

**Why:** `schema_migrations` records names **with the `.js` suffix** (`0001-underscore-class-models.js`, verified on the reference deployment), and `src/config/migrator.js` registers them from a static manifest — one `require()` per file, because Umzug's glob resolver finds nothing inside a `pkg`-compiled binary. Change a name string and Umzug treats all **19** as new — and runs them again against production.

**The frozen names**, read from `src/config/migrator.js` on 2026-09-23. Every one ends `.js`:

```
0001-underscore-class-models.js        0011-add-esignature-records.js
0002-add-stripe-invoice-id.js          0012-enable-rls-policies.js
0003-add-search-vectors.js             0013-add-tenant-parent-id.js
0004-add-mfa-fields.js                 0014-add-user-webauthn-fields.js
0005-add-batch-jobs.js                 0015-drop-rls-policies.js
0006-add-capas.js                      0016-add-attachment-storage-key.js
0007-add-sop-documents.js              0017-add-signature-workflows.js
0008-extend-vendors-qualification.js   0018-add-document-chunks.js
0009-add-uncertainty-budgets.js        0019-add-signature-crypto-fields.js
0010-add-iot-fields.js
```

**Definition of Done**
- [ ] migration files may become `.ts`, but **every manifest name string stays exactly as recorded**, `.js` suffix included — including `0019`
- [ ] a test asserts the manifest names equal a frozen list of the **19** historical names, in order
- [ ] the test is written **before** any file in `src/migrations/` is renamed, and is seen to fail when a name is altered. A frozen-list test added afterwards freezes whatever is there, including a mistake
- [ ] the `context` passed to Umzug stays the **QueryInterface itself**, not `{ queryInterface }`. Wrapping it is what made 0008, 0013 and 0014 record as applied with their columns absent, and a conversion is exactly the kind of change that would "tidy" it back
- [ ] new migrations are TypeScript from the start; their recorded name is fixed when first applied and never changes
- [ ] dialect guards inside applied migrations are left alone (ADR-039)
- [ ] P6-05's column verification runs against the result — the migration log is not evidence

**Abuse cases**
- "Tidying" the manifest names to drop `.js`
- The frozen list is generated **from** `migrator.js`, which proves the file equals itself and nothing else (`00-TASK-CONVENTIONS.md` § Evidence)

### P9-24 — Close-out

| | |
|---|---|
| **Status** | TODO · **Depends on** everything above · **Size** S |

**Definition of Done**
- [ ] ratchet at zero; `allowJs: false`; the ratchet script and baseline removed
- [ ] unused dependencies removed: `joi`, `aedes`, `aedes-server-factory`, `nodemon`, the Bun build path (A-18)
- [ ] the target-vs-current banner removed from every backend document, each checked against the code as it is removed
- [ ] `CLAUDE.md`, `AGENTS.md`, `docs/ENGINEERING/00-CODING-CONTEXT.md` state TypeScript as **fact**
- [ ] the four places that still describe the backend as untypeable are corrected — **they cite ADR-030, which ADR-038 superseded**: the root `tsconfig.json` comment, the `Makefile: typecheck` target comment, `00-TASK-CONVENTIONS.md` § Build, and `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`'s target banner. Three of the four are corrected earlier, under P9-01 and P9-01a; this is the sweep that confirms none was missed
- [ ] `CLAUDE.md`'s counts are re-derived rather than copied: it says **53 route modules** and **342 test files**; the tree on 2026-09-23 has **55** route files and **366** test files
- [ ] ADR-038 gets a completion note; `MEMORY/records/P9-24.md` written

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
