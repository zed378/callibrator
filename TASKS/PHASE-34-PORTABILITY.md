# Phase 34 — Portability: SQL Migrations, JWKS, `/meta`, the Gateway and AsyncAPI

> Part of the **backend-agnostic contract group, Phases 32 … 34** (ADR-136, [`docs/CONTRACT/05`](../docs/CONTRACT/05-REALTIME-ASYNCAPI.md),
> [`07`](../docs/CONTRACT/07-PORTING-PLAYBOOK.md)). The exit of this phase is the prerequisite of
> Phase 35 (shared packages and mobile) and of Phase 999 (Go, module by module).
>
> ← [Phase 33 — Conformance Suite](./PHASE-33-CONFORMANCE-SUITE.md) · [Phase 35 — Shared Packages](./PHASE-35-SHARED-PACKAGES.md) →

| | |
|---|---|
| **Status** | **BLOCKED** — 9 cards, 9 BLOCKED (written 2026-10-08; nothing built; P34-07 also waits on the owner, Q-C1) |
| **Goal** | everything a second engine needs to serve some modules beside Node on one database: language-neutral migrations, sessions verifiable by any engine, capability discovery for clients, per-module routing, the realtime contract — proved by a rehearsal with a second instance before any new language exists |
| **Depends on** | P33-10 |
| **Size** | L |
| **Cards** | 9: P34-01 … P34-09 |
| **Definition of Done** | the global DoD plus the group rule of [Phase 32](./PHASE-32-CONTRACT-FIRST-FOUNDATION.md) |

---

### P34-01 — Plain-SQL migrations: baseline, runner, `db.sync()` retired

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-10 |
| **Spec refs** | `docs/CONTRACT/07` § 3 · `backend/src/config/migrator.ts` (Umzug, `schema_migrations`, as built) · ADR-100 Am. 3 · `docs/DATABASE/13` · CLAUDE.md § Traps (blanket try/catch, model indexes) |
| **Spec required** | **yes** — `MEMORY/specs/P34-01-sql-migrations.md` |

**Definition of Done**
- [ ] `db/migrations/000000_baseline.sql` from a migrated database; restore + catalogue diff = 0 (named run); seeds as `INSERT`s
- [ ] The runner chosen and pinned (golang-migrate recommended; dbmate, Atlas compared), its version table continuing the Umzug history; one transaction per file, except files marked `-- no-transaction`
- [ ] `db.sync()` removed from boot; the model ↔ schema guard (attributes and indexes) replaces it
- [ ] Every migration since the baseline written as SQL; grants and triggers tested **as `callibrator_app`**; clean-database and production-shaped upgrade (`upgradeBoot` pattern) green; `make migrate-verify` reads the columns
- [ ] The deploy flows (compose, VM, Helm) run the runner before any engine starts

**Abuse cases**
- A baseline taken from a developer database rather than a chain-migrated one
- Keeping `db.sync()` "just for fresh installs"

### P34-02 — ES256 session tokens and the internal JWKS

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-10 |
| **Spec refs** | `docs/CONTRACT/07` § 4 · `backend/src/utils/jwt.util.ts` (as built: `JWT_ALGORITHM` default HS256, the ring of ADR-119) · `docs/SECURITY/03` · ADR-134 § B.4 |
| **Spec required** | no |

**Definition of Done**
- [ ] Access tokens signed ES256 with `kid`; claims `sub`, `tid`, `sid`, `iat`, `exp` (no facility claim); the issuer alone holds the private keys
- [ ] `/internal/.well-known/session-jwks.json` (internal mount only), cached by verifiers, refetched on an unknown `kid`
- [ ] Rotation rehearsed: publish → sign → retire after the token lifetime, with no forced sign-out (a live test); HS256 tokens issued before the switch honoured until expiry, then refused
- [ ] Revocation still per request through the session row

**Abuse cases**
- Publishing the session JWKS on the public host
- Sharing the private key with verifiers "for convenience"

### P34-03 — `GET /api/v1/meta` and capability-driven clients

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-10 |
| **Spec refs** | `docs/CONTRACT/03` § 14 (B-META-1) · `docs/CONTRACT/07` § 5 · `docs/MOBILE/01` § 6 |
| **Spec required** | no |

**Definition of Done**
- [ ] `/meta` in the contract and in Node (public, ETag); capabilities from the routing table and the server flags; no engine name
- [ ] The web reads it at start and on focus and hides features with a false capability (absent, not disabled); a component test per hidden feature
- [ ] `X-Served-By` stripped on the public host (a live check)

