# 09 — SCIM Provisioning

SCIM 2.0 user and group provisioning for an external identity provider: who may call it, how SCIM Users and Groups map onto this system's users and roles, and — plainly — what an IdP integrating today will find broken.

> **Target standard: TypeScript, strict (ADR-038).** `scim.route.js`, `scim.controller.js`, `scim.service.js` and `scim.validator.js` are **JavaScript/CommonJS** today and are described here **as built**. Conversion runs module by module under [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md).

Implementation: `backend/src/routes/api/scim.route.js` · `backend/src/controllers/scim.controller.js` · `backend/src/services/scim.service.js` · `backend/src/validators/scim.validator.js`. Mounted at `/api/v1/scim/v2` in `backend/index.js`.

---

## Before You Wire Up an IdP

**`PATCH` honours RFC 7644 `path` operations as of 2026-09-23.** The form every major IdP sends —

```json
{ "op": "replace", "path": "active", "value": false }
```

— now deactivates the user. So does the Entra ID spelling that prefixes the attribute with the core schema URN, and Okta’s `members[value eq "<id>"]` on a group. What is recognised, and the several ways an operation is now a **400** instead of a misleading 200, are in [§ PATCH](#patch) below.

> **Until 2026-09-23 that operation was silently dropped.** `patchUser` and `patchGroup` read only `op.value`, as an object — `Object.entries(false)` is `[]` — so the endpoint answered **200 with the user unchanged** and deprovisioning appeared to succeed while the account stayed active. The Joi schema compounded it by rejecting a boolean `value` before the service ever ran. That is finding **A-33** in [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md), **DONE** 2026-09-23. **If an IdP was pointed at these endpoints before that date, re-run a full sync** — every path-based deactivation and membership change it believes it applied did nothing, and nothing recorded that it did not.

**No SCIM mutation writes an audit row.** `scim.service.js` imports no audit model or service. Create, update, patch and delete — of users and of groups — leave no attributed record. For a system under 21 CFR Part 11 and ISO 13485 that is a compliance gap, not a nicety. It was folded into A-33 and is **still open** after A-33 closed; the card lists it as the largest remaining SCIM gap.

**A group grants nothing until it is mapped to a role** (ADR-053). An IdP can create groups as it always could, but adding members to a group with no `roleId` is a **409**; an administrator maps it first — see [§ Groups](#groups). Groups created before 2026-09-24 were global roles and are not carried over; re-push them.

> **Until 2026-09-24 `PATCH /Groups/:id` was not atomic** — it wrote as it went, outside any transaction. Every group write now runs in one transaction (A-38).

---

## Who May Call These Endpoints

Three middlewares run for every route, in this order (`scim.route.js:33–48`):

```
scimAuthShim        rewrite "Bearer <api key>" -> "ApiKey <api key>"
auth                resolve the principal
requireApiKeyOrAdmin   API key OR SUPERADMIN, else 403
```

**A plain user JWT does not reach SCIM.** `requireApiKeyOrAdmin` admits `req.user.isApiKey`, or a role named `SUPER_ADMIN`/`SUPERADMIN`. Everything else gets a SCIM-shaped 403:

```json
{ "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "detail": "SCIM endpoints require an API Key", "status": "403" }
```

> This guard is inline in the route file rather than a named middleware. The 2026-09-21 audit write-up of A-27 said every SCIM route was on `auth` alone; that was wrong, and the correction is recorded in the A-27 card. The scanning script had a fixed list of gate names and a gate it could not see read as no gate. **When you audit this file, read it — do not grep for `rbac(`.**

### The Bearer shim

SCIM clients send `Authorization: Bearer <token>`; this platform's API keys are sent as `Authorization: ApiKey <key>`. `scimAuthShim` bridges the two with a heuristic: a `Bearer ` header longer than 30 characters that contains **no dot** is rewritten to `ApiKey `. A JWT always contains dots, so it is left alone. Platform API keys are `cbk_` plus 56 hex characters — 60 characters, no dots — so they are always rewritten.

Configure the IdP with the API key as its bearer token. No other credential type works.

### API keys are the intended credential, and they changed on 2026-09-23

SCIM accepts **any** API key belonging to the tenant as a service account. It does not check the key's scopes — `requireApiKeyOrAdmin` sets `req.apiKeyAuthorized = true`, which is the explicit A-03 opt-in described in `auth.middleware.js#allowApiKey`.

Because any key is a SCIM key, key issuance itself is the real gate. Two changes on 2026-09-23 (commit `e326ae5`, finding **A-27**):

| Before | Now |
|---|---|
| `POST /api/v1/api-keys` on `auth` + `denyApiKey` — **any** authenticated user could mint a key | `[auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])]` (`apiKeys.route.js:17`) |
| scopes were whatever the caller sent; `["*"]` was accepted | `assertScopes()` refuses a wildcard resource or action and requires each entry to name a real menu slug and `read` or `write` (`apiKey.service.js:41–57`) |

Together with the role guards below, that closed a path from the lowest-privilege account to platform takeover.

### A SUPERADMIN calling SCIM acts inside their own tenant

The controller reads **`req.user?.tenantId`**, not `req.tenantId`. The `x-tenant-id` / `x-tenant-code` override that `auth.middleware.js` grants a SUPERADMIN writes `req.tenantId` only. So a super-admin cannot use SCIM to provision into a chosen tenant — the tenant is whatever is on their own user row, and if that is null the queries run against `tenantId: null`. Treat SUPERADMIN access here as a break-glass path, not an operating mode.

## The Endpoints

| Method | Path | | Method | Path |
|---|---|---|---|---|
| GET | `/Users` | | GET | `/Groups` |
| GET | `/Users/:id` | | GET | `/Groups/:id` |
| POST | `/Users` | | POST | `/Groups` |
| PUT | `/Users/:id` | | PUT | `/Groups/:id` |
| PATCH | `/Users/:id` | | PATCH | `/Groups/:id` |
| DELETE | `/Users/:id` | | DELETE | `/Groups/:id` |

Capital `U` and `G` are required by the specification; a lowercase path is not SCIM.

### The response envelope is not SCIM

Read this before writing a client. The service builds a correct SCIM body — `schemas`, `totalResults`, `startIndex`, `itemsPerPage`, `Resources` — and then the controller wraps it in the **platform** envelope:

```json
{ "success": true, "status": 200, "message": "SCIM users fetched",
  "data": { "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
            "totalResults": 2, "Resources": [ … ] } }
```

Every handler in `scim.controller.js` does this, through `success()` or a literal `res.json`. Errors are worse: `AppError`s thrown by the service go through the global error handler and come back in the platform error shape, **not** `urn:ietf:params:scim:api:messages:2.0:Error`. The only SCIM-shaped error in the module is the 403 from `requireApiKeyOrAdmin`.

A standards-compliant SCIM client will not parse any of this. As-built, these endpoints are SCIM-shaped payloads over a non-SCIM transport, and an integration needs an adapter.

> [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) states that SCIM responses use their own envelope and not the platform one. **The code contradicts that.** The code wins; that document needs correcting through the deviation protocol.

Two smaller deviations: `POST /Users` and `POST /Groups` return 201 without a `Location` header, and `DELETE` handlers call `res.status(204).json(...)` — Express strips a body on 204, so the client does receive an empty 204, but the code reads as if it sends one.

## Users

### Mapping

| SCIM | This system (`users`) |
|---|---|
| `id` | `user.id` (UUID) |
| `userName` | `user.email` — **and** `user.username`, both set to the email on create |
| `name.givenName` / `name.familyName` | `firstName` / `lastName` |
| `emails[0].value` | `email` (preferred over `userName` when present) |
| `active` | `isActive && status === "ACTIVE"` — writes set **both**: `isActive` and `status` `ACTIVE`/`SUSPENDED` |
| `roleId` *(non-standard extension)* | `user.roleId` |
| `meta.created` / `meta.lastModified` | `createdAt` / `updatedAt` |

`roleId` is not a SCIM attribute. It is accepted by `scimUserSchema` as an optional UUID and is this module's only way to set a role directly on a user.

### Create

`POST /Users` requires `userName` as a valid email (`scim.validator.js`). Defaults when the IdP omits them: `firstName` `"SCIM"`, `lastName` `"User"`, `roleId` `ROLE_IDS.USER`, `isEmailVerified: true`. A 32-hex-character random password is generated and hashed — no plaintext password is stored and none is returned, so the account is unusable until the user goes through password reset or SSO.

`active: false` at creation provisions the user as `SUSPENDED`.

> **Trap — global uniqueness.** `user.model.js` declares `username` and `email` **globally unique** (`indexes: [{ fields: ["email"], unique: true }]`), but the duplicate check is `Users.findOne({ where: { email } })`, which the global tenant hooks narrow to the caller's own tenant. An email already in use by **another** tenant therefore passes the 409 check and fails on the database constraint instead. The IdP learns that the address exists somewhere on the platform. This is the cross-tenant existence oracle `../../CLAUDE.md` warns about, and it is not tracked as a finding yet.

### Update and deprovision

`PUT /Users/:id` applies `name.givenName`, `name.familyName`, `roleId` and `active`. It is a partial apply, not a true PUT replace: an omitted attribute is left alone rather than cleared.

`DELETE /Users/:id` calls `user.destroy()`. The `Users` model is `paranoid: true`, so this sets `deleted_at` — a Sequelize soft delete. It does **not** set the model's own `isDeleted` flag (that is `user.softDelete()`), and it does not deactivate. Note that calibration attribution depends on users continuing to exist; `../API/13-INTEGRATION-API.md` says deprovisioning "must deactivate, not erase", and as-built it does neither — it soft-deletes.

### Filtering and pagination

`GET /Users` splits the `filter` query on ` and ` (case-insensitive) and matches each term against two regular expressions (`scim.service.js:255–277`):

| Recognised term | Effect |
|---|---|
| `userName eq "<value>"` | `where.email` |
| `email eq "<value>"` | `where.email` |
| `emails.value eq "<value>"` | `where.email` |
| `active eq true` / `active eq false` (quotes optional) | `where.isActive` **and** `where.status` (`ACTIVE`/`SUSPENDED`) |

Terms joined by ` and ` are combined. **Anything else is a 400** — `Unsupported SCIM filter: <filter>` — and the query never runs. A single unsupported term rejects the whole filter.

> **Until 2026-09-23 an unrecognised filter was dropped and the whole tenant came back.** `userName eq` was not recognised at all, and it is precisely the probe Okta and Entra ID send to decide whether a user already exists: a client asking "does this one user exist?" received every user in the tenant, which it may read as "no unique match". Finding **A-33**.

> **The 400 is not a SCIM error.** RFC 7644 § 3.4.2.2 calls for an `Error` response carrying `scimType: "invalidFilter"`; this throws an `AppError(400)` that the global handler renders in the **platform** error envelope. Right status, wrong body — see [§ The response envelope is not SCIM](#the-response-envelope-is-not-scim).

**`userName eq` matches `email` or `username`** (A-49, 2026-09-24). Until then it compared `email` only, so a user created through the application with a different `username` was unfindable by the probe an IdP runs before creating a user.

`startIndex` is 1-based and converted to an offset; `count` defaults to 100, is floored at 1 and has **no upper bound** — a client asking for a million rows gets an unbounded query.

**`GET /Groups`** supports `displayName eq "<value>"`, compared **case-insensitively**, and answers anything else with **400** — as `GET /Users` does. `count` is capped at **200** there (A-49, 2026-09-24). Until then the comparison was case-sensitive against an uppercased column, and an unsupported filter returned every role on the platform.

## Groups

### A SCIM Group is a tenant-owned mapping to a role (ADR-053)

Since 2026-09-24 a SCIM Group is a row in **`scim_groups`**, owned by one tenant (migration 0042,
`models/scimGroup.model.js`). It points at an **existing** role through `roleId`; SCIM never creates,
renames or deletes a role.

> **Until 2026-09-24 a SCIM Group *was* a row in the global `roles` table.** A tenant's IdP saw every
> tenant's groups, got **409** for a name another tenant held, and `DELETE` destroyed a role for every
> tenant (A-38). A group it created had `roleLevel` 1 and no menu permissions, so its members got
> nothing and nothing said so (A-39). Those roles still exist as ordinary global roles; they are not
> groups any more, and nothing records which tenant made them.

What an integrator must know:

- **Groups are per tenant.** `GET /Groups` lists the caller's tenant's groups only. Another tenant's
  group id, a missing id and a malformed id are the same **404**. `displayName` is stored as sent and
  unique per tenant **case-insensitively** — another tenant's name never collides.
- **A group grants its role, or nothing — and says which.** Every group carries
  `urn:ietf:params:scim:schemas:extension:callibrator:2.0:Group`:
  `{ "roleId": …, "roleName": …, "grantsAccess": true|false }`.
- **An unmapped group refuses members.** Standard IdPs send only `displayName`, so a group may be
  created without `roleId`, but adding a member to it — on `POST`, `PUT` or `PATCH` — is a **409**
  naming the fix. Map it with `roleId` on `POST`/`PUT`, or `PATCH` `{"op":"replace","path":"roleId","value":"<role id>"}`.
- **What a group may be mapped to:** an existing role that is not SUPERADMIN (**403**, A-27), not the
  default USER role, and holds at least one menu permission — otherwise **400**. A role backs at most
  **one** group per tenant (**409**); another tenant may map the same role.
- **Membership is derived and single-valued.** Members are the tenant's users whose `roleId` is the
  group's role — including users an administrator gave that role by hand. Adding a user **replaces**
  their role; removing one demotes them to `ROLE_IDS.USER`, and only if they are a member.
- **Re-mapping moves the members** to the new role. `remove roleId` unmaps the group and demotes its
  members. **`PUT` without `roleId` keeps the mapping** — IdPs never send it.
- **`DELETE /Groups/:id`** deletes the tenant's group row and demotes its members in that tenant.
- **No write to `members` is an exact sync.** `PUT` and a `replace` on `members` **assign** the members
  given and leave the ones omitted. Only an explicit `remove` demotes anyone.

### Mapping

| SCIM | This system |
|---|---|
| `id` | `scim_groups.id` |
| `displayName` | `scim_groups.display_name`, as sent |
| extension `roleId` | `scim_groups.role_id` → `roles.id` |
| `members[].value` | `user.id` — applied as `user.roleId = group.roleId`, tenant-scoped |
| `members[].display` | `user.email` |

## What SCIM May Not Do

Both guards were added on 2026-09-23 as part of A-27 (`scim.service.js:7–34`).

**`assertAssignableRole(roleId)`** runs on `createUser`, `updateUser` and the `roleId` branches of `patchUser` — in **both** patch shapes, because they share one assignment function — and — through `assertMappableRole` — whenever a group is mapped to a role:

| Condition | Result |
|---|---|
| `roleId === ROLE_IDS.SUPER_ADMIN` | **403** — `SCIM may not assign the SUPERADMIN role` |
| role not found | **400** — `Unknown roleId` |
| `role.isSystem` **and** name is `SUPERADMIN` (any case) | **403** |
| no `roleId` supplied | allowed — falls back to `ROLE_IDS.USER` on create |

The second SUPERADMIN check exists because the first compares against a UUID that is **committed to this repository** (`constants/roleConstants.js`). A system role named SUPERADMIN under a different id is refused too.

Group mappings are checked by **`assertMappableRole(roleId)`**, which calls `assertAssignableRole` and
additionally refuses the default USER role and a role with no menu permission (A-39). The former
`assertMutableGroup` is gone: SCIM no longer writes roles, so there is no role for it to protect.

## PATCH

`patchUser` and `patchGroup` accept both the RFC 7644 `path` form and the older value-object form, and both shapes funnel through **one** assignment function — which is what keeps `assertAssignableRole` unavoidable on a `roleId` write whichever way it arrives (`scim.service.js:162–191`, `386–420`, `565–631`).

> **Until 2026-09-23 the `path` form did nothing.** `patchUser` iterated `Object.entries(op.value)` and read `op.path` only in a `remove` branch that treated it as an **array of keys** — against a validator that declared it a `Joi.string()`, so that branch could never fire. Given `{"op":"replace","path":"active","value":false}`, `op.value` was the scalar `false`, `Object.entries({})` was `[]`, and the endpoint answered **200 with the user unchanged**. `patchGroup` failed the same way. The only working shape was `{"op":"replace","value":{"active":false}}`, which no IdP sends. Finding **A-33**, fixed 2026-09-23 — the card carries the before/after and the named tests. Anything an IdP synced before that date needs re-syncing.

### `PATCH /Users/:id`

Paths are matched **case-insensitively** (RFC 7643 § 2.1), and the core-schema URN prefix `urn:ietf:params:scim:schemas:core:2.0:User:` is stripped first, because Entra ID sends it (RFC 7644 § 3.10 makes the two spellings equivalent).

| `path` | Writes |
|---|---|
| `active` | `isActive` **and** `status` (`ACTIVE`/`SUSPENDED`) |
| `userName` | `email` **and** `username` — both, as `createUser` does |
| `name.givenName` | `firstName` |
| `name.familyName` | `lastName` |
| `roleId` *(non-standard extension)* | `roleId`, after `assertAssignableRole` |

`active` accepts a JSON boolean or the strings `"true"`/`"false"` — Entra ID has been observed sending `"True"`. A number is a 400.

`remove` **requires** a `path` (RFC 7644 § 3.5.2 makes it REQUIRED), and the only attribute it can clear is `roleId`, which resets the user to `ROLE_IDS.USER`. Anything else is a 400.

The value-object form still works — `{"op":"replace","value":{"active":false}}` — recognising `name` (`givenName`/`familyName`), `active`, `userName` and `roleId`, and ignoring unknown keys as it always did.

Every operation in the request accumulates into one `updates` object that is written with a single `user.update()` after the loop, so an operation that throws leaves the user untouched.

| 400 | Message |
|---|---|
| a `path` that resolves to no supported attribute | `Unsupported SCIM path: <path>` |
| a non-string `path` | `SCIM path must be a string` |
| an operation with neither a `path` nor an object `value` | `SCIM operation requires a path or an object value` |
| `remove` with no `path` | `SCIM remove operations require a path` |
| `remove` on anything but `roleId` | `SCIM cannot remove <attribute>` |
| an empty or non-string value where a string is required | `SCIM <attribute> must be a non-empty string` |
| an `op` outside `add`\|`remove`\|`replace` | `Unsupported SCIM op: <op>` (Joi rejects it first) |

Every id in a patch value — `roleId`, each member id, the id in Okta's `members[value eq "…"]` — is UUID-checked by the service before any query: **400** `SCIM … must be a UUID` (A-49, 2026-09-24). Until then a malformed id reached PostgreSQL, which raises 22P02 on a UUID column — a 500.

### `PATCH /Groups/:id`

`displayName`, `roleId` and `members` are honoured through `path`, and Okta’s filter form `members[value eq "<id>"]` resolves to that one member — which is how Okta removes a single person from a group.

- `add` and `replace` on `members` give the named tenant users the group's role — a **409** if the group is unmapped.
- **`replace` on `members` is deliberately additive**, as `PUT` is.
- `remove` on `members`, with a value or with Okta’s filter, demotes exactly those users to `ROLE_IDS.USER` — if they are members.
- `remove` on `members` with **no** value clears the whole attribute, per RFC 7644 § 3.5.2 — it demotes **every member of that group in the caller’s tenant**.
- `replace`/`add` on `roleId` maps or re-maps the group; `remove` on `roleId` unmaps it (members demoted).
- `remove` on `displayName` is a 400 (`SCIM cannot remove displayName`).
- An unsupported path, a non-string path, a non-string or empty `displayName`, an empty members value, a malformed id, or an operation with neither a path nor an object value is a 400.

The pre-2026-09-23 value-object form still works here too, for `displayName`, `roleId` and `members` — every one present is applied, in that order.

The whole patch runs in **one transaction**: an operation that fails leaves the group and every membership as they were.

## Validation

`scim.validator.js` exports a **local** `validate(data, schema)` that the controller calls inside each handler. It is not the Express middleware from `middlewares/validation.middleware.js`, and the route file applies no validator — this is deliberate and not the `schema.validate`-as-middleware trap.

It runs Joi with `abortEarly: false` and `stripUnknown: true`, and on failure throws a **plain object** `{ status: 400, message: "Validation failed", errors }` — not an `AppError`. Any change to the error handler's instanceof checks must keep handling that shape.

`stripUnknown` means unrecognised SCIM attributes are discarded without complaint. `schemas`, `externalId`, `phoneNumbers`, enterprise-extension attributes and anything else an IdP sends are silently dropped.

| Schema | Requires |
|---|---|
| `scimUserSchema` | `userName` (email). Optional: `name.givenName`, `name.familyName`, `emails[]`, `active`, `roleId` (UUID) |
| `scimGroupSchema` | `displayName` (≤ 255). Optional: `roleId` (UUID), `members[].value` (UUID), `members[].display` |
| `scimPatchSchema` | `Operations[]`, each with `op` ∈ `add`\|`remove`\|`replace`. Optional `path` (**string** — the service resolves it) and `value` (object, array, string, **boolean** or **number**) |

**Boolean and number were added to `value` on 2026-09-23.** Without them `{"op":"replace","path":"active","value":false}` — the exact payload Okta sends to deactivate a user — was a 400 *before the service ran*. Fixing only the service would have turned a silent 200 into a validation failure on that one payload (A-33).

## Tenant Isolation

Every `Users` query in the service passes `tenantId` explicitly **and** is narrowed again by the global hooks in `utils/tenantScope.util.js`. The redundancy is intentional; see [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md).

Every `ScimGroup` query passes `tenantId` explicitly too. `Role` queries are not scoped — the model has no tenant column — and SCIM now only **reads** roles, to validate a mapping and to name it.

Cross-tenant user and group access returns **404** (`User not found` / `Group not found`), never 403, as the platform rule requires.

## Tests

| Suite | Covers |
|---|---|
| `backend/src/tests/routes/scim.route.test.js` | the twelve routes; `scimAuthShim` rewrite rules; `requireApiKeyOrAdmin` — including `"rejects an ordinary user with a SCIM-shaped 403"` |
| `backend/src/tests/routes/scim.routes.test.js` | a second, thinner route-registration suite over the same router |
| `backend/src/tests/services/scim.service.test.js` | every service function, plus `describe("scim.service — privileged role guards (A-27)")` (refusing SUPERADMIN on create, update and patch, refusing a system role named SUPERADMIN under another id, refusing to rename a system role) and `describe("scim.service — RFC 7644 patch paths and filters (A-33)")` |
| `backend/src/tests/controllers/scim.controller.test.js` | the twelve handlers |
| `backend/src/tests/validators/scim.validator.test.js` | the three schemas and the local `validate`, including `"accepts the boolean value an IdP sends to deactivate a user"` and `"accepts an Okta members value filter as a path"` |
| `backend/src/tests/routes/scim.groups.tenantOwned.a38.test.js` | groups through the real route → controller → service with two tenants (`createTwoTenants()`): cross-tenant 404s, tenant-owned names, what a group grants, case-insensitive names, UUID-checked patch values, atomic patches (A-38, A-39, A-49) |
| `backend/src/tests/migrations/0042-scim-groups-per-tenant.test.js` | migration 0042's logic; the SQL was run on PostgreSQL 18 (A-38 card) |
| `backend/src/tests/e2e/modules/scim.e2e.test.js` | live spec, requires a running server. Reads the **as-built** envelope (`body.data`) since 2026-09-24; asserts an unmapped group says it grants nothing and a case-insensitive `displayName eq`. **No PATCH coverage** |

Named assertions behind the 2026-09-23 change, in the service suite: `"deactivates the user given the standard IdP deprovision operation"`, `"refuses a path-form roleId naming SUPERADMIN with 403 and writes nothing"`, `"rejects an unsupported path with 400 rather than ignoring it"`, `"narrows to one user on a userName eq filter"`, `"rejects an unsupported filter with 400 instead of returning the tenant"`, `"runs a path-form member add through the A-27 role guard"`. The A-33 card records the run: `npx jest src/tests/services/scim src/tests/controllers/scim src/tests/routes/scim src/tests/validators/scim` — 5 suites, 195 tests.

These remain unit suites against mocks. Per `../../CLAUDE.md` § Evidence, **a mock proves the client, not the contract**. They assert what the service does with an operation, not what an IdP receives over HTTP — and the envelope above means an off-the-shelf SCIM client still cannot read the response. **No real Okta, Entra ID or OneLogin tenant has been driven against these endpoints.** A green run is not a working integration.

## Related

- [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) § `/api/v1/scim/v2` — the endpoint list. Its envelope and deprovisioning claims disagree with the code; see above.
- [`../SECURITY/04-AUTHORIZATION-RBAC.md`](../SECURITY/04-AUTHORIZATION-RBAC.md) — roles, levels and the menu-permission matrix a SCIM group does not participate in.
- [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) — **A-27** (done, 2026-09-23) and **A-33** (done, 2026-09-23). A-33’s card lists what it did **not** close: no audit row on any SCIM mutation (still open). **A-38, A-39, A-49** (done, 2026-09-24; ADR-053) made groups tenant-owned mappings; the SCIM-vs-platform envelope question is still open on A-49.
