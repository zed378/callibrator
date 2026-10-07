# 06 — Data Protection Impact Assessment: Migrating SKP IPM into Callibrator (P17-02)

> **Ringkasan (Bahasa Indonesia).** Penilaian dampak pelindungan data pribadi (*DPIA*, UU No.
> 27/2022 Pasal 34) atas pemindahan data produksi aplikasi upstream SKP IPM (±384 ribu baris,
> ±47 ribu foto alat / ±91 GB yang masuk storage — **PDF sertifikat (±11,9 ribu, 19 GB) tidak disimpan di aplikasi**, hanya di arsip luring terenkripsi (aturan pemilik: sertifikat dirender di frontend) — data pribadi staf: nama, e-mail, username; **tidak ada
> data pasien**) ke Callibrator, dan atas pemrosesan lanjutan sesudahnya. **Model tenant (koreksi
> pemilik 2026-10-07):** satu **tenant = perusahaan kalibrasi/pemeliharaan** (mis. SKP) yang
> melayani banyak faskes; setiap **faskes = entitas klien di dalam tenant penyedia**; staf faskes
> adalah pengguna tenant penyedia yang **wajib dibatasi ke faskesnya** (*faskes scope*). Peran
> yang **diusulkan**: faskes = **pengendali** data alat dan data stafnya; perusahaan kalibrasi
> (tenant) = **prosesor** bagi setiap faskes sekaligus **pengendali** data stafnya sendiri; operator
> platform Callibrator = **sub-prosesor** bagi tenant. Dasar pemrosesan: kontrak dan kepentingan
> yang sah — **bukan persetujuan**. Kontrol pemisah yang paling kritis kini adalah **faskes scope
> di dalam satu tenant**, bukan isolasi antar-tenant — risikonya dinilai tinggi dan memerlukan uji
> isolasi "dua faskes". Risiko tertinggi saat ini ada **di luar kode kita**: celah yang masih
> terbuka di situs upstream, rahasia yang ikut tersalin, dan salinan lokal 116 GB — tindakan
> pemilik (OA-1 … OA-3, [`10-OWNER-CHECKLIST.md`](./10-OWNER-CHECKLIST.md)). Bagian bertanda
> **⚖ perlu tinjauan hukum** wajib diperiksa penasihat hukum. Dokumen ini **bukan pendapat hukum**.

**Status: DONE 2026-10-07 as an assessment — PENDING LEGAL REVIEW** of every section marked ⚖.
No real data value appears here: structure, counts and code values only (sources: 03 § 9, 05 § 10,
00 § 9). Companions: [`07-DATA-MINIMISATION.md`](./07-DATA-MINIMISATION.md) (what is and is not
migrated) and [`08-FILE-POLICY.md`](./08-FILE-POLICY.md) (the ~58.6 k files). Record:
[`../../MEMORY/records/2026-10-07-upstream-privacy-and-reports.md`](../../MEMORY/records/2026-10-07-upstream-privacy-and-reports.md).

> **Tenancy model assessed.** The owner corrected UD-1 on 2026-10-07: **the tenant is the
> calibration company that serves health facilities**; each facility (*faskes*) is a **client
> entity inside the provider's tenant**; provider staff work across their tenant's facilities;
> facility staff are users of the provider's tenant **restricted to their own facility by a
> mandatory per-facility scope**. The tenancy ADR is being rewritten in parallel (P12-02, by
> another agent — cross-referenced, not edited here). Where `04-SCHEMA-MAPPING.md` § 3 and
> `05-DATA-MIGRATION.md` still describe "facility = tenant", **this document follows the owner's
> correction**; those documents are amended with the ADR.

> **Not legal advice.** This is a privacy-compliance assessment written from the code, the schema
> and the plan. Roles, lawful bases, residency, retention periods and notification duties below are
> **proposals** until Indonesian privacy counsel confirms them (P17-03). The UU PDP article
> numbers cited are the assessor's reading and are part of what counsel checks.

---

## 1. Scope

| | |
|---|---|
| Processing assessed | (a) the **one-off migration** (extract from the upstream dumps and files → stage → transform → load into **one provider tenant** with ~114 facility client entities, 05 § 3, Phase 24); (b) the **transition** (dual-run, upstream read-only, Phase 30); (c) **ongoing processing** of the migrated data in Callibrator (device register, IPM sessions, calibration dates, certificates/IPM reports, facility users restricted by facility scope); (d) **archive and destruction** of the upstream copies (Phase 31) |
| Not assessed here | the threat model of the new surfaces (P17-06, blocked on the P12-02 ADR) and the go/no-go security review (P17-07). They feed back into § 5 |
| Laws | **UU No. 27/2022 (UU PDP)** — primary; **PP 71/2019** (electronic systems: registration, data location for public-scope operators) ⚖; GDPR principles as the platform's existing posture (`docs/SECURITY/09-PRIVACY-DATA-PROTECTION.md`) — GDPR itself applies only if EU data subjects are involved (none expected) |
| Why a DPIA | UU PDP Art. 34 requires an impact assessment for high-risk processing (among others: large-scale processing, matching/combining datasets, new technology). Whether this migration meets a mandatory trigger is ⚖ — it is small in people (≈ 106 accounts) but moves a third party's whole database into a multi-tenant platform, puts **118 facilities' records into one tenant separated only by a new facility scope**, and moves 116 GB of photos that may incidentally show people. **It is assessed as if mandatory.** |

