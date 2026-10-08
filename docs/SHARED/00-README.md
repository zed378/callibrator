# SHARED/ — The Cross-Platform Packages (TARGET)

> **Everything in this folder is TARGET, except where a section says "as built".** The only shared
> package that exists today is **`packages/contracts`** (`@callibrator/contracts`, P9-22, ADR-097 and
> its amendments). There is no `packages/tokens`, `api-client`, `i18n`, `domain`, `sync-engine`,
> `hooks` or `icons`, and no `apps/` folder (checked 2026-10-08 against the working tree at
> `9e4663b`). Where a document says "the package does X", read "the package, once built, will do X".
> Writing a target as fact is PR-4 (`CLAUDE.md`, `docs/PLAN/18-RISK-REGISTER.md`).

**Decision record:** **ADR-134** (`MEMORY/DECISIONS.md` — the shared-package architecture and the
backend for native clients; Accepted as the plan, not built). It supersedes the `shared/` root of
ADR-089 and the "move into `shared/contracts` at Phase 999" working decision of Q-48.
**Origin:** the owner's mobile brainstorm and decisions of 2026-10-08 (`TASKS/BACKLOG.md` D-11).
**Plan:** [`TASKS/PHASE-35-SHARED-PACKAGES.md`](../../TASKS/PHASE-35-SHARED-PACKAGES.md)
(one plan with the app, Phases 35 … 40, after the backend-agnostic contract group of Phases 32 … 34, ADR-136). The native app that is the second consumer is documented in
[`docs/MOBILE/`](../MOBILE/00-README.md) (ADR-135).

---

## Why This Folder Exists

On 2026-10-08 the owner decided to build a React Native app (Expo + EAS) **beside** the web
frontend and the offline PWA, and to share between them **logic and design tokens only — each
platform renders its own UI**. Two clients must then agree on the same things the web frontend
today keeps privately in `frontend/src/lib`, `frontend/src/i18n` and `frontend/src/api`:
what a status means, how a QR is read, what a 409 says, which strings exist in Indonesian, how an
offline capture is replayed. Copying them would start the drift `CLAUDE.md` § "Read This First"
warns about; these packages are where each lives **once**.

## The Packages

