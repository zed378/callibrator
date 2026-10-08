# P21-03 (a/b/c): the IPM session API — drafts, corrections, reads, `Idempotency-Key`, IPM photos, scope-loss codes, the field wipe

**Date:** 2026-10-09 · **Task:** P21-03, split into P21-03a, b and c (Phase 21) · **Decision:** ADR-126 Amendment 4 · **Specs:** [`P19-02`](../specs/P19-02-ipm-session-aggregate.md) § 7, § 9, § 10, § 12, § 14 (an as-built note was added to § 10.2); [`P19-08`](../specs/P19-08-offline-field-capture.md) § 9.5, § 11.3 · **Base commit:** `5d41916`

> **Privacy:** every fixture is synthetic ("Alat sintetis", `TST000001`, "Facility One", "Teknisi Sintetis"). `mozivid/` was not touched.

## The split (ADR-126 Am. 4 § 1)

| Part | Built |
|---|---|
| **P21-03a** | `routes/api/ipmSessions.route.ts` at `/api/v1/ipm/sessions`: `GET /`, `POST /`, `GET /:sessionId`, `PATCH /:sessionId`, `PUT /:sessionId/results`, `POST /:sessionId/discard` and `POST /:sessionId/corrections`, plus `GET /calibration-devices/:id/ipm-sessions`. Built with `services/ipmSession.service.ts`, the controller and `*.openapi.ts`. On the contracts side: `inspectionSessions.ts` (the strict schemas and the `inputKind` union), and in `inspectionValues.ts` `IPM_CONFLICT_CODES`, `IDEMPOTENCY_CONFLICT_CODES` and `normaliseResult`. `utils/codedError.util` puts the `code` and the ids at the top level of the response. The reads are marked N-2 and the draft writes N-3 in `FACILITY_ACCESSIBLE_ROUTES`. |
| **P21-03b** | `middlewares/idempotency.middleware.ts` and `services/idempotency.service.ts`. Replay re-reads the resource in the current context. They answer three 409s: key reused, scope changed, and in flight (a stale key is taken over). Any refused request frees its key. The nightly purge is `idempotencyKeyPurgeScheduler` (`IDEMPOTENCY_KEY_PURGE_SCHEDULER`, 03:53), and the job monitor has an entry for it. |
| **P21-03c** | `LINKABLE_RESOURCES.inspectionsession`. A photo goes only on the caller's own draft and gets `purpose = ipm_evidence`. The bound gate needs `ipm` write. Deleting a submitted session's photo answers 409. `POST /attachments` honours `Idempotency-Key`, hashing the file too. Also built: the account and tenant `SCOPE_LOSS_CODES` in `auth.middleware`, `POST /api/v1/field/wipes` (`field.route.ts`), and the device move's open-draft 409. |
| **→ P21-04** | Moved to P21-04: the submit, the correction's submit, the void, `GET /ipm/due`, `computeIpmDue`, `missingRequiredItems`, `performerSnapshot.p2103` and `socket.ipmEvents`. 0126's issued-fields CHECK needs the report's issuance in the submitting UPDATE. |

## What surprised me (→ ADR-126 Am. 4)

1. **A submit cannot be written without P19-06's issuance.** 0126 makes the report number, token, hash, scheme and issuer NOT NULL on a submitted row. This is why the card was split.
2. **A template item's `sort_order` repeats across the base and type origins inside one section.** Copying it would hit the unique `(session_id, section, sort_order)`. The row's order is now its position in the pinned version's read order.
3. **The spec's § 9.2 left a 5xx's key in flight.** That would block the offline outbox for five minutes after a write that provably rolled back. Any non-success now frees the key.
4. **An error's `data` is `null`.** So `headId` goes top-level, like `draftId`.
5. **The memoryDb has no unique index.** The `clientRef` collision and the key race are therefore proved only by the new live suite. It confirms that PostgreSQL's 23505 names `client_ref` in `err.fields`.

## Hand-off items — status

- **Idempotency middleware and purge:** done (P21-03b).
- **Device move 409 for an open IPM draft:** done. The service counts every creator's draft. Note that the database alone still moves such a device (`deviceMove.p2007.live` moves it by raw SQL).
- **`LINKABLE_RESOURCES` with the draft/own-session upload rule:** done (P21-03c).
- **Account and tenant scope-loss codes:** done. They are `ACCOUNT_INACTIVE`, `TENANT_SUSPENDED` and `TENANT_DELETED`, on both the API-key path and the user path. `auth.test.js` and `auth.tenantGone.a101.test.js` were updated: they now assert `error(res, msg, 403, null, { code })` instead of `forbidden(res, msg)`.
- **The `esignature` entry on G-P2/G-P3:** not this card's. The signatures route (N-5) is P21-04's, so both lists are unchanged.
- **`IPM_CONFLICT_CODES` in `@callibrator/contracts`:** done.
- **`docs/SECURITY/15` § 11 status column:** updated, in the authorised column only:
  - G-07: IPM routes.
  - G-11 and G-12: P20-04.
  - G-25: P20-02, P20-04, P20-05 and P20-08 live suites.
  - G-26: built, with the tests named.

