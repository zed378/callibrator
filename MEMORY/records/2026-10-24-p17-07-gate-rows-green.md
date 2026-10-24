# P17-07: the gate rows are green — the live run and phones remain

**Date:** 2026-10-24 · **Card:** P17-07 (PARTIAL) · **Status:** entry condition met in unit/memoryDb/guards; exit needs the live run + two real phones · **Spec refs:** `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` § 11 (G-01 … G-33), § 12 (PT-01 … PT-33)

## Hook

P17-07 is BLOCKED on a live run with two real phones. What is not blocked is proving the entry
condition: every "gate" row of § 11 green and named in a record. The gate rows that can run
without a live stack or a phone are green. The ones that need them are named, not claimed.

## What was verified (no code changed)

| Gate | Evidence 2026-10-24 |
|---|---|
| G-01 facility resolution | `tenantScope.facility` — every branch, forced predicate, skip does not skip facility |
| G-03 includes | same suite — provider-internal denied in ON, INNER stays INNER, readable/through/separate/nested |
| G-05/G-06 bulk writes | same suite — column named, hooks through model API, scoped bulk update, AM-6 refused, TRUNCATE refused |
| G-08 two-facility coverage | `twoFacilityRoutes.guard` — every marked `:id` route covered |
| G-16 facility context writers | `facilityContextSource.guard` — four entry paths, no header read |
| G-20 cache keys | `cacheKeyFacility.guard` + `dashboardCache.twoFacility` — scoped keys |
| G-21 recipients | `notificationRecipients.twoFacility` — only the row's facility |
| G-23 signed links | `attachmentSigned.replay` — TTL capped, move refused, replay refused |

68 tests green across the six suites.

## What remains (not claimed)

- G-02, G-04, G-07, G-10, G-11, G-12, G-13, G-17, G-18, G-19, G-22, G-24, G-25, G-26, G-27, G-28, G-29, G-30, G-31, G-32, G-33: named in § 11, many built by their cards — not re-run here.
- PT-01 … PT-33 live run on a disposable production-mode stack + two real phones (PT-23 … PT-28): the exit condition, BLOCKED.

## Why this shape

A gate row green in unit/memoryDb/guards is evidence the mechanism holds; it is not the live run
the card demands. The honest status is PARTIAL with the green rows named, not DONE and not BLOCKED
without evidence.

## Tests

- Six suites, 68/68 (2026-10-24): `tenantScope.facility`, `notificationRecipients.twoFacility`, `attachmentSigned.replay`, `twoFacilityRoutes.guard`, `facilityContextSource.guard`, `cacheKeyFacility.guard`.

- **Not run:** the live suites and the e2e facility-pentest — they need a disposable PostgreSQL 18 / production-mode stack and two real phones.

## Definition of Done (partial)

- [x] the runnable gate rows named with their passing suites
- [x] the live run + phones named as the remainder, not claimed
- [ ] the live run PT-01 … PT-33 + phones — P17-07 exit, BLOCKED

## Files

- `TASKS/PHASE-17-UPSTREAM-SECURITY-PRIVACY.md` (P17-07 Status cell)
- This record
