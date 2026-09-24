# Phase 0, Batch 3 — Checkpoint — 2026-09-24

**Kind:** change record, **checkpoint.** Committed at the owner's request while four fix agents were
still running. Their in-flight edits are included, and their work is recorded when it lands.

**Cards closed** (details on each card in [`REMEDIATION`](../../TASKS/AUDIT-2026-09-REMEDIATION.md)
and [`DATA`](../../TASKS/AUDIT-2026-09-DATA.md)):

| | |
|---|---|
| **A-63** critical | any user could edit or suspend any tenant — the `checkSelf` bypass trusted a body `userId` |
| **A-64** critical | a `PUT` could approve or sign a certificate |
| **A-65** | anyone could sign anyone's step; signing now always re-authenticates (ADR-047) |
| **A-66** | QMS had no permission gate or audit trail — and its screen had been empty since it was built |
| **A-67** partial | the login limiter now records failures. Per-IP counting ships **off** (`AUTH_RATE_LIMIT_BY_IP`), because behind the proxy every browser shares one address |
| **A-70, A-72** | suspended users are refused at SSO and login; logins write `LOGIN` audit rows |
| **A-73, A-74, A-75** | QMS numbering collided under concurrency (migration `0024`); no validators; foreign ids accepted |
| **A-87** critical | **the tenant hooks never filtered an include** — proven on PostgreSQL 18 to return another tenant's device and user. Fixed at the mechanism, join type preserved (ADR-048) |
| **A-37** partial, **A-84, A-85, D-04** | SCIM oracle signal hidden; signing gated on a new `esignature` slug (migration `0025`); 409s; device serials unique per tenant (migration `0026`, ADR-049) |

**New owner questions:** Q-15 to Q-19. **New findings:** A-76 to A-92.

## Evidence at the checkpoint

Run by the orchestrator:

- **Backend,** `npm run test:coverage`: **365 suites, 7,803 tests, all passing.** Coverage is
  **99.93 %** statements and 99.84 % branches, **not 100 %**. The uncovered lines are in files the
  running agents are editing: `tenant.controller.js:148`, `auth.service.js:99`,
  `eSignature.service.js:1028` and `rateLimiter.redis.service.js:764-765`.
- **Frontend,** `npx jest`: **81 suites, 764 tests**; `npx tsc --noEmit` exits 0.
- **PostgreSQL 18.6,** in throwaway containers: migrations `0024` and `0026`, A-73's concurrent
  numbering, and A-87's before and after on the include leak.

## Not Covered

- **Not deployed.** The VM still runs `3f1051f`.
- **Deploy notes, when it ships:**
  - flush `permissions:*` in Redis (A-84);
  - deploy the frontend and backend together (A-60);
  - leave `AUTH_RATE_LIMIT_BY_IP` unset until A-16 lands.
