# P21-15: The operator's e-signature on a calibration record, verifiable at a public URL

**Card:** P21-15 (Phase 21) · **ADR:** ADR-140 · **Status:** spec, 2026-11-03
**Owner's words (2026-11-03):** "buatkan fitur e-signature yang mana bisa diverifikasi lewat public endpoint"; "bedakan e-signature dengan sertifikat. e-signature digunakan untuk verifikasi data operator yang melakukan kalibrasi."

## 1. What it is, and what it is not

- **It is** the attestation of the person who **performed** a calibration, given on the calibration record itself: "I performed this calibration and these are the results I measured." It binds the signer to a SHA-256 hash of the record's data. Anyone holding the link can check, without signing in, that the data has not changed since it was signed and who signed it.
- **It is not the certificate.** A certificate is the document issued to the customer, approved and signed through the certificate flow (`certificate.service`, the signing key, the `/verify` page, ADR-040). Nothing in the certificate flow changes, and neither requires the other. A record can be signed with no certificate, and a certificate can be issued from an unsigned record. The certificate page may *link* to the record's signature verification, but only as a link.
- **It is not the generic workflow** (`/api/v1/esignature`, `signature_workflows`): that binds a free `documentId` with no content hash, verifies only signed in, and asks a requester to name the signers. The operator's signature has exactly one possible signer, the record's `performedBy`, so it needs no workflow.
- IPM sessions already carry a performer signature with a content hash and a public verdict (P21-04, `inspection_session_signatures`). This card gives a calibration record the same guarantees, following that design wherever it fits.

## 2. Data: `calibration_record_signatures` (migration 0149)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | stamped from context; tenant-scoped model |
| `calibration_record_id` | uuid NOT NULL FK → `calibration_records` | **UNIQUE**: one operator signature per record (a correction is a new record and is signed anew) |
| `signer_user_id` | uuid NOT NULL FK → `users` | = the record's `performed_by`, the authenticated caller |
| `signer_snapshot` | jsonb NOT NULL | `{ name, role, organisation }` at signing; **no e-mail, no phone** (FT-15) |
| `meaning` | varchar(40) NOT NULL | `performed` (the only value now; CHECK) |
| `auth_method` | varchar(10) NOT NULL | `password` \| `mfa` (CHECK) |
| `data_hash` | char(64) NOT NULL | SHA-256 hex of the canonical record data (§ 3) |
| `scheme` | varchar(40) NOT NULL | `calrec-sig-v1-rsa-sha256` |
| `signing_key_id` | varchar(100) NOT NULL | the tenant key (`tenant_keys.key_id`) |
| `signature_value` | text NOT NULL | base64 RSA-SHA256 over the signed payload (§ 3) |
| `signed_at` | timestamptz NOT NULL | server clock, millisecond precision |
| `verification_token` | varchar(64) NOT NULL UNIQUE | 24 CSPRNG bytes base64url, generated server-side (ADR-100). Stored like the IPM report's (G-R3) so the link can be printed again later |
| `ip_address`, `user_agent` | | stored, **never returned** |
| `created_at` | timestamptz | |

- **Append-only**: a trigger refuses UPDATE and DELETE (as 0057/0127). A signature is never edited or withdrawn. When the record is corrected or voided, the public verdict says so (§ 5).
- Grants: `callibrator_app` gets SELECT and INSERT only. A live test as `callibrator_app` proves UPDATE and DELETE are refused.
- The migration must not use a blanket try/catch. Its index lives in the migration, not the model (Am. 3 trap).

## 3. Canonical forms (in `packages/contracts`, so the browser recomputes the same bytes)

`canonicalCalibrationRecordData(record)` returns a JSON array of `[name, value]` pairs, in this fixed order, with every value a string and null rendered as `""`:
`schemeVersion` ("calrec-data-v1"), `tenantId`, `recordId`, `deviceId`, `clientFacilityId`, `calibrationDate` (YYYY-MM-DD), `dueDate`, `standard`, `results` (the JSON with object keys sorted recursively), `measurementUncertainty`, `isCompliant` ("true"/"false"/""), `entryKind`, `performedBy`, `calibrationVendorId`, `externalLabName`, `notes`.
`data_hash = sha256(utf8(that JSON))`.

The **signed payload** is `JSON.stringify` of `[["scheme", …], ["tenantId", …], ["recordId", …], ["dataHash", …], ["signerUserId", …], ["signedAt", ISO ms], ["authMethod", …], ["meaning", …]]`. It is signed with the tenant's current signing key, through `eSignature.service`'s `loadSigningKey`, which must be exported. `loadVerificationKey` verifies, so a rotated or deleted key still verifies while its public half is retained.

Golden-file tests pin both canonical forms in contracts. A change to either is a new `schemeVersion`, never an edit.

## 4. Signing: `POST /api/v1/calibration-records/:id/signatures`

Chain: `auth, denyApiKey, dynamicAccess("calibration", "write"), denyPlatformAuthoring, validateUuid("id"), validate(schema, { from: ["params", "body"] })`. Body: `{ authMethod: "password"|"mfa", credential: string, meaning: "performed" }`. Online only.

