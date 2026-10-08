# P21-04: the IPM submit, the correction's submit and the void; the report's issuance, document, signatures and public verification; "due"

**Date:** 2026-10-09 · **Task:** P21-04 (Phase 21; one card, not split) · **Decision:** ADR-126 Amendment 5 · **Specs:** [`P19-02`](../specs/P19-02-ipm-session-aggregate.md) § 6 – § 8, § 10.2, § 11, § 14; [`P19-06`](../specs/P19-06-ipm-report-document.md) § 4 – § 10, § 13, § 14 (as-built notes added) · **Base commit:** `9f4752f`

> **UD-17 is a WORKING DECISION (2026-10-08), not owner-confirmed.** This card was built on it under the owner's delegation. Each effect is reversible per tenant: `ipm_recommendation_side_effects` (unset = on) switches the Repair order, the device status and the calibration request; `ipm_countersign_enabled` (unset = off) switches the IPSRS countersignature (ADR-126 Am. 5 § 1).
>
> **Privacy:** synthetic fixtures only ("Alat sintetis", `TST000001`, "Facility One"). `mozivid/` was not touched. **Rendering rule:** no PDF renderer and no stored report file — the backend serves the document's data, the verification and the signatures.

## Built

| Area | What |
|---|---|
| Submit (`services/ipmSubmit.service.ts`) | `POST /ipm/sessions/:sessionId/submit` (N-3, idempotent). One transaction, lock order device → original → session: the § 7.2 refusals (each 409 with its top-level `code`; the 400 lists missing header fields and required items by section and label), the visit number (root: max + 1; correction: the original's), the **issuance** (number `IPM-<facility code>-<YYYYMMDD>-<NNN>` per tenant, facility and day in the tenant's zone under `pg_advisory_xact_lock`; 24-byte base64url token; `ipm-report-v1` content hash; issuer snapshot with the zone; device, facility, room and performer snapshots), the **side effects** (Preventative order; `needs_repair` Repair order + notice to the facility's maintenance readers; `not_fit_for_use` → `maintenance`; `needs_calibration` → the request flag; the confirmed room), ONE UPDATE to `submitted`, the original superseded, the `APPROVE` audit row, `ipm:submitted` after the commit. The correction's delta per § 8.3. |
| Void | `POST …/void` — `rbac([TENANT_ADMIN])`, unmarked, the service re-checks "not bound"; cancels the visit's Preventative order, clears the chain's calibration request, notes the rest; `DELETE` / `VOID_IPM`; `ipm:voided`. |
| Report (`services/ipmReport.service.ts`) | `GET …/report-document` (N-2): issued (hash recomputed at every read — `mismatch` shown, logged with `IPM_REPORT_INTEGRITY_MISMATCH`, counted) or a draft's preview for its creator; `?render=pdf|print` writes the `EXPORT` row before the body. `GET /ipm/verify/:reportNumber?token=` (public): token-only lookup (reviewed skips), constant-time number compare, one identical 404, `ipmVerifyToken` + `ipmVerify` budgets. |
| Signatures (`services/ipmSignature.service.ts`) | `POST …/signatures` (N-5, `esignature` write, `denyPlatformAuthoring`, `ipmSignature` budget per user + address): § 7.1 rules in order (codes `IPM_SIGNATURE_REFUSALS` + the six new `IPM_CONFLICT_CODES`), the credential through `certificate.service#verifySignerCredentials`, the integrity check, the row binding the stored hash, the audit row, the countersign notice, `ipm:signed`. The signer's role is read from its own user row. |
| Due (`services/ipmDue.service.ts`) | `GET /ipm/due` (N-9): one `sql()` read — the tenant bound on both tables, `facilityClause` for a bound caller, the LATERAL effective session, the month arithmetic in SQL = `computeIpmDue` in contracts. |
| Settings | `tenant_time_zone`, `ipm_interval_months`, `ipm_countersign_enabled`, `ipm_recommendation_side_effects` on the A-176 allow-list, validated when saved; read by `ipmSettingsOf` (reviewed skip). |
| Contracts | `ipmReport.ts` (scheme, number format, `canonicalIpmReportPayload`, `ipmReportPayloadOfDocument`, request schemas), `missingRequiredItems`, `zonedDay`, `computeIpmDue`, submit / void / due schemas. |
| Lists and guards | `FACILITY_ACCESSIBLE_ROUTES` (+4), `FACILITY_SCOPE_SKIPS` (+3), `routeGateExemptions` (public verify), budgets (+3), D-24 (+9 reviewed), G-16 readers (+2), two-tenant allow-list (verify), A-127 (+2 guarded). **G-P3's `esignature` pending entry cleared**; G-P2's `/dashboard/esignature` re-assigned to P23-02 (its load route stays unmarked by design). |

## What surprised me (→ ADR-126 Am. 5)

1. **No way back from UD-17** in the spec — hence the per-tenant switch.
2. **The hash binds the zone, but no column kept it** — `issuerSnapshot.timeZone`.
3. **The sequence read would be narrowed by the facility hooks** for a bound caller after a device move — a reviewed skip.
4. **No metrics registry exists** for an application counter — a coded error log + a process counter.
5. **§ 9.2 vs § 9.4**: the public document must carry the session id for the browser's recomputation.
6. memoryDb leaves unset columns `undefined`: the canonical payload now writes a missing member as `null`, and the services normalise with `orNull`.

## Evidence — tests named

- **Unit / memoryDb:** `services/ipmSubmit.p2104.test.ts` (39: issuance, numbers per facility/day/zone, the browser's hash rebuild, replay, room, L-1 dates, every side effect and the switch, every refusal, the correction delta, the void, audit atomicity), `services/ipmReport.p2104.test.ts` (21: § 10.1 rows, strict key set, links, logo, preview, mismatch, render audit, verification 404s, budgets), `services/ipmSignatures.p2104.test.ts` (21: § 7.1 rows, credential 401, integrity 409, races, atomicity, notices, self-served SoD), `services/ipmDue.p2104.test.ts` (4: binds, defaults, C-13 bound clause), `services/ipmSettings.p2104.test.ts` (17), `services/performerSnapshot.p2103.test.ts` (G-24), `services/socket.ipmEvents.test.ts` (G-19), `routes/ipmSessions.twoTenant.test.ts` (+4 routes, `@two-tenant`), `routes/ipmSessions.twoFacility.test.ts` (+3 routes, `@two-facility`).
- **Contracts:** `test/ipmReport.p2104.test.ts` — the canonical payload pinned to a string written by hand from § 6.
- **Live, PostgreSQL 18, as `callibrator_app`:** `services/ipmSubmit.p2104.live.test.ts` (9, new `p2104`): the issued UPDATE passes 0126/0127; two concurrent roots → visits n, n+1; the correction's supersede; the side effects; signatures bound by the trigger; the void; verification with no context; due with the bound facility clause.

## Gates (2026-10-09; one quiet tree)

- **Lint:** `node scripts/ci/eslint-ratchet.js` — 0 errors, 0 warnings, baseline 0; contracts `eslint src/` clean.
- **Typecheck:** `npm run typecheck` — 0 errors (backend, contracts, frontend).
- **Ratchet:** `npm run ratchet` — 695 `.js`, at the floor. **Build / load:** `build:dist` OK (728 TypeScript files); `load:check` OK in both modes (boot order 116).
- **Backend coverage:** `npm run test:coverage -- --ci` (Node 26) — **998 suites passed, 48 skipped, 0 failed; 17,116 tests passed, 418 skipped; 100 / 100 / 100 / 100**, 439 s. (The first full run found 2 failing guards — A-127 and the openapi currency, both fixed — and branch gaps, closed; then the whole run was repeated.)
- **Contracts:** `npm test` — 62 suites, 1,363 tests, 100 %.
- **OpenAPI:** `openapi:generate` 548 operations; `openapi:check` current; `openapi:lint` no new error (15 warnings, baselined). `openapi:breaking` not run locally (no oasdiff).
- **Frontend** (`schema.d.ts` regenerated): `npm run typecheck` 0 errors; `npm test -- --ci` 320/320 suites, 3,480 tests (94.16 / 85.07 / 90 / 94.8).
- **Live:** `npm run test:live -- --only=p2104,p2103,p2004,p2005,p2007,p2002,p2101,p2003` — **9 of 9 suites passed** (container `p2104-pg18`, 127.0.0.1:55214, removed by name; no migration or trigger changed, so not the full set).

## Not done / open

- **UD-17 stays a working decision** — owner confirmation pending; switchable per tenant.
- The self-served hospital's unbound IPSRS is not notified of a pending countersignature.
- The integrity mismatch is a log line + process counter, not a Prometheus metric with an alert rule (ADR-082's route).
- `ipmDue` on device reads, `GET /calibration-devices?ipmDue=` and a `month` parameter are not built (P21-07 / P22-02).
- The frontend renderer, the verification page and the `CREDENTIAL_ENDPOINTS` matcher for the signature path are P23-02's.
- `openapi:breaking` must be confirmed in CI (oasdiff not installed locally); all changes add operations.
- `FACILITY_BINDING_ENABLED` stays OFF; the § 11 gate is not green (G-22, G-27 … G-30, P18-04, P17-07 open).
