# 08 — Certificate and Signature Tables

`certificates` · `e_signature_records` · `signature_workflows` · `signature_workflow_steps` · `signature_records`

---

## `certificates` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `calibrationRecordId` | `UUID` | indexed — the evidence this certifies |
| `deviceId` | `UUID` | indexed |
| **`certificateNumber`** | `STRING` | **indexed** — the public identifier |
| `type` | ENUM | `calibration`, `maintenance`, `verification` |
| `status` | ENUM | `draft`, `pending_approval`, `approved`, `signed`, `revoked` — indexed |
| **`calibratedBy`** | `UUID` | nullable |
| **`approvedBy`** | `UUID` | nullable |
| **`signedBy`** | `UUID` | nullable |
| `digitalSignature` | `TEXT` | the detached signature |
| `digitalSignatureKeyId` | `STRING` | → `tenant_keys.keyId` |
| `signedAt` | `DATE` | |
| `issueDate` | `DATE` | indexed |
| `validUntil` | `DATE` | |
| `standard` | `STRING` | |
| `summary`, `conditions`, `notes` | `TEXT` | |
| `filePath`, `fileSize` | `STRING`, `BIGINT` | the rendered PDF |
| `createdBy`, `updatedBy`, `deletedBy` | `UUID` | audit columns |

### Three actor columns, all nullable

`calibratedBy`, `approvedBy`, `signedBy` are separate on purpose. Collapsing them into one "who touched this" column destroys the separation-of-duties evidence, which is the entire reason there are three transitions.

**Their nullability caused the worst list defect in the codebase.** `GET /certificates` returned zero rows while rows existed, because four includes — `device`, `calibratedByUser`, `approvedByUser`, `signedByUser` — defaulted to INNER JOINs. Every draft has null `approvedBy` and `signedBy`, so every draft vanished.

Fixed with `required: false` on all four. Assume this trap applies to any include on a nullable FK.

### `certificateNumber` is the public index

Indexed because `GET /api/v1/certificates/verify/:certificateNumber` is **unauthenticated** and therefore the most exposed lookup in the system.

The verification response must be identical in shape for "not found" and "signature mismatch". Distinguishing them tells an attacker which certificate numbers exist.

### The state machine

```
draft ──submit──▶ pending_approval ──approve──▶ approved ──sign──▶ signed
                                                                     │
                                                                  revoke
                                                                     ▼
                                                                  revoked
```

An invalid transition returns **409**, not 400 and not 500.

Before ADR-035, approving a `draft` threw a plain `Error` and surfaced as a 500 — and there was no submit transition at all, so approval was unreachable in practice. The fix added a `submitForApproval` model method, a `POST /:id/submit` route, and the 409 mapping.

A conflict reported as a server error hides a design gap behind a stack trace.

### `validUntil` versus `status`

`validUntil` passing does not change `status`. An expired certificate is `signed` with a past `validUntil`; the verification endpoint computes expiry.

Same reasoning as device overdue state (BR-11): a derived fact is derived, not denormalised into a status column that can then disagree with its own inputs.

## `e_signature_records`

The 21 CFR Part 11 evidence table.

| Column | Type | Requirement it satisfies |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `entityType`, `entityId` | `STRING`, `UUID` | polymorphic, indexed as a pair |
| `userId` | `UUID` | indexed — who |
| `action` | ENUM | `approve`, `sign`, `revoke` |
| **`meaning`** | `STRING` | signature manifestation — *why* it was applied |
| **`authMethod`** | ENUM | `password`, `mfa`, `sso` — identity components |
| **`documentHash`** | `STRING` | signature linking — *what* was signed |
| `ipAddress`, `userAgent` | `STRING` | attribution context |
| `timestamp` | `DATE` | when |

Added by migration `0011`.

### Why these three columns are the table

An electronic signature recording only "user X signed at time T" does not satisfy Part 11.

| Column | Without it |
|---|---|
| `meaning` | the record proves a signature happened, not what it asserted — approval, authorship, review are different acts |
| `authMethod` | no evidence the identity was established to the required strength |
| `documentHash` | the record proves someone signed *something* |

`documentHash` is the load-bearing one. It binds the signature to a specific document state, so a later edit is detectable.

### Why this is separate from `audit_logs`

An audit row records that a state changed. A signature record records **what a human asserted**. They answer different questions and one cannot substitute for the other.

## `signature_workflows` — `paranoid`

Multi-party signing, independent of certificates.

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `documentId` | `STRING` | indexed |
| `subject`, `message` | `STRING`, `TEXT` | what the signers are asked |
| `status` | ENUM | `pending`, `in_progress`, `completed`, `cancelled`, `expired` — indexed |
| `expiresAt` | `DATE` | |
| `signatureAlgorithm` | `STRING` | |

Added by migration `0017`.

## `signature_workflow_steps` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `workflowId` | `UUID` | indexed |
| `stepNumber` | `INTEGER` | ordering |
| `signerId` | `UUID` | internal user, nullable |
| **`signerEmail`, `signerName`** | `STRING` | external signer with no account |
| `status` | ENUM | `waiting`, `pending`, `signed`, `declined` — indexed |
| `signedAt` | `DATE` | |
| `ipAddress`, `userAgent` | `STRING` | |

### Four states, not three

| State | Meaning |
|---|---|
| `waiting` | not yet reachable — an earlier step is outstanding |
| `pending` | it is this signer's turn |
| `signed` | done |
| `declined` | refused |

Collapsing `waiting` and `pending` loses the ability to tell "not yet asked" from "asked and not done", which is the difference between a workflow that is progressing and one that is stuck on a person.

### External signers

`signerEmail` and `signerName` alongside `signerId` allow a vendor technician or an external assessor to sign without an account. `signerId` null with `signerEmail` populated is the external case.

## `signature_records` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `workflowId`, `workflowStepId` | `UUID` | indexed |
| `userId` | `UUID` | indexed |
| `signatureHash` | `STRING` | |
| `signatureAlgorithm` | `STRING` | |
| `polygon` | `JSON` | drawn signature path |
| `biometricData` | `JSON` | capture characteristics — pressure, timing |
| `authenticationMethod` | `STRING` | |
| `signedAt` | `DATE` | |
| `ipAddress`, `userAgent` | `STRING` | |
| `status` | ENUM | `signed`, `revoked` — indexed |
| `revokedAt`, `revokedBy`, `revocationReason` | | |

### `polygon` and `biometricData` are personal data

Both are optional, and both are personal data under GDPR — biometric capture characteristics especially. They belong in the retention and DSAR paths, not treated as inert blobs that nobody thought about.

A DSAR export that omits them is incomplete. An erasure that leaves them is not an erasure.

## Key Material

`certificates.digitalSignatureKeyId` → `tenant_keys.keyId`. Private keys are encrypted at rest with `ENCRYPT_KEY` and never returned by any endpoint.

**Losing `ENCRYPT_KEY` makes every stored private key undecryptable**, and losing `CERT_SIGNING_SECRET` makes every issued certificate fail public verification with no way to re-derive the old key.

Both must be backed up separately from the database. A backup strategy that captures the data and loses the keys has captured ciphertext — see [`../ARCHITECTURE/09-DISASTER-RECOVERY.md`](../ARCHITECTURE/09-DISASTER-RECOVERY.md).
