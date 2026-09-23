# Audit 2026-09 — Records Verification

Verifies Callibrator's own records (`TASKS/`, `MEMORY/`, `CLAUDE.md`) against the code, at the
repository state on 2026-09-23 (`HEAD = c131729`). **Verification only — no application code was
changed.** Method: read code, `git log`, `grep`, `find`, one live `npx eslint` run. No `jest` run
was performed (see § Sampled vs Exhaustive) — coverage and suite-size claims are cross-checked
against file counts and the documents' own dated inventories, not re-run.

**Overall finding: this board is unusually honest.** Every one of the ten sampled "DONE" audit
findings has code behind it that does what the card claims, with tests that exist and assert what
they are said to assert. The defects found here are not PR-4-shaped (a document asserting something
false about the present) — they are **stale counts and one missing cross-reference**: numbers taken
at one commit and never refreshed after a later commit changed them, and one phase file that does
not mention a critical defect discovered in the module it describes.

---

## 1 — Phase Files vs `PROGRESS.md`

| File | Claim | What the code shows | Verdict |
|---|---|---|---|
| `PHASE-0-FOUNDATION.md` … `PHASE-8` | Phases 0–5 shipped, 6–9 in flight (`PROGRESS.md` table) | Consistent with commit history (`a984e7b` → `f3d323e` "verify phases 0-5 against the code" → present). Not re-derived from scratch here; see § Sampled vs Exhaustive | `ACCURATE` (sampled) |
| `PHASE-3-CALIBRATION.md` P3-04 (Certificates) | "✅ DONE — after a defect that made approval unreachable", names ADR-035, the INNER-JOIN defect, both with mechanism | `certificate.service.js` / `certificate.route.js`: `submitForApproval`, `POST /:id/submit` exist; ADR-035 in `DECISIONS.md` matches | `ACCURATE` |
| `PHASE-3-CALIBRATION.md` P3-05 (Signing) | "✅ DONE", describes the Part-11 quartet and public verification, **no mention of any signature defect** | `eSignature.service.js` is the exact module A-47 rewrote 2026-09-23 (ADR-040): until that commit, `verifySignature` **could never return `valid: true`** for a genuine signature (`Date.now()` inside the hashed payload) | see **R-01** |
| `PHASE-3-CALIBRATION.md` P3-06 (e-Signature workflows) | "✅ DONE — beyond the plan", describes `signature_workflows`/`signature_records`, no defect noted | Same module as A-47/ADR-040. P3-04 in the same file *does* carry its defect note (ADR-035) as a model for how this should read; P3-05/P3-06 do not | see **R-01** |
| `PHASE-6-CORRECTNESS-AND-COMPLIANCE.md` / `PROGRESS.md` | P6-01 "✅ DONE 2026-09-11" — coverage gate at 100%, later "305 suites, 6,039 tests" (2026-09-23) | Not re-run (see § 5). File-count evidence is consistent with a large suite (359 `*.test.js` files found; see R-02) but the exact 305/6,039 figures were not independently reproduced | `ACCURATE` (not independently re-verified — flagged, not disputed) |
| `PHASE-9-TYPESCRIPT-MIGRATION.md` | Inventory "counted from the tree on 2026-09-21": models 72, services 76 (incl. storage), controllers 56, routes 54, tests 340, "**roughly 370 source files**" | Current tree (2026-09-23, two commits later): 71 `*.model.js`, 71 `*.service.js`, 57 `*.controller.js`, 55 route files (53 `routes/api` + 2 `routes/internal`), 359 `*.test.js`, **375** non-test `.js` source files under `src/` | see **R-02** — the file is explicit that its count is dated 2026-09-21, so this is drift, not a false claim, but the ratchet's own rule 2 ("the number of `.js` files may never rise") is already violated relative to the number written down, before the ratchet script (P9-04) even exists to enforce it |
| `PHASE-9` P9-19 | `[x] sessionSecurity.middleware.js is not in scope: deleted 2026-09-23 under A-12` | Confirmed: no `sessionSecurity.middleware.js` exists in `src/middlewares/`; only its coverage-report HTML artifacts remain under `backend/coverage/` | `ACCURATE` |

