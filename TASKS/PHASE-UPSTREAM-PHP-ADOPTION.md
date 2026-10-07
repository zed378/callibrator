# Upstream PHP Feature Adoption — SKP IPM (`apps-ipm`, CodeIgniter 4) into Callibrator

> **Ringkasan (Bahasa Indonesia).** Fase ini memindahkan fitur dan data aplikasi upstream **SKP IPM**
> (inventaris alat kesehatan + **IPM**, Inspeksi dan Pemeliharaan Preventif, untuk satu penyedia
> jasa yang melayani 118 faskes) ke Callibrator. **Riset selesai 2026-10-07** (kode, struktur
> database, modul, fitur — `docs/UPSTREAM/00…05`). Rencana ini menggabungkan fase usulan agen kode
> (UP-00…UP-19) dan agen database (UP-DB-1…9) menjadi **20 fase** dengan kartu kerja `UP-xx-yy`.
> **Pemilik sudah memutuskan empat hal (2026-10-07):** (1) setiap faskes = tenant rumah sakit
> sendiri, SKP = tenant penyedia, teknisi SKP bekerja lewat **hak akses per faskes** yang dapat
> dicabut dan diaudit, dengan pengalih "faskes aktif" — perlu ADR baru yang mengubah ADR-084
> sebelum dibangun; (2) **banyak IPM per alat**, riwayat lengkap, koreksi/void tanpa menghapus;
> aturan upstream "satu per bulan, simpan ulang = hapus" **tidak** dipakai; (3) pengambilan data
> lapangan lewat **PWA dengan mode offline** (kamera untuk foto/QR, sinkronisasi), tanpa aplikasi
> native; (4) **satu katalog global berversi** untuk jenis alat dan template ceklis — perlu ADR
> untuk tabel tanpa `tenant_id`. **Implementasi masih menunggu** ADR tersebut dan keputusan pemilik
> yang tersisa (tabel di bawah), serta tindakan pemilik di luar kode: **rotasi kata sandi DB dan
> JWT secret upstream**, menutup registrasi/mode development/`info.php`/rute QR & PDF publik di
> situs upstream, enkripsi lalu penghapusan salinan lokal `mozivid/`, memindai satu stiker QR fisik,
> dan dasar hukum (UU PDP) per faskes. Volume: ±384 ribu baris, **±110 GB berkas** yang dipindah
> (dari 116 GB).

| | |
|---|---|
| **Status** | **Research DONE 2026-10-07** (UP-01 … UP-04). **Plan written 2026-10-07** (this file). **Four owner decisions taken 2026-10-07** (UD-1, UD-3, UD-6, UD-14). **Implementation BLOCKED**: on the ADRs those decisions require (UP-00-02 … UP-00-05), on the open owner decisions below, and on the owner actions outside the codebase |
| **Roadmap position** | Phase 9 → **Upstream PHP Feature Adoption** → Phase 999 (`docs/PLAN/16-IMPLEMENTATION-ROADMAP.md`, ADR-089). Phase 999 stays blocked until this phase exits |
| **Backlog** | `TASKS/BACKLOG.md` Q-57 (the upstream is identified) |
| **Research** | [`docs/UPSTREAM/`](../docs/UPSTREAM/README.md): 00 overview (§ 9 security S-01…S-18, § 10 tenancy, § 11 drift D-01…D-13), 01 modules M01…M15, 02 features F-01…F-81, 03 database (Q-1…Q-28), 04 schema mapping (§ 9 decisions D-1…D-11, § 12 DB phases), 05 data migration |
| **Records** | [`2026-10-07-upstream-code-research.md`](../MEMORY/records/2026-10-07-upstream-code-research.md) · [`2026-10-07-upstream-database-research.md`](../MEMORY/records/2026-10-07-upstream-database-research.md) |
| **Source** | `mozivid/` (gitignored, read-only, **real personal data** — never committed, never copied into the repository) |

**Privacy rule for every card in this phase.** No real data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository: not in code, fixtures,
tests, docs, records, logs or screenshots. Fixtures are synthetic; reports are aggregates; real
data is touched only in throwaway containers bound to `127.0.0.1` and removed by name afterwards.

---

## 1. How the Two Draft Phase Lists Were Merged

The code agent's draft (00 § Phases, UP-00 … UP-19) is kept as the spine and **its ids are kept**,
so every reference already written in `docs/UPSTREAM/` stays valid. The DB agent's UP-DB-1 … 9
(04 § 12) fold into it with no duplicate phase:

| DB phase (04 § 12) | Merged into | Note |
|---|---|---|
| UP-DB-1 Structure research | **UP-02** | DONE |
| UP-DB-2 Decisions | **UP-00** | D-1 … D-11 are in the consolidated table (§ 3) |
| UP-DB-3 Schema migration design → spec | **UP-07** (cards UP-07-01 … 03, 08) | specs in `MEMORY/specs/` |
| UP-DB-4 Migration implementation | **UP-08** | migrations 0111 … 0118 as proposed in 04 § 11 (renumber at implementation) |
| UP-DB-5 ETL tool | **UP-12** (UP-12-01 … 04) | |
| UP-DB-6 ETL dry run | **UP-12** (UP-12-05) | |
| UP-DB-7 Reconciliation and sign-off | **UP-13** | |
| UP-DB-8 Cutover | **UP-18** | |
| UP-DB-9 Decommission | **UP-19** | |

The phases the owner asked for by name are UP-01 *code research*, UP-02 *DB-structure research*,
UP-03 *module research*, UP-04 *feature research*, UP-08 *DB-structure migration to our conventions*,
UP-09 *backend implementation* and UP-10 *frontend implementation*. The others were added by the
research.

## 2. The Phase List (ordered)

