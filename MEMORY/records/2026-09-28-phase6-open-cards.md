# 2026-09-28 — Phase 6: the open cards (P6-01, P6-04, P6-07, P6-08, P6-11 – P6-14)

**ADR:** [ADR-085](../DECISIONS.md) · **Migration:** `0090-webhook-secret-rotation-overlap` · **Out of scope here:** P6-02 (E2E agent), P6-06 / P6-10 (ops agent)

## What was open, and what it turned out to be

| Card | Found | Now |
|---|---|---|
| P6-01 | DoD item P6-01a (`npm run test:coverage` did not run) | **stale** — it runs; evidence restated below |
| P6-04 | card TODO, PROGRESS PARTIAL | **done** (ADR-058, 2026-09-25); re-verified. CI stage never run on GitHub → P7-01 |
| P6-07 | card TODO | **stale** — done 2026-09-25 (ADR-059, batch 6); re-verified |
| P6-08 | card TODO | **stale** — done 2026-09-25 (batch 6); re-verified |
| P6-11 | TODO; A-41 done | **partial** — covered set re-stated and pinned; 15 services unaudited, scope for the owner |
| P6-12 | TODO; A-48 done | **partial** — sid-less tokens refused, open sockets re-checked; VM `JWT_ACCESS_EXPIRED` open |
| P6-13 | TODO; A-51 done | **done** — caller secret refused, overlap rotation, migration 0090; a live defect fixed |
| P6-14 | TODO; A-32 done | **done** — coverage scope written down and pinned |

## The defect

Every webhook secret rotation and every webhook url change failed on PostgreSQL since migration 0033
(A-124): `webhook.service.js` wrote its audit row with `AuditLog.create` and no `actorType` (NOT NULL).
The unit tests mocked `AuditLog.create`. Proved on a `f0d7f08` worktree against PostgreSQL 18.6:
`SequelizeValidationError: notNull Violation: AuditLog.actorType cannot be null`. The service now
writes through `audit.service#logAction`, and `auditInTransaction.p611.test.js` fails any direct
`audit_logs` write outside `audit.service.js`.

## Changes

- `middlewares/auth.middleware.js` — `SIDLESS_ACCESS_TOKENS_ACCEPTED = false`; `req.sessionId` always set.
- `config/socket.js` — `checkPrincipal`, `recheckSocket`, a 60 s per-socket re-check; sid-less socket token refused.
- `validators/webhook.validator.js` — `secret` forbidden with a message; `rotateWebhookSecretSchema` (`overlapHours` 0–168, default 24).
- `routes/api/webhooks.route.js` — rotate validates its body; swagger updated.
- `services/webhook.service.js` — overlap rotation, `X-Webhook-Signature-Previous`, url change clears the previous secret, audited create/patch/rotate/delete through `logAction` in their transactions.
- `controllers/webhook.controller.js`, `models/webhook.model.js` (`previousSecret`, `previousSecretExpiresAt`; `softDelete(options)`).
- `migrations/0090-webhook-secret-rotation-overlap.js`, registered in `config/migrator.js`.
- `jest.config.js` — phantom `src/app.js` removed; the six-layer scope and the `index.js` exclusion explained.
- Docs: `SECURITY/03-AUTHENTICATION-SECURITY.md` (revocation windows, sockets), `BACKEND/10-MODULE-REFERENCE.md`, `WEBHOOK/03-WEBHOOK-SECURITY.md` (the secret section, rewritten — it described pre-A-51 code), `DATABASE/10-AUDIT-LOGS.md`, `BACKEND/09-TESTING.md`, `TESTING/00-TEST-STRATEGY.md`, `TESTING/01-UNIT-TESTING.md`, `ENGINEERING/14-CODE-REVIEW-CHECKLIST.md`; spec addendum `MEMORY/specs/A-41-audit-inside-transaction.md`.

## Evidence

- **Full run:** `npm run test:coverage -- --ci`, Node 26.10, working tree over `c905e74`, 2026-09-28 — exit 0,
  **638 suites passed (23 skipped), 12,780 tests passed (148 skipped), 100% on all four measures** (of the six measured layers).
- **Live, PostgreSQL 18.6** (scratch container `callib-p6x-pg`, port 56613):
  `0090-webhook-secret-rotation-overlap.p613.live.test.js` 5/5 — fresh boot through the real migrator
  (`runSchemaSetup`) with `verifySchema` clean; upgrade from a pre-0090 schema with a live webhook row
  (columns added NULL, row kept); re-run no-op; `down` removes both columns and `verifySchema` reports
  them; `up` restores; a rotation and a url change write real, named-actor audit rows.
- **Fail-before** (`git worktree` at `f0d7f08`, removed afterwards): 25 of the new P6 tests fail there
  (plus 3 unrelated `socket.test.js` A-42 logger assertions), including
  `auth.tokenPurpose.a59` "P6-12: an access token without sid is refused",
  `socket.test.js` "P6-12 — an open socket stops when its principal stops" (7),
  `webhook.validator` "P6-13: REFUSES a caller-supplied secret…",
  `webhook.secret.a51` "P6-13 — rotation with an overlap window" (5).
  `coverageScope.p614` and `auditInTransaction.p611` fail there by construction (`src/app.js` listed;
  `webhook.service.js` calls `AuditLog.create`).
- Re-verified, unchanged: `routePermissionGuard.p604`, `readGates.p604`, `auth.superAdminMfa.p607` (×2),
  `swaggerValidatorAlignment.p608` — 255 tests.

## Open

- P6-11: whether `apiKey`, `kanban`, `ticket`, `vendor`, `warehouse`, `finance`, `risk`, `featureFlag`,
  `notification`, `content`, `supplierScorecard`, `meteredBilling`, `oidcProvider`, `webauthn`, `ai`
  mutations must be audited — owner.
- P6-12: set the VM's `JWT_ACCESS_EXPIRED` to `15m` (operator; confirm the frontend refresh first — F-05).
- P6-13: the frontend has no rotate button and does not show `previousSecretExpiresAt` (F-18).
- P6-04: CI `backend-test` has never run on GitHub (P7-01).
- `auditLog.middleware.js` has no caller; deleting it is P9-19's call.
