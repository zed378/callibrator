# Feature Spec — A-02 Who may configure webhooks, object storage and custom domains

**Written:** 2026-09-28 — **retroactively**. The spec did not exist when A-02 was implemented (2026-09-23); the card cited this path while no such file existed (DOC-02, `TASKS/DOCS-GAP-2026-09.md`). It records the decision as it was made and the gates as they stand in the code on 2026-09-28, which differ from 2026-09-23 in the ways listed under [What changed after A-02](#what-changed-after-a-02).
**Task:** A-02 (`TASKS/AUDIT-2026-09-REMEDIATION.md` § A-02)
**Author:** Claude (agent), for Zed — reconstructed from the card's "What was changed" table, ADR-043 and the current routers
**Spec refs:** `docs/SECURITY/04-AUTHORIZATION-RBAC.md` · `docs/WEBHOOK/03-WEBHOOK-SECURITY.md` · `docs/STORAGE/04-TENANT-STORAGE.md` · `MEMORY/DECISIONS.md` ADR-043

> A retroactive spec cannot do what a spec is for — surface the decision while it is cheap. What it can do is make the decision discoverable, state what it rests on, and say plainly where the shipped state and the card disagree.

---

## Problem

Until 2026-09-23 three routers that configure a tenant's outbound and hosting surface carried `auth` and nothing else, and their controllers made no role or API-key check. The lowest-privilege account in a tenant (persona: any tenant user; a `USER` or `ROOM USER` token is enough) could:

- **storage** — read the tenant's storage settings, repoint the tenant's object storage at a bucket it controls (every later upload lands with the attacker), or make the server connect to an endpoint it supplied (`POST /settings/test`);
- **webhooks** — register a webhook that ships device and calibration events to an address it chose, signed with the tenant's secret;
- **custom domains** — add, verify (which issues a TLS certificate), remove, or change the default hostname that serves the tenant.

The question A-02 was opened to answer: **who may configure each of these**, given that at the time webhooks and storage had **no menu slug** (so `dynamicAccess` could not express them) and `custom-domains` did.

---

## What `docs/` Already Decides

| Decision | Source |
|---|---|
| Every route carries a permission gate; a route on `auth` alone works for everyone with a token | `CLAUDE.md` § Every route needs a permission gate; `docs/SECURITY/04-AUTHORIZATION-RBAC.md` |
| `dynamicAccess(slug, read\|write)` is the default gate where a menu slug exists | `docs/SECURITY/04-AUTHORIZATION-RBAC.md` |
| A tenant-supplied outbound destination is SSRF surface and is validated | `docs/WEBHOOK/03-WEBHOOK-SECURITY.md`; `backend/src/utils/ssrf.util.js` |
| `custom-domains` exists as a menu slug (`MENU_SLUGS.CUSTOM_DOMAINS`) | `backend/src/constants/roleConstants.ts` (was `.js` on 2026-09-23) |
| Webhooks and storage have no menu slug | same file — still true on 2026-09-28 |

`docs/` was **silent** on who should hold these surfaces. That silence is why the card required this spec.

---

## Options Considered

| Option | For | Against | Outcome |
|---|---|---|---|
| **A. `rbac([ROLE_NAMES.TENANT_ADMIN])` + `denyApiKey`** for webhooks and storage | expressible today without a slug; names the privilege floor ("tenant administrator"); `rbac` compares role level, so it covers every level-8 role | `TENANT_ADMIN` is a logical tier, not a seeded role; it works only if the principal carries a real `roleLevel` — which, it turned out, it did not (V-01) | **chosen** for webhooks and storage |
| B. Add `webhooks` / `storage` menu slugs and gate with `dynamicAccess` | one mechanism; grants editable per tenant | the slug, seed and role-assignment work did not exist; converting before it would replace a visible 403 with a silent denial (the A-07/A-58 shape) | deferred — ADR-043 decision 3 |
| C. `SUPER_ADMIN` only | simplest, strictest | a hospital's own administrator could not configure its own tenant; every change becomes a platform-support ticket | rejected |
| D. **`dynamicAccess(MENU_SLUGS.CUSTOM_DOMAINS, read\|write)`** + `denyApiKey` on writes | the slug already exists in the constant and the seed; standard gate | effective access is whatever the seeded grants say (see Contradiction below) | **chosen** for custom domains |
| E. Leave reads open, gate writes only | less friction | storage `GET /settings` reveals credential state; webhook `GET` reveals destinations and delivery payloads | rejected |

**Why `denyApiKey` on all three:** an API key must not be able to redirect storage, open a standing export channel (a webhook), or claim a hostname, whatever its scopes. That is an escalation from "read some endpoints" to "receive everything".

---

## Decision (as enforced on 2026-09-28)

### Webhooks — `backend/src/routes/api/webhooks.route.js`, mounted at `/api/v1/webhooks`

`const webhookAdmin = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])]` on **all 8 routes**:

| Method | Path | Extra |
|---|---|---|
| POST | `/` | `requireFeature("webhooks")` (plan gate, 402), `validate(createWebhookSchema)`; a caller-supplied `secret` is refused (P6-13) |
| GET | `/` | |
| GET | `/:id` | `validateUuid` |
| PATCH | `/:id` | `validateUuid`, `validate(updateWebhookSchema)` |
| DELETE | `/:id` | `validateUuid` |
| GET | `/:id/deliveries` | `validateUuid` |
| POST | `/:id/test` | `validateUuid` |
| POST | `/:id/rotate-secret` | `validateUuid`, `validate(rotateWebhookSecretSchema)` — **added after A-02** (A-51 / P6-13) |

### Storage — `backend/src/routes/api/storage.route.js`, mounted at `/api/v1/storage`

`const storageAdmin = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])]` on **5 routes**: `GET /settings`, `PUT /settings` (+ `validate(updateStorageSettingsSchema)`), `DELETE /settings`, `POST /settings/test`, `GET /usage`.

`GET /object` is deliberately **not** gated: it is the public, HMAC-signed, expiring download path (listed `PUBLIC` in `backend/src/constants/routeGateExemptions.js`), registered before the gated routes.

### Custom domains — `backend/src/routes/api/customDomains.route.js`, mounted at `/api/v1/custom-domains`

| Gate | Routes |
|---|---|
| `domainRead = [auth, dynamicAccess(CUSTOM_DOMAINS, READ)]` | `GET /domains`, `GET /domains/:domainId/status`, `GET /domains/:domainId/dns` |
| `domainWrite = [auth, denyApiKey, dynamicAccess(CUSTOM_DOMAINS, WRITE)]` | `POST /domains` (+ `validate(addDomain)`), `POST /domains/:domainId/verify`, `DELETE /domains/:domainId`, `POST /domains/:domainId/default` |

### What the `TENANT_ADMIN` gate actually admits

`backend/src/middlewares/rbac.middleware.js`: `SUPER_ADMIN`/`SUPERADMIN` bypasses; otherwise a caller passes when its role name is listed **or** (`allowHigher`, the default) `req.user.role.roleLevel ≥ ROLE_LEVELS.TENANT_ADMIN` (8). Level 8 today: `HEALTHCARE ADMIN` and `CALIBRATOR ADMIN` (`ROLE_LEVELS`, `backend/src/constants/roleConstants.ts`), plus any tenant-created role at level 8 — `roles.service.js` caps tenant-created roles at `MAX_TENANT_ROLE_LEVEL = ROLE_LEVELS.TENANT_ADMIN`, so a tenant can mint a role that holds these surfaces.

---

## What Changed After A-02

1. **V-01 / ADR-043 (2026-09-23, after A-02 shipped).** As shipped, the `TENANT_ADMIN` gate **refused every tenant administrator**: no auth loader projected `roleLevel`, nothing seeded it (every role was level 1), and `TENANT_ADMIN` matches no seeded role name. So for a period A-02's webhook and storage gates were effectively SUPER_ADMIN-only — fail-closed, but a lockout. ADR-043 fixed the principal: `roleLevel` projected in `auth.service.js` (e.g. `:474`, `:804`, `:861`), seeded, and backfilled by migration `0020-backfill-role-levels.js`; tenant-created roles capped below the SUPER_ADMIN tier. Pinned by `backend/src/tests/middlewares/rbac.authLoaderSeam.test.js` ("a HEALTHCARE ADMIN loaded by getAuthUserWithTenant passes rbac([ROLE_NAMES.TENANT_ADMIN])", "a CALIBRATOR ADMIN loaded the same way also passes", "a ROOM USER loaded the same way is refused with 403").
2. **ADR-043 decision 3:** webhooks and storage are **not** converted to `dynamicAccess` until their slugs exist in `MENU_SLUGS`, the seed and `ROLE_MENU_ASSIGNMENTS`; ADR-043 decision 6 sets the direction that `rbac` retires. A-02's DoD item "webhooks and storage get menu slugs" is therefore **still open** — neither slug is in `MENU_SLUGS` on 2026-09-28.
3. **Storage `GET /usage`** was on `auth` alone after the first pass of A-02 and was gated later (found by the documentation sweep; `routeGuards.a02.test.js` now sweeps storage too). A-02's "4 routes" is 5 today.
4. **Webhooks `POST /:id/rotate-secret`** was added (A-51 / P6-13) with the same gate; A-02's "7 routes" is 8 today.
5. **Constants moved to TypeScript** (Phase 9): `roleConstants.js` → `backend/src/constants/roleConstants.ts`. Docs that cite the `.js` path (`docs/WEBHOOK/03-WEBHOOK-SECURITY.md:41`, `docs/STORAGE/04-TENANT-STORAGE.md:154`) are stale on the path only.

### Contradiction: who holds `custom-domains`

A-02's "What was changed" says the slug has "WRITE for the admin roles and READ below them". **The code says otherwise.** `ROLE_MENU_ASSIGNMENTS` in `backend/src/constants/roleConstants.ts` (the source `migration.service.js` seeds from) grants `custom-domains`:

| Role | Grant |
|---|---|
| `SUPER_ADMIN` | WRITE (and bypasses `dynamicAccess` anyway) |
| `HEALTHCARE ADMIN` | **READ** only |
| every other seeded role, including `CALIBRATOR ADMIN` | none |

No migration adds further `custom-domains` grants. So on a freshly seeded database a hospital's own admin can **view** domains but not add, verify, remove or set the default — that remains a SUPER_ADMIN action — and a `CALIBRATOR ADMIN` cannot see them. The card's own "Spec required" line ("the menu matrix gives `custom-domains` write to `SUPERADMIN` only") matches the code; its "What was changed" line does not. Grants are database rows, so a tenant's live grants may differ from the seed. Whether tenant admins **should** hold WRITE is an owner decision, not settled here → Open Questions.

---

## API

| Method | Path | Permission | Purpose |
|---|---|---|---|
| (8 routes) | `/api/v1/webhooks…` | `auth` · `denyApiKey` · `rbac([TENANT_ADMIN])` | manage outbound webhooks |
| GET/PUT/DELETE | `/api/v1/storage/settings` | `auth` · `denyApiKey` · `rbac([TENANT_ADMIN])` | the tenant's object-storage configuration |
| POST | `/api/v1/storage/settings/test` | same | connect to the configured endpoint |
| GET | `/api/v1/storage/usage` | same | stored bytes and object count |
| GET | `/api/v1/storage/object` | none — signed token is the capability | download |
| GET | `/api/v1/custom-domains/domains[/:domainId/status\|/dns]` | `dynamicAccess(custom-domains, read)` | view |
| POST/DELETE | `/api/v1/custom-domains/domains[/:domainId[/verify\|/default]]` | `denyApiKey` · `dynamicAccess(custom-domains, write)` | change |

- [x] Every route has a permission gate — swept per router by `routeGuards.a02.test.js` ("leaves no route on auth alone"; storage: "leaves no route but /object on auth alone").
- [x] Identifiers are path parameters, checked by `validateUuid`.
- [x] 404 cross-tenant: `backend/src/tests/routes/webhooks.twoTenant.test.js` (every `/webhooks/:id` route) and `customDomains.twoTenant.test.js`.
- [x] Public endpoint: only `GET /storage/object`, recorded in `routeGateExemptions.js`.

---

## Security

- [x] **API keys:** refused on every webhook and storage-settings route and on every custom-domain write.
- [x] **SSRF:** webhook URLs pass `assertSafeUrl` at registration and on URL change, with a resolve-time backstop at delivery (`backend/src/services/webhook.service.js`); the S3 driver checks tenant-supplied endpoints (`backend/src/services/storage/s3.driver.js`). The abuse case the card named — gating the GETs and forgetting `POST /settings/test` — is closed: that route carries the full `storageAdmin` chain.
- [x] **Secrets:** storage settings report `hasCredentials`, not the key (`backend/src/services/storageSettings.service.js`); a webhook secret is server-generated and returned once (P6-13).
- [ ] **Not verified here:** whether storage-settings changes write an audit row. A grep of `storage.controller.js`, `storageSettings.service.js` and `services/storage/` found no audit call; webhook changes (`webhook.service.js#auditWebhook`, inside the transaction) and custom-domain changes (`customDomains.controller.js` via `auditActor`) do. Worth a card if confirmed.

---

## Tests

Named; not run as part of writing this spec.

- Composition: `backend/src/tests/routes/routeGuards.a02.test.js` — one case per route (8 webhook, 5 storage, 7 custom-domain) plus the per-router "no route on auth alone" sweeps, and "does not gate GET /object as a settings route". It mocks `rbac`/`dynamicAccess`, so it proves the gate is **in the chain**, not that it refuses anyone.
- Behaviour of the tier gate with a real principal: `backend/src/tests/middlewares/rbac.authLoaderSeam.test.js` (V-01).
- Two-tenant 404: `backend/src/tests/routes/webhooks.twoTenant.test.js`, `backend/src/tests/routes/customDomains.twoTenant.test.js`.
- **Gap against A-02's DoD:** "negative tests per route: a `USER` gets 403 and the configuration is unchanged". No route-level test drives a `USER` token through these routers and asserts both the 403 and the unchanged configuration; the negative case exists only at the middleware seam (ROOM USER → 403). Not written here.

---

## Open Questions

1. **Should tenant admins hold WRITE on `custom-domains`?** The seed says SUPER_ADMIN only (HEALTHCARE ADMIN READ); A-02's card text says the admin roles hold WRITE. One of them is wrong, and it needs an owner decision (then either a grant migration or a correction to the card). Candidate for `TASKS/BACKLOG.md` § Open Questions.
2. **Menu slugs for webhooks and storage** (A-02 DoD, ADR-043 decision 3): still to be added to `MENU_SLUGS`, the seed and `ROLE_MENU_ASSIGNMENTS` — and the API-key scope vocabulary split first, because widening `MENU_SLUGS` widens what an API key can be scoped to (ADR-043 implications).
3. **Tenant-created level-8 roles** pass the `TENANT_ADMIN` gate by construction. Intended by ADR-043's cap, but it means "tenant admin" here is "any role a tenant admin chose to make level 8".

---

## Rollout

No schema change of its own. The gates took effect on deploy; the V-01 backfill (`0020`) is what made them admit tenant administrators. Rollback of a gate is a code revert and re-opens the finding.