IDs are in dependency order except UP-15 and UP-16, whose decision parts run early (UP-16's
decision is taken; UP-15 waits on a sticker scan) and whose build parts land with UP-10.
Sizes: **S** ≤ 2 days · **M** ≤ 1 week · **L** > 1 week (one developer, tests included), as in 02.

| # | Phase | Goal | Cards | Status | Depends on | Size |
|---|---|---|---:|---|---|---|
| UP-00 | **Decisions & ADRs** | Settle what blocks design; write the ADRs the decisions need | 7 | WIP: 4 decisions taken, ADRs to write, 14 decisions open | — | S (+ owner time) |
| UP-01 | **Code research** | Understand the upstream code | 1 | **DONE 2026-10-07** | — | — |
| UP-02 | **DB-structure research** | Understand schema, data, files | 1 | **DONE 2026-10-07** | — | — |
| UP-03 | **Module research** | Group code into modules, map to ours | 1 | **DONE 2026-10-07** | UP-01 | — |
| UP-04 | **Feature research** | Feature-level gap list with implementation notes | 1 | **DONE 2026-10-07** | UP-03 | — |
| UP-05 | **Security, privacy & data protection** | DPIA (UU PDP 27/2022, GDPR posture), legal basis, minimisation, file policy, threat model of the new surfaces | 7 | TODO (3) / BLOCKED (4) | UP-00 | M |
| UP-06 | **Role & permission mapping** | 4 groups + IPSRS → our roles, slugs, grant scopes, two-tenant test plan | 4 | BLOCKED on UP-00-02 and UD-4 | UP-00 | S |
| UP-07 | **Domain design** | Specs for catalogue, IPM aggregate, device extensions, access grants, calibration dates, IPM report, public page | 8 | BLOCKED on the ADRs and open decisions | UP-00, UP-06 | L |
| UP-08 | **DB-structure migration to our conventions** | Models + forward migrations in our conventions | 9 | BLOCKED | UP-07 | M |
| UP-09 | **Backend implementation** | Services, routes, Zod contracts, OpenAPI, gates, audit, two-tenant tests | 10 | BLOCKED | UP-08 | L |
| UP-10 | **Frontend implementation** | Pages, PWA field capture with offline mode | 10 | BLOCKED | UP-09 | L |
| UP-11 | **Report & PDF parity** | IPM report, inventory PDF/XLSX, 5 calibration recaps: field parity plus our numbering, QR verification, signatures | 5 | TODO (1) / BLOCKED (4) | UP-09 | M |
| UP-12 | **Data ETL (incl. ~110 GB of files)** | Extract → stage → transform → load per tenant; file pipeline; dry run | 5 | BLOCKED | UP-08, UP-05 | L |
| UP-13 | **Reconciliation & parity verification** | Prove the migrated data equals the source, per tenant | 4 | BLOCKED | UP-12 | M |
| UP-14 | **UAT with real users** | Provider technicians in the field, facility admins, IPSRS | 3 | BLOCKED | UP-10, UP-13 | M |
| UP-15 | **QR sticker continuity** | Existing stickers keep resolving; new stickers carry a capability token | 4 | BLOCKED on OA-4 (scan a sticker) and UD-15 | UP-07, UP-10 | S–M |
| UP-16 | **Mobile / offline decision** | PWA vs native; APK retirement | 3 | Decision **DONE** (UD-14: PWA with offline mode); ADR TODO | UP-00 | S (decision) |
| UP-17 | **Training & documentation in Indonesian** | User guides, "what changed", as-built docs | 4 | BLOCKED | UP-14 | M |
| UP-18 | **Cutover & dual-run** | Freeze, final delta, invitations, read-only upstream, go/no-go | 5 | BLOCKED | UP-13, UP-14, UP-15 | M |
| UP-19 | **Decommission & archive** | Encrypted archive, drop import schema, revoke, delete copies | 4 | BLOCKED | UP-18 | S |
| | **Total** | | **96** | 5 DONE (UP-01-01 … UP-04-01, UP-16-01) · 9 TODO · 1 WIP · 81 BLOCKED | | |

**Build order inside UP-08 … UP-10 (thin vertical slices, from 00 § Phases):** catalogue & templates
→ device extensions (QR, photos, condition) → IPM capture → IPM report → calibration-date entry &
recaps → inventory exports → dashboard condition widgets → public device page → provider access
grants and the "active facility" switch → offline capture. The access-grant slice is the largest
and riskiest; it may run in parallel from UP-07-04 on, but **no provider user writes in a hospital
tenant before UP-09-09 is DONE** (the interim ETL path in 04 § 3 needs no provider write).

### Phase-wide Definition of Done (every implementation card UP-08 … UP-19 inherits it)

Added to the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md), not instead of it:

- [ ] **Tenant isolation:** every tenant-owned table has `tenant_id` NOT NULL and is scoped by the
      hooks (deny-by-default); `tenantId` never read from a body (upstream S-05/S-11 not ported);
      uniqueness per tenant only (QR, serial); composite `(tenant_id, …)` FKs where 04 § 4.8–4.9 says;
      global tables (catalogue) listed in `unscopedModels.d17` with the ADR as reason
- [ ] **Two-tenant tests:** every new `:id` route has a `twoTenantSuite` + `memoryDb` test asserting
      **404**, marked `@two-tenant`, and `twoTenantRoutes.guard` passes; access-grant routes add the
      negative cases (member of A not B, revoked, ended, wrong scope → 404)
- [ ] **Audit:** every mutation (including corrections, voids, grant changes, the active-facility
      switch, every import batch) writes its audit row inside its transaction; a rolled-back action
      leaves none
