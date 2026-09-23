# Documentation Gap Analysis — 2026-09

A benchmark-informed audit of `docs/`, `TASKS/`, `MEMORY/`, `README.md` and `CLAUDE.md`: every broken internal
reference, every category that is thin relative to the code it should describe, and what a comparison
against a second project by the same owner suggests Callibrator should — and should deliberately not —
adopt. **No documentation content was written and no code was changed to produce this file.**

## 0. Could the Benchmark Be Reached

**Yes.** `https://github.com/zed378/image-management` was reachable via `WebFetch` — the repo root, the
`docs/` tree listing, and two category subdirectories (`docs/SDK/`, `docs/PERFORMANCE/`) were fetched
successfully. `WebFetch` returns an AI-summarized rendering of the GitHub page, not a raw file listing or
file contents, so depth judgements below are based on directory structure, file names and the one-line
descriptions GitHub itself surfaces — not on reading the benchmark's document bodies. That is enough to
compare *categories and structure*, which is what this task asks for; it is not enough to compare prose
quality or grounding rigor between the two repositories, and this report does not claim to.

The benchmark is **Phase 0 — Foundation, not yet started**: a pnpm/turbo monorepo with `packages/`,
`services/`, 318 specification documents across 22 `docs/` categories, and, per its own repo description,
"no application code implemented." That single fact reframes the comparison (see § 4): the benchmark's
depth is *pre-code planning* depth, and Callibrator's `docs/README.md` rule — "ground every claim in
code" — has no equivalent to violate there, because there is no code yet.

---

## 1. Gap Summary

- **Broken links are not the problem.** A resolver-based check of all 845 relative markdown links across
  `docs/`, `TASKS/`, `MEMORY/`, `README.md` and `CLAUDE.md` found **2** that resolve to a missing file, both
  on one line. Zero case-sensitivity mismatches (Windows-invisible, Linux/CI-breaking) were found. The
  repository's link hygiene is good.
- **Dangling *citations* — file paths named in backticks rather than as clickable links — are a real
  problem, and two of them are serious.** `docs/DEVELOPER/02-AUTHENTICATION.md` and
  `MEMORY/specs/A-02-tenant-config-access.md` are each cited as the authoritative source inside a task
  card (`A-03`, `A-02`) that is marked **DONE**, and neither file exists. A naive `[text](url)` link
  checker — the kind this task warned against relying on alone — would report zero problems here, because
  these are not markdown links. See § 2.
- **A same-day stale-doc regression.** Six documents (`DEVOPS/05-MONITORING.md`, `DEVOPS/02-CONTAINERIZATION.md`,
  `API/12-PLATFORM-API.md`, `ARCHITECTURE/03-BACKEND-ARCHITECTURE.md`, `ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`,
  `PLAN/12-ADMIN-SURFACE.md`) still describe the **pre-fix** `/health` payload — including the exact
  `pid`/`node version` fields that `A-06` (information disclosure, **DONE 2026-09-23**) removed. The
  documentation was not updated the day the code it describes changed. This is the PR-4 shape `CLAUDE.md`
  opens by warning about, recurring in a file `CLAUDE.md` did not name.
- **Four `docs/` categories are structurally thin relative to the modules they cover**, and the repository
  already half-knows it: `DEVELOPER/`, `WEBHOOK/` and `OBSERVABILITY/` each carry a `README.md` that
  explains its own numbering gaps ("the numbering leaves gaps for guides ... not yet written"). `STORAGE/`,
  `SEARCH/` and `MULTI-TENANCY/` do the same thing (a single file or two, numbered as if from a larger
  planned set) **without** that README — so a reader lands in those three folders with no signal that
  anything is missing, unlike the other three. See § 3.
- **`createTwoTenants()` is still cited as real, load-bearing test infrastructure in eleven documents**,
  not eight. `CLAUDE.md` was corrected on 2026-09-23 (`A-55`) to say the fixture does not exist; the eleven
  `docs/` files that told engineers to use it as "a one-line fixture" were not. `A-55`'s own Definition of
  Done still lists "the documents that cite it are corrected" as an open checkbox.
- **`docs/README.md` — the map — is itself stale.** Its "Folder Structure" table omits `MULTI-TENANCY/`,
  `SEARCH/` and `WEBHOOK/` entirely and its prose says they "do not exist at all." All three exist today
  (2, 1 and 4 files respectively). This is the second-most-visited document in the repository (step 1 of
  "Before You Start" in `CLAUDE.md`) telling a new reader something the filesystem contradicts.
- **The benchmark's structure mostly does not transfer**, and where it does, Callibrator is already ahead
  in the one dimension that matters most for this kind of system (as-built grounding, deviation protocol,
  audit-driven correction) because the benchmark has no code yet to be grounded in. See § 4.

---

## 2. Broken-Link And Dangling-Citation Table

**Method.** A Node script walked every `.md` file under `docs/`, `TASKS/`, `MEMORY/`, plus `README.md`,
`CLAUDE.md`, `AGENTS.md` and `deploy/README.md`; extracted every `[text](target)` markdown link; skipped
`http(s)://` and `mailto:`; split off the `#anchor`; resolved the remaining path **relative to the source
file's own directory** (not the repo root — the naive-checker failure mode this task warned about); and
checked existence. A second pass re-walked the resolved path segment-by-segment against `fs.readdirSync`
results to catch **case-sensitivity** mismatches invisible on this Windows checkout but fatal on a
case-sensitive CI runner. A third pass matched `docs/…\.md`, `TASKS/…\.md` and `MEMORY/…\.md` patterns
**outside** of markdown-link parentheses — i.e. plain-text and backtick citations — and checked those too,
since `CLAUDE.md` itself is full of exactly this citation style. 845 markdown links and 39 distinct
backtick/plain-text path citations were checked.