## Evidence — tests named

**Unit / memoryDb (backend):**
- `routes/ipmSessions.twoTenant.test.ts` (12, A-10, `@two-tenant` ×6).
- `routes/ipmSessions.twoFacility.test.ts` (21, C-03 … C-07, `@two-facility` ×6, plus the list). C-05 checks a create naming F2's device: 404, the same as a missing device. C-07 checks another F1 technician's draft: 403.
- `services/ipmSession.p2103.test.ts`: § 7.1 and § 7.2 row by row. It checks every 409's code and text, results against the pinned version, discard, corrections, the reads and the audit rows.
- `middlewares/idempotency.p2103.test.ts` (19): replay, KEY_REUSED, AM-25 SCOPE_CHANGED, IN_FLIGHT, stale takeover, the race, a 409 freeing its key, a settle failure being logged, and the purge.
- `middlewares/idempotencyKeyPurgeScheduler.p2103.test.ts` (4).
- `routes/attachmentsIpm.p2103.test.ts` (9).
- `routes/fieldWipes.p2103.test.ts` (4).
- `routes/deviceMove.twoTenant.test.ts`: +1 test for the open-draft 409.
- `utils/controllerWrapper.publicCode.a288.test.ts`: +2 tests.
- Updated: `guards/facilityContextSource` (new reader), `services/unboundedFindAll.d24` (6 reviewed IPM reads), `migrations/0117-0123…p2007` (0123's frozen list excludes `inspectionsession`, which 0129 added).

**Contracts:** `test/ipmSessions.p2103.test.ts`.

**Live, PostgreSQL 18, as `callibrator_app`:** `services/ipmSessions.p2103.live.test.ts` (8, new in the manifest as `p2103`). It covers:
- a draft created in the device's facility;
- results replaced through the draft-only trigger;
- the `clientRef` collision on the real index (409);
- the key race, where exactly one request proceeds;
- a correction copying results through the trigger;
- the move's 409;
- the purge.

## Gates (2026-10-09; one quiet tree)

- **Lint:** `node scripts/ci/eslint-ratchet.js` reports 0 errors, 0 warnings, baseline 0. Contracts `npm run lint` is clean.
- **Typecheck:** `npm run typecheck` reports 0 errors in the backend, the contracts and the frontend.
- **Ratchet:** `npm run ratchet` reports 695 `.js` files, at the floor.
- **Load check:** `build:dist` OK (721 files), and `load:check` OK in both modes (dist 711 modules, boot order 115).
- **Backend coverage:** `npm run test:coverage -- --ci` (Node 26) gives **991 suites passed, 47 skipped, 0 failed; 16,993 tests passed, 409 skipped; 100 / 100 / 100 / 100**, in 499 s. The first full run found 2 failures and four uncovered branches; all were fixed, then the whole run was repeated.
- **Contracts:** `npm test` gives 61 suites, 1,324 tests, 100 %.
- **OpenAPI:** `openapi:generate` gives 542 operations. `openapi:check` is current and `openapi:lint` shows no new error. `openapi:breaking` was **skipped locally** because `oasdiff` is not installed; CI runs it. The change only adds operations, but the 403 bodies gain a `code`.
- **Frontend:** `schema.d.ts` was regenerated. `npm run typecheck` reports 0 errors, and `npm test -- --ci` passes 320/320 suites and 3,480 tests (94.16 / 85.07 / 90 / 94.8).
- **Live:** `npm run test:live -- --only=p2103,p2004,p2005,p2007,p2002,p2101,p2003` passed **8 of 8 suites** (container `p2103-pg18`, 127.0.0.1:55213, removed by name). The full live set was not run, because no migration or trigger changed.

## Not done / open

- **P21-04** (still BLOCKED on UD-17 as a working decision) now carries the submit, the correction's submit, the void and "due". Nothing can be submitted until it lands.
- The list-order indexes are not yet measured (the U-06 method) for P21-07.
- `openapi:breaking` must be confirmed in CI.
- `FACILITY_BINDING_ENABLED` stays OFF. The § 11 gate is not green: G-22, G-24, G-27, G-28, G-29 and G-30 remain, as do G-P2/G-P3's pending E-Signature entries.
