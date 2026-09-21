# 10 — Tooling, Lint and Format

The tools, their configuration as it actually is, and the target.

---

## Commands

| Task | Backend | Frontend |
|---|---|---|
| install | `npm install` at the repo root (workspace hoists to root `node_modules`) | same |
| dev | `npm run dev` (nodemon) → target `tsx watch` | `npm run dev` |
| lint | `npm run lint` — ESLint over `src/` | `npm run lint` |
| format check | `npm run prettier` | via ESLint/Prettier |
| typecheck | — (JavaScript) → target `tsc --noEmit` | `npx tsc --noEmit` |
| unit tests | `npm test`; gate: `npm run test:coverage` | `npx jest` |
| build | `npm run build` → `pkg` binary | `npm run build` |
| everything | `make verify` — **manual; nothing runs it automatically** | |

`npm test` runs `jest` from `PATH`. Until 2026-09-11 it ran `node node_modules/jest/bin/jest.js`, a path that does not exist under a hoisted workspace install, and failed with `MODULE_NOT_FOUND` — which looked nothing like a test failure and hid the true state of the coverage gate.

## ESLint — as-built

`backend/` contains **two** configurations:

| File | Format | Used? |
|---|---|---|
| `eslint.config.js` | flat config, ESLint 9 | **yes** |
| `.eslintrc.js` | legacy | **no** — ESLint 9 ignores it |

The live config is `@eslint/js` recommended + `eslint-config-prettier`, with `no-unused-vars` as a **warning**. It declares `sourceType: "module"` for a CommonJS codebase. It is permissive; it is not what the codebase will be held to.

Frontend: `eslint.config.mjs` with the Next.js and **React Compiler** rules. One pre-existing error: `react-hooks/set-state-in-effect` in `GlobalSearch.tsx` (A-22). **Do not disable React Compiler rules to make a build pass** — the rule is usually right about the component.

## ESLint — target (P9-02)

- one flat config; `.eslintrc.js` deleted;
- `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, with the ADR-038 rules as **errors**;
- `no-restricted-properties` on `process.env` outside `src/config/`;
- lint runs over `.ts` and the remaining `.js`.

## Prettier — as-built

Two configurations that disagree:

| File | Quotes | Width | Trailing commas |
|---|---|---|---|
| `backend/.prettierrc` | double | 80 | all |
| root `.prettierrc.js` | single | 100 | es5 |

Prettier uses the nearest file, so `backend/` code is formatted by `backend/.prettierrc` (and is consistently double-quoted), while anything formatted from the root picks up the other. P9-02 leaves exactly one governing `backend/`.

## Git Hooks and CI

**There are none.** No hook tooling in any `package.json`, no `core.hooksPath`, no CI pipeline, no secret scanner. Earlier documents described a `pre-push` hook and a secret scanner; neither exists. The honest state: nothing automatic stands between a commit and `main`.

Targets: a committed hook installed by `npm install` running lint, tests, the TypeScript ratchet and gitleaks (A-19, P9-04); CI running the same from a clean clone (P7-01).

## Lockfiles

None is committed — `.gitignore` excludes `pnpm-lock.yaml`, `package-lock.json` and `bun.lock`. Every install and every image build resolves transitive versions fresh (A-21). Both `pnpm-lock.yaml` and `package-lock.json` exist on developer machines; whichever tool ran last wrote its own.

## Editor

`.editorconfig` at the root: UTF-8, LF, two-space indent, final newline. Git on Windows converts to CRLF on checkout unless configured otherwise; the repository content is LF.
