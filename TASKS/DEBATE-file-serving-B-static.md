# Debate — File Serving, Position B: the static mount should survive

**Position:** serving files as static assets is the right default for this system. The enumerable
certificate filename is indefensible and must go. The mount that serves it should not.

**Status of the opposing paper:** `TASKS/DEBATE-file-serving-A-lockdown.md` did not exist when this
was written (checked 2026-09-23). Its case is already on record in this repository as
`TASKS/AUDIT-2026-09-INFRA.md` § S-01, severity **critical**, and I answer S-01 by name and by
line throughout. If paper A argues something S-01 does not, this paper has not seen it.

---

## 0. What is actually true, before anyone argues

Both halves of the contradiction are real and both are in the tree today.

The capability half:
`backend/src/services/storage/signing.js:15-22` mints `<exp>.<hmac(secret, "<key>.<exp>")>` and
verifies it in constant time at `:25-42`; `backend/src/routes/api/storage.route.js:52` exposes
`GET /object` with **no** gate, deliberately, because the token *is* the gate;
`backend/src/routes/api/attachments.route.js:88` does the same for `/:id/signed`. Default TTL is
300 seconds (`backend/src/services/attachment.service.js:35`).

The static half:
`backend/index.js:339-349` mounts `express.static(storagePath("uploads"))` with no auth, adding
only `X-Content-Type-Options: nosniff` and `Content-Disposition: inline`.
`backend/src/services/certificatePdf.service.js:199-205` writes the certificate there and stores
`filePath = "/uploads/certificates/<certificateNumber>.pdf"`. Both nginx configs proxy it
(`deploy/compose/nginx/default.conf:111-113`, `deploy/compose/nginx/vm-http.conf:78-80`) and so
does the chart (`deploy/helm/callibrator/templates/ingress.yaml:87-93`).

And one fact that decides more of this argument than either half:
**the capability layer is not wired into the request path.**
`docs/STORAGE/04-TENANT-STORAGE.md` § *Read This First* says it in the document's own words —
"the upload and download path has not been cut over to it", and its Traps table ends with
"Treating `attachment.storageKey` as the serving path | nothing in the request path reads it yet".
`backend/src/services/attachment.service.js:37-45` still resolves files through
`storagePath.util.js` at `uploads/attachments/<fileName>`.

So the choice in front of the referee is not "two working designs, pick one". It is: **a shipped,
load-bearing static path with one indefensible filename, versus a built-but-unwired capability
layer that would have to absorb every byte of this platform's file traffic on `replicaCount: 1`
(`deploy/helm/callibrator/charts/backend/values.yaml:6`, `deploy/helm/callibrator/values-prod.yaml:26`)
with no CDN in front of it.**

---

## 1. Five file classes, one mount — and that is the error on both sides

`backend/src/middlewares/createFolder.middleware.js:27-30` creates exactly four directories under
`uploads/`, and `backend/index.js:337` mounts a fifth path separately. Treating them as one
security object is how this debate goes wrong in both directions: S-01 proposes deleting the mount
for all of them, and the status quo protects none of them. Neither is right, because the five do
not share a threat model.

| Class | Written by | Name shape | Guessable? | Intended reader |
|---|---|---|---|---|
| **Certificates** | `certificatePdf.service.js:199-205` | `CERT-<YYYYMMDD>-<tenantCode>-<0001>.pdf` (`safeFileName`, `:60-61`) | **Yes — fully** | anyone holding the certificate number, including a third party with no account |
| **Attachments** | `utils/upload.util.js:22-28` | `<Date.now()>-<rand>-<uuidv4()><ext>` | No — 122 bits | members of the owning tenant |
| **Profile photos** | `routes/api/user.route.js:718` → same multer | same uuidv4 shape | No | anyone who can see the user in a list |
| **Tenant logos** | `routes/api/tenant.route.js:378,539,793` | same uuidv4 shape | No | anyone who can see the tenant, including a login screen |
| **ACME `.well-known`** | `customDomains.service` at runtime | dictated by the CA | Irrelevant | **Let's Encrypt, unauthenticated, over plain HTTP, by protocol** |

