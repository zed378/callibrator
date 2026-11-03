# P21-15: Personal e-signatures, applied to calibration records, certificates and other documents, verifiable at a public URL

**Card:** P21-15 (Phase 21) · **ADR:** ADR-140 · **Status:** spec **v2**, 2026-11-03. v2 supersedes v1 of the same day, which covered only the operator's signature on a calibration record.

**Owner's words (2026-11-03):**
1. "buatkan fitur e-signature yang mana bisa diverifikasi lewat public endpoint"
2. "bedakan e-signature dengan sertifikat. e-signature digunakan untuk verifikasi data operator yang melakukan kalibrasi."
3. "saya ingin setiap user bisa membuat e-signature dan e-signature tersebut bisa dibubuhkan ke sertifikat atau dokumen lainnya jika diperlukan"

## 1. The model in one paragraph

**Every user creates their own e-signature once**: a visual specimen (drawn or uploaded) plus a personal RSA key pair. The private key is held server-side, encrypted under the KMS ring, and is used only after the user re-authenticates. Each time the e-signature is **applied** to a document, the system makes a **signature application**: a record binding the signer, the meaning ("performed", "approved", …), the time and the SHA-256 of the document's content, signed with the signer's personal key. Every application has its own **public verification link and QR**: anyone can check who signed what, when, and that the content has not changed since. **The e-signature is not the certificate**; it can be *affixed* to a certificate (and to other documents) when needed. The certificate keeps its own tenant-key digital signature (ADR-040), unchanged.

## 2. Data (migration 0149)

### 2.1 `user_esignatures`: a user's e-signature (one active per user)

| Column | Notes |
|---|---|
| `id` uuid PK, `tenant_id` uuid NOT NULL | tenant-scoped; the super admin, who has no tenant, cannot create one (403 `ESIG_PLATFORM`) |
| `user_id` uuid NOT NULL FK → users | partial UNIQUE (`user_id`) WHERE `status = 'active'` |
| `version` int NOT NULL | 1, 2, … per user; a replacement is a new row and the old one becomes `superseded` |
| `specimen_svg` text NOT NULL | the visual signature as **sanitised SVG**: paths only, no script, no external refs, ≤ 64 KB. A drawn signature produces SVG directly; an uploaded PNG/JPEG is vectorised in the browser or embedded as a data-URI `<image>` (≤ 256 KB). The server validates it with an allow-list sanitiser and rejects anything else (400) |
| `public_key_pem` text NOT NULL | RSA-3072 public half |
| `private_key_enc` text NOT NULL | the private half, encrypted with the KMS ring (the mechanism `tenant_keys` already uses); **never returned, never logged** |
| `key_fingerprint` char(64) NOT NULL | SHA-256 of the SPKI DER, shown on verification |
| `status` | `active` \| `superseded` \| `revoked` (CHECK) |
| `created_at`, `superseded_at`, `revoked_at`, `revoked_reason` | |

- Create, replace and revoke each require **re-authentication** (`certificate.service#verifySignerCredentials`, password or MFA) and write an **audit row** in the same transaction.
- **A key or specimen is never deleted.** A superseded or revoked e-signature still verifies the applications it made. Revocation means "do not use from now on"; it does not invalidate the past (the public page shows "revoked on <day>" beside earlier applications).
- Each user manages only their own e-signature. A tenant admin can **revoke** a user's e-signature (for example, a departed employee) but can never create or replace one for someone else.

### 2.2 `esignature_applications`: one application to one document

| Column | Notes |
|---|---|
| `id` uuid PK, `tenant_id` | |
| `esignature_id` uuid NOT NULL FK → user_esignatures | the version used |
| `signer_user_id` uuid NOT NULL | |
| `signer_snapshot` jsonb NOT NULL | `{ name, role, organisation }`; no e-mail or phone (FT-15) |
| `document_type` varchar(40) NOT NULL | `calibration_record` \| `certificate` \| `document` (CHECK; extensible by migration) |
| `document_id` uuid NULL | the record or certificate id; NULL for a `document` |
| `document_title` varchar(255) NOT NULL | shown publicly: the certificate number, "Calibration record <device> <date>", or the uploaded file's name as the signer typed it |
| `meaning` varchar(40) NOT NULL | `performed` \| `reviewed` \| `approved` \| `authored` \| `acknowledged` (CHECK) |
| `content_hash` char(64) NOT NULL | SHA-256 of the canonical content (§ 3) |
| `content_scheme` varchar(40) NOT NULL | `calrec-data-v1` \| `cert-data-v1` \| `file-sha256` |
| `auth_method` | `password` \| `mfa` |
| `signature_value` text NOT NULL | base64 RSA-SHA256 (personal key) over the signed payload (§ 3) |
| `signed_at` timestamptz NOT NULL | |
| `verification_token` varchar(64) NOT NULL UNIQUE | 24 CSPRNG bytes base64url (ADR-100); stored, like the IPM report's, so the QR can be printed again |
| `ip_address`, `user_agent` | stored, never returned |

