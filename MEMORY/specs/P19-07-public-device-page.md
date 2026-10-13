# Feature Spec — P19-07 The Public Device Page: a Revocable Capability Token, One Exempted Read, One 404, a Per-Tenant Setting, and the Legacy-Sticker Boundary

**Written:** 2026-10-13 — **before** implementation. **Everything in this spec is TARGET: nothing here is built.**
**Task:** P19-07 (Phase 19, Domain Design). Builds in **P21-08** (table, staff routes, public route, setting — backend), **P22-08** (the `/d/[token]` page and the staff UI — frontend), **P27-03** (the sticker's print layout and the re-stickering policy); the legacy branch builds in **P27-02** once OA-4 is known.
**Author:** LINE B agent, under the owner's standing delegation (decide by best practice, record it; owner decisions stay open with a recommendation).
**Decision record:** **ADR-138** and **ADR-138 Amendment 1** (`MEMORY/DECISIONS.md`, written with this spec).
**Spec refs:** ADR-138 (all of it) · ADR-100 (request budgets, the per-address pair) · ADR-124 and Am. 1 – 2 (facility scope; the facility route gate; `ended`) · ADR-126 Am. 2 (the IPM report's verification token and page) · ADR-131 (the `(public)` root layout) · ADR-132 (QR numbers; `GET /calibration-devices/by-qr/:qrCode`) · ADR-133 (the "calibration due" computation) · ADR-137 (the envelope) · ADR-071 / ADR-090 (nonce CSP, one `<main>` / `<h1>`) · `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` P16, FT-31, EP-23 (FT-106, FT-107) · `docs/UPSTREAM/02-FEATURES.md` F-74, F-75, F-76 · `TASKS/PHASE-12-…` § 3 (UD-15, UD-16), § 4 (OA-4).
**Code read 2026-10-13 (HEAD `f2a2d70`, read only):** `services/ipmReport.service.ts#verifyReport` and `runAsTenantRead` (the house pattern for a public capability read: reviewed `skipTenantScope` + `skipFacilityScope`, then `runForTenant`), `controllers/ipmSession.controller.ts#verify` (ADR-100's pair: a request budget on the route, a tighter one counted after a 404), `routes/api/ipmReports.route.ts`, `constants/routeGateExemptions.ts` (the `api/ipmReports.route.ts` entry), `constants/rateLimitConstants.ts` (`ipmVerifyToken` 300 / `ipmVerify` 60 per 15 min), `middlewares/requestBudget.middleware.ts` (`perAddress`, `keyOf`; non-production factor 100), `middlewares/facilityRouteGate.middleware.ts` (a bound principal gets 403 `FACILITY_ROUTE_REFUSED` on any route not on `FACILITY_ACCESSIBLE_ROUTES` — deny by default), `constants/facilityAccess.ts#FACILITY_SCOPE_SKIPS`, `constants/tenantAdminSettings.ts#TENANT_ADMIN_SETTING_KEYS`, `services/tenant.service.ts#updateTenantSettings` (audited, in its transaction), `models/calibrationDevice.model.ts` (`status` active / inactive / maintenance / retired; `qrCode`; `clientFacilityId`; `nextCalibrationDate`), `packages/contracts/src/deviceValues.ts#computeCalibrationDue` (states not_scheduled / requested / overdue / due_soon / ok), `services/deviceReads.service.ts#deviceFacts` (the last IPM: `submitted`, not superseded), `packages/contracts/src/states.ts` (`CLIENT_FACILITY_STATUSES` active / inactive / ended), `routes/api/calibrationDevices.route.ts` (device writes gate on `calibration` write, not `equipment`), `frontend/src/lib/backendHeaders.ts` (`backendForwardHeaders`: the client address for a server-side call), `frontend/src/app/(public)/verify/ipm/[reportNumber]/page.tsx`, `frontend/bundle-budget.json` (`/verify/*` ≤ 120 KB brotli).

> **Privacy.** No upstream data value appears here. Every example is synthetic ("Facility One", QR `TST000001`).

---

## 1. Problem

Upstream's `FaskesController::readQr` answers a sequential device number with the device, its facility, its photos and links to its documents: anyone can count through every device of every client (S-06). UD-15 keeps a public page — a nurse, a patient or a visitor scanning a sticker should see that the device is calibrated — and ADR-138 decided its mechanism. This spec turns the ADR into build-ready rules: the table, the three staff routes, the one public route and its exact failure behaviour, the budget numbers, the setting, the fields, the page, the legacy-sticker boundary, the threats and the tests.

Personas: **provider staff, unbound** (issue, rotate, revoke a device's public link; print the sticker), **facility-bound staff** (never mint or revoke a public link; may read the page like anyone), **tenant administrator** (turns the page on or off), **anyone holding the sticker** (no account), **a scanner of random tokens** (the attacker of FT-106).

## 2. Already Decided (not re-decided here)

ADR-138 § 1 – 8: 128-bit CSPRNG token, 22 base64url characters, `https://<host>/d/<token>`; only SHA-256 stored in `public_device_tokens`; one active token per device; issuing over an active one revokes it in the same transaction; audited; unbound staff only; `GET /api/v1/public/devices/:token`, one reviewed exemption; the reviewed `skipTenantScope` on the token row only; one identical 404; its own budget, failures counting double; the per-tenant setting `public_device_page` (`off` default / `minimal` / `minimal_with_report`); the never-shown fields; `no-store`, `noindex`, `no-referrer`; the log carries `sha256(token)[0..8]`; no audit row per view; `/d/[token]` in `(public)`; legacy stickers do not reach this page.

## 3. Gaps Found and Decided Here (ADR-138 Amendment 1)

| # | Gap | Decision |
|---|---|---|
| G-1 | ADR § 1 names the gate `equipment` write; every device write in `calibrationDevices.route.ts` gates on **`calibration` write** | The staff routes gate on `dynamicAccess("calibration", "write")`: who may edit the device may sticker it. `equipment` is the attachments' menu, not the device's |
| G-2 | ADR § 8 / UD-16 branch (b) says "a rate-limited redirect to this page only for a device that already has a token". **Only the hash is stored**: the server cannot build `/d/<token>` from a legacy number. A number-keyed public view instead would revive the enumeration UD-15 ends | Branch (b) becomes: the old host's legacy path answers a **static, rate-limited "this sticker has been replaced" page** — no device data — with a link into the signed-in app's QR lookup. Nothing public is keyed by the number. § 11 |
| G-3 | "Same timing class": a known token whose page is hidden (setting off, facility ended, tenant suspended) costs more reads than an unknown one | Accepted and bounded: the extra reads happen only for a hash that exists, i.e. for someone holding a real sticker, who learns only that the page is unavailable — which the 404 says anyway. An unknown, malformed or revoked token costs exactly one indexed lookup; no secret-dependent comparison exists outside `timingSafeEqual`. No artificial delay |
| G-4 | ADR's status vocabulary (current / due soon / overdue / retired) does not cover `computeCalibrationDue`'s `requested` and `not_scheduled` | Public `calibrationStatus`: `current` (ok) · `due_soon` (due_soon **or** requested — an IPM asked for a calibration: the scanner should not treat it as current) · `overdue` · `retired` (device `status` retired) · `not_scheduled` (inactive, or no next date) |
| G-5 | `minimal_with_report` links to the IPM verification page, which shows the serial, the QR number and the signers' names | Accepted (ADR § 5: "shows only what verification shows"), and made explicit: the setting's UI text says the report link discloses what the printed report discloses. `minimal` discloses none of it |
| G-6 | Issue over an active token silently voids a printed sticker | Three routes, each refusing the wrong state with a 409: **issue** (409 `PUBLIC_TOKEN_ACTIVE` when one is active), **rotate** (409 `PUBLIC_TOKEN_NONE` when none is), **revoke** (409 `PUBLIC_TOKEN_NONE`). Rotation is an explicit act |
| G-7 | A soft-deleted device keeps a live token row; a reinstated device would silently re-publish | Deleting a device revokes its active token in the delete's transaction (reason `device_deleted`, audited with the delete). Reinstating does not re-issue: a new sticker is needed |
| G-8 | Rate-limit numbers left to P21-08 | Proposed in § 7; P21-08 sets them in `rateLimitConstants.ts` and records any change against the dry-run sticker count |
| G-9 | The token sits in the URL path: the backend access log, nginx's log and a `Referer` would carry it | Backend: the access/activity log writes the path with the token replaced by `~<hash8>`. nginx: the access log's request line has the token replaced by `~redacted` (nginx cannot hash; ADR-138 Am. 3 § 2; `deploy/compose/nginx`). `Referrer-Policy: no-referrer` on both the page and the API answer |

## 4. The Token

- **Mint:** `randomBytes(16).toString("base64url")` — exactly 22 characters of `[A-Za-z0-9_-]`. Shape check: `^[A-Za-z0-9_-]{22}$` (contract `PUBLIC_DEVICE_TOKEN`). Never from a body; never logged; returned **once**, in the issue / rotate answer.
- **Store:** `token_hash = sha256(token)` as 64 lower-case hex characters (`CHECK (token_hash ~ '^[0-9a-f]{64}$')`).
- **URL:** from configuration only — `PUBLIC_DEVICE_BASE_URL` (e.g. `https://kalibrasi.example/d`), else `${FRONTEND_URL}/d`; never from the request's `Host` (ADR-100, as `ipmVerifyUrl`).
- **Lookup:** hash the presented token, `findOne({ where: { tokenHash } , skipTenantScope: true, skipFacilityScope: true })`, then `timingSafeEqual` of the stored and computed hashes (defensive; the index lookup is the match).

## 5. The Table `public_device_tokens` (P21-08 migration — the next free number in `config/migrator.ts`)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | → tenants; stamped from the context (never the body) |
| `device_id` | uuid NOT NULL | → calibration_devices RESTRICT; a trigger refuses a device of another tenant |
| `token_hash` | char(64) NOT NULL | **UNIQUE, global** — the reviewed exception (ADR-138 § 2) |
| `created_by` | uuid NOT NULL | → users RESTRICT |
| `created_at` | timestamptz NOT NULL | |
| `revoked_at` | timestamptz NULL | |
| `revoked_by` | uuid NULL | → users RESTRICT (on `device_deleted`, the user who deleted the device) |
| `revoked_reason` | text NULL | `rotated` · `revoked` · `device_deleted`; CHECK: the revoke columns are set together or not at all; `revoked_by` may stay NULL only for `device_deleted` (a delete with no user actor) |

- **One active per device:** partial `UNIQUE (tenant_id, device_id) WHERE revoked_at IS NULL`. A race answers 23505 → 409 `PUBLIC_TOKEN_ACTIVE`.
- **Append-mostly:** a trigger refuses every UPDATE except setting the three revoke columns from NULL, and refuses DELETE. No soft delete (history is the audit trail).
- **Grants** (`callibrator_app`): SELECT, INSERT, UPDATE (`revoked_at`, `revoked_by`, `revoked_reason`); no DELETE. Tested as the application role.
- **Scope:** tenant-scoped (in the tenant hooks). **Not** facility-scoped: no bound principal reaches any route that reads it (§ 6), and the public read skips both dimensions by review. P21-08 records the classification wherever `facilityScopedModels.guard` asks for it.
- **Indexes live in the migration only** (ADR-100 Am. 3); the model declares none.

## 6. Staff Routes (unbound only)

All under `/api/v1/calibration-devices/:calibrationDeviceId/public-token`, each `auth, denyApiKey, validateUuid("calibrationDeviceId"), dynamicAccess("calibration", "write"), denyPlatformAuthoring`. None is on `FACILITY_ACCESSIBLE_ROUTES`, so a bound principal gets 403 `FACILITY_ROUTE_REFUSED` before the id is read (identical for any id, AM-12). Another tenant's or a deleted device: **404**.

| Route | Does | Answers |
|---|---|---|
| `GET …/public-token` | the link's state (gate `calibration` **read**) | `data: { active: boolean, issuedAt, issuedBy: PersonDisplay \| null, lastRevokedAt, setting: "off" \| "minimal" \| "minimal_with_report" }` — never the token or its hash |
| `POST …/public-token` | issue | 201 `data: { token, url, issuedAt }` · 409 `PUBLIC_TOKEN_ACTIVE` ("This device already has a public link. Rotate it to print a new sticker; the printed one will stop working.") |
| `POST …/public-token/rotate` | revoke the active one (`rotated`) and issue a new one, one transaction | 201 as issue · 409 `PUBLIC_TOKEN_NONE` |
| `DELETE …/public-token` | revoke (`revoked`) | 200 `data: { revokedAt }` · 409 `PUBLIC_TOKEN_NONE` |

- Each mutation locks the device row (`FOR UPDATE`), writes the token row and **one audit row in the same transaction**: `PUBLIC_DEVICE_TOKEN_ISSUED` / `_ROTATED` / `_REVOKED`, resource `CalibrationDevice` + id, details `{ tokenId, hashPrefix }` (8 hex) — never the token.
- Issuing is allowed while the setting is `off` (stickers are printed before the page is published); the answer's `url` is the same either way.
- The answer to issue / rotate carries `Cache-Control: no-store`.

## 7. The Public Route `GET /api/v1/public/devices/:token`

New router `routes/api/publicDevices.route.ts`, mounted at `/api/v1/public/devices`. Chain: `requestBudget("publicDevicePage")`, `requestBudget("publicDevicePageGlobal", { perAddress: false, keyOf: () => "all" })`, `validate(publicDeviceParams, { from: "params" })` — but a malformed token must answer **the same 404**, not a 400: the param schema is a plain string ≤ 2 048 (what a URL path carries); the shape check is in the service.

**Exemption** (`routeGateExemptions.ts`, `api/publicDevices.route.ts` → `GET /:token`): `kind: public`, reason "public capability page, UD-15 / ADR-138: a 128-bit token stored as its SHA-256 is the capability; one identical 404 for every failure; per-address and global request budgets; minimal fields by a per-tenant setting that is off by default". **Two-tenant guard:** the route is on `twoTenantRoutes.guard`'s reviewed allow-list as capability-token. **Skips:** `FACILITY_SCOPE_SKIPS["services/publicDevicePage.service.ts#resolveToken"]` with the reason, and the `skipTenantScope` named in the same comment.

**Order of work** (service `publicDevicePage.service.ts#readPublicDevice`):
1. Shape check → else 404.
2. Token row by hash, both scopes skipped; `revoked_at IS NULL` → else 404.
3. Tenant row: exists, not deleted, `isActiveTenantStatus` → else 404.
4. In `runForTenant(row.tenantId)`: the setting (`off` / unset / unparseable → 404, logged once per tenant as a warning when unparseable); the device (tenant hooks on; `isDeleted` → 404); its facility (`ended` → 404; `inactive` still shows — the device still hangs on a ward); the type, the last IPM, the calibration due.
5. Answer 200.

**One 404:** status 404, body `{ success: false, status: 404, code: "PUBLIC_DEVICE_NOT_FOUND", message: "No device answers to this link.", data: null }`, the same headers as a 200 (§ 8). Every 404 also counts against `publicDevicePageMiss` (ADR-100's pair, the `ipmSession.controller#verify` pattern) — "failures count double".

**Budgets** (`rateLimitConstants.ts`, production numbers; × 100 outside production):

| Key | Counts | Limit |
|---|---|---|
| `publicDevicePage` | every request, per client address | 120 / 15 min |
| `publicDevicePageMiss` | every 404, per client address | 30 / 15 min |
| `publicDevicePageGlobal` | every request, all addresses | 3 000 / 15 min |

Rationale: a ward behind one NAT scanning a few dozen stickers an hour stays far below 120; a random-token scanner hits the miss budget after 30 tries (2⁻¹²⁸ success each); the global ceiling bounds the database cost of a distributed scan. A 429 is the house envelope with `Retry-After`, naming no key.

## 8. The Answer

```json
{ "success": true, "status": 200, "message": "Public device page",
  "data": {
    "device": { "name": "Infusion Pump", "type": "Infusion pump", "manufacturer": "Maker", "model": "IP-1" },
    "facility": { "name": "Facility One" },
    "calibration": { "status": "current", "nextDueDate": "2027-03-01" },
    "lastIpmDate": "2026-09-14",
    "report": { "verifyUrl": "https://…/verify/ipm/IPM-F-0001-20260914-001?t=…" }
  } }
```

- `report` is present only under `minimal_with_report` and only when a submitted, non-voided, non-superseded session with a report number exists; else `null`.
- Dates are `YYYY-MM-DD` in the tenant's zone (`tenant_time_zone`, default Asia/Jakarta).
- `type` is the global catalogue's type name, or `null`.
- **Allow-list, not deny-list:** the service builds the object field by field. **Never present:** serial number, QR number, room / warehouse, photos, attachments, documents, any person's name, any id (device, tenant, facility, session, token), the tenant's name or code, the device's `status` beyond `retired`, remarks, vendor.
- **Headers (200 and 404):** `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`.
- **Logs:** path redacted to `/api/v1/public/devices/~<hash8>`; no audit row per view. A per-token daily counter is **not** built in P21-08 (optional in ADR § 6; deferred until a tenant report asks for it).

## 9. The Setting `public_device_page`

- Key in `tenant_settings`, added to `TENANT_ADMIN_SETTING_KEYS`; values `off` / `minimal` / `minimal_with_report` (anything else 400 naming the key); unset = `off`. Written through `PATCH /tenants/settings` (Management write, already audited in its transaction). No per-device override.
- Read by `publicDevicePageSettingOf(tenantId)` (one key of the token's own tenant; parsed; an unknown stored value reads as `off` — fail closed).
- The staff device page shows the current setting beside the token controls (G-5's warning on `minimal_with_report`).

## 10. The Page `/d/[token]` (P22-08)

- `frontend/src/app/(public)/d/[token]/page.tsx`: a **server component** that fetches the backend's public route per request (`cache: "no-store"`) with `backendForwardHeaders` (the client's address reaches the budget), and renders the answer as HTML — **readable without JavaScript**; no client island except the shared language form.
- Under the nonce CSP of the public root layout (ADR-131); one `<main>`; one `<h1>` — the device's name, or "Not found" / "Tidak ditemukan"; Indonesian by default, English by the language switch (`publicDevice.*` messages in both catalogues); theme tokens only (`pub-*`); status shown as a labelled badge with text (never colour alone).
- A 404 from the backend renders the not-found state and says only that no device answers to this link. A 429 renders "too many requests, try later". A backend failure renders a failed state with no detail. **As built (ADR-138 Am. 3 § 1): every outcome answers HTTP 200** — under Cache Components a dynamic route streams its shell before the read, so the status cannot change; the page is `noindex`, and the API's own answer is the 404.
- `next.config.ts` headers for `/d/:path*`: `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`. `robots.ts` disallows `/d/`; `sitemap.ts` never lists it.
- **Bundle budget:** `/d/[token]` in `bundle-budget.json` at the `/verify/*` figure (≤ 120 KB brotli first load).
- **Staff UI** (device detail, unbound users with `calibration` write): state, **Issue link**, **Rotate**, **Revoke** (each with a confirmation naming its effect), and on issue / rotate a **sticker dialog**: the QR rendered **in the browser** (the `qrcode` package already used by the PDF renderers) with the URL and the device's name, printable (`window.print()` on a print stylesheet) and downloadable as a PNG made in the browser — **nothing stored** (owner rule). Closing the dialog loses the token; the dialog says so. P27-03 owns the final sticker layout.

## 11. The Legacy-Sticker Boundary (UD-16; OA-4 chooses)

Legacy stickers never reach `/d/[token]` and never yield public device data.

| OA-4 finds | Branch | Behaviour | Built in |
|---|---|---|---|
| a **bare number** | (a) in-app lookup | Signed-in staff scan or type it; `GET /api/v1/calibration-devices/by-qr/:qrCode` resolves it in the caller's context, facility-scoped (FT-107: a bound user's lookup of another facility's QR → 404) | **built** (P21-02a, ADR-132); the scanner entry in P27-02 |
| a **URL on the old host** | (b) replaced-sticker notice (G-2) | The old host (while it lives) answers the legacy path with a static page: "This sticker has been replaced. Scan the new sticker, or ask the facility's staff." plus a link to the app's sign-in that returns to the QR lookup with the number pre-filled. Rate-limited; no lookup; the same page for every number | P27-02 |

The owner may revise G-2 (UD-16 is a working decision); OA-4 remains the owner's fact.

## 12. Threat Rows

| Id | Threat | Control | Test |
|---|---|---|---|
| FT-106 | a guessed token shows a device of any facility or tenant | 128-bit token; per-address + miss + global budgets; one 404 | `publicDevicePage.enumeration.p2108.test.ts`, `publicDevicePage.rateLimit.p2108.test.ts` |
| FT-107 | the legacy resolver crosses facilities | branch (a) in the caller's context; branch (b) carries no data | existing `by-qr` two-facility tests (P21-02a) |
| PD-1 | a database dump yields working URLs | hash only | `publicDeviceTokens.p2108.live.test.ts` (no clear column) |
| PD-2 | the 404 differs by cause (status, body, headers) and becomes an oracle | one constant body and header set for all seven causes | enumeration test compares bytes |
| PD-3 | a forbidden field leaks (serial, QR, room, name, id) | allow-list builder; exact key set | `publicDevicePage.fields.p2108.test.ts` (exact keys; no UUID pattern, no serial, no QR in the serialized body) |
| PD-4 | a bound user mints a public link for its facility's device | the route gate (not facility-accessible) | `publicDeviceTokens.twoFacility.p2108.test.ts` |
| PD-5 | another tenant's staff issue or revoke a token | tenant hooks; 404 | `publicDeviceTokens.twoTenant.p2108.test.ts` (`@two-tenant` markers) |
| PD-6 | the token leaks through logs or `Referer` | redacted paths; `no-referrer` | `publicDevicePage.headers.p2108.test.ts` |
| PD-7 | a cache or crawler keeps the page | `no-store`, `noindex`, `robots.ts` | headers test; frontend page test |
| PD-8 | a deleted then reinstated device re-publishes | revoke on delete (G-7) | `publicDeviceTokens.service.p2108.test.ts` |
| PD-9 | the table's history is rewritten | append-mostly trigger, grants | the live test, as `callibrator_app` |

`docs/SECURITY/15` EP-23 changes from "UD-15 / P12-06 open" to ADR-138 when P21-08 builds the control, with FT-106's residual and the test names above.

## 13. Test Plan

**Backend unit** (`backend/src/tests/…`, TypeScript, `memoryDb` + `twoTenantSuite` where routes): token mint shape and hash; issue / rotate / revoke state machine with the 409 codes; one audit row per mutation, in the transaction (a failed audit rolls the token back); delete revokes; the 404 for each of: malformed, unknown, revoked, deleted device, ended facility, suspended tenant, deleted tenant, setting off, setting unparseable — identical status, body and headers; retired device shown as `retired`; the status mapping of G-4; the exact field set under `minimal` and `minimal_with_report`; the budgets (per address, miss, global, 429 + `Retry-After`) with `RATE_LIMIT_NON_PRODUCTION_FACTOR=1`; the log redaction; the exemption and `FACILITY_SCOPE_SKIPS` entries hold (the existing guards).
**Backend live** (PostgreSQL 18, as `callibrator_app`): the migration up on an upgrade boot; the global unique hash; the partial unique (a second active row → 23505); the append-mostly trigger; the grants (DELETE refused); the cross-tenant device trigger.
**Frontend** (jest): the page renders 200 / 404 / 429 / failed states, one `<main>` and one `<h1>`, ID and EN; the staff panel's states and confirmations; the sticker dialog renders a QR without any network write; the existing `src/tests/guards`; `next build` + the bundle budget.
**Browser** (LINE C's automate suite, through the coordinator): issue a link, open `/d/<token>` signed out, see the minimal fields, revoke, see the 404.

## 14. Out of Scope

The sticker's print layout and the re-stickering policy (P27-03); the scanner entry and the old host's notice page (P27-02); a per-token view counter; any per-device visibility override.
