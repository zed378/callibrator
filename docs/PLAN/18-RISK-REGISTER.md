# 18 — Risk Register

Project and platform risks. Not to be confused with `docs/` coverage of the **product** risk module (`risks` table, `/dashboard/risk`), which is a customer-facing feature — see [`04-FEATURE-SPECIFICATION.md`](./04-FEATURE-SPECIFICATION.md).

Risks are `PR-<n>`. Severity is the consequence if it happens; likelihood is a judgement, stated so it can be argued with.

---

## Critical

### PR-1 — A single missed tenant predicate leaks patient-adjacent operational data

**Severity:** critical · **Likelihood:** low · **Status:** mitigated, monitored

One tenant seeing another hospital device register, calibration history and staff is the failure that ends the product.

**Mitigation in place:** isolation is deny-by-default in global Sequelize hooks (`tenantScope.util.js`), not per-query. The opt-out (`skipTenantScope`) is a single greppable string. A principal with no resolvable tenant matches `NO_TENANT_UUID` and sees nothing.

**Residual risk:** hand-written raw SQL and vector similarity queries bypass the hooks. `document_chunks` retrieval in the AI module is the highest-risk instance — see [`14-ANALYTICS-AND-REPORTING.md`](./14-ANALYTICS-AND-REPORTING.md).

**Watch:** any new `sequelize.query(...)`; any new `skipTenantScope`; the AI retrieval path.

### PR-2 — The append-only guarantee is a convention, not a constraint

**Severity:** critical · **Likelihood:** medium · **Status:** **open**

`calibration_records` is `paranoid`. A sufficiently privileged caller can soft-delete evidence. `audit_logs` is protected by having no delete path; `calibration_records` has one.

Under 21 CFR Part 11, originality of the record is not optional, and a control that depends on nobody calling `destroy()` is not a control.

**Mitigation:** `REVOKE UPDATE, DELETE ON calibration_records` for the application role, matching what `audit_logs` gets by construction. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

### PR-3 — Super-admin credential compromise

**Severity:** critical · **Likelihood:** low · **Status:** partially mitigated

`SUPERADMIN` bypasses every permission check and every tenant predicate. There is no second gate.

**Mitigation in place:** MFA and WebAuthn available; sessions bound to IP and user agent; failed-login lockout; all actions audited.

**Residual risk:** MFA is available, not enforced. A super-admin account without a second factor is one credential away from total compromise.

**Mitigation to add:** mandatory MFA for level 10, enforced at login rather than requested at onboarding.

## High

### PR-4 — The stale-specification trap

**Severity:** high · **Likelihood:** **realised** · **Status:** being corrected by this documentation set

`CLAUDE.md` instructed agents and engineers to write strict TypeScript with no `any` for a backend that is JavaScript. `TASKS/README.md` listed P1-01 to P1-07 as TODO for work that shipped months ago. `MEMORY/DECISIONS.md` described Kubernetes-first deployment and RLS-based isolation, both since changed.

An instruction document that disagrees with the code produces confidently wrong work, and the confidence is the dangerous part.

**Mitigation:** `docs/` is now as-built and names its source files. `MEMORY/DECISIONS.md` carries ADR-029 through ADR-037 recording the divergences. The deviation protocol makes a `docs/` change an event with a record.

**Watch:** any document making a claim with no file reference.

### PR-5 — Silent migration no-op

**Severity:** high · **Likelihood:** medium · **Status:** known, not mechanised

A migration wrapped in a blanket `try/catch` around `describeTable` is **recorded as applied while doing nothing**. The column never appears; the failure surfaces weeks later as a runtime error.

The Umzug context **is** the QueryInterface — `context.sequelize.getQueryInterface()` throws, and the same catch swallows it.

**Mitigation:** verify columns in the database after migrating; never trust the migration log alone.

**Mitigation to add:** a post-migration assertion step comparing expected columns against `information_schema`.

### PR-6 — Fail-open regressions in optional subsystems

**Severity:** high · **Likelihood:** medium · **Status:** mitigated by defaults, fragile

Several subsystems are optional and degrade when unconfigured. Each carries a fail-open/fail-closed decision, and the safe default is not always the convenient one.

