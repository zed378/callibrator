# 05 — User Flows

Screen-level flows. System-level sequences are in [`../PLAN/05-USER-FLOW.md`](../PLAN/05-USER-FLOW.md); the longer arcs are in [`04-USER-JOURNEYS.md`](./04-USER-JOURNEYS.md).

---

## Sign in

```
/login
  ├─ tenant-pinned build? → branding already rendered (GET /tenants/public)
  ├─ email + password
  ├─ MFA enabled? → challenge screen → code → token
  ├─ WebAuthn registered? → passkey prompt as an alternative
  └─ success → GET /menu-groups → sidebar built → /dashboard
```

Failure states, each distinct on screen:

| State | Message |
|---|---|
| Bad credentials | uniform, never revealing whether the account exists |
| Locked | says it is locked and roughly for how long |
| Suspended tenant | says the organisation account is suspended — not "invalid credentials" |
| Rate limited | says to wait, with the window |

The suspended-tenant case must not be disguised as bad credentials. The user cannot fix it and needs to know who can.

## Record a calibration

```
/dashboard/calibration → New
  ├─ device picker: search by name or serial, case-insensitive, partial
  ├─ prefilled: standard, interval, uncertainty budget from the device
  ├─ entry: results, measurementUncertainty, isCompliant, notes
  ├─ save
  └─ confirmation shows the NEW nextCalibrationDate
```

Showing the recalculated due date on save is the confirmation that matters — it is the thing the whole record exists to move.

**No edit path.** Records are append-only (BR-7). The UI states this before the user needs it: a correction is a new record.

## Issue a certificate

```
draft ──[Submit for approval]──▶ pending_approval
      ──[Approve]──────────────▶ approved      (different person)
      ──[Sign]─────────────────▶ signed
      ──[Revoke + reason]──────▶ revoked
```

Each control appears only when the transition is legal **and** the viewer may perform it. Where they can see the screen but not act on this particular certificate, say why — "you cannot approve a certificate you calibrated" is useful; a missing button is not.

An invalid transition returns 409. Surface it as "this certificate is in `draft` and must be submitted first", never as a generic error.

## Transfer stock

```
/dashboard/stock → Transfers → New
  ├─ from warehouse, to warehouse, item, quantity
  ├─ create               → pending
  ├─ [Mark in transit]    → in_transit   ← quantity LEAVES the source
  ├─ [Mark received]      → completed    ← quantity ARRIVES at the destination
  └─ [Cancel]             → cancelled    (from pending or in_transit only)
```

Each transition is confirmed, because quantity moves. The confirmation states what will be true afterwards, not "are you sure".

State is shown as a state. Never inferred from quantities — that is how phantom inventory is recreated.

## Raise a support ticket

```
/dashboard/tickets/raise
  ├─ subject, description  ← plain language, no required taxonomy
  ├─ priority (default Medium), category (optional)
  └─ submit → ticketKey shown, and it is quotable
```

Pak Hendra is a weekly user who does not know the vocabulary. A mandatory category field on a support form is a way of making people give up.

## Answer a support ticket

```
/dashboard/tickets/response          ← cross-tenant; responders only
  ├─ queue, filterable
  ├─ open → history, with internal notes visibly marked
  ├─ reply            → visible to the raiser
  ├─ internal note    → isInternal = true, NEVER shown to the raiser
  ├─ assign
  └─ resolve → close
```

The internal-note distinction must be unmistakable in the compose UI. A note written in the wrong box is a disclosure, and the UI is the only thing standing between the two.

## Verify a certificate — public

```
/verify/[certificateNumber]
  └─ verdict, first and at size:
       VALID  ·  EXPIRED  ·  REVOKED  ·  NOT FOUND
```

No login. No animation. Works on any phone. Identical response shape for "not found" and "signature mismatch" — otherwise it is a certificate-number oracle.

Below the verdict: device, calibration date, valid-until, issuing tenant. Enough for an auditor to match it to the paper in their hand, and nothing more.

## Create a tenant — operator

```
/dashboard/tenants → New
  ├─ name, code, plan, limitSeats, limitStorageMb
  ├─ subdomain is DERIVED from code — display it, do not present it as a choice
  └─ create → then create the first admin user
```

After the first admin exists the tenant is fully usable. Branding, storage, custom domain, OIDC and SCIM are all optional and reachable later.

## Suspend a tenant — operator

```
[Suspend]
  └─ confirmation names the tenant and states:
       "Every user in <name> will be unable to sign in or make any request."
```

**Suspending the tenant you belong to locks you out**, including from reversing it (BR-3). The confirmation must detect that case and refuse, not merely warn.

## Set an IP allowlist — operator

```
PUT /network-security/ip-allowlist
  └─ before applying: does the new list include the caller's current address?
       no → refuse, and say which address would be excluded
```

There is no in-product recovery from locking yourself out. Same shape as tenant suspension: an action that removes the ability to undo it.

## Run a bulk import

```
/dashboard/devices → Import
  ├─ file upload
  ├─ returns a job id — NOT a result
  ├─ /dashboard/batch-jobs shows progress: processedItems / totalItems
  └─ terminates in COMPLETED (with resultUrl) or FAILED (with errorDetails)
```

Synchronous import would exceed the 30-second timeout on any real hospital inventory. The UI must set that expectation at submit — "we will tell you when it is done" — rather than showing a spinner that ends in a 408.

A job stuck in `PROCESSING` is a bug, and the UI should make that visible rather than spinning forever.

## Reach a screen you cannot use

```
route reached (stale menu, revoked permission, bookmark)
  └─ AccessDeniedModal: what happened, and a way back
```

The backend refuses independently. This is explanation, not enforcement. A dead end is worse than a refusal.
