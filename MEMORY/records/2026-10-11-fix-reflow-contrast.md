# 2026-10-11: Two browser-suite defects fixed (devices reflow at 200% zoom, calibration contrast at 360 px)

The no-skip run of 2026-10-10 found two frontend defects ([record](./2026-10-10-no-skip-e2e-browser.md) § Not green, items 1 and 2). This record covers both, and the sibling tables with the same patterns. **Frontend only.** No test or assertion changed.

## 1. a11y: `/dashboard/devices` was wider than the viewport at 200% zoom (WCAG 1.4.10)

**Seen:** on a stack built from `6ad3bd7` (run below, before the fix), the page was 823 px wide in a 683 px viewport, with `sticking out: (none found)`. The screenshot shows no visible overflow.

**Root cause:** the register table (`DeviceTable.tsx`) has sr-only labels: the caption, and the photo and actions header labels. Tailwind's `sr-only` is `position: absolute`. The scroller around the table (`overflow-x-auto`) had no position, so it was not their containing block. Absolutely positioned descendants escape such a scroller. The actions header's label sat at the table's right edge (about 823 px) and widened the page. The suite's offender scan skips any element that has a scrolling DOM ancestor, so it named nothing.

**Fix:** the scroller is `relative overflow-x-auto`, which makes it the containing block, so the label is clipped and scrolls with the table.

**Same pattern elsewhere:** every `overflow-x-auto` region in a file that also has `sr-only` was changed in the same way (one class added):

- the shared `components/ui/Table/Table.tsx`;
- `AuditTable`, `CalibrationListPanel`, `FacilitiesClient`, `TechnicianActivity`, `IpmClient`, `CaptureClient` (the steps nav), `ReportClient` (the sections);
- the six `ipm-templates` panels: `DeviceTypesPanel`, `ItemLibraryPanel`, `ProposalQueuePanel`, `ProposalsPanel`, `TemplateEditor`, `TemplatesPanel`.

Kanban's board scroller was left alone: it is a drag surface, not a table.

## 2. p11: `/dashboard/calibration` at 360 px, `td:nth-child(5) > .text-xs` at 2.32:1 (light) and 1.84:1 (dark)

**Root cause: the text was overlapping the next cell, not using a weak colour token.** Column 5 of the records table is "Performed By", `<span class="text-xs">` in `text-foreground`, a token that passes everywhere else. The shared `Table` was `w-full table-fixed`, and its cells are `whitespace-nowrap`. A fixed-layout table at full width divides a 360 px card evenly between its 7 columns, roughly 51 px each, and 48 px of that is padding. The nowrap content then spilled over the neighbouring cells. axe measured column 5's text against the red `non_compliant` status badge from column 4, which was drawn under it. No colour token could fix that, and none was changed.

**Fix:** the shared `Table` is `table-auto lg:table-fixed`. Below `lg` the table takes its content's width, and its own focusable region scrolls (P11-07's `tabIndex`). From `lg` up, the fixed layout and the columns' explicit widths (for example `WorkOrdersTable`'s `w-[28%]` title) are unchanged.

**Same pattern elsewhere:** `UserTable` and `RolesTable` hand-roll the same `w-full table-fixed` with `whitespace-nowrap` cells. Both get `table-auto lg:table-fixed`. `WorkOrdersTable`'s comment now says the fixed layout applies from `lg`.

## Evidence

**Unit (frontend, run 2026-10-11):**

- `npm run typecheck`: 0 errors.
- `npx eslint` on the 18 changed files: clean.
- `npx jest --ci --findRelatedTests <18 files>`: **130 suites, 1,363 tests passed**, 0 skipped.
- Guards (`npx jest --ci src/tests/guards`): **5 suites, 93 tests passed**.
- `node ../node_modules/next/dist/bin/next build`: OK.
- `node scripts/bundle-budget.mjs`: exit 0, 10/10 within.

**Browser (disposable stack):**

- Stack: compose project `fixf-stack`, `BUILD_TAG=fixf`, `docker-compose.yml` + `docker-compose.build.yml` + `docker-compose.e2e.yml`, 127.0.0.1:27230/27231/27232, env from `scripts/ci/e2e-env.sh`.
- Production mode, seeded with `GET /api/v1/migration/seeding`. The bootstrap password was read inside the container and never printed.
- The frontend was rebuilt (`up --build --no-deps frontend`) after the fix.
- The backend image was built from the working tree on 2026-10-11. It held the parallel backend fixer's in-flight changes, which are not part of this record.

| Suite | Before (image from `6ad3bd7`'s frontend) | After |
|---|---|---|
| `automate/a11y.browser.js` | 79/80. FAIL `reflow at 200% zoom /dashboard/devices`: 823 px in 683 px | **80/80** (`reflow … /dashboard/devices`: 683 px ≤ 683 px) |
| `automate/p11.browser.mts` | not re-run (103/105 on 2026-10-10) | **105/105**: `axe [light 360]` and `axe [dark 360] /dashboard/calibration` axe 0 |
| `automate/responsive.browser.js` | — | **45/45** page-mode pairs clean, **90/90** QR demo rows clean, 0 FAIL |
| `automate/smoke.browser.js` | — | **7/7** (the 403s it lists on `/dashboard/mfa` are informational: pre-enrolment calls) |

The first p11 attempt after the frontend rebuild stopped at sign-in ("the password step never appeared") while `next build` was running on the same machine. The re-run was clean.

**Tear-down:** `down -v --rmi all` on `fixf-stack`, then the `callibrator/*:fixf` images removed by name. No prune.

## Files

- `frontend/src/components/ui/Table/Table.tsx`
- `frontend/src/app/(app)/dashboard/devices/components/DeviceTable.tsx`
- `frontend/src/app/(app)/dashboard/users/components/UserTable.tsx`
- `frontend/src/app/(app)/dashboard/roles/components/RolesTable.tsx`
- `frontend/src/app/(app)/dashboard/maintenance/components/WorkOrdersTable.tsx` (comment only)
- `frontend/src/app/(app)/dashboard/audit/components/AuditTable.tsx`
- `frontend/src/app/(app)/dashboard/calibration-dates/components/CalibrationListPanel.tsx`
- `frontend/src/app/(app)/dashboard/client-facilities/FacilitiesClient.tsx`
- `frontend/src/app/(app)/dashboard/components/TechnicianActivity.tsx`
- `frontend/src/app/(app)/dashboard/ipm/IpmClient.tsx`
- `frontend/src/app/(app)/dashboard/ipm/capture/[sessionId]/CaptureClient.tsx`
- `frontend/src/app/(app)/dashboard/ipm/sessions/[sessionId]/report/ReportClient.tsx`
- `frontend/src/app/(app)/dashboard/ipm-templates/components/{DeviceTypesPanel,ItemLibraryPanel,ProposalQueuePanel,ProposalsPanel,TemplateEditor,TemplatesPanel}.tsx`
- `MEMORY/records/2026-10-11-fix-reflow-contrast.md`, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md` (one row each)
