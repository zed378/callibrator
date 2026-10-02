# 07 — Certificate Pipeline

> **Language status (as-built 2026-10-02).** The backend's source is **TypeScript, strict** (ADR-038; the toolchain is ADR-087), compiled to CommonJS and run from one `dist/` tree. The only source `.js` file left is the dead `utils/checkMenu.util.js`, awaiting deletion (A-18); `noSourceJs.p924.guard` fails on any other. The **694 `.js` files in the test trees are legacy JavaScript** (682 test files and 12 fixtures and helpers, `src/tests/` and `__tests__/`, counted 2026-10-02), converted opportunistically under P9-26; **all new code, tests included, is TypeScript** (`npm run ratchet` refuses a new `.js` file). The rules are [`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`](../ENGINEERING/04-TYPESCRIPT-STANDARDS.md). Behaviour described here is **as-built** unless marked *target*.

From a calibration record to a publicly verifiable PDF. The compliance-critical path.

Domain rules: [`../PLAN/07-CALIBRATION-PROGRAM.md`](../PLAN/07-CALIBRATION-PROGRAM.md). API: [`../API/08-CERTIFICATE-ESIGNATURE-API.md`](../API/08-CERTIFICATE-ESIGNATURE-API.md).

---

## The Pipeline

```
calibration_records row
      │
      ▼
certificates row  (draft)
      │  submit
      ▼
pending_approval
      │  approve          ← a different person
      ▼
approved
      │  sign             ← tenant key, e_signature_records row
      ▼
signed ──────────────┐
      │  render       │  revoke
      ▼               ▼
   PDF + QR        revoked
      │
      ▼
public verification  (unauthenticated)
```

## The State Machine Lives in the Model

```js
certificate.submitForApproval();
certificate.approve(userId);
certificate.sign(userId, keyId);
certificate.revoke(userId, reason);
```

The model owns which transitions are legal. The service orchestrates the surrounding work — audit row, signature record, notification — inside a transaction.

That split keeps legality in one place rather than repeated at every call site.

### An invalid transition is a 409

Before ADR-035 the model threw a plain `Error` for an invalid transition, and it surfaced as a **500**. Worse, there was no submit transition at all — so approval was **unreachable in practice**, and the 500 hid that.

The fix added `submitForApproval`, a `POST /:id/submit` route, and mapped invalid states to **409**.

**A conflict reported as a server error hides a design gap behind a stack trace.** That is why the status code matters here beyond correctness.

## Three Actor Columns, All Nullable

`calibratedBy`, `approvedBy`, `signedBy`.

Separate on purpose: collapsing them into one "who touched this" column destroys the separation-of-duties evidence, which is the entire reason there are three transitions.

### Their nullability caused the worst list defect in the codebase

`GET /certificates` returned **zero rows while rows existed**. Four includes — `device`, `calibratedByUser`, `approvedByUser`, `signedByUser` — defaulted to INNER JOINs. Every draft has null `approvedBy` and `signedBy`, so every draft vanished.

Fixed with `required: false` on all four. Assume this applies to any include on a nullable FK.

## Signing

```js
await sequelize.transaction(async (t) => {
  const key = await TenantKey.findOne({ where: { keyType: "signing" }, transaction: t });
  const signature = sign(documentHash, decrypt(key.privateKey));

  await certificate.update({
    status: "signed",
    signedBy: userId,
    signedAt: new Date(),
    digitalSignature: signature,
    digitalSignatureKeyId: key.keyId,
  }, { transaction: t });

  await ESignatureRecord.create({
    entityType: "certificate", entityId: certificate.id, userId,
    action: "sign",
    meaning,          // WHY  — stated by the signer
    authMethod,       // password | mfa | sso
    documentHash,     // WHAT  — binds the signature to this document state
    ipAddress, userAgent,
  }, { transaction: t });

  await AuditLog.create({ /* … */ }, { transaction: t });
});
```

**One transaction.** A signature that outlives a failed transition is a signature on nothing.

### The Part 11 quartet

| Column | Without it |
|---|---|
| `meaning` | the record proves a signature happened, not what it asserted |
| `authMethod` | no evidence the identity was established to the required strength |
| `documentHash` | the record proves someone signed **something** |
| actor, IP, user agent, timestamp | no attribution |

`documentHash` is the load-bearing one: it binds the signature to a specific document state, so a later edit is detectable.

### Keys

`tenant_keys.privateKey` is encrypted at rest with `ENCRYPT_KEY` and **never returned by any endpoint**. `GET /esignature/key-pairs` returns public material and metadata only.

**Losing `ENCRYPT_KEY` makes every stored private key undecryptable.** It must be backed up separately from the database.

## PDF Rendering — in the frontend (ADR-095, 2026-09-29)

