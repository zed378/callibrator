# 2026-11-25 — P17-07 browser and additional live principals

Status: implemented in working tree, not merged; security exit remains partial.
Spec refs: `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` § 12,
P19-04 facility scope, P19-07 § 11, ADR-124 and ADR-138.

## Implementation and evidence

`backend/src/tests/e2e/modules/p1707-facility-live.e2e.test.ts` now checks the
impersonation audit's actual actor and target facility, scans overdue F1/F2
devices and checks the two bound users' actual HTTP inboxes, and provisions a
SCIM identity through a scoped key. Its impersonated session cannot read devices
until administrator confirmation: HTTP 403 `FACILITY_BINDING_PENDING`.
The account uses the built pending flag; this is not a claim its status is
literally INACTIVE. PT-18 email bodies and PT-21 actual IdP sign-in are not proved.

Live HTTP suite: **9/9 passed** on `callibrator-p17-20261125`, synthetic data,
production-mode images and `FACILITY_BINDING_ENABLED=true` in a temporary env
file. Before the two additional cases, the seven-case audit/socket/cache/API-key
suite passed too. The impersonation audit fix is in `auth.service.ts`, its unit
regression in `auth.impersonation.a82.test.ts` (earlier evidence in
`2026-11-25-remaining-tasks.md`).

`automate/p22.browser.mts` adds legacy query/typed-URL lookup and PT-29 checks:
the production response confines workers to self, and external/blob workers and
WebAssembly compilation fail. The whole suite passed **104/104** in 384 seconds,
including real browser IPM capture/submission, PDF and XLSX downloads, public
device issue/revoke/minimal fields, axe in both themes, and layout at 360, 768,
1280 and 200% zoom. These are desktop Chromium checks, not physical-device UAT.

The follow-up **105/105 passed** in 332 seconds after adding a real signed-out
QR lookup → login → same QR-prefilled page case. TypeScript 7's automate project
check passed after correcting new check callbacks to return their evidence text.

The later PT-04 extension added four bound-browser export checks. Its full
`automate/p22.browser.mts` rerun passed **109/109** in 214,072 ms. It captured
the real F1-only API reads and downloaded XLSX/PDF contents for inventory and
calibration recaps; details and remaining scope are in
[`2026-11-25-p17-bound-exports.md`](2026-11-25-p17-bound-exports.md).

## Limitations

The built-in Browser failed before executing JavaScript (missing sandboxPolicy);
the repository's existing browser suite supplied the actual browser evidence.
No full P17-07 exit, real-device test, production action or owner signature is
claimed. PT-04's bound export matrix, PT-17's full local/S3 exposure matrix,
PT-18 emails, PT-21 end-to-end IdP roundtrip and PT-30 remain open where not
covered by separately named evidence. Real-phone cases are excluded by owner.
