# Phase 3 — Calibration, Devices and Certificates

**Status: ✅ DONE**, with the project's most consequential open gap.

Written retrospectively. This is the domain core — if a change threatens anything here, it needs an ADR before it needs a branch.

---

### P3-01 — Device catalogue

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/PLAN/06-DEVICE-LIFECYCLE.md` · `docs/DATABASE/06-DEVICE-TABLES.md` |

**What shipped:** `calibration_devices` with identity, status, location, interval, uncertainty budget, reading tolerance, IoT fields and a derived recommendation.

**`nextCalibrationDate` is indexed** because every scheduler query, dashboard tile and overdue report filters on it. It is the most-queried column in the system.

**Overdue does not change status** (BR-11). Passing the due date is a **computed reportable state**, not a stored one — a device can be `active` and overdue at once, and the UI shows both badges. The platform makes the fact impossible to miss; the decision to stop using an overdue defibrillator belongs to the facility.

**⚠ Open gap — P6-06.** `serialNumber` is `unique: true` on the column, making it **globally unique across all tenants**. Two hospitals cannot both register the same manufacturer serial, and a uniqueness failure reveals that another tenant holds it — a weak cross-tenant oracle.

**`iotDeviceToken` is a credential.** It must never appear in a list response; a token in the device register is a leak to everyone who can read it.

---

### P3-02 — Calibration records

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/PLAN/07-CALIBRATION-PROGRAM.md` · `docs/DATABASE/07-CALIBRATION-TABLES.md` |

**What shipped:** `calibration_records` with `performedBy`, `calibrationDate`, `standard`, `results` (JSONB), `measurementUncertainty`, `isCompliant` and `notes`.

**`performedBy` is set from `req.user.id`, never from the body.** Attribution a client can set is not attribution.

**`results` is JSONB** because an infusion pump, a defibrillator and a centrifuge do not have comparable measurement points. A normalised measurement table that fits all three fits none well. The accepted cost: the database cannot validate measurement structure.

**`measurementUncertainty` is mandatory** because a measurement without one is not a measurement, it is a number. "35.2 °C" tells an auditor nothing; "35.2 ± 0.3 °C against a tolerance of ± 0.5 °C" does.

**`isCompliant` is an explicit human judgement**, never inferred from the results — within tolerance depends on the uncertainty budget and on conditions the form does not model.

**A failed calibration does not auto-create a work order.** It may mean the device is broken, or the reference standard drifted, or the technician erred. Only a person can tell which.

---

### P3-03 — Scheduling

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** `/calibration-scheduler` with due, overdue and upcoming, plus the sweep.

**`nextCalibrationDate` is recalculated on the calibration write, not by a nightly job**, so the due date is never stale relative to the record that determines it. A date computed by a sweep is wrong for the window between the calibration and the sweep — which is exactly when someone asks whether the device is current.

Devices in `inactive`, `maintenance` or `retired` are excluded. An out-of-service device is not overdue; it is out of service.

**Interval recommendations are proposals.** `recommendedCalibrationInterval` carries `recommendationReason`, because a bare number nobody can justify gets ignored — and changing an interval is a quality decision with regulatory weight. The system proposes; a human disposes.

---

### P3-04 — Certificates

| | |
|---|---|
| **Status** | ✅ DONE — **after a defect that made approval unreachable** |
| **Spec refs** | `docs/BACKEND/07-CERTIFICATE-PIPELINE.md` · `docs/API/08` |

**What shipped:** 13 endpoints and the state machine.

```
draft ──submit──▶ pending_approval ──approve──▶ approved ──sign──▶ signed ──revoke──▶ revoked
```

**⚠ The defect — ADR-035.** There was **no submit transition at all**, and approving a `draft` threw a plain `Error` that surfaced as a **500**. Approval was unreachable in practice, and the 500 hid the design gap.

Fixed by adding `submitForApproval()`, `POST /:id/submit`, and mapping invalid transitions to **409**.

**A conflict reported as a server error hides a design gap behind a stack trace.** That is why the status code matters here beyond correctness.

**⚠ The second defect.** `GET /certificates` returned **zero rows while rows existed**. Four includes — `device`, `calibratedByUser`, `approvedByUser`, `signedByUser` — defaulted to INNER JOINs, and every draft has null `approvedBy` and `signedBy`. Every draft vanished.

