# 07 — Porting Playbook: the Strangler, Module by Module (TARGET)

> **TARGET — nothing here is built.** Owner decision (2026-10-08, ADR-136): a port to another language
> replaces the Node backend **one module at a time**. A gateway routes the paths of each module to Node
> or to the new engine. Both engines use **the same database**. That requires plain-SQL migrations any
> language can run, signing keys shared through **JWKS** so a session is valid on both engines,
> and **`GET /api/v1/meta`** so clients hide what a port has not implemented. The first port planned is
> Go (Phase 999, re-planned on this playbook), and the playbook is written for **any** language.

---

## 1. The Shape During a Port

```
 web (Next proxy) ─┐                                  ┌─▶ Node backend   (modules not yet ported)
 mobile (native) ──┼─▶ gateway ─ routing table ───────┤
 integrations   ───┘   /api/v1/<module>/…  by module  └─▶ new engine     (modules at 100% conformance)
                       /socket.io/ (realtime module)            │
                                                                ▼
                         one PostgreSQL 18 · one Redis · one storage · plain-SQL migrations
```

## 2. The Gateway

- **Where it sits — an internal hop.** As built, the public edge sends `/api/` to **Next**
  (`deploy/compose/nginx/vm-http.conf`, `location /api/ { proxy_pass http://frontend; }`), and Next's proxy
  reaches the backend directly through `BACKEND_INTERNAL_URL`. The gateway is therefore an **internal**
  service: `BACKEND_INTERNAL_URL` points at the gateway, the native ingress `/native/api/v1` (ADR-134)
  points at the same gateway, and the gateway forwards to the engines. One gateway, two front doors.
- **What it is:** an nginx (or equivalent) **routing table per operation** — method + path template —
  generated from the contract's operations and their `x-module`, plus a small `routing.yaml`
  (`module: node|go|…`). Routing by path prefix is not enough: `/api/v1/tenants` is mounted by four
  routers and `/api/v1/auth` by two, so one prefix spans several modules. The generator emits a
  **precedence order** (literal segments before parameters, as Express resolves them), and a test asserts
  that **every operation resolves to exactly one engine** and no two rules overlap ambiguously. No
  hand-written location blocks.
- **What it is not:** it does not authenticate, authorise, transform bodies or merge responses. A
  request goes to exactly one engine.
- **Module boundaries** follow the route modules (55 as built) grouped into gateway modules by data
  ownership. A module owns its tables' **writes**. Reads of another module's tables are allowed through
  the database (one schema) but are listed, so a port knows its read dependencies.
- **Rules:**
  - a module is routed to an engine only when **both** the source and the target engine score **100%**
    on it on the **same contract version** (owner, 2026-10-08 — Q-C2), so the rollback target is
    known-good ([`06`](./06-CONFORMANCE-SUITE.md) § 4);
  - a routing change is a deploy with its own record;
  - rollback is the previous table, with no data migration, because the database is shared and both
    engines keep the contract.
- **Cross-module transactions:** an operation whose transaction spans two modules' tables (e.g. an IPM
  submit creating a work order, ADR-126 Am. 1 § 6) is served by the engine that owns the operation, and
  that engine writes both tables. The playbook therefore ports **the side-effect writers together**
  (§ 8 order), or the owning engine implements the write to the other module's table **to the same
  schema and triggers**. The triggers (append-only, facility defaults) protect both engines alike.

## 3. Migrations: Plain SQL, Runnable From Any Language

As built: **95** TypeScript migrations under Umzug (`0001` … `0123`, with gaps; `backend/src/config/migrator.ts`,
table `schema_migrations`), **plus `db.sync()`** (`config/migrate.ts`), which builds the base tables and
indexes from the Sequelize models (ADR-100 Am. 3: a model index on a later migration's column breaks the
upgrade boot). Migrations and seeds are also triggered over HTTP by the internal routes
`GET /api/v1/migration/{up,seeding,seed-demo,down,unseeding}` (`routes/internal/migration.route.ts`) —
**Node-internal**, not part of `contracts/`.

