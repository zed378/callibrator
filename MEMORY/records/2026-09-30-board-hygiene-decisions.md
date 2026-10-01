# 2026-09-30: Board Hygiene, and the Working Decisions for the Phases 0–10 Stop (ADR-109)

**Scope:** documents only; no code changed · **Source:** `TASKS/OPEN-WORK-2026-09-30.md` §1, §3 and §6 · **ADR:** [ADR-109](../DECISIONS.md), plus ADR-087 Amendment 17 · **Authority:** the main session, under the owner's explicit delegation *"decide the best recommendation and best practice"*. Every decision here is a **working decision awaiting the owner's confirmation**, like Q-39…Q-47.

Other agents were editing the same files throughout. Each file was re-read immediately before a targeted edit, and no file was rewritten whole. Line endings were checked, and all the files are LF, as in `HEAD`.

---

## 1. Decisions Recorded (ADR-109, BACKLOG § Working Decisions of 2026-09-30)

| # | Decision | Carried on |
|---|---|---|
| §1 | **P6-10:** rehearse key rotation on a restored copy of the VM database taken after the closing deploy. A rehearsal on real hospital data is a post-go-live check | `PHASE-6` P6-10 status; PROGRESS P6-10 row |
| §2 | **P6-11:** all 15 unaudited mutating services are in scope; an agent is implementing them | `PHASE-6` P6-11 status and DoD line; PROGRESS |
| §3 | **Phase 7 exit:** P7-06 on kind counts; U-01 is post-go-live. "Wakes somebody" needs owner-supplied values: `ALERT_WEBHOOK_URL` / `ALERT_EMAIL_TO`, the `MAIL_*` transport, and a log sink for Vector (endpoint and credentials) | `PHASE-7` § Phase Exit note; BACKLOG § Owner-Supplied Values |
| §4 | **Phase 8, "complete for this stop":** every card recorded as DONE, not triggered (with its measurement) or blocked (with its blocker). The P8-04 re-measure stays owed. Whether P8-02's and P8-07's open live checks block the stop is left to the owner | `PHASE-8` § Phase Exit table |
| §5 | **Phase 9 exit:** every non-test source module is TypeScript, with `allowJs: false` for source. The `.js` tests move to the new card **P9-26**, and the ratchet still refuses any new `.js`, tests included. This amends ADR-087 (Amendment 17) | `PHASE-9` P9-24 (scope row; DoD struck and restated), new P9-26 card |
| §6 | **Q-51:** a nullable `api_key_id` actor column with an exactly-one CHECK (being implemented: migration `0105`, the `q51` tests). **Q-52:** add the `vendors.notes` column. **Q-53:** the global limiter's 429 goes in the envelope | BACKLOG Q-51/52/53 rows |
| §7 | **V-13:** the author publishing their own SOP gets **403**, as in ADR-101. The single-admin tenant case is the new **Q-54**, open for the owner (a recommendation is given, not a decision) | REVIEW V-13 status; BACKLOG Q-54 |

**ADR number.** ADR-109 was checked free immediately before writing: the highest in the repository was ADR-108. ADR-087's amendment is **17**, because another agent had added Amendments 15 and 16 minutes earlier. The first attempt was refused by an exact-match check, and nothing was overwritten.

---

## 2. Boards Reconciled

Each change was checked against the code or a record first. The evidence named below is what was checked.

**`AUDIT-2026-09-REMEDIATION.md`: card Status lines brought in line with their summary rows.**
- **A-13:** the asyncHandler sanitises through `publicErrorMessage` (`controllerWrapper.util.ts`); `errorHandlers.a132.test.js` exists.
- **A-18:** card changed TODO → **PARTIAL**, and the summary row updated. `.eslintrc.js` is now absent; `aedes`, `aedes-server-factory` and `nodemon` are not in `backend/package.json`; **`utils/checkMenu.util.js` still exists**.
- **A-19:** DONE. The card says gitleaks is *configured* in CI and no GitHub run has been read.
- **A-32, A-37, A-40, A-42, A-60, A-67, A-71, A-86, A-88, A-89, A-92:** each card's cited test was confirmed to exist:
  - `istanbulIgnore.a32`, `scim.crossTenantOracle.a37`;
  - `storage.index`, `storageMigration.service`, `noConsole.a42`;
  - `auth.emailVerificationPolicy.a60`, `auth.rateLimit.a67`, `route.tokenStrip.a71`;
  - `eSignature.a129a130`, `tenantForeignKeys.a88`, `page.a89`, `calibrationDevices.serial.a92`.
- **A-93…A-98:** the combined card → DONE, matching the six summary rows and its "What was changed" section.
- **A-34 and A-55 → SUPERSEDED,** on the card and in the summary row:
  - A-34: lint baseline 0 (ADR-092);
  - A-55: the fixture exists (A-63), and DOC-13 is DONE.