Read that table and the argument reorganises itself.

**The ACME class settles the principle.** `backend/index.js:334-337` and
`deploy/compose/nginx/default.conf:21-24` serve `/.well-known/acme-challenge/` over port 80 with no
TLS and no session, *on purpose*, because HTTP-01 validation cannot work any other way. Nobody
proposes putting an authorization check in front of it. So "every byte through Node and an
authorization check" is already not the rule here — it is a rule with an exception, and once a
design admits one class of unauthenticated static file, the question stops being *whether* and
becomes *which*.

**The certificate class is the only one with a guessable name.** `certificate.model.js:183-213`
builds `CERT-<date>-<tenantCode>-<sequence>` with the sequence starting at 1 per tenant per day,
and `safeFileName` puts that string verbatim into the URL. That is the defect. It is a **naming**
defect. It is not evidence that static serving is wrong; it is evidence that this one filename was
never treated as a secret and was then published as one.

**The other three classes already have unguessable names**, and have had since multer was
configured: `${Date.now()}-${rand}-${uuidv4()}${ext}` (`utils/upload.util.js:22-28`). S-01 concedes
this in its own text — "the filename is `Date.now()-rand-uuidv4()` … so it is not enumerable". That
concession is larger than S-01 treats it. Three of the five classes are **already capability URLs**.
They were built as capability URLs. What they lack is not a check; it is **revocation** — and I
concede that in § 5.

**Profile photos and tenant logos are not evidence.** An avatar is displayed to every colleague in
the tenant, rendered one-per-row in user lists (`frontend/src/components/layouts/Navigation.tsx`,
`Sidebar.tsx`, `TopBar.tsx`, `UserDropdown.tsx`, and
`frontend/src/app/dashboard/users/components/UserRow.tsx`, all via `avatarImageProps` in
`frontend/src/lib/uploadUrl.ts:76`). A tenant logo is branding intended for a login page
(`backend/src/models/tenant.model.js:47`). Classifying them with calibration evidence, which is
what a single `/uploads` policy does, is a category error that costs real performance for no
security.

---

## 2. The strongest case against me, and my answer — class by class

Here is S-01's central claim, quoted verbatim, and it is correct:

> "Anyone on the internet, through the Cloudflare tunnel, can walk `CERT-20260923-<code>-0001.pdf`,
> `-0002.pdf`, … and pull down every tenant's calibration certificates. The tenant code is not a
> secret; it appears in the certificate number the public verification page already accepts."

And its general form, which is the real argument and is stronger than the specific one:

> "the URL the API hands out is a **permanent, unauthenticated bearer link** to calibration
> evidence … Every browser cache, proxy log and pasted link keeps working forever."

A hospital's calibration evidence is confidential. An infusion pump's serial number, its
manufacturer, its measured deviation, the technician who signed for it and the date it goes out of
tolerance are together a map of a hospital's clinical risk. An unauthenticated URL is a bearer
token with no expiry and no revocation. All of that is true.

My answer is not that it is false. It is that **deleting the mount answers almost none of it**, and
that the parts it does answer are answered more cheaply and more durably elsewhere.

### 2a. Certificates — S-01's enumeration argument is right, and its fix is aimed at the wrong door

The certificate number is not a secret *by design*. `backend/src/routes/api/certificates.route.js:35`
mounts `GET /api/v1/certificates/verify/:certificateNumber` with **no auth middleware at all**, and
`certificatePdf.service.js:283-315` answers it with the tenant name, the device name and serial
number, the type, the standard, the issue and expiry dates, the signer's name and the integrity
hash — to anyone, from anywhere, by certificate number alone. The tenant hooks do not narrow it:
with no CLS context, `resolveScope` returns `{ mode: "skip" }`
(`backend/src/utils/tenantScope.util.js:52-53`), which is deliberate for a public route.

