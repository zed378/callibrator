# Phase 1 — Authentication, RBAC and Users

**Status: ✅ DONE**, and it shipped considerably more than the plan asked for.

Written retrospectively from the code.

---

### P1-01 — Password authentication and sessions

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/API/01-AUTHENTICATION-API.md` · `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` |

**What shipped:** 25 endpoints under `/auth`. Password login issues a JWT **and** a persisted, revocable `sessions` row.

**⚠ Divergence — ADR-033.** The plan specified **OIDC as the authentication mechanism** (ADR-005). Password login with a database-backed session is the **primary** path; OIDC is supported alongside it.

The reason: most tenants — particularly smaller facilities — have no identity provider. Requiring one would have made onboarding depend on a procurement exercise.

**⚠ Divergence — ADR-034.** The plan put sessions in Redis with a database fallback (ADR-014). They live in the **database**, because a session here is an **audit record**, not a performance optimisation: it answers "revoke this person now" and "which sessions were live on 14 March", and both need durability a cache does not offer.

**The defect worth remembering:** `verifyAccessToken` passed `maxAge: "15m"` while tokens are signed `expiresIn=1d`. **Every token was rejected fifteen minutes after login, platform-wide.** Two verification parameters expressing the same idea will eventually disagree, and the one that disagrees silently causes the outage.

---

### P1-02 — Lockout and rate limiting

| | |
|---|---|
| **Status** | ✅ DONE |

**What shipped:** `failedLoginAttempts` and `lockedUntil` on the user row, plus Redis-backed limiters — login 5/15 min, register 3/hour, forgot-password 3/15 min, reset-password 5/5 min — layered under Express limiters (global, auth 20/15 min, OTP 5/hour).

**The distinction that matters:** an **auth** limiter defends a credential and therefore locks; an **API** limiter defends capacity and therefore only throttles. Conflating them turns a capacity control into a denial-of-service tool aimed at named people.

**The non-production global limit is 100,000/15 min**, because a full browser E2E run exhausts a production budget and then fails for reasons unrelated to the code. It keys on `NODE_ENV` so it cannot be left on by forgetting to unset something.

---

### P1-03 — MFA and WebAuthn

| | |
|---|---|
| **Status** | ✅ DONE — **not enforced** |

**What shipped:** TOTP (migration `0004`) and WebAuthn passkeys (migration `0014`), six endpoints each.

**WebAuthn challenges live in Redis**, not process memory — a challenge issued by one replica must be verifiable by another. This is one of the three hard prerequisites for more than one backend replica.

**`WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` are exact-match by specification.** A trailing slash, a missing port, or `https` where the browser sent `http` fails verification with an error that does not name the mismatch.

**⚠ Open gap — PR-3.** MFA is **available, not enforced**, including for `SUPERADMIN` — which bypasses every permission check and every tenant predicate, **with no second gate behind it**. → P6-07.

**A defence that is stored and not applied:** `webauthnSignCount` must be **compared**, not merely recorded. A counter lower than or equal to the stored value indicates a cloned authenticator.

---

### P1-04 — RBAC

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/PLAN/03-USER-ROLES.md` · `docs/DATABASE/04-RBAC-TABLES.md` · `docs/SECURITY/04-AUTHORIZATION-RBAC.md` |

**What shipped:** 11 seeded roles, **58 menu groups** (three levels deep, seeded from `backend/src/utils/seedMenuGroups.util.js`), `role_menu_permissions`, `user_menu_permissions`, and three gates — `dynamicAccess(resource, action)`, `rbac([roles])`, `abac`.

**Two levels, not five.** `read` or `write`; `write` implies `read`. A model with five verbs across 58 surfaces is 290 switches, and a model nobody configures correctly is not a security control.

A first seed reports the shape concretely: **11 roles, 58 menu groups, 129 role permissions, one super-admin.**

**`TENANT_ADMIN` is a role that is not in the database.** It sits in `ROLE_LEVELS` at level 8 so one `rbac()` gate covers both `HEALTHCARE ADMIN` and `CALIBRATOR ADMIN`. Looking for it in `roles` and not finding it is the expected outcome, and nothing said so until now.

**Level orders escalation, not scope.** `WAREHOUSE STAFF` at level 4 holds `write` on `warehouse` where `SUPERVISOR` at level 6 holds only `read`. A warehouse clerk moves stock; a supervisor approves it. Any gate assuming higher level implies broader scope is wrong.

**The silent failure mode:** a role absent from `ROLE_LEVELS` resolves to the lowest privilege. It fails closed — correct — but **silently**, with nothing explaining why every privileged gate refuses.

**⚠ Open gap.** **Nothing prevents a new route being merged with no permission gate.** It would work for everyone with a token. → P6-04.

**⚠ A defect found in production, fixed 2026-09.** `GET /menu-groups/menu-groups/admin` answered **500** with `Cannot read properties of undefined (reading 'roleId')`. `filterMenuGroups` serves both a POST and two GET routes and read `req.body.roleId` unguarded — and **Express 5 no longer defaults an absent body to `{}`**. On a GET with no body, `req.body` is `undefined`.

The sidebar was unaffected, which is why it survived: the menu tree comes from `getRoleMenuAssignments`, a different handler, so only `/dashboard/menu-groups` broke. A defect confined to the screen that configures permissions is easy to leave standing.

The remaining unguarded `req.body.x` reads are on POST and PATCH handlers, where a bodyless request is already a client error — but it answers 500 rather than 400. → **M-10** in `BACKLOG.md`.

