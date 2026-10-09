# P22-01 — the IPM checklist catalogue page: published catalogue, checklists and drafts, item library, device types, proposals and the operator's queue

**Date:** 2026-10-09 · **Task:** P22-01 (Phase 22) · **Spec:** [`MEMORY/specs/P19-01-inspection-catalogue.md`](../specs/P19-01-inspection-catalogue.md) § 5, § 7, § 8 · **API:** P21-01 ([record](./2026-10-09-p21-01-catalogue-api.md)) · **Kind:** frontend only (page, service, tests, i18n); no backend file, no `schema.d.ts` change; nothing committed

> **Privacy:** every fixture is synthetic ("Test Pump A", "Synthetic scale", "Synthetic warmer"). No upstream value anywhere; `mozivid/` untouched.

## What was built

| | |
|---|---|
| Page | `frontend/src/app/(app)/dashboard/ipm-templates/` — `page.tsx` (server: locale cookie, only the `ipmCatalogue.` namespace handed to the island, the language toggle posting to `setLocale`, as the SQL-dump import page) and `IpmTemplatesClient.tsx` (one `<main>` via `DashboardLayout`, one `<h1>`, tabs with arrow keys) |
| Audiences (ADR-102: the effective permissions, never a role name) | **operator** (`superAdmin`): Checklists · Item library · Device types · Proposal queue · Published catalogue. **tenant reader** (`ipm-templates`, `ipm` or `calibration` read — the G-2 gate of the reads): Published catalogue, read-only. **`ipm-templates` read** adds Proposals (write: propose, withdraw). **facility-bound** (G-P8): never Proposals (the routes answer 403 FACILITY_ROUTE_REFUSED). No read: a restriction notice, nothing loaded |
| Published catalogue | `GET /ipm/templates/published`; a type picker (filterable); the version a new inspection pins by `resolveTemplateVersion` (contracts — the same function as the server and the offline client); "uses the base checklist" when the type has none; items by section in registry order, base items tagged |
| Checklists + editor | list with published version and open draft (status / has-draft filters); create a type's checklist from a device-type picker; the editor: open a draft (copy of published / empty), add from the library, order inside a section, required, remove; **Save items** = `PUT …/items` at the revision read; change note; **Publish** (needs a note and no unsaved edits; confirmed; the base's confirmation says it rebases every type checklist; the toast counts `rebasedVersionIds`); discard; retire / reactivate (never the base); history with past versions opened read-only |
| Item library | filters (section, status, search); the item form offers only the section's kinds and outcomes (`INSPECTION_SECTION_RULES`), the kind's fields, a **live limit preview** (`parseLimit`: "Read as: ≤ 0.5 mA" / "kept as text, only printed"), and the **shared content checks** (`inspectionContentProblems`) before saving; edit keeps section and kind (the API refuses a change); retire |
| Device types | search, status, create, rename, retire (confirmed), reactivate |
| Proposals (tenant) | own list by status; new proposal: kind; a type (from the published catalogue) or a new name; items (section → kind, label, unit, limit, note); a change / retirement picks the item from the type's current checklist and sends `basedOnVersionId`; withdraw (confirmed) |
| Queue (operator) | `/admin/ipm/template-proposals` (submitted by default); one proposal read in full (tenant text shown, never copied); accept (a new-type proposal names the type the operator created), reject (note required) |
| Errors | every list: loading / empty / **failed** (`ErrorState`, never an empty list); every action's refusal shown in the panel (dialogs keep the form) with the backend's message — a 409 is its state explanation, a stale revision offers "Reload the draft" |
| Service | `api/services/ipmCatalogue.service.ts` — 27 P21-01 operations on the generated client (the single-row reads `GET /device-types/:id`, `/ipm/item-definitions/:id` and `/ipm/template-proposals/:id` are not needed by the page) (types read off `paths`); lists return `{ rows, meta }` from `data` + top-level `meta` |
| Shared | `usePermissions().facilityBound` (G-P8; P18-03 § 13); `statusTone` domains `catalogueLifecycle`, `templateVersion`, `templateProposal` (retired / rejected are decisions, never alarm); 252 `ipmCatalogue.*` keys in `id.ts` and `en.ts` (section names from spec § 5.1) |

## Decisions (within the spec; no `docs/` deviation, no ADR)

