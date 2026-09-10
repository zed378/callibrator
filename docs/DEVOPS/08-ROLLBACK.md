# 08 — Rollback

Disaster recovery: [`../ARCHITECTURE/09-DISASTER-RECOVERY.md`](../ARCHITECTURE/09-DISASTER-RECOVERY.md). This document is rolling back a **deployment**.

---

## The Asymmetry

**Application code rolls back cleanly. Database migrations do not.**

```
image  ──▶ previous tag ──▶ done
schema ──▶ ???
```

That asymmetry governs everything below. A deployment that changed the schema is not a deployment you can undo by retagging.

## Rolling Back the Application

```bash
make rollback TAG=<previous-sha>
```

Repoint the image tag and restart. Seconds, and safe **provided the schema did not change**.

Where it did, the previous code must still work against the current schema — which is what expand-and-contract buys.

## Expand and Contract

The migration discipline that makes rollback possible.

```
release N     add the new column, nullable        ← code ignores it
              backfill
release N+1   code writes both, reads the new one
release N+2   code reads only the new one
release N+3   drop the old column
```

Each step is independently reversible. The previous release keeps working against the newer schema at every point.

**A single migration that renames a column in place breaks every running instance during the deploy**, and cannot be rolled back without another migration.

## Every Migration Needs a `down`

A migration with no rollback is a one-way door, and the moment you need it is an incident.

```bash
npm run migrate:undo      # down
npm run migrate:status    # pending
```

`down` must be tested, not merely written. An untested `down` is a comment.

### The two migration traps that also affect rollback

**The Umzug context IS the QueryInterface.** `context.sequelize.getQueryInterface()` throws.

**A blanket `try/catch` marks a migration applied while doing nothing.** Umzug records success, the column never appears, and the failure surfaces weeks later.

That second one poisons rollback too: `migrate:undo` will happily "undo" a migration that never did anything, and the state you land in is not the state you expected.

**Verify columns in `information_schema` after migrating, and after rolling back.**

## Migrations Run at Boot

The backend runs `db.sync()` and migrations at startup. Consequences for rollback:

- Deploying the previous image **re-runs migration state resolution**. It will not re-apply what is already applied, but it will fail to start if the schema is ahead in a way the older code cannot tolerate.
- On more than one replica, exactly one must run migrations, or two instances race.

## Decision Tree

```
Is the deployment failing?
├── code only, no migration
│      → retag to the previous image. Done.
│
├── migration was additive (expand)
│      → retag. The old code ignores the new column.
│
├── migration was destructive (dropped or renamed something)
│      → the old code CANNOT run against this schema
│      → roll forward with a fix, or restore from backup
│
└── data corrupted
       → point-in-time recovery — see 04-DATABASE-BACKUP.md
```

**Rolling forward is usually right.** A fix deployed in ten minutes beats a restore that loses an hour of writes.

## What Cannot Be Rolled Back

| Change | Why |
|---|---|
| A dropped column, once data is gone | |
| **A rotated `CERT_SIGNING_SECRET`** | every certificate issued under the old key fails verification, permanently |
| **A rotated `ENCRYPT_KEY`** without re-encryption | every wrapped value becomes undecryptable |
| A sent email or notification | |
| A delivered webhook | |
| An `audit_logs` row | append-only, by design |
| A charged payment | |

The two secrets have **no rotation procedure today**, which means "rotate the key" is not an available response to an incident. Designing one is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md), and it is far cheaper to design in advance than to improvise.

## Frontend Rollback

The frontend image is built per environment, because `NEXT_PUBLIC_*` values are **inlined at build time**.

Rolling back means deploying the previously built image **for that environment** — not rebuilding the previous commit, which would produce a different artefact.

Keep previous images. A rebuild is not a rollback.

## After Rollback

- [ ] `/health` returns 200 with `database: "connected"`
- [ ] a user can log in
- [ ] a tenant-scoped list returns that tenant's rows and no others
- [ ] **a certificate verifies at its public URL**
- [ ] an attachment downloads through a signed URL
- [ ] `migrate:status` reports nothing unexpected
- [ ] schedulers are running, and **on exactly one replica**
- [ ] no duplicate side effects during the window

The certificate check is the one that catches a configuration rollback that lost a secret.

The last one matters if Redis was restarted: idempotency claims live there, and an outage window is a window in which duplicate emails, webhook deliveries and job side effects were possible.

## Blast Radius Reduction

Not currently in place, and worth building before it is needed:

| Technique | Status |
|---|---|
| Feature flags per tenant | **available** — `/api/v1/feature-flags` |
| Canary deployment | not in place — single host |
| Blue-green | not in place |
| Staged rollout | not in place |

Feature flags are the one lever that exists today: a risky feature can be enabled per tenant and turned off without a deployment.

## Recording It

Every rollback gets a record in [`../../MEMORY/records/`](../../MEMORY/records/):

- what was deployed and what failed,
- **why it failed** — the mechanism, not the symptom,
- what was rolled back and what could not be,
- whether any data was lost,
- what would have caught it earlier.

**Record failures.** A rollback is one of the highest-value records available, because it is evidence about a gap between what was tested and what production does.

Per the honesty rules in [`../../MEMORY/README.md`](../../MEMORY/README.md): record what happened, not what was supposed to happen.
