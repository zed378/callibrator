# 2026-11-25 — P27-03 session-only A4 sticker sheets

Status: implemented in working tree; actual sheet print geometry unverified.
Spec: `MEMORY/specs/P27-03-session-sticker-sheets.md`; ADR-138 Am. 6.
The P19-07 spec records the dialog-close exception through the deviation protocol.

`DevicesClient.tsx` holds an explicit tray of labels selected with the new
"Add sticker to A4 sheet" control in `PublicLinkDialog.tsx`. Only freshly issued
or replaced links can be added. There is no batch-mint endpoint or recoverable
token storage. The tray stores QR data images and label text in React state,
replaces duplicates, supports remove/clear, and removes a device after successful
local rotate/revoke/delete. Its register subtree is keyed by user, tenant,
pathname and public-link/facility access so a scope change discards it.
Cross-tab changes are not synchronized; the UI warns about stale links.

`StickerSheet.tsx` reuses the existing `StickerLabel`. Print temporarily mounts
its portal under body and suppresses the app. CSS specifies A4 portrait, 3 × 6
labels per page, 60 × 40 mm each, 5 mm gaps and 16/10 mm vertical/horizontal
margins. Existing thermal-label print and PNG remain available. New labels are
assembled only from individually authorized issue/replace operations. Strings
are bilingual and use existing theme/UI components.

Named verification:

- Focused Jest run, coverage disabled: **4 suites, 52/52 passed** —
  `stickerSheet.p2703.test.tsx`, `sticker.p2703.test.tsx`,
  `publicLink.p2208.test.tsx`, `page.test.tsx`. Covers 19 labels partitioned 18+1,
  duplicate replacement, remove/clear, portal lifetime, no browser-storage write,
  explicit add after issue, revoke clearing and principal-change clearing; existing
  thermal output/issuance/register tests remain green. Tray accessibility: axe 0.
- Frontend `npm run typecheck`: exit 0 after the final integration.
- ESLint from frontend workspace on changed TS/TSX/message files: exit 0.
- `git diff --check`: exit 0 on the shared tree at this boundary.

`.tmp-p27-sheet-print.mts` prepares a real Chromium check with the actual
StickerLabel, existing compiled dashboard CSS plus new source print rules,
19 labels and independent two-page A4/60×40mm assertions. Its default-sandbox
launch failed with browser exit code 2147483651 before a page opened. No new
escalation was requested under the owner's instruction to avoid optional prompts.
**No actual Chromium sheet output, paper alignment or physical scan is claimed.**
Next build/full coverage were not rerun by this lane; parent integration owns
repository-wide gates. No phase marked DONE, production action or signature.
