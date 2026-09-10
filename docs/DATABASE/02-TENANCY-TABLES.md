# 02 — Tenancy Tables

`tenants` · `tenant_hierarchies` · `tenant_settings` · `tenant_keys` · `tenant_backups` · `custom_domains` · `data_retention_policies`

---

## `tenants` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | PK |
| `name` | `STRING` | display name |
| `subdomain` | `STRING` | **required by the model, derived from `code`** (ADR-036) |
| `code` | `STRING` | indexed, the human identifier |
| `email` | `STRING` | indexed, falls back when not supplied |
| `domain` | `STRING` | indexed |
| `logo`, `primaryColor` | `STRING` | branding, readable pre-auth via `GET /tenants/public` |
| `plan` | ENUM | `free`, `professional`, `business`, `enterprise` |
| `status` | ENUM | `active`, `suspended`, `deleted` |
| `trialEndsAt` | `DATE` | |
| `billingCycle` | ENUM | **`monthly`, `yearly`** — note the casing versus `subscriptions` |
| `billingEmail` | `STRING` | |
| `contactName`, `contactEmail`, `contactPhone` | `STRING` | |
| `settings` | `JSONB` | structured configuration read as a unit |
| `limitSeats`, `limitStorageMb` | `INTEGER` | hard entitlement, enforced pre-handler |
| `parentId` | `UUID` | self-reference (migration `0013`) |
| `isDeleted` | `BOOLEAN` | |

Indexes: `status`, `subdomain`, `domain`, `email`, `code`, `is_deleted`.

### Three columns worth explaining

**`subdomain` is derived, not collected.** The model requires it; the creation form never asked for it. Before the fix, every tenant create returned a 500 `notNull` violation. It is derived from `code`, so it may not resemble anything a user typed.

**`status` has exactly three values.** Granular lifecycle state such as `offboarded` lives in `tenant_settings` under `lifecycle_status`. The service originally wrote uppercase values and states outside the ENUM, producing `invalid enum value` 500s on every suspend, resume and offboard (ADR-037).

**`settings` JSONB and `tenant_settings` rows both exist.** Use `settings` for configuration read as a unit; use `tenant_settings` for values written and read independently on their own schedule.

## `tenant_hierarchies`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `tenantCode`, `parentCode` | `STRING` | indexed — the edge, by code |
| `path` | `STRING` | **materialised** ancestor path, indexed |
| `depth` | `INTEGER` | distance from root |

A materialised path rather than recursive CTEs, because the platform must also run on MySQL and CTE support differs. Ancestor and descendant queries become prefix matches.

**Hierarchy does not grant visibility.** A parent tenant does not automatically see child data — the tenant predicate is still exact-match on `tenantId`.

## `tenant_settings`

| Column | Type | Notes |
|---|---|---|
| `tenantId`, `key` | `UUID`, `STRING` | composite index |
| `value` | `TEXT` | |

Known keys include `lifecycle_status`.

## `tenant_keys` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `keyId` | `STRING` | indexed — referenced by `certificates.digitalSignatureKeyId` |
| `keyType` | `STRING` | indexed |
| `algorithm` | `STRING` | |
| `publicKey` | `TEXT` | returnable |
| `privateKey` | `TEXT` | **encrypted at rest with `ENCRYPT_KEY`; never returned by any endpoint** |

Losing `ENCRYPT_KEY` makes every stored private key undecryptable. It must be backed up separately from the database — see [`../ARCHITECTURE/09-DISASTER-RECOVERY.md`](../ARCHITECTURE/09-DISASTER-RECOVERY.md).

## `tenant_backups` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `backupType`, `tag` | `STRING` | full or partial, plus a label |
| `filePath`, `backupPath` | `STRING` | |
| `fileSize`, `size` | `BIGINT` | |
| `recordCount` | `INTEGER` | what was captured |
| `status` | ENUM | `pending`, `in_progress`, `completed`, `failed`, `deleted` — indexed |
| `cronExpression` | `STRING` | scheduled backups |
| `retentionDays`, `expiresAt` | `INTEGER`, `DATE` | lifecycle |
| `restoredAt` | `DATE` | |
| `errorMessage` | `TEXT` | |
| `metadata` | `JSON` | |
| `createdBy`, `deletedBy` | `UUID` | |

Indexed on `tenant_id`, `status`, `created_at`.

`filePath`/`backupPath` and `fileSize`/`size` are duplicated pairs — a migration artefact. Check which one the service actually writes before relying on either.

## `custom_domains`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `domain` | `STRING` | indexed |
| `domainType` | ENUM | `custom`, `subdomain`, `vanity` |
| `status` | ENUM | `pending_verification`, `active`, `verification_failed`, `deleting`, `deleted` — indexed |
| `isDefault` | `BOOLEAN` | |
| `sslEnabled` | `BOOLEAN` | |
| `verificationToken` | `STRING` | DNS or HTTP-01 proof |
| `verifiedAt`, `lastCheckedAt` | `DATE` | |

TLS over ACME when `CUSTOM_DOMAINS_ENABLED` and `TLS_AUTO_PROVISION` are set.

**`ACME_DIRECTORY_URL` defaults to the Let's Encrypt staging directory.** Forgetting to point it at production yields certificates no browser trusts, and the failure appears in the browser rather than in any log.

Challenge files are written at runtime under `storagePath(".well-known")`. A CWD-relative path shifts with the launch directory and the resulting failures look like DNS problems.

## `data_retention_policies`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `entityType` | `STRING` | what this policy governs |
| `retentionDays` | `INTEGER` | |
| `isActive` | `BOOLEAN` | indexed |

A purge **must** skip anything under legal hold, regardless of age (BR-16). A retention policy that outranks a legal hold is a compliance incident.

The purge is scheduled by `RETENTION_SCHEDULER` (set to `disabled` to turn it off). It once failed entirely with `column "tenantId" does not exist`, because the sessions branch used `tenantId` where the `sessions` model attribute is `tenant_id`.
