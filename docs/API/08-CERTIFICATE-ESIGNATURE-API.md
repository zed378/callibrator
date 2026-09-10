# 08 — Certificate and e-Signature API

Base: `/api/v1/certificates`, `/api/v1/esignature`. Module `HDC-CERT` (11).

Domain rules: [`../PLAN/07-CALIBRATION-PROGRAM.md`](../PLAN/07-CALIBRATION-PROGRAM.md).

---

## `/api/v1/certificates` — 13 endpoints

### Public

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/verify/:certificateNumber` | **none** | verify a certificate |

Unauthenticated by design. A certificate that can only be checked by someone holding a login is not evidence any third party can rely on.

The endpoint resolves the number, recomputes an HMAC with `CERT_SIGNING_SECRET`, and reports:

| Outcome | Meaning |
|---|---|
| Valid | signature matches, `validUntil` not passed |
| Expired | signature matches, `validUntil` passed |
| Revoked | status is `revoked` |
| Not found / invalid | no match, or signature mismatch |

It must return the same shape of response for "not found" and "signature mismatch". Distinguishing them tells an attacker which certificate numbers exist.

`certificates(certificate_number)` is indexed because this endpoint is public and therefore the most exposed lookup in the system.

### CRUD

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | list |
| POST | `/` | create in `draft` |
| GET | `/stats` | statistics |
| GET | `/:certificateId` | one certificate |
| PUT | `/:certificateId` | update while in `draft` |
| DELETE | `/:certificateId` | soft delete |

**The list defect worth remembering.** `GET /` once returned zero rows while rows existed. Four includes — `device`, `calibratedByUser`, `approvedByUser`, `signedByUser` — defaulted to INNER JOINs, so any certificate with a null optional actor FK was silently dropped. Every draft has null `approvedBy` and `signedBy`, so every draft disappeared.

Fixed with `required: false` on all four. This is the single most repeated Sequelize trap in this codebase; see [`../BACKEND/00-BACKEND-STANDARDS.md`](../BACKEND/00-BACKEND-STANDARDS.md).

### State transitions

| Method | Path | From → To |
|---|---|---|
| POST | `/:certificateId/submit` | `draft` → `pending_approval` |
| POST | `/:certificateId/approve` | `pending_approval` → `approved` |
| POST | `/:certificateId/sign` | `approved` → `signed` |
| POST | `/:certificateId/revoke` | `signed` → `revoked` |

```
draft ──submit──▶ pending_approval ──approve──▶ approved ──sign──▶ signed
                                                                     │
                                                                  revoke
                                                                     ▼
                                                                  revoked
