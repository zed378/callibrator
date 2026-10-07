# Phase 12 — Upstream: Decisions & ADRs, and the Index of the Upstream Adoption Group (Phases 12 … 31)

> **This file is the index of the upstream PHP feature adoption group** — SKP IPM (`apps-ipm`,
> CodeIgniter 4) into Callibrator. It holds what is plan-wide (status, the Indonesian summary, the
> phase list and build order, the group-wide Definition of Done, owner decisions UD-1 … UD-18,
> owner actions OA-1 … OA-8, the group exit and the **old → new id mapping**, § 7) and the cards of
> Phase 12 itself (§ 5). Every other phase has its own file, listed in § 2. Until 2026-10-07 all of
> this was one file, `TASKS/PHASE-UPSTREAM-PHP-ADOPTION.md`, with phases `UP-00` … `UP-19` and cards
> `UP-xx-yy`; the owner asked for it to be split into `PHASE-12-…` onwards (*"pecah
> PHASE-UPSTREAM-PHP-ADOPTION.md menjadi PHASE-12-title dan seterusnya"*), and the old file was
> deleted. `UP-xx-yy` is now `P(12+xx)-yy`.
>
> Next → [Phase 13 — Code Research](./PHASE-13-UPSTREAM-CODE-RESEARCH.md)

> **Ringkasan (Bahasa Indonesia).** Fase ini memindahkan fitur dan data aplikasi upstream **SKP IPM**
> (inventaris alat kesehatan + **IPM**, Inspeksi dan Pemeliharaan Preventif, untuk satu penyedia
> jasa yang melayani 118 faskes) ke Callibrator. **Riset selesai 2026-10-07** (kode, struktur
> database, modul, fitur — `docs/UPSTREAM/00…05`). Rencana ini menggabungkan fase usulan agen kode
> (UP-00…UP-19) dan agen database (UP-DB-1…9) menjadi **20 fase — Fase 12 … 31**, satu berkas per
> fase sejak 2026-10-07, dengan kartu kerja `P12-yy` … `P31-yy` (dulu `UP-xx-yy`; pemetaan di § 7).
> **Pemilik sudah memutuskan empat hal (2026-10-07):** (1) **tenant = perusahaan kalibrator** yang
> melayani faskes (koreksi pemilik 2026-10-07, menggantikan usulan "faskes = tenant"): SKP adalah
> tenant, setiap faskes adalah **klien di dalam tenant** (`client_facilities`), staf SKP bekerja di
> semua faskes tenantnya, dan staf faskes (`client`, `teknisi_client`) adalah pengguna tenant yang
> **terikat ke faskesnya** lewat dimensi lingkup kedua yang ditegakkan terpusat oleh hook tenant
> (antar-faskes = 404) — ADR-124, ADR-084 tidak diubah; (2) **banyak IPM per alat**, riwayat lengkap, koreksi/void tanpa menghapus;
> aturan upstream "satu per bulan, simpan ulang = hapus" **tidak** dipakai; (3) pengambilan data
> lapangan lewat **PWA dengan mode offline** (kamera untuk foto/QR, sinkronisasi), tanpa aplikasi
> native; (4) **satu katalog global berversi** untuk jenis alat dan template ceklis. **Keputusan
> pemilik berikutnya (2026-10-07, semua sesuai rekomendasi):** tenant adalah siapa pun yang
> mengerjakan kalibrasi (perusahaan kalibrator dengan banyak faskes, atau IPSRS rumah sakit dengan
> satu faskes "self"); nomor seri unik **per faskes**; PDF sertifikat lab eksternal hanya diarsip
> (opsional nanti: entri data sertifikat terakhir per alat); ekspor data pribadi GDPR (ADR-114) tetap
> ZIP dari backend. **ADR-nya
> sudah ditulis 2026-10-07: ADR-124 (tenancy/faskes), ADR-125 (katalog), ADR-126 (sesi IPM),
> ADR-127 (PWA).** Aturan pemilik 2026-10-07: sertifikat dan ekspor data **dirender di frontend**,
> tidak ada berkas sertifikat/ekspor yang disimpan. **Implementasi masih menunggu** keputusan pemilik
> yang tersisa (tabel di bawah), serta tindakan pemilik di luar kode: **rotasi kata sandi DB dan
> JWT secret upstream**, menutup registrasi/mode development/`info.php`/rute QR & PDF publik di
> situs upstream, enkripsi lalu penghapusan salinan lokal `mozivid/`, memindai satu stiker QR fisik,
> dan dasar hukum (UU PDP) per faskes. Volume: ±384 ribu baris, **±91 GB berkas** (foto alat saja; PDF sertifikat ±19 GB diarsip offline, tidak dimuat — aturan pemilik 2026-10-07) yang dipindah
> (dari 116 GB).

| | |
|---|---|
| **Status** | **Research DONE 2026-10-07** (Phases 13 … 16). **Plan written 2026-10-07** (this file). **Four owner decisions taken 2026-10-07** (UD-1 — **revised by the owner the same day**: the tenant is the calibration company, facilities are clients inside it — UD-3, UD-6, UD-14). **ADRs written 2026-10-07:** ADR-124 (P12-02), ADR-125 (P12-03), ADR-126 (P12-04), ADR-127 (P28-02). **Second batch of owner decisions 2026-10-07** (all as recommended): Q-57·T (a) the tenant is whoever does the calibration work — confirms ADR-124; UD-9 serial unique per facility; external-lab certificate PDFs archive-only; the GDPR export (ADR-114) unchanged (§ 3). **Implementation BLOCKED**: on P12-05/06 (their owner decisions), the open owner decisions below, and the owner actions outside the codebase |
| **Roadmap position** | Phase 9 → 10 → 11 → **Phases 12 … 31 (upstream PHP feature adoption)** → Phase 999 (`docs/PLAN/16-IMPLEMENTATION-ROADMAP.md`, ADR-089). Phase 999 stays blocked until the group exits (§ 6) |
| **Files** | this index (Phase 12) and one file per phase, Phases 13 … 31, listed in § 2; ids mapped in § 7 |
| **Backlog** | `TASKS/BACKLOG.md` Q-57 (the upstream is identified) |
| **Research** | [`docs/UPSTREAM/`](../docs/UPSTREAM/README.md): 00 overview (§ 9 security S-01…S-18, § 10 tenancy, § 11 drift D-01…D-13), 01 modules M01…M15, 02 features F-01…F-81, 03 database (Q-1…Q-28), 04 schema mapping (§ 9 decisions D-1…D-11, § 12 DB phases), 05 data migration |
| **Records** | [`2026-10-07-upstream-code-research.md`](../MEMORY/records/2026-10-07-upstream-code-research.md) · [`2026-10-07-upstream-database-research.md`](../MEMORY/records/2026-10-07-upstream-database-research.md) · [`2026-10-07-upstream-adrs.md`](../MEMORY/records/2026-10-07-upstream-adrs.md) |
| **Source** | `mozivid/` (gitignored, read-only, **real personal data** — never committed, never copied into the repository) |

**Privacy rule for every card in this group (Phases 12 … 31).** No real data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository: not in code, fixtures,
tests, docs, records, logs or screenshots. Fixtures are synthetic; reports are aggregates; real
data is touched only in throwaway containers bound to `127.0.0.1` and removed by name afterwards.

---

## 1. How the Two Draft Phase Lists Were Merged

The code agent's draft (00 § Phases, UP-00 … UP-19) was kept as the spine, with its ids. On
2026-10-07 the owner had the plan split into one file per phase: draft phase UP-xx became
**Phase 12 + xx** and card UP-xx-yy became **P(12+xx)-yy** (§ 7); the references in `docs/UPSTREAM/`,
`TASKS/`, `docs/` and `MEMORY/DECISIONS.md` were rewritten to the new ids, and dated records keep the
old ones (a note at their top points here). The DB agent's UP-DB-1 … 9 (04 § 12) fold into it with no
duplicate phase:

| DB phase (04 § 12) | Merged into | Note |
|---|---|---|
| UP-DB-1 Structure research | **Phase 14** | DONE |
| UP-DB-2 Decisions | **Phase 12** | D-1 … D-11 are in the consolidated table (§ 3) |
| UP-DB-3 Schema migration design → spec | **Phase 19** (cards P19-01 … 03, 08) | specs in `MEMORY/specs/` |
| UP-DB-4 Migration implementation | **Phase 20** | migrations 0111 … 0118 as proposed in 04 § 11 (renumber at implementation) |
| UP-DB-5 ETL tool | **Phase 24** (P24-01 … 04) | |
| UP-DB-6 ETL dry run | **Phase 24** (P24-05) | |
| UP-DB-7 Reconciliation and sign-off | **Phase 25** | |
| UP-DB-8 Cutover | **Phase 30** | |
| UP-DB-9 Decommission | **Phase 31** | |

The phases the owner asked for by name are Phase 13 *code research*, Phase 14 *DB-structure research*,
Phase 15 *module research*, Phase 16 *feature research*, Phase 20 *DB-structure migration to our conventions*,
Phase 21 *backend implementation* and Phase 22 *frontend implementation*. The others were added by the
research.

## 2. The Phase List (ordered)

IDs are in dependency order except Phase 27 and Phase 28, whose decision parts run early (Phase 28's
decision is taken; Phase 27 waits on a sticker scan) and whose build parts land with Phase 22.
Sizes: **S** ≤ 2 days · **M** ≤ 1 week · **L** > 1 week (one developer, tests included), as in 02.

| # | Phase | Goal | Cards | Status | Depends on | Size |
|---|---|---|---:|---|---|---|
| [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) | **Decisions & ADRs** | Settle what blocks design; write the ADRs the decisions need | 7 | WIP: 5 decisions taken (UD-1 revised and confirmed, UD-9 added 2026-10-07), **ADR-124 … ADR-127 written**, 13 decisions open (carried as Q-57·UD-n) | — | S (+ owner time) |
| [Phase 13](./PHASE-13-UPSTREAM-CODE-RESEARCH.md) | **Code research** | Understand the upstream code | 1 | **DONE 2026-10-07** | — | — |
| [Phase 14](./PHASE-14-UPSTREAM-DB-RESEARCH.md) | **DB-structure research** | Understand schema, data, files | 1 | **DONE 2026-10-07** | — | — |
| [Phase 15](./PHASE-15-UPSTREAM-MODULE-RESEARCH.md) | **Module research** | Group code into modules, map to ours | 1 | **DONE 2026-10-07** | Phase 13 | — |
| [Phase 16](./PHASE-16-UPSTREAM-FEATURE-RESEARCH.md) | **Feature research** | Feature-level gap list with implementation notes | 1 | **DONE 2026-10-07** | Phase 15 | — |
| [Phase 17](./PHASE-17-UPSTREAM-SECURITY-PRIVACY.md) | **Security, privacy & data protection** | DPIA (UU PDP 27/2022, GDPR posture), legal basis, minimisation, file policy, threat model of the new surfaces | 7 | 3 DONE (pending legal review) / TODO (1: P17-06, unblocked by ADR-124) / BLOCKED (3) | Phase 12 | M |
| [Phase 18](./PHASE-18-UPSTREAM-ROLES-PERMISSIONS.md) | **Role & permission mapping** | 4 groups + IPSRS → our roles, slugs, facility-bound users, two-tenant and two-facility test plan | 4 | TODO (1) / BLOCKED (3) on UD-4 | Phase 12 | S |
| [Phase 19](./PHASE-19-UPSTREAM-DOMAIN-DESIGN.md) | **Domain design** | Specs for catalogue, IPM aggregate, device extensions, client facilities + facility scope, calibration dates, IPM report, public page | 8 | TODO (1) / BLOCKED (7) on open decisions and Phase 18 | Phase 12, Phase 18 | L |
| [Phase 20](./PHASE-20-UPSTREAM-DB-MIGRATION.md) | **DB-structure migration to our conventions** | Models + forward migrations in our conventions | 9 | BLOCKED | Phase 19 | M |
| [Phase 21](./PHASE-21-UPSTREAM-BACKEND.md) | **Backend implementation** | Services, routes, Zod contracts, OpenAPI, gates, audit, two-tenant tests | 10 | BLOCKED | Phase 20 | L |
| [Phase 22](./PHASE-22-UPSTREAM-FRONTEND.md) | **Frontend implementation** | Pages, PWA field capture with offline mode | 10 | BLOCKED | Phase 21 | L |
| [Phase 23](./PHASE-23-UPSTREAM-REPORTS.md) | **Report & PDF parity** | IPM report, inventory PDF/XLSX, 5 calibration recaps: field parity plus our numbering, QR verification, signatures | 5 | 1 DONE / BLOCKED (4) | Phase 21 | M |
| [Phase 24](./PHASE-24-UPSTREAM-DATA-ETL.md) | **Data ETL (incl. ~91 GB of photos)** | Extract → stage → transform → load per client facility of one provider tenant; file pipeline; dry run | 5 | BLOCKED | Phase 20, Phase 17 | L |
| [Phase 25](./PHASE-25-UPSTREAM-RECONCILIATION.md) | **Reconciliation & parity verification** | Prove the migrated data equals the source, per tenant | 4 | BLOCKED | Phase 24 | M |
| [Phase 26](./PHASE-26-UPSTREAM-UAT.md) | **UAT with real users** | Provider technicians in the field, facility admins, IPSRS | 3 | BLOCKED | Phase 22, Phase 25 | M |
| [Phase 27](./PHASE-27-UPSTREAM-QR-CONTINUITY.md) | **QR sticker continuity** | Existing stickers keep resolving; new stickers carry a capability token | 4 | BLOCKED on OA-4 (scan a sticker) and UD-15 | Phase 19, Phase 22 | S–M |
| [Phase 28](./PHASE-28-UPSTREAM-MOBILE-OFFLINE.md) | **Mobile / offline decision** | PWA vs native; APK retirement | 3 | Decision **DONE** (UD-14); **ADR-127 DONE**; APK retirement BLOCKED | Phase 12 | S (decision) |
| [Phase 29](./PHASE-29-UPSTREAM-TRAINING-DOCS.md) | **Training & documentation in Indonesian** | User guides, "what changed", as-built docs | 4 | TODO (1) / BLOCKED (3) | Phase 26 | M |
| [Phase 30](./PHASE-30-UPSTREAM-CUTOVER.md) | **Cutover & dual-run** | Freeze, final delta, invitations, read-only upstream, go/no-go | 5 | BLOCKED | Phase 25, Phase 26, Phase 27 | M |
| [Phase 31](./PHASE-31-UPSTREAM-DECOMMISSION.md) | **Decommission & archive** | Encrypted archive, drop import schema, revoke, delete copies | 4 | BLOCKED | Phase 30 | S |
| | **Total** | | **96** | 14 DONE (P12-02 … 04, P12-07, P13-01 … P16-01, P17-02, P17-04, P17-05, P23-01, P28-01, P28-02) · 4 TODO (P17-06, P18-03, P19-01, P29-02) · 1 WIP · 77 BLOCKED | | |

**Build order inside Phases 20 … 22 (thin vertical slices, from 00 § Phases):** catalogue & templates
→ device extensions (QR, photos, condition) → IPM capture → IPM report → calibration-date entry &
recaps → inventory exports → dashboard condition widgets → public device page → offline capture. **Revised
2026-10-07 (ADR-124):** the client-facility slice (`client_facilities`, `client_facility_id` on the
evidence chain, the facility dimension in the hooks) comes **first**, because every later table
carries the column; it is the riskiest slice (the most security-critical code in the system gains a
second dimension). **No facility-bound user is created in any tenant before P21-09 is DONE and
the two-facility guard and suite are green**; provider staff (unbound) need nothing new.

### Group-wide Definition of Done (every implementation card of Phases 20 … 31 inherits it)

Added to the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md), not instead of it:

