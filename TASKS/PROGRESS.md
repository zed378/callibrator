# Progress

**The single status board.** History lives in [`../MEMORY/`](../MEMORY/README.md); this is state.

Last updated: 2026-09-30 (board reconciliation and the ADR-109 working decisions, `MEMORY/records/2026-09-30-board-hygiene-decisions.md`). Sections not touched that day keep their own dates; a count is a dated snapshot, so re-count before quoting it.

> **What "DONE" means today.** The last commit is `ce74932` (2026-09-29). Everything marked DONE after it is **DONE in the working tree**: recorded, but not yet merged. Under `00-TASK-CONVENTIONS.md`, it is not DONE until committed (`OPEN-WORK-2026-09-30.md` §0).

---

## Where This Project Actually Is

Phases 0–5 are **shipped**. The previous version of this board listed foundation tasks as TODO for work that had been running for months (PR-4).

| | Count |
|---|---|
| Backend modules | **33** |
| Route modules | **53** under `routes/api/` + **2** internal (`health`, `migration`) — counted 2026-09-27 |
| Sequelize models | **71** (`models/*.model.js`, 2026-09-27) — the old count of 72 included `models/index.js`, which is the barrel, not a model |
| Services / controllers / validators | **81** / **58** / **40** (`services/*.service.js`, `controllers/*.controller.js`, `validators/*.validator.js`, 2026-09-27) — 88 `.js` files under `services/` counting the storage drivers |
| Backend test files | **674** (`*.test.js`/`*.test.ts` under `backend/src/tests`, 2026-09-27; 717 files there counting fixtures and helpers) |
| Live E2E specs | 53 |
| Frontend API services (each with a contract test) | 51 |
| Browser tests | 71 |
| Dashboard surfaces | ~60 |
| Migrations | **63** files in `backend/src/migrations`, numbered up to `0090` (2026-09-27; numbers are reserved per agent, so there are gaps). Which have run on the reference deployment is recorded per deploy in `MEMORY/records/`, not here |
| ADRs | **40** |

---

## Phases 0–5 — DONE

Each has a phase file written **retrospectively**, naming the divergences, the defects found, and what they taught.

| Phase | Intent | Reality | File |
|---|---|---|---|
| **0** Foundation | monorepo, schema, tenancy, CI | ✅ shipped — CI **deferred**, isolation moved out of RLS (ADR-029), backend is **JavaScript** (ADR-030) | [P0](./PHASE-0-FOUNDATION.md) |
| **1** Auth, RBAC, users | OIDC, sessions, permissions | ✅ shipped — **plus** MFA, WebAuthn, SCIM, an OIDC **provider** (ADR-033); sessions in the database (ADR-034) | [P1](./PHASE-1-AUTH-AND-RBAC.md) |
| **2** Warehouse | inventory, transfers, opname | ✅ shipped — locations are **one level**, not a tree | [P2](./PHASE-2-WAREHOUSE.md) |
| **3** Calibration | devices, records, certificates | ✅ shipped — **plus** multi-party e-signature; approval was **unreachable** until ADR-035 | [P3](./PHASE-3-CALIBRATION.md) |
| **4** Enterprise | SSO, advanced features | ✅ largely shipped — **plus** pluggable storage, developer API, GDPR, feature flags, network security | [P4](./PHASE-4-ENTERPRISE.md) |
| **5** Analytics | data lake, predictive maintenance | ✅ shipped (2026-09-28, ADR-088: P5-08 closed as superseded by P8-04) — predictive maintenance and pgvector RAG shipped, **plus** the whole QMS surface, workflow engine, Kanban and tickets; **no data lake, deliberately** (PR-10) | [P5](./PHASE-5-ANALYTICS.md) |

### The defects those phases produced, and what each taught

| Where | Failure | Lesson |
|---|---|---|
| P1 | every token rejected 15 min after login, platform-wide | two verification parameters expressing one idea will disagree |
| P3 | certificate approval **unreachable**; a 500 hid the gap | a conflict is a **409** |
| P3, P5 | lists returned **zero rows** while rows existed (certificates, risks) | an optional include without `required: false` is an INNER JOIN |
| P5 | three screens rendered **empty for weeks** | the envelope is a contract; a client breaks **silently** |
| P4 | the nightly retention purge failed **every night** | `sessions` uses snake_case — and a silent scheduled failure is worse than one that never ran |
| P5 | every workflow write 500ed | the models barrel exports `sequelize`, not `db` |
| P0 | the divergences went **unrecorded for months** | PR-4 — the reason Part II of `DECISIONS.md` exists |

### Shipped beyond the original plan

QMS (non-conformances, CAPA, SOP) · risk register · vendor scorecards · workflow engine · GDPR and retention · IoT telemetry over HTTP and optional MQTT (client of an external broker) · feature flags · network security · metered billing · batch jobs · Kanban tracker · support desk · pluggable object storage.

---

## Phase 6 — Correctness and Compliance 🚧

**The debt that blocks a defensible release.** Details: [`PHASE-6-CORRECTNESS-AND-COMPLIANCE.md`](./PHASE-6-CORRECTNESS-AND-COMPLIANCE.md).

| Task | Title | Status | Blocks |
|---|---|---|---|
| **P6-01** | Restore the backend coverage gate | ✅ **DONE** 2026-09-11; `npm run test:coverage` runs (P6-01a), evidence restated 2026-09-28 under P6-14 | trust in every other gate |
| **P6-02** | One clean full E2E pass, uninterrupted | ✅ **DONE** 2026-09-28 — two uninterrupted green runs, 392 tests, no 429 (ADR-077) | release sign-off |
| **P6-03** | `REVOKE UPDATE, DELETE` on `calibration_records` | ✅ **DONE** 2026-09-25 — trigger + application-role REVOKE, tested as `callibrator_app` on PG 18.6 (ADR-062) | 21 CFR Part 11 defensibility (PR-2) |
| **P6-04** | Build guard: no route without a permission gate | ✅ **DONE** 2026-09-25, re-verified 2026-09-28 — `routePermissionGuard.p604` + `readGates.p604` (212 tests) green; in `npm test`/`make verify` and CI `backend-test`, which has **never run on GitHub** (P7-01) | the likeliest authorization defect |
| **P6-05** | Post-migration column verification | ✅ **DONE** 2026-09-25 — every boot verifies; fresh and upgrade boots pass on PG 18.6 (ADR-062) | silent no-op migrations (PR-5) |
| **P6-06** | Composite unique on `(tenant_id, serial_number)` | ✅ **DONE** 2026-09-28 — constraint by ADR-049; **not partial on `is_deleted`, decided by ADR-078** (a deleted device keeps its serial; A-133 restore is the way back). Tests: `dataIntegrity.p6.live` "ADR-078: a soft-deleted device keeps its serial" (22/22, PG 18) | a cross-tenant oracle |
| **P6-07** | Mandatory MFA at role level 10 | ✅ **DONE** 2026-09-25 — enrolment-only session + audited break-glass (ADR-059); E2E harness change not run live | PR-3 |
| **P6-08** | Align Swagger with the GDPR validators | ✅ **DONE** 2026-09-25 — `swaggerValidatorAlignment.p608.test.js`; 33 other drifts pinned | AC-29 |
| **P6-09** | Reason required on every stock quantity change | ✅ **DONE** 2026-09-25 — `0059` + stock.service (ADR-062) | an unexplained quantity change |
| **P6-10** | Rotation procedure for the two unrotatable secrets | 🟡 **PARTIAL** 2026-09-28 — built (ADR-062); rehearsed on seeded data and on the P7-04 drill data, MFA seeds included (ADR-078: 12 re-wrapped, 0 failed, old TOTP seed and old/new e-signatures verify). A rehearsal on a **copy of production** is still owed. **Decided 2026-09-30 (ADR-109 §1, working decision):** that copy is a restored copy of the VM database taken after the closing deploy; real hospital data is a post-go-live check | "rotate the key" is not currently available |
| **P6-11** | Audit rows inside the transaction | ✅ **DONE** 2026-09-30 for the decided set (ADR-109 §2, working decision; [record](../MEMORY/records/2026-09-30-p6-11-audit-coverage.md)) — kanban, ticket, content, featureFlag, warehouse, usage alerts now audit inside the transaction; 7 of the 15 already did; notification/ai/metering allow-listed with reasons (owner to confirm). `auditCoverage.p611` guard fails on a new unaudited mutation; phase 2 closed the gaps outside the 15 (GDPR, SCIM groups, SOP, storage, registration, SSO JIT, subscription) — stock-take audited by the services helper; no known gap remains. Live PG18 as `callibrator_app` 4/4 | 21 CFR Part 11 attribution |
| **P6-12** | Revocation that revokes | 🟡 **PARTIAL** 2026-09-28 — sid-less tokens refused; open sockets re-checked every 60 s; windows named in the security doc (ADR-085). Open: the VM runs `JWT_ACCESS_EXPIRED=1d` against the repository's `15m` (operator change) | a revoked session that keeps working |
| **P6-13** | Webhook routes: validate the input, own the secret | ✅ **DONE** 2026-09-28 — caller secret refused (400); rotation with a 0–168 h overlap (`X-Webhook-Signature-Previous`, migration `0090`, PG 18.6 fresh/upgrade/down verified); every rotation 500ed on PostgreSQL before (no `actorType`) — fixed (ADR-085) | forgeable, unrotatable webhook signatures |
| **P6-14** | Make the coverage figure mean what it says | ✅ **DONE** 2026-09-28 — phantom `src/app.js` gone, `index.js` excluded with a reason, six-layer scope in the docs, reviewer rule written, `coverageScope.p614.test.js`; fresh run 638 suites / 12,780 tests at 100% (ADR-085) | a gate cited rather than checked |

