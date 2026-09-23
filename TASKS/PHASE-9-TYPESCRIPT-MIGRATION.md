# Phase 9 — Backend TypeScript Migration

**Status: 🔴 NOT STARTED.** Decided in [ADR-038](../MEMORY/DECISIONS.md) (2026-09-21), superseding ADR-030.

The backend moves from JavaScript/CommonJS to **TypeScript with the strictest practical settings**, incrementally, without a behaviour change. The target standard is [`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`](../docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md); the layer templates are in [`docs/ENGINEERING/05-LAYER-TEMPLATES.md`](../docs/ENGINEERING/05-LAYER-TEMPLATES.md).

**Until this phase closes, the backend is JavaScript.** Every backend document carries a banner saying so. Nothing in this file is shipped until its card says `DONE` and its `MEMORY/records/` entry exists.

---

## The Three Rules

These come from ADR-038 and are not renegotiated per task.

1. **Leaf-first order.** A file is converted only when everything it imports is already TypeScript. A `.ts` file never depends on an untyped `.js` one.
2. **The ratchet only goes down.** The number of `.js` files under `backend/src` may never rise. New backend code is TypeScript from P9-04 onward.
3. **Conversion never changes behaviour.** A conversion PR changes types, syntax and imports — nothing else. A bug the compiler exposes is written down and fixed in its **own** PR against [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md). If a conversion cannot compile without a behaviour change, it stops and the fix goes first.

## Preconditions

| | Why it must come first |
|---|---|
| **AUDIT-2026-09 wave 0 is `DONE`** | the cross-tenant write on `tenant-hierarchy` and the unguarded configuration routes are live holes. A migration measured in months is not a reason to leave them open |
| **A behaviour baseline exists** | rule 3 needs an oracle. The live E2E suite has never passed in one uninterrupted run (P6-02), so P9-00 records **which specs pass today**; no stage may reduce that set |
| **The backend suite is green at 100%** | it is (290 suites, 5,741 tests, 2026-09-21). Conversion that drops a file below 100% is not done |

## Inventory

What has to move, counted from the tree on 2026-09-21:

| Layer | Files | Stage |
|---|---|---|
| `constants/` | 5 | B |
| `utils/` | 20 | B |
| `config/` | 4 | B |
| `models/` | 72 | B |
| `validators/` (Joi → Zod) | 37 | B |
| `services/` (incl. `storage/`) | 76 | C |
| `middlewares/` | 21 | D |
| `controllers/` | 56 | D |
| `routes/` | 54 | D |
| `workers/`, `scripts/`, `index.js` | 6 | D |
| `migrations/` | 18 | E — **names frozen**, see P9-23 |
| tests | 340 | with their module |

Roughly **370 source files** and **340 test files**. The sizes below are relative (S/M/L/XL by file count and risk), not calendar estimates: nobody has measured this team's conversion rate yet, and a guessed date is a promise nobody made.

---

## Stage A — Foundations

No production module is converted in this stage. Its output is a toolchain in which the first conversion is boring.

### P9-00 — Record the behaviour baseline

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | — |
| **Spec refs** | `docs/TESTING/03-E2E-TESTING.md` · ADR-038 rule 3 |
| **Spec required** | no |
| **Size** | S |

**Why:** "No behaviour change" is unfalsifiable without a baseline. The unit suite mocks the database and the HTTP layer; the live E2E suite is the only thing that exercises real contracts, and it has never been green in one run.

**Definition of Done**
- [ ] the 53 E2E specs run against a fresh stack; the passing set is recorded by spec name in `MEMORY/records/P9-00.md`
- [ ] every failing spec has a one-line reason (known defect with an audit task id, flake, environment)
- [ ] the run command and stack commit are recorded, so the baseline can be reproduced

**Abuse cases**
- Recording a baseline from a run where failing specs were skipped rather than failed
- Taking the baseline *after* the first conversion

---

### P9-01 — TypeScript toolchain, build and image

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P9-00 |
| **Spec refs** | ADR-038 · `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` · `docs/DEVOPS/02-CONTAINERIZATION.md` |
| **Spec required** | no |
| **Size** | M |

**Why:** the compiler settings are the migration. Weakening them later is far harder than starting strict.

