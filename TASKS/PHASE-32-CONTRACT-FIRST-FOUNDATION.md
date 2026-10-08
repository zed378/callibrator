# Phase 32 — Contract-First Foundation, Behaviour Spec and Error Codes

> Part of the **backend-agnostic contract group, Phases 32 … 34** (ADR-136, [`docs/CONTRACT/`](../docs/CONTRACT/00-README.md)).
> Owner brainstorm and decisions of 2026-10-08: the frontend and the mobile app must never need a
> version per backend, and a port to any language must not need a new frontend. Implementation runs
> **after Phase 31**. The shared packages and mobile (Phases 35 … 40) come after this group, and
> Phase 999 (Go) is built on it.
>
> ← [Phase 31 — Upstream Decommission](./PHASE-31-UPSTREAM-DECOMMISSION.md) · [Phase 33 — Conformance Suite](./PHASE-33-CONFORMANCE-SUITE.md) →

| | |
|---|---|
| **Status** | **BLOCKED** — 10 cards, 10 BLOCKED (written 2026-10-08; nothing built) |
| **Goal** | a language-neutral `contracts/` folder is the single source of truth (OpenAPI 3.1, the behaviour spec, the error-code catalogue, named rules with golden vectors). Node's validators and every client are **generated** from it, and ADR-103's gates point at it |
| **Depends on** | **Phase 31 DONE** (P31-04) |
| **Size** | L |
| **Cards** | 10: P32-01 … P32-10 |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) plus the group rule below |

**Group rule (Phases 32 … 34):**
- **No client-visible behaviour changes except additively.** Each card states its effect on the web,
  the PWA and (later) the app.
- The live E2E suite (57 files) and the frontend jest suite stay green on every card.
- Nothing under `contracts/` is edited without a client-owner reviewer
  ([`docs/CONTRACT/02`](../docs/CONTRACT/02-CONTRACT-FIRST-WORKFLOW.md) § 6).

---

### P32-01 — `contracts/` scaffold and the v1 baseline from the as-built document

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P31-04 |
| **Spec refs** | `docs/CONTRACT/01` § 2 · `docs/CONTRACT/02` § 2 · `docs/CONTRACT/90` § 1 · ADR-103 (as built) · ADR-136 |
| **Spec required** | **yes** — `MEMORY/specs/P32-01-contract-baseline.md` (module grouping for `x-module`, the split layout, the hash of the baseline) |

**Why:** the contract starts as exactly what is served today, so moving the source of truth changes no
behaviour.

