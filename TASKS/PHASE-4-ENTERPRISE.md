# Phase 4 — Enterprise Features

**Status: ✅ largely DONE**, and it grew well past its original scope.

Written retrospectively. Most of what shipped here was not in the plan — the plan said "SSO and advanced features"; what arrived was a platform layer.

---

### P4-01 — Enterprise SSO

| | |
|---|---|
| **Status** | ✅ DONE — see [`PHASE-1-AUTH-AND-RBAC.md`](./PHASE-1-AUTH-AND-RBAC.md) P1-08 |

SAML and OIDC as a relying party with per-tenant callbacks, an OIDC **provider**, and SCIM 2.0. Delivered in Phase 1 rather than here.

---

### P4-02 — Tenant hierarchy

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/PLAN/10-TENANCY-AND-ONBOARDING.md` · `docs/API/04-TENANT-API.md` |

**What shipped:** `tenants.parentId` (migration `0013`) plus `tenant_hierarchies` materialising `path` and `depth`.

**A materialised path rather than recursive CTEs**, because the platform must also run on MySQL and CTE support differs. Ancestor and descendant queries become prefix matches.

**Hierarchy does not grant visibility.** A parent tenant does **not** automatically see child data — the tenant predicate is still exact-match on `tenantId`. Cross-tenant visibility for a group needs an explicit, audited path; it is not a side effect of the hierarchy.

That distinction is worth restating whenever someone asks for "group reporting".

---

### P4-03 — Tenant lifecycle

| | |
|---|---|
| **Status** | ✅ DONE — **after three defects** |

**What shipped:** suspend, resume, grace period, offboard, cancel offboard, export.

**⚠ Defect one — ADR-037.** The service wrote uppercase values such as `SUSPENDED`, and a state `offboarded` the ENUM did not contain. **Suspend, resume and offboard all 500ed** with `invalid enum value`.

`tenants.status` is exactly three values — `active`, `suspended`, `deleted` — because `auth.middleware.js` compares it on every request. Granular lifecycle state moved to `tenant_settings` under `lifecycle_status`.

**⚠ Defect two.** These endpoints validated `tenantId` in `req.body` when it only ever arrives as a **path parameter**. Every request 400ed. Fixed by merging `{ ...req.params, ...req.body }` before validating — a shape that recurred across feature flags and data retention too.

**⚠ Defect three — an operational trap, not a code bug.** Three E2E specs grabbed `/tenants/all` `data[0]` in `beforeAll` and suspended it. That is the **default tenant**, containing the super-admin running the test. Every subsequent request 403ed, and recovery required a direct database update.

Specs now create a **disposable** tenant. The rule is documented in three places because it costs a recovery each time it is forgotten.

**The routers are mounted under `/api/v1/tenants/...`**, not at `/api/v1/tenant-lifecycle` as the file name suggests. Four routers share that base path.

---

### P4-04 — Tenant backup

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** `tenant_backups` — on demand or cron-scheduled, with retention, expiry, record counts and restore.

Gated at `TENANT_ADMIN` (level 8) by `rbac()`, which is why that logical tier exists: one gate covering both admin roles.

**This is a product feature, not disaster recovery.** It answers "an admin deleted a warehouse and wants it back". It does **not** answer "the database volume is gone" — that is infrastructure backup, and neither substitutes for the other.

**Known wart:** `filePath`/`backupPath` and `fileSize`/`size` are duplicated column pairs, a migration artefact. Check which the service writes before relying on either.

---

### P4-05 — Custom domains and TLS

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** `custom_domains` with DNS verification and ACME TLS provisioning.

**Two traps, both of which fail in the wrong place:**

**`ACME_DIRECTORY_URL` defaults to the Let's Encrypt staging directory.** A production deployment that forgets to change it gets certificates **no browser trusts**, and the failure appears in a browser rather than in any log. Both the compose prod overlay and `make preflight` now refuse on it.

**Challenge files are written at runtime and must be served from `storagePath(".well-known")`** — the writable storage root. A CWD-relative path shifts with the launch directory, and the resulting verification failures **look like DNS problems**, which sends the investigation entirely the wrong way.

---

### P4-06 — Pluggable object storage

| | |
|---|---|
| **Status** | ✅ DONE — **beyond the plan** |
| **Spec refs** | `docs/ARCHITECTURE/05-STORAGE-ARCHITECTURE.md` |

**What shipped:** three drivers behind one port — `local`, `s3`, `nfs` — selectable globally and **overridable per tenant**, with tenant credentials encrypted at rest. MinIO-verified. Migration `0016` added `attachments.storageKey`.

**Key construction is a tenant-isolation control**, not a formatting concern: the key encodes tenant identity, so anyone who can influence it can read across tenants. Key building belongs in the storage service and nowhere else.

**The SSRF asymmetry is deliberate.** Tenant-supplied endpoints are checked; operator-configured ones are not, because `http://minio:9000` is a legitimate operator value. Any refactor unifying the two paths must keep the tenant side checked.