| Subsystem | Current default | Correct? |
|---|---|---|
| Virus scanning | fail-**closed** (`VIRUS_SCAN_FAIL_OPEN=false`) | yes |
| Tenant scoping with no context | **deny** | yes |
| CORS with no configured origins in production | **reject** | yes |
| CORS outside production | allow all | acceptable for dev only |
| Rate limit outside production | 100,000 / 15 min | acceptable, and it must never leak into production |

**Watch:** any change flipping one of these toward convenience. The RLS policy that was removed had exactly this shape — `app.current_tenant = ''` matched every row.

### PR-7 — Frontend services written against imagined endpoints

**Severity:** high · **Likelihood:** **realised** · **Status:** partially corrected

Several frontend service modules were written against endpoints that did not exist, with tests mocking the fabrication — so 3,863 tests passed while 13 endpoints were broken.

**Mitigation:** all 51 frontend services now have tests asserting the exact path, method, payload and envelope unwrap. A live E2E suite exercises the real server.

**Rule that follows:** a mock test proves the client calls what the developer believed. Only a live call proves the contract. See [`../TESTING/00-TEST-STRATEGY.md`](../TESTING/00-TEST-STRATEGY.md).

## Medium

### PR-8 — Vendor concentration on Stripe

**Severity:** medium · **Likelihood:** low · **Status:** accepted

Billing, invoicing and the webhook path are Stripe-shaped, including the enum vocabularies. Migrating providers is a schema change, not a config change. Accepted knowingly.

### PR-9 — Vendor concentration on an OpenAI-compatible LLM

**Severity:** medium · **Likelihood:** low · **Status:** mitigated

`OPENAI_BASE_URL` allows any compatible endpoint, and per-tenant keys allow a tenant to use its own. Embedding dimensionality is pinned at `vector(1536)`; changing model families means re-embedding every chunk.

### PR-10 — Reporting on the operational database

**Severity:** medium · **Likelihood:** medium · **Status:** accepted, with a trigger

There is no warehouse. Reports query operational tables with indexes chosen for them.

**Trigger for action:** measured impact of reporting queries on operational p95. The answer at that point is a read replica, not a warehouse.

### PR-11 — `iot_readings` and `audit_logs` unbounded growth

**Severity:** medium · **Likelihood:** high · **Status:** partially mitigated

`iot_readings` is the highest-volume table; `audit_logs` grows monotonically and by design has no delete path.

**Mitigation in place:** retention policies purge `iot_readings`.

**Not in place:** partitioning. `audit_logs` cannot be purged without a compliance decision.

### PR-12 — Single-host deployment

**Severity:** medium · **Likelihood:** medium · **Status:** mitigated by preparation

The default deployment is Docker Compose on one host: one machine, one failure domain.

**Mitigation:** Helm charts exist as the escape route, written while it was still cheap. They **render**; they are not yet known to be accepted by a real cluster, because no cluster has been reachable. That distinction is the honest state and should not be smoothed over in a status report.

## Low

### PR-13 — Enum vocabulary inconsistency

`tenants.billingCycle` is `monthly`/`yearly`; `subscriptions.billingCycle` is `Monthly`/`Annually`. Casing and word choice both differ. Mapping code must not assume a case transform suffices.

### PR-14 — `sessions` uses `tenant_id`, everything else uses `tenantId`

Already caused a production defect: a retention purge wrote `Session.destroy({ where: { tenantId } })`, failed with `column "tenantId" does not exist`, and broke the nightly cron. Tenant scoping handles both spellings; hand-written queries do not.

### PR-15 — `UsageMetrics` is the one camelCase table name

Everything else is snake_case. Only matters in raw SQL, where it will need quoting on PostgreSQL.

### PR-16 — Puppeteer needs a system Chromium in compiled builds

Certificate PDF rendering fails at first use, not at startup, when `PUPPETEER_EXECUTABLE_PATH` is unset outside Docker. A late failure in a compliance-critical path.

## Review

This register is reviewed at each phase boundary and whenever a risk is realised. A realised risk is not deleted — it is marked realised and keeps its entry, because the next person needs to know it happened, not that it was once considered.