- [ ] **Contracts:** Zod schemas in `@callibrator/contracts` (new unions in `contracts/states`:
      `INSPECTION_SECTIONS`, `INSPECTION_OUTCOMES`, `INSPECTION_RECOMMENDATIONS`,
      `INSPECTION_SESSION_STATUSES`, and the grant statuses), `validate(schema, { from })`; a
      `*.openapi.ts` per route; `openapi:check` current; `openapi:breaking` recorded where it fails
- [ ] **Gates:** every route behind `dynamicAccess` (`equipment`, `ipm`, `ipm-templates`, reports)
      or on the reviewed exemption list (the public capability page only); `routePermissionGuard.p604` green
- [ ] **Status codes:** 400 validation · 403 own-tenant permission · 404 cross-tenant · **409 with a
      state explanation** (a correction of a voided session, a submit of a submitted one)
- [ ] **Frontend:** strings in `id.ts` **and** `en.ts`; warm-palette theme tokens only (ADR-122
      colour guard green); status through the status-tone registry; one `<main>`/`<h1>`; nonce CSP;
      field screens mobile-first; accessibility suite green in light and dark
- [ ] **Traps checked:** includes of `performer`/`User`/`CalibrationDevice` with `required: false`;
      no model index on a migration-added column (ADR-100 Am. 3); no named export beside `export =`
- [ ] **Live verification:** a live E2E spec per new page flow and a live API smoke of every new
      route on a running stack — mocks do not count; migrations proved with `make migrate-verify`
      and `upgradeBoot.am3.live`
- [ ] **Privacy:** no real upstream value in any test, fixture, log, record or screenshot

---

## 3. Decisions Needed From the Owner (consolidated)

The code agent's six items (record "Needs the owner" 1–6) and the DB agent's D-1 … D-11 (04 § 9)
merged into one list. Items marked ★ were put to the owner first by the coordinator on 2026-10-07;
four of them are answered. Items that are facts only the owner can obtain (secret rotation, the
sticker scan, contracts) are **owner actions** (§ 4), cross-referenced here.

| # | Decision | Cross-refs | Recommendation | Consequence | Blocks | State |
|---|---|---|---|---|---|---|
| **UD-1** ★ | Tenancy model for a provider serving many facilities | D-1 · code #1 · 00 § 10 · 04 § 3 · F-17, F-26 · ADR-084 | Each facility = its own hospital tenant; the provider = a provider tenant; provider staff act through a revocable, audited **per-facility access grant** with an "active facility" switch (every request still runs inside exactly one tenant) | the first cross-tenant working path in the system: a new ADR **amending ADR-084** before any build; auth/session/socket/audit/rate-limit work (L); a security review and two-tenant negatives on every grant path | UP-06, UP-07, UP-08-07, UP-09-09, UP-10-09, UP-12, UP-18 | **DECIDED (owner, 2026-10-07)** as recommended. ADR → UP-00-02 |
| **UD-2** | Scope of adoption | 02 tally · 01 summary | Adopt every Exists/Partial/Missing feature (76 of 81); not adopted: F-03, F-05, F-77, F-80, F-81; three unsafe behaviours replaced (guessable public access, delete-and-reinsert, attribution from the body) | fixes the size of UP-09/UP-10; anything dropped later needs a recorded decision | UP-07 … UP-11 | open |
| **UD-3** ★ | Device types and checklist templates: platform-global or provider-owned | D-2 · F-19 … F-22 · 04 § 4.3–4.5 | One **global, versioned** catalogue maintained by the platform/provider, like `roles` | tables without `tenant_id` need an ADR reason and `unscopedModels.d17` entries; versioning means sessions reference the version used (02 F-20) — 04's schema gains a version dimension in UP-07-01; who may publish a version (super admin; provider proposes) is part of that ADR | UP-07-01, UP-08-01/03, UP-09-01, UP-10-01, UP-12 | **DECIDED (owner, 2026-10-07)**. ADR → UP-00-03 |
| **UD-4** | Role of upstream `client` accounts (and naming the person behind shared accounts) | D-3 · 01 role mapping · 04 § 6 · 05 § 5 | First account per tenant `HEALTHCARE ADMIN`, others `ROOM USER`; `teknisi_client` → `HEALTHCARE TECHNICIAN`; `admin`/`user` → `CALIBRATOR ADMIN`/`TECHNICIAN` in the provider tenant; the operator names the real person behind each shared account at invitation | hospital staff privilege level; 21 CFR Part 11 attributability of shared accounts | UP-06-01, UP-12-02 | open |
| **UD-5** | Passwords of imported users | D-4 · F-01 · 05 § 5 | Do **not** import hashes; unusable random hash + forced set via the single-use invitation | every upstream user re-registers their password once (~105 e-mails); no second password path in `auth.service` | UP-12-02, UP-18-04 | open |
| **UD-6** ★ | Many IPM sessions per device, or upstream's one-per-month-with-replacement | code #4 · F-55, F-56 · drift D-07 · 03 § 4.6 | Many per device, full history; corrections and voids through our correction/void pattern; nothing deleted | upstream's month-replace is **not** kept; a monthly schedule may flag a device "due"; technicians must learn "correct, don't overwrite" (UP-17) | UP-07-02, UP-08-04/05, UP-09-03, UP-10-03/04 | **DECIDED (owner, 2026-10-07)**. Recorded in the ADR of UP-00-04 |
| **UD-7** | Timezone of upstream `DATETIME` values | D-6 · 03 § 8.4 · 05 § 3.4 | Verify per table with the operator on 3–5 events of known local time (OA-6); default `Asia/Jakarta` | a 7-hour error moves sessions across dates and corrupts the session key | UP-12-02, UP-12-05 | open |
| **UD-8** | Meaning of `trx_inventory.tgl_kalibrasi` and the calibration interval | D-7 · Q-11 · F-62 … F-64 | SME answer (OA-7); until then import only `trx_kalibrasi` as records and set no `next_calibration_date` | regulatory dates on 23 k devices; due-date reminders stay off for imported devices until answered | UP-07-05, UP-12-02 | open |
| **UD-9** | Duplicate serials inside a tenant (624 groups) | D-5 · Q-18 · F-24 | Keep the serial on the oldest device of each group, NULL on the others, original in `id_map`, listed in the per-tenant data-quality report | visible device data changes; keeps `UNIQUE (tenant_id, serial_number)` | UP-12-02, UP-13-02 | open |
| **UD-10** | Rooms and the district-office → health-centre structure | D-8 · F-18 · 00 § 1 | Rooms as `warehouses` (locations) after a cleaning pass; a district office's centres as locations inside its tenant, not child tenants (ADR-084 gives a parent no visibility) | product vocabulary ("warehouse" for a ward) in the UI; ~3,099 raw room pairs to clean | UP-07-03, UP-12-02 | open |
| **UD-11** | Which facilities become tenants; their contact e-mail; commercial plan | D-9 · 04 § 3 | All with devices (114); e-mail from the client account, or provided by the operator (OA-8); plan/limits set by the operator | onboarding effort for 63 facilities with no client account | UP-12-02, UP-18-04 | open |
| **UD-12** | A `maintenance_work_orders` row per imported session | D-10 · F-48 | No for history; yes for future IPM (a Preventative work order linked to the session) | reporting expectations of maintenance lists | UP-07-02, UP-12-02 | open |
| **UD-13** | Audit granularity of the import | D-11 · 04 § 7 | One audit row per imported business row (~330 k) | cost vs per-record provenance | UP-12-02 | open |
| **UD-14** ★ | Field capture: native app or PWA | code #5 · UP-16 · F-77 … F-79 · M14 | PWA with offline mode: offline capture + sync, camera for photos and QR; no native app | the APK is retired at cutover; a service worker and an IndexedDB queue under our nonce CSP; idempotency keys on the capture endpoints; conflict = 409 with explanation | UP-09-03, UP-10-03/10, UP-16-02/03 | **DECIDED (owner, 2026-10-07)**. ADR → UP-16-02 |
| **UD-15** | What the public device page shows | F-74, F-75 · S-06 · M13 | Capability-token page (≥ 128-bit, revocable), per-tenant setting; default: identity + calibration status + last IPM date; photos and documents off | patients/visitors scanning a sticker see less than upstream showed; nothing reachable by a sequential number | UP-07-07, UP-09-08, UP-10-08, UP-15 | open |
| **UD-16** | How legacy stickers resolve | F-76 · UP-15 · OA-4 | If they encode a URL on the old host: a rate-limited redirect to the minimal public view; if only the number: in-app lookup by QR for signed-in technicians | keeps the old host name alive (or not) after decommission | UP-15-02, UP-19-02 | open — needs OA-4 first |
| **UD-17** | IPM business rules: recommendation side effects and the IPSRS countersignature | F-51, F-61 · drift D-04 | `needs_repair` → Repair work order; `not_fit_for_use` → device status `maintenance`; `needs_calibration` → scheduler flag; each audited in the same transaction. IPSRS (`FACILITY MAINTENANCE`) countersigns electronically, per-tenant setting | automatic status changes on hospital devices; IPSRS accounts needed in every facility that enables countersigning | UP-07-02/06, UP-09-04, UP-11-02 | open |
| **UD-18** | Legal basis, contracts and retention | code #6 · UP-05 · 05 § 10 · OA-5 | DPA between operator and platform; operator confirms its client contracts permit the transfer; facilities informed before cutover; storage in an Indonesian region or the self-hosted store; `upstream_import` kept until sign-off + 90 days; upstream archive kept per the operator's retention schedule | without it no real-data dry run (UP-12-05), no cutover, no decommission date | UP-05-03, UP-12-03/05, UP-18, UP-19 | open |

