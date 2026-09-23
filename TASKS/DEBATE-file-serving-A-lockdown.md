# Debate — File serving, Position A: the static mount must go

**Position.** `backend/index.js:339-349` mounts `express.static(storagePath("uploads"))` at `/uploads` with no authentication, no tenant predicate and no token. Every byte this platform stores — calibration certificates, the evidence attached to them, avatars, tenant logos — is reachable by anyone who can guess or be handed a path. That mount must be deleted, and every file must be served through a route that resolves a principal or a capability, applies the tenant boundary, and leaves a record. The capability design the repository already built (`backend/src/services/storage/signing.js`, `GET /api/v1/storage/object`, `GET /api/v1/attachments/:id/signed`) is the correct shape; the static mount is a hole punched straight through it.

**Why now.** Verified on the live deployment 2026-09-23: the uploads directories are empty, and there are **0 certificates and 0 attachments** in the database. The migration cost of this change is, today, zero rows and zero files. It becomes non-zero, and then irreversible, the moment the first hospital issues its first certificate — because the URLs this design hands out are permanent by construction and cannot be recalled from whoever has already stored one.

---

## 1. The threat, concretely

### 1.1 What the mount actually serves

`backend/index.js:339-349` serves the whole of `storagePath("uploads")`. Four writers put files under it:

| Writer | Path on disk | Public URL |
|---|---|---|
| `certificatePdf.service.js:199-205` | `uploads/certificates/<certificateNumber>.pdf` | `/uploads/certificates/<certificateNumber>.pdf` |
| `attachments.route.js:115-120` (multer) | `uploads/attachments/<name>` | `/uploads/attachments/<name>` |
| `tenant.route.js:377-390` and two siblings | `uploads/tenant/<name>` | `/uploads/tenant/<name>` |
| `user.route.js:717-724` | `uploads/profile/<name>` | `/uploads/profile/<name>` |

nginx proxies the whole prefix in both shipped configurations — `deploy/compose/nginx/default.conf:111` and `deploy/compose/nginx/vm-http.conf:78` — so this is the deployed shape, not a dev convenience. `helmet` is configured with `crossOriginResourcePolicy: { policy: "cross-origin" }` (`backend/index.js:142`), so any page on the internet may embed these responses. The only budget on the path is the global `defaultLimiter` (`backend/index.js:248`): **5000 requests per 15 minutes per IP in production**, roughly 480,000 requests a day.

There is no authentication on this path, no `dynamicAccess` gate, no `tenantContextMiddleware`, and therefore no tenant predicate — `utils/tenantScope.util.js:52` returns `skip` when there is no AsyncLocalStorage context, and on a static request there is no context and no query either. `CLAUDE.md` § The Non-Negotiables says every route needs a permission gate and that cross-tenant must be indistinguishable from not-found. This mount is not merely a route without a gate; it is a route without a *tenant concept*.

### 1.2 Certificates: the filename is not unguessable. It is a counter.

`certificate.model.js:183-215` builds the number as `CERT-<YYYYMMDD>-<tenantCode>-<sequence>`, `sequence` starting at `1` and zero-padded to four digits. `certificatePdf.service.js:60-61` turns that straight into the filename, and `:205` into the URL.

So the URL of every certificate PDF this platform will ever produce is:

```
https://<host>/uploads/certificates/CERT-20260923-<tenantCode>-0001.pdf
```

`tenantCode` is a human-chosen unique string on the tenant (`tenant.model.js:88-92`) — a hospital abbreviation. An attacker needs it exactly once: it is printed on every certificate that tenant issues, it is returned by the public verification endpoint, and it is the sort of string a hospital tells you on the phone. Given it, the remaining search space is *date × small integer*. Sweeping a year of dates against the first fifty sequence numbers is about 18,000 requests — under an hour inside the existing rate limit, from one IP, with `curl`.

What that yields is not metadata. It is the signed PDF: device name and serial number, calibration standard, measurement results, the technician who signed, the date, the tenant's letterhead. For a competitor, that is a rival hospital's entire medical-device inventory and its maintenance posture. For anyone else, it is enough to forge a plausible certificate, and — because the real one is freely downloadable — enough to know exactly what a real one looks like.

Note the asymmetry with the design's own intent: `certificates.certificate_number` is declared globally unique (`certificate.model.js:167`), which `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md:104-112` already identifies as an oracle shape for `serialNumber`. Here it is worse than an oracle. It is a key to the object.

