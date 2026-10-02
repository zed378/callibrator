# 2026-10-01 — P9-21's non-route files converted: utils, CLIs, generators, config, and the entry point

**ADR:** ADR-087. The amendment text is in § "For the ADR-087 amendment" below, for the Phase 9 lead to merge.
**Card (part):** P9-21: its non-route files, in the coordinator's order.
**Agent:** P9-21 helper (the services helper of P9-14/P9-16/P9-20).
**Tree:** HEAD `fb55605` plus the uncommitted work of the other agents.

## What was converted

Each `.js` was snapshotted, then `cmp`-checked against its snapshot when it was removed. Its `.ts` was proved identical before the swap.

| Area | Files | Shape |
|---|---|---|
| utils | `kmsVerify.util`, `seedMenuGroups.util`, `session.util` | `export =`, `.js` key order |
| `src/scripts` (CLIs) | `migrate`, `verifySchema`, `seedDemo`, `rotateKeys`, `migrateStorage`, `breakGlassMfaReset`, `backfillEmbeddings` | as the `.js`; `backfillEmbeddings` keeps `export = { backfill }` and `require.main === module` |
| `backend/scripts` | `generate-coding-standards-html`, `generate-doc-html`, `generate-html-doc`, `generate-illustrations`, `generate-markdown-html`, `generate-mermaid-svg`, `generate-pdf` | scripts, no exports |
| `src/config` | `index`, `migrate`, `migrator`, `socket` | `export =`, `.js` key order |
| entry | `backend/index.js` → `index.ts` | script; literal `require`s in place (swapped 2026-10-02) |

These were deleted, with no conversion:

- `config/index.d.ts`, `config/migrator.d.ts` and `config/socket.d.ts`, the declaration twins of converted modules;
- `backend/scripts/rotate-default-credentials.js`, which could never load (A-344).

## How identity was proved

All of the following ran in scratch: a mirror of `backend/` and harnesses outside the tree. The plants were made in scratch only (Amendment 25 rule 6).

**The CLIs.** `runpair.sh` runs the original `.js` (real tree) and the `.ts` (mirror) against separate copies of a migrated, seeded PostgreSQL 18 database. It compares the exit code, stdout and stderr after normalisation, and a normaliser that empties a non-empty output fails the run.

Every documented argument set was identical, plus the failure paths. Examples:
- `migrate` up / down / pending / executed on empty and on populated databases;
- `rotateKeys` with real old-key envelopes and a bogus key id;
- `migrateStorage` with migrated, missing and skipped attachment rows and the files they produce;
- `breakGlassMfaReset` across all five refusals and the success.

After lint fixes, the three CLIs those fixes touched were proved again post-swap (`runpost.sh`).

**The generators.** Each side generated from a fresh copy of `docs/`. The runs compared:
- the written files;
- a manifest (md5 of every file under `docs/`);
- stdout, stderr and the exit code.

Puppeteer and `mmdc` were replaced by scratch fakes, which record the exact HTML and options handed to Chrome and each `mmdc` call and its input. A fake was needed because the *original's* real-Chrome PDF and four ER diagrams differ from run to run (measured: Google Fonts under `networkidle0`, and mmdc's ER layout). The rendered SVGs of `generate-illustrations` are deterministic, so they were compared for real, with every SVG deleted first.

**`config/index`.** `cfgid.js` checked, over 28 environment scenarios:
- the exports, the instance's `options` and `config`, the CLS namespace and the logging function;
- every validation failure.

Live `Connection()` runs on PostgreSQL 18 covered: create, exists, create under production, and a bad password reaching `EXIT 1`.

**`config/migrate`.** `Up` on an empty database gave identical schemas (73 tables, `pg_dump -s` with its random `\restrict` token excluded); `Down` and the unreachable case were identical too.

