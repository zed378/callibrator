# Upstream adoption — the four ADRs (UP-00-02, UP-00-03, UP-00-04, UP-16-02) and the open questions (UP-00-07)

> **Card ids renumbered 2026-10-07: see PHASE-12 mapping** — [`TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`](../../TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) § 7 (`UP-xx-yy` → `P(12+xx)-yy`; the plan file `PHASE-UPSTREAM-PHP-ADOPTION.md` was split into Phases 12 … 31 and deleted). This record keeps the ids it was written with.

**Date:** 2026-10-07 · **Task:** Upstream PHP Feature Adoption, phase UP-00 (Decisions & ADRs) and UP-16-02 (BACKLOG Q-57) · **Decisions:** ADR-124, ADR-125, ADR-126, ADR-127 · **Base commit:** `755314d` (working tree, not committed) · **Kind:** documentation only — no code, migration or test was written; nothing was committed

> **Privacy:** no upstream data value appears in this record or in any file it names.

## What happened

1. The coordinator assigned the ADRs for the owner's four decisions of 2026-10-07 (UD-1 tenancy, UD-3 catalogue, UD-6 IPM sessions, UD-14 PWA) and UP-00-07.
2. **While the tenancy ADR was being designed — before anything was written — the owner corrected UD-1** (verbatim: *"sebagai konteks tenant adalah perusahaan kalibrator yang melayani faskes"* — "the tenant is the calibration company that serves the facilities"). The first reading (facility = tenant; provider staff act through a revocable cross-tenant grant and an "active facility" switch, amending ADR-084) was **never written as an ADR**, so there is nothing to withdraw; the plan's UD-1 row keeps the first reading struck through for history.
3. Two further owner rules arrived during the work and are applied: **certificates and data exports are rendered in the frontend; no certificate or export file is stored** (ADR-126 § 8, extending ADR-095 §4), and the upstream's ~11.9 k external certificate PDFs are archived offline, not loaded (consistent with the privacy agent's `docs/UPSTREAM/07`/`08`).
4. The privacy agent's DPIA (`docs/UPSTREAM/06-DPIA.md`) risk R-04 named the mitigations the facility scope must have before any facility user is invited; ADR-124 specifies each (central deny-by-default scope; the facility column NOT NULL on every facility-owned row; two-facility 404 tests on routes, lists, exports, includes, raw SQL, socket rooms and signed URLs, plus a guard; the facility segment in storage keys with a row check before any signed URL; no facility switch for bound users).

## Decisions (each with alternatives and bad implications in `MEMORY/DECISIONS.md`)

| ADR | Card | One line |
|---|---|---|
| **ADR-124** | UP-00-02 | A tenant is the organisation that performs/manages the work (a provider serving many facilities, or a hospital serving itself); a facility is a `client_facilities` row inside it; facility staff are users **bound** to their facility by a second scope dimension applied by the same tenant hooks, deny-by-default (other tenant tables answer nothing to them), cross-facility = 404, routes deny-by-default for bound users; ADR-084 reaffirmed, not amended |
| **ADR-125** | UP-00-03 | Global catalogue without `tenant_id`: device types, item library, templates, immutable published versions with copied items; sessions pin a version; writes super-admin only (new guard like `rolesGlobal.d16`); tenants propose through a tenant-scoped proposals table |
| **ADR-126** | UP-00-04 | IPM session = issued record: many per device; draft → submitted; correction supersedes, void final; trigger makes submitted rows immutable; visit number under a device lock; "due" computed from an interval, never blocking; IPM report and all exports rendered in the frontend from paginated reads |
| **ADR-127** | UP-16-02 | PWA: capture screens only offline; per-user encrypted IndexedDB; idempotent replay of the normal API (`Idempotency-Key`, `client_ref`); conflicts are 409/404 with reasons; `worker-src`/`manifest-src 'self'`, `camera=(self)`; cached capture page replays its nonce offline (recorded exception); iOS 17.4+ installed / Chromium 120+ floor |