**Verdict for this class: "unguessable" is false, and not marginally. The name is a predictable sequence.**

### 1.3 Attachments: the name is unguessable, and it is also published, permanent and immune to deletion

`upload.util.js:16-29` names an uploaded file `<epoch>-<rand>-<uuidv4><ext>`. The UUIDv4 is genuinely unguessable. So the brute-force story is different here — and it does not matter, for three reasons that are each sufficient on their own.

**It is handed out.** `attachment.service.js:57-73` — `toPublic()` — puts `url: getUploadUrl(a.fileName, a.folder)` (`:71`) into **every** attachment response: the list endpoint, the get endpoint, the upload response. `upload.util.js:286-292` renders that as `/uploads/attachments/<name>`. So the capability is not a secret an attacker must find; it is a field in an API payload, which means it lands in browser history, in the `Referer` header of any outbound link on a page that renders it, in proxy logs, in support tickets, in screenshots, in a pasted chat message, and in any client-side cache. Unguessable-but-published is the definition of a bearer token with no expiry. This repository knows that — it is why `generateSignedUrl` (`attachment.service.js:249-263`) exists with a 300-second TTL (`:35`). The static URL is the same capability with the TTL set to forever, issued unasked.

**It outlives deletion.** `deleteAttachment` (`attachment.service.js:189-243`) is a soft delete inside a transaction with its audit row — careful, correct code, written for A-28 with ISO 17025 §7.8 and 21 CFR 11.10(e) cited in its own comments. And `attachment.model.js:96-98` gives the model a `defaultScope` of `where: { is_deleted: false }`, so after that delete **every** database read path — `loadOwned` (`:152-159`) and `getSignedDownload` (`:286-297`) alike — correctly returns 404. Every path except one: the file is still on disk and `express.static` still serves it, forever, at the URL already handed out. The soft delete works perfectly and the static mount makes it a lie. Under GDPR that is an erasure request the system reports as honoured and has not honoured.

**It is evidence.** `deleteAttachment:194-209` refuses with a 409 to delete a file attached to an `approved` or `signed` certificate, on the grounds that it is part of a released record. That protection is about integrity of the record. It says nothing about who may *read* it, because on this path nothing does.

**Verdict for this class: the name is unguessable and the property is worthless, because the name is published in every response and revoked by nothing.**

### 1.4 Profile photos and tenant logos: lowest value, same hole, plus an opt-in that is one flag from active content

Same UUID naming, same publication (`frontend/src/lib/uploadUrl.ts:19-29`, `frontend/src/app/dashboard/tenants/hooks/useTenants.ts:141`). The data is less sensitive — a staff photo, a hospital logo — and I will not pretend otherwise. Two things still make it worth naming.

First, a staff directory is a phishing asset. A photo plus a name plus a hospital is the input to a convincing impersonation, and here the photo is retrievable without a session.

Second, the mount sets `Content-Disposition: inline` (`backend/index.js:346`). `upload.util.js:35-39` documents in a comment exactly why that is dangerous: *"SVG is intentionally excluded from the default allowlist. SVG files can embed executable JavaScript and are served inline from /uploads, which would enable stored XSS."* And then `tenant.route.js:377-390` opts `image/svg+xml` and `.svg` back in for tenant logos.

Today that upload is blocked by a *different* layer — `fileValidation.util.js:135-200` fails an SVG on magic bytes, and `.svg` is in `DANGEROUS_EXTENSIONS` (`:56`, `:90-91`). So this is latent, not live, and I say so plainly. But it is a stored-XSS-on-the-API-origin vector held shut by a magic-byte check that any route can disable with `validateMagicBytes: false` (`upload.util.js:104`). The reason it is one flag from live is the inline static mount. Remove the mount and the flag stops being load-bearing.

**Verdict for this class: real but modest exposure, and one defence-in-depth layer away from active content on the backend origin.**

### 1.5 What is lost even when nothing is stolen

There is no access record tied to a principal. `accessLog` (`backend/index.js:326`) does cover `/uploads` and writes a morgan line to a rotating file — that is an HTTP log, not the audit trail, and it has no user, no tenant and no resource id, because on this path none exist. So for a platform claiming ISO 17025, FDA 21 CFR Part 11, ISO 13485 and GDPR, there is no answer to *who read this certificate*. Under Part 11 the interesting question about a released record is not only who changed it but who obtained it; under GDPR Art. 15/30 the question is what personal data was disclosed and to whom. `/uploads` answers neither, and cannot be made to, because it does not know.

