# 02 — User API

Base: `/api/v1/users`. Module `HDC-USER` (4).

---

## Endpoints

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/all` | `account` read | list users, paginated |
| POST | `/detail` | `account` read | fetch one user — **POST, with the id in the body** |
| POST | `/username-check` | authenticated | availability check |
| POST | `/create` | `account` write | create a user |
| PATCH | `/edit` | `account` write | update a user |
| DELETE | `/delete` | `account` write | delete a user — **id in the query string** |
| POST | `/role-update` | `management` write | change a user role |
| POST | `/:userId/avatar` | self or `account` write | upload an avatar |
| DELETE | `/:userId/avatar` | self or `account` write | remove an avatar |

### Two conventions that will surprise you

**`POST /detail` rather than `GET /:id`.** Detail is fetched by posting the identifier in a body. It is inconsistent with the rest of the API and it is what the endpoint does.

**`DELETE /delete` reads `userId` from the query string**, not from a path segment:

```
DELETE /api/v1/users/delete?userId=<uuid>
```

Both are legacy shapes retained because changing them is a breaking API change (ADR-019) for no functional gain. They are documented rather than quietly fixed.

## The User Record

`users`, `paranoid`.

| Group | Columns |
|---|---|
| Identity | `username`, `email`, `firstName`, `lastName`, `phone`, `avatarUrl` |
| Tenancy | `tenantId`, `roleId` — exactly one each (BR-2) |
| State | `isActive`, `status`, `isEmailVerified`, `lastLoginAt`, `isDeleted` |
| Lockout | `failedLoginAttempts`, `lockedUntil` |
| MFA | `mfaEnabled`, `mfaSecret` (migration `0004`) |
| WebAuthn | `webauthnEnabled`, `webauthnCredentialId`, `webauthnPublicKey`, `webauthnSignCount` (migration `0014`) |
| OTP | `otpCode`, `otpExpiredAt`, `otpRequestCount`, `otpLastRequestedAt` |
| Password | `password` (hashed), `passwordChangedAt` |

Indexes: `username`, `email`, `(tenant_id, email)`, `(tenant_id, role_id)`, `status`, `is_active`, `failed_login_attempts`, `is_deleted`.

`(tenant_id, email)` as a composite is what makes the same email address usable in two tenants — different organisations, different accounts, one person.

## Never Returned

`password`, `mfaSecret`, `otpCode` and `webauthnPublicKey` must never appear in a response. The model excludes them via `defaultScope`; a query that bypasses the scope must exclude them explicitly.

This is the kind of leak that survives review because the field is absent from the screen the developer is looking at. It is worth asserting in tests, not just intending.

## Role Update

`POST /role-update` changes `users.roleId`.

Returns **400 "User already has this role"** when the target role matches the current one. That is correct behaviour, not a bug: a no-op role change should not produce an audit row implying a privilege change occurred.

Role change is a privileged operation and is audited with before and after.

## Avatar

`POST /:userId/avatar` is multipart. Files land under `uploads/profile` and are served from `/uploads` with `X-Content-Type-Options: nosniff` and `Content-Disposition: inline`.

Rate-limited as an upload endpoint (20/min).

## Tenant Scoping

Every list and lookup is tenant-scoped by the global hooks. A user id from another tenant returns **404**, identical to a non-existent one (see [`00-API-STANDARDS.md`](./00-API-STANDARDS.md) § 404 for cross-tenant).

`SUPERADMIN` sees across tenants and may target one with `x-tenant-id`.

## Deletion

Soft delete: `paranoid` plus `isDeleted`.

A user is never hard-deleted, because `calibration_records.performedBy` and `certificates.signedBy` point at them. A calibration record whose performer resolves to nothing has lost the attribution that made it evidence (see [`../PLAN/15-COMPLIANCE-STANDARDS.md`](../PLAN/15-COMPLIANCE-STANDARDS.md)).

GDPR erasure therefore **anonymises** rather than deletes: the identity is severed, the record survives.

## Quota

User creation is checked against `tenants.limitSeats` by `enforceQuota.middleware.js` **before** the insert (BR-15), so a rejected request never leaves a partial user behind.

## Per-User Permissions

Menu overrides live on a separate surface — `/api/v1/user-permissions`, documented in [`03-RBAC-API.md`](./03-RBAC-API.md).

## Frontend

| Route | Surface |
|---|---|
| `/dashboard/users` | list, create, edit, role assignment |
| `/dashboard/profile` | self-service profile |
| `/dashboard/change-password` | password change |

Service: `frontend/src/api/services/user.service.ts`, with contract tests in `user.service.test.ts`.

**Known UI gap:** the user-edit modal has an expected-failure marker for fuller-payload persistence. The backend was verified to persist correctly; the marker is a UI-side issue and is retained deliberately rather than removed to make the suite look green.