UP-00-07: the 14 open owner decisions are carried in `TASKS/BACKLOG.md` as **Q-57·UD-2 … Q-57·UD-18**, plus **Q-57·T** (what ADR-124 asks the owner to confirm: self-served hospitals stay tenants; facility accounts count as seats; no flow between a hospital's own tenant and its provider's records of it; provider roll-ups need no per-facility consent).

## Code read to ground the ADRs (2026-10-07)

`backend/src/utils/tenantScope.util.ts` (resolution order, include walk), `middlewares/tenantContext.middleware.ts` (the store), `middlewares/auth.middleware.ts` (tenant from the user row; super-admin header override; impersonation; API keys), `models/user.model.ts` (one `tenantId`, global unique e-mail), `models/session.model.ts`, `models/auditLog.model.ts`, `config/socket.ts` (rooms `tenant_<id>`, `user_<id>`, `super_admins`, `board_<id>`), `middlewares/dynamicAccess.middleware.ts` and `services/effectivePermission.service.ts`, `constants/roleConstants.ts`, `constants/seededMenuSlugs.ts`, `utils/sql.util.ts`, `tests/models/unscopedModels.d17.test.js`, `tests/utils/rawSqlTenantPredicate.d05.test.js`, `tests/guards/twoTenantRoutes.guard.test.ts`; frontend `src/lib/securityHeaders.ts` (no `worker-src`; `camera=()`), `src/lib/authCookies.ts`. Facts used: **115 reads of `user.tenantId` in 42 non-test files** (why ADR-124 keeps the tenant dimension untouched and adds the facility from the user row); no service worker, manifest or IndexedDB in the frontend.

## `docs/` amended (deviation protocol; every amendment labelled *target, not built*)

`docs/PLAN/00-PROJECT-OVERVIEW.md`, `docs/PLAN/03-USER-ROLES.md`, `docs/PLAN/10-TENANCY-AND-ONBOARDING.md`, `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` (new § Target — the Facility Dimension), `docs/SECURITY/12-INCIDENT-RESPONSE.md` (UU PDP Art. 46: 3 × 24 h to data subjects and the agency, beside GDPR's 72 h; per-facility breach scoping), `docs/MULTI-TENANCY/README.md`, `docs/DATABASE/00-DATA-MODEL.md`, `docs/FRONTEND/00-FRONTEND-STANDARDS.md` (CSP target), `docs/UPSTREAM/00-OVERVIEW.md` § 10 (superseded note), `docs/UPSTREAM/02-FEATURES.md` (§ B, C, F, G, I, L notes), `docs/UPSTREAM/04-SCHEMA-MAPPING.md` (§ 3, § 4.3, § 4.8, § 6, § 9 notes), `docs/UPSTREAM/05-DATA-MIGRATION.md` (§ 6.1 volume: photos only ≈ 91 GB; § 10 tenancy note). ADR-084 gets a one-line "reaffirmed, not amended" note.

## Plan and boards

The upstream adoption plan: UD-1 revised (first reading struck through), UD-3/6/14 name their ADRs, UD-11 reworded for client facilities; cards UP-00-02/03/04/07 and UP-16-02 **DONE**; UP-05-06, UP-06-03, UP-07-01, UP-17-02 unblocked to **TODO**; the grant/"active facility" cards re-scoped to client facilities and the facility scope (UP-06-01/03/04, UP-07-04, UP-08-07, UP-09-09, UP-10-09, UP-05-06/07 titles); export/PDF cards re-scoped to frontend rendering (UP-07-06, UP-09-06, UP-10-06, UP-11-02); ETL volume to ≈ 91 GB of photos (UP-12, UP-12-03). Totals: **14 DONE · 4 TODO · 1 WIP · 77 BLOCKED** of 96. `TASKS/PROGRESS.md` updated to match.

## Not done / not verified

- Nothing was built or run; no gate (`make verify`) was run because no code changed.
- ADR-124 § 1 (a self-served hospital remains a tenant) is a working decision awaiting the owner (Q-57·T).
- The privacy documents `docs/UPSTREAM/06–10` belong to the other agent; only the plan's status cross-references and the 04/05/SECURITY-12 follow-ups it requested were touched here.
