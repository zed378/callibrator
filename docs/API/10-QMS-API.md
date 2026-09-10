# 10 — QMS API

Base: `/api/v1/qms`, `/api/v1/sop`, `/api/v1/risk`, `/api/v1/vendors`, `/api/v1/supplier-scorecard`.

Modules `HDC-QMS` (13), `HDC-VEN` (14).

---

## `/api/v1/qms` — 6 endpoints

### Non-conformances

| Method | Path | Purpose |
|---|---|---|
| POST | `/nc` | raise a non-conformance |
| GET | `/nc` | list |
| PATCH | `/nc/:id` | update |

`non_conformances`: `ncNumber`, `title`, `description`, `status`, `severity`, `reportedBy`, `deviceId` (optional), `dateIdentified`, `rootCause`.

| Field | Values |
|---|---|
| `status` | `OPEN`, `UNDER_INVESTIGATION`, `CAPA_REQUIRED`, `CLOSED` |
| `severity` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |

`CAPA_REQUIRED` is a distinct state from `UNDER_INVESTIGATION`. Investigation has concluded; corrective action is owed and has not been delivered. Collapsing them loses the ability to report on the gap between "we know what went wrong" and "we fixed it", which is exactly the gap an auditor asks about.

### CAPA

| Method | Path | Purpose |
|---|---|---|
| POST | `/capa` | raise a CAPA |
| GET | `/capa` | list |
| PATCH | `/capa/:id` | update |

`capas`: `capaNumber`, `ncId`, `title`, `actionPlan`, `status`, `assignedTo`, `dueDate`, `completedDate`, `approvedBy`, `verificationNotes`.

Status: `DRAFT`, `OPEN`, `IN_PROGRESS`, `VERIFICATION`, `CLOSED`.

`VERIFICATION` sits between doing the work and closing it, and `verificationNotes` plus `approvedBy` record who confirmed it worked. A CAPA that goes straight from `IN_PROGRESS` to `CLOSED` records that someone did something, not that it was effective — and effectiveness is what ISO 13485 asks for.

### Two defects fixed here that generalise

**Envelope deviation.** `GET /nc` and `GET /capa` returned `{ total, ..., nonConformances: [] }` inside `data`. Every frontend list rendered empty, with no error. Fixed to rows in `data`, pagination in a top-level `meta` (see [`00-API-STANDARDS.md`](./00-API-STANDARDS.md)).

**Missing body validator.** `PATCH /nc/:id` with an invalid enum value 500ed, because there was no validator and the bad value reached the database. `qms.validator` now returns 400.

A bad enum reaching the database is always a missing validator, and it always surfaces as a 500 rather than a 400 — which sends the investigation to the wrong layer.

## `/api/v1/sop` — 4 endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | create an SOP |
| GET | `/` | list |
| PATCH | `/:id/publish` | publish |
| POST | `/:id/acknowledge` | acknowledge training |

`sop_documents`: `documentNumber`, `title`, `version`, `contentUrl`, `status` (`DRAFT`, `UNDER_REVIEW`, `PUBLISHED`, `ARCHIVED`), `authorId`, `publishedDate`, `requiresTraining`.

`sop_training_acknowledgments`: `documentId`, `userId`, `acknowledgedAt`, `status` (`PENDING`, `COMPLETED`).

Publishing an SOP with `requiresTraining` creates a pending acknowledgement for every user who must read it. That table is the personnel-competence evidence ISO 17025 and ISO 13485 both require, and the thing an auditor asks for when they ask "how do you know your staff read this".

Same envelope defect as QMS — `GET /` returned `data.documents` and rendered empty. Fixed.

**Note there is no delete.** SOPs are archived (`status: ARCHIVED`), not removed. A withdrawn procedure still has to be producible, because work was done under it.

## `/api/v1/risk` — 5 endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | create |
| GET | `/` | list |
| GET | `/:id` | one |
| PUT | `/:id` | update |
| DELETE | `/:id` | soft delete |

`risks`: `title`, `description`, `category`, `severity` (INTEGER), `likelihood` (INTEGER), **`rpn` (VIRTUAL)**, `status`, `mitigationPlan`, `identifiedBy`, `assignedTo`, `dueDate`.

`rpn` is computed from `severity` and `likelihood`, never stored (BR-12). A stored RPN can disagree with its own inputs after an edit, and there is then no way to tell which is right.

### The invisible-risks defect

Risks with no assignee were invisible: absent from the list, 404 on get, update and delete.

Cause: `getRisks` and `getRiskById` included the optional `identifier` and `assignee` associations without `required: false`, and the `User` model carries a `defaultScope`. Both became INNER JOINs, and every risk without an assignee was dropped.

This is the same trap as the certificate list ([`08-CERTIFICATE-ESIGNATURE-API.md`](./08-CERTIFICATE-ESIGNATURE-API.md)). It is the most repeated defect shape in this codebase.

## `/api/v1/vendors` — 6 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | list |
| GET | `/:vendorId` | one |
| POST | `/` | create |
| PATCH | `/:vendorId` | update |
| DELETE | `/:vendorId` | soft delete |
| PATCH | `/:vendorId/qualify` | set qualification status |

`vendors`: `name`, `type` (`CalibrationLab`, `PartsSupplier`, `Other`), `contactPerson`, `email`, `phone`, `address`, `rating`, `approvalStatus` (`APPROVED`, `PENDING`, `REJECTED`, `CONDITIONAL`), `scorecard`, `lastAuditDate`, `nextAuditDate`, `status` (`Active`, `Inactive`).

`CONDITIONAL` is a real state, not a fudge: a supplier approved for one category of work and not another, or approved pending a corrective action. Forcing it into `APPROVED` or `REJECTED` loses the condition, and the condition is the whole content of the decision.

`nextAuditDate` drives the supplier-audit schedule the same way `nextCalibrationDate` drives the device one.

## `/api/v1/supplier-scorecard` — 5 endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | record an evaluation |
| GET | `/` | list |
| GET | `/:id` | one |
| PUT | `/:id` | update |
| DELETE | `/:id` | soft delete |

`supplier_scorecards`: `vendorId`, `evaluationDate`, `qualityScore`, `deliveryScore`, `serviceScore`, **`overallScore` (VIRTUAL)**, `status`, `comments`, `evaluatedBy`, `nextEvaluationDate`.

`overallScore` is derived from the three component scores, for the same reason `rpn` is (BR-12).

Three components rather than one number because "this vendor is a 7" is not actionable. A vendor scoring well on quality and badly on delivery needs a different conversation from one scoring the reverse.

## Permissions

| Menu group | Write | Read |
|---|---|---|
| `qms` | `SUPERADMIN`, `HEALTHCARE ADMIN`, `CALIBRATOR ADMIN` | `ENGINEERING MANAGER` |
| `sop` | same | `ENGINEERING MANAGER` |
| `risk` | `SUPERADMIN`, `HEALTHCARE ADMIN`, `CALIBRATOR ADMIN` | `ENGINEERING MANAGER` |
| `supplier-scorecard` | `SUPERADMIN`, `HEALTHCARE ADMIN` | `CALIBRATOR ADMIN`, `ENGINEERING MANAGER` |

## Frontend

`/dashboard/qms`, `/dashboard/sop`, `/dashboard/risk`, `/dashboard/supplier-scorecard`. Services: `qms.service.ts`, `sop.service.ts`, `risk.service.ts`, `supplierScorecard.service.ts`.