- [ ] **Tenant isolation:** every tenant-owned table has `tenant_id` NOT NULL and is scoped by the
      hooks (deny-by-default); `tenantId` never read from a body (upstream S-05/S-11 not ported);
      uniqueness scoped, never global (QR per tenant; serial per facility, `(tenant_id, client_facility_id, serial_number)`, UD-9 decided 2026-10-07); composite `(tenant_id, …)` FKs where 04 § 4.8–4.9 says;
      global tables (catalogue) listed in `unscopedModels.d17` with the ADR as reason
- [ ] **Two-tenant tests:** every new `:id` route has a `twoTenantSuite` + `memoryDb` test asserting
      **404**, marked `@two-tenant`, and `twoTenantRoutes.guard` passes
- [ ] **Two-facility tests (ADR-124):** every facility-accessible `:id` route has a `twoFacilitySuite`
      test asserting **404** for another facility's row of the same tenant and its absence from every
      list, marked `@two-facility`; a bound user with no facility sees nothing; the facility-scoped
      model, route-marker and raw-SQL guards pass
- [ ] **Audit:** every mutation (including corrections, voids, facility changes, binding or
      unbinding a user to a facility, every import batch) writes its audit row inside its transaction; a rolled-back action
      leaves none
- [ ] **Contracts:** Zod schemas in `@callibrator/contracts` (new unions in `contracts/states`:
      `INSPECTION_SECTIONS`, `INSPECTION_OUTCOMES`, `INSPECTION_RECOMMENDATIONS`,
      `INSPECTION_SESSION_STATUSES`, and the client-facility kinds and statuses), `validate(schema, { from })`; a
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
four of them are answered; UD-9 was answered in the second batch the same day (below the table). Items that are facts only the owner can obtain (secret rotation, the
sticker scan, contracts) are **owner actions** (§ 4), cross-referenced here.

