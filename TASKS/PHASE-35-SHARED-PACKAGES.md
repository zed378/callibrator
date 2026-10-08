# Phase 35 — Shared Packages · Index of the Mobile Group (Phases 35 … 40)

> **Index of the mobile group, Phases 35 … 40 — one plan** (owner decision 2026-10-08): the shared
> packages, the backend for mobile (its **Node variant** here, Phase 36; its Go variant after Phase 999),
> and the native app (Expo + EAS, Android and iOS, phone and
> tablet). This file holds the group's phase list and build order (§ 1), the group-wide Definition of
> Done (§ 2), the owner questions it carries (§ 3), and the cards of Phase 35 itself (§ 4).
> Decisions: **ADR-134** (shared packages; backend for native clients), **ADR-135** (the mobile app).
> Documents: [`docs/SHARED/`](../docs/SHARED/00-README.md), [`docs/MOBILE/`](../docs/MOBILE/00-README.md).
> Origin: the owner's brainstorm and decisions of 2026-10-08 ([`BACKLOG.md`](./BACKLOG.md) D-11).
> **Only the backend for mobile has two variants:** Node (Phase 36, this group) and Go (after Phase 999,
> Phase 1000 — [`PHASE-1000-MOBILE-BACKEND-GO.md`](./PHASE-1000-MOBILE-BACKEND-GO.md), cards P1000-01 … P1000-16, by
> its author). The packages and the app are one plan, bound to the backend-agnostic contract of Phases 32 … 34
> (ADR-136), not to an engine.
>
> ← Phase 34 — the backend-agnostic API contract group, Phases 32 … 34 (ADR-136; files by their author) · [Phase 36 — Backend for Mobile, Node](./PHASE-36-MOBILE-BACKEND-NODE.md) →

> **Ringkasan (Bahasa Indonesia).** Kelompok fase 35 … 40 membangun **paket bersama** (token desain,
> klien API, i18n, aturan domain, mesin sinkronisasi, *hooks*, peta ikon) yang dipakai web dan aplikasi
> seluler, **backend untuk aplikasi seluler** di backend TypeScript yang sekarang (token *bearer* +
> *refresh* untuk aplikasi native, notifikasi *push*, SSO lewat *app link*, *passkey* native, batas
> versi aplikasi), lalu **aplikasi React Native (Expo + EAS)** untuk Android dan iOS, ponsel dan tablet.
> Yang dibagi hanya **logika dan token desain**; setiap platform menggambar UI-nya sendiri. PWA offline
> (`/field`) tetap ada. Semua kartu **BLOCKED** sampai kontrak API yang netral-backend (Fase 32 … 34) selesai.

| | |
|---|---|
| **Status** | **BLOCKED** — 11 cards: 11 BLOCKED (written 2026-10-08; nothing built) |
| **Goal** | the eight packages of `docs/SHARED/` exist, the web consumes them with **no behaviour change**, and the app can be born on them |
| **Depends on** | **Phase 34 DONE** — the backend-agnostic contract group (Phases 32 … 34, ADR-136), which itself follows Phase 31; Phase 22's P22-10 (the PWA sync engine) DONE or formally deferred |
| **Size** | L |
| **Cards** | 11: P35-01 … P35-11 (P35-11 optional, not exit-blocking) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus** the group-wide DoD (§ 2) **plus** [`docs/SHARED/90-CONVENTIONS.md`](../docs/SHARED/90-CONVENTIONS.md) for every package card |

---

## 1. The Group — Phases and Build Order