---

### P1-05 — Tenant context enforcement

| | |
|---|---|
| **Status** | ✅ DONE — see P0-11 for the mechanism change |

**What shipped:** `auth` sets `req.tenantId` and rejects **suspended tenants**; `tenantContext` opens the `AsyncLocalStorage` scope the global hooks read.

**The `x-tenant-id` override is honoured only for `SUPERADMIN`.** For anyone else it is **ignored, not rejected** — a probe returns the caller's own data rather than an error confirming the header means something.

**The suspension trap:** suspending the **default** tenant suspends the super-admin who lives in it, including the request that would reverse it. Recovery required a direct database update. Three E2E specs did exactly this before they were fixed to create disposable tenants.

---

### P1-06 — User management

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/API/02-USER-API.md` |

**What shipped:** 9 endpoints, avatars, role assignment.

**Two legacy shapes retained** because changing them is a breaking API change for no functional gain, and documented rather than quietly fixed:

- `POST /users/detail` — detail by POST, with the id in the body
- `DELETE /users/delete?userId=` — the id in the **query string**

**Users are never hard-deleted.** `calibration_records.performedBy` points here, and a record whose performer resolves to nothing has lost the attribution that made it evidence. GDPR erasure therefore **anonymises**.

**`(tenant_id, email)` is a composite index**, which is what lets one person hold accounts in two tenants.

---

### P1-07 — Audit logging integration

| | |
|---|---|
| **Status** | ✅ DONE |

Every mutation writes an `audit_logs` row **inside the transaction of the action**. See P0-14.

---

### P1-08 — Identity federation

| | |
|---|---|
| **Status** | ✅ DONE — **beyond the plan** |
| **Spec refs** | `docs/API/01-AUTHENTICATION-API.md` |

**What shipped, none of which was in the original scope:**

- SAML and OIDC as a **relying party**, with **per-tenant callbacks** (`/sso/callback/:tenantCode`) — each tenant may federate with its own IdP, and a shared callback cannot tell which one an assertion came from
- Callibrator as an **OIDC provider** — 11 endpoints, discovery, JWKS, client registration and secret rotation
- **SCIM 2.0** provisioning at `/api/v1/scim/v2`

**The OIDC router is mounted twice** — `/api/v1/oidc` and `/oidc` at the host root — because discovery advertises `<issuer>/oidc/...` and relying parties fetch it there. Serving it only under the API prefix produces a discovery document nobody can follow.

**SCIM has its own response envelope** and its own error format. It does **not** use the platform envelope, which is correct — a SCIM client will not parse anything else.

---

### P1-09 — Frontend authentication shell

| | |
|---|---|
| **Status** | ✅ DONE |
| **Spec refs** | `docs/FRONTEND/05-RBAC-IN-UI.md` |

**What shipped:** login and register, `AuthInitializer`, `authStore`, `menuStore`, `TenantBrandingProvider`, and the dashboard layout.

**The sidebar is rendered from the server-resolved menu tree.** There is no client-side permission array, no `can()` helper, no `<IfPermitted>` wrapper.

**An unauthorised surface is absent, not hidden.** A hidden element is still in the DOM, and its route is still reachable by typing the URL.

**Next.js owns `/api/v1/*`, and that is an architectural decision, not plumbing.** `app/api/v1/auth/login/route.ts` forwards to the backend and then sets `auth_token` and `auth_session` as **httpOnly** cookies plus a non-httpOnly `auth_logged_in` marker for client code that only needs to know whether someone is signed in; `app/api/v1/[...path]/route.ts` injects `Authorization: Bearer` from that cookie on every later call. `api/client.ts` sets `baseURL: ""` for exactly this reason — the browser talks to its own origin.

The consequence surfaced in deployment: a reverse proxy that routes `/api/` **to the backend** bypasses both handlers. Login returns a token in a JSON body that nothing stores, no cookie is set, and every authenticated request afterwards arrives with no credentials — while the backend answers 200 throughout. The token never reaches the browser as a token, so no amount of correct backend behaviour makes it work. See `docs/DEVOPS/03-REVERSE-PROXY.md`.

**Tenant branding is fetched before sign-in** for a pinned build (`NEXT_PUBLIC_TENANT_ID`), from the unauthenticated `GET /tenants/public` — which must therefore expose **branding only**.

---

## Phase 1 — Retrospective

**What shipped beyond plan:** MFA, WebAuthn, SCIM, an OIDC **provider**, per-tenant SSO callbacks, impersonation.

**What diverged:**

| Planned | Actual | ADR |
|---|---|---|
| OIDC as the authentication mechanism | password primary; OIDC both directions | ADR-033 |
| Sessions in Redis | sessions in the **database** | ADR-034 |

**What failed:** the `maxAge` defect made **every token expire fifteen minutes after login, platform-wide**, and survived until a live audit. No unit test could have caught it — the token and the verifier each behaved correctly in isolation. This is the clearest single argument for the live E2E layer.

**What remains open:**

| | → |
|---|---|
| MFA not enforced, including for level 10 | P6-07 |
| No mechanism prevents a route without a permission gate | P6-04 |
| An expired token reports "Invalid token" rather than a distinct message | left deliberately — churning a fully-covered suite for no gain |

**What to watch:** a new role added without a `ROLE_LEVELS` entry. It authenticates, resolves menus, and then fails every privileged gate with nothing explaining why.