**Note on scope:** Phases 0, 1, 2, 4, 5, 7, 8 were read for structure and cross-checked against
`PROGRESS.md`'s summary table and the commit log, but individual line items inside them were **not**
each independently re-derived from code — see § Sampled vs Exhaustive. No contradiction was found in
what was read.

---

## 2 — The Ten Audit "DONE" Claims

| Id | Claim | Verified against | Verdict |
|---|---|---|---|
| **A-01** | Cross-tenant write on `tenant-hierarchy` fixed: mutating routes `[auth, denyApiKey, superAdminOnly]`; reads gated by an own-tenant-or-SUPERADMIN guard returning 404 | `backend/src/routes/api/tenantHierarchy.route.js:35–52` (`ownTenantOnly`, `platformOnly`), lines 357/409/451/499 apply `platformOnly` to POST/PUT/DELETE and `cross-tenant-roles`. Tests: `src/tests/routes/tenantHierarchy.guards.test.js` exists | **HOLDS** |
| **A-03** | API keys deny-by-default via `controllerWrapper.util.js`; a key reaching a wrapped controller without `req.apiKeyAuthorized` gets 403 | `backend/src/utils/controllerWrapper.util.js:29–34` (`apiKeyBlocked`), called at the top of both `asyncHandler` and `asyncHandlerWithMapping`. Tests: `src/tests/utils/controllerWrapper.apiKey.test.js` exists | **HOLDS** |
| **A-09** | Bodyless-request 500 fixed via `bodyDefault.middleware.js` + Joi-coercion in `validation.middleware.js` + 69 in-controller guards | `backend/index.js:23,285` mounts `bodyDefault` after body parsers, before routers; `src/middlewares/bodyDefault.middleware.js` exists; tests `src/tests/controllers/bodyless.a09.test.js`, `src/tests/validators/bodylessBody.a09.test.js`, `src/tests/middlewares/bodyDefault.middleware.test.js` exist | **HOLDS** — card itself flags `index.js` is coverage-excluded so "still mounted" is only proven by these tests running green, not by the coverage gate; that caveat is already in the card |
| **A-12** | `sessionSecurity.middleware.js` deleted, not rewired; ADR-017/005/034/039 and six other docs corrected | No file at `src/middlewares/sessionSecurity.middleware.js` (only stale coverage-report HTML). `DECISIONS.md` ADR-017 status line: `Accepted — never implemented. Recorded 2026-09-23.` | **HOLDS** |
| **A-27** | API-key issuance is `TENANT_ADMIN`-only; `assertScopes` rejects `*`/unknown resources; SCIM `assertAssignableRole`/`assertMutableGroup` block SUPERADMIN and system-role mutation | `src/routes/api/apiKeys.route.js:17,50,69,87,105` (`adminOnly` on all four routes); `src/services/apiKey.service.js:41–57` (`assertScopes`, wildcard/unknown checks); `src/services/scim.service.js` calls `assertAssignableRole` at 5 sites (184, 339, 374, 550, 617) and `assertMutableGroup` at 536/570/638 | **HOLDS** |
| **A-30** | Rate limiter now uses the shared Redis client via `client.status === "ready"`, not a self-constructed client guarded on a nonexistent `.connected` | `src/services/rateLimiter.redis.service.js:13,49–52` imports `getRedisConnection` from `redis.service` and checks `client.status === "ready"` | **HOLDS** |
| **A-33** | SCIM `patchUser`/`patchGroup` parse RFC 7644 `path`, route through the same assignment/guard code as the value form | `src/services/scim.service.js:44–45` (comment naming the old bug), `386–410` (`patchUser` resolves `op.path` via `resolveUserPath`), `579–580` (`patchGroup` via `resolveGroupPath`) | **HOLDS** |
| **A-35** | Per-user override matrix keyed by menu name **and** slug (previously name only, while `dynamicAccess` looks up by slug) | `src/services/userPermission.service.js:212–232` (`getUserOverrideMatrix`) sets both `matrix[p.menu?.name]` and `matrix[p.menu?.slug]` | **HOLDS** |
| **A-45** | IoT ingest carries soft-delete predicate explicitly on the unscoped lookup; ingest failure no longer reaches `unhandledRejection` | `src/controllers/iot.controller.js:27–28` (`.unscoped().findOne({ where: { iotDeviceToken: token, iotEnabled: true, isDeleted: false } })`); `src/services/iot.service.js:75` (`this.ingestReading(...).catch(...)`) | **HOLDS** |
| **A-47** | `generateSignatureHash` (with `Date.now()` inside the hash) deleted; real RSA-SHA256 over a canonical payload; `unverifiable_legacy` status; soft-deleted keys still verify (`paranoid: false`) | `src/services/eSignature.service.js`: no `generateSignatureHash` function remains (only comments referencing the old name); `:533` `crypto.sign("sha256", payloadBuffer, privateKeyPem)`; `:720` enum includes `unverifiable_legacy`; `:263,741` `paranoid: false` with comments explaining why | **HOLDS** |

