# 05 — User Flow

End-to-end flows across the whole system. Screen-level detail lives in [`../UI-UX/05-USER-FLOWS.md`](../UI-UX/05-USER-FLOWS.md); this document is the system-level sequence, including what happens server-side at each step.

---

## Flow 1 — Sign-in

```
Browser                     Next.js                    Express API
   │                           │                           │
   │ POST /login ─────────────▶│                           │
   │                           │ POST /api/v1/auth/login ─▶│
   │                           │                           │ rate limit (20 / 15 min)
   │                           │                           │ lookup user by email + tenant
   │                           │                           │ check tenants.status != suspended  (BR-3)
   │                           │                           │ check users.lockedUntil
   │                           │                           │ verify password
   │                           │                           │ on failure: failedLoginAttempts++
   │                           │                           │ on success: reset counter
   │                           │                           │ create sessions row (token hash, IP, UA)
   │                           │                           │ write audit_logs LOGIN
   │                           │◀─ { data, token, session } │
   │◀── token + user ──────────│                           │
   │                           │                           │
   │ GET /api/v1/menu-groups (Bearer) ────────────────────▶│ resolve effective menus (BR-4)
   │◀── menu tree ─────────────────────────────────────────│
   │ render sidebar from the resolved tree                 │
```

The sidebar is **not** a static component with permission checks sprinkled through it. It is rendered from the menu tree the server returned, which is why an unauthorised menu is absent rather than hidden. See [`../FRONTEND/05-RBAC-IN-UI.md`](../FRONTEND/05-RBAC-IN-UI.md).

If MFA is enabled the login response carries a challenge instead of a token, and the client completes it at the MFA endpoint before receiving one. WebAuthn follows the same shape with a credential assertion.

## Flow 2 — Registering a device

```
1. Technician opens /dashboard/devices → New Device
2. Form collects name, serialNumber, manufacturer, model, category,
   locationId (a warehouse), installationDate, calibrationIntervalDays
3. POST /api/v1/calibration-devices
     ├─ dynamicAccess("equipment", "write")   → 403 if the role lacks it
     ├─ Joi validation                        → 400 with field detail
     ├─ tenantScope stamps tenantId           → not taken from the body (BR-1)
     ├─ INSERT calibration_devices
     ├─ nextCalibrationDate = installationDate + calibrationIntervalDays
     └─ audit_logs CREATE with the after-state
4. Device appears in the list, and in the scheduler once it has a due date
```

`tenantId` is never read from the request body. A body-supplied tenant id would be an obvious cross-tenant write; the CLS context supplies it instead.

## Flow 3 — Performing a calibration

```
Technician                                  System
    │
    │ opens /dashboard/calibration → New Record
    │ selects device (list is already tenant-scoped)
    │ enters results, measurementUncertainty, standard, isCompliant
    │
    ├─ POST /api/v1/calibration-records ────▶ validate
    │                                         INSERT calibration_records
    │                                           performedBy = req.user.id  ← attribution
    │                                           results stored as JSONB
    │                                         UPDATE calibration_devices
    │                                           nextCalibrationDate = calibrationDate + interval
    │                                         audit_logs CREATE
    │                                         notification: CALIBRATION
    │◀───────────────────────────────────────  Socket.IO push to the tenant room
```

The record is append-only (BR-7). A wrong result is corrected by writing a new record, not by editing this one.

## Flow 4 — Certificate issue and verification

```
draft ──submit──▶ pending_approval ──approve──▶ approved ──sign──▶ signed ──revoke──▶ revoked
```

| Step | Actor | What happens server-side |
|---|---|---|
| Create | Technician | `certificates` row in `draft`, linked to a `calibration_records` row and a device |
| Submit | Technician | `POST /certificates/:id/submit` → `pending_approval`. Without this step, approve is unreachable (ADR-035) |
| Approve | Supervisor | `POST /certificates/:id/approve` → `approved`, `approvedBy` set. Invalid state returns **409** |
| Sign | Authorised signer | detached signature from the tenant key (`tenant_keys`), `digitalSignature` + `digitalSignatureKeyId` + `signedAt` set; an `e_signature_records` row captures meaning, auth method, document hash, IP, UA (BR-9) |
| Render | System | puppeteer renders the PDF; a QR code encodes `CERT_VERIFY_BASE_URL/<certificateNumber>` |
| Verify | **Anyone, unauthenticated** | the public page resolves the number, recomputes the HMAC with `CERT_SIGNING_SECRET`, and reports valid / invalid / revoked |