---

## 2. What the capability design gives you that the mount throws away

`docs/STORAGE/04-TENANT-STORAGE.md` describes a layer that is genuinely well built:

- **Keys are the isolation boundary.** `t/<tenantId>/<domain>/<name>` with `keys.assertKeyForTenant()` on every `ScopedStorage` call (doc §"Keys Are the Isolation Boundary", lines 83-90). A service that constructs a key by hand still cannot address another tenant's object. `getTenantStorage(null)` throws rather than falling back to global (doc:102) — deny-by-default, the same rule as `tenantScope.util.js`.
- **The token is minted and verified in one file.** `storage/signing.js:15-43`: `<exp>.<hmac(secret, "<key>.<exp>")>`, constant-time compare, returns `false` — never throws — on malformed, wrong-length or expired input.
- **Authorization is derived from the object, not the request.** `openSignedObject()` verifies the token *before touching storage*, then derives the tenant from the key (doc:116). A valid token for tenant A's key can only ever open tenant A's object.
- **The response is hardened at the point of serving**: `Content-Disposition: attachment` and `nosniff`, with a 410 when the object vanished mid-stream (doc:118).
- **Time is bounded.** 300 seconds by default (`attachment.service.js:35`).

The static mount discards every one of those properties at once. It has no key namespace, no tenant derivation, no expiry, no revocation and no record. It is not a weaker version of the capability design; it is the negation of it, mounted three hundred lines above the routes that implement it.

**Where the capability design is incomplete, stated honestly.** `docs/STORAGE/04:28` says it outright: *"The attachment request path does not use this module yet."* Attachments are still written and read through multer and `storagePath.util.js`; nothing outside `storageMigration.service.js` reads `attachment.storageKey`; the only application code importing `services/storage` is the storage controller and the migration tool. Doc line 284 is equally frank: the suites are unit tests against mocks, and per `CLAUDE.md` § Evidence *a mock proves the client, not the contract* — a full live bring-your-own-bucket run is recorded nowhere in this repository. `GET /api/v1/storage/object` (`storage.route.js:52`) is deliberately ungated, which is correct for a token-resolved endpoint but means its entire security rests on `signing.js` plus the key's tenant segment. And the per-process driver cache (doc:57) means a settings change does not propagate across replicas.

**This does not weaken the position, and here is why.** My proposal does not require the storage cutover. The authorized read paths for both file classes already exist, already work against the legacy on-disk layout, and are already gated:

- `GET /api/v1/attachments/:id/download` — `auth` + `dynamicAccess(EQUIPMENT, "read")` + `validateUuid` (`attachments.route.js:190-196`), resolving through `loadOwned` (`attachment.service.js:152-159`), which is tenant-scoped and soft-delete-aware.
- `GET /api/v1/attachments/:id/signed` — token-resolved, no session (`attachments.route.js:87`), minted on demand by `POST /:id/signed-url` (`:222`).
- `GET /api/v1/certificates/:certificateId/pdf` — `auth` + `dynamicAccess("certificate", "read")` (`certificates.route.js:567-573`), resolving through `getOrCreatePdf` (`certificatePdf.service.js:229-258`), which regenerates the PDF if the file is missing.

The lockdown is: stop publishing the unauthenticated path, and point the callers at the gated routes that are already there. Finishing the storage façade cutover is a separate, later, optional improvement.

---

## 3. The hard case: public certificate verification

This is the strongest argument against me and it deserves to be met exactly, not waved at.

A printed calibration certificate carries a QR code. `certificatePdf.service.js:171-172` encodes `resolveVerifyUrl(...)` into it. `certificates.route.js:35` serves `GET /api/v1/certificates/verify/:certificateNumber` with **no middleware at all** — deliberately, so a third party with a piece of paper can check it. Because no auth middleware runs, `tenantContextMiddleware` never runs either, so `tenantScope.util.js:52-53` resolves `skip` and the lookup in `verifyByCertificateNumber` (`certificatePdf.service.js:264-272`) is genuinely cross-tenant by certificate number. That is not an isolation bug. That is the design, and it is the *point* of third-party-verifiable evidence: a certificate nobody outside the issuing tenant can check is not evidence, it is a claim.