### The state of the gates

*The backend row is the 2026-09-28 snapshot. For the current state, including the red full run of 2026-09-30, see § Live Health.*

| Gate | State |
|---|---|
| Backend unit coverage (100%) | ✅ **passing** — 683 suites (24 skipped), 12,890 tests, 100% on all four measures (2026-09-28, Node 26.10.0, `MEMORY/records/2026-09-28-p9-helper-lint-baseline-coverage.md`; refreshed under ADR-088). **But `models/` is excluded from the gate twice, so it has never measured a model** — the A-88 model DDL test now covers foreign keys |
| Backend lint | ✅ **0 errors, ratchet baseline 0** (2026-09-28, ADR-092, P9-02a). History: it had never run at all (A-34, a version mismatch crashed ESLint); then 1,319 errors (2026-09-23), 1,083 (2026-09-27). Warnings remain (263 `no-unused-vars`, 19 `no-console`) |
| Frontend coverage (70%) | ✅ **passing, above target**: 93.33% statements, 83.99% branches, 88.93% functions, 94.02% lines. 280 of 280 suites and 2,911 tests pass (`npx jest --coverage --ci`, whole tree, 2026-09-30, after the F-19 second pass, `MEMORY/records/2026-09-30-f19-fixes.md`). The gate is 90 / 81 / 86 / 91 (ADR-067 Amendment 1). F-19 is PARTIAL: Q-37, the ticket-HTML policy and one backend label bug remain. It was 43.68% statements on 2026-09-29 |
| Live E2E in one uninterrupted run | ✅ **achieved 2026-09-28, twice** (P6-02, ADR-077; again at `35ebd76`, ADR-092) — by hand on a compose stack, not in CI |

`make verify` runs lint first, so until 2026-09-28 it had **never** passed on any machine. Lint no
longer stops it (ADR-092); a full `make verify` pass has not been recorded — name the run before
claiming one.

**A gate that is currently failing is a gate nobody trusts. A suite that has never passed as a suite has not passed.**

---

## Audit Remediation — 2026-09 🚧

**Board:** [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) · **Records:**
[`2026-09-21-backend-audit`](../MEMORY/records/2026-09-21-backend-audit.md),
[`2026-09-23-wave0-authorisation-fixes`](../MEMORY/records/2026-09-23-wave0-authorisation-fixes.md),
[`2026-09-23-wave0-parallel-remediation`](../MEMORY/records/2026-09-23-wave0-parallel-remediation.md),
[`2026-09-24-phase0-foundation-repairs`](../MEMORY/records/2026-09-24-phase0-foundation-repairs.md),
[`2026-09-24-phase0-batch2`](../MEMORY/records/2026-09-24-phase0-batch2.md),
[`2026-09-24-phase0-batch3-checkpoint`](../MEMORY/records/2026-09-24-phase0-batch3-checkpoint.md),
[`2026-09-24-phase0-batch4`](../MEMORY/records/2026-09-24-phase0-batch4.md),
[`2026-09-25-phase0-batch5`](../MEMORY/records/2026-09-25-phase0-batch5.md),
[`2026-09-25-phase0-batch7`](../MEMORY/records/2026-09-25-phase0-batch7.md)

Started as a documentation task on 2026-09-21 and turned into an audit. The board has grown from
32 findings to 47, because **fourteen of the new ones were found while fixing or documenting
something else** — which is the only way defects of this shape are found.

| | Count (2026-09-25, batch 7, main board only) |
|---|---|
| Findings recorded | **231** |
| Done and verified by a named test | **219** |
| Partly done | 6 |
| Open | 5 — A-08, A-19, A-24, A-257, A-263 (A-20 done 2026-09-28, ADR-077) |

> 2026-09-27 (ADR-076): **A-19, A-42 and A-257 are DONE** and A-18 is further along (partial: two deletions await the owner). Node 26 and TypeScript 7.0.2 are pinned. The backend coverage gate was green on Node 26.10.0: 637 suites, 12,775 tests, 100 % on all four measures. The table above is the batch-7 snapshot; re-count before quoting.

### Still open (re-derived 2026-09-30)

The four this section used to list are all **DONE**:
- **A-63**: tenant edit/suspend by any user. DONE 2026-09-24; not yet verified on a running server.
- **A-64**: DONE 2026-09-24.
- **A-65**: DONE 2026-09-24 (ADR-047).
- **A-37**: DONE 2026-09-27 (ADR-075).

What is open now, from the board and `OPEN-WORK-2026-09-30.md` §1 and §5:

