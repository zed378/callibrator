# Audit 2026-09 — Storage, Secrets and Deployment

Findings from the infrastructure audit of **2026-09-23**: `backend/src/services/storage/**`, the
attachment path, ClamAV, `kms.service.js` and every secret it does or does not wrap, all of
`deploy/`, both Dockerfiles and the `Makefile`.

Task ids are `S-nn`. They are separate from the `A-nn` series in
[`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md); where a finding touches an open
`A-nn` card it says so rather than restating it.

**Evidence standard.** Every card names the file and line. **"Verified: from code"** means read,
not executed. **"Verified: executed"** means a command was run and its output is quoted. Nothing was
run against the reference deployment at 10.1.200.13, and no cluster was contacted — consistent with
`CLAUDE.md` § *Distinguish "Renders" From "Works"*, **the Helm charts still only render.** Three
cards below are about the gap between rendering and working, and none of them upgrades that claim.

---

## Summary

| Id | Finding | Severity | Status |
|---|---|---|---|
| S-01 | **`/uploads` is a public static mount** — every certificate PDF is enumerable, unauthenticated, cross-tenant | **critical** | TODO |
| S-02 | **A tenant backup restore deletes every user in the tenant and recreates them without passwords** | **critical** | **DONE** 2026-09-24 |
| S-03 | **`BACKUP_SCHEDULER` backs up nothing** — it zips two directories inside the read-only pkg snapshot | **critical** | **DONE** 2026-09-24 — scheduler runs a per-tenant `createBackup` under each tenant's context, audited as `system:scheduled-backup`; status file; invalid cron refuses; zip-slip `extractZip` deleted (PG18-verified) |
| S-04 | ClamAV is wired in but cannot scan: no `STANDBY` command, unframed `INSTREAM`, and "not FOUND" read as clean | **high** | **DONE** 2026-09-24 — `zINSTREAM` with length-prefixed chunks; only `stream: OK` is clean, everything else fails closed; `clamav`+unset `CLAMAV_ENABLED` fails closed; verified on real `clamav/clamav:1.4` (EICAR FOUND) |
| S-05 | `KMS_MASTER_KEY` does not exist anywhere in the Helm chart | **high** | **DONE** 2026-09-24 — `KMS_MASTER_KEY` in the chart Secret; guard requires it |
| S-06 | The Helm chart's Secret and ConfigMap names can never both match what the Deployment mounts | **high** | **DONE** 2026-09-24 — one `baseName` helper; envFrom uses the same helpers that create the objects |
| S-07 | `nginx/default.conf` routes `/api/` to the backend — the mistake `deploy/README.md` says breaks login | **high** | **DONE** 2026-09-24 — no browser login yet |
| S-08 | No secret is rotatable: no key id in the KMS payload, `ENCRYPT_KEY` outside the KMS entirely | **high** | TODO |
| S-09 | RabbitMQ credentials contradict themselves in `.env.example`; Redis has no authentication at all | **high** | **PARTIAL** 2026-09-24 — RabbitMQ template fixed; Redis auth needs a deploy decision |
| S-10 | `.env.example` ships `IMAGE_TAG=latest`, which satisfies the prod overlay's `:?` guard | **high** | **DONE** 2026-09-24 |
| S-11 | Six of the twelve allowed attachment types are rejected by the magic-byte check | medium | TODO |
| S-12 | The image never creates or chowns `/app/storage` or `/app/.well-known` | medium | **DONE** 2026-09-24 — proven live |
| S-13 | The backend build disables TLS verification for apt and resolves npm without a lockfile | medium | **PARTIAL** 2026-09-24 — backend done; frontend image deferred |
| S-14 | The backup pruner and the backup writer point at different directories; the pruner can delete every tenant backup | medium | **DONE** 2026-09-24 — one `BACKUP_DIR`; row-driven pruning, keep newest `BACKUP_KEEP_MIN`, unlink only inside the dir, audited in-transaction (PG18-verified) |
| S-15 | The attachment traversal guard derives its root from the same untrusted value it validates | medium | **DONE** 2026-09-24 — fixed root `path.resolve(storagePath("uploads"))`, both separators, empty folder refused (attachment + storage migration) |
| S-16 | `make migrate` always also runs migrations on the host | medium | **DONE** 2026-09-24 |
| S-17 | Uploads are written into the public tree before they are scanned; the scan cache key is not a hash | medium | **DONE** 2026-09-24 — **deviation:** quarantine is `uploads/.quarantine` (same mount, avoids EXDEV; not served, `dotfiles: "ignore"`); scan before promote; cache key = SHA-256 of content |
| S-18 | Helm: no volume for `/app/backup`, persistence mounted at the wrong path, no NetworkPolicy, no PDB | medium | TODO |
| S-19 | Compose: no `user:`, no `cap_drop`, no `read_only`, no CPU limits; dev publishes five datastores on `0.0.0.0` | medium | TODO |
| S-20 | Plaintext secrets at rest outside the KMS: TOTP seeds, IoT device tokens, ~~webhook secrets~~ (A-51, 2026-09-24) | medium | TODO — webhook secrets done |
| S-21 | Six health-check claims describe a `/health` body that no longer exists | low | **DONE** 2026-09-24 |
| S-22 | Two manifests still document things removed or never built (the MQTT port, an embedded broker) | low | **DONE** 2026-09-24 |
| S-23 | `vm-http.conf` proxies two Swagger paths the backend does not serve | low | **PARTIAL** 2026-09-24 — dead proxy paths removed; Swagger gate open |
| S-24 | `docs/STORAGE/04` says `GET /usage` is `auth` only; the route is tenant-admin gated | low | TODO |
| S-25 | Three divergent environment templates, one of them committed and unusable | low | **PARTIAL** 2026-09-24 — canonical templates named, not consolidated |
| S-26 | The JWT key registry is decorative, and non-HS256 deployments stop verifying after 30 days uptime | low | TODO |
| S-27 | Helm: the default release name `callibrator` breaks every service and ConfigMap reference | **high** | **DONE** 2026-09-24 — renders consistently for any release name (checked by a script over `helm template`); not known to deploy |
| S-28 | Makefile `.ONESHELL` without `-e`: a failed step does not stop a recipe | medium | **DONE** 2026-09-24 — `.SHELLFLAGS := -ec` |
| S-29 | `frontend/Dockerfile` uses `npm install` and an unpinned base image | medium | **DONE** 2026-09-24 — frontend image from the repo root with `npm ci --workspace frontend`, pinned node 24, uid 1001 |
| S-30 | compose sets `HOST`, which Next standalone ignores | low | **DONE** 2026-09-24 — `HOSTNAME: 0.0.0.0` |
| S-31 | Helm sets `VIRUS_SCAN_PROVIDER=clamav` but no `CLAMAV_ENABLED`/`HOST`/`PORT` — **since S-04 every Helm upload is refused 422** (fail-closed). **The chart has no ClamAV service**, so none was invented: clamd is treated as external, like PostgreSQL. `backend.clamav.host`/`port` (3310) → ConfigMap `CLAMAV_ENABLED="true"`, `CLAMAV_HOST`, `CLAMAV_PORT` whenever the provider is clamav; guard 6 refuses to render the clamav provider with an empty host; values-prod/-staging carry placeholder hosts in the `database.host` convention (`clamav.<env>.svc.cluster.local`) that must point at a real clamd. Evidence: `helm template` renders the three keys for default (with `--set backend.clamav.host`), prod and staging values; renders none with `VIRUS_SCAN_PROVIDER=none`; refuses with no host; `helm lint` clean on all three. **Renders only — no cluster, no clamd contacted** | **high** | DONE |
| S-32 | tenant backups: HTTP `createBackup` writes no audit row and never sets `expiresAt`; `STATUS` `deleting`/`restoring`/`restored` are not in the DB ENUM (`deleteBackup` should fail on PG); `backup_path` is VARCHAR(255) (live "value too long" with a long `APP_STORAGE_PATH`) | medium | TODO |
| S-33 | nothing sweeps `uploads/.quarantine` after a crash mid-scan; two replicas both run the backup cron | low | TODO |
| S-34 | docs deviation: `docs/STORAGE/04:254` still describes the old traversal root; `docs/DEVOPS/04` lacks `BACKUP_KEEP_MIN`/`BACKUP_RETENTION_DAYS`/`disabled`/status file; S-17 location deviation needs recording | low | TODO |

**What the storage module gets right, and is worth not breaking:** `keys.js` really is
deny-by-default, `normalizeKey` really does throw rather than clean, `signing.js` really is
constant-time and fails closed on an absent secret, and the tenant/operator SSRF asymmetry in
`s3.driver.js:64-78` is intact. None of the findings below are in that module. They are in the
path that never got cut over to it.

---

## S-01 — `/uploads` is a public static mount, and it is where the certificates live

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **critical** |
| **Verified** | from code. **Not exploited** — doing so on the reference deployment would read real hospital records |

**Evidence**

- `backend/index.js:339-350` — `app.use("/uploads", express.static(storagePath("uploads"), …))`.
  It is mounted **before** every router, carries no `auth`, no `dynamicAccess`, no tenant check and
  no token.
- `backend/src/services/certificatePdf.service.js:199-205` — the generated calibration certificate
  is written to `storagePath("uploads","certificates")` and its public path is
  `/uploads/certificates/<fileName>`.
- `backend/src/services/certificatePdf.service.js:61` — `safeFileName` is
  `${certificateNumber}.pdf`, sanitised but otherwise verbatim.
- `backend/src/models/certificate.model.js:183-208` — `certificateNumber` is
  `CERT-<YYYYMMDD>-<tenantCode>-<sequence>`, sequence starting at 1 per tenant per day.
- `deploy/compose/nginx/default.conf:111-113` and `deploy/compose/nginx/vm-http.conf:78-80` —
  `location /uploads/ { proxy_pass http://backend; }` on both edges.
- `deploy/helm/callibrator/templates/ingress.yaml:87-93` — the same path, to the backend, in the
  chart.
- `backend/src/services/attachment.service.js:68-72` — `toPublic()` returns
  `url: getUploadUrl(a.fileName, a.folder)`, i.e. this same unauthenticated path, in **every**
  attachment response.
- `backend/src/services/attachment.service.js:192-245` — `deleteAttachment` is a **soft** delete
  (`isDeleted = true`). The file stays on disk and stays served.

**Why it matters here.** `GET /api/v1/storage/object` is deliberately ungated and its defences —
an HMAC token, an expiry, a tenant segment in the key — are the whole story for that route, and
they hold. None of them apply to `/uploads`. Anyone on the internet, through the Cloudflare tunnel,
can walk `CERT-20260923-<code>-0001.pdf`, `-0002.pdf`, … and pull down every tenant's calibration
certificates. The tenant code is not a secret; it appears in the certificate number the public
verification page already accepts.

The attachment half is different in shape and no better in consequence: the filename is
`Date.now()-rand-uuidv4()` (`backend/src/utils/upload.util.js:22-28`), so it is not enumerable —
but the URL the API hands out is a **permanent, unauthenticated bearer link** to calibration
evidence, and the A-28 authorization work on `DELETE /attachments/:id` does not revoke it, because
the soft delete leaves the file in place. Every browser cache, proxy log and pasted link keeps
working forever.

`docs/STORAGE/04-TENANT-STORAGE.md:28` is right that the attachment path was never cut over to the
storage module. What no document says is that the path it uses instead has no authorization at all.

**Fix direction.** Serve nothing from `/uploads` statically. Route certificate PDFs and attachments
through an authenticated controller, or through `storage.openSignedObject` with its existing HMAC
token. If a stable inline URL is genuinely needed for the CMS editor, it must still resolve through
a handler that checks the tenant. Until the mount is removed, a certificate PDF filename must be
unguessable (a random id, not the certificate number). Deleting an attachment must unlink or move
the object, or the soft delete must be documented as *not* a revocation.

**Definition of Done**
- [ ] `express.static("/uploads")` is gone from `backend/index.js`, and the `/uploads/` locations
      are gone from both nginx configs and the Helm ingress
- [ ] a test fetches a certificate PDF path with no credentials and asserts 401/404, not 200
- [ ] a test in tenant A constructs tenant B's certificate number and asserts it cannot fetch the
      PDF
- [ ] deleting an attachment makes its URL stop working — asserted, not assumed
- [ ] `docs/STORAGE/04-TENANT-STORAGE.md` § *What Is Wired* states that the legacy path is
      unauthenticated, until it is not

---

## S-02 — A tenant backup restore wipes the tenant's users and recreates them without passwords

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **critical — data loss and total tenant lockout** |
| **Verified** | from code; the `sequelize.Op` half **executed** |

**Evidence**

- `backend/src/services/tenantBackup.service.js:90-97` — the export excludes the password:
  ```js
  const users = await Users.findAll({
    where: { tenantId },
    attributes: { exclude: ["password", "createdAt", "updatedAt", "deleted_at"] },
  });
  ```
- `backend/src/services/tenantBackup.service.js:378-390` — the non-merge restore:
  ```js
  await Users.destroy({ where: { tenantId: targetTenantId }, transaction });
  // Preserve password hashes from backup for non-merge restores
  await Users.bulkCreate(data.users.map((u) => ({ ...u, id: undefined })), { transaction });
  ```
  The comment says the hashes are preserved. The export deleted them four hundred lines earlier.
- `backend/src/services/tenantBackup.service.js:366-372` — the merge path keys on
  `[sequelize.Op.or]`, where `sequelize` is a Sequelize **instance**.
  Executed (`node -e` against the installed `sequelize`):
  ```
  instance .Op is undefined
  static   .Op is object
  ```
  so `sequelize.Op.or` throws a `TypeError` before any row is touched. **The merge path has never
  run successfully.**
- `backend/src/services/tenantBackup.service.js:80-100` — a backup of type `full`
  (`models/tenantBackup.model.js:20-23`) contains the tenant row and its users. **Nothing else** —
  no devices, calibrations, certificates, attachments, stock or audit rows.
- Route: `backend/src/routes/api/tenantBackup.route.js:603-612`,
  `POST /:tenantId/backups/:backupId/restore`, `SUPER_ADMIN`/`TENANT_ADMIN`.

**Why it matters here.** A tenant admin restoring "a warehouse an admin deleted" — the use case
`docs/DEVOPS/04-DATABASE-BACKUP.md:13` gives for this feature — gets no warehouse back (it was never
exported), loses every user account created since the backup, and leaves every surviving account
with whatever `Users.bulkCreate` does with an absent `password`. That is a self-inflicted outage of
an entire hospital tenant, reachable from a supported button, inside one transaction that commits.

`docs/DEVOPS/04-DATABASE-BACKUP.md:34` says "Restore is destructive and must be audited". It is more
destructive than that sentence implies, and the audit row is not written.

**Fix direction.** Refuse the restore until the export is complete: either export the password hash
(it is a hash, and the backup file is already a tenant-scoped artefact) or merge users by
`email`/`username` without destroying. Fix `sequelize.Op` → `Sequelize.Op` or `Op` from the package.
A `full` backup must either cover the tenant's business data or be renamed to what it is.

**Definition of Done**
- [ ] a restore into a populated tenant leaves every pre-existing user able to log in — proved by a
      test that logs in before and after
- [ ] the merge path executes at all — a test covering `mergeData: true`
- [ ] `backupType: "full"` either includes devices, calibrations and certificates, or the enum value
      is renamed and `docs/DEVOPS/04-DATABASE-BACKUP.md:13` corrected
- [ ] the restore writes an audit row naming the backup id and the actor, in the same transaction

---

**What was changed (2026-09-24)** — `tenantBackup.service.js`, 59 tests, 100 %.

A restore **never deletes a live account** and never touches a live password, role, active flag or
status. A user present in both the backup and the tenant keeps their account; with `mergeData:
false` (the default) only profile fields are updated from the backup, and with `mergeData: true` the
account is left entirely alone. Accounts created after the backup are kept and reported `retained`;
soft-deleted ones are not revived and are reported `skippedDeleted`. Every row is stamped with the
target tenant **from the database, never from the file**, and a backup naming another tenant is
refused with a **409** before any transaction opens.

**The rewrite this finished had a defect that would have broken every real restore**, and the
mocked tests could not see it: its audit row used `action: "RESTORE"`, and `audit_logs.action` is an
ENUM of `CREATE, UPDATE, DELETE, LOGIN, APPROVE, EXPORT`. On PostgreSQL that insert throws, and the
transaction rolls back — so **every** restore would have failed, and the suite was green because the
mock accepted any string. It now writes `UPDATE` with `changes.operation: "RESTORE"`. This is the
fourth instance this month of a mock inventing the contract.

Three more found and fixed in the same pass: a username or email that collides with **another
tenant's** account (D-06 — both are globally unique) was a 500 and is now a 409 that rolls back; a
backup in the wrong state was a bare 400 and is now a 409 naming the state; and an archive altered
after it was taken was accepted — it is now refused when it no longer matches the SHA-256 recorded
at backup time.

**Proof:** the original service fails **22** of the new tests; the half-finished rewrite fails **7**.
The 8 tests that failed in `36205df` were all **old tests asserting the destructive behaviour** —
one asserted `Users.destroy` then `bulkCreate`, one asserted the never-working merge — and are
replaced, with the old assertions quoted beside their replacements.

**Decision taken, recorded as Q-09:** an account in the backup but missing from the tenant is
re-created **inactive, with a random password nobody holds**, and listed in `pendingActivation`; the
holder resets it through the existing email OTP. That meets "never left with an empty or guessable
credential" but not "usable immediately". The strict alternative is not to re-create at all.

**Still open:** a `full` backup still contains only the tenant row and its users — no devices,
calibrations or certificates. And nothing here has run against a real database; the requirement to
prove login works before and after a restore is unmet.

## S-03 — `BACKUP_SCHEDULER` backs up nothing

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **critical — a backup everyone believes in** |
| **Verified** | from code |

**Evidence**

- `backend/index.js:618` — `cronBackup()` is started at boot.
- `backend/src/middlewares/backup.middleware.js:9` — the schedule is `process.env.BACKUP_SCHEDULER`,
  the variable set in `deploy/compose/.env.example:180`, `docker-compose.prod.yml:38`,
  `docker-compose.vm.yml:48` and `deploy/helm/callibrator/values.yaml:44`.
- `backend/src/middlewares/backup.middleware.js:11` —
  `const rootDir = path.join(__dirname, "../../");`
- `backend/src/middlewares/backup.middleware.js:45-47` — the job copies `rootDir/data` and
  `rootDir/log` and writes its ZIPs to `rootDir/backup`.
- `backend/Dockerfile:27-29` — the runtime artefact is a `@yao-pkg/pkg` binary, so `__dirname`
  resolves **inside the read-only snapshot** (`/snapshot/...`), not `/app`.
  `backend/src/utils/packaged.util.js:19-20` confirms the packaged mode.
- `backend/src/middlewares/backup.middleware.js:74` — the copy filter is
  `(src) => !src.endsWith("mysql.sock")`. MySQL was removed by **ADR-039**, and on every supported
  deployment the database runs in a separate `pgvector/pgvector:pg17` container
  (`deploy/compose/docker-compose.yml:88`). There is no `data/` database directory to back up.
- `backend/src/middlewares/backup.middleware.js:83-85` — every failure is swallowed into
  `logger.error(...)`, and per A-14 production adds no Console transport, so `docker logs` shows
  nothing.

**Why it matters here.** The variable is named `BACKUP_SCHEDULER`, it is set in every overlay and in
the chart, `docs/DEVOPS/04-DATABASE-BACKUP.md:32` says "Scheduled by `BACKUP_SCHEDULER`" directly
under the **Tenant Backup** heading, and `deploy/README.md` counts double-running backups among the
reasons `cron.enabled` cannot coexist with replicas. All of that describes a job that copies two
directories that do not exist, on a filesystem it cannot write to, and reports the failure to a file
nobody reads. It is connected to `tenantBackup.service.js` by nothing at all — that service is only
ever called from the HTTP route.

This is exactly the failure `docs/DEVOPS/04-DATABASE-BACKUP.md:167` warns about, in the same
document that mis-attributes the scheduler.

**Fix direction.** Decide what the weekly job is for. If it is the database, it needs `pg_dump`
against `DB_HOST` and a destination on the `/app/backup` volume; if it is tenant backups, it must
call `tenantBackup.service.createBackup` per tenant. Either way it must use `storagePath()` like
every other writer in the codebase, and a failure must alert, not log.

**Definition of Done**
- [ ] the scheduled job writes a file to the `volumes/backup` bind mount, verified by listing it on
      the host after a run
- [ ] a forced failure produces a visible signal, not a line in `log/activity/`
- [ ] `docs/DEVOPS/04-DATABASE-BACKUP.md:32` says what `BACKUP_SCHEDULER` actually schedules
- [ ] the `mysql.sock` filter is deleted (ADR-039)

---

## S-04 — ClamAV is in the path and cannot scan

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code — **not** exercised against a running `clamd`. The protocol claim below is the first thing to confirm |

**Evidence**

- `backend/src/services/virusScan.service.js:22-24` — the provider default is `"none"`, which
  returns `{ clean: true }` for every file.
- `deploy/compose/docker-compose.prod.yml:26`, `docker-compose.staging.yml:30`,
  `docker-compose.vm.yml:42` and `deploy/helm/callibrator/values.yaml:84` all set
  `VIRUS_SCAN_PROVIDER: clamav`, so the real path is selected.
- `backend/src/services/clamAv.service.js:239-242` — but `clamAv.scanFile` returns
  `{ isClean: true, code: "SKIPPED" }` unless `CLAMAV_ENABLED === "true"`. That variable is set in
  `deploy/compose/.env.example:154` and **nowhere in the Helm chart** (`grep -rn CLAMAV deploy/helm`
  returns only the three `VIRUS_SCAN_PROVIDER` lines). In-cluster, scanning is silently off while
  every manifest comment says fail-closed.
- `backend/src/services/clamAv.service.js:98-115` — with it on, the first thing sent is
  `STANDBY\r\n`, and anything but `OK` rejects. `STANDBY` is not a clamd command (clamd's set is
  `PING VERSION RELOAD SHUTDOWN SCAN CONTSCAN MULTISCAN ALLMATCHSCAN INSTREAM FILDES STATS
  IDSESSION END VERSIONCOMMANDS`), so clamd answers `UNKNOWN COMMAND` and closes.
- `backend/src/services/clamAv.service.js:152-155` — `INSTREAM` is then followed by the raw file
  buffer. The clamd `INSTREAM` protocol requires each chunk to be prefixed with a 4-byte
  network-order length and terminated by four zero bytes.
- `backend/src/services/clamAv.service.js:165-167` —
  ```js
  const statusCode = response.includes(CLAMAV_CODES.FOUND) ? CLAMAV_CODES.FOUND : CLAMAV_CODES.OK;
  ```
  **any** response that does not contain the literal `FOUND` is reported clean — including
  `UNKNOWN COMMAND`, `INSTREAM size limit exceeded` and a truncated read.
- `backend/src/services/virusScan.service.js:36-49` — a thrown scan error is fail-closed by default,
  so a rejecting clamd turns into `422 File rejected by virus scan` / `500 File scan service
  unavailable` on **every** upload.

**Why it matters here.** There are two outcomes and neither is "files are scanned". With
`CLAMAV_ENABLED` unset — the Helm case — nothing is scanned and the API says every file is clean.
With it set — the compose case — the handshake fails and, correctly fail-closed, every attachment
upload is refused. The compose comment at `docker-compose.yml:145-148` and the configmap comment at
`templates/configmap.yaml:66-67` both describe a working scanner failing safe. Neither state has
ever been a working scanner.

`clamAv.service.js:365-369` already carries an honest note that `isConfigured()` never evaluates
`CLAMAV_SOCKET_PATH`, so the file has been read before. The protocol was not.

**Fix direction.** Delete `sendStandby` (use `PING` if a readiness handshake is wanted, or
`nIDSESSION`). Implement `INSTREAM` framing, or use `zINSTREAM` with a maintained client library.
Treat anything that is neither `stream: OK` nor `... FOUND` as an **error**, not as clean. Add
`CLAMAV_ENABLED`, `CLAMAV_HOST` and `CLAMAV_PORT` to the chart's ConfigMap, or make
`VIRUS_SCAN_PROVIDER=clamav` with `CLAMAV_ENABLED` unset a refusal to start rather than a silent
skip.

**Definition of Done**
- [ ] **verify first**: upload the EICAR test string against a running `clamav/clamav:1.4` and
      record the response. Name the test
- [ ] a clean file uploads; the EICAR file is rejected 422; a stopped scanner rejects with a
      distinguishable error
- [ ] a response of `UNKNOWN COMMAND` is asserted **not** to read as clean
- [ ] the chart sets `CLAMAV_ENABLED`, or the mismatch refuses to start

---

## S-05 — `KMS_MASTER_KEY` does not exist anywhere in the Helm chart

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code and manifests |

**Evidence**

- `backend/src/services/kms.service.js:11-17` — in production the module **throws at require time**
  without `KMS_MASTER_KEY`.
- `grep -rn "KMS\|kms" deploy/helm` → **no matches**. It is absent from
  `templates/secret.yaml` (the stringData block is lines 20-60), from `templates/configmap.yaml`,
  from `values.yaml` (`secrets:` at :185-200), from `values-prod.yaml:117` and from
  `values-staging.yaml:79`.
- `deploy/helm/callibrator/templates/guards.tpl:42-64` — guard 3 is titled "the **three** required
  secrets" and checks `certSigningSecret`, `encryptKey`, `attachmentUrlSecret`.
- `deploy/helm/callibrator/templates/secret.yaml:21` — `# --- required: the application EXITS
  without these ---`, three entries.
- Against: `deploy/compose/.env.example:33-42` — "A **FOURTH** required secret … Found only by
  deploying"; `deploy/README.md` § *The Four Required Secrets*; `Makefile:88-95` generates four.
- `docs/DEVOPS/09-KUBERNETES.md:92-96` repeats the wrong number: "Three are **required**".

**Why it matters here.** The chart renders, `helm lint` passes, guard 3 passes, and the backend pod
crash-loops. Per `deploy/README.md` and `Makefile:353-354`, that crash writes **nothing** to stdout,
so the operator sees a restarting pod with empty logs — the exact failure mode `.env.example:39-41`
says cost a deployment on compose. The correction was written into the compose path and the Makefile
and never propagated to the chart or to `docs/DEVOPS/09`.

This is the PR-4 shape: a document and a manifest that disagree with `kms.service.js:12`.

**Fix direction.** Add `secrets.kmsMasterKey`, template it into `secret.yaml`, extend guard 3 to
four, and correct `docs/DEVOPS/09-KUBERNETES.md:92-96`. While there, note that
`ENCRYPT_KEY` and `KMS_MASTER_KEY` are different keys protecting different things (S-08) — the
chart's secret.yaml header at :8-12 mentions only two.

**Definition of Done**
- [ ] `helm template` with `kmsMasterKey` unset **refuses to render**
- [ ] the rendered Secret carries `KMS_MASTER_KEY`
- [ ] `docs/DEVOPS/09-KUBERNETES.md` lists four
- [ ] a validation-status note is added if and when a cluster is reachable — not before

---

## S-06 — The chart's Secret and ConfigMap names can never both match the Deployment

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high — renders, cannot start** |
| **Verified** | from manifests, by template-name analysis. **No cluster was contacted** |

**Evidence**

The umbrella chart and the backend subchart name the same two objects two different ways.

| Object | Created as | Referenced as |
|---|---|---|
| ConfigMap | `templates/configmap.yaml:5` → `callibrator.configMapName` = `{{ fullname }}-config` (`_helpers.tpl:45-47`) | `charts/backend/templates/deployment.yaml:57` → `{{ .Release.Name }}-callibrator-config` |
| Secret | `templates/secret.yaml:16` → `callibrator.secretName` = `{{ fullname }}-secrets` (`_helpers.tpl:37-43`) | `charts/backend/templates/deployment.yaml:59` → `{{ .Values.secretName }}`, whose only default is `callibrator-secrets` (`charts/backend/values.yaml:19`) and which the umbrella never sets (`grep -n secretName values*.yaml` returns only `ingress.tls.secretName` and `secrets.external.secretName`) |

`callibrator.fullname` (`_helpers.tpl:7-18`) returns `{{ .Release.Name }}` when the release name
contains `callibrator`, and `{{ .Release.Name }}-callibrator` otherwise. So:

- release `prod` → ConfigMap `prod-callibrator-config`, referenced `prod-callibrator-config` ✅;
  Secret `prod-callibrator-secrets`, referenced `callibrator-secrets` ❌
- release `callibrator` (the `Makefile:22` default) → Secret `callibrator-secrets`, referenced
  `callibrator-secrets` ✅; ConfigMap `callibrator-config`, referenced
  `callibrator-callibrator-config` ❌

There is no release name that satisfies both. A missing `configMapRef`/`secretRef` in `envFrom` is a
`CreateContainerConfigError`, not a render error.

Two further start-time refusals in the same file:

- `charts/backend/templates/deployment.yaml:35-40` sets `runAsNonRoot: true` with no `runAsUser`,
  over an image whose `USER` is the **name** `app` (`backend/Dockerfile:95`). The kubelet cannot
  resolve a username to a uid and refuses the container with *"container has runAsNonRoot and image
  has non-numeric user (app)"*.
- the same block sets `fsGroup: 1000`, while the image's user comes from `useradd -r`
  (`backend/Dockerfile:60`), which allocates a **system** uid below 1000.

**Why it matters here.** `deploy/README.md` § *Two Paths* and `Chart.yaml:39-44` are already careful
to say the charts render and are not cluster-validated. This card is the concrete content of that
caveat: three independent reasons a rendered manifest would not produce a running pod. It does not
change the status — it says what "renders only" is currently hiding, so nobody reads the green
`helm lint` as readiness.

**Fix direction.** One naming helper, used by both charts. Pass `backend.secretName` and
`backend.configMapName` down from the umbrella, or move both objects into the subchart. Set
`runAsUser` to the numeric uid the Dockerfile creates (pin it: `useradd -r -u 1001`), and set
`fsGroup` to match.

**Definition of Done**
- [ ] `helm template prod …` and `helm template callibrator …` both produce a Deployment whose
      `envFrom` names objects the same render created — asserted by a script, not by eye
- [ ] `backend/Dockerfile` pins a numeric uid and the chart's `runAsUser` matches it
- [ ] when a cluster is first reachable, `kubectl apply --dry-run=server` is run and its output
      recorded — and only then does `Chart.yaml:44` change

---

## S-07 — `nginx/default.conf` routes `/api/` to the backend

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from manifests |

**Evidence**

- `deploy/compose/nginx/default.conf:101-103`:
  ```nginx
  location /api/ {
      proxy_pass http://backend;
  }
  ```
  This is the config mounted by the **prod** and **staging** overlays
  (`docker-compose.yml:169`, unoverridden by `docker-compose.prod.yml` and
  `docker-compose.staging.yml`).
- `deploy/compose/nginx/vm-http.conf:63-74` does the opposite, and explains why:
  > `/api/` goes to the FRONTEND, not the backend. Next.js owns this path:
  > `app/api/v1/auth/login` sets the httpOnly `auth_token` cookie … Routing `/api/` straight to the
  > backend bypasses both — login returns a token that nothing stores, and every authenticated
  > request afterwards arrives with no credentials.
- `deploy/README.md` § *nginx: Five Routes Easy to Get Wrong* lists `/api/* → **frontend**` first,
  and names routing it to the backend as the thing that breaks login.
- `deploy/helm/callibrator/templates/ingress.yaml:26-32` sends `/api` to the backend service too,
  and `docs/DEVOPS/09-KUBERNETES.md:110` tabulates `/api/*` → backend.

**Why it matters here.** The repository contains its own written statement that one of its two
shipped nginx configs is wrong, and the chart makes the same choice. The VM deployment works because
it uses the other file. Nobody has stood up prod or staging, so nothing has contradicted the config —
which is precisely the condition under which a manifest stays wrong.

There is a real possibility the *VM* comment is the one that is wrong for a TLS deployment (a
different frontend build, `BACKEND_INTERNAL_URL` set differently). That is the point: three
artefacts disagree and no test distinguishes them. This needs a decision recorded, not a quiet edit
— the deviation protocol applies.

**Fix direction.** Decide, in an ADR, which layer owns `/api/`. Then make `default.conf`, the Helm
ingress and `docs/DEVOPS/03-REVERSE-PROXY.md` agree with it, and add a browser-level check to the
post-deploy list that proves a cookie is set (`deploy/README.md:235` already says a `curl` 200
proves nothing about the cookie).

**Definition of Done**
- [ ] an ADR records which service owns `/api/` and why
- [ ] `default.conf`, `vm-http.conf`, `templates/ingress.yaml`, `deploy/README.md` and
      `docs/DEVOPS/03` all state the same thing
- [ ] a browser login against a stack using `default.conf` succeeds — named, with the stack it ran
      against

---

## S-08 — Nothing here is rotatable, and one secret is outside the KMS entirely

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high — an incident-response gap** |
| **Verified** | from code |

**Evidence**

- `backend/src/services/kms.service.js:90-98` — the envelope payload is
  `v1:encDEK:dekIv:dekAuthTag:encData:dataIv:dataAuthTag`. `v1` is a **format** version. There is no
  key id, no key version and no `KMS_MASTER_KEY` fingerprint anywhere in the ciphertext.
- `backend/src/services/kms.service.js:18-19` — exactly one master key is loaded, from one
  environment variable. There is no second-key-for-decryption path and no re-wrap routine anywhere
  in `src/`.
- `backend/src/services/kms.service.js:18` — outside production the fallback is
  `sha256("local-kms-mock-key")`, a value derivable from this file. Only `NODE_ENV === "production"`
  refuses it (`:11-17`).
- `backend/src/services/eSignature.service.js:33-39, 179, 193` — tenant signing **private keys** are
  encrypted with `crypto.createCipheriv("aes-256-cbc", sha256(ENCRYPT_KEY), iv)`. Not through
  `kms.service`: no envelope, no per-tenant AAD, and **CBC without a MAC**, so the ciphertext is
  unauthenticated and malleable. Compare `kms.service.js:78-84`, which uses GCM *and* binds the
  tenant id as AAD.
- `backend/src/models/tenantKey.model.js:45-48` — the column comment says
  `"AES-256 encrypted PEM (iv:ciphertext); never plaintext"`, confirming the shape.
- `backend/src/services/customDomains.service.js:460` — TLS private keys **do** go through
  `kms.service`. So two private-key stores use two different schemes.
- `backend/src/utils/jwt.util.js:83-151` — a `JwtKeyRegistry` with a `rotateKey()` method. It is an
  in-process `Map` seeded from `JWT_ACCESS_SECRET`; `rotateKeys()` (`:335-374`) has **no caller**
  outside tests and nothing persists a rotated key. See S-26.
- `deploy/helm/callibrator/templates/secret.yaml:12` states it plainly: *"Neither is practically
  rotatable."*

**Why it matters here.** Rotating a key means being able to decrypt with the old one and re-encrypt
with the new. With no key id in the payload there is nothing to decide which key a row was wrapped
with, so rotation is a flag day across every `tenant_settings` sensitive row, every `tenant_keys`
row and every stored TLS key — with no rollback, because the old ciphertext is gone the moment the
re-wrap commits. Today a suspected `KMS_MASTER_KEY` disclosure has no response other than "accept
it". For a platform under 21 CFR Part 11 that is a control gap, not an inconvenience.

The `ENCRYPT_KEY` split makes it worse: a reviewer looking at `kms.service.js` and its `SENSITIVE_KEYS`
list (`models/tenantSettings.model.js:52-61`) will reasonably conclude that is where the secrets
are, and miss that the **signing** private keys — the 21 CFR Part 11 artefacts — are elsewhere,
under a different key, with weaker properties.

**Fix direction.** Put a key id in the payload (`v2:<keyId>:…`) and let `decryptData` select from a
map of `KMS_MASTER_KEY` / `KMS_MASTER_KEY_PREVIOUS`. Write a re-wrap script that walks every
sensitive row and is resumable. Move `eSignature`'s key wrapping onto `kms.service` behind a
migration that reads CBC and writes envelope (and record it as an ADR — it changes stored data).
Then delete the "neither is practically rotatable" line, because it will no longer be true.

**Definition of Done**
- [ ] a new ciphertext names the key that wrapped it
- [ ] with two master keys configured, rows wrapped by either decrypt
- [ ] a re-wrap script runs, is resumable, and is proved by re-reading a row it converted
- [ ] `eSignature` private keys are envelope-encrypted with tenant AAD, or an ADR records why not
- [ ] `docs/SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md` and
      `deploy/helm/callibrator/templates/secret.yaml:8-12` are corrected

---

## S-09 — RabbitMQ credentials contradict themselves; Redis has no authentication

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from manifests |

**Evidence**

- `deploy/compose/.env.example:63-65`:
  ```
  RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
  RABBITMQ_USER=guest
  RABBITMQ_PASS=CHANGE_ME
  ```
- `deploy/compose/docker-compose.yml:130-131` — the broker is created with
  `RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-guest}` / `RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS:-guest}`.

  An operator who follows `make env` + `make secrets` and sets `RABBITMQ_PASS` gets a broker whose
  password is not `guest`, while the backend still connects with the `guest:guest` URL. An operator
  who leaves `RABBITMQ_PASS=CHANGE_ME` gets a broker with the password `CHANGE_ME` and the same
  mismatch. There is no path through this file that produces a working, non-default credential.
  `make check-env` (`Makefile:346`) checks four secrets and not this one.
- `deploy/compose/.env.example:62` — `REDIS_URL=redis://redis:6379`, no credentials.
  `docker-compose.yml:111-124` runs `redis:8.6-alpine` with no `requirepass` and no ACL;
  `docker-compose.prod.yml:86` and `docker-compose.vm.yml:88` override the command only to add
  `--appendonly yes`.
- Redis is not a cache here. `docker-compose.yml:112-114` says so, and A-30 made it authoritative
  for brute-force lockouts. Anything that can reach the compose network can flush the lockout
  counters and the WebAuthn challenge store.
- The Helm side has the same hole by omission: `values.yaml:110-114` has `redis.url` and
  `rabbitmq.url` as bare strings in a **ConfigMap** (`templates/configmap.yaml:40-41`), so any
  credentials embedded in those URLs are stored unencrypted and printed by `kubectl get cm -o yaml`.

**Why it matters here.** `deploy/README.md` and the Makefile lead an operator through a procedure
that ends in a broker the application cannot authenticate to, and a Redis with no password on a
host that also publishes ports in dev (S-19). `.env.example` is the file people copy; its internal
contradiction is not a documentation nit, it is the deployment.

**Fix direction.** Build `RABBITMQ_URL` from `RABBITMQ_USER`/`RABBITMQ_PASS` in the compose file
rather than duplicating it, or delete the separate variables. Add `--requirepass` to Redis and put
the password in `REDIS_URL`. Move `redis.url` and `rabbitmq.url` from the Helm ConfigMap into the
Secret. Extend `make check-env` to reject `guest`, `CHANGE_ME` and a credential-less `REDIS_URL`
when `ENV` is not `dev`.

**Definition of Done**
- [ ] a by-the-book `make env; make secrets; make up ENV=prod` produces a backend that connects to
      RabbitMQ — verified from the container, not from the compose file
- [ ] Redis refuses an unauthenticated `PING`
- [ ] the two URLs are in the Helm Secret, not the ConfigMap
- [ ] `make preflight` fails on a default credential

---

## S-10 — `.env.example` ships `IMAGE_TAG=latest`, defeating the prod guard

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from manifests |

**Evidence**

- `deploy/compose/.env.example:17` — `IMAGE_TAG=latest`, three lines under a comment saying
  `:latest` in production means nobody can say what is running.
- `deploy/compose/docker-compose.prod.yml:11` —
  `image: …:${IMAGE_TAG:?IMAGE_TAG is required in production}`. `:?` tests for **unset or empty**.
  `latest` satisfies it.
- `deploy/compose/docker-compose.yml:19` — the base default is `${IMAGE_TAG:-latest}`.
- The Makefile does guard it (`Makefile:275`, `:324`, `:361`), but only on `push`, `deploy` and
  `helm-deploy`. `Makefile:45` sets `IMAGE_TAG=$(TAG)` on the command line, so a direct
  `docker compose -f … -f docker-compose.prod.yml up -d` — the invocation
  `docker-compose.vm.yml:3` and `deploy/README.md` both show — falls back to the `.env` value and
  deploys `:latest`.
- `deploy/README.md` § *Guards That Refuse Rather Than Warn* lists "`IMAGE_TAG` required in staging
  and prod" as a compose guard. It is a presence check, and the file that ships alongside it
  supplies the value that makes the check pass.

**Why it matters here.** The guard exists because a rollback needs something to roll back to. A
presence check whose failing value is pre-filled in the template is not a guard. The Helm equivalent
(`guards.tpl:17-24`) is correct — it refuses an empty tag and there is no values file supplying one.

**Fix direction.** Make `.env.example` ship `IMAGE_TAG=` (empty) with the comment, and add an
explicit refusal in the prod and staging overlays that rejects the literal `latest`. Compose has no
way to express "not this value", so it belongs in `make preflight` **and** in a startup assertion,
or the overlays must drop the `:-latest` default so the variable is simply required.

**Definition of Done**
- [ ] `.env.example` does not contain a usable production tag
- [ ] `docker compose … -f docker-compose.prod.yml config` with `IMAGE_TAG=latest` fails
- [ ] `deploy/README.md`'s guard table says presence-or-value, accurately

---

## S-11 — Six of the twelve allowed attachment types cannot be uploaded

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code; fixed and proven over real files |

**Resolution** (2026-09-24). `backend/src/utils/fileValidation.util.js` only — `upload.util.js`
already forwards the validator's error unchanged on both the single- and multi-file paths.

- **OLE2** (`D0 CF 11 E0 A1 B1 1A E1`) signature entries for `application/msword` and
  `application/vnd.ms-excel`.
- **OOXML** (`.docx`, `.xlsx`): the head must be a ZIP local header **and** the ZIP's central
  directory — read from the file's own bytes, no new dependency — must list `[Content_Types].xml`
  and a part under `word/` (docx) or `xl/` (xlsx). A plain archive, a docx declared as xlsx, and a
  truncated/malformed/ZIP64 directory are refused.
- **Text** (`text/plain`, `text/csv`): no signature exists, so the first 8 KiB must contain no NUL
  byte (comment in the source says why). The head read grew from 16 bytes to 8 KiB.
- The refusal now reads `File content does not match declared type "<declared mime>"`.

Named tests — `backend/src/tests/utils/fileValidation.s11.test.js`, all over real files written to a
temp dir (OOXML packages built with JSZip; no fs or validator mocks): `S-11: a real .xlsx passes as
spreadsheetml.sheet`, `S-11: a real .docx passes as wordprocessingml.document`, `S-11: an OLE2 .xls
passes as application/vnd.ms-excel`, `S-11: an OLE2 .doc passes as application/msword`, `S-11: a .csv
passes as text/csv`, `S-11: a UTF-8 .txt passes as text/plain`, `S-11: a .txt renamed to .xlsx is
refused`, `S-11: a plain zip without [Content_Types].xml declared as docx is refused`, `S-11: a docx
declared as xlsx is refused`, `S-11: a binary with a NUL byte declared as text/plain is refused`, plus
malformed-ZIP cases. Fail-before: run against the HEAD validator in a throwaway worktree, 19 of 20
failed (the 7 acceptance cases were rejected outright; the refusal cases failed on the message, which
did not quote the type); all 20 pass after.

**Still open.** OLE2 does not tell `.doc` from `.xls` (that needs a CFB directory walk), so a `.doc`
declared as `application/vnd.ms-excel` passes. UTF-16 text is refused (it carries NULs). A macro part
(`vbaProject.bin`) inside a `.docx`/`.xlsx` is not looked for. The route-level upload path (multer +
this validator end to end) still has no test over a real file.

**Evidence**

- `backend/src/routes/api/attachments.route.js:12-38` — the allowlist is jpeg, png, gif, webp, pdf,
  **doc, docx, xls, xlsx, csv, txt**.
- `backend/src/utils/upload.util.js:135-150` — after multer, `validateFileMagicBytes(path, mime)`
  runs for every upload (`validateMagicBytes` defaults true).
- `backend/src/utils/fileValidation.util.js:10-53` — the `MAGIC_BYTES` table has entries for
  `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`, `application/zip` and
  `application/octet-stream`. **None** of `text/plain`, `text/csv`, `application/msword` or the two
  OOXML types.
- `backend/src/utils/fileValidation.util.js:153-197` — a file matches only when a signature hits
  **and** `declaredMime === mime`. A `.txt` matches no signature and is not octet-stream, so it
  falls through to `throw new AppError(400, "File content does not match declared type")`. A `.docx`
  is a ZIP, so it matches the `application/zip` signature, whose mime is not the declared OOXML type
  — same throw.

**Why it matters here.** The one attachment type an ISO 17025 calibration record most often carries
after a PDF is a spreadsheet of measurements. Today those are refused with a message
("File content does not match declared type") that points a user at their file rather than at the
table that lacks an entry. Nothing in the test suite catches it because the route tests mock multer.

The check itself is the right design — declared type must match content — it is the table that is
short.

**Fix direction.** Add signatures for OLE2 (`D0 CF 11 E0`) and map ZIP-container OOXML types by
inspecting `[Content_Types].xml`, or accept ZIP-signature content for the OOXML declared types
explicitly. Text types have no magic bytes: either exempt them from the check with a comment saying
why, or validate them as "no NUL bytes in the first 16".

**Definition of Done**
- [x] a real `.xlsx`, `.docx`, `.csv` and `.txt` each pass validation — named tests over real
      fixture files, not mocks (validator level; see "Still open" for the route level)
- [x] a `.txt` renamed to `.xlsx` is still refused
- [x] the error message names the type that was rejected

---

## S-12 — The image never creates `/app/storage` or `/app/.well-known`

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — and it stopped a real deployment first |
| **Severity** | medium |
| **Verified** | from the Dockerfile |

**Evidence**

- `backend/Dockerfile:37` — `WORKDIR /app`, created as **root**.
- `backend/Dockerfile:63-64` — only
  `/app/backup/tenant-backups`, `/app/log`, `/app/uploads/profile`, `/app/uploads/tenant` are
  created and chowned to `app`.
- `backend/Dockerfile:95` — `USER app`.
- `backend/src/services/storage/config.service.js:71-75` — the `local` provider's root is
  `process.env.STORAGE_LOCAL_ROOT || storagePath("storage")`, i.e. `/app/storage` when packaged
  (`utils/storagePath.util.js:4-7`, `APP_STORAGE_PATH=/app` at `Dockerfile:83`). Neither
  `docker-compose.prod.yml:34` nor `docker-compose.vm.yml:44` sets `STORAGE_LOCAL_ROOT`, and both
  set `STORAGE_DRIVER: local`.
- `backend/index.js:337` — `app.use("/.well-known", express.static(storagePath(".well-known")))`,
  and `customDomains.service` writes ACME challenge files there at runtime. `/app/.well-known` is
  not created or chowned either.
- Neither path has a volume: `docker-compose.yml:32-35` mounts `uploads`, `backup` and `log` only.
- Against: `docs/DEVOPS/02-CONTAINERIZATION.md:69` — *"Persistent directories are created and
  chowned at build, because a container running as non-root cannot create them at runtime."* Two of
  them are not.

**Why it matters here.** It has not bitten yet only because the attachment path still writes to
`uploads/` and does not use the storage module (`docs/STORAGE/04-TENANT-STORAGE.md:28`). The moment
anything calls `getGlobalStorage()` or `getTenantStorage()` on a `local` deployment — the metered
`GET /usage`, a `certificates` or `exports` domain write, the cutover itself — `LocalDriver.put`
does `fsp.mkdir` under a root-owned `/app` as uid `app` and fails with `EACCES`. The same applies
the first time a custom domain is provisioned. And even if the directories existed, neither is on a
volume, so both are ephemeral.

**Fix direction.** Create and chown `/app/storage` and `/app/.well-known` in the Dockerfile
alongside the others, add both to the compose volume list, and add `/app/storage` to the Helm
persistence mount (S-18). Correct `docs/DEVOPS/02-CONTAINERIZATION.md:69` to name what is actually
prepared.

**Definition of Done**
- [ ] a container started from a clean build can write to `/app/storage` and `/app/.well-known` as
      `app` — proved with `docker exec`, not by reading the Dockerfile
- [ ] both are backed by a volume in compose and in the chart
- [ ] `docs/DEVOPS/02-CONTAINERIZATION.md:69` lists them

---

**Proven live, 2026-09-24 — this card predicted a real outage.** The first deployment onto empty
volumes (the owner's instruction was to wipe the stack's containers and volumes before deploying)
**crash-looped the backend** before it wrote a single log line:

```
Error: EACCES: permission denied, mkdir '/app/log/activity/'
```

The mechanism is the one this card describes, now demonstrated:

- `backend/Dockerfile` `chown -R app:app /app/backup /app/log /app/uploads` sets ownership **inside
  the image** — and the three **bind mounts** shadow those directories with the host's at runtime,
  so the build-time chown has no effect at all.
- On a fresh host Docker creates missing bind-mount directories as `root:root 755`.
- The backend runs as uid 997 and cannot create anything in them.
- It had only ever worked on the reference VM because those directories were fixed by hand once,
  long ago. **Any fresh install on any host would have failed identically.**

`docs/DEVOPS/02-CONTAINERIZATION.md` states that "persistent directories are created and chowned at
build, because a non-root container cannot create them at runtime". True of the image; irrelevant
under a bind mount.

**Fixed in the repository:**

| Change | File |
|---|---|
| a one-shot `volume-init` service that chowns `uploads`, `backup` and `log` to the backend's uid before the backend starts; idempotent, so safe on every `up` | `deploy/compose/docker-compose.yml` |
| the backend waits on it: `condition: service_completed_successfully` | same |
| the uid is **pinned**: `useradd -r -u 997`. `-r` alone takes whatever system uid the base image leaves free — 997 today, not guaranteed — which would turn a base-image bump into a silent crash loop | `backend/Dockerfile` |

**Proof, on the VM's real Linux kernel but against scratch directories in `/tmp`, not production:**
with the directories root-owned, uid 997 gets `Permission denied`; after running the exact
`volume-init` command, uid 997 gets `WRITE-OK`. Fail before, pass after.

**The reference deployment was unblocked by hand** (the same `chown`, run once) before this fix
existed; the next deployment exercises `volume-init` for real.


## S-13 — The build trusts the network twice

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from the Dockerfiles and `git ls-files` |

**Evidence**

- `backend/Dockerfile:49-50`:
  ```dockerfile
  apt-get -o Acquire::https::Verify-Peer=false update; \
  apt-get -o Acquire::https::Verify-Peer=false install -y --no-install-recommends ca-certificates;
  ```
  TLS peer verification is disabled for the step that installs the trust store. Anything on the
  build network can serve that `ca-certificates` package, and everything afterwards — `openssl`,
  `chromium` — verifies against whatever it installed. `docs/DEVOPS/02-CONTAINERIZATION.md:59` calls
  this "ugly, deliberate, and documented so nobody cleans it up"; documenting it does not make the
  window smaller.
- `backend/Dockerfile:18` — `RUN npm install`, not `npm ci`.
  `git ls-files | grep -E "package-lock|bun.lock|yarn.lock"` → **no lockfile is committed** (A-21).
  `backend/package-lock.json` and `backend/bun.lock` exist on disk and are ignored.
- `frontend/Dockerfile:42-46` says the same thing about itself, honestly:
  *"No lockfile is committed, so this resolves fresh on every build. That is a real reproducibility
  gap."*
- `frontend/Dockerfile:40` — `COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun`,
  an unpinned floating tag, pulled purely so a devDependency's postinstall can create a symlink.
- `backend/.dockerignore` — 18 lines. It excludes `.env` but not `local.env` (which **is** committed,
  S-25), not `.env.example`, not `.git`, not `coverage/`, not `src/tests/`. `COPY . .` at
  `Dockerfile:21` therefore copies all of them into the builder. They do not reach the runtime stage
  — `Dockerfile:67-79` copies five named paths — but `package.json`'s `pkg.assets` includes
  `"uploads/**/*"` and `"docs"`, so **whatever is in `backend/uploads/` at build time is embedded
  into the binary**. On this working copy that directory holds `attachments/`, `certificates/`,
  `profile/` and `tenant/`.

**Why it matters here.** A clean clone does build — `frontend/Dockerfile:1-24` records that the
previous one did not, which is why that claim is worth checking rather than assuming. But it builds
something different every time, from a package index it verified with a trust store it fetched
unverified, and it can bake a developer's local uploads into the shipped artefact.

**Fix direction.** Commit the lockfiles and switch both images to `npm ci`. Pin the bun image by
digest. Replace the verify-peer dance with `COPY --from=debian:bookworm-slim
/etc/ssl/certs/ca-certificates.crt` or a base image that already has the bundle. Add `uploads`,
`local.env`, `.git`, `coverage`, `src/tests` and `__tests__` to `backend/.dockerignore`, and drop
`uploads/**/*` from `pkg.assets` unless something genuinely needs it.

**Definition of Done**
- [ ] `npm ci` succeeds in both images from a committed lockfile
- [ ] no step disables certificate verification
- [ ] `docker run --rm <image> ls /app` and a `strings` scan of the binary show no developer upload
- [ ] a clean clone of the repository builds both images — recorded with the commit it was run at

---

## S-14 — The backup pruner and the backup writer point at different directories

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code |

**Evidence**

- `backend/src/middlewares/backup.middleware.js:12` —
  `const backupFolder = storagePath("backup");` → `/app/backup`.
- `backend/src/middlewares/backup.middleware.js:47` —
  `const backupDir = path.join(rootDir, "backup");` → the pkg snapshot root (S-03).
- `backend/src/middlewares/backup.middleware.js:111-131` — `deleteOldFiles()` iterates
  `backupFolder` (`/app/backup`), `fse.stat`s each **entry** — directories included — and
  `fse.remove`s anything whose mtime is more than 30 days old.
- `backend/src/services/tenantBackup.service.js:21` — tenant backup ZIPs live in
  `storagePath("backup", "tenant-backups")`, i.e. `/app/backup/tenant-backups`.
- `backend/src/middlewares/backup.middleware.js:140-150` — both run on every `BACKUP_SCHEDULER`
  tick.

**Why it matters here.** The writer writes where nothing reads and the pruner prunes where nothing
was written. That is harmless until the `tenant-backups` **directory's** own mtime passes 30 days —
which happens whenever no new tenant backup has been created for a month — at which point
`fse.remove` deletes the directory and every retained tenant backup inside it, regardless of each
backup's own `retentionDays` (`models/tenantBackup.model.js:26`, default 30) and regardless of
`expiresAt`. The `tenant_backups` rows survive pointing at files that are gone.

**Fix direction.** Prune files, not directories, and prune by the `expiresAt` the model already
stores rather than by filesystem mtime. Use one constant for the backup root.

**Definition of Done**
- [ ] `deleteOldFiles` skips directories — asserted by a test with an old directory containing a new
      file
- [ ] retention is driven by `tenant_backups.expiresAt`, and deleting a file marks its row
- [ ] writer and pruner resolve the same path from the same helper

---

## S-15 — The traversal guard validates its input against a root derived from that input

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — latent today |
| **Verified** | from code |

**Evidence**

- `backend/src/services/attachment.service.js:38-46`:
  ```js
  const folderParts = attachment.folder.split("/").filter(Boolean);
  const abs  = storagePath(...folderParts, attachment.fileName);
  const root = storagePath(...folderParts);
  if (!abs.startsWith(root)) { throw new AppError(400, "Invalid attachment path"); }
  ```
- `backend/src/services/storageMigration.service.js:39-49` — the same six lines.
- `root` is built from the same untrusted `attachment.folder` it is supposed to constrain. With
  `folder = "../../etc"`, `root` resolves outside the storage root and `abs` is `root/<fileName>`,
  so `startsWith` is true and the guard passes. It constrains `fileName` only.
- Against: `docs/STORAGE/04-TENANT-STORAGE.md:254` — *"the traversal guard in
  `storageMigration.legacyPath()` and in `attachment.service.resolveAbsPath()` is written at each
  call site, which is why both of them re-derive the root and compare prefixes."* Re-deriving the
  root from the untrusted value is the defect, not the mitigation.
- Compare `backend/src/services/storage/local.driver.js:45-59`, which resolves against a **fixed**
  `this.root`, and `:69-94`, which additionally resolves symlinks. That one is correct.

**Why it matters here.** `folder` is written by the server as the constant `ATTACH_FOLDER`
(`attachment.service.js:22, 100`), so nothing reaches this today. But it is a plain nullable column
on the model, the migration tool reads it from rows that may predate that constant, and the
documentation tells the next reader the check is sound. That combination is how a latent guard
becomes a live one.

**Fix direction.** Compare against `storagePath()` with no arguments — the fixed root — in both call
sites, the way `local.driver.js` does. Then correct `docs/STORAGE/04-TENANT-STORAGE.md:254`.

**Definition of Done**
- [ ] a test with `folder = "../../etc"` and a benign `fileName` is refused by both functions
- [ ] both compare against the fixed storage root
- [ ] `docs/STORAGE/04-TENANT-STORAGE.md:254` no longer presents the re-derivation as the reason it
      is safe

---

## S-16 — `make migrate` always also runs migrations on the host

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from the Makefile, by shell-precedence analysis |

**Evidence**

- `Makefile:178`:
  ```make
  $(DC) exec backend ./backend --migrate up || cd backend && npm run migrate
  ```
  `A || B && C` parses left-associatively as `(A || B) && C`. When the container migration
  **succeeds**, `B` (`cd backend`) is skipped and `C` (`npm run migrate`) still runs — from the
  repository root, against whatever `backend/.env` points at. When it fails, `cd backend` runs and
  `npm run migrate` runs there.
- `Makefile:14` sets `.ONESHELL`, so the whole recipe is one shell and the `cd` persists into later
  lines of that recipe.
- `backend/package.json` `scripts.migrate` is `node src/scripts/migrate.js up`.

**Why it matters here.** The intent is an in-container migration with a host fallback. What it does
is run the host migration every time — either against nothing (no `node_modules`/no `.env` at the
root, a confusing failure right after a successful migration) or, on a developer machine with a
populated `backend/.env`, against a **different database**. `Makefile:180-182` then prints the
correct advice that the migration log is not evidence, which is the only reason this has not
produced a silent surprise.

**Fix direction.** Brace the fallback: `{ A; } || { cd backend && npm run migrate; }`. While there,
`Makefile:186` and `:190` (`migrate-status`, `migrate-undo`) run on the host unconditionally with no
container path at all — that should be deliberate or fixed.

**Definition of Done**
- [ ] a successful container migration does not run the host one
- [ ] `make migrate-status` targets the same database `make migrate` did

---

## S-17 — Uploads land in the public tree before they are scanned, and the scan cache key is not a hash

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code |

**Evidence**

- `backend/src/utils/upload.util.js:16-29` — multer's `diskStorage` writes the file to
  `storagePath(req.uploadFolder)` = `uploads/attachments` **as it is received**.
- `backend/index.js:339` — that directory is the public static mount (S-01).
- `backend/src/utils/upload.util.js:134-159` — the magic-byte check runs **after** the write.
- `backend/src/services/attachment.service.js:85-90` — the virus scan runs after that, and unlinks
  on a positive.
- So a file is world-readable at a predictable-prefix path for the duration of the scan
  (`CLAMAV_TIMEOUT` defaults to 10 s, `clamAv.service.js:25`) before it is rejected and removed.
- `backend/src/services/clamAv.service.js:249-256, 271-274` — the cache is keyed
  `` `${stat.size}:${stat.mtimeMs}` ``, under a heading that reads
  `FILE HASH CACHE (prevent re-scanning)` (`:44-45`). It is not a hash of anything. Two files of the
  same byte length written in the same millisecond share a verdict.
- `backend/src/services/clamAv.service.js:49` — entries live 24 hours.

**Why it matters here.** The window is small and the collision is contrived — but the mitigation is
free, and the cache key is simply mislabelled in a way that invites someone to trust it. The scan is
the last gate before a file becomes a permanent public URL (S-01); it should not be racing that URL.

**Fix direction.** Write uploads to a staging directory outside `storagePath("uploads")` and move
the file into place only after the magic-byte check and the scan both pass. Key the cache on the
SHA-256 `attachment.service.computeChecksum` already computes.

**Definition of Done**
- [ ] an upload is not reachable at its `/uploads` URL until the scan has passed — asserted
- [ ] the cache key is a content hash, and the heading matches
- [ ] a rejected upload leaves no file behind

---

## S-18 — Helm: no backup volume, persistence on the wrong path, no NetworkPolicy, no PDB

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from manifests |

**Evidence**

- `deploy/helm/callibrator/charts/backend/templates/deployment.yaml:95-125` — the only volumes are
  `storage` (conditional PVC), `logs` (`emptyDir`) and `wellknown` (`emptyDir`).
  **There is no mount for `/app/backup`**, which is where `tenantBackup.service.js:21` writes every
  tenant backup ZIP, and which compose does bind (`docker-compose.yml:34`).
- `:96-99` — the PVC, when enabled, mounts at `/app/uploads`. The `local` storage driver's root is
  `/app/storage` (S-12), so pluggable-storage objects are on an `emptyDir`-equivalent ephemeral
  layer even with `persistence.enabled: true`.
- `:124-125` — `wellknown` is an `emptyDir`, so ACME challenge files do not survive a restart. That
  is probably fine for HTTP-01 and is worth stating rather than leaving to chance.
- `grep -rn "NetworkPolicy\|PodDisruptionBudget\|HorizontalPodAutoscaler" deploy/helm` → **no
  matches**. Nothing restricts pod-to-pod traffic to the externally-provided Postgres, Redis and
  RabbitMQ (`docs/DEVOPS/09-KUBERNETES.md:120-126`), and `frontend.replicaCount: 2`
  (`values.yaml:138`) has no disruption budget.
- Against: `docs/DEVOPS/04-DATABASE-BACKUP.md:160` lists `./backup` as holding tenant backups —
  true on compose, and there is no equivalent in the chart.

**Why it matters here.** A tenant backup taken in-cluster is written to the container layer and lost
on the next rollout. The operator has a `tenant_backups` row saying `completed`, with a
`filePath` that no longer exists — which is the same shape as S-14 and as
`docs/DEVOPS/04-DATABASE-BACKUP.md:167`'s warning about believing a job that reports success.

**Fix direction.** Add a `backup` PVC (or refuse to render with `cron.enabled` and no backup
persistence, matching the style of `guards.tpl`), mount the storage PVC at `/app/storage` as well as
`/app/uploads`, add a default-deny NetworkPolicy with explicit egress to the three datastores, and
add a PodDisruptionBudget for any deployment with `replicaCount > 1`.

**Definition of Done**
- [ ] `/app/backup` is on a PVC, or `cron.enabled` without one refuses to render
- [ ] the storage PVC covers the `local` driver root
- [ ] a NetworkPolicy and a PDB exist and render
- [ ] none of this is described as working until a cluster has accepted it

---

## S-19 — Compose containers have no user, capability, filesystem or CPU constraints

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from manifests |

**Evidence**

- `deploy/compose/docker-compose.yml` — no `user:`, no `cap_drop:`, no `read_only:`,
  no `security_opt:` and no `deploy.resources` on **any** of the eight services. The backend and
  frontend images set `USER` themselves (`backend/Dockerfile:95`, `frontend/Dockerfile:99`);
  postgres, redis, rabbitmq, clamav and nginx run as whatever their images default to, with the full
  default capability set.
- `docker-compose.prod.yml:46-104` adds **memory** limits only. No `cpus:` anywhere, so one runaway
  Chromium render (`:49-50` acknowledges the burstiness) can starve the host.
- `docker-compose.prod.yml:106-113` — nginx gets `restart` and `logging` but no resource block.
- `docker-compose.dev.yml:49-64, 74-106` — Postgres `5432`, Redis `6379`, RabbitMQ `5672` and
  `15672`, ClamAV `3310`, MinIO `9000`/`9001` and pgAdmin `8888` are all published **without a bind
  address**, i.e. on `0.0.0.0`, with `PGADMIN_CONFIG_SERVER_MODE: "False"` (no login) at `:82` and
  `minioadmin:minioadmin` at `:98-99`. The file says "NOTHING HERE IS SAFE FOR PRODUCTION" (`:7`) —
  it is also not safe on a laptop on hospital wifi.
- The VM overlay is the good example: `docker-compose.vm.yml:51, 82, 93` bind to `127.0.0.1` and
  only `19080` is on `0.0.0.0` (`:105`).

**Why it matters here.** The prod overlay is the one an operator would copy for a second site, and
it is the weakest of the three on container hardening while being the strongest on memory limits —
so it looks like it was thought about. The dev overlay's `0.0.0.0` bindings are the reachable
version of the same gap; A-17 removed one such port and the pattern remains in five others.

**Fix direction.** Bind every dev port to `127.0.0.1` as the VM overlay does. Add `cap_drop: [ALL]`
plus the minimum `cap_add` to every service, `read_only: true` with explicit `tmpfs` where the image
allows it, `security_opt: [no-new-privileges:true]`, and `cpus:` alongside the existing memory
limits.

**Definition of Done**
- [ ] `docker compose … config` for dev shows no `0.0.0.0` binding except the reverse proxy
- [ ] every service declares `cap_drop`, `no-new-privileges` and a CPU limit in prod
- [ ] `docs/DEVOPS/02-CONTAINERIZATION.md:182` ("non-root") is expanded to say which services that
      covers

---

## S-20 — Secrets stored in the database outside the KMS

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code |

**Evidence**

What **is** protected:

| Secret | How | Where |
|---|---|---|
| `tenant_settings` sensitive keys | KMS envelope, AES-256-GCM, tenant id as AAD | `models/tenantSettings.model.js:52-61, 77-82` |
| custom-domain TLS private key | KMS envelope | `services/customDomains.service.js:460` |
| `tenant_keys.privateKey` | AES-256-**CBC** under `ENCRYPT_KEY`, unauthenticated, no AAD | `services/eSignature.service.js:179` (S-08) |
| API keys | SHA-256 of a random key, prefix stored for display | `models/apiKey.model.js:29-34` |
| refresh tokens | `sessions.token_hash` | `models/session.model.js:35` |

What is **not**:

| Secret | Evidence |
|---|---|
| `users.mfaSecret` — the TOTP seed | `models/user.model.js:80-83`: plain `STRING(255)`, no hook, and the model's `defaultScope` (`:165-167`) filters `is_deleted` only — it does **not** exclude the column |
| `calibration_devices.iotDeviceToken` | `models/calibrationDevice.model.js:82-86`: plaintext, `unique: true`, no scope exclusion. A-29 already covers the leak-in-list-responses half; the plaintext-at-rest and **global** uniqueness halves are separate. A globally unique tenant-owned value is a cross-tenant existence oracle — the trap `CLAUDE.md` names |
| `webhooks.secret` | `models/webhook.model.js:47-51`: plaintext `STRING(128)`. Covered by A-51 for the caller-supplied and unrotatable halves; noted here so the at-rest inventory is complete |

**Why it matters here.** Anyone with read access to a database dump — which is exactly what
`make backup` (`Makefile:207-215`) produces and writes to `./backups`, unencrypted — gets every
tenant's TOTP seeds and every IoT device token in the clear. The `docs/DEVOPS/04-DATABASE-BACKUP.md`
model that a dump plus the secrets is a recoverable system also means a dump **without** the secrets
is still a serious disclosure, because these three are not among the things the secrets protect.

**Fix direction.** Add `mfaSecret` and `iotDeviceToken` to a KMS-encrypted path (the
`tenantSettings` hook pattern generalises), exclude both from every default scope, and make the IoT
token a hash the way API keys already are. Make `certificate_number` and `iot_device_token`
uniqueness tenant-scoped.

**Definition of Done**
- [ ] a `pg_dump` contains no readable TOTP seed and no readable IoT token
- [ ] neither column appears in any API response — asserted per route, not by inspection
- [ ] uniqueness constraints on tenant-owned business identifiers are `(tenant_id, value)`

---

## S-21 — Six places describe a `/health` body that no longer exists

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code and docs |

**Evidence**

A-06 and A-15 changed `/health` to return exactly `{"status":"ok"}` — one key, asserted by
`controllers/health.controller.test.js` — and split liveness and readiness onto `/live` and `/ready`
(`routes/internal/health.route.js`, mounted at `backend/index.js:517`). These were not updated:

| Claim | Where |
|---|---|
| "`/health` returns 200 with `database: \"connected\"`" | `Makefile:390` (postdeploy checklist) |
| same | `deploy/README.md:232` (After Any Deployment) |
| same, twice | `docs/DEVOPS/04-DATABASE-BACKUP.md:100` and `:109` |
| "`/health` calls `db.authenticate()`" | `docs/DEVOPS/09-KUBERNETES.md:85` |
| same | `deploy/compose/docker-compose.yml:51-52` |
| liveness on `/`, readiness on `/health`, with no mention of `/live` or `/ready` | `deploy/helm/callibrator/values.yaml:50-64`, `charts/backend/values.yaml:30-42` |

The **status codes** are unchanged (200/503), so the compose healthcheck at
`docker-compose.yml:53` and the Helm probes still function. Only the body claim and the
`db.authenticate()` description are stale.

**Why it matters here.** A post-deploy checklist with an item that can never pass trains people to
skip the checklist. `Makefile:390` is the first line of `postdeploy`, which `make deploy` prints
after every deployment.

**Fix direction.** Point the deep checks at `/ready` (which does report per-dependency state,
`health.controller.js#readinessDetail`) and leave `/health` described as a verdict. Add `/live` to
the Helm liveness path.

**Definition of Done**
- [ ] every listed line matches what `health.controller.js` returns
- [ ] the Helm liveness probe uses `/live`

---

## S-22 — Two manifests document things that were removed or never built

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from manifests |

**Evidence**

- `deploy/compose/docker-compose.vm.yml:19` — the PORT ALLOCATION header still lists
  `0.0.0.0:19883   mqtt   NOTHING LISTENS HERE`, in the same file whose `:52-56` explains that A-17
  removed that mapping on 2026-09-23. The mapping is gone; the allocation table was not updated.
- `deploy/helm/callibrator/charts/backend/values.yaml:25-28` —
  *"Embedded aedes MQTT broker for IoT telemetry ingest"*, and
  `charts/backend/templates/deployment.yaml:48-54` exposes `containerPort: 1883` with
  *"Embedded so an on-premise hospital deployment does not need a separate broker"*.
  There is no embedded broker: A-17 and `deploy/compose/.env.example:66-68` both state the backend
  is an MQTT **client** of an external broker, and there is no aedes server in the codebase.
  `mqtt.enabled` defaults to `false`, so nothing renders today — but setting it publishes a port
  with nothing behind it, in a cluster, which is the finding A-17 closed on compose.

**Fix direction.** Delete the `19883` line from the vm header. Delete `mqtt.enabled` and the port
block from the backend subchart, or rewrite both comments to say the port is for a sidecar broker
that the chart does not provide.

**Definition of Done**
- [ ] neither manifest describes an embedded broker
- [ ] no chart value can publish 1883 without a broker to publish

---

## S-23 — `vm-http.conf` proxies two Swagger paths the backend does not serve

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code and manifests |

**Evidence**

- `deploy/compose/nginx/vm-http.conf:82-84`:
  ```nginx
  location /api-docs    { proxy_pass http://backend; }
  location /swagger.json { proxy_pass http://backend; }
  ```
- `backend/src/docs/swagger.js:25-27` — the backend serves the spec at **`/docs.json`** and the UI
  at **`/docs`**. Nothing is mounted at `/api-docs` or `/swagger.json`.
- `backend/src/docs/swagger.js:20-40` — `swaggerDocs(app)` is called unconditionally
  (`backend/index.js:363`) with **no authentication and no environment gate**. On the VM it is
  unreachable only because neither nginx config routes `/docs`, and `location /` sends it to the
  frontend; on `127.0.0.1:19000` (`docker-compose.vm.yml:51`) it is directly reachable.

**Why it matters here.** Two dead proxy rules that look like a working control, plus an
unauthenticated full API contract that is currently protected by an accident of routing rather than
by a decision. Adding a `/docs` location later — an easy thing to do while debugging — publishes the
whole surface.

**Fix direction.** Delete the two locations or point them at the real paths. Gate `swaggerDocs` on
`NODE_ENV !== "production"` or behind `superAdminOnly`, and record which.

**Definition of Done**
- [ ] the nginx locations match the mounted paths, or are gone
- [ ] `/docs` and `/docs.json` require authentication in production — asserted by a test

---

## S-24 — `docs/STORAGE/04` says `GET /usage` is `auth` only; the route is tenant-admin gated

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code |

**Evidence**

- `docs/STORAGE/04-TENANT-STORAGE.md:135` — the endpoint table gives `GET /usage` the gate
  `auth` only.
- `docs/STORAGE/04-TENANT-STORAGE.md:147` builds a paragraph on it: *"**`GET /usage` is `auth`
  only.** Any authenticated member of the tenant can read the tenant's stored bytes and object
  count. That is a deliberate scope-of-the-fix line…"*
- `backend/src/routes/api/storage.route.js:121` —
  `router.get("/usage", ...storageAdmin, storageController.getUsage);`
  where `storageAdmin` is `[auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])]`
  (`:13`). It has the same gate as the four settings routes.

**Why it matters here.** The code is stricter than the document, so this is not a live hole — but it
is the document being wrong about a gate, which is the failure mode `CLAUDE.md` opens with, and it
is wrong in the direction that would let a reviewer wave through a route that genuinely was
`auth`-only. The rest of that section is accurate and worth keeping, including the honest note at
`:147` that the A-02 sweep would not catch a newly added ungated storage route.

**Fix direction.** Correct both lines. Keep the note about the sweep's blind spot, and consider
turning it into an assertion that enumerates the storage router's stack.

**Definition of Done**
- [ ] `docs/STORAGE/04-TENANT-STORAGE.md:135` and `:147` match `storage.route.js:121`
- [ ] a test enumerates the storage router and fails on any route with `auth` alone except
      `GET /object`

---

## S-25 — Three divergent environment templates, one committed and unusable

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from `git ls-files` and the files |

**Evidence**

- `git ls-files | grep env` → `backend/.env.example`, `backend/local.env`,
  `deploy/compose/.env.example`.
- `backend/local.env` is **committed**. Its contents are placeholders only —
  `SECRET=CHANGE_ME…`, `DB_PASS=CHANGE_ME…`, `JWT_ACCESS_SECRET=CHANGE_ME…` — so **no secret is
  leaked**, and its own line 4 says "Never commit secrets to version control."
- It defines 34 variables and **none** of the four the application requires:
  no `CERT_SIGNING_SECRET`, no `ENCRYPT_KEY`, no `ATTACHMENT_URL_SECRET`, no `KMS_MASTER_KEY`. A
  developer who copies it to `.env` gets a backend that throws at
  `services/eSignature.service.js:36` before it listens.
- It sets `JWT_ACCESS_EXPIRED=1d`, against `deploy/compose/.env.example:93`'s `15m`.
- It is not in `backend/.gitignore` (which lists `.env` only) and not in `backend/.dockerignore`
  (which also lists `.env` only), so `COPY . .` at `backend/Dockerfile:21` carries it into the
  builder stage.

**Why it matters here.** Three templates, one of which is committed, is stale, contradicts the
others and cannot produce a working process. `.env.example:39-41` records that `KMS_MASTER_KEY` was
"found only by deploying" precisely because it was missing from a template — and here is a third
template still missing all four.

**Fix direction.** Delete `backend/local.env`, or make it a symlink-in-spirit to
`backend/.env.example` with the four required secrets present. Add `*.env` and `.env.*` to both
ignore files. Decide which of the two remaining templates is canonical and say so at the top of the
other.

**Definition of Done**
- [ ] one canonical template per workspace, each listing every variable the code will refuse to
      start without
- [ ] `.dockerignore` and `.gitignore` cover every env filename, not just `.env`
- [ ] a fresh clone + copy of the template starts the backend

---

## S-26 — The JWT key registry is decorative, and non-HS256 deployments stop verifying after 30 days

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code |

**Evidence**

- `backend/src/utils/jwt.util.js:88-104` — `JwtKeyRegistry` is an in-process `Map` seeded with one
  key whose `expiresAt` is **`now + 30 days`**, computed at process start.
- `:120-133` — `getActiveKeys()` filters on `now <= expiresAt`, so after 30 days of continuous
  uptime it returns `[]`.
- `:248-300` — `verifyAccessToken` loops over `getActiveKeys()` and, when that yields nothing, falls
  through to a fallback that verifies against `ACCESS_SECRET` with **`algorithms: ["HS256"]`**
  hardcoded (`:290-293`).

  So with the default `JWT_ALGORITHM=HS256` the fallback saves it. With `HS384`, `HS512` or any
  `RS*`/`ES*` — all of which `:36-46` explicitly supports and `:49` reads from the environment —
  the fallback cannot match and **every access token is rejected** once uptime passes 30 days.
- `:335-374` — `rotateKeys()` generates a key, calls `keyRegistry.rotateKey()` and returns. It has
  **no caller** in `src/` outside tests, nothing persists the result, and a restart discards it. On
  more than one replica each process would hold a different Map.

**Why it matters here.** The single-VM reference deployment restarts on every rebuild, so it has
never been up for 30 days, and it uses the HS256 default — which is why this has not been seen. It
is still a dormant, date-triggered total authentication outage for any deployment that pins a
stronger algorithm, and the "rotation support" the registry advertises is not rotation: rotating
`JWT_ACCESS_SECRET` means editing `.env` and restarting, which invalidates every token in flight.

**Fix direction.** Either implement rotation properly — persist keys, expose an operator endpoint,
select by `kid` — or delete the registry and verify against `ACCESS_SECRET` directly, which is what
effectively happens today. Do not leave a `rotateKey` method that looks like a control. Whichever
way, the 30-day `expiresAt` must not be able to empty the active set.

**Definition of Done**
- [ ] a test sets the clock past 31 days of uptime with `JWT_ALGORITHM=HS512` and asserts a valid
      token still verifies
- [ ] `rotateKeys()` has a caller and a store, or it is deleted
- [ ] `docs/SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md` states what rotating each JWT secret requires

---

## Not Findings — Checked and Sound

Recorded so the next audit does not re-derive them.

| Area | Why it is fine |
|---|---|
| `services/storage/keys.js` | `assertKeyForTenant` runs on every `ScopedStorage` call (`index.js:67-99`); a null tenant reaches `global/` only; `normalizeKey` throws on backslash and NUL rather than cleaning |
| `services/storage/signing.js` | HMAC over `key.exp`; constant-time compare with a length guard first; returns `false`, never throws; expiry checked before the compare |
| `openSignedObject` | verifies the token **before** touching storage and derives the tenant from the key, never from the request (`index.js:195-210`) |
| `/api/v1/storage/object` with no tenant context | `resolveScope` returns `skip` for a request with no CLS store (`utils/tenantScope.util.js:53-54`), so `getTenantConfig`'s explicit `where: { tenantId }` is honoured and the correct tenant driver is built. The driver cache is not poisoned by the public route |
| tenant vs operator S3 endpoint | `s3.driver.js:64-78` SSRF-checks a tenant endpoint and exempts only `endpointTrusted`, which `getGlobalConfig` alone sets (`config.service.js:48`). `validateTenantConfig` never returns the flag |
| `storage_credentials` at rest | `config.service.js:180-188` deliberately uses `findOrBuild`+`save` rather than `upsert`, so the encryption hook runs. The trap is documented and the code obeys it |
| `LocalDriver._resolve` / `_assertNoSymlinkEscape` | resolves against a fixed root and walks up to the nearest existing ancestor before comparing realpaths (`local.driver.js:45-94`) — the correct version of S-15 |
| API keys and refresh tokens at rest | SHA-256 hash plus display prefix (`models/apiKey.model.js:29-34`); `sessions.token_hash` (`models/session.model.js:35`) |
| A-40 (driver cache per process, unverified migration copies) | confirmed still accurate at `services/storage/index.js:32, 144-164` and `storageMigration.service.js`. Not restated |
| A-17 (public MQTT port) | confirmed removed from `docker-compose.vm.yml` and `docker-compose.dev.yml`. Only the stale header comment remains — S-22 |
| A-02 (storage settings gating) | confirmed at `routes/api/storage.route.js:13, 90-121`. `GET /object` is correctly left out; `GET /usage` is *more* gated than documented — S-24 |

---

## What Could Not Be Checked

| Question | Why not |
|---|---|
| Whether the reference VM's running `.env` matches `.env.example` | out of scope by instruction — the audit was from the repository, and 10.1.200.13 was not contacted |
| Whether `/uploads/certificates/CERT-…pdf` actually answers 200 unauthenticated in production | S-01 is derived from the static mount, the nginx locations and the filename format. Confirming it means fetching a real hospital's certificate |
| Whether clamd answers `UNKNOWN COMMAND` to `STANDBY` | S-04's first Definition-of-Done item. The clamd command set is documented and `STANDBY` is not in it, but this was not run against a container |
| Whether the Helm manifests are accepted by a cluster | no cluster has been reachable (`Chart.yaml:39-44`). S-06 is a template-name and securityContext analysis, not an apply |
| Whether the backend image's `app` uid is 997 as `deploy/README.md:207` claims | `useradd -r` (`Dockerfile:60`) picks the highest free system uid, which depends on the base image contents. Verifying it means building |
| Whether bind-mounted `volumes/uploads` is writable by that uid on the live host | `deploy/README.md:207-211` says it must be chowned first; whether it was is a host fact |
| Whether a restore has ever been performed | `docs/DEVOPS/04-DATABASE-BACKUP.md:135` says no drill has been done, and nothing in the repository contradicts it. S-02 and S-03 say what a first drill would find |
| Whether `make verify` passes | not run — this was an audit, and the instruction was to change nothing |

---

## Infra batch — 2026-09-24

Every card was checked against the files before it was changed, and **three cards were wrong in
part**. The record is [`MEMORY/records/2026-09-24-phase0-batch2.md`](../MEMORY/records/2026-09-24-phase0-batch2.md),
and the build-context decision is **ADR-046**.

| | What was done | Validated by |
|---|---|---|
| **S-07** | `nginx/default.conf` and the Helm ingress now send `/api/` to the **frontend**, matching `vm-http.conf`, `docs/DEVOPS/03` and the frontend proxy. The base compose file and the frontend chart now set `BACKEND_INTERNAL_URL`: without it, prod and staging would have looped `/api` back through nginx | `nginx -t` on both configs; a live routing test with a stub frontend. **No browser login against `default.conf`** |
| **S-10** | `IMAGE_TAG=` ships empty, so a template-copied `.env` fails prod and staging `config`. Compose cannot refuse the literal `latest`; `make preflight` does, and `deploy/README.md` now says the compose guard is presence-only | `docker compose config -q` for all four overlays |
| **S-13** | **The card was wrong:** `npm ci` cannot run in a `backend/` context, because the committed lockfile is the root workspace one (ADR-044). The build context moved to the repo root (ADR-046), `npm ci --workspace backend`, a `Dockerfile.dockerignore` allow-list, and `Verify-Peer=false` is gone — CA certificates are copied from the builder. Swagger UI assets are now embedded explicitly, because the tree is hoisted | `docker build` exit 0; the image booted against pg18, Redis and RabbitMQ, applied 22 migrations, and served `/health`, `/live`, `/ready` and `/docs/swagger-ui.css` |
| **S-16** | **The card was incomplete:** the binary has no `--migrate` CLI, so `exec backend ./backend --migrate up` started a second server, which migrated as a side effect of booting and died on EADDRINUSE. `make migrate` now restarts the backend, which migrates at boot, and waits for healthy. `make migrate-host` is explicit, and the host-only targets say so | GNU make in a container: `make -n migrate` stops on failure |
| **S-21** | every health claim now matches the code: `/health` returns `{"status":"ok"}` or 503, plus `/live` and `/ready`; backend liveness probes `/live` | Helm template and lint; live curl |
| **S-22** | the MQTT port and "embedded aedes" text are removed from the VM overlay and the backend subchart | `helm template`: no 1883 |
| **S-23** | the two Swagger locations the backend never served are removed from `vm-http.conf`. **Still open:** gating `/docs` itself | live 404s on the removed paths |
| **S-25** | `backend/.env.example` (source checkout) and `deploy/compose/.env.example` (stack) are named canonical. `local.env` is marked "NOT A TEMPLATE". It is not deleted, because four docs and a script copy it | — |
| **S-09** | the template's RabbitMQ user, password and URL now agree; `make check-env` rejects a URL that disagrees; `make preflight` rejects `guest` and `CHANGE_ME`. **Redis `requirepass` is deferred** — it changes every running stack's `REDIS_URL` | make cases in a container: exit 2 on each bad input |

**Found, not fixed:**

- **S-27 — the Helm chart is broken under its own default release name.** `RELEASE ?= callibrator`
  makes the umbrella `fullname` collapse to `callibrator`. The ingress then targets services that do
  not exist, and the backend `envFrom` names a ConfigMap that does not exist. Confirmed with
  `helm template callibrator …`.
- **S-28 — the Makefile uses `.ONESHELL` without `-e`,** so a failing middle command does not stop a
  recipe: a failed `pull` in `deploy` still runs `up`. Only the new `migrate` recipe is guarded.
- **S-29 — `frontend/Dockerfile` still uses `npm install` and an unpinned `oven/bun:1-alpine`.**
- **S-30 — the compose frontend sets `HOST: 0.0.0.0`,** which Next standalone ignores. It binds
  correctly only because the Dockerfile sets `HOSTNAME`.