- **Append-only** (trigger refuses UPDATE and DELETE; `callibrator_app` gets SELECT and INSERT only; a live test runs as `callibrator_app`).
- UNIQUE (`document_type`, `document_id`, `signer_user_id`, `meaning`) WHERE `document_id` IS NOT NULL: the same person cannot apply the same meaning to the same record twice.
- Every application also writes an `e_signature_records` row (the Part 11 log: entityType, entityId, action `sign`, meaning, authMethod, documentHash) and an audit row, all in one transaction.

## 3. Canonical content and the signed payload (in `packages/contracts`, so the browser recomputes the same bytes)

- `calrec-data-v1`: a JSON array of `[name, value]` pairs, in this fixed order, with every value a string and null rendered as `""`: `schemeVersion`, `tenantId`, `recordId`, `deviceId`, `clientFacilityId`, `calibrationDate` (YYYY-MM-DD), `dueDate`, `standard`, `results` (keys sorted recursively), `measurementUncertainty`, `isCompliant`, `entryKind`, `performedBy`, `calibrationVendorId`, `externalLabName`, `notes`.
- `cert-data-v1`: the same form over the certificate's issued content: `schemeVersion`, `tenantId`, `certificateId`, `certificateNumber`, `calibrationRecordId`, `deviceId`, `issueDate`, `validUntil`, `status`-independent fields only (**not** `status`, `signedAt`, `digitalSignature`, which change as the certificate moves through its flow), and the certificate's own integrity hash where it has one (A-241). Read `certificate.service` and the frontend certificate renderer, pick the fields that define what the certificate *says*, and record the list in ADR-140.
- `file-sha256`: the SHA-256 of the file's bytes, **computed in the browser**. The server receives only the hash, the title and the size; **the file itself is never uploaded or stored** (memory: frontend-rendered documents; privacy). The verifier drops the same file on the public page, and the browser compares the hashes.
- **Signed payload** = `JSON.stringify` of `[["scheme","esig-app-v1-rsa-sha256"],["tenantId"],["applicationId"],["esignatureId"],["keyFingerprint"],["documentType"],["documentId"],["contentScheme"],["contentHash"],["meaning"],["signerUserId"],["signedAt" ISO ms],["authMethod"]]`, signed with the signer's private key. Golden-file tests pin every form. A change is a new scheme version, never an edit.

## 4. API (all under `/api/v1`)

**My e-signature** (`auth`, `denyApiKey`, `dynamicAccess(MENU_SLUGS.ESIGNATURE, …)`; every tenant role that signs holds `esignature` since A-129, so check that migration and grant `esignature:write` to any role that performs, approves or signs and lacks it, by a migration with an ADR note):
- `GET /esignature/me`: the active e-signature (specimen, fingerprint, version, created_at) or `null`, plus earlier versions (no keys).
- `POST /esignature/me` `{ specimenSvg, authMethod, credential }`: create, or replace (the old row becomes `superseded`). The key pair is generated server-side. 201.
- `POST /esignature/me/revoke` `{ authMethod, credential, reason }`.
- `POST /esignature/users/:userId/revoke` (tenant admin, `qms` write): revoke someone else's; two-tenant test.