### 2.1 Broken markdown links (2)

| # | Source | Target | Resolves to | Status |
|---|---|---|---|---|
| L-01 | `docs/ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md:49` | `../SEARCH/02-FULL-TEXT.md` | `docs/SEARCH/02-FULL-TEXT.md` | **missing** — `docs/SEARCH/` holds only `01-GLOBAL-SEARCH.md` |
| L-02 | `docs/ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md:49` | `../WEBHOOK/00-WEBHOOK-ARCHITECTURE.md` | `docs/WEBHOOK/00-WEBHOOK-ARCHITECTURE.md` | **missing** — `docs/WEBHOOK/README.md` already documents this gap ("Webhook Architecture — **not written**... that link is broken today") |

Both are on the same line: *"Full-text search is [`../SEARCH/02-FULL-TEXT.md`]… webhook fan-out is
[`../WEBHOOK/00-WEBHOOK-ARCHITECTURE.md`]."* Neither target exists.

### 2.2 Dangling backtick/plain-text citations, non-ARCHIVE (4 distinct targets)

These do not trip a markdown-link checker at all — the citation is prose or a table cell, not a hyperlink
— which is exactly the false-negative shape the opposite of the false positives this task warned about.

| # | Cited from | Cited path | Status | Why it matters |
|---|---|---|---|---|
| C-01 | `TASKS/AUDIT-2026-09-REMEDIATION.md:171` (Spec refs) and `:178` (Definition of Done) | `docs/DEVELOPER/02-AUTHENTICATION.md` | **missing** | Cited as *the* list of which routes API keys may reach, inside card **A-03**, marked **DONE**, severity **high**. The DoD literally says "the list is in `docs/DEVELOPER/02-AUTHENTICATION.md`" — an engineer following that instruction today finds nothing |
| C-02 | `TASKS/AUDIT-2026-09-REMEDIATION.md:134` (Spec refs) | `MEMORY/specs/A-02-tenant-config-access.md` | **missing** | Card **A-02** (critical config-exposure fix, **DONE**) says "Spec required: **yes**". `CLAUDE.md`'s own workflow says the spec is written **first, before** implementation. `MEMORY/specs/` contains only `README.md` — the spec that should have gated this fix was never written, or was written and not saved where the card says it is |
| C-03 | `docs/SEARCH/01-GLOBAL-SEARCH.md:184` | `docs/SEARCH/02-FULL-TEXT.md` | **missing** | Same target as L-01, cited a second time from inside the category itself |
| C-04 | `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md:143, :259, :498` | `MEMORY/records/P9-00.md`, `MEMORY/specs/P9-05-shared-types.md`, `MEMORY/records/P9-24.md` | **missing, but expected** | All three are cited inside **TODO** (not-yet-started) Phase 9 task cards whose own Definition of Done says the file "gets written" as part of doing that task. Not a defect — a forward reference to work not yet reached. Listed here only so it is not mistaken for one later |

### 2.3 `docs/ARCHIVE/` — `file://` links (85 instances, 1 file)

`docs/ARCHIVE/2026-06-modules-reference.md` uses 85 absolute `file:///c:/Users/Zed/Documents/Project/Callibrator/...`
links instead of relative markdown paths. A naive checker would flag all 85 as "not a normal link"; the
accurate finding is narrower:

| Sub-finding | Count | Status |
|---|---|---|
| point at `context.md` (e.g. `file:///…/context.md#L76-L89`) | 7 | **dead** — `context.md` was the pre-monorepo PRD; `docs/ARCHIVE/README.md`'s own provenance table shows it was superseded and is not present on disk anywhere in the repo |
| point at real `backend/src/...` model/route files | 78 | **resolve today, on this machine, for this user** — but are hardcoded to `C:\Users\Zed\...`, so they are dead the moment this repository is cloned to any other path, any other machine, or opened on Linux/macOS. This is a portability defect, not a currently-broken link |

Since `docs/README.md` states `ARCHIVE/` is "superseded... kept for provenance, never authoritative," this
is the lowest-priority item in this table — see `DOC-15`.

### 2.4 `docs/ARCHIVE/openclaw-*-directive.md` — a plan that names files never created (2 files, ~25 targets)

`docs/ARCHIVE/openclaw-backend-directive.md` and `openclaw-frontend-directive.md` cite roughly 25 distinct
paths under `docs/openclaw/...` (a memory tree with files like `03-architecture-map.md`,
`07-security-audit.md`, `15-change-log.md`). None of `docs/openclaw/` exists. Read in context, these two
files are **directives given to an earlier agent run**, prescribing a documentation structure it was
supposed to produce; the structure was apparently abandoned in favor of the `docs/` layout that exists
today. Internally self-consistent, entirely inside `ARCHIVE/`, and explicitly non-authoritative — noted
here as one line item rather than 25, and not carried into the DOC-xx cards below.

### 2.5 Non-issues surfaced by the citation scan (for completeness, not action)

`MEMORY/PROGRESS.md` and `MEMORY/BLOCKERS.md` are cited from three places — all inside `ARCHIVE/`
provenance tables ("was `MEMORY/PROGRESS.md`, superseded by `TASKS/PROGRESS.md`") or a `MEMORY/records/`
entry narrating the same move. These correctly describe a past location; they are not broken references.

---

## 3. Coverage Table — Category → Documents → Modules Covered → Modules NOT Covered

Grounded in `docs/BACKEND/10-MODULE-REFERENCE.md`'s own 33-module index (`HDC-AUTH` … `HDC-STORAGE`), which
every module gets a full 24-section generic entry in regardless of category. The gap this table names is
**category-specific deep-dive treatment** — the kind every other domain gets (e.g. calibration devices get
a `BACKEND/10` entry *and* `API/06`, `DATABASE/06`, `PLAN/06`, `UI-UX/12`) — not the generic template entry,
which every module already has.

