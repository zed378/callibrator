# 04 — Tenant Storage

Pluggable object storage: `local`, `s3` and `nfs`, a platform default plus a per-tenant override, KMS-encrypted credentials, tenant-scoped keys, signed downloads, and the tool that moves legacy on-disk attachments into it.

> **Target standard: TypeScript, strict (ADR-038).** Every file named here is **JavaScript/CommonJS** today and is described **as built**. Conversion happens module by module under [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md) and never changes behaviour.

Implementation:

| | |
|---|---|
| façade | `backend/src/services/storage/index.js` |
| key construction and the isolation guard | `backend/src/services/storage/keys.js` |
| configuration resolution | `backend/src/services/storage/config.service.js` |
| drivers | `backend/src/services/storage/local.driver.js` · `s3.driver.js` |
| download-URL HMAC | `backend/src/services/storage/signing.js` |
| tenant-facing settings | `backend/src/services/storageSettings.service.js` |
| migration tool | `backend/src/services/storageMigration.service.js` · `backend/src/scripts/migrateStorage.js` |
| route and controller | `backend/src/routes/api/storage.route.js` · `backend/src/controllers/storage.controller.js` |
| request validation | `backend/src/validators/storage.validator.js` |
| filesystem-root helper | `backend/src/utils/storagePath.util.js` |

---

## Read This First: What Is Wired, and What Is Not

Two facts decide how much of this document applies to the code you are about to change.

**The attachment request path does not use this module yet.** `backend/src/services/attachment.service.js` still writes and reads files through multer and `storagePath.util.js` at `uploads/attachments/<fileName>`. Nothing outside `storageMigration.service.js` reads or writes `attachment.storageKey`. The only application code that imports `services/storage` is the storage controller and the migration tool. The pluggable layer is built, tested and reachable through `/api/v1/storage`; **the upload and download path has not been cut over to it.** Do not write a document, a task or a code comment that says attachments are served from tenant storage today.

**The legacy path is no longer served statically (S-01, ADR-057 — ADR-042 steps 3–6).** Until 2026-09-24 `backend/index.js` mounted `express.static(storagePath("uploads"))` at `/uploads` with **no authentication**: every attachment and every certificate PDF on that legacy path was an unauthenticated, permanent URL, and deleting an attachment (a soft delete) did not revoke it. As built now:

| Class | On disk | Reached through |
|---|---|---|
| **public** — avatars, tenant logos, CMS images | `uploads/public/{profile,tenant,cms}/` | the static mount, **only** `/uploads/public/*`, images only (`.jpg .jpeg .png .gif .webp`, each served with a pinned `Content-Type`), `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`. **SVG is refused.** Written only by a permissioned upload: `users:update` (avatar), `management` (logo), `content:create` (`POST /api/v1/content/media`, which also writes an audit row) |
| attachments | `uploads/attachments/` | `GET /api/v1/attachments/:id/download` (`auth` · `equipment:read` · tenant · soft delete) — the `url` in every attachment response — or a signed `/attachments/:id/signed?token=…` link. Both answer **404** once the attachment is deleted, and the delete **unlinks the file after its transaction commits** |
| certificates | `uploads/certificates/` (`filePath` is the locator `certificates/<random>.pdf`, not a URL) | `GET /api/v1/certificates/:id/pdf` (`auth` · `certificate:read` · tenant), or — for the public verification page — the `documentUrl` capability `/api/v1/certificates/verify/<number>/document?token=…`, minted **only for a `signed` certificate**, one-hour TTL (`CERT_DOCUMENT_URL_TTL_SEC`), status re-checked on every fetch |
| exports, backups | `exports/`, `backup/` | never under `uploads/`; their own gated routes |

Every gated file route answers `If-None-Match`/`If-Modified-Since` with 304 and a single `Range` with 206, and sets `Content-Disposition` from the content type — `inline` only for raster images and PDF (`backend/src/utils/fileResponse.util.js`). Existing files and stored paths were moved by migration `0056-uploads-public-class.js`.