**`config/migrator`.** Through the `migrate` CLI on both sides: `down` ×3, then `up`, on base copies, ending with identical schemas. The 79 manifest entries are identical (extracted with the tests' own regex).

**`config/socket`.**
- `socket.test.js` passes unchanged, with 100% of `socket.ts` covered.
- `sockid.js` ran every exported helper over a matrix (160 observations, return values included). It catches a planted `deny()` that drops `next()`'s return value, which the unit suite does not.
- The A-54 cross-replica case passed live on a disposable Redis 7.

**Plants.** Every harness was bitten at least once. Two plants were found vacuous and redone: one hit a comment, and one ran without the file argument.

## Decisions taken in the conversion (for the amendment)

1. **`export =`, not named exports, for config.** The standards table (04 § Module shape) says an object of functions takes named exports. Tried first on `config/index`, the identity harness showed tsx emitting them as **alphabetical getters plus `__esModule`**, so `Object.keys` order and own keys changed.

   `export =` keeps the `.js` object exactly. The 62 `import { db } from "../config"` callers type-check against it unchanged.

2. **Load order is kept by literal `require`s where an `import` would move a load.** esbuild hoists `import`s above the code between them (measured).

   - `config/index` loads cls-hooked and creates its namespace before sequelize; `useCLS` runs before the logger loads.
   - `migrator` loads its 79 migrations inline, and the tests read those lines as text.
   - `generate-illustrations` loads puppeteer after its diagram table.
   - `index.ts` (pending) loads its routes after the middleware, and loads modules inside `startServer`.

   Each such `require` is typed through `import type` and `typeof`. `typeof import()` annotations are a lint error.

3. **ESM-only puppeteer 25** is loaded with `require(esm)` and typed with `import type … with { "resolution-mode": "import" }`, as the `.js` loaded it.

4. **Raw SQL in `config/index` moved to `sql()`.** The bootstrap's `datname = ?` replacement is now `$1` bound. `CREATE DATABASE` takes an identifier, which cannot be bound, so it stays quoted. The rows and the logged statement text are the same.

5. **`process.env` in a `.ts` outside `src/config`.** The CLIs and the generators read none. `index.ts` reads it through `config/env`'s `env()`, which is `process.env[name]` at call time; the require sits where activityLog has already loaded `config/env`, so the boot order is unchanged.

6. **The declaration-drift guard no longer pins names.** With the config twins gone, its "finds" test compares the walker with an independent recursive scan. A `.d.ts` left behind a converted module now fails the guard (bitten with a planted orphan).

## Re-keyed (not otherwise changed)

- **Paths and keys:**
  - `package.json` scripts (`migrate*`, `keys:rotate`) and the Makefile's `seedDemo`;
  - `noConsole.a42` keys;
  - `ai.ragReach.az02`;
  - the spawn path in `migrationLock.p803.live`;
  - the 48 tests that read `config/migrator.js` (now `migrator.ts`);
  - `upgradeBoot.am3.live`, which reads `migrator.ts`, or `migrator.js` in an older tree;
  - `declarationDrift`.
- **Frontend:** `menuHelpers.seedIcons.a118` reads `seedMenuGroups.util.ts`, falling back to `.js` (1 suite, 50 tests).
- **Not edited:** comment-only mentions of `config/index.js` in other lanes' files, and runtime strings that print a `.js` name: migration 0086's operator message, and `generate-markdown-html`'s usage line. Changing a printed string changes output, so they are left as they are.

## Defects found

- **A-344** (DONE): `rotate-default-credentials.js` had failed at its first `require` since the first commit. It was deleted on the main session's decision.
- **A-345** (DONE): the live Redis-adapter test had failed since P6-12 because its token mock carried no `sid`. It now has a one-line `sid`, and passes 2/2 on Redis 7.

## The entry point (swapped 2026-10-02)

`index.ts` is written in scratch:
- typecheck clean, lint 0;
- every load is a literal `require` in `index.js`'s position, so `load-check`'s boot-order parse still applies.

**Boot identity.** `bootid.js` records the `src` load order (521 modules), every app and router call with its factory arguments, the log sequence, 14 HTTP probes once ready, and the SIGTERM shutdown. It shows `index.ts` identical to `index.js` in:
- development: 2,010 observations;
- production with `FORCE_HTTPS`: 1,757 observations;
- the CLI-dispatch branch: 1,468 observations.

The one exception is the position of the batch-worker retry warning, which races the probes. That race appears between runs of either side, and the multiset and all other order are identical. Three plants were caught:
- a JSON limit;
- the order of two mounts;
- a moved load.

**Swapped** once `routes/internal/migration.route` landed (2026-10-02). It was proved again against the current tree first: development, 2,010 observations, identical modulo the retry race. `index.js` was `cmp`-identical to its snapshot.

The swap edits:
- package.json `start` / `dev`, and the two `ci.yml` boots, point at `index.ts`;
- `index.ts` is included in both tsconfigs;
- `build-dist` refuses an `index.js` beside `index.ts` and compiles `index.ts` to `dist/index.js`; `load-check` reads `index.ts`;
- 15 tests that read the entry as text are re-keyed: paths, the `"index.js"` app-routes label (also in `routeGateExemptions`), and three patterns updated to the `.ts` syntax of the same assertion (`runSchemaSetup` with a typed `db`, the typed `health.route` require, `Number(env("RATE_LIMIT_MAX"))`).

`jest.config.js` lost three `collectCoverageFrom` patterns that now match nothing (`config`, `controllers`, `routes` `.js`; coverageScope.p614).

**Gates after the swap:**
- eslint: 0 errors.
- typecheck: 0.
- build:dist: OK, `dist/index.js` emitted.
- load:check: OK in both modes. The boot-order count is 104, up from 103: the parse counts the `config/env` require, which activityLog has already loaded.
- Tests: the re-keyed suites with coverageScope and bootstrapCredential pass 161 of 163. The two failures are `swaggerValidatorAlignment`'s committed-`openapi.json` check, which already failed against `index.js`, and coverageScope, since fixed.
- Full coverage run before the swap: 854 suites passed. My files are at 100%.

**Not re-run on the swapped tree:** the full coverage run and the live E2E suite.

## P9-24 close-out items done in the same round (2026-10-02)

**Unused dependencies.**
- `joi`, `aedes`, `aedes-server-factory` and `nodemon` are in no `package.json`, no lockfile entry and no `node_modules` (`npm ls`: empty). No source imports them. Two frontend comments still mention "Joi" (`custom-domains/page.tsx:29`, `workflow.service.test.ts:71`); they are left to the frontend owner.
- The Bun path in A-18 was the backend's `build:bun`, already gone. The stray, git-ignored `backend/bun.lock` was deleted.
- The frontend's opt-in compiled binary (`next-bun-compile`, `NEXT_COMPILE=true`) is a live product path (PRD N7). It is **not** unused, so it was not removed. **Decided 2026-10-02 (main session): `next-bun-compile` is kept (PRD N7).**
- `npm audit`: 0 vulnerabilities.

**`allowJs: false` for source.** The base `tsconfig.json` comment now gives the one reason `allowJs` stays: the `.js` tests (P9-26, ADR-109 §5). The new guard `src/tests/guards/noSourceJs.p924.guard.test.ts` fails on any non-test `.js` in the counted set that is not on its PENDING list, and on a listed one that is gone. It also checks that the entry is `index.ts`. It passes 3/3, and both plants were caught in scratch. PENDING, which empties to meet the exit:
- `src/docs/components.js` and `src/docs/tags.js` (P9-25 lane);
- `services/attachment.service.js` and `services/maintenance.service.js` (P9-22 helper);
- `utils/checkMenu.util.js` (owner, A-18).

**ADR-030.** The DoD's four places (root `tsconfig.json`, `Makefile: typecheck`, `00-TASK-CONVENTIONS` § Build, the `04-TYPESCRIPT-STANDARDS` banner) already cite no ADR-030. Five live documents still stated it as current fact, and now state the as-built TypeScript:
- `docs/ARCHITECTURE/01-APPLICATION-ARCHITECTURE.md` (`typecheck`);
- `docs/ARCHITECTURE/03-BACKEND-ARCHITECTURE.md` (the language line, `index.ts`);
- `docs/DEVOPS/11-MAKEFILE-REFERENCE.md` (`make typecheck`);
- `docs/BACKEND/00-BACKEND-STANDARDS.md` (the entry and `npm start`);
- `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` (the divergence row marks ADR-030 superseded).

`BACKLOG` D-06 (JSDoc `checkJs`) is marked superseded. Historical records (PHASE-0, the PROGRESS Phase 0 row, the AUDIT records) are left as history.

**Target-vs-current banners for the final sweep.** Each line-3/5 banner must be checked against the code as it is removed:
- `docs/BACKEND/00-BACKEND-STANDARDS.md`, and `docs/BACKEND/01`–`11`;
- `docs/ARCHITECTURE/03-BACKEND-ARCHITECTURE.md`;
- `docs/ENGINEERING/README.md`, `00-CODING-CONTEXT.md` (also its line 105), `01-CODING-STANDARDS.md` and `04-TYPESCRIPT-STANDARDS.md` (line 5; also line 263, "most callers are still JavaScript");
- `docs/ENGINEERING/05-LAYER-TEMPLATES.md`: line 5, and the **As-built** notes at lines 28, 53 (Joi), 73, 99, 144 and 162, which describe JavaScript patterns;
- `CLAUDE.md` line 23 (backend row) and its Code Style section;
- `AGENTS.md` line 32;
- `TASKS/00-TASK-CONVENTIONS.md` line 118 ("mostly JavaScript still").

Not language banners, and staying: `docs/ENGINEERING/15-GO-CODING-STANDARDS.md` (Phase 999), and `10-TOOLING-LINT-FORMAT.md:51`'s lint target.

## Follow-ups (2026-10-02, second round)

- **Branch gaps on four routes.**
  - **Cause:** `admin`, `session`, `tenantBackup` and `webauthn` imported ES-module controllers and validators with `import * as X`. Babel's CommonJS transform injects an `_interopRequireWildcard` helper there, and the source map pins it to the last import line. Jest instruments that output, and the helper's CommonJS-module arms never run.
  - **Fix:** named imports, as every other converted route uses (aliases where a member name was generic). The values are identical, since each is read when the route registers at load, and handler names are unchanged.
  - **Result:** the four files are at 100/100/100/100 under `src/tests/routes` + `src/tests/controllers` (269 suites); guards 171/171; `openapi:check` current. No istanbul ignore.
- **The W-01 flake.** `tenantLifecycle.w01` compared the PLATFORM audit row with the tenant's row *including* `createdAt`, and the two rows are stamped one after the other (1 ms apart under load). It now compares every other field with `toEqual`, which is stricter than the old `objectContaining`. Each `createdAt` is asserted on its own: a `Date` inside the call's start and end. No tolerance was widened. 41/41 three times.
- **swagger-jsdoc removed.**
  - `src/docs/components.js` and `tags.js` are now `.ts`, data verbatim (deep-equal to the `.js`), `export =`.
  - In `scripts/openapi/build.ts`, `legacySpec`, the JSDoc path merge and the swagger-jsdoc import are gone; `normaliseLegacy` stays for the 3.0-style components.
  - `assertNoJsdocContract` refuses a route source with a ` * @swagger` / ` * @openapi` tag line. It was bitten in scratch, and a prose mention passes.
  - It caught a dead `@swagger tags: Content` block in `content.route.ts`, which the old builder never read (it took paths and components only). The block was removed.
  - **Proof:** the old builder (scratch copy, swagger-jsdoc and the `.js` data) and the new one produce **byte-identical** documents on the same tree (2,337,358 bytes), and the committed `openapi.json` equals the new output.
  - `swagger-jsdoc` and `@types/swagger-jsdoc` were uninstalled, with their transitive packages only (nothing else imports `yaml`, `openapi-types` or `@apidevtools/*`). `npm audit` 0.
- **The frontend "Joi" comments** now name the Zod schema and "the backend's request validator".
- **Guards.**
  - `noSourceJs.p924` PENDING is now `utils/checkMenu.util.js` alone, held by the owner under A-18.
  - `declarationDrift` handles the state with no twin left. Jest refuses an empty `.each`, so the per-twin case is skipped; the orphan scan still runs.
  - `jest.config.js` drops the `services` `.js` pattern (coverageScope.p614).

## P9-24 docs sweep and the contract's description (2026-10-02, third round)

**`openapi.json` `info.description`** now says the document is generated code-first: every operation from its route's `*.openapi.ts` module and the Zod schemas `validate()` enforces, with the shared components and tags of `src/docs/`. It no longer mentions "the remaining route JSDoc". This was regenerated and the diff accepted.
- That diff also carries another lane's not-yet-regenerated tenant-hierarchy change (the POST child route regrouped under `/{tenantId}/children`).
- `openapi:check` is current, Spectral passes (0 new errors, empty baseline), and p925 + p608 + apiDocs pass 28/28.
- `frontend` `api:types` was regenerated, `api:types:check` passes, and the frontend typecheck has 0 errors.

**Banners.** Every target-vs-current banner in the backend documents now states the as-built TypeScript:
- `docs/BACKEND/00`–`11`, `ARCHITECTURE/03`;
- `ENGINEERING` README, 00, 01, 04, 05;
- `00-TASK-CONVENTIONS` § Build.

Each says three things: the source is TypeScript, strict; the one source `.js` file left is the dead `checkMenu.util.js` (A-18); and the **694 `.js` files in the test trees (682 of them test files) are legacy `.js` (P9-26), while all new code, tests included, is TypeScript**.
- **00-CODING-CONTEXT:105** no longer claims every trap is a compile error. It names which ones the TypeScript backend now refuses mechanically (typed models, `sql()`, `validate`, `bodyDefault`, the boot's authorization wiring), and which are still left to tests and review.
- **04:263** now says the run-time shape is a contract because the legacy `.js` tests `require` the modules. Its module-shape table now includes the Amendment 28 `export =` rule.
- **05-LAYER-TEMPLATES**' as-built notes now describe the TypeScript and Zod code by its real modules:
  - the route: named imports and `export = router`;
  - the validator: `validate(schema, { from })` and `validated()`; Joi is removed (ADR-093);
  - the controller: `asyncHandler` forwards errors (A-13 DONE), with `req.user` and `success()`;
  - the service: `export =`, and the audit row inside `db.transaction`;
  - raw SQL: `sql(runner, …)`;
  - tests: new ones in `.ts` with `twoTenantSuite` and `memoryDb`.

  Its route, validator and SQL templates were corrected to code that mounts and compiles against the as-built helpers.
- **The body text of the same documents** was checked against the code: 230 references to a `.js` module that is now `.ts` were renamed. Left as written: test files, the frozen `NNNN-*.js` migration names, `dist/index.js` (the real compiled output), `Next.js`, and `checkMenu.util.js`. ENGINEERING 02 and 03 (project structure, naming) got the same renames.
- **Not touched,** as the main session asked: `CLAUDE.md`, `AGENTS.md`, the root README.

**P9-24 DoD ticked:**
- `allowJs` for source (the reason is beside the flag, plus the guard);
- the ratchet kept;
- unused dependencies (earlier);
- the backend banners;
- ADR-030 (earlier).

The "no non-test `.js`" item is annotated (only `checkMenu.util.js` is left) and stays unticked until the owner rules on A-18.

## For the ADR-087 amendment

> **Amendment (P9-21, non-route files).** An object-of-functions module whose callers destructure it converts with `export =` in the `.js` key order: tsx emits named exports as alphabetical getters with `__esModule`, which an identity check sees (config/index). Where an `import` would move a load — code between the requires, a load inside a function or a branch, or a manifest that tests read as text — the module keeps literal `require`s in place, typed through `import type`. A declaration twin is deleted with its module, and declarationDrift now fails on an orphan. A generator whose real output is nondeterministic (headless Chrome, mmdc) is proved on what it hands the renderer, captured by a scratch fake, and on its deterministic outputs.