| Package | Name | Status | Consumers | Document |
|---|---|---|---|---|
| `packages/contracts` | `@callibrator/contracts` | **as built** (ADR-097, Am. 1–6) | backend, frontend; mobile (target) | [`01-ARCHITECTURE.md` § 3](./01-ARCHITECTURE.md#3-contracts--the-one-package-that-exists) |
| `packages/tokens` | `@callibrator/tokens` | target | frontend, mobile | [`02-TOKENS.md`](./02-TOKENS.md) |
| `packages/api-client` | `@callibrator/api-client` | target | frontend, mobile | [`03-API-CLIENT.md`](./03-API-CLIENT.md) |
| `packages/i18n` | `@callibrator/i18n` | target | frontend, mobile | [`04-I18N.md`](./04-I18N.md) |
| `packages/domain` | `@callibrator/domain` | target | frontend, mobile | [`05-DOMAIN.md`](./05-DOMAIN.md) |
| `packages/sync-engine` | `@callibrator/sync-engine` | target | frontend (`/field` PWA), mobile | [`06-SYNC-ENGINE.md`](./06-SYNC-ENGINE.md) |
| `packages/hooks` | `@callibrator/hooks` | target | frontend, mobile | [`07-HEADLESS-HOOKS.md`](./07-HEADLESS-HOOKS.md) |
| `packages/icons` | `@callibrator/icons` | target | frontend, mobile | [`08-ICONS.md`](./08-ICONS.md) |

The backend consumes **`contracts` only**, as today. No other shared package is imported by the
backend (ADR-134 § A.4) — so the backend's release build (`scripts/build-dist.ts`) keeps compiling
exactly one package.

## Documents

| # | Document | What it decides |
|---|---|---|
| 00 | this file | index, status, reading order |
| 01 | [`01-ARCHITECTURE.md`](./01-ARCHITECTURE.md) | package boundaries, the dependency graph and its rules, platform adapters (ports), versioning inside the monorepo, build and (internal-only) publishing, how web and mobile consume the packages, why the Go backend changes nothing for a client |
| 02 | [`02-TOKENS.md`](./02-TOKENS.md) | one TypeScript source → CSS variables for the web + a React Native theme object; light/dark; status tones with shape and icon; breakpoints and window classes incl. tablet; the generator (decided over Style Dictionary) |
| 03 | [`03-API-CLIENT.md`](./03-API-CLIENT.md) | the typed OpenAPI client; the pluggable auth adapter (web: cookie through the Next proxy; mobile: bearer + rotating refresh in the secure store); error normalisation, 404/409 handling, `Idempotency-Key`, retries |
| 04 | [`04-I18N.md`](./04-I18N.md) | the ID/EN dictionaries, the translator and the plural subset, `Intl` formatters, the code→message map for API errors, and how the web's existing dictionaries migrate |
| 05 | [`05-DOMAIN.md`](./05-DOMAIN.md) | client-side pure rules: due classification (ADR-133, ADR-126), reading a scanned QR (ADR-132, ADR-100), limit preview from contracts (ADR-125), the facility capability check (ADR-124 Am. 1, ADR-102), the state→tone registry |
| 06 | [`06-SYNC-ENGINE.md`](./06-SYNC-ENGINE.md) | the outbox, frozen ops, idempotency keys, `client_ref`, conflict classification, purge rules — derived from P19-08 — behind storage, crypto, clock, network and scheduler ports (IndexedDB + WebCrypto vs SQLCipher + Keychain/Keystore) |
| 07 | [`07-HEADLESS-HOOKS.md`](./07-HEADLESS-HOOKS.md) | React hooks with no DOM and no React Native import: query hooks on TanStack Query with tenant-keyed caches, capability, formatting, sync status |
| 08 | [`08-ICONS.md`](./08-ICONS.md) | the semantic icon map onto one glyph set (Lucide) for `lucide-react` and `lucide-react-native` |
| 90 | [`90-CONVENTIONS.md`](./90-CONVENTIONS.md) | naming, folder layout, exports, testing at 100 % (as `contracts`), the no-platform-import guard, changelog and versioning, deprecation |

Backend-for-mobile (the server side the app needs) is in the MOBILE folder, written alongside this
one: [`../MOBILE/20-BACKEND-FOR-MOBILE-NODE.md`](../MOBILE/20-BACKEND-FOR-MOBILE-NODE.md) (today's
Express/TypeScript backend) and [`../MOBILE/21-BACKEND-FOR-MOBILE-GO.md`](../MOBILE/21-BACKEND-FOR-MOBILE-GO.md)
(the same capabilities in the Go engine, ADR-089).

## Reading Order

1. `01` — the rules every package obeys. Nothing else makes sense without the dependency graph.
2. `90` — before writing a line in any package.
3. The package you are touching. `03` and `06` carry security weight (tokens, offline data at rest);
   read `docs/SECURITY/05`, `docs/SECURITY/15` and ADR-127 Am. 1 before changing either.

## What These Documents Inherit, Unchanged

The packages are **client** code (except `contracts`). They change no server rule:

- **Tenant and facility scope are the server's** (`docs/SECURITY/05`, ADR-124). No package computes
  scope, sends a `tenantId`, or trusts a `clientFacilityId` it was given.
- **Authorization is not a client concern** (`docs/FRONTEND/00` § Authorization, ADR-102): a client
  hides what the server's effective permission denies; it never derives a permission from a role name.
- **The contract comes first** (owner decision 2026-10-08, ADR-136): the language-neutral root
  `contracts/` folder (OpenAPI 3.1, AsyncAPI 3, behaviour spec) is the source of truth;
  `@callibrator/api-client` is generated from it, and every refusal a client acts on has a stable
  machine `code` there (`01` § 4).
- **The envelope** (`CLAUDE.md`): rows in `data`, paging in a top-level `meta`. Unwrapped once, in
  `api-client`.
- **404 for another tenant's or facility's row; 409 is a state explanation** — surfaced by
  `api-client` and worded by `i18n`, never a generic error.
- **Status is shape + icon + text; colour is the third channel** (ADR-122 § 6).