**It was only visible once there was demo data.** An empty database has no drafts to lose.

**Three actor columns stay separate.** Collapsing `calibratedBy`, `approvedBy` and `signedBy` into "last modified by" would destroy the separation-of-duties evidence that is the entire reason there are three transitions.

---

### P3-05 — Signing and public verification

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** detached signatures from per-tenant keys (`tenant_keys`, private keys encrypted with `ENCRYPT_KEY`), `e_signature_records` carrying the 21 CFR Part 11 quartet, PDF rendering with a QR code, and a **public, unauthenticated** verification endpoint.

**The Part 11 quartet** — `meaning`, `authMethod`, `documentHash`, plus actor, IP, user agent and timestamp. `documentHash` is the load-bearing one: without it the record proves someone signed *something*.

**Verification is public by design.** A certificate that can only be checked by someone holding a login is not evidence any third party can rely on. Unknown and tampered return **identical** responses, or the endpoint becomes a certificate-number oracle.

**`CERT_SIGNING_SECRET` cannot be rotated.** Rotating it breaks verification of every certificate ever issued, and the old key cannot be re-derived. A restore that loses it produces a system that **starts cleanly and is permanently broken**. → P6-10, P7-04, P7-05.

**PDF rendering fails at first use, not at startup**, when `PUPPETEER_EXECUTABLE_PATH` is wrong — a late failure in a compliance-critical path.

---

### P3-06 — e-Signature workflows

| | |
|---|---|
| **Status** | ✅ DONE — **beyond the plan** |

**What shipped** (migration `0017`, not in the original scope): multi-party signing independent of certificates — `signature_workflows`, ordered `signature_workflow_steps`, `signature_records`.

**Four step states, not three.** `waiting` means the step is not yet reachable; `pending` means it is this signer's turn. Collapsing them loses the difference between "not yet asked" and "asked and not done" — which is the difference between a workflow that is progressing and one stuck on a person.

**External signers** are supported: `signerEmail` and `signerName` alongside a null `signerId`, for a vendor technician or an external assessor with no account.

**`polygon` and `biometricData` are personal data** — biometric capture characteristics are a special category under GDPR. They belong in the DSAR and retention paths, not treated as inert blobs.

---

### P3-07 — Device and calibration UI

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/UI-UX/12-DEVICE-CALIBRATION-UX.md` |

**What shipped:** `/dashboard/devices`, `/calibration`, `/calibration-scheduler`, `/esignature`, and the public `/verify/[certificateNumber]`.

**The device register is dense; the calibration form is spacious.** Budi records a calibration standing, tired, at the end of a shift — a form crammed to fit above the fold is how a wrong measurement gets typed.

**The verification page is the one screen with a regulatory consequence for a design failure**, and the one nobody who works on the product uses. It is first forgotten in a redesign and last tested, which is why it has its own line in the release checklist.

---

## Phase 3 — Retrospective

**What shipped beyond plan:** multi-party e-signature workflows, public certificate verification, IoT-linked reading tolerance, derived interval recommendations.

**What failed, and what it taught:**

| Failure | Lesson |
|---|---|
| Approval was **unreachable** — no submit transition, and an invalid state threw a 500 | a conflict is a **409**; a 500 hides a design gap |
| The certificate list returned **zero rows** | an optional include without `required: false` is an INNER JOIN — and it was **only visible with data** |

**⚠ The open gap — PR-2, P6-03. The most consequential in the project.**

BR-7 says calibration records are **append-only**. The model is `paranoid`, and the API exposes `PUT` and `DELETE`.

**The guarantee is a service-layer convention, not a constraint.**

Contrast `audit_logs`, protected by having **no delete path at all** — the absence is the control. `calibration_records` has one.

Under 21 CFR Part 11 scrutiny this is the finding an auditor raises first. It is documented in three separate places on purpose: a compliance claim the code does not support is **worse** than a named gap, because it stops anyone looking again.

**What to watch:**

- Any new include on a nullable FK — the certificate defect shape is the most repeated in this codebase
- Any change to the certificate state machine that does not extend the 409 mapping
- Anything that would let a calibration record be edited rather than superseded
