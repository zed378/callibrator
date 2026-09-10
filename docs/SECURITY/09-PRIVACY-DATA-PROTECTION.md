# 09 — Privacy and Data Protection

GDPR applies to **platform users** — technicians, supervisors, administrators. The system holds **no patient data**, which is what keeps it outside HIPAA covered-entity scope for its own data ([`../PLAN/00-PROJECT-OVERVIEW.md`](../PLAN/00-PROJECT-OVERVIEW.md) § Non-Goals).

---

## Personal Data Inventory

| Table | Personal data | Notes |
|---|---|---|
| `users` | name, email, phone, avatar, credentials | the primary subject record |
| `sessions` | IP address, user agent, device | behavioural |
| `audit_logs` | actor, IP, user agent, `changes` | **append-only, no delete path** |
| `e_signature_records` | actor, IP, user agent, meaning | Part 11 evidence |
| `signature_records` | `polygon`, **`biometricData`** | special category — easy to forget |
| `consent_records` | IP at time of consent | |
| `calibration_records` | `performedBy` | attribution — the reason erasure anonymises |
| `tickets`, `ticket_comments` | free text | users write anything in free text |
| `posts` | author name, role, avatar | **denormalised deliberately** |
| `notifications` | free text | |

### The two that get missed

**`signature_records.biometricData`** holds capture characteristics — pressure, timing, stroke dynamics. That is biometric data, a special category under Article 9, sitting in a JSON column that nobody thinks of as personal data. A DSAR export omitting it is incomplete; an erasure leaving it is not an erasure.

**`audit_logs.changes`** can contain any field of any mutated row, including personal data. It is append-only with no delete path, so anything that lands there is permanent.

## Lawful Basis and Consent

`consent_records`: `purpose`, **`version`**, `status` (`granted` / `withdrawn`), `ipAddress`, `consentedAt`, `withdrawnAt`.

`version` is the column that makes the record meaningful. Without it the row proves someone clicked agree; with it, it proves **what they agreed to** — which is the question asked at audit, and one that cannot be answered retroactively because the terms change and the old text is gone.

Withdrawal is a **state change, not a delete**. Deleting a withdrawn consent destroys the evidence that consent existed during the period when data was processed under it, which is exactly the period an audit asks about.

## Data Subject Rights

`dsar_requests`: `type`, `status` (`pending`, `in_progress`, `completed`, `rejected`), `details`, `requestedAt`, `completedAt`.

| Right | Article | Type | Implementation |
|---|---|---|---|
| Access | 15 | `export` | batch job assembling subject data → `resultUrl` |
| Rectification | 16 | `rectification` | applied and audited like any mutation |
| Erasure | 17 | `erasure` | **anonymises** — see below |
| Restriction | 18 | `restriction` | flags the data as processing-restricted |
| Portability | 20 | `export` | structured artefact |

`rejected` is a legitimate outcome where an exemption applies, and it must be recorded **with its reason**. Refusing quietly is indistinguishable from ignoring.

## Erasure versus Part 11: the real tension

GDPR Article 17 says erase. 21 CFR Part 11 says the record must remain attributable.

**Resolution: erasure anonymises the actor; it does not delete the evidence.**

```
users row      → name, email, phone, avatar cleared or pseudonymised
               → the row survives, the id survives
calibration_records.performedBy → still resolves, to an anonymised person
certificates.signedBy           → same
audit_logs                      → untouched
```

A calibration record whose `performedBy` resolves to nothing has lost the attribution that made it evidence. Hard-deleting the user destroys the compliance value of every record they touched — which is why users are **never** hard-deleted (`paranoid`, always).

This is a real conflict between two regulatory regimes, resolved in favour of preserving the record and severing the identity. It is a defensible position and it should be stated in the privacy notice rather than discovered by a subject.

## Legal Hold Outranks Retention

A retention purge **must skip anything under legal hold**, regardless of age (BR-16).

A retention policy that outranks a legal hold is a compliance incident, not a feature. The check happens first, before the age comparison, so a policy misconfiguration cannot reach held data.

Legal hold is managed at `/api/v1/tenants/:tenantId/legal-hold`.

## Retention

`data_retention_policies`: per tenant, per `entityType`, with `retentionDays` and `isActive`.

Scheduled by `RETENTION_SCHEDULER` (set to `disabled` to turn it off).

| Table | Retention |
|---|---|
| `iot_readings` | purged — the only high-volume table managed this way |
| `sessions` | expiry sweep |
| `notifications` | purged |
| `webhook_deliveries` | purged after exhaustion |
| **`audit_logs`** | **nothing** — purging requires a compliance decision, not an engineering one |
| `calibration_records`, `certificates` | retained; the regulatory question outlives the device by years |

### The purge defect worth remembering

`POST /:tenantId/purge` returned 500 with `column "tenantId" does not exist`, because the sessions branch used `tenantId` where the `sessions` model attribute is `tenant_id`.

That broke the **nightly retention cron** as well as the endpoint — a scheduled compliance job failing silently every night. Scheduled jobs need their failures surfaced, not just logged.

## Masking and Anonymisation

Two separate operations, at `/api/v1/tenants/:tenantId/mask-pii` and `/anonymize`.

| Operation | Reversible | Use |
|---|---|---|
| Mask PII | in principle | producing a dataset for support or testing |
| Anonymise | **no** | erasure |

Confusing them is how an "anonymised" export turns out to be re-identifiable. If it can be reversed, it is masked, not anonymised.

## Data Location

| Data | Location |
|---|---|
| Database | wherever it is deployed — an on-premise hospital install keeps everything on site |
| Object storage | platform default, or **the tenant's own bucket** |
| LLM | `OPENAI_BASE_URL`, overridable **per tenant** |
| Email | the configured SMTP relay |

The per-tenant LLM key exists precisely so a tenant whose policy forbids sending data to a shared account can point at its own endpoint. That is a data-residency control, not a billing convenience.

A tenant with its own bucket has moved that data outside the platform's storage entirely, which changes who is the processor for it.

## Breach Notification

GDPR Article 33: 72 hours to the supervisory authority for a personal-data breach.

`audit_logs` is the primary evidence — append-only and continuous, so "what happened, to what, by whom, when" is answerable from the data rather than from memory. Its continuity across a restore point is one of the checks in the recovery drill.

See [`12-INCIDENT-RESPONSE.md`](./12-INCIDENT-RESPONSE.md).

## Processing Records

Article 30 requires a record of processing activities. `GET /api/v1/gdpr/processing` serves it.

## Checklist for a Feature Handling Personal Data

- [ ] the field is in this document's inventory
- [ ] it is covered by the DSAR **export**
- [ ] it is covered by **erasure** — anonymised, not orphaned
- [ ] it is covered by a **retention** policy, or deliberately exempt with a reason
- [ ] it is **redacted from logs**, by key-name walk at any depth
- [ ] it is **not serialised into `audit_logs.changes`** unless it must be
- [ ] a lawful basis exists, and where it is consent, `consent_records` carries a `version`