**`AUDIT-2026-09-AUTHZ-MATRIX.md` AZ-04.** The "500 leak still open" note is closed. `dynamicAccess.middleware.js` hands the error to `next(error)`, pinned by four `… (A-13)` cases in `dynamicAccess.test.js`.

**`REVIEW-2026-09-23-REMEDIATION.md`: a dated state note under § Verdict, and these Status lines.**
- **V-01 → DONE.** `auth.service.ts` selects `roleLevel`; `rbac.authLoaderSeam.test.js`; record `2026-09-24-phase0-foundation-repairs.md`.
- **V-02 → DONE** by A-311. `apiKeyScopeCoverage.a311.guard.test.ts`; record `2026-09-30-a311-api-key-scopes.md`.
- **V-03 → DONE** by S-21. Helm `values.yaml` and `NOTES.txt` describe `/live` and `/health`, and `health.route.test.js` asserts `{status:"ok"}`. Redis and RabbitMQ stay required for readiness, by decision.
- **V-04 → DONE.** `eSignature.validator.ts` requires `reason`, and `esignature.signing.test.js` covers tampering.
- **V-06 → DONE.** Lint is at 0, and CLAUDE.md states it. `make verify` end to end remains F-03.
- **V-07 → DONE (the cause).** `jest.setTimeout(60000)`. No record names two consecutive loaded runs, so that box stays unticked.
- **V-09 → PARTIAL, not DONE** (the brief said DONE). The live Lua suite exists but is opt-in behind `REDIS_LIVE_TEST=1`, and no gate runs it. The card's own DoD requires a named command in a documented gate. Marking it DONE would round it up.
- **V-13 → decided (403), not implemented.** `sop.service.ts` still answers 409.
- **Still open, unchanged:** V-05, V-08, V-12, V-14, V-15, V-17. V-10, V-11 and V-16 were not re-checked.

**Phase files.**
- **P7-01:** the "lint ratchet red (1,061 vs 950)" claim is struck as stale. "Never run on GitHub" is restated as **unverified**: `ci.yml` has been on `origin/main` since `a31c601` with `on: push` to `main`, checked with `git show origin/main:.github/workflows/ci.yml`.
- **P10-14:** now **IN REVIEW** on its card and in the board row. A-293 is DONE in the working tree, and its four named tests exist. It is uncommitted, migration 0096 has not been run on PostgreSQL, and Q-47's confirmation is owed.
- **P2, P3 and P4 retrospectives:** the "remains open" text now says closed:
  - P6-09, 2026-09-25;
  - P6-03, 2026-09-25, with Q-34's `audit_logs` protection;
  - the IP allowlist lock-out, by Q-38/ADR-100 on 2026-09-29.

  The original text is kept as history.

**`BACKLOG.md`.**
- **M-07 → DONE:** `SELF_LOCKOUT` in `signInPolicy.service.ts` and `networkSecurity.route.js`.
- **M-10 → DONE:** `bodyDefault.middleware.js`, mounted at `index.js:228`, with its test.
- **W-11 → RESOLVED:** `package-lock.json` is tracked, and `.gitignore` says so.
- **U-04 restated:** 234 s measured once (P7-04 record).
- **Title line repaired:** it had three DECIDED fragments of Q-34/35/36 fused into the `# Backlog` heading. Their rows already carry them.
- **New sections:** § Working Decisions of 2026-09-30, and § Owner-Supplied Values.

**`DOCS-GAP-2026-09.md`.** A dated note: all 17 DOC cards are DONE, and the §1/§2/§5 tables are the original snapshot.

**`docs/DEVELOPER/02-AUTHENTICATION.md`.** The four V-02 statements are corrected to "closed by A-311", citing its record:
- the Read This First paragraph;
- the paragraph under the slug table;
- the A-07 "still open" bullet;
- the predictiveMaintenance row.

This is a correction to match the code, not a deviation: no behaviour or decision changes, and A-311's record is the evidence. The 179/139 route split is labelled as the 2026-09-27 state, not re-derived.

**`PROGRESS.md`.**
- "Last updated" → 2026-09-30, with a note that DONE after `ce74932` means DONE in the working tree.
- The P6-10, P6-11, P7-01, P7-06, P8-07, Phase 8, P9-24 and P10-14 rows are updated, and a P9-26 row is added.
- The ratchet count restated: 905 names = 209 non-test + 696 test tree, 2026-09-30.
- "The ones that matter most, still open" (A-63/64/65/37, all DONE) is replaced by a re-derived still-open list, including N-01 (a fix is in the tree, with no A-id yet).
- The "do wave 0 first" heading is marked as history, and the PostgreSQL 18 evidence line is corrected.
- PR-3 → mitigated (P6-07).
- **§ Live Health is rewritten from dated records only:**
  - backend gate **red** on the shared tree: 767 suites, 4 failed, 99.96% (`2026-09-30-p10-backend-access-requests-passkey.md`); last green 2026-09-28;
  - frontend 93.3/84.0/88.9/94.0 (`2026-09-30-f19-fixes.md`);
  - E2E achieved 2026-09-28;
  - CI on GitHub unverified;
  - `make verify` never recorded end to end;
  - Helm on kind only.

