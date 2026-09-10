# 06 — File Upload Security

Modules `HDC-ATT` (21), `HDC-STORAGE` (33).

An upload is attacker-controlled content that the platform stores, may scan, and later serves back to a browser. Every one of those three steps is a control point.

---

## Ingest

| Control | Where |
|---|---|
| Body limit 10 MB | `express.json` / `urlencoded` |
| Quota checked **before** the write | `enforceQuota.middleware.js`, `tenants.limitStorageMb` |
| Filename sanitised | stored as `fileName`; the original kept separately as `originalName` |
| MIME type recorded | `attachments.mimeType` — **recorded, not trusted** |
| Checksum computed | `attachments.checksum` |
| Attribution | `attachments.uploadedBy` |
| Virus scan | ClamAV when configured |

Quota is enforced ahead of the handler (BR-15) so a rejected upload never leaves a partial object behind.

### The declared MIME type is a claim

`mimeType` comes from the client. It is stored for display and content negotiation, never as a security decision. A file declaring `image/png` may be anything.

Content-based type detection is the correct check where type matters. Where it is not performed, the compensating controls are the scanner and the serving headers below.

## Virus Scanning

| Variable | Effect |
|---|---|
| `VIRUS_SCAN_PROVIDER` | `none` (default) leaves uploads unscanned; `clamav` enforces |
| `CLAMAV_HOST`, `CLAMAV_PORT` | the clamd TCP socket — `clamav:3310` in compose |
| `CLAMAV_ENABLED` | | 
| `VIRUS_SCAN_FAIL_OPEN` | **default `false`** |

### Fail-closed is the default and it is inconvenient

A scanner error **rejects the upload**. When ClamAV is down, uploads stop.

The alternative — fail open — means a scanner outage silently turns scanning off, and the failure mode is a malicious file getting through while the logs show a clean upload. An outage you notice is better than a control that disables itself.

`VIRUS_SCAN_FAIL_OPEN=true` exists and should be a deliberate, recorded decision, not a reaction to an incident.

### Operational note

ClamAV first boot downloads its signature database, which takes minutes. Compose allows a 120-second health-check start period and the backend depends on it with `service_started` rather than `service_healthy` — waiting for healthy would block the whole stack on an optional component at every cold start.

## Storage

Objects are addressed by `attachments.storageKey` (migration `0016`), not by a filesystem path. That is what lets the same row be served from local disk, S3 or NFS.

### Key construction is a tenant-isolation control

**The storage key encodes tenant identity.** An attacker who can influence key construction can read across tenants — which makes key building a security function, not a formatting concern.

It belongs in the storage service and nowhere else. No call site should be able to name an object directly.

### Driver-specific notes

| Driver | Note |
|---|---|
| `local` | incompatible with more than one backend replica — replica A writes, replica B cannot serve |
| `s3` | leave the key pair unset where possible and use the ambient credential chain (IAM role) |
| `nfs` | `STORAGE_NFS_FSYNC` defaults to `true` — an NFS client can acknowledge a write still only in its own page cache |

`STORAGE_S3_PREFIX` is a convenience for sharing one bucket across environments. **It is not an isolation boundary**; anything with bucket access reads across prefixes.

### The SSRF asymmetry

| Endpoint source | SSRF-checked |
|---|---|
| Operator (`STORAGE_S3_ENDPOINT`) | **no** |
| Tenant-supplied | **yes** |

Deliberate. The operator is allowed to name an internal host — `http://minio:9000` is the normal compose configuration. A tenant is not: a tenant-supplied endpoint pointing at `http://169.254.169.254/` or an internal service is a server-side request forgery made from the platform's network position.

Any refactor that unifies these paths must keep the tenant side checked.

Tenant storage credentials are encrypted at rest with `ENCRYPT_KEY` and must never be returned by `GET /storage/settings`.

## Serving

### Signed URLs

Downloads go through HMAC-signed, time-limited URLs (`ATTACHMENT_URL_SECRET`).

A tenant-scoped object served from a predictable path is an IDOR waiting to be found. Signing makes the **URL itself the capability**, and expiry bounds the damage when one leaks into a chat log, a browser history or a support ticket.

Client helper: `frontend/src/lib/uploadUrl.ts`.

### Static serving headers

`/uploads` is served with two headers on every response:

```
X-Content-Type-Options: nosniff
Content-Disposition: inline
```

Defence in depth for user-uploaded content: never let the browser sniff an upload into active content, and never let it be treated as a document with its own origin privileges.

`crossOriginResourcePolicy` is set to `cross-origin` in helmet so the separate-origin frontend can load `/uploads` images. That is a deliberate relaxation and the reason the two headers above are not optional.

## The Other Upload Surface: `posts.contentHtml`

Not an attachment, but the same class of problem and the more dangerous one.

`contentHtml` is user-supplied HTML from the TipTap editor, rendered into a **public** page. It is the stored-XSS surface of this system.

Two controls, both required:

1. **Sanitise on ingest.** Sanitising on render alone means the payload is in the database, waiting for any other consumer that renders it differently.
2. **Render under a CSP that does not permit inline script.** The current policy allows `'unsafe-inline'` for scripts because the bundled swagger-ui injects inline assets — which weakens this defence on the API origin. The public content pages are served by Next.js, which is a different origin and should carry a stricter policy.

That gap is worth stating: the API's CSP is relaxed for swagger, and the reasoning does not transfer to the pages that render user HTML.

## Retention and Erasure

Attachments are `paranoid`. A soft-deleted attachment row still has an object behind it, and a GDPR erasure that clears the row without removing the object has not erased anything.

The same applies to `signature_records.polygon` and `biometricData` — personal data that lives in a JSON column and is easy to forget in an erasure path.

## Checklist for a New Upload Endpoint

- [ ] quota checked before the write
- [ ] filename sanitised, original preserved separately
- [ ] declared MIME type recorded, not trusted
- [ ] checksum computed
- [ ] scanned when a scanner is configured, failing closed on scanner error
- [ ] key built by the storage service, never by the call site
- [ ] download only through a signed, time-limited URL
- [ ] `nosniff` and `Content-Disposition` on any static path
- [ ] erasure path removes the object, not only the row
- [ ] two-tenant test: tenant B cannot fetch tenant A's object, and gets 404
