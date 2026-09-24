# Phase 0 Foundation Repairs — 2026-09-24

**Kind:** change record
**Tasks:** D-01, D-03, D-07 ([`AUDIT-2026-09-DATA`](../../TASKS/AUDIT-2026-09-DATA.md)) · S-02 ([`INFRA`](../../TASKS/AUDIT-2026-09-INFRA.md)) · W-05, W-11 ([`ASYNC`](../../TASKS/AUDIT-2026-09-ASYNC.md)) · F-01, F-02, F-06 ([`FRONTEND`](../../TASKS/AUDIT-2026-09-FRONTEND.md)) · AZ-04 ([`AUTHZ-MATRIX`](../../TASKS/AUDIT-2026-09-AUTHZ-MATRIX.md)) · V-01, A-57, A-58 ([`REMEDIATION`](../../TASKS/AUDIT-2026-09-REMEDIATION.md))
**Decisions:** ADR-042, ADR-043
**Repairs:** commit `36205df`, pushed red

---

## What Happened First

Seven fix agents were cut off by an API usage limit mid-task on 2026-09-23. Their partial work was
committed and pushed as `36205df`, leaving `main` **red on origin**: 8 suites, 43 tests.

That state is worth recording precisely because of what it contained. It was not uniformly broken:

| Kind | Example |
|---|---|
| finished and correct | the tenant-admin lockout fix |
| **test written, fix missing** | D-07: 21 failing tests, and none of the seven model files touched |
| **fix correct, test broken** | D-01: the `upsert` stub dropped `bind`, so a correct hook could never be observed |
| **fix present, wired to nothing** | A-58: a 632-line boot assertion with no caller |
| **fix that would have failed every real run** | S-02: the rewrite wrote `action: "RESTORE"` to an ENUM that does not contain it |

The last row is the reason no agent's work was committed without a second agent reading it
critically. On PostgreSQL an invalid ENUM value throws, the transaction rolls back, and **every
tenant restore would have failed** — while the suite was green, because the mock accepted any string.
That is the fourth instance this month of a mock inventing the contract.

## Fixed

| | What it was |
|---|---|
| **D-01** | `bulkCreate` and `upsert` were outside the tenant hooks entirely. Now a write naming another tenant is refused — checked in Sequelize's source, where `upsert` snapshots values **before** `beforeUpsert` runs, so re-stamping could never have worked. Verified live against PostgreSQL: tenant B's row stayed `B-ORIGINAL` |
| **V-01** | every `rbac([TENANT_ADMIN])` route refused every tenant admin. Now has the seam test nobody had: the real loader into an unmocked `rbac` |
| **A-58** | five workflow routes gated on `"workflow"`; the slug is `"workflows"`. Fixed, and a two-phase boot assertion now refuses to start on any gate naming an unseeded slug — **watched failing** on the typo and on a mismatched `role_level` |
| **AZ-04** | both authorization middlewares, and `user.service.js`, answered 403 for another tenant's id. Now a byte-identical 404. **Five existing tests had encoded the oracle** |
| **S-02** | restore deleted every user and recreated them without passwords. It now never deletes a live account, never trusts the file's tenant, and refuses an altered archive |
| **D-03** | a global retention policy purged every tenant's rows, audit logs included |
| **D-07** | `restoreStatic()` on seven models wrote nothing and reported success |
| **A-57** | the public verification endpoint published a draft certificate's PDF; the filename was a sequential counter |
| **W-05** | one Redis blip ended the client forever — read from ioredis's own source, not assumed |
| **W-11** | a deleted role kept granting for an hour; invalidating the cache alone would not have fixed it |
| **F-01 / F-06** | logout left the socket open and `x_tenant_id` set, so the next user in the tab inherited the last one's tenant |
| **F-02** | the dashboard's "All Systems Go" panel was hardcoded |

## Found While Fixing, Deliberately Not Landed

- **`dynamicAccess` still writes `error.message` in a 500.** The fix was written, tested, and
  **reverted**: on its own it makes search fail **open**, because the search probe treats any call
  to `next` as "allowed". A seam between two correct changes, the same shape as V-01. The patch is
  ready; `search.controller.js:24` must change with it.
- **The frontend coverage gate (70 %) has never been green** — about 14 % — and nothing runs it.
- **`models/` is excluded from the backend coverage gate twice.** The "100 %" has never measured a
  model.
- **`tenantStore` sets `x_tenant_id` whenever a super-admin merely views a tenant.**
- Two decisions taken as defaults and left for the owner: **Q-09**, **Q-10**.

## Evidence

- Backend, `npm run test:coverage`: **315 suites, 6,359 tests, 100 %** statements, branches,
  functions and lines — run by the orchestrator, not taken from an agent's report.
- Frontend, `npx jest`: **74 suites, 712 tests**; `npx tsc --noEmit` exit 0.
- Every fix in the table above has a named test shown failing against the unfixed code; the names
  are on each card.

## What This Does Not Cover

- **Only one fix was exercised against a real database** (D-01, on PostgreSQL 16 — the cached
  image, not 18). Everything else is unit or integration level.
- **Nothing here has been deployed.** The reference VM still runs the pre-remediation code on
  PostgreSQL 17.11.
- **The live E2E suite has still never completed an uninterrupted run.**