I am not proposing to touch that endpoint's public status. I am proposing to change one field of its response.

**Today** the endpoint returns, at `certificatePdf.service.js:311-313`:

```js
// Relative path to the signed PDF (served from /uploads). The public
// verification page prefixes it with the API origin to display the doc.
documentUrl: cert.filePath || null,
```

Three consequences worth separating:

1. Verification hands out a **permanent, unauthenticated** URL to the PDF.
2. It does so for **any** certificate that exists, at **any** status. Look at lines 289-315: `valid` is computed from `signed && !revoked && !expired` at `:286`, and `documentUrl` is returned unconditionally at `:313`. So the public endpoint publishes the PDF of a `draft` certificate — an unreleased record — to anyone who guesses its number.
3. Because the URL is static, obtaining the document is invisible: verification is logged nowhere, and the subsequent fetch goes to `express.static`.

**The locked-down design that still serves the same purpose:**

- `GET /api/v1/certificates/verify/:certificateNumber` stays exactly as public as it is. Nothing about the QR flow changes.
- Its payload keeps everything a verifier actually needs — `found`, `valid`, `status`, `revoked`, `expired`, `issuedTo`, `device`, `issueDate`, `validUntil`, `signedBy`, `signedAt`, and crucially `integrityHash` (`:287`, from `computeIntegrityHash`) alongside `computeSignature` / `SIGNATURE_KEY_ID` (`certificatePdf.service.js:318-322`). **The hash and the signature are the evidence.** A third party's assurance has never come from the fact that a PDF was fetchable at a guessable address; it comes from a value computed over the record and checkable against the document in their hand. Lockdown keeps the evidence intact and bounds only the convenience copy.
- `documentUrl` changes from a static path to a **minted, single-certificate, short-TTL capability**, produced by the same `signing.js:15-22` used everywhere else, over a key naming that one certificate, with the existing 300-second TTL:

  ```
  /api/v1/certificates/verify/<certificateNumber>/document?token=<exp>.<hmac>
  ```

- That resolver route is public and token-gated — exactly the shape `storage.route.js:52` already establishes and `backend/src/tests/routes/routeGuards.a02.test.js` already asserts is legitimate ("does not gate GET /object as a settings route"). It verifies the HMAC before touching storage, derives the tenant from the certificate row rather than from the request, streams with `Content-Disposition: attachment` and `nosniff`, and answers 410 if the file is gone.
- The mint is **conditional on status**. A `draft` certificate gets `documentUrl: null` and a message saying it has not been issued. Whether a `revoked` certificate still yields its document is a policy question for the owner, not a judgement call — per `CLAUDE.md` § The Deviation Protocol it belongs in `TASKS/BACKLOG.md` as an Open Question. My recommendation, for the referee's benefit: yes, because a verifier holding a revoked certificate needs to see what they are holding.
- Each mint writes one audit row: certificate id, tenant id derived from the row, requester IP and user-agent, actor `public-verification`. That is the ISO 17025 / Part 11 answer to *who obtained this released record*, which today does not exist.
- The mint is also the natural place for a budget tighter than the global 5000/15min (`backend/index.js:248`). Enumeration still reveals *existence* through verification, which is inherent and intended — but it no longer yields the document for free.

**Frontend cost of this, precisely: zero or one line.** `frontend/src/app/verify/[certificateNumber]/page.tsx:159-160` builds the PDF link by prefixing `data.documentUrl` with `API_BASE_URL`. If the minted `documentUrl` is returned as an API-relative path, that line keeps working unchanged.

**The second public case, which I will not pretend away.** `content.route.js:60` and `:81` serve a public blog (`/posts/public`, `/posts/public/:slug`). `frontend/src/app/dashboard/content/components/PostEditor.tsx:309` and `frontend/src/components/blog/PostCard.tsx:15` render images whose `/uploads/...` URLs are baked into stored post HTML by the WYSIWYG editor — and `attachment.service.js:66-70` says so in a comment: *"Stable, permanent, host-relative URL for inline embedding... Used by the CMS WYSIWYG editor."* A 300-second capability cannot be embedded in published content. This is a genuine requirement and the honest answer is not "sign it anyway"; it is a **deliberate public asset class** (§4, step 6): an `isPublic` flag set by an explicit, permissioned, audited action, a separate directory, and a separate route. The distinction that matters is between *a file someone chose to publish* and *every file the platform has ever stored*. The static mount does not make that distinction. That is the whole complaint.