**Definition of Done**
- [ ] `backend/tsconfig.json` with every flag in ADR-038 (`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + the rest), `allowJs: true`, `checkJs: false`, `module: Node16`, `outDir: dist`
- [ ] `tsconfig.build.json` excludes tests; `npm run build` = `tsc -p tsconfig.build.json` → `pkg dist/index.js`
- [ ] `tsx` for `dev` and every script in `package.json`; `nodemon` removed
- [ ] `build:bun` and its script removed (a second, unmaintained build path)
- [ ] backend Dockerfile builds the TypeScript output; the image boots and `/health` is 200 on a staging stack
- [ ] **the binary behaves identically**: the P9-00 baseline set still passes against the new image
- [ ] `typescript`, `@types/node`, `@types/express`, `tsx` pinned

**Abuse cases**
- Starting with `strict: false` "for now"
- Adding `skipLibCheck` to hide a real type conflict rather than as the documented default
- Declaring the build done because `tsc` exits 0 on a tree with zero `.ts` files

---

### P9-02 — Lint and format: one config each, strict

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P9-01 |
| **Spec refs** | ADR-038 · `docs/ENGINEERING/10-TOOLING-LINT-FORMAT.md` |
| **Spec required** | no |
| **Size** | S |

**Why:** the audit found **two** ESLint configs in `backend/` (legacy `.eslintrc.js`, ignored by ESLint 9, beside `eslint.config.js`) and **two conflicting Prettier configs** (`backend/.prettierrc`: double quotes, width 80; root `.prettierrc.js`: single quotes, width 100). A rule nobody can find is not a rule.

**Definition of Done**
- [ ] `backend/.eslintrc.js` deleted; `eslint.config.js` is the only config
- [ ] `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` with every rule in ADR-038 as an **error**
- [ ] `no-restricted-properties` bans `process.env` outside `src/config/`
- [ ] one Prettier configuration governs `backend/`; the conflicting one is deleted or scoped with a written reason
- [ ] lint covers `.ts` **and** the remaining `.js`

**Abuse cases**
- Rules set to `warn` so the build passes
- A blanket `eslint-disable` at the top of a converted file

---

### P9-03 — Tests run TypeScript; the gate stays at 100%

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P9-01 |
| **Spec refs** | `docs/ENGINEERING/09-TESTING-CONVENTIONS.md` · `docs/BACKEND/09-TESTING.md` |
| **Spec required** | no |
| **Size** | S |

**Definition of Done**
- [ ] Jest transforms `.ts` with `@swc/jest`; `collectCoverageFrom` includes `.ts`
- [ ] thresholds unchanged at 100%
- [ ] one trivial util converted as a canary, with its test, proving `.ts` source + `.ts` test + coverage work end to end
- [ ] suite duration recorded before and after; a regression over 25% is investigated, not accepted

**Abuse cases**
- Excluding converted files from coverage "until the migration settles"

---

### P9-04 — The ratchet

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P9-01 |
| **Spec refs** | ADR-038 rule 2 |
| **Spec required** | no |
| **Size** | S |

**Why:** without it, "new code is TypeScript" is a sentence in a document — the exact failure the audit found with the non-existent `pre-push` hook.

**Definition of Done**
- [ ] `scripts/ts-ratchet` counts `.js` under `backend/src` (excluding the frozen migration names — P9-23) against `backend/.ts-ratchet` and **fails if the count rose**
- [ ] when the count falls, the script rewrites the baseline, so the new floor is committed with the conversion
- [ ] wired into `make verify` **and** into CI when P7-01 lands — and, until CI exists, into a real `pre-push` hook that is committed and installed by `npm install`
- [ ] tested both ways: adding a `.js` file fails; converting one passes and lowers the floor

**Abuse cases**
- Raising the baseline by hand in the same PR that adds a `.js` file
- Renaming `.js` to `.ts` with `// @ts-nocheck` at the top

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
| **Status** | TODO · **Depends on** P9-08 · **Size** M |
| **Spec refs** | `docs/ENGINEERING/06-ERROR-RESPONSE-STANDARDS.md` |

**Definition of Done**
- [ ] 20 files; `ApiResponse<T>` models the envelope (`data` + top-level `meta`) so `data.rows` is unrepresentable
- [ ] `AppError` hierarchy typed; `catch (e: unknown)` narrowed with a type guard
- [ ] `response.util#paginated` — **dead code** (no callers, and it reads `res.query`) — deleted rather than typed
- [ ] `asyncHandler`'s behaviour is **preserved** here; its defects (it sends the raw error message before the central handler can sanitise it, then calls `next` anyway) are fixed in AUDIT task A-13, not in this conversion

---

### P9-10 — `models/`

| | |
|---|---|
| **Status** | TODO · **Depends on** P9-09 · **Size** XL |
| **Spec refs** | `docs/DATABASE/*` · ADR-038 (models row) · `docs/BACKEND/05-TENANT-SCOPING.md` |
| **Spec required** | **yes** — the association typing pattern, before 72 models copy a wrong one |

**Definition of Done**
- [ ] 72 models as `Model<InferAttributes<M>, InferCreationAttributes<M>>` with `declare` fields; associations typed
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
| **P9-18** | Platform | notification, email, emailQueue, webhook, search, ai, storage/*, attachment, batchJob, rabbitmq, redis, rateLimiter.redis, gdpr, audit, content, kanban, ticket, dashboard, report, kms | XL | P9-12 |

**P9-14 is the domain core** (`CLAUDE.md`: "if a change threatens anything here, it needs an ADR before it needs a branch"). Its state machines must use the P9-05 unions with `switch-exhaustiveness-check`, so adding a certificate state fails compilation everywhere it is not handled.

---

## Stage D — The HTTP Layer

### P9-19 — `middlewares/`

| | |
|---|---|
| **Status** | TODO · **Depends on** Stage C · **Size** M |

**Definition of Done**
- [ ] 21 files typed against the P9-05 `Request` augmentation
- [x] `sessionSecurity.middleware.js` is not in scope: **deleted 2026-09-23** under AUDIT task A-12 as dead code (imported by nothing; its SQL targeted a nonexistent `"Sessions"` table). Nothing to convert
- [ ] `dynamicAccess` resource names typed as the menu-slug union, so `dynamicAccess("AuditLogs", …)` — a slug that does not exist — is a compile error (see AUDIT A-07)

### P9-20 — `controllers/`

| | |
|---|---|
| **Status** | TODO · **Depends on** P9-19 · **Size** L |

**Definition of Done**
- [ ] 56 controllers as `RequestHandler<Params, ApiResponse<T>, Body, Query>`; body and query come from `req.validated`, never raw `req.body`
- [ ] `req.body?.x` guards disappear because the typed body makes the undefined-body case explicit (the class of bug behind the 2026-09 `menu-groups` 500)

### P9-21 — `routes/`, `index.js`, socket, workers, scripts

| | |
|---|---|
| **Status** | TODO · **Depends on** P9-20 · **Size** M |

**Definition of Done**
- [ ] 54 route files; a route helper that **requires** a permission gate argument (or an explicit `public()` marker) — P6-04 made structural rather than a lint check
- [ ] `index.js` → `index.ts`; `config/socket` and the batch worker typed
- [ ] `pkg` still produces a working binary; the Docker image boots

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
| **Status** | TODO · **Depends on** P9-21 · **Size** S |
| **Spec refs** | `docs/DATABASE/13-MIGRATIONS.md` |

**Why:** `schema_migrations` records names **with the `.js` suffix** (`0001-underscore-class-models.js`, verified on the reference deployment), and `src/config/migrator.js` registers them from a static manifest. Change a name string and Umzug treats all 18 as new — and runs them again against production.

**Definition of Done**
- [ ] migration files may become `.ts`, but **every manifest name string stays exactly as recorded**, `.js` suffix included
- [ ] a test asserts the manifest names equal a frozen list of the 18 historical names
- [ ] new migrations are TypeScript from the start; their recorded name is fixed when first applied and never changes
- [ ] dialect guards inside applied migrations are left alone (ADR-039)

**Abuse cases**
- "Tidying" the manifest names to drop `.js`

### P9-24 — Close-out

| | |
|---|---|
| **Status** | TODO · **Depends on** everything above · **Size** S |

**Definition of Done**
- [ ] ratchet at zero; `allowJs: false`; the ratchet script and baseline removed
- [ ] unused dependencies removed: `joi`, `aedes`, `aedes-server-factory`, `nodemon`, the Bun build path
- [ ] the target-vs-current banner removed from every backend document, each checked against the code as it is removed
- [ ] `CLAUDE.md`, `AGENTS.md`, `docs/ENGINEERING/00-CODING-CONTEXT.md` state TypeScript as **fact**
- [ ] ADR-038 gets a completion note; `MEMORY/records/P9-24.md` written

---

## Order at a Glance

```
AUDIT wave 0 ──▶ P9-00 ──▶ P9-01 ──┬──▶ P9-02
                                   ├──▶ P9-03 ──▶ P9-05 ──▶ P9-06 ──▶ P9-07
                                   └──▶ P9-04
P9-07 ──▶ P9-08 ──▶ P9-09 ──▶ P9-10 ──▶ P9-11 ──┬──▶ P9-12 ──▶ P9-13 ──┬──▶ P9-14 ──▶ P9-16
                                                 │                       ├──▶ P9-15
                                                 │                       └──▶ P9-17
                                                 │        P9-12 ──▶ P9-18
                                                 └──▶ P9-22
Stage C ──▶ P9-19 ──▶ P9-20 ──▶ P9-21 ──▶ P9-23 ──▶ P9-24
```

## What Would Make This Phase Fail

| Failure | Its signature |
|---|---|
| strictness eroded under deadline | `warn` instead of `error`; `skipLibCheck` hiding a real conflict; `any` behind `unknown as` |
| behaviour changed silently | a baseline E2E spec starts failing and the conversion PR is where it happened |
| the dual state never ends | the ratchet flat for weeks; new `.js` justified as "just a small script" |
| documents claiming it finished early | a backend document without its banner while its module is still `.js` — PR-4 again |
