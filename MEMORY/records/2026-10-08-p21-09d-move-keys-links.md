# P21-09d — device move, storage-key segment and re-key job, signed link v3, recipients and emitters, dashboard cache v2, the raw-SQL twin rule (G-14, G-15, G-19, G-20, G-21, G-23)

**Date:** 2026-10-08 · **Task:** P21-09d (Phase 21) · **Decision:** ADR-124 Amendment 6 (§§ 1 – 7, new) · **Spec:** [`MEMORY/specs/P19-04-client-facilities.md`](../specs/P19-04-client-facilities.md) § 8, § 9, § 11 (as-built notes added) · **Base:** `db7befd`, working tree, **not committed** (built together with P21-09e; one gate run for both — § Gates of the P21-09e record) · **Kind:** code + tests + contracts + OpenAPI.

> **Privacy:** synthetic fixtures only ("Facility One", `F-0001`, `@example.test`).

## What was built

| | |
|---|---|
| Raw SQL (§ 8, G-14) | `utils/facilityPredicate.util.ts#facilityClause(column, position)` — no facility parameter, allow-listed column shape, appended last, the deny sentinel for a bound principal with no facility. `constants/facilityAccess#RAW_SQL_UNREACHABLE_BY_BOUND`: 7 statements (attachment orphans, audit count, key rotation, QMS numbering, search, SQL-dump staging, KMS boot check), each with its reachable routes |
| G-15 | no `literal()` subquery in source (none existed) |
| Emitters (§ 9.1, G-19) | `services/realtime.ts#emitForRow` / `roomsForRow` (tenant room + the ROW's facility room) |
| Recipients (§ 9.6, G-21) | `services/notificationRecipients.ts#recipientsFor` → `{ broadcast: true, boundUserIds }`; the calibration scan sends the broadcast and one addressed notification (+ audit row, `audience: facility-user`) per bound user of the device's facility |
| Cache (§ 9.2, G-20) | `dashboardCache.service`: prefix `dashboard:metrics:v2`, `facilityScopeSegment()` from the context (`all` / `f:<id>`) |
| Keys (§ 9.3) | `storage/keys#buildKey({ …, clientFacilityId })` → `t/<t>/f/<f>/<domain>/<name>` (attachments, branding), `facilityOfKey`; `ScopedStorage.buildKey` passes it; an upload linked to a record stores under the record's facility and names it on the row |
| Integrity (FT-77) | `attachment.service#keyMatchesRow` / `assertKeyIntegrity` before every download and link mint: segment = row facility, or no segment on the self facility / a row with no facility, or `rekey_pending` — else 404 logged as an integrity error |
| Re-key (§ 9.4) | `services/attachmentRekey.service.ts` (`rekeyTenantAttachments`, `enqueueRekey`): copy → switch key + clear flag + audit (`system:attachment-rekey`) in one transaction → delete the old object |
| Signed link v3 (§ 9.5) | token `<exp>.<tenant>.<issuer>.<facility|->.<sig>`, message `attachment-link/v3|…`; bound issuer `b<id>` must still be bound to the token's facility and that facility `active`; the row's facility must equal the token's |
| Device move (§ 11) | `POST /api/v1/calibration-devices/:calibrationDeviceId/move` (`auth, denyApiKey, validateUuid, rbac([TENANT_ADMIN]), dynamicAccess(calibration, write), validate(deviceMove, params+body)`), `GET …/moves` (`calibration` read); `services/deviceMove.service.ts`, `controllers/deviceMove.controller.ts`; contracts `deviceMove`, `deviceMovesParams`, `DEVICE_MOVE_COUNT_KEYS`; OpenAPI `moveCalibrationDevice`, `listCalibrationDeviceMoves` (503 operations) |

## Evidence — tests named (all in `npm run test:coverage`)

- `tests/utils/facilityPredicate.util.test.ts` (G-14) · `tests/utils/rawSqlFacilityPredicate.d05twin.test.ts` (G-14, fail-before: a planted unlisted statement, a clause in a file that never calls the helper) · `tests/guards/literalSubquery.guard.test.ts` (G-15, planted).
- `tests/guards/socketFacilityRooms.guard.test.ts` (G-19, planted swaps) · `tests/guards/socketEmitters.facility.guard.test.ts` (G-19, planted tenant/actor-facility emits).
- `tests/services/notificationRecipients.twoFacility.test.ts` (G-21: only the row's facility, inactive and override-removed users excluded, the scan's broadcast + addressed rows in one transaction).
- `tests/services/dashboardCache.twoFacility.test.ts` (G-20) · `tests/guards/cacheKeyFacility.guard.test.ts` (G-20, planted).
- `tests/services/storageKeyFacility.test.ts` (G-23) · `tests/services/attachmentSigned.replay.test.ts` (G-23: moved row, re-bound issuer, ended facility → 404; v2 shape and a rewritten facility → 403; integrity cases) · `tests/services/attachmentRekey.test.ts`.
- `tests/routes/deviceMove.twoTenant.test.ts` (`@two-tenant` both routes; bound principal 403 `FACILITY_ROUTE_REFUSED` id-independent; every 409 with its text; location rules; rollback leaves nothing; emits + re-key after commit) · `packages/contracts/test/clientFacilities.p2109d.test.ts`.
- `tests/guards/facilityAccessibleRoutes.guard.test.ts` gains the planted marker on `POST /:calibrationDeviceId/move` (G-09).
- Changed for the deliberate change (no assertion weakened): `routes/attachmentSigned.a365.test.ts` (five-part v3 token in the tamper cases, plus "an empty facility" and "the v2 four-part shape"), `services/unboundedFindAll.d24.test.js` (reviewed new findAlls), `fixtures/fakeStorage.ts` (passes `clientFacilityId`).
- The live proof of the cascade is P20-07's `migrations/deviceMove.p2007.live` (unchanged; no migration or trigger changed here).

## Not done / open

- The open-IPM-draft 409 of the move (P20-04 / P21-03 add it with the sessions).
- No periodic re-key sweep: a flag left by a crash stays until the tenant's next move (harmless — ADR-124 Am. 6 § 5).
- No raw statement reachable by a bound principal exists yet, so no `rawSqlFacility.live` twin was needed; the first marked raw statement needs one.
