# 90 — Conventions for Shared Packages (TARGET, generalising `contracts` as built)

> **Status:** these conventions are what `packages/contracts` does **as built** (ADR-097), stated as
> the rule for every package that ADR-134 adds. Where a rule is new, it says so. A package card in
> Phase 35 is not DONE until its package meets every section here.

---

## 1. Naming

| Thing | Rule | Example |
|---|---|---|
| Directory | `packages/<kebab-name>` | `packages/sync-engine` |
| npm name | `@callibrator/<kebab-name>`, `"private": true` | `@callibrator/sync-engine` |
| Source file | `camelCase.ts`, one concern per file | `planner.ts`, `apiErrors.ts` |
| Test file | `test/<module>.test.ts`, with the card or finding id when it pins one (`envelope.test.ts`, `inspectionValues.p2003.test.ts` — the as-built pattern) | `test/purge.p3207.test.ts` |
| Types | `PascalCase`; branded ids from contracts (`TenantId`, `UserId`) — never a bare `string` for an id that has a brand | `CaptureState` |
| Constants | `UPPER_SNAKE_CASE`, frozen (`as const` + `Object.freeze` where read at runtime; the as-built `constants.test.ts` asserts frozenness) | `SCOPE_LOSS_CODES` |
| Unions instead of enums | `as const` tuples and their element type; **no TypeScript `enum`** (the as-built lint ban) | `export const TONES = [...] as const` |
| i18n keys | `namespace.subject.detail`, lower camel segments | `field.conflicts.ipmDraftExists` |

## 2. Folder Layout

```text
packages/<name>/
├── package.json        # private; exports ./src/*.ts; no "type"; peerDependencies for react etc.; engines node >=26 <27
├── README.md           # status (TARGET/as built), purpose, the API in ten lines, link to docs/SHARED/<nn>
├── CHANGELOG.md        # § 7
├── tsconfig.json       # extends the shared strict base (§ 4); lib ES2025, types []
├── eslint.config.js    # mirrors packages/contracts/eslint.config.js + § 5's rules
├── jest.config.js      # 100 % thresholds on src/**
├── src/                # source only; index.ts = named re-exports
├── test/               # tests and their tsconfig
└── scripts/            # build-time generators only (tokens' build-css.ts, api-client's api:types)
```

## 3. Exports

- **Source-only exports** (ADR-097 decision 2): `"exports": { ".": { "types": "./src/index.ts",
  "default": "./src/index.ts" }, "./*": { "types": "./src/*.ts", "default": "./src/*.ts" },
  "./package.json": "./package.json" }`, and **no `"type"` field** (Turbopack's format inference; the
  as-built reason in ADR-097 decision 2).
- **Named exports only.** No `export default`; no `export =` (the backend's CommonJS module shape of
  ADR-087 Am. 15 does not apply inside packages, which the backend never imports — except `contracts`,
  which already follows this rule).
- **No `export *`** in a barrel — Babel's interop for it adds branches the 100 % gate counts (ADR-097
  decision 4, measured). Re-export by name.
- **A big package is imported by subpath** (`@callibrator/contracts/vendor`); its barrel stops growing
  once names would collide (ADR-097 Am. 1 § 4).
- **Return types on every export** (`docs/ENGINEERING/04` § Return types).

## 4. TypeScript

- The backend's strict flags (`docs/ENGINEERING/04` § The Compiler): `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`,
  `noUnusedParameters`, `isolatedModules`, `forceConsistentCasingInFileNames`.
- **`"lib": ["ES2025"]`, `"types": []`** — no `DOM`, no `node`. A browser or Node global is a compile
  error (`01` § 2 rule 2). Fetch types used by `api-client` come from its own minimal ambient module.
- **Checked by TypeScript 7 by path** (`node ../../node_modules/@typescript/native/bin/tsc -p
  tsconfig.json --noEmit`, as `contracts` does); never a bare `npx tsc` (ADR-076).
- Every package must also typecheck under **each consumer's** settings (the frontend's looser ones,
  the app's): the package's own strict check is the stricter gate, the consumers' typechecks prove the
  rest (ADR-097 implications).
- No `any`; reasons on every `@ts-expect-error` and `eslint-disable` (`CLAUDE.md` § Code Style).

## 5. The No-Platform-Import Guard (new)

Three independent failures, so one forgotten rule is not enough to leak:

1. **Lint** (`eslint.config.js` of every package): `no-restricted-imports` for `next`, `next/*`,
   `react-dom`, `react-dom/*`, `react-native`, `react-native/*`, `expo`, `expo-*`, `@react-native/*`,
   `@expo/*`, `node:*` and the Node built-in names, `axios`, `idb`, `localforage`; and — except in
   `hooks` — `react`. `no-restricted-globals` for `window`, `document`, `navigator`, `localStorage`,
   `sessionStorage`, `indexedDB`, `process`, `global`, `__DEV__`, `require`, `fetch`, `crypto`.
