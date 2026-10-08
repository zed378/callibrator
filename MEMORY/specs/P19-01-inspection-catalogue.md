# Feature Spec — P19-01 The Inspection Catalogue: Device Types, Item Library, Versioned Templates, Proposals, Typed Items and Limit Parsing

**Written:** 2026-10-07 — **before** implementation. **Everything in this spec is TARGET: nothing here is built.**
**Task:** P19-01 (Phase 19, Domain Design). Builds in P20-01, P20-03 (migrations), P21-01 (API), P22-01 (operator UI), P24-02 (seeding from the upstream); consumed by P19-02 (IPM aggregate), P19-06 (IPM report), P19-08 (offline capture)
**Author:** software-architect agent, under the owner's standing delegation (decide by best practice, record it)
**Spec refs:** ADR-125 (the catalogue — this spec implements it) and **ADR-125 Amendment 1** (written with this spec, `MEMORY/DECISIONS.md`) · ADR-124 § 5, § 7, § 10 (global models and the facility dimension) · ADR-126 § 1, § 3, § 7, § 8 (sessions pin a version; reports rendered in the frontend) · ADR-127 § 1, § 4, § 8 (offline catalogue download) · ADR-062 (the append-only trigger pattern, migration 0057) · ADR-095 §4, ADR-107 (data document + hash) · ADR-064 §1, D-16, D-17 (global tables guarded at the route) · ADR-100 Am. 3 (indexes in the migration) · `docs/UPSTREAM/02-FEATURES.md` F-19 … F-22, F-31, F-36 … F-46, F-79 · `03-DATABASE.md` § 4.3 … 4.6, Q-20 … Q-24 · `04-SCHEMA-MAPPING.md` § 4.2 … 4.5, § 5 · `07-DATA-MINIMISATION.md` (catalogue rows) · `09-REPORT-LAYOUTS.md` § 2.2 (section order) · `TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md` § 2 (group DoD), § 3 (design questions that are ours)
**Card scope (verbatim):** *"Catalogue spec per ADR-125: `device_types`, `inspection_item_definitions`, `inspection_templates` / `_versions` / `_items` (replacing 04's `device_type_inspection_items`), proposals; typed items (tri-state, measured-with-limit, setting/measured/reference); limit parsing."*
**Threat model:** the facility dimension and the new surfaces are threat-modelled by **P17-06** (another agent, in parallel; `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md`, being written at the time of this spec). This spec cross-references it and does not duplicate it; § 9 lists what P17-06 should look at here.

> **Privacy.** No upstream data value appears here. The limit *shapes* in § 6 were derived by replacing every digit of the upstream reference texts with `N` and counting the shapes (catalogue reference data, `03-DATABASE.md` § 9 "Reference — non-confidential"); every number in the examples is synthetic.

---

## 1. Problem

Every IPM session is a checklist whose items depend on the device type (F-20) plus common sections (F-21). The upstream keeps 344 device types and ~480 items in 12 `mst_*` tables and 5 `mapping_*` tables, writable only by seeders and SQL (drift D-10), and re-renders every past report from current rows — so changing a mapping silently rewrites history. Callibrator has none of it: no device type, no checklist, no template, no limit.

Personas: the **platform operator** (super admin) curates the catalogue; the **provider's administrator** proposes changes; **technicians** (provider staff, unbound) and **facility technicians** (bound, ADR-124) read the published checklists online and offline; the **report renderer** (P19-06) reads the exact version a session pinned.

---

## 2. What `docs/` Already Decides (not re-decided here)