| Phase | File | Goal | Depends on |
|---|---|---|---|
| **35** | this file | shared packages; the web migrated onto them, behaviour-neutral | Phase 34 |
| **36** | [`PHASE-36-MOBILE-BACKEND-NODE.md`](./PHASE-36-MOBILE-BACKEND-NODE.md) | the backend for native clients on the TypeScript backend (`docs/MOBILE/20`) — the **Node variant** | Phase 34; P35-06 for the regenerated client |
| **37** | [`PHASE-37-MOBILE-APP-FOUNDATION.md`](./PHASE-37-MOBILE-APP-FOUNDATION.md) | `apps/mobile`: Expo + EAS, navigation, theme, i18n, sign-in (password + MFA), sessions, app lock, configuration, CI | P35-10, P36-01 … P36-03, P36-07 |
| **38** | [`PHASE-38-MOBILE-FIELD-CAPTURE.md`](./PHASE-38-MOBILE-FIELD-CAPTURE.md) | QR, camera, device registration, IPM capture online and **offline** (SQLCipher + the shared sync engine), conflicts, purge, shared phones, attestation | Phase 37; P36-09 |
| **39** | [`PHASE-39-MOBILE-ROLES-TABLET-NATIVE.md`](./PHASE-39-MOBILE-ROLES-TABLET-NATIVE.md) | facility staff, IPSRS, auditor, manager screens; tablet layouts; push; hospital SSO; passkeys; app links; accessibility | Phase 37; P36-04 … P36-06, P36-08 |
| **40** | [`PHASE-40-MOBILE-RELEASE.md`](./PHASE-40-MOBILE-RELEASE.md) | distribution, OTA policy, MDM, security review, real-device and field UAT, the first production release, group exit | Phases 38, 39 |

```text
Phase 34 exit (the contract group, ADR-136)
      │
      ▼
P35-01 ─▶ P35-02 tokens ─▶ P35-03 icons ─┐
   │  ─▶ P35-04 i18n ────────────────────┤
   │  ─▶ P35-05 domain ──────────────────┤
   │  ─▶ P35-06 api-client ──────────────┼─▶ P35-07 sync-engine ─▶ P35-08 hooks ─▶ P35-09 docs ─▶ P35-10 exit
   │                                     │
   └─▶ Phase 36 (P36-01 … P36-14, in parallel with P35-02 … P35-08; P36-07+ need P35-06)
                                         │
                                         ▼
                       Phase 37 ─▶ Phase 38 ─┐
                               └─▶ Phase 39 ─┴─▶ Phase 40 (exit: P40-08)
```

**Roadmap position:** after the contract group (Phases 32 … 34, which follow Phase 31), **before
Phase 999** (owner decisions 2026-10-08). The Go variant of the **backend for mobile only** runs after
Phase 999 (Phase 1000+); the packages and the app do not change for it.

## 2. Group-wide Definition of Done (every card of Phases 35 … 40 inherits it)

Added to the global DoD, not instead of it:

- [ ] **Target → as built:** every `docs/SHARED/` or `docs/MOBILE/` statement the card makes true is
      swept from TARGET to as built **in the same change**, naming source files; anything the card
      found wrong goes through the deviation protocol (ADR-134 / ADR-135 amendment), never a quiet edit
- [ ] **No platform import in a shared package** — the three guards of `docs/SHARED/90` § 5 green
- [ ] **Behaviour-neutral web migration:** a card that moves web code into a package names the web
      tests that pin the behaviour and shows them **unchanged** in case names and count, plus one
      uninterrupted live E2E run (`make test-e2e`) on the card's tree
- [ ] **Bundle budget held:** `next build` within budget (`/` ≤ 150 KB gzip), measured on the card's tree
- [ ] **Images build:** the frontend (and, where touched, backend) Docker image builds with the new
      packages in its allow-list (ADR-046, ADR-097 implications)
- [ ] **Tenant and facility scope:** every new route — two-tenant **and** two-facility tests where it has
      a path parameter (`twoTenantSuite`, `twoFacilitySuite`, `@two-tenant`/`@two-facility`), a gate or
      a reviewed exemption, a facility-accessible decision (ADR-124 Am. 1); every client cache key starts
      with the tenant (`docs/SHARED/07` § 3)
- [ ] **Contract first:** every new or changed route, event and error `code` is written into the root
      `contracts/` folder (OpenAPI 3.1 / AsyncAPI 3 / behaviour spec, ADR-136) **before** its code, with a
      stable machine `code` for every refusal; the backend conforms (its `*.openapi.ts` and the conformance
      gate of ADR-136 green; `openapi:breaking` passes); `@callibrator/api-client` regenerated from `contracts/` and
      `api:types:check` green
- [ ] **No secret** in a response, a log, `audit_logs.changes`, the app bundle, an OTA update or a crash
      report (tokens, device tokens, verifiers, codes, keys)
- [ ] **Mobile release procedure** (`docs/MOBILE/08` § 8) for any card that ships a binary or an OTA update
- [ ] **Evidence named:** every test the card relies on is named in its record; real-device runs are
      recorded as named runs with devices, OS versions and app version

## 3. Owner Questions Carried by the Group

