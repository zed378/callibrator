# 10 — Tooling, Lint and Format

The tools, their configuration as it actually is, and the target.

---

## Commands

**Runtime: Node 26, one source of truth** (ADR-076): the root `.nvmrc` is `26`, every `engines.node` is `>=26 <27`, both Dockerfiles pin `node:26.10.0-alpine` by digest, CI's `NODE_VERSION` is `26.10.0`, and a jest `globalSetup` refuses any other major. Package manager: **npm**, with the root `package-lock.json` committed (ADR-044).

| Task | Backend (`cd backend`) | Frontend (`cd frontend`) |
|---|---|---|
| install | `npm ci` / `npm install` at the repo root (the workspaces hoist to root `node_modules`) | same |
| run source | `npm start` = `node --import tsx index.js`; `npm run dev` = `tsx watch index.js`. **Plain `node` on backend source fails** (`MODULE_NOT_FOUND` on the first `.ts` module) — scripts, migrations and one-off runs go through `tsx` (ADR-087 decision 4) | `npm run dev` |
| lint (the gate) | `node scripts/ci/eslint-ratchet.js` **from the repo root** — fails on any error above `backend/.eslint-baseline.json` (**0**); `make lint-ratchet` | `npm run lint` (`eslint`); CI runs `npx eslint` |
| lint (plain) | `npm run lint` — `eslint src/ scripts/build-dist.ts` | |
| typecheck | `npm run typecheck` — TypeScript 7 by path, `--noEmit` (ADR-076). **Not** `npx tsc` | `npm run typecheck` — the same, TypeScript 7 |
| JavaScript ratchet | `npm run ratchet` (`tsx scripts/ts-ratchet.ts`) — fails on any `.js` path not listed in `backend/.ts-ratchet.json`; lowers the floor when files have gone. `-- --list` prints the counted files | — |
| format check | `npm run prettier` — **not a gate, and not clean** (below) | — |
| unit tests | `npm test`; gate: `npm run test:coverage` (100%, ADR-085 scope). Through the npm scripts, never bare `npx jest` (A-99) | `npm test` (= `jest --coverage`) |
| live E2E | `npm run test:e2e` against a running server (`BASE_URL`) | — |
| build | `npm run build` = `openapi:check` (the committed `openapi.json` is current; P9-25, ADR-103 — was `swagger:generate`) → `build:dist` (`tsx scripts/build-dist.ts`: `.js` copied byte for byte, `.ts` compiled by TypeScript 7 under `tsconfig.build.json`) → `pkg` (`node26-linux-x64`, `node26-win-x64`) | `npm run build` (`next build`, which also type-checks with the TypeScript 6 API) |
| everything | `make verify` = `lint ts-ratchet typecheck test build` — **manual**; CI runs the same stages. Not covered: `make test-e2e`, `make test-browser` | |

