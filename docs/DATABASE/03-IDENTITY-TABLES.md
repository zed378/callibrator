# 03 — Identity Tables

`users` · `sessions` · `consent_records`

---

## `users` — `paranoid`

| Group | Column | Type | Notes |
|---|---|---|---|
| Key | `id` | `UUID` | PK |
| Tenancy | `tenantId` | `UUID` | exactly one (BR-2) |
| | `roleId` | `UUID` | exactly one |
| Identity | `username` | `STRING` | indexed |
| | `email` | `STRING` | indexed |
| | `firstName`, `lastName`, `phone` | `STRING` | |
| | `avatarUrl` | `STRING` | |
| State | `isActive` | `BOOLEAN` | indexed |
| | `status` | `STRING` | indexed |
| | `isEmailVerified` | `BOOLEAN` | |
| | `lastLoginAt` | `DATE` | |
| | `isDeleted` | `BOOLEAN` | indexed |
| Lockout | `failedLoginAttempts` | `INTEGER` | indexed |
| | `lockedUntil` | `DATE` | |
| Password | `password` | `STRING` | hashed — **never returned** |
| | `passwordChangedAt` | `DATE` | |
| MFA | `mfaEnabled` | `BOOLEAN` | migration `0004` |
| | `mfaSecret` | `STRING` | **never returned** |
| WebAuthn | `webauthnEnabled` | `BOOLEAN` | migration `0014` |
| | `webauthnCredentialId` | `STRING` | |
| | `webauthnPublicKey` | `TEXT` | |
| | `webauthnSignCount` | `INTEGER` | replay defence |
| OTP | `otpCode` | `STRING` | **never returned** |
| | `otpExpiredAt` | `DATE` | |
| | `otpRequestCount`, `otpLastRequestedAt` | `INTEGER`, `DATE` | throttling |

Indexes: `username`, `email`, `(tenant_id, email)`, `(tenant_id, role_id)`, `status`, `is_active`, `failed_login_attempts`, `is_deleted`.

### `(tenant_id, email)` as a composite

This is what makes the same email address usable in two tenants — different organisations, different accounts, one person. A global unique on `email` would prevent it.

### Fields that must never leave the server

`password`, `mfaSecret`, `otpCode`, `webauthnPublicKey`. Excluded by `defaultScope`; a query that bypasses the scope must exclude them explicitly.

This is the kind of leak that survives review, because the field is absent from the screen the developer is looking at. Assert it in tests rather than intending it.

### `webauthnSignCount`

The authenticator increments a counter on each use. A response carrying a counter **lower than or equal to** the stored value indicates a cloned authenticator, and must be rejected. Storing it without checking it is storing a defence nobody applies.

### Users are never hard-deleted

`calibration_records.performedBy` and `certificates.signedBy` point here. A calibration record whose performer resolves to nothing has lost the attribution that made it evidence.

GDPR erasure therefore **anonymises** — the identity is severed, the record survives. See [`../PLAN/15-COMPLIANCE-STANDARDS.md`](../PLAN/15-COMPLIANCE-STANDARDS.md).

## `sessions`

**This model uses snake_case attribute names.** Not just column names — the Sequelize attributes themselves.

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | PK |
| `user_id` | `UUID` | indexed |
| `tenant_id` | `UUID` | indexed |
| `token_hash` | `STRING` | **indexed** — hit on every authenticated request |
| `ip_address`, `user_agent`, `device` | `STRING` | binding |
| `expired_at` | `DATE` | indexed |
| `last_activity_at` | `DATE` | |
| `is_revoked`, `is_active` | `BOOLEAN` | composite index |
| `revoked_at`, `revoked_reason` | `DATE`, `STRING` | |
| `is_deleted`, `deleted_at` | `BOOLEAN`, `DATE` | indexed |

### The naming trap

```js
Session.destroy({ where: { tenantId } })   // ✗ column "tenantId" does not exist
Session.destroy({ where: { tenant_id } })  // ✓
```

This exact mistake broke the nightly data-retention purge. `tenantKeyOf()` in `tenantScope.util.js` checks for **both** `tenantId` and `tenant_id` specifically because of this model — automatic scoping works; hand-written queries do not get the same help.

### Only the hash is stored

`token_hash`, never the token. A database read cannot recover a session token.

### Why sessions are in the database, not Redis

A session here is an audit record, not a cache entry (ADR-034). It answers "which sessions were live on 14 March" and "revoke this person now" — both need durability a cache does not offer. Redis may cache lookups in front of it; the table stays the source of truth.

### Binding

`ip_address` and `user_agent` are recorded and checked. Strict IP binding breaks legitimate users on mobile networks that rotate addresses; the trade-off between security and usability here is a product decision, and `sessionSecurity.middleware.js` is where it is made.

## `consent_records`

| Column | Type | Notes |
|---|---|---|
| `tenantId`, `userId` | `UUID` | indexed |
| `purpose` | `STRING` | indexed — what the consent covers |
| **`version`** | `STRING` | which version of the terms |
| `status` | ENUM | `granted`, `withdrawn` |
| `ipAddress` | `STRING` | where it was recorded |
| `consentedAt`, `withdrawnAt` | `DATE` | |

### Why `version` is the important column

Without it, the record proves someone clicked agree. With it, it proves **what they agreed to**.

That is the question asked at a GDPR audit, and it cannot be answered retroactively — the terms change and the old text is gone. A consent record without a version is a record of an event with no content.

### Withdrawal is a state change, not a delete

`status = 'withdrawn'` with `withdrawnAt` set. The original grant stays. Deleting a withdrawn consent destroys the evidence that consent existed during the period when data was processed under it, which is exactly the period an audit asks about.