| # | Decision | Cross-refs | Recommendation | Consequence | Blocks | State |
|---|---|---|---|---|---|---|
| **UD-1** ★ | Tenancy model for a provider serving many facilities | D-1 · code #1 · 00 § 10 · 04 § 3 · F-13 … F-18, F-26 · ADR-084 | ~~Each facility = its own hospital tenant; provider staff act through a revocable per-facility grant with an "active facility" switch~~ (first reading, never built). **Revised by the owner 2026-10-07:** *"sebagai konteks tenant adalah perusahaan kalibrator yang melayani faskes"* — **the tenant is the calibration company; each facility is a client inside it** (`client_facilities`); provider staff work across their tenant's facilities; facility staff are users **bound** to their facility by a second, deny-by-default scope in the tenant hooks (cross-facility = 404). A hospital doing its own calibration stays a tenant with one facility, itself (working reading, Q-57·T) | no cross-tenant path, ADR-084 **not** amended; the scoping core gains a second dimension (L); two-facility tests and guards on every facility-accessible route; every evidence table gains `client_facility_id` (backfilled to each tenant's self facility) | Phase 18, P19-04, P20-07, P21-09, P22-09, Phase 24, Phase 30 | **DECIDED (owner, 2026-10-07), REVISED by the owner the same day.** **ADR-124** (P12-02 DONE) |
| **UD-2** | Scope of adoption | 02 tally · 01 summary | Adopt every Exists/Partial/Missing feature (76 of 81); not adopted: F-03, F-05, F-77, F-80, F-81; three unsafe behaviours replaced (guessable public access, delete-and-reinsert, attribution from the body) | fixes the size of Phases 21/22; anything dropped later needs a recorded decision | Phases 19 … 23 | open |
| **UD-3** ★ | Device types and checklist templates: platform-global or provider-owned | D-2 · F-19 … F-22 · 04 § 4.3–4.5 | One **global, versioned** catalogue maintained by the platform/provider, like `roles` | tables without `tenant_id` need an ADR reason and `unscopedModels.d17` entries; versioning means sessions reference the version used (02 F-20) — 04's schema gains a version dimension in P19-01; who may publish a version (super admin; provider proposes) is part of that ADR | P19-01, P20-01/03, P21-01, P22-01, Phase 24 | **DECIDED (owner, 2026-10-07)**. **ADR-125** (P12-03 DONE) |
| **UD-4** | Role of upstream `client` accounts (and naming the person behind shared accounts) | D-3 · 01 role mapping · 04 § 6 · 05 § 5 | First account per tenant `HEALTHCARE ADMIN`, others `ROOM USER`; `teknisi_client` → `HEALTHCARE TECHNICIAN`; `admin`/`user` → `CALIBRATOR ADMIN`/`TECHNICIAN` in the provider tenant; the operator names the real person behind each shared account at invitation | hospital staff privilege level; 21 CFR Part 11 attributability of shared accounts | P18-01, P24-02 | open |
| **UD-5** | Passwords of imported users | D-4 · F-01 · 05 § 5 | Do **not** import hashes; unusable random hash + forced set via the single-use invitation | every upstream user re-registers their password once (~105 e-mails); no second password path in `auth.service` | P24-02, P30-04 | open |
| **UD-6** ★ | Many IPM sessions per device, or upstream's one-per-month-with-replacement | code #4 · F-55, F-56 · drift D-07 · 03 § 4.6 | Many per device, full history; corrections and voids through our correction/void pattern; nothing deleted | upstream's month-replace is **not** kept; a monthly schedule may flag a device "due"; technicians must learn "correct, don't overwrite" (Phase 29) | P19-02, P20-04/05, P21-03, P22-03/04 | **DECIDED (owner, 2026-10-07)**. **ADR-126** (P12-04 DONE) |
| **UD-7** | Timezone of upstream `DATETIME` values | D-6 · 03 § 8.4 · 05 § 3.4 | Verify per table with the operator on 3–5 events of known local time (OA-6); default `Asia/Jakarta` | a 7-hour error moves sessions across dates and corrupts the session key | P24-02, P24-05 | open |
| **UD-8** | Meaning of `trx_inventory.tgl_kalibrasi` and the calibration interval | D-7 · Q-11 · F-62 … F-64 | SME answer (OA-7); until then import only `trx_kalibrasi` as records and set no `next_calibration_date` | regulatory dates on 23 k devices; due-date reminders stay off for imported devices until answered | P19-05, P24-02 | open |
| **UD-9** | Duplicate serials inside a tenant (624 groups) | D-5 · Q-18 · F-24 | Keep the serial on the oldest device of each group, NULL on the others, original in `id_map`, listed in the per-tenant data-quality report | visible device data changes; keeps `UNIQUE (tenant_id, serial_number)` | P24-02, P25-02 | **DECIDED (owner, 2026-10-07)**, as recommended under ADR-124: serials are unique **per facility** — `UNIQUE (tenant_id, client_facility_id, serial_number)`, not per tenant (a provider tenant spans 118 facilities). Duplicates inside one facility keep the treatment recommended here; the P19-03 spec and the P20-02 migration build it (P19-03 still waits on UD-10) |
| **UD-10** | Rooms and the district-office → health-centre structure | D-8 · F-18 · 00 § 1 | Rooms as `warehouses` (locations) after a cleaning pass; a district office's centres as locations inside its tenant, not child tenants (ADR-084 gives a parent no visibility) | product vocabulary ("warehouse" for a ward) in the UI; ~3,099 raw room pairs to clean | P19-03, P24-02 | open |
| **UD-11** | Which facilities become `client_facilities` rows (no longer tenants — ADR-124); their contact e-mail; the provider tenant's plan and seats | D-9 · 04 § 3 | All with devices (114) as client facilities of one provider tenant; contact from the client account, or provided by the operator (OA-8); the provider tenant's plan/limits set by the operator (facility accounts count as seats today, Q-57·T) | onboarding effort for 63 facilities with no client account | P24-02, P30-04 | open (the seat point (b) of Q-57·T rides with it) |
| **UD-12** | A `maintenance_work_orders` row per imported session | D-10 · F-48 | No for history; yes for future IPM (a Preventative work order linked to the session) | reporting expectations of maintenance lists | P19-02, P24-02 | open |
| **UD-13** | Audit granularity of the import | D-11 · 04 § 7 | One audit row per imported business row (~330 k) | cost vs per-record provenance | P24-02 | open |
| **UD-14** ★ | Field capture: native app or PWA | code #5 · Phase 28 · F-77 … F-79 · M14 | PWA with offline mode: offline capture + sync, camera for photos and QR; no native app | the APK is retired at cutover; a service worker and an IndexedDB queue under our nonce CSP; idempotency keys on the capture endpoints; conflict = 409 with explanation | P21-03, P22-03/10, P28-02/03 | **DECIDED (owner, 2026-10-07)**. **ADR-127** (P28-02 DONE) |
| **UD-15** | What the public device page shows | F-74, F-75 · S-06 · M13 | Capability-token page (≥ 128-bit, revocable), per-tenant setting; default: identity + calibration status + last IPM date; photos and documents off | patients/visitors scanning a sticker see less than upstream showed; nothing reachable by a sequential number | P19-07, P21-08, P22-08, Phase 27 | open |
| **UD-16** | How legacy stickers resolve | F-76 · Phase 27 · OA-4 | If they encode a URL on the old host: a rate-limited redirect to the minimal public view; if only the number: in-app lookup by QR for signed-in technicians | keeps the old host name alive (or not) after decommission | P27-02, P31-02 | open — needs OA-4 first |
| **UD-17** | IPM business rules: recommendation side effects and the IPSRS countersignature | F-51, F-61 · drift D-04 | `needs_repair` → Repair work order; `not_fit_for_use` → device status `maintenance`; `needs_calibration` → scheduler flag; each audited in the same transaction. IPSRS (`FACILITY MAINTENANCE`) countersigns electronically, per-tenant setting | automatic status changes on hospital devices; IPSRS accounts needed in every facility that enables countersigning | P19-02/06, P21-04, P23-02 | open |
| **UD-18** | Legal basis, contracts and retention | code #6 · Phase 17 · 05 § 10 · OA-5 | DPA between operator and platform; operator confirms its client contracts permit the transfer; facilities informed before cutover; storage in an Indonesian region or the self-hosted store; `upstream_import` kept until sign-off + 90 days; upstream archive kept per the operator's retention schedule | without it no real-data dry run (P24-05), no cutover, no decommission date | P17-03, P24-03/05, Phase 30, Phase 31 | open |