Design questions that are **ours** (taken by ADR in UP-07, not put to the owner): template version
model (UD-3 fixed that there *is* versioning); condition vocabulary (a `condition` column vs 04's
mapping onto `status`, 02 F-24 vs 04 § 4.2); QR uniqueness scope (04: per tenant); electrical-safety
pass/fail computation (02 F-42, new behaviour); HEIC/derivative policy (05 § 6.2).

## 4. Owner Actions Outside the Codebase

None of these is a code change; each is a precondition named by a card.

| # | Action | Why | Card waiting on it |
|---|---|---|---|
| **OA-1** | **Rotate the upstream database password and `JWT_SECRET`** | both sit in a plain file in the fork (S-01); once a copy circulates they are disclosed | UP-05-01 |
| **OA-2** | On the live upstream: **close open registration** (S-04), switch off **development mode** (S-02), **delete `info.php`** (S-03), put the **public QR, IPM and PDF routes** behind login or remove them (S-06). Advised as well: remove the `recall` debug route (S-12) and the APK/operator files from `public/` (S-13), enable CSRF (S-09) | today a self-registered account downloads any facility's inventory, and anyone reads IPM reports by sequential number | UP-05-01 |
| **OA-3** | **Encrypt the local `mozivid/` copy at rest** (36 dumps + 116 GB), keep it gitignored, and **delete it after cutover** | real personal data on a workstation (05 § 10) | UP-05-01, UP-19-03 |
| **OA-4** | **Scan one physical QR sticker** and report what it encodes (bare number, or a URL — which host) | decides UD-16 and the redirect design | UP-15-01 |
| **OA-5** | **Legal basis and contracts per facility**: a DPA operator ↔ platform; confirmation the operator's client contracts allow the transfer; facilities informed | UU PDP 27/2022 (UD-18) | UP-05-03 |
| OA-6 | Give 3–5 events whose real local time is known (with the operator) | UD-7 | UP-12-05 |
| OA-7 | SME answer on the meaning of the device's typed calibration date and the interval | UD-8 | UP-07-05 |
| OA-8 | Contact e-mails for facilities without a client account; the real person behind each shared account | UD-4, UD-11 | UP-12-02, UP-18-04 |