---

## 4. The migration, file by file

**1. `backend/index.js:339-349` — delete the mount.** Keep `:337` (`/.well-known`): ACME HTTP-01 requires an unauthenticated path, the content is a nonce, and it is a different directory. Keep `:351` (`/public`): that is `appPath("public")`, application-owned static, not user uploads.

**2. `backend/src/services/certificatePdf.service.js:199-206` — stop writing a URL into the database.** Keep writing the PDF. Change `relPath` from `/uploads/certificates/<file>` to a bare key (`certificates/<file>`, or `t/<tenantId>/certificates/<file>` if the write is routed through `getTenantStorage()` so `assertKeyForTenant` applies — recommended, not required). Change `:311-313` to mint the capability URL described in §3, gated on status. `getOrCreatePdf` (`:229-258`) already regenerates a PDF that is missing from disk, so any row whose file cannot be found self-heals on first access rather than 404ing.

**3. `backend/src/services/attachment.service.js:71` — stop putting an unauthenticated URL in every response.** `toPublic()` returns `downloadUrl: "/api/v1/attachments/<id>/download"` — the authenticated route that already exists at `attachments.route.js:190-196` — and nothing else. A shareable link becomes an explicit action: `POST /api/v1/attachments/:id/signed-url` (`attachments.route.js:222`), which already exists, already takes a TTL, and can now carry an audit row for the act of sharing. That single change is also the GDPR erasure fix: the model's `defaultScope` (`attachment.model.js:96-98`) already hides soft-deleted rows from `loadOwned` and `getSignedDownload`, so once the static path is gone, `deleteAttachment` (`:189-243`) actually removes the file from reach. No new logic is needed for that; it starts working when the bypass is removed.

**4. nginx — `deploy/compose/nginx/default.conf:105-113` and `deploy/compose/nginx/vm-http.conf:76-80` — remove the `/uploads/` location.** In `default.conf`, `/api/` already proxies to the backend (`:100-102`), so the replacement routes are covered with no further config change. In `vm-http.conf`, `/api/` deliberately proxies to the **frontend** (`:71-74`) because Next owns the httpOnly auth cookie and injects `Authorization` from it — which means removing `/uploads/` there does not merely close a hole, it corrects an inconsistency: today file bytes bypass the one origin that holds the credential. The comments above both `/uploads/` blocks ("the backend sets nosniff and inline — do not override") go with them; they document a defence that only exists because of the thing being removed.

**5. Frontend.** `frontend/next.config.ts:17-18` (the `/uploads/:path*` rewrite) and `:28` (`remotePatterns` for `/uploads/**`) are dropped or repointed at the public-asset prefix. `frontend/src/lib/uploadUrl.ts:19-29` (`toSameOriginUpload`) and `:56` (`avatarSrc`) rewrite the new prefix instead of `/uploads/`. `frontend/src/app/dashboard/tenants/hooks/useTenants.ts:141` builds a logo URL by hand — one line. `frontend/src/app/verify/[certificateNumber]/page.tsx:159-160` is unchanged (§3). Tests that hardcode the shape need updating: `frontend/src/app/dashboard/profile/__tests__/page.test.tsx:193-230`, `frontend/src/stores/__tests__/authStore.test.ts:54-177`, `frontend/src/lib/uploadUrl.test.ts`.

**6. The public asset class** (the CMS case from §3). Add `isPublic` to `attachments`, default false, set only by an explicit permissioned action that writes an audit row. Public assets are written to `uploads/public/` and served by a narrow route — never by re-mounting `uploads/` — which serves only rows with `isPublic = true` and `is_deleted = false`, with long cache headers. The CMS rewrites embedded URLs at publish time. This is the largest single piece of work in the plan and I am not going to pretend it is small.

**7. Stored URLs.**

