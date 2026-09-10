# 07 — Calibration Program

The domain core. If a change threatens anything in this document, it needs an ADR before it needs a branch.

---

## What a Calibration Record Is

A `calibration_records` row is the evidence that a specific device was measured against a specific standard by a specific named person on a specific date, and whether it passed.

| Column | Type | Why it exists |
|---|---|---|
| `deviceId` | `UUID` | what was calibrated |
| `performedBy` | `UUID` → `users.id` | **who** — non-negotiable for 21 CFR Part 11 |
| `calibrationDate` | `DATE` | when |
| `dueDate` | `DATE` | when the result stops being valid |
| `standard` | `STRING` | against what reference standard |
| `results` | `JSONB` | the measurements themselves |
| `measurementUncertainty` | `FLOAT` | the number that makes the result meaningful |
| `isCompliant` | `BOOLEAN`, indexed | pass or fail |
| `certificateNumber` | `STRING` | the certificate this record justifies |
| `certificateFileUrl` | `STRING` | the rendered PDF |
| `notes` | `TEXT` | conditions, deviations, anything a later auditor needs |

`results` is JSONB rather than a normalised measurement table because the shape of a measurement differs by device class — an infusion pump, a defibrillator and a centrifuge do not have comparable measurement points. A schema that fits all three fits none well.

The trade-off is accepted knowingly: JSONB means the database cannot validate measurement structure. Validation lives in the Joi validators and in `uncertaintyBudget` on the device.

## Why Measurement Uncertainty Is Mandatory

A measurement without an uncertainty is not a measurement, it is a number. "35.2 °C" tells an auditor nothing about whether the device is within tolerance; "35.2 ± 0.3 °C against a tolerance of ± 0.5 °C" does.

ISO 17025 requires the uncertainty budget to be documented. That is what `calibration_devices.uncertaintyBudget` (JSONB, added by migration `0009-add-uncertainty-budgets`) is for: the per-device model of contributing uncertainty components, from which `calibration_records.measurementUncertainty` is derived for a given calibration.

## Append-Only (BR-7)

Calibration records are **never edited**. A wrong result is corrected by writing a new record; the original stays, and the audit trail shows both.

This is not fastidiousness. A calibration record that can be edited after the fact has no evidential value at all — an auditor cannot distinguish "this was always the result" from "this became the result once somebody noticed the problem".

**Current gap, stated plainly:** `calibration_records` is a `paranoid` model, so a sufficiently privileged caller can soft-delete a row. The append-only property is enforced by service-layer convention, not by a database constraint, and unlike `audit_logs` it does not have the absence of a delete path to protect it. This is a known divergence between the stated rule and the mechanism, and it is tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Scheduling

`backend/src/services/calibrationScheduler.service.js`, with `calibrationScheduler.middleware.js` for the periodic sweep.

```
For each active device with a nextCalibrationDate:

  nextCalibrationDate <  today            → OVERDUE
  nextCalibrationDate <= today + 30 days  → DUE SOON
  otherwise                               → OK
```

Devices in `inactive`, `maintenance` or `retired` are excluded — an out-of-service device is not overdue, it is out of service.

The scheduler drives:

- the dashboard compliance tiles,
- `CALIBRATION`-type notifications (in-app over Socket.IO, plus email),
- the overdue and forecast reports,
- the `/dashboard/calibration-scheduler` planning view.

`nextCalibrationDate` is indexed precisely because every one of those paths filters on it.

## Certificates

A certificate is the externally-presentable artefact derived from a calibration record.

### State machine (BR-8)

```
draft ──submit──▶ pending_approval ──approve──▶ approved ──sign──▶ signed
                                                                     │
                                                                  revoke
                                                                     ▼
                                                                  revoked
```

Types: `calibration`, `maintenance`, `verification`.

Actor columns are separate on purpose: `calibratedBy`, `approvedBy`, `signedBy`. Collapsing them into one "who touched this" column would destroy the separation-of-duties evidence, which is the point of having three transitions.

**Historical defect worth remembering** (ADR-035): approving a `draft` used to throw a plain `Error` and surface as a 500, and there was no submit transition at all — so approval was unreachable in practice. The fix added `POST /certificates/:id/submit`, a `submitForApproval` model method, and mapped invalid transitions to **409**. A conflict is not a server error, and reporting it as one hides a design gap behind a stack trace.

### Signing

Signing produces a detached digital signature stored on `certificates.digitalSignature` with the key identity in `digitalSignatureKeyId`, referencing a per-tenant key pair in `tenant_keys`. Private keys are encrypted at rest with `ENCRYPT_KEY`.

Every signing event also writes an `e_signature_records` row (BR-9): `action` (`approve` / `sign` / `revoke`), `meaning`, `authMethod` (`password` / `mfa` / `sso`), `documentHash`, `ipAddress`, `userAgent`, `timestamp`.

`documentHash` is what makes the signature meaningful. Without it the record proves someone signed *something*; with it, it proves what.

### PDF rendering

Rendered with puppeteer from templates in `backend/src/templates`. In a compiled binary the bundled Chromium is not available, so `PUPPETEER_EXECUTABLE_PATH` must point at a system Chromium. The Docker runtime image installs `chromium` and `fonts-liberation` and sets the variable; outside Docker it must be set by hand or PDF generation fails at first use rather than at startup.

### Public verification

```
QR code encodes:  CERT_VERIFY_BASE_URL + "/" + certificateNumber
                  e.g. https://app.example.com/verify/CAL-2026-000123
```

The verification page is **public and unauthenticated**. It resolves the certificate number, recomputes an HMAC using `CERT_SIGNING_SECRET`, and reports one of:

| Outcome | Meaning |
|---|---|
| Valid | signature matches, `validUntil` not passed |
| Expired | signature matches, `validUntil` passed |
| Revoked | status is `revoked` |
| Not found / invalid | no match, or signature mismatch |

A certificate that can only be checked by someone holding a login is not evidence any third party can rely on. That is why this endpoint has no auth and why it is on the frontend origin rather than the API origin.

## Approval Workflows

When a `workflows` row exists with `resourceType = 'Certificate'`, approval routes through `workflow_instances` rather than the single approve call: ordered `workflow_steps`, each gated to a `roleId` with a `requiredApprovals` count, recording each decision in `workflow_actions` as `APPROVED` or `REJECTED`.

The same engine serves `StockTransfer` and `MaintenanceWorkOrder` — those three are the entire `resourceType` ENUM.

## Standards This Serves

| Standard | What it demands | How the program answers |
|---|---|---|
| **ISO 17025** | documented uncertainty, traceability to reference standards, competent personnel | `uncertaintyBudget`, `standard`, `performedBy` |
| **FDA 21 CFR Part 11** | attributable, legible, contemporaneous, original, accurate records; signature meaning | append-only records, `e_signature_records`, `audit_logs` |
| **ISO 13485** | device lifecycle control, CAPA | device states, `non_conformances`, `capas` |
| **KARS / SNARS** | Indonesian hospital and metrology accreditation | evidenced calibration intervals, certificate verification |