---

## 5. Cards

Statuses as in `00-TASK-CONVENTIONS.md`. **Spec refs** use `00 §`, `02 F-`, `03 Q-`, `04 §`, `05 §`
for the files in `docs/UPSTREAM/`. A card marked *spec required* writes `MEMORY/specs/<card>-<slug>.md` first.

### UP-00 — Decisions & ADRs

**Goal:** no design or build starts on an unrecorded decision. **Spec refs:** § 3 above · 00 § 10 ·
04 § 9 · ADR-084 · ADR-064 · `docs/PLAN/10-TENANCY-AND-ONBOARDING.md`. **Size:** S.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-00-01 | Put the consolidated decisions to the owner; record each answer here with date | **WIP** — UD-1, UD-3, UD-6, UD-14 answered 2026-10-07; 14 open | — |
| UP-00-02 | ADR: facility = tenant, provider tenant, per-facility access grant (`service_engagements` and how a user acts in one), "active facility" switch — **amends ADR-084** | TODO (unblocked by UD-1) | UD-1 |
| UP-00-03 | ADR: global versioned inspection catalogue without `tenant_id` (who writes, who publishes, how sessions pin a version) | TODO (unblocked by UD-3) | UD-3 |
| UP-00-04 | ADR: an IPM session is an issued record — many per device, draft → submitted, correction supersedes, void, results immutable after submit; the "due" flag replaces the month rule | TODO (unblocked by UD-6) | UD-6 |
| UP-00-05 | ADR: imported identities — invitation, no hash import, performer snapshots for deleted users | BLOCKED | UD-4, UD-5 |
| UP-00-06 | ADR: public device page by capability token (exemption-list reason, rate limit, tenant setting) | BLOCKED | UD-15 |
| UP-00-07 | Carry every unanswered decision as a dated Open Question under Q-57 in `TASKS/BACKLOG.md` | TODO | UP-00-01 |

**DoD:** every ADR has decision, rationale, alternatives (04 § 3 options A/B/C; 00 § 10 options 1–3)
and bad implications; `docs/` amendments named (SECURITY/05, MULTI-TENANCY, DATABASE/00) through the
deviation protocol; § 3 shows every answer with its date. **Abuse case:** starting UP-08 because "the
owner already said yes" — the decision is not the ADR.

### UP-01 — Code research · UP-02 — DB-structure research · UP-03 — Module research · UP-04 — Feature research

| Card | Title | Status | Output |
|---|---|---|---|
| UP-01-01 | Upstream code: stack, routes, auth, API, reports, uploads, security S-01…S-18, drift D-01…D-13 | **DONE 2026-10-07** | 00 · [record](../MEMORY/records/2026-10-07-upstream-code-research.md) |
| UP-02-01 | Upstream database: 52 tables, counts, quality Q-1…Q-28, files, privacy classes; schema mapping and ETL plan (= UP-DB-1) | **DONE 2026-10-07** | 03, 04, 05 · [record](../MEMORY/records/2026-10-07-upstream-database-research.md) |
| UP-03-01 | 15 modules M01…M15 mapped (Exists 3 · Partial 8 · Missing 2 · N/A 2); draft role map | **DONE 2026-10-07** | 01 |
| UP-04-01 | 81 features F-01…F-81 (Exists 17 · Partial 29 · Missing 30 · N/A 5) with implementation notes; table names reconciled to 04 on 2026-10-07 | **DONE 2026-10-07** | 02 |

Evidence and what was **not** run (no `make verify`, no real-data load into PostgreSQL, no EXIF
read, no live-site test) are in the two records.

### UP-05 — Security, privacy & data protection

**Goal:** nothing leaves the owner's machine, and nothing is built, without a lawful basis, a DPIA
and a threat model. **Spec refs:** 00 § 9 (S-01…S-18) · 03 § 9 · 05 § 10 · docs/SECURITY/05 ·
`docs/SECURITY/` GDPR documents · UD-18. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-05-01 | Upstream hardening advice handed over and its execution confirmed by the owner (OA-1, OA-2, OA-3) | BLOCKED (owner) | OA-1 … OA-3 |
| UP-05-02 | DPIA under UU PDP 27/2022 (+ GDPR posture): data inventory from 03 § 9, flows, controller/processor roles, risks, mitigations | TODO | — |
| UP-05-03 | Legal basis and DPA; facility notification text (ID); residency choice | BLOCKED | UD-18, OA-5 |
| UP-05-04 | Minimisation list: migrated / archived / destroyed, per table and per file class (05 § 10) | TODO | — |
| UP-05-05 | File policy: content allow-list, ClamAV, SHA-256, derivatives stripping EXIF, originals only by signed download; an aggregate-only EXIF survey (tag presence counts, no values) | TODO | — |
| UP-05-06 | Threat model of the new surfaces: access grants and the active-facility switch, public capability page, offline queue, import tooling | BLOCKED | UP-00-02 |
| UP-05-07 | Security review before go/no-go: penetration test of grants, public page and PWA sync; findings closed | BLOCKED | UP-09, UP-10 |

**DoD:** DPIA and threat model written and reviewed; every S-finding mapped to "not ported" or to the
control that replaces it; no real value in any artefact. **Abuse case:** a DPIA that lists the data
classes but never decides what is *not* migrated.

### UP-06 — Role & permission mapping