**`GET /usage` is not connected to billing.** `meteredBilling.service.js` defines a `storage_bytes` metric and `usageMetric.model.js` stores it, but no code calls `storageSettings.getUsage()` and records it. The endpoint reports the number; feeding it to metering is unbuilt.

## The Three Providers

`config.service.js` freezes the allowlist at `["local", "s3", "nfs"]`.

| Provider | Driver | Where objects live | Downloads |
|---|---|---|---|
| `local` | `LocalDriver` | a directory on the app server | app-served, HMAC-signed URL |
| `nfs` | `LocalDriver` with `name: "nfs"` | a mounted directory, `fsync` on by default | app-served, HMAC-signed URL |
| `s3` | `S3Driver` | a bucket, optionally behind a custom endpoint | **presigned** URL straight to the bucket |

`nfs` is not a separate driver. It is `LocalDriver` with a different root, a mount health-check and `fsync` defaulting **on** — an NFS client will otherwise acknowledge a write that is still only in its own page cache.

`s3` is the only provider where download traffic leaves the app server. `ScopedStorage.signedUrl()` returns `{ url, expiresAt, direct }`, and `direct: true` means the caller must send the client to the bucket rather than proxying.

## Resolution Order

```
tenant override   (TenantSettings: storage_config + storage_credentials)
       │  absent
       ▼
platform default  (environment: STORAGE_DRIVER and friends)
```

`resolveDriver(tenantId)` in `services/storage/index.js` caches one driver instance per tenant, keyed by tenant id, with `"__global__"` for the platform. Drivers hold an S3 client and a connection pool, so rebuilding one per request would be waste.

**The cache is per process; its invalidation is not (A-40, fixed 2026-09-24).** `storage.invalidate(tenantId)` — awaited after a settings write or clear — drops the local entry **and** writes a new random *generation* to Redis (`storage:driver-generation:<tenantId>`, 30-day TTL). Every `resolveDriver` reads that generation and rebuilds when it differs from the one its cached driver was built under, so a rotated or revoked credential stops being used on **every** replica at its next request. When Redis is unavailable the generation reads as `null` everywhere and staleness is bounded by a local TTL instead: `STORAGE_DRIVER_CACHE_TTL_SEC`, default 60 seconds. The cost is one Redis `GET` per resolve.

A stored configuration is **re-validated on read**, not only on write (`index.js`, `resolveDriver`): a row could predate a validation rule or have been edited out of band.

### Platform default environment keys

| Key | Meaning |
|---|---|
| `STORAGE_DRIVER` | `local` (default), `s3` or `nfs` |
| `STORAGE_S3_BUCKET` | required when `STORAGE_DRIVER=s3` |
| `STORAGE_S3_REGION` | default `us-east-1` |
| `STORAGE_S3_ENDPOINT` | optional; **trusted**, see below |
| `STORAGE_S3_FORCE_PATH_STYLE` | default true; `"false"` turns it off |
| `STORAGE_S3_PREFIX` | optional prefix inside the bucket |
| `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY` | optional — **absent means the SDK's ambient chain (IAM role)**, which is the right setup for a platform-owned bucket |
| `STORAGE_NFS_ROOT` | required when `STORAGE_DRIVER=nfs` |
| `STORAGE_NFS_FSYNC` | default true; `"false"` turns it off |
| `STORAGE_LOCAL_ROOT` | default `storagePath("storage")` |
| `ATTACHMENT_URL_SECRET` (or `CERT_SIGNING_SECRET`) | HMAC secret for local/NFS signed URLs |
| `PUBLIC_BASE_URL` | prefix of the signed URL the app mints |
| `KMS_MASTER_KEY` | 64-char hex; encrypts `storage_credentials` at rest |

An invalid `STORAGE_DRIVER`, or `s3`/`nfs` without its required key, throws a 500 `AppError` from `getGlobalConfig()` the first time storage is resolved — not at boot.

## Keys Are the Isolation Boundary

Every object's key encodes its owner in its first segments:

```
t/<tenantId>/<domain>/<name>     tenant-owned
global/<domain>/<name>           platform-owned
```

`keys.assertKeyForTenant(key, tenantId)` runs on **every** `ScopedStorage` call before the driver sees the key. A service that builds a key by hand still cannot address another tenant's object. Deny-by-default applies exactly as it does in `utils/tenantScope.util.js`: a null tenant may reach `global/` **only** — it is never a wildcard.

`domain` is an allowlist, not free text:

```
attachments · certificates · avatars · backups · exports · branding · temp
```

An unknown domain is a 400. The allowlist exists so a caller cannot invent a namespace that escapes quota accounting or the retention policy attached to each domain.

`normalizeKey()` **throws** on a suspicious key rather than cleaning it up. Backslashes and NUL are rejected outright — a backslash is a path separator on Windows, so a key containing one would traverse on the local driver while looking inert to a naive check. Silently rewriting a traversal attempt into a valid key is how one tenant ends up reading another's object.

`getTenantStorage(null)` does not fall back to global: it throws 500. Platform-owned storage is `getGlobalStorage()`, explicitly.

## Signed Downloads

### local and nfs

`LocalDriver.signedUrl()` mints

```
<PUBLIC_BASE_URL>/api/v1/storage/object?key=<key>&token=<exp>.<hmac>
```

`signing.js` is the single place the token is constructed, so the code that mints and the code that verifies cannot drift. Verification is constant-time and returns `false` — never throws — on a malformed, wrong-length or expired token.

`openSignedObject()` verifies the token **before touching storage**, then derives the tenant from the key (`t/<tenantId>/…`) rather than from the request. A valid token for tenant A's key can only ever open tenant A's object.