**Definition of Done**
- [ ] The as-built `openapi:generate` output normalised, split per module into `contracts/openapi/`, and bundled to `contracts/dist/openapi.json`
- [ ] oasdiff **both ways** between the bundle and the as-built `backend/openapi.json`: **0** changes (a named run); the baseline hash recorded
- [ ] `x-module` on every operation, from the spec's module table (the gateway key)
- [ ] `VERSION` = `1.0.0`, `CHANGELOG.md` started
- [ ] Scalar `/api/v1/docs` and `api:types` read the bundle; `backend/openapi.json` retired as a source (kept only as the equivalence check's per-module output, P32-03)

**Abuse cases**
- Hand-"fixing" the baseline while splitting it (a behaviour change hidden in a refactor)
- Grouping modules by file name instead of by data ownership (the gateway then routes split transactions)

### P32-02 — ADR-103's gates re-pointed at `contracts/`

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-01 |
| **Spec refs** | `docs/CONTRACT/02` § 5 · ADR-103 § 7 · `.github/workflows/ci.yml` (the `api-contract` job) |
| **Spec required** | no |

**Definition of Done**
- [ ] `contract:check` (bundle stale, every generated artefact stale), Spectral at `contracts/.spectral.yaml` (the ADR-103 rules + `x-module`, `x-error-codes`, `x-rule` existence; the legacy baseline carried over shrink-only), oasdiff breaking on `contracts/dist/openapi.json` (v1 additive only), the route-without-doc guard reading `contracts/`, `api:types:check` — all in `make verify` and CI **before** the backend tests
- [ ] Mutation checks: an edited generated file, a breaking change, an unregistered code, and an undocumented mounted route each fail their named gate
- [ ] AsyncAPI parser validation wired (the document itself is P34-05)

**Abuse cases**
- Adding the existing failures to a new baseline (the baseline only shrinks)

### P32-03 — Generate Node's validators from the contract (pilot module) and the equivalence check

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-02 |
| **Spec refs** | `docs/CONTRACT/02` § 3 · ADR-093 (Zod validators) · ADR-097 (`@callibrator/contracts`) · `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` |
| **Spec required** | no |

**Why:** one copy of each shape. The decision (generate, not prove equivalence) is in ADR-136. The
equivalence check holds the modules that have not flipped yet.

**Definition of Done**
- [ ] The OpenAPI → Zod generator chosen under the package rule (candidates and criteria of `02` § 3), pinned, its choice recorded; output loads under `tsx` and the compiled `dist/` (`load:check`)
- [ ] `npm run contract:generate` writes `backend/src/generated/contract/**`; `contract:check` fails when it is stale
- [ ] Pilot: the `vendor` module (ADR-103's pilot) validates with generated schemas; its hand-written validators deleted; its tests unchanged and green; the live E2E vendor specs green
- [ ] **Equivalence check** for every unflipped module: as-built code-first output vs `contracts/` = 0 both ways, a shrink-only list
- [ ] The TypeScript build, typecheck and 100% backend coverage gate stay green

**Abuse cases**
- Editing generated files to make a refinement fit
- Moving a refinement into a controller instead of a named rule (P32-09)

### P32-04 — Every module flipped to generated validators

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-03, P32-09 (for modules with named rules) |
| **Spec refs** | `docs/CONTRACT/02` § 3 · the module list of P32-01's spec |
| **Spec required** | no |

**Definition of Done**
- [ ] Each module flipped in its own change (named tests per module); the equivalence list empty at the end, and its CI step deleted
- [ ] `@callibrator/contracts` hand-written request schemas replaced by generated ones and re-exported unchanged for the frontend (ADR-097's callers keep compiling)
- [ ] No `z.object(` for a request or response shape left in `backend/src` outside generated code (a guard)

**Abuse cases**
- Flipping several modules in one change so a regression cannot be attributed

### P32-05 — The 76 undocumented routes

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-01 |
| **Spec refs** | ADR-103 § 7 (`openapiRoutes.undocumented.json`, 76 on 2026-09-30) · `docs/CONTRACT/02` § 2 step 3 |
| **Spec required** | no |

**Definition of Done**
- [ ] Every route on the list documented in `contracts/` from its as-built behaviour, or classified **internal** (not part of the public contract, served on the internal mount only) with a reason
- [ ] The list deleted; the guard has no allow-list left

**Abuse cases**
- Classifying a route the web calls as "internal"

### P32-06 — The behaviour spec into `contracts/behaviour/`, and the required extensions

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-01 |
| **Spec refs** | `docs/CONTRACT/03` (the draft) · `docs/CONTRACT/90` § 3 · `docs/API/00-API-STANDARDS.md` · `docs/API/14-BACKEND-INTEROPERABILITY-CONTRACT.md` · ADR-059, ADR-128, ADR-126 Am. 1 |
| **Spec required** | no |

**Definition of Done**
- [ ] `contracts/behaviour/*.md` holds every `B-*` rule, each marked as built or with the card that builds it; `docs/CONTRACT/03` becomes a pointer; `docs/API/00` and `14` amended to point at it (deviation protocol, ADR-136)
- [ ] Every operation carries the required extensions (`x-permission`, `x-tenant-scoped`, `x-facility-accessible`, `x-audited`, `x-rate-limit`, `x-error-codes`, `x-credential-endpoint`, `x-idempotent`, `x-etag`, `x-upload` where they apply); Spectral enforces them
- [ ] The additive gaps closed in Node: the 429 envelope (B-ENV-5); `data: null` on every error

**Abuse cases**
- Writing a rule as "as built" without the file and line that shows it

### P32-07 — The error-code catalogue and the universal `code` field

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-06 |
| **Spec refs** | `docs/CONTRACT/04` · `backend/src/utils/response.util.ts#error` (as built, `extra`) · `frontend/src/i18n/apiErrors.ts` · `docs/SHARED/04-I18N.md` · `docs/MOBILE/20` § 13a |
| **Spec required** | no |

**Definition of Done**
- [ ] `contracts/errors/codes.yaml` with its schema; the codes of `04` § 5 registered with `id` and `en` messages
- [ ] Node sends a top-level `code` on **every** error response (the generic codes at least, `VALIDATION_FAILED` with per-field codes); a test asserts no error response lacks it
- [ ] `packages/i18n` (or, before Phase 35, `frontend/src/i18n/apiErrors.ts`) generates its code keys from the registry
- [ ] The P19-02 / P19-08 `data.code` wording aligned by their spec owners to the top-level `code` (`04` § 2), or recorded as pending with the owner named

**Abuse cases**
- A code that distinguishes not-found from not-yours (B-STATUS-2)

### P32-08 — Codes for every module's prose errors

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-07 |
| **Spec refs** | `docs/CONTRACT/04` § 5 |
| **Spec required** | no |

**Definition of Done**
- [ ] Every `error(…)` / `conflict(…)` / `forbidden(…)` call site in `backend/src` inventoried; each gets a registered code; module by module, additive
- [ ] Every 409 has a specific code and a state explanation (B-STATUS-3)
- [ ] The frontend shows translated messages by code for the codes it handles; screens never parse `message`

**Abuse cases**
- One `CONFLICT` code reused for every 409

### P32-09 — Named rules and golden vectors

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-01 |
| **Spec refs** | `docs/CONTRACT/01` § 2 (`rules/`, `vectors/`) · ADR-132 § 1 (`normaliseQrCode`) · ADR-126 § 6 + Am. 1 § 10 (`computeIpmDue`) · ADR-126 Am. 2 § 4 (`ipm-report-v1`) · ADR-125 Am. 1 (measured-value parser, limits) · P19-02 § 9.4 (`missingRequiredItems`) · P19-08 § 9.5 (scope fingerprint) |
| **Spec required** | no |

**Why:** these rules run in the server **and** the clients. A port in another language must reproduce
them exactly. The vectors are the language-neutral proof.

**Definition of Done**
- [ ] Each rule written in `contracts/rules/<id>.yaml` (statement, inputs, outputs, edge cases)
- [ ] Vectors in `contracts/vectors/<id>.json` covering every branch and the edges (decimal comma/point, NFC/NFD, padding, month boundaries in the tenant zone, leap days, empty and maximal inputs)
- [ ] The TypeScript implementations (`@callibrator/contracts`) pass the vectors; CI fails when a rule's implementation changes without new vectors
- [ ] **The vectors are written from the rule's statement and the existing tests, not generated from the implementation** (consistency is not correctness)

**Abuse cases**
- Generating vectors by running the TypeScript function

### P32-10 — Exit

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-01 … P32-09 |
| **Spec refs** | `docs/CONTRACT/` · `TASKS/00-TASK-CONVENTIONS.md` |
| **Spec required** | no |

**Definition of Done**
- [ ] `docs/CONTRACT/00`–`04` and `90` amended from TARGET to as-built where built
- [ ] Record, index line, CHANGELOG, PROGRESS in the same commit; Phase 33 unblocked
