# 04 — Database Backup

Strategy and honest gaps: [`../ARCHITECTURE/09-DISASTER-RECOVERY.md`](../ARCHITECTURE/09-DISASTER-RECOVERY.md). This document is the procedure.

---

## Two Independent Layers

They serve different failures and **neither substitutes for the other**.

| Layer | Scope | Answers | Does not answer |
|---|---|---|---|
| **Tenant backup** — a product feature | one tenant's rows | "an admin deleted a warehouse and wants it back" | "the database volume is gone" |
| **Infrastructure backup** — disaster recovery | the whole database | "the host is gone" | "restore just this tenant" |

Restoring one tenant from an infrastructure backup means a full restore into a scratch instance followed by a selective export — slow, which is exactly why layer 1 exists.

## Layer 1 — Tenant Backup

`tenant_backups`, exposed at `/api/v1/tenants/:tenantId/backups`, gated at `TENANT_ADMIN` (level 8).

| Column | Purpose |
|---|---|
| `backupType`, `tag` | full or partial, plus a label |
| `cronExpression` | scheduled |
| `retentionDays`, `expiresAt` | lifecycle |
| `recordCount` | what was captured |
| `status` | `pending`, `in_progress`, `completed`, `failed`, `deleted` — **exactly the column's ENUM** |
| `restoredAt` | when last restored — a restored backup is `completed` **with `restoredAt` set**, and cannot be restored again |
| `errorMessage` | why it failed |

**The state machine (S-32, 2026-09-24).** The service used to write `restoring`, `restored` and `deleting`, which the `status` ENUM does not have: on PostgreSQL **every restore and every HTTP delete failed** with `invalid input value for enum enum_tenant_backups_status` (reproduced on PG16 against the real model). Now, with ENUM members only:

| Operation | Transition |
|---|---|
| take | `pending` → `in_progress` → `completed` (with `expiresAt` and, for a user, its `CREATE` audit row, in one transaction) or `failed` |
| restore | `completed` (no `restoredAt`) → **`in_progress`, claimed conditionally** (of two concurrent restores exactly one proceeds; the other gets 409) → `completed` + `restoredAt` |
| delete | `completed`/`failed` → `deleted` + soft delete + `DELETE` audit row in **one transaction**; the file is unlinked after the commit. `in_progress` is a 409 |

Every transition a user makes is audited — take (`CREATE`), restore (`UPDATE`, operation `RESTORE`), delete (`DELETE`); the scheduled job's are audited under the system actor `system:scheduled-backup`. Before S-32 an HTTP backup and an HTTP delete wrote **no** audit row, and an HTTP backup never set `expiresAt`.

`filePath` (VARCHAR 500) is the path of record. `backupPath` (VARCHAR 255) is **legacy and no longer written** — the service copied the path into it, and a path longer than 255 characters (a long `APP_STORAGE_PATH`) failed the whole `completed` update with "value too long". Readers fall back to it for rows written before S-32. `fileSize`/`size` remain a duplicated pair.

### Scheduled tenant backup (S-03, S-14, S-33)

| Setting | Default | Meaning |
|---|---|---|
| `BACKUP_SCHEDULER` | `0 0 * * *` (compose `.env.example` and Helm: `0 3 * * 0`) | cron; **`disabled`/`off` turns it off**; an invalid expression is refused at boot and alerted (P7-02) |
| `BACKUP_RETENTION_DAYS` | `30` | retention a scheduled backup is created with (`expiresAt`) |
| `BACKUP_KEEP_MIN` | `3` | the newest completed backups of every tenant that pruning **never** removes, whatever their age |

Each run backs up every tenant that is not offboarded, then prunes expired backups (row-driven: `expiresAt`, else `createdAt + retentionDays`; a file is deleted only when it resolves inside the backup directory). It writes its outcome to **`<backup root>/last-scheduled-backup.json`** (`ok`, per-tenant successes and failures, prune counts) and — since P7-02 — a failed run is an **alert** (`job.scheduled-backup.failed`), a run that did not happen is `job.scheduled-backup.missed`, and on more than one replica only the one that claims the minute in Redis runs it (S-33). [`07-ALERTING.md`](./07-ALERTING.md).

**Restore is destructive** and must be audited with both the backup id and the actor.

## Layer 2 — Infrastructure Backup

### PostgreSQL

```bash
# nightly full
pg_dump -Fc -d "$DATABASE_URL" -f "backup-$(date +%F).dump"

# point-in-time recovery
archive_mode = on
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'
```

WAL archiving is what makes the 1-hour RPO achievable. Nightly dumps alone give a 24-hour RPO.

### Retention

| Kind | Kept |
|---|---|
| Hourly WAL | 7 days |
| Nightly dump | 30 days |
| Monthly | 12 months |

### Object storage