The controller (ADR-042 step 5) sets `X-Content-Type-Options: nosniff` and a `Content-Disposition` **chosen by the content type**: `inline` only for `image/jpeg|png|gif|webp` and `application/pdf`, `attachment` for everything else (the local driver stores no type, so it is taken from an allowlisted extension, else `application/octet-stream`). Non-PDF responses also carry `Content-Security-Policy: default-src 'none'; sandbox`. It emits `ETag` (the driver's, or a weak size+mtime tag) and `Last-Modified`, answers a matching `If-None-Match`/`If-Modified-Since` with **304** without opening the object, a single `bytes=` `Range` with **206** (`Content-Range`), an unsatisfiable one with **416**, and a multi-range or malformed one with the whole object; `If-Range` is honoured. `Cache-Control: private, no-cache, no-transform`. If the object disappears mid-stream the connection is aborted, or answered 410 when headers have not been sent. Until 2026-09-24 it hardcoded `attachment` and had none of the rest, which is why it could not back an `<img>` or `<iframe>`.

### s3

`S3Driver.signedUrl()` returns a real presigned GET with `direct: true`. These URLs never reach `/api/v1/storage/object`.

## The Endpoints

Mounted at `/api/v1/storage` (`backend/index.js`).

| Method | Path | Gate |
|---|---|---|
| GET | `/object` | **none** — public, token-gated |
| GET | `/settings` | `auth` · `denyApiKey` · `rbac([TENANT_ADMIN])` |
| PUT | `/settings` | `auth` · `denyApiKey` · `rbac([TENANT_ADMIN])` · `validate(updateStorageSettingsSchema)` |
| DELETE | `/settings` | `auth` · `denyApiKey` · `rbac([TENANT_ADMIN])` |
| POST | `/settings/test` | `auth` · `denyApiKey` · `rbac([TENANT_ADMIN])` |
| GET | `/usage` | `auth` · `denyApiKey` · `rbac([TENANT_ADMIN])` |

### Who may configure storage, and since when

**Until 2026-09-23 the four `/settings*` routes carried `auth` and nothing else.** Any role in the tenant could read the tenant's bucket credentials view, or repoint every future upload at a bucket it owned. That is finding **A-02** in [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md), fixed in commit `e326ae5`. They are now `[auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])]`.

`denyApiKey` is deliberate and separate from the role gate: **an API key must not be able to redirect a tenant's storage**, whatever its scopes.

`TENANT_ADMIN` is a *logical* tier, not a seeded role — see `ROLE_NAMES.TENANT_ADMIN` and `ROLE_LEVELS.TENANT_ADMIN = 8` in `backend/src/constants/roleConstants.js`. `rbac()` compares role levels, so the seeded level-8 roles (`HEALTHCARE ADMIN`, `CALIBRATOR ADMIN`) pass and `SUPERADMIN` bypasses.

**`GET /object` is deliberately outside that gate.** It is the public resolution point for local/NFS signed URLs; its authorization is the HMAC token and the tenant segment of the key. `backend/src/tests/routes/routeGuards.a02.test.js` asserts this explicitly — the case is `"does not gate GET /object as a settings route"`.

**`GET /usage` is tenant-admin gated** (`storage.route.js`: `router.get("/usage", ...storageAdmin, …)`), the same gate as the four settings routes — it reports the tenant's stored bytes and object count. This document said `auth` only until 2026-09-24 (S-24); the code was stricter than the document. The A-02 suite pins it: `"leaves no route but /object on auth alone"` in `backend/src/tests/routes/routeGuards.a02.test.js` enumerates the storage router's stack and fails on any route without a role gate other than `GET /object`, so a newly added ungated storage route fails the suite.

### What a tenant may configure

`storage.validator.js` accepts `provider: "s3" | "nfs"` — **`local` is refused.** Letting a tenant point the local driver at a server path is an arbitrary filesystem read/write primitive. `config.service.validateTenantConfig()` refuses it a second time, in the service, with a 400.

Fields are mutually exclusive by provider (`Joi.forbidden()` on the other side), so an `s3` body carrying `root` is a 400 rather than a silently ignored field.

| `provider: "s3"` | |
|---|---|
| `bucket` | required |
| `region` | optional, defaults `us-east-1` |
| `endpoint` | optional URI |
| `forcePathStyle` | optional boolean, defaults true |
| `prefix` | optional |
| `accessKeyId` / `secretAccessKey` | optional |

| `provider: "nfs"` | |
|---|---|
| `root` | required |
| `fsync` | optional boolean, defaults true |

### A tenant endpoint is SSRF-checked; the operator's is not

`S3Driver` calls `assertSafeUrl(config.endpoint)` from `utils/ssrf.util.js` **unless** `config.endpointTrusted` is set. Only `getGlobalConfig()` sets that flag, and only for `STORAGE_S3_ENDPOINT` from the environment: an operator is legitimately allowed to name `http://minio:9000`, and a tenant is not.

`validateTenantConfig()` never returns `endpointTrusted`, which is what keeps the tenant path checked on both the write and the read. **Any refactor that unifies the two configuration shapes must preserve that asymmetry.**

### Save is health-checked, and the probe is not cached

`storageSettings.updateSettings()`:

1. `validateTenantConfig(input)` — shape only, no I/O.
2. `storage.buildProbeDriver({ ...validated, accessKeyId, secretAccessKey })` — a throwaway driver built from the **candidate** config, never from the cache and never entering it.
3. `probe.healthCheck()`. A failure is **422** — `Storage connection test failed: <reason>` — and nothing is persisted.
4. `setTenantConfig()`, then `storage.invalidate(tenantId)`.

Saving a configuration that does not work would leave the tenant unable to upload and unable to see why, so the probe is not optional.

`POST /settings/test` is a different operation: it health-checks the tenant's **active** storage, not a body. It takes no request body and therefore cannot be used to make the server connect to a caller-supplied address.

### Credentials never come back out

`storageSettings.publicView()` returns `provider`, `usingPlatformDefault`, `hasCredentials` (a boolean) and the non-secret provider fields. There is no code path that returns `accessKeyId` or `secretAccessKey` to a client.

With no override, `GET /settings` answers `{ provider: "default", usingPlatformDefault: true }` — the platform's own bucket name is not disclosed either.

## Credentials at Rest

Two rows in `tenant_settings`, both under the tenant's id:

| Key | Contents | Encrypted |
|---|---|---|
| `storage_config` | the validated, **secret-free** configuration as JSON | no |
| `storage_credentials` | `{ accessKeyId, secretAccessKey }` as JSON | **yes** |

Encryption is envelope encryption via `services/kms.service.js`, driven by **`KMS_MASTER_KEY`** (64 hex characters / 32 bytes; required in production). `storage_credentials` is in the `SENSITIVE_KEYS` list in `backend/src/models/tenantSettings.model.js`; a `beforeSave` hook encrypts, an `afterFind` hook decrypts, and the ciphertext is recognised by its `v1:` prefix so a re-save cannot double-encrypt.

> **Trap.** `setTenantConfig()` writes `storage_config` with `TenantSettings.upsert()` but writes `storage_credentials` with `findOrBuild()` + `row.save()`. That is not stylistic. **`upsert()` bypasses the `beforeSave` hook**, so an upserted credential row would land in the database in plaintext. If you touch this function, keep the credentials write on the instance path.

`clearTenantConfig()` destroys both rows, so reverting to the platform default also disposes of the stored secret.

## The Migration Tool

`services/storageMigration.service.js`, driven by `src/scripts/migrateStorage.js`.

```bash
node src/scripts/migrateStorage.js --dry-run        # report only
node src/scripts/migrateStorage.js                  # everything
node src/scripts/migrateStorage.js --tenant <id>    # one tenant
node src/scripts/migrateStorage.js --limit 100      # a bounded batch
```

It copies a legacy on-disk attachment — `<storage root>/<attachment.folder>/<attachment.fileName>` — into the configured backend at `t/<tenantId>/attachments/<fileName>`, verifies it, and backfills `attachment.storageKey` (column `storage_key`, added nullable by migration `0016-add-attachment-storage-key.js`).

| Property | How |
|---|---|
| Resumable | a row that already has a `storageKey` returns `skipped` |
| Verified | the SHA-256 of the object **read back from storage** must equal `attachment.checksum` — or, for a row with no checksum, the source file's own hash taken before the copy — or the partial copy is deleted and the row fails. A source that no longer matches its recorded checksum is refused **before** copying |
| Non-destructive | the legacy file is left in place; reclaiming disk is a separate, deliberate step |
| Dry-run | `--dry-run` reports `would-migrate` and writes nothing |
| Batch-safe | one failing row is recorded as `failed` and the run continues |

Per-row outcomes are `migrated`, `skipped`, `missing-source`, `would-migrate` and `failed`; the summary counts each and the CLI exits `1` if anything failed.

Two things to know before running it:

- **It runs cross-tenant by design.** There is no AsyncLocalStorage context in a CLI process, so `resolveScope()` returns `skip` and the global tenant hooks add no predicate — `Attachment.findAll({ where: { storageKey: null } })` really does see every tenant. `--tenant` is the only thing that narrows it. The per-row copy is still tenant-correct, because `getTenantStorage(attachment.tenantId)` binds the key to the row's own tenant.
- **A checksum-less row is verified against its source file (A-40, fixed 2026-09-24).** It used to be copied unverified and reported `migrated`, `verified: false`. Every `migrated` row is now `verified: true`, with `verifiedAgainst: "recorded-checksum"` or `"source-file"` — the latter proves the copy matches the file as it is on disk now, not that the file is what was uploaded.

`attachment.save({ hooks: false })` skips the model hooks when writing the key back, which also means it does not re-stamp or re-check the tenant. The key was built from the row's own `tenantId`, so it is consistent — but it is a hook bypass, and it is here because the tool runs outside a request.

**Migrating a row today does not change how it is served**, because the read path still uses `folder`/`fileName`. The migration is preparation for a cutover that has not happened.

## `storagePath.util.js` Is Not Part of This Module

It is a one-line filesystem-root helper and it predates the pluggable layer:

```js
const storageRoot = isPackaged
  ? process.env.APP_STORAGE_PATH || path.join(path.dirname(process.execPath), "storage")
  : path.resolve(__dirname, "../../");
module.exports = (...paths) => path.join(storageRoot, ...paths);
```

Unpackaged, the root is the `backend/` directory. Packaged (a Bun single-file binary — `utils/packaged.util.js`), `__dirname` is meaningless, so the root moves next to the executable or to `APP_STORAGE_PATH`.

It resolves **filesystem** paths, not storage **keys**. It is used by the legacy attachment path, by `backend/index.js` for the `.well-known` and `uploads/public` static mounts, by `getGlobalConfig()` for the `local` provider's default root, and by the migration tool to find the source file. It has no knowledge of tenants and performs no isolation check — the traversal guard in `storageMigration.legacyPath()` and in `attachment.service.resolveAbsPath()` is written at each call site, which is why both of them re-derive the root and compare prefixes.

## Traps

| Trap | What happens |
|---|---|
| Using `TenantSettings.upsert()` for `storage_credentials` | the `beforeSave` encryption hook is skipped and the secret is stored **in plaintext** |
| Passing a tenant config through to `S3Driver` with `endpointTrusted` | the SSRF guard is skipped on an attacker-chosen endpoint |
| Building a key by string concatenation | it still passes `assertKeyForTenant`, or it throws — but a key built outside `buildKey()` can miss the domain allowlist |
| Calling `getTenantStorage()` with no tenant | 500, not a fallback to global. Use `getGlobalStorage()` |
| Expecting a settings change to apply across replicas when Redis is down | the generation cannot be shared; other replicas converge within `STORAGE_DRIVER_CACHE_TTL_SEC` (default 60s) |
| Reading `verifiedAgainst: "source-file"` as proof of the original upload | it proves the copy matches today's file, which had no recorded checksum to compare with |
| Treating `attachment.storageKey` as the serving path | nothing in the request path reads it yet |

## Tests

Named, because an unnamed claim is not evidence.

| Suite | Covers |
|---|---|
| `backend/src/tests/services/storage.keys.test.js` | construction, normalization, the tenant guard, scope prefixes |
| `backend/src/tests/services/storage.index.test.js` | façade, driver resolution and cache, `openSignedObject` |
| `backend/src/tests/services/storage.config.test.js` | global and tenant configuration, provider validation |
| `backend/src/tests/services/storage.local.test.js` · `storage.s3.test.js` | the two drivers |
| `backend/src/tests/services/storage.signing.test.js` | HMAC mint/verify, expiry, wrong-length tokens |
| `backend/src/tests/services/storageSettings.service.test.js` | `getSettings` · `updateSettings` · `clearSettings` · `testConnection` · `getUsage` |
| `backend/src/tests/services/storageMigration.service.test.js` | `migrateAttachment` · `legacyPath` · `hashStream` · `migrateAll` |
| `backend/src/tests/controllers/storage.controller.test.js` | the six handlers |
| `backend/src/tests/routes/routeGuards.a02.test.js` | the four settings routes carry `auth`, `denyApiKey` and a `TENANT_ADMIN` gate; `/object` does not |

These are unit suites against mocks. Per `../../CLAUDE.md` § Evidence, **a mock proves the client, not the contract** — the S3 path has been exercised live against MinIO only for the checksum-trailer behaviour noted in `s3.driver.js`, and a full live bring-your-own-bucket run is not recorded anywhere in this repository.

## Related

- [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) § `/api/v1/storage` — the endpoint list in API terms. **Two claims there disagree with the code**: it says credentials are encrypted with `ENCRYPT_KEY` (the code uses `KMS_MASTER_KEY`), and it lists six endpoints without stating the 2026-09-23 role gate. The code wins; those lines need the deviation protocol.
- [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) — the deny-by-default rule that `keys.js` mirrors for object storage.
- [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-02 — the authorization defect this module carried until 2026-09-23.