**Target (Phase 34):**

1. **A baseline.** At the switch-over point, `pg_dump --schema-only` of a database migrated by the
   as-built chain becomes `db/migrations/000000_baseline.sql`. It is verified by restoring it and
   diffing the catalogue (`schemaVerify` `EXPECTED_OBJECTS` + a full `pg_dump` diff = 0) against a
   migrated database. Seed data that migrations insert (roles, menus, the base catalogue) is part of
   the baseline as `INSERT`s.
2. **From then on, every schema change is a plain `.sql` file** (`db/migrations/<UTC timestamp>_<slug>.up.sql`,
   with a `.down.sql` where a down is meaningful). Each file runs in **one transaction** (PostgreSQL
   transactional DDL), except the files the chosen tool lets you mark as non-transactional (e.g.
   `CREATE INDEX CONCURRENTLY`) — the **marker syntax is the tool's own** (dbmate:
   `-- migrate:up transaction:false`; golang-migrate has no per-file marker and needs such a statement
   in a file of its own run outside a transaction by the runner's configuration). The card fixes the
   syntax with the tool.
3. **One runner, language-neutral:** a single static binary run by every engine's deploy and by CI.
   **golang-migrate** is recommended (plain up/down SQL files, a CLI usable from any language), against
   `dbmate` and Atlas, confirmed by the card under the package rule.
   - **A distinct version table.** Umzug's table is `schema_migrations` — which is also the **default**
     table of golang-migrate and dbmate (with different columns; golang-migrate stores a single
     version). The new runner **must** be configured with its own table (e.g. `schema_versions`), so the
     two histories never collide.
   - **The upgrade gate.** A deployment must first be on the **last Umzug release** (every Umzug
     migration applied — checked against the manifest); only then is the new runner run with
     `force <baseline version>` and, from then on, `up`. A deployment on an older release is refused with
     a message naming the release to install first.
4. **`db.sync()` is retired**, and so are the HTTP migration routes (`/migration/up`, `/down`,
   `/seeding`, `/unseeding`, `/seed-demo`): the runner applies schema; seeds become SQL files (roles,
   menus, the base catalogue in the baseline; demo data as a separate, refused-in-production seed file
   run by the runner's CLI). If the bootstrap flow still needs an HTTP trigger, it is re-implemented as a
   Node-internal route that **calls the runner**, documented as internal (not in `contracts/`). The
   schema comes only from SQL. Sequelize models describe it and must not create it. A guard compares the models' attributes and indexes with the database (the as-built
   `modelIndexColumns.am3.guard` grows into a full model ↔ schema check).
5. **Data migrations** that need application logic (back-fills) are written as SQL where possible. A
   back-fill that truly needs code is a **one-off job** in whichever engine, not a migration, and is
   recorded.
6. Migrations are tested **as `callibrator_app`** for grants and triggers (CLAUDE.md § Evidence), on a
   clean database and on production-shaped data (`upgradeBoot` pattern), by CI for every engine
   (the schema is shared).

## 4. Sessions Valid on Every Engine: JWKS

As built: access tokens are JWTs with `JWT_ALGORITHM` defaulting to **HS256** (a shared secret), with a
**single-algorithm** key ring (ADR-119, `utils/jwt.util.ts`) and a session row checked per request.
**Purpose tokens** — activation (24 h), MFA (5 min), socket (300 s), first sign-in — are signed with the
same keys (`PURPOSE_TOKEN_TYPES`). The claims are `id`, `email`, `sid`, `amr`, `impersonatorId`, `typ`
(`auth.service.ts`). Sharing an HMAC secret with every engine would let every engine **mint** tokens.

**Target (Phase 34):**