| Driver | Backup |
|---|---|
| `local` | volume snapshot of `./uploads` |
| `s3` | provider versioning plus cross-region replication |
| `nfs` | whatever the storage layer provides |

**A database backup without the objects is not a backup.** A calibration certificate row whose PDF is gone is a record pointing at nothing.

## The Third Thing, and It Is the One That Ends Recoveries

**Back up the secrets, separately from the database and separately from the host.**

```
CERT_SIGNING_SECRET      losing it: EVERY issued certificate permanently fails
                         public verification. The key cannot be re-derived.
ENCRYPT_KEY              losing it: every tenant private key and every stored
                         storage credential becomes undecryptable.
ATTACHMENT_URL_SECRET    losing it: existing signed URLs stop validating.
```

A restore that recovers the database and loses these produces a system that **starts cleanly and is permanently broken**. Nothing errors at boot. The failure appears the first time an auditor scans a QR code.

A backup strategy that captures the data and loses the keys has captured **ciphertext**.

Neither of the first two is practically rotatable ([`../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md`](../SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md)).

## Restore Order

The backend runs migrations at boot and will fail against a partially restored database, so order matters.

```
1. provision the host, install Docker
2. restore the database volume, or dump + WAL
3. restore the object store, or repoint STORAGE_DRIVER at the surviving bucket
4. RESTORE THE SECRETS                    ← the step that ends recoveries
5. start postgres, redis, rabbitmq; wait for healthy
6. start the backend; it runs migrations
7. verify /health returns 200 with {"status":"ok"}
8. start the frontend and nginx
9. verify — see below
```

## What a Restore Test Must Prove

Restoring without verifying is restoring into hope.

- [ ] `/health` returns 200 with `{"status":"ok"}` (a verdict over PostgreSQL, Redis and RabbitMQ; the per-dependency breakdown is `GET /api/v1/health`, super admin only)
- [ ] a user can log in
- [ ] a tenant-scoped list returns that tenant's rows **and no others**
- [ ] **a certificate issued before the incident still verifies at its public URL**
- [ ] **an attachment uploaded before the incident still downloads through a signed URL**
- [ ] `npm run migrate:status` reports nothing pending
- [ ] the audit trail is continuous across the restore point

The two bold checks are the ones that catch a **lost-secrets restore**. Without them a broken recovery looks successful for weeks.

## Verify the Backup, Not Just the Job

A backup job reporting success is not a backup.

```bash
pg_restore --list backup.dump | head          # readable?
pg_restore -d scratch backup.dump             # restorable?
psql -d scratch -c "SELECT count(*) FROM calibration_records;"   # populated?
```

The middle step is the only one that proves anything.

## Current Gaps, Stated Plainly

| Gap | Consequence |
|---|---|
| **No full restore drill has been performed** | the 4-hour RTO is unverified — it is a guess |
| No scheduled monthly restore verification | backups are assumed good, not known good |
| **Secret backup procedure not formalised** | the lost-secrets failure is possible today |
| No offsite replica | host loss means restore, not failover |

Each is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

A backup document listing only its strengths is a marketing document. The first drill is where the surprises happen, and it has not happened yet.

## Tables With Special Weight

| Table | Note |
|---|---|
| **`audit_logs`** | append-only, no delete path, grows monotonically. Purging needs a **compliance** decision, not an engineering one |
| **`calibration_records`** | evidence; retained far beyond device life |
| `iot_readings` | the only high-volume table purged by retention |
| `tenant_keys` | encrypted with `ENCRYPT_KEY` — useless without it |

## Compose Volumes

```
./volumes/postgres    the database
./volumes/redis       rate-limit counters, passkey/OIDC state, caches
./volumes/rabbitmq    queued messages
./volumes/uploads     attachments (always local disk) and the upload quarantine
./volumes/storage     the `local` storage driver's objects (S-40)
./volumes/backup      tenant backups + last-scheduled-backup.json
```

In Kubernetes, `/app/backup` is its own claim (`<base>-backup`, S-18) — before S-18 it had no volume at all.

`./volumes/redis` does not need backing up: it holds passkey challenges, OIDC authorisation state, lockout counters and caches, all short-lived. Losing it interrupts sign-ins in progress. (An earlier version said it held worker idempotency claims and that losing it reopened a duplicate window; no such claims exist.)

## Backup Failures Must Alert

A backup job that fails **silently** every night is worse than one that never ran, because everyone believes it did.

The retention purge did exactly this — failing nightly with `column "tenantId" does not exist` — until someone looked. Scheduled outcomes need alerting, not just logging — **in place since P7-02 for the tenant backup** ([`07-ALERTING.md`](./07-ALERTING.md)). The **infrastructure** backup (host `pg_dump`/WAL) runs outside the application and must alert on its own exit status; nothing in this repository does that for it yet.