**Goal:** every upstream actor has a role, a tenant and gates. **Spec refs:** 01 § Role Mapping ·
04 § 6 · 00 § 4 · `backend/src/constants/roleConstants.ts` · ADR-064 · UD-1, UD-4. **Size:** S.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-06-01 | Role matrix: `admin`/`user` → provider tenant `CALIBRATOR ADMIN`/`TECHNICIAN`; `client`/`teknisi_client` → hospital tenant roles; IPSRS → `FACILITY MAINTENANCE` | BLOCKED | UD-4, UP-00-02 |
| UP-06-02 | Slugs and grants spec: `ipm`, `ipm-templates` (+ `seededMenuSlugs`), reports; no new role unless needed — if one is, its `ROLE_LEVELS` entry | BLOCKED | UP-06-01 |
| UP-06-03 | Grant scopes ↔ permissions: how `dynamicAccess` composes with a per-facility grant (`devices:read`, `inspections:write`, `calibrations:write`, `attachments:write`) | BLOCKED | UP-00-02 |
| UP-06-04 | Two-tenant test plan: every new `:id` route and every grant negative case listed with its expected 404 | BLOCKED | UP-06-03 |

**DoD:** matrix in 01 updated through the deviation protocol; test plan reviewed before UP-09 starts.

### UP-07 — Domain design (specs; includes UP-DB-3)

**Goal:** a reviewed spec per aggregate before any migration. **Spec refs:** 02 F-17…F-79 · 04 § 3–8
· 03 § 4.6 · 00 § 11 · ADR-107 (snapshots) · certificate pipeline docs. **Size:** L. All cards *spec required*.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-07-01 | Catalogue spec: `device_types`, `inspection_item_definitions`, `device_type_inspection_items` **plus the version dimension** (UD-3); typed items (tri-state, measured-with-limit, setting/measured/reference); limit parsing | BLOCKED | UP-00-03 |
| UP-07-02 | IPM aggregate spec: `inspection_sessions` / `inspection_results`, states, corrections/supersede, void, visit number computed at submit, "due" flag, work-order link (UD-12), side effects (UD-17) | BLOCKED | UP-00-04, UD-12, UD-17 |
| UP-07-03 | Device extensions spec: `qr_code` normalisation + per-tenant uniqueness, `device_type_id`, `inventoried_on`, `calibration_vendor_id`, `accessories_complete`, condition vocabulary, photos as attachments (`device-photos`), serial duplicates | BLOCKED | UD-9, UD-10 |
| UP-07-04 | Access-grant spec: grant lifecycle (409 transitions), active-facility switch, token re-issue, socket rooms, audit attribution, rate limits, revocation by the hospital admin | BLOCKED | UP-00-02, UP-06-03 |
| UP-07-05 | Calibration-date spec: quick external calibration record by QR, history kept, import actor (per-tenant import API key, 04 § 4.7) | BLOCKED | UD-8 |
| UP-07-06 | IPM report spec: certificate `type: maintenance`, issued once at submit, numbering, stored PDF, QR to `/verify`, e-signature and countersign | BLOCKED | UP-07-02, UD-17 |
| UP-07-07 | Public device page spec (capability token) and legacy resolver | BLOCKED | UP-00-06, UD-16 |
| UP-07-08 | Offline capture spec (UD-14): service worker scope under the nonce CSP, IndexedDB queue, idempotency keys, photo queue, conflict 409, catalogue ETag download (F-79) | BLOCKED | UP-16-02, UP-07-02 |

**DoD:** each spec names its tables, routes, contracts, gates, audit events and two-tenant tests;
`docs/` amendments drafted with their ADR. **Abuse case:** copying the 16-table upstream shape
because "the ETL is simpler".

### UP-08 — DB-structure migration to our conventions (UP-DB-4)

**Goal:** the schema of 04, in migrations, proved on PostgreSQL 18. **Spec refs:** 04 § 2, § 4, § 8,
§ 10, § 11 · docs/DATABASE/00, 13 · ADR-100 Am. 3 · migration 0057 (append-only precedent). **Size:** M.
Numbers are 04's proposal; renumber at implementation.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-08-01 | `0111` `device_types` (+ version per UP-07-01) and `calibration_devices.device_type_id`; model; `unscopedModels.d17` entry | BLOCKED | UP-07-01 |
| UP-08-02 | `0112` device columns, `UNIQUE (tenant_id, id)`, partial unique `(tenant_id, qr_code)` | BLOCKED | UP-07-03 |
| UP-08-03 | `0113` inspection catalogue tables and ENUM types | BLOCKED | UP-07-01 |
| UP-08-04 | `0114` `inspection_sessions` / `inspection_results`, composite FKs, CHECKs, indexes | BLOCKED | UP-07-02 |
| UP-08-05 | `0115` immutability trigger for submitted results; tested as `callibrator_app` | BLOCKED | UP-08-04 |
| UP-08-06 | `0116` menu groups `ipm`, `ipm-templates` and grants | BLOCKED | UP-06-02 |
| UP-08-07 | `0117` access-grant tables (`service_engagements` and whatever UP-00-02 adds) | BLOCKED | UP-07-04 |
| UP-08-08 | `0118` attachment folders / resource type, if a DB-level list exists | BLOCKED | UP-07-03 |
| UP-08-09 | Upgrade boot and `make migrate-verify` on production-shaped data; columns inspected, not the log | BLOCKED | UP-08-01 … 08 |

**DoD (adds):** one transaction per migration, reversible `down`, no blanket try/catch, indexes and
CHECKs in the migration only; every negative of 04 § 10 re-proved by a named test on the real migration.

### UP-09 — Backend implementation

**Goal:** the features of 02 behind our API. **Spec refs:** 02 (feature rows named per card) · the
UP-07 specs · docs/API/00 · docs/BACKEND/00 · CLAUDE.md non-negotiables. **Size:** L.

