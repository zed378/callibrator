# 06 — File Processing

Modules `HDC-ATT` (21) and `HDC-STORAGE` (33). Security treatment: [`../SECURITY/06-FILE-UPLOAD-SECURITY.md`](../SECURITY/06-FILE-UPLOAD-SECURITY.md).

---

## Upload Path

```
multipart request
  → body limit 10 MB
  → enforceQuota          BEFORE the write (BR-15)
  → createFolder          prepare the target directory
  → sanitise filename     stored as fileName; original kept as originalName
  → compute checksum
  → virus scan            when configured; scanner ERROR rejects by default
  → storage service       builds the key, writes the object
  → attachments row       tenantId, resourceType, resourceId, storageKey, checksum, size, uploadedBy
  → audit_logs
```

Quota is checked ahead of the handler so a rejected upload never leaves a partial object behind.

## Two Names Per File

| Column | Holds |
|---|---|
| `fileName` | the sanitised, collision-safe stored name |
| `originalName` | what the uploader called it |

The user recognises the second in a list; the first is what is safe to put on a filesystem. Storing only one loses either safety or recognisability.

## The Declared MIME Type Is a Claim

`attachments.mimeType` comes from the client. It is stored for display and content negotiation, **never as a security decision**.

A file declaring `image/png` may be anything. Where type genuinely matters, detect it from content. Where that is not done, the compensating controls are the scanner and the serving headers.

## `size` Is `BIGINT`

Scanned certificate archives and medical imaging exceed 2 GB. An `INTEGER` size column silently wraps.

## Storage Keys, Not Paths

`attachments.storageKey` (migration `0016`) holds an opaque object key rather than a filesystem path. That is what lets the same row be served from local disk, S3 or NFS.

### Key construction is a tenant-isolation control

**The key encodes tenant identity.** An attacker who can influence key construction can read across tenants.

Key building belongs in the storage service and nowhere else. No call site should be able to name an object directly — that is a security property, not a code-organisation preference.

## The Storage Service

`backend/src/services/storage/`. Three drivers behind one port, selected by `STORAGE_DRIVER`, overridable per tenant.

| Driver | Notes |
|---|---|
| `local` | `STORAGE_LOCAL_ROOT`; **incompatible with more than one backend replica** |
| `s3` | AWS, MinIO, R2, Wasabi, Spaces; `FORCE_PATH_STYLE` defaults `true` |
| `nfs` | `STORAGE_NFS_FSYNC` defaults `true` |

Resolution: **tenant configuration → platform `STORAGE_DRIVER` → local**.

Three details that are not incidental:

- **Leave the S3 key pair unset where possible** — the ambient credential chain (IAM role) beats static keys in an environment file.
- **`STORAGE_NFS_FSYNC` defaults to true** because an NFS client can acknowledge a write still only in its own page cache. For attachment data that is a silent-loss window.
- **`STORAGE_S3_PREFIX` is not an isolation boundary.** It shares one bucket across environments; anything with bucket access reads across prefixes.

### The SSRF asymmetry

| Endpoint source | SSRF-checked |
|---|---|
| Operator (`STORAGE_S3_ENDPOINT`) | **no** |
| Tenant-supplied | **yes** |

Deliberate. The operator is allowed to name an internal host — `http://minio:9000` is the normal compose configuration. A tenant is not.

Any refactor unifying the two paths must keep the tenant side checked.

Tenant credentials are encrypted at rest with `ENCRYPT_KEY` and never returned by any endpoint.

## `appPath()` versus `storagePath()`

The distinction that matters in a compiled binary:

| Helper | Resolves to | For |
|---|---|---|
| `appPath()` | relative to the executable | packaged, read-only assets |
| `storagePath()` | the writable root (`APP_STORAGE_PATH`) | anything written at runtime |

**ACME HTTP-01 challenge files must come from `storagePath()`.** A CWD-relative path shifts with the launch directory, and the resulting challenge failures look like DNS problems — which sends the investigation in entirely the wrong direction.

## Static Serving

| Mount | Source | Headers |
|---|---|---|
| `/.well-known` | `storagePath(".well-known")` | ACME challenges, written at runtime |
| `/uploads` | `storagePath("uploads")` | `X-Content-Type-Options: nosniff`, `Content-Disposition: inline` |
| `/public` | `appPath("public")` | packaged assets |

The two headers on `/uploads` are defence in depth: never let the browser sniff an upload into active content.

`crossOriginResourcePolicy` is `cross-origin` in helmet so the separate-origin frontend can load these images — which is exactly why the headers are not optional.

## Signed Download URLs

HMAC-signed with `ATTACHMENT_URL_SECRET`, time-limited.

The **URL is the capability**; expiry bounds the damage when one leaks into a chat log, a browser history or a support ticket. A predictable path would be an IDOR waiting to be found.

## Virus Scanning

| Variable | Effect |
|---|---|
| `VIRUS_SCAN_PROVIDER` | `none` (default) unscanned; `clamav` enforces |
| `CLAMAV_HOST`, `CLAMAV_PORT` | clamd TCP socket — `clamav:3310` in compose |
| `VIRUS_SCAN_FAIL_OPEN` | **default `false`** |

**Fail-closed is the default and it is inconvenient**: when ClamAV is down, uploads stop.

The alternative silently turns scanning off at exactly the moment it is not working, and the failure mode is a malicious file passing while the logs show a clean upload. An outage you notice beats a control that disables itself.

ClamAV first boot downloads its signature database, taking minutes — hence the 120-second health-check start period and `service_started` rather than `service_healthy` in compose.

## Certificate PDF Rendering

puppeteer, from templates in `backend/src/templates`.

**In a compiled binary the bundled Chromium is unavailable.** `PUPPETEER_EXECUTABLE_PATH` must point at a system browser.

The Docker runtime image installs `chromium` and `fonts-liberation` and sets it. **Outside Docker it fails at first use, not at startup** — a late failure in a compliance-critical path, which the API must surface as a clear error rather than a silent missing download.

## Templates Ship With the Binary

`src/templates` is read from disk **next to the executable** via `appPath()`, not from the embedded snapshot. The Dockerfile copies it explicitly, alongside `swagger.json` and `docs/`.

Omitting that copy produces an API that starts fine and then fails on the first PDF or the first email — a failure far from its cause.

## Bulk Import

`POST /calibration-devices/bulk-import` creates a **batch job**, not a synchronous import.

A 5,000-row hospital inventory exceeds the 30-second request timeout, and an import that dies halfway is worse than one that takes five minutes and reports when it is done.

## Migration Between Drivers

```bash
npm run migrate:storage     # src/scripts/migrateStorage.js
```

For a tenant adopting its own bucket, or a platform moving from local disk to S3.

## The Scaling Constraint

**`local` storage and more than one backend replica are incompatible.** Replica A writes an attachment, replica B serves the download, and the object is not there.

This is the first of the three hard prerequisites for horizontal scaling ([`../ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`](../ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md)).