Therefore: **removing `/uploads` does not remove the enumeration primitive.** The attacker who can
walk `CERT-20260923-RSUD-0001.pdf` can equally walk
`/api/v1/certificates/verify/CERT-20260923-RSUD-0001` and get the device inventory in JSON, through
a route S-01 does not touch. Deleting the static mount while that endpoint stands closes a window
and leaves the door open — and it does so while producing a "critical finding remediated" line in
the change record. That is the shape of defect `CLAUDE.md` § Evidence warns about: a fix that stops
anyone looking again.

I must not overstate this. The PDF is a **superset** of the verify JSON: `renderHtml`
(`certificatePdf.service.js:118-150`) puts `summary`, `conditions`, `notes`, the device
manufacturer and model, and the names of the calibrating and approving users into the document, and
none of those appear in the verify response. So the enumerable filename leaks strictly more than the
endpoint does, and it is a real, separate leak. My claim is narrower and survives that: the
*enumerable identifier* is the shared root cause, the identifier is deliberately public, and any fix
that does not make the **file name** independent of the **certificate number** has fixed one symptom
of two.

The fix that addresses both is one line of naming, not a re-plumbing: give the PDF a random storage
name and keep the certificate number as the human-facing lookup key. Then the number stays public
(the QR code depends on it), the verify endpoint keeps working, and the document behind it needs a
128-bit secret nobody can walk. S-01 itself allows for this as an interim — "Until the mount is
removed, a certificate PDF filename must be unguessable (a random id, not the certificate number)".
I am arguing that this is not an interim. It is the fix.

### 2b. Attachments — the bearer-token argument is real, and it is an argument about *revocation*, not about *static*

This is S-01's best point and I do not want to blunt it. `attachment.service.js:68-71` returns
`url: getUploadUrl(a.fileName, a.folder || ATTACH_FOLDER)` in **every** attachment response — a
permanent unauthenticated link — and `deleteAttachment` (`:192-245`) is a soft delete that leaves
the file on disk and therefore leaves the URL live. A link pasted into a group chat in 2026 still
works in 2028. That is indefensible, and I concede it in § 5.

But notice what the capability route does about it: **nothing.** `getSignedDownload`
(`attachment.service.js:291-303`) verifies the HMAC, loads the row with `Attachment.findByPk(id)`,
resolves the path and streams. It does not consult `isDeleted`. It runs with no CLS context, so no
tenant predicate is added — correct, since the token carries the authority, but it means the
soft-delete state is never checked on this path either. A 300-second signed URL issued one second
before the delete keeps working for 299 seconds after it, and the file it points at is never
unlinked at all.

So "move it behind the capability layer" does not deliver revocation. **Unlinking the object
delivers revocation**, and unlinking works identically under both designs. The security property
S-01 wants is achieved by a change to `deleteAttachment`, not by a change to `express.static`.

The remaining residue — a live attachment's URL being a bearer token while the attachment is alive —
is a 122-bit random name over TLS through a Cloudflare tunnel. That is the same construction as an
S3 presigned URL, which `docs/STORAGE/04-TENANT-STORAGE.md` § *Signed Downloads* already endorses
for the `s3` provider, where the app never sees the bytes and `direct: true` sends the client
straight to the bucket. This project has already decided that a capability URL resolving without an
application authorization check is an acceptable design. The disagreement is only about how long it
lives.

### 2c. Profile photos and tenant logos — the threat is disclosure of a face and a logo

Put the strongest version: an avatar can identify a named individual at a named hospital, and that
is personal data under GDPR, which `CLAUDE.md` lists in the compliance set. Fine. It is also an
image the person uploaded to be shown to colleagues, addressed by a 122-bit random name, over TLS.
The marginal confidentiality gained by routing it through `auth` + `dynamicAccess` is small; the
marginal cost is measured in § 3 and is not. If this class ever needs a check, it needs a
*different* check — "is the viewer in the same tenant as the subject" — which is a product decision
and belongs in `TASKS/BACKLOG.md` as an Open Question per `CLAUDE.md`, not something the mount's
removal delivers.

### 2d. ACME — unanswerable, and it is mine

There is no version of "route every byte through Node and an authorization check" that survives
contact with HTTP-01. The class exists, it is static, it is unauthenticated, and both nginx configs
and the chart already carry a special case for it.

---

## 3. What the other side will not volunteer