| | |
|---|---|
| ~~**N-01**~~ → **A-323 DONE** 2026-09-30 | one super-admin predicate (`utils/role.util.ts`) everywhere; revoke-all works for the seeded `SUPERADMIN`; guard `superAdminPredicate.n01`. **A-324** (found here) DONE: session revoke/revoke-all/delete audited in the transaction — [record](../MEMORY/records/2026-09-30-correctness-batch.md) |
| ~~**A-273**~~ DONE 2026-09-30 | path params win, a differing body/query id is 400 (`utils/pathParams.util.ts`, `pathParams.a273`) — [record](../MEMORY/records/2026-09-30-correctness-batch.md) |
| **A-283** | IN PROGRESS 2026-09-30: suites decided one by one; a10/w34/p804 green as `callibrator_app`; q02/dbA/dbB/p613 switched, re-run owed ([record](../MEMORY/records/2026-09-30-live-pg18-migrations-a283.md)) |
| **A-284** (A-274 DONE 2026-09-30) | lint covers `src/` only · the unused `includeDeleted` scope removed from 12 models, ApiKey's kept for its callers — [record](../MEMORY/records/2026-09-30-correctness-batch.md) |
| **A-18** | `utils/checkMenu.util.js` still exists; deleting it needs the owner's permission |
| ~~**REVIEW V-05, V-08, V-12, V-13, V-14, V-15, V-17**~~ | **DONE 2026-09-30**, each with a named test (V-13 → 403 per ADR-109 §7; V-17 removes `SIGNATURE_ALGORITHM`). Also Q-52 (vendors.notes: migration **0106** verified on PG18 up/down/up, a Notes field in the vendor form, max 2,000) and Q-53 (global 429 envelope) — [record](../MEMORY/records/2026-09-30-correctness-batch.md) |
| **Live checks** | A-310 on kind; A-63 two-tenant; D-08/D-13/D-22 on the deployed database; S-19 containers; migrations 0091–0105 on PostgreSQL 18 as `callibrator_app` |

### One shape, three times

`client.connected` (ioredis), `connection.isOpen` (amqplib) and a `redisReady` flag set only
inside a function nothing called — three liveness guards on things that did not exist, each with
passing tests, two of them kept green by **mocks that invented the missing property**. Redis
helpers were no-ops, every broker call leaked a connection, and the rate limiter never used Redis
at all. See A-24, A-36, A-30.

---

## PostgreSQL 18 — repository moved, deployment has not 🚧

**Decision:** [ADR-041](../MEMORY/DECISIONS.md) · **Runbook:** [`RUNBOOK-POSTGRES-18-UPGRADE.md`](./RUNBOOK-POSTGRES-18-UPGRADE.md)

The compose pins and all eighteen documents now say **PostgreSQL 18** (`pgvector/pgvector:pg18`).
The VM still runs **17.11**, and that is deliberate: a data directory written by 17 will not start
under 18, so `docker compose pull && up -d` on the VM would crash-loop the database. The move is a
dump, a fresh volume and a restore, with the old volume kept as the rollback.

| | |
|---|---|
| Repository | ✅ on 18 |
| Deployment | 🔴 **17.11** — not started |
| Application changes needed | none; access is through Sequelize 6 and the only extension is `pgvector` |
| Evidence it works on 18 | **Local, not deployed.** The E2E suite passed in one run, twice, on PostgreSQL 18 on 2026-09-28 (P6-02, ADR-077), and the live suites run on 18.6. A CI run on GitHub is unverified (P7-01). On the VM, the upgrade is superseded by the **wipe** decision (`RUNBOOK-POSTGRES-18-UPGRADE.md` § Owner Decision) and happens at the closing deploy |

---

## Phase 7 — Operational Maturity ⏳

[`PHASE-7-OPERATIONAL-MATURITY.md`](./PHASE-7-OPERATIONAL-MATURITY.md)

| Task | Title | Status | Depends on |
|---|---|---|---|
| P7-01 | CI pipeline running the gates that run only locally | 🟡 **PARTIAL** 2026-09-28 — `.github/workflows/ci.yml` written (ADR-066). 2026-09-28 (ADR-082): `backend-test` (12,790 tests, 100%), `boot-and-migrate` (PG 18, 63 migrations, schema-verify OK, idempotent second boot) and `dependency-audit` (0 high) **run in their CI form and pass**, after fixing three red-on-day-one defects (`npm ci` skipped `tsx` under `NODE_ENV=production`; `migrate:status` never exited, M-13; coverage depended on `.env`); each proved in the failing direction. **2026-09-30: CI has run on GitHub 10 times since 2026-09-24 and never been green** (9 failure, 1 cancelled). On HEAD `ce74932` (run 36537915943) 7 of 8 jobs pass, `next build` included; **only `secret scan (gitleaks)` fails**, on 3 false positives (no real secret in history). Fixed in the working tree, not yet seen green on GitHub (`MEMORY/records/2026-09-30-p7-01-ci-gitleaks.md`). ~~Lint ratchet red (1,061 vs 950)~~: stale, the backend lint baseline has been **0 errors** since 2026-09-28 (ADR-092). No image build/push | P6-01 |
| P7-02 | **Alerting on scheduled-job outcomes** | 🟡 **PARTIAL** 2026-09-25 — in the application: every scheduler monitored, watchdog for missed runs and stuck batch jobs, webhook/email sinks, `/health/jobs`, `/health/metrics` (ADR-066; `jobMonitor.service.p702`, `alert.service.p702`, `health.jobs.p702`, `metricsAuth.p702` — 100% covered; metrics served live). 2026-09-28 (ADR-082): routing tested end to end into a real HTTP receiver (`alertRouting.p702`), retention `incomplete` / quarantine `truncated` alert as warnings, the boot log states the route. Open: the infrastructure backup runs outside the process, and no deployment has a route set | — |
| P7-03 | Structured log shipping | 🟡 **PARTIAL** 2026-09-25 — JSON on stdout with `requestId` on every request line (`activityLog.requestId.p703`); 2026-09-28 (ADR-082): the pinned Vector shipped a real backend container's stdout to a local Loki 3.5.5 and a file — `requestId` on every request line, 0 secrets, a stray unredacted line redacted by Vector; the `alert` label moved to its own sink; **no deployment ships**; 52 `console.*` sites remain (A-42 sweep) | — |
| P7-04 | **A full restore drill** | ✅ **DONE** 2026-09-28 (ADR-078) — compose, PG 18: dump + objects + escrowed secrets restored, checklist identical before/after, **RTO 234 s**, RPO = dump age; 7 findings (D-1 PDF rendering in the image — **closed 2026-09-29 by ADR-095: the backend renders no PDF; the frontend renders it from `GET /certificates/:id/document`**; D-2 postgres init; D-3 tenant backup held no users; D-4 role before pg_restore; D-5 secrets first; D-6 wrong KMS key booted; D-7 `migrate:status` hangs) | — |
| P7-05 | Formalise the secret backup procedure | ✅ **DONE** 2026-09-28 (ADR-078) — `docs/SECURITY/14-SECRET-ESCROW.md`; the boot refuses a database whose KMS key is missing (`kmsVerify.util.p705`, 9); secrets restore was part of the drill | P6-10 |
| P7-06 | Validate the Helm charts against a real cluster | ✅ DONE on kind 2026-09-30 (ADR-106): installs, upgrades, rolls back; seven chart defects fixed; **not proven on a production cluster**; A-310 is fixed in code but not re-run on kind. **The Phase 7 exit counts kind; U-01 (a production cluster) is post-go-live** (ADR-109 §3, working decision). "Wakes somebody" waits for the owner's alert destination and log sink (`BACKLOG.md` § Owner-Supplied Values) | a cluster |
| P7-07 | Pin the two `:latest` base images | ✅ **DONE** 2026-09-25 — every base image pinned by digest (both Dockerfiles, compose, the Vector overlay; MinIO dev-only by release tag); process in `docs/DEVOPS/02` § Moving a pinned base image; compose digests pulled successfully in a live run (ADR-066) | — |
| P7-08 | Split swagger onto its own CSP | 🟡 **PARTIAL** 2026-09-25 — API origin drops `'unsafe-inline'` for scripts; `/docs` has its own policy and serves no inline script (checked live); Swagger off in production unless `SWAGGER_ENABLED` (`csp.p708`, ADR-066). **Content origin done 2026-09-25 (ADR-071).** The Next.js pages send a per-request nonce CSP with `'strict-dynamic'`, minted in `src/proxy.ts`. Every page now renders per request. `<style>` elements need the nonce; `style` attributes stay inline. nosniff, Referrer-Policy and Permissions-Policy are set, and X-Powered-By is off. Tests: `lib/securityHeaders.test.ts` and `proxy.test.ts` § "the page CSP". Checked live on a production build with the standalone server: curl showed a different nonce on each request. Headless Chrome loaded 11 pages with 0 violations. A `contentHtml` carrying `<script>`, a `data:` script, `onerror` and `<style>` had all four blocked. Open: that `contentHtml` check was a one-off run and is not in a suite (the frontend has no browser runner). Also open: the websocket was not exercised against a live backend, and there is no `MEMORY/records` entry yet. **Follow-ups done 2026-09-25 (ADR-071 amendment 1).** The certificate PDF frame is not blocked: the document route already allows `'self'` plus `CORS_ORIGIN` with no `X-Frame-Options`, and the `/api` proxy relays that. `certificateFrame.p708.test.js` pins it, and headless Chrome rendered the PDF in the frame on a real backend. Tenant logos are uploads only, and `img-src` is not widened. A URL or path is refused (400), and a stored absolute URL gets `logoBaseUrl: null`, so the UI falls back, with no migration. Tests: `tenant.logoUrl.p708.test.js` and `useTenantBranding.p708.test.tsx`, both failing against HEAD | — |