**Owner rulings of 2026-10-07, second batch (all as recommended; carried in `TASKS/BACKLOG.md`):**

- **Q-57·T (a) — DECIDED.** A tenant is whoever does the calibration work: a calibration company
  serving many facilities, **or** a hospital's IPSRS serving itself with exactly one `is_self`
  facility. Existing tenants keep working unchanged. This confirms ADR-124's working decision.
  Q-57·T (b) facility accounts count as tenant seats, (c) nothing flows between a hospital's own
  tenant and its provider's records of it, (d) provider roll-ups need no per-facility consent —
  **stay the agent's working decisions, awaiting confirmation** (Q-57·T stays open for them).
- **UD-9 — DECIDED:** serial numbers unique per facility, `(tenant_id, client_facility_id, serial_number)` (table above).
- **External-lab certificate PDFs (~11.9 k) — DECIDED:** archive only (encrypted, offline, outside
  the application), with an **optional later data-entry pass** recording the latest certificate's
  key data per device, rendered by the frontend — option A now, C optionally later
  (`docs/UPSTREAM/07-DATA-MINIMISATION.md` § 4.1, finding F-CERT).
- **The GDPR personal-data export stays as built (ADR-114, a backend ZIP).** It is a legal
  data-subject download, not a rendered report: the frontend-rendering rule of ADR-126 § 8 applies
  to reports and exports, not to ADR-114.