### 3.1 On this deployment, `/api/` does not reach the backend

`deploy/compose/nginx/vm-http.conf:63-74` is explicit, and it is load-bearing:

```
    # /api/ goes to the FRONTEND, not the backend.
    location /api/ { proxy_pass http://frontend; }
```

`/uploads/` goes straight to the backend (`:78-80`), and `frontend/next.config.ts:14-21` rewrites
`/uploads/:path*` to the backend as a **rewrite**, which Next streams. Its own comment says why:
"Unlike `/api/v1` (see note below), these are static files with no auth injection, so a rewrite is
safe here."

Everything under `/api/v1/` instead lands in `frontend/src/app/api/v1/[...path]/route.ts`, which
does this, at `:56` and `:66`:

```ts
  body = await req.arrayBuffer();                 // every non-GET
  const responseData = await res.arrayBuffer();   // every response
```

and returns the buffer at `:115`. **It does not stream.** This repository already records it:
`TASKS/AUDIT-2026-09-FRONTEND.md:42` — "F-16 | The proxy buffers every request and response whole;
uploads and downloads are held twice in the Next process".

So "route file serving through the API" on the deployment that actually exists — one VM behind an
existing Cloudflare tunnel — means a 25 MB attachment (`attachments.route.js:120`) is read fully
into the Next.js heap, re-emitted, and only then reaches the browser. Concurrency multiplies it. A
screen opening twelve attachments is 300 MB of transient V8 allocation in the process whose other
job is rendering every page of the application. The static path has none of that: nginx → backend →
stream.

### 3.2 Node serves every byte, on one replica

`deploy/helm/callibrator/charts/backend/values.yaml:6` is `replicaCount: 1`, and
`deploy/helm/callibrator/values-prod.yaml:20-26` explains it is pinned there because the scheduler
runs in-process — "Scheduled jobs run ONCE PER REPLICA, so this deployment stays at one and the
chart enforces it". There is no CDN in front of the app. So every byte of every avatar in every user
list is served by the same single event loop that runs the calibration scheduler, the retention
cron and the backup job.

`express.static` on that loop is a read stream to the socket, with an `ETag` and a `Last-Modified`
computed from a `stat`, and a 304 on the second view. The authorized path is that *plus* a JWT
verification, a session lookup, an `AsyncLocalStorage` context establishment, a `dynamicAccess`
permission resolution and at least one database round trip — per image, per page render. On a single
replica that is the difference between a list of forty users costing forty `stat` calls and costing
forty authorization transactions.

### 3.3 The capability endpoint cannot do what the static mount does

`backend/src/controllers/storage.controller.js:46-68` is the whole of `getObject`. It sets
`Content-Type`, `Content-Length`, `Content-Disposition: attachment` and `X-Content-Type-Options`,
then pipes. It emits **no `ETag`**, **no `Last-Modified`**, **no `Accept-Ranges`**, and it **ignores
`Range` entirely**. Concretely:

- **No conditional requests.** A browser that already holds the file re-downloads it in full, every
  time. There is no `If-None-Match` to answer, because nothing issued an `ETag`.
- **No `Content-Range`.** A resumed or seeking download restarts at byte 0. On a hospital's network
  that is the difference between a retry and a failure.
- **No inline rendering, ever.** `Content-Disposition: attachment` is hardcoded at `:58` and is
  right for *that* route's threat model — but it means `getObject` **cannot** back an `<img>` tag or
  an inline PDF preview. `frontend/src/app/verify/[certificateNumber]/page.tsx:257-261` renders the
  certificate in an `<iframe src={pdfUrl}>`. Point that at `getObject` and the iframe becomes a
  download prompt. Point it at `attachmentController.download`
  (`backend/src/controllers/attachment.controller.js:47`, `res.download(absPath, fileName)`) and you
  get the same `Content-Disposition: attachment`.
- **`compression()` (`backend/index.js:104`) sits in front of it**, re-compressing already-compressed
  PDFs and JPEGs on that same single event loop.

None of this is a criticism of `getObject`. It is a correct implementation of *a download*. It is
simply not an implementation of *an asset*, and a dashboard needs assets.

