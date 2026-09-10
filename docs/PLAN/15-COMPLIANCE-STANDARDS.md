# 15 — Compliance Standards

Four standards shape this system. This document maps each requirement to the mechanism that satisfies it, and states plainly where a mechanism is a convention rather than a constraint.

A control that depends on someone remembering is not a control. Where that is the current state, it says so.

---

## FDA 21 CFR Part 11 — Electronic Records and Signatures

The strictest of the four, and the one that shaped the schema most.

| Requirement | Mechanism | Strength |
|---|---|---|
| **Attributable** — every record traceable to an individual | `calibration_records.performedBy`, `certificates.calibratedBy` / `approvedBy` / `signedBy`, `audit_logs.userId` | schema (NOT NULL) |
| **Legible** — retrievable throughout retention | append-only records, retention policies with legal hold | schema + service |
| **Contemporaneous** — recorded at the time | server-assigned `createdAt`, `audit_logs.createdAt` | schema |
| **Original** — the first capture is preserved | append-only convention (BR-7) | **convention** |
| **Accurate** — validated on entry | Joi validators, database constraints | middleware + schema |
| **Audit trail** — computer-generated, time-stamped, does not obscure prior values | `audit_logs` with before/after in `changes`, no delete path | schema (by absence) |
| **Signature manifestations** — printed name, date, **meaning** | `e_signature_records.meaning` | schema |
| **Signature linking** — bound to the record, not transferable | `e_signature_records.documentHash` | schema |
| **Identity for signing** — two components, or biometric | `authMethod` ENUM `password` / `mfa` / `sso` | schema |
| **Access control** — limited to authorised individuals | RBAC menu-group model, tenant scoping | middleware |

### Where this is weakest

**Originality of calibration records is a service-layer convention, not a database constraint.** `calibration_records` is `paranoid`, so a sufficiently privileged caller can soft-delete a row. `audit_logs` is protected by having no delete path at all; `calibration_records` is not.

Under Part 11 scrutiny this is the finding an auditor would raise first. The fix is a database-level `REVOKE UPDATE, DELETE` for the application role on `calibration_records`, matching what `audit_logs` gets by construction. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

Stating it here rather than omitting it is the point: a compliance document that claims a control it does not have is worse than one that names the gap, because it stops anyone looking again.

## ISO/IEC 17025 — Testing and Calibration Laboratories

| Requirement | Mechanism |
|---|---|
| Measurement uncertainty documented | `calibration_devices.uncertaintyBudget` (JSONB, migration `0009`), `calibration_records.measurementUncertainty` |
| Metrological traceability to reference standards | `calibration_records.standard` |
| Competence of personnel | role model plus `sop_training_acknowledgments` |
| Documented procedures | `sop_documents` — versioned, published, training-gated |
| Handling of non-conforming work | `non_conformances` → `capas` |
| Reporting of results — certificates with required content | `certificates` plus the PDF template |
| Control of records | audit trail, retention policy, legal hold |
| Risk-based thinking | `risks` with severity, likelihood and derived RPN |
| Equipment calibration intervals | `calibrationIntervalDays`, `nextCalibrationDate`, the scheduler |

Uncertainty is the requirement most often under-served by generic asset-management tools, and the reason `uncertaintyBudget` is a first-class device column rather than a note field.

## ISO 13485 — Medical Devices Quality Management

| Requirement | Mechanism |
|---|---|
| Document control | `sop_documents` with version and status |
| Records control | `audit_logs`, retention policies |
| Infrastructure and equipment maintenance | `maintenance_work_orders`, `calibration_devices` lifecycle |
| Monitoring and measuring equipment control | the whole calibration program |
| Non-conformity and CAPA | `non_conformances`, `capas` |
| Supplier evaluation and monitoring | `vendors.approvalStatus`, `supplier_scorecards`, audit dates |
| Risk management across the lifecycle | `risks` |
| Training records | `sop_training_acknowledgments` |

## GDPR

Applies to platform users, not to patients — the system holds no patient data ([`00-PROJECT-OVERVIEW.md`](./00-PROJECT-OVERVIEW.md) § Non-Goals).

| Article | Requirement | Mechanism |
|---|---|---|
| 6, 7 | Lawful basis, demonstrable consent | `consent_records`: `purpose`, **`version`**, `status`, `ipAddress`, `consentedAt`, `withdrawnAt` |
| 15 | Right of access | `dsar_requests` type `export` |
| 16 | Rectification | type `rectification` |
| 17 | Erasure | type `erasure` — checks legal hold first (BR-16) |
| 18 | Restriction of processing | type `restriction` |
| 20 | Portability | export produces a structured artefact |
| 25 | Data protection by design | tenant scoping deny-by-default, encryption at rest for keys and credentials |
| 30 | Records of processing | `audit_logs` |
| 32 | Security of processing | see [`../SECURITY/`](../SECURITY/00-SECURITY-REQUIREMENTS.md) |
| 33 | Breach notification within 72 hours | [`../SECURITY/12-INCIDENT-RESPONSE.md`](../SECURITY/12-INCIDENT-RESPONSE.md) |

`consent_records.version` is what makes a consent record meaningful. Without it the record proves someone clicked agree; with it, it proves what they agreed to. That is the question asked at audit.

Erasure and retention are in genuine tension with Part 11 originality. The resolution: **erasure anonymises the actor, it does not delete the evidence.** A calibration record whose `performedBy` points at nothing is no longer attributable and has lost its evidential value. Anonymisation preserves the record and severs the identity.

## KARS and SNARS — Indonesian Accreditation

The primary market. KARS is hospital accreditation; SNARS is the national standard it implements.

| Requirement | Mechanism |
|---|---|
| Medical equipment inventory, complete and current | `calibration_devices` |
| Evidence of calibration to schedule | `calibration_records`, the scheduler |
| Certificates available for inspection | public unauthenticated verification page |
| Preventative maintenance programme | `maintenance_work_orders` type `Preventative` |
| Incident and non-conformity follow-up | `non_conformances`, `capas` |
| Personnel competence records | `sop_training_acknowledgments` |

Role display names are Indonesian for this reason — Admin Faskes, Teknisi, IPSRS, Penyelia. An accreditation surveyor reads the screen, and a screen in the wrong vocabulary costs time in an assessment where time is the scarce resource.

## Evidence for an Audit

What to hand an auditor, and where it comes from:

| Question | Where |
|---|---|
| Which devices were out of calibration on date D? | calibration compliance report, historical |
| Who performed calibration C, and were they competent? | `calibration_records.performedBy` → user → `sop_training_acknowledgments` |
| Prove certificate X is genuine | the public verification URL — no login needed |
| What changed on record R, when, by whom? | `audit_logs` filtered by `resourceId` |
| Show the CAPA for non-conformance N | `non_conformances` → `capas` chain |
| Show your supplier qualification for vendor V | `vendors.approvalStatus`, `supplier_scorecards` |
| Show your data retention and deletion policy | `data_retention_policies`, `dsar_requests` |

Every one of these is a query against an operational table, not a report someone assembles by hand. That is the design goal of the whole system: evidence as a by-product of doing the work.
