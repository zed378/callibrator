# 2026-09-27/28 — Restore drill, secret escrow, rotation rehearsal, serial decision (P7-04, P7-05, P6-10, P6-06)

**Decision record:** [ADR-078](../DECISIONS.md) — the findings D-1…D-7, the decisions, the alternatives and the implications.

## The drill (P7-04)

Throwaway compose stack, project `callib-drill`, the repository's `docker-compose.yml` plus an overlay
(backend image built from `c905e74` with the working tree's Dockerfile; loopback ports 27300/27432; no
clamav/frontend/nginx — `VIRUS_SCAN_PROVIDER=none`, the API driven directly). Torn down afterwards;
image removed. Scripts lived in the agent's scratchpad (`ops/`), not the repository.

**Seeded (through the API, as each tenant's administrator):** two tenants (enterprise plan); per tenant
a HEALTHCARE ADMIN, devices, two calibration records each, certificates taken draft → submit →
approve → sign with a rendered PDF, one text attachment per device, an e-signature key pair, an
e-signature workflow signed and verified, a webhook, an `oidc_client_secret`. The super administrator
enrolled TOTP (P6-07). Totals: A 8 devices / 16 records / 5 certificates / 8 attachments; B 6 / 12 / 3 /
6; 12 KMS envelopes; 134 audit rows.

**Backups (timeline, UTC):**

| | |
|---|---|
| 03:43:35 | `pg_dump -Fc` exactly as `make backup` (372,789 bytes, 843 TOC entries); tenant backups `POST /tenants/:id/backups` + download, both tenants |
| 03:43:44 | tarball of `volumes/uploads`, `storage`, `backup`; the nine secrets copied to a separate escrow file; the non-secret `.env` kept apart |
| 03:43:53 | a marker device written **after** the dump (the RPO probe) |
| 03:44:01 | **incident:** `docker compose down -v`, every volume and the `.env` deleted |
| 03:44:19 | restore start (docs/DEVOPS/04 as then written) |
| 03:45:49 | `pg_restore` exit 1 — 85 errors, all `role "callibrator_app" does not exist` (D-4); the backend then refused to boot on it |
| 03:48:00 | database recreated with the role first, `pg_restore --exit-on-error` exit 0 |
| 03:48:13 | `/health` 200 — **RTO 234 s** from restore start |
| 03:48:46 | checklist complete |

**Checklist, pre-incident vs post-restore (`04-check.js`): identical.** `/health` 200; super administrator
(with TOTP) and both tenant administrators sign in; each tenant's lists hold only its rows and the other
tenant's device is 404; all 8 certificates `valid`, same integrity hashes, public document bytes
identical; all 14 attachments byte-identical through a fresh signed URL; both e-signatures valid.
Row counts of all 75 tables equal except `audit_logs`/`sessions`/`tenant_backups` (rows the drill's own
sign-ins and backups wrote after the baseline). Audit trail: the 134 rows up to the dump have the same
md5 digest; the marker device written after the dump is absent — **RPO = age of the dump**. Migrations
pending: 0 of 63.

**Lost-secret probes on the restored database:**
- new `KMS_MASTER_KEY` → `[kms-verify] FAILED`, UNREADABLE tenant_keys (5), tenant_settings (2),
  users.mfa_secret (1), webhooks (4); no `/health`; restart loop. With `KMS_VERIFY=warn`: `/health` 200,
  lists and public verification fine, **signing 500, super-admin MFA sign-in 500** (D-6).
- new `CERT_SIGNING_SECRET`, `ATTACHMENT_URL_SECRET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, no
  `ENCRYPT_KEY` → full checklist identical (apart from the P6-06 probe devices).

## Rotation rehearsal (P6-10)

On the restored stack, `docs/SECURITY/13` step by step, `keys:rotate` run from a clean worktree of HEAD
(no `backend/.env`): 12 envelopes re-wrapped (tenant_settings 2, webhooks 4, tenant_keys 5,
users.mfa_secret 1), failed 0; second dry run 0; after the previous key was removed, boot
`[kms-verify] OK`, an **old TOTP seed verified a real code**, pre-rotation e-signatures verified, new
e-signatures signed and verified in both tenants, a webhook secret rotated, and the certificate and
attachment checks stayed identical.

## P6-06 on the stack

Delete a device, re-register its serial → 409 naming the deleted device's id; same serial in the other
tenant → 201; other tenant restores it → 404; restore → 200; again → 409 "not deleted".

## Changes

- `backend/src/utils/kmsVerify.util.js` + `index.js` boot call (in `a31c601`, verified here).
- `backend/src/services/tenantBackup.service.js` — `isBackupType` (D-3).
- `deploy/compose/docker-compose.yml` — `init: true` on postgres (D-2, in `a31c601`).
- Tests: `kmsVerify.util.p705.test.js` (9), `tenantBackup.backupType.p704.test.js` (4),
  `tenantBackup.service.test.js` (mock `BACKUP_TYPES` = the model's), `rawSqlTenantPredicate.d05.test.js`
  (CROSS_TENANT entry), `dataIntegrity.p6.live.test.js` (+1, live 22/22 on pg18).
- Docs: `docs/SECURITY/14-SECRET-ESCROW.md` (new), `docs/DEVOPS/04-DATABASE-BACKUP.md`,
  `docs/ARCHITECTURE/09-DISASTER-RECOVERY.md`, `docs/SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md`,
  `docs/SECURITY/13-KEY-ROTATION.md`.

## Fail-before

- `kmsVerify.util.p705.test.js` at `2acce51`: "Cannot find module '../../utils/kmsVerify.util'"; live, with the
  check switched off (`KMS_VERIFY=warn`, i.e. the pre-ADR-078 boot) the restore under a new KMS key reached `/health`
  200 and failed only per request (D-6); with it on, the boot refused.
- `tenantBackup.backupType.p704.test.js` at `c905e74` (clean worktree): 2 failed ("FULL", "USER_ONLY"),
  2 passed.

## Left open

- **D-1:** the backend image cannot render certificate PDFs (pkg + ESM puppeteer). Release blocker for
  certificate documents.
- **D-7:** `npm run migrate:status` does not exit under Node 26 + tsx.
- WAL archiving, a scheduled infrastructure dump, `make restore`, a Kubernetes drill, production-volume
  RTO, a rotation against a production copy.