### 3.4 What a 300-second TTL does to a printed QR code

`certificatePdf.service.js:186` bakes a QR code into the PDF pointing at `resolveVerifyUrl(...)`
(`:65-74`) — the certificate number, permanently. That is right, and it must stay permanent: the QR
code is printed, laminated and stuck to an infusion pump for the device's service life. An
ISO 17025 certificate is evidence in an audit that may happen three years later.

Now apply the TTL. `DEFAULT_SIGNED_TTL` is 300 seconds (`attachment.service.js:35`); the storage
layer's local/NFS URLs carry the same shape (`storage/signing.js:15-22`). Under a pure capability
design:

- **The printed QR code cannot embed a signed URL.** Five minutes after printing it is dead. A
  long-lived signed URL is precisely the "permanent bearer token" S-01 objects to — with the extra
  property that you cannot revoke it without rotating `CERT_SIGNING_SECRET`
  (`certificatePdf.service.js:27-31`), which invalidates every other link in the system at the same
  moment. So the QR must point at the verify page, and the verify page must mint a fresh link —
  meaning the mint is unauthenticated anyway, and the "capability" has become a vending machine that
  hands a capability to anyone who asks. That is a static URL with three extra round trips and a
  worse cache story.
- **An emailed link dies before it is read.** Any workflow that sends a certificate to a vendor, a
  regulator or a hospital's biomedical engineering department produces a link that is expired on
  arrival.
- **A bookmark dies mid-audit.** An auditor opens twenty certificates, works through them for an
  hour, and the tab they return to answers 403 `Invalid or expired download link`
  (`attachment.service.js:293`). There is no refresh path on that page: the token is in the URL and
  the page has no session to mint a new one. The auditor's recourse is to ask the hospital to
  re-issue every link. During an ISO 17025 assessment.

Raising the TTL to survive these cases converts the signed URL into exactly the thing the opposite
position objects to — an unauthenticated bearer link with a long life — while keeping every cost in
§ 3.3.

**That is the core of my argument. A signed URL is a capability, and a 404-by-obscurity random path
is a weaker capability of the same kind.** They are the same design at different points on one dial:
expiry. They are not opposites, and this debate should be about where that dial sits *per file
class*, not about whether to have a dial at all.

### 3.5 The cost nobody has priced: this deployment runs `local`

`docs/STORAGE/04-TENANT-STORAGE.md` § *The Three Providers* is clear that `s3` is "the only provider
where download traffic leaves the app server". `deploy/helm/callibrator/values-prod.yaml:46-52` sets
`driver: s3` and notes it is "required before replicaCount goes above one" — but the deployment that
exists today is compose, `deploy/compose/docker-compose.yml:33` bind-mounts
`./volumes/uploads:/app/uploads`, and the driver is `local`. Under `local`, "route it through the
capability layer" and "route it through Node" are the same sentence.

---

## 4. The design

Five changes. None is architectural; four are one file each.

### 4.1 Break the certificate filename away from the certificate number

In `certificatePdf.service.js`, replace `safeFileName` (`:60-61`) so the on-disk name is a random
token, and keep the certificate number as the human identifier it already is:

- store the PDF as `<random>.pdf` under `uploads/certificates/`;
- persist that path in `certificates.file_path` exactly as today (`:205`), so `documentUrl` (`:313`)
  and the verify page (`frontend/src/app/verify/[certificateNumber]/page.tsx:159-160`) keep working
  unchanged;
- on `POST /:certificateId/pdf` (`certificates.route.js:605-611`) regenerate with a **new** random
  name and unlink the old file, so regeneration revokes the previous link;
- `getOrCreatePdf` (`:230-262`) already derives the absolute path from `cert.filePath` via
  `path.basename`, so it needs no change.

Cost: a few lines, no migration (the column is a path, not a number), and one test asserting the
stored path does not contain the certificate number.

**That is the whole of the enumeration fix.** After it, `/uploads/certificates/` is a 128-bit
namespace with nothing to walk.

### 4.2 Rate-limit and shrink the metadata oracle that remains