The design decisions were made under the owner's delegation and recorded in ADR-134 and ADR-135 with
their alternatives. **Q-58 … Q-61 were answered by the owner on 2026-10-08**; Q-M1 … Q-M4 remain open:

| # | Question | Recommendation | Blocks |
|---|---|---|---|
| Q-58 (ADR-134) | Native ingress: path prefix `/native/` on the platform host, or a separate `api.<domain>` host? | **decided (owner, 2026-10-08): the `/native/` path prefix** | — |
| Q-59 (ADR-134) | Native session absolute lifetime: 30 days (re-sign-in monthly) — or longer for field technicians? | **decided (owner, 2026-10-08): 30 days absolute; a tenant may shorten it** | — |
| Q-60 (ADR-134) | Extend refresh-reuse detection to **web** sessions (needs a grace window for racing tabs)? | **decided (owner, 2026-10-08): mobile only for now; web revisited with a cross-tab refresh lock** | — |
| Q-61 (ADR-134) | Reserve the `@callibrator` scope on npm (squatting protection for the private packages)? | **decided (owner, 2026-10-08): yes** — owner to-do: create the free npm organisation `callibrator` (BACKLOG) | — |
| Q-M1 … Q-M4 (ADR-135) | store identity and app id; production hosts in the binary; Android fallback listing; EAS plan and device lab budget | `docs/MOBILE/08` § 9 | Phases 37, 37 |

These are recorded in [`BACKLOG.md`](./BACKLOG.md) (Open Questions) by the change that wrote this plan.

---

## 4. Cards (Phase 35)

### P35-01 — Entry check, the package template and the guards

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | Phase 34 DONE (the contract group, ADR-136) |
| **Spec refs** | `docs/SHARED/00-README.md` · `docs/SHARED/01-ARCHITECTURE.md` §§ 2, 5–7, 11 · `docs/SHARED/90-CONVENTIONS.md` · ADR-097 · ADR-134 |
| **Spec required** | no |

**Why:** eight packages built without a shared template and guard would each invent its own lint,
coverage and boundary — the drift the packages exist to prevent.

**Definition of Done**
- [ ] `docs/SHARED/` re-read against the code at the card's start; any statement the code now contradicts corrected through the deviation protocol first (the docs are dated 2026-10-08)
- [ ] A shared strict `tsconfig` base for packages (`lib: ["ES2025"]`, `types: []`, the ADR-038 flags) and an ESLint config with `docs/SHARED/90` § 5's restricted imports and globals, used by `contracts` too (its own rules unchanged or stricter)
- [ ] `scripts/ci/sharedPackages.guard.test.ts`: refuses a platform import, a platform global, an edge outside `01` § 2's graph, and a `domain` export that shadows a `contracts` export — **mutation-checked**: one planted violation of each kind fails it
- [ ] The "one copy" tests: one Zod (existing, extended to future consumers) and one React per app (`01` § 11) — written as the pattern the app's card will instantiate
- [ ] CI runs `lint`, `typecheck`, `test` for every `packages/*` (the job list extended); `turbo` pipeline includes them
- [ ] The frontend `Dockerfile` and `Dockerfile.dockerignore` carry a **pattern** that includes each `packages/<name>` (manifest before `npm ci`, `src/` before `next build`, tests and `node_modules` excluded), proved by building the image
- [ ] Q-48 closed in `BACKLOG.md` by reference to ADR-134 (`packages/contracts` stays; no `shared/`)
- [ ] The `@callibrator` npm organisation's existence confirmed (owner to-do, Q-61) — or its absence recorded as the owner's open action

**Abuse cases**
- A guard that scans only `src/index.ts`, so a deep module's platform import passes
- Coverage met by excluding files from the package's jest config without a recorded reason

### P35-02 — `@callibrator/tokens` and the web's colours moved onto it

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P35-01 |
| **Spec refs** | `docs/SHARED/02-TOKENS.md` · ADR-090 (and its brand-colour amendment) · ADR-118 · ADR-122 §§ 5–6 · `frontend/src/app/globals.css` · `frontend/src/app/public-surface.css` · `frontend/src/lib/{statusTone,priority,brandColor,readableOn}.ts` |
| **Spec required** | no |

**Why:** the app must draw the same brand and the same five tones; the values live today only in the
web's stylesheet.