| Decision | Source |
|---|---|
| One **global** catalogue without `tenant_id` and without `client_facility_id`; five global tables; writes super-admin only; held route by route by `inspectionCatalogueGlobal.guard` (shape of `rolesGlobal.d16`) | ADR-125 § 1, § 4; ADR-124 § 5 ("global models are untouched by either dimension") |
| Versions `draft → published → retired`; **exactly one published per template**; a published version is **immutable and self-contained** (items copied in; the base template materialised at publish); `content_hash` SHA-256; `change_note` required to publish; nothing hard-deleted | ADR-125 § 1 – § 2 |
| 04's `device_type_inspection_items` is **replaced** by `inspection_template_items`; the ETL seeds version 1 of each type | ADR-125 § 1; `04` § 4.5 note |
| Sessions pin `template_version_id` (RESTRICT); results pin `template_item_id` + a label snapshot; a retired version stays valid: **409** to *start* on it online, accepted from an offline capture | ADR-125 § 3; ADR-126 § 1; ADR-127 § 8 |
| Tenants propose through the **tenant-scoped** `inspection_template_proposals`; drafts never visible to tenants; the operator strips identifying text on acceptance | ADR-125 § 5 |
| `GET /api/v1/ipm/templates/published` with a strong `ETag` over the sorted `(version id, content_hash)` set, `304` on `If-None-Match` | ADR-125 § 6; F-79; ADR-127 § 4 |
| The hooks scope a model iff it declares `tenantId`/`tenant_id` (`backend/src/utils/tenantScope.util.ts#tenantKeyOf`, line 122); catalogue models declare neither (nor `clientFacilityId`) and must never; added to `UNSCOPED` in `unscopedModels.d17` as group `"global"` | ADR-125 § 7; `backend/src/tests/models/unscopedModels.d17.test.js` |
| **No association declared from a catalogue model to a tenant model** (no `DeviceType.hasMany(CalibrationDevice)`) | ADR-125 § 7 |
| Catalogue read routes with a path parameter: `twoTenantRoutes.guard` allow-list kind `not-tenant-owned`; mutating ones `platform`; proposal routes get `twoTenantSuite` 404 tests | ADR-125 § 7; `backend/src/tests/guards/twoTenantRoutes.guard.test.ts` (kinds, line 58) |
| Audit for every publish/retire under the **PLATFORM** tenant, inside the transaction, with version id and content hash; `audit_logs.action` is the closed ENUM (`CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `APPROVE`, `EXPORT`, …) with `changes.operation` naming the act | ADR-125 § 4; `backend/src/constants/auditActions.ts`; precedent `roles.service.ts` (`PLATFORM_TENANT_ID`, `operation: "CREATE_ROLE"`) |
| Reports and exports are rendered in the frontend from API reads; no stored file | ADR-126 § 8; ADR-095 §4 |
| Decimal comma in measured values (4,148 of 13,470 performance rows); non-numeric values kept as raw text (~1,550 performance, 6,941 of 32,439 electrical safety); environment out of a plausible range NULLed with the raw kept; 5 case/space duplicate type groups | `03` Q-21 … Q-24; `04` § 2 |
| Request validation is Zod via `validate(schema, { from })`; `.ts` handlers read `validated(req, schema)`; contracts live in `@callibrator/contracts`; a route's contract is its `*.openapi.ts` | CLAUDE.md; ADR-093, ADR-097, ADR-103 |
| List order ends in `id` (`pageOrderTiebreaker.ci3.guard`); rows in `data`, paging in top-level `meta`; `DEFAULT_LIMIT` 25, `MAX_LIMIT` 200 | `88e198c`; `packages/contracts/src/pagination.ts` |
| A single document (not a list) may hold arrays inside `data` | A-343 (CLAUDE.md § The Response Envelope) |
| `dynamicAccess` accepts an **array** of menu slugs (any of them grants) | `backend/src/middlewares/dynamicAccess.middleware.ts` line 199 |

### Gaps and contradictions found — resolved by ADR-125 Amendment 1 (deviation protocol)

| # | What `docs/` says | What is true / missing | Resolution |
|---|---|---|---|
| G-1 | `04` § 5: physical and consumable codes `1 / 0 / -1` → `pass / fail / not_applicable` | The upstream report prints physical as **Baik / Cacat-Rusak Ringan / Rusak Berat** and consumable as **Iya / Tidak / Habis** (`app/Views/ipm/pdf_ipm.php`, read 2026-10-07): `-1` is *heavy damage* / *empty*, not "N/A". 04's mapping would have turned every heavily damaged device into "not applicable" | outcome vocabulary per section (§ 5); `04` § 5 amended |
| G-2 | ADR-125 § 6 and the Phase 12 DoD name the menu **`equipment`** as a read gate | `equipment` is the **parent menu**; device routes are gated by **`calibration`** (`calibrationDevices.route.ts`); `equipment` gates only attachments | read gate `["calibration", "ipm", "ipm-templates"]` (§ 8) |
| G-3 | ADR-125 § 1: `inspection_item_definitions` is `section`, `label`, `input_kind`, `limit_op/limit_value/limit_unit`, …; `04` § 4.4 has `applies_to_all_types` (`flag`) | One `limit_value` cannot hold a range (`10 – 45`) or a tolerance around a nominal (`± N %` — the commonest upstream shape, § 6); `flag` is replaced by base-template membership; no hard/soft input ranges for humidity etc. | structured limit columns, `valid_*`/`warn_*` ranges, `flag` dropped (§ 4) |
| G-4 | ADR-125 § 1: `device_types` unique `WHERE deleted_at IS NULL` (paranoid); `04` § 4.3 lists `deleted_at`, `is_deleted` | A paranoid model gets a `defaultScope`, and **an include of a model with a `defaultScope` is an INNER JOIN** (CLAUDE.md trap, A-75) — a session or device including its type/version would vanish when the type is retired. "Retire, never delete" needs no soft delete | catalogue models are **not paranoid and have no `defaultScope`**; `status` is the only removal (§ 4) |
| G-5 | `04` § 4.2: `calibration_devices.device_type_id` → `device_types` **SET NULL** | The catalogue is never deleted (ADR-125 § 2); SET NULL would only ever fire on a mistaken hard delete, silently stripping evidence | **RESTRICT** (§ 4.7) |
| G-6 | ADR-125 states `draft / published / retired` only | A draft the operator abandons must end somewhere without deleting it | add **`discarded`** (terminal, drafts only) — the ADR-126 precedent (§ 7) |
| G-7 | ADR-125 § 2: "publishing materialises the **current** base version into the type version" | Silent on what happens to the ~130 published type versions when the **base** is republished | **rebase in the same transaction** (§ 7.3) |
| G-8 | ADR-125 § 1: `inspection_template_items.item_definition_id` nullable (provenance) | Nullable provenance makes a performance item untraceable across versions (no trend of "reading at setting X" over years) | **NOT NULL**: every template item is an instance of a library definition; a one-off check during a session is an ad-hoc *result* (P19-02), not a template item (§ 4.5) |
| G-9 | 02 F-20's `input_kind` list lacks `measured` (environment, supply); ADR-125 has it | — | ADR-125's list stands; 02 F-20 gets a pointer here |
| G-10 | `05` § 3.1 step 5 and `07` (catalogue rows) still name `device_type_inspection_items` | replaced | names amended |
| G-11 | `P21-01` depends on P20-01/03 only | its read gates name the `ipm` / `ipm-templates` slugs, which exist only after **P20-06** (`SeededMenuSlug` makes an unknown slug a compile error) | P21-01 gains P20-06 as a dependency |

---

## 3. The Model at a Glance

```
                      GLOBAL (no tenant_id, no client_facility_id; writes: superAdminOnly)
 ┌──────────────┐ 0..1  ┌──────────────────────┐ 1   n ┌──────────────────────────────┐ 1   n ┌──────────────────────────┐
 │ device_types │◄──────│ inspection_templates │──────►│ inspection_template_versions │──────►│ inspection_template_items│
 └──────────────┘       │ (device_type_id NULL │       │ draft→published→retired      │       │ frozen copy of library    │
        ▲               │  = THE base template)│       │ (draft→discarded)            │       │ items + base items        │
        │               └──────────────────────┘       │ content_hash, version_number │       └────────────┬─────────────┘
        │                                              └──────────────▲───────────────┘                    │ n..1 (provenance, NN)
        │                                                             │ RESTRICT                           ▼
        │                                                             │                     ┌─────────────────────────────┐
        │ RESTRICT (tenant → global: allowed)                         │                     │ inspection_item_definitions │
        │                                                             │                     │ (the library)               │
 TENANT-SCOPED                                                        │                     └─────────────────────────────┘
 ┌─────────────────────┐       ┌──────────────────────────────┐       │
 │ calibration_devices │       │ inspection_sessions (P19-02) │───────┘ template_version_id (pinned)
 │  .device_type_id    │       │ inspection_results  (P19-02) │──► template_item_id + label snapshot
 └─────────────────────┘       └──────────────────────────────┘
 ┌─────────────────────────────────┐
 │ inspection_template_proposals   │──► device_type_id / template_version_id / resulting_version_id (global, RESTRICT)
 │ tenant_id NN, provider-internal │    (no client_facility_id: bound users DENY, ADR-124 § 5)
 └─────────────────────────────────┘
```

**Aggregates.**

- **Device type** — a name and a lifecycle. Its own aggregate (a device references it; a template references it).
- **Template** (root) **→ versions → items** — one aggregate. Invariants it protects: at most one published version, at most one open draft, a published/retired version's content never changes, a type version embeds exactly the base items it was published with. All writes go through the template's service, inside one transaction, under a row lock on the template (`SELECT … FOR UPDATE`) so two operators cannot publish the same template concurrently.
- **Item definition** — the library entry; mutable while active (a library edit affects only drafts that copy it **afterwards**; existing drafts and versions hold copies).
- **Proposal** — a tenant's request; its own small aggregate with a lifecycle (§ 7.4).

**Domain events** (in-process, not a bus): `TemplateVersionPublished { versionId, templateId, contentHash, retiredVersionId }`, `TemplateVersionRetired`, `BaseRebased { baseVersionId, rebasedVersionIds[] }`, `ProposalDecided { proposalId, tenantId, decision }`. Each is realised as the audit row(s) written in the transaction and, for `ProposalDecided`, an in-app notification to the proposer (§ 10). There is **no** socket broadcast and **no** webhook (§ 10 explains why).

---

## 4. Tables and Columns (TARGET; migrations P20-01 `device_types`, P20-03 the rest — numbers renumbered at implementation)

Conventions: UUID `id` (`UUIDV4`), camelCase attributes over snake_case columns (`underscored: true`), `initModel` + `export =` alone, `created_at`/`updated_at`, `created_by`/`updated_by` → `users` RESTRICT. **Every index, CHECK and unique constraint is in the migration, none on a model** (ADR-100 Am. 3), with a leading index on every FK (D-20). No blanket `try/catch`. **No catalogue model is `paranoid` and none has a `defaultScope`** (G-4). Brand types `DeviceTypeId`, `InspectionTemplateId`, `InspectionTemplateVersionId`, `InspectionTemplateItemId`, `InspectionItemDefinitionId`, `InspectionTemplateProposalId` in `src/types/ids.ts`.

### 4.1 `device_types` (global; P20-01)

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | NN | |
| `name` | varchar(255) | NN | trimmed, internal whitespace collapsed; 1–255 |
| `status` | ENUM `active`, `retired` | NN, default `active` | `DEVICE_TYPE_STATUSES` |
| `legacy_id` | integer | NULL | upstream `mst_alat.id`; `UNIQUE (legacy_id) WHERE legacy_id IS NOT NULL`; the 5 merged duplicate groups map every member through `upstream_import.id_map`, not here |
| `created_by`, `updated_by` | uuid → users RESTRICT | NULL (system import) | never returned to tenants |
| `created_at`, `updated_at` | timestamptz | NN | |

Unique: `device_types_name_unique` on `lower(btrim(name))` — **all statuses** (a retired name is reactivated, not recreated). Global uniqueness is correct here: the table is platform content every tenant reads; there is no tenant whose existence it could reveal.

### 4.2 `inspection_item_definitions` (global; the library)

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | NN | |
| `section` | ENUM `INSPECTION_SECTIONS` | NN | § 5.1 |
| `label` | varchar(255) | NN | Indonesian, the language of the reports; 1–255, no control characters |
| `input_kind` | ENUM `INSPECTION_INPUT_KINDS` | NN | § 5.2; must be allowed for the section |
| `unit` | varchar(20) | NULL | normalised token (§ 6.3); required for the measured kinds except `text` limits |
| `symbol` | varchar(50) | NULL | the upstream display symbol, kept verbatim for parity printing |
| `setting_text` | varchar(50) | NULL | `setting_measured_reference` only — as printed (e.g. "N bpm") |
| `setting_value` | numeric | NULL | parsed from `setting_text` when it spells one number (§ 6.1); the nominal for tolerance limits |
| `limit_op` | ENUM `INSPECTION_LIMIT_OPS` | NULL | § 6.2; NULL ⇔ no limit |
| `limit_value` | numeric | NULL | the bound for `lt`/`lte`/`gt`/`gte` |
| `limit_low`, `limit_high` | numeric | NULL | `between`, inclusive |
| `limit_nominal` | numeric | NULL | `plus_minus`/`plus_minus_pct` with an explicit nominal (`N ± N`); else the nominal is `setting_value` |
| `limit_tolerance` | numeric | NULL | `plus_minus` (absolute, in `unit`) / `plus_minus_pct` (percent) |
| `limit_text` | varchar(100) | NULL | the limit **as written** (the reference value column of the report); NOT NULL whenever `limit_op` is NOT NULL |
| `valid_min`, `valid_max` | numeric | NULL | **hard** input range: a measured value outside is refused with **400** (e.g. humidity 0 … 100) |
| `warn_min`, `warn_max` | numeric | NULL | **soft** plausibility range: accepted, flagged on the result and highlighted (e.g. humidity 10 … 95) |
| `allowed_outcomes` | ENUM `INSPECTION_OUTCOMES`[] | NN | non-empty subset of the section's outcome set (§ 5.1); `{}` only for `measured` and `text` |
| `default_required` | boolean | NN, default true | copied to a template item's `required` when added |
| `notes` | text | NULL | **operator-only** (never copied into a version, never returned to tenants) — the upstream `mst_*.notes` are free text (`07`: "reviewed once by the operator") |
| `status` | ENUM `active`, `retired` | NN | a retired definition cannot be added to a draft (400); existing copies are untouched |
| `legacy_table` | varchar(64) | NULL | |
| `legacy_id` | integer | NULL | `UNIQUE (legacy_table, legacy_id) WHERE legacy_id IS NOT NULL` |
| `created_by`, `updated_by`, `created_at`, `updated_at` | | | |

CHECKs (all in the migration; the Zod contract mirrors them so a 400 comes before the database):

- `limit_op IS NULL OR input_kind IN ('measured_with_limit','setting_measured_reference')`
- per op: `lt|lte|gt|gte` ⇒ `limit_value` NN and the other numerics NULL; `between` ⇒ `limit_low`, `limit_high` NN and `limit_low <= limit_high`; `plus_minus|plus_minus_pct` ⇒ `limit_tolerance >= 0` NN; `text` ⇒ every numeric limit column NULL
- `limit_op IS NULL OR limit_text IS NOT NULL`
- `valid_min IS NULL OR valid_max IS NULL OR valid_min <= valid_max`; the warn range inside the valid range when both exist
- `cardinality(allowed_outcomes) > 0 OR input_kind IN ('measured','text')`

Indexes: `(section, status, lower(label), id)` (operator library list).

### 4.3 `inspection_templates` (global)

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | NN | |
| `device_type_id` | uuid → device_types RESTRICT | NULL | **NULL = the base template** (F-21 common sections) |
| `status` | ENUM `active`, `retired` | NN | a retired template has no published version; sessions for that type fall back to the base (§ 7.5) |
| `created_by`, `updated_by`, `created_at`, `updated_at` | | | |

Unique: `UNIQUE (device_type_id)` (one template per type, ever — NULLs distinct, so the base is not covered) **and** `inspection_templates_one_base` `UNIQUE ((device_type_id IS NULL)) WHERE device_type_id IS NULL` (exactly one base row). The base row is created by the P20-03 migration.

### 4.4 `inspection_template_versions` (global)

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | NN | the id sessions pin |
| `template_id` | uuid → inspection_templates RESTRICT | NN | |
| `status` | ENUM `draft`, `published`, `retired`, `discarded` | NN | `TEMPLATE_VERSION_STATUSES` (§ 7) |
| `version_number` | integer | NULL | assigned **at publish** as max + 1 per template (drafts and discarded drafts have none, so published numbers have no gaps) |
| `base_version_id` | uuid → inspection_template_versions RESTRICT | NULL | the base version materialised into a **type** version; NULL on the base template's own versions |
| `rebased_from_version_id` | uuid → inspection_template_versions RESTRICT | NULL | set on a version created by a base rebase (§ 7.3) |
| `content_hash` | char(64) | NULL | lower-case hex SHA-256 of the canonical content (§ 7.6); set at publish |
| `change_note` | text | NULL | 3–2000; required to publish |
| `revision` | integer | NN, default 0 | draft optimistic concurrency (§ 7.2); frozen after publish |
| `published_at`, `published_by` | timestamptz, uuid → users | NULL | |
| `published_by_system` | varchar(64) | NULL | a system actor, when no user published (seed, import) |
| `retired_at`, `retired_by` | timestamptz, uuid → users | NULL | |
| `discarded_at`, `discarded_by` | timestamptz, uuid → users | NULL | |
| `created_by`, `updated_by`, `created_at`, `updated_at` | | | |

Constraints: `UNIQUE (template_id, version_number) WHERE version_number IS NOT NULL`; **one published per template** `UNIQUE (template_id) WHERE status = 'published'`; **one open draft per template** `UNIQUE (template_id) WHERE status = 'draft'` (**as built since migration 0125, ADR-125 Amendment 3 § 1: `… AND rebased_from_version_id IS NULL`** — a base rebase's version, inserted as a draft and published in the same transaction, is not an operator draft); CHECK `status IN ('draft','discarded') OR (version_number, content_hash, change_note, published_at) all NOT NULL`; CHECK **exactly one publisher** for a published or retired version — `published_by` (a user) **or** `published_by_system` (varchar(64), a member of the closed `SYSTEM_ACTORS` list: `system:catalogue-seed` for the migration's base version, `system:upstream-import` for the ETL — both added to `constants/systemActors.ts` by the cards that use them), the precedent of `calibration_records_actor_exactly_one` (migration 0105); CHECK `status <> 'retired' OR retired_at IS NOT NULL`; CHECK `status <> 'discarded' OR discarded_at IS NOT NULL`. Indexes: `(template_id, status)`, `(base_version_id)`, `(rebased_from_version_id)`, `(status, id)` (the published download).

### 4.5 `inspection_template_items` (global; the frozen content of one version)

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | NN | the id results pin (`inspection_results.template_item_id`) |
| `version_id` | uuid → inspection_template_versions RESTRICT | NN | |
| `item_definition_id` | uuid → inspection_item_definitions RESTRICT | **NN** | provenance; the cross-version identity of "the same check" (G-8) |
| `origin` | ENUM `base`, `type` | NN | `base` = materialised from the base version at publish |
| `section`, `label`, `input_kind`, `unit`, `symbol`, `setting_text`, `setting_value`, `limit_*`, `valid_*`, `warn_*`, `allowed_outcomes` | as § 4.2 | | **copied** from the definition when added to the draft; the operator may edit the copy in the draft (e.g. a type-specific limit) — the copy is the content |
| `required` | boolean | NN | submit refuses a session with a required item unanswered (P19-02, 400) |
| `sort_order` | integer | NN | order inside its section; base items sort before type items of the same section |
| `created_at`, `updated_at` | | | |

Constraints: the § 4.2 CHECKs again; `UNIQUE (version_id, item_definition_id)` (the same check twice in one version is refused — including base ∩ type at publish, § 7.2); `UNIQUE (version_id, section, origin, sort_order)`. Indexes: `(version_id, section, origin, sort_order, id)` (the read order), `(item_definition_id)`.

Size bounds (Zod + service): ≤ 300 items per version, ≤ 60 per section.

### 4.6 `inspection_template_proposals` (tenant-scoped, provider-internal)

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid PK | NN | |
| `tenant_id` | uuid → tenants RESTRICT | NN | stamped from the context by the hooks; never from the body |
| `kind` | ENUM `new_device_type`, `add_items`, `change_items`, `retire_items` | NN | `TEMPLATE_PROPOSAL_KINDS` |
| `device_type_id` | uuid → device_types RESTRICT | NULL | NN unless `kind = 'new_device_type'` (CHECK) |
| `proposed_device_type_name` | varchar(255) | NULL | NN iff `kind = 'new_device_type'` (CHECK) |
| `based_on_version_id` | uuid → inspection_template_versions RESTRICT | NULL | the published version the proposer was looking at |
| `proposed_items` | jsonb | NN, default `[]` | array ≤ 100 of the **proposal item schema** (§ 8.4) — validated by Zod, never trusted as catalogue content |
| `reason` | text | NN | 3–2000 |
| `status` | ENUM `submitted`, `accepted`, `rejected`, `withdrawn` | NN | `TEMPLATE_PROPOSAL_STATUSES` (§ 7.4) |
| `submitted_by` | uuid → users RESTRICT | NN | the caller |
| `decided_by`, `decided_at`, `decision_note` | uuid → users, timestamptz, text | NULL | `decision_note` NN on reject (CHECK) |
| `resulting_version_id` | uuid → inspection_template_versions RESTRICT | NULL | the draft opened or linked on acceptance |
| `withdrawn_at`, `withdrawn_by` | | NULL | |
| `created_at`, `updated_at` | | | |

Not paranoid (a withdrawn proposal is a status). **No `client_facility_id`**: under ADR-124 § 5 a facility-bound principal gets DENY on this model (tenant-scoped, not facility-scoped, not on `FACILITY_READABLE`) — a proposal is provider business. Indexes: `(tenant_id, status, created_at DESC, id)`, `(status, created_at, id)` (the operator queue, run as super admin), leading indexes on the four FKs.

### 4.7 The one change to an existing table here: `calibration_devices.device_type_id` (P20-01)

`device_type_id uuid NULL → device_types RESTRICT` (**not** 04's SET NULL, G-5), leading index `(tenant_id, device_type_id)` — **as built `(device_type_id, tenant_id)`** (ADR-125 Amendment 2 § 3: D-20 wants the foreign key leading). `CalibrationDevice.belongsTo(DeviceType, { as: "deviceType" })` is declared (tenant → global is allowed; ADR-125 § 7 forbids only the reverse); every include of it carries **`required: false`** (the first trap in CLAUDE.md — a device with no type must not vanish from lists). A device may not be *given* a retired type (400, "this device type is retired; choose its replacement"); a device that already has one keeps it. The rest of the device extensions (QR, photos, condition, `inventoried_on`, …) are **P19-03**, blocked on UD-10; `category` stays and is backfilled from the type name there.

---

## 5. Sections, Input Kinds and Outcomes (the typed items)

All vocabularies live once in **`packages/contracts/src/inspectionValues.ts`** (frozen tuples + derived unions, the `qmsValues.ts` pattern, ADR-097); the state machines' tuples (`DEVICE_TYPE_STATUSES`, `TEMPLATE_VERSION_STATUSES`, `TEMPLATE_PROPOSAL_STATUSES`) are added to **`states.ts`**, and `stateUnions.p905.guard` holds the model ENUMs equal to them. The ENUM order is the tuple order (it is part of the schema).

### 5.1 Sections — the registry `INSPECTION_SECTION_RULES`

Order = capture order = print order (`09-REPORT-LAYOUTS.md` § 2.2). `ad-hoc` = a session may add a row with no template item (P19-02; F-39, F-42, F-45, F-49).

| # | `INSPECTION_SECTIONS` | Upstream | Kinds allowed | Outcome set (labels ID / EN, for the renderer) | Ad-hoc | Typically in |
|---|---|---|---|---|---|---|
| 1 | `environment` | Kondisi Lingkungan | `measured` | — (value only) | no | base |
| 2 | `electrical_supply` | Kondisi Kelistrikan | `measured` | `not_applicable` (N/A) | no | base |
| 3 | `tools_used` | Alat Kerja yang Digunakan | `check` | `done` / `not_done` | **yes** | type |
| 4 | `other_safety` | Pemeriksaan Keamanan Lain | `tri_state` | `pass` Baik/Good · `fail` Tidak/Not good · `not_applicable` N/A | no | base |
| 5 | `physical` | Pemeriksaan Fisik | `condition_clean` | `good` Baik · `minor_damage` Cacat/Rusak Ringan (C/RR) · `major_damage` Rusak Berat (RB); cleanliness `clean` Bersih · `dirty` Kotor | no | base |
| 6 | `electrical_safety` | Pemeriksaan Keamanan Listrik | `measured_with_limit` | computed `pass` / `fail`; `not_applicable` | **yes** | type (or base) |
| 7 | `function` | Pemeriksaan Fungsi Alat | `tri_state` | `pass` / `fail` / `not_applicable` | no | type |
| 8 | `completeness` | Pemeriksaan Kelengkapan Alat | `tri_state` | `pass` / `fail` / `not_applicable` | no | type |
| 9 | `performance` | Pemeriksaan Kinerja Alat | `setting_measured_reference` | `pass` Baik / `fail` Tidak Baik | **yes** | type |
| 10 | `battery` | Pemeriksaan Battery | `setting_measured_reference` | `pass` / `fail` | no | type |
| 11 | `maintenance_task` | Pemeliharaan Alat | `check` | `done` Dilakukan / `not_done` Tidak | no | base |
| 12 | `consumable` | Stok Konsumabel | `tri_state` | `available` Iya · `not_available` Tidak · `empty` Habis | **yes** | type |

`INSPECTION_OUTCOMES` = `pass`, `fail`, `not_applicable`, `done`, `not_done`, `good`, `minor_damage`, `major_damage`, `available`, `not_available`, `empty`. `INSPECTION_CLEANLINESS` = `clean`, `dirty`. The session-level outcomes (overall inspection result, maintenance result, recommendation) and notes are **header fields of the session** (P19-02, `04` § 4.8), not catalogue items. Any section may appear in the base or a type template; a section appearing in neither is simply not shown.

**Upstream code mapping (corrects `04` § 5, G-1):** completeness, function, other safety `1/0/-1` → `pass/fail/not_applicable`; **physical `1/0/-1` → `good/minor_damage/major_damage`**, cleanliness `status_kebersihan` `1/0` → `clean/dirty` (and the report prints cleanliness from its own field — `09` L-3); **consumable `1/0/-1` → `available/not_available/empty`**; tools used and maintenance tasks `1/0` → `done/not_done`; electrical supply `1/-1` → measured / `not_applicable`; electrical safety `1/-1` → measured / `not_applicable` (its pass/fail is **computed**, never imported — upstream never recorded one, `04` § 5 note).

### 5.2 Input kinds — `INSPECTION_INPUT_KINDS` (ADR-125's list, unchanged)

| Kind | The technician enters | Outcome | What the catalogue item carries |
|---|---|---|---|
| `check` | ticked / not ticked | `done` / `not_done` — an unticked box **is** an answer (`not_done`), so a `check` item is never "missing" | label |
| `tri_state` | one choice of the item's `allowed_outcomes` (2–3 values) | the choice | label, `allowed_outcomes` |
| `condition_clean` | a condition **and** a cleanliness | condition ∈ allowed; cleanliness ∈ `INSPECTION_CLEANLINESS` | label |
| `measured` | one number (or N/A where allowed) | none (value only); `warn` flag when outside the warn range | `unit`, `valid_*`, `warn_*` |
| `measured_with_limit` | one number (or N/A) | **computed** from the limit (§ 6.4): `pass` / `fail`; if indeterminate, the technician must choose and `outcome_source = technician` | `unit`, limit, `valid_*` |
| `setting_measured_reference` | reading 1 (required), reading 2 (optional) | the **technician's** `pass` / `fail` (the upstream practice, F-45); the computed outcome is stored beside it and a disagreement is flagged, never silently overridden | `setting_text`/`setting_value`, `limit_*` + `limit_text` (the reference value), `unit` |
| `text` | free text ≤ 500 | none | label |

**What P19-02 must provide for this to hold** (handed over, not decided there twice): result columns `outcome` (`INSPECTION_OUTCOMES`), `cleanliness` (`INSPECTION_CLEANLINESS`), `measured_value`, `measured_value_1`, `measured_value_2` (numeric), `raw_value` (verbatim text whenever a parse failed or the value came from the import), `computed_outcome` (`pass`/`fail`/NULL), `outcome_source` ENUM `technician`, `computed`, `warn_flag` boolean, `label_snapshot`, `template_item_id` (NULL only for ad-hoc rows and imported history). **Rule:** for `measured_with_limit` a determinate computed outcome **is** the outcome — the technician cannot override an objective electrical-safety limit (re-measure instead); for `setting_measured_reference` the technician's choice is the outcome and `computed_outcome` is evidence beside it. `04` § 4.9 is amended to point here.

---

## 6. Parsing and Validation Rules (one implementation, shared)

Pure functions in **`packages/contracts/src/inspectionValues.ts`**, imported by the backend (authoritative), the frontend capture form (live preview) and the ETL (P24-02). One implementation means the server and the offline client can never disagree on a pass/fail.

### 6.1 `parseDecimal(text) → { value: string | null, raw: string }`

- Trim; accept `^[+-]?\d+([.,]\d+)?$` — **one** separator, `,` or `.`, is the decimal separator (Indonesian forms write `0,7`; `03` Q-22). `"0,7"` → `"0.7"`; `" 12 "` → `"12"`.
- **Refuse digit grouping** (`1.000,5`, `1,000.5`, `1 000`): numeric NULL, raw kept. The API answers **400** for a refused capture value; the ETL keeps the raw text with NULL numeric (Q-23).
- **The ambiguous case** `^\d{1,3}\.\d{3}$` (`1.200` — one point two, or one thousand two hundred?) is parsed as a decimal point (1.2), because the capture UI shows the parsed value with its unit back before submit ("1,2 µA") — that confirmation is the safeguard. The ETL counts these per facility into the data-quality report (P25-02) instead of guessing silently.
- Values are carried as **decimal strings** end to end (the models read them as strings — a reviewed exception to D-21, ADR-125 Amendment 2 § 2) (Sequelize returns `DECIMAL` as strings; JSON bodies may send a number or a string). Comparisons (§ 6.4) are done on scaled `BigInt`s, never on binary floats — `0.1 + 0.2` problems do not exist at a limit boundary.

### 6.2 `parseLimit(text) → Limit`

Grammar (whitespace-tolerant, case-insensitive for the words; `˚` is normalised to `°`):

```
LIMIT   := CMP NUM UNIT?                       → lt | lte | gt | gte       ("≤ N µA", "< Ns", "≥ N,N mmAl")
         | ("Max"|"Maks") NUM UNIT?            → lte                       ("Max N psi")
         | "Min" NUM UNIT?                     → gte
         | PM NUM "%"                          → plus_minus_pct (nominal = setting)   ("± N%", the commonest shape)
         | PM NUM UNIT?                        → plus_minus     (nominal = setting)   ("± N °C", "± N mmHg", "±N,N D")
         | NUM PM NUM ("%" | UNIT)?            → plus_minus(_pct) with limit_nominal
         | NUM ("-" | "–" | "s.d." | "to") NUM UNIT?  → between
CMP     := "≤" | "<=" | "<" | "≥" | ">=" | ">"
PM      := "±" | "+/-" | "+-"
NUM     := parseDecimal
```

Anything else → `{ op: "text" }`: the limit is printed as written and **never evaluated** (`...`, "≤ N × resolution", "RH%"). Survey of the upstream performance reference values by shape (digits replaced, 184 rows): `± N %` ~93, `...` 30, `≤ N × resolution` 14, `± N °C` 10, `± N mmHg` 10, `≤ N %` 5, others ≤ 3 each — so about **three quarters** (139 of 184) parse to an evaluable limit and a quarter (45) stay `text`. Electrical-safety limits are all `≤ N unit` (with a decimal comma in one), i.e. 100 % evaluable.

**Unit rules.** A limit's unit must equal the item's `unit` after normalisation; a mismatch is a **400 at publish** ("the limit is in mA but the item records µA") — there is **no unit conversion** anywhere (the technician enters the value in the item's unit; the form shows the unit beside the field). For `plus_minus_pct` the unit is `%` of the nominal and the item's unit is the nominal's unit.

### 6.3 `normaliseUnit(token)`

A closed alias table, extended by the operator through a contract change (not data): `uA`/`µA`/`μA` → `µA` (U+00B5); `mA`; `A`; `ohm`/`Ω`/`Ω` → `Ω` (U+03A9); `mΩ`, `kΩ`, `MΩ`; `V`, `mV`, `kV`; `W`; `J`; `°C`/`˚C`/`C` → `°C`; `%`, `%RH` → `%`; `mmHg`; `mmHg/min`; `kPa`; `psi`; `bpm`/`BPM` → `bpm`; `L/min`/`lpm` → `L/min`; `mL`, `mL/h`; `s`, `min`; `Hz`; `dBA`; `mGy`; `m/s`; `mmAl`; `D`. An unknown token is kept verbatim (trimmed, ≤ 20) — it is still a valid label for printing, and limits on it still evaluate (same unit on both sides).

### 6.4 `evaluate(item, readings) → "pass" | "fail" | null`

| op | pass when (every present reading) |
|---|---|
| `lt` / `lte` / `gt` / `gte` | `m < v` / `m ≤ v` / `m > v` / `m ≥ v` |
| `between` | `low ≤ m ≤ high` |
| `plus_minus` | `|m − nominal| ≤ tol` |
| `plus_minus_pct` | `|m − nominal| ≤ |nominal| × tol / 100` |
| `text` / no limit | — → `null` (indeterminate) |

`nominal` = `limit_nominal` ?? `setting_value`; NULL nominal → `null`. A reading that is NULL or `not_applicable` → `null` for that reading; the item is `fail` if any present reading fails, `pass` if all present readings pass and at least one is present, else `null`. Boundaries are inclusive for `≤`, `≥`, `between` and `±` — "≤ 0,7 Ω" with 0.7 measured **passes**.

### 6.5 Validation rules on capture values (enforced at the session API, P19-02; defined here)

- `valid_min`/`valid_max` → **400** outside ("Humidity must be between 0 and 100 %").
- `warn_min`/`warn_max` → accepted, `warn_flag = true`, shown amber on the form and the report (never a block — `02` F-37).
- Seeded base values (**proposed; the SME confirms at UAT, P26-01**): temperature `°C` valid −20 … 80 (`04` § 4.8's CHECK), warn 10 … 45; humidity `%` valid 0 … 100, warn 10 … 95 (`03` Q-21); mains/UPS/stabiliser voltage `V` valid 0 … 400, warn 198 … 242 (220 V ± 10 %).
- `allowed_outcomes`: an outcome outside the item's set → 400.
- `text` ≤ 500; `label_snapshot` is the server's copy of the item label, never the client's.

---

## 7. State Machines

### 7.1 Device type and template lifecycle (`active` ⇄ `retired`)

| From | Action | To | Who | Otherwise |
|---|---|---|---|---|
| — | create | `active` | operator | **409** "A device type named "…" already exists (status: retired — reactivate it instead)." |
| `active` | rename | `active` | operator | 409 on a normalised-name clash |
| `active` | retire | `retired` | operator | **409** "This device type is already retired." Devices keep it; it cannot be given to a device any more (400 there) |
| `retired` | reactivate | `active` | operator | 409 "This device type is active." |
| template `active` | retire template | `retired`; its published version → `retired` in the same transaction | operator | 409 "The checklist for … is already retired." New sessions for that type use the base (§ 7.5) |
| template `retired` | reactivate | `active` (no published version until the next publish) | operator | 409 |

### 7.2 Template version (`TEMPLATE_VERSION_STATUSES` = `draft`, `published`, `retired`, `discarded`)

| From | Action | To | Who | Otherwise (each 409 carries the explanation shown) |
|---|---|---|---|---|
| — | create draft (empty, or a copy of the current published version's **type** items) | `draft`, `revision` 0 | operator | **409** "… already has an open draft, created on <date> — edit or discard it." (partial unique index) · 409 "The checklist for … is retired; reactivate it first." |
| `draft` | replace items / edit note (`If-Match`-style: body carries `revision`) | `draft`, `revision + 1` | operator | **409** "This draft was saved by <operator> at <time> (revision r); reload it before saving." · **409** on any non-draft "Version n of … was published on <date> and cannot be changed — create a new draft." · 400 a retired definition |
| `draft` | publish (`changeNote`) | `published`; `version_number` = max + 1; `base_version_id` = the base's published version (type templates); base items materialised as `origin = base`; `content_hash`; the previous published → `retired` — **one transaction under a template row lock** | operator | **409** "Only a draft can be published; this version is <status>." · **409** "The base checklist has no published version; publish the base first." · **400** zero items (a type template); a definition in both base and type; a limit unit ≠ item unit; an outcome outside the section's set; `changeNote` missing |
| `draft` | discard | `discarded` (terminal; rows kept) | operator | 409 "Only a draft can be discarded." |
| `published` | publish of a newer version, or retire template | `retired` (terminal) | (the publish) | — |
| `published`, `retired`, `discarded` | anything else | — | — | 409 from the service; **the trigger refuses it anyway** (§ 7.7) |

### 7.3 Base rebase (G-7) — decided

Publishing a new **base** version, in the same transaction: for every active type template with a published version, create a new `published` version = that version's `type` items copied unchanged + the new base items, `change_note` "Rebased onto base version n", `rebased_from_version_id` = the previous version, and retire the previous one. Open type drafts are untouched (each materialises the then-current base at its own publish). One audit row per created version. Result: the common sections are identical across every type at every moment, and every report still renders its pinned version. **Bad implication:** each base change adds a version to every typed template (~130), and every technician online with a form open gets the stale-version 409 once.

### 7.4 Proposal (`TEMPLATE_PROPOSAL_STATUSES` = `submitted`, `accepted`, `rejected`, `withdrawn`)

| From | Action | To | Who | Otherwise |
|---|---|---|---|---|
| — | submit | `submitted` | tenant user with `ipm-templates` write (unbound; the route is not facility-accessible) | 400 shape; 404 an unknown device type or version |
| `submitted` | withdraw | `withdrawn` (terminal) | any user of the **same tenant** with `ipm-templates` write | **409** "This proposal was <accepted/rejected> on <date>; it can no longer be withdrawn." · another tenant's id → **404** |
| `submitted` | accept (`decisionNote` optional) | `accepted`; opens a draft on the target template (or links the open one) → `resulting_version_id`; for `new_device_type` the operator creates the type first and passes its id | operator | **409** "This proposal was already <status> on <date>." |
| `submitted` | reject (`decisionNote` required) | `rejected` (terminal) | operator | 409 as above |

Acceptance **copies nothing** from `proposed_items` into the global tables: the operator adds each item to the draft explicitly (each edit audited), with the proposal shown beside the editor. That is how ADR-125 § 5's "the operator removes anything that identifies a facility or person" is enforced by construction rather than by a review step that could be skipped.

### 7.5 Which version a new session pins — `resolveTemplateVersion(publishedSet, deviceTypeId)`

The device's type template's published version; else (no type, no template, template retired) **the base template's published version**; else **409** at session start "No published checklist exists — ask the platform operator to publish the base checklist." Pure function in contracts so the offline client resolves exactly as the server (ADR-127). About 214 of the 344 upstream types have no type-specific checklist (`03` § 4.4) and get the base.

### 7.6 `content_hash`

SHA-256 (lower-case hex) over the UTF-8 bytes of canonical JSON, keys sorted, no insignificant whitespace, numbers as the decimal strings of § 6.1:

```json
{ "schema": "inspection-template-version-v1", "templateId": "…", "deviceTypeId": "…|null",
  "versionNumber": n, "baseVersionId": "…|null",
  "items": [ { "id", "itemDefinitionId", "origin", "section", "label", "inputKind", "unit", "symbol",
               "settingText", "settingValue", "limitOp", "limitValue", "limitLow", "limitHigh",
               "limitNominal", "limitTolerance", "limitText", "validMin", "validMax", "warnMin",
               "warnMax", "allowedOutcomes" (sorted), "required", "sortOrder" } … ] }
```

Items in read order (section registry order, `origin` base first, `sort_order`, `id`). Item ids **are** hashed (results pin them). The schema string is versioned so a later change of canonical form never reinterprets an old hash. The IPM report's data document (P19-06) carries the pinned version's `content_hash`; `/verify` recomputes it.

### 7.7 Immutability in the database (P20-03; the migration-0057 pattern, tested as `callibrator_app`)

- `inspection_template_versions`: `DELETE`/`TRUNCATE` refused for every role; when `OLD.status <> 'draft'` an `UPDATE` may change only `status` `published → retired` with `retired_at`/`retired_by` (once), plus `updated_at`/`updated_by`; `discarded` and `retired` are final. While `draft`, only the draft columns change, and the publish `UPDATE` must set every publish column at once (the CHECK).
- `inspection_template_items`: `INSERT`/`UPDATE`/`DELETE` refused unless the parent version is `draft` (draft items are replaced wholesale — work in progress, as ADR-126 treats draft results); `TRUNCATE` refused.
- `device_types`, `inspection_item_definitions`, `inspection_templates`, `inspection_template_proposals`: `DELETE`/`TRUNCATE` refused (retire / withdraw instead).
- Grants: `callibrator_app` has `SELECT, INSERT, UPDATE` on all six tables and **no `DELETE`**; the triggers bind the owner too. **As built (ADR-125 Amendment 2 § 1, 2026-10-07): `inspection_template_items` keeps `DELETE` — a draft's items are replaced wholesale — and its trigger refuses the write unless the parent is a draft; the other five have no `DELETE`.** Both triggers are listed in `schemaVerify` `EXPECTED_OBJECTS` (`backend/src/scripts/verifySchema.ts`).
- Errors use `ERRCODE '42501'` with a message naming the row, as 0057 does; the service maps a trigger refusal it did not foresee to **409**, not 500, and the test asserts the service's own 409 fires first.

---

## 8. API (TARGET; P21-01) — contracts, gates, markers

### 8.1 Gates and markers

- **Operator writes:** `auth, superAdminOnly` (operator reads of drafts, the library and the proposal queue too). Every one is on `inspectionCatalogueGlobal.guard`'s `MUTATING` inventory and allow-listed `platform` in `twoTenantRoutes.guard`.
- **Catalogue reads (published/retired content, active types):** `auth, dynamicAccess(["calibration", "ipm", "ipm-templates"], "read")` — G-2. Marked **facility-accessible** (the ADR-124 § 7 marker; its exact name is fixed by P19-04), reason "global content (ADR-125 § 6), no facility-owned rows". `:id` reads allow-listed `not-tenant-owned` in `twoTenantRoutes.guard` and, when `twoFacilityRoutes.guard` exists (P21-09), exempt with the same reason.
- **Proposals (tenant side):** `auth, dynamicAccess("ipm-templates", "read" | "write")`; **not** facility-accessible (bound users: 403 at the route, DENY in the hooks). P18-02 grants `ipm-templates` write to the tenant-administration tier only by default.
- The `ipm` and `ipm-templates` slugs are created by **P20-06** (P18-02 specs the grants); until then a gate naming them does not compile (`SeededMenuSlug`) — hence G-11.

### 8.2 Routes

| Method | Path | Gate | Contract (`@callibrator/contracts`, `inspectionCatalogue.ts`) | Purpose |
|---|---|---|---|---|
| GET | `/api/v1/device-types` | catalogue read | `listDeviceTypesQuery` (`search` ≤ 100, `status` `active` (default) \| `retired` \| `all` — open to every reader, so a device's retired type still resolves its label), `page`, `limit` | picker (F-19, F-31); order `lower(name), id` |
| GET | `/api/v1/device-types/:deviceTypeId` | catalogue read | `deviceTypeIdParams` | one type (any status) |
| POST | `/api/v1/device-types` | operator | `createDeviceType` | create |
| PATCH | `/api/v1/device-types/:deviceTypeId` | operator | `updateDeviceType` (`name`) | rename |
| POST | `/api/v1/device-types/:deviceTypeId/retire` · `/reactivate` | operator | `deviceTypeIdParams` | § 7.1 |
| GET | `/api/v1/ipm/templates/published` | catalogue read | — | **the offline/online catalogue document** (§ 8.3) |
| GET | `/api/v1/ipm/template-versions/:versionId` | catalogue read | `templateVersionIdParams` | one version with items, `published` or `retired` (pinned by old sessions; the report renderer reads it); a `draft`/`discarded` id → **404** for non-operators |
| GET | `/api/v1/ipm/templates` | operator | `listTemplatesQuery` (`deviceTypeId`, `status`, `hasDraft`, `page`, `limit`) | operator list with the current published version number and open draft |
| POST | `/api/v1/ipm/templates` | operator | `createTemplate` (`deviceTypeId`) | a type template (the base exists from the migration) |
| POST | `/api/v1/ipm/templates/:templateId/retire` · `/reactivate` | operator | | § 7.1 |
| POST | `/api/v1/ipm/templates/:templateId/versions` | operator | `createDraft` (`copyFrom`: `published` \| `empty`) | § 7.2 |
| GET | `/api/v1/ipm/template-versions?templateId=` | operator | `listVersionsQuery` | history of one template, every status, `page`/`limit`, order `created_at DESC, id` |
| PUT | `/api/v1/ipm/template-versions/:versionId/items` | operator | `replaceDraftItems` (`revision`, `items[]` ≤ 300 of `templateItemInput`) | wholesale replace — a draft is edited as a document; `PUT` because it replaces |
| PATCH | `/api/v1/ipm/template-versions/:versionId` | operator | `updateDraft` (`revision`, `changeNote`) | |
| POST | `/api/v1/ipm/template-versions/:versionId/publish` | operator | `publishVersion` (`revision`, `changeNote` 3–2000) | § 7.2, § 7.3 |
| POST | `/api/v1/ipm/template-versions/:versionId/discard` | operator | `templateVersionIdParams` | |
| GET/POST/PATCH | `/api/v1/ipm/item-definitions[/:itemDefinitionId]`, `POST …/:itemDefinitionId/retire` | operator | `listItemDefinitionsQuery`, `createItemDefinition`, `updateItemDefinition` | the library (`limitText` is parsed server-side by `parseLimit`; the client may preview) |
| GET | `/api/v1/ipm/template-proposals` | `ipm-templates` read | `listProposalsQuery` (`status`, `page`, `limit`) | own tenant's proposals (hooks) |
| POST | `/api/v1/ipm/template-proposals` | `ipm-templates` write | `createProposal` | § 7.4 |
| GET | `/api/v1/ipm/template-proposals/:proposalId` | `ipm-templates` read | `proposalIdParams` | another tenant's → **404** |
| POST | `/api/v1/ipm/template-proposals/:proposalId/withdraw` | `ipm-templates` write | `proposalIdParams` | |
| GET | `/api/v1/admin/ipm/template-proposals` | admin router (`rbac(["SUPER_ADMIN","SUPERADMIN"])`) | `listProposalsQuery` | the operator queue across tenants (super admin skips the tenant hooks by design) |
| POST | `/api/v1/admin/ipm/template-proposals/:proposalId/accept` · `/reject` | admin router | `decideProposal` (`decisionNote`; required on reject; `deviceTypeId` for a new-type acceptance) | § 7.4 |

**As built (P21-01, 2026-10-09; ADR-125 Amendment 3):** the limit is written as `limitText` and parsed by the server; a draft item is `{ itemDefinitionId, required?, content? }` in array order; an item keeps its definition's section and kind; the base template is never retired; no actor in any answer; proposal writes refuse an API key; the contracts are imported by subpath and the response shapes are in `docs/openapi/inspectionCatalogueSchemas.ts`. Every path parameter is named in `validate(schema, { from: ["params", …] })` (the 400-on-every-request trap). Every route has its `*.openapi.ts` (ADR-103); `openapi:check` current; `openapi:breaking` has nothing to break (all new).

### 8.3 The published catalogue document

`GET /api/v1/ipm/templates/published` → a single document (A-343), not a paged list:

```json
{ "success": true, "status": 200, "message": "…",
  "data": { "schema": "inspection-catalogue-v1",
            "deviceTypes": [ { "id", "name" } ],                       // active only
            "versions": [ { "id", "templateId", "deviceTypeId|null", "versionNumber",
                            "baseVersionId", "contentHash", "publishedAt", "items": [ … ] } ] } }
```

- `ETag: "<sha256 hex>"` (strong) over the sorted `versionId:contentHash` lines **plus** the sorted `deviceTypeId:name` lines (the types are in the document, so they must be in the validator — ADR-125 § 6 named only the versions; G-3-adjacent, recorded in the amendment). `If-None-Match` match → **304**, empty body. `Cache-Control: private, no-cache`. Express's automatic ETag is not used for this route (the route sets its own).
- Size (upstream scale): ~130 type versions × ~39 items + the base ≈ 5 k items, ≈ 1.5 MB JSON, ≈ 150 KB gzipped. Read with the operator-free fields only: no `created_by`/`published_by`, no `notes`.
- No actor is returned to tenants anywhere in the catalogue (who on the platform published a version is not tenant data, and a `User` include from a global model would cross the tenant hooks).

### 8.4 Contracts (new modules; all exported by name from `packages/contracts/src/index.ts`)

- `inspectionValues.ts` — the tuples and unions of § 5 (`INSPECTION_SECTIONS`, `INSPECTION_INPUT_KINDS`, `INSPECTION_OUTCOMES`, `INSPECTION_CLEANLINESS`, `INSPECTION_LIMIT_OPS`, `TEMPLATE_PROPOSAL_KINDS`, `TEMPLATE_ITEM_ORIGINS`), `INSPECTION_SECTION_RULES`, and the pure functions `parseDecimal`, `parseLimit`, `normaliseUnit`, `evaluate`, `resolveTemplateVersion`, `canonicalTemplateVersion` (the § 7.6 payload; the hash itself is computed with the platform's SHA-256 on each side).
- `states.ts` — `DEVICE_TYPE_STATUSES`, `TEMPLATE_VERSION_STATUSES`, `TEMPLATE_PROPOSAL_STATUSES` (and `INSPECTION_SESSION_STATUSES` when P19-02 lands).
- `inspectionCatalogue.ts` — request schemas named in § 8.2 and response schemas (`deviceType`, `templateVersion`, `templateItem`, `publishedCatalogue`, `templateProposal`) with `PaginationMeta`. `templateItemInput` is a **discriminated union on `inputKind`** so a limit on a `tri_state` item, or `allowedOutcomes` outside the section's set (a `superRefine` over `INSPECTION_SECTION_RULES`), is a 400 before the service. The **proposal item schema** is the same union with every field optional except `section`, `label`, `inputKind`, plus `itemDefinitionId` (for a change/retire).

---

## 9. Security (P17-06 cross-reference)

- **Tenant dimension:** catalogue models have no tenant column → the hooks do nothing; the **route** is the only write control (`superAdminOnly`, guard-held). Proposals are tenant-scoped by the hooks; `tenantId` is stamped from the context, never read from the body.
- **Facility dimension (ADR-124):** catalogue reads are facility-accessible and global (a bound user reads the same published content as everyone — no facility data in it). Proposals are provider-internal: DENY for bound users in the hooks and 403 at the route — two layers.
- **Global text leaks platform-wide** (ADR-125 implication): mitigated by construction (§ 7.4 — nothing auto-copied from a proposal), `notes` kept operator-only, and the ETL's catalogue import reviewed once by the operator (`07`). Item labels and change notes stay a human review — **P17-06 should list "identifying text in a global label or change note" as a threat** with this mitigation.
- **No new public surface, no outbound request, no secret, no raw SQL** (if the published download is ever written as `sql()` for speed, it names only global tables, so `rawSqlTenantPredicate.d05` is satisfied and no facility predicate applies).
- **Existence oracles:** the global name uniqueness of device types reveals nothing about any tenant. A proposal id of another tenant is 404, indistinguishable from missing.
- **Fail-closed choices:** an unparseable limit evaluates to *indeterminate* (a person decides) rather than pass; an unknown outcome is refused; a template with no published base refuses to start a session (409) rather than starting an empty checklist.
- **Denial of service:** the published document is bounded (≤ 300 items × templates) and cached by `ETag`; the operator routes are super-admin only.

---

## 10. Audit, Events, Notifications

Every mutation writes its audit row **inside its transaction** (a rolled-back publish leaves none — tested). Catalogue rows are recorded under `PLATFORM_TENANT_ID` (A-125, the roles precedent); proposal rows under the **proposal's tenant**, actor = the caller (the operator for a decision), so the tenant can read its own trail.

| Act | `action` | `resourceType` | `changes.operation` | `changes` also carries |
|---|---|---|---|---|
| create / rename / retire / reactivate a device type | `CREATE` / `UPDATE` | `DeviceType` | `CREATE_DEVICE_TYPE`, `RENAME_DEVICE_TYPE`, `RETIRE_DEVICE_TYPE`, `REACTIVATE_DEVICE_TYPE` | before/after name, status |
| create / edit / retire an item definition | `CREATE` / `UPDATE` | `InspectionItemDefinition` | `…_ITEM_DEFINITION` | before/after of the changed fields (no `notes` text — length only) |
| create / retire / reactivate a template | `CREATE` / `UPDATE` | `InspectionTemplate` | | device type id |
| create draft / replace items / edit note / discard | `CREATE` / `UPDATE` | `InspectionTemplateVersion` | `CREATE_DRAFT`, `EDIT_DRAFT_ITEMS`, `EDIT_DRAFT_NOTE`, `DISCARD_DRAFT` | `revision` before/after, item count, the draft's canonical hash before/after (so the edit history is reconstructible without storing every list) |
| publish | **`APPROVE`** | `InspectionTemplateVersion` | `PUBLISH_TEMPLATE_VERSION` | `versionNumber`, `contentHash`, `baseVersionId`, `retiredVersionId`, `changeNote` |
| rebase (per version) | `APPROVE` | `InspectionTemplateVersion` | `REBASE_TEMPLATE_VERSION` | the same + `rebasedFromVersionId` |
| proposal submit / withdraw | `CREATE` / `UPDATE` | `InspectionTemplateProposal` | `SUBMIT_PROPOSAL`, `WITHDRAW_PROPOSAL` | kind, device type id |
| proposal accept / reject | `APPROVE` / `UPDATE` | `InspectionTemplateProposal` | `ACCEPT_PROPOSAL`, `REJECT_PROPOSAL` | `resultingVersionId`; decision note length |

**Events.** No socket event and no webhook: the catalogue is platform content with no tenant room to send it to, an `io.emit` to every socket would be the first global broadcast in the system for little gain, and clients learn of a change through the `ETag` (offline sync) or the stale-version 409 (online start). A decided proposal sends an **in-app notification** to its submitter (existing notification service, tenant-scoped). Revisit if operators report technicians working on stale forms for long.

---

## 11. Reports, Exports and How They Read the Catalogue

- The **IPM report** (P19-06) renders the session's **pinned** version: its data document embeds the version's items in read order and its `content_hash`; the renderer lays sections out by `INSPECTION_SECTION_RULES` and labels outcomes by the § 5.1 maps (ID/EN from the frontend's `id.ts`/`en.ts`). A later version never changes a past report (the upstream re-render defect, `09` L-7).
- The **operator's printable checklist** of a version is rendered in the browser from `GET /ipm/template-versions/:id` — no backend PDF (ADR-126 § 8).
- Operator lists (types, definitions, templates, versions, proposals) are **paginated reads** (`page`/`limit` ≤ 200, order ending in `id`), envelope rows in `data`, paging in top-level `meta`.
- **"Due"** is not a catalogue concern: ADR-126 § 6 computes it from the device's `ipm_interval_months` or the tenant setting. A per-device-type default interval was considered and **not** added: intervals are a tenant's maintenance policy, and a global catalogue cannot carry a tenant's policy (it would need per-tenant overrides — per-tenant templates by another name).

---

## 12. Seeding

- **P20-03 migration:** creates the base template and a published **base version 1** with neutral, platform-authored items for the fixed sections (environment: temperature, humidity; electrical supply: mains, UPS, stabiliser; other safety: placement, wheels/trolley/bracket; physical: main unit, accessories; maintenance tasks: the six of F-48) with the § 6.5 ranges — structure documented in `02` F-21, **no upstream text copied**. Published by the migration as the system actor `system:catalogue-seed` (`published_by_system`; the audit row names the same actor; P20-03 adds the member to `SYSTEM_ACTORS`).
- **P24-02 (ETL):** creates device types (5 duplicate groups merged), the item library from the 12 `mst_*` tables (with `legacy_*`), and **version 1 of each type template** from the 5 `mapping_*` tables (5 duplicate pairs collapsed), parsing limits with `parseLimit` and reporting the `text` remainder per item; base items are linked to the seeded base definitions by `legacy_*`. All through the catalogue **service** (audited, actor `system:upstream-import`), never by bulk `INSERT` around it. The catalogue text is reference data, but it becomes global: the operator reviews it once before the import publishes (`07`).

---

## 13. Test Plan (names are TARGET files; each asserts behaviour, not a re-read of the code it tests)

**Contracts (`packages/contracts/test/`, 100 % gate):**
- `inspectionValues.parse.test.ts` — `parseDecimal` table: `0,7`→`0.7`, `12`, `-3.5`, `1.000,5`→refused, `1 000`→refused, `1.200`→`1.2` (the ambiguous case pinned), empty/whitespace→NULL. `parseLimit`: one synthetic case per shape of § 6.2 (incl. `≤ 0,7 Ω`, `Max N psi`, `± N%`, `N ± N mmHg`, `N – N °C`, `˚C`), and the `text` remainder (`...`, `≤ N × resolution`, `RH%`). `normaliseUnit` alias table both ways.
- `inspectionValues.evaluate.test.ts` — inclusive boundaries (`≤ 0.7` at 0.7 → pass, 0.7000001 → fail), `0.1 + 0.2` against `≤ 0.3` → pass (scaled decimals), tolerance around a setting, pct of a negative nominal, missing nominal → null, two readings one failing → fail, one missing → evaluates the other.
- `inspectionCatalogue.contract.test.ts` — the discriminated union refuses a limit on `tri_state`, outcomes outside the section's set, > 300 items, a blank `changeNote`; `canonicalTemplateVersion` is order-independent for object keys and order-*dependent* for items (the hash must change when items move).

**Backend unit/route (`memoryDb` = the real models and hooks in memory):**
- `inspectionCatalogue.service.test.ts` — the § 7.2 table row by row, each 409 asserting its explanation text; one-draft and one-published invariants under two concurrent publishes (the template lock); base rebase creates one version per typed template and retires the old; `content_hash` equals the contract's canonical hash; **audit inside the transaction**: a publish forced to fail after the audit write leaves no audit row and no version change.
- `inspectionCatalogueGlobal.guard.test.ts` — the `rolesGlobal.d16` shape: every non-GET catalogue route is on `MUTATING`, and each refuses a tenant administrator holding every menu with 403 and passes for the super admin. **Fail-before:** remove `superAdminOnly` from one route in a planted copy and watch the guard fail (recorded in the P21-01 record).
- `catalogueModels.guard.test.ts` — the five catalogue models declare no `tenantId`/`tenant_id`/`clientFacilityId`, are not `paranoid`, have no `defaultScope`, and have **no association to a tenant-scoped model** (walks `Model.associations`); `unscopedModels.d17` lists them as `global` with "ADR-125" in the reason; the proposal model **is** tenant-scoped.
- `ipmTemplateProposals.twoTenant.test.ts` — `twoTenantSuite`: tenant B's `GET /ipm/template-proposals/:id` and `POST …/withdraw` → **404**; B's list never contains A's; `@two-tenant` markers on both `:id` routes. Operator accept writes its audit row in **A's** tenant.
- `ipmCatalogue.twoFacility.test.ts` (lands with P21-09's `twoFacilitySuite`) — a bound F1 user: published catalogue 200 (same `ETag` as an unbound user), a version by id 200, proposals list/create **403** (route) and zero rows from the model (hooks DENY), operator routes 403.
- `ipmCatalogue.etag.test.ts` — 200 with `ETag`; same `If-None-Match` → 304 with no body; a publish changes the `ETag`; a rename of a device type changes it; a draft edit does **not**.
- `ipmTemplateVersions.read.test.ts` — a draft id is 404 to a tenant user and 200 to the operator; a retired version is readable (old sessions); no actor fields in any tenant response.
- `calibrationDevice.deviceType.test.ts` (P20-01/P21-01) — a device with no type and a device with a retired type both appear in the list (LEFT include — the first trap), a retired type cannot be assigned (400).
- `stateUnions.p905.guard`, `twoTenantRoutes.guard`, `routePermissionGuard.p604`, `pageOrderTiebreaker.ci3.guard` pass with the new routes and tuples.

**PostgreSQL 18, as `callibrator_app` (`*.live.test.ts`, opt-in like 0057's):** `UPDATE` of a published version's `change_note` refused; `INSERT` into a published version's items refused; `DELETE` of any catalogue row refused; publish → retire allowed once, retire → published refused; draft item replace allowed; the partial unique indexes refuse a second draft and a second published; `schemaVerify` sees both triggers. Run against an **upgrade boot** (`upgradeBoot.am3.live`) so the indexes are proven to live in the migration.

**Live (P21-10, P22-01):** API smoke of every route on a running stack (mocks do not count); an E2E spec for the operator flow create type → draft → publish → a technician sees it → publish v2 → the old version still renders.

**Privacy:** every fixture synthetic (types like "Test Device Type A", limits with synthetic numbers); no upstream label, limit text or file name in any test.

---

## 14. Traps Checked

| Trap | Here |
|---|---|
| optional include without `required: false` | `CalibrationDevice → DeviceType`, `Session → TemplateVersion` (P19-02): `required: false`, tested |
| include of a model with a `defaultScope` | catalogue models have **none** (G-4) |
| A-90 / user includes across scopes | no `User` include from catalogue models; no actors returned to tenants |
| `schema.validate` passed to Express; path param unseen | `validate(schema, { from: ["params", "body"] })` on every `:id` route |
| `is_deleted` in code | no catalogue model is paranoid; nothing writes it |
| blanket `try/catch` in a migration | none; `make migrate-verify` reads the columns |
| model index on a migration-added column | `device_type_id` index in the P20-01 migration only |
| global uniqueness as an oracle | only on global content (type names); proposals' ids are per tenant |
| named export beside `export =` | models `export =` alone; contracts use named exports only |
| new role without `ROLE_LEVELS` | no role added; the operator is the super admin |

---

## 15. Out of Scope (other cards)

IPM session/result aggregate, its states, visit number, "due", work-order link and side effects → **P19-02**. QR, photos, condition, serial per facility, device moves → **P19-03**. `client_facilities`, the facility dimension, the route marker's implementation → **P19-04**. The IPM report document and its signatures → **P19-06**. Offline storage and sync of the catalogue → **P19-08** (this spec fixes only the download's shape and `ETag`). Menu slugs and grants → **P18-02 / P20-06**.

## 16. Decisions Made Here (agent, under delegation — recorded as ADR-125 Amendment 1)

1. Outcome vocabulary per section; physical and consumable codes corrected (G-1).
2. Read gate `calibration` | `ipm` | `ipm-templates`, not `equipment` (G-2).
3. Structured limits (`op` + low/high/nominal/tolerance + verbatim text), hard and soft input ranges, `flag` dropped (G-3).
4. Catalogue models not paranoid, no `defaultScope`; `status` is the only removal (G-4).
5. `calibration_devices.device_type_id` RESTRICT (G-5).
6. `discarded` drafts; version numbers assigned at publish (G-6).
7. Base republish rebases every published type version in the same transaction (G-7).
8. `item_definition_id` NOT NULL on template items (G-8).
9. Electrical-safety pass/fail computed and not overridable; performance pass/fail the technician's, computed kept beside it.
10. Decimal parsing: one separator, either `,` or `.`; grouping refused; `N.NNN` read as a decimal point with on-screen confirmation.
11. No unit conversion; a limit/item unit mismatch is a publish-time 400.
12. Proposal acceptance copies nothing automatically; it opens/links a draft.
13. The published document carries the active device types and its `ETag` covers them.
14. No socket event or webhook for catalogue changes.
15. No per-device-type IPM interval in the catalogue.
16. Exactly one publisher per published version: a user or a named system actor (`system:catalogue-seed`, `system:upstream-import`).

**For the owner / SME to confirm (none blocks the migration):** the seeded warn ranges (§ 6.5, especially mains voltage) and decision 9 (no override of a computed electrical-safety fail) at UAT (P26-01); decision 7's cost (a version per type on each base change) is accepted unless the operator objects.
