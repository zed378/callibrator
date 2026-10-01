# Phase 7 — Operational Maturity — Summary

**Completed:** **not yet.** This is an interim summary. The phase exit requires a summary and none existed (`OPEN-WORK-2026-09-30.md` §2). It states the phase as it stands on 2026-09-30, including what is open. Re-issue it, dated, at close.
**Duration:** 2026-09-25 (P7-02, P7-07, P7-08 started, ADR-066) → open
**Tasks:** 4 of 8 DONE (P7-04, P7-05, P7-07, P7-06 on kind); 4 PARTIAL (P7-01, P7-02, P7-03, P7-08); none deferred

> Saved as `MEMORY/records/2026-09-30-phase-7-summary.md` (template: `MEMORY/templates/PHASE-SUMMARY-TEMPLATE.md`).
>
> **The exit is interpreted by ADR-109 §3** (a working decision under the owner's delegation, awaiting the owner's confirmation). P7-06 on kind counts; a production cluster (U-01) is post-go-live. "Wakes somebody" needs a real alert destination and log sink that only the owner can supply.

---

## What Shipped

Operators can now restore the system from a backup and know how long it takes: 234 seconds in the one drill. A restore under the wrong encryption key refuses to start. Scheduled jobs report failures to a configurable route. Logs are structured and can be shipped. The Kubernetes charts install, upgrade and roll back on a real (kind) cluster. None of this is yet wired to a person who would be woken.

| Task | Title | Record |
|---|---|---|
| P7-04 | A full restore drill | `2026-09-27-p7-04-restore-drill.md` (ADR-078) |
| P7-05 | Formalise the secret backup procedure | `2026-09-27-p7-04-restore-drill.md` (ADR-078); `docs/SECURITY/14-SECRET-ESCROW.md` |
| P7-06 | Validate the Helm charts against a real cluster | **on kind only:** `2026-09-30-p7-06-helm-kind-cluster.md` (ADR-106) |
| P7-07 | Pin the two `:latest` base images | `2026-09-25-phase0-batch6.md`, `-batch7.md` (ADR-066) |
| P7-01 | CI pipeline | **PARTIAL.** `2026-09-28-p7-01-02-03.md` (ADR-066, ADR-082) |
| P7-02 | Alerting on scheduled-job outcomes | **PARTIAL.** `2026-09-28-p7-01-02-03.md` (ADR-066, ADR-082) |
| P7-03 | Structured log shipping | **PARTIAL.** `2026-09-28-p7-01-02-03.md` (ADR-082) |
| P7-08 | Split swagger onto its own CSP | **PARTIAL.** `2026-09-25-phase0-batch6.md`, `-batch7.md` (ADR-066, ADR-071). The card says the content-origin work has **no record of its own** |

---

## What Deviated From `docs/`

