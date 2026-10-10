# P22-07: the dashboard's device-condition panel, IPM figures and technician activity

**Date:** 2026-10-10 · **Task:** P22-07 (Phase 22; F-70 … F-73) · **Decision:** ADR-126 Amendment 7 · **Builds on:** P21-07 (ADR-126 Am. 6, [record](./2026-10-09-p21-07-dashboard-ipm-due.md)) · **Base:** `dfe8d80`

> Frontend only. No API change (`schema.d.ts` read, not regenerated). Synthetic fixtures only. `mozivid/` not touched. `FACILITY_BINDING_ENABLED` untouched.

## Built

| Area | What |
|---|---|
| Page | `dashboard/page.tsx` is now a server component: the locale's `dashboard.` + `devices.condition.` strings to the island `DashboardClient.tsx` (the former page body, unchanged except the panels below) |
| Condition (F-70, F-71) | `components/DeviceConditionPanel.tsx`: good / not good / broken / not assessed with count, share and a progress bar; an SVG donut (theme tokens, named `role="img"`); links `Show <condition> devices` → `/dashboard/devices?condition=` for a `calibration` reader; `unset` states it has no filter; empty state |
| Drill-down target | `devices/page.tsx` reads `?condition=` (`register.ts#conditionOf`: good / not_good / broken only) → `DevicesClient initialCondition` → the first list read is filtered and the select shows it |
| IPM (F-70) | `components/IpmPanel.tsx`: visits of the last 30 days; tenant view: due this month, never inspected, scheduled; global view (`due: null`): a note; history link for an `ipm` reader |
| Activity (F-73) | `components/TechnicianActivity.tsx`: `GET /ipm/sessions` (`status=submitted`, `effective`, `sort=performedAt`, `limit 5`) on the generated client (`ipmHistory.service`, read only); search `q`, "Only my visits" (`performedBy`); date, device, QR, S/N, facility, technician, recommendation from the visit's snapshots; loading / empty / failed + retry; tenant view and `ipm` read only |
| Bound user | `DashboardStats` hides Warehouses, Low Stock, Pending Transfers when `facilityBound` |
| i18n | 37 `dashboard.*` keys in `id.ts` / `en.ts` (inserted after `devices.condition.broken`) |

## Evidence — tests named

- **New:** `dashboard/__tests__/conditionActivity.p2207.test.tsx` (15: counts, shares, donut name, drill-down hrefs, `unset` without link, axe; no links without `calibration`; empty; helpers; Indonesian; IPM figures + history link; global note and no activity read; activity rows from snapshots and the exact query; search + "mine"; empty vs failed + retry, blanks as "—"; no activity without `ipm`; bound user's cards hidden, unbound shown); `dashboard/__tests__/page.server.p2207.test.tsx` (1: only the two namespaces, in the request's locale).
- **Re-based:** `dashboard/__tests__/page.test.tsx` (imports the island; fixtures gain `byCondition` and `ipm`); `devices/__tests__/page.test.tsx` (+2: `?condition=` applied to the first read and the select; `conditionOf`).

## Gates (2026-10-10, per-card scope under the owner's rule of 2026-10-10)

| Gate | Result |
|---|---|
| `npx eslint` on every changed file | 0 errors, 0 warnings |
| `npm run typecheck` (frontend) | 0 errors |
| `npx jest --ci --findRelatedTests <dashboard files, i18n>` | 47 suites, 485 tests passed |
| `npx jest --ci --findRelatedTests <devices files>` | 3 suites, 43 tests passed |
| coverage of the new files (dashboard suites) | `DeviceConditionPanel`, `IpmPanel`, `page.tsx` 100 %; `TechnicianActivity` 100 / 98.1 / 100 / 100 |
| `node ../node_modules/next/dist/bin/next build` | OK (twice; the second after the devices page change) |
| `node scripts/bundle-budget.mjs` | **`/` over: gzip 150.0 / 150 KB** (was 149.7). Not this card: no P22-07 module is in `/`'s chunks (no dashboard string found in `.next/static`); the uncommitted P23-02 change to `frontend/src/api/client.ts` (shared by every page) is the likely cause. Every other route within |

## Not done / open

- The dashboard's older cards stay English in an Indonesian session.
- `condition=unset` still has no list filter (backend, Am. 6).
- The `/` bundle budget (above) needs the owner of the `client.ts` change.
