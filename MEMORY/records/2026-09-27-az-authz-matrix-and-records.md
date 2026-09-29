# Authorization Matrix, Records and Docs-Gap Boards Worked to Completion — 2026-09-27/28

**Kind:** change record · **Decision:** ADR-088 · **Boards:** `AUDIT-2026-09-AUTHZ-MATRIX.md`, `AUDIT-2026-09-RECORDS.md`, `DOCS-GAP-2026-09.md`, `PHASE-5-ANALYTICS.md`

## Code

| File | Change |
|---|---|
| `backend/src/routes/api/quota.route.js` | `GET /` gains `dynamicAccess(MENU_SLUGS.BILLING, "read")` (ADR-088 §1) |
| `backend/src/constants/routeGateExemptions` | the stale `accepted` entry for `GET /quota` is removed (the P6-04 guard fails on a stale entry) |
| `backend/src/services/ai.service.js` | `RAG_READABLE_SOURCE_TYPES`; retrieval adds `source_type = ANY($4::text[])` (ADR-088 §3) |
| `backend/src/tests/services/ai.service.test.js` | the `retrieveContext` bind expectation gains the fourth parameter |

## Named Tests

All run on Node 26.10.0 via `npm test`. The route tests use the real `dynamicAccess` over the real seed (`fixtures/seededAuthorization`).

| Test | Result |
|---|---|
| `qms.gate.az01.test.js` | 66 pass. Mutation: removing the `GET /nc` gate → 8 fail |
| `quota.gate.az01.test.js` | 13 pass. Mutation: `auth` alone → 9 fail |
| `ai.ragReach.az02.test.js` | 4 pass, alongside `ai.service.test.js` (26 total) |
| `routePermissionGuard.p604.test.js`, `readGates.p604`, `readGates.a155`, `networkSecurity.evaluateLogin.a179`, `dataRetention.gate.a136`, `ai.gate.a94` | pass. The last five were already on the tree; they are named here as the proof of each matrix row |

The AZ-02 SQL was also run once, by hand, on `pgvector/pgvector:pg18` (PostgreSQL 18.6). With a `SopDocument` row and a `Certificate` row in tenant A, and an SOP in tenant B, only tenant A's SOP was returned. It is not in a suite.

The mutation checks were made by editing the route, running the test, and restoring the file in the same command.

## Boards

- **AUTHZ-MATRIX:** AZ-01, AZ-02 and AZ-03 are DONE. Each row is in § Row-by-Row Verification with its test. One gate changed (`GET /quota`).
- **RECORDS:**
  - R-01 was already done in `4c085ef`, and is confirmed.
  - R-02: counts re-derived with their method in `CLAUDE.md` and `PROGRESS.md`.
  - R-03 is superseded: lint is 0.
  - R-04 is new. It adds retroactive records for `4c085ef` and `f1caf6b`, the batch-6 index row and changelog section, and index rows for both retroactive records.
- **DOCS-GAP:** DOC-01…DOC-17. See the board statuses. Agents wrote DOC-01/11/12, DOC-03/04/08/09/10, DOC-02/15/16/17 and DOC-05/06/07/14. The lead wrote DOC-13 and the stray `/health` and rate-limit corrections, and reviewed every report.
- **PHASE-5:** P5-08 is closed as superseded by P8-04, and the phase is DONE. The index claims were checked in the models and in migration `0067`.
- **CLAUDE.md:** the Scale row was re-counted. § "Two Things Currently Failing" is now "What Is Currently Failing", rebuilt from the records:
  - coverage: 12,890 tests;
  - lint: 0 / 0 (ADR-092);
  - E2E: green twice (ADR-077).

  `TASKS/README.md` and `PROGRESS.md` § The state of the gates were refreshed to match.

## Not Done / Open

- **`GET /dashboard/metrics`** stays `accepted`, as an owner question: FACILITY MAINTENANCE and WAREHOUSE STAFF have no `dashboard` grant.
- **`STORAGE/04`** still holds two contradictions. Another agent's diff held that file.
- **Code comments** that contradict code are listed in ADR-088's implications.
- **A-40's card body** on the remediation board still says TODO while its index row says DONE. That board belongs to another owner.
- **`custom-domains`** grants differ from A-02's text; the question is open in `MEMORY/specs/A-02-tenant-config-access.md`.
