# 07 — Certificate Pipeline

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

## PDF Rendering

puppeteer, from HTML templates in `backend/src/templates`.

Two operational facts that produce late failures:

**1. The bundled Chromium is unavailable in a compiled binary.** `PUPPETEER_EXECUTABLE_PATH` must point at a system browser. The Docker runtime image installs `chromium` and `fonts-liberation` and sets it; outside Docker it must be set by hand.

**The failure happens at first PDF, not at startup** — a late failure in a compliance-critical path. The API must surface it as a clear error rather than a silent missing download.

**2. Templates are read from disk next to the binary** via `appPath()`, not from the embedded snapshot. The Dockerfile copies `src/templates` explicitly. Omitting that copy produces an API that starts fine and fails on the first certificate.

## The QR Code

Encodes `CERT_VERIFY_BASE_URL/<certificateNumber>`.

It exists to be scanned **off paper**, by someone holding a phone who has never used this software. That is the whole verification journey.

## Public Verification

`GET /api/v1/certificates/verify/:certificateNumber` — **no authentication**.

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
| PDF rendering fails **loudly** when Chromium is absent |

The last one is worth writing deliberately: it is the failure that otherwise reaches a customer as a missing download.
