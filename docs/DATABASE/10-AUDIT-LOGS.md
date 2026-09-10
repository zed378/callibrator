# 10 — Audit Logs

`audit_logs`

One table, and the only one in the schema whose most important property is something it **does not have**.

---

## Schema

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | PK |
| `tenantId` | `UUID` | |
| `userId` | `UUID` | the actor |
| `action` | ENUM | `CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `APPROVE`, `EXPORT` |
| `resourceType` | `STRING` | what kind of thing |
| `resourceId` | **`STRING`** | which one — not `UUID` |
| `changes` | `JSONB` | before and after |
| `ipAddress` | `STRING` | |
| `userAgent` | `STRING` | |
| `createdAt` | `DATE` | when |

## What Is Absent, and Why That Is the Point

**`audit_logs` is not `paranoid`. It has no `isDeleted`, no `deletedAt`, and no delete path anywhere in the codebase.**

That absence is the control (BR-6). An audit trail that can be edited or deleted is not an audit trail — it is a log, and a log that the person under investigation could have altered proves nothing.

Every other significant table is soft-deletable. This one is not, deliberately, and any change that adds a delete path here is a compliance regression regardless of how it is justified.

### The mechanism should be the database, not the convention

Currently the protection is architectural — nothing calls destroy, because nothing has a reason to.

The stronger form is a database grant:

```sql
REVOKE UPDATE, DELETE ON audit_logs FROM <application_role>;
```

**Test it as the application role, not as the database owner.** As the owner the test passes whether the grant exists or not, which makes it worse than no test — it produces a green tick for an absent control.

## `resourceId` is a `STRING`

Not a `UUID`, because some audited resources are not UUID-keyed. Composite keys, external identifiers, and settings keys all appear here.

The cost: no foreign key, no referential integrity, and a dangling `resourceId` will not error. That is accepted — an audit row must survive the deletion of the thing it describes, which a foreign key would prevent.

## `changes` — before and after

```json
{
  "before": { "status": "pending_approval" },
  "after":  { "status": "approved", "approvedBy": "…" }
}
```

Both halves. "After" alone records what the row became; the question at audit is usually what it **was**.

### What must never be in `changes`

The diff is written from model attributes, which means a careless implementation will happily serialise a password hash, an MFA secret, an OTP code, a tenant private key, or an S3 credential into a permanently retained, undeletable table.

Redaction happens on the way in, and it must be a key-name walk at any depth rather than a fixed path list — a nested object under an innocuous key is exactly where a secret hides.

A test generated from the redaction key set verifies consistency, never correctness: it cannot catch a key being deleted from the set, because the test derives from the same set. Only an independent list, or a mutation check, catches that.

## The Six Actions

| Action | Written when |
|---|---|
| `CREATE` | a row is inserted |
| `UPDATE` | a row is modified |
| `DELETE` | a row is soft-deleted |
| `LOGIN` | authentication succeeds |
| `APPROVE` | a workflow or certificate transition is approved |
| `EXPORT` | data leaves the system |

`EXPORT` deserves note. Knowing **who extracted what, and when** is itself a compliance requirement — including who exported the audit trail. An audit-log export is audited.

`APPROVE` is separate from `UPDATE` because an approval is a decision, not a field change, and a compliance reviewer filters for decisions.

## Written Inside the Transaction

The audit row is written in the **same transaction** as the action it describes.

An audit row that survives a rolled-back action records something that did not happen. An action that commits without its audit row is unattributable. The transaction is what makes both impossible.

This means `auditLog.middleware.js` and the service transaction have to cooperate — the middleware cannot open its own connection and write independently.

## Query Surface

Exactly one endpoint: `GET /api/v1/audit`, read-only, gated on `security` read.

No create, no update, no delete. The write path is middleware; the read path is a filter over `action`, `resourceType`, `resourceId`, `userId` and a date range.

Large exports run as batch jobs, and are themselves audited.

## Growth

`audit_logs` grows monotonically and, by design, has no delete path.

| Table | Managed by |
|---|---|
| `iot_readings` | retention purge |
| `audit_logs` | **nothing** |

That is not an oversight. Purging audit history requires a **compliance decision**, not an engineering one — and in a 21 CFR Part 11 context the retention period is likely to be measured in years after the last use of the device.

Partitioning by date is the correct engineering answer when volume becomes a problem, because it makes old data cheap to keep rather than necessary to delete. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) as PR-11.

## Relationship to `e_signature_records`

They look similar and are not interchangeable.

| | `audit_logs` | `e_signature_records` |
|---|---|---|
| Records | that a state changed | what a human asserted |
| Carries | before and after | `meaning`, `authMethod`, `documentHash` |
| Written by | middleware, automatically | the signing service, explicitly |
| Answers | what happened to this row | why this person signed, and to what |

An audit row proves an approval was recorded. A signature record proves a named person, authenticated to a stated strength, asserted a stated meaning about a specific document state.

Part 11 requires both. Neither substitutes for the other.

## What an Auditor Asks This Table

| Question | Filter |
|---|---|
| What changed on record R, when, by whom? | `resourceId` |
| Everything this user did in March | `userId` plus a date range |
| Every approval in the period | `action = APPROVE` |
| Who exported data, and what | `action = EXPORT` |
| Was there activity from an unexpected address? | `ipAddress` |

Every one of these is a filtered read on an indexed operational table. That is the design goal: evidence as a by-product of doing the work.