**The backend renders no PDF.** Until 2026-09-29 it rendered one with puppeteer and a system Chromium, and in
the shipped pkg binary that never worked (ADR-078 D-1: the ES-module puppeteer cannot load from pkg's
snapshot). By owner decision the backend now serves the certificate **document** —
`GET /certificates/:certificateId/document` (every printed field, `verifyUrl`, and `integrity`) — and the
frontend renders the A4 PDF in the browser with jsPDF (`frontend/src/lib/certificatePdf.ts`), with the QR code
and the integrity hash printed on it. Chromium, `fonts-liberation`, `PUPPETEER_EXECUTABLE_PATH` and
`templates/certificate.html` left the backend.

**Integrity is over DATA, never over PDF bytes** — nothing ever hashed the file. Three schemes
(`services/certificateDocument.service.ts`):

- `certificate-canonical-json-v1` — `integrityHash`, printed on every PDF the backend rendered. Unchanged byte
  for byte, so an issued printout still matches its verification page.
- `certificate-content-v2` — printed on every frontend-rendered PDF. Binds every column of the certificate
  row the PDF prints (v1's fields plus summary, conditions, notes, the calibrated/approved/signed-by ids and
  the e-signature value and key id). Names of people, of the device and of the tenant are printed live and
  **not** hashed. Since ADR-107 this is the scheme of a certificate **without** a signing snapshot: a draft,
  pending or approved one, or one signed before ADR-107 (nothing was back-filled).
- `certificate-content-v3` (ADR-107, Q-50) — a certificate signed from ADR-107 on. The sign step stores what it
  prints — the issuer's name, address and contact, the instrument, the three people — in
  `certificates.signed_snapshot` (migration 0103), and the certificate is printed **from that snapshot** from
  then on (`contentAsOf: "signing"`). v3 binds v2's fields plus the snapshot, in a fixed key order
  (PostgreSQL re-orders JSONB keys). A rename or move after signing changes nothing on it; an edit of the
  snapshot changes the recomputed hash.

PDFs stored before the change stay where they were (`uploads/certificates/<random>.pdf`) and stay served:
`GET /:certificateId/pdf` (gated) and the verification capability `documentUrl`. Nothing writes a new one.

## The QR Code

Encodes `CERT_VERIFY_BASE_URL/<certificateNumber>`.

It exists to be scanned **off paper**, by someone holding a phone who has never used this software. That is the whole verification journey.

## Public Verification

`GET /api/v1/certificates/verify/:certificateNumber` — **no authentication**.

**Amended 2026-09-29 (ADR-100, A-293).** Certificate numbers are sequential, so the number alone is not a secret. Every certificate carries a random `verification_token` (192 bits, unique, migration 0096), and the QR encodes `CERT_VERIFY_BASE_URL/<number>?t=<token>` (the API form `?token=`). A lookup **with the right token** returns the full public verdict (device, serial, signer, document); a lookup by the **bare number** — a typed number, or a QR printed before the token existed — returns only the minimal verdict (found / valid / status / revoked / expired / withdrawn, issuing tenant, issue and valid-until dates, the integrity hashes). A wrong token answers exactly like no token. Both are rate limited per address (`certificateVerify`, `certificateVerifyToken`). The pipeline below describes the verdict itself.

```
resolve certificateNumber
  → recompute HMAC with CERT_SIGNING_SECRET
  → compare
  → check status and validUntil
  → VALID | EXPIRED | REVOKED | NOT FOUND
```

Two rules:

**Identical response shape for "not found" and "signature mismatch."** Distinguishing them tells an attacker which certificate numbers exist.

**`certificates(certificate_number)` is indexed.** This is public and therefore the most exposed lookup in the system.

### `CERT_SIGNING_SECRET` cannot be rotated

Rotating it breaks verification of **every certificate ever issued** under the old key, and the old key cannot be re-derived from the data.

A restore that recovers the database and loses this secret produces a system that starts cleanly and is permanently broken — every certificate fails verification, with nothing indicating why.

That is why the disaster-recovery drill asserts that a **pre-incident certificate still verifies** ([`../ARCHITECTURE/09-DISASTER-RECOVERY.md`](../ARCHITECTURE/09-DISASTER-RECOVERY.md)). It is the check that catches a lost-secrets restore before weeks pass.

## Workflow-Gated Approval

Where a `workflows` row exists with `resourceType = 'Certificate'`, approval routes through `workflow_instances` and ordered, role-gated `workflow_steps` instead of the single approve call.

Each decision writes a `workflow_actions` row (`APPROVED` / `REJECTED`, with comments) **in the same transaction** as the step advance.

## Testing

| Assertion |
|---|
| approving a `draft` returns **409**, not 500 and not 200 |
| submit is reachable and required |
| the list returns drafts — the `required: false` regression test |
| signing writes `meaning`, `authMethod` and `documentHash` |
| signing and the transition are atomic — a failed transition leaves no signature record |
| verification: valid, expired, revoked, tampered, unknown |
| **unknown and tampered return identical shapes** |
| verification requires no authentication |
| the document route answers 404 for another tenant's certificate (`certificates.lifecycle.twoTenant.test.ts`) |

The v1 hash is pinned against the original function (`certificateDocument.service.m11.test.ts`): changing it would make every issued printout fail verification.
