# 09 — Disaster Recovery

Procedures are in [`../DEVOPS/04-DATABASE-BACKUP.md`](../DEVOPS/04-DATABASE-BACKUP.md) and [`../DEVOPS/08-ROLLBACK.md`](../DEVOPS/08-ROLLBACK.md). This document is the strategy and the honest state of it.

---

## Objectives

| Metric | Target | Currently achievable? |
|---|---|---|
| RPO — maximum data loss | 1 hour | yes, with hourly database backup |
| RTO — maximum downtime | 4 hours | **unverified** — no full restore drill has been performed |
| Backup retention | 30 days rolling, 12 monthly | yes |
| Restore verification | monthly | **not yet scheduled** |

Two of those are aspirations rather than measurements, and they are marked as such. An RTO nobody has rehearsed is a guess, and the first rehearsal is the one where the surprises happen.

## Two Independent Backup Layers

They serve different failures and neither substitutes for the other.

### Layer 1 — tenant backup (a product feature)

`tenant_backups`, exposed at `/api/v1/tenants/:id/backups`.

| Column | Purpose |
|---|---|
| `backupType`, `tag` | full or partial, and a label |
| `cronExpression` | scheduled backups |
| `retentionDays`, `expiresAt` | lifecycle |
| `recordCount` | what was captured |
| `status` | `pending`, `in_progress`, `completed`, `failed`, `deleted` |
| `restoredAt` | when it was last restored |
| `errorMessage` | why it failed |

Answers: "a tenant admin deleted a warehouse and wants it back."

Does **not** answer: "the database volume is gone."

### Layer 2 — infrastructure backup (disaster recovery)

Whole-database dump plus WAL archiving for point-in-time recovery on PostgreSQL. Volume snapshots for the object store when it is local.

Answers: "the host is gone."

Does **not** answer: "restore just this tenant" — that is a full restore into a scratch instance followed by a selective export, which is slow and is exactly why layer 1 exists.

## Failure Scenarios

| Scenario | Detection | Response | Data loss |
|---|---|---|---|
| Backend process crash | `/health` 503, container restart policy | automatic restart | none |
| Database unreachable | `/health` 503 with `database: "disconnected"` | investigate; the app fails closed rather than serving stale data | none |
| Redis down | rate limiting and idempotency degrade | restart; **review for duplicate side effects during the window** | in-flight idempotency claims |
| RabbitMQ down | jobs queue up in `PENDING` | restart; queued messages persist on the volume | none if the volume survives |
| Disk full | writes fail | expand; check `./data` and `./log` | none |
| Host lost | external monitoring | rebuild from images, restore database, restore object store | up to RPO |
| Accidental tenant deletion | user report | tenant backup restore | since last tenant backup |
| Database corruption | integrity checks, query errors | point-in-time recovery | up to RPO |
| Ransomware | monitoring, anomalous access | restore to a clean host from offline backups | up to RPO |

The Redis row is the one most likely to be mishandled. Redis coming back is not the end of the incident — the window during which idempotency claims were unavailable is a window in which duplicate emails, duplicate webhook deliveries and duplicate job side effects were possible. That window needs reviewing, not assuming.

## Restore Order

Order matters, because the backend runs migrations at boot and will fail against a partially restored database.

```
1. Provision the host and install Docker
2. Restore the database volume, or restore from dump + WAL
3. Restore the object store (or repoint STORAGE_DRIVER at the surviving bucket)
4. Restore secrets — CERT_SIGNING_SECRET, ENCRYPT_KEY, ATTACHMENT_URL_SECRET
5. Start postgres, redis, rabbitmq; wait for healthy
6. Start the backend; it runs migrations
7. Verify /health returns 200 with database: "connected"
8. Start the frontend and nginx
9. Verify: login, a tenant-scoped list, a certificate verification URL
```

### Step 4 is the one that ends recoveries

**Restoring the database without `CERT_SIGNING_SECRET` and `ENCRYPT_KEY` produces a system that starts cleanly and is permanently broken:**

- Every issued certificate fails public verification, because the HMAC no longer matches. There is no way to re-derive the old key from the data.
- Every encrypted e-signature private key and every stored tenant storage credential is undecryptable.

These secrets must be backed up **separately from the database and separately from the host**, and their restore must be part of the drill. A backup strategy that captures the data and loses the keys has captured ciphertext.

## What a Restore Test Must Prove

Restoring without verifying is restoring into hope. The drill must assert:

- [ ] `/health` returns 200 with `database: "connected"`
- [ ] a user can log in
- [ ] a tenant-scoped list returns that tenant's rows **and no others**
- [ ] a certificate issued **before** the incident still verifies at its public URL
- [ ] an attachment uploaded before the incident still downloads through a signed URL
- [ ] migrations report no pending state
- [ ] the audit trail is continuous across the restore point

The certificate and attachment checks are the ones that catch a lost-secrets restore. Without them a broken recovery looks successful for weeks.

## Current Gaps

Stated plainly, because a disaster-recovery document that lists only its strengths is marketing:

| Gap | Consequence |
|---|---|
| **No full restore drill has been performed** | the 4-hour RTO is unverified |
| No scheduled monthly restore verification | backups are assumed good, not known good |
| Secret backup procedure not formalised | the failure above is possible today |
| No offsite replica | host loss means restore, not failover |
| Helm charts not cluster-validated | the Kubernetes recovery path is untested |

Each is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Communication

A recovery affecting tenant data is a notifiable event. GDPR Article 33 sets 72 hours for a personal-data breach; a compliance customer will ask for a written account regardless.

The audit trail is the primary evidence: `audit_logs` is append-only and continuous, so "what happened, to what, by whom, when" is answerable from the restored database rather than from memory.

See [`../SECURITY/12-INCIDENT-RESPONSE.md`](../SECURITY/12-INCIDENT-RESPONSE.md).