| Card | Title | Features | Status | Depends on |
|---|---|---|---|---|
| UP-09-01 | Catalogue and template API: device types, versions, publish (audited), published-catalogue download with ETag | F-19 … F-22, F-31, F-79 | BLOCKED | UP-08-01, 03 |
| UP-09-02 | Device extensions: QR lookup, type, photos (sniffing, HEIC → JPEG, EXIF strip, thumbnails, ClamAV), photo replace | F-23 … F-29 | BLOCKED | UP-08-02, 08 |
| UP-09-03 | IPM sessions: prefill, draft, submit, correction, void, list/history; idempotency keys for offline sync | F-35 … F-57 | BLOCKED | UP-08-04, 05 |
| UP-09-04 | IPM side effects in the submit transaction: work order, device status, scheduler flag, "due" flag | F-48, F-51, F-54 | BLOCKED | UP-09-03, UD-17 |
| UP-09-05 | Quick calibration-date entry by QR with certificate attachment | F-32, F-62 … F-64 | BLOCKED | UP-07-05 |
| UP-09-06 | Exports as batch jobs: inventory PDF (photos on/off), XLSX, calibration recaps | F-65 … F-69 | BLOCKED | UP-09-02 |
| UP-09-07 | Dashboard condition metrics and technician activity list | F-70 … F-73 | BLOCKED | UP-09-03 |
| UP-09-08 | Public device page API (capability token, rate-limited, exemption list) | F-74, F-75 | BLOCKED | UP-00-06 |
| UP-09-09 | Per-facility access grants and the active-facility switch | F-17, F-26 | BLOCKED | UP-08-07 |
| UP-09-10 | Live API smoke of every new route and live E2E specs for the backend flows | all | BLOCKED | UP-09-01 … 09 |

### UP-10 — Frontend implementation

**Goal:** the pages, with field capture as a PWA with offline mode (UD-14). **Spec refs:** 02 § F
page notes · docs/FRONTEND/00 · docs/UI-UX/08 · ADR-122 · ADR-071/090 · UP-07-08. **Size:** L.

| Card | Title | Features | Status | Depends on |
|---|---|---|---|---|
| UP-10-01 | Catalogue and template admin (`dashboard/ipm-templates`) | F-22 | BLOCKED | UP-09-01 |
| UP-10-02 | Device form and list: QR, type picker, mandatory photos, condition, thumbnails | F-23 … F-31 | BLOCKED | UP-09-02 |
| UP-10-03 | IPM capture: mobile-first stepper, camera QR scan, autosave draft | F-35 … F-53 | BLOCKED | UP-09-03 |
| UP-10-04 | IPM history, corrections and void; device "IPM" tab | F-54 … F-57 | BLOCKED | UP-09-03 |
| UP-10-05 | Calibration-date quick entry and list | F-62 … F-64 | BLOCKED | UP-09-05 |
| UP-10-06 | Exports UI with job status | F-65 … F-69 | BLOCKED | UP-09-06 |
| UP-10-07 | Dashboard condition widgets and technician activity | F-70 … F-73 | BLOCKED | UP-09-07 |
| UP-10-08 | Public device page `d/[token]` | F-74, F-75 | BLOCKED | UP-09-08 |
| UP-10-09 | Active-facility switcher; grant management for hospital admins | F-17 | BLOCKED | UP-09-09 |
| UP-10-10 | PWA offline mode: service worker, IndexedDB queue of drafts and photos, background sync, conflict display | F-78, F-79 | BLOCKED (scope decided, UD-14) | UP-10-03, UP-07-08 |

**DoD (adds):** jest, accessibility (light + dark), responsive and live browser suites cover each page;
offline mode proved on a real phone with the network cut and restored (named run in the record).

### UP-11 — Report & PDF parity

**Goal:** every upstream document has a field-for-field equivalent, plus our numbering, QR
verification and signatures. **Spec refs:** 00 § 7 · 02 F-58 … F-69 · M08, M10 · UP-07-06. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-11-01 | Structure-only reference of the upstream layouts (sections, field order, page size, signature blocks) from the views — no data | TODO | — |
| UP-11-02 | IPM report on the certificate pipeline; golden-file test on synthetic data | BLOCKED | UP-09-03, UP-07-06 |
| UP-11-03 | Inventory PDF (with/without photos) and the facility variant | BLOCKED | UP-09-06 |
| UP-11-04 | Inventory XLSX and the five calibration recaps: column parity | BLOCKED | UP-09-06 |
| UP-11-05 | Side-by-side sign-off by the provider (dry-run data on a throwaway stack) | BLOCKED | UP-11-02 … 04, UP-12-05 |

### UP-12 — Data ETL, including ~110 GB of files (UP-DB-5, UP-DB-6)

**Goal:** an idempotent, reconciled import into hospital tenants. **Spec refs:** 05 (all) · 04 § 2, § 5,
§ 7 · 03 Q-1 … Q-28 · UD-4 … UD-13, UD-18. **Size:** L.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-12-01 | ETL tool `backend/src/scripts/upstream-import/`: extract → stage → transform → load, `upstream_import.id_map` + quarantine (not granted to `callibrator_app`), synthetic fixtures only | BLOCKED | UP-08 |
| UP-12-02 | Transforms in 05 § 3.1 order: tenants, users (invitation), catalogue, vendors, locations, devices, calibrations, sessions, results, audit rows | BLOCKED | UD-4 … UD-13 |
| UP-12-03 | File pipeline for the ~58,650 referenced files (~110 GB of 116 GB): content allow-list, ClamAV, SHA-256, put under `t/<tenant>/attachments/`, derivatives, HEIC → JPEG; bulk early, delta by name | BLOCKED | UP-05-05, UD-18 |
| UP-12-04 | Per-tenant import API key as the calibration-record actor; revoked after cutover | BLOCKED | UP-07-05 |
| UP-12-05 | Dry run: latest dump → throwaway PG 18 + throwaway bucket, every step timed, repeated until UP-13-01 is green | BLOCKED | UP-12-01 … 04, UD-7, UD-18 |