| Category | Docs | Numbering | Modules it should cover | Covered in depth | NOT covered in depth |
|---|---|---|---|---|---|
| `STORAGE/` | 1 (`04-TENANT-STORAGE.md`, 290 lines) | starts at **04** — 00-03 unassigned, no README | Module 33 (`HDC-STORAGE`) | driver abstraction (local/s3/nfs), KMS credential encryption, key construction, signed downloads, tenant settings surface — all in the one file | the **migration tool** (`storageMigration.service.js`, `scripts/migrateStorage.js`) and its operational runbook; no architecture/index doc separate from the tenant-settings doc; `A-40`'s "null-checksum migration reports `migrated` unverified" has no doc at all |
| `SEARCH/` | 1 (`01-GLOBAL-SEARCH.md`, 207 lines) | starts at **01** — 00 and 02+ unassigned, no README, and 02 is a broken citation (§2.1, §2.2) | Module 29 (`HDC-SEARCH`) | the endpoint, its permission model (post-`A-04`), the FTS→ILIKE fallback in outline | the FTS mechanics themselves (`02-FULL-TEXT.md` is *cited* but not written — the tsvector migration, ranking, and `A-56`'s "second failure swallowed to `[]`") |
| `MULTI-TENANCY/` | 2 (`06-REALTIME-ISOLATION.md`, `08-CROSS-TENANT-PROTECTION.md`) | **06** and **08** only — 00-05, 07 unassigned, no README | Modules 5, 6, 7 (`HDC-TENANT`, `HDC-TLC`, `HDC-BAK`) plus the cross-cutting isolation mechanism `SECURITY/05` defines | realtime/socket isolation; an inventory of cross-tenant controls and their known gaps | **tenant hierarchy** (sub-organizations, parent/child) has no dedicated doc at all — notable because this is exactly the model `A-01` (critical: any user could re-parent another tenant) was found in; tenant lifecycle (suspend/activate) and tenant backup/restore (a deliberately cross-tenant-capable admin surface) are mentioned only in passing inside `BACKEND/10`, `API/04`, `PLAN/10`; there is no single place that enumerates **every legitimate exception to deny-by-default** (SCIM, tenant backup, tenant hierarchy reads, billing admin) in one inventory |
| `DEVELOPER/` | 3 (`07-IOT-INGEST.md`, `09-SCIM-PROVISIONING.md`, `README.md`) | **07** and **09** only — 00-06, 08 unassigned; README explicitly documents the gap | the entire integrator/service-account surface: API keys, auth for integrations, rate limits, IoT, SCIM, webhooks | IoT ingest (with its "built and unreachable" warning already in place) and SCIM provisioning in real depth | **API-key authentication and scoping has no dedicated doc** — and per §2.2/C-01, one is *cited as existing* from a DONE security card; no quickstart/onboarding doc for a new integrator; no rate-limit or error-code reference outside scattered mentions in `API/00-API-STANDARDS.md` |
| `OBSERVABILITY/` | 2 (`01-LOGGING.md`, `README.md`) | **01** only — 02+ unassigned | Module-crosscutting: what the platform emits at runtime | logging transports, levels, rotation, redaction, and — accurately — the fact that `docker logs` was empty in production (`A-14`, still open) | **this is not really a documentation gap** — the README says plainly "there is no metrics stack, no tracing and no aggregation," which matches the code (no Prometheus/OpenTelemetry dependency, no `deploy/` Prometheus/Grafana config exists). Writing a metrics/tracing doc here would describe a system that does not exist. Low priority; see `DOC-16` for the one place this *does* leave a real gap (numeric performance budgets) |
| `WEBHOOK/` | 4 (`01-EVENT-CATALOG.md`, `03-WEBHOOK-SECURITY.md`, `04-WEBHOOK-RETRY.md`, `README.md`) | **01, 03, 04** — no 00, no 02; README explains both gaps ("there is no `02-`... nothing links to it") | Module 15 (`HDC-DEV`) webhook half | event catalogue (2 real events vs. every name accepted), HMAC signing/SSRF history, retry/durability limits | the **00 architecture overview** the README itself says is missing and that `ARCHITECTURE/00` links to (L-02) |

### Categories that are *not* thin, for contrast

`API/` (14), `ARCHITECTURE/` (11), `BACKEND/` (12), `DATABASE/` (14), `DEVOPS/` (12), `ENGINEERING/` (16),
`FRONTEND/` (12), `PLAN/` (19), `SECURITY/` (13), `TESTING/` (8) and `UI-UX/` (20) are all **gapless
numbered sequences from 00** (or 00/01 through their max), several with a `README.md` on top. That
consistency is itself evidence: the thin categories above are not an oversight spread evenly across the
whole documentation set — they are six specific categories where a planned sequence stalled after 1–2
entries, and three of the six (`STORAGE/`, `SEARCH/`, `MULTI-TENANCY/`) do not even carry the "here's what's
missing and why" README the other three adopted.

---

## 4. Benchmark Comparison

The benchmark's 22 `docs/` categories, set against what Callibrator has and what it actually needs, given
it is a regulated multi-tenant hospital SaaS rather than a public image CDN:

| Benchmark category | Callibrator equivalent | Adopt / Skip | Reason |
|---|---|---|---|
| `API`, `ARCHITECTURE`, `DATABASE`, `SECURITY`, `TESTING`, `MULTI-TENANCY`, `DEVOPS`, `ENGINEERING`, `DEVELOPER`, `OBSERVABILITY`, `SEARCH`, `WEBHOOK`, `PLAN` | already exist, same names | — | direct overlap; both repos independently converged on the same category set for the parts of a backend SaaS that are domain-agnostic |
| `SDK` (8 docs: strategy, JS, TS, React, Next.js, PHP, Go, client-side component) | `docs/API/13-INTEGRATION-API.md` + the thin `DEVELOPER/` category | **skip the full category, adopt the gap it points at** | Callibrator is an internal-integration surface (SCIM, webhooks, a REST API for hospital IT and device vendors), not a platform whose value proposition is "install our client library." Shipping and maintaining 6 language SDKs no one asked for would be pure cost. What *should* transfer is the discipline the benchmark applies to its `DEVELOPER`-equivalent surface — a numbered, complete guide per integration path — which is precisely where Callibrator's own `DEVELOPER/` (3 of an implied ≥9 docs) falls short. See `DOC-11`, `DOC-12` |
| `PERFORMANCE` (10 docs: requirements, upload, processing, delivery, CDN, database, cache, concurrency, scalability, load testing) | `docs/TESTING/05-PERFORMANCE-TESTING.md` (1 file) | **skip the category, adopt one document** | A 10-document performance category sized for a request-per-image CDN does not map onto a CRUD-and-reporting hospital system with a handful of hot paths (device list, certificate PDF generation, search). `TASKS/BACKLOG.md` § Unverified Claims already carries `U-06`: "no load testing has been performed; no baseline exists." The honest, proportionate response is one additional document stating numeric budgets for Callibrator's actual hot paths, not a category. See `DOC-16` |
| `ASSET`, `CDN`, `IMAGE-DELIVERY-PROTOCOL`, `IMAGE-PROCESSING` | none | **skip entirely** | These are the benchmark's core *product* domain (transformation pipelines, edge caching, delivery protocol). Callibrator's core domain is calibration/maintenance/QMS, already covered by `PLAN/06`, `PLAN/07`, `API/06`–`10`, `DATABASE/06`–`09`. Adopting these categories would mean documenting a product Callibrator does not build |
| `WEBSITE` (public presence, positioning, landing page, launch checklist) | none | **skip** | Callibrator is not a self-serve product with a public marketing site in this repository's scope; `PLAN/00`–`02` already cover positioning for an enterprise sales motion. A launch-checklist document has no object to point at here |
| — | `ARCHIVE/` (9 docs) | **benchmark has no equivalent — Callibrator should keep this** | The benchmark cannot have a superseded-documentation folder yet; nothing has shipped to be superseded. This is where Callibrator is structurally ahead: it is the direct mechanism the deviation protocol (`CLAUDE.md` § The Deviation Protocol) produces, and it is why `PR-4` (a stale doc producing "confidently wrong work") is a *named, recorded* failure here rather than a live one |
| — | as-built grounding discipline (`docs/README.md` § Rules: "ground every claim in code... name the file") | **benchmark has no equivalent to compare — noted, not adopted, because there is nothing to adopt from** | The benchmark's 318 documents describe a system with zero lines of application code (its own repo description: "Phase 0... not yet started"). Its documents cannot yet drift from code the way `A-12`, `A-30` and the `/health` regression above show Callibrator's can — the risk that makes this whole audit necessary does not exist there yet. This is not a criticism of the benchmark (pre-code specification is a legitimate, different phase of work); it means the comparison of *document count per category* is not apples-to-apples, and copying its table of contents wholesale — as this task's brief warned — would be the mistake it named |

**Net:** adopt the *underlying gaps* the benchmark's `SDK` and `PERFORMANCE` categories point at (a
complete, numbered developer-integration surface; explicit numeric performance budgets somewhere durable),
sized to Callibrator's actual integration and performance surface rather than copied at the benchmark's
scale. Skip `ASSET`, `CDN`, `IMAGE-DELIVERY-PROTOCOL`, `IMAGE-PROCESSING` and `WEBSITE` outright as
domain-mismatched. Keep and lean further into `ARCHIVE/` and the as-built/deviation-protocol discipline,
which the benchmark cannot yet demonstrate either way.