## 2. Description of the Processing

### 2.1 Data inventory (from 03 § 9; counts from the 2026-10-06 dump)

| Category | Where (upstream) | Volume | Personal? | Class (03 § 9) |
|---|---|---:|---|---|
| Staff identity: e-mail, username, full name, avatar | `users` | 106 accounts (76 without a full name — shared institutional accounts) | **yes** | PII |
| Credentials: password hash, reset/activation hashes, remember tokens | `users`, `auth_tokens` (empty) | 106 hashes | yes (secret) | Secret |
| Login history: e-mail, IP, user id, time, success | `auth_logins` | 12,191 rows; 4,220 distinct IPs | **yes** | PII |
| Reset/activation attempts (e-mail, IP, user agent) | `auth_reset_attempts`, `auth_activation_attempts` | 0 rows | yes | PII |
| Sessions and application logs | `writable/session/*`, `writable/logs/*` (files) | 507 + 1,205 files, 161 MB | **yes** | PII |
| Group membership, facility mapping | `auth_groups_users`, `trx_mapping_user_client` | 105 / 60 rows | yes (linked) | Attribution |
| Attribution of work: `id_user` on devices, IPM rows, calibration dates | `trx_inventory`, 16 `trx_*`, `trx_kalibrasi` | ~350 k rows carry an `id_user`; 13,169 IPM rows + 2,294 devices point at **deleted** users | pseudonymous | Attribution |
| Technician name printed on IPM reports and exports | rendered from `users.fullname` | — | **yes** | PII (derived) |
| Facility identity: name, phone, address, logo | `mst_faskes` | 118 | no (organisations) — confidential | Sensitive operational |
| Device register: type, brand, model, serial, QR, room, floor, condition, dates, lab | `trx_inventory` | 23,722 | no — confidential to the facility | Sensitive operational |
| Inspection / maintenance results | 16 `trx_*` | ~328 k rows, ~8,166 sessions | no (except attribution and notes) | Sensitive operational |
| Free text: session notes, rooms, catalogue notes | `trx_catatan.description` (625 non-empty), `nama_ruangan` | — | **possibly** (names typed in) | Free text (review) |
| Device photos (front, serial plate) | `public/uploads/foto_depan`, `foto_sn` | 50,098 files, 96.9 GB | **possibly** — people or patient areas in frame; EXIF may carry GPS, phone make/model, capture time (not measured) | Sensitive operational + incidental PII |
| Calibration certificates (external lab PDFs) | `public/uploads/inventory` | 11,923 files, 19.2 GB | possibly (signatory names of the lab) | Sensitive operational — **not stored in Callibrator** (owner rule 2026-10-07: certificates are rendered in the frontend; no certificate file in storage): encrypted offline archive only (07 § 4.1, finding F-CERT) |
| Original upload file names | `trx_inventory.foto_*` (≈ 3,600 keep the client's original name) | — | possibly (phone-generated names, sometimes names) | Free text (review) |
| Patient data | — | **none found**: no patient, medical-record or diagnosis column exists (03 § 9) | — | — |

**Data subjects:** provider staff (`admin` 10, `user` 35), facility staff (`client` 57,
`teknisi_client` 3), one account with no group (likely self-registered, see R-17), former users
known only by a legacy id, and incidental persons in photos or named in free text.

**Specific (sensitive) personal data (UU PDP Art. 4(2))** — health, biometric, genetic, criminal,
children, financial: **none by design.** Residual exposure: a device photo taken in a ward could
show a patient (health-related, ⚖). Treated as a risk (R-12), not as a processed category.

### 2.2 Parties and roles (proposed, for the corrected tenancy model) ⚖

| Party | In Callibrator | Role for facility records (devices, IPM, calibration) and facility staff accounts | Role for provider staff data (provider accounts, attribution of provider technicians) |
|---|---|---|---|
| **Health facility (*faskes*)** — ~114 with devices (UD-11) | a **client entity inside the provider's tenant**; its staff are users of that tenant with a mandatory facility scope | **Controller** (*Pengendali Data Pribadi*) — the records are the facility's device-maintenance evidence; its staff data is processed because the facility assigned them to use the service | recipient of the attribution printed on its reports |
| **Calibration company — the tenant** (SKP for this migration) | **the tenant** | **Processor** (*Prosesor Data Pribadi*) acting for each facility under its service contract; administers the facility users of its tenant on the facility's instruction | **Controller** of its own staff accounts and login history |
| **Platform operator (Callibrator)** | hosts the tenant | **Sub-processor** of the tenant (engaged by the processor) | **Processor** for the tenant |
| Infrastructure sub-processors (§ 2.4) | — | sub-processors of the platform | same |

Why this split, and the alternatives (for counsel):

- **Facility as controller** follows the purpose: the device register and IPM reports exist so the
  facility meets its own device-maintenance duties. The tenant (calibration company) decides how
  it delivers the service, not why the records exist.
- **Alternative A — the calibration company as controller (or joint controller) of the IPM records
  it authors** (its own work evidence as a service company; UU PDP Art. 18 joint control). The
  corrected model (records live in the company's tenant, the company administers them) makes this
  more plausible than before; ⚖ decide per the service contracts. If joint control applies, the
  arrangement must say who answers data-subject requests.
- **Alternative B — the company as controller of facility staff accounts** (it creates them to
  give facilities access to its service). Defensible for the account itself; the facility remains
  controller of the records those staff see. ⚖
- **Sub-processor approval.** UU PDP Art. 51–52 (as read) lets a processor engage another
  processor only with the controller's **written approval**. In this model the platform contracts
  **with the tenant**; each facility must approve (in its service contract with the company, or by
  the notification of UD-18 turning into an approval) that the company uses the platform. ⚖ **This
  is the most important legal question of the migration** — it is simpler than under the earlier
  facility-per-tenant model, because the platform has one counterparty per tenant.
- **63 facilities have no client account upstream** — their records still belong to them; ⚖
  whether the company's existing contracts already cover processing them in a new system.

### 2.3 Purposes

1. Continue the facilities' device inventory and inspection/preventive-maintenance (IPM) records
   in a system with isolation, audit and record integrity (ISO 17025, 21 CFR Part 11 posture) — the
   same purpose as upstream (**purpose limitation:** no new purpose is added).
2. Let the company's staff keep doing the work across the facilities they serve, and let facility
   staff see their own facility's records only.
3. Reconcile the migration (prove nothing was lost or altered) — temporary, ends at sign-off.

Not purposes: analytics across facilities beyond the company's own service reporting, marketing,
AI/LLM processing of imported records (§ 2.4), profiling of staff. Technician activity lists (F-73)
are an existing upstream feature (work attribution), not performance scoring.

### 2.4 Recipients, locations and transfers ⚖

| Recipient / location | What reaches it | Evidence in the repository | Transfer question |
|---|---|---|---|
| Upstream hosting (live site) | everything (source) | `info.php` / `.env` in the fork; host not recorded | location unknown to the repo — owner confirms |
| Owner's workstation (`mozivid/`) | 36 dumps + 116 GB files | `.gitignore`; 05 § 10 | domestic, but **Documents may be synced** (OneDrive Known Folder Move) and Defender may submit samples — R-02 |
| Reference deployment VM (PostgreSQL 18, `STORAGE_DRIVER=local`, `db-backup` dumps on the same host) | the migrated database and files | `deploy/compose/docker-compose.vm.yml`; MEMORY `vm-deployment` | **physical location not recorded** (private address) — owner confirms it is in Indonesia |
| **Cloudflare Tunnel** in front of the VM (public hostname) | every request and response of every user: **TLS ends at Cloudflare's edge**, so personal data is readable there | MEMORY `vm-deployment` | a US-headquartered sub-processor; edge location not guaranteed to be Indonesian → **cross-border transfer** (UU PDP Art. 56) unless counsel concludes otherwise; DPA with Cloudflare required |
| SMTP relay (invitations, ~105 e-mails) | name, e-mail, single-use link | `docs/SECURITY/09` § Data Location | provider and location not recorded |
| LLM endpoint (`OPENAI_BASE_URL`, per-tenant override) | only what a user explicitly sends (certificate OCR, RAG ingest) — **nothing automatically** (`ai.service.ts` ingests on explicit call only) | `backend/src/services/ai.service.ts` | **rule for this migration:** the ETL never calls AI; the imported tenant keeps AI features off until counsel clears the transfer |
| Object storage (if moved off `local`) | the files | `docs/STORAGE/04` | an S3 region must be Indonesian or the self-hosted store (UD-18) |
| Docker Hub | images only, **no data** | ADR-123 | none |

**Residency recommendation (UD-18):** database, objects and backups on infrastructure physically in
Indonesia; ETL traffic over the private network or SSH, **never through the public tunnel**; a
documented decision on the tunnel (keep with a Cloudflare DPA and a transfer assessment, or replace
by a domestic reverse proxy) **before the first real-data dry run (P24-05)**. ⚖ Facilities that
are **public-scope electronic-system operators** (government hospitals, health centres, district
health offices are among the 118) may be bound by PP 71/2019 to keep their data in Indonesia —
counsel to confirm whether that binds a processor holding their device records.

### 2.5 Data flows

```
 LIVE UPSTREAM (CodeIgniter 4, MariaDB skp_ipm, public/uploads 116 GB)        controller: each faskes / SKP
   │  daily mysqldump  +  file copy (owner)                                   OA-1/OA-2 close the holes first
   ▼
 OWNER WORKSTATION  mozivid/  (36 dumps, 116 GB)  ── must be encrypted (OA-3), excluded from cloud sync
   │  read-only, 127.0.0.1-bound throwaway containers only (research done this way, records 2026-10-07)
   ▼
 ETL HOST (throwaway, encrypted volume)                                       platform as sub-processor
   │  extract → upstream_stage.* (text) → transform (07: drop / transform / keep)
   │  photos: allow-list → ClamAV → SHA-256 → put → derivatives (08)
   │  certificate PDFs: type check → ClamAV → SHA-256 → ENCRYPTED OFFLINE ARCHIVE only (never the app store)
   │  quarantine + id_map in upstream_import (NOT granted to callibrator_app)
   │  ── SSH / private network, never the public tunnel ──
   ▼
 CALLIBRATOR (PostgreSQL 18 + object storage)
   └── TENANT = the calibration company (SKP)          ← tenant hooks: deny-by-default, cross-tenant 404
         ├── faskes client entity × ~114               ← FACILITY SCOPE: the separation control that matters here
         │     ├── devices, IPM sessions, calibration dates, attachments (faskes_id on every row)
         │     ├── objects under t/<tenant>/f/<faskes>/…  (08 § 7)
         │     └── facility users ── restricted to THIS faskes (mandatory scope) — see own records only
         ├── company staff (admin / technician) ── work across the tenant's faskes (role-gated)
         └── public capability page (UD-15, minimal) ◄── QR sticker scan by anyone
   │
   ├──► users: browser via Cloudflare Tunnel (TLS ends at the edge) ⚖
   ├──► SMTP: invitations
   └──► reports/exports: rendered IN THE BROWSER (jsPDF / client-side XLSX, 09) from API data — no report or export file is stored; one faskes per document
 REQUESTS & INCIDENTS: data subject → faskes (controller) ↔ tenant (processor) ↔ platform (sub-processor)
 ARCHIVE (P31-01): encrypted upstream dump + files for the retention period → destroyed
 DESTRUCTION (P31-03): mozivid/, staging volumes, upstream_import, upstream host
```

## 3. Lawful Basis per Category (UU PDP Art. 20(2)) ⚖

Consent (Art. 20(2)(a)) is **deliberately not used**: staff cannot freely refuse their employer's
work system (power imbalance), and a withdrawal would oblige deleting the attribution that makes a
maintenance record evidence. Every basis below is to be documented by the controller named.

| Category | Controller (proposed) | Basis (proposed) | Notes |
|---|---|---|---|
| Facility staff accounts (e-mail, username, name) | facility (account administered by the tenant as processor; Alternative B in § 2.2) | **contract** (Art. 20(2)(b): the staff member's employment/assignment; the system is their work tool) and **legitimate interest** (2(f)) in continuity of access | invitation re-confirms the person and the e-mail (UD-5) |
| Company (tenant) staff accounts | the company | contract (employment) + legitimate interest | |
| Attribution on records (who inspected, who entered a calibration date) | facility (records) / company (its staff) | **legitimate interest** in record integrity; **legal obligation** (2(c)) where device-maintenance rules require attributable records ⚖ (health-facility device maintenance and calibration rules — counsel names them) | attribution is the reason erasure anonymises, not deletes (§ 7) |
| Device, inspection and calibration records | facility | not personal data except attribution and free text; confidentiality duty under the service contract | |
| Free text (notes, rooms) | facility | legitimate interest; **flagged for the facility's review** after import (05 § 10) | never copied into logs or reports |
| Device photos | facility | legitimate interest (identification and evidence) with the safeguards of 08 | incidental persons: R-12 |
| Certificate PDFs (archive only) | facility | legal obligation / legitimate interest in keeping calibration evidence for its retention period ⚖ | not processed in the application; retrieval on request is logged (07 § 4.1) |
| Login history, IPs, sessions, logs, hashes | the company | **no basis for migration** — the purpose (authenticating to upstream) ends at cutover | **not migrated** (07) |
| Migration-only data (id map, source hashes, quarantine) | platform on the tenant's instruction | legitimate interest in proving a correct migration | deleted at sign-off + 90 days (§ 6) |

## 4. Necessity and Proportionality

- **Minimisation is decided, per table and per file class**, in [`07`](./07-DATA-MINIMISATION.md):
  login records, IPs, sessions, logs, every credential, original upload names, profile images,
  upload-log tables, unreferenced files and the non-allow-listed files are **not migrated**.
- **Less intrusive alternatives considered:** (a) starting the facilities empty — rejected, the
  device history is the facilities' maintenance evidence; (b) importing aggregates only — rejected
  for the same reason; (c) importing password hashes to spare ~105 e-mails — rejected (UD-5:
  invitation); (d) **one tenant per facility** (the earlier UD-1) — superseded by the owner's
  correction; from a privacy view it gave a stronger separation (tenant hooks) at the cost of a
  cross-tenant working path for the company; the corrected model puts all facilities of a company
  in one tenant, so **the facility scope must be built to the same standard as tenant isolation**
  (R-04).
- **Accuracy (UU PDP Art. 29 as read):** the ETL corrects nothing silently: timezone confirmed by the
  operator (UD-7), duplicates and anomalies reported per facility (P25-02), every row loaded,
  merged or quarantined with a reason (05 § 1).
- **Data-subject expectations:** facility staff and company technicians expect their names on the
  reports they sign — the IPM report prints the technician (09 § 2). They do **not** expect their
  name to be shown to anyone scanning a sticker, which upstream does today (S-06); our public page
  shows no person by default (UD-15). Facility staff expect to see **their** facility only, never
  another client of the same company.

## 5. Risk Assessment

Likelihood (L) and impact on individuals (I) on 1–5; score = L × I. **≥ 15 = blocks the next
real-data step until mitigated.** "Owner" = an action outside the codebase (§ 4 of the plan).

| # | Risk | L | I | Score | Mitigation | Card / owner | Residual |
|---|---|---:|---:|---:|---|---|---:|
| R-01 | **Upstream is exploitable today**: open self-registration + `login`-only routes leak any facility's inventory XLSX and IPM reports; IPM/PDF/QR pages public by sequential number; development mode leaks stack traces; `phpinfo()` public (S-02…S-06) | 5 | 4 | **20** | close registration, require a role on the public and export routes, production mode, delete `info.php` | OA-2, [`10`](./10-OWNER-CHECKLIST.md) § 2–5 | 6 after OA-2 |
| R-02 | **Local copy leaks** (workstation loss, OneDrive/backup sync of `Documents`, antivirus sample upload, a mistaken `git add`) — 116 GB incl. staff PII | 3 | 4 | 12 | encrypt at rest (BitLocker/VeraCrypt), exclude from sync and sample submission, keep gitignored, never `git add -A`, delete after cutover | OA-3, 10 § 8–9; P31-03 | 4 |
| R-03 | **Secrets disclosed** (DB password and `JWT_SECRET` in `.env` of the fork, S-01) → direct DB access to the live upstream | 4 | 4 | **16** | rotate both; confirm `.env` not web-reachable; DB not exposed publicly | OA-1, 10 § 6–7 | 4 |
| R-04 | **Cross-facility exposure inside the company's tenant.** All ~114 facilities' records sit in one tenant; the tenant hooks do **not** separate them. A facility user (or an export, a list, an include, a raw-SQL report, a socket room, a storage key) that misses the facility predicate shows one client's devices, reports, photos and staff names to another client — the upstream S-05 defect class, and the A-87 class of bug in our own history (00 § 10 option 2 named exactly this) | 4 | 4 | **16** | (1) the facility scope **enforced centrally and deny-by-default** like the tenant hooks (a facility user with no resolvable facility sees nothing), not by per-query `where`; (2) **"two-faskes" isolation tests** — for every route, export, report, include, raw-SQL statement and socket room that returns facility data: a user of faskes A asking for faskes B's row gets **404** (same shape as not-found), lists never contain B's rows, exports contain only A — modelled on `twoTenantSuite`, plus a **guard test** that fails on a new facility-data route without one (like `twoTenantRoutes.guard`); (3) `faskes_id` NOT NULL on every facility-owned row, composite `(tenant_id, faskes_id, …)` keys where rows reference each other; (4) storage keys with a facility segment **and** an authorisation check on the row's facility (08 § 7); (5) threat model (P17-06) and pen test (P17-07) of the scope; (6) facility users never get a "switch facility" | P12-02 (ADR), P17-06/07, P18-04 test plan, Phases 20/21 | 6 |
| R-04b | **Cross-tenant exposure** between calibration companies or hospital tenants (existing tenant isolation) | 2 | 5 | 10 | existing deny-by-default hooks, two-tenant 404 tests, `twoTenantRoutes.guard` — unchanged | existing | 4 |
| R-05 | **Malicious or active content migrated** (the shell script and text file in the public certificate folder, SVG, polyglots; PDF active content is **out of the application** since certificate PDFs are archive-only) | 1 | 4 | 4 | content allow-list by magic bytes, ClamAV before the object is reachable, PDF active-content flagging, quarantine, never migrate the script | [`08`](./08-FILE-POLICY.md) | 2 |
| R-06 | **Over-collection**: login history, IPs, hashes, sessions or logs carried "just in case" | 3 | 3 | 9 | minimisation list with a reason per item; the ETL has no extract step for them; reconciliation proves their absence | [`07`](./07-DATA-MINIMISATION.md); P25-01 | 1 |
| R-07 | **Technician identity over-exposed**: names on public pages, in exports with permanent photo URLs | 3 | 3 | 9 | public page without persons (UD-15); exports carry signed expiring links or none (09 § 4); attribution through a performer snapshot (07 § 3) | P19-07, P21-06 | 2 |
| R-08 | **Cross-border transfer without a basis** (Cloudflare edge, SMTP, LLM, storage region) | 3 | 3 | 9 | residency decision (§ 2.4); DPAs with sub-processors; ETL off-tunnel; AI off for the imported tenant | UD-18, P17-03 ⚖ | 3 |
| R-09 | **Data subjects not informed** — facility staff and company technicians learn of the move from an invitation e-mail | 4 | 3 | 12 | facility notification text (ID) before cutover, sent through the tenant; privacy notice naming controller, processor and sub-processor (Q-42 deliverable); invitation e-mail links it | P17-03, OA-5 ⚖ | 3 |
| R-10 | **Rights answered too slowly**: UU PDP sets short windows (3 × 24 hours for several rights, as read) while our DSAR workflow follows GDPR's one month; the request now travels faskes ↔ tenant ↔ platform | 3 | 3 | 9 | counsel confirms the window per right; DSAR SLA and alerting set to the shortest applicable; each hop forwards within one working day (§ 7) | § 7; P17-03 ⚖ | 3 |
| R-11 | **Retention drift**: `upstream_import`, quarantine, the archive and local copies kept indefinitely; a facility leaving the company with its data still in the tenant | 3 | 3 | 9 | dated retention per store (§ 6); a **facility off-boarding path** (export to the facility, then delete or anonymise its scope) specified in Phase 19 | Phase 31, Phase 19 | 2 |
| R-12 | **Incidental personal data in photos / free text** (people, patients in a ward, names in notes; EXIF GPS/phone model) | 3 | 3 | 9 | photos never public by default (UD-15); display derivatives stripped of metadata; originals by signed download only; aggregate EXIF survey in the dry run; free text flagged for facility review and kept out of logs | 08 § 4; 05 § 10 | 4 ⚖ |
| R-13 | **Inaccurate records after migration** (timezone shift moves sessions across dates; dropped rows; **a device attached to the wrong facility**) | 3 | 3 | 9 | UD-7 confirmation; reconciliation R-1…R-12 run **per facility**; `faskes_id` taken from the upstream device row, never inferred; dry run until green | P24-05, Phase 25 | 2 |
| R-14 | **Interception or loss in transfer** of ~91 GB of photos (and of the archive copy of the PDFs) | 2 | 4 | 8 | SSH/rsync or TLS to the store; checksum at source and after put; no copy through third-party file-sharing | 08 § 9 | 2 |
| R-15 | **Real data left in throwaway environments** (Docker volumes, scratch dirs, CI) | 3 | 3 | 9 | containers bound to 127.0.0.1, removed by name with their volumes; scratch deleted; no real data in CI/fixtures (phase DoD) | P24-05 records | 2 |
| R-16 | **Upstream stays exposed after cutover** (read-only window, forgotten host) | 3 | 4 | 12 | OA-2 holds through the dual-run; decommission date; host retired (P31-02) | P30-05, Phase 31 | 3 |
| R-17 | **A breach may already have happened**: registration was open with no activation, and one account has **no group** (03 § 2) — consistent with a self-registered account that the `login`-only routes admit | ? | 4 | **unknown** | owner reviews that account and the access logs of the export/report routes now; if personal data was accessed without authority, the controllers' **3 × 24 h** notification duty may apply (§ 8) | OA-2, 10 § 3 ⚖ | — |

**Effect of the owner's certificate rule (2026-10-07).** Keeping no certificate file in the
application removes ~11.9 k PDFs (19 GB) from the online store: the PDF active-content surface (R-05)
and the lab signatories' names leave the application, and the stored volume falls to ~91 GB of
photos. The cost moves to availability: the external certificates are retrievable only from the
offline archive (07 § 4.1) — a facility-facing service question, not a confidentiality risk.

**Above the threshold today:** R-01, R-03 (owner actions), **R-04 (the facility scope — blocked
until the tenancy ADR, the threat model and the two-faskes test plan exist)**, R-17 (unknown until
the owner checks). **No real-data dry run (P24-05) starts while any of R-01, R-03 or R-17 is
open, and no facility user is invited before R-04's mitigations (1)–(4) are proved by named
tests.**

## 6. Retention ⚖

| Store | Kept until | Then | Basis |
|---|---|---|---|
| Migrated device, IPM and calibration records | the facility's retention schedule for device-maintenance records (⚖ counsel/the facility names the rule); our default keeps calibration records and certificates (`docs/SECURITY/09` § Retention) | per tenant `data_retention_policies` (a per-facility policy may be needed — Phase 19); legal hold outranks | controller's obligation |
| A facility that ends its contract with the company | export handed to the facility; then its scope deleted or anonymised per its instruction (⚖ the company may need to keep its own work evidence — Alternative A) | — | controller's instruction |
| Migrated user accounts | while the account is active; erasure **anonymises** (users are never hard-deleted) | — | |
| Performer snapshots on issued reports | with the report | anonymised on erasure **unless** the report is an issued, signed record (evidence exemption, ADR-107 precedent) ⚖ | legal obligation / legal claims |
| `upstream_import.id_map`, quarantine, file manifest | reconciliation sign-off (P25-04) **+ 90 days** | archived with the upstream snapshot (encrypted), schema dropped (P31-02) | 05 § 10 |
| Upstream archive (dump + files, encrypted, P31-01) | **proposal: 1 year after cutover**, or the company's schedule if longer and justified — **except the certificate PDFs**, which are the only copy of the external-lab certificates (F-CERT) and are kept for the facilities' calibration-evidence retention period ⚖ | destroyed, key destroyed, record written | dispute window ⚖ |
| `auth_logins`, sessions, logs | not migrated; exist only in the upstream archive | destroyed with it | — |
| Owner's `mozivid/` copy and every staging volume | cutover + archive verified (one restore tested, P31-01) | deleted (10 § 9); deletion recorded | 05 § 10 |
| ETL logs and reports | permanent in records — **aggregates only** | — | — |

## 7. Data-Subject Rights (UU PDP Art. 5–13 as read; GDPR equivalents)

**Request flow:** a data subject may contact the facility (controller), the company (tenant,
processor) or the platform. Whoever receives it forwards it **within one working day** along the
chain **faskes ↔ tenant ↔ platform**; the facility decides, the tenant executes in its tenant, the
platform assists (and executes only on the tenant's instruction). A request touching the
company's **own** staff data is decided by the company.

| Right | How it works after migration | Who decides / executes |
|---|---|---|
| Information (privacy notice) | notification to facilities before cutover, sent by the tenant (P17-03) + privacy notice naming controller, processor and sub-processor (Q-42 deliverable) | facility; tenant sends; platform supplies the text |
| Access and copy, portability | the existing GDPR export: `POST /api/v1/gdpr/export` builds the subject's archive; **downloaded only through `GET /gdpr/exports/:exportId/download`, the subject's own archive, one 404 for everything else, audited before it is sent (ADR-114)**. Imported users are ordinary users of the tenant, so it covers them | subject self-service; facility/tenant on request |
| Rectification | profile edit; the invitation step lets the 76 users without a full name correct the name derived from the username (04 § 6) | subject / tenant admin |
| Erasure / termination | **anonymises** the user (name, e-mail cleared; id kept so records stay attributable) — `docs/SECURITY/09` § Erasure versus Part 11. **Gap to close in P19-02:** performer snapshots are a second copy of the name; the erasure path and the DSAR export must cover them | facility decides (company decides for its staff); tenant executes |
| Restriction, objection | existing `dsar_requests` types | as above |
| Data that never migrated (login history, upstream logs) | a request during the transition goes to the **company** (controller of that data); after destruction there is nothing to return | company |

**Timelines ⚖:** UU PDP sets windows as short as **3 × 24 hours** for several rights (as read);
with a three-party chain, the processor and sub-processor contracts must commit to forwarding
within one working day and to executing an instructed erasure or export within the controller's
window.

## 8. Breach Notification

- **UU PDP Art. 46 (as read):** a personal-data breach → **written notice within 3 × 24 hours** to
  the data subjects **and** the supervisory agency (*Lembaga*), stating what data was disclosed,
  when and how, and what is being done; in some cases also to the public. ⚖ counsel confirms when
  the clock starts (awareness) and the agency's channel at the time.
- **Flow:** platform → **tenant within 24 hours** of awareness → tenant → **each affected
  facility** (the controller) without delay, scoped by facility from `audit_logs` (append-only) so
  each facility learns only about its own records → facility notifies subjects and the agency. A
  breach of the company's own staff data is the company's to notify.
- **Scoping by facility is part of the response:** an incident inside one tenant must be answerable
  "which facilities were affected" from the audit trail (the audit row must carry the facility —
  requirement for Phases 19/21).
- **Our incident response** (`docs/SECURITY/12-INCIDENT-RESPONSE.md`) states GDPR's 72 hours to the
  authority; for Indonesian data the same window applies **to subjects as well as the authority**.
  That document is being amended by the parallel docs/SECURITY work — **cross-reference only**; the
  follow-up is listed in the record.
- **Upstream before cutover:** the live upstream is the company's system; a breach there is the
  company's (and the facilities') to notify. R-17 is the open question the owner must answer first.

## 9. DPO and Contacts ⚖

| | |
|---|---|
| Platform | designate a **personal-data protection officer** (*pejabat/petugas PDP*, UU PDP Art. 53) — recommended even if not mandatory, because the platform processes for every tenant's clients. Name and contact address: **to be named by the owner** (OA-5); published in the privacy notice |
| Tenant (calibration company) | names its contact for facility requests and for its own staff data |
| Facilities | facilities providing a **public service** (government hospitals, health centres, district offices) are likely obliged to have their own officer (Art. 53(1)(a), as read) — the notification asks each facility for its contact |
| Escalation | rights requests and incidents: one working day per hop; incidents to the tenant within 24 h |

## 10. Consultation Needs

| With | About | When |
|---|---|---|
| **Indonesian privacy counsel** | every ⚖ item: roles under the corrected model, joint control of IPM records, the facilities' approval of the platform as sub-processor (§ 2.2), lawful bases (§ 3), residency, Cloudflare and PP 71/2019 (§ 2.4), retention and facility off-boarding (§ 6), rights windows (§ 7), breach duties and R-17 (§ 8), DPO (§ 9) | before P17-03 is closed, and before P24-05 |
| SKP (the first tenant) | its client contracts permit processing in the platform (OA-5); its retention schedule; the account review (R-17) | now |
| Facilities' officers | notification/approval; controller contact; free-text review after import | before cutover (P30-01) |
| Electronic-system registration | whether the platform (and the company) must register as private-scope electronic-system operators (PP 71/2019) ⚖ | before go-live |
| Supervisory agency | UU PDP has, as read, **no prior-consultation step like GDPR Art. 36**; the internal gate (score ≥ 15 blocks) replaces it. Counsel confirms | — |

## 11. Measures Summary (what makes the residual risk acceptable)

| Technical | Organisational | Contractual |
|---|---|---|
| tenant isolation hooks (unchanged) **plus a central, deny-by-default facility scope**; two-tenant **and two-faskes** 404 tests with guards | owner actions OA-1…OA-3 before any real-data step | DPA company ↔ platform (OA-5) |
| minimisation by construction (no extract for the dropped tables) | throwaway environments removed by name; no real value in the repository | facility approval of the platform as sub-processor |
| file allow-list, ClamAV fail-closed, SHA-256, signed downloads, metadata-free derivatives, facility segment in keys | operator reviews quarantine and the per-facility data-quality report | sub-processor DPAs (tunnel, SMTP, storage) |
| invitation instead of hash import; audit row per imported row, carrying the facility | training on "correct, don't overwrite" (Phase 29) | retention, off-boarding and destruction dates |
| encrypted volumes for staging, store and backups (08 § 8) | destruction recorded (P31-03) | breach and request timelines along the chain |

## 12. Assessor's Opinion and Sign-off

The migration **can be carried out lawfully as designed**, provided that: (1) OA-1 and OA-2 are
done and R-17 is answered before any further copy of real data is made; (2) OA-3 is done now;
(3) counsel confirms the role model — in particular the facilities' approval of the platform as
the company's sub-processor — and the residency position on the tunnel, **before the first
real-data dry run**; (4) **the facility scope is specified in the tenancy ADR, threat-modelled
(P17-06), proved by two-faskes tests and a guard, and pen-tested (P17-07) before any facility
user is invited.**

| Sign-off | Name | Date | State |
|---|---|---|---|
| Assessment written | coordinating agent (privacy role) | 2026-10-07 | done (revised the same day for the owner's tenancy correction) |
| Legal review | Indonesian privacy counsel | — | **pending** (P17-03) |
| Controller acceptance | facilities (through the tenant's notification); the company for its staff data | — | pending (OA-5) |
| Owner acceptance of residual risk | owner | — | pending |
