# Monorepo restructure and as-built documentation

**Date:** 2026-09-10
**Task:** — (structural work, not a numbered task)
**Spec refs:** none — this record *produced* the reference set

---

## Hook

`CLAUDE.md` instructed engineers and agents to write strict TypeScript with no `any`, for a backend that is **JavaScript, CommonJS**. `TASKS/README.md` listed P1-01 through P1-07 as TODO for work that had shipped months earlier. `MEMORY/DECISIONS.md` described Kubernetes-first deployment and RLS-based tenant isolation, both since changed.

An instruction document that disagrees with the code produces confidently wrong work, **and the confidence is the dangerous part**.

135 documents were rewritten from the code rather than from the plan.

---

## What Changed

### Structure

```
docs/         10 categories, 135 documents + ARCHIVE/
MEMORY/       README · MEMORY-INDEX · CHANGELOG · DECISIONS · records/ · specs/ · templates/
TASKS/        README · conventions · PROGRESS · BACKLOG · phase files
deploy/       compose/ (base + 3 overlays + nginx) · helm/callibrator/ (umbrella + 2 subcharts)
Makefile      development, quality gates, deployment
CLAUDE.md     rewritten
AGENTS.md     rewritten
README.md     rewritten
```

Mirrors the `zed378/wedding-saas` layout for `docs/`, `MEMORY/` and `TASKS/`, as requested.

### Root markdown, classified rather than deleted

| Was | Now |
|---|---|
| `MODULES.md` (4,320 lines) | `docs/BACKEND/10-MODULE-REFERENCE.md` — the ground-truth module reference |
| `FRONTEND.md` (837 lines) | `docs/UI-UX/19-IMMERSIVE-REVAMP-PLAN.md` |
| `MCP_SETUP.md` | `docs/DEVOPS/10-MCP-TOOLING.md` |
| `context.md`, `AUDIT-REPORT.md`, `SETUP-COMPLETE.md`, `MODULES.old.md`, `commands-*.md`, `MEMORY/BLOCKERS.md` | `docs/ARCHIVE/` — superseded, kept for provenance, never authoritative |

### ADRs

Nine added — **ADR-029 to ADR-037**, in a new Part II. Each names the earlier ADR it supersedes. The earlier ADRs were **left in place rather than edited**.

---

## Why

Because the specification and the code had diverged far enough that the specification was actively harmful.

The concrete cost of that divergence, measured: an agent or engineer reading `CLAUDE.md` would have spent effort adding TypeScript types to a JavaScript codebase, or "completed" P1-04 RBAC — which has been running in production, with 11 seeded roles and 58 menu groups, for months.

Rewriting `docs/` from the code makes the reference material checkable. Every document names the file it derives from, so a reader can verify rather than trust.

---

## Alternatives Considered

**Keep the existing spec narrative and write `docs/` as the intended design.** Rejected: it preserves the exact failure being fixed. A specification nobody can check against the code is a specification nobody should follow.

**Right-size to ~60 consolidated documents.** Considered and offered. With 33 modules, 53 route modules and 72 models, per-domain granularity means each document stays small enough to be read before the work it governs.

**Edit ADR-001 to ADR-028 to match reality.** Rejected firmly. An ADR is a record of what was decided at a moment; rewriting it destroys the evidence that the decision changed — which is the one thing a future reader needs. Part II supersedes; Part I stays.

**Delete the superseded root documents.** Rejected. `MODULES.md` in particular is the most accurate artefact in the repository, generated from static analysis of `backend/src`. It became a `docs/` document rather than a casualty.

---

## What Surprised Me

**The gap between the plan and the build was wider than the TypeScript line alone.** Six of the nine new ADRs supersede an earlier one: isolation mechanism, language, deployment target, authentication model, session storage, and realtime transport had all changed without the ADR log recording it.

**`MODULES.md` had already caught most of it** — it carries a dated "current project state" block noting the RLS removal and the Socket.IO reversion. The information existed; it was not where anyone would look for a decision.

**Several inconsistencies are load-bearing rather than sloppy.** `sessions` uses snake_case attributes and `tenantKeyOf()` checks both spellings *because of it*. `UsageMetrics` is the one camelCase table. `tenants.billingCycle` is `monthly`/`yearly` while `subscriptions.billingCycle` is `Monthly`/`Annually`. Each has caused or can cause a defect, so each is documented as a hazard rather than tidied into a claim of consistency.

**`ROLE_LEVELS` contains a role that is not in the database.** `TENANT_ADMIN` at level 8 is a logical tier so one `rbac()` gate covers both admin roles. Looking for it in `roles` and not finding it is the expected outcome, and nothing said so.

**A typo is preserved deliberately.** `ROLE_NAMES.HEALTCARE_ADMIN` is missing its `H`. Renaming it needs a coordinated change to seed data and every consumer, for no behavioural gain. The value it maps to is spelled correctly.

---

