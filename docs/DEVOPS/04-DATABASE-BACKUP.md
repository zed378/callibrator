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

**What it contains — measured in the P7-04 drill (ADR-078):** the tenant row and the tenant's user
accounts (an allow-list of identity columns, A-139). **Nothing else** — no devices, calibration
records, certificates, attachments, stock or audit rows. It answers "an administrator deleted or
changed user accounts", not "a warehouse was deleted": everything else needs layer 2. Until
2026-09-28 a backup taken **through the API** did not even hold the users: the validator sends
`"FULL"`, the export compared against `"full"`, and both drill tenants' archives came back with
`"users": []` (D-3, fixed in `tenantBackup.service.js#isBackupType`, test
`tenantBackup.backupType.p704.test.js`).

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
**Nothing in this repository configures WAL archiving**: with compose as shipped, the RPO is the age of
the last dump. `make backup` is the dump; it runs on the host against the compose stack
(`docker compose exec postgres pg_dump -Fc`), and a scheduler for it is the operator's.

**The dump does not contain the application role.** `pg_dump` writes the `GRANT … TO
callibrator_app` statements but not the role (roles are cluster-wide, ADR-062). Restored into a new
cluster, every grant fails, `pg_restore` exits 1 ("errors ignored on restore: 85" in the drill), and the
backend then refuses to boot with `role "callibrator_app" does not exist`. Create the role **before**
restoring — see Restore Order (drill finding D-4, ADR-078).

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

**Back up the secrets, separately from the database and separately from the host.** What, why and
how: [`../SECURITY/14-SECRET-ESCROW.md`](../SECURITY/14-SECRET-ESCROW.md).

```
KMS_MASTER_KEY (+ any _PREVIOUS a retained backup needs)
                         losing it: every tenant signing key, webhook secret,
                         tenant credential and every user's TOTP seed is gone.
                         UNRECOVERABLE. The backend refuses to boot (ADR-078).
ENCRYPT_KEY              only for a backup taken before migration 0058.
everything else          regenerate on loss — measured in the P7-04 drill.
```

**Corrected 2026-09-28 (ADR-078).** This section used to name `CERT_SIGNING_SECRET` as the key whose
loss makes every certificate fail verification, and left `KMS_MASTER_KEY` out. Since A-241 no issued
certificate depends on `CERT_SIGNING_SECRET` — the drill replaced it and every certificate still
verified with an identical integrity hash — and since P6-10/S-20 the KMS master key protects what
`ENCRYPT_KEY` used to, and more. The "starts cleanly and is permanently broken" restore was real: in the
drill, a restore under a new `KMS_MASTER_KEY` booted, answered `/health` 200 and served every list,
while signing and every MFA sign-in answered 500. The boot now refuses instead.

## Restore Order

The backend runs migrations at boot and will fail against a partially restored database, so order matters.
**Rehearsed end to end on 2026-09-28 (P7-04, ADR-078)** — the order below is the one that worked; the
previous list put the secrets fourth, but nothing (not even PostgreSQL) starts without the `.env`
they live in, and it had no step for the application role.

```
1. provision the host, install Docker, check out the release (the image tag you ran)
2. RESTORE THE SECRETS AND THE .env      ← 14-SECRET-ESCROW.md; compose reads DB_* from it
3. start postgres alone; wait until it accepts connections to DB_NAME
     (healthy is not enough on first boot: the init script restarts the server)
4. restore the database — one of:
   a) the volume snapshot (./volumes/postgres) — roles come with it; or
   b) a dump, role first:
        docker compose … exec -T postgres psql -U $DB_USER -d postgres \
          -c "DROP DATABASE $DB_NAME" \
          -c "CREATE ROLE callibrator_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS" \
          -c "GRANT callibrator_app TO $DB_USER" \
          -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"
        docker compose … exec -T postgres pg_restore -U $DB_USER -d $DB_NAME \
          --no-owner --exit-on-error < backups/db-<date>.dump
      (use DB_APP_ROLE's value if it is not callibrator_app; --exit-on-error makes a
       missing role a failure instead of "errors ignored")
5. restore the object store: ./volumes/uploads (attachments AND certificates/ PDFs),
   ./volumes/storage, ./volumes/backup — or repoint STORAGE_DRIVER at the surviving bucket
6. start redis, rabbitmq (empty volumes are fine), then the backend. Its boot migrates,
   verifies the schema ([schema-verify] OK) and the KMS ring ([kms-verify] OK) and
   refuses on either
7. verify /health returns 200 with {"status":"ok"}
8. start the frontend and nginx
9. verify — see below
```

**Measured (compose, one host, 14 devices / 28 calibration records / 8 certificates / 14 attachments /
134 audit rows):** 234 s from "restore start" to `/health` 200 with the order above — about 110 s of it
was the first attempt's missing-role failure. Most of a real RTO is step 1 and finding the escrow; the
4-hour target is not threatened by the restore itself at this size. The data loss equals the age of the
dump: the device written 17 s after the dump was absent after the restore, as expected (no WAL archive).

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

**Correction from the drill (ADR-078):** neither bold check catches a lost `KMS_MASTER_KEY` — both
passed on a restore under the wrong key. What catches it is the boot's `[kms-verify]` check, and, as a
manual step, **one MFA sign-in and one e-signature** after the restore.

All seven were asserted in the drill (`MEMORY/records/2026-09-27-p7-04-restore-drill.md`): every
per-tenant count, every certificate's integrity hash and document bytes, every attachment's bytes
through a fresh signed URL, the e-signatures, and the audit trail up to the dump (134 rows, identical
digest) were the same before the incident and after the restore; nothing pending.

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
| One restore drill performed (2026-09-28, compose, small data set — P7-04) | the restore itself took 234 s; the RTO at production volume and on Kubernetes is still unmeasured |
| No scheduled monthly restore verification | backups are assumed good, not known good |
| Secret escrow is a procedure ([`../SECURITY/14-SECRET-ESCROW.md`](../SECURITY/14-SECRET-ESCROW.md)), not a mechanism | nothing enforces that the escrow exists; the boot refuses a wrong KMS key (ADR-078) |
| No WAL archiving configured | RPO = age of the last dump |
| No offsite replica | host loss means restore, not failover |
| No `make restore` target | the restore is the manual sequence above |

Each is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

A backup document listing only its strengths is a marketing document. The first drill is where the surprises happen, and it has not happened yet.

## Tables With Special Weight

| Table | Note |
|---|---|
| **`audit_logs`** | append-only, no delete path, grows monotonically. Purging needs a **compliance** decision, not an engineering one |
| **`calibration_records`** | evidence; retained far beyond device life |
| `iot_readings` | the only high-volume table purged by retention |
| `tenant_keys`, `webhooks`, `tenant_settings`, `users` (MFA seeds) | KMS envelopes under `KMS_MASTER_KEY` (since 0058/0086) — useless without it; `ENCRYPT_KEY` only for a pre-0058 backup |

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