- `certificates.filePath` today holds `/uploads/certificates/<n>.pdf` (`certificatePdf.service.js:205`). A data migration strips the prefix. **Verified 2026-09-23: 0 certificate rows and an empty directory — the migration is a no-op and there is nothing to backfill.** Per `CLAUDE.md` § The Traps, it is written without a blanket `try/catch`, and verified in `psql`, not from the migration log.
- Past attachment responses: `toPublic().url` was handed out in every attachment response ever served, and any client holding one keeps a permanent unauthenticated URL that no server-side change can recall. **Verified 2026-09-23: 0 attachment rows, so zero such URLs exist.** After the first upload that stops being true, permanently. This is the entire timing argument: the cost of this change is currently zero and monotonically increasing.
- All of the above per `CLAUDE.md` § The Deviation Protocol: an ADR in `MEMORY/DECISIONS.md` recording the decision, the alternatives (including Position B), and the bad implications listed in §5; `docs/STORAGE/04-TENANT-STORAGE.md` amended to match; both noted in the change record. Removing a public URL shape is an architecture change and gets an ADR, not a quiet commit.

---

## 5. What this costs

**Bytes through Node: mostly already paid.** This is the counter-argument I expect, and it is weaker than it looks. `express.static` at `backend/index.js:341` runs *inside the same Express process*, and nginx proxies to it (`default.conf:111`) rather than serving from disk itself. So file bytes already traverse Node today. The genuine new cost per request is a database round trip (`loadOwned`, or a certificate lookup) plus one HMAC verification — microseconds of CPU against milliseconds of I/O. `res.download` / `res.sendFile` preserve ETag, Last-Modified and Range, so conditional requests and PDF range-fetches keep working. What is lost is `express.static`'s cheaper path and its in-process caching of stat results.

**Caching and CDN: a real regression, and the sharpest one.** A 300-second capability URL must be `Cache-Control: private, no-store` and is uncacheable at any shared cache by design. Avatars and tenant logos are the problem: a device list showing forty rows with forty avatars becomes forty credentialed requests that no CDN can absorb, on every page load, for every user. That is a measurable latency and bandwidth regression on exactly the screens users spend their time on. It is also the case where the data barely justifies the protection — which is why §6 concedes precisely this.

**Frontend breakage.** Until step 6 lands, images embedded in already-published CMS posts (`PostEditor.tsx:309`, `PostCard.tsx:15`) break. Avatars and logos break until `uploadUrl.ts` and `useTenants.ts:141` are repointed. Several test files encode the `/uploads` shape and go red. `next/image` optimization does not work through a credentialed route — partly already paid, since `avatarImageProps` in `uploadUrl.ts` already sets `unoptimized`.

**A new proxy hop on the VM.** On `vm-http.conf`, moving file bytes under `/api/` routes them through the Next.js cookie-injecting proxy (`app/api/v1/[...path]`). That proxy has never carried large binary streams. It needs to be verified for streaming rather than buffering a 25 MB attachment (`attachments.route.js:119`) into memory, and for `Range` pass-through. This is a genuine unknown and should be a named, run test before the change ships — per `CLAUDE.md` § Evidence, naming the test is the point, and I am not naming one that does not yet exist.

**New operational surface.** A public-asset class means a new permission, a new audit event, a publish-time URL rewrite, and a new failure mode ("the image did not appear on the blog because nobody marked it public"). An expiring URL means a class of user-visible failure that does not exist today: a link pasted into a chat stops working after five minutes. Support will see that.

**Some adjacent work is unproven.** The storage façade is unit-tested against mocks only (`docs/STORAGE/04:284`) and the attachment path has never been cut over (doc:28). My plan deliberately does not depend on it — it uses the already-gated routes — but any version of this that *also* routes serving through `services/storage` is taking on an unproven path, and should say so rather than inherit the façade's test suite as if it were evidence.

---

## 6. What I would concede

If forced to a single compromise: **keep a static mount, but only for an explicitly-public asset class in its own directory — `uploads/public/` — never `uploads/` as a whole.**

Avatars, tenant logos and CMS images published to the public blog move there at upload or publish time, behind a permissioned, audited action. They get long cache headers, CDN caching and `next/image` optimization, and the latency regression in §5 disappears exactly where it hurt. They keep `nosniff`, lose `inline` in favour of a strict per-type `Content-Type` allowlist, and that also disarms the SVG path in §1.4.

Certificates and attachments never land in that directory. Certificate PDFs and evidence files are served only through an authorized or capability-bound route, always, with a record — because those are the released records this platform exists to hold, the ones ISO 17025 and 21 CFR Part 11 are about, and the ones whose filenames are a counter.

The line I am drawing is not "static serving is bad". It is that *public* must be a property a file is **given**, deliberately, once, by someone with the authority to give it — not the default property of every byte the platform has ever written to disk.