1. **A draft item already in the draft is saved with its own copy of the content** (`content` in the PUT); a library item added in the editor is sent without content, so the server copies it. Otherwise a save would silently swap the draft's copy for a later library edit, which the spec forbids ("existing drafts and versions hold copies").
2. **The editor does not edit an item's content in place**; content is edited in the library and re-added (remove + add). The API allows a per-item override; no screen asked for it and it would be a second content form.
3. **The live content checks print the contracts' own sentences (English)**, the same the server's 400 carries; translating them would mean a second copy of the rules.
4. **The proposal form takes the types and items from the published catalogue document** (one read, no per-type call); a change/retirement can only name an item of the type's current checklist.
5. **The queue shows the proposing tenant's id**, not its name: the queue row carries `tenantId` only (follow-up below).
6. Bilingual island like the SQL-dump import page; the rest of the dashboard stays English.

## Evidence — tests named

- `src/api/services/ipmCatalogue.service.test.ts` — 15: every path, method and body against `schema.d.ts`; the envelope (rows in `data`, top-level `meta`, a missing `meta` = one page, `null` data = none); a 409 rejects.
- `src/app/(app)/dashboard/ipm-templates/__tests__/catalogue.test.ts` — 21: the strict content union per kind; the shared checks (mA vs µA, missing outcome); a kept copy vs a library add; section order of the PUT; move inside a section; read order; `limitSymbolic` for 9 limit forms and the text case.
- `…/__tests__/IpmTemplatesClient.test.tsx` — 15: tabs per audience (`tabsFor`); loading; restricted; a reader's read-only catalogue (type → own version, a type without → the base, filter); a failed read is an error with retry; nothing published; **G-P8 bound account has no proposals and never calls the route**; read-only proposals; propose a new type and withdraw (409 shown); a change proposal names the item and `basedOnVersionId`; an add-items proposal and a refused submit keeping the form; status filter and a missing catalogue disabling "New proposal"; arrow-key tabs + axe; Indonesian.
- `…/__tests__/TemplatesPanel.test.tsx` — 14: list + filters + axe; create a type checklist and open an empty draft; a create 409 shown and dismissed; the draft edit and the exact PUT body at the revision read; reorder; **stale save 409 + reload**; note + publish confirmed; a publish 400 shown, draft kept; **base publish rebase text + toast count**; discard and reopen from published; retire/reactivate; history + read-only past version; a draft read failure; library filter + failure.
- `…/__tests__/operatorPanels.test.tsx` — 13: device types (filters, paging, axe, 409 clash shown, rename, retire, reactivate, failed list); library (filters + axe, the item form's preview / checks / exact POST and a 400 keeping the dialog, the setting fields, edit with locked section/kind + PATCH, retire 409 and retire, outcome order); queue (default `submitted`, full read + axe, reject needs a note + 409, accept a new type with the created type, accept with no note).
- `…/__tests__/page.test.tsx` — 2: title in the request's language; only the `ipmCatalogue.` namespace handed over; the toggle.
- `src/hooks/__tests__/usePermissions.bound.test.ts` — 2 (G-P8): bound / unbound / absent / not loaded.
- `src/lib/statusTone.test.ts` — +10 rows for the three new domains.

**Gates (2026-10-09, frontend):** `npm run typecheck` 0 errors; `npx eslint` on every changed file clean; `npx jest --ci --coverage` **327 suites, 3,571 tests passed, 0 failed**, 94.17 / 85.25 / 90.06 / 94.85 (gate 90 / 81 / 86 / 91) — the first full run caught `copyTruthfulness.p1011` flagging "± 10 %" in the limit help as an unsourced figure (the example became "± 0,2 V"); new files alone: lines ≥ 94 %, branches ≥ 87 %; `node ../node_modules/next/dist/bin/next build` OK (`ƒ /dashboard/ipm-templates`); `node scripts/bundle-budget.mjs` 10 / 10 within. Tree not quiet: the backend agent was editing `backend/` in parallel (no backend file touched here).

## Not done / open

- **The menu entry is still inactive** (ADR-124 Am. 5): backend follow-up — set `ipm-templates` `is_active = true` in `seedMenuGroups.util.ts` **and** by a migration for seeded databases. Not written here (backend's).
- Live browser / E2E / accessibility (light + dark) suites on a running stack (the phase DoD), and the live operator flow of spec § 13 (create type → draft → publish → a technician sees it → v2 → the old version still renders): not run — no stack in this session.
- Optional backend follow-up: the queue row carries no tenant name (only `tenantId`).
- Not committed.