**Definition of Done**
- [ ] Package per `02` § 3; the TypeScript source holds every role of `02` § 4.1 in both themes, the five tones with fill/icon/tints, type, space, radius, elevation, motion, breakpoints and window classes, the brand derivation and `readableOn`
- [ ] `scripts/build-css.ts` writes `generated/tokens.css`; `tokens:check` in CI fails on drift
- [ ] `globals.css` imports the generated file; the resolved `:root` and `.dark` custom properties are **identical before and after**, compared property by property (test named in the record)
- [ ] The duplicated `--pub-*` values reference the semantic variables; the public pages render identically (browser smoke + the accessibility suite green)
- [ ] The ADR-090 contrast tests run against the package's objects at 100 %, unchanged in what they assert; `brandColor.test.ts` moved with its function
- [ ] `createTheme(scheme, { brand })` implemented and tested (used by Phase 37)
- [ ] `brandRamp(primaryColor, scheme)` (`02` § 4.4, owner decision 2026-10-08): OKLCH ramp, the ADR-090 pairs guarded, **copper fallback** when no step passes — tested with extreme, invalid and null inputs; a test proves no status tone or `status-*` role changes for any brand input

**Abuse cases**
- "Identical" claimed from a visual glance instead of a property-by-property comparison
- A contrast pair dropped from the test because it fails after the move

### P35-03 — `@callibrator/icons`

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P35-02 |
| **Spec refs** | `docs/SHARED/08-ICONS.md` · ADR-122 § 6 · ADR-090 (icon-only controls named after their object) |
| **Spec required** | no |

**Why:** the same meaning must show the same symbol on the web, the PWA and the app.

**Definition of Done**
- [ ] The semantic map, with every meaning the web already shows mapped to the **as-built** glyph (no screen changes)
- [ ] `LucideGlyphName` generated from the installed glyph list; a removed or misspelt glyph fails the typecheck
- [ ] The web's one `Icon` component resolves names; the tone badges use it; rendered SVGs of the five tones unchanged (snapshot)
- [ ] The five status icons asserted equal to ADR-122's

**Abuse cases**
- Mapping a meaning to a new glyph "while we are here" — a visible change smuggled into a refactor

### P35-04 — `@callibrator/i18n` and the web's dictionaries split

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P35-01 |
| **Spec refs** | `docs/SHARED/04-I18N.md` · ADR-098 § 4 and Am. 2 · `frontend/src/i18n/*` · P19-08 § 9.6 (`field.conflicts.*`) |
| **Spec required** | no |

**Why:** the app is Indonesian-first; it must use the same words, error explanations and formatters as
the web and the PWA.

**Definition of Done**
- [ ] `config`, `format`, `translate` moved unchanged; `frontend/src/i18n/index.ts` re-exports them (no web import changes)
- [ ] The plural subset (`{n, plural, …}`) with `Intl.PluralRules`; a dictionary test refuses a missing `other` branch
- [ ] Formatters of `04` § 4 with the tenant's time zone; decimals formatted without a float round-trip where precision matters
- [ ] Shared namespaces (`common`, `errors`, `status`, `field`, `auth`, `verify`) moved per `04` § 5; the merged web dictionary compared key by key and value by value before and after (identical)
- [ ] `errors.conflict.<CODE>` exists in both locales for every code in contracts' tuples (test)
- [ ] `status.<domain>.<state>` keys with the as-built English words as the `en` values verbatim
- [ ] `i18n.p1002.test.ts` and `copyTruthfulness.p1011.test.ts` unchanged and green; bundle budget held

**Abuse cases**
- A string "improved" during the move (copy changes need their own card and, for claims, their source row)
- A test that checks only that both locales have the same keys, not that moved values are unchanged

### P35-05 — `@callibrator/domain`

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P35-02, P35-04 |
| **Spec refs** | `docs/SHARED/05-DOMAIN.md` · ADR-102 · ADR-122 § 6 · ADR-124 Am. 1 · ADR-125 Am. 1 · ADR-126 Am. 1–2 · ADR-132 · ADR-133 · `MEMORY/specs/P19-02…`, `P19-03…`, `P19-05…`, `P19-06…` |
| **Spec required** | no |

**Why:** both clients must read a scan, classify a due date and decide what to offer the same way —
without ever re-implementing a rule the server enforces.

