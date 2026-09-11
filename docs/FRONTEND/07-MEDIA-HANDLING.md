# 07 — Media Handling

Uploads, downloads, images and the certificate PDF.

Backend treatment: [`../SECURITY/06-FILE-UPLOAD-SECURITY.md`](../SECURITY/06-FILE-UPLOAD-SECURITY.md).

---

## Upload

Multipart. **Leave the content type to the browser** so the multipart boundary is correct — setting it by hand is a common way to produce a request the server cannot parse.

```
select file
  → client-side size and type check      ← convenience, not a control
  → POST /api/v1/attachments (multipart)
  → progress
  → done, or a specific failure
```

### Failures worth distinguishing

| Failure | Message |
|---|---|
| Too large | names the limit — 10 MB |
| Quota exceeded | says the tenant storage limit is reached, not "upload failed" |
| **Scanner unavailable** | says the file could not be scanned and was rejected |
| Rate limited | says to wait |

The scanner case matters. `VIRUS_SCAN_FAIL_OPEN` defaults to `false`, so when ClamAV is down **uploads stop**. A user who is told "upload failed" will retry forever; a user told "the file could not be scanned" knows to raise it.

Client-side size and type checks are a **convenience**. The server enforces, and the declared MIME type is never trusted as a security decision.

## Download

**Never a direct path.** Downloads go through HMAC-signed, time-limited URLs.

```
POST /api/v1/attachments/:id/signed-url   → a signed, expiring URL
```

Built client-side by `frontend/src/lib/uploadUrl.ts`.

The URL **is** the capability, and expiry bounds the damage when one leaks into a chat log, a browser history or a support ticket. A predictable path would be an IDOR waiting to be found.

A signed URL that has expired must produce a clear message and a way to mint a fresh one — not a raw 403.

## Images

| Rule | |
|---|---|
| `next/image` for anything with known dimensions | |
| Alt text always; `alt=""` for decorative | |
| No layout shift — dimensions or an aspect ratio, always | |
| Avatars and logos have a fallback | a broken logo on a branded login page looks like a broken deployment |

Uploaded images are served from `/uploads` with `X-Content-Type-Options: nosniff` and `Content-Disposition: inline` set by the backend.

`crossOriginResourcePolicy` is `cross-origin` on the API so the separate-origin frontend can load them — which is precisely why those two headers are not optional.

### The default avatar, and why it is a frontend asset

`users.avatar_url` and `tenants.logo` store the sentinel **`default.svg`** when nothing has been uploaded. **That is a marker, not a file.** Building a URL from it produced `/uploads/profile/default.svg`, which 404s — so every seeded user rendered a broken image.

There is a `default.svg` in `backend/uploads/profile/`, and it still does not help:

| Check | Result |
|---|---|
| `git ls-files backend/uploads/` | **nothing** — `backend/.gitignore` has `/uploads/` |
| the directory on a deployed host | **does not exist** |
| `/app/uploads/profile/` in the container | **empty** — the compose bind mount shadows whatever the image holds |

So the backend reports "no avatar" as **`null`**, and the placeholder lives at **`frontend/public/default-avatar.svg`**: committed, served same-origin by Next, immune to the volume. A placeholder is a UI concern.

### `next/image` rejects SVG

`next/image` routes every `src` through `/_next/image`, and that endpoint answers **400 for SVG** unless `images.dangerouslyAllowSVG` is set:

```
GET /default-avatar.svg                     ->  200 image/svg+xml
GET /_next/image?url=%2Fdefault-avatar.svg  ->  400
```

An SVG placeholder therefore renders as a broken image — the very thing it was added to fix, and invisible until you load the built app.

The fix is **`unoptimized` on the placeholder only**, centralised in `avatarImageProps()` in `src/lib/uploadUrl.ts`. Setting `dangerouslyAllowSVG: true` globally would also work and is the **wrong trade**: uploaded avatars are user-supplied, an SVG can carry script, and they must keep going through the optimizer.

## Tenant Logo

`tenants.logo`, fetched from the **unauthenticated** `GET /api/v1/tenants/public` for builds pinned with `NEXT_PUBLIC_TENANT_ID`.

Rendered on the login page **before sign-in**, so it must load fast and degrade to the tenant name if it fails. That endpoint exposes branding only.

## Certificate PDF

Two paths, and they are not equivalent.

| Path | Produces |
|---|---|
| `GET /api/v1/certificates/:id/pdf` | **the authoritative artefact** — server-rendered by puppeteer, signed, QR-coded |
| `frontend/src/lib/certificatePdf.ts` | a client-side convenience |

**The server-rendered PDF is the certificate.** It is what an auditor receives, what the QR code corresponds to, and what the HMAC verifies against.

A client-side PDF is a preview or a working copy. It must never be presented as the certificate, because it carries no signature and nothing verifies it.

### Rendering can fail late

Server-side rendering needs a system Chromium (`PUPPETEER_EXECUTABLE_PATH`). In a compiled binary the bundled Chromium is unavailable, and outside Docker the failure happens at **first use, not at startup**.

The UI must surface that as a clear, actionable error. A silently missing download in a compliance-critical path is the worst available outcome — the user assumes it worked.

## QR Codes

Generated with `qrcode`. Encodes `CERT_VERIFY_BASE_URL/<certificateNumber>`.

The QR is on the PDF, not on the screen. It exists to be scanned off paper by someone holding a phone — which is the whole verification journey ([`../UI-UX/12-DEVICE-CALIBRATION-UX.md`](../UI-UX/12-DEVICE-CALIBRATION-UX.md)).

## Rich Text

TipTap 3, for `posts.contentHtml`.

**This is the stored-XSS surface of the system.** The content is authored here and rendered into a **public** page.

Two controls, both required:

1. **Sanitise on ingest**, server-side. Sanitising only on render leaves the payload in the database for any other consumer that renders it differently.
2. **Render under a CSP that does not permit inline script.**

The API origin's CSP allows `'unsafe-inline'` because bundled swagger-ui needs it. **That reasoning does not transfer** to the Next.js origin serving these pages, which should be stricter.

Image uploads from inside the editor go through the same attachment path as everything else — no separate, less-checked route.

## Attachments in Context

Attachments are polymorphic — `(resourceType, resourceId)`. The same component serves devices, calibration records, certificates, work orders and tickets.

Each attachment shows `originalName` (what the uploader called it), not `fileName` (the sanitised stored name). The user recognises the first and not the second.

## Bulk Upload

`POST /api/v1/calibration-devices/bulk-import` returns a **job id, not a result**.

A 5,000-row hospital inventory exceeds the 30-second request timeout. The UI sets that expectation at submit — "we will tell you when it is done" — rather than showing a spinner that ends in a 408.

Progress is polled at `/api/v1/jobs/:id`, showing `processedItems / totalItems`. A percentage alone cannot tell anyone whether 47% is 47 rows or 47,000.
