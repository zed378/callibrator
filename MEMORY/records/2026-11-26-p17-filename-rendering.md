# 2026-11-26 — P17 PT-30 stored filename on the report renderer

Status: implemented and verified in the working tree, not merged. No security
phase exit or production action is claimed.

Spec refs: `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` §12 PT-30;
`docs/UPSTREAM/00-OVERVIEW.md` §9 S-07;
`MEMORY/specs/P19-02-ipm-session-aggregate.md` IPM photos;
`MEMORY/specs/P19-06-ipm-report-document.md` §§11–12.

## Change

`automate/p22.browser.mts` adds two checks for the remaining stored-filename
vector. A real JPEG is selected through the capture page's file input with a
filename containing a quote, closing angle bracket, image markup and an
`onerror` execution sentinel. A browser `File`/`DataTransfer` supplies the name
because Windows disk filenames cannot contain those characters. The actual
React change handler, browser photo preparation, multipart upload, persistence
and signed-image loading all run normally.

The first check requires the exact filename in the draft image's alternative
text. After submission and navigation to the actual report page, the second
requires the exact filename in one loaded image's `alt` attribute, and rejects
active image handlers, SVG handlers, iframe srcdoc, script elements and the
execution sentinel. Thus the test cannot pass merely because the filename
was discarded or no photo rendered. `EvidencePhotos.tsx` uses a React `alt`
attribute; its escaping holds for this probe. No application fix was needed.

## Named evidence

- `P17 PT-30 S-07: upload an IPM evidence photo with a hostile filename`: PASS.
- `P17 PT-30 S-07: stored evidence filename stays an inert attribute in the report`:
  PASS, including loaded signed JPEG and exact stored payload.
- Complete `automate/p22.browser.mts`: **112/112 passed in 358,760 ms**, exit 0,
  through `.tmp-p17-test.cjs browser` on the existing synthetic disposable
  `callibrator-p17-20261125` production-mode stack (backend 27130, frontend
  27131). Existing device/notes probes, actual PDF/XLSX downloads, bound exports,
  CSP, legacy QR sign-in, axe light/dark and responsive checks also passed.
- `node node_modules/@typescript/native/bin/tsc -p automate/tsconfig.json`:
  exit 0 after the final executable change.

Two earlier browser attempts failed before upload because the harness was on
the section step, then the outcome step. Source inspection showed the photo
input is on the final review step; the corrected navigation produced the full
green run above. These were test harness failures, not security findings.

## Limits

This proves the named on-screen IPM report evidence-photo path with synthetic
data in desktop Chromium. Evidence photos are intentionally excluded from the
PDF by the report contract; this does not claim a PDF filename surface exists.
No physical-device test, production verification, full verify gate, new
mutation check, human security signoff or complete P17 exit is claimed. Existing
dirty work was preserved; only the browser suite and this record were edited.