**P7-02 first.** A scheduled compliance job failing silently is the failure mode this system is most exposed to, and it has already happened — the retention purge failed every night with `column "tenantId" does not exist` until someone looked.

**P7-04 was worth running** (ADR-078, 2026-09-28). The first drill restored cleanly only after two procedure fixes, found that a restore under the wrong KMS key booted and failed per request (now refused at boot), that API tenant backups held no users, and that the image cannot render certificate PDFs (D-1 — closed 2026-09-29 by ADR-095: by owner decision the frontend renders the PDF, and Chromium left the backend image). One compose drill on a small data set; the RTO at production volume is still unmeasured.

**2026-09-29 — ADR-095** ([record](../MEMORY/records/2026-09-29-adr095-audit-append-only-pdf-frontend.md)):
- **Q-34 DONE:** `audit_logs` is append-only in the database. Migration `0091` adds a trigger (ENABLE ALWAYS)
  and REVOKEs; only GDPR masking may change a row. It is proven on PostgreSQL 18.6 as `callibrator_app` and
  as a superuser owner, on a fresh and an upgraded database.
- **Q-35 DONE:** a system role cannot be soft-deleted.
- **Q-36 DONE:** `keyRotation.s08.live` passes 5/5 with the S-20 seeds.
- **M-11 DONE:** the certificate PDF is rendered by the frontend. The backend serves the document data, the
  integrity hash is `certificate-content-v2`, and the old v1 hash still verifies.

**2026-09-30 — ADR-095 Amendment 1** ([record](../MEMORY/records/2026-09-30-adr095-followups.md)), the open items closed:
- **O-1:** the boot self-check now also refuses a role that can DELETE or TRUNCATE `audit_logs` or UPDATE any
  column but the three masking ones. Proven by unit tests and live on PostgreSQL 18.6.
- **O-2:** eight live suites create, migrate and drop their own database and run as `callibrator_app`. None
  deletes an audit row. All 7 run pass (w33 12/12 after an actor fix; `w14` needs a broker). `dataIntegrity.p6.live`
  applies migrations after 0091 from the manifest (26/26).
- **O-4:** backend memory limits are 1Gi (production 1536Mi), down from 4Gi. The measured peak was 337 MiB.
  The charts render; they are not known to deploy.
- **O-5:** the certificate PDF embeds Noto Sans. Latin Extended, Vietnamese, Greek and Cyrillic now print;
  other scripts print `?`.
- **O-6:** the browser smoke passed 7/7 live, and ADR-101's separate approver works.

---

## Phase 8 — Scale and Reach ⏳

[`PHASE-8-SCALE-AND-REACH.md`](./PHASE-8-SCALE-AND-REACH.md). Each is **trigger-driven**, not scheduled.

| Task | Title | Trigger | Status |
|---|---|---|---|
| P8-01 | Object storage off local disk | before replica count > 1 | 🚫 **BLOCKED** 2026-09-28 (ADR-086). A-40 is done; the rest needs a target S3/NFS environment and an ambient credential chain |
| P8-02 | Socket.IO Redis adapter | same | 🟡 **PARTIAL**. The adapter and cross-replica test are done (A-54), and open-socket revocation is done (ADR-085). Open: the fan-out test after a reconnect, and a live notification through the proxy |
| P8-03 | Migration advisory lock or init container | same | ✅ **DONE** 2026-09-28 (ADR-086). `db.sync()` + migrations run under a PostgreSQL advisory lock (`utils/migrationLock.util.js`), and `npm run migrate` takes the same lock. Tests: `migrationLock.p803.test.js` (17) and `migrationLock.p803.live.test.js` (4, PostgreSQL 18.6), with fail-before on a HEAD worktree. On two real replicas, one applied 63 migrations and the other waited and applied none |
| P8-04 | Read replica for reporting | measured impact on operational p95 | ⏳ The trigger fired in part (P8-07). Decided: query-shaped fixes first, a replica only if p95 still fails (ADR-086 §3) |
| P8-05 | Partition `iot_readings` | row count makes retention insufficient | ⏳ not triggered (ADR-086 §3) |
| P8-06 | Partition `audit_logs` | same — and it has **no delete path** | ⏳ not triggered. The measured cost is an exact count, which partitioning does not bound. Retention is still undecided (Q-03) |
| P8-07 | Load and abuse testing at scale | before any of the above is sized | 🟡 **PARTIAL** 2026-09-28 (ADR-086 §3). Over 35,963 requests: 0 cross-tenant leaks, 0 × 408, 0 × 429, 0 × 5xx, 0 acquire timeouts. The p95 target is missed above low concurrency, and the ceiling is PostgreSQL. Open: MQTT ingest under load. ("PDF memory (M-11)" is moot: since ADR-095 the frontend renders the PDF.) |
| P8-08 | Multi-region | a customer requirement | 🚫 **BLOCKED** on a customer data-residency requirement |

**"Complete for this stop"** (ADR-109 §4, working decision): every card is recorded as DONE, not triggered (with its measurement) or blocked (with its blocker). The **P8-04 p95 re-measure stays owed**. `PHASE-8` § Phase Exit has the table.

**P8-01, P8-02 and P8-03 are the hard prerequisites for more than one backend replica**, and none is difficult. They simply have to happen before the replica count changes, not after somebody notices duplicated backups.

---

## Audit 2026-09 Remediation — the original wave plan (history)

> **2026-09-30:** wave 0 is complete (the Phase 9 precondition was met before P9-01 started). The table below is the plan as written on 2026-09-21. For what is open now, see § Audit Remediation — 2026-09 › Still open, above.

