# 11 — Document and Asset Management

Modules: `HDC-ATT` (21), `HDC-STORAGE` (33), `HDC-CMS` (20).

---

## Attachments

`attachments` is polymorphic: any resource can carry files.

| Column | Purpose |
|---|---|
| `resourceType`, `resourceId` | what this is attached to — indexed as a pair |
| `fileName` | the stored name |
| `originalName` | what the uploader called it |
| `folder` | logical grouping |
| `storageKey` | the object key in whichever backend holds it (migration `0016`) |
| `mimeType`, `size` | `BIGINT` size, because medical imaging and scanned certificate archives exceed 2 GB |
| `checksum` | integrity, and duplicate detection |
| `uploadedBy` | attribution |

Keeping `originalName` alongside `fileName` matters: the stored name is sanitised and made collision-safe, and the original is what the user recognises in a list.

`storageKey` rather than a path is what allows the same row to be served from local disk, S3 or NFS without rewriting anything (BR-14).

### Signed URLs

Attachments are never served from a guessable path. Download URLs are HMAC-signed with `ATTACHMENT_URL_SECRET` and time-limited.

A tenant-scoped row served from a predictable URL is an IDOR waiting to be found; signing makes the URL itself the capability, and expiry bounds the damage if one leaks.

### Virus scanning

| Variable | Effect |
|---|---|
| `VIRUS_SCAN_PROVIDER` | `none` (default) leaves uploads unscanned; `clamav` enforces |
| `CLAMAV_HOST`, `CLAMAV_PORT` | the clamd TCP socket, `clamav:3310` in compose |
| `VIRUS_SCAN_FAIL_OPEN` | **default `false`** — a scanner error rejects the upload |

Fail-closed is the right default and the inconvenient one: when ClamAV is down, uploads stop. The alternative is that a scanner outage silently turns scanning off, which is the failure mode where a malicious file gets through and the logs show a clean upload.

ClamAV first boot downloads the signature database, which takes minutes. The compose health check allows a 120-second start period, and the backend depends on it with `service_started` rather than `service_healthy` — waiting for healthy would block the whole stack on an optional component.

### Static serving hardening

`/uploads` is served with two headers on every response:

```
X-Content-Type-Options: nosniff
Content-Disposition: inline
```

Defence in depth for user-uploaded content: never let the browser sniff an upload into active content.

## Pluggable Object Storage

`backend/src/services/storage/`. Three drivers, selectable globally and overridable per tenant.

| Driver | Configuration | Notes |
|---|---|---|
| `local` | `STORAGE_LOCAL_ROOT`, defaults to `<app storage>/storage` | the app server disk |
| `s3` | `STORAGE_S3_BUCKET`, `_REGION`, `_ENDPOINT`, `_FORCE_PATH_STYLE`, `_PREFIX`, and optional key pair | AWS S3, MinIO, Cloudflare R2, Wasabi, DigitalOcean Spaces |
| `nfs` | `STORAGE_NFS_ROOT`, `STORAGE_NFS_FSYNC` | a mount |

Points worth knowing:

- **Leave the S3 key pair unset where possible.** Unset means the ambient credential chain (IAM role) is used, which is preferred over static keys in the environment.
- **`STORAGE_NFS_FSYNC` defaults to `true`.** An NFS client can acknowledge a write that is still only in its own page cache. For attachment data that is a silent-loss window, and the fsync cost is worth paying.
- **`STORAGE_S3_FORCE_PATH_STYLE` defaults to `true`**, because MinIO and most non-AWS providers require it.
- **`STORAGE_S3_PREFIX`** lets one bucket serve several environments. It is a convenience, not an isolation boundary.

### Per-tenant storage

A tenant may register its own bucket, which moves that tenant storage cost and capacity off the platform. Credentials are encrypted at rest.

Tenant-supplied endpoints are **SSRF-checked**; operator-configured endpoints are not, because they are allowed to be internal (`http://minio:9000`). That asymmetry is the whole point: the operator is trusted to name an internal host, a tenant is not.

### Migration between backends

`npm run migrate:storage` (`src/scripts/migrateStorage.js`) moves objects between drivers, for a tenant adopting its own bucket or a platform moving from local to S3.

## Content Management

`HDC-CMS`, route `/content`, table `posts`.

| Column | Notes |
|---|---|
| `type` | `BLOG` or `NEWS` |
| `status` | `DRAFT`, `PUBLISHED`, `ARCHIVED` |
| `slug` | indexed, the public URL segment |
| `contentHtml` | rendered body from the TipTap editor |
| `authorName`, `authorRole`, `authorAvatarUrl` | denormalised author display |
| `readingMinutes`, `featured` | presentation |
| `publishedAt` | indexed for ordering |

Categorised through `post_categories` against a global `categories` table.

**`posts` is not tenant-scoped**, and that is deliberate: blog and news content is platform marketing served on the public site, not tenant data.

Author fields are denormalised rather than joined to `users` because a published article should keep its byline after the author account is deactivated or anonymised.

Authoring is at `/dashboard/content`; the public surface is `/blog` and `/news`. See [`../UI-UX/14-PUBLIC-SURFACES-UX.md`](../UI-UX/14-PUBLIC-SURFACES-UX.md).

## Documents That Are Not Attachments

Two document kinds are modelled in their own right rather than as attachments, because they have lifecycles:

| Kind | Table | Why not an attachment |
|---|---|---|
| SOPs | `sop_documents` | versioned, published, and may require per-user training acknowledgement (`sop_training_acknowledgments`) |
| Signature workflows | `signature_workflows` | multi-party, ordered, with per-step signer state |

An attachment is a file hanging off a record. These are records in their own right that happen to have a file.
