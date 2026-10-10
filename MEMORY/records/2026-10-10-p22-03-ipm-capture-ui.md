# P22-03: the online IPM capture — start by QR (typed, scanner or camera), the mobile-first stepper, autosave, submit

**Date:** 2026-10-10 · **Task:** P22-03 (Phase 22; F-35 … F-53) · **Decision:** ADR-127 Am. 2 · **Specs:** [`P19-02`](../specs/P19-02-ipm-session-aggregate.md) § 7, § 8, § 9.4, § 10; P19-01 § 5, § 6 (the item kinds and limits); `docs/UPSTREAM/02-FEATURES.md` F-35 … F-53 · **Base:** `1942c5d` with P22-06 uncommitted in the tree

> Frontend only, plus one header change. No backend change, no API change, no migration. The `ipm` menu entry has been on since P22-04 (migration 0131). Offline capture is P22-10 (`/field`); this page needs the network.

## Built

| Area | What |
|---|---|
| Start (F-35, F-36) | `/dashboard/ipm/new` (server page + `StartClient`). The QR sticker can be **typed**, entered by a **handheld scanner** (it types the code and Enter), or **scanned with the camera** (`QrScanner`: rear camera through `getUserMedia`, the browser's `BarcodeDetector` for QR only, a frame every 300 ms, the camera released as soon as a code is read; a URL printed on a sticker gives its last segment). The device is found in the caller's context (`GET /calibration-devices/by-qr/:code`); a 404 reads "no device you may inspect has the sticker …". Its facts are shown: QR, serial, make · model, facility, room, last IPM. **Start** sends `POST /ipm/sessions { deviceId, clientRef }`, with **one** `clientRef` per device chosen so a retry answers the same draft (AM-16), then opens the capture. A 409 `IPM_DRAFT_EXISTS` (top-level `draftId`) and a device's own `openIpmDraftId` both offer "continue the draft". Allowed for `ipm` writers only, never the operator |
| Camera policy | `camera=(self)` on `/dashboard/ipm/new` **only** (ADR-127 Am. 2; `CAMERA_PAGES` in `securityHeaders.ts`, set by `next.config.ts`). Every other page keeps `camera=()`. No JavaScript decoder is shipped: a browser without `BarcodeDetector`, or a refused camera, is told so. The camera button is rendered on the client only (`useSyncExternalStore`, so no hydration mismatch) |
| Stepper (F-37 … F-49) | `/dashboard/ipm/capture/<id>` (`CaptureClient`) loads the draft, its **pinned** version (`GET /ipm/template-versions/:id`) and the device's room. There is **one step per section** in print order: each section with items, plus every section that takes ad-hoc rows. Then a step for the header ("outcome and recommendation") and one for review. Each step button carries its "answered / total" count. Previous / next controls and the touch targets are at least 44 px |
| Item fields | `ItemField` covers each input kind: check, tri-state, condition + cleanliness (toggle buttons with `aria-pressed`, named after the item), a reading or **not applicable**, a reading against its limit, a setting with readings 1 and 2, and text. For a reading against its limit, the computed outcome is shown and cannot be overridden while it is determinate; a person chooses when it is not. For a setting with two readings, a mismatch between the computed result and the technician's choice is flagged. The field also shows the setting and limit text, the warning range, and **the server's own problem** from `normaliseResult` (contracts), e.g. "outside the possible range" or "not a number" |
| Ad-hoc rows | Rows can be added in tools used, electrical safety, performance and consumables, each with its name and, by kind, a unit, setting and reference. Unnamed rows are not sent; rows can be removed |
| Autosave | After a 1.2 s pause, the page sends ONE `PUT …/results` (the whole set of rows) and/or ONE `PATCH` of only the header fields that changed. Each write uses the revision the previous one answered, and the writes run one at a time. A status line shows "saving" / "saved at hh:mm" / "changes not saved yet". **Answers the server would refuse are not sent.** A refused write stays visible ("Try again"), and the next change retries it; there is no retry loop. **`IPM_REVISION_CONFLICT` stops the autosave** and offers to reload the draft |
| Header (F-47, F-50 … F-53) | Performed at, inspection and maintenance outcomes, recommendation and notes. Room: **the device's room is kept** by default; another room can be found by name (`GET /warehouses?kind=room&find=`) and moves the device at submit (spec § 8.2). The server refuses a room from another facility |
| Review and submit | Lists the required items still missing (`missingRequiredItems`, the server's rule), each linked to its step. **Submit stays off** while any item is missing or holds a problem. Submit first saves whatever is pending, then sends `POST …/submit` at the current revision, and shows "IPM visit 008 submitted" plus the server's notices (`notices` + `sideEffects.notices`: a repair order opened, the device set to maintenance …). A refusal is shown in the server's words. Discard (`POST …/discard`) is on the same step. A draft that is no longer a draft points to the history |
| Links | The history gains a "Start an IPM" button for writers; a draft opened in the history links to "Continue the checklist" |

## Evidence — tests named

New:
- `app/(app)/dashboard/ipm/__tests__/capture.test.ts` (5). Includes **the PUT body for every kind parsed by the contract `ipmResultsReplaceBody`**.
- `__tests__/StartClient.test.tsx` (8): access; facts and axe; the same `clientRef` on a retry; not-found and failure; `IPM_DRAFT_EXISTS` resume and the device's own draft; `codeFromScan`; a scan that stops the camera and finds the device; a refused camera and a missing detector; closed before the camera opened.
- `__tests__/CaptureClient.test.tsx` (11): load states; steps and counts; PUT at the revision read, then at the one answered; axe; refused values not sent; limit computed and choices for every kind; ad-hoc add, name and remove; a refused save with no loop; a conflict with reload; `headerChanges`; the header PATCHes and the room pick; rooms none and failed; review, then submit with notices; refused submit, failed pending save and discard.
- `__tests__/captureServer.test.tsx` (3).
- `lib/securityHeaders.test.ts` (+1): camera on the scanning page only.

## Gates (2026-10-10, Node 26, Windows)

These were run before the owner's per-card rule of the same day arrived, so they are the full versions.

| Gate | Result |
|---|---|
| frontend `npm run typecheck` | 0 errors |
| `npx eslint` on every changed file | 0 errors, 0 warnings |
| `npx jest --ci --coverage` (full) | **350 of 351 suites, 3,755 of 3,756 tests passed**; 94.61 / 86.41 / 90.83 / 95.23. The one failure was `kanban/[projectId]/hooks/useBoard.realtime.test.ts`, which ran 21.7 s under load and is not touched by this card; **re-run alone twice: 3 / 3 passed** |
| `node ../node_modules/next/dist/bin/next build` | OK (`ƒ /dashboard/ipm/new`, `/dashboard/ipm/capture/[sessionId]`) |
| `node scripts/bundle-budget.mjs` | 10/10 within, exit 0 |

## Not done / open

- **Offline** (the queue, the worker, `/field`) is P22-10. This page needs the network, and an autosave that fails offline is reported as a failed save.
- **IPM evidence photos** (`POST /attachments` with `purpose: ipm_evidence`) are not in the stepper yet.
- No real-device run: camera scanning on Android Chrome and iOS Safari is unproven in a browser.
- No live browser, accessibility or responsive suite against a server.