`GET /api/v1/certificates/verify/:certificateNumber` (`certificates.route.js:35`) is where the
enumeration primitive actually lives. It is covered only by the global limiter
(`backend/index.js:210-248`), which in production allows 5000 requests per 15 minutes per IP — ample
for a walk. Give it its own limiter in the shape of `authLimiter` / `otpLimiter`
(`backend/index.js:224-244`). Whether a third party needs the device **serial number** to trust a
certificate is a product question, so it goes to `TASKS/BACKLOG.md` as an Open Question per
`CLAUDE.md`, not a judgement call made in a debate paper.

### 4.3 Stays static: certificates, CMS/inline images, avatars, tenant logos, `.well-known`

`app.use("/uploads", express.static(...))` (`backend/index.js:339-349`) stays, with `nosniff` and
`Content-Disposition: inline` unchanged. Both nginx configs already carry a comment forbidding their
removal (`default.conf:105-109`, `vm-http.conf:76-77`), and they are the defence that matters for
this mount, because the attack class against a static upload tree is stored XSS, not disclosure —
which is also why `utils/upload.util.js:36-40` excludes SVG and must keep excluding it.

Keep the mount below the global limiter (`backend/index.js:248`), where it already sits. Note for
the record that it sits **above** `globalSanitizer` (`:357`) — correct, since a static file has no
body to sanitise, but that ordering should be asserted by a test rather than inherited.

### 4.4 Moves behind a check: attachments become revocable, and staging comes before serving

Three changes, none of them to the mount:

- **`deleteAttachment` (`attachment.service.js:192-245`) must unlink or move the object**, inside
  the same transaction that writes the audit row. The soft delete stays — the row is evidence — but
  the bytes leave the served tree. This single change delivers the revocation S-01 correctly says is
  missing, and it delivers it for the static path and the signed path at once, because
  `getSignedDownload` (`:291-303`) does not check `isDeleted` either.
- **`toPublic` (`:57-72`) stops emitting `url` for evidence classes.** The permanent link exists for
  the CMS editor; keep it for images pasted into CMS content, and for
  `resourceType` in (`certificate`, `calibration_record`, `maintenance_work_order`) return the id and
  let the client call `/:id/download` (`attachments.route.js:190-196`), which is already
  authenticated and already `dynamicAccess`-gated.
- **Uploads land outside the served tree until they are clean.** `utils/upload.util.js:16-29` writes
  multer's file straight into `uploads/attachments`; the magic-byte check runs after
  (`:134-159`) and the virus scan after that (`attachment.service.js:85-90`). Write to a staging
  directory outside `storagePath("uploads")` and move into place only once both pass. That is
  `TASKS/AUDIT-2026-09-INFRA.md` § S-17, it is free, and it is a *staging* fix rather than a
  *routing* fix — the window exists because of where multer writes, and it would exist identically
  if the read path were fully authorized.

### 4.5 nginx does less, not more

Both configs keep `location /uploads/ { proxy_pass http://backend; }`
(`default.conf:111-113`, `vm-http.conf:78-80`). The one worthwhile addition is edge caching for the
classes whose names change when their content changes, and which are therefore safely immutable:
`Cache-Control: private, max-age=…` for `/uploads/profile/` and `/uploads/tenant/`, and nothing for
`/uploads/certificates/` and `/uploads/attachments/`. No auth subrequest, no `X-Accel-Redirect`, no
new upstream. The `.well-known` block (`default.conf:21-24`, `:93-96`) stays exactly as it is.

The Helm ingress `/uploads` path (`deploy/helm/callibrator/templates/ingress.yaml:87-93`) stays too,
for the same reasons — and the chart's own warning that `local` is incompatible with
`replicaCount > 1` (`deploy/helm/callibrator/templates/configmap.yaml:44-49`) is the real
prerequisite for scaling, not the mount.

### 4.6 How the QR code still works for a third party, a year later

1. The QR encodes `<CERT_VERIFY_BASE_URL>/<certificateNumber>` (`certificatePdf.service.js:65-74`).
   Permanent, printable, and it *identifies* a certificate rather than *authorising* anything.