**Abuse cases:** a row "dropped" without a quarantine reason; an append-only target corrected by
UPDATE; a real value in a test fixture.

### UP-13 — Reconciliation & parity verification (UP-DB-7)

**Spec refs:** 05 § 7 (R-1 … R-12) · 03 § 7. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-13-01 | Automated R-1 … R-12 per tenant, aggregates only | BLOCKED | UP-12-05 |
| UP-13-02 | Quarantine review and per-tenant data-quality report (duplicate serials, duplicate files, orphans, implausible dates) | BLOCKED | UP-13-01 |
| UP-13-03 | Sampled report diff: upstream vs ours, field by field, on throwaway copies | BLOCKED | UP-11-02 |
| UP-13-04 | Signed reconciliation by the operator: zero unexplained deltas | BLOCKED | UP-13-01 … 03 |

### UP-14 — UAT with real users

**Spec refs:** 00 § 1, § 4 · 01 role mapping · UP-17 guides. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-14-01 | UAT plan and scripts (Indonesian) per persona: provider technician, provider admin, facility admin, facility technician, IPSRS | BLOCKED | UP-10 |
| UP-14-02 | Field UAT on phones with poor connectivity, offline capture included, on staging with dry-run data | BLOCKED | UP-14-01, UP-13-04 |
| UP-14-03 | Defect triage and UAT sign-off | BLOCKED | UP-14-02 |

### UP-15 — QR sticker continuity

**Spec refs:** 02 F-23, F-74 … F-76 · 00 § 9 S-06 · D-13 · UD-15, UD-16. **Size:** S–M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-15-01 | Establish what the stickers encode | BLOCKED (owner) | OA-4 |
| UP-15-02 | Legacy resolver: in-app QR lookup for signed-in staff; redirect from the old host if stickers carry URLs (rate-limited, minimal view) | BLOCKED | UP-15-01, UD-16 |
| UP-15-03 | New stickers with capability tokens: print layout, re-stickering policy | BLOCKED | UP-10-08 |
| UP-15-04 | Sticker-scan test with real phones, legacy and new | BLOCKED | UP-15-02, 03 |

### UP-16 — Mobile / offline decision

**Spec refs:** 00 § 6 · 02 F-77 … F-79 · M14 · UD-14. **Size:** S (decision); the build is UP-10-10.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-16-01 | Decide PWA vs native | **DONE 2026-10-07 (owner decision UD-14: PWA with offline mode, camera for photos/QR, no native app)** — record: this file § 3; ADR in UP-16-02 | — |
| UP-16-02 | ADR: PWA field capture, offline queue, sync and conflict rules, CSP and service-worker constraints, browser support floor | TODO | UP-16-01 |
| UP-16-03 | APK retirement: announcement, removal from the public folder, upstream API shut down at cutover | BLOCKED | UP-18 |

### UP-17 — Training & documentation in Indonesian

**Spec refs:** 02 F-55, F-56 · UD-6 · docs/ deviation protocol. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-17-01 | User guides (ID): technician (capture, offline, corrections), facility admin (grants, users, reports), IPSRS (countersign) | BLOCKED | UP-10 |
| UP-17-02 | "What changed" note (ID): no overwrite — corrections; invitations; new stickers and public page; the app replaces the APK | BLOCKED | UP-00-04, UP-16-02 |
| UP-17-03 | Short videos / train-the-trainer sessions | BLOCKED | UP-17-01 |
| UP-17-04 | As-built `docs/` (English) for the new modules, with their ADRs | BLOCKED | UP-09, UP-10 |

### UP-18 — Cutover & dual-run (UP-DB-8)

**Spec refs:** 05 § 8 · ADR-123 deployment · `db-backup`. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-18-01 | Cutover runbook in `TASKS/` (T-14 d … T+30 d, rollback = pre-import backup) | BLOCKED | UP-13 |
| UP-18-02 | Full rehearsal on a disposable stack, freeze timed | BLOCKED | UP-18-01 |
| UP-18-03 | Go/no-go record: reconciliation signed, UAT signed, security review closed, invitations ready, owner actions done | BLOCKED | UP-13-04, UP-14-03, UP-05-07, UP-15-04 |
| UP-18-04 | Cutover: freeze → final dump → delta load and files → reconciliation → invitations; upstream read-only | BLOCKED | UP-18-03 |
| UP-18-05 | Dual-run window: upstream read-only for lookup, redirects live, no dual writing; post-cutover reconciliation | BLOCKED | UP-18-04 |

### UP-19 — Decommission & archive (UP-DB-9)

**Spec refs:** 05 § 8, § 10 · UD-18 · OA-3. **Size:** S.

| Card | Title | Status | Depends on |
|---|---|---|---|
| UP-19-01 | Encrypted archive of the upstream DB and files for the retention period; one restore tested | BLOCKED | UP-18-05 |
| UP-19-02 | Drop `upstream_import`; revoke import keys and upstream credentials; retire the host (keep the redirect only if UP-15 needs it) | BLOCKED | UP-19-01 |
| UP-19-03 | Secure deletion of every copy, `mozivid/` on workstations included; decommission record | BLOCKED | UP-19-02, OA-3 |
| UP-19-04 | Phase exit: `PROGRESS.md`, roadmap; Phase 999 unblocked | BLOCKED | UP-19-03 |

---

## 6. Phase Exit

The phase is complete when UP-19-04 is DONE: every card DONE with its record, the reconciliation
and UAT signed, the security review closed, the upstream archived and its copies deleted. **Not
before** — Phase 999 waits on it (ADR-089).
