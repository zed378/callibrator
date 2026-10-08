# 02 — Screens and Roles (TARGET)

> **TARGET — nothing here is built.** Permission sources: ADR-102 (one effective permission), ADR-124
> Am. 1 and `MEMORY/specs/P18-03-facility-scope-permissions.md` (the bound menu ceiling, Matrix B; the
> facility-accessible routes, Matrix D), `MEMORY/specs/P18-01-02-role-matrix-and-grants.md` (grants,
> UD-4 (b)). This document **consumes** those decisions; it changes none of them.

---

## 1. The Rule That Decides What Anyone Sees

The app never decides permissions. On sign-in and on every foreground it reads
**`GET /api/v1/menu-groups/my-permissions`**. **As built** it answers `{ superAdmin, permissions }`
(`backend/src/services/menuGroup.service.ts#getMyPermissions`), where `permissions` is the **effective
permission** (role matrix ⊕ per-user override, ADR-102). **Target:** `facilityBound` in that answer and
the cap by `BOUND_MENU_CEILING` for a bound user (P18-03 § 5, § 13 — built by P21-09). It also reads
`POST /auth/verify` for the user and (**target**, P21-09 / AM-26) the scope fingerprint, and, for a bound
user, **`GET /client-facilities/mine`** (S-8 — **target**, P21-09; not built) for the facility it
is confined to.

| Rule | Meaning in the app |
|---|---|
| **Absent, not disabled** | a tab, a sidebar entry, a button or a screen whose slug/action the effective permission does not grant is not rendered (`docs/UI-UX/00` principle 2) |
| **No role names in screens** | screens test `canRead(slug)` / `canWrite(slug)` from the shared permission hook, never `role === "TECHNICIAN"` (`docs/FRONTEND/05-RBAC-IN-UI.md`) |
| **The bound route rule** (P18-03 § 13) | when `facilityBound`, a write action is hidden **also** when its route is not facility-accessible, even if the slug grants write — e.g. device delete, bulk import, every calibration-record write, every certificate write, IPM void. The list of hidden actions comes from one shared constant (`docs/SHARED/` — the route-marker mirror the web uses), never from a per-screen judgement |
| **The server decides anyway** | every route is gated server-side; a hidden button is a courtesy, not a control. A direct link to a hidden screen answers the "not available" screen; the API answers 403/404 |
| **Superadmin** | the platform operator works in the web app. **Not a mobile v1 audience** (`11` § 9; owner decision (C) 2026-10-08, Q-M6 decided, enforced server-side at native token issuance): a super admin signing in to the app is refused with "Use the web app for platform administration" |

**Not built yet (checked 2026-10-08):** every `/ipm/*` route (P21-03, P21-04), `/client-facilities/*` and the facility-accessible marker (P21-09), the by-QR lookup and device photo routes (P21-02), `view=field` (P21-02) and the IPM verification route (P21-04) named in this document are **TARGET** routes of the upstream build phases; the app screens that use them wait for those cards.

**Before any of this:** the install has exactly one tenant, chosen on the first-run tenant setup
screen (`11`); its branding (in-app logo, derived palette) and its sign-in methods apply from then on.
Platform super admins are **not** a v1 audience (`11` § 9).

## 2. Users and Their Screens

### 2.1 Field technician — provider `TECHNICIAN` (unbound) and facility `HEALTHCARE TECHNICIAN` (bound, "HT·b")

The main user and the reason the app exists: IPM capture and device registration, all day, often
offline.

| Screen | Purpose | Permission (slug · action) | Offline |
|---|---|---|---|
| Home | today: the outbox state, the due list for the chosen facility, open drafts, "to sign" list | `home` R | yes (from the working set) |
| Scan | camera QR → device; typed code always available | `calibration` R (N-13 by-QR lookup) | yes (working set) |
| Devices — list / detail | search, filter by room / due state / condition; identity, room, condition, last IPM, calibration due, photo completeness | `calibration` R (A-1) | yes (working set: the `view=field` summary) |
| Register device | P19-03 create form; **no QR field for a bound user** (ADR-132 § 1); room find-or-create (online only) | `calibration` W (A-2; HT·b subject to UD-4 (b), which ships as a working decision) | yes (queued) |
| Device photos | front and serial-plate photos (purpose), replace | `calibration` W (N-6) | yes (queued) |
| IPM capture | the stepper over the pinned checklist version; autosave locally; submit | `ipm` W (N-3) | **yes — the core offline flow** |
| IPM preview | the draft's report with the watermark "DRAFT — NOT A RECORD" | `ipm` R | yes |
| IPM sessions — list / detail / report | history per device, the issued report document | `ipm` R (N-2) | no (online) |
| Sign | performer signature after a synced submit, re-entered password (+ MFA per method) | `esignature` W — N-5 only | **no — never from the outbox** (P19-06) |
| Correct an IPM | new draft superseding a submitted one | `ipm` W (N-3) | online to start; the correction draft can be edited offline |
| Outbox / needs attention | per capture: state, last server explanation, actions | — (own data) | yes |
| Calibration status (read) | the device's calibration due and history | `calibration` R (A-4) | due state only, from the summary |
| Work orders (read) | orders on the device | `maintenance` R (A-8) | no |
| Notifications | own notifications | self (S-5) | no |
| Settings | offline mode, security (passkeys, MFA, my sessions), language, theme, about | self (S-1 … S-4) | partly |