[`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md). 23 findings; evidence in [`../MEMORY/records/2026-09-21-backend-audit.md`](../MEMORY/records/2026-09-21-backend-audit.md).

| Wave | Tasks | Rule |
|---|---|---|
| **0 — security** | A-01 **cross-tenant write on `tenant-hierarchy`** · A-02 tenant config open to every user · A-03 API-key scope bypass · A-04 search permission bypass · A-05 Socket.IO · A-06 `/health` disclosure · A-13 raw errors in production · A-17 MQTT exposure | **now, in JavaScript**, before Phase 9 |
| 1 — correctness | A-07 · A-09 · A-10 · A-11 · A-12 · A-14 · A-15 · A-16 | before or alongside the Phase 9 stage for that module |
| 2 — hygiene | A-18 … A-23 | freely |
| done | **A-08** metered billing read every tenant's usage as zero — fixed 2026-09-21 | |
| done 2026-09-29 (ADR-094) | **A-275** OIDC consent bound to the client's tenant · **A-276** a payment lifts only dunning's suspension · **A-277** users named in a body checked in the record's tenant · **A-278** missing audit rows (SCIM, API keys, e-signature keys, vendor/risk/scorecard/finance, four lifecycle transitions) · **A-279** lifecycle conflicts are 409 · **A-280** operator routes name the tenant · **A-281** AI not configured is 409. Open: **A-282** (partial), **A-288**, **Q-38** — [record](../MEMORY/records/2026-09-29-security-fixes-a275-a282.md) | |
| done 2026-09-29 (ADR-100) | **A-293** certificate verification token (migration 0096): full verdict with the QR token, minimal by number · **A-288** allowlist/geofence enforced at password, MFA, SSO, passkey and refresh; operators exempt · **Q-38** tenant admins set their own, 409 self-lockout guard (migration 0098) · **A-291** request budgets counting successes, Retry-After, per-IP on in production · **A-292** one SSO-start 404 · **A-289** emailed links from config · **A-272** controller validation 400 = validate() · **A-282** key writes audited as `system:api-key` + guard · **A-304** dashboard metrics gated · **A-305** offboarding and Stripe plan change audited twice — [record](../MEMORY/records/2026-09-29-security-followups.md). **Amendment 1 (2026-09-30):** Q-51 closed (migration 0105, keys as row actors, person-only decisions refuse keys); 0096/0098/0105 verified on PG18 fresh + upgraded as `callibrator_app` (**correction 2026-09-30:** that upgrade started from today's models; from a real `ce74932` database the boot refuses before 0105 — [record](../MEMORY/records/2026-09-30-live-pg18-migrations-a283.md)); IPv6 allowlist; geofence save sends `currentLocation`; network-security page on ADR-102; SSO refusal latency floor · **Amendment 2:** lists and details name the API key that wrote a row · **Amendment 4 (A-331):** `/roles/assign` projection; credential attributes dropped from `toJSON()` on seven models; S-20 response scan in every route suite · **Amendment 3:** upgrade-boot blocker fixed (no model index on a migration-added column; guard `modelIndexColumns.am3`; live `upgradeBoot.am3.live` from ce74932 — 15 migrations, schema-verify OK) | |
| done 2026-09-29 (no ADR) | **A-296** multipart bodies are sanitized like JSON (`upload.util` sanitizes after every multer parse; guard `multipartSanitizer.a296.guard`); `errorLog` removed — [record](../MEMORY/records/2026-09-29-multipart-sanitizer.md) | |
| done 2026-09-30 (coordinator decision) | **A-303** tenant profile columns stored (migration 0102), validated, printed as the certificate issuer; `maxUsers` off the edit; Q-50 open on hashing the issuer — [record](../MEMORY/records/2026-09-30-a303-tenant-profile.md) | |
| done 2026-09-30 (coordinator decisions) | **Q-50 → ADR-107** signing snapshot + `certificate-content-v3` (migration 0103) · **seat limit** `limitSeats` single source, `remainingSlots` NaN fixed — [record](../MEMORY/records/2026-09-30-a303-tenant-profile.md) | |
| done 2026-09-29 (ADR-104) | **A-176** SSRF note closed. `oidc_authority` and `ai_base_url` (and a tenant S3 endpoint) are checked on save and on every server call: pinned DNS, no redirects, a timeout and a size cap. `SSRF_DEV_ALLOW_HOSTS` is for development only. · **A-306** hex IPv4-mapped IPv6 is now blocked. · A refused CORS origin is 403, not 500 (DAST). · **A-307** (2026-09-30, Am. 1): webhook delivery connects through the pinned lookup; a rebinding answer is refused — [record](../MEMORY/records/2026-09-29-a176-ssrf.md) | |
| done 2026-09-30 (ADR-097, ADR-102) | **A-298** stored XSS: `data:` dropped from the CMS policy, now one shared contract (`@callibrator/contracts/contentHtml`) applied on write, on every read and at render (blog/news, ticket description — which was injected raw) · **A-299** API-key dialog offers only scopes the backend accepts (contract + guard against `MENU_SLUGS`) · **A-300** menu-groups bulk actions act on a real selection, bulk revoke confirmed · **A-301** menu-group CRUD and scheduler read effective permissions · **A-302** dropdown clear no longer re-opens — [record](../MEMORY/records/2026-09-30-xss-apikey-menugroups.md). Open: `ticket.service.js` stores the description unsanitized | |

---

## Phase 9 — Backend TypeScript Migration 🟡

[`PHASE-9-TYPESCRIPT-MIGRATION.md`](./PHASE-9-TYPESCRIPT-MIGRATION.md) · ADR-038 · **ADR-087** (the toolchain as built). **The backend is JavaScript until this closes**; backend documents state TypeScript as the target. As-built 2026-09-29: **42 modules are TypeScript** — all 16 `constants/`, 24 `utils/` (`tenantScope`, `response`, `upload` among them), and the two infrastructure middlewares (`activityLog`, `tenantContext`); everything else is JavaScript.

| Card | State 2026-09-28 |
|---|---|
| P9-01 compiler · P9-01a typecheck gate · P9-03 jest runs `.ts` · P9-04 ratchet | **done** (ADR-087, Amendment 1) |
| P9-01b `build:dist` → pkg, image | **done** (ADR-087 Am. 5) — the P9-00 baseline set passes against the converted image: 53/53 specs, 392 tests, per-spec counts identical, 0 × 429 |
| P9-00 behaviour baseline | **done** (ADR-092) — `35ebd76` (0 `.ts`), fresh compose stack, **53/53 specs passed twice** (392 tests, 0 × 429); the set by name in `MEMORY/records/P9-00.md` |
| P9-02 lint | **done** (ADR-087 item 6, ADR-092) — `.eslintrc.js` deleted; global `ignores` in their own object (474 `dist/` files no longer visited); `backend/.prettierrc` governs `backend/`, the root file scoped by a comment |
| P9-02a lint debt | **started** — **0 errors** (was 1,050; baseline 950 → 0), fixed rule by rule and shown AST-identical to `HEAD`; 12 unused directives removed. Open: 263 `no-unused-vars`, 19 `no-console` to triage by hand. **Commit the 137 formatted files alone** |
| P9-03a coverage config | **done** (ADR-085, ADR-092) — models stay outside the figure (measured 93.5/65.58/93.17/93.39) and P9-10's check is replaced; the A-32 guard reads `.ts`, ceiling 30 |
| P9-05 shared types | **started** — `src/types/`: `node-process.d.ts`, `express.d.ts`, `ids.ts` (`TenantId`), `apiResponse.ts` (`ApiResponse<T>`) |
| P9-05a infrastructure modules | **done** — `activityLog`, `tenantContext` (four gates incl. a live PG 18.6 two-tenant check), `packaged`, `storagePath` |
| P9-09 `utils/` | **started** — 30 of 36 `utils/` are `.ts` (3 of them the path utils under P9-05a): 12 leaves (helper 2); `dbReady`, `circuitBreaker`, `tenantScope`, `fileValidation`, `otp`, `response`, `ssrf`, `controllerWrapper`, `upload`, `authorizationWiring`, `publicBaseUrl`, `schedulerSwitch`, `jobContext`, `migrationLock`, `jsonShape` (lead; ADR-087 Am. 4–6). `validators/iot.validator` is `.ts` too (still Joi — the jsonShape ordering gap, closed). Left: `kmsVerify` (P9-18), `jwt` (P9-12), `generateSwagger` (P9-21), `checkMenu`/`session`/`seedMenuGroups` (after P9-10) |
| P9-06 configuration | **part 1 done** (2026-09-29, ADR-087 Am. 6) — `src/config/env.ts` accessors; no `process.env` in any converted module outside `src/config/`. Part 2 (the Zod schema, fail-listing boot) open |
| P9-08 `constants/` | **done** — all 16; `ROLE_LEVELS` checked at compile time |
| P9-10 `models/` | **DONE** (2026-09-29, ADR-087 Am. 7–11) — **71 of 71** models and the barrel `models/index.ts` are `.ts`: batch 1 Kanban (9), batch 2 inventory (6), batch 3 workflow/QMS/suppliers (11, the class variant settled), batch 4 billing/usage/notifications/operations (10, D-21 and D-27 typed), batch 5 calibration/certificates (6; p6 + q02 live green), batch 6 signatures (4; d18 green), batch 7 content/tickets/GDPR (8), batch 8 platform (5), batch 9 the 12 tenant-isolation-critical models with the barrel in one merge (701 suites / 13,076 tests / 100%; live PG18 two-tenant probe 54/54; image + P9-00 E2E baseline twice, per-spec identical). Next in this lane: P9-07 (typed SQL helper, a Stage C prerequisite), then P9-12 once P9-11 lands. Each definition-identical to its JavaScript original over the whole barrel; D-12 holds the `DefaultScoped` brand to the runtime set; model figure did not fall. The spec pattern is amended (TS2502 between mutually-referring models). The barrel stays `.js` until the last batch |
| P9-07 bind-only SQL helper | **DONE** (2026-09-29, ADR-087 Am. 12). `utils/sql.util.ts` is `sql<Row>(runner, text, bind, { transaction })`:<br>• `replacements` and an unbound `$n` are refused before the database is reached;<br>• direct `.query(` in TypeScript source is a lint error;<br>• `rawSqlTenantPredicate.d05` requires helper statements on tenant tables to **bind** `tenant_id = $n`;<br>• the converted utils are migrated; the 19 JavaScript calls move in Stage C;<br>• live on PG18 as `callibrator_app`: 10/10. |
| P9-11 `validators/` Joi → Zod | **DONE** (2026-09-29, ADR-093) — every validator is Zod `.ts` (39 modules + `fields.ts` explicit conversions + `input.ts`, the one helper); `validation.middleware.ts` with `validate(schema, { from })` (path wins) and a typed `req.validated`; metered billing's own middleware folded in; **`joi` uninstalled** (audit 0). Owner decision: the `details` wording is Zod's (every changed string in ADR-093); status, envelope, message and the production rule unchanged. Contract suites 39/45 green; differential vs Joi: 232,655 payloads, differences only in braced/unhyphenated uuids and non-IANA email TLDs; full gate 700 suites / 13,272 tests / 100%; live E2E twice, 53/53 specs (per spec = P9-00, `certificates` +4 from another agent). Left: A-272, A-273, A-274 |
| P9-12 identity & access | **CONVERTED** (ADR-087 Am. 13–14), 2026-09-30.<br>• Every module on the card is `.ts`: jwt.util and the session, webauthn, userPermission, roles, user, auth, apiKey, sso, scim and oidcProvider services, plus oidcJwks.<br>• Each is surface-identical to its JavaScript and at 100%; jwt is also behaviour-identical (1,223 checks).<br>• Compiler-exposed: A-285/286/287 (fixed with A-294), and A-295 (open).<br>• Image baseline run 2026-09-30 (record `2026-09-30-p9-12-image-baseline.md`): 3 runs on an image built from a frozen snapshot; runs 2–3 stable at 5–7 failures of 433, all in new P10 specs or flaky, none in a P9-12 module. `auth`/`sop` E2E specs updated for ADR-099 one-time passwords.<br>• Left for DONE: the full coverage gate on a quiet tree (never quiet; every P9-12 file is at 100% in its own suites) — the coordinator's call. |
| P9-19 `middlewares/` | **IN PROGRESS** (2026-09-29, round 1, P9-19 helper).<br>• **10 of 25 are `.ts`:** `notFound`, `validateUuid`, `requestTimeout`, `globalSanitizer`, `accessLog`, `createFolder`, `errorHandlers`, and, under the four gates, `metricsAuth`, `rbac` and `denyPlatformAuthoring`.<br>• **Identity checks: 11,906, all identical.** 11,053 are for the security three, 853 for the others.<br>• **Gates:** (c) 86 of 88 authz and isolation suites passed; the 2 failures fail the same way with the JavaScript originals. (d) Live PostgreSQL 18.6 checks passed.<br>• **Blocked** on JavaScript services: `auth`, `dynamicAccess`, `abac`, `enforceQuota` and the 9 schedulers (`jobMonitor`).<br>• **Held back:** `bodyDefault` (another agent's change) and `auditLog` (A-41).<br>• Record: `MEMORY/records/2026-09-29-p9-19-middlewares-round1.md` |
| P9-22 `packages/contracts` | **IN PROGRESS** (ADR-097 + Am. 1). **40 of 42** validator modules live in the package (all but `networkSecurity` and `admin`, backend-only on purpose, ADR-097 Am. 2); the backend validators re-export the same objects. The **envelope** has one definition (shared with P9-25's OpenAPI; `openapi.json` byte-identical). Pagination, QMS, logo and access-request constants are canonical there. Frontend request types: ADR-103's generated types are canonical, and `z.input` is interim (8 services). Package 1,057 tests at 100%; `build:dist` and `load:check` (src + dist) green. Record: `MEMORY/records/2026-09-29-p9-22-contracts.md` |
| P9-25 API contract, code-first | **WIP** — foundation done 2026-09-30 (ADR-103). `backend/openapi.json` (OpenAPI 3.1) is generated from per-route `*.openapi.ts` (the validators' own Zod schemas, `zod-openapi`) merged with the remaining JSDoc, and committed. Scalar replaces Swagger UI at `/docs` and `/api/v1/docs`, self-hosted, behind `auth → denyApiKey → rbac([TENANT_ADMIN])`. CI job `api-contract` + `make openapi`: stale file, Spectral (shrink-only baseline, 18), oasdiff vs `main`, frontend types current. Guard `openapiRoutes.p925`: no undocumented route beyond a shrink-only list (76), `x-permission` equals the chain. Pilot `vendor` (backend and the frontend service on `openapi-fetch`). Open: every other module (rides with P9-20/P9-21); live browser check. Record: `MEMORY/records/2026-09-29-P9-25-api-contract-foundation.md` |
| P9-23 migrations | **DONE** (2026-09-30, ADR-087 amendment). All **63** migrations 0001–0090 are `.ts`. Their `schema_migrations` names are unchanged: each still ends `.js`, and `migrator.js` is untouched apart from two comments. `manifestNames.p923.test.ts` freezes the 63 names; it was typed by hand, written first, and seen to fail on a renamed name.<br>• **Identity, original `.js` against compiled `.ts`:** a recording fuzz QueryInterface ran `up`/`down` on every migration, 37,800 runs with 0 differences. A normalised AST diff shows only runtime-neutral lines.<br>• **Live on PG18:** fresh databases from the `.js` and the `.ts` migrations have identical `schema_migrations` names (74 rows), `pg_dump --schema-only` and grants. A database migrated by the `.js` code has nothing pending under the `.ts` tree, and schema-verify is OK. `migrate` and `migrate:status` both exit 0.<br>• **Tests:** 41 migration tests are `.ts`. Record: `MEMORY/records/2026-09-30-p9-23-migrations.md` |
| P9-15 warehouse · P9-17 commercial | **CONVERTED** 2026-09-30 (services helper; record `MEMORY/records/2026-09-30-p9-15-17-warehouse-commercial-services.md`, ADR-087 Am. 18) — `warehouse`, `stock`, `billing`, `finance`, `stripeWebhook`, `meteredBilling` (`quota` earlier, leaf helper): 70,009 identity checks, 33 plants caught; meteredBilling raw SQL to `sql()` as its own change first. Findings A-319…A-322 |
| P9-13 tenancy | **CONVERTED** 2026-09-30 (ADR-087 Am. 19–20) — all ten card modules are `.ts` (featureFlag, admin, tenantBackup by the leaf helper; networkSecurity, tenantHierarchy, customDomains, dataRetention, tenantLifecycle, tenant, tenantUpload by the P9-13 helper): 570,332 identity checks, four gates on the isolation-critical three (live PG18 41/41). Found A-326…A-329 (A-326/327 answer 500 on a tenant edit today). DONE awaits the full gate + image baseline |
| P9-16 quality | **CONVERTED** 2026-09-30 (services helper, ADR-087 Am. 22; record `2026-09-30-p9-16-quality-services.md`) — workflow, qms, risk, supplierScorecard, vendor (+ sop earlier): 3,163 identity checks, 20/20 plants; workflow and qms under the four gates (live PG18 27/27, 20/20). A-330 open |
| Load gate | **added** 2026-09-30 (ADR-087 Am. 15) — `npm run load:check` (dist via node, src via tsx) in `make verify` + CI `backend-load`; lint `EXPORT_EQUALS_ALONE`. Record `2026-09-30-p9-load-gate.md` |
| P9-14, P9-16, P9-18 … P9-21 | partly in flight (Stage C/D); see `OPEN-WORK-2026-09-30.md` §1 for the per-card counts |
| P9-24 close-out | TODO. **Scope amended 2026-09-30 (ADR-109 §5, ADR-087 Amendment 17; working decision):** the phase exits when every **non-test** source module is TypeScript, with `allowJs: false` for source. The `.js` test files are not part of the exit |
| **P9-26** `.js` tests | **new** 2026-09-30. About 696 `.js` files in the test tree are converted opportunistically; the ratchet still refuses any **new** `.js`, tests included. Not a Phase 9 exit item |

| Stage | Tasks | Scope |
|---|---|---|
| A — foundations | P9-00 … P9-07 | baseline, toolchain, lint, tests, ratchet, shared types, typed config, bind-only SQL helper |
| B — leaf layers | P9-08 … P9-11 | constants, utils, 72 models, 37 validators (Joi → Zod) |
| C — services | P9-12 … P9-18 | 76 services in seven domain waves |
| D — HTTP layer | P9-19 … P9-21 | middlewares, controllers, routes, `index` |
| E — close-out | P9-22 … P9-24 | shared contracts package, frozen migration names, `allowJs: false` |

Ratchet: **905 names** in `backend/.ts-ratchet.json` on 2026-09-30 (209 non-test, 696 in the test tree; it was 1,172 on 2026-09-29). It counts source, tests and `backend/scripts`, plus `backend/index.js`. A new `.js` name fails `make verify`, CI and the pre-push hook. It only goes down.

---

## Phase 10 — Landing, Sign-in, Request Access and Verification Revamp 🟡

[`PHASE-10-LANDING-AUTH-REVAMP.md`](./PHASE-10-LANDING-AUTH-REVAMP.md) · ADR-098 · spec [`docs/UI-UX/20-LANDING-AUTH-REVAMP.md`](../docs/UI-UX/20-LANDING-AUTH-REVAMP.md). **Planned 2026-09-29; runs now, in parallel with finishing Phase 9.** Frontend-focused; its backend pieces (request access, SSO discovery, passwordless passkey, invitation, the register flag) are TypeScript under the Phase 9 rules and convert no existing module. It consumes ADR-100's request budgets and link origins (a security agent's change) rather than rebuilding them.

| Card | Scope | Status |
|---|---|---|
| P10-00 | Remove fabricated proof from the live pages | **DONE 2026-09-30** ([record](../MEMORY/records/2026-09-30-P10-00-fabricated-proof-removed.md)) |
| P10-01 … P10-02 | Public tokens and fonts; ID/EN dictionaries | **DONE 2026-09-30** — tokens with a contrast test computed from the CSS, self-hosted OFL fonts, the motif; `id`/`en` dictionaries, cookie, Server Action toggle ([index record](../MEMORY/records/2026-09-30-P10-frontend-as-built.md)) |
| P10-03 … P10-09 | Landing, sign-in, request access (backend, page, queue), verification, forgot/reset | **Frontend DONE in code 2026-09-30** (P10-03, P10-04 page, P10-06, P10-08, P10-09; [index record](../MEMORY/records/2026-09-30-P10-frontend-as-built.md), ADR-098 Amendment 1); **P10-05 and P10-07 IN REVIEW** (ADR-108). Open: the live E2E (P10-13), the privacy notice before `/request-access` is public (Q-42), Lighthouse AC-5/AC-6 not met on a loaded host (Performance 75–91, A11y 100) |
| P10-10 | Passwordless passkey sign-in | **IN REVIEW 2026-09-30**: backend (options/verify, UV required, counts as MFA per Q-46, migration 0100), tested with real signed assertions; sign-in button wired 2026-09-30; virtual-authenticator E2E outstanding. [record](../MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md), ADR-108 |
| P10-11 | Copy-truthfulness guard test | **DONE 2026-09-30** — banned terms, unsourced figures, stock URLs, §11 sources, §12 asset rows; mutation-checked ([record](../MEMORY/records/2026-09-30-P10-11-copy-guard.md)) |
| P10-12 | Register endpoint: production flag, neutral answers | **IN REVIEW 2026-09-30**: `SELF_REGISTRATION_ENABLED` (off in production → 404), one neutral 202. [record](../MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md), ADR-108 |
| P10-13 | Accessibility, performance, live E2E | **IN PROGRESS** — performance part done 2026-09-30: dashboard providers out of the root layout; first-load JS brotli `/` 150.6→123.4 KB, `/verify/*` 155.4→117.9 KB (**AC-7 met**), blog/news 237→119 KB; `frontend/scripts/bundle-budget.mjs` in CI and `make verify`; blog and news on the public surface; axe 0 (11 pages × 320/1280); full frontend jest 286/286 suites. Lighthouse (5× median, interleaved, loaded host): `/` 75→76, `/login` 85→81, `/verify/*` 77→82, `/blog` 70→89 — **AC-5/6 still not met** ([record](../MEMORY/records/2026-09-30-P10-perf-blog.md), ADR-098 Am. 2). Open: live E2E, keyboard/NVDA walks, §14 checklist |
| P10-14 | Certificate-verification enumeration (tracks the security agent's change) | **IN REVIEW**. A-293 is DONE in the working tree (2026-09-29, ADR-100 §1) but not committed; Q-47 still needs the owner's confirmation |
| P10-15 | Invitation acceptance | **IN REVIEW 2026-09-30**: `POST /auth/invitation/accept` (single-use, 7-day token); `/invitation` page built 2026-09-30 ([record](%s2026-09-30-P10-15-invitation-page.md)). [record](../MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md), ADR-108 |
| P10-16 | First super admin: one-time bootstrap password, file inside the container only (ADR-099) | **DONE in code 2026-09-29**, live check open ([record](../MEMORY/records/2026-09-29-superadmin-bootstrap-otp.md)) |

Working decisions Q-39 … Q-47 (ADR-098 §8) were set by the coordinating session and **await the owner's confirmation**; P10-16 is DONE in code; the backend of P10-04/05/07/10/12/15 is built and in review (ADR-108); the public pages are in progress.

---

## Phase 11 — Admin Dashboard Revamp ⏸

[`PHASE-11-DASHBOARD-REVAMP.md`](./PHASE-11-DASHBOARD-REVAMP.md). **On hold until the owner instructs.** Placeholder cards, all BLOCKED; inputs in `docs/UI-UX/research/01–03`.

> 2026-09-29 — **UI correctness fixes done ahead of the redesign** (bug fixing, no visual change; ADR-101, ADR-102, A-312…A-317, [record](../MEMORY/records/2026-09-29-ui-correctness-fixes.md)): certificates can be submitted and approved from the UI, and their author cannot approve them (403, migration 0095); the sidebar and the write buttons of devices/calibration/stock/warehouse/maintenance/vendors/billing/Home follow the effective API permission (`GET /menu-groups/my-permissions`, migration 0097 adds Stock and Object Storage); tenant-backup Restore/Delete and e-signature deletes ask first; global search opens the list filtered to the record; kanban cards move by keyboard. Research findings 01 S6/S7, §3.1, §3.3, §4.4–4.6, §5.4 (seven pages) and 03 F1–F3, F5–F9 are closed; the rest stay Phase 11 input.

---

## Upstream PHP Feature Adoption ⏳

**Post-Phase 9 Priority**: Merging and adopting upstream features from the original PHP fork. Must be completed before Phase 999 implementation begins.

---

## Phase 999 — Go Migration & Dual-Backend Implementation ⏳

[`PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md`](./PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md) · ADR-089. **Dual-backend implementation container**. Porting Go backend engine, multi-frontend targets, and shared components.

| Stage | Scope | Status |
|---|---|---|
| Foundation & Bootstrap | P999-01 … P999-02 | `Planned` |
| Domain & Application Migration | P999-03 … P999-05 | `Planned` |
| HTTP Transport & Security | P999-06 … P999-10 | `Planned` |
| Integrations & Workers | P999-11 … P999-14 | `Planned` |
| Testing & Parity Verification | P999-15 … P999-17 | `Planned` |
| Frontend Integration & Shared Extract | P999-18 … P999-20 | `Planned` |
| Deploy, Performance & Close-out | P999-21 … P999-25 | `Planned` |

*Note: Implementation is strictly blocked until Phase 9 and Upstream PHP Feature Adoption complete.*

---

## Live Health

Re-stated **2026-09-30**. Each row cites the dated record it rests on. A row with no record says **unverified**, because a gate that has not been seen to run has not passed.

| Gate | State | Evidence |
|---|---|---|
| Backend lint | ✅ **0 errors**, ratchet baseline 0 | ADR-092, 2026-09-28. Warnings remain: 263 `no-unused-vars`, 19 `no-console` (P9-02a) |
| Backend unit gate (100%) | 🔴 **red on the shared tree, from in-flight lanes.** The last full run, `npm run test:coverage -- --ci` on Node 26.10.0 on 2026-09-30, gave 767 suites (28 skipped): 763 passed and 4 failed. Tests: 14,127 passed, 8 failed. Coverage: 99.96 / 99.86 / 99.9 / 99.96. The failing suites belong to other agents' unfinished work | `MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md`; `2026-09-30-a303-tenant-profile.md` lists more failing suites from the same cause. **The last green full run** was 2026-09-28: 683 suites, 12,890 tests, 100% (`2026-09-28-p9-helper-lint-baseline-coverage.md`). Re-run it on a **quiet tree** before claiming green |
| Backend typecheck / `build:dist` | 🟡 **red at the last recorded boundary**, only in in-flight files | ADR-087 Amendment 14 item 9 (2026-09-30) |
| Frontend unit gate (90 / 81 / 86 / 91) | ✅ **passing**: 93.3% statements, 84.0% branches, 88.9% functions, 94.0% lines. 280 of 280 suites and 2,911 tests | `npx jest --coverage --ci`, whole tree, 2026-09-30, `MEMORY/records/2026-09-30-f19-fixes.md`. A later Phase 10 run on the same day reported 3 failing suites of its own in-progress work (`2026-09-30-P10-frontend-as-built.md`) |
| Frontend `next build` | 🟡 not re-recorded for the current tree | — |
| Live E2E, one uninterrupted run | ✅ **achieved 2026-09-28, twice**: 53/53 specs, 392 tests, 0 × 429 | P6-02, ADR-077; again at the P9-00 baseline `35ebd76` (ADR-092). By hand on a compose stack, **not in CI**, and never against the reference deployment. The new Phase 10 specs have not run live |
| Browser smoke + a11y | ✅ 5/5 smoke twice (ADR-077); the a11y suite green (ADR-090) | Run by hand (`make test-browser`); not in CI (M-14) |
| CI on GitHub | 🔴 **ran, never green** (read 2026-09-30 from the public Actions API). 10 runs since 2026-09-24, 9 failure + 1 cancelled. On `ce74932`: 7 of 8 jobs green (backend-test 100%, boot-and-migrate PG 18, frontend incl. `next build`, backend-lint + typecheck, npm audit, deploy-config, actionlint); **`secret scan (gitleaks)` red on 3 false positives**, fixed in the working tree and expected green on the next push — not yet observed | P7-01, `MEMORY/records/2026-09-30-p7-01-ci-gitleaks.md`. `gh` is not installed; `https://api.github.com/repos/zed378/callibrator/actions/runs` needs no auth |
| `make verify` end to end | ⚪ **never recorded on one machine** | F-03, U-03 |
| Pre-push hook | 🟡 exists, **opt-in** (`make hooks`; gitleaks, lint ratchet, typecheck, ts-ratchet) | ADR-066, ADR-076 |
| Helm charts | 🟡 **deploy on one kind cluster**; not on a production cluster | P7-06, ADR-106; U-01 |
| Reference deployment (VM) | 🟡 PostgreSQL 17.11 until the closing deploy (wipe) | `RUNBOOK-POSTGRES-18-UPGRADE.md` |

---

## Open Risks Carrying Into Phase 6

From [`../docs/PLAN/18-RISK-REGISTER.md`](../docs/PLAN/18-RISK-REGISTER.md).

| Risk | Severity | State |
|---|---|---|
| **PR-2** — append-only is a convention, not a constraint | critical | **mitigated** 2026-09-25 — P6-03 (ADR-062) |
| **PR-3** — super-admin without enforced MFA | critical | **mitigated** 2026-09-25 — P6-07 (ADR-059): enrolment-only session and audited break-glass |
| PR-1 — a missed tenant predicate | critical | mitigated, monitored |
| PR-5 — silent migration no-op | high | **mechanised** 2026-09-25 — P6-05 (ADR-062) |
| PR-12 — single host | medium | mitigated by preparation only |

---

## Legend

✅ done  ·  🚧 in progress  ·  ⏳ todo  ·  🔴 todo and blocking  ·  🟡 partial or unverified  ·  ⚪ deferred