No card is unblocked by this batch: P19-03 still waits on UD-10, P19-05 on UD-8, and the rest
on the decisions and owner actions still open.

Design questions that are **ours** (taken by ADR in Phase 19, not put to the owner): template version
model (UD-3 fixed that there *is* versioning); condition vocabulary (a `condition` column vs 04's
mapping onto `status`, 02 F-24 vs 04 § 4.2); QR uniqueness scope (04: per tenant); electrical-safety
pass/fail computation (02 F-42, new behaviour); HEIC/derivative policy (05 § 6.2).

## 4. Owner Actions Outside the Codebase

None of these is a code change; each is a precondition named by a card.

| # | Action | Why | Card waiting on it |
|---|---|---|---|
| **OA-1** | **Rotate the upstream database password and `JWT_SECRET`** | both sit in a plain file in the fork (S-01); once a copy circulates they are disclosed | P17-01 |
| **OA-2** | On the live upstream: **close open registration** (S-04), switch off **development mode** (S-02), **delete `info.php`** (S-03), put the **public QR, IPM and PDF routes** behind login or remove them (S-06). Advised as well: remove the `recall` debug route (S-12) and the APK/operator files from `public/` (S-13), enable CSRF (S-09) | today a self-registered account downloads any facility's inventory, and anyone reads IPM reports by sequential number | P17-01 |
| **OA-3** | **Encrypt the local `mozivid/` copy at rest** (36 dumps + 116 GB), keep it gitignored, and **delete it after cutover** | real personal data on a workstation (05 § 10) | P17-01, P31-03 |
| **OA-4** | **Scan one physical QR sticker** and report what it encodes (bare number, or a URL — which host) | decides UD-16 and the redirect design | P27-01 |
| **OA-5** | **Legal basis and contracts per facility**: a DPA operator ↔ platform; confirmation the operator's client contracts allow the transfer; facilities informed | UU PDP 27/2022 (UD-18) | P17-03 |
| OA-6 | Give 3–5 events whose real local time is known (with the operator) | UD-7 | P24-05 |
| OA-7 | SME answer on the meaning of the device's typed calibration date and the interval | UD-8 | P19-05 |
| OA-8 | Contact e-mails for facilities without a client account; the real person behind each shared account | UD-4, UD-11 | P24-02, P30-04 |

