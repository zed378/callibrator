# 2026-11-25 — Remaining tasks: implementation and verification

Owner instruction: implement remaining tasks; skip testing on real devices.

## Scope and exclusions

Start with outstanding application/security work in Phases 12–31. Later roadmap
groups retain their documented dependencies; no operator signature, legal fact,
production cutover, credential rotation or destructive decommission is inferred.

Physical-device checks (including P17-07 PT-23–PT-28, P26-02 and P27-04) are
excluded at the owner's request. This exclusion is not a claim that they passed.
Browser and automated checks remain in scope.

## Work in progress

- G-04: complete the facility hookless-statics proof on PostgreSQL as
  `callibrator_app`, with independent numeric expectations and cross-facility
  mutation checks. Existing SQL-generation coverage is in
  `backend/src/tests/utils/tenantScope.facility.test.ts`.

## Evidence and remaining work

No new test result claimed yet. P17-07's remaining browser/live cases, owner
actions and sign-offs stay open until named evidence is recorded here.

## Owner answers (2026-11-25)

- Scope: application and upstream adoption through Phase 31.
- P11-08 to P11-14: defer the large dashboard redesign.
- OA-4 / P27-01: both bare device codes and legacy URLs are in use.
- Open questions are presented as multiple choices for the owner to decide.

## Verified so far

- G-04 live: tenantHookless.facility.live, 7/7, twice around a mutation check.
- Mutation: omitting aggregate facility predicate fails four tests (3/7 pass); original source restored byte-for-byte.
- Existing facility unit and live-manifest guard: 43/43, coverage disabled for this focused run. Full coverage not claimed.
- PT-19 audit regression: auth.impersonation.a82, 4/5 before the fix; a bound impersonation omitted clientFacilityId. Fix supplies the target account facility explicitly in the same transaction.
- auth.impersonation.a82 + auth.impersonationRefresh.a146: 20/20 after the fix.
- Backend typecheck: exit 0.
- P27-01/02: owner fact established; legacy URL extraction, sign-in prefill and
  old-host notice implemented in working tree. Frontend proxy/StartClient 29/29;
  backend device reads/isolation 23/23; frontend lint/typecheck/build and real
  nginx HTTP checks green. Not merged/deployed; browser login journey remains.
  See `2026-11-25-p27-02-legacy-stickers.md` for named evidence and limitations.
