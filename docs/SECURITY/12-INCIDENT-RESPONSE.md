# 12 — Incident Response

Technical recovery: [`../ARCHITECTURE/09-DISASTER-RECOVERY.md`](../ARCHITECTURE/09-DISASTER-RECOVERY.md) and [`../DEVOPS/08-ROLLBACK.md`](../DEVOPS/08-ROLLBACK.md). This document is the security incident process.

---

## Severity

| Level | Definition | Examples |
|---|---|---|
| **SEV-1** | cross-tenant data exposure, evidence integrity compromised, operator credential compromise | one tenant saw another's data; `audit_logs` altered; `SUPERADMIN` compromised |
| **SEV-2** | personal data exposure within one tenant, authentication bypass, secret leaked | a permission gate missing on a route; a key committed |
| **SEV-3** | availability, degraded control, abuse | Redis outage disabling brute-force protection; a scanner failing open |
| **SEV-4** | hygiene | a dependency advisory with no reachable path |

**Any suspected cross-tenant exposure is SEV-1 until proven otherwise.** Not "until investigated" — until *proven* otherwise. The default assumption while a SEV-1 is open is that it happened.

## The First Hour

```
1. Declare.  Name a single incident lead. One lead, always.
2. Preserve. Snapshot the database and logs BEFORE changing anything.
3. Contain.  Revoke sessions, disable the account, block the path.
4. Assess.   Scope from audit_logs — what, whose, how much, how long.
5. Communicate. Internal first. External on the evidence, not the fear.
```

### Preserve before you fix

The instinct is to fix it. **Snapshot first.**

`audit_logs` is append-only and continuous, which makes it the primary evidence — but a fix that deletes rows, rotates a key, or restarts a container can destroy the context that explains *how*, and "we fixed it but cannot say what happened" is not an answer a regulator accepts.

### Containment actions available

| Action | Endpoint or mechanism |
|---|---|
| Revoke one session | `POST /api/v1/sessions/:id/revoke` |
| Revoke all sessions for a user | `POST /api/v1/sessions/user/:userId/revoke-all` |
| Disable a user | `users.isActive = false` |
| Suspend a tenant | `POST /api/v1/tenants/:tenantId/suspend` — **see the trap below** |
| Revoke an API key | `DELETE /api/v1/api-keys/:id` |
| Disable a webhook | `PATCH /api/v1/webhooks/:id` |
| Rotate JWT secrets | invalidates every session |
| Block at the edge | nginx, or the IP allowlist — **see the trap below** |

### Two containment actions that can lock you out

**Suspending the default tenant** suspends the super-admin who lives in it (BR-3), including the request that would reverse it. Recovery is a direct database update. Confirm which tenant you are suspending.

**Setting an IP allowlist** can exclude yourself. There is no in-product recovery.

Both are the same shape: an administrative action that removes the ability to undo it. Under incident pressure is exactly when they get used carelessly.

## Scoping From the Audit Trail

`audit_logs` answers the questions that matter, and it is queryable at `GET /api/v1/audit`:

| Question | Filter |
|---|---|
| What did this actor do? | `userId` plus a date range |
| What happened to this record? | `resourceId` |
| What data left the system? | `action = EXPORT` |
| Was there activity from an unexpected address? | `ipAddress` |
| Which approvals were made? | `action = APPROVE` |

`EXPORT` is the exfiltration signal. Knowing who extracted what, and when, is why that action exists as its own enum value.

## Playbooks

### Suspected cross-tenant exposure — SEV-1

```
1. Snapshot. Do not deploy a fix yet.
2. Identify the path: raw SQL? vector search? a cache key? a missing predicate?
3. Determine reach — which tenants, which tables, how long the window was open.
4. Contain: disable the endpoint if it can be disabled without wider damage.
5. Fix, with a two-tenant test that fails before the fix and passes after.
6. Sweep for the same shape elsewhere — a missing predicate is rarely unique.
7. Notify affected tenants. GDPR Article 33: 72 hours where personal data is involved.
8. Record in MEMORY/, naming the mechanism, not just the symptom.
```