---

## 5. Cards (Phase 12)

Statuses as in `00-TASK-CONVENTIONS.md`. The cards of Phases 13 … 31 are in their own files (§ 2); the conventions below hold for all of them. **Spec refs** use `00 §`, `02 F-`, `03 Q-`, `04 §`, `05 §`
for the files in `docs/UPSTREAM/`. A card marked *spec required* writes `MEMORY/specs/<card>-<slug>.md` first.

### Phase 12 cards — Decisions & ADRs

**Goal:** no design or build starts on an unrecorded decision. **Spec refs:** § 3 above · 00 § 10 ·
04 § 9 · ADR-084 · ADR-064 · `docs/PLAN/10-TENANCY-AND-ONBOARDING.md`. **Size:** S.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P12-01 | Put the consolidated decisions to the owner; record each answer here with date | **WIP** — UD-1, UD-3, UD-6, UD-14 answered 2026-10-07; second batch the same day: Q-57·T (a) confirmed, UD-9 decided; 13 open | — |
| P12-02 | ADR: tenancy for a provider serving many facilities — **revised 2026-10-07 to the owner's model:** the provider is the tenant, facilities are `client_facilities` inside it, facility-bound users confined by a second deny-by-default scope (ADR-084 not amended) | **DONE 2026-10-07 — ADR-124** ([record](../MEMORY/records/2026-10-07-upstream-adrs.md)) | UD-1 |
| P12-03 | ADR: global versioned inspection catalogue without `tenant_id` (who writes, who publishes, how sessions pin a version) | **DONE 2026-10-07 — ADR-125** | UD-3 |
| P12-04 | ADR: an IPM session is an issued record — many per device, draft → submitted, correction supersedes, void, results immutable after submit; the "due" flag replaces the month rule; reports and exports rendered in the frontend (owner rule 2026-10-07) | **DONE 2026-10-07 — ADR-126** | UD-6 |
| P12-05 | ADR: imported identities — invitation, no hash import, performer snapshots for deleted users | BLOCKED | UD-4, UD-5 |
| P12-06 | ADR: public device page by capability token (exemption-list reason, rate limit, tenant setting) | BLOCKED | UD-15 |
| P12-07 | Carry every unanswered decision as a dated Open Question under Q-57 in `TASKS/BACKLOG.md` | **DONE 2026-10-07** — Q-57·UD-2 … Q-57·UD-18 (the 14 then open; UD-9 since decided) and Q-57·T (what ADR-124 asks the owner to confirm) | P12-01 |