---

## 5. Stale Or Thin Documents

Judged against the code and against other `docs/` files describing the same subsystem, not against the
benchmark.

| Document | Problem | Evidence |
|---|---|---|
| `docs/README.md` | The map itself is stale. "Folder Structure" omits `MULTI-TENANCY/`, `SEARCH/`, `WEBHOOK/` and states they "do not exist at all" | all three exist (2, 1, 4 files); confirmed by direct listing. This is read first, per `CLAUDE.md` § Before You Start item 1 |
| `docs/DEVOPS/05-MONITORING.md` | Documents the **pre-`A-06`/`A-15`** `/health` contract: "200 with uptime, memory, pid, node version... **503** with `database: disconnected`" and lists `GET /` / `GET /health` as the liveness/readiness pair | `A-06` (DONE 2026-09-23) removed every one of those fields from the public response (`{"status":"ok"}` only, one key). `A-15` (DONE 2026-09-23) replaced the two-endpoint pair with three: `/live` (dependency-free), `/ready` (DB+Redis+RabbitMQ), `/health` (verdict only) |
| `docs/API/12-PLATFORM-API.md:165` | Same stale `/health` payload, verbatim | see above |
| `docs/ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md:120` | Same stale `/health` payload | see above |
| `docs/PLAN/12-ADMIN-SURFACE.md:107` | Same stale `/health` payload | see above |
| `docs/ARCHITECTURE/03-BACKEND-ARCHITECTURE.md:30` | Lists `GET /health` and `GET /` as the health surface; the third route (`/live`) added by `A-15` is absent | see above |
| `docs/DEVOPS/02-CONTAINERIZATION.md:133` | Same two-route health surface, missing `/live` | see above |
| 11 documents (`BACKEND/05`, `BACKEND/09`, `ENGINEERING/05`, `ENGINEERING/09`, `MULTI-TENANCY/06`, `SECURITY/05`, `SECURITY/11`, `TESTING/00`, `TESTING/02`, `TESTING/03`, `TESTING/04`) | Present `createTwoTenants()` as real, working, "one-line," "load-bearing" test infrastructure, several with code samples calling it | Confirmed by repo-wide grep: `createTwoTenants` appears in **zero** `.js` files. `CLAUDE.md` was corrected 2026-09-23 (`A-55`) to say so explicitly; none of these eleven were. `A-55`'s own Definition of Done still has "the documents that cite it are corrected" unchecked |
| `docs/DEVELOPER/README.md` (not stale, but worth naming) | Explicitly the *model* for how a category should disclose its own gaps ("the numbering leaves gaps for guides... a link to a `DEVELOPER/` path absent from the table above is a broken link, not a hidden document") | `STORAGE/`, `SEARCH/` and `MULTI-TENANCY/` do not follow this pattern — see `DOC-05`, `DOC-08`, `DOC-10` |
| `docs/ARCHIVE/2026-06-modules-reference.md` | 85 `file://` links hardcoded to one machine's absolute path; 7 of them point at `context.md`, a file that no longer exists anywhere in the repo | § 2.3 |