Step 6 is the one most often skipped. The places to look: every `sequelize.query`, every `skipTenantScope`, every `isSystemTask`, every cache key, the search union, and `document_chunks` retrieval.

### Leaked secret — SEV-2

```
1. Rotate immediately, if it is rotatable.
2. Assess exposure: how long, where, who could have seen it.
3. Check audit_logs for use of the credential.
```

**Two secrets are effectively not rotatable**, and the plan must account for that before it is needed:

| Secret | Why |
|---|---|
| `CERT_SIGNING_SECRET` | rotating breaks verification of every certificate issued under the old key |
| `ENCRYPT_KEY` | rotating requires decrypting and re-encrypting every wrapped value |

There is no rotation procedure for either today. Designing one is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md), and it is the kind of thing that is cheap to design in advance and impossible to improvise.

### Compromised operator account — SEV-1

`SUPERADMIN` bypasses every permission check and every tenant predicate. There is no second gate.

```
1. Revoke all sessions for that user.
2. Disable the account.
3. Rotate JWT secrets — invalidates everything, everywhere.
4. Scope from audit_logs: every action, every tenant, the full window.
5. Assume cross-tenant reach until the trail shows otherwise.
6. Enforce MFA for level 10 before restoring access.
```

Step 5 is the default because step 6 has not been done yet — MFA is available and not enforced (PR-3).

### Evidence integrity — SEV-1

Any suggestion that `audit_logs` or `calibration_records` were altered.

```
1. Snapshot. This is now potentially a regulatory matter.
2. Compare against the last known-good backup.
3. Determine whether the application role has UPDATE or DELETE on the table
   — testing AS THE APPLICATION ROLE, not as the owner.
4. Involve compliance, and the affected tenant, early.
```

`calibration_records` is `paranoid` with `PUT` and `DELETE` routes, so alteration is *possible* by design gap rather than only by compromise (PR-2). That has to be part of the assessment rather than a surprise during it.

### Redis outage — SEV-3, with a tail

Redis coming back is **not** the end of the incident.

| During the window | Consequence |
|---|---|
| brute-force counters unavailable | login attempts were unthrottled |
| idempotency claims unavailable | duplicate emails, webhook deliveries and job side effects were possible |
| WebAuthn challenges unavailable | ceremonies failed |

The window needs **reviewing**, not assuming: check for duplicate webhook deliveries, duplicate notifications, and repeated failed logins that would normally have locked an account.

## Communication

| Audience | When | Content |
|---|---|---|
| Internal | immediately | facts, not speculation |
| Affected tenant | as soon as reach is established | what, whose, when, what we are doing |
| Supervisory authority | within 72 hours where personal data is involved | GDPR Article 33 |
| All customers | if trust in the platform is affected | |

Say what is known and what is not. "We are still determining scope" is a real answer; a confident wrong number is not, and it will be quoted back.

## After

Every SEV-1 and SEV-2 gets a record in [`../../MEMORY/records/`](../../MEMORY/records/) with:

- what happened, and the **mechanism** — not just the symptom
- how it was found, and whether a control should have caught it
- the fix, and the test that now fails without it
- what was **not** determined, stated plainly
- follow-ups, in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) so they have a consequence rather than only a mention

### Honesty rules

From [`../../MEMORY/README.md`](../../MEMORY/README.md), and they apply hardest here:

- **Record failures.** An abandoned approach and a control that did not fire are the highest-value entries.
- **Never claim a security test passed without naming it.**
- **Do not retroactively edit a record to look better.** Add a follow-up instead.

## Prevention Loop

An incident that produces only a fix will recur. Each one should produce at least one of:

| Output | Example |
|---|---|
| A test that fails without the fix | the two-tenant test for the leaked path |
| A **mechanism**, not a rule | a build guard failing any route without a permission gate |
| A monitoring signal | alert on `EXPORT` volume, or on lockout rate |
| A documentation change | this folder, amended through the deviation protocol |

A rule that depends on someone remembering is not a control. That is the whole argument for making tenant isolation a global hook rather than a code-review checklist, and the same reasoning applies to every follow-up written here.