**Definition of Done**
- [ ] `presentDue`/`recomputeDueOffline`, `readScan`, `limitHint`/`previewOutcome`/`checklistProgress`, `can`/`canInvoke`, `STATE_TONES`/`toneOf`, `actorLabel`, `performerLabel`, `buildIpmReportPreview`, `buildIpmReportLayout` — each composing contracts' functions where `05` § 1 says so, never re-implementing them
- [ ] The web's `statusTone.ts` registry, `actorLabel.ts` and `menuAccess.ts` moved with their tests (same case names and count); the web's badges unchanged
- [ ] `readScan` refuses a foreign-host URL, parses certificate and IPM-report verification URLs without fetching them, and normalises a bare code through `normaliseQrCode` — cases from P19-03 § 4.2 and ADR-100
- [ ] The tone mappings for the upstream states (IPM session, recommendation, condition, sync) added with the design rationale in the record
- [ ] The shadowing guard of P35-01 green

**Abuse cases**
- A local copy of `normaliseQrCode` "to avoid the dependency" — the exact drift the boundary forbids
- `can()` that falls back to a role name when the permission is missing

### P35-06 — `@callibrator/api-client`, the generated types moved, the web on it with axios underneath

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P35-01, P35-04 |
| **Spec refs** | `docs/SHARED/03-API-CLIENT.md` · ADR-103 · ADR-059 · ADR-074 · F-05, F-07, A-123, A-160, A-71 · `frontend/src/api/{client,typed}.ts` · `docs/MOBILE/20-BACKEND-FOR-MOBILE-NODE.md` § 6 (credential endpoints) |
| **Spec required** | no |

**Why:** one generated client, one envelope unwrap, one error model, one refresh rule for both clients.

**Definition of Done**
- [ ] `generated/schema.d.ts`, `api:types` and `api:types:check` moved into the package and **generated from the root `contracts/` OpenAPI 3.1 files** (ADR-136), not from `backend/openapi.json`; CI checks it there
- [ ] `createApiClient` with the `FetchLike` and `AuthAdapter` ports, single-flight refresh, one retry, the credential-endpoint table, `unwrap`/`unwrapList` (refusing `data.rows`), `ApiError` and the classification table of `03` § 6.2, `Idempotency-Key` typed only where the operation declares it, the retry table of § 6.4
- [ ] A guard test checks the credential-endpoint table against the backend's auth route files
- [ ] The tenant-hint injector (`X-Tenant-Code`, never `x-tenant-id`) and `createBrandingCache` with the `BrandingStore` port (`03` § 5a): ETag revalidation, offline read, `clear()` on tenant switch, a 404 returning to setup — tested; the web passes no hint (test)
- [ ] The web's `typedApi` built on the package with the **axios transport kept** (`03` § 4); `client.session.f05`, `client.passwordChange.a123`, `client.mfaEnrolment.a160`, `typed.test.ts` and every service contract test **unchanged and green**
- [ ] One uninterrupted live E2E run on the card's tree (named in the record)

**Abuse cases**
- Tests of the client that mock a fabricated envelope instead of producing it from contracts' envelope schemas
- Replacing axios in the same card "because it was easy" — that is P35-11, with its own proof

### P35-07 — `@callibrator/sync-engine`, extracted from (or built for) the `/field` PWA

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P35-05, P35-06; P22-10 DONE (or formally deferred — then the engine is built here against P19-08) |
| **Spec refs** | `docs/SHARED/06-SYNC-ENGINE.md` · `MEMORY/specs/P19-08-offline-field-capture.md` · ADR-127 + Am. 1 · `docs/MOBILE/04-OFFLINE-FIELD-CAPTURE.md` · `docs/SECURITY/15` |
| **Spec required** | **yes** — `MEMORY/specs/P35-07-sync-engine-extraction.md`: the port signatures as finally narrowed, the move map from `frontend/src/field/` (or the build plan), and the proof plan |

**Why:** the code that can lose or duplicate regulated work must exist once.

**Definition of Done**
- [ ] The engine (model, planner, freeze, runner, classify, working set, purge, registry) in the package behind the ports of `06` § 4; the web adapters (IndexedDB + WebCrypto, registry, scheduler, network) stay in `frontend/src/field/platform/`
- [ ] P19-08's numbers are defaults the app cannot loosen (construction refuses a looser value — tested)
- [ ] Planner property tests (`06` § 10) and the purge table row by row with the outbox asserted untouched — **mutation-checked** (a purge that drops `ops` fails a named test)
- [ ] The PWA proof re-run after the move: P19-08 § 16's unit, browser and live suites unchanged, and the PWA real-device script (Android + iPhone) as a named run
- [ ] 100 % at the package gate