---

## 6. Proposed Documents — Task Cards

Same shape as `TASKS/AUDIT-2026-09-REMEDIATION.md`. All Status **TODO**. Priority follows that file's
convention: **0** = fixes something a completed, higher-severity task's own Definition of Done depends on;
**1** = a named broken reference or a security/compliance-relevant category gap; **2** = hygiene, schedule
freely.

### DOC-01 — Write `docs/DEVELOPER/02-AUTHENTICATION.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **0** |
| **Audience** | backend engineers wiring a new route; anyone reviewing whether a route is safely reachable by an API key |
| **Grounding** | `backend/src/middlewares/auth.middleware.js` (`tryApiKeyAuth`, `allowApiKey`), `backend/src/middlewares/dynamicAccess.middleware.js` (`checkApiKeyScope`, sets `req.apiKeyAuthorized`), `backend/src/utils/controllerWrapper.util.js` (`asyncHandler`/`asyncHandlerWithMapping` — the deny-by-default chokepoint), `backend/src/services/apiKey.service.js` (`assertScopes`), `backend/src/routes/api/scim.route.js` (`requireApiKeyOrAdmin`, the one self-authorizing exception), `TASKS/AUDIT-2026-09-REMEDIATION.md` §§ A-03, A-27 |
| **Size** | M (this is exactly the document `A-03`'s Definition of Done says already exists) |

**Must contain:** the deny-by-default shape adopted in `A-03` (a route reaches its controller with an
unauthorized API-key principal only if a gate set `req.apiKeyAuthorized`); the two ways a route opts in
(`dynamicAccess(resource, action)` vs. the explicit `allowApiKey` escape hatch, and when each is correct);
a route-by-route table of which of the 53 route modules are API-key-reachable today and under which scope
string; the `A-07` caveat that several `dynamicAccess` resource names (`Management`, `Maintenance`,
`Finance`, `Vendors`, `Billing`, `AuditLogs`) do not match any real `MENU_SLUGS` entry and that this is
**unverified**, not fixed; the two controllers (`iot.controller.js`, `predictiveMaintenance.controller.js`)
that bypass the wrapper chokepoint entirely, named as residual risk exactly as `A-03`'s own writeup names
them.

**Definition of Done**
- [ ] every one of the 53 route modules appears in the reachability table, with its actual gate
- [ ] the `A-07` mismatched resource names are listed as open, not silently resolved by this document
- [ ] `TASKS/AUDIT-2026-09-REMEDIATION.md` A-03's citation now resolves
- [ ] cross-linked from `docs/DEVELOPER/README.md`'s document table (which currently has no `02` row) and from `docs/SECURITY/04-AUTHORIZATION-RBAC.md`

---

### DOC-02 — Write `MEMORY/specs/A-02-tenant-config-access.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **0** |
| **Audience** | whoever reviews `A-02`'s implementation against its stated requirement, and whoever next touches webhook/storage/custom-domain access control |
| **Grounding** | `TASKS/AUDIT-2026-09-REMEDIATION.md` § A-02 (the "What was changed" section already states the decision reached — TENANT_ADMIN-only for webhooks and storage settings, `dynamicAccess` for custom domains); `MEMORY/templates/FEATURE-SPEC-TEMPLATE.md` for the expected shape; `CLAUDE.md` § Workflow step 2 |
| **Size** | S — this is a retroactive write-up of a decision already made and shipped, not new design work |

**Must contain:** the access-control question `A-02` was opened to answer (who may configure webhooks,
storage and custom domains, given neither had a menu slug at the time), the options considered, and the
decision recorded in the card's "What was changed" table, in the spec-template shape so it is discoverable
the way every other `Spec required: yes` card's spec is.

**Definition of Done**
- [ ] `MEMORY/specs/` contains the file; `TASKS/AUDIT-2026-09-REMEDIATION.md:134`'s citation resolves
- [ ] `MEMORY/MEMORY-INDEX.md` gets an entry, per the standard workflow
- [ ] a one-line audit of every other `Spec required: yes` card in the same file to confirm this is not a second instance of the same gap (not done as part of this task — flagged as worth a follow-up sweep)

---

### DOC-03 — Write `docs/WEBHOOK/00-WEBHOOK-ARCHITECTURE.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **1** |
| **Audience** | a backend engineer or an integrator's engineer forming a mental model of the outbound webhook system before reading the security/retry/event-catalogue detail docs |
| **Grounding** | `backend/src/services/webhook.service.js`, `backend/src/controllers/webhook.controller.js`, `backend/src/routes/api/webhooks.route.js`, `backend/src/models/webhook.model.js`, `backend/src/models/webhookDelivery.model.js`; `docs/WEBHOOK/README.md` (already states this doc's intended scope); `docs/ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md:49` (the broken link this closes) |
| **Size** | S — an overview that sits above the three existing detail docs, not a fourth detail doc |

**Must contain:** the emit → queue → deliver → retry → dead-letter shape (as it actually is today, not the
RabbitMQ design `A-10` defers to); how this relates to the three existing docs (`01` catalogue, `03`
security, `04` retry) so it functions as their index; the one paragraph `WEBHOOK/README.md` already has
under "The Short Version," expanded and diagrammed rather than duplicated.

**Definition of Done**
- [ ] `docs/ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md:49`'s link resolves
- [ ] `docs/WEBHOOK/README.md`'s document table gets a `00` row
- [ ] no content duplicated verbatim from `01`/`03`/`04` — this document links to them rather than restating them

---

### DOC-04 — Write `docs/SEARCH/02-FULL-TEXT.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **1** |
| **Audience** | backend engineers touching `search.service.js`; whoever picks up `A-56` |
| **Grounding** | `backend/src/services/search.service.js`, `backend/src/migrations/0003-add-search-vectors.js`; `docs/SEARCH/01-GLOBAL-SEARCH.md` (cites this doc at line 184); `docs/ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md:49` (the other half of the same broken line) |
| **Size** | S |

**Must contain:** the tsvector migration and what columns/tables it covers; the FTS query construction; the
ILIKE fallback and **why** it exists as a fallback rather than the primary path; `A-56`'s open finding (a
second failure is swallowed into an empty result set rather than surfaced) stated as a known defect, not
silently omitted.

**Definition of Done**
- [ ] both halves of `ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md:49` resolve once this and `DOC-03` land
- [ ] `docs/SEARCH/01-GLOBAL-SEARCH.md:184`'s citation resolves

---

### DOC-05 — Write `docs/MULTI-TENANCY/README.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **1** |
| **Audience** | anyone landing in this folder — currently the only one of the three thin, README-less categories that also happens to be the one `CLAUDE.md` calls mandatory reading (via `SECURITY/05`) |
| **Grounding** | `docs/DEVELOPER/README.md`, `docs/WEBHOOK/README.md`, `docs/OBSERVABILITY/README.md` — the three existing examples of this exact pattern; `docs/BACKEND/10-MODULE-REFERENCE.md` modules 5–7 |
| **Size** | XS — this is a ~30-line index, matching the three models it follows |

**Must contain:** the same disclosure the other three READMEs give — a document table with the numbering
gaps named explicitly (00–05, 07 unassigned), a pointer to `SECURITY/05-MULTI-TENANCY-SECURITY.md` as the
mandatory document this category *extends* rather than replaces (both `06` and `08` already say this
individually; the README should say it once, at the top).

**Definition of Done**
- [ ] the document table lists `06` and `08` with their real titles and marks 00–05/07 as unassigned, mirroring `WEBHOOK/README.md`'s "there is no `02-`" line
- [ ] linked from `docs/README.md`'s (corrected, per `DOC-14`) folder structure

---

### DOC-06 — Write `docs/MULTI-TENANCY/01-TENANT-HIERARCHY-AND-SUBORGS.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **1** |
| **Audience** | anyone building on or reviewing tenant hierarchy, tenant lifecycle or tenant backup — three modules that are all deliberately capable of crossing the normal per-row tenant boundary |
| **Grounding** | `backend/src/models/tenant.model.js`, `tenantHierarchy.model.js` (no `tenantId` attribute — the actual root cause named in `A-01`'s evidence), `backend/src/controllers/tenantHierarchy.controller.js`, `tenantLifecycle.controller.js`, `tenantBackup.controller.js`; `backend/src/routes/api/tenantHierarchy.route.js` (the `ownTenantGuard` / `superAdminOnly` + `denyApiKey` shape `A-01` put in place); `TASKS/AUDIT-2026-09-REMEDIATION.md` § A-01 |
| **Size** | M |

**Must contain:** why `Tenant` has no `tenantId` column and is therefore **outside** the global Sequelize
scoping hooks `SECURITY/05` describes as automatic — this is the single fact that made `A-01` possible, and
it belongs in a document a reviewer reads before touching this model again, not only in a remediation
card; the current gate shape per route (`ownTenantGuard` on reads, `superAdminOnly` + `denyApiKey` on
writes); the parent/child sub-organization model itself (what it is for, who is allowed to create one);
tenant lifecycle states and who may transition them; tenant backup/restore as a deliberately cross-tenant
admin capability and how it is scoped.

**Definition of Done**
- [ ] explicitly answers "why is this model not covered by the deny-by-default hooks `SECURITY/05` describes as universal" — the one question `SECURITY/05` itself cannot answer, since it describes the general mechanism
- [ ] the `A-01` fix (route-by-route gate table) is reproduced here as living documentation, not only in the (append-only) remediation card
- [ ] linked from `docs/MULTI-TENANCY/README.md`'s table

---

### DOC-07 — Write `docs/MULTI-TENANCY/07-SUPERADMIN-CROSS-TENANT-OPERATIONS.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **2** |
| **Audience** | security reviewers and anyone adding a new SUPERADMIN-only or cross-tenant capability |
| **Grounding** | `backend/src/routes/api/scim.route.js`, `tenantBackup.route.js`, `tenantHierarchy.route.js`, `billing.route.js` (admin paths); `backend/src/constants/roleConstants.js` (`ROLE_IDS.SUPER_ADMIN`); `TASKS/AUDIT-2026-09-REMEDIATION.md` §§ A-27, A-37, A-38, A-39 (every one of which is a SCIM/cross-tenant privilege-boundary defect) |
| **Size** | M |

**Must contain:** a single inventory table of every route or service function that is allowed to act
across tenants (SCIM provisioning, tenant backup, tenant hierarchy re-parenting, billing admin), what makes
each one an intentional exception rather than a bug, and a cross-reference to the four still-open SCIM
findings (`A-37` cross-tenant email oracle, `A-38` global SCIM groups, `A-39` silent no-grant provisioning)
so a reader sees the known gaps in the same place as the intended design, rather than having to reconstruct
that list from a remediation log.

**Definition of Done**
- [ ] every SUPERADMIN-gated or cross-tenant-capable route in the 53-module route set is accounted for in the inventory — present with its justification, or flagged as unreviewed
- [ ] the four open SCIM/cross-tenant findings are linked, not restated

---

### DOC-08 — Write `docs/STORAGE/README.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **1** |
| **Audience** | anyone landing in this folder |
| **Grounding** | same three-README pattern as `DOC-05`; `docs/STORAGE/04-TENANT-STORAGE.md`'s own implementation table |
| **Size** | XS |

**Definition of Done**
- [ ] document table with `04` listed and `00`–`03` marked unassigned, same shape as `WEBHOOK/README.md`

---

### DOC-09 — Write `docs/STORAGE/02-STORAGE-OPERATIONS-AND-MIGRATION.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **2** |
| **Audience** | whoever operates a legacy-attachment migration into the pluggable storage layer, or investigates `A-40` |
| **Grounding** | `backend/src/services/storageMigration.service.js`, `backend/src/scripts/migrateStorage.js`; `TASKS/AUDIT-2026-09-REMEDIATION.md` § A-40 ("a null-checksum migration reports `migrated` unverified"); `docs/STORAGE/04-TENANT-STORAGE.md`'s existing implementation table (currently the only place the migration tool is even named) |
| **Size** | S |

**Must contain:** the migration tool as an operational runbook — preconditions, how it decides a file
migrated successfully, what a null checksum means and why `A-40` calls that unverified, and the rollback
story if one exists (or the honest statement that it does not, matching this repository's stated practice
of naming absences rather than smoothing them).

**Definition of Done**
- [ ] `A-40`'s finding is linked, not silently resolved
- [ ] linked from `docs/STORAGE/README.md`

---

### DOC-10 — Write `docs/SEARCH/README.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **1** |
| **Audience** | anyone landing in this folder |
| **Grounding** | same pattern as `DOC-05`/`DOC-08` |
| **Size** | XS |

**Definition of Done**
- [ ] document table with `01` listed, `02` marked unassigned (matching the citation at `SEARCH/01:184` this and `DOC-04` together resolve)

---

### DOC-11 — Write `docs/DEVELOPER/00-INTEGRATION-QUICKSTART.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **2** |
| **Audience** | an integrator's engineer (hospital IT, a device vendor, an SI implementing SSO) arriving with no prior context — the reader `docs/DEVELOPER/README.md` says this whole category exists for |
| **Grounding** | `docs/API/00-API-STANDARDS.md` (envelope, status codes), `docs/API/01-AUTHENTICATION-API.md`, the (once written) `DOC-01`, `docs/DEVELOPER/07-IOT-INGEST.md` and `09-SCIM-PROVISIONING.md` as the two existing examples of this category's voice |
| **Size** | S — this is a front door, not a reference; it should mostly point elsewhere |

**Must contain:** the three integration paths that exist today (REST API + API key, SCIM provisioning,
outbound webhooks) and which document to read for each; the response envelope and status-code contract
from `CLAUDE.md`/`API/00`, stated once for an audience that will not read `CLAUDE.md`; explicitly, the
`DEVELOPER/README.md` "Standing Warning" that a documented integration surface can be built and
unreachable (IoT is the current example) — repeated here because this is the document a new integrator
reads first, and the warning is wasted if it is only ever read by people already inside the codebase.

**Definition of Done**
- [ ] every existing `DEVELOPER/` document is reachable from this one within two clicks
- [ ] does not duplicate `API/00-API-STANDARDS.md`; links to it

---

### DOC-12 — Write `docs/DEVELOPER/03-RATE-LIMITS-AND-ERROR-CODES.md`

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **2** |
| **Audience** | an integrator whose client needs to handle 429/lockout responses correctly |
| **Grounding** | `backend/src/services/rateLimiter.redis.service.js` (post-`A-30` — the Lua `EVAL` counter, the fail-to-memory-not-fail-open outage behaviour); `TASKS/AUDIT-2026-09-REMEDIATION.md` § A-30, A-16 (unverified: whether `req.ip` survives the proxy chain) |
| **Size** | S |

**Must contain:** the rate-limit shape after `A-30` (Redis-shared, replica-safe, fails to a per-process
counter on Redis outage — stated as a real limitation, not hidden); that keys are per-`req.ip` and `A-16`
(whether that is trustworthy through the production proxy chain) is still **unverified**, so an integrator
sharing an egress IP with other tenants' traffic should know that is an open question, not a settled one.

**Definition of Done**
- [ ] `A-16`'s unverified status is stated as unverified, not implied to be resolved

---

### DOC-13 — Correct the eleven documents citing `createTwoTenants()` as real

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **1** |
| **Audience** | every engineer who reads any of the eleven testing/security documents before writing a cross-tenant test |
| **Grounding** | `TASKS/AUDIT-2026-09-REMEDIATION.md` § A-55; `CLAUDE.md`'s own corrected paragraph (the model to match); the eleven files: `docs/BACKEND/05-TENANT-SCOPING.md`, `docs/BACKEND/09-TESTING.md`, `docs/ENGINEERING/05-LAYER-TEMPLATES.md`, `docs/ENGINEERING/09-TESTING-CONVENTIONS.md`, `docs/MULTI-TENANCY/06-REALTIME-ISOLATION.md`, `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`, `docs/SECURITY/11-SECURITY-TESTING.md`, `docs/TESTING/00-TEST-STRATEGY.md`, `docs/TESTING/02-INTEGRATION-TESTING.md`, `docs/TESTING/03-E2E-TESTING.md`, `docs/TESTING/04-SECURITY-TESTING.md` |
| **Size** | S per file, ~11 small edits — this is a correction pass, not new writing |

**Must contain, per file:** the same correction `CLAUDE.md` already made — state plainly that the fixture
does not exist yet, that writing it is a prerequisite, and either point at wherever it eventually lands
or (until then) show the setup it is meant to replace so the code samples in `ENGINEERING/05` and
`TESTING/03` do not silently fail if copied verbatim.

**Definition of Done**
- [ ] `A-55`'s own remaining checkbox ("the documents that cite it are corrected") can be checked
- [ ] no document in this list still presents `createTwoTenants()` as a callable, existing function without qualification
- [ ] this pass does **not** write the fixture itself — that is a code task, out of scope here, and conflating the two is exactly the kind of quiet substitution `CLAUDE.md` warns against

---

### DOC-14 — Fix `docs/README.md`'s stale Folder Structure section

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **0** |
| **Audience** | every reader — this is the entry point named first in `CLAUDE.md` § Before You Start |
| **Grounding** | direct directory listing: `docs/MULTI-TENANCY/` (2 files), `docs/SEARCH/` (1 file), `docs/WEBHOOK/` (4 files) |
| **Size** | XS — a table edit and one corrected paragraph |

**Must contain:** the three missing rows added to the Folder Structure table with their real counts; the
paragraph stating they "do not exist at all" removed or rewritten to describe the numbering-gap pattern
this report documents (§3) instead — which is accurate, where "do not exist" is not.

**Definition of Done**
- [ ] `docs/README.md`'s own folder-structure table, summed, matches `find docs -name "*.md" | wc -l` (175) within the categories it lists
- [ ] the false "do not exist at all" claim is gone

---

### DOC-15 — `docs/ARCHIVE/2026-06-modules-reference.md`: fix `file://` link hygiene

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **2** |
| **Audience** | low — `ARCHIVE/` is explicitly never-authoritative; this is a hygiene pass, not a correctness fix |
| **Grounding** | § 2.3 above; `docs/ARCHIVE/README.md`'s provenance table (confirms `context.md` was superseded, not merely moved) |
| **Size** | S |

**Must contain / do:** replace the 78 `file:///c:/Users/Zed/...` links that point at real source files with
ordinary repo-relative code spans (`` `backend/src/models/user.model.js` ``, not a clickable absolute-path
link — this file predates the current linking convention and should match it); remove or clearly annotate
the 7 references to `context.md#L...`, since that file no longer exists anywhere in the repository to
anchor a line range against.

**Definition of Done**
- [ ] zero `file:///c:/...` links remain in the repository
- [ ] no reference to `context.md` implies it can still be opened

---

### DOC-16 — Add numeric performance budgets (fold into `docs/TESTING/05-PERFORMANCE-TESTING.md`, do not create a new category)

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **2** |
| **Audience** | whoever eventually acts on `TASKS/BACKLOG.md`'s `U-06` ("no load testing has been performed; no baseline exists") — this document is preparation for that work, not a substitute for it |
| **Grounding** | `docs/TESTING/05-PERFORMANCE-TESTING.md` (existing, to be extended rather than replaced); `TASKS/BACKLOG.md` § Unverified Claims, `U-06`; the benchmark's `PERFORMANCE/00-PERFORMANCE-REQUIREMENTS.md` pattern (§4) as the structural idea being adopted at a fraction of its scale |
| **Size** | S–M |

**Must contain:** explicit numeric targets (not "fast," a number and a method) for Callibrator's actual hot
paths — device/calibration list rendering, certificate PDF generation (already a documented module,
`BACKEND/07-CERTIFICATE-PIPELINE.md`), global search latency, dashboard aggregation — each stated as a
**target**, clearly distinguished from a **measured** result, since none have been measured yet. This
document should make `U-06` easier to close later, not attempt to close it now by asserting numbers that
were not tested.

**Definition of Done**
- [ ] every number in the document is labeled target or measured — never presented ambiguously
- [ ] `TASKS/BACKLOG.md` `U-06` links here rather than restating

---

### DOC-17 — Correct the six documents describing the pre-`A-06`/`A-15` `/health` contract

| | |
|---|---|
| **Status** | TODO |
| **Priority** | **1** |
| **Audience** | DevOps/SRE-facing readers, and anyone configuring a load-balancer or Kubernetes probe against these documents |
| **Grounding** | `backend/src/services/health.service.js`, `backend/src/controllers/health.controller.js`, `backend/src/routes/internal/health.route.js` (all new, per `A-15`); `TASKS/AUDIT-2026-09-REMEDIATION.md` §§ A-06, A-15; the six stale files: `docs/DEVOPS/05-MONITORING.md`, `docs/DEVOPS/02-CONTAINERIZATION.md`, `docs/API/12-PLATFORM-API.md`, `docs/ARCHITECTURE/03-BACKEND-ARCHITECTURE.md`, `docs/ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`, `docs/PLAN/12-ADMIN-SURFACE.md` |
| **Size** | S per file |

**Must contain, per file:** the corrected three-route surface (`/live` dependency-free liveness, `/ready`
per-dependency readiness including Redis and RabbitMQ, `/health` a one-key verdict with the detailed
breakdown moved to the authenticated `GET /api/v1/health`); explicit removal of every field the old payload
showed (`pid`, `node version`, `memory`, `uptime`) — leaving them in even as a "before" example risks a
reader copying the sample payload into a client-side assumption.

**Definition of Done**
- [ ] no document outside `TASKS/AUDIT-2026-09-REMEDIATION.md`'s historical "What was changed" sections still shows the pre-fix payload as current
- [ ] all six files describe the same three-route surface consistently with each other
