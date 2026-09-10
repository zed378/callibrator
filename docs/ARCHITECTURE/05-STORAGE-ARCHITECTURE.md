# 05 — Storage Architecture

Module `HDC-STORAGE` (33). Implementation: `backend/src/services/storage/`.

---

## Three Drivers Behind One Port

```
                    application code
                          │
                          ▼
                  storage service (port)
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
    ┌───────┐        ┌────────┐        ┌───────┐
    │ local │        │   s3   │        │  nfs  │
    │ disk  │        │ S3-API │        │ mount │
    └───────┘        └────────┘        └───────┘
```

`STORAGE_DRIVER` selects the platform default. A tenant may override it with its own bucket, which moves that tenant storage cost and capacity off the platform (BR-14).

Resolution order for any object operation:

```
tenant storage configuration  →  platform STORAGE_DRIVER  →  local
```

## Driver Configuration

### local

| Variable | Default |
|---|---|
| `STORAGE_LOCAL_ROOT` | `<app storage>/storage` |

The app server disk. Fine for single-host deployments; unusable the moment there is more than one backend replica, because two replicas do not share a disk. This is the constraint that forces `s3` or `nfs` before horizontal scaling.

### s3

Works with AWS S3, MinIO, Cloudflare R2, Wasabi and DigitalOcean Spaces.

| Variable | Notes |
|---|---|
| `STORAGE_S3_BUCKET` | required |
| `STORAGE_S3_REGION` | required |
| `STORAGE_S3_ENDPOINT` | custom endpoint for non-AWS providers |
| `STORAGE_S3_FORCE_PATH_STYLE` | **default `true`** — MinIO and most non-AWS providers require it |
| `STORAGE_S3_PREFIX` | optional prefix, for sharing one bucket across environments |
| `STORAGE_S3_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | **leave unset where possible** |

Leaving the key pair unset uses the ambient credential chain — an IAM role — which is strictly better than static keys sitting in an environment file. Set them only where no ambient identity exists.

`STORAGE_S3_PREFIX` is a convenience for sharing a bucket across environments. It is **not an isolation boundary**; anything with bucket access can read across prefixes.

### nfs

| Variable | Default |
|---|---|
| `STORAGE_NFS_ROOT` | — |
| `STORAGE_NFS_FSYNC` | **`true`** |

`fsync` after every write, on by default. An NFS client can acknowledge a write that is still only in its own page cache; for attachment data that is a silent-loss window between "the API said saved" and "the bytes exist". The fsync cost is worth paying, and turning it off is a decision to accept that window.

## Per-Tenant Storage

A tenant registers its own bucket at `/dashboard/storage`. Credentials are encrypted at rest with KMS-style wrapping keyed by `ENCRYPT_KEY`.

### The SSRF asymmetry

| Endpoint source | SSRF-checked? |
|---|---|
| Operator (`STORAGE_S3_ENDPOINT`) | **no** |
| Tenant-supplied | **yes** |

This looks inconsistent and is exactly right. The operator is allowed to name an internal host — `http://minio:9000` is the normal compose configuration. A tenant is not: a tenant-supplied endpoint pointing at `http://169.254.169.254/` or an internal service is a server-side request forgery, and the platform would make the request with its own network position.

Any change that unifies the two paths must keep the tenant side checked.

## Storage Keys, Not Paths

`attachments.storageKey` (migration `0016`) holds an opaque object key rather than a filesystem path. That is what lets the same row be served from local disk, S3 or NFS without rewriting anything, and what makes migration between drivers a data operation rather than a code change.

The key encodes tenant identity. That makes key construction a **tenant isolation control**, not a formatting concern: an attacker who can influence key construction can read across tenants. Key building belongs in the storage service and nowhere else.

## Signed Download URLs

Attachments are never served from a guessable path. Download URLs are HMAC-signed with `ATTACHMENT_URL_SECRET` and time-limited (`frontend/src/lib/uploadUrl.ts` on the client side).

The URL is the capability; expiry bounds the damage when one leaks into a chat log or a browser history.

## Static Serving

Three static mounts in `backend/index.js`, each for a different reason:

| Mount | Source | Notes |
|---|---|---|
| `/.well-known` | `storagePath(".well-known")` | ACME HTTP-01 challenges, written at runtime |
| `/uploads` | `storagePath("uploads")` | `X-Content-Type-Options: nosniff` and `Content-Disposition: inline` on every response |
| `/public` | `appPath("public")` | packaged static assets |

`storagePath()` versus `appPath()` matters in a compiled binary:

- `appPath()` resolves relative to the executable — packaged, read-only assets.
- `storagePath()` resolves to the writable storage root (`APP_STORAGE_PATH`).

ACME challenge files are written at runtime and **must** come from `storagePath()`. A CWD-relative path shifts with the launch directory, and the resulting challenge failures look like DNS problems, which sends the investigation in the wrong direction entirely.

## Migration Between Drivers

```bash
npm run migrate:storage      # src/scripts/migrateStorage.js
```

Moves objects between drivers — a tenant adopting its own bucket, or a platform moving from local disk to S3.

## Virus Scanning

Covered in [`../PLAN/11-DOCUMENT-AND-ASSET-MANAGEMENT.md`](../PLAN/11-DOCUMENT-AND-ASSET-MANAGEMENT.md). The essential point: `VIRUS_SCAN_FAIL_OPEN` defaults to **false**, so a scanner error rejects the upload. Fail-closed is inconvenient when ClamAV is down and correct anyway — the alternative silently disables scanning at exactly the moment it is not working.

## Capacity

`tenants.limitStorageMb` is enforced by `enforceQuota.middleware.js` **before** the write (BR-15), so a rejected upload never leaves a partial object behind.

A tenant on its own bucket is spending its own capacity; whether the platform limit still applies to it is a product decision, and the current behaviour is that it does.

## Scaling Constraint, Stated Plainly

`local` storage and more than one backend replica are incompatible. Replica A writes an attachment, replica B serves the download, and the object is not there.

Horizontal scaling requires `s3` or `nfs` first. This is the single hard prerequisite for the Kubernetes path in [`08-DEPLOYMENT-ARCHITECTURE.md`](./08-DEPLOYMENT-ARCHITECTURE.md).