**Verified on 2026-09-29** (Node 26.10.0, Windows, this tree): backend `npm run typecheck` exit 0; frontend `npm run typecheck` exit 0; `npm run ratchet` exit 0 — it found two `.js` files gone (converted by another agent while this was written) and **rewrote the floor 1050 → 1048**, which is its designed behaviour: the lowered `backend/.ts-ratchet.json` belongs in the commit of the conversion that earned it; `node scripts/ci/eslint-ratchet.js` "0 error(s), 237 warning(s); baseline 0", exit 0; backend `npm run lint` 0 errors, 237 warnings; `npm run prettier` exit 2 (≈1,100 files not in Prettier's format). `make` itself is not installed on this workstation, so each target was run as the command it wraps.

`npm test` runs jest through `node --experimental-vm-modules ../node_modules/jest/bin/jest.js` (the real `otplib` 13 needs ES-module-only dependencies, A-99). Until 2026-09-11 it ran a path that did not exist under the hoisted install and failed with `MODULE_NOT_FOUND` — which looked nothing like a test failure and hid the true state of the coverage gate.

## ESLint — as-built

Since 2026-09-28 (P9-02, ADR-092) `backend/` has **one** configuration, `eslint.config.js` (flat config, ESLint 9); the legacy `.eslintrc.js`, which ESLint 9 ignored, is deleted.

The JavaScript block is `@eslint/js` recommended + `eslint-config-prettier` + the house formatting rules (double quotes, `always-multiline` commas, `curly: all`, two-space indent), with `no-unused-vars` still a **warning**. It declares `sourceType: "module"` for a CommonJS codebase. The `.ts` block is typescript-eslint `strictTypeChecked` + `stylisticTypeChecked` (ADR-087).

**Global ignores** (`dist/`, `coverage/`, `build/`, `docs/`, `*.config.js`) sit in a config object of their own. Until 2026-09-28 they shared an object with `rules`, which in flat config scopes them to that object: an `eslint .` visited 474 files under `dist/` and 6 under `coverage/`, and `jest.config.js` was linted without the house rules. Checked with `ESLint#isPathIgnored` over every file, not by reading the config.

**Error count: 0** since P9-02a (2026-09-28, ADR-092): the 1,050 errors were formatting only and were fixed rule by rule, with each fixed file shown AST-identical to `HEAD`. `backend/.eslint-baseline.json` is 0, so the ratchet now fails on any new error. Warnings are P9-02a's hand-triage items (mostly `no-unused-vars`): 300 on 2026-09-28, **237** on 2026-09-29. `no-unused-vars` goes to `error` only after that triage.

**What the lint gate covers, as built.** `scripts/ci/eslint-ratchet.js` (CI, the pre-push hook, `make lint-ratchet`) lints **`backend/src/` only**; `npm run lint` adds `scripts/build-dist.ts`. `backend/index.js`, `backend/__tests__/` and `scripts/ts-ratchet.ts` are outside both (AUDIT A-284). Run `npx eslint <file>` on what you change, wherever it is.

**The `.ts` block** (`**/*.ts`, type-aware through `projectService` on the TypeScript 6 API): typescript-eslint `strictTypeChecked` + `stylisticTypeChecked` with the ADR-038 rules as errors, plus the house bans — `process.env` outside `src/config/`, `enum`, shared types outside `src/types/`, and a direct `.query(` outside `utils/sql.util.ts` (P9-07). The full table is [`04-TYPESCRIPT-STANDARDS.md`](./04-TYPESCRIPT-STANDARDS.md) § The Lint Rules.

Frontend: `eslint.config.mjs` with the Next.js and **React Compiler** rules. One pre-existing error: `react-hooks/set-state-in-effect` in `GlobalSearch.tsx` (A-22). **Do not disable React Compiler rules to make a build pass** — the rule is usually right about the component.

## ESLint — P9-02 status

- one flat config; `.eslintrc.js` deleted — **done 2026-09-28** (ADR-092);
- `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, with the ADR-038 rules as **errors** — **done** (ADR-087 decision 6);
- `no-restricted-properties` on `process.env` outside `src/config/` — **done**, for `.ts` files;
- lint runs over `.ts` and the remaining `.js` — **done** for `src/`;
- *target:* `no-unused-vars` as an error after the warning triage, and plain `eslint` replacing the ratchet script once nothing depends on a baseline;
- *target (ADR-076):* ESLint 10 once `eslint-config-next`'s plugins accept it (held at 9.39.5).

## Prettier — as-built

Two configurations that disagree:

| File | Quotes | Width | Trailing commas |
|---|---|---|---|
| `backend/.prettierrc` | double | 80 | all |
| root `.prettierrc.js` | single | 100 | es5 |

Prettier uses the nearest file and never merges two, so **`backend/.prettierrc` is the one configuration that governs `backend/`** (P9-02, ADR-092) — `npx prettier --find-config-path index.js` from `backend/` prints `.prettierrc` (re-checked 2026-09-29; from a `frontend/` file it prints the root `.prettierrc.js`). Its choices are the ones `backend/eslint.config.js` enforces (double quotes, trailing commas). The root `.prettierrc.js` is kept, scoped by a header comment saying it does not govern `backend/`; what it governs is the frontend owner's question, since `frontend/src` is almost entirely double-quoted and that file says `singleQuote`.

**Prettier is not a gate anywhere: ESLint's formatting rules are.** `npm run prettier` over `backend/src` is **not clean** (exit 2, about 1,100 files, 2026-09-29), because the tree follows ESLint's `indent` and quote rules rather than Prettier's printer, and the two disagree on some constructs (ADR-092). So **do not run `npm run prettier:fix` or the root `npm run format`** as a sweep: it rewrites far more than the lint rules require, and its output is not assumed lint-clean. Where the two disagree on a line you must keep, `// prettier-ignore` with the ESLint layout is the recorded precedent (ADR-087 Amendment 9).

## Git Hooks and CI

**Corrected 2026-09-29** — this section said there were none; both exist:

- **CI** (`.github/workflows/ci.yml`, ADR-066, ADR-082): gitleaks over every commit; actionlint; **backend lint** (`node scripts/ci/eslint-ratchet.js`, then `npm run typecheck`, then `npm run ratchet`); **backend unit + coverage gate** (`npm run test:coverage -- --ci --forceExit`); **frontend** `npx eslint` · `npm run typecheck` · `npx jest --ci --coverage` · `npx next build`; `npm audit --audit-level=high`; a **boot on PostgreSQL 18** (every migration, schema verification, a second idempotent boot); and the deploy-config render checks.
- **The pre-push hook** (`scripts/git-hooks/pre-push`) is **opt-in**: `make hooks` sets `core.hooksPath` and installs gitleaks 8.30.1 (checksum-verified) into the git-ignored `.tools/bin` (ADR-076, A-19). It runs gitleaks over the pushed range, and, for pushes touching `backend/`, the ESLint ratchet, `npm run typecheck` and `npm run ratchet`; for `frontend/`, `npm run typecheck`. A forced hook installed by `npm install` was refused (ADR-066). `make hooks-off` disables it.

`make verify` is still **manual**, and neither CI nor the hook runs the live E2E or browser suites.

## Lockfiles

**Corrected 2026-09-29:** npm is the package manager and the root **`package-lock.json` is committed** (ADR-044); `make install` and CI use it (`npm ci`). This section used to say no lockfile was committed. A stray `backend/bun.lock` is still present on disk and is not the lockfile of record.

## Editor

`.editorconfig` at the root: UTF-8, LF, two-space indent, final newline. Git on Windows converts to CRLF on checkout unless configured otherwise; the repository content is LF.