**Apply** (each requires the signer's active e-signature, else 409 `ESIG_NONE` "Create your e-signature first, in Profile → E-signature."; each re-authenticates):
- `POST /calibration-records/:id/esignatures` `{ meaning, authMethod, credential }`. `performed` only by the record's `performedBy` (403 `ESIG_NOT_PERFORMER`); `reviewed` by anyone else with calibration write. Refusals: 409 `CALREC_VOIDED`, `CALREC_SUPERSEDED` + `headId`, `CALREC_EXTERNAL` (external lab or imported), `ESIG_ALREADY_APPLIED`. Each 409 is a state explanation.
- `POST /certificates/:id/esignatures` `{ meaning, authMethod, credential }`. `performed`: the certificate's `calibratedBy`. `approved`: its `approvedBy`/`signedBy`, once the certificate has reached that state; otherwise 409 with the state ("this certificate is in `draft`…"). **The certificate's existing approve and sign steps also apply the actor's e-signature automatically when they have one** (meaning `approved`), in the same transaction as the step. Without one, the step still works exactly as today, and the certificate shows no specimen. Nothing in the certificate flow is ever blocked for lack of an e-signature.
- `POST /esignature/documents` `{ title, contentHash, sizeBytes, meaning, authMethod, credential }`: sign any file by hash.

**Read:**
- `GET /calibration-records/:id/esignatures` and `GET /certificates/:id/esignatures`: the applications, each with `verifyUrl`, `specimenSvg`, the signer snapshot and an `integrity` field (the content hash recomputed now: `intact` \| `changed`). Two-tenant tests.
- `GET /esignature/me/applications`: what I have signed (paged; `data` + top-level `meta`).

**Public, no `auth`** (a reviewed `public` exemption, in the two-tenant allow-list, a `requestBudget` pair like the IPM verification):
- `GET /public/esignatures/:applicationId?token=`. A malformed, unknown or mismatched link returns one identical 404 (constant-time comparison, reviewed `skipTenantScope`). The verdict is the field to branch on:
  - `valid`: the signature verifies under the stored public key and, for record and certificate types, the content hash recomputed now matches.
  - `content_changed`: the signature verifies but the content no longer hashes to the stored value. Tamper signal: log it at warn and count it.
  - `invalid`: the cryptographic check fails.
  - For `document` the verdict is `valid` or `invalid` (the server has no file), plus the browser-side comparison.
  - Beside the verdict: `esignatureState` (`active` \| `superseded` \| `revoked` + day) and, for records and certificates, `documentState` (`current` \| `superseded` \| `voided`).
- **Shown:** verdict and explanation (ID/EN keys), signer snapshot, specimen SVG, key fingerprint and public key PEM (offline verification), meaning, `signedAt`, organisation display name, document type and title, `contentHash`, and the canonical content for records and certificates (so the browser can recompute it), with a minimal record or certificate summary (device name, brand, model, serial; dates; compliant).
- **Never shown:** e-mail, IP, user agent, the token, internal ids beyond those inside the canonical content.
- Headers: `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

## 5. Frontend

- **Profile → E-signature** (every user): draw on a canvas (pointer and touch; clear and redo) or upload an image; preview; save with password or MFA. Shows the fingerprint, the version history, "Replace" and "Revoke".
- **Calibration record detail:** an "E-signature" panel with the applications (specimen, name, role, meaning, time, integrity badge, verify link, QR), a **Sign** button (meaning, then credential) for the performer or a reviewer, and the `ESIG_NONE` explanation with a link to the profile.
- **Certificate:** in the frontend renderer's signature blocks (calibrated by / approved by), place each applicable application's **specimen**, name, role and date, plus a small verification QR. A block with no application stays as today. Signing panel as on the record. The certificate's own verification (`/verify`) is unchanged and links to the e-signature verifications.
- **Sign a document** (`/esignature/documents`): drop a file (hashed in the browser, never uploaded), give a title, choose a meaning, sign. The result offers the verify link, the QR, and a printable "signature sheet" (specimen, details, QR) to attach to the paper document.
- **Public page `/s/[id]?t=`** (server-rendered under the nonce CSP, ID/EN, noindex, **exactly one `<main>` and one `<h1>`**): the verdict as the heading, the details, the specimen rendered as sanitised SVG (no `dangerouslySetInnerHTML` of unsanitised input; render the paths, or use an `<img>` with a data-URI), a "check it yourself" section (recompute the canonical hash with Web Crypto; for `document`, drop the file), and the bundle budget kept.

## 6. Gates, docs, record

- OpenAPI modules for every route; Zod schemas in contracts; `openapi:check` and `openapi:lint` pass.
- Per-card gates (scoped): lint clean on changed files; typecheck; `npm run ratchet`; `load:check`; jest `--findRelatedTests` with changed files at 100%; contracts at 100%; the live suite of migration 0149 on PostgreSQL 18 as `callibrator_app`; frontend jest for new components and pages; `next build` within budget. `routePermissionGuard` and `twoTenantRoutes.guard` pass.
- Docs: `docs/BACKEND/13-UPSTREAM-MODULES.md` and a user guide section in `docs/UPSTREAM/13-USER-GUIDES-ID.md` ("Membuat e-signature", "Menandatangani rekaman kalibrasi, sertifikat dan dokumen"). ADR-140 records the alternatives considered: the tenant key instead of personal keys; storing the uploaded document; extending the generic workflow tables; the visual specimen only, without a key. Its implications, including the bad ones, include: server-held private keys are not a qualified electronic signature (PSrE/BSrE) under Indonesian law; KMS loss means no new applications, but verification still works from the stored public keys.
- Record, CHANGELOG, MEMORY-INDEX, PROGRESS (Phase 21: 15 cards) in the same commit.

## 7. Out of scope (stated so nobody rounds it up)

Qualified certificates from an Indonesian CA (PSrE), or the user holding their own private key (device or passkey signing); multi-party signing workflows (the generic `/esignature/workflows` stays as it is); stamping the specimen into an uploaded PDF's bytes; offline signing; signing imported records from the previous system.
