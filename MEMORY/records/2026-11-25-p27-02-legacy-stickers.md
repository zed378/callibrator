# 2026-11-25 — P27-01/02: legacy sticker continuity

Status: implemented in the working tree; not merged or deployed.
Spec refs: `MEMORY/specs/P27-02-legacy-sticker-resolver.md`, P19-07 § 11,
ADR-138 Amendment 1 G-2, `TASKS/PHASE-27-UPSTREAM-QR-CONTINUITY.md`.

## Owner fact and implementation

The owner's 2026-11-25 answer, preserved in `2026-11-25-remaining-tasks.md`,
confirms both bare codes and legacy URLs. The host and production cutover are
still operator inputs; no domain or real sticker value is inferred.

`frontend/src/app/(app)/dashboard/ipm/new/StartClient.tsx` extracts typed URL
codes through the existing camera helper. `new/page.tsx` passes a bounded `qr`
query to pre-fill the field; lookup requires Find and the existing permission.
`frontend/src/proxy.ts` keeps the query in the sign-in callback.

`deploy/compose/nginx/legacy-stickers.conf.template` and its notice HTML serve
a static bilingual notice with a fixed app-origin sign-in link, no device lookup,
no-store/noindex/no-referrer/CSP headers, and a per-address budget. The upstream
`/readQr/(:alphanum)` shape bounds the interpolated code to 64 alphanumeric
characters. `TASKS/RUNBOOK-LEGACY-STICKERS.md` describes rendering and cutover.

## Verification

- Frontend `src/proxy.test.ts` and
  `src/app/(app)/dashboard/ipm/__tests__/StartClient.test.tsx`: 29/29 passed,
  coverage disabled. Includes URL extraction, explicit Find, read-only denial
  and query preservation through sign-in.
- `npm.cmd --prefix frontend run typecheck`: exit 0.
- ESLint on all five changed frontend files: exit 0; `git diff --check`: exit 0.
- Backend `calibrationDevices.reads.p2102.test.ts` and
  `deviceRegister.isolation.p2102.test.ts`: 23/23 passed, coverage disabled;
  real route-chain checks over in-memory fixtures, not a live HTTP deployment.
- `npm.cmd --prefix frontend run build`: exit 0, including Next's typecheck.
- `node scripts/upstream/legacy-stickers-check.mts`: passed against disposable
  nginx: syntax, actual HTTP notice, identical known/unknown-shaped responses,
  fixed callback despite hostile Host/forwarded host/query, privacy headers and
  429 budget. Its container and temporary directory were cleaned up.

## Not determined

No production host cutover or full make verify is claimed.
The follow-up browser suite `automate/p22.browser.mts` passed **105/105**,
including a signed-out request to the QR-prefilled start page, actual sign-in,
and verification that the destination and sticker survive. The earlier 104-case
run also passed before this extra case. See `2026-11-25-p17-browser-security.md`.
Physical-phone scans (P27-04) are excluded by the owner.
The remaining Phase 12–31 work remains tracked separately; this record does not
close the overall programme or P17-07.
