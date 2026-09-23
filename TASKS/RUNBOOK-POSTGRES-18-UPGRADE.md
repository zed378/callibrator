# Runbook — Moving the Deployment to PostgreSQL 18

**Decision:** [ADR-041](../MEMORY/DECISIONS.md) · **Status:** not started · **Target:** the VM at
`10.1.200.13`, `/home/infra/callibrator`

---

## Read This Before Anything Else

**Changing the image tag and restarting does not work.** The repository now pins
`pgvector/pgvector:pg18`, but the volume on the VM was initialised by **PostgreSQL 17.11**
(confirmed 2026-09-23: `postgres (PostgreSQL) 17.11 (Debian 17.11-1.pgdg12+2)`, image
`pgvector/pgvector:pg17`). A PostgreSQL server will not read a data directory written by a
different major version. Start 18 against that volume and the container crash-loops with:

```
FATAL: database files are incompatible with server
DETAIL: The data directory was initialized by PostgreSQL version 17,
        which is not compatible with this version 18.
```

So: **do not `docker compose pull && up -d` on the VM after this change** until the steps below
have been carried out. That is the one way this goes badly, and it is the obvious thing to do.

## What Is Actually Being Moved

| | |
|---|---|
| Rows | one tenant; `signature_records`, `signature_workflows` and `tenant_keys` were all **empty** on 2026-09-23 |
| Extensions | `vector` only (migration `0018` runs `CREATE EXTENSION vector`) |
| Size | small — check with `\l+` before starting, but this is minutes, not hours |
| Application changes needed | **none.** Access is through Sequelize 6; nothing depends on a 17-specific behaviour |

The dataset being small is the argument for doing this now. It will not get smaller.

---

## Path A — Dump and Restore (recommended)

Simpler than `pg_upgrade`, avoids the checksum question entirely (see Path B), and the rollback is
an untouched volume.

### 1. Take the backup, and verify it is real

```bash
ssh infra@10.1.200.13
cd /home/infra/callibrator/deploy/compose

# Dump from the RUNNING 17 container, not from the host
docker exec callibrator-postgres-1 pg_dump -U callibrator -d callibrator -Fc \
  > /home/infra/callibrator-pg17-$(date +%F).dump

ls -lh /home/infra/callibrator-pg17-*.dump          # non-zero, and plausible
pg_restore --list /home/infra/callibrator-pg17-*.dump | head -40   # readable, lists tables
```

A dump file that exists is not a backup. The `pg_restore --list` is what tells you it can be read.

### 2. Record what the old cluster contained, so the restore can be checked against it

```bash
docker exec callibrator-postgres-1 psql -U callibrator -d callibrator -At \
  -c "select count(*) from users" \
  -c "select count(*) from tenants" \
  -c "select count(*) from calibration_devices" \
  -c "select count(*) from audit_logs" \
  -c "select count(*) from document_chunks" \
  -c "select extname, extversion from pg_extension" \
  -c "select name from schema_migrations order by name desc limit 3" \
  | tee /home/infra/pg17-inventory.txt
```

### 3. Stop the application, keep the old volume

```bash
docker compose -f docker-compose.yml -f docker-compose.vm.yml stop backend frontend
docker compose -f docker-compose.yml -f docker-compose.vm.yml stop postgres

docker volume ls | grep -i postgres      # note the exact name
```

**Do not remove that volume, and do not reuse its name.** It is the rollback.

### 4. Bring up 18 on a NEW volume

Point the postgres service at a new volume name (e.g. `pgdata18`) in the VM overlay, then:

```bash
git pull                                  # picks up the pg18 pin
docker compose -f docker-compose.yml -f docker-compose.vm.yml up -d postgres
docker logs -f callibrator-postgres-1     # expect "database system is ready to accept connections"
docker exec callibrator-postgres-1 postgres --version    # expect 18.x
```

### 5. Restore

```bash
docker exec -i callibrator-postgres-1 pg_restore -U callibrator -d callibrator --no-owner \
  < /home/infra/callibrator-pg17-*.dump
```

Errors about the `vector` extension already existing are expected and harmless. Errors about
missing types are **not** — stop and read them.

### 6. Update the extension and confirm the vector index

```bash
docker exec callibrator-postgres-1 psql -U callibrator -d callibrator \
  -c "ALTER EXTENSION vector UPDATE" \
  -c "select extname, extversion from pg_extension" \
  -c "\d document_chunks"
```

A vector index built under one extension version is not guaranteed to be usable by another. If the
index is missing after the restore, rebuild it before declaring this done.

### 7. Verify against the inventory from step 2

Re-run the same counts and **compare them to `pg17-inventory.txt` line by line.** A restore that
"completed without errors" and lost a table is the failure this step exists to catch.

### 8. Bring the application back and check it end to end

```bash
docker compose -f docker-compose.yml -f docker-compose.vm.yml up -d backend frontend
curl -s localhost:19000/health           # 200, verdict only
```

Then, by hand, because nothing automated covers this (there is no CI — A-19, and the live E2E suite
has never completed an uninterrupted run — P6-02):

- log in at `https://kalibrasi.zedth.my.id`
- open a device list, a certificate, and the dashboard
- run one search — it exercises both the full-text path and the tenant predicate
- ask one RAG question — it exercises `pgvector` specifically, which is the whole reason for the
  pgvector image
- check `docker logs callibrator-backend-1` for anything new

### 9. Only then

Keep the old volume for at least a week. Record the outcome in `MEMORY/records/`, and update
ADR-041's status line from "the deployment still runs 17.11" to what is actually true.

---

## Path B — `pg_upgrade`

Faster on a large dataset, and irrelevant here at this size. If it is ever used, one thing must be
checked first:

```bash
docker exec callibrator-postgres-1 psql -U callibrator -d callibrator -c "SHOW data_checksums"
```

`initdb` in 18 turns data checksums **on** by default, where 17 left them off. `pg_upgrade`
requires both clusters to agree, and a mismatch aborts it. If the old cluster reports `off`, the
new cluster has to be initialised with `--no-data-checksums`, or Path A used instead.

---

## Rollback

1. `docker compose stop postgres backend frontend`
2. point the postgres service back at the **old** volume and `pgvector/pgvector:pg17`
3. `docker compose up -d`

The old volume is untouched throughout Path A, which is the reason Path A is recommended.

---

## Definition of Done

- [ ] `postgres --version` on the VM reports 18.x
- [ ] every count in step 7 matches `pg17-inventory.txt`
- [ ] `select extname, extversion from pg_extension` shows `vector`, and `document_chunks` has its index
- [ ] login, a device list, a certificate, a search and one RAG answer all verified **by hand** in the browser
- [ ] the old volume still exists and is named in the record
- [ ] ADR-041's status line updated to reflect reality
- [ ] a `MEMORY/records/` entry written, including anything that went wrong

## What This Runbook Does Not Do

- It does not upgrade any other environment; there is only one.
- It does not test the application against 18 in advance. Nothing does — there is no CI, and the
  E2E suite has never passed in one run. The manual pass in step 8 is the evidence, and it should
  be described that way rather than as a green build.
- It does not address the `iot_readings` and `audit_logs` growth question (partitioning, deferred),
  which a major-version move would be a natural moment to reconsider.
