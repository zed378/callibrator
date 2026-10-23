# C-2: the IPM evidence photos on the dashboard checklist and in the report

**Date:** 2026-10-23 · **Card:** C-2 (found by P26-01, `docs/UPSTREAM/12-UAT-PLAN-ID.md` § 9), plus the report half of P19-06 § 12 · **Status:** DONE in code (frontend only; the backend route already existed) · **Spec refs:** P19-02 spec § 10.2, § 12 · P19-06 spec § 12 · ADR-132 Am. 1 § 5, Am. 3 · `docs/FRONTEND/00-FRONTEND-STANDARDS.md`

## Hook

The dashboard could fill in an IPM but not attach a photo to it. The server had accepted IPM evidence photos since P21-03 (`POST /attachments` with `resourceType: inspectionsession`, purpose set server-side, draft-only, creator-only) and `/field` used them — so the gap was a screen, not a control. UAT step TP-07 (dashboard capture) therefore had no evidence photo, while TP-13 (`/field`) did.

## What was built

| | |
|---|---|
| `ipm/components/EvidencePhotos.tsx` (new) | The capture's evidence photos: the list, a failed load as a FAILED state (never an empty list), add (browser-downscaled JPEG through `lib/photoPrep`, the register's pipeline), remove with a confirmation, and a read-only state for a submitted IPM. Each thumbnail is the ORIGINAL through a short-lived signed link — an `ipm_evidence` photo has no metadata-free derivative, so a `variant` would 404. ID/EN (19 keys each) |
| `capture/[sessionId]/CaptureClient.tsx` | The review step renders `EvidencePhotos` above the missing-items list — the place the technician reviews the visit before submitting |
| `api/services/attachment.service.ts` | `uploadIpmEvidence(sessionId, file)` (multipart with `resourceType: inspectionsession`), `listForResource(type, id)` (rows in `data`, paging in `meta`), `signedLink(id)` (same-origin path, no `variant`) |
| `sessions/[sessionId]/report/ReportClient.tsx` | **P19-06 § 12 (the same day):** the on-screen report now lists the session's evidence photos, read-only, between the results and the outcomes — never in the PDF. It passes its own note, because the same page previews a draft: an issued report says the photos are part of its record and are not printed; a preview says the report shows them once submitted |

No backend change: `POST /attachments` already sets `purpose = ipm_evidence` from the resource type, refuses a non-draft session (409 `IPM_NOT_DRAFT`), refuses another user's draft (403), stamps the session's facility and honours `Idempotency-Key` (`attachmentsIpm.p2103`).

## Why this shape

The photos belong where the visit is reviewed, not on a step of their own: the stepper's steps come from the pinned checklist's sections (`stepsOf`), and adding an "evidence" step would have put a non-checklist section into a list the catalogue defines. A submitted IPM's photos are part of its record and cannot be deleted (the server's 409), so the component offers nothing in that state.

## Alternatives considered

- **A step of its own in the stepper.** Rejected: `stepsOf` derives steps from `INSPECTION_SECTIONS`; a non-checklist step there would be a second source of truth for the capture's order.
- **A metadata-free derivative for `ipm_evidence`.** Rejected here: `hasDerivatives` deliberately excludes `ipm_evidence` (P21-02b), and changing it is a storage decision with its own cost, not a screen's.
- **Embedding the photos in the PDF.** Rejected by the spec itself (P19-06 § 12): upstream parity, and a PDF that embeds tenant evidence would be a second copy outside the storage layer's delete and re-key paths.
- **Reusing `deviceRegisterService.photoLink`.** Rejected: it always sends a `variant`, and the server answers 404 for a variant of a file with no derivative. `signedLink` asks for the original.

## What surprised me

Adding the component made the existing capture suite fail for a reason that was invisible in the product: `CaptureClient.test.tsx`'s `routes()` rejected any unexpected GET, so the new `GET /attachments` turned into a second "Try again" button and `getByRole("button", { name: "Try again" })` matched two. The fix is in the harness (the mock now answers the new call with an empty page), not in the page. Worth knowing for the next component added to that screen.

Two smaller things: `ConfirmDialog` takes `description`, not `message` (a wrong prop type-checks until the component is rendered in a test); and a HEIC the browser cannot decode is refused by `photoPrep` before any request — the test had to count the delta of upload calls rather than assert zero, because an earlier refusal in the same case had already counted one.

The report half found a third, and it is the useful one: `ReportClient.test` asserted the PDF's `render=pdf` read with `toHaveBeenLastCalledWith`. That passed only while the report page made exactly one kind of read. Adding the photos' own `GET /attachments` made "last" a race — the assertion was measuring call order, not the thing it named. It now asserts `toHaveBeenCalledWith`, which is what "a fresh audited read happened" actually means. A `…LastCalledWith` on a page that is still growing is a latent flake, not a stricter test.

## Tests (named; scoped — the full suite was not run)

- **New:** `ipm/components/__tests__/EvidencePhotos.c2`, 8 tests: the list through a signed link to the original and axe-clean; an empty list versus a failed load (a failure is never an empty list); a retry after a failure; the upload's form (`inspectionsession` + the session id + the prepared JPEG); a refusal in the server's words and a HEIC the browser cannot convert (never sent); remove after a confirmation; read-only for a submitted IPM; Indonesian.
- **New:** `api/services/attachment.service.test`, 3 more: `uploadIpmEvidence`, `listForResource`, `signedLink` (no variant).
- **New (report half):** `ipm/__tests__/ReportClient.test`, 2 more: the issued report lists the photos with the "not printed in the PDF" note and offers no add/remove; a preview says the report shows them once submitted.
- **Changed:** `ipm/__tests__/ReportClient.test`'s PDF case now asserts `toHaveBeenCalledWith` for the `render=pdf` read (see "What surprised me"). No other assertion changed.
- **Changed:** `ipm/__tests__/CaptureClient.test` — its `routes()` answers `GET /api/v1/attachments` with an empty page. No assertion changed.
- **With the existing suites:** the whole frontend tree — **399 suites / 4,147 tests**, all passed (`npx jest --ci`, 2026-10-23, both halves in the tree).
- **Gates:** `npm run typecheck` 0 errors; `npm run lint` 0 errors (52 pre-existing warnings elsewhere in the tree; every changed file is clean, 0 warnings — the `load` dependency was fixed with `useCallback` rather than a suppression).
- **Not run:** the browser suites (`automate/p22.browser.mts`) and `next build`.

## Files

- `frontend/src/app/(app)/dashboard/ipm/components/EvidencePhotos.tsx` (new)
- `frontend/src/app/(app)/dashboard/ipm/capture/[sessionId]/CaptureClient.tsx`
- `frontend/src/api/services/attachment.service.ts`, `attachment.service.test.ts`
- `frontend/src/i18n/messages/en.ts`, `id.ts`
- tests (new): `frontend/src/app/(app)/dashboard/ipm/components/__tests__/EvidencePhotos.c2.test.tsx`
- `frontend/src/app/(app)/dashboard/ipm/__tests__/CaptureClient.test.tsx`
- `docs/UPSTREAM/12-UAT-PLAN-ID.md` (§ 9 C-2), `TASKS/PHASE-22-UPSTREAM-FRONTEND.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record
