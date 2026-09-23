# Wave 0 Authorization Fixes — 2026-09-23

**Kind:** change record
**Tasks:** [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) — A-01, A-02, A-03, A-27; new finding A-33
**Audit:** [`2026-09-21-backend-audit.md`](./2026-09-21-backend-audit.md)

---

## What Changed

Four of the audit's Wave 0 findings, all of them the same shape: a route that
authenticates but does not authorize.

| Finding | Before | After |
|---|---|---|
| **A-27** | any authenticated user could mint an API key with `scopes: ["*"]`; SCIM accepts any API key as a service account and wrote a caller-chosen `roleId`, and the SUPERADMIN role id is a committed constant | API-key management is `TENANT_ADMIN`-only; scopes must name a real menu slug and a real action (`*` refused); SCIM refuses to assign SUPERADMIN or an unknown role, and refuses to rename, patch or delete a system role |
| **A-01** | three `tenant-hierarchy` mutations guarded by `auth` alone, on a model the tenant hooks do not scope — any principal could re-parent **another hospital's** tenant | reads of a named tenant are the caller's own tenant or **404**; re-parenting and `cross-tenant-roles` are `[auth, denyApiKey, superAdminOnly]` |
| **A-02** | webhooks, storage settings and custom domains: `auth` only, so the lowest role could repoint the tenant's uploads or its event stream at a host it owned | webhooks and storage settings are `[auth, denyApiKey, rbac([TENANT_ADMIN])]`; custom domains use the existing `custom-domains` menu slug, read for reads and write (plus `denyApiKey`) for writes |
| **A-03** | API-key scopes were read **only** by `dynamicAccess`; on any other route a key was just an authenticated principal | deny-by-default: a gate that authorized the key sets `req.apiKeyAuthorized`, `allowApiKey` is the explicit opt-in, and a key that reaches a wrapped controller without it gets 403 |

## The Correction Worth Keeping

The 2026-09-21 write-up of A-27 said *every SCIM route is guarded by `auth`
alone*. That was wrong — `scim.route.js` also applies `requireApiKeyOrAdmin`,
so a plain user JWT gets 403. The escalation was real, but it ran through
**API-key issuance**, which was open to every authenticated user.

The error came from my own tooling: the script that built the authorization
matrix had a fixed list of gate names, and `requireApiKeyOrAdmin` — an inline
guard, not an imported middleware — was not in it. A gate the tool did not know
about read as no gate at all.

Both the card and this record keep the original text next to the correction.
That is the point of the PR-4 rule in `CLAUDE.md`: a confident claim that turns
out to be wrong is worth more visible than a quiet edit.

## A New Finding

**A-33** — `scim.service.js#patchUser` reads `op.value` as an object and
ignores `op.path`. RFC 7644's normal form is
`{ "op": "replace", "path": "active", "value": false }`; against this endpoint
`Object.entries(false)` is `[]`, so the operation is dropped and the endpoint
answers **200 with the user unchanged**. Okta, Entra ID and OneLogin all send
that form to deactivate a user — deprovisioning appears to succeed while the
account stays active.

Found while writing the A-27 tests: the reproduction in the original card used
the standard shape, and it did not escalate. The shape that *did* is
`{ "op": "replace", "value": { "roleId": "<id>" } }`.

## Evidence

`npm run test:coverage` → **293 suites, 5799 tests, 100 % statements, branches,
functions and lines.** New cases:

| File | Covers |
|---|---|
| `src/tests/services/scim.service.test.js` § "privileged role guards (A-27)" | create / update / patch into SUPERADMIN, a system role named SUPERADMIN under another id, unknown `roleId`, rename / delete / patch a system role |
| `src/tests/services/apiKey.service.test.js` | wildcard scopes, unknown resource, unknown action, empty list, non-array, lower-casing |
| `src/tests/routes/tenantHierarchy.guards.test.js` | 404 for another tenant on each read route; `auth` + `denyApiKey` + `superAdminOnly` on each mutation |
| `src/tests/routes/routeGuards.a02.test.js` | the gate on each webhook, storage-settings and custom-domain route, plus "leaves no route on auth alone" |
| `src/tests/utils/controllerWrapper.apiKey.test.js` | an unauthorized API key is refused; an authorized one runs; ordinary and unauthenticated principals are untouched |
| `src/tests/middlewares/auth.test.js` § "allowApiKey (A-03)" | the opt-in marker |

## What This Does Not Cover

Stated because a green gate is not a green release:

- No live reproduction. Every case above is a unit test. The two-tenant and
  two-account reproductions against a running server are still open.
- `iot.controller.js` and `predictiveMaintenance.controller.js` do not use the
  controller wrapper, so they sit outside the A-03 chokepoint. Neither is
  reachable by an API key today; a new controller written without the wrapper
  would be.
- Roles are **global**, not per-tenant. SCIM group management therefore edits
  rows every tenant shares. The guards stop the dangerous cases; the data model
  is an Open Question.
- SCIM mutations still write no audit row.