2. A third party with no account scans it and lands on `/verify/<certificateNumber>`
   (`frontend/src/app/verify/[certificateNumber]/page.tsx`), which both nginx configs already route
   to the frontend with a comment saying it "must work without a session"
   (`default.conf:122-128`, `vm-http.conf:92-96`).
3. The page calls the public verify endpoint, which answers with validity, revocation, expiry, the
   integrity hash and `documentUrl` (`certificatePdf.service.js:283-315`).
4. `documentUrl` is now `/uploads/certificates/<random>.pdf` — unguessable, permanent, streamable,
   cacheable, seekable, and renderable in the existing `<iframe>` at `page.tsx:257-261`.

The capability the third party exercises is the certificate number. The file behind it is addressed
by a secret handed to them by the same public endpoint that just told them the certificate is valid.
**Nothing in that chain needs an expiry, and adding one breaks step 4 for the auditor who bookmarked
it.**

---

## 5. Where I concede

Without hedging.

1. **The enumerable certificate filename is indefensible.** `CERT-<date>-<tenantCode>-<sequence>.pdf`
   in a world-readable directory is a cross-tenant disclosure of clinical evidence, exactly as
   `TASKS/AUDIT-2026-09-INFRA.md` § S-01 describes it, and severity **critical** is right. It must
   change before anything else in this paper is worth discussing.

2. **Attachments must gain revocation, and that means the object is unlinked on delete.** Today the
   soft delete leaves a live permanent URL (`attachment.service.js:192-245`) and the signed route
   does not check `isDeleted` either (`:291-303`). I defend neither. S-01's Definition of Done item —
   "deleting an attachment makes its URL stop working — asserted, not assumed" — should be adopted
   verbatim.

3. **Attachment responses must stop handing out a permanent unauthenticated URL for evidence.**
   `toPublic` (`:68-71`) emitting `url` for every attachment in every response is a bearer-token
   firehose, and the CMS-editor use case does not justify it for calibration evidence.

4. **The file classes that must move behind authorization**, named, with no qualification:

   - **Tenant backups** (`backend/src/routes/api/tenantBackup.route.js`; the `backups` domain in
     `docs/STORAGE/04-TENANT-STORAGE.md` § *Keys Are the Isolation Boundary*) — a backup is every row
     the tenant owns. It has no business on a static mount under any naming scheme.
   - **Exports and generated reports** (`backend/src/routes/api/reports.route.js`; the `exports`
     domain) — bulk, structured, cross-record data.
   - **Calibration-evidence attachments** — `resourceType` in (`certificate`, `calibration_record`,
     `maintenance_work_order`). Authenticated download, or a signed URL minted by an authenticated
     caller; no permanent `url` field. This is where S-01's confidentiality argument wins outright,
     and I will not argue that a random path is good enough for the raw measurement evidence behind
     a 21 CFR Part 11 signature.

   What stays static after those move: **certificates** (public by design, with an unguessable
   filename), **CMS/inline images**, **profile photos**, **tenant logos**, and **`.well-known`**.

5. **The unverified claims in this paper**, stated plainly per `CLAUDE.md` § *Distinguish "Renders"
   From "Works"*: every performance argument in § 3 is read from code and configuration, not
   measured. The buffering at `frontend/src/app/api/v1/[...path]/route.ts:56,66` is code, not a
   benchmark. The single replica is configuration, not an observed saturation. Nothing in this
   repository records a measurement of `express.static` against `attachmentController.download` on
   the reference VM, and I did not take one. If the referee wants those priced, they must be
   measured, and the measurement is a task, not an assertion. S-01 makes the matching admission on
   its own side — "**Not exploited**" — and both should be read at that weight.

---

## 6. The one-sentence version

The static mount is not the vulnerability; a filename that was treated as an identifier and then
published as a secret is the vulnerability, and the remedy for it costs one function — whereas the
remedy proposed against it costs every byte of this platform's asset traffic on a single Node
replica with no CDN, no `ETag`, no `Range`, and a 300-second clock running against a certificate
that still has to open in three years.