In one transaction:
1. Load the record **in context** (another tenant's, a soft-deleted or a missing one: the same 404), `FOR SHARE`.
2. Refuse, each with a top-level `code` and a state explanation:
   - 403 `CALREC_SIGNATURE_NOT_PERFORMER`: the caller is not `performedBy`.
   - 409 `CALREC_VOIDED`: "This record was voided on <day>; a voided record is not signed."
   - 409 `CALREC_SUPERSEDED` + `headId`: "This record was corrected on <day>; sign the latest version."
   - 409 `CALREC_EXTERNAL`: an external-lab or imported record (`entryKind` not a performance by this user, or `performedBy` null): "Records from an external laboratory or the previous system are not signed electronically."
   - 409 `CALREC_ALREADY_SIGNED`: "You signed this record on <day>."
3. Re-enter the credential through `certificate.service#verifySignerCredentials`, exported as needed (Part 11 § 11.200(a); a wrong credential is the existing 401 plus its `SIGNATURE_AUTH_FAILED` row).
4. Compute `data_hash`, then sign.
5. Insert the signature, an **audit row** (`CALIBRATION_RECORD_SIGNED`, entity CalibrationRecord) and an `e_signature_records` row (Part 11 log: `entityType` "CalibrationRecord", `action` "sign", `meaning`, `authMethod`, `documentHash` = `data_hash`), all three in the same transaction. A unique violation on concurrent signing becomes `CALREC_ALREADY_SIGNED`.
6. 201 → `{ data: { signature (no ip/agent), verifyUrl } }`. After commit, emit `calibration:signed` to the tenant room.

`GET /api/v1/calibration-records/:id/signatures` (calibration read) returns the record's signature with `verifyUrl` and an `integrity` field (the hash recomputed now: `intact` | `changed`). `verifyUrl` uses `PUBLIC_APP_URL` if set (frontend page `/s/<id>?t=<token>`), otherwise the API URL, as `ipmVerifyUrl` does.

Both `:id` routes get a two-tenant test asserting 404 (`twoTenantSuite` + `memoryDb`, `@two-tenant` marker).

## 5. Public verification: `GET /api/v1/public/calibration-signatures/:signatureId?token=`

No `auth`. It is a reviewed `public` exemption in `routeGateExemptions` and in the two-tenant allow-list. It uses a `requestBudget` pair like the IPM verification: `calSigVerifyToken` counts every request, and `calSigVerify` counts every non-verdict, in the controller. The signature is resolved by id plus a constant-time token comparison, under the reviewed `skipTenantScope`. A malformed, unknown or mismatched link returns **one identical 404**.

`verdict`, the field to branch on:
- `valid`: the signature verifies and the data hash recomputed now equals `data_hash`.
- `data_changed`: the signature verifies but the record's data no longer hashes to `data_hash`. This is a tamper signal: log it at warn and count it.
- `invalid`: the cryptographic check fails.
- `key_missing`: the signing key's public half is gone.
- plus a `recordState` field, `current` | `superseded` (with the correction day) | `voided`. It is shown beside a `valid` verdict, never in place of one.

Shown, and only this: the verdict and its explanation (ID and EN keys), `signedAt`, `meaning`, the signer snapshot (name, role, organisation), the tenant's display name, a record summary (device name, brand, model, serial number; calibration date; due date; compliant; standard), `dataHash`, the canonical data fields (so the browser can recompute the hash), `scheme`, `signingKeyId`, and the public key PEM (so anyone can verify offline). **Never shown:** e-mail, IP, user agent, internal user ids beyond those inside the canonical data, the token itself, or results beyond the canonical data. Response headers: `Cache-Control: no-store` and `X-Robots-Tag: noindex`.

## 6. Frontend

- **Calibration record detail:** a "Tanda tangan elektronik operator / Operator e-signature" panel.
  - Unsigned record, caller is the performer: a **Sign** button opens a dialog with the meaning statement, then password or MFA code. The submit button stays disabled while the request is pending.
  - Signed record: who signed, when, the integrity badge, the verify link, the QR (made in the browser), and Copy link.
  - A 409 response is shown as its explanation text.
- **Public page `/s/[id]`** (server-rendered under the nonce CSP, ID/EN, `noindex`, one `<main>`, one `<h1>`): the verdict as the main heading, the details from § 5, and a "check it yourself" section that recomputes the SHA-256 in the browser (Web Crypto) from the canonical data and compares it with `dataHash`. It stays within the public page's bundle budget.
- The certificate view does not change, except for one optional link, "Verify the operator's e-signature", shown when the record is signed.

## 7. Contract, docs and gates

- OpenAPI modules for the three routes. Zod schemas in `packages/contracts`. `openapi:check` and `openapi:lint` pass.
- `docs/BACKEND/13-UPSTREAM-MODULES.md` gets a section; the user guide (`docs/UPSTREAM/13-USER-GUIDES-ID.md`, technician) gets "Menandatangani rekaman kalibrasi".
- Per-card gates (scoped, the owner's rule): lint clean on changed files; typecheck; `npm run ratchet`; `load:check`; jest `--findRelatedTests` with changed files at 100%; contracts at 100%; the migration's live suite on PostgreSQL 18 as `callibrator_app`; frontend jest for the new components and page; `next build` within budget. `routePermissionGuard` and `twoTenantRoutes.guard` pass.
- Record, CHANGELOG, MEMORY-INDEX, PROGRESS (Phase 21: 15 cards) in the same commit.

## 8. Out of scope (said so that nobody rounds it up)

Revocation or withdrawal of a signature; a second signer (reviewer countersign) on calibration records; signing many records at once; offline signing; signing imported records from the previous system.