```

**An invalid transition returns 409, not 400 and not 500.**

Before ADR-035, `approve` on a `draft` threw a plain `Error` and surfaced as a 500 — and there was no submit transition at all, so approval was simply unreachable. The fix added `POST /:id/submit`, a `submitForApproval` model method, and mapped invalid states to 409.

A conflict reported as a server error hides a design gap behind a stack trace. That is why the status code matters here.

### PDF

| Method | Path | Purpose |
|---|---|---|
| GET | `/:certificateId/pdf` | download the rendered PDF |
| POST | `/:certificateId/pdf` | (re)generate |

Rendered with puppeteer from templates in `backend/src/templates`. The QR code encodes `CERT_VERIFY_BASE_URL/<certificateNumber>`.

**In a compiled binary the bundled Chromium is unavailable.** `PUPPETEER_EXECUTABLE_PATH` must point at a system browser. The Docker runtime image installs `chromium` and `fonts-liberation` and sets it; outside Docker it must be set by hand, and the failure appears at first PDF rather than at startup — a late failure in a compliance-critical path.

## Certificate Fields

| Column | Notes |
|---|---|
| `certificateNumber` | indexed, the public identifier |
| `type` | `calibration`, `maintenance`, `verification` |
| `status` | `draft`, `pending_approval`, `approved`, `signed`, `revoked` |
| `calibrationRecordId`, `deviceId` | provenance |
| **`calibratedBy`, `approvedBy`, `signedBy`** | three distinct actors |
| `digitalSignature`, `digitalSignatureKeyId`, `signedAt` | the signature and its key |
| `issueDate`, `validUntil` | validity window |
| `standard`, `summary`, `conditions`, `notes` | content |
| `filePath`, `fileSize` | the rendered PDF |
| `createdBy`, `updatedBy`, `deletedBy` | audit columns |

The three actor columns are separate on purpose. Collapsing them into one "who touched this" column destroys the separation-of-duties evidence, which is the entire reason there are three transitions.

## `/api/v1/esignature` — 11 endpoints

### Key pairs

| Method | Path | Purpose |
|---|---|---|
| GET | `/key-pairs` | list tenant keys |
| POST | `/key-pairs` | generate |
| DELETE | `/key-pairs/:keyPairId` | remove |

`tenant_keys`: `keyId`, `keyType`, `algorithm`, `publicKey`, `privateKey`.

`privateKey` is encrypted at rest with `ENCRYPT_KEY` and must **never** be returned by any endpoint. `GET /key-pairs` returns public material and metadata only.

Losing `ENCRYPT_KEY` makes every stored private key undecryptable, which is why it must be backed up separately from the database (see [`../ARCHITECTURE/09-DISASTER-RECOVERY.md`](../ARCHITECTURE/09-DISASTER-RECOVERY.md)).

### Signing workflows

| Method | Path | Purpose |
|---|---|---|
| GET | `/workflows` | list |
| POST | `/workflows` | create with ordered steps |
| GET | `/workflows/:workflowId` | one |
| PUT | `/workflows/:workflowId` | update |
| DELETE | `/workflows/:workflowId` | delete |

`signature_workflows`: `documentId`, `subject`, `message`, `status` (`pending`, `in_progress`, `completed`, `cancelled`, `expired`), `expiresAt`, `signatureAlgorithm`.

`signature_workflow_steps`: `stepNumber`, `signerId`, `signerEmail`, `signerName`, `status` (`waiting`, `pending`, `signed`, `declined`), `signedAt`, `ipAddress`, `userAgent`.

`signerEmail` and `signerName` alongside `signerId` allow an **external** signer who has no account — a vendor technician, an external assessor.

Four step states rather than three: `waiting` means the step is not yet reachable because an earlier step is outstanding; `pending` means it is this signer turn. Collapsing them loses the ability to tell "not yet asked" from "asked and not done".

### Signing and verification

| Method | Path | Purpose |
|---|---|---|
| POST | `/sign` | apply a signature |
| POST | `/verify` | verify one |
| GET | `/history` | signature history |

`signature_records`: `signatureHash`, `signatureAlgorithm`, `polygon` (JSON), `biometricData` (JSON), `authenticationMethod`, `signedAt`, `ipAddress`, `userAgent`, `status` (`signed` / `revoked`), plus `revokedAt`, `revokedBy`, `revocationReason`.

`polygon` holds a drawn signature path; `biometricData` holds capture characteristics such as pressure and timing. Both are optional, and both are personal data under GDPR — they belong in the retention and DSAR paths, not treated as inert blobs.

## 21 CFR Part 11 Evidence

Every signature event also writes `e_signature_records`:

| Column | Requirement it satisfies |
|---|---|
| `action` | `approve`, `sign`, `revoke` |
| **`meaning`** | signature manifestation — *why* it was applied |
| **`authMethod`** | `password`, `mfa`, `sso` — identity components |
| **`documentHash`** | signature linking — *what* was signed |
| `ipAddress`, `userAgent`, `timestamp`, `userId` | attribution |

`documentHash` is what makes the record meaningful. Without it the row proves someone signed *something*.

These three columns are the reason the table exists separately from `audit_logs`. An audit row records that a state changed; a signature record records what a human asserted.

## Frontend

`/dashboard/esignature` and the public `/verify/[certificateNumber]`.

The verification page must work without a session, without heavy client dependencies, and on whatever browser an auditor happens to have. It is the one public route that is functionally load-bearing.

Client PDF helper: `frontend/src/lib/certificatePdf.ts`.
