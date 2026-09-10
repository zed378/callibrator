# 00 — Project Overview

## What Callibrator Is

Callibrator is a **multi-tenant SaaS platform for hospital medical-device calibration and lifecycle management**. It serves two kinds of organisation that sit on opposite sides of the same transaction:

- **Healthcare facilities** (`HEALTHCARE ADMIN` tenants) — hospitals and clinics that own medical devices and are legally required to keep them calibrated, maintained, and evidenced.
- **Calibration providers** (`CALIBRATOR ADMIN` tenants) — accredited laboratories and service organisations that perform the calibration and issue the certificates.

Both live in the same deployment, isolated from each other by the tenant boundary described in [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md).

## The Problem

A hospital that cannot prove a defibrillator was calibrated within its interval has, for audit purposes, an uncalibrated defibrillator. The evidence *is* the compliance. In practice that evidence is scattered across spreadsheets, paper certificates in a filing cabinet, a maintenance log in one department and a procurement record in another. When an ISO 17025 or KARS auditor arrives, reconstructing "which devices were out of calibration on 14 March, and who signed off on the ones that were" takes weeks and usually produces gaps.

The failure modes that follow are specific:

- **Silent interval drift** — a device passes its due date and nobody is told until an audit or an incident.
- **Unattributable records** — a calibration result exists but nothing binds it to a named, authenticated person at a known time, which fails 21 CFR Part 11.
- **Mutable history** — a spreadsheet row can be edited after the fact, so the record cannot be trusted as evidence.
- **No chain from device to certificate** — the certificate PDF and the measurement data that justify it live in different systems.

## The Solution

Callibrator makes the evidence a by-product of doing the work:

1. **Every device is a first-class record** with a serial number, a location, an interval, and a computed next-calibration date (`calibration_devices`).
2. **Every calibration produces an append-only record** carrying measurement results, measurement uncertainty, the standard applied, and the identity of the person who performed it (`calibration_records`).
3. **Every certificate is generated from that record**, signed, QR-coded, and independently verifiable from a public URL without authentication (`certificates`, see [`07-CALIBRATION-PROGRAM.md`](./07-CALIBRATION-PROGRAM.md)).
4. **Every mutation is audit-logged** with before/after state, actor, IP and user agent, into an append-only table (`audit_logs`).
5. **Every query is tenant-scoped by construction** — not by the developer remembering to add a WHERE clause (see [`../BACKEND/05-TENANT-SCOPING.md`](../BACKEND/05-TENANT-SCOPING.md)).

Around that core the platform carries the operational surface a real facility needs: warehouse and stock control, maintenance work orders, predictive maintenance, a quality management system (non-conformances, CAPA, SOPs, risk register), vendor scorecards, billing and metered usage, a developer API with webhooks, and a support desk.

## Scope at a Glance

| | |
|---|---|
| Backend modules | **33** — see [`../BACKEND/10-MODULE-REFERENCE.md`](../BACKEND/10-MODULE-REFERENCE.md) |
| Mounted route modules | **53** under `/api/v1/*` |
| Database models | **72** |
| Frontend dashboard surfaces | **~60** routes under `/dashboard` |
| Roles | **11 seeded** plus one logical tier (`TENANT_ADMIN`) |
| Compliance targets | ISO 17025, FDA 21 CFR Part 11, ISO 13485, GDPR, KARS, SNARS |

## Non-Goals

Stated explicitly, because each of these has been proposed and deliberately rejected:

- **Callibrator is not a PACS, EMR, or clinical system.** It never touches patient data. That is what keeps it outside HIPAA covered-entity scope for its own data; GDPR still applies to its users — see [`../SECURITY/09-PRIVACY-DATA-PROTECTION.md`](../SECURITY/09-PRIVACY-DATA-PROTECTION.md).
- **Callibrator does not perform measurements.** It records them. IoT telemetry ingest (`iot_readings`) is for trend and anomaly detection, never for producing a calibration result without a human signing it.
- **Callibrator does not issue accreditation.** It produces evidence that an accredited body can audit.
- **Callibrator is not single-tenant-per-deployment.** Tenancy is a first-class runtime concept, not a deployment strategy. A single-tenant *branded frontend* is supported via `NEXT_PUBLIC_TENANT_ID`, but it talks to the same multi-tenant backend.

## Where to Go Next

| Question | Document |
|---|---|
| What must the product do? | [`01-PRODUCT-REQUIREMENTS.md`](./01-PRODUCT-REQUIREMENTS.md) |
| What rules are non-negotiable? | [`02-BUSINESS-RULES.md`](./02-BUSINESS-RULES.md) |
| Who can do what? | [`03-USER-ROLES.md`](./03-USER-ROLES.md) |
| How is it built? | [`../ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md`](../ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md) |
| What is already shipped? | [`../../TASKS/PROGRESS.md`](../../TASKS/PROGRESS.md) |