**DoD:** every ADR has decision, rationale, alternatives (04 § 3 options A/B/C; 00 § 10 options 1–3)
and bad implications; `docs/` amendments named (SECURITY/05, MULTI-TENANCY, DATABASE/00) through the
deviation protocol; § 3 shows every answer with its date. **Abuse case:** starting Phase 20 because "the
owner already said yes" — the decision is not the ADR.

---

## 6. Group Exit

The group (Phases 12 … 31) is complete when P31-04 is DONE: every card DONE with its record, the reconciliation
and UAT signed, the security review closed, the upstream archived and its copies deleted. **Not
before** — Phase 999 waits on it (ADR-089).

---

## 7. Old → New Id Mapping (2026-10-07)

The rule is mechanical: **phase `UP-xx` → Phase `12 + xx`; card `UP-xx-yy` → `P(12+xx)-yy`** — the
card's sequence number is unchanged (UP-05-06 → P17-06, UP-09-09 → P21-09, UP-19-04 → P31-04).
Card content, status, dependencies (rewritten to the new ids), spec refs, sizes and DoD are carried
over unchanged. Dated records in `MEMORY/records/` and old `CHANGELOG`/`MEMORY-INDEX` entries keep
the `UP-` ids they were written with; use this table to resolve them. `UD-n`, `OA-n`, `Q-57·…`,
`S-`, `D-`, `F-`, `M`, `Q-n` (03) and `R-n` ids are **not** renumbered.