2. **Compile:** `lib` without `DOM` and `types: []` (§ 4).
3. **Guard test** — `scripts/ci/sharedPackages.guard.test.ts` (target, P35-01) parses every
   `packages/*/src/**/*.ts` (skipping `contracts`' own documented allowances), lists every import
   specifier and global identifier, and fails on one outside the package's allowed set from the table
   in `01` § 2 — including **edges between packages** that the graph does not allow (a cycle, or
   `domain` importing `api-client`). It also fails if `domain` exports a function name that
   `contracts` exports (`05` § 1).

## 6. Testing

- **100 % statements, branches, functions and lines** for every package's `src/` — the threshold
  `contracts` holds today (ADR-097 decision 10) and the backend's unit gate holds (`CLAUDE.md`).
  Exclusions are allowed only for generated files with no runtime code (`api-client`'s
  `generated/schema.d.ts`), each named in the jest config with its reason.
- Tests run in a **plain Node environment** (no jsdom), which is also the proof that nothing reaches
  for the DOM. `hooks` uses `renderHook` from `@testing-library/react` without a DOM container.
- **The evidence rules of `CLAUDE.md` apply in full:** name the test; a test generated from the code it
  tests proves consistency, not correctness (a tone test must not iterate the registry's own keys to
  derive its expectations); a mock proves the client, not the contract — packages that touch the API
  are proved against the running server by the consumers' live suites (`03` § 8, `06` § 10).
- **Mutation checks** where a test guards something load-bearing: the purge table, op freezing, the
  tenant prefix of query keys, the contrast rule, the credential-endpoint table. Break it, watch the
  named test fail, record it.
- A package's tests run from the root with `npm test -w @callibrator/<name>` and through
  `turbo run test`; CI runs them beside `contracts`' (`.github/workflows` — the job list is extended
  by P35-01).

## 7. Changelog and Versioning

- `packages/<name>/CHANGELOG.md`, newest first:

  ```markdown
  ## 0.3.0 — 2026-11-02 — P35-06
  - Added: `unwrapList` refuses a non-array `data` (kind `contract`).
  - BREAKING: `ApiError.code` is `string | null` (was `string | undefined`); consumers updated in the same change.
  ```

- Bump per `01` § 6: minor for additive, `0.n → 0.n+1` with a `BREAKING` line for breaking. All
  consumers are updated **in the same pull request** — there is no window in which a consumer uses an
  older copy (workspace links).
- A user-visible or operationally significant change also gets its `MEMORY/CHANGELOG.md` entry, as
  every change does (the global DoD).

## 8. Deprecation

- Mark with JSDoc `@deprecated <replacement> — removal: <card id>`; the lint rule
  `@typescript-eslint/no-deprecated` makes every remaining use visible.
- A deprecated export is **removed when no workspace imports it** — proved by the typecheck of every
  workspace — and at the latest at the end of the phase that deprecated it. There is no external
  consumer to wait for.
- **Installed app binaries are not consumers of the packages**; they are frozen copies. What an old
  binary needs from the server is governed by the **API** deprecation policy
  (`docs/API/14-BACKEND-INTEROPERABILITY-CONTRACT.md` § 9) and the installed-app-version policy
  (`../MOBILE/20` § 9) — a package change never needs a compatibility shim for an old app; a contract
  change might.

## 9. Documentation

- Every package has a `README.md` (§ 2) and a document in `docs/SHARED/`. When a package is built,
  its document is swept from TARGET to **as built** in the same change, naming source files — the
  `docs/` rule "state as fact only what the code does".
- A decision that changes a package's boundary, the graph of `01` § 2 or a rule here is an ADR
  amendment (ADR-134), through the deviation protocol.

## 10. Review Checklist for a Shared-Package Change

- [ ] The change belongs in a shared package by `01` § 1's rule (logic or tokens, needed by more than
      one platform), not UI or a platform mechanism
- [ ] No new import outside the package's allowed set; the guard test is green
- [ ] Named exports only; no `export *`; return types declared
- [ ] 100 % coverage held, with fail-before cases for the rule being added
- [ ] Every consumer (frontend, app, backend for `contracts`) typechecks and its tests pass in this PR
- [ ] For `api-client`: `api:types:check` green; for `tokens`: `tokens:check` green and the contrast
      tests unchanged in count
- [ ] For `sync-engine`: P19-08's numbers not loosened; the outbox untouched by every purge path
- [ ] Query keys start with the tenant (hooks)
- [ ] `CHANGELOG.md` entry; the `docs/SHARED/` document updated if behaviour changed
- [ ] The frontend Docker image still builds (its allow-list includes the package)
