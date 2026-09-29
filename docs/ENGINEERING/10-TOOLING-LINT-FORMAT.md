# 10 — Tooling, Lint and Format

The tools, their configuration as it actually is, and the target.

---

## Commands

| Task | Backend | Frontend |
|---|---|---|
| install | `npm install` at the repo root (workspace hoists to root `node_modules`) | same |
| dev | `npm run dev` — `tsx watch index.js` (ADR-087) | `npm run dev` |
| lint | `npm run lint` — ESLint over `src/` | `npm run lint` |
| format check | `npm run prettier` | via ESLint/Prettier |
| typecheck | `npm run typecheck` — TypeScript 7, `--noEmit`; checks the converted `.ts` modules only, the rest is still JavaScript (ADR-087) | `npm run typecheck` |
| unit tests | `npm test`; gate: `npm run test:coverage` | `npx jest` |
| build | `npm run build` → `pkg` binary | `npm run build` |
| everything | `make verify` — **manual; nothing runs it automatically** | |

`npm test` runs `jest` from `PATH`. Until 2026-09-11 it ran `node node_modules/jest/bin/jest.js`, a path that does not exist under a hoisted workspace install, and failed with `MODULE_NOT_FOUND` — which looked nothing like a test failure and hid the true state of the coverage gate.

## ESLint — as-built

Since 2026-09-28 (P9-02, ADR-092) `backend/` has **one** configuration, `eslint.config.js` (flat config, ESLint 9); the legacy `.eslintrc.js`, which ESLint 9 ignored, is deleted.

The JavaScript block is `@eslint/js` recommended + `eslint-config-prettier` + the house formatting rules (double quotes, `always-multiline` commas, `curly: all`, two-space indent), with `no-unused-vars` still a **warning**. It declares `sourceType: "module"` for a CommonJS codebase. The `.ts` block is typescript-eslint `strictTypeChecked` + `stylisticTypeChecked` (ADR-087).

**Global ignores** (`dist/`, `coverage/`, `build/`, `docs/`, `*.config.js`) sit in a config object of their own. Until 2026-09-28 they shared an object with `rules`, which in flat config scopes them to that object: an `eslint .` visited 474 files under `dist/` and 6 under `coverage/`, and `jest.config.js` was linted without the house rules. Checked with `ESLint#isPathIgnored` over every file, not by reading the config.

**Error count: 0** since P9-02a (2026-09-28, ADR-092): the 1,050 errors were formatting only and were fixed rule by rule, with each fixed file shown AST-identical to `HEAD`. `backend/.eslint-baseline.json` is 0, so the ratchet now fails on any new error. 300 warnings remain (263 `no-unused-vars`, 19 `no-console`, 12 unused `eslint-disable`, 6 `prefer-arrow-callback`) — P9-02a's hand-triage items.

Frontend: `eslint.config.mjs` with the Next.js and **React Compiler** rules. One pre-existing error: `react-hooks/set-state-in-effect` in `GlobalSearch.tsx` (A-22). **Do not disable React Compiler rules to make a build pass** — the rule is usually right about the component.

## ESLint — target (P9-02)

- one flat config; `.eslintrc.js` deleted — **done 2026-09-28**;
- `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, with the ADR-038 rules as **errors**;
- `no-restricted-properties` on `process.env` outside `src/config/`;
- lint runs over `.ts` and the remaining `.js`.

## Prettier — as-built

Two configurations that disagree:

| File | Quotes | Width | Trailing commas |
|---|---|---|---|
| `backend/.prettierrc` | double | 80 | all |
| root `.prettierrc.js` | single | 100 | es5 |

Prettier uses the nearest file and never merges two, so **`backend/.prettierrc` is the one configuration that governs `backend/`** (P9-02, ADR-092) — `npx prettier --find-config-path backend/index.js` prints `backend/.prettierrc`. Its choices are the ones `backend/eslint.config.js` enforces (double quotes, trailing commas). The root `.prettierrc.js` is kept, scoped by a header comment saying it does not govern `backend/`; what it governs is the frontend owner's question, since `frontend/src` is almost entirely double-quoted and that file says `singleQuote`. Prettier is not a gate anywhere: ESLint's formatting rules are.

## Git Hooks and CI

**There are none.** No hook tooling in any `package.json`, no `core.hooksPath`, no CI pipeline, no secret scanner. Earlier documents described a `pre-push` hook and a secret scanner; neither exists. The honest state: nothing automatic stands between a commit and `main`.

Targets: a committed hook installed by `npm install` running lint, tests, the TypeScript ratchet and gitleaks (A-19, P9-04); CI running the same from a clean clone (P7-01).

## Lockfiles

None is committed — `.gitignore` excludes `pnpm-lock.yaml`, `package-lock.json` and `bun.lock`. Every install and every image build resolves transitive versions fresh (A-21). Both `pnpm-lock.yaml` and `package-lock.json` exist on developer machines; whichever tool ran last wrote its own.

## Editor

`.editorconfig` at the root: UTF-8, LF, two-space indent, final newline. Git on Windows converts to CRLF on checkout unless configured otherwise; the repository content is LF.