**Not in the app for technicians:** IPM void (unbound tenant administrator only, ADR-126 § 3, and an
administrative act that belongs on the web), calibration-record entry (the quick external entry N-10
and full records are provider desk work — they stay on the web in the first release; a later card
may add them), certificate issuance.

**Unbound vs bound technician.** Same screens. The unbound technician picks the facility (or up to
three, `04` § 3) to work in and sees every facility of its tenant; the bound technician is confined to
its own facility, has no facility picker, no QR field, and sees provider staff only as redacted
snapshots (`…Display`, ADR-124 Am. 2 § 7).

### 2.2 Facility staff — bound `HEALTHCARE ADMIN`, `ROOM USER` (and an unbound self-served hospital's own staff)

Tracking, read-only in this group (P18-03 § 5.2: a bound `HEALTHCARE ADMIN` is read-only).

| Screen | Purpose | Permission | Offline |
|---|---|---|---|
| Home (facility) | the facility's devices by due state and condition, recent IPMs — built from the marked reads (A-1, N-2, N-9) until the metrics route is marked (A-10, OQ-8) | `home` R | no |
| Devices — list / detail | the facility's inventory | `calibration` R | no |
| IPM history and reports | sessions and their issued reports | `ipm` R | no |
| Certificates | the facility's certificates and their document | `certificate` R (A-7) | no |
| Work orders | read | `maintenance` R | no |
| Rooms | the facility's rooms | `warehouse` R (A-9) | no |
| Scan | QR → device detail (look-up only) | `calibration` R | no |
| Notifications, Settings | own | self | — |

Facility staff do **not** get offline mode (P19-08 and ADR-127 § 1 scope offline to field capture);
their data never rests on the phone beyond the screen in memory.

### 2.3 IPSRS — bound `FACILITY MAINTENANCE` (or unbound on a self-served tenant's own facility)

Everything in § 2.2, plus the **countersignature** list: "reports waiting for your countersignature"
(`ipm.countersignEnabled` tenant setting; `esignature` W reaching N-5 only; never the submitter's own,
P19-06 § 6). Online only.

### 2.4 Auditor — anyone holding a printed certificate or IPM report

An accreditation surveyor or a hospital auditor, **usually without an account**. The verification
screens are in the `(public)` group and need **no sign-in**:

| Screen | Reads | Notes |
|---|---|---|
| Verify — scan | the QR on a certificate or an IPM report | decodes the printed verification URL; opens the matching screen; a URL of another host is refused with "This code is not a Callibrator verification link" |
| Verify — certificate | the public certificate verification (ADR-100's routes) | the verdict component of `docs/UI-UX/10` § VerificationVerdict, held to the verification page's higher accessibility standard (`docs/UI-UX/17` § The Verification Page) |
| Verify — IPM report | `GET /api/v1/ipm/verify/:reportNumber?token=` (P19-06; the token is required) | the browser-side hash recomputation of the web page is reproduced with the shared `domain` canonical payload; a mismatch is shown as such, never hidden |

The same QR opens the **web** verification page on a phone without the app (the URL is the web page's;
app links hand it to the app when installed, `05` § 5). The app adds nothing to what the public page
discloses (ADR-100: the token holder holds the paper).

### 2.5 Managers — `CALIBRATOR ADMIN`, `ENGINEERING MANAGER`, `SUPERVISOR` (unbound); tenant administrators

Read dashboards on a phone or tablet; act on the web.

| Screen | Reads | Notes |
|---|---|---|
| Dashboard | the dashboard metrics (`GET /dashboard/metrics`, ADR-120's cached aggregates), IPM due counts (N-9), condition widgets, technician activity (N-8), calibration due | tablet: a multi-pane grid (`03` § 6); phone: a vertical stack, headline figures first ("state before decoration", `docs/UI-UX/00`) |
| Devices, IPM, certificates, work orders | as § 2.2, across every facility of the tenant | facility filter |
| Outbox of others | **no** — a manager never sees another user's unsynced captures | the field wipe (`04` § 10.3) is a tenant administrator's act on the phone itself |
| Field data wipe | on a shared phone, wipe another user's offline data (audited, `POST /field/wipes`) | unbound tenant administrator only (`rbac([TENANT_ADMIN])`) |

Administration (users, roles, facilities and bindings, settings, SSO, API keys, billing, audit) is
**not in the app**. A manager who needs it opens the web app; the app's "Open in browser" link is a
plain link to the web route, never an embedded web view of the dashboard (an embedded web view would
need the web session, which the app does not hold, ADR-059).

## 3. The Bound Permission Ceiling, as the App Sees It

Restated from P18-03 Matrix B for the screens above (R read, W write, — none). The app reads the
**result** from `my-permissions`; this table is for reviewers, not for code.

| Slug | HA·b | HT·b | FM·b | RU·b | App surfaces |
|---|---|---|---|---|---|
| `home`, `dashboard` | R | R | R | R | Home (facility home until A-10 is marked) |
| `profile-page`, `change-password` | W | W | W | W | Settings → profile, password |
| `equipment` | R | R | R | R | attachment reads (device photos) |
| `calibration` | R | **W** (UD-4 (b)) | R | R | Devices, Register, Photos (HT·b only) |
| `certificate` | R | R | R | R | Certificates (read, document) |
| `maintenance` | R | R | R | R | Work orders (read) |
| `ipm` | R | **W** | R | R | IPM capture (HT·b), history, reports |
| `ipm-templates` | R | R | R | R | the published checklist (download for capture) |
| `esignature` | — | **W** (N-5) | **W** (N-5) | — | Sign (performer / countersign) |
| `warehouse` | R | R | R | R | Rooms; room pick in Register |
| everything else | — | — | — | — | absent |

**Consequences the app must show honestly:**

- A bound technician without `calibration` W (if UD-4 (b) is ever revised) sees no Register button —
  and the device's IPM can still be captured if the device exists.
- A device registered by a bound technician has **no QR** until provider staff attach one (ADR-132
  implication); the device detail says "QR sticker not assigned yet — ask your provider", and the
  capture can start from the device list instead of a scan.
- A bound user's own facility leaving `active` or a binding change revokes the user's sessions
  (AM-1): the app returns to sign-in with the reason (`01` § 5) and purges the working set (`04` § 8).

## 4. Navigation Map

### 4.1 Phone — bottom tabs (at most five, per platform convention)

| Tab | Technician | Facility staff / IPSRS | Manager | Auditor (signed out) |
|---|---|---|---|---|
| 1 | Home | Home | Dashboard | — |
| 2 | Devices | Devices | Devices | — |
| 3 | **Scan** (centre, prominent) | Scan | Scan | Verify (the only screen) |
| 4 | IPM | IPM | IPM | — |
| 5 | More (outbox, certificates, work orders, notifications, settings) | More (certificates, work orders, rooms, notifications, settings; countersign for FM) | More | — |

A tab whose slug the user lacks is absent (a manager without `ipm` R has four tabs). The outbox count
is a badge on Home and on More → Outbox **on every screen's header while offline mode is on** (ADR-127
§ 7's rule, native form). Android back and iOS swipe-back follow the platform: back pops the stack of
the current tab; at a tab root, Android back exits (never a custom "press again to exit" trap).

### 4.2 Tablet — sidebar

The same destinations as a vertical sidebar (`03` § 3): Home/Dashboard, Devices, Scan, IPM,
Certificates, Work orders, Rooms (bound), Outbox, Notifications, Settings — grouped as the web's
sidebar groups them, collapsed to a rail at the medium window class. Master-detail panes replace the
phone's push navigation where `03` § 4 says so.

### 4.3 Entry points from outside

| Entry | Lands on | Rule |
|---|---|---|
| **First run** (no stored tenant) | on a build without a compiled default server, or when MDM gives none: the **server screen first** (`08` § 6); then **tenant setup** (`11`): org code, setup QR, or the work-email code lookup; MDM may pre-fill and lock both | sign-in is reachable only after a tenant is set; verify is reachable without one |
| App link / QR `/m/setup?org=<code>` | tenant setup with the code pre-filled; the user confirms the resolved name and logo | refused while someone is signed in to another tenant (switching rules, `11` § 6) |
| App link `/verify/...` | the public verify screen | no sign-in needed |
| Push notification tap | the notification's target screen, after unlock | the push carries only an opaque id (`05` § 3); the app fetches the notification and checks the screen is reachable; otherwise the notifications list |
| SSO return `/m/sso-return` ([`20`](./20-BACKEND-FOR-MOBILE-NODE.md) § 7) | completes sign-in | `06` § 3 |
| A device QR scanned by the phone's own camera app | the web device page (P21-08 public device page), or the app's device screen when installed and signed in | the device page URL is the web's; the app link opens the app; a signed-out app shows only what the public page shows |
