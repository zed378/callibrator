# 2026-11-03: The backup verifier restores every source role (ADR-116 Am. 1)

**Status:** fixed in code and proven against PostgreSQL 18. **Not deployed**: the reference deployment still runs `zed378/calibration-backup:155605d`, which fails every night.

## What was wrong

After the `155605d` deploy on 2026-11-02, `/home/infra/callibrator/volumes/pgdump/restore-verify.history.jsonl` on the VM showed the nightly verification **failing six nights running (2026-10-27 … 2026-11-01)**. The latest failed check was `restore`:

```
pg_restore failed: Command was: GRANT USAGE ON SCHEMA upstream_import TO callibrator_transform;
```

The production cluster has all four roles (`callibrator`, `callibrator_app`, `callibrator_import`, `callibrator_transform`). `deploy/backup/backup-verify.sh` created only `DB_APP_ROLE` in its throwaway server, so the first grant to a Phase 24 role (migrations 0114, 0133) stopped `pg_restore --exit-on-error`. Dumps were still being written, but none was verified in that period.

The manual runbook, `docs/DEVOPS/04` § Restore Order step 4b, had the same gap.

## The change

- `facts_sql` records `roles`: the source's `pg_roles` minus `pg_*` and the dumping user, read in the dump's exported snapshot and stored in the manifest.
- `do_verify` creates each recorded role, plus `DB_APP_ROLE` when set, `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`. Names go through `format('%I')` and `\gexec`, with no shell interpolation into SQL. The database is created the same way. A manifest without `roles` (written before this change) falls back to `DB_APP_ROLE` only.
- `docs/DEVOPS/04`: a paragraph on the import roles; step 4b creates all three roles and grants them to the owner; the verification table names `roles`.
- ADR-116 Amendment 1 records the alternatives considered and the cost.

## Evidence

On the workstation, with throwaway resources removed afterwards by name (`bvfix-pg`, `bvfix-net`, `bvfix-backup:test`):

1. `pgvector/pgvector:pg18` (the compose digest), migrated by booting `zed378/calibration-be:155605d`. That boot applied 120 migrations and created the roles `callibrator_app`, `callibrator_import` and `callibrator_transform`.
2. `zed378/calibration-backup:155605d run-once`: `sha256` ok, `toc` ok (1531 entries), `scratch` ok (PostgreSQL 18.6), **`restore` FAILED, `GRANT USAGE ON SCHEMA upstream_import TO callibrator_transform`**. This is the VM's failure, reproduced.
3. The image rebuilt from this tree (`deploy/backup/Dockerfile`, backend context `zed378/calibration-be:155605d`), `run-once`: `sha256`, `toc`, `scratch`, **`restore` ok** (exit 0, 5 s), `pgvector` ok (0.8.6), `facts` ok, `schema` ok ("89 tables, 1302 columns and 124 control objects match the models"), `outcome: ok=true phase=complete`, restoreSeconds 10.

`bash -n deploy/backup/backup-verify.sh` passes.

## Not done

- **Not deployed.** It needs a backup image built from a commit with this change, pushed, and pulled on the VM (`scripts/release/push-images.ps1`, then `scripts/release/deploy-vm.sh`). Until then the VM keeps failing nightly.
- **The dumps already on the VM cannot pass verification** (no `roles` in their manifests). The first verified dump will be the first one the new image takes. Verifying an old dump would need the ACL-parsing fallback (ADR-116 Am. 1, alternatives).
- No automated test covers the shell script; its proof is the live run above, as in U-05.
- Why the six failure alerts went unnoticed is not investigated: whether `ALERT_WEBHOOK_URL` or `ALERT_EMAIL_TO` is set on the VM is not checked.