---

## 3. Phase Summaries Written

- [`2026-09-30-phase-6-summary.md`](./2026-09-30-phase-6-summary.md): interim. 11 of 14 DONE, and P6-10/P6-11/P6-12 PARTIAL. It includes what failed: the webhook `actorType` 500 behind a green suite, 11 defects found getting E2E green, and four stale cards. Security outcomes are named test by test.
- [`2026-09-30-phase-7-summary.md`](./2026-09-30-phase-7-summary.md): interim. 4 of 8 DONE (P7-06 on kind). It includes the drill findings: seven from P7-04, three from P7-01, one from P7-03, and seven chart defects plus A-310 from P7-06. It records that nothing wakes anybody yet.

---

## 4. Not Touched, on Instruction: Stale Lines Found in `README.md` and `CLAUDE.md`

The main session updates these at close. The stale lines found on 2026-09-30:

**`README.md`**
- l.37 `backend/ Express · JavaScript → TypeScript (ADR-038, in progress)` and l.46 "**JavaScript today**": the backend is mixed. About 337 non-test `.ts` modules and 209 non-test `.js` files.
- l.111 "Two gates are failing".
- l.115 backend gate "passing (2026-09-11) — 289 suites, 5735 tests". The last green was 2026-09-28, with 683 suites and 12,890 tests; the 2026-09-30 shared-tree run was red.
- l.116 E2E "never achieved". It was achieved on 2026-09-28, twice.
- l.117 `calibration_records` append-only "a convention". It is a constraint (P6-03, 2026-09-25).
- l.118 Helm "render; no cluster has been reachable". It deploys on kind (ADR-106).
- l.119 CI "deferred — no hook exists either". The workflow exists and the hook is opt-in; a GitHub run is unverified.

**`CLAUDE.md`**
- l.15 "grounded in the code as of 2026-09-10".
- l.28 Scale row: "counted 2026-09-27" and "125 modules are `.ts`". Now about 337 non-test `.ts`. The ratchet floor is 905 names: 209 non-test, 696 in the test tree.
- l.28 The same row says "**a new backend `.js` file — test files included — fails**". That still holds under ADR-109 §5, but when P9-24 lands it should also say that existing `.js` tests are legacy (P9-26).
- l.29 Compliance lists **SNARS**. Q-39's working decision retires SNARS from public copy; retiring it in `docs/` is a separate ADR.
- l.240 "controllers, services, routes and most middlewares are still `.js`". Many services are now `.ts`: P9-12, the Stage C leaves, tenancy and commercial.
- l.264 "What Is Currently Failing": the backend gate is "passing" (2026-09-28), but the 2026-09-30 shared-tree run is red.
- l.267 "CI has **never run on GitHub**" is unverified and probably false. "sign-in under `FORCE_HTTPS=true` fails (A-310)" is fixed in code (2026-09-30), not re-run on kind.

---

## Evidence

No test was run for this change. It is documents only, and every claim above cites the record or file it was checked against. Checks made:
- file existence for every test named;
- `git show origin/main:.github/workflows/ci.yml` for the CI trigger;
- `backend/.ts-ratchet.json` counted by script: 905 entries, 696 of them in the test tree;
- `find` counts on disk: 209 non-test `.js` and 337 non-test `.ts` under `backend/`;
- `grep` for `roleLevel`, `SELF_LOCKOUT`, `bodyDefault`, `reason` in the eSignature validator, `jest.setTimeout`, and `REDIS_LIVE_TEST` (in no gate);
- `sop.service.ts` still answers 409.

## Files

`MEMORY/DECISIONS.md` (ADR-109; ADR-087 Amendment 17) · `TASKS/BACKLOG.md` · `TASKS/PROGRESS.md` · `TASKS/AUDIT-2026-09-REMEDIATION.md` · `TASKS/AUDIT-2026-09-AUTHZ-MATRIX.md` · `TASKS/REVIEW-2026-09-23-REMEDIATION.md` · `TASKS/PHASE-2-WAREHOUSE.md` · `TASKS/PHASE-3-CALIBRATION.md` · `TASKS/PHASE-4-ENTERPRISE.md` · `TASKS/PHASE-6-CORRECTNESS-AND-COMPLIANCE.md` · `TASKS/PHASE-7-OPERATIONAL-MATURITY.md` · `TASKS/PHASE-8-SCALE-AND-REACH.md` · `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md` · `TASKS/PHASE-10-LANDING-AUTH-REVAMP.md` · `TASKS/DOCS-GAP-2026-09.md` · `docs/DEVELOPER/02-AUTHENTICATION.md` · `MEMORY/records/2026-09-30-phase-6-summary.md` (new) · `MEMORY/records/2026-09-30-phase-7-summary.md` (new) · this record · `MEMORY/MEMORY-INDEX.md` · `MEMORY/CHANGELOG.md`