Verification is deliberately public and unauthenticated. A certificate that can only be checked by someone with a login is not evidence anyone outside the tenant can rely on.

If a workflow is configured for `resourceType = 'Certificate'`, approval routes through `workflow_instances` and the ordered, role-gated `workflow_steps` instead of the single approve call.

## Flow 5 — Stock transfer between warehouses

```
Warehouse staff                     System                      Supervisor
      │ create transfer ───────────▶ status = pending
      │                              from/toWarehouseId, quantity
      │                                        │
      │                                        │ if a workflow exists for
      │                                        │ StockTransfer → instance created
      │                                        │                        │
      │                                        │◀────── approve ────────┤
      │ mark in transit ───────────▶ status = in_transit
      │                              quantity leaves source (in a transaction)
      │ mark received ─────────────▶ status = completed
      │                              quantity arrives at destination
```

Source decrement and destination increment happen at different transitions and each inside a transaction — never both at once, never neither (BR-10). `cancelled` is reachable from `pending` and `in_transit` only.

## Flow 6 — Maintenance work order

```
Fault reported (human, or an IoT anomaly on iot_readings)
  → maintenance_work_orders row: type Breakdown | Repair | Preventative
                                 priority Low | Medium | High | Critical
                                 status Open
  → assignedTo a technician, optionally vendorId for external service
  → status InProgress → Completed  (or Cancelled)
  → if the outcome indicates a systemic problem:
       non_conformances row → investigation → capas row → verification → closed
```

Preventative orders can be generated from predictive-maintenance signals derived from IoT readings and maintenance history, but a generated order is a proposal for a human, never an automatic action on a device.

## Flow 7 — Tenant onboarding

```
1. SUPERADMIN creates the tenant
     name, code, plan, limitSeats, limitStorageMb
     subdomain is DERIVED FROM code when not supplied  (ADR-036)
     email falls back when not supplied
2. Roles already exist globally (seeded); no per-tenant role creation
3. First tenant admin user created with tenantId + roleId
4. Optional: branding (logo, primaryColor) → the login page can render it
   pre-authentication when the frontend is pinned with NEXT_PUBLIC_TENANT_ID
5. Optional: bring-your-own storage bucket (/dashboard/storage)
6. Optional: custom domain → DNS verification → ACME TLS
7. Optional: OIDC or SCIM wiring for enterprise directory sync
```

Steps 4 through 7 are all independently optional; a tenant is fully usable after step 3.

## Flow 8 — Support ticket

```
Any tenant user (tickets-raise)          SUPERADMIN / responder (tickets-response)
        │ raise ticket ──────────────────▶ tickets row, tenant-scoped
        │   ticketKey from ticket_counters   status open
        │                                             │
        │◀──── comment (isInternal = false) ───────────┤
        │                                             │ internal notes: isInternal = true
        │                                             │   never shown to the raiser
        │ reply ──────────────────────────────────────▶│
        │                              resolvedAt ◀────┤
        │                                closedAt ◀────┤
```

The responder side is **cross-tenant** — it must be, or the platform operator could not answer anyone. `SUPERADMIN` holds `tickets-response` and not `tickets-raise` (BR-13).

## Flow 9 — GDPR data subject request

```
Subject or admin raises a DSAR
  → dsar_requests: type export | erasure | rectification | restriction
                   status pending
  → export:        batch job assembles the subject data → resultUrl
  → erasure:       checks legal hold FIRST (BR-16), then anonymises or deletes
  → rectification: applies the correction, audit-logged like any mutation
  → restriction:   flags the subject data as processing-restricted
  → status completed, completedAt set
```

Consent is tracked separately and versioned in `consent_records` — `purpose`, `version`, `status` (`granted` / `withdrawn`), with the IP that recorded it. A consent record without a version cannot answer "what were they agreeing to", which is the question that matters at audit.