| Deviation | ADR | Why |
|---|---|---|
| CI stages were proved by running their own steps in their own images, locally, rather than on GitHub | ADR-082 | Nobody had read a GitHub run, and "the workflow file exists" is not evidence. The local method found three red-on-day-one defects |
| Alert routing is `ALERT_WEBHOOK_URL` and/or `ALERT_EMAIL_TO`, and the boot log states the route | ADR-082 | A route that is silently unset is the failure P7-02 exists to prevent |
| The backend renders **no** certificate PDF. The frontend renders it from `GET /certificates/:id/document` | ADR-095 §4 (owner decision) | Drill finding D-1: the packaged image could not run puppeteer. Chromium left the image |
| Helm is validated on **kind**, not a production cluster, and "known to deploy" is read as kind for this stop | ADR-106; **ADR-109 §3** (working decision) | No production cluster exists or is reachable (U-01) |
| A restore with the wrong KMS key **refuses to boot** (`utils/kmsVerify.util`) | ADR-078 | The drill booted under the wrong key and failed per request instead (D-6) |
| Swagger UI is replaced by Scalar, behind sign-in (touches P7-08's API-origin CSP) | ADR-103 | P9-25. The docs page now has its own policy |

---

## What Was Deferred

| Item | Waiting on | Backlog entry |
|---|---|---|
| A real alert destination on a deployment (P7-02) | owner-supplied `ALERT_WEBHOOK_URL` / `ALERT_EMAIL_TO` and a working `MAIL_*` transport | `BACKLOG.md` § Owner-Supplied Values; ADR-109 §3 |
| A real log sink on a deployment (P7-03) | the owner's sink endpoint and credentials for Vector | same |
| The infrastructure-backup alert (outside the process) | P7-02 follow-up | P7-02 card |
| WAL archiving, a scheduled infrastructure dump, `make restore` | engineering work | M-12 |
| Scheduled restore verification | M-12 | U-05 |
| A production cluster | an environment | U-01 (post-go-live, ADR-109 §3) |
| Image build/push and the E2E stage in CI | P7-01 | P7-01 card; A-19 |
| The `contentHtml` inline-script check in a suite, and P7-08's record | `automate/` now has a browser runner | P7-08 card; M-14 |

---

## What Failed

**The drills were real: each one broke something.**

- **The restore drill (P7-04, ADR-078).** It restored cleanly only after two procedure fixes, and it produced seven findings:
  - **D-1:** the image could not render certificate PDFs. Closed by ADR-095: the frontend renders them.
  - **D-2:** postgres init.
  - **D-3:** API tenant backups held **no users**.
  - **D-4:** the role must exist before `pg_restore`.
  - **D-5:** secrets must be restored first.
  - **D-6:** a restore under the **wrong KMS key booted**, then failed on every request. It now refuses at boot.
  - **D-7:** `migrate:status` never exited (M-13, fixed).
- **CI in its CI form (P7-01, ADR-082).** Three stages were red on day one:
  - `npm ci` under the job's `NODE_ENV=production` skipped `tsx`, so the boot failed with `ERR_MODULE_NOT_FOUND`;
  - `migrate:status` hung;
  - coverage depended on a local `.env`.

  Each was proved in the failing direction after the fix.
- **Log shipping (P7-03).** The Loki sink templated an `alert` label that most events do not have, so Vector logged `template_failed` on every non-alert line. The label moved to its own sink.
- **Helm on kind (P7-06, ADR-106).** Seven chart defects were found:
  - `checksum/config` was always empty, so a ConfigMap change never rolled the pod;
  - `ALLOW_SEEDING` could not be set;
  - public origins fell back to development values;
  - `/health` was not on the ingress;
  - probe timeouts were 1 s, and the frontend had no startup probe;
  - the startup budget (300 s) was shorter than the migration-lock timeout (600 s);
  - the chart's own notes said "renders only".

  It also found **A-310: sign-in fails under the shipped `FORCE_HTTPS: "true"`**. That is fixed in code and **not** re-run on kind.
- **The card said "never run on GitHub" and "lint ratchet red (1,061 vs 950)" after both were probably untrue.** Lint has been at 0 since 2026-09-28. The workflow has been on `origin/main` with `on: push` since 2026-09-27. The board was reconciled on 2026-09-30, and the GitHub result is still **unread**.

---

## Security Outcomes

| Control | Test | Result |
|---|---|---|
| A restore under the wrong key refuses to boot | `kmsVerify.util.p705` (9) | green 2026-09-28 (ADR-078) |
| Secrets restore | the P7-04 drill checklist: counts, a two-tenant isolation 404, 8 certificates valid with identical hashes, 14 attachments byte-identical | identical before and after, 2026-09-28 |
| Tenant isolation after a restore | the drill's isolation 404 probe | held, 2026-09-28 |
| Alert routing to a receiver | `alertRouting.p702` (end to end into a real HTTP receiver) | green 2026-09-28. **Proves the client, not that a person is reached** |
| Metrics endpoint gated | `metricsAuth.p702` | green |
| API docs CSP | `csp.p708` | green 2026-09-25 |
| Page CSP (per-request nonce) | `lib/securityHeaders.test.ts`, `proxy.test.ts` § "the page CSP"; a headless check of 11 pages with 0 violations | green 2026-09-25. The `contentHtml` script check was **one-off**, not in a suite |
| Cluster guards | `helm upgrade` refusing `replicaCount=2` with cron on, and an empty `kmsMasterKey` | refused on kind, 2026-09-30 |
| Secret scanning | gitleaks, `prePushHook.a19.test.js` (11) | the hook is opt-in. CI's gitleaks step is configured, and **no GitHub run has been read** |

---

## Compliance Outcomes

| Requirement | Evidence |
|---|---|
| Append-only records | unchanged by this phase. They are constraints (Phase 6, ADR-062, ADR-095), and the drill confirmed they survive a restore |
| Signature completeness | 8 certificates verified with identical hashes after the restore (P7-04) |
| Audit trail continuity | a failed audit write goes to the logger (A-42), and log shipping works locally (P7-03). **It wakes nobody yet**: no deployment ships logs or sets an alert route |
| Retention and legal hold | the retention sweep's `incomplete` result and the quarantine `truncated` result now alert as warnings (ADR-082) |

---

## What Was Not Determined

- **Whether CI has ever run green on GitHub.** The workflow is on `origin/main`, and nobody has read the Actions tab (`gh` is not installed on the authoring machine).
- **Whether anyone is woken.** No deployment has an alert route or a log sink.
- **Whether the charts deploy on a production cluster:** managed CNI, a real StorageClass, several nodes, cert-manager, external secrets, and the prod/staging values files. Browser sign-in through the ingress with `FORCE_HTTPS: "true"` was blocked by A-310, which is now fixed in code but not re-run.
- **RTO at production volume.** 234 s is one compose drill on drill-sized data (U-04). RPO is "the age of the last manual dump" until M-12.
- **`make verify` end to end on one machine** has never been recorded (F-03).

---

## Definition of Done

- [ ] Every task in the phase file is `DONE`. **Not met:** P7-01, P7-02, P7-03 and P7-08 are PARTIAL
- [ ] Every `DONE` task has a record. P7-08's content-origin work has none of its own (the card says so); the DONE tasks do
- [ ] The global Definition of Done is satisfied for each, or the waiver is recorded with **who agreed**. ADR-109 §3 awaits the owner's confirmation
- [x] This summary exists (interim)
- [x] Security outcomes are **named**, not asserted
- [x] `TASKS/PROGRESS.md` reflects reality (reconciled 2026-09-30)

Phase exit (`PHASE-7` § Phase Exit, read with ADR-109 §3):
- [ ] a failing scheduled job wakes somebody (needs the owner's alert destination)
- [ ] a failed audit write wakes somebody (needs the owner's log sink)
- [x] a restore has been performed, and the RTO measured (234 s, one drill)
- [x] the Helm charts are known to deploy: on kind (U-01 is post-go-live, a working decision)
- [x] a phase summary names what failed during the drills (this document)

---

## What to Watch

- **An unset alert route.** The boot log warns about it, and nothing else does. A deployment that ignores the warning has P7-02 in name only.
- **A restore run from a runbook without the escrowed KMS key.** The refusal is correct, and it will look like an outage.
- **Probe budgets on a slow node.** On the contended kind VM the frontend was still killed by its probes now and then, even with the new budgets.
- **Two replicas on RWO volumes.** It worked on kind only because both pods ran on one node.

---

## Metrics

| | |
|---|---|
| Tasks completed | 4 of 8 (P7-06 on kind) |
| ADRs written in the phase | ADR-066, 071, 078, 081, 082, 106, and 109 §3 (working decision) |
| Specification gaps found | "known to deploy" (kind or production: decided, ADR-109 §3); "wakes somebody" (needs owner values) |
| Defects found **after** a task was marked done | P7-01's card went stale on both claims within two days. The Helm charts "rendered" for weeks with seven defects that only a cluster exposed |
| Drill findings | 7 (P7-04), 3 (P7-01), 1 (P7-03), 7 chart defects plus A-310 (P7-06) |

---

## Next Phase

Phase 8 is trigger-driven. ADR-109 §4 defines "complete for this stop" for it. Phase 7 closes when:
- the owner supplies the alert destination and log sink, and a failing job and a failed audit write are seen to arrive;
- the GitHub Actions result for the pushed SHA is read and recorded (P7-01);
- the A-310 re-run on kind passes;
- P7-08's `contentHtml` check is in a suite, with its record;
- the owner confirms or overturns ADR-109 §3.