### P34-04 — The gateway: a routing table generated from `x-module`

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-01 |
| **Spec refs** | `docs/CONTRACT/07` § 2 · `deploy/compose/nginx/*.conf` · the Helm ingress · memory `callibrator-deployment-gotchas` (`/api/` goes to the frontend's proxy first) |
| **Spec required** | no |

**Definition of Done**
- [ ] `routing.yaml` (module → engine) + a generator writing the nginx and Helm routing from the contract's `x-module`; a stale generation fails CI
- [ ] The web proxy (`/api/v1`) and the native ingress (`/native/api/v1`) both pass through the table
- [ ] The routing refuses a module whose engine lacks a 100% conformance score on the current contract version (a CI check reading the scores)
- [ ] Rollback = the previous table; a live test switches a module back and forth with no failed request beyond the documented retry

### P34-05 — The AsyncAPI document and its guard

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-01 |
| **Spec refs** | `docs/CONTRACT/05` · `backend/src/config/socket.ts`, `services/notification.service.ts`, the kanban services (as built) · ADR-031, ADR-085, ADR-124 § 9 |
| **Spec required** | no |

**Definition of Done**
- [ ] `contracts/asyncapi/asyncapi.yaml`: handshake, rooms, the client commands (`kanban:join` with its ack, `kanban:leave`), the server events (`new_notification`, the 18 `kanban:*` events) with payloads `$ref`-ing the REST schemas
- [ ] A guard that inventories every `emit(` / `socket.on(` in Node and fails on an event missing from the document
- [ ] Event-name and payload types generated for the web's `socket.io-client`
- [ ] Emission after commit (B-RT-5) checked in Node; any emitter inside a transaction moved

### P34-06 — Realtime conformance, including adapter interoperability

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P34-05, P33-08 |
| **Spec refs** | `docs/CONTRACT/05` § 6, § 7 · `docs/CONTRACT/06` § 3.5 |
| **Spec required** | no |

**Definition of Done**
- [ ] The six realtime checks with the official `socket.io-client` 4.x, against Node, in CI
- [ ] Adapter interoperability proven with a second publisher using the `@socket.io/redis-emitter` format

### P34-07 — Row Level Security as a second layer (owner decision Q-C1)

| | |
|---|---|
| **Status** | BLOCKED — **on the owner** (ADR-136 Q-C1; recommendation: yes, fail-closed, second layer) |
| **Depends on** | P34-01; the owner's answer |
| **Spec refs** | `docs/CONTRACT/07` § 6 · ADR-029 (why RLS was removed) · ADR-039 · migrations 0012/0015 · `docs/SECURITY/05` |
| **Spec required** | **yes**, if the owner says yes |

**Definition of Done (if yes)**
- [ ] Policies on the evidence-chain tables reading `current_setting('callibrator.tenant_id')` **without** `missing_ok` (unset → error; empty → no rows) and the facility twin; `SET LOCAL` per transaction in Node
- [ ] Tested **as `callibrator_app`**: no context → error, a wrong tenant → no rows; migrations and cross-tenant system tasks under a role with `BYPASSRLS`, listed and reviewed
- [ ] Cost measured with the U-06 k6 scripts before and after; the record states it
- [ ] If the owner says no: the card is closed with the decision recorded, and `07` § 6 says so

### P34-08 — The strangler rehearsal: one leaf module on a second instance

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P34-01 … P34-06 |
| **Spec refs** | `docs/CONTRACT/07` § 1, § 7, § 8 |
| **Spec required** | no |

**Why:** prove the machinery (routing, JWKS verification by a non-issuer, `/meta`, shared migrations,
realtime through the adapter, conformance gating) **before** a new language exists, with a second
Node instance that serves only one leaf module.

**Definition of Done**
- [ ] A second instance configured to serve only a leaf module (e.g. the public verification or catalogue reads) and to verify tokens through the JWKS only
- [ ] The routing table sends that module to it; conformance through the gateway 100%; the web and a mobile build (when it exists) unchanged
- [ ] Rollback rehearsed; a record with the run ids

**Abuse cases**
- Letting the second instance share the signing key (it must verify through the JWKS only)

### P34-09 — Exit of the contract group

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P34-01 … P34-08 (P34-07 closed either way) |
| **Spec refs** | `docs/CONTRACT/` · `TASKS/PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md` |
| **Spec required** | no |

**Definition of Done**
- [ ] `docs/CONTRACT/` fully as-built where built; ADR-136 status updated; record, index, CHANGELOG, PROGRESS
- [ ] Phase 35 and Phase 999 unblocked on this side