**`local` is incompatible with more than one backend replica** — replica A writes an attachment, replica B cannot serve it. This is the first of the three hard prerequisites for horizontal scaling (P8-01).

---

### P4-07 — Developer API

| | |
|---|---|
| **Status** | ✅ DONE — **beyond the plan** |

**What shipped:** scoped API keys (hash-only storage, a display prefix, `lastUsedAt`, `expiresAt`) and signed webhooks with delivery tracking.

**`exhausted` is a distinct terminal state from `failed`.** `failed` means another attempt follows; `exhausted` means we stopped. Collapsing them loses the ability to answer "did we give up, or are we still going?".

**A tenant-supplied webhook URL is an SSRF vector** — the platform makes an outbound request from its own network position to an address the tenant chose.

---

### P4-08 — GDPR and data retention

| | |
|---|---|
| **Status** | ✅ DONE — **after a defect that failed nightly** |

**What shipped:** DSAR export, erasure, rectification and restriction; versioned consent; retention policies with legal hold, PII masking and anonymisation.

**⚠ The defect worth remembering.** `POST /:tenantId/purge` 500ed with `column "tenantId" does not exist`, because the sessions branch used `tenantId` where the `sessions` model attribute is **`tenant_id`**.

**This broke the nightly retention cron, not just the endpoint.** A scheduled compliance job was failing every night, silently, until somebody looked. That is the strongest argument for P7-02.

**Erasure anonymises, it does not delete.** A calibration record whose `performedBy` resolves to nothing has lost the attribution that made it evidence. GDPR Article 17 and 21 CFR Part 11 are in genuine tension, and this is the resolution: preserve the record, sever the identity.

**Purge checks legal hold first**, before any age comparison. A retention policy that outranks a legal hold is a compliance incident, not a feature.

**`consent_records.version` is what makes a consent record meaningful.** Without it the row proves someone clicked agree; with it, it proves what they agreed to.

---

### P4-09 — Feature flags and network security

| | |
|---|---|
| **Status** | ✅ DONE |

**Feature flags:** per tenant, per key. Both identifiers are path parameters — the validator originally required them in the body and 400ed every request. Same shape as tenant lifecycle.

**Network security:** IP allowlisting and geofencing.

**⚠ Open trap — T31.** `PUT /network-security/ip-allowlist` **can exclude the caller**, and there is no in-product recovery. The mitigation — validating the new list against the caller's current address before applying — is **not implemented**.

Same shape as the tenant-suspension trap: an administrative action that removes the ability to reverse it.

---

## Phase 4 — Retrospective

**What shipped beyond plan:** pluggable object storage, the developer API with webhooks, GDPR and retention, feature flags, network security, tenant backup, custom domains with ACME.

**What failed, and what it taught:**

| Failure | Lesson |
|---|---|
| Suspend, resume and offboard all **500ed** | keep a security-critical ENUM small; put product state beside it |
| Several endpoints **400ed every request** | a path parameter must reach the validator |
| The nightly retention purge **failed every night** | `sessions` uses snake_case attributes — and **a silent scheduled failure is worse than one that never ran** |
| Three E2E specs **suspended the default tenant** | use a disposable tenant, always |

**What remains open:**

| | → |
|---|---|
| IP allowlist can lock out the caller, with no recovery | backlog |
| `local` storage blocks horizontal scaling | P8-01 |
| No alerting on scheduled-job outcomes | **P7-02** |

**What to watch:** `ACME_DIRECTORY_URL` pointing at staging in production. It produces certificates no browser trusts, and nothing in the logs says so.
