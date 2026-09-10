# 12 — Device and Calibration UX

`/dashboard/devices` · `/dashboard/calibration` · `/dashboard/calibration-scheduler` · `/dashboard/esignature` · public `/verify/[certificateNumber]`

The domain core. Budi and Dewi live here ([`03-PERSONAS.md`](./03-PERSONAS.md)).

---

## The Device Register

Dense (P7) — this screen is for scanning to find an exception.

| Column | Notes |
|---|---|
| Serial number | **mono, never truncated** |
| Name | |
| Manufacturer / model | |
| Status | badge |
| **Calibration** | computed badge: current · due soon · **overdue** |
| Next due | date, tabular |
| Location | warehouse, may be empty |

**Two badges, not one.** A device can be `active` **and** overdue simultaneously — overdue is derived from `nextCalibrationDate` at render, never stored (BR-11). Collapsing them loses the distinction between "in service" and "in service but out of interval", which is precisely what an auditor asks about.

### Search must forgive

Serial numbers are printed on labels that get scuffed and typed from memory. Search is **case-insensitive and partial**, across name, serial, manufacturer and model.

An exact-match serial search is the single biggest friction point on Budi's round.

### Filters

Status, category, location, and calibration state (overdue / due in 30 / current). Filter state lives in the URL so a view is shareable — "here is the overdue list" is a message someone sends.

## Device Detail

Tabs, because a device accumulates five kinds of history:

| Tab | Content |
|---|---|
| Overview | identity, status, location, interval, next due |
| Calibration | records, newest first — **read-only, append-only** |
| Maintenance | work orders |
| Telemetry | IoT readings, anomalies highlighted — only when `iotEnabled` |
| Finance | purchase, depreciation, book value |

**`iotDeviceToken` is never displayed in the register list.** It is a credential; a token in a list is a leak to everyone who can read the device register. On the detail screen it is masked with a reveal, and regenerable.

### The interval recommendation

Where `recommendedCalibrationInterval` is set, show it **with `recommendationReason`**.

A bare number nobody can justify gets ignored. Accepting it is an explicit action by someone with the permission, because changing a calibration interval is a quality decision with regulatory weight — the system proposes, a human disposes.

## Recording a Calibration

**Spacious** (P7). This is the one form where a cramped layout produces a compliance defect.

```
device        ← prefilled when arriving from the scheduler or a device
standard      ← prefilled from the device
calibration date, due date
─────────────────────────────
results       ← shape driven by the device uncertaintyBudget
measurementUncertainty
isCompliant   ← explicit, never inferred
notes         ← ambient conditions, deviations
─────────────────────────────
[Save]        ← above the fold, always
```

On save, the confirmation shows the **new `nextCalibrationDate`**. That is the thing the record exists to move, and seeing it change is the confirmation that matters.

### No edit path, and say so early

Records are append-only (BR-7). There is no "edit last entry". The UI states this **before** the user needs it — a correction is a new record that supersedes the old one.

Discovering the rule after typing a wrong value is a bad moment. Discovering it in the form's helper text is not.

### `isCompliant` is explicit

Never inferred from the results. The technician makes the judgement and the system records it, because "within tolerance" depends on the uncertainty budget and on conditions the form does not model.

A failed calibration does **not** auto-create a work order. It may mean the device is broken, or the reference standard drifted, or the technician erred — and only a person can tell which.

## The Scheduler

`/dashboard/calibration-scheduler`.

```
OVERDUE      nextCalibrationDate < today          ← red, first
DUE SOON     within 30 days                        ← amber
UPCOMING     beyond 30 days
```

Grouped, sorted by date within each group. Devices that are `inactive`, `maintenance` or `retired` are **excluded** — an out-of-service device is not overdue, it is out of service.

Each row links straight into the calibration form with the device prefilled. That link is the whole point of the screen: it turns a list into a work queue.

## Certificates

The state machine is the interface.

```
draft ──[Submit for approval]──▶ pending_approval
      ──[Approve]──────────────▶ approved      ← different person
      ──[Sign]─────────────────▶ signed
      ──[Revoke + reason]──────▶ revoked
```

| Rule | |
|---|---|
| Illegal transitions are **absent** | |
| Legal but not yours shows **disabled with the reason** | "you cannot approve a certificate you calibrated" |
| **Submit is presented as a real step** | it was once missing entirely, making approval unreachable (ADR-035) |
| A 409 surfaces as a state explanation | never a generic error |
| Revoke requires a reason | it changes what the public page says |

### Three actors, shown separately

`calibratedBy`, `approvedBy`, `signedBy` are three people on the screen, never collapsed into "last modified by" (P5). That separation is the evidence Dewi's accreditation depends on.

### Signing states the meaning

The signature meaning is recorded (`e_signature_records.meaning`) and must be **shown at the moment of signing**, not buried. The signer is asserting something specific; the UI should say what.

### PDF

`GET /:certificateId/pdf`. Rendering needs a system Chromium (`PUPPETEER_EXECUTABLE_PATH`) and outside Docker it fails at **first use, not at startup**.

Surface that as a clear, actionable error. A silently missing download in a compliance-critical path is the worst available outcome.

## Public Verification

`/verify/[certificateNumber]` — the screen with regulatory consequences, used once by someone who has never seen the product.

```
        ┌───────────────────────────┐
        │                           │
        │         V A L I D         │   ← display size, the largest
        │                           │      thing in the product
        └───────────────────────────┘
   Device        Infusion Pump · IP-2024-00871
   Calibrated    14 Mar 2026
   Valid until   14 Mar 2027
   Issued by     Lab Kalibrasi X
```

| Rule | |
|---|---|
| No login, ever | a certificate only insiders can check is not evidence |
| The **word** carries the message; colour reinforces it | it will be read in poor light, possibly with a colour vision deficiency |
| Four verdicts: VALID · EXPIRED · REVOKED · NOT FOUND | |
| "Not found" and "signature mismatch" render **identically** | otherwise it is a certificate-number oracle |
| No animation, no heavy dependencies | an auditor wants the answer, not a reveal |
| Nothing below the fold that matters | |

Nobody who works on the product uses this screen. It is the first to be forgotten in a redesign and the last to be tested — which is why it has its own line in the release checklist ([`18-UX-ACCEPTANCE-CRITERIA.md`](./18-UX-ACCEPTANCE-CRITERIA.md)).