**Abuse cases**
- An adapter that quietly keeps a plaintext index of QR codes in IndexedDB "for speed"
- A purge path that calls a generic "clear database" and takes the outbox with it

### P35-08 — `@callibrator/hooks`

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P35-05, P35-06, P35-07 |
| **Spec refs** | `docs/SHARED/07-HEADLESS-HOOKS.md` · `docs/FRONTEND/00` § API Access · `docs/FRONTEND/05-RBAC-IN-UI.md` · ADR-102 |
| **Spec required** | no |

**Why:** the app must not re-implement fetching, paging, envelope handling or capability checks.

**Definition of Done**
- [ ] The hooks of `07` § 4 and `CallibratorProvider`; `react` and `@tanstack/react-query` as peers only
- [ ] Key factories with the tenant prefix; a guard test enumerates them — **mutation-checked**
- [ ] The cache cleared on sign-out, tenant switch, scope loss and fingerprint change (tests per event)
- [ ] Tests in a node environment (no jsdom) at 100 %
- [ ] One web screen converted as the reference (chosen in the record, among screens changing anyway), its tests unchanged; `docs/FRONTEND/02-STATE-MANAGEMENT.md` amended (two styles coexist, and why)

**Abuse cases**
- A key factory with an optional tenant ("for public data") that ends up on a tenant resource
- Persisting the query cache for faster cold starts

### P35-09 — Documents: superseded plans re-scoped; `docs/SHARED/` swept to as built

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P35-02 … P35-08 |
| **Spec refs** | ADR-134 § A.10 · `docs/ARCHITECTURE/11`, `12` · `docs/FRONTEND/12`, `13` · `TASKS/PHASE-999-…` P999-01/18/19 · `CLAUDE.md` (stack table) · `docs/README.md` |
| **Spec required** | no |

**Why:** a plan that still describes `shared/components` and a per-backend frontend adapter will be
built by someone (PR-4).

**Definition of Done**
- [ ] The superseded sections rewritten (not just bannered) to `packages/*` and one generated client; P999-01/18/19 re-scoped in the Phase 999 file with the reason
- [ ] Every `docs/SHARED/` document swept from TARGET to as built where built, naming files
- [ ] `CLAUDE.md`'s frontend row and Scale row updated (packages counted with the date)

**Abuse cases**
- Marking a document "as built" for a section whose code is still a plan

### P35-10 — Phase exit

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P35-01 … P35-09 |
| **Spec refs** | `TASKS/00-TASK-CONVENTIONS.md` · `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md` § Definition of Phase Complete · `docs/SHARED/01` § 11 |
| **Spec required** | no |

**Why:** the app (Phase 37) builds on these packages; it must start on a proven base.

**Definition of Done**
- [ ] `make verify` green; live E2E **twice back to back** in one uninterrupted run each; browser and accessibility suites green; bundle budget within
- [ ] Frontend and backend images built and booted on a disposable compose stack
- [ ] Cold `next build` and dev-start times measured before and after the packages (the source-only risk of `01` § 11), recorded with the hosts
- [ ] Phase summary in `MEMORY/` (shipped, deviated, deferred, watch); `PROGRESS.md` updated

**Abuse cases**
- An E2E pass assembled from several partial runs

### P35-11 — Optional: a fetch transport replaces axios on the web

| | |
|---|---|
| **Status** | BLOCKED (optional; not exit-blocking) |
| **Depends on** | P35-10 |
| **Spec refs** | `docs/SHARED/03-API-CLIENT.md` §§ 4, 9 · `frontend/src/api/client.ts` · F-05, F-07, F-14, F-16 |
| **Spec required** | **yes** — the behaviour inventory of `client.ts` (timeouts, multipart, redirects, access-denied store, error shapes) and how each is preserved |

**Why:** two HTTP layers on the web cost bundle size and reasoning; removing one is only worth it with
every pinned behaviour proved.

**Definition of Done**
- [ ] Every behaviour of the inventory preserved, each by a named test that fails on the axios-removed tree if it is not
- [ ] Bundle size reduction measured; live E2E twice in one run each

**Abuse cases**
- Rewriting the pinned tests to fit the new transport