- Access **and purpose** tokens are signed **ES256** with a `kid` **in the JWT header**; the claim set is
  unchanged (B-AUTH-2: `id`, `email`, `sid`, `amr`, `impersonatorId`, `typ`, plus `iat`, `exp`). Signing
  keys live only with the **issuer**: the engine that serves the `auth` module. One issuer at a time.
- Every engine **verifies** against the issuer's **JWKS**, served on an **internal** mount at
  `/internal/.well-known/session-jwks.json`. **No `/internal` mount exists today** — it is target, built by
  P34-02, reachable only on the internal network (the edge refuses `/internal/` on public hosts). The
  OIDC-provider JWKS at **`/oidc/.well-known/jwks.json`** (`oidc.route.ts`; the root `/.well-known/` is the
  ACME static mount, `backend/index.ts`) stays as built and is a different key set. Verifiers cache the
  JWKS by `kid` and refetch on an unknown `kid` — **rate-limited** (at most one refetch per few seconds
  per verifier), so a flood of forged `kid`s cannot hammer the issuer.
- **The HS256 → ES256 move** happens on the **issuer only**, which for one access-token lifetime
  verifies **both** algorithms (its ring holds the old HMAC key for verification only, signs ES256 only);
  the other engines are not routed any module until the window has passed, so they never need HMAC.
  This changes the as-built single-algorithm ring — an explicit, tested exception for that window.
  Purpose tokens follow the same move (an activation link minted before the switch stays valid for its
  24 h on the issuer).
- **Rotation:** a new key is published in the JWKS **before** it signs; the old key stays published until
  every token signed with it has expired (access-token lifetime + clock skew). The ring of ADR-119
  becomes the JWKS's key list.
- **Revocation** stays a session-row check in the shared database (and Redis, as built), so a revocation
  is seen by every engine at the next request.
- **Refresh tokens** are opaque, stored hashed in the shared `sessions` table. Rotation and reuse
  detection (ADR-134 § B.4) are implemented by the auth-module owner only.
- Moving the `auth` module from one engine to another moves the **issuer**. The new issuer imports the
  signing keys (or starts a new `kid` while the old one is still published) and needs no forced sign-out.
  This is the continuity case of `TASKS/PHASE-1000-MOBILE-BACKEND-GO.md`.

## 5. `GET /api/v1/meta` — Contract Version and Capabilities

- Public, ETag, cheap: `{ contractVersion, capabilities: { "<module>": true|false, "<feature>": true|false } }`
  (B-META-1), **deployment-wide only** — per-tenant and per-user flags stay behind the authenticated
  mobile configuration read; rate limit `requestBudget("meta")` per address.
- The **gateway** answers it, or the engine serving the `meta` module answers it from the routing table:
  a module is `true` when routed to an engine that implements it **fully**. Feature capabilities (e.g.
  `mobile.passkeys`, `ipm.countersign`) are the server flags of `docs/MOBILE/01` § 6.
- Clients read it at start and on focus. A false capability **hides** the feature (absent, not disabled).
  A client never needs a build per backend.
- It never names the engine, its version or the routing table (no fingerprinting surface). Diagnostics
  for operators go in the response header `X-Served-By`, which the edge strips on the public host and
  keeps on internal hosts.

## 6. Tenant-Isolation Parity

Each engine implements isolation its own way ([`01`](./01-ARCHITECTURE.md) § 4). Node uses the Sequelize
hooks (ADR-029, ADR-048, ADR-124). Go uses predicates in every repository function
(`docs/BACKEND/12` § 4). The **observable** behaviour is the same and is proved the same way:

- the two-tenant and two-facility parts of the conformance suite ([`06`](./06-CONFORMANCE-SUITE.md) § 3.2)
  at 100% for every module the engine serves;
- each engine's own white-box tests of its deny branch (`NO_TENANT_UUID`, `NO_FACILITY_ID`): a principal
  with no resolvable tenant sees nothing;
- raw SQL with the bound tenant (and facility) predicate only (`sql()` in Node; the same rule elsewhere).