## Tests

No application code was changed, so no application tests were added.

What was verified about the deliverables:

| Check | Result |
|---|---|
| `helm lint` on the umbrella chart, prod values | **passes** (one INFO: no icon) |
| Guard: missing `image.tag` | **refuses to render** — verified |
| Guard: `cron.enabled` with `replicaCount=3` | **refuses to render** — verified |
| Valid config renders | ConfigMap, 2 Services, 2 Deployments, Ingress |
| `docker compose config` — base + dev | **valid** |
| `docker compose config` — base + staging | **valid** |
| `docker compose config` — base + prod, no `ACME_DIRECTORY_URL` | **refuses** — the guard working |
| `docker compose config` — base + prod, ACME set | **valid** |
| Makefile recipe indentation | 85 targets, 0 space-indented recipe lines |

**Not verified: the Makefile has not been executed.** `make` is not installed on this machine. Its syntax and indentation were checked statically; its behaviour was not.

---

## Definition of Done

- [x] Documentation grounded in the code, naming source files
- [x] Root markdown classified, not deleted
- [x] ADRs recording every known divergence
- [x] `deploy/` with compose and Helm
- [x] Makefile
- [x] Helm and compose artefacts validated
- [ ] **Makefile executed** — `make` unavailable here
- [ ] **Helm charts applied to a cluster** — none reachable

**Waived:** nothing. The two unchecked items are stated as not determined, not waived.

---

## Security and Compliance

No application code changed, so no control changed.

Several gaps were **documented rather than introduced**, and each now appears in the risk register and the backlog:

| Gap | |
|---|---|
| **PR-2** — `calibration_records` append-only is a **convention, not a constraint**. The model is `paranoid` and has `PUT`/`DELETE` routes. Under 21 CFR Part 11 this is the finding an auditor raises first. |
| **PR-3** — MFA is available, not enforced, including for `SUPERADMIN`, which bypasses every permission check with no second gate. |
| No build guard fails a route missing a permission gate — the most likely authorization defect has no mechanism against it. |
| `calibration_devices.serialNumber` is globally unique, making a uniqueness collision a weak cross-tenant oracle. |

Writing these down rather than omitting them is deliberate. A compliance document that claims a control it does not have is worse than one that names the gap, because it stops anyone looking again.

---

## What to Watch

- **Any document making a claim with no file reference.** That is the shape of the problem this record fixes.
- **Whether `docs/` stays as-built.** The deviation protocol makes a `docs/` change an event with a record; without it, this set drifts exactly as the last one did.
- **The two "renders but is not known to work" claims** — the Helm charts, and the E2E suite that has never passed in one uninterrupted run. Both will be tempting to round up in a status report.
- **`Part II` of `DECISIONS.md`.** If a tenth divergence appears and no ADR is written, the log is drifting again.

---

## What Was Not Determined

Stated plainly.

- **The Makefile has not been run.** `make` is not installed on this machine. Recipe indentation and syntax were checked statically across 85 targets; execution was not.
- **The Helm charts render; they are not known to deploy.** `helm lint` and `helm template` pass and both guards fire correctly. `kubectl apply --dry-run=server` has not been run because no cluster was reachable.
- **The compose stacks validate; they have not been brought up.** `docker compose config` passes for all three overlays and the production ACME guard fires; no containers were started.
- **`docs/` accuracy rests on static reading of the code**, not on executing every path. The endpoint inventory, model schemas, middleware order, role constants and configuration keys were extracted programmatically from source. Behaviour described in prose — particularly around workers, schedulers and realtime — is inferred from code and from the audit report, not observed.

---

## Follow-Ups

All in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md):

| Item | Why |
|---|---|
| Restore the backend coverage gate | it is **currently failing**; a failing gate is a gate nobody trusts |
| One clean full E2E pass | verified fix by fix, never as a suite |
| `REVOKE UPDATE, DELETE` on `calibration_records` | PR-2 — turn the convention into a constraint |
| Build guard for routes without a permission gate | the gap with no mechanism |
| Post-migration column verification | a blanket-catch migration is recorded as applied while doing nothing |
| Composite unique on `(tenant_id, serial_number)` | close the oracle |
| Mandatory MFA at role level 10 | PR-3 |
| Validate the Helm charts against a real cluster | turn "renders" into "works" |
| Align Swagger with the GDPR validators | documented drift is still drift |
| A rotation procedure for `CERT_SIGNING_SECRET` and `ENCRYPT_KEY` | neither is rotatable today, so "rotate the key" is not an available incident response |

---

## Links

- ADRs: [ADR-029 to ADR-037](../DECISIONS.md) — Part II
- Changelog: [Unreleased](../CHANGELOG.md)
- Backlog: [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md)
- Risk register: [`../../docs/PLAN/18-RISK-REGISTER.md`](../../docs/PLAN/18-RISK-REGISTER.md) — PR-4 is this record's subject