| Old phase | Title | New phase | File | Old cards | New cards | Count |
|---|---|---|---|---|---|---:|
| UP-00 | Decisions & ADRs | Phase 12 | [`PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) | UP-00-01 … UP-00-07 | P12-01 … P12-07 | 7 |
| UP-01 | Code Research | Phase 13 | [`PHASE-13-UPSTREAM-CODE-RESEARCH.md`](./PHASE-13-UPSTREAM-CODE-RESEARCH.md) | UP-01-01 | P13-01 | 1 |
| UP-02 | DB-Structure Research | Phase 14 | [`PHASE-14-UPSTREAM-DB-RESEARCH.md`](./PHASE-14-UPSTREAM-DB-RESEARCH.md) | UP-02-01 | P14-01 | 1 |
| UP-03 | Module Research | Phase 15 | [`PHASE-15-UPSTREAM-MODULE-RESEARCH.md`](./PHASE-15-UPSTREAM-MODULE-RESEARCH.md) | UP-03-01 | P15-01 | 1 |
| UP-04 | Feature Research | Phase 16 | [`PHASE-16-UPSTREAM-FEATURE-RESEARCH.md`](./PHASE-16-UPSTREAM-FEATURE-RESEARCH.md) | UP-04-01 | P16-01 | 1 |
| UP-05 | Security, Privacy & Data Protection | Phase 17 | [`PHASE-17-UPSTREAM-SECURITY-PRIVACY.md`](./PHASE-17-UPSTREAM-SECURITY-PRIVACY.md) | UP-05-01 … UP-05-07 | P17-01 … P17-07 | 7 |
| UP-06 | Role & Permission Mapping | Phase 18 | [`PHASE-18-UPSTREAM-ROLES-PERMISSIONS.md`](./PHASE-18-UPSTREAM-ROLES-PERMISSIONS.md) | UP-06-01 … UP-06-04 | P18-01 … P18-04 | 4 |
| UP-07 | Domain Design | Phase 19 | [`PHASE-19-UPSTREAM-DOMAIN-DESIGN.md`](./PHASE-19-UPSTREAM-DOMAIN-DESIGN.md) | UP-07-01 … UP-07-08 | P19-01 … P19-08 | 8 |
| UP-08 | DB-Structure Migration to Our Conventions | Phase 20 | [`PHASE-20-UPSTREAM-DB-MIGRATION.md`](./PHASE-20-UPSTREAM-DB-MIGRATION.md) | UP-08-01 … UP-08-09 | P20-01 … P20-09 | 9 |
| UP-09 | Backend Implementation | Phase 21 | [`PHASE-21-UPSTREAM-BACKEND.md`](./PHASE-21-UPSTREAM-BACKEND.md) | UP-09-01 … UP-09-10 | P21-01 … P21-10 | 10 |
| UP-10 | Frontend Implementation | Phase 22 | [`PHASE-22-UPSTREAM-FRONTEND.md`](./PHASE-22-UPSTREAM-FRONTEND.md) | UP-10-01 … UP-10-10 | P22-01 … P22-10 | 10 |
| UP-11 | Report & PDF Parity | Phase 23 | [`PHASE-23-UPSTREAM-REPORTS.md`](./PHASE-23-UPSTREAM-REPORTS.md) | UP-11-01 … UP-11-05 | P23-01 … P23-05 | 5 |
| UP-12 | Data ETL (incl. ~91 GB of Photos) | Phase 24 | [`PHASE-24-UPSTREAM-DATA-ETL.md`](./PHASE-24-UPSTREAM-DATA-ETL.md) | UP-12-01 … UP-12-05 | P24-01 … P24-05 | 5 |
| UP-13 | Reconciliation & Parity Verification | Phase 25 | [`PHASE-25-UPSTREAM-RECONCILIATION.md`](./PHASE-25-UPSTREAM-RECONCILIATION.md) | UP-13-01 … UP-13-04 | P25-01 … P25-04 | 4 |
| UP-14 | UAT With Real Users | Phase 26 | [`PHASE-26-UPSTREAM-UAT.md`](./PHASE-26-UPSTREAM-UAT.md) | UP-14-01 … UP-14-03 | P26-01 … P26-03 | 3 |
| UP-15 | QR Sticker Continuity | Phase 27 | [`PHASE-27-UPSTREAM-QR-CONTINUITY.md`](./PHASE-27-UPSTREAM-QR-CONTINUITY.md) | UP-15-01 … UP-15-04 | P27-01 … P27-04 | 4 |
| UP-16 | Mobile / Offline Decision | Phase 28 | [`PHASE-28-UPSTREAM-MOBILE-OFFLINE.md`](./PHASE-28-UPSTREAM-MOBILE-OFFLINE.md) | UP-16-01 … UP-16-03 | P28-01 … P28-03 | 3 |
| UP-17 | Training & Documentation in Indonesian | Phase 29 | [`PHASE-29-UPSTREAM-TRAINING-DOCS.md`](./PHASE-29-UPSTREAM-TRAINING-DOCS.md) | UP-17-01 … UP-17-04 | P29-01 … P29-04 | 4 |
| UP-18 | Cutover & Dual-Run | Phase 30 | [`PHASE-30-UPSTREAM-CUTOVER.md`](./PHASE-30-UPSTREAM-CUTOVER.md) | UP-18-01 … UP-18-05 | P30-01 … P30-05 | 5 |
| UP-19 | Decommission & Archive | Phase 31 | [`PHASE-31-UPSTREAM-DECOMMISSION.md`](./PHASE-31-UPSTREAM-DECOMMISSION.md) | UP-19-01 … UP-19-04 | P31-01 … P31-04 | 4 |
| | **Total** | | | | | **96** |

The DB agent's draft phases (04 § 12), merged in § 1:

| Draft | Now |
|---|---|
| UP-DB-1 | Phase 14 |
| UP-DB-2 | Phase 12 |
| UP-DB-3 | Phase 19 |
| UP-DB-4 | Phase 20 |
| UP-DB-5 | Phase 24 |
| UP-DB-6 | Phase 24 |
| UP-DB-7 | Phase 25 |
| UP-DB-8 | Phase 30 |
| UP-DB-9 | Phase 31 |
