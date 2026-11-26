# 2026-11-26 — P27 sheet printing and frontend integration

Owner: continue implementation through Phase 31 in parallel. Physical-device
checks remain excluded; no production action, merge or sign-off is inferred.
Spec refs: `MEMORY/specs/P27-03-session-sticker-sheets.md`, ADR-138 Am. 6,
`MEMORY/specs/P19-07-public-device-page.md` §10.

## Reproducible print check

Added `scripts/sticker-sheet-print.mts`, run from the repository root with
`node --import tsx scripts/sticker-sheet-print.mts` after frontend build.
It uses the real `StickerLabel`, built frontend CSS and synthetic QR data.
The browser executable can be supplied with `CHROME_PATH`.

Actual headless Chromium passed: 19 labels, two A4 PDF pages, each label
60 × 40 mm within 0.2 CSS pixels, with the application subtree hidden.
The retained script passed again after the current production frontend build.
The earlier scratch script also passed; its prior launch failure is superseded
for this environment by these successful runs.

The fixture groups labels into 18+1 independently of the tray component.
Tray pagination, portal lifecycle and authorization continue to rely on
`stickerSheet.p2703.test.tsx` and the dialog/register regressions. This check
does not prove physical printer alignment, optical QR readability or actual
browser dialog interaction. No physical scan or visual PDF review is claimed.

## Frontend gates

- `npm run typecheck`: exit 0 (TypeScript 7).
- `npm run build`: exit 0 (Next 16.4.5, TypeScript 6).
- `npm run lint`: exit 0, zero errors and 12 warnings in existing unrelated files.
- `npm run api:types:check`: exit 0.
- `node --import tsx --test scripts/upstream/cutover-evidence.test.mts`:
  11/11 passed, exit 0 (the existing collector regressions).

An initial collector invocation with native Node type stripping failed before
test execution because the contracts source uses extensionless imports. The
existing `tsx` runtime resolves those imports; no source workaround was added.

The build warns about the existing `partialPrefetching` configuration. This
continuation does not change that configuration or the unrelated lint warnings.
Full frontend `npm test -- --runInBand` completed in 1581.197 seconds:
411 suites passed, one failed; 4216 tests passed, two failed (4218 total).
Coverage exceeded every configured gate: statements 95.08%, branches 87.54%,
functions 91.89%, lines 95.69%.

Both failures were `copyTruthfulness.p1011.test.ts` dictionary numeric checks:
the sheet's "100%" actual-size printing instruction lacked a numeric-source
entry. Added the exact `devices.sticker.sheet.lead` entry to `copyRules.ts`,
citing `StickerSheet.tsx`'s 18-label capacity, `StickerLabel.tsx` dimensions,
the A4 CSS and the real Chromium geometry proof above. No assertion, numeric
pattern, threshold or product copy was removed or weakened.

Focused rerun: `npm exec -- jest --runInBand --coverage=false --runTestsByPath
src/tests/public/copyTruthfulness.p1011.test.ts` passed **79/79**, exit 0.
The full frontend suite was not repeated after this source-reference-only
test-infrastructure correction; an uninterrupted all-green full run is not claimed.