**RLS — decided (owner, 2026-10-08, Q-C1: yes, a second layer, fail-closed, staged).** The owner removed PostgreSQL Row Level Security earlier
(ADR-029, migrations 0012 → 0015). Three reasons were given:
1. RLS is PostgreSQL-only, while MySQL was still supported;
2. the policy failed open on an empty `app.current_tenant`;
3. it cost a round trip per request.

With two or more engines writing one database, isolation is now implemented **N times**, and a single
missed predicate in a new engine is a cross-tenant leak that no other layer stops.

**Decision: reintroduce RLS as a second layer, never the only one, fail-closed and staged.**
- Reason 1 no longer holds: PostgreSQL is the only database (ADR-039).
- Reason 2 is a policy defect, not an RLS property. The policy reads
  `current_setting('callibrator.tenant_id')` **without** `missing_ok`, so an unset setting **raises**,
  and an empty value matches no row.
- Reason 3: the tenant (and facility) are set with `SET LOCAL` **inside a transaction**. Under the
  extended query protocol a `SET LOCAL` outside a transaction is lost at the next statement, so **reads
  too must run inside a transaction** (a read-only one) whenever an RLS-protected table is queried — that
  is the real cost: a `BEGIN`/`COMMIT` pair and one `SET LOCAL` per request on those tables. It is
  **measured first** with the U-06 k6 scripts, before any policy is enabled.
- **The super-admin bypass path:** the as-built cross-tenant reads (`skipTenantScope` for the super
  admin and the system tasks, ADR-029) run under a role or setting the policies admit explicitly
  (`callibrator.bypass_tenant = on`, set only by those code paths, reviewed like `skipTenantScope`) —
  never by disabling RLS; migrations run as a `BYPASSRLS` role.

Start with the evidence-chain tables (devices, records, certificates, IPM sessions and results,
attachments, audit). Enable it only after the gateway exists and before the **first non-Node engine
writes** them. Keep the application layer as the primary control and the conformance isolation suite
as the proof.

**Bad implications:**
- the per-request settings plumbing in every engine;
- `BYPASSRLS` roles for migrations and the system tasks that span tenants;
- a performance cost to measure;
- a second mechanism to keep in step with the hooks, whose disagreement shows as a denied query
  (a 500 if unhandled).

Built by P34-07. Until it is enabled, the conformance suite plus each engine's deny-branch tests are the
only proof.

## 7. What a Module Port Must Deliver (checklist)

- [ ] every operation of the module implemented from `contracts/` (generated validators, no hand-made shapes)
- [ ] every named rule the module uses implemented and passing `contracts/vectors/`
- [ ] isolation: the module's two-tenant and two-facility checks 100%
- [ ] audit rows in the same transaction; 409s with their codes; `code` on every error
- [ ] side effects (notifications, realtime emits through the adapter, jobs) as the contract documents
- [ ] the conformance score for the module 100% on the port, recorded with the contract version
- [ ] the routing change deployed behind a flag, observed, then made default; rollback rehearsed
- [ ] `/meta` capability true only after routing
- [ ] the record, the index line, PROGRESS (`TASKS/00-TASK-CONVENTIONS.md`)

## 8. Order of Modules (recommended)

1. **Leaf, read-mostly modules** without cross-module writes (e.g. the global catalogue reads, public
   verification, content): they prove the gateway, JWKS verification and `/meta` at low risk.
2. **Self-contained write modules** (vendors, warehouses/stock).
3. **The evidence chain together** (devices, calibration records, certificates, IPM sessions,
   attachments, work orders), because their writes cross module lines (§ 2) and share triggers.
4. **`auth` and sessions** (the issuer move, § 4) once the verifier side has run in production.
5. **Realtime** last (§ `05` § 6: ports emit through the adapter long before they own the socket server).

Node keeps every module that has not been ported. There is no deadline by which Node must be empty:
ADR-089's "the TypeScript backend remains supported" stands.