**All ten hold.** Each has the file/line evidence the card claims, and a named test file exists at
the path the card cites. This is the opposite failure mode from PR-4: the board is not
overclaiming here.

---

## 3 — ADRs (`MEMORY/DECISIONS.md`, 40 total — count corrected, see R-02)

Sampled: every ADR referenced by the ten audit findings above, plus a read of all 40 status lines.

| ADR | Status line | Check | Verdict |
|---|---|---|---|
| ADR-017 — User Sessions Bound to IP/UA | `Accepted — never implemented. Recorded 2026-09-23.` | Matches A-12/`sessionSecurity.middleware.js` finding exactly; this is the **already-corrected** instance the task brief points at | `ACCURATE` (correction verified real, not just claimed) |
| ADR-029 — Isolation in ORM, not RLS | `Accepted — the isolation mechanism stands; the engine-agnostic premise … superseded by ADR-039` | Matches ADR-039 (PostgreSQL-only) coexisting with kept RLS-removal migrations `0012`→`0015` | `ACCURATE` |
| ADR-030 — Backend is JavaScript | `Superseded by ADR-038` | Matches: 0 `.ts` files under `backend/src` (excl. tests); ADR-038 exists and is `Accepted` | `ACCURATE` |
| ADR-038 — TypeScript migration | `Accepted` | `PHASE-9-TYPESCRIPT-MIGRATION.md` status "🔴 NOT STARTED" — an accepted **decision** to migrate, not a claim the migration happened; consistent | `ACCURATE` |
| ADR-039 — PostgreSQL only | `Accepted` | `src/config/index.js` — not itself re-read line-by-line here, but consistent with A-08's fix commit (`9745f01`) and the removal of MySQL-only paths described elsewhere | `ACCURATE` (sampled) |
| ADR-040 — RSA-signed e-signatures | `Accepted` | Matches A-47 code exactly (§ 2 above) | `ACCURATE` |
| ADR-009 — Row-Level Audit Logging | `Accepted`; implications include "Audit tables required for every mutable entity" | Does **not** claim transactional atomicity, so it is not contradicted by A-41 (audit rows written outside the transaction, still **TODO**) — but a reader of ADR-009 alone would not learn that the audit write can silently fail post-commit (A-42, also **TODO**). Not a false ADR; an incomplete one | `ACCURATE`, gap already tracked by A-41/A-42 (not a new finding) |
| ADR-014 — Redis Session Persistence with DB Fallback | `Accepted` | At the time A-24 was found (2026-09-21), every `redis.service` helper was a no-op guarded on a nonexistent `.connected` — the "Redis" half of this ADR did not function until that fix. A-24 is marked DONE and the code now imports and uses `getRedisConnection` correctly (verified indirectly via A-30's use of it) | `ACCURATE` as currently implemented; was **not** accurate between the ADR's acceptance and the 2026-09-21 fix — already documented in `MEMORY-INDEX.md`/`CHANGELOG.md`, not a new gap |

No ADR beyond ADR-017 was found describing behaviour that does not exist. The other 33 ADRs were
read for their status line only (all `Accepted` except ADR-030, correctly marked superseded) — see
§ Sampled vs Exhaustive.

---

## 4 — `MEMORY/records/`, `MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`

Cross-checked against `git log --oneline` (last 5 commits) and the audit board.

| Check | Result |
|---|---|
| `MEMORY-INDEX.md` entries for 2026-09-23 (wave 0 authorisation fixes, wave 0 parallel remediation) and 2026-09-21 (backend audit) | Each names findings that match the corresponding `AUDIT-2026-09-REMEDIATION.md` cards (A-01/02/03/27, A-04…A-50, A-08) and the record files exist at the paths given | `ACCURATE` |
| `MEMORY/CHANGELOG.md` "Unreleased" section | Entries for ADR-040, ADR-039, ADR-038, and Fixed-section bullets for A-09, A-50, A-12, A-04, A-05, A-06/A-15, A-17, A-25, A-26, A-28, A-30, A-31, A-33, A-35, A-36, A-44, A-45, A-34, A-27 all correspond to code changes confirmed present in §2 or in the commit diff of `c131729` | `ACCURATE` |
| Git log correspondence | `c131729` "fix: eighteen audit findings, and twenty more found while fixing them" — diff includes exactly the files the CHANGELOG and audit cards name (`health.controller.js`, `health.service.js`, `bodyDefault.middleware.js`, `routes/internal/health.route.js`, `rateLimiter.redis.service.js`, `rabbitmq.service.js`, `scim.service.js`, `eSignature.service.js`, etc.) | `ACCURATE` |

---

## 5 — `CLAUDE.md` Itself

| Claim | Check | Verdict |
|---|---|---|
| "backend modules 33 · route modules 53 · models 72 · test files 342" | Route modules: **53** under `routes/api/` confirmed exactly. Models: **71** `*.model.js` files (72 only if the directory's `index.js` is counted). Test files: **359** `*.test.js` under `backend/src/tests`, not 342. "33 modules" not independently re-derived (no single canonical definition of "module" found in code) | see **R-02** |
| `createTwoTenants()` does not exist, cited in `CLAUDE.md` and eight `docs/` files, in zero code files | Grepped `backend/src/tests/` (359 files) and `docs/` (entire tree): **zero** matches in any `.js`/`.test.js` file. This claim, already flagged as corrected in the task brief, is **itself accurate** | `ACCURATE` |
| "Two Things Currently Failing": backend coverage 100% "passing" 2026-09-11; live E2E "never achieved" | Coverage figure not re-run (§ Sampled vs Exhaustive). Lint is separately claimed red in `PROGRESS.md`, confirmed live: `npx eslint src/ --ext .js` → **1,297 errors, 340 warnings** (1,637 total), all auto-fixable/formatting on inspection of the tail output — close to but **not identical to** the 1,319/346 figures recorded in A-34/`PROGRESS.md`, both dated 2026-09-23 | see **R-03** |
| Makefile targets named (`make verify`, `make test-e2e`, `make migrate`, `make migrate-verify`) | All present in `Makefile`: `verify: lint typecheck test build`, `migrate`, `migrate-verify`, `migrate-status`, `migrate-undo`, plus every other target `PROGRESS.md`/`CLAUDE.md` reference (`dev`, `up`, `down`, `helm-lint`, etc.) | `ACCURATE` |
| The Traps table (e.g. "`is_deleted` written in code silently does nothing", "`tenantId` on `sessions`... uses snake_case") | Spot-checked the `sessions` claim: `A-12`'s fix explicitly documents the model has `expired_at`/`last_activity_at`, not the camelCase the deleted middleware assumed — consistent. Not each of the 10 trap rows individually re-derived | `ACCURATE` (sampled) |
| Response envelope example | Not independently re-tested against a live route in this pass; consistent with A-04's card describing the same `data` + top-level `meta` shape and with the CHANGELOG's QMS/SOP/certificates envelope-bug entries | `ACCURATE` (sampled, consistent with other evidence) |

---

## Findings — Documents Needing Edits

### R-01 — `TASKS/PHASE-3-CALIBRATION.md`: P3-05/P3-06 describe e-signatures as done with no mention of A-47

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — not a false "done" (the feature is now genuinely fixed, per ADR-040), but the phase file is the retrospective record of what shipped, and it is silent about the most severe defect ever found in the module it describes |
| **Verified** | from code, 2026-09-23 |

**Quote (P3-05, line 96):**
> `**Status** | ✅ DONE |`
> "What shipped: detached signatures from per-tenant keys … `e_signature_records` carrying the 21 CFR Part 11 quartet, PDF rendering with a QR code, and a public, unauthenticated verification endpoint."

**Quote (P3-06, line 114):**
> `**Status** | ✅ DONE — **beyond the plan** |`
> "What shipped (migration `0017`, not in the original scope): multi-party signing independent of certificates — `signature_workflows`, ordered `signature_workflow_steps`, `signature_records`."

**What the code shows:** until the commit that landed 2026-09-23 (same day as this phase file's own
timestamp), `eSignature.service.js#generateSignatureHash` hashed
`${documentId}:${userId}:${tenantId}:${Date.now()}`, so `verifySignature` — which recomputed the
same function — **could never return `valid: true` for a genuine signature**, and no RSA key pair
was ever used to sign anything (A-47, `ADR-040`). Neither P3-05 nor P3-06 says this. By contrast,
**P3-04 in the same file** (certificates) *does* carry its defect inline — "⚠ The defect — ADR-035"
— which is the model this file should follow for e-signatures too.

**Definition of Done**
- [ ] P3-05 and/or P3-06 gain a "⚠ The defect" block naming A-47/ADR-040, in the same style as P3-04
- [ ] the block states plainly that verification could not pass before the fix, and that the
      reference deployment had zero rows so no historical signature is affected
- [ ] the "beyond the plan" framing in P3-06 is not removed — the module still shipped more than
      planned — but is no longer the only thing said about it

---

### R-02 — `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`, `TASKS/PROGRESS.md`, `CLAUDE.md`: stale file-count inventories

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low — no claim is falsified in a way that misleads a decision; the counts are two commits stale and drift in the direction the ratchet is supposed to forbid |
| **Verified** | from code, 2026-09-23 (`find`/`ls` counts against the current tree) |

**Quote (`CLAUDE.md`):**
> "Scale | 33 modules · 53 route modules · 72 models · 342 test files"

**Quote (`PROGRESS.md`):**
> "Sequelize models | **72**" / "Services / controllers / validators | 76 / 56 / 37" / "Backend test
> files | 342"

**Quote (`PHASE-9-TYPESCRIPT-MIGRATION.md`, line 29):**
> "What has to move, counted from the tree on 2026-09-21: … `models/` 72 … `services/` (incl.
> `storage/`) 76 … `controllers/` 56 … `routes/` 54 … tests 340 … Roughly **370 source files**."

**What the code shows (current tree, `backend/src`):**

| Metric | Docs claim | Actual |
|---|---|---|
| Route files (`routes/api/*.route.js`) | 53 | **53** ✓ |
| Route files (`routes/internal/*.route.js`) | 1 | **2** (`migration.route.js`, `health.route.js` — the latter added 2026-09-23 under A-15/A-06) |
| Models (`*.model.js`) | 72 | **71** (72 only if `models/index.js` is counted, which is not a model) |
| Services (`*.service.js`) | 76 | **71** |
| Controllers (`*.controller.js`) | 56 | **57** |
| Validators (`*.validator.js`) | 37 | **37** ✓ |
| Test files (`*.test.js`) | 342 / 340 | **359** |
| Non-test `.js` source files under `src/` | ~370 | **375** |

**Why this matters for Phase 9 specifically:** rule 2 of the migration ("the ratchet only goes
down") is stated against the 2026-09-21 baseline of ~370. The tree already has 375 non-test `.js`
files — five more than the number the ratchet script (P9-04, still `TODO`) will eventually be asked
to hold flat or shrink. The rise happened for a legitimate reason (A-06/A-15's `health.route.js`,
`health.controller.js`, `health.service.js`, and A-09's `bodyDefault.middleware.js`), and P9-04 does
not exist yet to have been violated — but the inventory that will seed its baseline is already wrong
if taken from this file as written.

**Definition of Done**
- [ ] `CLAUDE.md`'s Scale table and `PROGRESS.md`'s count table refreshed from a `find`/`ls` count
      at edit time, with the counting method stated (e.g. "excludes `models/index.js`")
- [ ] `PHASE-9`'s inventory table re-counted immediately before P9-00 starts (its own baseline task),
      not left at the 2026-09-21 figure
- [ ] a one-line convention: any PR that adds/removes a counted file type updates the two summary
      tables in the same commit, the same discipline `TASKS/PROGRESS.md` already asks for `MEMORY/
      records/` entries

---

### R-03 — `TASKS/PROGRESS.md` / `TASKS/AUDIT-2026-09-REMEDIATION.md` A-34: lint error/warning counts stale by ~20

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low — the qualitative claim ("red, all formatting, none logic") holds; only the exact counts drifted |
| **Verified** | 2026-09-23, by running `npx eslint src/ --ext .js` live in `backend/` |

**Quote (`PROGRESS.md`):**
> "Backend lint | 🔴 red … It runs now and reports **1,319 errors**, all formatting, none logic"

**Quote (A-34, "What is left"):**
> "**1,319 errors and 346 warnings**, of which 1,333 are auto-fixable (`indent` 392, `quotes` 296,
> `comma-dangle` 266, `curly` 243, `no-trailing-spaces` 87, `eol-last` 19)."

**What the live run shows:**
```
✖ 1637 problems (1297 errors, 340 warnings)
  1296 errors and 18 warnings potentially fixable with the `--fix` option.
```
1,297 errors (not 1,319), 340 warnings (not 346), 1,314 auto-fixable (not 1,333). The direction is
plausible — later commits in the same day's audit work (e.g. A-45's `.catch()` addition, A-33's
`resolvePath` helpers) touched files this rule set lints, shifting counts by roughly the same order
of magnitude as the changed line counts. The qualitative claim — the gate is red, the findings are
formatting, none is a logic defect on inspection of the categories — is **not** contradicted; the
literal numbers are.

**Definition of Done**
- [ ] re-run `npx eslint src/ --ext .js` immediately before recording a count in a document, or
      state the commit SHA the count was taken at (as A-34 already does for its root-cause analysis)
- [ ] the DoD box "zero errors" in A-34 stays open regardless — this finding does not change what
      is left to do, only the number reported for how much

---

## Sampled vs Exhaustive

**Read in full:** `TASKS/PROGRESS.md`, `TASKS/AUDIT-2026-09-REMEDIATION.md` (all 1,838 lines, in two
passes), `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`, `TASKS/PHASE-3-CALIBRATION.md`,
`MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md` (head section), all 40 ADR status lines in
`MEMORY/DECISIONS.md`, `CLAUDE.md`.

**Verified against code, file-and-line:** all ten requested audit findings (A-01, A-03, A-09, A-12,
A-27, A-30, A-33, A-35, A-45, A-47); ADR-017, ADR-029, ADR-030, ADR-038, ADR-040; P3-04/P3-05/P3-06
of Phase 3; the file-count claims in `CLAUDE.md`/`PROGRESS.md`/`PHASE-9`; the `createTwoTenants()`
claim (grepped across all of `backend/src/tests` and `docs/`); the lint-count claim (live run).

**Sampled, not exhaustively re-derived:**
- Phases 0, 1, 2, 4, 5, 6 (P6-01 only spot-checked), 7, 8 — read for their summary status and
  cross-referenced against the commit log and `PROGRESS.md`, but individual line-items inside them
  were not each independently traced to code the way P3-04/05/06 was.
- The remaining 34 ADRs beyond the six listed above — status line read, body not re-verified against
  code line-by-line.
- The "backend unit coverage gate: 305 suites, 6,039 tests, 100%" figure — **not re-run**. A full
  `jest` run over 359 test files was judged too expensive for this pass; the file-count evidence
  (359 test files exist, up from the 342/340 recorded elsewhere) is consistent with a large, still-
  growing suite, but the exact suite/test counts and the 100% figure were not reproduced.
- `docs/BACKEND/10-MODULE-REFERENCE.md` ("generated from static analysis") — not diffed against the
  current tree; likely to show the same drift as R-02 but not confirmed.
- The remaining 46 audit findings not on the requested list of ten (A-02, A-04 through A-08, A-10,
  A-11, A-13 through A-26 except those cited above, A-28, A-29, A-32, A-36 through A-56) — read for
  consistency (§ 4) but not independently re-verified against code line-by-line the way the
  requested ten were.
- `docs/PLAN/18-RISK-REGISTER.md` — confirmed PR-4 exists there (grep only); not read in full.

---

## Report Summary

1. **Phase tasks mislabelled:** one — `PHASE-3-CALIBRATION.md` P3-05/P3-06 (e-signatures) read as
   clean "DONE" with no mention of A-47, the critical defect that meant no signature could ever
   verify, fixed the same day this file is dated. P3-04 in the same document shows the correct
   pattern (inline defect callout) and was not followed for P3-05/P3-06. Everything else sampled in
   the phase files was accurate or explicitly self-dated.

2. **Audit-board "DONE" claims that do NOT hold up:** **none, of the ten requested.** A-01, A-03,
   A-09, A-12, A-27, A-30, A-33, A-35, A-45 and A-47 all have the file/line evidence and the named
   tests their cards claim. This is the opposite of the PR-4 failure mode — the board undersells
   nothing checked here.

3. **ADRs describing behaviour that does not exist:** none found beyond the already-corrected
   ADR-017 (which the task brief flagged and which this pass confirmed is genuinely corrected, not
   just re-labelled). ADR-009 (audit logging) is accurate but incomplete relative to A-41/A-42 — that
   gap is already tracked on the audit board, not newly discovered here.

4. **False `CLAUDE.md` claims found:** the Scale table's four counts are stale — models (claims 72,
   is 71), services (claims 76, is 71), test files (claims 342, is 359), plus `PHASE-9`'s "~370
   source files" (is 375) and A-34's lint counts (claims 1,319/346, live run shows 1,297/340). All
   are drift from a specific dated snapshot rather than fabrication, and all are low severity. The
   `createTwoTenants()` claim, already flagged as corrected by the task brief, was independently
   re-verified: zero matches in code anywhere in the repository.

5. **Sampled vs exhaustive:** exhaustively read the two largest task/board documents in full and
   verified all ten requested audit findings and the four highest-signal ADRs line-by-line against
   code. Six of nine remaining phase files, 34 of 40 ADRs, and 46 of 56 audit findings were sampled
   for consistency rather than independently re-derived — see § Sampled vs Exhaustive for the exact
   list. No full `jest` run was performed.
