# Architectural Decision Records (ADRs)

Central record of architectural decisions with rationale and trade-offs.

## Format

Each ADR follows this pattern:
- **Decision** — What was decided
- **Rationale** — Why this choice
- **Alternatives Considered** — What was rejected and why
- **Implications** — Consequences and trade-offs
- **Status** — Accepted | Proposed | Deprecated

---

## ADR-001: Multi-Tenant Architecture with Shared Infrastructure

**Decision:** Implement multi-tenant SaaS platform with logical isolation rather than physical database separation per tenant.

**Rationale:** 
- Simplified operational overhead vs. per-tenant databases
- Cost-efficient resource utilization
- Easier backup and disaster recovery strategy
- Sufficient isolation via application-level tenant context

**Alternatives Considered:**
- Per-tenant database — more isolation but significantly higher ops complexity
- Namespace-level isolation — insufficient for compliance requirements

**Implications:**
- Tenant context must be enforced at every data access point
- Database queries MUST include tenant_id filters
- Row-level security policies recommended for PostgreSQL

**Status:** Accepted

---

## ADR-002: Express.js + Sequelize for REST API

**Decision:** Use Express.js with Sequelize ORM for backend REST API.

**Rationale:**
- Lightweight and battle-tested for enterprise APIs
- Sequelize provides type safety with TypeScript
- Strong ecosystem for middleware and integrations
- Familiar to healthcare IT teams

**Alternatives Considered:**
- NestJS — more opinionated, higher learning curve
- Fastify — minimal gain over Express for this scale

**Implications:**
- Explicit middleware composition required
- Tenant context must be injected via middleware
- Manual validation of business rules

**Status:** Accepted

---

## ADR-003: PostgreSQL with Redis for Caching

**Decision:** PostgreSQL as primary database, Redis for session cache and real-time data.

**Rationale:**
- PostgreSQL: ACID compliance, strong data integrity for audit trails
- Redis: Sub-millisecond session lookups, distributed cache
- Proven combination in healthcare systems

**Alternatives Considered:**
- MongoDB — insufficient transaction support for compliance
- DynamoDB — vendor lock-in and compliance audit complexity

**Implications:**
- Cache invalidation strategy required for consistency
- Redis failover and replication needed for production
- Session state must survive Redis outages (falls back to DB)

**Status:** Accepted

---

## ADR-004: Kubernetes for Container Orchestration

**Decision:** Deploy to Kubernetes with auto-scaling based on CPU/memory/request metrics.

**Rationale:**
- Industry standard for enterprise platforms
- Auto-scaling reduces operational overhead
- Proven for healthcare deployments
- Native support for multi-region failover

**Alternatives Considered:**
- Docker Compose — insufficient for production scale
- Managed services (AWS ECS) — reduced control over compliance

**Implications:**
- Required: etcd cluster for Kubernetes state
- Required: ingress controller and network policies
- Quarterly DR drills mandatory

**Status:** Accepted

---

## ADR-005: OIDC for Authentication

**Decision:** OpenID Connect (OIDC) for authentication with session rotation.

**Rationale:**
- Industry standard for enterprise SSO
- Supports external identity providers
- Token-based stateless authentication
- Compliance with security standards

**Alternatives Considered:**
- SAML — more enterprise but heavier, added later as Phase 4
- Custom JWT — reduced audit trail, higher security risk

**Implications:**
- Requires OIDC provider configuration (Auth0, Keycloak, etc.)
- Refresh token rotation mandatory
- Session binding to IP/user agent for anomaly detection — **never implemented**, see ADR-017 and Q-08 (noted 2026-09-23)

**Status:** Accepted

---

## ADR-006: RabbitMQ for Asynchronous Processing

**Decision:** Use RabbitMQ for event-driven work with at-least-once delivery guarantee.

**Rationale:**
- Reliable message delivery for compliance events
- Decouples processing from request/response cycle
- Supports dead-letter queues for failed messages
- Proven in healthcare event systems

**Alternatives Considered:**
- Redis Streams — insufficient durability for audit trail
- AWS SQS — vendor lock-in, compliance audit complexity

**Implications:**
- Idempotent message handlers required
- Dead-letter queue monitoring needed
- Message schema versioning required

**Status:** Accepted

---

## ADR-007: Next.js for Frontend with Server-Side Rendering

**Decision:** Next.js with server-side rendering for both web app and public invitation pages.

**Rationale:**
- SEO benefits for public pages
- Reduced client-side bundle size
- Type safety across full stack (TypeScript)
- Built-in image optimization

**Alternatives Considered:**
- SPA (React) — poor SEO for public pages
- Separate backend rendering — increased complexity

**Implications:**
- API calls from server and client components
- Session propagation via secure cookies
- Build-time static generation for some pages

**Status:** Accepted

---

## ADR-008: Separate Admin Panel Trust Boundary

**Decision:** Host admin panel on separate subdomain with independent session management.

**Rationale:**
- Mitigates stored XSS impact from user-submitted content
- Clear security boundary for administrative functions
- Easier to apply stricter CSP policies
- Compliance best practice for role separation

**Alternatives Considered:**
- Single-domain with path-based separation — insufficient XSS mitigation

**Implications:**
- Three distinct hostnames required (app, invitation, admin)
- Admin sessions independent from user sessions
- CORS configuration required for cross-domain API calls

**Status:** Accepted

---

## ADR-009: Row-Level Audit Logging

**Decision:** Log all data mutations with before/after state, user attribution, and timestamp.

**Rationale:**
- Compliance requirement for ISO 17025 and KARS
- Enables forensic investigation of data changes
- Immutable audit trail in separate schema

**Alternatives Considered:**
- Application-level logging only — insufficient for regulatory audit
- PostgreSQL WAL logs — not queryable for compliance reporting

**Implications:**
- Audit tables required for every mutable entity
- Performance impact on write operations (minimal)
- 30-day retention policy mandatory

**Status:** Accepted

---

## ADR-010: Calibration Record Permanence

**Decision:** Calibration records are immutable once created; changes create new records with historical reference.

**Rationale:**
- Compliance requirement: audit trail cannot be modified
- Enables trend analysis across record versions
- Device health score calculation requires historical data

**Alternatives Considered:**
- Soft deletes with versioning — insufficient for compliance (could be undone)

**Implications:**
- No direct updates to calibration records
- Correction process creates new records with reference to original
- Database storage grows steadily (plan for it)

**Status:** Accepted

---

## ADR-011: Monorepo Structure with pnpm Workspaces

**Decision:** Monorepo using pnpm workspaces for backend, frontend, admin, and shared packages.

**Rationale:**
- Shared code lives in `packages/` (schema, ui components, types)
- Single dependency tree reduces version conflicts
- Atomic commits across related changes
- Easier refactoring across domain boundaries

**Alternatives Considered:**
- Separate repositories — difficult to keep shared types in sync
- Yarn workspaces — pnpm faster and more disk-efficient

**Implications:**
- CI/CD must understand workspace topology
- Dependency management must be careful (no circular deps)
- Build caching with Turbo required for speed

**Status:** Accepted

---

## ADR-012: Feature-Branch Workflow with Task IDs

**Decision:** One branch per task, named with task ID (e.g., `feat/P1-09-rbac-system`), merged only when Definition of Done is met.

**Rationale:**
- Task ID is join key across branches, commits, PRs, MEMORY, and board
- Clear ownership and tracking of work
- Code review occurs before merge to main
- Main stays deployable at all times

**Alternatives Considered:**
- Trunk-based development — insufficient code review for compliance
- Long-lived feature branches — integration becomes painful

**Implications:**
- Branch naming discipline required
- Commit subjects must include task ID
- Main is always deployable (prerequisite for CD/CD)

**Status:** Accepted

---

## ADR-013: Sequelize Migrations with TypeScript

**Decision:** Use Sequelize migrations for schema changes, written in TypeScript.

**Rationale:**
- Reversible schema changes with rollback support
- Version control for database evolution
- Type safety in migration code
- Clear audit trail of schema changes

**Alternatives Considered:**
- Manual SQL — error-prone and hard to reverse
- Automatic migrations — insufficient control for compliance

**Implications:**
- Migrations must be idempotent for safety
- Data migrations require separate scripts
- Migration testing on staging before production

**Status:** Accepted

---

## ADR-014: Redis Session Persistence with Database Fallback

**Decision:** Sessions cached in Redis with fallback to PostgreSQL if cache misses.

**Rationale:**
- Sub-millisecond session lookups for API performance
- Survives Redis outages via database fallback
- Refresh token rotation stored in Redis for speed

**Alternatives Considered:**
- Redis-only — risk of session loss during outages
- Database-only — insufficient performance for scale

**Implications:**
- Cache invalidation strategy required
- Session data must fit in Redis memory
- Clock skew detection for anomalies required

**Status:** Accepted

---

## ADR-015: Compliance-First Secrets Management

**Decision:** Secrets stored in environment variables with encryption at rest, audit on access.

**Rationale:**
- Standard approach for Kubernetes deployments
- Secrets encrypted in etcd (Kubernetes native)
- Access audit trail for compliance
- No third-party secrets service initially (Phase 4 option)

**Alternatives Considered:**
- HashiCorp Vault — added complexity for current scale
- Hard-coded secrets — absolutely not

**Implications:**
- .env files never committed to git
- Secrets rotated quarterly
- Access audit logs reviewed monthly

**Status:** Accepted

---

## ADR-016: Device Calibration Records as Immutable Log

**Decision:** Calibration history stored as immutable append-only log with aggregated views.

**Rationale:**
- Compliance: cannot modify historical data
- Enables trend analysis and device health scoring
- Clear audit trail for regulatory inspection

**Alternatives Considered:**
- Mutable calibration records — compliance violation
- Separate audit log — slower for analytics

**Implications:**
- Corrections create new records, don't update old ones
- Aggregated "current state" views required for UI
- Storage grows with every calibration (plan for it)

**Status:** Accepted

---

## ADR-017: User Sessions Bound to IP and User Agent

**Decision:** Session tokens validated against IP address and user agent for anomaly detection.

**Rationale:**
- Detects session hijacking attempts
- Compliance requirement for access control
- Forces re-authentication if access pattern changes

**Alternatives Considered:**
- No binding — insufficient security for healthcare data
- Device fingerprinting — unreliable and privacy concerns

**Implications:**
- Session invalidated if IP/user agent changes significantly
- VPN users may experience re-auth on path changes
- Geolocation data used only for anomaly detection

**Status:** Accepted — **never implemented.** Recorded 2026-09-23.

Nothing in the request path has ever compared a session's `ip_address` or `user_agent` against the incoming request. The only code that claimed to, `sessionSecurity.middleware.js`, was imported by nothing and its SQL targeted a `"Sessions"` table with camelCase columns that does not exist; it was deleted under audit finding A-12. This ADR is the origin of a claim that reached six `docs/` files as fact, which is the PR-4 failure shape. It stands as the decision that was taken; the controls it describes are a **target**, and whether they should be built — and how they behave on a changed IP — is Q-08 in [`../TASKS/BACKLOG.md`](../TASKS/BACKLOG.md). **Superseded by ADR-084 (2026-09-28): no IP/UA binding and no concurrent-session cap; a user lists and ends their own sessions instead.**

---

## ADR-018: Tenant Context via Middleware

**Decision:** Extract tenant context in Express middleware, attach to request object.

**Rationale:**
- Tenant isolation enforced at request level
- Prevents data leakage across tenants
- Easy to audit tenant queries

**Alternatives Considered:**
- Context passed as parameter — error-prone, hard to audit
- Global context — thread safety concerns

**Implications:**
- Every route handler has access to req.tenant
- Queries MUST filter by req.tenant.id
- Missing tenant filter = security bug

**Status:** Accepted

---

## ADR-019: API-First Development with OpenAPI/Swagger

**Decision:** Define API contracts with OpenAPI 3.0, generate server stubs and client SDKs.

**Rationale:**
- Contract-first ensures backend and frontend alignment
- Auto-generated documentation
- Client SDK reduces integration errors
- Easier to detect breaking changes

**Alternatives Considered:**
- Code-first — documentation drifts from implementation
- Postman collections — insufficient as source of truth

**Implications:**
- OpenAPI spec is source of truth for contracts
- Breaking changes detected at build time
- Client SDK regenerated on every API change

**Status:** Accepted

---

## ADR-020: Calibration Work Orders as State Machine

**Decision:** Work orders follow strict state machine: draft → submitted → approved → completed → archived.

**Rationale:**
- Compliance: clear audit trail of work order status
- Prevents invalid state transitions
- Matches calibration lab workflow

**Alternatives Considered:**
- Free-form status field — insufficient control, audit gaps

**Implications:**
- Invalid transitions rejected at API level
- Status change audit logged with user and timestamp
- Corrections require cancellation and new work order

**Status:** Accepted

---

## ADR-021: Maintenance Records with Parts Tracking

**Decision:** Maintenance records track parts used, costs, and technician assignments.

**Rationale:**
- Supports warranty claims and cost tracking
- Enables spare parts inventory optimization
- Compliance requirement for device lifecycle

**Alternatives Considered:**
- Simple on/off maintenance flags — insufficient for compliance
- Separate parts management system — integration complexity

**Implications:**
- Maintenance records link to spare parts inventory
- Cost tracking enables ROI analysis
- Parts forecasting requires historical analysis

**Status:** Accepted

---

## ADR-022: Notification System via RabbitMQ + Multiple Channels

**Decision:** Notifications triggered by events, delivered via email, SMS, and in-app with retry logic.

**Rationale:**
- Decoupled from main request/response
- Reliable delivery with RabbitMQ persistence
- Multiple channels ensure receipt
- Audit trail of all notifications sent

**Alternatives Considered:**
- Synchronous email in request handler — blocks requests, poor UX
- Single channel only — insufficient for critical alerts

**Implications:**
- Notification templates versioned
- Delivery receipts logged for compliance
- Dead-letter queue for failed deliveries

**Status:** Accepted

---

## ADR-023: Warehouses Modeled as Hierarchical Locations

**Decision:** Warehouses contain locations in a tree structure (floor → section → bin → slot).

**Rationale:**
- Reflects real-world storage organization
- Enables accurate physical inventory tracking
- Supports barcode-based location lookup

**Alternatives Considered:**
- Flat location list — insufficient for multi-floor facilities
- GPS coordinates only — inaccurate for indoor spaces

**Implications:**
- Stock transfer queries require location path traversal
- Barcode system must encode location hierarchy
- Stock opname validates entire location tree

**Status:** Accepted

---

## ADR-024: Certificate Generation with Digital Signatures

**Decision:** Calibration certificates generated with RSA-2048 digital signatures, signed by authorized personnel.

**Rationale:**
- Compliance requirement for ISO 17025
- Digital signature prevents tampering
- Audit trail of who signed and when
- PDF export for archival

**Alternatives Considered:**
- Unsigned certificates — non-compliant
- Timestamp-only signing — insufficient proof of authorization

**Implications:**
- Private key stored securely (HSM in production)
- Signature verification requires public key distribution
- Certificate revocation process required

**Status:** Accepted

---

## ADR-025: Backup Strategy with Point-in-Time Recovery

**Decision:** Daily encrypted backups stored off-site, 30-day retention, point-in-time recovery capability.

**Rationale:**
- Compliance requirement for business continuity
- Quarterly DR drills validate recovery procedures
- Off-site storage prevents single-point failure
- 30-day window covers most incidents

**Alternatives Considered:**
- On-site only — vulnerable to facility disaster
- Continuous replication only — recovery point too recent

**Implications:**
- Infrastructure cost for backup storage
- DR runbooks required and tested quarterly
- Recovery procedure SLA < 4 hours

**Status:** Accepted

---

## ADR-026: RBAC with Three-Tier Model: Users → Roles → Permissions

**Decision:** Role-based access control with explicit role-permission assignments, no direct user-permission grants.

**Rationale:**
- Simpler to manage permissions at role level
- Role templates reduce configuration errors
- Audit trail clear: user has role, role has permissions
- Compliance audit easier to verify

**Alternatives Considered:**
- Direct user-permission grants — audit complexity, error-prone
- Attribute-based access control (ABAC) — overkill for current complexity

**Implications:**
- Permissions always checked via role membership
- Role changes effective on next session
- Bulk permission changes done at role level

**Status:** Accepted

---

## ADR-027: Separate Admin Subdomain for Trust Boundary

**Decision:** Admin panel hosted at `admin.{domain}` with independent cookies and session.

**Rationale:**
- Stored XSS in user-submitted content (guestbook, RSVP names) cannot attack admin session
- Clear security boundary for sensitive operations
- Compliance best practice: role separation
- Reduces attack surface for administrative functions

**Alternatives Considered:**
- Single domain with path separation — insufficient XSS mitigation
- Same cookies — compromised user could escalate to admin

**Implications:**
- Three hostnames required (app, public-invite, admin)
- Admin session independent from user session
- CORS config required for admin API calls
- Admin must have dedicated login flow

**Status:** Accepted

---

## ADR-028: Device Health Score Calculation

**Decision:** Device health score calculated from calibration history, last maintenance, and trend analysis (0-100 scale).

**Rationale:**
- Enables predictive maintenance scheduling
- Identifies devices at risk of failure
- Prioritizes calibration for high-risk devices
- Compliance: data-driven maintenance decisions

**Alternatives Considered:**
- Manual health assessment — subjective and audit-unfriendly
- Age-only calculation — insufficient for healthcare criticality

**Implications:**
- Score recalculated on every calibration
- Historical data required for trend analysis
- Threshold-based alerts required for critical devices

**Status:** Accepted

---

---

# Part II — Decisions Recorded After Implementation

ADR-001 through ADR-028 were written **before** the system was built. Several of them describe a system that was then built differently.

The ADRs below record what actually happened. Where one supersedes an earlier decision, it says so, and the earlier ADR is left in place rather than edited — an ADR is a record of what was decided at a moment, and rewriting it destroys the evidence that the decision changed.

**Read Part II before acting on Part I.**

---

## ADR-029: Tenant Isolation in the ORM Layer, Not Row Level Security

**Supersedes the RLS recommendation in ADR-001. Supersedes ADR-018 in mechanism.**

**Decision:** Enforce tenant isolation with global Sequelize hooks reading an `AsyncLocalStorage` context, **deny-by-default**. Remove PostgreSQL Row Level Security.

Migration `0012` added RLS. Migration `0015` removed it. Both are kept.

**Rationale:**

1. **RLS is PostgreSQL-only.** The platform must also run on MySQL (ADR-030 records why). An isolation mechanism that exists on one engine is not an isolation mechanism.
2. **The RLS policy carried a fail-open branch.** `app.current_tenant = ''` matched **every row**. A request arriving without the session variable set saw everything.
3. **Cost.** Setting and resetting the GUC cost two round-trips and a wrapping transaction on every authenticated request.

**Implementation:** `backend/src/utils/tenantScope.util.js`, installed by `models/index.js`.

```
options.skipTenantScope  → skip    explicit, greppable opt-out
no CLS context           → skip    pre-auth, public, migrations, schedulers
context.isSystemTask     → skip    background work spanning tenants
context.isSuperAdmin     → skip    cross-tenant operator
context.tenantId         → filter
otherwise                → DENY
```

The deny branch resolves to `tenantId = '00000000-0000-0000-0000-000000000000'` — a valid UUID no tenant will ever own, chosen over a sentinel string because tenant columns are UUID-typed and a non-UUID literal makes PostgreSQL raise a **type error**, turning a denial into a 500. A 500 is something people fix by removing the check.

**Alternatives considered:**

- **Keep RLS, add an application-layer fallback for MySQL.** Two mechanisms for one invariant, diverging over time. Rejected.
- **Per-tenant databases.** Revisits ADR-001 entirely; operationally far heavier at this scale.
- **Per-query filters by convention.** This is the mechanism that was replaced. A control requiring someone to remember will eventually not be remembered.

**Implications:**

- Raw SQL bypasses the hooks. Every `sequelize.query` must carry the predicate explicitly, and every new one is a review item.
- Vector similarity search on `document_chunks` does not scope itself — the highest-risk instance in the system.
- Cache keys must include the tenant id, or a leak persists after the bug is fixed until the key expires.
- `tenantKeyOf()` checks both `tenantId` and `tenant_id`, because `sessions` uses snake_case attributes.

**The rule to carry forward:** an isolation mechanism whose "no context" branch **permits** rather than denies is not an isolation mechanism.

**Status:** Accepted — **the isolation mechanism stands**; the engine-agnostic premise ("the platform must also run on MySQL") is **superseded by ADR-039**. MySQL was reason 1 of 3 for removing RLS; reasons 2 and 3 still hold.

---

## ADR-030: The Backend Is JavaScript, Not TypeScript

**Supersedes the TypeScript premise in ADR-002 and ADR-013.**

**Decision:** The backend is JavaScript, CommonJS, `"type": "commonjs"`, Node 24. The frontend remains TypeScript.

**Rationale:**

The backend originated from an Express boilerplate in JavaScript and grew to 76 services, 56 controllers, 72 models and 342 test files before the question was revisited. At that point a migration would have been a multi-month rewrite of working, tested, compliance-critical code, with the defect risk concentrated in exactly the paths that must not break.

The type-safety argument is real and was weighed against that. It lost on cost, not on merit.

**Alternatives considered:**

- **Migrate incrementally with `allowJs`.** Produces a codebase that is neither, for a long time, with two sets of conventions.
- **Rewrite.** Rejected on risk.
- **JSDoc with `checkJs`.** Genuinely attractive and still open — it buys editor-level checking without a rewrite. Not adopted; recorded here as the live option.

**Implications:**

- **`CLAUDE.md` instructed agents and engineers to write strict TypeScript with no `any` for a codebase that has no types.** That is corrected, and it is the clearest instance of the stale-specification risk (PR-4).
- `pnpm typecheck` runs meaningfully only in `frontend/`.
- There is no shared `packages/` workspace. The glob matches nothing, because a CommonJS backend and a TypeScript frontend share no code.
- Frontend API types are **hand-written** — a belief about the API, not a guarantee. Contract tests and the live suite are what keep them honest.
- JSDoc on exported functions is the only type information the backend has, which raises its value.

**Status:** **Superseded by ADR-038** (2026-09-21). Kept verbatim: it records why the migration was rejected once, and ADR-038 answers each of those reasons rather than ignoring them.

---

## ADR-031: Socket.IO Stays; the Plain-WebSocket Migration Was Reverted

**Decision:** Realtime uses Socket.IO on both ends — `socket.io` server-side, `socket.io-client` in the frontend.

A plain-WebSocket hub was trialled and **reverted by decision**.

**Rationale:** Socket.IO's reconnection, room semantics and transport fallback are the parts actually being used. Re-implementing them was work with no product benefit, and the fallback behaviour matters on hospital networks where a proxy may not pass upgrades.

**Alternatives considered:** the plain-WebSocket hub — built, evaluated, reverted. Recorded so nobody rebuilds it from an old note describing it as the direction.

**Implications:**

- The reverse proxy **must** pass WebSocket upgrade headers for `/socket.io/*`. Without them Socket.IO silently falls back to long-polling — it works, and nobody notices until connection counts matter. This is the deployment mistake most likely to go undetected.
- More than one backend replica requires the **Redis adapter**, or a notification reaches only the replica holding that connection.
- Authentication uses a short-lived socket token (`POST /auth/socket-token`), not the access token — a long-lived credential should not be handed to a transport that holds it for the life of a connection.
- **The room join takes a raw id, not a prefixed room name.** A prefixed string joins a room nobody publishes to, and the symptom is silence rather than an error.

**Status:** Accepted

---

## ADR-032: Docker Compose Is the Primary Deployment Path

**Supersedes ADR-004.**

**Decision:** Docker Compose on a single host is the primary deployment. Helm charts exist as the alternative.

**Rationale:** Most deployments are installations inside a hospital network where Kubernetes is not present and would not be welcome. Every additional runtime and control plane is a procurement conversation. A compose stack plus a reverse proxy is something a hospital IT department will accept.

This is also why both applications compile to **standalone binaries** — the production images carry no language runtime.

**Alternatives considered:**

- **Kubernetes-first** (ADR-004). Correct for a pure-SaaS product; wrong for the on-premise reality.
- **Compose only.** Leaves no escape route from the single-host risk.

**Implications:**

- Single host, single failure domain (PR-12), accepted.
- Helm charts are written and maintained, with render-time guards.
- **Their honest status: the manifests render; they are not known to be accepted by a cluster**, because no cluster has been reachable. `helm lint` and `helm template` pass; `kubectl apply --dry-run=server` has not been run. That distinction should not be smoothed over.
- Horizontal scaling has three hard prerequisites — object storage off local disk, exactly one scheduler replica, and the Socket.IO Redis adapter — plus the migration race, since migrations run at boot.

**Status:** Accepted

---

## ADR-033: Password Authentication Is Primary; OIDC Is Both Directions

**Amends ADR-005.**

**Decision:** Password login with a JWT plus a database-backed session is the primary path. OIDC and SAML are supported as a **relying party**, and the platform is additionally an OIDC **provider**.

**Rationale:** ADR-005 assumed an external identity provider. Most tenants — particularly smaller facilities — have none. Requiring one would have made onboarding depend on a procurement exercise.

Being a provider as well emerged from enterprise tenants wanting Callibrator identities in their own tooling.

**Implications:**

- The OIDC router is mounted **twice**: `/api/v1/oidc` and `/oidc` at the host root, because discovery advertises `<issuer>/oidc/...` and relying parties fetch it there. Serving it only under the API prefix produces a discovery document nobody can follow.
- Per-tenant SSO callbacks (`/sso/callback/:tenantCode`) exist because each tenant may federate with its own IdP and a shared callback cannot tell which one an assertion came from.
- MFA and WebAuthn are available and **not enforced** — including for `SUPERADMIN`, which bypasses every permission check and every tenant predicate with no second gate behind it. That is PR-3, and it is open.

**Status:** Accepted

---

## ADR-034: Sessions Live in the Database

**Amends ADR-014.**

**Decision:** `sessions` is a database table. Redis may cache lookups; the table is the source of truth.

**Rationale:** A session here is an **audit record**, not a performance optimisation. It answers "revoke this person now" and "which sessions were live on 14 March", and both need durability a cache does not offer.

**Implications:**

- Only `token_hash` is stored — a database read cannot recover a token.
- Sessions carry `ip_address`, `user_agent` and `device`. They are **recorded and never checked** — corrected 2026-09-23. `sessionSecurity.middleware.js`, named here as where the balance was struck, was dead code and was deleted under A-12. Strict IP binding breaks users on mobile networks, so the balance is a product decision; it is Q-08 in [`../TASKS/BACKLOG.md`](../TASKS/BACKLOG.md), not something the code currently expresses. Decided in ADR-084: they stay recorded, are shown to the user (`GET /sessions/mine`), and are never compared.
- **`sessions` uses snake_case attribute names** — `tenant_id`, not `tenantId`. `Session.destroy({ where: { tenantId } })` fails with `column "tenantId" does not exist`, which broke the nightly retention purge. This is recorded as a real inconsistency (PR-14), not a convention.

**Status:** Accepted

---

## ADR-035: An Invalid Certificate Transition Returns 409, and Submit Exists

**Decision:** The certificate state machine gained an explicit `submit` transition, and invalid transitions map to **409 Conflict**.

```
draft --submit--> pending_approval --approve--> approved --sign--> signed --revoke--> revoked
```

**The defect this fixed:** approving a `draft` threw a plain `Error` and surfaced as a **500** — and there was **no submit transition at all**, so approval was unreachable in practice. The 500 hid the design gap.

**Rationale:** A conflict with the current state is neither a validation failure (the request was well-formed) nor a server error (nothing broke). Reporting it as a 500 hides a design gap behind a stack trace, and a 500 is what makes people stop investigating.

**Implications:**

- `submitForApproval()` is a model method; the model owns which transitions are legal.
- The UI must present **submit as a real step**, not hide it behind approve.
- A 409 surfaces as a state explanation — "this certificate is in `draft` and must be submitted first" — never as a generic error.
- The three actor columns (`calibratedBy`, `approvedBy`, `signedBy`) stay separate: collapsing them destroys the separation-of-duties evidence that is the reason there are three transitions.

**Status:** Accepted

---

## ADR-036: Tenant `subdomain` Is Derived From `code`

**Decision:** `tenants.subdomain` is derived from `code` when not supplied. `email` falls back when absent.

**The defect this fixed:** the model required both; the creation form collected neither reliably. Every tenant create returned a 500 `notNull` violation.

**Rationale:** Asking an operator for a subdomain they do not care about, at the moment they are creating a tenant, is friction for no benefit. Deriving it is deterministic and reversible.

**Implications:**

- **`subdomain` may not resemble anything a user typed.** The UI should display it as derived, not present it as a choice.
- A `code` collision produces a `subdomain` collision. That constraint is inherited and should be surfaced at the `code` field.

**Status:** Accepted

---

## ADR-037: Tenant Status Has Three Values; Granular Lifecycle Lives in `tenant_settings`

**Decision:** `tenants.status` is exactly `active`, `suspended`, `deleted`. Granular lifecycle state — `offboarded`, grace periods — lives in `tenant_settings` under `lifecycle_status`.

**The defect this fixed:** the service wrote uppercase values such as `SUSPENDED` and a state `offboarded` that the ENUM did not contain, producing `invalid enum value` 500s on every suspend, resume and offboard.

**Rationale:** `status` is load-bearing — `auth.middleware.js` rejects every request from a suspended tenant. Keeping it to three values a middleware can compare cheaply, and putting the richer product lifecycle beside it, separates the security check from the business state.

**Implications:**

- Two places describe tenant state. Anything reading lifecycle must read both.
- Path parameters must be **merged into validation** (`{ ...req.params, ...req.body }`) — these endpoints validated `tenantId` in the body when it only ever arrives in the path, and 400ed every request. The same shape recurred across feature flags and data retention.
- **The suspension trap:** suspending the default tenant suspends the super-admin who lives in it, including the request that would reverse it. Recovery required a direct database update. Any script or test that suspends must create a **disposable** tenant first.

**Status:** Accepted

---

## ADR-038: The Backend Moves to TypeScript, Strict, Incrementally

**Supersedes ADR-030.** Date: 2026-09-21. Decided by the project owner.

**Decision:** The backend is migrated from JavaScript/CommonJS to **TypeScript with the strictest practical compiler and lint settings**, incrementally, leaf-first, on a ratchet that only moves one way. The work is planned in [`../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md).

**Until the migration completes, the code is still JavaScript.** Every backend document states its TypeScript content as the **target standard** and names current behaviour as as-built. Writing the target as if it were already true is PR-4 — the exact failure ADR-030 was written to correct — and is not permitted.

### Why now, when ADR-030 rejected it on cost

ADR-030's reasoning was sound for the question it answered. The 2026-09 audit changed the inputs:

| ADR-030 said | What the audit found since |
|---|---|
| type safety lost on **cost, not merit** | the defects found this month are overwhelmingly the kind a type checker rejects: `req.body.roleId` on an `undefined` body, `db` destructured from a barrel that exports `sequelize`, `res.query` read where `req.query` was meant, `$1` placeholders passed as `replacements` |
| the codebase is **working, tested** | 5,746 tests passed while those defects shipped, and one test asserted the `replacements` bug as correct behaviour. Mocked tests prove the client, not the contract |
| incremental `allowJs` produces a codebase that is **neither, for a long time** | true, and accepted with three mitigations: a strict order, a ratchet, and a rule that conversion never changes behaviour |

### The compiler settings

`strict: true`, and on top of it:

```jsonc
{
  "noUncheckedIndexedAccess": true,       // arr[i] is T | undefined
  "exactOptionalPropertyTypes": true,     // { a?: string } does not accept a: undefined
  "noImplicitOverride": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true,
  "noPropertyAccessFromIndexSignature": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "isolatedModules": true,
  "forceConsistentCasingInFileNames": true,
  "allowJs": true,                        // removed when Phase 9 closes
  "checkJs": false
}
```

`useUnknownInCatchVariables` comes with `strict`: every `catch (e)` is `unknown` and must be narrowed.

**`verbatimModuleSyntax` is deliberately off during the migration.** It is incompatible with emitting CommonJS from `import` syntax, and emitting CommonJS is required (below). The `consistent-type-imports` lint rule provides most of its value. Revisit with the ESM decision.

### The lint rules that make "strict" mean something

`typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, with these as **errors**:

| Rule | Why it is non-negotiable here |
|---|---|
| `no-explicit-any` | `any` switches the checker off silently, which is worse than no checker because it looks like one |
| `no-unsafe-assignment`, `-member-access`, `-call`, `-return`, `-argument` | contain the `any` that arrives from untyped dependencies |
| `no-floating-promises`, `no-misused-promises` | an un-awaited audit write, or an async Express handler whose rejection nobody catches |
| `switch-exhaustiveness-check` | certificate, transfer and CAPA state machines: a new state must fail compilation everywhere it is not handled |
| `no-non-null-assertion` | `!` is a runtime crash the author promised would not happen |
| `ban-ts-comment` | `@ts-ignore` banned; `@ts-expect-error` only with a written reason |
| `consistent-type-assertions` (`objectLiteralTypeAssertions: never`) | `{...} as User` builds an object the checker never verified |
| `explicit-module-boundary-types` | exported functions declare their return types — the types are the documentation JSDoc used to be |
| `no-restricted-properties` on `process.env` outside `src/config/` | configuration is parsed and validated once, not read raw in 40 places |

### Decisions inside the decision

| Area | Choice | Alternative rejected, and why |
|---|---|---|
| Module output | **CommonJS** emitted from `import` syntax (`"module": "Node16"`, package stays `"type": "commonjs"`) | ESM now: two migrations at once, and `@yao-pkg/pkg` packages CommonJS reliably. ESM is a later, separate ADR |
| Runtime validation | **Zod**, replacing Joi module by module; the schema is the single source of the runtime check **and** the request type | keep Joi: its types do not flow into handlers, so `req.body` stays unchecked at compile time |
| Models | Sequelize 6 native typing — `Model<InferAttributes<M>, InferCreationAttributes<M>>` with `declare` fields | `sequelize-typescript` decorators: `experimentalDecorators`, a second model DSL, and 72 models to rewrite rather than annotate |
| Express types | `@types/express` 5; `req.user`, `req.tenantId`, `req.requestId` added by declaration merging in `src/types/express.d.ts` | casting `req as AuthedRequest` per handler — what `consistent-type-assertions` exists to stop |
| Raw SQL | a typed `sql()` helper that accepts **only** `bind` parameters and a result row type | free-form `db.query`: the `replacements`/`$1` mismatch is exactly what an untyped options bag lets through |
| Tests | **Jest 30 stays**, transformed by `@swc/jest`; the 100% coverage gate stays | Vitest: a second migration alongside the first, across 342 test files |
| Dev runtime | `tsx` for `dev` and scripts | `ts-node`: slower, and its module handling is the part most likely to fight `allowJs` |
| Build | `tsc -p tsconfig.build.json` → `dist/`, then `pkg dist/index.js` | `bun build --compile`: already a second, unmaintained build path (`build:bun`); it is removed |
| Shared contracts | a `packages/contracts` workspace holding the Zod schemas, consumed by the frontend | hand-written frontend API types: ADR-030 called them "a belief about the API, not a guarantee" |

### Three rules that keep the dual state survivable

1. **Order.** Leaf-first: `types` and `constants` → `utils` → `config` → `models` → `validators` → `services` → `middlewares` → `controllers` → `routes` → `index`. A file is converted only when everything it imports already is, so a `.ts` file never depends on an untyped `.js` one.
2. **Ratchet.** `scripts/ts-ratchet` counts `.js` files under `backend/src` and fails if the count rises. New backend code is TypeScript from the day this ADR is accepted. The count only goes down.
3. **Conversion never changes behaviour.** A conversion PR changes types, syntax and imports — nothing else. When the checker exposes a bug, the bug is fixed in its **own** PR against an audit task (`TASKS/AUDIT-2026-09-REMEDIATION.md`). A conversion that also fixes three bugs cannot be reviewed as either.

### Alternatives considered

- **Stay on JavaScript; adopt JSDoc with `checkJs` (ADR-030's open option).** Cheaper, and it catches a meaningful share of the same defects. Rejected by the owner: JSDoc cannot express much of what strict TypeScript enforces — exhaustiveness, `noUncheckedIndexedAccess`, branded types — and keeps `any` one missing annotation away.
- **Big-bang rewrite.** Rejected on risk, as in ADR-030.
- **Port to a different language.** A Go port was explored in a separate checkout; none of it is in this repository. Rejected: it discards tested domain logic rather than typing it.
- **ESM and TypeScript together.** Rejected; see module output above.

### Implications, including the bad ones

- **A long dual state.** Roughly 300 source files and 342 test files. Two conventions coexist until the ratchet reaches zero, and reviewers must know which rules apply to which file.
- **Security fixes do not wait for types.** The cross-tenant write on `tenant-hierarchy` and the unguarded configuration routes found in the audit are fixed **in JavaScript, first** (`AUDIT-2026-09`, wave 0). A months-long migration is not a reason to leave a live hole open.
- **The build gets a step.** `tsc` before `pkg`, and the Dockerfile changes. A broken type build now blocks a release — which is the point.
- **Tests get slower** by the transform cost; `@swc/jest` keeps it small.
- **Coverage must not dip.** Each conversion runs the full suite, not just its own tests.
- **Every backend document carries a target-vs-current banner** until Phase 9 closes. Removing a banner is part of finishing the module it describes.

**Status:** Accepted. **Amended by ADR-087** (2026-09-28): the test transform is babel-jest, not `@swc/jest`; the build copies unconverted JavaScript into `dist/` instead of emitting it with `tsc`; the target is ES2025; shared types live in `backend/src/types/`

---

## ADR-039: PostgreSQL Is the Only Supported Database

**Supersedes the engine-agnostic premise of ADR-029.** The ORM-layer, deny-by-default tenant isolation of ADR-029 stands unchanged. Date: 2026-09-21. Decided by the project owner.

**Decision:** PostgreSQL with the `pgvector` extension is the only supported database.
(The version was 17 when this was written; **ADR-041 moves the baseline to 18** — the engine decision below is unaffected.) MySQL support is removed from code, configuration and documentation. `DB_DIALECT` is no longer required; any value other than `postgres` refuses to start.

### Why

MySQL support was a claim, not a capability. The 2026-09 audit found:

| Evidence | Consequence on MySQL |
|---|---|
| `mysql2` is **not a dependency** of the backend | Sequelize cannot load the dialect at all — the stack never starts |
| `search.service.js` uses `tsvector`, `plainto_tsquery`, `ILIKE` and double-quoted identifiers | search fails, falls back, fails again, and **returns an empty list with no error** |
| `webhooks.events` is `JSONB` matched with `Op.contains` | webhook fan-out cannot run |
| `ai.service.js#retrieveContext` had a non-pgvector branch | it returned the five most **recent** chunks as "context" — confident answers from the wrong documents |
| `meteredBilling.service.js` had one branch per engine | the PostgreSQL branch was the broken one (`$1` passed as `replacements`), so production silently read every tenant's usage as **zero** while the MySQL branch — which never ran — was correct |

That last row is the real cost of a phantom second engine: each feature is written twice, only one copy runs, and the tests exercise whichever copy their mock happened to pick.

### What changed in the code

| File | Change |
|---|---|
| `src/config/index.js` | dialect fixed to `postgres`; `DB_DIALECT` optional and validated; MySQL config and bootstrap branch removed |
| `src/services/meteredBilling.service.js` | single PostgreSQL path, placeholders passed as **`bind`** — fixes the zero-usage defect |
| `src/services/ai.service.js` | single pgvector path; the recency fallback is gone |
| `src/services/gdpr.service.js` | a dialect ternary with identical branches removed |

Deliberately **not** changed:

- **Applied migrations** (`0012`, `0015`, `0018`) keep their dialect guards. A migration that has run is history; rewriting it changes nothing on existing databases and invites divergence on new ones.
- **`sessionSecurity.middleware.js`** kept its dialect branches because it was **dead code** — imported by nothing, and its SQL targeted a `"Sessions"` table that does not exist. Resolved **2026-09-23**: deleted under audit finding A-12, with its tests. Wiring it in would have changed authentication behaviour on a decision nobody had made, so that became Q-08 instead.

### What PostgreSQL-only now permits

These were avoided, or worked around, to stay engine-agnostic. They are now ordinary tools — each still needs its own decision:

- recursive CTEs (the materialised path in `tenant_hierarchies` was chosen because "CTE support differs");
- partial and expression indexes, `JSONB` operators, generated columns, `tsvector` search as a first-class feature;
- `REVOKE UPDATE, DELETE` on `calibration_records` and `audit_logs` — the append-only guarantee as a grant, not a convention (PR-2);
- **Row Level Security as defence in depth.** ADR-029 removed RLS for three reasons: MySQL, a fail-open policy branch, and per-request cost. Only the first is gone. RLS is therefore an **open decision**, not an automatic return.

### Alternatives considered

- **Make MySQL genuinely work** — add `mysql2`, port search to `MATCH ... AGAINST`, replace `JSONB`/`Op.contains`, find a vector store. Rejected: significant work for a deployment target no customer has asked for, and a permanent tax of two implementations per feature.
- **Keep the claim, document it as unsupported.** Rejected: a documented-but-false capability is what PR-4 warns about.

### Implications

- **One engine to test against.** The live E2E suite and any future CI run against `pgvector/pgvector:pg17`, and PostgreSQL-specific SQL no longer needs a fallback.
- **Raw SQL remains the isolation risk it always was** (ADR-029): every `db.query` carries its tenant predicate explicitly, bound as a parameter.
- **Existing deployments are unaffected** — they are all PostgreSQL.

**Status:** Accepted

---

## ADR-040: Electronic Signatures Are RSA-Signed Over a Canonical Payload, and Verification Verifies

**Date:** 2026-09-23 · **Finding:** A-47 · **Supersedes:** nothing — this is the first working version of the control

**Context**

`eSignature.service.js#generateSignatureHash(documentId, userId, tenantId)` built
`${documentId}:${userId}:${tenantId}:${Date.now()}` and SHA-256'd it. `verifySignature` called that
same function again and compared the result to the stored hash. Because `Date.now()` was inside the
payload, the recomputed value could never equal the stored one: **`verifySignature` returned
`valid: false` for every genuine signature ever made.**

And there was nothing behind it. The per-tenant RSA key pairs — created, listed and deleted through
the API, private half encrypted at rest — were **never used to sign or verify anything**;
`verifySignature` read no key at all. The "electronic signature" was a SHA-256 of a timestamp. It
bound no document, no signer and no tenant, it could not be verified, and it could not distinguish
a genuine record from a fabricated one. This system claims FDA 21 CFR Part 11 and ISO 13485
conformance, and this is the artefact those claims rest on.

**Decision**

1. Signing produces an **RSA-SHA256 signature with the signing tenant's private key**
   (`crypto.sign`) over a canonical payload binding: scheme, algorithm, `tenantId`, `documentId`,
   `workflowId`, `workflowStepId`, signer `userId`, `signedAt`, `authenticationMethod` and the
   signature's `reason` (its *meaning*, per § 11.50(a)(3)).
2. The payload is serialized as a JSON **array of `[name, value]` pairs** in an order fixed by one
   module constant, every value stringified, `null` and `undefined` collapsed to `""`. Key order
   cannot drift, and a NULL column and an empty string cannot produce two different payloads for
   the same record.
3. `signedAt` is computed **once**, before signing, and is the value stored. Verification
   reconstructs it from the stored column at fixed millisecond ISO-8601 precision. **No value in
   the payload is ever derived from the verification-time clock** — that was the defect.
4. `signature_records` gains `signature_value`, `signing_key_id`, `signature_scheme` and
   `signature_reason` (migration `0019-add-signature-crypto-fields.js`, all nullable, **no
   backfill**).
5. Verification loads the key by `signing_key_id` with **`paranoid: false`**, so a soft-deleted key
   still verifies its past signatures; the parent workflow is read the same way, so soft-deleting a
   workflow does not erase the evidence of signatures made against it. Verification uses the public
   key only.
6. `verifySignature` returns a `verificationStatus` enum —
   `valid | invalid | revoked | not_found | workflow_missing | unverifiable_legacy | unverifiable_key_missing | error`
   — alongside the `valid` boolean, which is `true` only for a cryptographically verified signature.
7. Signing with no provisioned key pair is **409**, not 500: an unmet precondition with a stated
   remedy is not a server fault.
8. Records written before this ADR carry `signature_scheme IS NULL` and are reported
   `unverifiable_legacy` — **never `valid`, never `invalid`**.

**Rationale**

§ 11.70 requires the signature to be *linked to its record* so it cannot be excised, copied or
transferred; § 11.50 requires the signer, the timestamp and the meaning to be part of the signed
manifest. A keyed signature over a canonical payload containing exactly those fields is the minimum
that satisfies this, and the only construction that lets an auditor check a record without trusting
the application. Determinism is not a nicety: a payload that serializes differently on a different
Node version silently turns the whole archive invalid.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Keep the hash, just remove `Date.now()` | a SHA-256 over public, guessable fields proves only that someone who knows the fields can recompute it. It cannot tell a signature from a forgery, and it leaves the key pairs dead code |
| HMAC with a tenant secret | symmetric: anyone who can verify can forge, so the record has no evidentiary weight **against the operator** — which is the party an audit is checking |
| Per-signer keys instead of per-tenant | the stronger construction and the right eventual target, but no per-user key material or enrolment flow exists. Deferred deliberately; the consequence is recorded below |
| Detached JWS or PKCS#7/CAdES | premature — a dependency and a format decision for a module with no external-verifier requirement yet. The canonical payload can be re-wrapped as JWS later without changing what is bound |
| Backfill old rows with a scheme marker, or re-sign them now | **refused.** Signing an old record today asserts a property that never existed and dates it wrongly. That is falsifying a Part 11 record |
| `JSON.stringify` of an object with sorted keys | still depends on the implementation's key handling, and on nobody adding a nested object later. An explicit ordered array does not |

**Implications, including the bad ones**

- Every signature made before this change **cannot be verified and never will be**. They are
  flagged `unverifiable_legacy`. Where such a record backed a regulated approval, that reliance has
  no cryptographic backing and needs a QA assessment. *On the reference deployment this is moot:
  `signature_records` is **empty** (checked 2026-09-23, 0 rows, 0 workflows, 0 tenant keys) — the
  feature was never used in anger, which is the only reason this is a bug fix rather than an
  archive recovery.*
- Signing now **fails with 409 for any tenant with no key pair**. Nobody is blocked today (there
  are none, and nobody signs), but generating a key pair becomes a prerequisite step before the
  first signature — an operational step that did not exist.
- The private key is protected by `ENCRYPT_KEY` (AES-256-CBC) in `eSignature.service.js`, **not**
  by `kms.service.js`, which protects every other tenant secret. This ADR deliberately does not
  change that — re-wrapping existing keys is its own change — so it is now the weakest link in the
  chain and should be the next one addressed.
- `signature_reason` is bound but **not yet populated**: the controller and validator do not accept
  a `reason`, so signatures currently bind an empty meaning. A residual § 11.50(a)(3) gap, and a
  two-line follow-up.
- A hard `DELETE` on `tenant_keys` — or a GDPR purge, or a tenant cascade — permanently makes every
  signature that key made unverifiable (`unverifiable_key_missing`). Honest, and unrecoverable.
  Public keys arguably belong in a separate, never-deleted archive.
- These are **per-tenant** keys held by the service, so a verified signature proves *the service
  signed for that user at that time*. It is not non-repudiation against the operator; § 11.200's
  "sole use by their genuine owner" is met administratively, not cryptographically.
- There is **no trusted timestamp**. `signedAt` is the application's clock, bound but unattested. A
  skewed or malicious server can date a signature freely. Long-term archival would need RFC 3161.
- Key rotation remains **undesigned**: `generateKeyPair` inserts another row and signing picks the
  newest. Old signatures keep verifying against their own `signing_key_id`, which is the part that
  matters, but there is no ceremony, no overlap policy and no way to tell a rotation from an
  accident.
- Signing now costs an RSA operation and an AES decryption. Negligible here, but it is no longer a
  pure hash.

**Verification**

`npx jest src/tests/services/esignature src/tests/controllers/eSignature src/tests/routes/eSignature`
→ 6 suites, 116 tests, 100 % on `eSignature.service.js`. The new
`services/esignature.signing.test.js` uses a **real** 2048-bit RSA key and the real at-rest
wrapper, not a mocked signer — a mocked signer is the class of test that let this defect live.
Named: "verifies as valid — the case that could never pass before ADR-040"; "verifies as INVALID
when the signing timestamp is changed after signing"; "still verifies a signature whose key has
been soft-deleted"; "is reported as unverifiable_legacy — neither valid nor a forgery"; "fails with
409 and an actionable message when no key pair is provisioned".

**Not known to work:** migration `0019` has **not been run** — no database was reachable from the
machine that wrote it. It is written to fail loudly rather than no-op silently, and the columns must
be confirmed in `psql` after `make migrate`.

**Status:** Accepted

---

## ADR-041: PostgreSQL 18 Is the Baseline

**Date:** 2026-09-23 · **Amends:** ADR-039 (which fixed *PostgreSQL only*; that stands — this
changes the **version**, not the engine)

**Context**

ADR-039 removed MySQL and fixed PostgreSQL 17 with `pgvector` as the only supported database. The
owner has asked for **PostgreSQL 18**. PostgreSQL 18 is the current major release and `pgvector`
publishes an image for it; both `pgvector/pgvector:pg18` and `postgres:18-alpine` were confirmed to
exist before this ADR was written, rather than assumed.

**Decision**

1. **PostgreSQL 18 with `pgvector` is the supported database.** The compose stacks pin
   `pgvector/pgvector:pg18` — still the pgvector image, not `postgres:18-alpine`, because migration
   `0018` runs `CREATE EXTENSION vector` and plain Postgres fails it. That reason is unchanged from
   ADR-039; only the number moved.
2. Every document that stated "PostgreSQL 17" now states 18, and each says it is a **target the
   deployment has not yet reached** until the running instance is actually upgraded.
3. The running deployment is **not** upgraded by this decision. It runs 17.11 today, and moving it
   is a separate, scheduled operation with a runbook — see below and
   [`../TASKS/RUNBOOK-POSTGRES-18-UPGRADE.md`](../TASKS/RUNBOOK-POSTGRES-18-UPGRADE.md).

**Rationale**

Nothing in this codebase depends on a version-specific behaviour of 17: access is through Sequelize
6, the only extension is `pgvector`, and the raw SQL is ordinary. The cost of the move is therefore
not in the code — it is entirely in the data directory, and that cost is the same whenever it is
paid. Paying it while the deployment holds one tenant and a small dataset is cheaper than paying it
later.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Stay on 17 | supported until November 2029, so there is no forced date. Rejected because the owner asked for 18 and the migration only gets more expensive as the dataset grows |
| Move to 18 in development, keep 17 in production | the configuration drift is the risk: this project's worst incidents come from an environment differing from what documents claim. Two engines in two places is that shape |
| Change the image tag and restart | **this does not work**, and believing it does is the trap this ADR exists to prevent. See the implications |

**Implications — including the bad ones**

- **A PostgreSQL data directory cannot be read by a different major version.** The volume on the
  reference VM was initialised by 17.11. Starting `pgvector/pgvector:pg18` against it fails at
  boot with *"The data directory was initialized by PostgreSQL version 17, which is not compatible
  with this version 18"*. The container will crash-loop. This is the entire cost of the decision
  and it is not optional: the move requires **`pg_dump` → fresh volume → restore**, or
  `pg_upgrade` with both binaries present.
- **`initdb` in 18 enables data checksums by default**, where 17 did not. For a dump-and-restore
  path this does not matter. For `pg_upgrade` it does — both clusters must agree, and a mismatch
  aborts the upgrade. Check `SHOW data_checksums` on the old cluster before choosing the path.
- **The `vector` extension is versioned separately from the server.** After a restore, run
  `ALTER EXTENSION vector UPDATE` and confirm `document_chunks` still has its index; a vector index
  built under one extension version is not guaranteed to be read by another.
- **Downtime is real.** Dump, restore and verify against the live dataset. It is small today — one
  tenant — which is the argument for doing it now rather than later.
- **Rollback is the old volume.** Keep it, do not delete it, and do not reuse the volume name. If
  the restore is wrong, the way back is to re-point compose at the 17 image and the untouched
  volume.
- **Nothing tests this.** There is no CI (A-19), the live E2E suite has never completed an
  uninterrupted run (P6-02), and no load test exists (U-06). So "the application works on 18" is a
  claim that will rest on a manual pass after the upgrade — not on a gate. Do not write it as fact
  in any document before that pass happens.
- **Two compose files pin the image** — `deploy/compose/docker-compose.yml` and
  `backend/docker-compose.yaml`. They were both changed; a future third would drift silently,
  because nothing checks that they agree.

**Status:** Accepted — **the repository targets 18; the deployment still runs 17.11.** That
distinction is the point, and it is stated in every document this ADR touches.

---

## ADR-042: File Serving — One Public Class, Everything Else Behind a Capability

**Date:** 2026-09-23 · **Findings:** S-01, A-57 · **Debate:**
[`../TASKS/DEBATE-file-serving-A-lockdown.md`](../TASKS/DEBATE-file-serving-A-lockdown.md) ·
[`../TASKS/DEBATE-file-serving-B-static.md`](../TASKS/DEBATE-file-serving-B-static.md)

**Context**

This codebase serves files two incompatible ways at once, and has since before either design was
finished.

| | |
|---|---|
| A **capability** design | `services/storage/signing.js`, `GET /api/v1/storage/object`, `GET /api/v1/attachments/:id/signed` — HMAC-signed paths, 300-second TTL, pluggable drivers, per-tenant prefixes |
| A **static mount** | `index.js:339-349` serves `/uploads` through `express.static` with no authentication, and both nginx configs proxy it |

Certificate PDFs are written into that mount as `CERT-<YYYYMMDD>-<tenantCode>-<sequence>.pdf`
(`certificatePdf.service.js:199-205`, `certificate.model.js:183-215`) — a counter, not a secret.

Two agents were asked to argue the question from opposite sides, and both papers were then checked
against the code rather than taken at their word. That check changed the outcome, so it is recorded
here.

**What the check found**

1. **The capability path already revokes; the static mount is what defeats it.** The lockdown paper
   assumed revocation was a benefit it still had to build; the static paper asserted that
   revocation "works identically under both designs". **Both were wrong.**
   `attachment.model.js:96-98` sets `defaultScope: { where: { is_deleted: false } }`, and
   `getSignedDownload` reads through `Attachment.findByPk` — so a soft-deleted attachment returns
   **404 on the capability path**, today, with no further work. `express.static` has no such
   notion and keeps serving the file. The delete that A-28 made auditable is honoured by one path
   and silently ignored by the other.
2. **The capability path cannot serve what the product renders.** `storage.controller.js:46-68`
   sets `Content-Type`, `Content-Length` and a hardcoded `Content-Disposition: attachment`, and
   emits **no `ETag`, no `Last-Modified`, no `Accept-Ranges`**, ignoring `Range` entirely. It
   cannot back an `<img>` or the `<iframe>` on the public verification page, and it cannot be
   seeked. "Move everything behind the capability" is therefore not a decision anyone can execute
   this week — it is blocked on that controller.
3. **The public verification endpoint publishes the PDF path of a `draft` certificate.**
   `certificatePdf.service.js:286` computes `valid` from signed/revoked/expired, and `:313` then
   returns `documentUrl: cert.filePath || null` **unconditionally** (A-57). The status gate exists
   one line above the leak.

**Decision**

Neither "delete the mount" nor "keep the mount" — **split the classes, and fix the filename first.**

1. **The certificate filename stops being the certificate number.** `safeFileName` emits a random
   token; the number stays the identifier, the filename becomes unguessable. This kills enumeration
   without touching the architecture, and it is the first thing to ship.
2. **`documentUrl` is gated on issued status.** A `draft` or `revoked` certificate returns `null`,
   not a path.
3. **One deliberately public class**, in its own directory `uploads/public/`, reached by a
   permissioned, audited action: avatars, tenant logos, published CMS images. These keep the static
   mount, keep CDN and `next/image` caching, and carry a strict per-type `Content-Type`
   allowlist — `image/svg+xml` is allowed today (`tenant.route.js:377-390`) against the upload
   utility's own warning, held shut only by a magic-byte check.
4. **Everything else leaves `/uploads`**: certificates, attachments, exports, backups. They are
   reached through the already-gated routes, which already respect the soft delete.
5. **Before (4) can happen**, `storage.controller.js#getObject` gains conditional requests, range
   support and a content-type-driven disposition. This is the sequencing constraint the static
   paper is right about, and it is a precondition, not an objection.
6. **Deleting an attachment unlinks the object** inside the same transaction as the audit row.
   Both designs need this; neither has it.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Delete the static mount now, serve everything through the API | breaks the verification `<iframe>` and every avatar immediately, per finding 2. The right end state, the wrong first step |
| Keep `/uploads` as is, only randomise filenames | leaves evidence on permanent unauthenticated URLs that survive deletion — and the delete path is exactly what A-28 made auditable |
| Put a CDN in front and sign at the edge | no CDN exists in front of this deployment today; a design that needs infrastructure nobody has is not a decision, it is a wish |
| Keep both paths and document which is which | this is the status quo, and it is how one path came to honour deletion while the other did not |

**Implications — including the bad ones**

- **Avatar-heavy screens lose CDN caching** for anything that moves behind the gate. The public
  class exists precisely to keep that cost where it is felt; if a later measurement shows it is
  still too slow, that is an argument about which class a file belongs to, not about the split.
- **On this deployment, `/api/` is served by the frontend**, whose proxy buffers whole requests and
  responses into an `arrayBuffer` (F-16). Streaming a 25 MB attachment through it would double-buffer
  in the Next heap. That must be fixed or bypassed before large files move — a second precondition,
  and it is unverified because nothing has been measured.
- **Existing URLs break** when files move. There are **zero** certificates and **zero** attachments
  on the reference deployment today (checked 2026-09-23), so the migration cost is zero now and
  permanently non-zero after the first certificate is issued.
- **The storage façade is mock-tested only.** Moving evidence onto a path this project has never
  exercised against a real bucket is a risk the plan takes deliberately by using the already-gated
  legacy routes first.

**Status:** Accepted — step 1 and step 2 are immediate; steps 3–6 are sequenced behind the
`getObject` work.

---

## ADR-043: Authorization — Fix the Data, Then Retire the Ladder

**Date:** 2026-09-23 · **Findings:** V-01, A-07, A-58 · **Debate:**
[`../TASKS/DEBATE-tenant-admin-A-fix-the-principal.md`](../TASKS/DEBATE-tenant-admin-A-fix-the-principal.md) ·
[`../TASKS/DEBATE-tenant-admin-B-retire-the-ladder.md`](../TASKS/DEBATE-tenant-admin-B-retire-the-ladder.md)

**Context**

Every route gated `rbac([ROLE_NAMES.TENANT_ADMIN])` refuses every tenant administrator. Four
routers are affected — `apiKeys`, `webhooks`, `storage` (gated 2026-09-23 under A-02/A-27) and
`tenantBackup` (older, so it has been SUPERADMIN-only for longer than anyone noticed). A hospital's
own admin cannot issue an API key or configure storage in their own tenant.

Three facts, each verified in the code:

1. `rbac.middleware.js:38-39` decides by `role_level`, and **no loader selects it** —
   `auth.service.js:174`, `:410`, `:451` project `["id","name"]` / `["id","name","description"]`.
2. Even if it were projected, **nothing writes it**. `role.model.js:36-39` defaults `roleLevel` to
   `1`, and neither seed array in `migration.service.js` sets it. Every seeded role is level 1.
3. `ROLE_NAMES.TENANT_ADMIN` is a logical tier, not a seeded role, so the name check cannot match
   either.

Two agents argued opposite positions. The debate converged, which is worth recording: the paper
arguing to retire the ladder concedes the other's fix "ships today and mine does not, and is
necessary independently of mine"; the paper arguing to keep the tier concedes the direction and
hands over `metered-billing` outright.

**The finding that decided it**

Both mechanisms fail the same way, and it is not about levels.

The retirement paper's own check found that **none of the four slugs needed to convert those
routers exists in both places**: `api-keys` and `webhooks` are seeded menu rows but are absent from
`MENU_SLUGS`; `storage` and `tenant-backups` exist in neither. And the tier paper found that
converting `metered-billing` — the one slug that does exist everywhere — **reproduces the identical
lockout**, because `HEALTHCARE ADMIN` holds only `READ` there and `CALIBRATOR ADMIN` has no row at
all.

This is not hypothetical. `workflows.route.js` gates five routes on `dynamicAccess("workflow", …)`
— **singular** — while `MENU_SLUGS` and the seed both say `workflows`. Those five routes deny
everyone but SUPERADMIN today (A-58), through the mechanism that was supposed to be the safe one.

So: **the defect is unvalidated authorization data, in whichever mechanism holds it.** A constant
that describes something the database does not have is the same failure as `connected` on ioredis
and `isOpen` on amqplib — the third instance this month, and the first one inside the
authorization layer.

**Decision**

1. **Ship the principal fix in full, now.** Add `roleLevel` to the four Role projections *and* the
   hand-built role literal in `verifyUserSession`; set `roleLevel` in both seed arrays; add
   migration `0020` to backfill already-seeded databases, because `seedDefaultRoles` skips existing
   roles so a seed edit alone changes nothing. Cap tenant-created roles below the SUPERADMIN tier.
   This is necessary under either future and it unblocks four routers today.
2. **Convert `metered-billing` to `dynamicAccess` in the same change**, and close its grant gap —
   its slug exists in the constant, the seed and the assignments, and it is a menu, not a privilege
   floor.
3. **Do not convert the other four routers yet.** Converting before the slug, seed and assignment
   work would replace a named denial with a silent one, which is strictly worse. The slug work is
   its own task, sequenced behind the high-severity board.
4. **Fix `"workflow"` → `"workflows"`** (A-58), and treat it as the proof that this class of error
   is live rather than theoretical.
5. **The real deliverable is the assertion, not the choice.** The system refuses to start when a
   `dynamicAccess` resource name matches no seeded slug, or when a `ROLE_NAMES` key has no
   `ROLE_LEVELS` entry, or when the `roles` table disagrees with the constants — naming the offender.
   `config/index.js` and `jwt.util.js` already establish that pattern. Without it, both mechanisms
   keep failing silently and the next instance is found by a customer.
6. **Direction: `rbac` retires.** 37 of its 68 routes are name-matched `SUPERADMIN` and are a
   rename to the existing `superAdminOnly`; the remaining 31 are tier-gated and all currently
   denying. `dynamicAccess` stays the default. `tenant-backups` **restore** is a genuine privilege
   floor and keeps a named guard rather than a menu row.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Add the column and stop | leaves two authorization systems, one of which has no data model and has been decorative its entire life |
| Convert all four routers to `dynamicAccess` now | none of the four slugs exists in both the constant and the seed. It converts a visible 403 into an invisible one — A-07, which is already live five times over in `workflows.route.js` |
| Enumerate real role names in the gates | works today, and bars every runtime-created custom role from ever holding admin privilege. It also restates one requirement at eleven call sites |
| Leave it: the gates are "dormant and fail-closed" | a 403 to an administrator becomes a support ticket, and the fastest fix to hand is a SUPERADMIN account — which bypasses both the gate and tenant scoping |

**Implications — including the bad ones**

- **Backfilling wakes eleven gates at once** on five high-consequence surfaces. They have never run
  against a real principal, so their first real exercise happens in production unless the
  integration test below lands with them.
- **The ladder becomes load-bearing** for as long as it takes to retire it, which is the opposite
  of the direction. Accepted deliberately: a live lockout outranks an architectural preference.
- **A numeric scalar cannot express "administers storage but not billing."** The moment a customer
  asks for that, the tier is the wrong answer and the conversion work must already be underway.
  The engineer who wrote `rbac(["TENANT_ADMIN","BILLING_ADMIN"])` — a role name that exists in no
  constants file and no seed — was reaching for exactly that.
- **Widening `MENU_SLUGS` widens API-key scope issuance**, because `apiKey.service.js` validates
  scopes against it. The two vocabularies need splitting before the slug work, or issuing a key
  becomes a way to reach a surface the gate was meant to restrict.
- **`dynamicAccess` is not clean either** — AZ-04 (403 where the rule says 404), a 500 carrying
  `error.message`, and an override lookup that fails **open**. Retiring `rbac` in its favour
  inherits those, and they are open findings.
- **Nothing in either paper was tested against a running server.** The first action under this ADR
  is to log in as `HEALTHCARE ADMIN` and `POST /api/v1/webhooks` — fail before, pass after, named
  in the record.

**Status:** Accepted — steps 1, 2 and 4 immediate; steps 3, 5 and 6 sequenced.

---

## ADR-044: npm Is the Package Manager, and Its Lockfile Is Committed

**Date:** 2026-09-23 · **Finding:** A-21 · **Phase:** 0 (foundation)

**Context**

`.gitignore` excluded **all three** lockfiles — `package-lock.json`, `pnpm-lock.yaml` and
`bun.lock` — so a clean clone resolved every floating range afresh. The repository also declared
its workspaces twice: an npm-style `workspaces` array in `package.json` and a
`pnpm-workspace.yaml`. The `Makefile` — the documented entry point — called `pnpm` for install and
for every gate, while calling `npm` for migrations and the E2E suite.

This is not theoretical debt. It has already cost a gate: the backend asked for `eslint ^10.10.0`
while the root pinned `9.22.0`, hoisting resolved to 9.22.0 with `@eslint/js` 10.0.1, and
`js.configs.recommended` from 10.x enables a rule 9.22 does not have. **ESLint crashed before
linting a single file**, and because `make verify` runs lint first, that gate could never have
passed on any machine (A-34). A floating tree produced a broken gate that looked like a config
error.

**Decision**

1. **npm is the package manager.** `package-lock.json` is committed.
2. Every `Makefile` target uses `npm`; `make install` is **`npm ci`**, not `npm install`, so the
   committed lockfile is honoured rather than updated in place.
3. `pnpm-lock.yaml` and `bun.lock` stay ignored, and so do nested `backend/package-lock.json` and
   `frontend/package-lock.json` — a lockfile inside a workspace silently produces a different tree
   from the hoisted root one, which is the same failure mode again one level down. A stale one
   dated 2026-07-28 was found in `backend/` during this work.

**Rationale**

npm wins on evidence, not preference: the committed tree is the one the suite is actually proven
against. **6,128 tests and the lint gate run green against this `node_modules`**, installed by npm.
`pnpm`'s strict, non-hoisted layout is defensible and arguably better, but nothing in this
repository has ever been verified under it, and this is a compliance-critical codebase with a
packaged binary build (`@yao-pkg/pkg`), Puppeteer and native dependencies — the exact set most
sensitive to layout. Choosing the unverified option to gain strictness would be trading a known
tree for an unknown one on a day when four gates are already red.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| pnpm, matching `pnpm-workspace.yaml` and the Makefile | nothing has been tested under pnpm's layout. It may well be the better end state; it is not a change to make blind, and it belongs with the CI work (P7-01) where it can be proven |
| Commit all three lockfiles | three answers to one question. The next person resolves the ambiguity by guessing |
| Leave them ignored and pin exact versions in `package.json` | pins the direct dependencies and leaves every transitive one floating — which is where the ESLint break actually came from |

**Implications — including the bad ones**

- **`pnpm-workspace.yaml` still exists and now contradicts this ADR.** Deleting it is the tidy
  follow-through, and it is deliberately **not** done here: nothing depends on it today, and a file
  removal is easier to review on its own than buried in a foundation change. It is an Open Question
  in `TASKS/BACKLOG.md`, not a loose end.
- **`npm ci` fails outright when `package.json` and the lockfile disagree.** That is the point, and
  it will be a nuisance the first time someone edits a dependency without refreshing the lock.
- A committed lockfile makes dependency changes visible in review, which is a 700 KB diff nobody
  reads. Accepted: the alternative is the change being invisible.
- This does **not** by itself make `make verify` pass. Lint is still red at 1,297 errors (A-34) and
  the backend still has no `typecheck` task at all (P9-01a) — `turbo` exits 0 on a package that
  does not define one, so a green typecheck currently means nothing was compiled.

**Status:** Accepted

---

## ADR-045: Tenant Lifecycle Is a Real Feature — Give It the Schema It Was Written Against

**Date:** 2026-09-24 · **Finding:** W-01 ([`../TASKS/AUDIT-2026-09-ASYNC.md`](../TASKS/AUDIT-2026-09-ASYNC.md))

**Context**

`tenantLifecycle.service.js` suspends a tenant, holds it in a grace period, then offboards it and
keeps its data until a retention deadline. It has never done any of that. Its scheduled query
compares the lowercase `status` ENUM to `'SUSPENDED'`, and filters on `gracePeriodExpiresAt` — a
column that does not exist. Either defect makes the query throw, nightly, into a log nothing reads.
Its write side assigns `gracePeriodExpiresAt`, `offboardedAt` and `offboardRetentionExpiresAt` to a
model that has none of those attributes, so Sequelize drops them **without an error**.

W-01 asked for a decision before a fix: is this a feature, or a module to delete?

**Decision**

It is a feature. `docs/PLAN/10-TENANCY-AND-ONBOARDING.md`, `docs/API/04-TENANT-API.md` and
`docs/DATABASE/02-TENANCY-TABLES.md` all describe the grace period and offboarding, and a SaaS
serving hospitals needs a defined end-of-contract path. So:

1. a migration adds the columns the service writes, and the model gains the attributes;
2. the scheduled query uses the ENUM's own values;
3. the job moves onto `node-cron` beside the other scheduled jobs, configurable like them, instead
   of a 24-hour `setInterval` that depends on a process living a day;
4. the destructive step writes its audit row **inside** its transaction (A-41), under a system actor
   named in `changes.actor` until Q-13 decides the first-class form;
5. a data-driven test asserts that every key the service writes is a model attribute, so the next
   added field cannot reintroduce the silent drop.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Delete the module and the interval | three documents describe the feature, and the product needs an end-of-contract path; deleting it moves the gap rather than closing it |
| Fix the query only | the write side would still drop the grace period silently — the worse half, because nothing reports it |
| Keep `setInterval` | a job that runs only if the process stays up for 24 hours never runs on a deployment that is redeployed daily, which is this one |

**Implications — including the bad ones**

- **The job becomes live for the first time.** An offboarding path that has never run will run in
  production on its first scheduled tick after deploy. There are no suspended tenants on the reference
  deployment today, so the first real exercise is controlled — but it is a first exercise.
- **Offboarding deletes data.** A defect in it is irreversible in a way the old silent failure was
  not. The audit row inside the transaction is the minimum; a dry-run mode is worth adding before the
  first real tenant is offboarded.
- **Retention periods are now enforced** where before they were fictional. That is a behaviour
  change a customer will notice only when it matters.

**Status:** Accepted — implemented under W-01.

---

## ADR-046: The Backend Image Builds From the Repository Root, and `/api/` Belongs to the Frontend

**Date:** 2026-09-24 · **Findings:** S-13, S-07 · **Amends:** ADR-044 (lockfile)

**Context**

ADR-044 committed one lockfile: the **root** workspace `package-lock.json`. `backend/package-lock.json`
stays ignored. The backend image was built with `backend/` as its context, so it could never see a
lockfile, and it resolved dependencies with `npm install`, a different tree on every build. S-13 said
to use `npm ci`, which in that context is impossible.

Separately, `nginx/default.conf` and the Helm ingress sent `/api/` to the backend. The VM config,
`docs/DEVOPS/03` and the frontend's own proxy route all send it to the frontend, because Next owns the
httpOnly auth cookie and injects `Authorization` from it. Two manifests disagreed with everything
else.

**Decision**

1. The backend build context is the **repository root**, with `dockerfile: backend/Dockerfile` in
   every compose file and the Makefile, and `npm ci --workspace backend` against the root lockfile.
   `backend/Dockerfile.dockerignore` is an allow-list: Docker reads a per-Dockerfile ignore file in
   preference to `.dockerignore`.
2. `/api/` is routed to the **frontend** in every manifest. The frontend receives
   `BACKEND_INTERNAL_URL` explicitly in compose and Helm.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Commit a second lockfile in `backend/` | two lockfiles drift; ADR-044 rejected exactly that |
| Keep the `backend/` context and `npm install` | the build is not reproducible, and S-13 stays open |
| Route `/api/` to the backend and move cookie handling there | a redesign of authentication, for no gain, contradicting the deployment that works |

**Implications — including the bad ones**

- **A root context is larger.** The allow-list keeps it to about 0.7 MB under compose, but a file
  added at the root is excluded until someone lists it. That is the safe failure.
- **Every backend build needs the frontend's `package.json`** because of the workspace, so a
  frontend dependency change can invalidate the backend's install layer.
- **The VM's next pull and rebuild use the new context.** It was validated with a local
  `compose build` and a boot, and **not yet on the VM**.
- **`npm ci` under npm 11 skips unapproved install scripts** (puppeteer, esbuild). That is harmless
  for this build, and it will surprise the first person who needs one of them.

**Status:** Accepted — implemented 2026-09-24.

---

## ADR-047: Signing Always Re-Authenticates — `REQUIRE_REAUTHENTICATION` Is Removed as a Switch

**Date:** 2026-09-24 · **Finding:** A-65 · **Relates to:** ADR-040

**Context**

`REQUIRE_REAUTHENTICATION` (default on) let an operator turn off the credential check on signing.
Workflow signing never actually re-authenticated anyway: it checked only that the user was active.
Under 21 CFR Part 11 §11.200, an electronic signature needs its identification components at signing
time. A signature that the signer's credentials did not authorise is not attributable, whatever the
RSA layer (ADR-040) says about the bytes.

**Decision**

Every signature — certificate approve, sign and revoke, and workflow steps — goes through one
`verifySignerCredentials(userId, method, payload)`, by password or MFA code. The environment variable
no longer disables it, and `getStatus()` always reports re-authentication as on.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Keep the switch, default on | a configuration value that disables the signature's authentication is the same bypass as a missing check — just harder to see in review |
| Keep it only for development | development deployments share the code path; tests can fake the password comparison, as the A-65 tests do |

**Implications — including the bad ones**

- **An operator who set `REQUIRE_REAUTHENTICATION=false` will now be prompted for credentials** at
  every signature. That is a visible change, and it is deliberate.
- **`webauthn` and `totp` as signing methods are refused.** Nothing verifies them at signing time.
  Adding WebAuthn signing is a feature, not a flag.
- **External (email-only) signers can no longer sign at all** (A-86).
- **Workflow signing now depends on `authService.passIsValid`.** A change to its return shape breaks
  both certificate approval and workflow signing.

**Status:** Accepted — implemented 2026-09-24.

---

## ADR-048: Tenant Isolation Reaches Includes, and Never Changes a Join Type

**Date:** 2026-09-24 · **Findings:** A-87, A-75 · **Amends:** ADR-029

**Context**

ADR-029's global hooks added the tenant predicate to the **root** model's `WHERE` only. `beforeFind`
fires once, so an `include` of a tenant-scoped model joined whatever row its foreign key pointed at,
in any tenant. Proven on PostgreSQL 18.6: tenant A's non-conformance list returned tenant B's device
name and user email. CLAUDE.md's "you do not opt in" was true for root queries and false for every
include.

**Decision**

`beforeFind` and `beforeCount` also walk the include tree (`tenantScope.util.js#applyTenantToIncludes`):

1. Includes are normalised with Sequelize's own `_conformIncludes` and `_expandIncludeAll`, which are
   idempotent, and the tree is walked, `through` models included.
2. Every tenant-scoped include gets the **same** predicate the root would get, from the same
   `resolveScope`, with the same exemptions (super admin, system task, `skipTenantScope`). It is placed
   in the ON clause and forced over any caller value; a non-plain `where` is `Op.and`-ed.
3. **`required` is pinned first, to Sequelize's own default** — `!!(own where || defaultScope where)` —
   so adding a `where` never turns a LEFT JOIN into an INNER JOIN.
4. `separate` includes are left to their own `findAll`, which the root hook scopes.
5. `skipTenantScope: true` on one include is the only opt-out: explicit, and greppable.
6. The hook does **not** force `required: false` on a `defaultScope`-implicit INNER include. That is
   a per-call-site decision (A-90).

**Alternatives considered**

| Alternative | Why not |
|---|---|
| A lint or test that refuses an include without an explicit tenant `where` | opt-in again; cannot follow string aliases or `{ all: true }`; a missed site is a leak |
| `include.where = { tenantId }` | turns every LEFT JOIN into an INNER JOIN — the mutation test breaks 46 association joins |
| Also force `required: false` on implicit INNER joins | result sets would differ between a tenant user and a super admin, and soft-delete semantics would change silently at about 20 sites |
| Database row-level security | rejected in ADR-039 |

**Implications — including the bad ones**

- **Good:** every include is scoped without opting in, and a data-driven test covers every current
  and future association (743 tests).
- **It depends on private Sequelize statics** on 6.37.8. The test fails if an upgrade changes them;
  that is the alarm, not a guarantee.
- **A cross-tenant reference now reads as `null`** on a LEFT include, and **removes the parent row**
  on an INNER include. That includes legitimate references authored by the super admin inside a
  tenant (Q-17), and the implicit-INNER sites need `required: false` (A-90).
- An include of a model **with no tenant key** is still unscoped. That is correct today, and it means
  a new tenant-owned model that forgets its tenant column is silently global — exactly as for root
  queries.
- `aggregate`, `max` and `sum` remain unhooked. *(Closed by ADR-073: they, `increment` and `restore` are now scoped.)*
- A-88 — the `foreignKey: "tenant_id"` shape — is a separate decision (Q-16).

**Status:** Accepted — implemented 2026-09-24.

---

## ADR-049: Device Serials Are Unique Per Tenant; Signing Is Its Own Permission

**Date:** 2026-09-24 · **Findings:** D-04, A-84

**Context**

`calibration_devices.serial_number` was globally unique. A serial number is printed on the
instrument, so a caller could learn whether any other hospital owned a given device, and two
hospitals genuinely owning the same instrument — after a sale or a loan — could not both register it.
Separately, the signing routes had no permission gate at all (A-84).

**Decision**

1. **Serial numbers are unique per tenant:** `UNIQUE (tenant_id, serial_number)`, created by
   migration `0026`, which **refuses** rather than resolves any existing in-tenant duplicate. The
   composite index lives only in the migration, never on the model, so `sync()` cannot build it
   before the duplicate check has run — the same pattern as `0024`.
2. **Signing is gated on a new `esignature` slug**, not `qms`. A signer is whoever a workflow names,
   and most roles have no `qms` menu. Every seeded role gets `write` by default (Q-19 asks the owner
   to confirm), and migration `0025` backfills seeded databases without overwriting a grant.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Keep the global serial unique and mask the error | the oracle remains a timing and statistics question, and the legitimate collision stays blocked |
| Renumber or merge in-tenant duplicates in the migration | a serial identifies a physical instrument; a migration must not decide which record is right |
| Gate signing on `qms` | technicians and every other non-admin role named as signers would be locked out of their own step |

**Implications — including the bad ones**

- **A database holding an in-tenant serial duplicate refuses to boot** until someone resolves it by
  hand. That could only have happened if the global constraint was never there.
- **`down` is refused** once two tenants share a serial.
- **Permission caches** hold a role's matrix for up to an hour: flush `permissions:*` at deploy, or
  signers see 403 until it expires.
- **The e-signature menu item** now gives roles that have no other management menu a "Management"
  root in the sidebar.

**Status:** Accepted — implemented 2026-09-24. **Amended by ADR-051 (Q-19), 2026-09-24:** the default `esignature` grant is for the technical roles only; USER, ROOM USER and WAREHOUSE STAFF no longer sign by default (migration `0032`).

---

## ADR-050: One Client Address, Resolved Once at the Edge

**Date:** 2026-09-24 · **Findings:** A-16, A-67

**Context**

Behind Cloudflare Tunnel → nginx → Next → backend, the backend's `req.ip` was the Docker gateway for
every browser. nginx *appended* to `X-Forwarded-For`, so a client could also plant any address at the
front of the list. Per-IP rate limiting was therefore either useless or — once A-67 made it count — a
way for anyone to lock every user out.

**Decision**

- **The client address is decided once, at the first hop we control, and every later hop forwards
  exactly one value.**
  - On the VM, nginx accepts `CF-Connecting-IP` **only** from the compose gateway, where cloudflared
    arrives. It then **overwrites** `X-Forwarded-For` and strips the Cloudflare header.
  - Where nginx is itself the edge, it overwrites the header with the peer address.
- **Next** forwards the rightmost valid IP and drops every other client-address header.
- **The backend trusts exactly one hop** (`TRUST_PROXY_HOPS`) and never reads a forwarded header
  directly.
- **Per-IP auth counting** stays behind `AUTH_RATE_LIMIT_BY_IP` until a real sign-in on the VM shows a
  real public address.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Raise `trust proxy` to the full hop count | the chain differs between the VM and `default.conf`, and every appended value is still client-controlled at the front |
| Have the backend read `CF-Connecting-IP` directly | any client that can reach any hop could set it; trust must be tied to a peer address, which only nginx sees |
| Keep per-IP counting off permanently | leaves password spraying across many accounts unthrottled |

**Implications — including the bad ones**

- **Trusting the gateway means trusting any process on the VM host** that can reach nginx's published
  port. The tunnel already relies on that.
- **The compose subnet is pinned** (`172.30.19.0/24`). If it collides with another project's network,
  both the compose file and `vm-http.conf` must change together.
- **Docs to amend:** `docs/DEVOPS/03-REVERSE-PROXY.md`, `deploy/README.md` and
  `docs/OBSERVABILITY/01-LOGGING.md` still show `$proxy_add_x_forwarded_for` or the old `:real-ip` —
  amended with this ADR.

**Status:** Accepted — implemented 2026-09-24; **verified on the VM 2026-09-24** (the session and the `LOGIN` audit row recorded the operator's real public IP). `AUTH_RATE_LIMIT_BY_IP=true` is enabled there.

---

## ADR-051: The Owner Questions Q-09 to Q-19, Decided by Debate

**Date:** 2026-09-24 · **Debate:**
[`../TASKS/DEBATE-owner-questions-A-compliance.md`](../TASKS/DEBATE-owner-questions-A-compliance.md) ·
[`../TASKS/DEBATE-owner-questions-B-operability.md`](../TASKS/DEBATE-owner-questions-B-operability.md)
· **Authority:** the owner directed, on 2026-09-24, that contradictions be settled by agents
debating from different positions, with the orchestrator deciding the best practice.

**Context**

Eleven questions had been parked for the owner, plus three that were product-shaped (A-86, A-98 and
A-107). Two agents argued them independently: one compliance-first, one for operability and minimal
disruption. **They agreed on more than half.**

- **Agreed:** audit rows are never purged; no cascading deletes on regulated data; no deletion once a
  signature exists; no silent restoration of an erased person; email-only signers are refused.
- **Disagreed, and decided below:** Q-09, Q-11, Q-14, Q-15, Q-17, Q-18, Q-19 and A-98.

Both papers found live defects while reading the code. These were checked by the orchestrator before
deciding:
- *Workflow signing refuses every real user* — `"active"` against a stored `"ACTIVE"`. **Confirmed.**
- *Admin-created users are never marked verified* — `is_email_verified` is not an attribute.
  **Confirmed.**

**Decisions**

| # | Decision | Taken from | Why this side |
|---|---|---|---|
| **Q-09** restore, account missing | **Never re-create.** Report it as `notRestored` in the response and in the audit row; the admin re-invites through the ordinary create path | A | B's default **re-creates an anonymised person** from the archive (F-1): the restore tool becomes the mechanism that reverses a GDPR erasure. The re-created account has a new id, so it re-links to nothing — the default recovers nothing the strict answer loses |
| **Q-10** global retention policies | **One engine.** Delete the dead second purge engine in `gdpr.service` (F-4). No global policy rows. Per-entity minimum days in code | both | a second engine where 0 days means "delete everything" is a loaded gun with no caller |
| **Q-11** unverified accounts | **Verification stays informational** (not checked at login); fix F-2; a completed email-code reset marks the address verified. **But an admin-chosen password must be changed at first login** — the user is flagged and every route but change-password answers 403 until it is | B, plus A's non-negotiable | enforcing verification today locks out every admin-created account (F-2). A's credential point survives on its own merits: since ADR-047 a password signs, so the admin who set it could sign as the user (F-3) |
| **Q-12** purging `audit_logs` | **Never.** Remove audit rows from every purge path and every retention setting (F-4, F-5); `RESTRICT` the foreign key (W-20); partition and archive later; mask IP and user agent for GDPR rather than deleting rows | both | irreversible once the first rows are 365 days old — first in the rollout |
| **Q-13** system actor | **Two columns on `audit_logs`, `actor_type` (`user` or `system`) and `actor_name`, from a fixed list of job names; no system user row.** `logAction` requires exactly one of a user or a system actor. Individual IoT readings and session sweeps are not audited | A's shape, B's constraint and scope | queryable, honest for old rows (backfilled as `unknown`), and it does not pretend a job is a person |
| **Q-14** tenant of a cross-tenant change | **A reserved PLATFORM tenant** records platform operations: tenant create and delete, global roles. A change to one tenant's data is recorded in that tenant | A | F-7: under the current rule every platform operation lands in "Default Hospital Tenant"'s trail, **readable by that hospital's admins** and deleted with it |
| **Q-15** failed sign-ins as audit rows | **Audit `ACCOUNT_LOCKED` and `SIGNATURE_AUTH_FAILED`** as new ENUM values (one migration). Individual failed logins stay in the security log | B's scope, A's typing | 21 CFR 11.300(d) wants unauthorized attempts on signature credentials detected and reported, and that is the signing case. Recording them as `UPDATE` would hide them from every query that looks for them |
| **Q-16** `tenant_id` foreign keys | **`RESTRICT` by default, including `audit_logs`; `CASCADE` only for a named list of throwaway tables.** One migration that refuses to run while orphans exist. `calibration_records.performed_by` → users becomes `RESTRICT` (F-6) | both | agreed |
| **Q-17** platform-operator identity | **Operators may not author Part 11 records inside a tenant:** signing, approving, creating or editing a calibration record while impersonating or overriding the tenant answers 403. Other writes remain allowed and are **audited with the impersonator** (F-8). References show *"Platform operator"* | A, narrowed | A's read-only impersonation would remove the support tool entirely. The regulated acts are what must never be authored by a non-member |
| **Q-18** account identity | **Global identity stays for now.** The residual oracle — a 409 on create — is reachable only by tenant admins; those conflicts are rate-limited and audited. Per-tenant **memberships** are the long-term model. Per-tenant uniqueness with tenant-qualified login is rejected | B | A's own confidence was medium-high and it conceded memberships are the better model. Tenant-qualified login is a redesign of every sign-in path for a residual reachable only by admins |
| **Q-19** who may sign | **Default `esignature: write` for the technical roles only** — not USER, ROOM USER or WAREHOUSE STAFF. The signer's eligibility is checked when the workflow is created. The signer's name and email come from the user record (F-10). The meaning is mandatory. `/history` requires `qms` read, or returns only the caller's own signatures (F-9) | A | least privilege costs nothing here: those roles do no technical work. F-9 exposed every signature's IP address and biometric data to every role |
| **A-107** deleting certificates and workflows | **409** for approved, signed and revoked certificates and for any workflow with a signature. Public verification reads soft-deleted rows, so a deleted revoked certificate still says *revoked* (F-11). Add a cancel-workflow route; revoking a signature stays unrouted | both, with B on revoke | no demand for revocation through the API yet, and it is a Part 11 act that needs its own design |
| **A-86** external signers | **Refuse email-only signers at creation (400).** An outside engineer gets a user account | both | agreed |
| **A-98** change password | **Available to every authenticated user, outside the permission matrix.** It writes an audit row (F-12). SSO users are pointed to their identity provider | A | a self-service security control must not depend on a menu grant a tenant admin can withdraw |

**Alternatives considered** — every alternative is the losing paper's position on that row. Each
paper steelmanned the other, and those arguments are in the papers.

**Implications — including the bad ones**

- **Q-11:** every admin-created user is forced to change their password at next login.
- **Q-19:** USER, ROOM USER and WAREHOUSE STAFF lose signing. A migration revokes the default grant
  only where it is still the untouched default.
- **Q-14:** a PLATFORM tenant row must exist. It is excluded from every tenant listing, and from the
  tenant hooks' reach for ordinary users.
- **Q-16:** the migration may refuse to run on a deployment that has orphans, and an operator must
  resolve them by hand.
- **Q-17:** a super admin can no longer fix a calibration record by impersonating the hospital. They
  must ask a member to do it.
- **Q-18** leaves a known, narrow residual oracle, and says so.

**Status:** Accepted — implementation tracked as cards **A-119 to A-131**.

---

## ADR-052: A Super Admin Authors Part 11 Records Only as a Member of Their Home Tenant

**Date:** 2026-09-24 · **Finding:** A-127 · **Extends:** ADR-051 (Q-17)

**Context**

ADR-051 decided that platform operators may not author Part 11 records inside a tenant. Implementing
it showed a hole the decision had not named. The tenant hooks **skip super admins entirely**, so on a
route that takes a record id, a super admin could sign or approve **another tenant's** record by its
id — no impersonation and no header needed.

**Decision**

On a Part 11 authoring route (`denyPlatformAuthoring`):
- an impersonated request, a header override into another tenant, and a super admin with no home
  tenant are refused with 403;
- a super admin in their home tenant is **rebound for the rest of the request as an ordinary member
  of that tenant**: `isSuperAdmin: false`. Another tenant's id then answers 404, like anyone else's.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Refuse super admins on these routes outright | the platform operator's home tenant may genuinely be where they work |
| Leave super-admin scope as it is | the id-based cross-tenant signature stays open |

**Implications — including the bad ones**

- **Inside their own tenant, on these routes, a super admin behaves as a member**, including 404s for
  records outside it. A support workflow that relied on the super admin reaching across tenants by
  id no longer works on these routes. That is intended.
- **The route list is enforced by a source scan.** A new authoring route fails the build until someone
  decides whether it is guarded.

**Status:** Accepted — implemented 2026-09-24.

---

## ADR-053: A SCIM Group Is a Tenant-Owned Mapping to an Existing Role

**Date:** 2026-09-24 · **Findings:** A-38, A-39, A-49 · **Migration:** `0042-scim-groups-per-tenant`

**Context**

A SCIM Group **was** a row in `roles`, and roles are global (`role.model.js`; ADR-051 Q-14 files
global roles under platform operations). So one tenant's IdP could list every tenant's groups, learn
another tenant's group names from a 409, and delete a role other tenants' users held (A-38). A group
it created was a role with `roleLevel` 1 and no menu permissions: its members passed neither `rbac`
nor `dynamicAccess`, and the IdP was told "created" (A-39) — the `ROLE_LEVELS` trap, reachable from
outside the codebase.

**Decision**

1. SCIM Groups live in a new tenant-scoped table, `scim_groups` (`tenant_id`, `display_name`,
   nullable `role_id`). **SCIM never creates, renames or deletes a role.**
2. A group **maps** to an existing role through `roleId` (a Callibrator extension attribute on
   `POST`/`PUT`, or `PATCH` path `roleId`). The role must exist, must not be SUPERADMIN (A-27), must not
   be the default USER role, and must hold at least one menu permission — otherwise 400.
3. A group may be created **unmapped**, because standard IdPs send only `displayName`. An unmapped group
   grants nothing and **says so**: every group response carries
   `urn:ietf:params:scim:schemas:extension:callibrator:2.0:Group` `{ roleId, roleName, grantsAccess }`,
   and adding a member to an unmapped group is a **409** naming the fix.
4. Membership stays derived from `users.role_id`, so a role backs at most one group per tenant —
   `UNIQUE (tenant_id, role_id)`. Re-mapping moves the members to the new role; unmapping or deleting
   the group demotes them to USER.
5. `display_name` is stored as sent and unique **per tenant, case-insensitively** —
   `UNIQUE (tenant_id, lower(display_name))`.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Add `tenantId` to `roles` | the global tenant hooks would then hide every seeded role (NULL tenant) from every tenant user; every `rbac`, `dynamicAccess` and seed path would need rework. That is the per-tenant-roles redesign, not a SCIM fix |
| Keep creating a role, but give it a documented level and an empty permission set, and say so in the response | honest, but still writes global rows from a tenant credential, so A-38 stays open; and an empty role is A-39 with a label on it |
| Require `roleId` on every `POST /Groups` (refuse unmapped groups) | the most explicit, but Okta, Entra ID and OneLogin cannot send it on a group push, so group provisioning would simply fail for every standard IdP |
| Map groups to roles by a separate admin-configured table (displayName → role) | no admin UI or API for it exists; the SCIM credential can already assign any non-SUPERADMIN role to a user, so letting it map a group grants nothing new |

**Implications — including the bad ones**

- **Roles created by the old code are not migrated.** Nothing records which tenant created them, so
  they stay as ordinary global roles (level 1, no grants), no longer visible as groups. An IdP re-pushes
  its groups; an administrator maps them.
- **An IdP cannot manage membership until an administrator maps the group.** That is the point, but it
  is an extra step, and it is done through the SCIM API (`PATCH` path `roleId`) — there is no UI.
- **Membership is still single-valued.** Adding a user to a group replaces their role, and every tenant
  user who holds the mapped role — however they got it — is listed as a member. Deleting or unmapping the
  group demotes all of them, including users an administrator assigned by hand.
- **`PUT` without `roleId` keeps the mapping.** IdPs never send it, and reading its absence as "unmap"
  would demote everyone on a rename. A client that wants to unmap must say `remove roleId`.
- **`scim_groups.tenant_id` is `ON DELETE RESTRICT`** (Q-16 default): a hard tenant delete must remove
  the groups first.
- **No SCIM mutation writes an audit row yet** — still open from A-33. Group writes are now at least
  transactional.

**Status:** Accepted — implemented 2026-09-24.

---

## ADR-054: Webhook Delivery Is a Database Outbox, Not a RabbitMQ Queue

**Date:** 2026-09-24 · **Findings:** A-10, A-11 · **Migration:** `0043-webhook-durable-delivery`

**Context**

A-10's Definition of Done said "delivery moves onto RabbitMQ with a dead-letter queue", following the
old service comment. Retries were `setTimeout` waits in the emitting process (~15 s of backoff); a
restart lost every one and stranded its row `pending`/`failed` forever. The signature had no timestamp,
so a captured delivery was valid forever. Separately (A-11), only the calibration scan emitted events.

**Decision**

1. **`webhook_deliveries` is the queue.** A row per webhook per event carries `attempts`,
   `next_attempt_at` (new, 0043) and the outcome. `pending|failed` + `next_attempt_at <= now()` is due;
   `exhausted` is the dead letter.
2. **Claiming is `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`**, which also
   pushes `next_attempt_at` forward by a lease (`WEBHOOK_LEASE_MS`, 5 min). Replicas claim disjoint
   rows; a sender that dies mid-attempt leaves a row that is due again when the lease expires.
3. **A dispatcher** (`webhookDeliveryScheduler.middleware.js`, node-cron, 15 s) runs one pass at boot —
   what makes a restart resume — then on schedule. The first attempt of a new event is made at once,
   through the same claim.
4. **Backoff** `min(1 min × 2^(n−1), 6 h)`, 12 attempts — ~20.5 h to the dead letter. Deleted or
   deactivated webhooks are re-checked before every attempt and dead-letter the row.
5. **Signature v1:** `X-Webhook-Signature: v1=HMAC-SHA256(secret, "<timestamp>.<raw body>")` with
   `X-Webhook-Timestamp` (unix seconds, fresh per attempt). Receivers reject timestamps more than
   5 min off and deduplicate on `X-Webhook-Delivery`.
6. **Events are emitted from `transaction.afterCommit`** (`webhook.service#emitAfterCommit`), so a
   rolled-back mutation never fires one. The catalogue is `constants/webhookEvents.js`.

**Alternatives considered**

- **RabbitMQ with a DLQ (the DoD as written).** Rejected for now: the event would have to be published
  after commit anyway, and a publish that fails after commit loses the event unless it is first
  written to a table — i.e. an outbox is needed *in front of* the broker. Delayed retries of hours need
  a delayed-message plugin or a TTL-queue ladder; the delivery log the tenant UI reads would still be
  the table. The deployment treats RabbitMQ as optional (batch jobs and email fall back inline), and
  PostgreSQL is already the one hard dependency. Moving the transport to RabbitMQ later remains
  possible: the dispatcher would publish due rows instead of POSTing them.
- **Redis sorted set / BullMQ.** Adds a second store of truth beside the delivery row; Redis is not
  durable by default in this deployment.
- **Write the delivery row inside the business transaction (a pure transactional outbox).** Strictly
  stronger — no gap between COMMIT and the row. Not taken now: `emitEvent` inside the transaction
  could abort it on any error (PostgreSQL aborts the whole transaction on a failed statement), so it
  would need a savepoint per emit in every service, and the task was to add only minimal emit lines.
- **Keep `sha256=` over the body and add a timestamp header beside it.** An unsigned timestamp is not
  replay protection. A second, timestamped signature header kept alongside the old one would leave
  the replayable signature on the wire for every receiver that never upgrades.

**Implications — including the bad ones**

- **Breaking change for receivers.** A receiver verifying the old `sha256=<HMAC(body)>` rejects every
  delivery from now on; its deliveries fail, retry for ~20 h and dead-letter. There is no dual-signing
  window. Receivers must move to the v1 recipe (`docs/WEBHOOK/03-WEBHOOK-SECURITY.md`).
- **A crash between COMMIT and the row insert loses that event** (afterCommit runs in-process). The
  gap is milliseconds, but it is not zero; closing it is the transactional-outbox alternative above.
- **At-least-once, not exactly-once.** A lease that expires while a POST is still in flight (a
  receiver slower than `WEBHOOK_LEASE_MS`, far above the 8 s timeout) is sent twice, same delivery id.
- **Polling cost:** one indexed `UPDATE … SKIP LOCKED` every 15 s per replica, on a partial index
  (`webhook_deliveries_due`) that holds only unfinished rows.
- **The dispatcher's claim is cross-tenant raw SQL by design** (a system worker, like the calibration
  scan); every read after it is scoped by the claimed row's own `tenant_id`, and a claim by id carries
  `tenant_id` explicitly. It is a review item like every raw query.
- **Rows the old loop abandoned:** 0043 resumes those under 24 h old and dead-letters older ones with
  the reason in `last_error`. `down` does not un-dead-letter them.
- **`webhook.test` is removed from the subscribable catalogue** (it never matched a subscription);
  a test delivery gets exactly one attempt.

**Status:** Accepted — implemented 2026-09-24. Amends A-10's Definition of Done (RabbitMQ → outbox),
`docs/WEBHOOK/01-EVENT-CATALOG.md`, `03-WEBHOOK-SECURITY.md` and `04-WEBHOOK-RETRY.md`.

---

## ADR-055: A Workflow Decision on a Certificate Is a Signature; Revocation Is Removed Until Designed; Started Workflows Are Immutable

**Date:** 2026-09-25 · **Findings:** A-182, A-183, A-184, A-107, A-190, A-204 · **Extends:** ADR-035, ADR-047

**Context.** The workflow engine was a second route to `approved` that skipped the re-authentication
ADR-047 requires and the certificate state machine ADR-035 built. Its decision route carried no
permission gate, and it counted approvals outside a lock. `revokeSignature` existed in the service,
controller and validator, but no route called it. It had no re-authentication and no state check.
Replacing a workflow's steps cascaded into `workflow_actions` and erased approval history.

**Decision**

1. **Every APPROVED action on a Certificate workflow re-authenticates.** It uses the same
   `verifySignatureAuth` as `POST /certificates/:id/approve`. The **final** approval is the
   certificate's own `pending_approval → approved` transition: under `FOR UPDATE`, with the
   `ESignatureRecord`, the audit row and the webhook. A rejection is allowed only from `draft` or
   `pending_approval`. From any other state it answers 409 with a state explanation. State checks run
   before re-authentication, so a refused decision does not consume an MFA code.
2. **Gates on the workflow routes.**
   - The decision route needs write on a decidable record type (`certificate`, `warehouse` or
     `maintenance`).
   - The service then requires write on the instance's own type.
   - `GET /instances/pending` needs `workflows` read.
   - The instance row is locked inside the decision transaction. "Already acted" and the approval
     count are read under that lock.
   - `signDocument` locks the workflow, then the step, in the same order as cancel, update and delete.
3. **`createCertificate` starts its workflow inside its own transaction.** A workflow that cannot
   start rolls the certificate back.
4. **Signature revocation is removed.** `revokeSignature` is deleted from the service, controller and
   validator, and a pin test fails if it returns. `verifySignature` keeps its `revoked` status for
   historical rows. Deleting a revoked, signed or approved certificate stays 409 (A-130).
5. **Workflow definitions are audited.** Create, update and delete write `Workflow` audit rows
   inside the transaction. Once any instance exists, including a soft-deleted one, replacing steps
   is 409. Deleting a workflow with PENDING instances is 409. The inbox skips orphaned instances.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Re-authenticate only the final approval | every step approval is an attestation, and which one is "final" depends on a concurrent count |
| Gate the decision on `workflows` write | that is the definition-admin grant; approvers would gain the power to rewrite the chain |
| Leave the decision gated by the step-role match only | P6-04 requires a gate; a role can lose `certificate` write and keep its workflow step |
| Let a rejection revoke | revocation is its own re-authenticated act |
| Route `revokeSignature` with a gate and an audit row | there is no design for who may revoke or how verification shows it; this would ship a Part 11 act with no specification |
| Keep `revokeSignature` as dead code | it is the implementation the next route would inherit |
| Version workflow steps (new rows plus a version column) | better long term, but a schema change; recorded as the successor |
| Make the steps FK RESTRICT through a migration | PUT would answer 500 instead of 409, and it needs the Q-16 orphan checks |

**Implications, including the bad ones**

- **Approvers type credentials at every Certificate step.** This adds friction.
- **Some approvers now get 403.** A caller who holds the step role but has no `certificate` write is
  refused. The default seed grants it; custom roles may need the grant.
- **A-203, open:** a certificate approved directly while its workflow is PENDING leaves an instance
  whose final approval is 409. Whether the workflow is mandatory is an owner question.
- **StockTransfer and MaintenanceWorkOrder decisions are still not signatures.** StockTransfer writes
  status values that are not in its ENUM (A-201, open).
- **No signature can be revoked.** A mistaken signature is handled by cancelling the workflow or
  revoking the certificate.
- **Changing a started workflow's steps** means deactivating it and creating a new one.

**Status:** Accepted, implemented 2026-09-25 (batch 6).

---

## ADR-056: Menu Deletion, Public Link Origin, the Q-20 Grants, and Tenant Notification Defaults

**Date:** 2026-09-25 · **Findings:** A-181, A-186, A-187, A-189, Q-20 · **Extends:** ADR-050, ADR-043

**Decision**

1. **A menu with children cannot be deleted.** This holds on both paths, `menuGroup.service` and
   `roles.service#deleteMenu`. The request is refused with 409, the children are named, and nothing
   is written. An empty group is deleted with its grants and one audit row. Grant writes (assign,
   revoke, bulk) are transactional and all-or-nothing. Each writes one `GRANT_MENU` or `REVOKE_MENU`
   row and clears the role's permission cache after commit.
2. **The public origin of generated links** is `PUBLIC_BASE_URL`, else `HOST_URL`. In production
   with neither set, the request fails with a 500 naming the setting; it never guesses from a Host
   header. Outside production, the forwarded origin is read only through the one-hop `trust proxy`
   (ADR-050). The Next proxy overwrites `X-Forwarded-Host` and `X-Forwarded-Proto` and never copies
   the browser's values.
3. **Q-20 grants.** Rationale:
   - Every route is tenant-scoped, and `user.service` refuses to create or grant SUPERADMIN.
   - The tenant must be able to review its own audit trail (21 CFR 11.10(e)).
   - `PATCH /billing/subscription` can override payment state (A-225), so billing stays read-only.
   - `content` is the platform's public blog, so it stays SUPERADMIN-only.

   | Role | New grants |
   |---|---|
   | HEALTHCARE ADMIN | `users` write, `vendors` write, `billing` read, `audit` read |
   | CALIBRATOR ADMIN | `users` write, `vendors` write, `billing` read, `audit` read |
   | ENGINEERING MANAGER | `vendors` read |
   | any role but SUPERADMIN | not `content` |

   Migration `0054` applies the grants to already-seeded databases.
4. **Tenant notifications and sub-organisations.**
   - A custom-domain email goes to the requester plus the tenant's active administrators, never to
     "the oldest user". Recipient addresses are never logged.
   - A sub-organisation takes the parent's email, a subdomain derived from its code, and the
     parent's plan. It is created in one transaction with a PLATFORM audit row.
   - Domain writes are audited in the tenant's trail.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Keep SET NULL on menu delete | the grandchildren silently became top-level entries, keeping their grants |
| Re-parent children to the deleted group's parent | **privilege escalation**: every role granted that parent silently inherits the moved pages |
| Cascade the whole subtree | one click removes routes from every role, under one audit row |
| Trust forwarded headers in production | Host-header injection into links printed on official PDFs |
| Require the configured origin at boot | breaks deployments that set only `CERT_VERIFY_BASE_URL` |
| Leave Q-20's five resources SUPERADMIN-only | a tenant administrator that cannot manage its own users is a broken product; every route is tenant-scoped |
| Require an email in the sub-organisation body | changes the validator and UI contract for a field the parent already has |

**Implications, including the bad ones**

- **Deleting a populated menu group** now takes N+1 operations. This reverses A-173's "deletes direct
  children". A child created concurrently in the read-then-commit window would still be SET NULL;
  this is accepted because menu edits are SUPERADMIN-only.
- **A production deployment without `HOST_URL`** answers 500 on signed URLs and on the verify URL
  when `CERT_VERIFY_BASE_URL` is unset. Every shipped configuration sets `HOST_URL`.
- **Tenant administrators can now create peer administrators.** `0054`'s `down` also removes
  identical grants that someone added by hand. Redis permission caches must be flushed after it runs.
- **More email per domain.** A sub-organisation's contact address must be changed by hand.

**Status:** Accepted, implemented 2026-09-25 (batch 6).

---

## ADR-057: File Serving — ADR-042 Completed (Steps 3–6)

**Date:** 2026-09-25 · **Findings:** S-01, A-40, A-230, A-232 · **Completes:** ADR-042

**Decision**

- **Only `uploads/public/{profile,tenant,cms}` is static.** It serves images only
  (jpeg, png, gif, webp) with a pinned type, `nosniff` and a sandbox CSP. Any other extension answers
  404 before the disk is read. **SVG is refused** at upload.
- **Only permissioned actions write the public class:** `users:update`, `management`, and
  `content:create` through the new, audited `POST /content/media`.
- **Certificates and attachments are unreachable statically.**
  - Attachments are served through `/attachments/:id/download` (gated, tenant-scoped, soft-delete
    aware) or `/signed` (HMAC, 300 s).
  - Certificates are served through `/:id/pdf` (gated) or a verification capability,
    `/certificates/verify/:number/document?token=…`. The capability lasts one hour, is minted only
    for a signed certificate that has a file, and re-checks status on every fetch.
  - nginx answers 404 for `/uploads/` outside `/uploads/public/`.
- **Gated file routes support conditional requests and Range** (ETag/Last-Modified → 304, a single
  range → 206, unsatisfiable → 416). Disposition is chosen by content type: `inline` only for images
  and PDF.
- **Deleting an attachment unlinks its file after commit, not inside the transaction.** An unlink
  cannot be rolled back. Inside the transaction, a failed audit insert would leave a live row whose
  evidence is gone. After commit, the worst case is an orphan file that nothing can reach. A storage
  leak beats a record that lies.
- **The storage driver cache is invalidated across replicas** through a Redis generation key, with a
  local TTL bound when Redis is down (A-40). A storage migration verifies every copied object against
  the recorded checksum, or against the source hash when there is none.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Serve SVG as `attachment` with a sandbox | the logo would never display; the public class exists to render images |
| Unlink inside the transaction | irreversible side effect inside a transaction that can still roll back |
| Keep a random filename on the static mount (paper B) | a deleted or revoked file stays served |
| Put a long-lived signed URL in the QR code | the QR encodes the verification page, which mints a fresh capability |
| Move attachments onto the storage façade now | that path is proven by mocks only; deferred |

**Implications, including the bad ones**

- **Buffering in the frontend proxy.** On `vm-http`, attachment and certificate bytes now pass
  through the Next proxy, which buffers whole responses (F-16). A 25 MB file sits in Next's heap. This
  is unmeasured.
- **Ticket images go through an authenticated request each.** Avatars and logos keep a one-day cache.
- **The unauthenticated verify page mints a capability per view.** Anyone who knows a signed
  certificate's number can fetch its PDF for an hour. That is public verification by design, but no
  audit row is written per mint.
- **Existing SVG logos go blank** until the tenant uploads a raster image. Old `/uploads/attachments`
  links break, by design.
- **Deleting draft evidence destroys the bytes.** Whether deleted drafts are retained is an open
  owner question.

**Status:** Accepted, implemented 2026-09-25 (batch 6). Migration `0056` moves existing public files
and rewrites certificate paths.

---

## ADR-058: Route Authorization Is Enforced by a Whole-Tree Guard over an Explicit Exemption List

**Date:** 2026-09-25 · **Findings:** P6-04, AZ-01, AZ-03, A-250, A-251, A-252, A-254 · **Extends:** ADR-043

**Context.** Four live incidents (A-01, A-02, A-03, A-27) were ungated routes. Each was fixed route
by route, and nothing stopped a fifth. A check that only asks whether a gate is present would
wrongly fail 56 routes that are correctly authorized by other means (AZ-03), so the exemptions have
to be claims the guard can verify.

**Decision**

- **Every route carries a gate or an exemption.** A gate is `dynamicAccess`, `rbac`,
  `checkRoleLevel`, `abac` or `superAdminOnly`. An exemption is an entry in
  `backend/src/constants/routeGateExemptions.js` with a kind (`public`, `self`, `service`, `inline`,
  `pending` or `accepted`) and a reason.
- **`routePermissionGuard.p604.test.js` checks the real route tree.** It tags the gate factories,
  requires every router, walks the real Express stacks, and parses the routes `index.js` registers
  on the app directly. It fails on:
  - a route with no gate and no exemption;
  - a stale exemption;
  - an exemption whose kind contradicts the route's chain;
  - a `service` exemption naming a function that does not exist;
  - an `inline` exemption whose guard is missing;
  - a resource that is not a seeded slug;
  - a router that is not mounted.
- **Read paths are gated like their writes.** This covers reports, supplier-scorecard (whose writes
  were ungated), jobs, feature-flag definitions, OIDC clients, username-check, and the menu-group
  reads (own role only).
- **SCIM keys need the `scim` scope** (A-250).
- **A tenant-wide test notification needs `notifications:write`** (A-251).
- **A DSAR status is visible to the subject, or to `gdpr:read`** (A-252).
- **`GET /dashboard/metrics` and `GET /quota` stay on `auth`, recorded as `accepted`.** The dashboard
  is every role's landing page, but FACILITY MAINTENANCE and WAREHOUSE STAFF have no `dashboard`
  grant. Whether to grant `dashboard` to every role or scope the metrics per role is an open
  question.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| A lint or source-text scan | misses factory and inline guards; that is how the first SCIM audit went wrong |
| A structural `route()` helper that requires a gate argument | the right end state, and it belongs to P9-21, which will read `publicRoutes()` from the same list |
| A diff-only check | never sees routes that were already wrong |

**Implications, including the bad ones**

- **Every new public, self-service or service-gated route needs an entry in the list.** A `service`
  entry proves only that the named function exists, not that it authorizes correctly.
- **The guard runs only inside `npm test`**, until CI exists (P7-01).
- **SCIM integrators get 403** until they are issued a key with `scim:write`. Scopes cannot be edited
  on an existing key.
- **A custom role without the `reports` grant loses the reports pages.**

**Status:** Accepted, implemented 2026-09-25 (batch 6).

---

## ADR-059: Sign-In Is Throttled, Never Locked; the Browser Never Holds the Access Token; OIDC Is Discovered; the Operator Must Enrol MFA

> **Amended by ADR-108 §10 (2026-09-30, Q-46 working decision):** a session that signed in with a user-verifying passkey (`amr` = `passkey`) satisfies item 7 (the operator must have MFA) and every tenant MFA policy. A password session still needs TOTP.

**Date:** 2026-09-25 · **Findings:** A-185, A-71, A-188, A-210, P6-07, A-160, A-191, A-162 · **Extends:** ADR-047, ADR-051

**Decision**

1. **Sign-in failures are throttled per identifier and address. An account is never locked by
   anonymous attempts (A-185).**
   - The key is the SHA-256 of the normalised identifier plus `req.ip`: 5 failures in 15 minutes
     pause that pair.
   - 100 failures in an hour pause the identifier from every address. 100 is NIST 800-63B's ceiling.
   - The throttle is checked before the account is looked up, so an unknown identifier is throttled,
     and timed, exactly like a real one: it pays for a dummy bcrypt comparison.
   - Every failure answers 401 "Invalid credentials". A 403 or 423 is disclosed only after the right
     password.
   - `locked_until` is written only by the MFA step.
2. **The BFF strips access tokens before a response reaches the browser (A-71).** The Next proxy
   removes top-level `token` and `refreshToken` after it sets the httpOnly cookie. The backend still
   returns `token` to server-side callers. The guarantee depends on nginx never routing `/api/`
   straight to the backend.
3. **OIDC is configured by discovery (A-188, A-210).**
   - The provider is read from `/.well-known/openid-configuration`, cached for an hour, with Entra's
     authority form mapped.
   - Multi-tenant authorities such as `/common` are refused, because JIT provisioning would admit
     any directory's users.
   - Public clients send no secret.
   - A refused callback redirects to `/login?error=<fixed code>`.
   - SSO stamps `last_login_at`.
   - A level-10 operator cannot sign in through SSO.
4. **A level-10 account without MFA receives an enrolment-only session (P6-07).**
   - Every route except MFA setup, change-password, `/verify` and logout answers
     403 `MFA_ENROLMENT_REQUIRED`.
   - Break-glass recovery is an audited CLI (`scripts/breakGlassMfaReset.js`) that needs database
     access and clears the enrolment. It never disables the check.
5. **Passkeys do not satisfy the tenant MFA policy. SSO sessions are exempt from it; the IdP's MFA
   governs them (A-160).** Migration `0052` adds `sessions.auth_method`. The access token carries an
   `amr` claim, which survives a refresh.
6. **The activation token is bound to the address it was mailed to (A-191).** Login does not check
   `isEmailVerified`, which reaffirms ADR-051 Q-11.
7. **Admin-created users keep a temporary password with a forced change, not a reset link (A-162).**
   A reset link needs working mail, which on-premises hospitals may lack, and a link can be
   intercepted. The temporary password carries 93 bits, is audited, and revokes all sessions.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Lock the account after N failures | an enumeration oracle, and a denial of service anyone can aim at a named person |
| Progressive delay | holds connections open, and can still be aimed at a person |
| CAPTCHA | there is no infrastructure for it |
| Per-IP limits only | a botnet evades them |
| Remove the token from the backend response | breaks the Next cookie writing and every E2E spec |
| Allow `/common` with a `tid` allow-list | more configuration; deferred |
| Refuse the operator at login until MFA exists | locks out the seeded operator with no recovery path |
| An environment switch to skip the MFA requirement | that is simply disabling the check |
| Count a passkey toward the MFA policy | a passkey is never asked at sign-in, so the compliance would be fake |
| Enforce `isEmailVerified` at login | locks out admin-created users that a past bug stored as unverified; they cannot be told apart |

**Implications, including the bad ones**

- **A distributed attacker can still pause one identifier**, at 100 attempts an hour. Behind a shared
  proxy address, the pair limit collapses into the identifier limit.
- **Every super-admin automation now has to complete TOTP.** Until the operator enrols, the account
  gets only an enrolment session.
- **The E2E harness now enrols and answers MFA itself.** It has never run against a live server.
- **OIDC tenants configured with `/common`, or with no authority,** stop working until they are
  reconfigured.
- **A tenant whose IdP has no MFA** has SSO users without MFA.
- **Open follow-ups:** temporary passwords never expire (A-215), and JIT-SSO users cannot change a
  password they never knew (A-216). Both closed by ADR-068 (2026-09-25).

**Status:** Accepted, implemented 2026-09-25 (batch 6).

---

## ADR-060: Background Jobs Declare Their Tenant, Are Switched Off by One Variable, and Never Report Work That Did Not Happen

**Date:** 2026-09-25 · **Findings:** W-02, W-07, W-08, W-12 (`TASKS/AUDIT-2026-09-ASYNC.md`) · **Replaces:** the `ADR-PENDING-async` markers in `utils/schedulerSwitch.util.js`, `utils/jobContext.util.js` and `services/batchJob.service.js`

**Context**

The async audit found four things about work that runs outside a request. The chart's "not the
scheduler" branch disabled one job of four, and `CALIBRATION_SCHEDULER` was set nowhere (W-02). A
batch job claimed its work in Redis before running it, for a day, so a worker killed mid-job left the
row `PROCESSING` forever and its redelivery was acked as a duplicate (W-07). A job of any type with
no handler "completed", with `progress` 100 and a `resultUrl` to a route that does not exist (W-08).
And every job ran with no tenant context, so the isolation hooks skipped and each query was isolated
only by the `where` its author remembered to write (W-12).

**Decision**

1. **One switch.** Every singleton scheduler reads its expression through
   `scheduleSetting(envName, default)`. `SCHEDULERS_ENABLED=false` returns `"disabled"` for all of
   them. The chart's `cron.enabled: false` branch sets it and also disables each variable. The
   webhook dispatcher is the one named exemption, because its claim is `FOR UPDATE SKIP LOCKED`
   (ADR-054).
2. **The switch defaults to ENABLED.** The card asked for off by default, and that was not done.
3. **A job declares its tenant context in code.** `runForTenant(tenantId, fn)` is for work done for
   one tenant: the hooks confine every query to it and stamp it on every create.
   `runAsSystem(reason, fn)` is a cross-tenant opt-out, and it must be given a reason. Neither form is
   a super admin.
4. **The batch-job claim is the row.** It is an atomic `UPDATE … SET status='PROCESSING' WHERE id=?
   AND status='PENDING'`, run inside the job's own tenant context. A runner that loses it does
   nothing. A running job heartbeats its row, and a sweep fails any `PROCESSING` row whose heartbeat
   stopped (`BATCH_JOB_STALE_MINUTES`, 10). Shutdown drains the consumers and fails the jobs it had
   to abandon. **Nothing is re-run automatically.**
5. **There is no default handler.** `createJob` refuses an unregistered type with a 400. A queued job
   of an unregistered type ends `FAILED`, with the reason. `resultUrl` and `processedItems` come only
   from what the handler returns.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Default the switch to **off** (the card's suggestion) | every existing single-instance deployment (compose, the VM) silently stops its backups, retention purge and calibration scan on upgrade. A job nobody runs is a worse failure than one that runs twice, and running twice is now bounded (W-03's index; the P7-02 minute claim) |
| Leader election (a Redis or advisory lock per run) | a second moving part for every job. The chart already runs one scheduler pod, and what remains dangerous about a double run (W-03) is held by the database instead |
| Keep the Redis claim and release it on shutdown | a SIGKILL or OOM kill cannot release anything. The claim has to live where the job's state lives |
| Re-run an interrupted job automatically | handlers are not declared idempotent, so a re-run could repeat side effects. Failing the job with a reason is honest, and the user can start it again |
| Register placeholder handlers for the types the UI offers | that is the fabrication W-08 removed, moved into another file |
| Leave jobs contextless and review each `where` | this is the state that produced W-12. The hooks exist so that isolation does not depend on each author remembering |

**Implications, including the bad ones**

- **Batch jobs now do nothing at all.** No type is registered, so `POST /api/v1/jobs/test`
  answers 400 for every type. The feature is honest, and it is also empty until someone writes a
  handler.
- **An interrupted batch job stays failed.** The user has to start it again, and the failure reason
  says so.
- **The heartbeat adds one `UPDATE` a minute** for each running job. A handler that blocks the event
  loop for longer than `BATCH_JOB_STALE_MINUTES` is failed by the sweep while it is still running.
  Its late completion does not overwrite the `FAILED` row.
- **Defaulting to enabled means a new replica that is not told otherwise runs every scheduler.**
  The chart tells it. A hand-rolled deployment has to set `SCHEDULERS_ENABLED=false` itself.
- **`runAsSystem` is still an opt-out.** It is easy to find (`grep -rn runAsSystem src/`), but it is
  not enforced. W-12 is **partial**: the retention purge, session cleanup, the quarantine sweep and
  MQTT ingest do not use either helper yet.

**Status:** Accepted, implemented 2026-09-25. The tests are named in the ASYNC board rows for W-02,
W-07, W-08 and W-12.

---

## ADR-061: The Database and the Broker Hold the Async Invariants: One Scheduled Work Order per Device, Retries in Delay Queues, One Connection, Settle on the Arrival Channel

**Date:** 2026-09-25 · **Findings:** W-03, W-04/W-30, W-06, W-09, W-18, W-31 · **Migration:** `0060-work-order-auto-scheduled-unique` · **Replaces:** the `ADR-PENDING-async` markers in migration 0060 and `constants/systemActors.js`

**Context**

The calibration scan's idempotency guard was a read followed by three writes. Two scans in the same
minute both created a work order, notified the whole hospital and called the webhook (W-03). Since
A-190 the scan's work order is audited inside its transaction, and since A-124 `logAction` refuses an
entry that names no actor. The scan passed none, so **every work order the scheduled scan tried to
create was rolled back** (W-30, found while fixing W-03). On the queue side, a broker restart ended
both consumers for the life of the process (W-06). A failed email was dead-lettered on every attempt
and retried from an in-process timer that could throw out of its callback (W-09). The email queue
kept its own second AMQP connection, and shutdown closed only one of the two (W-18). The batch worker
acked through the shared publishing channel, where the delivery tag means nothing (W-31).

**Decision**

1. **`maintenance_work_orders.auto_scheduled`** (boolean, default false) and a **partial unique index
   on `device_id`, where `auto_scheduled` and status is Open or InProgress and the row is not
   deleted**. The scan sets the flag. A unique violation from `createWorkOrder` becomes a 409, and
   the scan counts it as a **skip**, before any notification or webhook. The scan's read guard is
   unchanged.
2. **The scan's audit rows name `system:calibration-scan`** (`SYSTEM_ACTORS.CALIBRATION_SCAN`). A
   manual run names the user who asked for it.
3. **One AMQP connection per process** (`rabbitmq.service`), with a memoised in-flight connect and
   channel open, and one `closeRabbitMQ`. `emailQueue.service` no longer imports amqplib.
4. **Supervised consumers.** `startConsumer(queue, handler, {prefetch, setup})` registers on a
   channel of its own. It re-registers with capped exponential backoff when that channel closes or
   registration fails, and re-runs `setup` (the queue declarations) each time. There is one consumer
   per queue.
5. **Settle on the arrival channel.** A handler receives `(msg, ch)`, and `ack`/`nack` never throw. A
   closed channel means the broker has already requeued the message.
6. **Email retries live in the broker.** Retry *n* is published to `email_retry_<ms>`, a durable
   queue whose `x-message-ttl` dead-letters it back onto `email_queue`, and the original is acked.
   Only the last failure is nacked to `email_dlq`. A message that is not a JSON object is
   dead-lettered and not left unsettled.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| A unique index on every open Preventative order per device (the card's first suggestion) | a person may legitimately open a second preventative order (cleaning, an electrical-safety test) while a calibration order is open. That ordinary API create would become a 409 |
| A lock (advisory or Redis) around the scan | it holds only while every writer takes it. A manual run, a new code path or a Redis outage bypasses it. The index holds for every writer |
| Backfill `auto_scheduled` from the old titles or descriptions | this is guessing from free text. A guess that marked two open rows for one device would stop the index from being built. With no backfill, the index cannot find a duplicate |
| Attribute the scan to a seeded "system" user | it would put a user row in every tenant, with a password field nobody owns. It would also blur "a person did this" in a Part 11 trail |
| The RabbitMQ delayed-message plugin | it is a plugin that has to be installed on every broker, and the deployment treats RabbitMQ as optional. TTL queues are core AMQP |
| Keep the in-process retry timer and catch around it | a restart would still lose the retry, and the DLQ would still get a copy for every attempt |
| Publisher confirms on every publish | this is the right next step, and it was not done here (see the implications below) |

**Implications, including the bad ones**

- **Rows that existed before this change are never protected.** Existing open orders stay `false`,
  so a race against an old open calibration order is caught only by the read guard. That race window
  closes when the old order does.
- **One delay queue per tier** (`email_retry_2000/4000/8000` by default). Changing
  `EMAIL_RETRY_BASE_MS` declares new queues. The old ones are left for an operator to delete, and
  redeclaring a queue with different arguments is a `PRECONDITION_FAILED`.
- **No publisher confirms.** A publish made in the gap between the broker dying and the client
  noticing is lost without an error. This was observed in the live run: a publish on the stale
  channel just after a restart. An email lost this way is not retried. The window is the socket
  close latency.
- **At-least-once, not exactly-once.** The A-26 claim for email is still taken before the send.
- **The email DLQ is now truthful:** one message per exhausted job. Anything reading it as "one per
  attempt" was reading it wrong before.
- **The migration's `down` keeps the column.** The model declares it, and it records which orders
  the scan created.

**Verified.** Migration 0060 was run on **PostgreSQL 18.6**: up, a second `migrator.up()` that
applied nothing, a direct re-run of `up`, `down` (index gone, column kept), and `up` again. The index
was checked with `\d maintenance_work_orders`. The two-scan race was run live on the same server
(`calibrationScheduler.w03.live.test.js`); without the index, the race test fails. The queue
behaviour was run on **RabbitMQ 4** with a real container restart (`rabbitmq.w06.live.test.js`). The
old code left **4** DLQ copies of one always-failing email on that broker; the new code leaves 1.

**Status:** Accepted, implemented 2026-09-25.

---

## ADR-062: Calibration Records Are Append-Only in the Database; the Backend Runs as an Application Role; Every Boot Verifies the Schema; Stock Moves Only by Adjustment; Every Secret Names Its Key

**Date:** 2026-09-25 · **Findings:** P6-03 (PR-2, BR-7), P6-05 (PR-5), P6-09, P6-10, S-08, S-26, A-240, A-242 · **Migrations:** `0057`, `0058`, `0059` · **Replaces:** the `ADR-PENDING-data` markers

**Context**

Five controls the compliance story depended on were conventions, not mechanisms. `calibration_records`
was `paranoid` and had `PUT` and `DELETE` routes. The backend connected as the database owner — a
superuser in compose — so a `REVOKE` alone would have protected nothing (A-240). A migration that did
nothing could be recorded as applied, and nothing checked the columns (PR-5). `PATCH /stocks/:id` set
`quantity` with no reason and no actor. No secret could be rotated: KMS envelopes named no key,
tenant signing keys were AES-CBC under `ENCRYPT_KEY`, and the JWT "key registry" was an in-process
map that emptied itself after 30 days of uptime (S-26).

**Decision**

1. **`calibration_records` is append-only in the database, for every role (P6-03, migration `0057`).**
   - A trigger refuses `DELETE` and `TRUNCATE` outright.
   - `UPDATE` may change only the lifecycle columns, and only once each:
     - `superseded_by_id` and `superseded_at` — the record was corrected;
     - `void_reason`, `voided_by`, `is_deleted`, `deleted_at` — the record was voided;
     - `updated_at`.
   - Every other column is compared as "all but the lifecycle list", so a column added later is
     immutable by default.
   - CHECKs: a void names a reason; a correction names a reason and never supersedes itself. A
     partial unique index on `supersedes_id` keeps each correction chain linear.
   - The routes changed to match. `PUT` and `DELETE` are gone. A wrong result is corrected by a
     **new** record (`POST /:id/corrections`), and the original stays. A record entered in error is
     voided with a reason (`POST /:id/void`), and a void is final.
2. **The backend runs its queries as an application role (P6-03).**
   - `0057` creates `DB_APP_ROLE` (default `callibrator_app`): `NOLOGIN`, DML on every table and
     sequence, default privileges for tables created later.
   - It then revokes `UPDATE`, `DELETE` and `TRUNCATE` on `calibration_records`, and grants `UPDATE`
     back on the lifecycle columns alone.
   - Boot still migrates as the owner. It then switches every pooled connection with `SET ROLE`
     (`afterPoolAcquire`, `utils/dbRole.util.js`).
   - Before continuing, boot **proves the switch as the switched session**. It refuses to start if
     the role is a superuser, can `DELETE` or table-wide `UPDATE` `calibration_records`, or cannot
     `INSERT`.
   - `0057` also switches off row level security left on with no policy by `0012` (A-242). That was
     invisible to a superuser and fatal to the application role.
3. **Every boot compares the schema with the models, and refuses on a mismatch (P6-05).** After
   `db.sync()` and the migrator, and before the role switch, `utils/schemaVerify.util.js` checks
   `information_schema` against:
   - every model's table and columns;
   - any undeclared `NOT NULL` column with no default;
   - any table with row level security on;
   - the control objects that exist only in migrations: the two `0057` triggers, the void CHECK, the
     per-tenant serial index (`0026`), the stock-reason CHECK (`0059`), and the case-insensitive
     identity indexes (`0063`, ADR-063).

   It is not wrapped in a catch. `SCHEMA_VERIFY=warn` is the only way past a mismatch, and it logs
   every one at error level. `make migrate` ends in `make migrate-verify`.
4. **A stock quantity changes only through an explained movement (P6-09, migration `0059`).**
   - `PATCH /stocks/:id` refuses a `quantity` change (a `0` included) with a 400 that names the
     adjustment endpoint.
   - An adjustment's `reason` is `NOT NULL` with `CHECK (btrim(reason) <> '')`, and the validator
     refuses a blank one.
   - Every adjustment records `stock_id`, `quantity_before` and `quantity_after`.
   - Stock created with a quantity writes an opening-balance adjustment.
   - Legacy adjustments with no reason are backfilled with a text that says none was recorded.
5. **Every stored secret names the key that wrapped it, and every key has a successor (P6-10, S-08,
   S-26, migration `0058`).**
   - **KMS envelopes are `v2:<keyId>:…`.** The ring is `KMS_MASTER_KEY` plus
     `KMS_MASTER_KEY_PREVIOUS`, and `npm run keys:rotate` re-wraps resumably. A `v1` envelope,
     which names no key, is read by trying each key.
   - **Tenant e-signature private keys are KMS envelopes with the tenant id as AAD.** `0058`
     converts every legacy CBC row, verifying each one by re-reading it. After that, `ENCRYPT_KEY` is
     read only for a row restored from an old backup.
   - **The JWT key registry is deleted.** Each token names its key (`kid` = fingerprint).
     `JWT_ACCESS_SECRET_PREVIOUS` and `JWT_PUBLIC_KEY_PREVIOUS` cover one token lifetime. The
     algorithm is pinned, and there is no HS256 fallback.
   - The procedure is `docs/SECURITY/13-KEY-ROTATION.md`.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| `REVOKE UPDATE, DELETE` alone | decorative while the backend is the owner or a superuser (A-240): the owner can re-grant, and a superuser skips privilege checks |
| The trigger alone | it holds for every role, but an auditor asks for the grant by name, and two independent layers mean one mistake does not reopen the hole |
| A separate `LOGIN` role for the application, with no path back to the owner | stronger: `RESET ROLE` could not undo it. But it needs a second credential in every deployment template, including Helm. Recorded as the recommended hardening, not built |
| Keep `PUT` and make every edit an audited change | the record's content still changes in place. Part 11 wants the original kept and the correction attributable |
| Verify the schema in CI only | CI never sees the deployed database, and the drift that matters is the drift on that database |
| `db.sync({ alter: true })` to close column gaps | alters live tables with no review, and hides the migration that did nothing instead of naming it |
| Version `ENCRYPT_KEY` separately instead of moving the signing keys into the KMS | two key-management schemes for the same kind of secret, and CBC stays unauthenticated |
| An external KMS (AWS KMS, Vault) now | the key-id format is what makes one pluggable later. Choosing a provider is a deployment decision, not this card |

**Implications — including the bad ones**

- **`SET ROLE` can be undone by `RESET ROLE`.** An attacker who can run arbitrary SQL gets the owner
  back. The trigger still holds even then, but the grant does not. A separate login role would close
  this.
- **Runtime paths that need the owner now fail as the application role:**
  - `migration.service#syncTables` (`db.sync({ force: true })`) and the other destructive reset
    helpers;
  - `unseedDemoData`, which force-deletes the demo tenant's calibration records. It is not
    transactional, so it stops part-way after deleting the certificates. **Demo calibration records,
    and the devices they reference, can no longer be removed.** This is the intended guarantee, but
    the helper does not yet say so.
- **Roles are cluster-wide.** Two databases on one cluster share `callibrator_app` unless
  `DB_APP_ROLE` differs. On managed PostgreSQL an owner without `CREATEROLE` cannot create the role,
  so `0057` refuses the boot with the two statements an administrator must run.
- **`DB_APP_ROLE` unset means owner mode.** Every boot logs a warning, and only the trigger protects
  the records. `deploy/compose/.env.example` sets it; **the Helm chart does not**.
- **A void is final.** A mistaken void is answered by a new record, never an undo. Rows soft-deleted
  before `0057` carry a synthetic void reason that says no reason was recorded.
- **Adjustments written before `0059` stay unattributed:** `stock_id` and before/after are `NULL`.
  The migration does not guess.
- **A mismatch refuses the boot.** Any hand-made column, trigger drop or skipped migration now stops
  the application until someone fixes it or sets `SCHEMA_VERIFY=warn`.
- **`0058` needs the `ENCRYPT_KEY` the rows were written under.** With the wrong key it refuses the
  boot, naming each row. Its `down` converts back to unauthenticated CBC.
- **The rotation has been rehearsed only against seeded data**, on PostgreSQL 16 and 18.6
  (`keyRotation.s08.live.test.js`). The rehearsal against a copy of production that the P6-10 DoD
  asks for is still owed.

**Verification (PostgreSQL 18.6, `pgvector/pgvector:pg18`)**

- **Fresh boot:** `db.sync()` then all 57 migrations; verifier OK; `current_user = callibrator_app`.
- **Upgrade from `fabc3be`'s schema, with legacy rows seeded:**
  - the 12 pending migrations apply;
  - the soft-deleted record is backfilled;
  - the blank and `NULL` reasons are backfilled;
  - the legacy CBC signing key becomes `v2:`;
  - the verifier passes.
- **Re-running** is a no-op. **Up, down, down, up** was run for each of `0057`–`0059`.
- **As `callibrator_app`:**
  - `DELETE`, a content `UPDATE` and `TRUNCATE` are refused with "permission denied";
  - a void and an `INSERT` succeed.
- **As the superuser owner,** the trigger refuses `DELETE` and content changes.
- **Mutation check:** with `DELETE` granted back, the trigger still refuses. With the trigger also
  disabled, the delete succeeds.

Tests: `dataIntegrity.p6.live.test.js` (21), `keyRotation.s08.live.test.js` (5),
`dbRole.util.p603`, `schemaVerify.util.p605`, `0057-0059.p6`, `calibrationRecords.service`,
`stock.service`, `stock.validator`, `keyRotation.service.s08`, `kms.rotation.s08`,
`signingKeyWrap.s08`, `keyring.util.p610`, `certificatePdf.keyId.p610`, `jwt.keyring.s26`.

**Status:** Accepted, implemented 2026-09-24/25 (batch 6). Verified on PG 18.6 on 2026-09-25.

---

## ADR-063: Identity and Certificate Numbers Stay Platform-Wide; Identity Is Case-Insensitive; Erasure Pseudonymises; the Audit Trail Is Indexed; Migrations Never Swallow

**Date:** 2026-09-25 · **Findings:** D-05, D-06 (A-37), D-08, D-09, D-10, D-11, D-14, D-15 (D-40) · **Extends:** ADR-051 (Q-12, Q-16, Q-18) · **Migrations:** `0062`, `0063` · **Replaces:** the `ADR-PENDING-dbA` markers

**Context**

The data audit proposed per-tenant uniqueness for `users.email`, `users.username` (D-06) and
`certificates.certificate_number` (D-15). It also found that `hardDeleteUser` was a soft delete
reported as a hard one (D-11), that `audit_logs` had no useful index (D-08), and that five migrations
recorded themselves applied on any `describeTable` error (D-14). Two of those proposals conflict with
decisions already made: ADR-051 Q-18 keeps one global identity, and the public verification page
resolves a certificate by its number alone.

**Decision**

1. **Identity stays platform-wide, and is now case-insensitive (D-06, migration `0063`).** ADR-051
   Q-18 stands: sign-in takes a username or email with no tenant qualifier, so each identifier must
   name exactly one account.
   - `0063` adds `UNIQUE (lower(email))` and `UNIQUE (lower(username))` beside the existing exact
     indexes. SCIM wrote addresses as the IdP sent them, and the A-128 duplicate check used `ILIKE`
     while the constraint did not.
   - The migration **refuses** while two accounts differ only by case. It names account ids and
     tenants, never the address, because migration output lands in logs.
   - The indexes live only in the migration, never on the model, because `sync()` runs first.
2. **Certificate numbers stay platform-wide (D-15, D-40).** The number is the key the public
   verification page and the printed QR code resolve, with no tenant in the URL. The card's composite
   constraint is rejected.
   - What was broken is fixed instead. Every tenant with no `code` shared the prefix `T`, and the
     generator's tenant-scoped lookup could not see the other tenant's numbers. The second such
     tenant to issue on a given day collided.
   - A code-less tenant's prefix is now `T` plus the first 8 hex digits of its id.
   - The generator reads the highest number under that prefix across every tenant
     (`skipTenantScope`). That number is never returned to the caller.
3. **Erasure pseudonymises the account in place. There is no physical delete (D-11).**
   - The account row is referenced, with `RESTRICT` (ADR-051 Q-16), by calibration records,
     signatures, certificates and the audit trail. Those are records the platform must keep: 21 CFR
     Part 11, ISO 17025, and GDPR Art. 17(3)(b).
   - An erasure destroys the name, contact details, password, second factors and sessions. It keeps
     the id, so the retained records stay attributable.
   - `hardDelete: true` is **refused with a 400** that says what an erasure does instead. The
     `anonymize: false` branch is reported as `soft_deleted` and erases nothing.
4. **The audit trail is indexed by migration, never by the model (D-08, migration `0062`).**
   - The indexes are `(tenant_id, created_at DESC)`, `(tenant_id, resource_type, resource_id)` and
     `(user_id)`.
   - They are built `CONCURRENTLY`, because every mutation writes an audit row. A plain build would
     stall every tenant's writes for its duration.
   - An `INVALID` index left by an interrupted build is dropped and rebuilt, never accepted.
5. **A migration never swallows an error (D-14, D-09).**
   - The five `catch { return }` guards around `describeTable` are gone. `sync()` runs first, so the
     table exists, and the only thing a catch could swallow is a real failure.
   - A migration that genuinely tolerates an absent table checks with `showAllTables()` and says so,
     as `0063` does.
   - `0011` refuses to re-run over a populated `e_signature_records` (A-147).
   - A test runs the whole migrator twice over a populated database, `schema_migrations` emptied in
     between, and asserts every table's row count is unchanged.
6. **Every raw query that names a tenant-scoped table carries `tenant_id` (D-05).**
   - The `card_seq` bump in `kanban.service#createCard` now carries the project's tenant, and a
     statement that updates no row is a 404.
   - `rawSqlTenantPredicate.d05.test.js` is the tripwire:
     - it derives the tenant-scoped tables from the real model factories;
     - it reads every `.query(` in application source;
     - it fails on a statement that names a scoped table, or interpolates a table name, without
       `tenant_id`.
   - A deliberate cross-tenant statement must be listed in its `CROSS_TENANT` map with a reason.
     The map is empty.
7. **`calibration_records.performed_by` is `RESTRICT` (D-10).** This was decided in ADR-051 Q-16
   and is confirmed here on PostgreSQL 18. A hard delete of a user who performed a calibration fails
   with SQLSTATE `23001` (`restrict_violation`), and the record stays.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| `UNIQUE (tenant_id, email)` and `(tenant_id, username)` (the D-06 fix direction) | ADR-051 Q-18 rejected it: it needs tenant-qualified sign-in on every path. Memberships are the long-term model |
| A `citext` column type | changes the column type under every query and every `sync()`, for what one expression index does |
| Lower-case on write only | leaves existing mixed-case rows and relies on every writer, SCIM included, remembering to do it |
| Per-tenant certificate numbers, with the tenant in the verification URL | breaks every QR code already printed on a certificate |
| A physical delete with `SET NULL` and the performer's name copied onto each record | loses attribution for a Part 11 record, and copies personal data into more places, not fewer |
| Indexes declared on the `AuditLog` model | `sync()` never adds an index to an existing table (D-13), and would build it with a blocking lock on a fresh one |
| A lint rule instead of a test for D-05 | the project has no custom ESLint rule infrastructure. The test uses the real model set, so a new scoped model is covered with no edit |

**Implications — including the bad ones**

- **The existence oracle remains.** A tenant admin creating a user learns that an address or
  username exists somewhere on the platform, now case-insensitively too. This is the narrow residual
  that Q-18 accepted.
- **`0063` refuses the boot while case-variant duplicates exist.** An operator must decide which
  account a person keeps.
- **A code-less tenant's printed certificate numbers expose the first 8 hex digits of its tenant
  id.** Numbers issued before this change keep the shared `T` prefix.
- **An erased account is a row forever,** holding `erased_<id>@erased.local`. Nothing on the platform
  can physically remove a person's account row. If the owner wants that, it needs a new decision.
- **`CONCURRENTLY` cannot run inside a transaction,** so `0062` is not atomic. On a large deployed
  `audit_logs`, the first boot after it takes as long as three index builds.
- **The D-05 tripwire is textual.** A statement assembled at runtime from fragments escapes it. It
  proves the predicate is present, not that it is correct.

**Verification (PostgreSQL 18.6)**

`dataIdentity.dbA.live.test.js` passes 10/10. It covers:

- D-10 `RESTRICT`;
- D-11 erased fields, asserted field by field, and the `hardDelete` refusal;
- D-06 case-variant refusal, both as a constraint and as the migration's refusal;
- the D-08 plans using each new index over 20,000 rows;
- the D-40 two code-less tenants;
- D-09, the whole migrator run twice with row counts unchanged;
- `0011`'s refusal.

**Up, down, down, up** was run for `0062` and `0063` on an upgraded and a fresh database.

Unit tests: `0062-audit-log-indexes`, `0063-user-identity-case-insensitive`,
`describeTableGuards.d14`, `certificateNumber.d40`, `gdpr.service`, `kanban.service`,
`rawSqlTenantPredicate.d05`.

**Status:** Accepted, implemented 2026-09-24/25 (batch 6). Verified on PG 18.6 on 2026-09-25.

---

## ADR-064: Roles Stay Global; Child Tables Stay Unscoped Behind a Checked Parent Key; Evidence Links Are RESTRICT; Every Tenant Key and Foreign Key Is Indexed; Money Reads as a Number; a Tenant Purge Never Destroys a Retained Record

**Date:** 2026-09-25 · **Findings:** D-12, D-13, D-16 (A-38), D-17, D-18, D-19, D-20, D-21, D-22, D-23, D-24, D-25, D-26, D-27, D-28 · **Extends:** ADR-051 (Q-16), ADR-062 (P6-05), ADR-039 · **Migrations:** `0066`, `0067` (`0068` and `0069` were reserved by the halted agent and never written) · **Replaces:** the `ADR-PENDING-dbB` markers

**Context**

The second half of the data audit (`TASKS/AUDIT-2026-09-DATA.md`, D-12 to D-28) was worked by the batch-6
agent "dbB", which was halted mid-task; its edits were committed unverified in `244b63b..beb0c4b`. This ADR
records the decisions those edits implement, and the ones finished afterwards. Several cards are data-model
questions rather than defects: the audit said so, and asked for a recorded decision either way.

**Decision**

1. **Roles, their menu permissions and menu groups stay global (D-16, D-17 group 3).** No `tenant_id` on
   `roles`, `role_menu_permissions`, `menu_groups`, `user_menu_permissions`; `roles.name` stays unique
   platform-wide. The guard is the route: every route that creates, renames, deletes or re-permissions a
   role or menu group is SUPERADMIN-only, held route by route by `rolesGlobal.d16.test.js` (43 tests; a new
   mutating route fails its inventory). The CMS (`posts`, `categories`, `post_categories`) is platform
   content by the same decision.
2. **Child tables stay unscoped, and the parent key is checked statically (D-17 group 2).** The seven
   `kanban_*` children, `workflow_steps`, `workflow_actions`, `notification_states`, `ticket_comments` and
   `user_menu_permissions` do not gain a denormalised `tenant_id` now. Every query on them must name its
   scoped parent's key; `unscopedModels.d17.test.js` parses `backend/src` and fails on one that does not,
   with two reviewed exceptions, and fails when a new model without a tenant column is not listed with its
   reason. Every such model carries a header comment naming the reason and the compensating control.
3. **An evidence row's link to what it evidences is `ON DELETE RESTRICT` (D-18).** Only a non-attesting
   operational actor may be `SET NULL`. After `0066` (`signature_records.workflow_step_id`, was CASCADE) the
   rule holds for all five evidence tables: `signature_records`, `e_signature_records`, `certificates`,
   `calibration_records`, `attachments` (tenant RESTRICT; `uploaded_by` SET NULL; the polymorphic resource
   link has no foreign key — item 8). No code hard-deletes a signature model (`signatureEvidence.d18.test.js`).
4. **Every tenant column and every foreign key is indexed, by migration and in the model (D-19, D-20).**
   `0067` creates up to 75 reviewed indexes (tenant boundary, `(tenant_id, status)` where lists filter on status,
   every unindexed FK, and `iot_readings (tenant_id, device_id, timestamp)` / `(tenant_id, timestamp)`),
   skipping any already served by an index with the same leading columns and recording what it created, so
   `down` drops exactly those. `iot_readings` is a retention entity: platform default 0 (keep), opt-in
   per tenant, floor 730 days. It is **not partitioned** while empty (A-29: nothing ingests); the Open
   Decisions row "Partitioning `iot_readings` and `audit_logs`" stands. `webhook_deliveries` has the same
   unbounded shape and **no purge** — open; `document_chunks` is replaced on re-index and bounded by its
   documents.
5. **A `DECIMAL` attribute reads as a number (D-21).** A per-attribute `get()` returning `Number(...)`, not
   a global `pg` type parser: visible in the model, and it does not silently change `raw: true` and
   aggregate results elsewhere. Aggregates are parsed at the call site. `decimalGetters.d21.test.js`
   discovers every `DECIMAL` attribute. Rule in `docs/BACKEND/00-BACKEND-STANDARDS.md`.
6. **`db.sync()` is not a migration (D-13, D-12).** It creates tables and adds missing model indexes; it
   never adds a column, an enum value or a changed foreign key. Drift is caught at every boot by ADR-062's
   schema verification. An index on a column only a migration creates never goes on the model in the same
   release (it would break `sync()` on every existing database, because sync runs first). Every include of a
   default-scoped model states `required` — a test over the source (`includeRequired.d12.test.js`) is the
   lint rule.
7. **A tenant purge never destroys a retained record (D-23).** `hardDeleteOffboardedTenant` runs in one
   transaction; it counts every tenant-scoped table (enumerated from `db.models`) that is neither on 0030's
   CASCADE list nor on its own delete list (`tenant_settings`, `users`, `subscriptions`), soft-deleted rows
   included, and **refuses (409)** naming each that holds rows. Otherwise it deletes those three, then the
   tenant row, with one PLATFORM audit row. The compliance answer to "what is retained after a purge": every
   regulated record — calibration records, certificates, signatures, invoices and the audit trail, which
   includes the offboarding itself — until an archival process removes it. None exists.
8. **An attachment's resource link stays polymorphic, validated in code (D-22).** No foreign key is possible
   on `(resource_type, resource_id)`. A linked attachment's type must be on `LINKABLE_RESOURCES` and its id a
   live record of the caller's tenant (A-97). Cascading a parent's soft delete to its attachments is open.
9. **Aggregation happens in the database (D-24).** PostgreSQL-only (ADR-039) removes the portability that
   justified bucketing in JS: `monthlyTrend` groups by `date_trunc('month', …)` in the connection's timezone
   (`+07:00`) and returns at most six rows.
10. **Low-severity schema conventions (D-25, D-26, D-27, D-28).** `paranoid` (`deleted_at`) is the
    soft-delete mechanism for new models; the eleven models that carry both `isDeleted` and `deleted_at` are
    not converted in this change. Native `ENUM`s stay; a new value is a migration (`ALTER TYPE … ADD VALUE`),
    because `sync()` never adds one. JSON columns: `api_keys.scopes`' comment now matches `assertScopes`.
    `"UsageMetrics"` keeps its camelCase name, documented in `docs/DATABASE/11-BILLING-TABLES.md`.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Tenant-owned roles: nullable `roles.tenant_id` (NULL = system), `UNIQUE (tenant_id, name)`, hooks scope them | a migration with a backfill over every user's `role_id`, a split between "system" and "tenant" roles in every gate, and SCIM already gives tenants their own group names (ADR-053). Worth doing when a tenant needs a custom role; not as an audit side effect |
| A denormalised `tenant_id` on the eleven child tables | eleven columns, a backfill, and every create path — including background jobs — must stamp a tenant; a missed stamp is a row no one can see. The static parent-key check gives the same guarantee for today's code at no schema cost |
| `ON DELETE CASCADE` kept on the step key, relying on paranoid steps | the database would obey the one `force: true` or hand-run `DELETE` that erases Part 11 signatures; RESTRICT makes the database refuse |
| Indexes in the model `indexes` block only | `sync()` adds them only when it next runs, and 60-odd names appearing at an arbitrary boot is not a reviewable change; the migration creates them deliberately, reversibly and with a lock timeout |
| `CREATE INDEX CONCURRENTLY` in `0067` | cannot run inside the transaction that makes the migration atomic; every table is small today. The header documents the by-hand path for a large database |
| A global `pg.types.setTypeParser(1700, parseFloat)` | also changes every `raw: true` read and aggregate, silently, and float-parses money everywhere; the getter is local and discoverable |
| Rely on `tenants` CASCADE for the purge | 0030 made regulated tenant keys RESTRICT on purpose (ADR-051 Q-16); CASCADE would erase the evidence the platform must keep |
| Remove `hardDeleteOffboardedTenant` (it has no caller) | the offboarding design names a purge after retention; a correct, refusing implementation is the specification for whoever wires it |
| Rename `"UsageMetrics"` to `usage_metrics` | touches raw statements and every deployed database for a naming benefit only |

**Bad implications, stated**

- Roles are shared: a tenant cannot have a role of its own, and a platform operator's rename changes it
  for every hospital. Tenants needing custom roles have no path today.
- The child-table guarantee is a source scan, not a database predicate: raw SQL, a dynamic model name, or a
  query built outside `backend/src` escapes it.
- RESTRICT means a genuine clean-up of a test workflow's signatures needs a deliberate archival step; and
  on PostgreSQL 18 a RESTRICT refusal is SQLSTATE **23001** (`restrict_violation`), which Sequelize 6 does
  **not** map to `ForeignKeyConstraintError` (only 23503). Any future "refusal → 409" translation must test
  both codes (`dataLayer.dbB.live.test.js` asserts either).
- `0067` takes a SHARE lock per table while it builds; on a large production database it needs a window.
- The number getter does not cover `raw: true` or `SUM`; a new aggregate over money can still be a string.
- In practice no real tenant can be hard-deleted: every offboarded tenant has at least its offboarding
  audit row. That is intended, but it means offboarded tenants accumulate until archival exists.
- `monthlyTrend`'s months are WIB months (the connection timezone), not the viewer's.
- D-22's orphaning path (a parent soft-deleted, its attachments still listed) and D-24's other unbounded
  reads (DSAR export, SOP fan-out, signature history) remain.

**Evidence**

On PostgreSQL **18.6** (`pgvector/pgvector:pg18`, throwaway container), booting as `backend/index.js` does
(`db.sync()`, then the migrator from `0001`, then ADR-062's schema verification):
- a database built by `fabc3be` (45 migrations) then booted by this tree: `0066`, `0067`, `0070` applied,
  schema verification OK; the step key became `ON UPDATE CASCADE ON DELETE RESTRICT` with the previous
  CASCADE definition recorded; 71 of the 75 indexes created (the two `iot_readings` indexes had already been added by
  `sync()` from the model, and two more were already served by existing indexes — all four skipped); re-running each `up` changed nothing; `down` to before `0066`
  restored CASCADE and dropped exactly the 71; `up` again re-applied all three;
- a fresh database: 57 migrations, verification OK; a second boot applied 0;
- `dataLayer.dbB.live.test.js` (10 tests) against the same server;
- D-23 against the migrated database: a tenant with an audit row refused (409, `audit_logs (1)`); a tenant
  with only settings and a CASCADE custom domain deleted, and afterwards no row in any of the 52 tables
  with a `tenant_id` column referenced it (enumerated from `information_schema`).

Unit tests: `includeRequired.d12`, `rolesGlobal.d16`, `unscopedModels.d17`, `signatureEvidence.d18`,
`0067-foreign-key-and-tenant-indexes`, `dataRetention.service` (iot_readings), `decimalGetters.d21`,
`tenantLifecycle.hardDelete.d23`, `dashboard.service` (monthlyTrend).

**Status:** Accepted. D-12, D-13, D-16 to D-21, D-23, D-27, D-28 implemented 2026-09-25; D-22, D-24, D-25, D-26
partial (see the board).

---

## ADR-065: Custom Domains Are Verified Claims, Unique While Live; Stock Transfers Are Decided on Their Own Lifecycle; a Started Approval Workflow Is Mandatory; Tenant Moves Are Transactional; Unrouted Handlers Are Removed

**Date:** 2026-09-25 · **Findings:** A-201, A-202, A-203, A-223, A-224, A-225, A-226, A-228, A-253, A-255, A-256, A-258 · **Extends:** ADR-055 (workflow decisions are signatures), ADR-042/057 (file serving), A-190 · **Migrations:** `0070` · **Replaces:** the `ADR-PENDING-misc` markers

**Context**

The batch-6 agent "misc" was halted while editing the custom-domains service; its edits were committed
unverified. Two of its cards were marked as needing an owner decision (A-201's status mapping, A-203 "is the
workflow mandatory?"). The owner's standing instruction is to argue both sides briefly, decide on best
practice, and record the decision.

**Decision**

1. **A custom domain is a verified claim, unique while live (A-223, A-256; migration `0070`).**
   - `custom_domains.domain` is no longer globally unique. It is stored lower-case, and two partial unique
     indexes hold the rule: ACTIVE (verified) for one organisation at a time; live (not `deleted`) at most
     once per tenant. A removed domain blocks nothing and can be added again; a PENDING claim does not hold a
     domain against its real owner — the first to publish the DNS record and verify holds it.
   - Every conflict is a 409 with its explanation; a lost race on either index is the same 409, not a 500.
     The "someone else holds it" answer never says who.
   - `0070` refuses, changing nothing, while existing rows already violate the new indexes (naming row ids,
     never the domain), and its `down` refuses while a removed domain has been re-added.
   - **Serving the application on a custom domain is not implemented.** `resolveTenantByDomain` and
     `provisionTLSCertificate` had no caller and were removed rather than fixed: selecting a tenant from a
     `Host` header is a tenant-isolation decision (which principal may act where, what a spoofed `Host`
     selects), and the ACME stub had no caller, no persistence of what it issued and no renewal.
     `TLS_AUTO_PROVISION` and `ACME_*` are no longer read; the instructions stop promising a certificate.
2. **A stock transfer's workflow decision lands on the transfer's own states (A-201).**
   - For: add `approved` / `rejected` to the ENUM — the transfer then records the decision literally. Against:
     an `ALTER TYPE` migration, and two new states every transfer screen, filter and transition rule must
     learn, for information the workflow instance already holds.
   - **Decided:** approved → `in_transit` (released to move; `approvedBy` = the approver), rejected →
     `cancelled`, each audited in the decision's transaction. An approval authorises a movement, it does not
     perform one: stock moves only at `completed`, which counts and audits both quantities (P6-09). A
     transfer no longer `pending`, or gone, is a 409 and the decision rolls back.
   - A maintenance work order's sign-off (nothing starts one yet): approved → `Completed`, rejected →
     `InProgress` (back to its performer). A rejection used to change nothing.
3. **A started approval workflow is mandatory (A-203, A-202).**
   - For "optional": a direct approval is itself permission-gated, re-authenticated and audited, and an
     absent approver in the chain could block an urgent certificate. Against: a tenant that configured a chain
     configured it as its approval control (ISO 17025 7.8, Part 11 §11.10(f) sequencing checks); a direct
     approval made the chain advisory and left its instance PENDING forever over an approved certificate — an
     inconsistent record.
   - **Decided:** while a certificate's instance is PENDING, `POST /certificates/:id/approve` is 409, decided
     under the row lock and before re-authentication. A tenant with no workflow approves directly, as before.
     A re-submission after a rejection starts a new instance in the same transaction. The same holds for a
     stock transfer: its workflow starts inside the create's transaction (was after commit, fail-soft — the
     A-190 shape), the create is audited, and a manual status change while the instance is PENDING is 409.
   - The remedy for an absent approver is to reconfigure the workflow (an audited definition change, A-204),
     not a bypass.
4. **Moving a tenant in the hierarchy is one audited transaction (A-224).** The handlers moved into
   `tenantHierarchy.service`: tenant row locked, a cycle refused on the `parentId` chain (not only on paths,
   which may be incomplete), the tenant's hierarchy row and every descendant's `path` and `depth` rewritten,
   depth limit checked for the whole subtree, `_` escaped in the `LIKE` subtree pattern, one PLATFORM audit
   row. "Already a root" is a 409.
5. **Unreachable handlers are removed (A-255).** The seven unrouted `tenantHierarchy.controller` handlers
   and the service's `assignRoleToUserAcrossHierarchy` — which wrote a user's role unaudited, with no
   privilege check, and passed a user id where a tenant id was expected — were deleted rather than routed.
6. **Already implemented by the halted agent, recorded here:**
   - A-225: `PATCH /billing/subscription` refuses every change on a Stripe-billed subscription (409 — the
     provider is the source of truth), allows only the payment-lifecycle status transitions with a required
     `reason`, locks the row, and audits before/after in one transaction.
   - A-226: a menu group's parent may not be itself or a descendant (409); an unknown parent is 404.
   - A-228: the log redaction masks email addresses in any string and redacts keys ending in `link`.
   - A-253: `/documentation` and `/standards` are served only under `SWAGGER_ENABLED` (not in production by
     default); `/error` (a test route answering 500) and `/tab-permissions` (a missing file) were removed.
   - A-258: `username-check` compares exactly (case-insensitive), not with `LIKE` on raw input.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Keep the global unique on `domain`, hard-delete on removal | the removal is in the audit trail by id; a hard delete leaves audit rows naming nothing |
| Implement Host-header tenant resolution and ACME now | a tenant-isolation design (spoofed `Host`, principal vs. domain tenant mismatch, certificate storage and renewal) that deserves its own spec, not a side effect of an audit card |
| `approved`/`rejected` transfer states | see 2 |
| Approval completes the transfer (moves the stock) | conflates authorising a movement with receiving it; the receiving count is a separate, audited act |
| Direct approval stays allowed alongside the workflow | see 3 |
| Route the seven hierarchy handlers behind SUPERADMIN | they duplicated routed handlers with other response shapes, and one was a privilege-escalation primitive |

**Bad implications, stated**

- A verified custom domain does nothing for users yet; the UI must not imply otherwise. Deploy templates
  still set `TLS_AUTO_PROVISION` (harmless; to be removed with them). `acme-client` remains a dependency.
- `0070` lower-cases stored domains; its `down` does not restore the original case.
- (Checked: no frontend screen uses `Approved`/`Rejected` as a transfer status — a grep of `frontend/src`.)
- An approver who is absent blocks a certificate until the workflow is reconfigured.
- A transfer decided by a workflow still needs a person to mark it `completed` when it arrives.
- A tenant move rewrites every descendant row under lock; a very large subtree is a long transaction.

**Evidence**

`0070` on PostgreSQL 18.6, booted from `fabc3be`'s schema with legacy rows (a removed `Old.Example.com`, a
pending and an active domain): before, re-adding the removed domain failed on `custom_domains_domain_key`;
after, the two legacy uniques (`custom_domains_domain_key` and the model index `custom_domains_domain`) were
dropped, domains lower-cased, the partial indexes created; re-adding succeeded, a second ACTIVE and a second
live row in one tenant were refused by the new indexes; `down` refused while re-added rows existed, then
restored `custom_domains_domain_key`; `up` again re-applied. The workflow gate's lookup
(`workflow.service#findPendingInstance`) on the same server: a PENDING Certificate instance was found (with its
workflow's name and step), the same resource id asked as a StockTransfer was not, and after the instance was
REJECTED it was not found.

Named tests, and how many failed at `fabc3be`: `customDomains.service` (31 of 59), `appRoutes.a253` (4 of 4),
`billing.subscriptionOverride.a225` (22 of 24), `menuGroup.cycle.a226` (9 of 18), `activityLog.redaction.a228`
(11 of 17), `user.usernameCheck.a258` (6 of 9), `tenantHierarchy.move.a224` (14 of 14), `workflow.service` ›
A-201 (all new A-201 cases), `stock.service` › A-202 (4 of 4), `certificate.service` › A-203 (2 of 4; the two
that pass at baseline pin the unchanged no-workflow path).

**Status:** Accepted, implemented 2026-09-25.

---

## ADR-066: CI Is One Workflow of Required Gates; Scheduled Jobs Alert on Their Outcome; Deployment Credentials Have One Source

**Date:** 2026-09-25 · **Findings:** P7-01, A-19, P7-02, P7-03, P7-07, P7-08, S-09, S-17, S-18, S-19, S-23, S-25, P6-03 (deployment half) · **Replaces the markers:** `ADR-PENDING-infra (CI)`, `(P7-02)`, `(helm secrets)`, `(P7-08/S-23)`, `(S-17 location)`

**Context.** The "infra" agent of batch 6 was halted before it wrote a report. Its edits were committed
unverified, with five `ADR-PENDING-infra` markers in `docs/`. The follow-up on 2026-09-25 verified
what could be run locally and found three defects the unverified work would have shipped. The
workflow's own `actionlint` stage failed on the workflow (SC2086). The `secret-scan` stage failed on
the repository's own commits: its documentation quoted the Stripe placeholder literally, which gave
three findings. The `frontend` stage ran `jest` without `--coverage`, so it never evaluated the
frontend gate.

**Decision**

- **CI is `.github/workflows/ci.yml`, and every job in it is a required gate.** The jobs are
  secret scan, workflow lint, the backend ESLint ratchet, backend unit tests with the 100% coverage
  gate, the frontend (lint, typecheck, test with coverage, build), `npm audit`, a boot-and-migrate
  run on PostgreSQL 18, and deploy config (helm plus kubeconform, the chart's refusal guards,
  `docker compose config` and the S-19 port check).
  - No job is `continue-on-error`.
  - A gate that cannot pass today is replaced by a gate that can fail honestly, not softened. The
    backend lint ratchet is the example.
  - Actions are pinned by commit SHA. The CLI tools are pinned by version and sha256. Node is
    24.21.0.
  - The `pre-push` hook is opt-in (`make hooks`). CI is the gate.
- **Secret-scan allowlisting has two forms, and a new entry is a review item.** A narrow value regex
  covers the template placeholders (`CHANGE_ME…`). Anything else is a fingerprint in
  `.gitleaksignore` with a comment. Nothing is allowlisted by source directory.
- **A scheduled job's outcome is monitored, not just its start (P7-02).**
  - Every scheduler runs through `jobMonitor.runMonitored`. A partial failure counts as a failure.
  - Each job's state is persisted to `JOB_STATUS_DIR`.
  - The alert of record is a structured `error` log line with an `alert.key`. It is also pushed to
    `ALERT_WEBHOOK_URL` or `ALERT_EMAIL_TO` when either is set.
  - An alert fires on the first failure, then at most every `JOB_ALERT_REPEAT_HOURS`, and once more
    on recovery.
  - A watchdog alerts on missed runs and on batch jobs stuck in `PROCESSING`.
  - Metrics are served on `/api/v1/health/metrics`, bearer-gated and off until `METRICS_TOKEN` is
    set.
- **Log shipping is a template, not a deployment (P7-03).** `deploy/observability/vector.toml`
  reads container stdout, re-redacts and ships to Loki. It is an optional overlay.
- **Swagger is off in production unless `SWAGGER_ENABLED=true`, rather than behind a session
  (S-23).** The UI is fetched by a browser navigation that carries no bearer token. A spec gated by
  a cookie the API does not issue would be a gate in name only.
- **The API origin's CSP has no `'unsafe-inline'` for scripts. `/docs` has its own policy
  (P7-08).** Swagger UI loads its scripts as files. Only style stays inline.
- **Quarantine is `uploads/.quarantine`, inside the uploads mount (S-17).** A quarantine on another
  filesystem would make the promoting `rename` fail with `EXDEV`. The static mount ignores
  dotfiles, and the hourly sweep removes leftovers.
- **Helm: the Secret switch is `global.secrets.external`.** The old `secrets.external` key refuses
  to render. The URLs in the ConfigMap must be credential-free, and guard 9 refuses a URL with
  `user:password@`. `REDIS_PASSWORD` and a credentialed `RABBITMQ_URL` go in the Secret.
- **Compose: deployment credentials have one source (S-09).**
  - `REDIS_PASSWORD` is read by both Redis (`--requirepass`) and the backend (AUTH). `REDIS_URL`
    stays credential-free.
  - The backend's `RABBITMQ_URL` is built in `docker-compose.yml` from the same
    `RABBITMQ_USER`/`RABBITMQ_PASS` that create the broker's user. `environment` overrides
    `env_file`, so a stale URL in `.env` can no longer disagree with the broker.
- **Compose and Helm set `DB_APP_ROLE` (P6-03, deployment half).** Compose defaults it to
  `callibrator_app` in the file itself, because a `.env` made before 2026-09-25 has no such line.
  The chart sets it through `backend.database.appRole`. `none` opts out explicitly.
- **Hardening (S-19) is `no-new-privileges` and `cap_drop: [ALL]` on every service.** A service
  adds back only the capabilities its entrypoint needs. Redis and nginx get a read-only root. CPU
  limits sit beside the memory limits. The dev overlay binds nothing but nginx on 0.0.0.0. Base
  images are pinned by digest (P7-07).

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Softening a red stage (`continue-on-error`) until it is fixed | the abuse case P7-01 names. A ratchet or a narrower gate that can fail is honest |
| Plain `eslint` as the backend lint gate | ~950 errors today (A-34). The gate would be red on day one and then switched off |
| A forced hook on every clone (husky) | the first thing people learn to `--no-verify`. CI is the gate |
| Allowlisting the docs directories in gitleaks | "allowlisted into uselessness". A fingerprint silences one finding in one commit |
| Alerting through a metrics stack only | no metrics stack exists. The log line and the webhook work with nothing else deployed |
| Swagger behind a super-admin session | no session cookie exists for a navigation. See the decision |
| Keeping `RABBITMQ_URL` in `.env` and checking agreement with `make check-env` | was the batch-2 fix. It only works when the operator runs `make`, and it does not protect a `.env` edited later |
| `read_only` on the backend and frontend | pkg extracts native addons and Chromium writes at runtime, and neither is mapped yet. A read-only root that breaks certificate PDFs on first use is worse |

**Implications, including the bad ones**

- **The workflow has never run on GitHub.** What was run on 2026-09-25, on Windows with Docker:
  - `actionlint` 1.7.12, clean after the SC2086 fix;
  - `gitleaks` 8.30.1 over all 41 commits, clean after three fingerprints;
  - the helm and kubeconform steps, verbatim, with helm **v4.3.0** where CI pins v3.19.0;
  - the compose step and the S-19 check, in both directions;
  - the backend lint ratchet at 950 = baseline;
  - frontend eslint (0 errors), `tsc` and the coverage gate;
  - the tool checksums and the action SHAs, checked against the tags.

  **The `boot-and-migrate`, `backend-test`, `npm audit` and `next build` jobs were not run in their
  CI form.**
- **The ratchet and `backend-test` are sensitive to concurrent work.** Another change that adds a
  lint error or drops coverage turns them red. That is their purpose, and it makes a parallel batch
  noisy.
- **The Helm charts render. They are not known to deploy.** P7-06 is still open.
- **With compose, `RABBITMQ_PASS` must be URL-safe.** It is placed in the URL verbatim. `make
  secrets` prints hex.
- **`DB_APP_ROLE` on by default requires `CREATEROLE`.** A managed PostgreSQL whose owner lacks
  it fails migration 0057 at boot until an administrator creates the role, and the error says how.
  Under compose the owner is a superuser.
- **Alert routing is configuration.** Until `ALERT_WEBHOOK_URL`, `ALERT_EMAIL_TO` or a log pipeline
  is set up, an alert is a log line. In Kubernetes the job status files live on an `emptyDir`.
- **Vector is validated (`vector validate`) but has never shipped a line.**
- **The content origin still sends no CSP.** The frontend half of P7-08 is open.

**Status:** Accepted. Implemented 2026-09-24 (batch 6) and verified or corrected 2026-09-25. The
evidence is in `MEMORY/records/2026-09-25-phase0-batch6.md` § Follow-up: infra.

---

## ADR-067: The Frontend Coverage Gate Is the Measured Figure, Ratcheted to 70%, and It Runs

**Date:** 2026-09-25 · **Findings:** F-03, F-04, F-05, F-07, F-08, F-10, F-12, F-15, F-17 · **Replaces the marker:** `ADR-PENDING-fe`

**Context.** `frontend/jest.config.js` declared a 70% threshold that nothing evaluated. `npm test`
ran plain `jest`, the real figure was 28%, and the CI draft ran `jest --ci` without coverage too. The
"fe" agent of batch 6 was halted before reporting. Its work was committed unverified.

**Decision**

- **`npm test` is `jest --coverage`, and CI runs `jest --ci --coverage`.** Only `--coverage`
  evaluates `coverageThreshold`.
- **The threshold is what the suite measures, and it only ratchets up.** It stands at 41 / 35 / 34 /
  41 (statements / branches / functions / lines).
  - It moves toward 70 in the steps listed in `docs/FRONTEND/10-TESTING.md` § Coverage gate.
  - It rises in the same change that earns it.
  - It is never lowered, and never reached by excluding product code. `collectCoverageFrom`
    excludes only `*.d.ts`, the root layout and page, and `src/tests/**` helpers.
- **The service tests are named for what they are.** The `*.service.test.ts` files mock the client.
  They prove what the frontend believes about the API, not the API. Real-code layers sit above them:
  - the client interceptors, run through a fake adapter;
  - the Next route handlers;
  - `proxy.ts`;
  - store contracts;
  - screen hooks.
- **`axe-core` runs in the jsdom component suite.** Colour contrast and page-level rules are off
  there and belong to the browser suite.
- **Async queries wait up to 5 s (`jest.setup.ts`).** Under coverage instrumentation the full-page
  suites (`page.a156`, DataRetention A-135) failed intermittently: 4 failures in 1 of 3 runs. The
  ceiling changes only how long a failing test waits, not what any assertion accepts.
- **Behaviour chosen in this batch:**
  - a missing `roleId` yields an empty menu with a retry, never the static tree (F-15);
  - a 403 from `/search` removes the search box (F-10);
  - one `proxy.ts` (F-08);
  - route error boundaries (F-07);
  - the two unused animation dependencies are removed (F-17).

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Keep 70% and fix the gate later | a number nothing checks is the failure F-03 records |
| 70% now, with `continue-on-error` in CI | softening a gate. See ADR-066 |
| Exclude untested pages from coverage | reaches the number by redefining it |
| `retry` on flaky suites | hides a real hang as well as a slow render. A longer wait still fails a test that never renders |

**Implications, including the bad ones**

- **41% is not 70%.** Most pages still have no test above the service layer, and branch coverage
  trails.
- **A frontend change that lowers coverage by one point fails the gate.** That is intended.
- **The manual checks the F-cards ask for have not been done.** These are the screen-reader walk,
  one screen per status code, and the `JWT_ACCESS_EXPIRED=60s` run. No browser has exercised this
  work, so those cards stay partial.
- **The 5 s async ceiling makes a genuinely failing `findBy*` slower to report.**

**Status:** Accepted. Implemented 2026-09-24 (batch 6), verified 2026-09-25. The measured figures
are in `MEMORY/records/2026-09-25-phase0-batch6.md` § Follow-up: fe.

**Amendment 1 (2026-09-30): the gate is 90 / 81 / 86 / 91, and the 70% target is passed.**

- **Measured.** A coverage batch took the suite from 43.68 / 38.30 / 37.13 / 43.94 (157 suites,
  1,408 tests) to **90.91 / 81.62 / 86.94 / 91.61** (264 suites, 2,758 tests), statements / branches /
  functions / lines. The record is `MEMORY/records/2026-09-30-frontend-coverage-70.md`.
- **What earned it.** Behaviour tests of pages and screen hooks, each with axe. List screens have
  loading / empty / failed tests. Page tests mock only `@/api/client`, with fixtures shaped as the
  controllers answer, so the real service unwrap runs. No product code was excluded.
- **The gate is each measured figure rounded down**: 90 / 81 / 86 / 91 in `jest.config.js`. Until now it sat a point under; there is now no slack beyond the rounding.
- **`testTimeout: 30000`.** Full-page suites with several awaited steps overran Jest's 5 s default in
  the parallel full run while passing alone. As with the 5 s `findBy*` ceiling, this changes only how
  long a failing test takes to report.
- **Bad implications.**
  - The margin is under one point, and it covers new product code as well as regressions. A large
    untested page added elsewhere (Phase 10's public forms are at 0%) can turn the gate red for a
    change that did not cause it.
  - The page tests still mock the network. A route check against the real router dump found every
    one of the 387 service calls names a real method and path. That check cannot catch a wrong
    response shape: six of this batch's defects were exactly that (F-19).

---

## ADR-068: A Sensitive Self-Service Change Re-Authenticates; an Administrator's Password Expires in 72 Hours; a Federated Session's Password Is the Identity Provider's; No Runtime Helper Resets the Schema

**Date:** 2026-09-25 · **Findings:** A-211, A-213, A-214, A-215, A-216, A-259 · **Extends:** ADR-051 (Q-11, A-98), ADR-059 (7), ADR-062 · **Migration:** `0078-user-temporary-password-expiry`

**Context**

Six follow-ups from batch 6. The password step of a sign-in stamped `last_login_at` before the MFA
step had passed (A-211). Removing a passkey needed nothing but the session, and wrote no audit row
(A-213). A self-service email change also needed nothing but the session. A stolen session could
move the address, reset the password through it, and take the account (A-214). The password an
administrator chose at creation or by a reset signed in until its holder changed it, with no time
limit (A-215; ADR-059 listed this as open). A user provisioned just-in-time by SSO has a random local
password that nobody knows. Change Password could only tell them it was wrong, and ADR-051's "SSO
users are pointed to their identity provider" was not built (A-216). Since P6-03 the backend runs as
the application role. `unseedDemoData` then stopped part-way, and `syncTables` could not work at all
(A-259; ADR-062 listed both as implications).

**Decision**

1. **`last_login_at` is written when a session is issued, in the session's transaction** (A-211).
   This is `auth.service#openLoginSession`, used for password-only sign-in and for the MFA step. A
   sign-in whose LOGIN audit row fails leaves no stamp. SSO already worked this way (A-188).
   Impersonation does not stamp it, because the holder did not sign in.
2. **Removing a passkey and changing one's own email need fresh re-authentication, by the A-114
   rule** (A-213, A-214). The rule is `auth.service#reauthenticate`:
   - the current password is required;
   - on an MFA account, a current TOTP code or a recovery code is required as well;
   - the code is spent inside the change's own transaction, so a rolled-back change does not burn it;
   - a missing proof is a 400 that names what is needed;
   - a wrong password and a wrong code give one combined 400.

   Each change is audited in its transaction: `WEBAUTHN_DISABLE`, and `GDPR_RECTIFICATION` for
   email. Both rows carry `reauthenticatedWith`. The other rectifiable fields (names, phone) need no
   re-authentication. An administrator changing *another* user acts through the user routes, whose
   gates and audit are unchanged.
3. **A temporary password expires 72 hours after it is issued** (A-215).
   - Column `users.temporary_password_expires_at`, added by migration `0078`. It is set by
     `userCreate` and `resetUserPassword`.
   - It is cleared by the holder's own change and by the email-code reset.
   - An expired temporary password at sign-in gets the same 401 "Invalid credentials" as a wrong
     password, and the throttle counts it the same way. It is not an oracle.
   - A session opened before the expiry cannot use the expired password to change it. The holder,
     who has just proved the password, gets a 409 that says it expired.
   - Migration `0078` starts the clock at the upgrade for every account that was already flagged
     `must_change_password`.
4. **A session that signed in through SSO does not change a local password or email here** (A-216,
   and A-214 for email). The check is the access token's `amr` of `saml` or `oidc` (A-160):
   - `POST /auth/just-update-password` answers 409, naming the protocol and the identity provider.
     The provider name is the host of `oidc_authority`, the SAML entity id, or the host of the SAML
     entry point.
   - `/auth/verify` returns `passwordManagedBy`, and the change-password page shows the explanation
     instead of the form.
   - An account under the A-123 forced change is exempt. An administrator gave it a temporary
     password, which the holder knows and must replace.
5. **No runtime helper drops or recreates the schema** (A-259).
   - `migration.service#syncTables` (a forced `db.sync`) and `resetAndSeed`, its only caller, are
     removed. The application role cannot drop a table, and no route, script or boot path called
     either one.
   - Recreating the schema is an owner operation, done outside the application: `make migrate` on an
     empty database.
   - `unseedDemoData` runs in one transaction. It counts the demo devices' calibration records
     first. If any exist, it refuses before deleting anything and says why: the records are
     append-only (ADR-062), and a device that has records cannot be deleted.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Stamp `last_login_at` at the password step and again at the MFA step | the first stamp is the defect: a correct password is not a sign-in |
| Re-authenticate a passkey removal with a passkey assertion | an SSO-only user could then remove a passkey, but it needs a second ceremony flow on the page. Recorded as a possible follow-up. The password rule matches A-114 and A-141 |
| Require re-authentication for every GDPR rectification | a name or phone number does not give control of the account. The email does, because the reset goes to it |
| Send a confirmation link to the *old* address instead of asking for the password | a stolen session often comes with the mailbox, and on-premises deployments may have no mail (ADR-059 7). The old address is still told about the change (A-180) |
| TTL of 24 hours | a temporary password issued on a Friday dies before Monday. Hospital shifts and weekends make that the usual case |
| TTL of 7 days (the session lifetime) or 14 days | a credential handed over on paper stays usable for a week or more. That is most of the risk the card names |
| Make the TTL a setting | nobody has asked for one. A constant (`TEMPORARY_PASSWORD_TTL_MS`) is one line to change, and the migration names the same 72 |
| Leave passwords issued before `0078` without expiry | keeps the defect for exactly the accounts that already exist |
| Backfill passwords issued before `0078` as already expired | would lock out, without warning, every account an administrator created that has not signed in yet |
| A 401 "expired" at sign-in | tells anyone who has the old temporary password that the account exists and what state it is in |
| Mark JIT-provisioned accounts with a column (`sso_provisioned`) | accounts that already exist cannot be told apart without guessing from the audit trail. The session's `amr` is exact for every JIT account, because such an account can only ever hold an SSO session |
| Keep `syncTables` and make it refuse clearly | it would be a helper whose only honest behaviour is to refuse, kept next to seeding code that someone will one day call. ADR-051 Q-10 removed the second purge engine for the same reason |
| Make unseed void the demo records and delete the rest | the devices would have to stay (the records reference them), so the result is still partial, only in a different way. A void is also final (ADR-062), so demo "cleanup" would write permanent Part 11 voids |

**Implications, including the bad ones**

- **A user with a password who signs in through SSO is told to use the IdP** while in that session,
  even though they could change their local password after signing in with it. That is the price of
  keying the rule on the session rather than on the account.
- **An SSO-only user cannot remove a passkey or change their email through self-service**: they
  have no password to re-authenticate with. The email belongs to the IdP, because SSO matches
  accounts by it. An administrator can remove a passkey today only by database access. There is no
  admin passkey reset, and that is an open follow-up. Closed by ADR-072 (A-262, 2026-09-25):
  `DELETE /users/:userId/webauthn`.
- **The re-authentication endpoints are a password oracle for whoever holds the session.** This is
  not new: `POST /auth/pass-is-valid` and the change-password route already are one. None of them has
  a per-user limit except the MFA management bucket (A-142). This is recorded as open. Closed by
  ADR-072 (A-260, 2026-09-25).
- **Demo data, once seeded, can never be unseeded**, because seeding creates calibration records.
  This is the ADR-062 guarantee, and `unseedDemoData` now says so instead of half-deleting. It has no
  caller today.
- **`dropSeededTables` now has no caller.** It deletes every user and tenant without a transaction,
  and it was left in place because A-259 did not name it. Recorded as open. Removed by ADR-072
  (A-261, 2026-09-25).
- **An expired temporary password strands a signed-in holder on the change-password screen**
  (every other route is 403 under A-123) until an administrator resets it again. The page shows why.
- **The 72 hours start at issue, not at delivery.** An administrator who issues a password and
  hands it over three days later hands over a dead one.

**Verified.** PostgreSQL 18.6 (`pgvector/pgvector:pg18`), in a throwaway container:

- A real `node index.js` boot on an empty database applied 58 migrations, ending with `0078`. The
  schema verifier reported OK (72 tables, 864 columns) and the role switched to `callibrator_app`.
- An upgrade boot, after dropping the column, deleting the `0078` row and adding a flagged legacy
  account, applied only `0078`. It gave that account an expiry 72 hours from the upgrade, and the
  verifier passed.
- A third boot applied nothing.
- `authCards.a215.live.test.js` (8 tests) proves fresh, upgrade, re-run, down, up, the model
  mapping, the trigger refusing the record delete, `unseedDemoData` refusing with nothing deleted,
  and `callibrator_app` unable to drop a table.
- At `HEAD`, the old `unseedDemoData` deleted the demo category and then failed on the calibration
  record. The category was gone, and the device and record remained.

**Status:** Accepted, implemented 2026-09-25.

---

## ADR-069: Every Background Job Runs in a Declared Context from a Closed List, Audits What It Changes, and Reads in Bounded Pages; Audit Rows Have No Retention Window

**Date:** 2026-09-25 · **Findings:** W-04, W-12, W-17, and two found while doing them: W-32, W-33 (`TASKS/AUDIT-2026-09-ASYNC.md`) · **Extends:** ADR-060 (the job helpers), ADR-061 (the calibration scan's audit), ADR-051 (Q-12, Q-13)

**Context**

ADR-060 created `runForTenant` and `runAsSystem`. By its own account W-12 stayed partial: the
retention purge, session cleanup, the quarantine sweep, the webhook dispatcher and MQTT ingest used
neither helper. `runAsSystem` took any non-empty string, so "every opt-out is named" was a
convention, not a control. W-04 still had three unaudited background mutations: IoT ingest, the
calibration scan's tenant-wide notification, and batch-job state changes. It also carried an
unanswered question about a "365-day audit-log window". W-17 had bounded only the calibration scan.

Doing this work surfaced two live defects. Both were hidden because background jobs ran with no
tenant context:

- **W-33.** `Model.destroy` maps attribute names to column names *before* it runs
  `beforeBulkDestroy` (`sequelize/lib/model.js`: `Utils.mapOptionFieldNames`, then the hook), and
  nothing maps them again. The isolation hook added `tenantId`, which reached the `DELETE` as written.
  So every bulk destroy of an underscored model inside a tenant context failed on PostgreSQL with
  `column "tenantId" does not exist`. The first live run of the tenant-scoped retention purge failed
  this way for every tenant.
- **W-32.** IoT ingest wrote its anomaly alert with `type: "system"`. The notifications ENUM is
  `SYSTEM, CALIBRATION, INVENTORY, MAINTENANCE`, and PostgreSQL refused the insert. No anomaly alert
  had ever been stored, and the unit tests asserted the wrong value.

**Decision**

1. **The cross-tenant opt-outs are a closed list.** `SYSTEM_TASKS` in `utils/jobContext.util.js`
   has six entries: the batch-job sweep and shutdown, the calibration scan's due-device read,
   session cleanup, the quarantine sweep, and the webhook claim. `runAsSystem` refuses any other
   reason. `jobContext.w12.test.js` scans `src/` and fails when:
   - `isSystemTask: true` appears outside `jobContext.util.js`;
   - a `runAsSystem(...)` call passes a literal instead of a `SYSTEM_TASKS` entry.

   This mirrors `SYSTEM_ACTORS`. Adding an opt-out is a reviewed edit to one file.
2. **The context of each job:**

   | Job | Context |
   |---|---|
   | Retention purge | `runForTenant(tenant)` for each tenant's purge. The tenant list reads `tenants`, which is not tenant-scoped |
   | Session cleanup | `SYSTEM_TASKS.SESSION_CLEANUP`. Expiry does not depend on the tenant, and an operator's session has no tenant (`sessions.tenant_id` is nullable), so a per-tenant loop would miss it. Not audited: Q-13 |
   | Quarantine sweep | `SYSTEM_TASKS.QUARANTINE_SWEEP`. It covers one shared directory and reads no table |
   | Webhook dispatcher | The raw claim runs under `SYSTEM_TASKS.WEBHOOK_DISPATCH`. Each claimed delivery runs under `runForTenant(its tenant)` |
   | MQTT and HTTP IoT ingest | `runForTenant(tenant)`, inside `ingestReading`. A topic naming another tenant's device finds nothing |
   | Tenant lifecycle, scheduled backup | These already had a per-tenant context. They now go through `runForTenant` too, so every job declares its context the same way |
3. **The bulk-destroy predicate names the column (W-33).** `applyTenantWhere(..., { byField: true })`
   runs only in the `beforeBulkDestroy` hook. It uses the attribute's `field`. Finds and bulk updates
   map names after their hooks, so they still use the attribute name.
4. **What background work audits (W-04).** Each audit row is written inside its mutation's
   transaction:
   - **IoT ingest:** only an anomaly. The reading, the tenant-wide alert and one audit row naming
     `system:iot-ingest` form one transaction. An ordinary reading writes no audit row. Q-13 keeps
     individual readings out of the audit trail, and the reading row is the record.
   - **The calibration scan's notification:** the notification and its audit row (the job, or the
     user on a manual run) form their own transaction, after the work order's. The notification is
     announced only after that transaction commits. It stays best-effort: a failed notification is
     logged and not counted, and it does not roll back the work order. `emitNotification(data,
     { transaction })` is the transactional form. It re-throws, and it delivers after the commit.
   - **Batch jobs:** every state change is audited as `system:batch-job`, with the queuing user in
     `changes.requestedBy`. The changes are PENDING→PROCESSING, PROCESSING→COMPLETED and
     PROCESSING→FAILED, including the sweep and shutdown. A failure updates only a row that is
     still `PROCESSING`, so a job the sweep already failed is not failed or audited twice. The
     sweeps use `UPDATE … RETURNING` and audit each returned row in its own tenant.
5. **Audit rows have no retention window.** The card asked what "the 365-day audit-log window" means
   against the compliance claim. It could mean three things:
   - **A deletion window:** delete rows older than 365 days. That was the pre-A-121 behaviour, and
     Q-12 forbids it.
   - **A minimum retention period:** keep rows at least N days. Part 11 §11.10(e) requires the audit
     trail to be kept at least as long as the records it describes. A calibration record is kept
     indefinitely (append-only, ADR-062), so any finite N understates the requirement.
   - **A hot-storage window:** rows older than N days move to cheaper storage and remain
     retrievable.

   **Decided:** the retention period of an audit row is *indefinite*. No job deletes one, and there
   is no setting for it: `setRetentionPolicy` refuses `audit_logs`, and no `AUDIT_LOG_RETENTION_DAYS`
   exists. "Window" may only ever mean the third reading. An archival process may later move old
   rows out of the hot table only if all of these hold:
   - the rows stay retrievable by the audit API with the same filters;
   - their integrity is verifiable;
   - the move itself writes an audit row.

   That process does not exist. Until it does, there is no window. `docs/DATABASE/10-AUDIT-LOGS.md`
   says so.
6. **Bounded scheduled work (W-17).** Each job has a batch or page size, and a time budget where it
   loops:

   | Job | Bound | Setting (default) |
   |---|---|---|
   | Retention sweep | tenants in keyset pages of ids | `RETENTION_SWEEP_TENANT_PAGE_SIZE` (100) |
   | Retention purge | each pass deletes at most N rows per table (`DELETE … WHERE id IN (SELECT id … LIMIT n)`), one transaction and one audit row per pass. A table that filled its batch gets another pass | `RETENTION_PURGE_BATCH_SIZE` (5000) |
   | Retention sweep | every tenant gets at least one pass per run. Catch-up passes stop once the budget is spent, and the tenant is counted in `incomplete` | `RETENTION_SWEEP_BUDGET_MS` (15 min) |
   | Session cleanup | bounded DELETE batches, stopping on a short batch or when the budget is spent | `SESSION_CLEANUP_BATCH_SIZE` (1000), `SESSION_CLEANUP_BUDGET_MS` (60 s) |
   | Quarantine sweep | the directory is streamed (`opendir`), and a run examines at most N entries (`truncated: true`) | `QUARANTINE_SWEEP_MAX_ENTRIES` (5000) |
   | Tenant lifecycle | ids in keyset pages | `TENANT_LIFECYCLE_PAGE_SIZE` (50) |
   | Scheduled backup | tenants in keyset pages; the prune walks `(tenant ASC, created_at DESC, id DESC)` pages and carries the tenant's rank across page boundaries | `BACKUP_PRUNE_PAGE_SIZE` (500) |
   | Webhook dispatcher | already `LIMIT`ed, so a pass has at most N POSTs in flight | `WEBHOOK_DISPATCH_BATCH` (50) |

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Keep `runAsSystem` open and review call sites by grep | this is the state ADR-060 left. A grep nobody runs is not a control, and the test now fails on the first unreviewed opt-out |
| Retention per tenant as `runAsSystem` with the existing explicit predicates | this is what W-12 described. Isolation would still rest on each author's `where` |
| Session cleanup per tenant | it would miss every platform operator's session (NULL tenant). It would also add one query per tenant to delete rows whose deletion rule has no tenant in it |
| Fix W-33 by mapping every hook's key to the field name | finds and bulk updates map after their hooks. Giving them the column name would double-map it or break it. Only the destroy path runs its hook after the mapping |
| Audit every IoT reading | Q-13 decided against it. Readings arrive continuously, and the reading row is the record. The consequential act is the tenant-wide alert |
| Create the scan's notification inside the work order's transaction | `createWorkOrder` owns its transaction in `maintenance.service`. A failed notification would roll back the work order, which is the part that matters |
| Audit only the batch-job terminal states | a job that is claimed and never finishes would have no record that it ever started. That is the W-07 case |
| One purge transaction per tenant, however large (the W-16 shape) | a tenant with a million expired rows would hold one transaction and its locks for the whole delete |
| A finite audit retention period (e.g. 7 years) | no current obligation names one, and every record the trail describes is kept indefinitely. A finite period would be the first deletion path back into the audit trail |

**Implications, including the bad ones**

- **More audit rows:**
  - about three per batch job;
  - one per retention pass;
  - one per calibration reminder;
  - one per anomalous IoT reading.

  A flapping sensor writes one audit row per out-of-tolerance reading, with no rate limit.
- **`runAsSystem` with an unlisted reason throws.** A new cross-tenant job fails at runtime until
  its entry is added to `SYSTEM_TASKS`. That is intended.
- **W-33 changes a path that was failing.** Every bulk destroy of an underscored tenant model inside
  a request's tenant context used to throw on PostgreSQL. It now runs. `src/` has about 69
  `.destroy({` call sites, instance destroys included, and **they were not reviewed one by one**.
  - A request route that answered 500 because of this now performs its delete.
  - Which routes were affected in production is not known. They are listed as open on W-33.
- **A backlog is purged over several nights.** A tenant left `incomplete` is logged. It is not an
  alert: `retentionScheduler`'s `isFailure` still looks only at `errors`.
- **A truncated quarantine sweep leaves files for the next hourly run**, and it is not flagged as a
  failure either.
- **Still open in W-17** *(all three closed by ADR-073)*:
  - the per-event first webhook attempt from `emitEvent` is not capped (only the dispatcher is);
  - `offboardTenant` still builds an export it throws away (`tenantLifecycle.service`, being edited
    under D-23);
  - the calibration scan still uses one transaction per due device.
- **Evidence is PostgreSQL only.** `backgroundJobs.w12.live.test.js` ran on 18.6. Nothing here was
  run against a deployed stack.

**Status:** Accepted, implemented 2026-09-25. The tests are named in the ASYNC board rows for W-04,
W-12, W-17, W-32 and W-33.

---

## ADR-070: A Parent's Soft Delete Takes Its Attachments With It; Unbounded Reads Are Paged; Every JSON Column Declares Its Shape and the Audit Trail Keeps No Secret; Finished Webhook Deliveries Are Purged After 30 Days

**Date:** 2026-09-25 · **Findings:** D-22, D-24, D-27 (`TASKS/AUDIT-2026-09-DATA.md`), ADR-064 decision 4's open `webhook_deliveries` purge · **Extends:** ADR-064 (items 4, 8, 9, 10), ADR-054, ADR-060, ADR-051 Q-13 · **Migrations:** none (`0080` was reserved and is not used)

**Context**

ADR-064 left four data-layer items open. A parent's soft delete left its attachments live, and nothing
could find attachments whose parent was already gone (D-22). Three reads grew with the tenant: the
Article 15 export, the SOP training fan-out, and the signature history (D-24). The JSON columns had no
declared shape, and nothing kept a secret out of `audit_logs.changes` (D-27). `webhook_deliveries` had
no purge.

**Decision**

1. **A parent's soft delete soft-deletes its attachments (D-22).** It happens in the parent's
   transaction and writes one `DELETE` audit row per attachment. The audit row names the parent in
   `changes.cascade` and carries `operation: "cascade-soft-delete"`. This is
   `attachment.service#softDeleteForResource`. It is wired into the four delete paths that exist:
   certificate, calibration device, maintenance work order and kanban card. The kanban card delete had
   no transaction and now has one. The attachment's type matches without regard to case and under
   every spelling that links to the model. The tenant predicate is explicit.
   - **The file is kept.** No gated path serves a soft-deleted row, so the kept bytes cannot be
     reached. A future restore of the parent can restore exactly the rows whose audit row names it.
   - **Voiding a calibration record is not a delete.** A voided record is retained evidence (P6-03),
     and so are its files. Nothing cascades on a void.
2. **There is an orphan report (D-22).** `GET /api/v1/attachments/orphans` requires `auth`,
   `rbac(TENANT_ADMIN)` and `equipment: read`.
   - It lists the caller's tenant's live attachments whose `(resource_type, resource_id)` resolves to
     no live record, with a reason for each: `parent_missing_or_deleted` or `unlinkable_type`.
   - A parent counts only if it belongs to the **same** tenant.
   - The query is raw SQL (a polymorphic anti-join), built only from constant maps, with an explicit
     tenant predicate.
   - The report is read-only. An administrator acts on an orphan through the ordinary audited routes.
   - It has no `:id`.
3. **Unbounded reads become pages (D-24).**
   - **The DSAR export streams, and it is complete.** Each table is read in keyset pages of 500 by id.
     Each page is written through `fs.promises.writeFile(asyncIterable)` before the next is read. The
     export used to hold everything in memory, and it **silently truncated** at 1,000 rows per table
     and 5,000 audit rows. A read that fails partway through still fails the export (A-151). Rows are
     now in id order, not newest first.
   - **The SOP training fan-out is batched.** It reads 500 user ids at a time by keyset and runs one
     `bulkCreate` per page. All of it runs inside the publish's transaction, so a release is still all
     or nothing.
   - **`GET /esignature/history` is paginated** (`page`, `limit`, default 25, maximum 200). Rows are in
     `data`, and `meta { total, page, limit, totalPages }` is at the top level. The order is
     `signedAt DESC, id ASC`, so no row appears on two pages. The frontend
     `eSignatureService.getSignatureHistory` now returns a `PaginatedResponse`. No screen calls it.
4. **Every JSON column declares its shape (D-27).** `utils/jsonShape.util.js` holds one Joi schema for
   each of the 14 JSON/JSONB attributes, and each attribute validates with
   `validate.shape = jsonShape("<Model>.<attr>")`.
   - Where a boundary validator exists, the schema reuses it (`readingToleranceSchema`) or mirrors it
     (the scopes, webhook event names and notification channels).
   - No schema is stricter than today's writers. `calibration_records.results` still accepts the `""`
     that its create schema allows.
   - A discovery test fails when a JSON attribute is added without a shape.
5. **`audit_logs.changes` keeps no secret (D-27).** `audit.service#logAction` stores a redacted copy
   (`utils/auditRedaction.util.js`), and a warning names the fields.
   - The deny-list matches key names by their **ending**, optionally followed by `hash`: `password`,
     `secret`, `token`, `apikey`, `privatekey`, `accesskey`, `secretkey`, `otp`, `recoverycodes`, and
     the others in the util. So `smtp_password` and `tokenHash` are redacted, while
     `passwordChangedAt`, `tokenExpiresAt` and `secretRotated` are kept.
   - Boolean and empty values are kept.
   - Bearer and JWT strings are masked wherever they appear.
   - An entry that carries a secret is **redacted, not refused**. Refusing it would roll back the
     mutation.
6. **Finished webhook deliveries are purged (ADR-064 #4).** This is
   `services/webhookDeliveryPurge.service.js`.
   - **What it deletes:** only `success` and `exhausted` rows whose `updated_at` is older than
     `WEBHOOK_DELIVERY_RETENTION_DAYS` (default **30**, floor 7). The DELETE re-checks the status, so a
     `pending` or `failed` row is never removed, however old it is.
   - **How it runs:** tenant by tenant under `runForTenant`. Each batch of 1,000 is its own
     transaction. A run stops at 50,000 rows and says so.
   - **What it records:** one audit row per batch, in that batch's transaction. The actor is
     `system:webhook-delivery-purge`, a new `SYSTEM_ACTORS` entry. The row records the count, the
     counts by status, the cutoff and the window.
   - **When it runs:** daily at 03:43 (`WEBHOOK_DELIVERY_PURGE_SCHEDULER`), through `scheduleSetting`,
     so `SCHEDULERS_ENABLED=false` stops it along with every other singleton. It is registered with the
     job monitor, in the chart's API-pod branch and in both `.env.example` files.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| D-22 **keep**: leave the attachments live and filter them at read time by the parent's state | every read path (list, get, download, signed link, quota) would need a polymorphic join, and a path that missed it would serve evidence of a deleted record |
| D-22 **hide**: a read-time join only, with no write | the same problem, and storage accounting would still count the files |
| D-22: unlink the file too, as an explicit delete does | deleting a draft certificate is not a decision to destroy evidence bytes, and it would make a restore impossible |
| D-22: a `deleted_with_parent` marker column (migration 0080) | no code path restores a parent today. The audit row already identifies the cascaded rows exactly, so a column would be a schema change with no reader |
| D-22: cascade on a calibration record's void | a voided record is retained evidence (P6-03), and its files are part of it |
| D-24: `INSERT … SELECT` for the SOP fan-out | it is set-based and faster, but it is raw SQL (a review item that bypasses the hooks) and it skips the model defaults. Keyset batches bound the statement just as well |
| D-24: a background job that builds the DSAR export | it adds a queue and a status model. Streaming bounds the memory, which is where the export failed |
| D-24: a cursor for the signature history | every other list route uses `page`/`limit`, and the frontend's `PaginatedResponse` expects it |
| D-27: refuse an audit entry that carries a secret | `logAction` re-throws inside a transaction, so each such call site would become a failed mutation in production |
| D-27: reuse A-228's log redactor | it masks every email address and every `*link` key, and an audit row must record exactly which address a change set |
| D-27: TypeScript types only (Phase 9) | types are not checked at run time, on writes from JavaScript, or on JSON the client sends |
| Purge through the retention engine (`dataRetention.service`) as a per-tenant entity | retention there is opt-in per tenant (platform default 0, keep), so nothing would be purged without a tenant policy. A delivery row is the platform's queue state, not a tenant's record |
| Keep deliveries forever, or partition the table | keeping them forever is the unbounded growth this item is about. Partitioning is the open "partition `audit_logs`/`iot_readings`" row, and a table kept bounded does not need it |
| Separate windows for delivered and dead-lettered rows | there is no redelivery route, so a dead letter is informational only. One window is simpler to operate |
| Purge across tenants in one statement under `runAsSystem` | it needs a new `SYSTEM_TASKS` opt-out, and it could not write the audit row in each tenant's own trail |

**Implications, including the bad ones**

- **A cascaded attachment's file stays on disk.** It cannot be reached, but it uses storage and
  nothing sweeps it. The quota counts only live rows, so the tenant is not charged for it.
- **Deleting a kanban project does not cascade.** The project is paranoid and its cards are not
  destroyed, so the cards' attachments stay live. The orphan report does not list them, because the
  cards are still live.
- **Rows written outside a model create or update are not validated.** The shape is checked when a
  model create or update writes the column. It is not checked for `bulkCreate` without
  `validate: true`, for raw SQL, or for rows written before this change. A `readingTolerance` written
  before A-46 that violates its schema now fails on its next save.
- **The redaction deny-list is a list.** A secret stored under a key it does not match (for example
  `pin`) is still written. The fixtures test real shapes, not the list itself.
- **The DSAR export now comes out in id order**, not newest first. It can be very large, but it is
  complete, which the old export was not.
- **The signature history change breaks any client that relied on the full list.** No screen uses it,
  and the frontend service was updated in the same change.
- **A tenant's webhook delivery log keeps 30 days.** For older events, it shows no deliveries.
- **The orphan query has not been run on the deployed database.** D-22's DoD asks for that run, and it
  remains open.

**Evidence**

On PostgreSQL **18.6** (`pgvector/pgvector:pg18`, throwaway container). No migration was added.
- **Upgrade boot.** A database built by `beb0c4b` was booted as `index.js` boots it: `db.sync()`, then
  57 migrations, then schema verification. It was then booted with this tree, which applied the one
  pending migration (another agent's `0078`), and schema verification passed.
- **Fresh boot.** A fresh database applied 58 migrations and passed verification. A second boot
  applied none.
- **Live test.** `dataLayer.dbC.live.test.js` (4 tests) passed on **both** databases, running **as the
  application role** (`DB_APP_ROLE=callibrator_app`, with `current_user` asserted). It shows:
  - the certificate and device cascades, each with its audit rows, leave another tenant's row naming
    the same id untouched;
  - the orphan report finds a deleted parent, an unlinkable type and a link to another tenant's
    certificate, and does not list a voided record's evidence, a standalone file or another tenant's
    orphans;
  - the purge removes finished rows older than 30 days and keeps pending, failed and recent rows;
  - each tenant gets one `system:webhook-delivery-purge` audit row, which passes migration 0033's
    actor CHECK.

**Unit tests, with how many failed at `beb0c4b`:**
- `attachment.cascade.d22`: 10 of 10
- `attachments.orphans.d22`: 5 of 6
- `sop.fanout.d24`: 4 of 4
- `gdpr.exportStream.d24`: 3 of 4 (12,345 audit rows written through the real `writeFile`)
- `esignature.newmethods` › getSignatureHistory: 7
- `eSignature.envelope.a105a106` › GET /history: 1
- the parent services' delete tests: `kanban.service` 1, `certificate.service` 3,
  `maintenance.service` 1, `calibrationDevices.service` 1

Four new suites could not load at `beb0c4b`, because the modules they test did not exist:
`webhookDeliveryPurge.adr070` (8), `webhookDeliveryPurgeScheduler.adr070` (8), `jsonShape.d27` (64)
and `auditRedaction.d27` (11).

Suites updated because their contract changed: `gdpr.a180`, `gdpr.subject.a151.a154`,
`gdpr.exportProfile.a140`, `gdpr.service`, `eSignature.controller`, `eSignature.a129a130`,
`certificates.twoTenant.a145`, `attachments.route`, `sop.service`, `systemActors.a124`,
`schedulerSwitch.w02` (through the registration lines) and the frontend `eSignature.service.test.ts`.

**Status:** Accepted, implemented 2026-09-25. D-22, D-24 and D-27 are **DONE**, except where the board
says otherwise. D-25 and D-26 are unchanged: their decisions are recorded in ADR-064, and what remains
of them is conversion work, not a decision.

---

## ADR-071: The Content Origin Sends a Nonce CSP with 'strict-dynamic'; Every Page Renders per Request; Style Elements Need the Nonce, Style Attributes Stay Inline

**Date:** 2026-09-25 · **Findings:** P7-08 (content-origin half), S-43, W-09 · **Follows:** ADR-066 (the API-origin half)

**Context.** ADR-066 took `'unsafe-inline'` out of the API origin's `script-src`. The Next.js origin
— the one that renders user-authored `posts.contentHtml` and ticket descriptions through
`dangerouslySetInnerHTML`, the stored-XSS surface of the system — sent no Content-Security-Policy at
all. Server-side sanitisation (`sanitize-html` at write time) was the only layer. The app runs
Next 16.3.6 with `cacheComponents: true`, so most routes shipped a build-time static shell.

**Decision**

- **Scripts: a per-request nonce with `'strict-dynamic'`, minted in the proxy.** `src/proxy.ts`
  generates 128 random bits per page request and sets the policy on the response **and on the
  request**. Next reads the nonce back from the request's `Content-Security-Policy` header while
  rendering (`next/dist/server/app-render/get-script-nonce-from-header.js`) and stamps it on its own
  bootstrap, chunk and flight scripts. `x-nonce` hands it to the root layout for the one inline
  script of our own (`ThemeInitScript`). `script-src-attr 'none'`. `'unsafe-eval'` is added only
  under `next dev`, for React's error stacks.
- **Every page renders per request.** A nonce exists only while a request is rendered. A prerendered
  page, or a Cache Components static shell, was rendered at build time with no nonce, and under
  `'strict-dynamic'` none of its scripts would run. The root layout reads `headers()` outside any
  Suspense boundary and exports `instant = false`, which is Next 16's declaration that the root
  layout may block. `use cache` data caching is unaffected.
- **Styles: `style-src-elem 'self' 'nonce-…'`, `style-src-attr 'unsafe-inline'`.** A `<style>`
  element needs the nonce; a `style` attribute does not. The attributes cannot be nonced (CSP has no
  nonce for attributes). React server-renders each `style={{…}}` prop (39 in `src/`, plus Motion's
  initial states) as an attribute, and hydration does not re-apply one the browser dropped. So
  attributes stay allowed. Tailwind 4 and Next emit no inline `<style>` in production (the built
  pages carry none; CSS is linked files), so elements can be locked down. Injected `<style>` in
  content is then blocked, which also closes CSS-based exfiltration. `style-src 'self'
  'unsafe-inline'` is the fallback for a browser without the `-elem`/`-attr` split. Under
  `next dev`, HMR injects `<style>` without a nonce, so dev allows inline elements.
- **The rest.** `default-src 'self'`. `img-src 'self' data: blob:` plus the API origin (TipTap has
  `allowBase64`; the avatar preview is a `blob:`). `font-src 'self'` (next/font self-hosts).
  `connect-src 'self'` plus `ws://` and `wss://` of the request's `Host` (validated before it is
  reflected) plus `NEXT_PUBLIC_API_BASE_URL` and its websocket twin. `frame-src 'self'` plus the API
  origin (the certificate PDF). `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `frame-ancestors 'none'`.
- **Static headers in `next.config.ts`:** `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` that keeps only
  geolocation (`dashboard/network-security`). `poweredByHeader: false`. `/api/` and
  `/uploads/public/` are excluded, because they relay backend responses that already carry helmet's
  headers. nginx adds only HSTS, so nothing is sent twice.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| A static CSP in `next.config.ts` with `script-src 'self' 'unsafe-inline'` | Next's inline bootstrap and flight scripts need either the nonce or `'unsafe-inline'`, and `'unsafe-inline'` lets an injected `<script>` in `contentHtml` run. That is the W-09 reasoning, which ADR-066 already refused to carry over |
| Experimental SRI (`experimental.sri`) with hashes, keeping static prerendering | Experimental. It covers script **files** but not Next's inline flight scripts, which still need `'unsafe-inline'` or a nonce |
| `style-src 'self' 'nonce-…'` with no `'unsafe-inline'` | Blocks every server-rendered `style` attribute. Landing sections, Motion, progress bars and kanban colours lose their styling with no error |
| `style-src 'self' 'unsafe-inline'` for elements too | Simpler. But nothing in production needs inline `<style>`, and allowing it leaves content-injected CSS live |
| Choosing `ws:` or `wss:` from `X-Forwarded-Proto` | Makes the websocket depend on a proxy header. If the header is missing, Socket.IO silently falls back to long-polling. `ws:` on an https page is refused as mixed content anyway, so listing both widens nothing |
| `img-src https:` (as on the API origin) | Lets content authors embed third-party tracking images. See the bad implications |
| Keeping static shells and reading the nonce only inside Suspense | The shell's own scripts (bootstrap, flight) would still be un-nonced, so the page would not boot |

**Implications, including the bad ones**

- **No page is prerendered any more.** Every navigation is server-rendered, and a CDN cannot cache
  HTML. For a signed-in operational app the cost is small, but it is a cost. The public blog/news
  pages lose static delivery. Their data is still `use cache`d.
- **External images are blocked.** A tenant logo, a content image or an avatar that is an absolute
  `https://` URL to another host no longer loads. The supported path is an upload, which is served
  from `/uploads/public/`. Nothing in the repository sets such a URL, but `tenant.logo` is a free
  string (`tenant.validator.js`).
- **The nonce is only as good as the proxy matcher.** A page path excluded from the matcher gets no
  CSP. Today the matcher excludes only `api`, `_next/static`, `_next/image`, `favicon.ico` and
  `uploads/public/`.
- **Development differs from production.** Dev allows `'unsafe-eval'` and inline `<style>`. A
  violation seen only in production is possible, and the production build is the one verified.
- **Not verified:** the Socket.IO websocket under this policy against a live backend (the header was
  checked, the connection was not). Also not verified: a deployment behind nginx or the Cloudflare
  tunnel.

**Evidence.**
- Unit: `frontend/src/lib/securityHeaders.test.ts` (the builder, and Next's own nonce parser reading
  the result) and `frontend/src/proxy.test.ts` § "the page CSP".
- Live: `next build`, then the standalone `server.js` on `127.0.0.1:4310`. curl showed the header on
  `/`, `/login`, `/blog/<slug>` and `/verify/<n>`, with a different nonce on each request. Every
  `<script>` Next served carried that request's nonce.
- Headless Chrome, driven through the repository's existing `puppeteer-core`, loaded 11 pages with
  zero CSP violations and zero page errors, and Next booted on every page. The pages were `/`,
  `/login`, `/register`, `/blog`, `/news`, `/verify/CERT-1`, `/oauth/consent`, `/sso-callback`, a
  404, `/dashboard` and `/dashboard/devices`.
- A 12th page, `/blog/csp-probe`, was served by a stand-in backend. Its `contentHtml` carried an
  inline `<script>`, a `data:` script, an `onerror` attribute and a `<style>`, which bypassed the
  write-time sanitiser. All four were blocked, and none of the payload's globals was set.

**Status:** Accepted, implemented 2026-09-25.

**Amendment 1 (2026-09-25) — the certificate frame, and external images**

*The certificate frame is not blocked, and nothing changed.* The verification page frames
`NEXT_PUBLIC_API_BASE_URL` + `documentUrl`. In every deployment template that base is the public
origin, so the PDF is served through the Next `/api` proxy, which relays the backend's headers
unchanged. The document route already replaces helmet's policy with
`default-src 'none'; frame-ancestors 'self' <CORS_ORIGIN…>` and removes `X-Frame-Options`
(`fileResponse.util.js`, `certificatePdf.controller.js`, ADR-057). Through the proxy, `'self'` is the
page's own origin. Every other API response keeps `frame-ancestors 'none'` and
`X-Frame-Options: SAMEORIGIN`, including the gated `/certificates/:id/pdf`, which nothing frames. The
attachment routes are not framed anywhere either: they are opened in a new tab or saved from a blob.
`certificateFrame.p708.test.js` pins these headers over helmet configured as `index.js` configures
it. Checked live against a real backend on PostgreSQL 18 and `next build` + `next start`: headless
Chrome 154 rendered the PDF viewer in the frame. A control iframe of an ordinary API response was
refused for `frame-ancestors 'none'`.

*External images: validate the logo, do not widen `img-src`.*

| Option | For | Against |
|---|---|---|
| **(a) A logo is an uploaded file only** (chosen) | Tenant logos are uploads already: since A-79 the controller drops a body `logo`, and the upload route names the file. No third party learns who views the app. `img-src` stays closed to tracking pixels in `contentHtml`. A logo cannot disappear because another host changed | A tenant row that already holds a hotlinked URL shows no logo until the tenant uploads one. Content authors cannot embed an external image; they must upload it (`POST /content/media`) |
| (b) Add `https:` to `img-src` | Nothing breaks. Pasted images keep working | Every viewer's IP, and the page as Referer origin, go to whichever host the logo or content names. Any author can plant a tracking pixel in `contentHtml`. This is the alternative ADR-071 already refused |

- **Validation.** `tenant.validator.js` accepts `logo` only as a stored file name
  (`constants/tenantLogo.js`: `^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$`). A URL or a path answers 400.
- **Existing values, without a migration.** `logoUrl()` in `tenant.service.js` serves a bare file
  name as before. It reduces a legacy same-origin path to its file name. For an absolute value
  (a scheme or `//host`), or anything else that is not a stored file name, it returns
  `logoBaseUrl: null`. The UI then shows its fallback: the default favicon, and the building icon in
  the tenant editor. Before, such a value became `<HOST_URL>/uploads/public/tenant/https://…`, a
  broken image.
- **The frontend uses the served URL only.** The signed-in branding (`useTenantBranding.ts`) set the
  favicon and apple-touch-icon from the raw `tenant.logo`. That was a relative href for a file name,
  and a hotlink for a URL. It now uses `logoBaseUrl`, as the public branding already did. The tenant
  editor no longer builds a preview URL from the raw value (`useTenants.ts`).
- **Bad implications.** A stored logo whose original file extension held a character outside
  `[A-Za-z0-9._-]` is now refused at upload (400) and not served. The upload middleware keeps the
  original extension verbatim. External images already embedded in `contentHtml` stay blocked. No
  sanitiser rule strips them at write time, so the author sees a broken image.
- **Evidence.** `tenant.logoUrl.p708.test.js` (backend, 23 tests; 16 fail against HEAD) and
  `useTenantBranding.p708.test.tsx` (frontend, 2 tests; both fail against HEAD). Live: a default
  tenant whose stored logo was `https://cdn.example.com/hotlinked-logo.png` answered
  `logoBaseUrl: <origin>/uploads/public/tenant/https://cdn.example.com/hotlinked-logo.png` before
  the change and `null` after. Headless `/login` and `/register`, from a build with
  `NEXT_PUBLIC_TENANT_ID` set, showed the default icons, made no request off the app origin and had
  no CSP violation.

---

## ADR-072: A Session's Own-Password Checks Share One Budget, and Spending It Signs That Session Out; an Administrator Can Remove a Passkey; No Helper Deletes Every User

**Date:** 2026-09-25 · **Findings:** A-260, A-261, A-262 · **Extends:** ADR-059 (1), ADR-068 (implications) · **No migration**

**Context**

ADR-068 left three follow-ups open. Every check of the caller's own password by a signed-in
session could be repeated without limit (A-260):
- `POST /auth/pass-is-valid`;
- the change-password route;
- the re-authentication of a passkey removal, an email change and an MFA rotation or disable.

The only limit was the `mfaManage` bucket (A-142), and it covered the MFA endpoints alone. A stolen
session was therefore a password oracle that the sign-in throttle (A-185) never saw.

`migration.service#dropSeededTables` had no caller. It force-deleted every stock row, user, tenant,
role-menu permission, menu group and role, one statement at a time, with no transaction (A-261).

An administrator had no way to remove another user's passkey (A-262). An SSO-only user, who has no
password to re-authenticate with, could not remove their own passkey at all.

**Decision**

1. **One budget per user covers every signed-in check of one's own password** (A-260). The code
   path is `auth.service#verifySessionPassword`, and the budget is
   `AUTH_ENDPOINTS.passwordCheck`: five wrong passwords in fifteen minutes.
   - It is keyed by the user id from the verified session, never by request input.
   - It has no per-address key: the session already names the one principal who is guessing.
   - The budget is checked **before** the comparison, so a spent budget learns nothing, not even
     from the right password.
   - The right password clears the count.
   - It never writes `users.locked_until`. As with `mfaManage` (A-142), the guesser already holds a
     session, so locking sign-in would lock out only the real user. ADR-059 (1) still holds: an
     account is never locked by attempts.
2. **The attempt that spends the budget signs out the session that made it, and is audited.**
   - `ACCOUNT_LOCKED`, actor `system:auth-lockout`, `changes.scope` `session-password-check`, with
     the purpose, the count, when the pause ends and whether a session was revoked.
   - The row and the revocation are written in one transaction of their own. A re-authentication
     runs inside the change's transaction, and that transaction is about to roll back.
   - If the row cannot be written, the session is revoked anyway and the failure is logged. This
     follows `recordAccountLock`: the control must not depend on the trail.
   - An attempt racing past the budget revokes its own session but writes no second row.
3. **A spent budget answers 429 with `Retry-After`.** This covers the spending attempt and every
   check until the window ends. `controllerWrapper#sendCaughtError` sends the header for any
   `AppError` that carries `retryAfterSeconds`. A wrong password below the budget keeps each route's
   own answer (`valid: false`, or 400).
4. **`dropSeededTables` is removed** (A-261). No route, controller, script or boot path called it. A
   test pins that no application source defines or calls it. This is ADR-068 (5) applied to the
   last such helper.
5. **`DELETE /users/:userId/webauthn` lets a tenant administrator remove another user's passkey**
   (A-262).
   - Guards: `loadAdminResetTarget`, shared with the MFA and password resets. Another tenant's user
     or a missing one is 404, oneself is 400, a higher role is 403, and no passkey is 409.
   - It clears every passkey column and revokes **every** session of the user, because a session
     opened with a lost authenticator may be the thief's.
   - It is audited `WEBAUTHN_ADMIN_RESET`, actor the administrator, in the transaction.
   - The password and MFA are untouched.
   - The users page offers it only for a user with a passkey.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Pause without revoking the session | a stolen session keeps its 5 guesses per 15 minutes for its whole 7-day life, about 3,300 guesses. Revoking caps a stolen session at 5 |
| Revoke every session of the user | the other sessions are not implicated. Whoever holds this session can already sign out everywhere through `/auth/logout-all`, so revoking everything adds no protection, and it costs the owner their other devices |
| Lock the account (`users.locked_until`) | ADR-059 (1): the guesser is signed in already, so a sign-in lock hurts only the owner |
| Count per endpoint (a limiter middleware on each route) | spreading guesses across five routes would give 25 per window. The email rectification checks the password only for `email`, so a route middleware would also have throttled a name change |
| Fold these checks into `mfaManage` | that bucket counts every 4xx on the MFA endpoints, including a missing field. It is also consulted before the handler, where pass-is-valid and the rectification have no hook |
| Count every 4xx, as `withAuthOutcome` does | a missing password or a 409 state explanation is not a guess |
| Keep `dropSeededTables` and wrap it in a transaction | a helper nobody calls, which erases the platform, has no honest use (ADR-068 (5)) |
| Remove a passkey by the self-service route with an admin override flag | one route with two authorisation models. The admin resets already have their own shape, guards and audit |

**Implications, including the bad ones**

- **The owner who mistypes five times signs themselves out,** and for fifteen minutes cannot change
  a password, email, passkey or MFA setting. They can still sign in, because the sign-in throttle is
  separate, and they can use the rest of the application.
- **Anyone holding a session can pause the owner's sensitive changes for fifteen minutes** by typing
  five wrong passwords. It costs them that session. They could already sign the owner out
  everywhere.
- **The budget lives in Redis,** with a per-process fallback during an outage (A-30). During an
  outage the effective budget is five per replica.
- **The pause's audit row has no actor user.** It names the account as the resource and the system
  as the actor, like the A-126 sign-in lock.
- **An administrator can remove the passkey of any user at or below their level in their tenant.**
  The row and the user's forced sign-out are the controls. This is the same trust ADR-059 (7)
  places in the password reset.

**Verified.** Tests only: `auth.passwordCheckBudget.a260.test.js` (19),
`auth.passwordCheckRetryAfter.a260.test.js` (3), `user.passkeyReset.a262.test.js` (13),
`migration.service.test.js` › A-261 (2), and the frontend `CredentialResetActions.a262.test.tsx` (3)
and `user.passkeyReset.a262.test.ts` (3). Fail-before is recorded under A-260 to A-262 in
`TASKS/AUDIT-2026-09-REMEDIATION.md`. The budget has not been exercised against a live Redis, and
the new users-page action has not been used in a browser.

**Status:** Accepted, implemented 2026-09-25.

---

## ADR-073: The Statics No Hook Reaches Are Wrapped per Model; the Calibration Scan Commits per Tenant Chunk; the Emit Path's First Attempts Are Capped; Offboarding Builds No Export

**Date:** 2026-09-25 · **Findings:** W-34 (new), W-17 (remainder) (`TASKS/AUDIT-2026-09-ASYNC.md`) · **Amends:** ADR-048 (its "aggregate, max and sum remain unhooked"), ADR-069 §4 and §6 (the scan's transactions, the emit path)

**Context**

ADR-048 recorded that `aggregate`, `max` and `sum` remained unhooked. Reading Sequelize 6.37.8
(`lib/model.js`) showed the gap is wider:

| Verb | Hook Sequelize runs | Registered before this ADR |
|---|---|---|
| `aggregate`, and `sum`/`min`/`max` (each is `this.aggregate(...)`) | **none** | — |
| `count` | `beforeCount`, then `this.aggregate(...)` | yes |
| static `increment`; `decrement` and the instance forms all end in it | **none** | — |
| static `restore` | `beforeBulkRestore`, *after* `mapOptionFieldNames` (as `destroy`, W-33) | **no** |
| instance `restore` | `beforeRestore` | **no** |
| `destroy({ truncate: true })` | `beforeBulkDestroy`, but the statement is `TRUNCATE`: the WHERE is dropped | yes, and useless |

Today's two aggregate call sites (`Stock.sum` in `dashboard.service`, `Attachment.sum` in
`quota.service`) pass `tenantId` explicitly, so nothing was leaking. It was a trap: on PostgreSQL 18.6,
at `beb0c4b`, `runForTenant(A, () => Stock.sum("quantity"))` returned **1107**, tenant A's 7 plus
tenant B's 1100. An increment aimed at B's row by id from A's context changed it, and a bulk restore
from A's context restored B's rows.

W-17 had three items left. `emitEvent` started one detached claim-and-POST chain per matching webhook
per event, with no cap. `offboardTenant` built a full export and threw it away. The calibration scan
committed two transactions per due device.

**Decision**

1. **The hookless statics are wrapped per model, not guarded by a test.**
   `tenantScope.util.js#scopeHooklessStatics` defines `aggregate` and `increment` as own statics on
   every tenant-scoped model: every model already defined when `register` runs, and every later one
   through `afterDefine`. Because `sum`, `min`, `max` and `count` call `this.aggregate`, and
   `decrement` and the instance forms call `increment`, those two wrappers reach every verb in the
   table. The predicate is resolved by the same `resolveScope` as a find: `skipTenantScope: true` is
   the only opt-out; no context, the super admin and a system task skip; no resolvable tenant denies.
   - `aggregate` also scopes includes (`applyTenantToIncludes`). It skips an options object
     `beforeCount` has already scoped (a `WeakSet`), so `count` carries the predicate once.
   - An `increment` with no `where` is passed through untouched, so Sequelize still refuses it
     rather than the wrapper widening it to the whole tenant. A non-plain `where` is AND-ed.
   - `beforeBulkRestore` names the **column** (`byField`, as W-33). `beforeRestore` refuses another
     tenant's instance (`assertSameTenant`).
   - `destroy({ truncate: true })` inside a tenant or deny scope is **refused**.
2. **The calibration scan commits per tenant chunk.** Due devices are grouped by tenant within a page
   and split into chunks of `CALIBRATION_SCAN_TX_BATCH_SIZE` (25). Each chunk runs in its tenant's
   context:
   - **Transaction 1** is `maintenanceService.createAutoScheduledWorkOrders`. It makes one tenant
     check of the devices, one `INSERT … ON CONFLICT DO NOTHING` of every work order, and a read-back
     **by id**. It then writes **one audit row per created order**, naming the actor, and queues one
     `work_order.created` webhook per order for after the commit. A device whose open auto-scheduled
     order already exists (0060's partial index, W-03) inserts nothing and is reported as
     `conflicted`, which the scan counts as a skip. A device that is not the tenant's is `missing`,
     which is an error.
   - **Transaction 2** is every tenant-wide notification of the chunk, each with its own audit row
     naming its device and work order. As before, it is best-effort towards the scan.
   - Then each created order's `device.*` webhook event is emitted.

   There are two commits per chunk instead of two per device. Per-device audit attribution does not
   change.
3. **`emitEvent`'s first attempts are capped per process** (`WEBHOOK_EMIT_CONCURRENCY`, 10). Past the
   cap, the delivery row is written and gets no immediate attempt. It is already due, so the
   dispatcher's next pass (every 15 s by default) sends it. The result says `deferred: n`. A slot is
   released when its attempt settles, whether it succeeded or failed.
4. **`offboardTenant` builds no export.** Remove, not keep. The export was taken before the
   transaction, so it was not a snapshot of the offboarded state. The scheduler discarded it, and the
   operator's screen ignored it while announcing "data exported". Offboarding deletes nothing: the
   data stays readable through `GET /tenants/:tenantId/export` until the hard delete, and the hard
   delete refuses while regulated records remain (D-23). The response is `{ tenant }`, and the
   frontend's type and toast say so.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| A permanent guard test failing on any source call of these statics without an explicit `tenantId` | opt-in again: the ADR-048 argument. A text scan cannot follow `const M = models[name]; M.sum(...)`, an alias, or a `where` built elsewhere, and "has an explicit tenantId" trusts the author's value. It also leaves `restore` and `truncate` open |
| Patch `Model.aggregate`/`increment` once on Sequelize's base class | reaches every Sequelize instance in the process, and non-tenant models pay for a check that always skips. Per model is explicit, and a model with no tenant key is never touched |
| Put the predicate in an `aggregate` wrapper and let `count` apply it twice | it is idempotent on a plain `where`, but it nests `Op.and` again on a non-plain include `where`. The `WeakSet` keeps `count`'s SQL identical to what it was |
| One savepoint per device inside a chunk transaction, reusing `createWorkOrder` | a Sequelize savepoint runs its `afterCommit` hooks when the savepoint is released, **before** the outer commit, so `emitAfterCommit` would announce work orders that could still roll back (the A-11 invariant) |
| `bulkCreate(..., { returning: true })` | Sequelize maps `RETURNING` rows onto the built instances **by position**. With `ON CONFLICT DO NOTHING` skipping a row, every later row's id would be attached to the wrong device, and so would its audit row |
| One transaction per tenant per page, however many devices | holds a transaction and its unique-index entries for up to 200 inserts. A chunk bounds the lock time and the blast radius of one failure |
| Put the notifications in the work orders' transaction | rejected by ADR-069: a failed notification would roll back the work orders |
| Queue deferred first attempts in memory | an in-memory queue is the unbounded structure W-17 is about, and it would still be lost on restart. The durable row is already the queue |
| Keep the offboard export by writing it to storage | this is personal data at rest with no retention rule (W-15's problem again). The live export route already serves the same data for the whole retention period |

**Implications, including the bad ones**

- **The tenant isolation now depends on two more private Sequelize behaviours**: `count` calling
  `this.aggregate`, and `decrement` and the instance forms calling `increment`. The unit suite pins
  both. A Sequelize upgrade that changes either shows up as a failing test. It is not a guarantee.
- A model whose statics were captured **before** `register` ran is not wrapped. No such model exists:
  the barrel registers after defining every model, and `afterDefine` covers the rest.
- **A failure in a chunk's work-order transaction is an error for every device in the chunk.**
  Before, only the failing device was an error. A per-device failure other than a conflict is now
  rare, because the tenant check and the conflict are handled in SQL, but it costs up to 24
  neighbours a day's delay.
- **A failed notification transaction loses the notifications of the whole chunk.** They are logged,
  not counted, and not retried. The work orders stand.
- A bulk insert bypasses the model's instance hooks. `MaintenanceWorkOrder` has none, and
  `beforeBulkCreate` still stamps the tenant.
- **Deferred webhook first attempts wait for the dispatcher**, up to one tick (15 s by default),
  longer if the dispatcher is disabled. Total in-flight POSTs per process are at most
  `WEBHOOK_DISPATCH_BATCH` + `WEBHOOK_EMIT_CONCURRENCY`. `testWebhook` is not capped: it is one
  awaited attempt per request.
- **The emit path still writes one autocommit delivery row per webhook per event.** The scan's
  writes per device are now constant per chunk, except for these rows.
- **Still open:** the offboard response returns the raw `Tenant` row, and its `settings` JSONB can
  mirror a credential (A-179's `exportedTenant` strips it only from the export). This was true before
  this ADR, beside the export. `suspend`, `resume` and `cancelOffboarding` return the same row. This
  needs its own card.

**Status:** Accepted, implemented 2026-09-25. The tests are named on the ASYNC board, W-17 and W-34.

---

## ADR-074: The Proxy Streams, Bounds Its Upstream Wait and Forwards a Caller's Key; List Endpoints Keep the House Envelope; a Timed-Out Request Answers 408 in It; Backend Links Stay Same-Origin; SSO Hand-Off Is Same-Origin Only

**Date:** 2026-09-27 · **Cards:** F-05, F-07, F-09, F-10, F-11, F-12, F-13, F-14, F-16 (AUDIT-2026-09-FRONTEND) · **Extends:** ADR-059 (A-71), ADR-067, ADR-071

**Context.** The frontend board's open and partial cards. Code in `a31c601` already cited this ADR
(`meteredBilling.controller.js`, `requestTimeout.middleware.js`, the `f13`/`f14` tests) before it was
written — audit finding F-28. This is the record those citations point at.

**Decision**

1. **The Next proxy streams both bodies (F-16).** `app/api/v1/[...path]/route.ts` passes `req.body`
   upstream with `duplex: "half"` and returns `res.body` as it arrives. It reads a response body only
   when it may carry an access token: a 2xx `application/json` answer that is not
   `Content-Disposition: attachment` and declares no more than 1 MiB. That is the A-71 strip and the
   cookie rotation, unchanged. Hop-by-hop request headers (`transfer-encoding`, `expect`,
   `keep-alive`, `upgrade`) are not re-sent. A-69 (redirects pass through) and A-68 (only the OIDC
   binding cookie crosses) are unchanged.
2. **A caller's `Authorization` is forwarded when there is no session cookie, on purpose (F-16).**
   nginx sends every `/api/` request to Next (ADR-046, ADR-059), so the proxy is also the path of
   the machine clients that send `Authorization: ApiKey <key>`. The cookie's token always wins.
3. **The proxy bounds its wait (F-14).** Budgets: client 35 s > proxy 32 s > backend 30 s, in
   `src/constants/index.ts`. The proxy aborts its upstream fetch if no response headers arrive within
   32 s, or when the browser goes away. It then answers **504** in the envelope. The timer stops at
   the headers, so a long download is not cut off. `ErrorState` reads 504 like 408: a retryable
   timeout.
4. **A timed-out backend request answers 408 in the envelope (F-14).** `connect-timeout` raises its
   error from wherever the request has reached, past the matched route. So the inline 408 handler that
   sat right after `timeout("30s")` in `index.js` was **never reached**. A timed-out request answered
   **503 "Response timeout"** from `errorHandler`. `requestTimeout.middleware.js` now sits
   immediately before `errorHandler` and answers `error(res, "Request timeout", 408)`.
5. **List endpoints keep the house envelope; the frontend is not coded around exceptions (F-13).**
   `GET /metered-billing/history` now sends rows in `data` and pagination in the top-level `meta`.
   `GET /sessions` was fixed the same way by A-111. The frontend services read only that shape.
6. **Backend-issued API links are used as the same-origin paths they are (F-11).** The verification
   page's `documentUrl` is `/api/v1/certificates/verify/<n>/document?token=…`. It is rendered through
   `toSameOriginApiPath` (`lib/uploadUrl.ts`), never prefixed with `NEXT_PUBLIC_API_BASE_URL`. A
   value that is not an `/api/v1/` path gets no link. This supersedes ADR-071 Amendment 1's
   description of the frame as "`NEXT_PUBLIC_API_BASE_URL` + `documentUrl`". The frame is now
   `'self'`, which `frame-src 'self'` and the document route's `frame-ancestors 'self'` already allow.
7. **The SSO hand-off accepts only a same-origin request (F-09).** A-60 already made
   `/api/v1/auth/sso-session` exchange a one-time, single-use code server-to-server, and write no
   cookie unless the backend confirms it. F-09 adds `lib/sameOrigin.ts`: `Sec-Fetch-Site`, when sent,
   must be `same-origin`, and `Origin` must be present and match the `Host` the request arrived with.
   Anything else is refused with 403 before the body is read.
8. **Every page overlay is a modal dialog (F-12).** The ten bare `fixed inset-0` overlays gained
   `role="dialog"`, `aria-modal` and `aria-labelledby`, and use `useModalA11y`: focus moves in, Tab is
   trapped, Escape closes, and focus returns to the opener. Their icon-only close buttons are named.
   `DateField`, `MultiSelect` and `SearchableDropdown` associate label, control and message.
   `MultiSelect` gained a real trigger `<button>`, a named multi-select `listbox` and keyboard
   selection. `Badge`'s remove button is named and is `type="button"`, so it no longer submits a
   surrounding form.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Keep buffering, add a size ceiling | Still holds every in-ceiling transfer twice. A ceiling on a hospital's attachments is a product limit, not a proxy one |
| Stream everything, move A-71's strip to the dedicated auth routes only | `POST /auth/mfa/login` and `/auth/impersonate` are answered through the catch-all. Moving them is a larger change, and missing one leaks a bearer token to script |
| Strip every client `Authorization` | Breaks every API-key integration on the documented deployment, since nginx routes `/api/` to Next |
| `AbortSignal.timeout(32 s)` on the whole fetch | Also aborts a download that is still streaming after 32 s |
| Accept the nested envelope for the two endpoints and document it | The deviation `CLAUDE.md` names as the silent-empty-list failure. The next person to fix it "correctly" empties the screen without an error |
| Move the 408 handler above the routes | It is already above them. The error travels forward from the route, so no position before the routes can catch it |
| A `state` value minted by the Next route for the SSO hand-off | The backend's one-time code is already a server-minted, single-use, 60-second capability bound to a verified identity (A-60). A second token would add storage and replicate that |
| Refuse a missing `Origin` only on a cross-site `Sec-Fetch-Site` | Browsers send `Origin` on every POST. A caller that sends none is not a page of ours |

**Implications, including the bad ones**

- **A JSON response over 1 MiB, or sent as an attachment, is never inspected.** If the backend ever
  put a top-level `token` in such a response, it would reach the browser. No endpoint does.
- **An `Expect: 100-continue` request used to be refused by undici (502).** It is now sent without
  the header.
- **A request that really needs more than 32 s gets a 504** even if the backend would have finished.
  The backend's own 30 s budget already cut it off.
- **Before this change a timed-out backend request answered 503.** Any client or dashboard that
  keyed on that 503 now sees 408.
- **The SSO hand-off now depends on nginx forwarding `Host` as `$host`.** It does, in every template
  (`deploy/compose/nginx/*.conf`). A proxy that rewrites `Host` would break SSO with a 403.
- **`MultiSelect`'s chip remove buttons are live while the control is disabled**, as before. Not
  changed here.
- **No screen reader has been used.** axe runs only in jsdom (component suite). The browser suite
  does not run it.

**Evidence**

- Unit tests, each run against the pre-change tree (`git worktree` at `f0d7f08`) to prove it fails
  first. Details are in `MEMORY/records/2026-09-27-frontend-board-fe2.md`:
  - `route.stream.f16` (9 tests, 6 fail before);
  - `requestTimeout.f14` (the pre-change stack answered 503);
  - `envelope.f13` (2 of 3 fail before; the sessions one was fixed by A-111);
  - `page.f11` (3 of 3);
  - `sso-session/route.test` › F-09 (3 fail before);
  - `a11y.f12b` (8 of 9);
  - `a11y.f12.overlays` (4 of 4).
- Headless Chrome 154 against `next build` + `next start`, with `NEXT_PUBLIC_API_BASE_URL` set to an
  unreachable origin. The backend was a **stand-in**, not the real one: session management showed
  403, 404, 408, 409, 429 and offline states, each with its reference. An expired access token
  refreshed once and kept the typed filter. A refused refresh cleared every cookie and landed on
  `/login` once. A backend that never answered produced the 504 copy at 33 s, and the stand-in saw
  the connection closed at 32 s. The verification PDF loaded same-origin, with no request to the
  backend origin. A role with none of the searchable menus had no search box and sent no `/search`.
  During a 400 MB download and a 300 MB upload the Next process's working set peaked at 186 MB and
  185 MB.

**Status:** Accepted, implemented 2026-09-27.

### Amendment 1 (2026-09-29): F-05 against the real backend — the route guard reads a path-`/` "renewable" marker; the catch-all proxy keeps a sign-in's refresh token

The run above used a stand-in backend and stayed on one page. Against the real backend with
`JWT_ACCESS_EXPIRED=60s`, the in-page refresh held: one 401, one `POST /auth/refresh` 200, the retry
200, and the typed search text kept. Two defects appeared that the stand-in and the unit tests could not show:

1. **Every page load after expiry went to `/login`.** `hasUsableSession` (`lib/sessionRouting.ts`)
   treated an expired token as usable when an `auth_refresh` cookie was present. But that cookie is
   scoped to `/api/v1/auth/refresh`, so **a browser never sends it with a page request**, and the
   guard never saw it. `proxy.test.ts` had put it on a `/dashboard` request, which no browser does.
   **Decision:** a second httpOnly cookie, `auth_renewable=1`, on path `/`, written and cleared with
   the refresh token (`lib/authCookies.ts`). The guard reads it. It grants nothing: the backend verifies
   every call, and a revoked refresh token is refused at the refresh route, which clears the marker too.
2. **An MFA sign-in could not be renewed.** `POST /auth/mfa/login`, and `/auth/impersonate`, answer
   through the catch-all proxy with a top-level `refreshToken`. The proxy removed it from the body
   (A-71) but never stored it. That affects every MFA user, including every platform operator.
   **Decision:** the catch-all proxy writes a sign-in with the same `writeSessionCookies` as the
   login route. Also, the guard's own dead-session clear now deletes `auth_refresh` on its own path
   and `auth_renewable`. Before, it left the refresh cookie behind.

*Alternatives:* widening `auth_refresh` to path `/` would send the refresh token with every request,
including every API call the proxy forwards, which is the exposure the path scoping exists to prevent.
Using the non-httpOnly `auth_logged_in` as the signal would work, but a script can forge it, and it
means "signed in", not "renewable". Refreshing inside the route guard is not possible, because the
guard cannot see the refresh token either. *Bad implication:* one more cookie to keep in step. The
`authCookies` test pins the set that is written and cleared.

---

## ADR-075: SCIM Gets the Tenant Administrator's Identity-Conflict Rule; Sign-In Does Not Wait on Email Verification, and the Link Now Lands; a Deleted Calibration Device Can Be Restored; Lifecycle Responses Carry No Credential

**Date:** 2026-09-27 · **Cards:** A-37 (Q-18 for SCIM), A-60 item 3 (Q-11), A-133, A-263 ·
**Extends:** ADR-051 (Q-11, Q-18), ADR-070 (D-22) · **Authority:** the owner's standing instruction —
argue each decision from two opposing positions, write both into the card, decide the best practice.

**Context**

Four cards were left open after batch 7. Two needed a decision ADR-051 had taken for another path
but not for this one (SCIM, and the activation link). One needed a decision nobody had taken (device
restore). One was a straightforward leak (A-263). Reading the code for them found one more defect:
**the activation link has never worked** — it points at `/activation`, and no frontend page answered
that path. So `isEmailVerified` could never become true through the application.

**Decisions**

| # | Decision | Compliance-first said | Operability-first said | Why this answer |
|---|---|---|---|---|
| **A-37** SCIM identity conflict | **A-128's rule for SCIM:** one 409 whoever holds the address (the check is global, soft-deleted accounts included); a budget of 10 conflicts an hour **per API key**, then 429 before any lookup; one audit row per conflict in the key's tenant, actor **`system:scim`** with `changes.apiKeyId`, never the address or whose it was. A `userName` PATCH is the same probe and gets the same rule. A super admin's JWT is answered but neither counted nor audited | keep the generic 500 of 2026-09-24: a 409 tells the key "this address exists somewhere". Or go per-tenant uniqueness, the only real closure | a 500 is **worse**, not safer: Okta and Entra ID retry a 5xx indefinitely, so the probe becomes unlimited and unaudited, and the IdP's operator can never see why a user will not provision. RFC 7644 § 3.3 names `409 uniqueness` for exactly this | ADR-051 Q-18 already accepted a 409 for tenant administrators on the condition that it is rate-limited and audited. A `scim:write` key holds the same power (A-250), so the same condition is the consistent answer. Per-tenant uniqueness stays the long-term model (memberships), as Q-18 says |
| **A-60 / Q-11** unverified sign-in | **Upheld: sign-in does not check `isEmailVerified`.** The decision is now pinned by a test. **And the link lands:** a frontend `/activation` page spends the token once and removes it from history | refuse an unverified password sign-in with a 403 state explanation (the password was right, so the account is known to the caller and there is no oracle), and add a resend | every account that reaches data was vouched for by someone other than the mailbox: an administrator (temporary password, A-123, which the holder must change), SCIM or an SSO identity provider (both store `true`). The only never-vouched accounts are self-registrations, which carry no tenant and see nothing. Enforcing locks out exactly the wrong people: every account whose address was rectified (A-180 resets the flag), every legacy admin-created account (F-2), and — because the link was a 404 — **every self-registration there has ever been** | operability. The compliance paper's strongest point — "a session for an address nobody proved" — buys nothing when that session reaches no tenant. What verification actually protects is the **password-reset channel**, and it now works end to end. A 403 gate would also need a resend endpoint that is itself an unauthenticated oracle surface |
| **A-133** device restore | **Restore exists:** `POST /calibration-devices/:id/restore`, gated `auth` → `validateUuid` → `rbac([TENANT_ADMIN])` → `calibration: write`. **404** for another tenant's device, identical to a missing id. **409** with a state explanation for a device that is not deleted, or whose serial a **live** device of the tenant now holds (the unique index is the backstop for a race). One transaction: `restoreStatic`, **exactly** the attachments the delete took (`attachment.service#restoreForResource`), and an `UPDATE` audit row with `operation: "RESTORE"` | a device is the anchor of calibration records and certificates (ISO 17025 §6.4.13, §7.5): a delete in error must be reversible, attributably, not by a database edit | a restore resurrects a register entry and its attachments; if it is the same grant as delete, a mistaken restore is as easy as a mistaken delete. And the bytes of a cascaded attachment may since have been swept | both, combined. Reversibility is the compliance requirement; the administrator gate and the 409s are operability's safeguards. The 409 serial message now names the deleted device's id so the administrator can act on it |
| **A-263** lifecycle responses | `suspend`, `resume`, `grace-period`, `offboard` and `cancel-offboarding` answer the Tenant row through `withoutRedactedSettings` (constants/tenantSecretSettings.js), the A-179 rule | redact in the service, so no caller can ever get the raw row | the scheduler calls `offboardTenant` and wants the instance; a service returning plain objects changes every internal caller for no gain | redact where the row **leaves the server** — the controller. Nothing internal serialises these rows |

**Which attachments a restore brings back.** ADR-070 designed this: the attachment is restored when
it is still deleted **and its most recent DELETE audit row is a `cascade-soft-delete` naming this
parent**. So an attachment deleted on its own — before the parent's delete, or after an earlier
restore — stays deleted: a restore must not undo a decision somebody else took. The candidates are
**locked before their history is read**. The D-22 deleted-file sweep (`attachmentFileSweep.service.js`) locks the rows it purges and
writes a `file-purge` DELETE row in the same transaction, so a sweep that got there first is seen
(its row is now the latest DELETE, and a row whose bytes are gone is not revived), and a later sweep
skips the locked rows.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| A-37: per-tenant uniqueness of `users.email` | Q-18 rejected it: login looks users up by address, so an address in two tenants makes every sign-in path ambiguous |
| A-37: count every SCIM create, not only conflicts | limits ordinary provisioning (a bulk initial sync) instead of probing — the same reason A-128 counts only conflicts |
| A-37: a system user row for SCIM | ADR-051 Q-13 forbids one: a job or a machine credential is not a principal that could log in or be impersonated |
| Q-11: gate only tenant-less, unverified, non-operator accounts | protects accounts that can reach nothing, and needs an unauthenticated resend endpoint — an existence oracle to build and then defend |
| Q-11: mark every existing account verified in a migration | writes a false fact into the record |
| A-133: restore under the same grant as delete (`calibration: write`) | the 409 message already told users "ask an administrator"; a restore re-attaches history and is rarer than a delete |
| A-133: restore every soft-deleted attachment of the device | revives files somebody deleted on purpose |
| A-133: a `deleted_with_parent` column (ADR-070 rejected it too) | the audit trail already identifies the cascaded rows exactly |
| A-263: redact inside the lifecycle service | see the table |

**Implications — including the bad ones**

- **A-37:** SCIM create for an address another tenant holds changes from **500 to 409**. An IdP that
  treated the 500 as transient stops retrying and reports the conflict to its operator — intended.
  The residual oracle is the one Q-18 accepts, now bounded at ten answers an hour per key and each
  one on the record. Soft-deleted accounts still hold their address, as the unique index does.
- **A-37:** SCIM **successful** mutations still write no audit row (A-33's open gap). Only conflicts
  are audited here.
- **Q-11:** an unverified address still receives password-reset codes; the reset then verifies it
  (ADR-051). Unverified self-registrations still **hold their address** against the global unique
  index — address squatting — and nothing expires them. That needs its own card.
- **Q-11:** the activation link's origin is taken from the request's `Origin` or `Host` header
  (`auth.controller#register`, and the rectification mail). It is sent only to the address the
  caller typed, so it is not an account-takeover vector today, but it should come from configuration.
- **A-133:** there is **no trash view** in the frontend. An administrator finds a deleted device's
  id in the audit trail or in the serial-conflict 409 message, and restores through the API. The
  delete modal no longer says restoring needs database tools.
- **A-133:** a restored device resumes calibration scheduling and IoT ingest with the token it had.
- **A-263:** only these five responses were changed. `tenant.service#transformTenant` already strips
  the same keys from every other tenant response; the three definitions of the rule should become one.

**Evidence** — the tests and the PostgreSQL 18.6 run are named on the four cards
(`TASKS/AUDIT-2026-09-REMEDIATION.md` § A-37, A-60, A-133, A-263).

**Status:** Accepted, implemented 2026-09-27.

---

## ADR-079: MQTT Replicas Share One Subscription and Read Under a Cap; a GDPR Export's Expiry Lives on Disk and the Retention Sweep Enforces It; a Retention Value That Cannot Be Applied Is a Failed Run; the Rate Limiter's Memory Fallback Is Bounded; a Grace Period Needs a Suspended Tenant

**Date:** 2026-09-27 · **Findings:** W-14, W-15, W-16, W-19, W-21 (`TASKS/AUDIT-2026-09-ASYNC.md`); W-10, W-13 and W-20 verified already fixed (S-03, P7-02 + A-14, A-122 + D-23) · **Extends:** ADR-069 (the sweep's context and audit rules), P7-02 (`jobMonitor.service`) · **Migrations:** none (0085 was offered and not needed)

**Context**

The last open cards of the async audit:

- **W-14.** Every replica subscribed to plain `device/#` with its own client id. The broker delivered each
  message to all of them, so N replicas stored N readings and raised N tenant-wide anomaly alerts. The
  handler ran each ingest detached, with no limit on how many ran at once.
- **W-15.** A GDPR subject-access export ZIP was deleted only by a 168-hour `setTimeout` in the process
  that built it. A restart inside the week left the subject's exported personal data on disk forever.
  The unpacked working directory waited on the same timer.
- **W-16.** `getRetentionPolicy` parsed stored periods with `parseInt`. `""`, `"forever"` and null became
  NaN, which the purge skipped every night with no trace, and `"30abc"` became 30.
- **W-19.** The rate limiter's in-memory fallback (the store whenever Redis is not ready) expired an entry
  only when that key was read again. A one-off IP's bucket never is.
- **W-21.** `enterGracePeriod` stamped a deadline on a tenant in any state. A tenant suspended after that
  deadline had passed was offboarded by the next scheduler run, with no grace.

**Decision**

1. **MQTT ingest uses a shared subscription** (`iot.service.js`): `$share/<MQTT_SHARED_GROUP>/device/#`,
   group `callibrator` by default. `MQTT_SHARED_GROUP=none` subscribes to plain `device/#` for a broker
   without shared subscriptions; only one replica may then run MQTT. A group name holding `/`, `+` or `#`
   falls back to the default and logs an error. Client ids get a random suffix.
2. **Ingest reads under a cap** (`MQTT_INGEST_CONCURRENCY`, 8). Ingest runs from the client's
   `handleMessage(packet, done)`, not a `"message"` listener. mqtt.js reads the next packet only after
   `done`, so at the cap `done` is withheld until an ingest finishes. The backlog waits in the broker and
   in TCP, not in memory or in the database pool.
3. **A GDPR export's expiry is on disk.** `exportUserData` writes `<exportId>.json` (tenant, subject,
   created, expires) **before** any other file, deletes its working directory as soon as the ZIP exists,
   and sets no timer. `gdpr.service#purgeExpiredExports`, called at the end of the nightly
   `runRetentionSweep`, deletes each expired ZIP and working directory, writes one audit row in the
   export's tenant (`runForTenant`, actor `system:retention-purge`, `resourceType: "DataExport"`,
   `operation: "GDPR_EXPORT_EXPIRED"`), and deletes the manifest **last**, so a failed audit row is
   retried by the next sweep. The rules for other cases:
   - An export with no manifest (written before this change) expires by the timestamp in its id. It is
     deleted and logged, not audited, because its owner is not recorded anywhere.
   - A manifest whose expiry does not parse counts as expired.
   - A manifest that is not JSON is an error, and its files are kept.
   - Names that do not match an export id are never touched.
4. **A retention value that cannot be applied is reported, and the run fails.**
   - A stored override must be a whole number of days (`/^\d+$/` after trimming). Anything else falls back
     to the platform default.
   - A malformed platform default (the environment) has nothing to fall back to. That entity is not
     purged.
   - Both cases are logged at `error`, returned as `anomalies`, and counted in the sweep summary.
   - `retentionScheduler#failureOf` makes a run with anomalies, per-tenant errors or export failures
     (`exportErrors`) a FAILED run, which `jobMonitor` alerts on.
   - `setRetentionPolicy` refuses a non-integer with 400 itself, not only through the route validator.
5. **The memory fallback is bounded** (`rateLimiter.redis.service.js`):
   - A sweep of expired entries runs every 60 s on an unref'd timer, which stops when the Map is empty.
   - The Map holds at most `RATE_LIMIT_MEMORY_MAX_KEYS` (100,000). Writing a new key at the cap evicts the
     entry written longest ago, because a write re-inserts its key.
   - Eviction is logged at `warn`, at most once a minute.
6. **A grace period needs a suspended tenant.** Any other state is a 409 that names the state and says to
   suspend first. Nothing is saved.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Route MQTT through RabbitMQ (the card's first suggestion) | brings prefetch and the DLQ, but it adds a hop and a second at-least-once system to a feature that is off on every deployment (A-17, A-29). The shared subscription removes the fan-out at the broker, and the cap gives the backpressure |
| An idempotency key on `iot_readings` (a producer-side message id, unique per device) | needs migration 0085 and a payload contract no device yet sends. Subscriptions are QoS 0, so the broker never redelivers, and the fan-out was the only source of duplicates. This is the right next step if QoS 1 ingest is wanted |
| Drop messages past a queue size | a dropped reading is lost environmental evidence. Withholding `done` loses nothing |
| A `gdpr_exports` table for the expiry | needs a migration, and the file and its expiry could still disagree after a restore of one without the other. A manifest next to the ZIP is the same durable fact, stored where the data is |
| Keep the timer as a fast path beside the sweep | two deletion paths, and the timer's path could not write the audit row in a tenant context without duplicating the sweep. The file is deleted up to one sweep interval late instead (below) |
| On a malformed retention value, keep the entity forever (the previous effective behaviour) | this is the defect. Keeping data longer than the tenant's policy, silently, is what W-16 reported |
| Refuse to purge the whole tenant on any malformed value | one bad key would stop the purge of the other entities, which is W-16 again in another shape |
| An LRU on reads for the rate-limit fallback | every read would reorder the Map. Write order is enough, because a live counter is written on every request |
| Refuse new keys at the cap | a refused key would be un-counted, which fails open for exactly the addresses a spray uses |
| Accept a grace period on an active tenant and clear it on suspension | it hides the operator's mistake. A 409 tells them the state |

**Implications, including the bad ones**

- **MQTT shared subscriptions need broker support.** Mosquitto 2, EMQX, HiveMQ and VerneMQ have it. A broker
  without it either refuses the subscription (logged as `IoT MQTT Subscribe Error`) or treats `$share/...`
  as a literal topic and delivers nothing. `MQTT_SHARED_GROUP=none` is then the setting, with one replica.
- **Shared subscriptions receive no retained messages** (MQTT 5 §4.8.2). A reading published as retained
  before the backend connected is no longer ingested on connect. That replay was one of W-14's own
  complaints.
- **Ingest throughput per replica is bounded** at `MQTT_INGEST_CONCURRENCY` concurrent database
  transactions. A sustained rate above that backs up in the broker, whose own queue limits then apply.
- **Still open on W-14:** no alert suppression window. A flapping sensor still raises one tenant-wide alert,
  and one audit row, per out-of-tolerance reading (ADR-069's implication stands).
- **A GDPR export can outlive its stated `expiresAt` by up to one sweep interval** (`RETENTION_SCHEDULER`,
  daily by default), and indefinitely if the retention scheduler is disabled. Before, a restart made it
  indefinite in any case.
- **Exports written before this change have no audit row on deletion.**
- **A GDPR export's creation is still not audited.** Only its expiry is.
- **The `downloadUrl` an export returns points at no route.** No `/gdpr/exports/:id/download` exists. This
  was true before this ADR and needs its own card.
- **A retention anomaly makes the job red every night until the setting is fixed.** Alerts repeat at most
  every `JOB_ALERT_REPEAT_HOURS`. That is intended.
- **At the rate-limit cap, the fallback under-counts.** An evicted counter, which could be a lockout written
  during the outage, restarts from zero. The cap is 100,000 keys, far above one process's normal key count,
  and it applies only while Redis is down.
- **The grace-period 409 is a new failure for any caller that set a grace period on an active tenant.** No
  frontend call site was changed here.

**Verified.**

- Unit suites: `iot.ingest.w14.test.js`, `gdpr.exportSweep.w15.test.js`, `dataRetention.policy.w16.test.js`,
  `rateLimiter.memoryBound.w19.test.js`, `tenantLifecycle.gracePeriod.w21.test.js`.
- Live, on PostgreSQL 18 (`pgvector/pgvector:pg18`, schema by `db.sync()` + every migration) and
  Mosquitto 2.1: `iot.sharedSubscription.w14.live.test.js`, `retentionExports.w15w16.live.test.js`.
- Fail-before: every one of those suites fails on `f0d7f08`, the tree before this change. Live, the old
  code stored **2** readings and **2** alerts per publish with two replicas, duplicated burst messages,
  and left the malformed-setting tenant's 200-day-old notification in place.
- Guards for the already-fixed cards: `jobMonitor.coverage.w13.test.js` (W-13) and
  `tenantHardDelete.w20.live.test.js` (W-20). Both pass on `f0d7f08`, because the fixes predate them.

**Status:** Accepted, implemented 2026-09-27.

---

## ADR-080: A TOTP Seed Is a KMS Envelope Bound to Its User; the Backup Status ENUM Is Not Widened, and Its Legacy Path Column Is TEXT

**Date:** 2026-09-27/28 · **Findings:** S-20, S-32 · **Migrations:** `0086`, `0087` · **Extends:** ADR-062 (5)

**Context**

- **S-20.** `users.mfa_secret` (the live TOTP seed) and `users.mfa_pending_secret` (an enrolment,
  A-114) were plaintext `VARCHAR(255)`. A `pg_dump` — `make backup` writes one, unencrypted — gave out
  every account's second factor. On `f0d7f08`, PostgreSQL 18, `setupMfa` stored the seed it returned
  byte for byte. The rest of the at-rest inventory was checked against the models (2026-09-27):
  `tenant_settings` secrets, `webhooks.secret` (A-51), `tenant_keys.private_key` (S-08) and custom-domain
  TLS keys are KMS envelopes; API keys, refresh tokens, IoT tokens (A-29), recovery codes (A-141) and
  e-mail OTP codes are hashes; `webauthn_public_key` and `webauthn_credential_id` are public material;
  `custom_domains.verification_token` is published in DNS by design. The TOTP seeds were what remained.
- **S-32.** The board row still said TODO, but the code had been fixed on 2026-09-24: the service uses
  only `status` ENUM members (restoring → `in_progress` claimed from `completed`; restored →
  `completed` + `restored_at`; deleting → `deleted` + soft delete in one transaction), the HTTP backup
  writes its `CREATE` audit row and stamps `expires_at`, and `backup_path` is no longer written. Left:
  the 255-character column, and completed backups taken over HTTP before the fix with no `expires_at`.

**Decision**

1. **A TOTP seed is stored only as a `kms.service` v2 envelope, with AAD `users.mfa:<userId>`**
   (`mfa.service#sealSecret` / `#openSecret`). The AAD is the **user** id, not the tenant id: a user's
   tenant can be null (the platform operator) and can change (a tenant move). Both columns share it, so
   `verifyMfaSetup` promotes the pending envelope unchanged. `consumeCode` opens whatever it is given, so
   every verify path (`loginMfa`, rotation, e-signature/certificate signing) is unchanged for callers.
2. **The User model refuses a plaintext seed** on every ORM write path — instance save, `bulkCreate`,
   static `update`, `upsert`. `hooks: false` is the only bypass.
3. **Migration `0086`** widens both columns to `TEXT` and seals every plaintext seed through
   `keyRotation.service#rewrapTarget` (optimistic write, re-read, decrypt-compare), soft-deleted users
   included. It **refuses** — naming the user id and column, never the value — a value that is not a
   base32 seed of at least 16 characters, or an envelope the ring cannot open; the transaction then
   leaves every row and both types as they were. `down` decrypts back to plaintext and restores
   `VARCHAR(255)` (the pre-0086 code reads nothing else), and refuses on a row it cannot open.
4. **`keys:rotate` and the boot KMS check cover the seeds.** `keyRotation.service` TARGETS gain
   `users.mfa_secret` and `users.mfa_pending_secret` with an `aad` derivation and a legacy converter
   (plaintext seed → envelope). The UPDATE predicate became `tenant_id IS NOT DISTINCT FROM`, since a
   user's tenant can be null. Reports carry `column`. `kmsVerify.util` decrypts its v1 sample under the
   target's AAD.
5. **S-32: the status ENUM is NOT widened.** `deleting`, `restoring` and `restored` would be values
   nothing writes; the model's `STATUS` stays exactly the ENUM (pinned by
   `tenantBackup.status.s32.test.js`). **Migration `0087`** makes `backup_path` `TEXT` (a legacy
   column, read as a fallback, no longer a trap for a future writer) and backfills `expires_at =
   created_at + retention_days days` for a `completed` row with none — the pruner's own rule. A row with
   no positive `retention_days` is left NULL: the pruner's fallback is a runtime setting, not guessed.
   `down` restores `VARCHAR(255)`, refusing while a longer path exists, and keeps the backfill (it equals
   what the pruner derived without it).

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Tenant id as the AAD, like every other envelope | null for the operator; a tenant move would make the seed unreadable |
| A different AAD per column | the promotion pending → live would have to decrypt and re-encrypt; binding to the column adds nothing an attacker with write access lacks |
| Encrypt transparently in model hooks (as `tenant_settings`) | the AAD needs the id on every static path, and a decrypting `afterFind` puts the plaintext in `toJSON`; an explicit seal plus a refusing hook fails closed |
| Accept only envelopes on read | a row restored from a pre-0086 dump would lock its user out; such a row is still sealed by the next `keys:rotate` or migration run |
| Add the three states to the ENUM (the card's wording) | the service was already fixed to ENUM members, and schema that no code writes is drift |
| Leave `backup_path` at 255 | nothing writes it today; the next writer would meet the same "value too long" |

**Implications — including the bad ones**

- **A seed now depends on the KMS ring.** A database restored without its `KMS_MASTER_KEY` fails MFA
  sign-in with a 500 (a misconfiguration, deliberately not reported as a wrong code), and the boot check
  (ADR-078) refuses first. `KMS_MASTER_KEY` escrow now also protects every second factor.
- **A legacy plaintext value still reads**, so the plaintext-refusing guarantee is on WRITE and on the
  data 0086 converted, not on arbitrary rows put in by hand with raw SQL.
- **0086 can refuse the boot** on a corrupt seed; the message says to reset that user's MFA.
- **Recovery codes stay SHA-256 hashes** (80-bit codes; A-141). E-mail OTP codes are unsalted SHA-256 of
  six digits — trivially reversible from a dump but valid only until `otp_expired_at`; not changed here.
- **`npm run migrate` did not exit** after `[migrate] up` on this run (Node 26, `tsx`); the migrations
  had applied. Not investigated here.

**Verification (PostgreSQL 18.6, `pgvector/pgvector:pg18`)**

- **Fresh boot and down/up**, `secretsAtRest.s20.live.test.js` (9 tests, `DB_APP_ROLE=callibrator_app`):
  `db.sync()` builds TEXT; every migration applies; schema and KMS verifiers pass; an upgrade from
  VARCHAR with plaintext seeds (operator with no tenant, soft-deleted user, pending enrolment) applies
  exactly 0086 and 0087; re-run is a no-op; down restores plaintext and VARCHAR(255); a non-seed is
  refused naming the user; as the application role the real-otplib path seals at setup, promotes, verifies
  the next code and refuses its replay; the model refuses a plaintext write; an HTTP-path backup is
  `completed` with `expires_at` and a `CREATE` row, and a delete succeeds with its `DELETE` row.
- **Upgrade from the real pre-change code:** `f0d7f08` built the schema and enrolled a user through its
  own `setupMfa` (plaintext stored); `npm run migrate` on `c905e74` applied 0086–0090; then, as
  `callibrator_app`: `verifySchema` no problems, `verifyKmsKeys` 3 envelopes and no problems, the pre-0086
  enrolment completed with a real code, the next code accepted and its replay refused; `pg_dump | grep`
  found none of the three seeds.
- Unit: `mfa.secretAtRest.s20`, `user.mfaSeedAtRest.s20`, `0086-user-mfa-secrets-kms-envelope`,
  `0087-tenant-backup-path-and-expiry`, `keyRotation.service.s08`, `mfa.realOtplib.a99`,
  `mfa.rotation.a114`, `auth.service` (setupMfa), `0028-user-mfa-pending-and-replay`,
  `kmsVerify.util.p705`. Fail-before on `f0d7f08`: every S-20 suite fails (34 tests).

**Status:** Accepted, implemented 2026-09-27/28.

---

## ADR-076: Node 26 Is Pinned Everywhere; TypeScript 7 Runs Beside the TypeScript 6 API; No `console.*` Outside Terminal CLIs; the Pre-Push Hook Installs Its Own Gitleaks; Unused Dependencies Are Removed

**Date:** 2026-09-27/28 · **Findings:** A-42, A-18, A-257, A-19 (remainder) · **Owner instructions:** 2026-09-27 (Node 26, every dependency to latest, TypeScript 7.0.2) · **Extends:** A-14, ADR-066, ADR-087

**Context.** Four hygiene cards, then two owner instructions on top of them. A-42 left 24 runtime `console.*` sites that bypass the winston logger and the A-14 redactor. A-18 listed unused dependencies. A-257: the suite silently breaks on the wrong Node major. A-19 left the pre-push hook without a way to get the scanner it runs. The owner then moved the target from Node 24 to **Node 26**, asked for every dependency at its latest release, and overrode the earlier TypeScript 6 hold: **TypeScript 7.0.2 in every workspace**. TypeScript 7 is the native compiler and ships **no JavaScript compiler API**. Its main export is `lib/version.cjs`, and only `typescript/unstable/*` is exported besides.

Most of this change was committed unverified in `a31c601`, when the owner committed every agent's in-flight edits. This ADR records what it contains, what was wrong in it, and the evidence.

### Decision

1. **Node 26, one source of truth (A-257).** The root `.nvmrc` is `26`, and `engines.node` is `>=26 <27` in all three manifests. Both Dockerfiles use `node:26.10.0-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80`; the digest was read from a real `docker pull`, not just from the Hub API. CI's `NODE_VERSION` is `26.10.0`. The pkg targets are `node26-linux-x64` and `node26-win-x64`. `@yao-pkg/pkg` 6.22.0 / pkg-fetch 3.6 publish node26 base binaries (v26.2.0 up to v26.8.1), so moving the binary to 26 was not a trade-off. The built binary embeds **v26.5.1**, the newest base its patch set covers, not 26.10.0. A jest `globalSetup` (`src/tests/setup/nodeMajor.globalSetup.js`) reads `.nvmrc` and refuses any other major with one message, before any suite runs.
2. **TypeScript 7 beside the TypeScript 6 API — the side-by-side layout the TypeScript 7.0 announcement recommends.** In both workspaces:
   - `"@typescript/native": "npm:typescript@^7.0.2"` is **the compiler**. `npm run typecheck` runs `node ../node_modules/@typescript/native/bin/tsc … --noEmit`. It is called by path because `node_modules/.bin/tsc` is claimed by **both** TypeScript 7 and TypeScript 6's nested `@typescript/old`, and npm linked 6.0.3 there. A bare `npx tsc` would silently check with 6. CI's frontend step and the pre-push hook now call `npm run typecheck`, and `backend/scripts/build-dist.ts` resolves `@typescript/native/package.json` for its `tsc`.
   - `"typescript": "npm:@typescript/typescript6@^6.0.2"` is **the API** for the tools that still need one. That is typescript-eslint 8.70.1, whose latest and canary releases both peer `typescript >=4.8.4 <6.1.0`; with TypeScript 7 installed as `typescript` it throws "typescript-eslint does not support TS 7.0" (probed). The others are `next build`'s own type-check step and ts-jest.
   - **`next build`** keeps its type-check. Next 16.3.6 loads `typescript/lib/typescript.js`, which the TypeScript 6 package provides, so `ignoreBuildErrors` is **not** set. The build is therefore gated twice: by TypeScript 6 inside `next build`, and by TypeScript 7 in `typecheck` (CI and `make verify`).
   - **Frontend jest: ts-jest stays, transpile-only.** `frontend/tsconfig.json` sets `isolatedModules: true`, so ts-jest calls `ts.transpileModule` and **type-checks nothing** (it never did). It needs only the TypeScript 6 API. next/jest (SWC) was tried and **refused**: it emits imports in ESM order, ahead of the module-scope mock objects 13 suites declare before their imports. Those 13 suites failed with "Cannot access 'x' before initialization"; the other 142 passed.
   - **Backend jest** keeps ADR-087's babel-jest with `@babel/preset-typescript`. It is now on **Babel 8** (8.0.1 presets, `@babel/core` 8.0.6). Babel 8 removed `allowDeclareFields` and throws on every `.ts` file when it is passed, so the option was deleted from `backend/jest.config.js`. `babel-jest` 30.5.2 loads the root `@babel/core` 7.29.7 with the Babel 8 presets. A probe `.ts` module with a `declare` field transformed and ran, and `jest.spyOn` on its export worked, which is ADR-087's reason for Babel.
3. **No `console.*` outside terminal CLIs (A-42).** The 24 runtime sites now log through `activityLog.middleware`'s `logger`, at the level the call used, with structured fields instead of interpolation. They are in `config/socket.js` (9), `backend/index.js` (2), `notification.service.js` (3), `sso.service.js` (1, a duplicate of the logger line beside it), `calibrationDevices.controller.js` (1) and migrations `0012` (4), `0032` (2), `0036` (1) and `0056` (1). `index.js`'s startup failure is now one redacted line with the stack, instead of an unredacted `console.error` of the whole error. There is no pre-logger boot exception: the logger requires only winston, winston-daily-rotate-file and a path helper, and loads before anything that logs. The guard `src/tests/guards/noConsole.a42.test.js` scans `backend/src` (tests excluded) and `backend/index.js` for **any** reference to the global `console`, with comments stripped and strings kept. The **allow-list** has seven entries:
   - the six terminal CLIs in `src/scripts/`: `backfillEmbeddings`, `breakGlassMfaReset`, `migrateStorage`, `rotateKeys`, `seedDemo`, `verifySchema`. Each must carry an in-file `// A-42 console-allowed:` comment;
   - `src/utils/checkMenu.util.js`, marked `pendingRemoval`. It is a module-load debug dump of every role and menu row with no caller; deleting it was refused by the permission system in this change, and is left to the owner.

   The guard also fails on a stale entry (a file that no longer exists or no longer uses the console), and on an allowed file outside `src/scripts/` that is not pending removal.
4. **The pre-push hook installs its own scanner (A-19).** `make hooks` now also runs `scripts/git-hooks/install-gitleaks.sh`. It installs gitleaks **8.30.1**, CI's version, into the git-ignored `.tools/bin`. The script carries the release's sha256 for linux, darwin and windows (x64 and arm64); the linux_x64 value is CI's own. It verifies the checksum before installing anything and is idempotent. The hook puts `$PWD/.tools/bin` first on its `PATH`: `$PWD`, not the `git rev-parse --show-toplevel` value, because on Windows that value is `C:/…` and its colon split the `PATH` entry. That was found by the test, not by review. The hook also ignores blank stdin lines and runs `npm run typecheck` for the frontend.
5. **Unused dependencies are removed (A-18).** The removals rest on a per-dependency grep of `require`/`import`/`jest.mock` specifiers and file mentions, plus a single-pass depcheck-style scan of each workspace (the scan's source is not committed):
   - **backend:** `acme-client`, `aedes`, `aedes-server-factory`, `clamdjs`, `fs-extra`, `randomstring`;
   - **frontend:** `@testing-library/user-event`, `@tiptap/extension-link`, `eslint-plugin-react` (it comes in through `eslint-config-next`), `jest-cli`;
   - **root:** `eslint-plugin-react`.

   `pg` and `pg-hstore` were kept: Sequelize's postgres dialect `require`s both. `nodemon`, `prettier`, `@yao-pkg/pkg` and `eslint` stay; the scripts use them. `backend/package.json` is renamed `express-boilerplate` → `callibrator-backend`, and its "Harvester" description is replaced. `build:bun` is gone (P9 had also dropped it). `ai.service#chunkText`'s comment had already been corrected.

   **Not done:** `backend/.eslintrc.js` is still present. It is ignored by ESLint 9, and its deletion was refused by the permission system together with `checkMenu.util.js`.
6. **Every dependency at its latest release, with two majors held.** The holds and their reasons:
   - **ESLint 9.39.5, not 10.11.0**, and `@eslint/js` 9.39.5, not 10.0.1, which must match it. `eslint-config-next` 16.3.6 brings `eslint-plugin-react` 7.37.5 (peer `eslint … ^9.7`), `eslint-plugin-import` 2.32.0 (`… ^9`) and `eslint-plugin-jsx-a11y` 6.10.2 (`… ^9`). None accepts ESLint 10, checked on the registry 2026-09-27. The root `overrides.eslint` stays 9.39.5.
   - **ts-jest 29.4.14** (peer `typescript <7`) runs on the TypeScript 6 package by design (item 2); it is not a hold on TypeScript.

   `npm-check-updates` reports nothing else outstanding. `npm audit`: **0 vulnerabilities**. `allowScripts` was reviewed. The one install script it does not name, `fsevents` 2.3.3, is darwin-only and optional, and was already in the lockfile before this change. Nothing new needs approval.
7. **The backend image runs `npm run build:dist` before `pkg`.** Phase 9 moved `package.json`'s `bin` to `dist/index.js`, and the Dockerfile in `a31c601` never built `dist/`. `pkg` refused with "Bin file does not exist": **the committed backend image did not build**. That was found by this change's `docker build`.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Keep the pkg binary on Node 24 while everything else moves to 26 | not needed: pkg-fetch publishes node26 bases. Two majors would make every "tested on" claim ambiguous |
| TypeScript 7 as `typescript`, and `--legacy-peer-deps` for typescript-eslint | typescript-eslint refuses to load at runtime ("does not support TS 7.0"), and Next's in-build check and ts-jest need `lib/typescript.js`. It installs and then breaks lint, the build and every test |
| npm `overrides` to nest TypeScript 6 under typescript-eslint only | npm refuses it with ERESOLVE: a peer cannot be split from the root's copy. Probed |
| `ignoreBuildErrors` in `next.config.ts`, with TypeScript 7 as the only checker | unnecessary: Next finds the TypeScript 6 API in the side-by-side layout, and it removes a gate for nothing |
| next/jest (SWC) for the frontend | 13 suites fail on import order (item 2). Rewriting them belongs to the frontend board's owner and would change what they test, for no type-safety gain: ts-jest already transpiles only |
| @swc/jest for the backend | ADR-087 already refused it: SWC's getter exports break `jest.spyOn` |
| Keep Babel 7 for the backend | the owner's instruction was latest. Babel 8's one breaking option is removed, and a probe proves the transform and `spyOn` |
| ESLint 10 now | three plugins that `eslint-config-next` pins peer ESLint ≤ 9 |
| A forced hook installed by `npm install` (A-19's original DoD) | ADR-066 refused it: a forced hook is the first thing people `--no-verify` |
| Allow-list the migrations for `console` | a migration runs **at boot**, inside the production process, and its output was the only record of an unsigned-signer or flagged-account report. It is exactly what the redactor and the JSON stream exist for |

### Implications, including the bad ones

- **Two TypeScripts are installed.** `typescript` means 6 and `@typescript/native` means 7. `npx tsc` means **6**: a developer who types it checks with the wrong compiler and gets no warning. Every committed entry point calls 7 by path. This lasts until TypeScript 7.1 ships an API and typescript-eslint supports it (typescript-eslint#10940). Then `typescript` becomes 7, `@typescript/native` goes, and ts-jest must be replaced or dropped.
- `next build` type-checks with **6**, `typecheck` with **7**. They can disagree, and a change must pass both.
- ts-jest and Babel type-check nothing. **Types are only as safe as the `typecheck` step**, and `make verify` is manual (CLAUDE.md).
- The backend jest transform mixes `@babel/core` 7 (babel-jest's) with Babel 8 presets. It works today, as probed. A babel-jest release that pins core 8, or a preset that asserts `api.assertVersion(8)`, would surface as every `.ts` suite failing to run.
- The binary runs Node **26.5.1** while the images and CI run 26.10.0. That is a patch-level gap, bounded by pkg-fetch's release cadence.
- The console guard is static. It cannot see `globalThis["con"+"sole"]`, and it does not police `process.stdout.write`.
- `checkMenu.util.js` and `backend/.eslintrc.js` remain until the owner deletes them.
- **Lint is red independently of this change.** The ratchet reports 1,061 errors against a baseline of 950, from files outside this change (migrations `0006`, `0007` and the e2e smoke suite). `notification.service.js:360`'s `curly` error dates from 2026-09-10. Every file this change wrote lints clean.

### Change record — evidence (Node v26.10.0, npm 12.0.1, tree at `c905e74` plus the working changes)

- **Backend:** `npm run test:coverage` → **637 suites passed (23 skipped), 12,775 tests passed (148 skipped), 100 % statements, branches, functions and lines**, exit 0. An earlier run the same day (626/633 suites, 17 failures) failed only in suites other agents had in flight (webhook, auth MFA, migration 0028, D-05's `kmsVerify.util.js`), plus the A-257 test, which still said 24 and was fixed.
- **Backend:** `npm run typecheck` (TypeScript 7.0.2) exit 0; `npm run build:dist` → 477 JavaScript files copied.
- **Frontend:** `npm run typecheck` (TypeScript 7.0.2) — 1,542 files, exit 0; a planted `const x: number = "no"` → TS2322, exit 1. `npx jest --ci --coverage` → **155 suites, 1,380 tests passed**, thresholds met (43.38 / 37.99 / 36.84 / 43.64). `npx eslint` → 0 errors, 60 warnings. `npx next build` → exit 0, "Running TypeScript … Finished".
- **Images** (built from the repo root, then removed):
  - `docker build -f backend/Dockerfile .` → exit 0 (after item 7). The container, with PostgreSQL 18 (pgvector), Redis 8.6 and an AMQP broker, answered **`GET /health` → 200 `{"status":"ok"}`**. Its `docker logs` were 45 lines, all JSON, none unparsed. RabbitMQ 3.13 itself would not start under this Docker Desktop (`.erlang.cookie: eacces`, even as root), so the broker was LavinMQ, an AMQP 0-9-1 server.
  - `docker build -f frontend/Dockerfile .` → exit 0. The container runs Node v26.10.0 and served `/login` 200.
- **Named tests:**
  - `src/tests/guards/noConsole.a42.test.js` (6): "flags every form of reaching the console"; "does not flag comments, other identifiers or object keys"; "no console.* in backend/src (tests excluded) or backend/index.js outside the reviewed allow-list"; "every allow-list entry still exists and still uses the console (no stale exceptions)"; "every allowed file carries the in-file marker comment, unless it is pending removal"; "every allowed file that is not pending removal is a CLI script under src/scripts".
  - `src/tests/guards/nodeVersion.a257.test.js` (14): the globalSetup refuses 24, 22 and 27 with the fix in the message, accepts any 26.x, refuses an `.nvmrc` that names no major, and is registered; the three `engines`, both Dockerfiles, CI's `NODE_VERSION` and every `setup-node`, and the pkg targets all name 26.
  - `src/tests/guards/prePushHook.a19.test.js` (11), all against the real hook in scratch git repositories: a gitleaks finding refuses the push, and the scan is exactly the pushed range; a clean push; a new branch as `--not --remotes`; a delete or empty input does nothing; a loud SKIP with no gitleaks; **with the real gitleaks, a generated AWS key in a pushed commit is refused and redacted**. Also: `make hooks` sets `core.hooksPath` and runs the installer; `.tools/bin` comes first on the `PATH` and is git-ignored; the installer pins CI's version and checksum; the checksum is verified before install; the hook is mode 100755.
  - Updated for the logger: `socket.test.js`, `socket.redisAdapter.live.test.js`, `calibrationDevices.controller.test.js`, `notification.service.test.js` (plus "A-42: a missing payload is logged through the logger and returns null"), and migrations `0032`, `0036`, `0056`.
- **Fail-before**, in a `git worktree` at `2acce51` (before `a31c601`) with the three guard files copied in: all three suites fail.
  - The A-42 guard names **exactly the 24 runtime sites** listed in item 3, and the marker check fails.
  - The A-257 suite fails on the absent `.nvmrc`.
  - The A-19 suite fails on the absent installer.

  The worktree was removed (the `node_modules` junction first, with `rm` on the link).
- **Console sites:** before, `backend/src` had 52 `console.*` lines outside tests. Two of those were comment mentions in migrations `0032` and `0036`, so 50 calls, plus 2 in `backend/index.js`: 52 calls in all. The 24 runtime calls were converted. After: 0 outside the allow-list, and 28 inside it (21 in the six CLIs and 7 in `checkMenu.util.js`).

**Dependency table** (ranges in the manifests; the lockfile resolves each to the newest matching release).

| Workspace | Package | Before (`2acce51`) | After | Hold / reason |
|---|---|---|---|---|
| root | `turbo` | `^2.11.3` | `^2.11.5` | |
| root | `eslint-plugin-react` | `^7.37.5` | removed | unused at the root |
| root | `eslint` (override) | `9.39.5` | `9.39.5` | **held**: see item 6 |
| backend | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | `^3.1139.0` | `^3.1141.0` | |
| backend | `@simplewebauthn/server` | `^14.0.2` | `^14.0.3` | |
| backend | `amqplib` | `^2.0.1` | `^2.1.0` | |
| backend | `dotenv` | `^18.0.3` | `^18.0.4` | |
| backend | `nodemailer` | `^10.0.10` | `^10.0.11` | |
| backend | `socket.io` | `^4.8.3` | `^4.8.4` | |
| backend | `acme-client`, `aedes`, `aedes-server-factory`, `clamdjs`, `fs-extra`, `randomstring` | various | removed | no reference in any code (A-18) |
| backend | `typescript` | — | `npm:@typescript/typescript6@^6.0.2` | the TypeScript 6 API for typescript-eslint (item 2) |
| backend | `@typescript/native` | — | `npm:typescript@^7.0.2` | the compiler |
| backend | `@babel/core`, `@babel/preset-typescript`, `@babel/plugin-transform-modules-commonjs` | — | `^8.0.1` | ADR-087's transform, Babel 8 |
| backend | `@types/express` `^5.0.6`, `@types/jest` `^30.0.0`, `@types/node` `^26.6.3`, `tsx` `^4.23.15`, `typescript-eslint` `^8.70.1` | — | added by P9 | typescript-eslint peers TypeScript < 6.1 |
| backend | `@eslint/js`, `eslint` | `^9.39.5` | `^9.39.5` | **held**: 10 needs every plugin on ESLint 10 |
| frontend | `motion` | `^13.4.3` | `^13.4.4` | |
| frontend | `socket.io-client` | `^4.8.3` | `^4.8.4` | |
| frontend | `@types/node` | `^26.6.2` | `^26.6.3` | |
| frontend | `ts-jest` | `^29.4.13` | `^29.4.14` | peer TypeScript < 7: runs on the TypeScript 6 package |
| frontend | `typescript` | `^6.0.3` | `npm:@typescript/typescript6@^6.0.2` | the API for Next, ts-jest and typescript-eslint |
| frontend | `@typescript/native` | — | `npm:typescript@^7.0.2` | the compiler |
| frontend | `@testing-library/user-event`, `@tiptap/extension-link`, `eslint-plugin-react`, `jest-cli` | various | removed | unused; `eslint-plugin-react` comes through `eslint-config-next` |
| frontend | `eslint` | `^9.39.5` | `^9.39.5` | **held**: as above |

**Docs amended (deviation protocol):**
- Node 24 → 26: `docs/DEVOPS/02-CONTAINERIZATION.md` (image table, snippets, the `build:dist` step), `docs/ARCHITECTURE/03-BACKEND-ARCHITECTURE.md`, `docs/ARCHITECTURE/08-DEPLOYMENT-ARCHITECTURE.md`, `docs/BACKEND/00-BACKEND-STANDARDS.md`, `docs/ENGINEERING/02-PROJECT-STRUCTURE.md`, `docs/FRONTEND/11-BUILD-AND-BINARY.md`.
- The hook: `docs/DEVOPS/01-CI-CD.md` and `docs/DEVOPS/11-MAKEFILE-REFERENCE.md`.
- The console rule: `docs/ENGINEERING/12-LOGGING-CONVENTIONS.md`.
- **Not amended:** `docs/ARCHITECTURE/11-DUAL-BACKEND-ARCHITECTURE.md` still says Node 24; it is ADR-089's document, left to its owner.

**Status:** Accepted, implemented 2026-09-27/28, uncommitted in the working tree (no agent commits).

---

## ADR-078: A Restore Under the Wrong KMS Key Refuses to Boot; Two Secrets Are Escrowed, the Rest Regenerated; a Dump Restores Role First; a Soft-Deleted Device Keeps Its Serial

**Date:** 2026-09-28 · **Cards:** P7-04, P7-05, P6-10, P6-06 · **Record:**
`MEMORY/records/2026-09-27-p7-04-restore-drill.md` · **Migration:** none (0083 not used)

**Context**

No restore had ever been performed (P7-04). The documents named `CERT_SIGNING_SECRET` and
`ENCRYPT_KEY` as the secrets that end recoveries and left `KMS_MASTER_KEY` out; the rotation runbook
had met only seeded data (P6-10); and whether a soft-deleted calibration device holds its serial
number was an open decision (P6-06). The drill ran all four on one throwaway compose stack
(`-p callib-drill`, PostgreSQL 18, the backend image built from the release): two tenants with
devices, calibration records, signed certificates with rendered PDFs, attachments, e-signatures,
webhooks, an SSO secret and an MFA-enrolled super administrator; `make backup`'s `pg_dump`, a tarball
of the upload/storage/backup volumes, the tenant backup through the API and the secrets taken
separately; every volume and the `.env` destroyed; the documented restore followed; the checklist
asserted before and after.

What it found:

- **D-1** — the backend image cannot render a certificate PDF: `pkg` does not package the ESM
  `puppeteer-core` (`ERR_MODULE_NOT_FOUND …/puppeteer-core/lib/puppeteer/api/Browser.js`), so
  `POST /certificates/:id/pdf` answers 500. The drill rendered the PDFs with the same service code on
  the host. `--fallback-to-source` and adding the packages as `pkg` assets did not fix it. **Open.**
- **D-2** — PostgreSQL ran crash recovery twice under load: the postmaster was PID 1 and treated a
  killed health check's `pg_isready` as a crashed child ("untracked child process … exited with exit
  code 2"), terminating every session. **Fixed:** `init: true` on the compose `postgres` service.
  (RabbitMQ showed the same shape at teardown: a zombie that could not be stopped.)
- **D-3** — a tenant backup taken through the API contained **no users**: the validator and the UI
  send `"FULL"`, the export compared against `"full"`. Both drill archives held the tenant row and
  `"users": []`. **Fixed** (`tenantBackup.service.js#isBackupType`). Separately, a "full" tenant backup
  is the tenant row and its users and nothing else — the documents said "an admin deleted a warehouse
  and wants it back".
- **D-4** — a dump restored into a new cluster fails on every `GRANT … TO callibrator_app` (roles are
  cluster-wide and not in `pg_dump`); `pg_restore` exits 1 with "errors ignored", and the backend then
  refuses to boot with `role "callibrator_app" does not exist`. **Fixed in the procedure:** create the
  role (and grant it to the owner) before `pg_restore --exit-on-error`.
- **D-5** — the documented restore order put the secrets fourth; nothing, PostgreSQL included, starts
  without the `.env` they live in. **Fixed in the procedure.**
- **D-6** — **a restore under a new `KMS_MASTER_KEY` starts cleanly without the boot check** (measured with
  it switched off, `KMS_VERIFY=warn`, which is the boot as it was before this ADR): `/health` 200, sign-in without
  MFA, every list, public certificate verification — and then 500 on every e-signature and every MFA
  sign-in (the super administrator, who must have MFA, is locked out). The two "bold" checks the
  documents said would catch a lost-secrets restore both passed. Replacing `CERT_SIGNING_SECRET`,
  `ATTACHMENT_URL_SECRET` and both JWT secrets, and removing `ENCRYPT_KEY`, broke **nothing** (the
  checklist was identical apart from the probe devices).
- **D-7** — `npm run migrate:status` (tsx, Node 26) printed its queries and never exited (killed by a
  timeout, twice). `keys:rotate` exited normally. **Reported, not fixed.**

**Decision**

1. **Every boot verifies the KMS key ring against the database, and refuses on a miss (P7-05, D-6).**
   `utils/kmsVerify.util.js`, called in `index.js` after the schema verification. For each column
   `keys:rotate` re-wraps (`keyRotation.service` `TARGETS`, the MFA seeds included since S-20) it
   groups the `v2:` envelopes by key id and requires every id to be in the ring; it decrypts one `v1:`
   envelope per column as a sample, under `aadOf(target, row)`. It reads key ids and counts, never a
   value it keeps. It is raw SQL across every tenant by design — listed in
   `rawSqlTenantPredicate.d05.test.js` `CROSS_TENANT` with that reason. `KMS_VERIFY=warn` logs every
   problem at error level and continues; it exists for the recovery in which the key is known lost.
2. **Two secrets are escrowed; everything else is regenerate-on-loss (P7-05).** `KMS_MASTER_KEY` —
   and every previous master key a retained backup is under — and, while a pre-0058 backup is kept,
   `ENCRYPT_KEY`. Separately from the database and the host, by key id, verified whenever a backup is
   verified. `docs/SECURITY/14-SECRET-ESCROW.md`.
3. **The restore order is: secrets and `.env`, PostgreSQL alone, the database (role first for a
   dump), the objects, then the application** (D-4, D-5). `docs/DEVOPS/04-DATABASE-BACKUP.md`.
4. **The key rotation is rehearsed on the restored drill data (P6-10)** — `docs/SECURITY/13` § Rehearsal
   against the drill data. The P6-10 DoD's "copy of production data" is still owed; the drill data is
   realistic in shape, not in volume.
5. **The serial-number index stays whole-table: a soft-deleted device keeps its serial (P6-06).** No
   migration; 0083 is not used.

   | | Argument |
   |---|---|
   | **Compliance** | A serial number identifies a physical instrument. A soft-deleted device is still the anchor of calibration records and certificates, which are append-only evidence (ADR-062) and whose public verification prints the serial (`verifyByCertificateNumber`). With a partial index, a second live row could take the serial, and "which device is `SN-123`" gets two answers inside one hospital — one of them carrying the history. ADR-049 already refused to let a migration decide which record is right; a partial index would let every user do it |
   | **Operability** | A returned or re-acquired device must be registrable. With the whole-table index the create is a 409 — but since A-133 (ADR-075) that 409 names the deleted device's id and the administrator restores it, which brings its calibration history back with it. That is the correct outcome for the *same* physical device. The residual cost: a deleted device registered under a **wrong** serial blocks that serial until it is restored and corrected — rare, and resolvable in the application |
   | **Decided** | Compliance, because operability's case is served by restore. The DoD's "partial on `is_deleted = false`" item is closed as decided against |

   **Combined with A-133 (ADR-075), as measured on the drill stack:** create a device, delete it,
   create the same serial again → **409** "held by a deleted calibration device … restore that device
   (id …)"; the same serial in the other tenant → **201**; the other tenant restoring it → **404**;
   restore → **200**; restore again → **409** "not deleted". A-133's "a live device now holds its serial"
   409 cannot occur while the index is whole-table (no second row can hold the serial); it stays as the
   backstop it describes itself as, and its comment's "possible once the serial index is partial" is
   now a condition that was decided against.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Check the KMS key by decrypting every envelope at boot | boot time grows with the data, and the key id already answers the question for every `v2` value without touching plaintext |
| Refuse only when **no** envelope decrypts | a half-restored ring (one key of two) would boot and fail on the other half |
| Warn at boot instead of refusing | the failure mode being fixed is exactly a boot that looks fine; `KMS_VERIFY=warn` is the explicit opt-out |
| Put the KMS check in `/health` | `/health` is polled and cached, and a health check that turns red after the boot has already let traffic in |
| Escrow every secret in the inventory | escrow is a cost and a risk; the drill measured that only the KMS key (and the legacy key) are unrecoverable, and the rest are cheaper to regenerate than to guard |
| A `make restore` target | it would encode a procedure rehearsed once, on compose only; written down first, automated after the second drill |
| Include roles in the backup (`pg_dumpall --roles-only`) | it carries the owner's password hash and cluster-wide roles of other databases; creating the one role the application needs is smaller and explicit |
| Partial serial index (P6-06, the DoD as written) | see decision 5 |
| Unique on `(tenant_id, manufacturer, model, serial_number)` | the honest answer to "two different instruments share a serial"; a schema and UI change nobody has asked for yet. Open decision |

**Implications — including the bad ones**

- **A database with a value under a key nobody has refuses to boot.** Before, it served everything but
  that value. A deployment carrying one orphaned webhook secret now needs `KMS_VERIFY=warn` or a
  re-issue before it starts.
- **Every boot runs five grouped queries over five columns** (plus a sample decrypt per column with v1
  rows). Measured on the drill: not noticeable; not measured at production volume.
- **The escrow is a procedure.** Nothing enforces that it exists or audits reads of it; there is no
  external KMS.
- **D-1 is open: the shipped image cannot render certificate PDFs.** Signing works; the document does
  not. This is a release blocker for certificates and belongs to the image/packaging owner.
- **RPO is the dump's age.** Nothing configures WAL archiving; the 1-hour RPO in
  `docs/ARCHITECTURE/09` was marked "yes" and is not achievable as shipped.
- **The RTO was measured once**, on compose, with a small data set: 234 s from restore start to
  `/health` 200, of which ~110 s was the first attempt's missing-role failure. Kubernetes and
  production volume are unmeasured.
- **A soft-deleted device's serial stays reserved** until an administrator restores it.

**Verification**

- Drill, PostgreSQL 18 (`pgvector/pgvector:pg18`), compose project `callib-drill`, backend image from
  `c905e74`: pre-incident and post-restore checklists (`04-check.js`) **identical** — per-tenant counts
  (A: 8 devices / 16 records / 5 certificates / 8 attachments; B: 6 / 12 / 3 / 6), no foreign rows,
  cross-tenant device 404, every certificate `valid` with the same integrity hash and a byte-identical
  document, every attachment byte-identical through a fresh signed URL, both e-signatures valid;
  audit trail: the 134 rows up to the dump identical (md5 digest), migrations pending 0 of 63.
- Wrong KMS key: `[kms-verify] UNREADABLE` for `tenant_keys.private_key` (5), `tenant_settings.value`
  (2), `users.mfa_secret` (1), `webhooks.secret` (4), `[kms-verify] FAILED`, no `/health`, restart loop.
- Rotation rehearsal: 12 envelopes re-wrapped, failed 0; after the previous key was removed, an old
  TOTP seed verified a real code, old and new e-signatures verified.
- Tests: `kmsVerify.util.p705.test.js` (9; fails at `2acce51`: the module does not exist),
  `tenantBackup.backupType.p704.test.js` (4; the "FULL" and "USER_ONLY" cases fail at `c905e74`),
  `tenantBackup.service.test.js` (mock corrected to the model's real `BACKUP_TYPES`),
  `rawSqlTenantPredicate.d05.test.js` (the `CROSS_TENANT` entry),
  `dataIntegrity.p6.live.test.js` "ADR-078: a soft-deleted device keeps its serial — the index is NOT
  partial on is_deleted" (opt-in live: the suite ran 22 of 22 green on a scratch `pgvector/pgvector:pg18`,
  2026-09-28, the new case included).

**Status:** Accepted, implemented 2026-09-27/28, uncommitted in the working tree (no agent commits).

---

## ADR-085: A Token That Names No Session Is Refused, and an Open Socket Is Re-Checked Every Minute; a Webhook Secret Rotates With a Bounded Overlap and Is Never Accepted From a Caller; Audit Rows Have One Write Path; the Coverage Figure States Its Scope

**Date:** 2026-09-27/28 · **Findings:** P6-11, P6-12, P6-13, P6-14 (with A-41, A-48, A-59, A-51, A-32) · **Extends:** ADR-051 Q-13 (A-124), ADR-054, ADR-062, ADR-070

**Context.** The four Phase 6 cards P6-11 to P6-14 each had an audit card (A-41, A-48, A-51, A-32)
closed on 2026-09-24/25, and each carried Definition-of-Done items the audit card did not: revocation
for sockets and sid-less tokens, a rotation overlap, a caller secret *refused* rather than dropped,
the coverage figure's scope written down. Working them found one live defect: every webhook rotation
and every webhook url change **failed on PostgreSQL** — `webhook.service.js` wrote its audit row with
`AuditLog.create` and no `actorType`, a column NOT NULL since migration 0033 (A-124). The unit tests
mocked `AuditLog.create`, so they passed. Proved on a pre-change worktree (`f0d7f08`) against
PostgreSQL 18.6: `SequelizeValidationError: notNull Violation: AuditLog.actorType cannot be null`.

**Decision**

1. **An access token without `sid` is refused (P6-12).** `SIDLESS_ACCESS_TOKENS_ACCEPTED` is `false`.
   Every issuer has set `sid` since A-59; the VM has run that code since the 2026-09-24 deploy
   (`87de9bf`) with a 1-day token lifetime, so no valid sid-less token remains and the flip signs
   nobody out. A socket token without `sid` is refused at the handshake too.
2. **An open socket is re-checked every 60 s (P6-12).** `config/socket.js#checkPrincipal` is the
   handshake check (live session, active user, tenant neither suspended nor deleted), and a per-socket
   `setInterval` re-runs it and disconnects a socket that fails. A re-check that *errors* keeps the
   socket. This is not a stricter rule than HTTP (Q-08) — it is the same rule, applied while open.
3. **The revocation window is named in `docs/SECURITY/03-AUTHENTICATION-SECURITY.md`:** the next
   request through the model hooks; at most 60 s when the hooks are bypassed or Redis was away; at most
   60 s for an open socket. `JWT_ACCESS_EXPIRED` bounds only an unrevoked stolen token.
4. **The liveness cache key stays `session:live:<sid>`, without the tenant id** — an exception to the
   task conventions' rule. The check runs before any tenant is resolved, the token carries no tenant
   claim, the sid is a server-generated primary key, and the cached entry is bound to the user id,
   compared on every read.
5. **A caller-supplied webhook `secret` is refused with 400 (P6-13)**, on create, patch and rotate
   (`Joi.any().forbidden()` with a message). Stripping it silently was the card's named abuse case.
6. **Rotation has a bounded overlap (P6-13).** `POST /webhooks/:id/rotate-secret` takes
   `overlapHours` (0–168, default 24). The replaced secret is kept as its KMS envelope in
   `webhooks.previous_secret` (migration **0090**, with `previous_secret_expires_at`), and while the
   window is open every delivery also carries `X-Webhook-Signature-Previous` under it. `0` ends the old
   secret at once. Rotating inside a window replaces the previous one: one old key at most. A url
   change rotates with **no** overlap and clears any previous secret.
7. **Webhook create, patch, rotate and delete write their audit row through
   `audit.service#logAction` inside their transaction**, naming the actor. An actorless change is
   refused (A-124), and rolls back.
8. **`audit.service#logAction` is the only writer of `audit_logs` (P6-11).** Pinned by
   `auditInTransaction.p611.test.js`, with every call passing a transaction except two named file
   writes. `auditLog.middleware.js` has no caller; nothing compliance-bearing depends on it. The
   covered set is re-stated as an addendum to `MEMORY/specs/A-41-audit-inside-transaction.md`.
9. **The coverage figure is 100% of six layers (P6-14):** controllers, middlewares, routes, services,
   utils, validators. The phantom `src/app.js` is removed from `collectCoverageFrom`; `backend/index.js`
   is excluded with a written reason, its boot covered by CI `boot-and-migrate` and
   `liveContract.smoke.test.js`. A new `istanbul ignore` is reviewed like an `eslint-disable`
   (`docs/ENGINEERING/14-CODE-REVIEW-CHECKLIST.md`). Pinned by `coverageScope.p614.test.js`.
10. **`SENSITIVE_KEYS` is not extended for webhooks.** The name now belongs to `tenant_settings`
    (`constants/tenantSecretSettings.js`); the webhook secret is a column of its own, already a KMS
    envelope (A-51), and `secret`/`previousSecret` are caught by both the log redactor
    (`activityLog.middleware.js`) and the audit redactor (`auditRedaction.util.js`).

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Keep accepting sid-less tokens "for compatibility" | nothing issues them any more; the only ones left are unrevocable, which is the defect |
| Disconnect sockets from the revoke path (a `session:<sid>` room and `disconnectSockets`) | exact, but covers only revocation through the service; a suspended tenant, a banned user or a raw-SQL revoke would still be missed. The interval covers all of them with one rule. It can be added later as a fast path |
| A shorter `JWT_ACCESS_EXPIRED` as the control | revocation is enforced per request; the lifetime is now a secondary bound, and the VM value is an operator change (open, below) |
| Multiple signatures in one header (`v1=a,v1=b`) | breaks every receiver written from the current recipe, which compares the whole header |
| Sign with the OLD secret until the window ends | a receiver that has switched early fails for the whole window |
| No overlap (the A-51 behaviour) | every rotation is a coordinated cut-over, and a rotation after a leak is an outage |
| Mock `audit.service` in the webhook tests | a mock of the audit write is how the actorType defect shipped; the tests now run the real `logAction` over a mocked model, and a live PG18 test runs it for real |
| Delete `auditLog.middleware.js` now | correct in principle (A-32: dead code is deleted), but P9-19 names the file; left to that card |
| Measure `index.js` in the unit gate | it can only be exercised by mocking every router, the ORM and the migrator — a number, not evidence |

**Implications, including the bad ones**

- **Any client still holding a pre-A-59 token is signed out** on the next deploy. By the dates above
  there are none.
- **An open socket costs one liveness check (Redis) and one user read per minute.** Thousands of
  sockets means thousands of reads a minute; the interval is a constant to tune, not a setting.
- **A socket keeps receiving events for up to a minute after revocation.** Named, not hidden.
- **Integrators who sent a `secret` now get a 400** where they got a 201. That is the point, and it
  is a contract change: `docs/WEBHOOK/03-WEBHOOK-SECURITY.md` and the swagger say so.
- **During an overlap two keys sign every delivery.** A leaked old key stays useful until the window
  closes — which is why `0` exists, and why the maximum is a week.
- **An actorless webhook change is refused.** No such caller exists; a future system job that manages
  webhooks must pass a `systemActor`.
- **`GET /webhooks` gains `previousSecretExpiresAt`.** The frontend does not show it yet, and has no
  rotate button (F-18, frontend board).
- **Services with no audit row at all remain** — `apiKey`, `kanban`, `ticket`, `vendor`, `warehouse`,
  `finance`, `risk`, `featureFlag`, `notification`, `content`, `supplierScorecard`, `meteredBilling`,
  `oidcProvider`, `webauthn`, `ai`. CLAUDE.md says every mutation; whether each is in the compliance
  scope is open on P6-11.
- **The VM's `JWT_ACCESS_EXPIRED` was `1d`** at the last read; the repository says `15m`. Aligning it
  is an operator action on the VM, open on P6-12.

**Tests** (fail-before on a `f0d7f08` worktree, 2026-09-28: 25 of the P6 tests below fail there; 3 more `socket.test.js` failures there belong to the A-42 logger change, not to this ADR):
`auth.tokenPurpose.a59.test.js` "P6-12: an access token without sid is refused",
`auth.sessionRevocation.a48.test.js` "P6-12: a token that names no session is refused…",
`socket.test.js` "P6-12 — an open socket stops when its principal stops" (7) and "P6-12: rejects a
socket token that names no session", `webhook.validator.test.js` "P6-13: REFUSES a caller-supplied
secret…" and `rotateWebhookSecretSchema` (4), `webhook.secret.a51.test.js` "P6-13 — rotation with an
overlap window" (5, incl. "no secret … reaches a response body, a log line or audit_logs.changes"),
`webhook.service.test.js`, `webhook.controller.test.js`, `webhooks.twoTenant.test.js` (every `:id`
route 404 cross-tenant), `auditInTransaction.p611.test.js` (5), `coverageScope.p614.test.js` (4), and
the opt-in live `0090-webhook-secret-rotation-overlap.p613.live.test.js` (5, PostgreSQL 18.6: fresh
boot through the real migrator, upgrade from a pre-0090 schema with a live row, re-run no-op, down and
up again, and a rotation and url change writing real audit rows).

**Status:** Accepted, implemented 2026-09-27/28. Part of it reached `a31c601` unverified (committed by
the owner with every agent's in-flight edits); the fixes and tests above are in the working tree.

---

## ADR-083: A Deleted Attachment's File Is Swept After 90 Days; Attachment Types Come From One List; a Kanban Project's Delete Reaches Its Cards' Files; Unbounded Reads Are a Reviewed List; ENUM Mirrors and Soft-Delete Mechanisms Are Checked, Not Converted

**Date:** 2026-09-27/28 · **Findings:** D-22, D-24, D-25, D-26, D-29 (`TASKS/AUDIT-2026-09-DATA.md`) · **Extends:** ADR-064 (items 8, 9, 10), ADR-070, ADR-060, ADR-075 (A-133 restore) · **Migration:** `0088-attachment-file-purged-at`

**Context**

ADR-064 and ADR-070 left five data-layer items partial:

- **D-22.** A parent's soft delete soft-deletes its attachments and keeps their files, so a restore can bring them back (ADR-070). Nothing ever removed those files afterwards. `resource_type` was still a free string on an upload without a `resourceId`. Deleting a kanban **project** did not reach its cards' files, because the cards stay live behind the deleted project.
- **D-24.** Nothing stopped a new unbounded `findAll`. `dataRetention`'s whole-dataset anonymise read had since been removed (A-152). Its subject-masking read (`maskAuditTrail`) still read a data subject's whole audit history in one statement.
- **D-25 and D-26.** ADR-064 recorded the decisions: paranoid for new models, and native ENUMs stay. It did not add the checks those decisions need.
- **D-29.** Migration 0019 had two residual risks: the `context.queryInterface || context` fallback, and index detection by name only.

**Decision**

1. **The deleted-file sweep (D-22).** This is `services/attachmentFileSweep.service.js`.
   - **What it selects.** A row that has been deleted for longer than the window. That means `is_deleted = true` with `updated_at` before the cutoff, or paranoid `deleted_at` before the cutoff. The row's new `file_purged_at` (migration 0088) must also be NULL. A live row is never selected.
   - **Window.** `ATTACHMENT_FILE_RETENTION_DAYS` sets it. The default is **90** and the floor is 30. The window is the time a parent's restore can still bring the files back.
   - **What it removes.** It removes the legacy disk file, which is resolved through `attachment.service#resolveAbsPath` (the S-15 guard). A path outside the uploads tree is recorded as `outside-uploads`, and nothing is removed for it. If the row was migrated into pluggable storage, its storage object is removed too.
   - **What it records.** It sets `file_purged_at`. It writes one audit row **per attachment** in the batch's transaction: action `DELETE`, `changes.operation = "file-purge"`, `changes.file` = `removed` | `absent` | `outside-uploads`, and actor `system:attachment-file-sweep` (a new `SYSTEM_ACTORS` entry).
   - **How it interacts with restore.** The rows are locked (`FOR UPDATE SKIP LOCKED`). The purge row becomes the attachment's latest DELETE, so `restoreForResource` (ADR-075) leaves a row whose bytes are gone deleted.
   - **Failures.** A file or object that cannot be removed is logged and counted. It is not marked, and the next run retries it.
   - **Bounds.** The sweep runs tenant by tenant under `runForTenant`, walking each tenant by keyset on id. It takes 200 rows per transaction and at most 5,000 examined per run, and says when it stopped early. Tenants are also read 500 per page.
   - **Schedule.** Daily at 04:13 (`ATTACHMENT_FILE_SWEEP_SCHEDULER`) through `scheduleSetting`, so `SCHEDULERS_ENABLED=false` stops it. It is registered with the job monitor (`attachment-file-sweep`). It is off in the chart's API-pod branch and listed in both `.env.example` files.
2. **One list of attachment types (D-22).** `constants/attachmentResources.js` holds the list:
   - `LINKABLE_RESOURCES`, moved there from the service unchanged;
   - the standalone types `generic`, `ticket` (the ticket editor's images) and `post` (kept for older clients).

   Matching ignores case. `createAttachment` refuses any other type with a 400 that names the list, for linked and unlinked uploads alike. The check runs before the virus scan, and the uploaded file is removed. The model validates the same list (`knownResourceType`) on every create path. It validates only when the column is written, because `save()` validates only changed attributes, so a legacy row with another value can still be soft-deleted. There is **no database CHECK**: see the alternatives.
3. **A kanban project's delete reaches its cards' files (D-22).** `kanban.service#deleteProject` destroys the project in a transaction. It reads the project's live cards by keyset, 500 at a time, and calls `softDeleteForResource(tenant, "KanbanCard", [card ids], { via: { type: "KanbanProject", id } })`.
   - `softDeleteForResource` now accepts an array of parent ids. Each audit row still names its own card in `changes.cascade.id`, with the project as `changes.cascade.via`, so a card restore would still restore exactly its files.
   - The cards themselves stay live, unreachable behind the deleted project, as before.
4. **Unbounded reads are a reviewed list (D-24).** `unboundedFindAll.d24.test.js` parses every file under `src/services` with espree. It finds each `.findAll(` whose options carry no `limit`, keyed as `<file>::<enclosing function>::<receiver>` with a count.
   - Each such read must be on `REVIEWED` with a reason from a fixed set: parent-bounded, fixed keys, caller's ids, aggregate, closed set, operator script, or **OPEN**.
   - OPEN means the read grows with the tenant. There are 24 such entries. They are listed so they cannot multiply unseen. Each is a follow-up, not an endorsement.
   - A new site fails the test, and so does a stale entry.
   - `dataRetention#maskAuditTrail` now reads by keyset on id, 500 at a time, inside its one transaction.
5. **ENUM mirrors are checked, not derived (D-26).** Native ENUMs stay, per ADR-064. `enumMirrors.d26.test.js` reads all 48 ENUM attributes from the real models. Each must appear in a registry that names what mirrors it:
   - **a constant**, which must be equal and in the same order: 7 such, including `AUDIT_ACTIONS`, `ACTOR_TYPE_VALUES`, the QMS lists, `TENANT_STATUS` and the Certificate/TenantBackup statics;
   - **a validator**, whose Joi `.valid` list on the key must hold only storable values, and all of them where marked `equal`;
   - **none**, with the reason.

   `dataLayer.dbD.live.test.js` compares every model's labels with `pg_enum` for the column's type, in order, on PostgreSQL 18. No drift exists today.
6. **The soft-delete split is pinned, not converted (D-25).** `softDeleteMechanisms.d25.test.js` pins what exists today:
   - the 12 models that carry both `is_deleted` and paranoid `deleted_at` (`ApiKey`, `Attachment`, `CalibrationDevice`, `CalibrationRecord`, `Category`, `Post`, `Role`, `Stock`, `Tenant`, `User`, `Warehouse`, `Webhook`);
   - the one model that carries only the flag (`Session`).

   A new flagged model fails the test: use paranoid. On every flagged model the defaultScope filters `is_deleted = false`. A default read is therefore live only when both flags say so. The application's soft delete writes `isDeleted`, and `deleted_at` is set only by `destroy()`.
7. **D-29, both risks.**
   - **The fallback.** The contract is now tested: the manifest passes `db.getQueryInterface()`, a real QueryInterface has no `.queryInterface`, and the fallback is frozen to the 16 migrations that carry it. The 16 are not edited, because they are applied and frozen by name.
   - **Index detection.** 0019 now recognises the signing-key index by name **or** by a single-column index on `signing_key_id`. This changes nothing on a database that ran it.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Unlink the file in the cascade itself | ADR-070 already rejected it: it destroys draft evidence at once and makes a restore impossible |
| Mark swept rows only by the audit trail (`NOT EXISTS` over `audit_logs`) | a raw anti-join over the largest table on every run; a nullable column is cheaper, indexed by the tenant key, and survives audit masking |
| Remove the bytes after the transaction commits (as `deleteAttachment` does) | a failed unlink would leave a row marked purged whose bytes remain, and nothing would look again; unlinking first leaves at worst an unmarked row the next run records as `absent` |
| One summary audit row per batch (as the webhook purge does) | the per-row DELETE row is what stops a later restore from reviving a row with no bytes, and it names the file |
| A database CHECK on `resource_type` | a CHECK is evaluated on every UPDATE of a row, so a `NOT VALID` constraint would make soft-deleting any legacy row with another value fail; rewriting legacy values needs to know what a typo meant |
| Soft-delete the kanban project's cards too | no restore exists for a project; the cards are already unreachable, and deleting them adds rows to reason about without a reader |
| Derive each ENUM from its constant at model definition (D-26) | 41 of 48 enums have no constant; for the seven that do, the test proves equality today, and deriving changes model files every agent edits for no behaviour change |
| Convert the 12 dual models to paranoid only (D-25) | touches every service that writes `isDeleted`, `search.service`'s raw SQL, the orphan report, the attachment cascade and restore, and the append-only `calibration_records` trigger; a behaviour change for every `restore`. Deferred, not rejected |
| Delete the `context.queryInterface \|\| context` line from the 16 migrations (D-29) | a no-op on every path; editing sixteen applied migrations adds diff and review for nothing the test does not already hold |

**Implications, including the bad ones**

- **After 90 days, a parent's restore gets its rows back but not its files.** The restore leaves swept rows deleted, so nothing points at missing bytes. The evidence is still gone.
- Rows that `deleteAttachment` deleted explicitly already had their files unlinked. The first run records each of them as `absent`, a one-time backlog of audit rows bounded at 5,000 per run.
- **A narrow race remains.** If a restore reads the audit trail before the sweep's lock and updates after it, it can revive a row whose file was just removed. `restoreForResource` locks the rows before reading, which closes the ordinary interleavings.
- **Case-insensitive types are stored as given.** `KanbanCard` and `kanbancard` both exist, and the list filter on `GET /attachments` is still exact-match.
- **The OPEN list holds 24 reads that grow with a tenant**: reports, exports, inventory, notifications, signer lists and more. It records them. It does not bound them.
- **The ENUM registry is hand-written.** It proves that the lists agree today. It cannot tell whether a `none` entry should have a mirror.

**Evidence**

On PostgreSQL **18.6** (`pgvector/pgvector:pg18`, throwaway container), booted as `backend/index.js` boots (`runSchemaSetup`: sync, then every migration, then schema verification):

- **Fresh.** 63 migrations were applied, including `0088`. Schema verification passed.
- **Upgrade.** A database was built by `f0d7f08` (58 migrations, no `file_purged_at`), then booted by this tree. That applied `0086` to `0090` including `0088`, and schema verification passed.
- `dataLayer.dbD.live.test.js` (6 tests) passed on **both**, as the application role. It shows:
  - the column shape;
  - the D-29 re-run with the index under another name, and showIndex's `fields[].attribute` shape;
  - the sweep removing only expired files, marking them and writing `system:attachment-file-sweep` audit rows that satisfy 0033's CHECK, with a re-run adding none;
  - a legacy free-string row soft-deleted through the model while a new one is refused;
  - a project delete cascading to two cards' files with `cascade.via`;
  - every model ENUM equal to `pg_enum`, in order.

Unit tests: `attachmentFileSweep.d22` (10), `attachmentFileSweepScheduler.d22` (8), `attachment.resourceType.d22` (13), `kanban.service` deleteProject (4), `systemActors.a124`, `unboundedFindAll.d24` (8), `dataRetention.maskAuditPaged.d24` (2), `enumMirrors.d26` (5), `softDeleteMechanisms.d25` (3), `0088-attachment-file-purged-at` (6), `0019-signature-crypto-fields.d29` (6).

These tests fail on the pre-change tree `f0d7f08`: the sweep, scheduler, type, 0088 and live suites (modules absent), the deleteProject tests, both `maskAuditPaged` tests, the unbounded-read list, and 0019's other-name case. `enumMirrors.d26` and `softDeleteMechanisms.d25` pass there. They pin a state that had not drifted, and each is shown to bite on a synthetic case.

**Status:** Accepted, implemented 2026-09-27/28. The code reached `a31c601` unverified and was verified on `35ebd76`. D-22, D-24, D-26 and D-29 are done. D-25 stays partial by decision (see alternatives). D-22's orphan query against the deployed database has still not been run.

---

## ADR-084: The Owner Questions Q-01 to Q-08 Are Closed — a Retired Device Stays Retired Except by Audited Reinstatement; the Hierarchy Grants No Visibility; an Own Bucket Still Counts While the Platform Holds the Bytes; No Session Cap and No Address Binding, but Every User Sees and Ends Their Own Sessions

**Date:** 2026-09-27/28 · **Questions:** Q-01 to Q-08 (`../TASKS/BACKLOG.md`) · **Debate:**
[`DEBATE-owner-questions-C-retired-devices.md`](../TASKS/DEBATE-owner-questions-C-retired-devices.md) ·
[`DEBATE-owner-questions-C-parent-visibility.md`](../TASKS/DEBATE-owner-questions-C-parent-visibility.md) ·
[`DEBATE-owner-questions-C-own-bucket-quota.md`](../TASKS/DEBATE-owner-questions-C-own-bucket-quota.md) ·
[`DEBATE-owner-questions-C-sessions.md`](../TASKS/DEBATE-owner-questions-C-sessions.md) · **Authority:** the owner's
standing instruction (ADR-051) that open questions are settled by a debate between a compliance-first and an
operability-first position, then decided · **Extends:** ADR-034, ADR-051, ADR-062, ADR-075 (A-133 restore),
ADR-078 (serial stays reserved), ADR-085, ADR-072 · **Migration:** `0089`

**Context.** Eight questions had been parked for the owner since the September audits. Four were already decided in
effect by later ADRs and only needed closing with evidence. Four needed a decision. This number was cited in code
(about 21 files, from 2026-09-27) before this entry existed — the F-28 finding; this is that entry.

**Decisions**

| # | Decision | Decided by | Evidence |
|---|---|---|---|
| **Q-01** immutable calibration records | Append-only in the database for every role; corrections are new records | **ADR-062** (P6-03) — closed here | `dataIntegrity.p6.live.test.js` (22 passed, PostgreSQL 18.6, 2026-09-28) |
| **Q-03** audit retention | Indefinite; no job and no setting deletes an audit row | **ADR-069 §5** (after ADR-051 Q-12) — closed here | `dataRetention.a121.test.js` |
| **Q-07** break-glass MFA | Enrolment-only session for an operator without MFA; audited CLI reset that never switches the requirement off | **ADR-059 §4** (P6-07) — closed here | `auth.superAdminMfa.p607.test.js` "P6-07: the break-glass reset" (7) |
| **Q-04** IP binding strictness | Superseded by Q-08: none | this ADR | — |
| **Q-02** retired devices | **1** below | this ADR (A's enforcement, B's correction path) | |
| **Q-05** parent sees child data | **2** below | this ADR (A) | |
| **Q-06** own bucket and `limitStorageMb` | **3** below | this ADR (A, with B's two demands) | |
| **Q-08** fixation, cap, binding, sockets | **4** below | this ADR (A on fixation, B on cap and binding) | |

1. **A retired calibration device is permanently retired; the one way back is an audited reinstatement (Q-02).**
   - `PUT /calibration-devices/:id` with a status other than `retired` on a retired device answers **409** with a state
     explanation that names the reinstatement (`calibrationDeviceReinstate.service.js#retirementConflict`). Retiring,
     re-saving `retired`, and editing a retired device's other fields stay allowed.
   - **Migration `0089`**: trigger `calibration_devices_retired_terminal`, `BEFORE UPDATE OF status`, refuses leaving
     `retired` for every role with SQLSTATE 23514 — unless the transaction has named *that* device in the
     transaction-local setting `callibrator.reinstate_device`. The edit path maps the trigger's error to the same 409
     (the device retired between its read and its write). The trigger is in `schemaVerify` `EXPECTED_OBJECTS`, so a
     boot without it fails. The migration throws rather than skips when the table is absent, and has no try/catch.
   - **`POST /calibration-devices/:id/reinstate`**: `auth`, `validateUuid`, `rbac([TENANT_ADMIN])`,
     `dynamicAccess("calibration", "write")` — the same gates as A-133's restore. Body: `reason` (10–1000 characters)
     and `status` (`active`, `inactive` or `maintenance`). One transaction: `set_config(…, true)`, the status change,
     and an `UPDATE` audit row with `operation: "REINSTATE"`, the reason, before and after. Another tenant's device is
     **404**, byte-identical to a missing one; a device that is not retired is **409**.
   - **Retire, restore and reinstate are three acts.** *Retire* is a status; the device keeps its history and its
     serial. *Restore* (A-133, ADR-075) undoes a soft **delete** and leaves the status alone: a retired device that is
     restored is still retired (it touches `is_deleted`, not `status`, so the trigger does not fire). *Reinstate* undoes
     a **retirement**, and a deleted device is 404 to it — restore first. Because a soft-deleted device keeps its serial
     (ADR-078) and so does a retired one, "register the instrument again" is not available as a correction; that is why
     the reinstatement exists.
2. **A parent tenant never sees a child tenant's data by virtue of the hierarchy (Q-05).** The hierarchy is structure,
   not access, and nothing may widen a principal's tenant through it. `getDataVisibilityScope`, `buildTenantFilter`,
   `HIERARCHY_SCOPE` and the `assignRole` validator — unused, and encoding the opposite answer (a "subtree" scope, and
   an "all" scope that showed a child its siblings, found by a `code LIKE '<root>_%'` that also matched unrelated
   tenants) — are removed. Group reporting, if the owner wants it, is a new feature with its own ADR: aggregates only,
   enabled and revocable by each child tenant's administrator, audited in both tenants.
3. **`limitStorageMb` bounds what the platform holds; a tenant on its own bucket still counts today (Q-06).** The
   attachment upload path was never cut over to the storage module and the migration tool leaves the legacy file in
   place, so every byte is on platform storage. The count is unchanged; the false claim in
   `storage/config.service.js` ("no longer bounded by the platform's per-tenant quota") is corrected; a 413 to a tenant
   with its own storage says why; an unreadable storage configuration explains nothing and is still a 413, never a
   500. **When the cutover lands**, the exemption is per attachment — one whose bytes live only in the tenant's
   storage stops counting in `getStorageUsageMb` — never a per-tenant switch, which would exempt the platform-held
   legacy copies too.
4. **Sessions (Q-08, and Q-04 with it).**
   - **Fixation: required, and structural.** A session row and its `sid` exist only once authentication completes
     (password-only sign-in, the MFA step, SSO, refresh rotation, impersonation), a new row every time. The MFA
     password step issues an `mfa` purpose token with no `sid` and creates no session (A-59). Pinned so it stays true.
   - **No concurrent-session cap**, platform-wide or per tenant. `MAX_CONCURRENT_SESSIONS` stays unread.
   - **No IP or user-agent binding.** A changed address or browser never ends a session. Both stay recorded at
     sign-in and refresh (ADR-050 resolves the address once, at the edge).
   - **The control instead: a user sees and ends their own sessions.** `GET /api/v1/sessions/mine` lists every live
     session of the caller — recorded address and browser, sign-in method, created, last activity, expiry, which one is
     *this* session, and whether it is a platform operator's support session (the operator is not named).
     `POST /api/v1/sessions/mine/:id/revoke` ends one: the revocation and an `UPDATE` audit row
     (`resourceType: "Session"`, `operation: "REVOKE_OWN_SESSION"`) in one transaction, in the user's tenant, the
     session's tenant, or PLATFORM for a tenant-less operator. Another user's session — this tenant or another — is
     **404**, like a missing one; an ended or expired one of one's own is 404 too. API keys are refused. The Session
     model hooks drop the liveness cache after commit, so the token is refused on its next request (A-48) and its open
     sockets at the next 60-second re-check (ADR-085).
   - **Sockets: the same rule as HTTP**, at the handshake and while open (ADR-085 §2) — not a stricter one.
   - **ADR-072 is unchanged:** the own-password budget still caps a stolen session at five guesses and signs it out;
     that, and signing's re-authentication (ADR-047), are what close the credential-sharing harm a cap was meant for.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Q-02: retired is final, no way back ("register it again") | the old device keeps its serial (ADR-078), so the same instrument cannot be registered under its own serial, and its history would split across two entries |
| Q-02: allow leaving `retired` through `PUT`, audited as an edit | the trail would show an edit where a reversal happened, and nothing distinguishes an accident from a correction |
| Q-02: service check only, no trigger | a script, a future endpoint or a raw UPDATE revives the device; ADR-062 set the two-layer precedent |
| Q-02: trigger with no escape (reinstatement by DDL only) | puts the correction in the hands of whoever can disable a trigger — the most privileged access, unaudited |
| Q-05: an opt-in parent role reading children's rows | row-level cross-tenant access is the hardest thing in the product to get right, and not needed for the group reporting asked for; aggregates first, under their own ADR |
| Q-05: keep the helpers, unused | dead code that means "see everything" is the ADR-051 Q-10 anti-pattern; the next group-report card would wire it in |
| Q-06: exempt a tenant with its own bucket now | its bytes are still on platform storage: unbounded platform disk for that tenant, at every other tenant's expense |
| Q-08: a per-tenant cap evicting the oldest session (NIST AC-10) | AC-10 is a High-baseline control; a cap of one breaks multi-device clinicians and a cap of N does not stop sharing N ways; the signing harm is closed by re-authentication |
| Q-08: bind to IP (/24) or user agent | hospital Wi-Fi and mobile networks rotate addresses; a user agent is spoofed by anyone holding a stolen token, so binding inconveniences only the real user |
| Q-08: disconnect sockets from the revoke path | considered in ADR-085 and left as a possible fast path; the 60-second re-check already applies the one rule |

**Implications, including the bad ones**

- **Q-02:** a device retired in error needs a tenant administrator; a technician who retired it cannot undo it. The
  escape hatch is a transaction-local setting: it stops the ordinary path and accidents, not someone with SQL access
  who chooses to set it — the audit row is what makes the deliberate act visible. A retired device still accepts new
  calibration records, IoT readings and work orders; refusing them needs a retirement date the table does not have
  (open).
- **Q-05:** a hospital group gets no group view until the aggregate feature is designed.
- **Q-06:** a tenant that configured its own bucket can still be refused at its platform limit until the cutover.
- **Q-08:** there is no automatic defence against a stolen session used from another network; detection depends on
  the user looking at the list (and revocation on them acting). Ending another session does not ask for the password
  again (ASVS V3.3.4 suggests it); it only reduces access, like `logout-all`. The frontend page for the list is not
  built. A new-device sign-in notification is not built.
- **`docs/` amended** with this ADR: `SECURITY/01-THREAT-MODEL.md` (T2), `SECURITY/03-AUTHENTICATION-SECURITY.md`,
  `BACKEND/04-MIDDLEWARE-PIPELINE.md`, `BACKEND/10-MODULE-REFERENCE.md`, `DATABASE/02-TENANCY-TABLES.md`,
  `DATABASE/03-IDENTITY-TABLES.md`, `DATABASE/06-DEVICE-TABLES.md`, `PLAN/06-DEVICE-LIFECYCLE.md`,
  `PLAN/10-TENANCY-AND-ONBOARDING.md`, `API/04-TENANT-API.md`, `API/06-DEVICE-API.md`,
  `ARCHITECTURE/05-STORAGE-ARCHITECTURE.md`.

**Tests**
- Q-02: `calibrationDevices.reinstate.q02.test.js` (13: the real route chain over the two-tenant fixture — PUT 409,
  reinstate with its audit row in the transaction after naming the device, cross-tenant 404 identical to missing,
  audit failure leaves it retired, 409 not retired, 400s, 403 technician); `calibrationDeviceReinstate.q02.test.js`
  (trigger-error recognition, the race mapped to 409, which edits leave retirement);
  `0089-calibration-device-retired-terminal.test.js` (7); `schemaVerify.util.p605.test.js`; and the opt-in
  **`calibrationDevice.retired.q02.live.test.js` (10, PostgreSQL 18.6)** — UPGRADE: retired rows written before the
  migration, revival proven possible before it, `up` twice, refused for the owner with SQLSTATE 23514,
  the model error mapped, allowed updates allowed, the setting scoped to one device and one transaction, the service
  409, cross-tenant 404, a real reinstatement with its real audit row, `down` then `up`. FRESH: an empty PostgreSQL
  18.6 database booted as `index.js` does (`db.sync()` then the full migrator, 63 migrations): trigger present,
  `verifySchema` no problems, a second `up` runs nothing, and `psql` shows the revival refused.
- Q-05: `tenantHierarchy.visibility.q05.test.js` (12) — tenant A made the parent of B; the four reads 404 both ways,
  identical to a missing id.
- Q-06: `quota.ownBucket.q06.test.js` (5).
- Q-08: `auth.sessionFixation.q08.test.js` (3), `session.own.q08.test.js` (12, two tenants, 404 identical to missing,
  audit row in the transaction, rollback on audit failure, PLATFORM for a tenant-less principal),
  `routePermissionGuard.p604.test.js` (the two self-service routes listed in `routeGateExemptions.js`).
- **Fail-before** on a worktree at `f0d7f08` (before any of this, 2026-09-28): `calibrationDevices.reinstate.q02`
  11 of 13 fail, `quota.ownBucket.q06` 3 of 5, `tenantHierarchy.visibility.q05` 2 of 12; the 0089, reinstate-service
  and own-session suites cannot load (their modules did not exist). `auth.sessionFixation.q08` passes there — it pins
  behaviour that was already right.

**Status:** Accepted, implemented 2026-09-27/28. Part of it reached `a31c601` unverified (committed with every agent's
in-flight edits); the rest, the tests' completion and this entry are in the working tree.

---

## ADR-086: The Schema Step Runs Under a PostgreSQL Advisory Lock, Not in an Init Container; Phase 8's Remaining Cards Wait on Their Triggers

**Date:** 2026-09-28 · **Cards:** P8-03 (done), P8-07 (baseline, partial), P8-02/04/05/06/08 (dispositions) ·
**Cited before it was written** by `backend/index.js`, `backend/src/utils/migrationLock.util.js`,
`src/scripts/migrate.js` and the two `migrationLock.p803` suites (audit finding F-28). The agent that wrote those
citations was stopped by the session limit; this is the record.

### 1. The lock (P8-03)

**Problem.** `backend/index.js` ran `await db.sync()` and then `await migrator.up()` at every boot, with nothing
between two processes. Reproduced on PostgreSQL 18.6: with two instances booting at once on an empty database, one
**crashed inside `db.sync()`** with `relname must be unique`. That replica crash-loops. On an existing database, a
migration that is not idempotent fails on the second replica, and one that is (a backfill `UPDATE`) runs twice.

**Decision.** The whole schema step (`db.sync()` + `migrator.up()`) runs inside `runSchemaSetup`
(`utils/migrationLock.util.js`). That function holds a PostgreSQL **session** advisory lock (key
`8003000000000000803`) on a connection taken straight from `sequelize.connectionManager`:

- The first instance migrates. Any other instance polls `pg_try_advisory_lock` every second, logs once that it is
  waiting, and then re-runs the step. By then every migration is recorded, so it applies nothing.
- A waiter gives up after `MIGRATION_LOCK_TIMEOUT_MS` (default 600000) and **refuses the boot**, rather than
  starting against a schema that may be half-migrated. A malformed value refuses the boot too.
- A process that dies holding the lock releases it with its connection.
- `src/scripts/migrate.js` (`npm run migrate`, `migrate:undo`) takes the same lock for `up` and `down`. `pending`
  and `executed` only read, so they do not wait. A lock timeout there sets exit code 1.

**Why a session lock on a raw connection, not `pg_advisory_xact_lock` in a transaction.** `config/index.js` enables
Sequelize CLS. Every query issued inside a managed transaction's callback therefore *joins* that transaction, so
the entire sync and every migration would have run inside the lock's transaction. That would change what the
migrations do and how they fail. A raw connection is invisible to model queries.

**Alternatives considered.**

| Option | For | Against | Verdict |
|---|---|---|---|
| **Init container / a Helm pre-upgrade Job running `npm run migrate`** | migrations run once, before any replica, visibly as a Kubernetes object | compose, the VM and a bare `node index.js` have no init containers, so it would protect Helm only. The boot would still need `db.sync()`, which creates tables no migration creates. The charts are not known to deploy (U-01, P7-06) | rejected: protects one of four deployment shapes |
| `pg_advisory_xact_lock` in a transaction | released automatically at commit | CLS pulls every query into that transaction (above) | rejected |
| Blocking `pg_advisory_lock` | simplest | waits forever behind a stuck migration; no log line saying why the replica is not up | rejected in favour of polling with a bound |
| **Session lock, polled, bounded** | works in every deployment shape; the loser waits, logs, and then verifies (P6-05 runs after the step on every replica) | one extra pooled connection during boot; the lock key is a constant every replica must share | **chosen** |

**Implications, including the bad ones.**
- A slow migration now delays **every** replica's start, not only one. That is intended. A migration longer than
  ten minutes will make the waiting replicas refuse to boot and restart. Raise `MIGRATION_LOCK_TIMEOUT_MS` for such
  a release.
- The lock covers the schema step only. Seeding (`GET /migration/seeding`, `/seed-demo`) is still an HTTP action,
  not a boot step, and is not locked.
- `migrationLock.util.js` is JavaScript. It was written before the P9-01 toolchain landed (ADR-087). It converts under
  Phase 9 as a leaf, but converting it also means changing the live test: that test spawns `src/scripts/migrate.js`
  with plain `node`, which cannot resolve an extensionless `.ts` require (ADR-087 §1, the `storagePath.util` case).

**Evidence.**
- Unit: `src/tests/utils/migrationLock.p803.test.js`, 17 tests, 100% of the util.
- Live (`MIGRATION_LOCK_LIVE_TEST=1`, PostgreSQL 18.6, 4 of 4):
  - "P8-03: two instances starting simultaneously produce ONE migration run; the other waits and applies nothing"
  - "P8-03: the run is verified by inspecting columns (P6-05), not by the migration log"
  - "P8-03: the lock is free afterwards — a third boot takes it at once and applies nothing"
  - "P8-03: `npm run migrate` (scripts/migrate.js up) WAITS for a held lock, then runs and exits 0"
- **Fail-before**, `git worktree` of HEAD. HEAD's unlocked boot step run by two instances failed all three boot
  cases ("relname must be unique"). At `35ebd76`, the migrate-CLI case fails with `Expected: "still-waiting",
  Received: 0`: the CLI migrated while another instance held the lock.
- **Real replicas.** On a compose stack of the image built from the working tree, two backend replicas started
  together on an empty PostgreSQL 18 database:
  - `backend-2` logged `Applied 63 migration(s)` at 06:33:56–58.
  - `backend-1` logged `[migration-lock] another instance is migrating the schema; waiting…` and then
    `lock acquired after waiting` at 06:33:58.759. It synced, applied nothing, and started.
  - Both logged `[schema-verify] OK: 72 tables, 867 columns and 8 control objects`.
  - `schema_migrations` holds 63 rows, 63 distinct.

### 2. The other Phase 8 cards

Phase 8 is trigger-driven. The decision recorded here is **not to build a card whose trigger has not fired**. The
trigger for P8-04/05/06 is the P8-07 measurement, not an impression.

- **P8-02** — the adapter and the cross-replica test exist (A-54). An open socket's revocation is re-checked every
  60 s (ADR-085). Still open: the fan-out test *after a reconnect*, and a live notification through the proxy.
  Both are recorded on the card as TODO.
- **P8-04 / P8-05 / P8-06** — their triggers are measured impact on p95 and row counts. The measurement is in §3:
  P8-04's trigger fired only in part, and query-shaped fixes come first. P8-05 and P8-06 are not triggered. P8-06
  additionally has no retention decision to scope against (Q-03).
- **P8-08** — **BLOCKED** on a customer data-residency requirement, which does not exist.
- **P8-01** — not started. Its prerequisite A-40 is done (ADR-057). What remains needs a target S3/NFS environment
  and an ambient-credential chain (IAM role / service account), which this environment does not have.

### 3. The first load baseline (P8-07), and what it says about P8-04 and P8-06

**Setup.**
- **Stack:** the backend image built from the working tree, two replicas (each 2 CPU / 4 GiB, the Helm limits),
  PostgreSQL 18 (pgvector image) and Redis, all on one Docker Desktop host (16 CPUs).
- **Settings:** `NODE_ENV=production`, so `DB_POOL_MAX` 20. `RATE_LIMIT_MAX=100000000`, set deliberately.
- **Data** (`scripts/load/p807-seed.sql`, over the demo seed): two tenants, each with 5,000 devices, 50,000
  calibration records (two a year for five years), 2.16M `iot_readings` (1,000 IoT devices, hourly, 90 days) and
  500,000 `audit_logs` rows.
- **Load:** k6 in a container on the stack's network (`scripts/load/p807-baseline.k6.js`). Each virtual user
  alternates between the two tenants' tokens and requests one of: the device list (random page), device search,
  the records list, the audit list, `GET /dashboard/metrics`.

**Every response is checked for its tenant.** Every returned row's `tenantId` must be the caller's. `meta.total`
must equal the caller's own count (5,000 devices, 50,000 records). The dashboard's device total must be 5,000.
A context that bled between concurrent requests would fail either check, in either direction.

**Results.** 35,963 requests over 15 runs.

| Measure | Result |
|---|---|
| **Cross-tenant leakage under concurrency** | **0** in 35,963 checked responses, up to 50 concurrent users across two tenants and two replicas |
| 408 | **0** |
| 429 (limiter measured instead of throughput) | **0** — the limiter's headers showed the deliberate budget |
| 5xx / failed requests | **0** |
| Connection acquire timeouts | **0** in both replicas' logs |
| Backend memory | stable at ~320–345 MiB under sustained load (4 GiB limit) |
| p95, 1 user (unloaded) | devices 49 ms, search 54 ms, records 56 ms, dashboard 64 ms, audit 140 ms |
| p95, 10 users, one replica | 576–732 ms across the mix; ~37 req/s |
| p95, 25 / 50 users, one replica | 0.8–1.8 s; 40–64 req/s (run-to-run variance on a shared desktop host) |
| p95, 50 users, **two** replicas | 1.8–2.2 s; **51 req/s — adding a replica added no throughput** |

**The < 500 ms p95 target for tenant-scoped lists holds only at low concurrency** (roughly ≤ 5 in-flight requests
per replica) at this data volume.

**The ceiling is PostgreSQL, not the API process.**
- During the two-replica run each Node process sat at ~100–130% CPU, while PostgreSQL sat at **790–940%**.
- Sampling `pg_stat_activity` under load:
  - **39 of 72 active queries were the audit list's `SELECT count(...)`** over the whole tenant history, with two
    LEFT JOINs to `users`. `EXPLAIN ANALYZE`: a parallel sequential scan of 500,000 rows with 3 workers, **67 ms**
    per request.
  - Most of the rest were the other lists' exact `count(...)` and the dashboard's aggregates.
- Every list request pays an exact count of everything the tenant has ever had. That cost grows with history, not
  with the page.

**Finding (recorded as asked, not fixed): the dashboard's 20 parallel counts against a 20-connection pool.**
- `dashboard.service.js#getDashboardMetrics` issues 20 queries in one `Promise.all`. The production pool is 20
  (`config/index.js`). One dashboard request can therefore hold every connection.
- Measured with 10 users each, on one replica:

  | Pool | Device-list p95, alone | Device-list p95, with concurrent dashboard traffic | Combined throughput |
  |---|---|---|---|
  | 20 | 320 ms | **726 ms** | 60 → 37 req/s |
  | 60 (`DB_POOL_MAX=60`) | 360 ms | 574 ms | 47 req/s |

- So the pool explains part of the interference, and the database's CPU the rest. It is not fixed here:
  - bounding the dashboard's fan-out, or sizing the pool against it, is a capacity decision;
  - raising the pool alone moves load onto an already saturated PostgreSQL.

**Decision on P8-04 (read replica), by debate.**
- *For building it now:* reporting traffic measurably degrades operational p95 (device list 320 → 726 ms), which
  is the card's trigger.
- *Against:* the measured cost is not "reporting". It is exact counts over full history on every **operational**
  list (audit, records, devices). A replica would move that load, not remove it, and it adds a staleness window to
  compliance figures and a second connection path for the tenant hooks.
- **Decided:** the trigger has fired only in part. The **first** response is query-shaped: bounded or estimated
  counts, and a default date window on the audit list. A replica comes only if p95 still fails after that. This
  is new work and is not started here (no new implementation in this change). It is recorded on the P8-04 card.

**P8-05 / P8-06.**
- At 2.16M `iot_readings` and 500,000 `audit_logs` per tenant, the measured cost came from counts, not from table
  size on indexed reads. Partitioning by date would not bound an unbounded count.
- **Not triggered.** P8-06 still also waits on Q-03.

**Not measured, and why.**
- **Memory under sustained PDF rendering:** the image cannot render certificate PDFs (M-11 / P7-04 D-1).
- **The MQTT ingest path:** not run; a telemetry flood test is still owed. The card's premise that "the broker
  shares the API process" is **stale**: there is no embedded broker (A-17). The backend is an MQTT *client*, and
  its message handler shares the API event loop.
- **The load generator** ran on the same host as the stack, so absolute numbers are a lower bound for a
  dedicated host. The shape — database-bound, count-dominated — is the finding.

**Status:** Accepted, implemented 2026-09-28 (P8-03). The P8-07 baseline is taken; the card stays PARTIAL for PDF
memory and MQTT ingest.

---

## ADR-087: The Backend Runs Mixed JavaScript and TypeScript From One `dist/` Tree; Tests Erase Types With Babel, TypeScript 7 Checks Them; Shared Types Live in `backend/src/types/`

**Date:** 2026-09-27/28 · **Cards:** P9-01, P9-01a, P9-01b, P9-02 (part), P9-03, P9-08 (part) · **Amends:** ADR-038 (test transform, compiler target, where types live) · **Works with:** ADR-076 (Node 26, TypeScript 7 beside the TypeScript 6 API, Babel 8)

**Context.** Phase 9 had no toolchain: no `backend/tsconfig.json`, no `typecheck` script, `transform: {}` in jest, no ESLint configuration that matched a `.ts` file, and a pkg build that globbed `src/**/*.js`. ADR-038 chose `@swc/jest` and a `tsc → dist → pkg` build. Three facts found while building the toolchain changed parts of that:

1. **Node cannot `require` an extensionless `.ts` module.** Node 26 strips types, but its CommonJS resolver tries `.js`, `.json` and `.node` only. Probed on 26.10.0: `require("./a")` with only `a.ts` present throws `MODULE_NOT_FOUND`. So once one module is `.ts`, **every entry point that runs source with plain `node` breaks** — `npm start`, the `migrate*`, `swagger:generate` and `keys:rotate` scripts, `make seed-demo` and CI's boot job — and the unconverted `.js` callers of a converted module must still resolve it in jest, in dev and in the binary.
2. **`tsc` does not pass JavaScript through unchanged.** With `allowJs`, `tsc` re-prints every `.js` file, and under `strict` (`alwaysStrict`) it prefixes `"use strict"`. That changes the semantics of sloppy-mode CommonJS (an assignment to an undeclared name throws; `this` in a plain function is `undefined`). Emitting the whole tree through `tsc` would change the behaviour of ~470 files nobody converted — ADR-038 rule 3 broken wholesale.
3. **`@swc/jest` breaks `jest.spyOn` on a converted module.** SWC emits exports as non-configurable getters. A probe `.ts` module under `@swc/jest` failed `jest.spyOn(m, "f")` with `TypeError: Cannot redefine property: f`; the same module under babel-jest with `@babel/plugin-transform-modules-commonjs` passed. The backend suite spies on module exports throughout, so SWC would make each conversion rewrite its callers' tests — a conversion that changes tests is not provably behaviour-identical.

The owner then set **TypeScript 7.0.2**, which has **no compiler API**: nothing that must call TypeScript in-process (ts-jest, a type-checking jest transform) can use it. ADR-076 installed it as `@typescript/native` beside the TypeScript 6 API package.

### Decision

1. **The compiler (P9-01).** `backend/tsconfig.json` carries `strict` and every ADR-038 flag, `allowJs: true`, `checkJs: false`, `module`/`moduleResolution: Node16` (CommonJS emit, `"type": "commonjs"` kept), `outDir: dist`, `rootDir: "."`, `skipLibCheck` as the only relaxation, and `verbatimModuleSyntax` off. **Two deviations from the standards document:** `target`/`lib` are **`ES2025`** (Node 26 is the runtime, and ES2025 is the newest target TypeScript 7 accepts), not ES2023; and `types: ["node", "jest"]` is explicit, because TypeScript 6+ no longer loads every `@types` package. It includes `src/**/*.ts`, `scripts/**/*.ts` and `__tests__/**/*.ts`.
2. **The check is TypeScript 7; nothing else is (P9-01a).** `npm run typecheck` runs `@typescript/native`'s `tsc -p tsconfig.json --noEmit` by path (ADR-076: a bare `npx tsc` finds TypeScript 6). It is wired where a gate runs: `make typecheck` (both workspaces, each directly), CI's backend-lint job, and the pre-push hook for pushes touching `backend/`. **`turbo run typecheck` is not the path:** it skips a package without the script and exits 0, and at the root it currently refuses to run at all ("Missing `packageManager` field", observed 2026-09-28).
3. **One `dist/` tree, JavaScript copied, TypeScript compiled (P9-01b).** `npm run build:dist` (`scripts/build-dist.ts`, run by tsx) empties `dist/index.js` and `dist/src/`, **copies** `index.js` and every non-test, non-`.ts` file under `src/` byte for byte, then compiles the `.ts` sources with TypeScript 7 using `tsconfig.build.json`. That file extends the base with **`allowJs: false`**, so a `.ts` file that imports an unconverted `.js` file fails the build with TS7016: **leaf-first order (ADR-038 rule 1) is enforced by the compiler.** The script also refuses a module present as both `x.js` and `x.ts`, and refuses a `.ts` source for which nothing was emitted. `package.json` `bin`/`main` are `dist/index.js` and `pkg.scripts` is `dist/src/**/*.js`. `npm run build` is `swagger:generate → build:dist → pkg`. `build:bun` is gone, and so is `nodemon`.
4. **Source runs through tsx.** `start` is `node --import tsx index.js` (one process, so a PID file is the server's); `dev` is `tsx watch index.js`; `swagger:generate`, the `migrate*` scripts and `keys:rotate` run under `tsx`; so do `make seed-demo` and CI's two boots. The binary never needs tsx.
5. **Tests erase types with Babel, never check them (P9-03).** `jest.config.js` and `jest.e2e.config.js` transform `^.+\.ts$` with babel-jest, `@babel/preset-typescript` and `@babel/plugin-transform-modules-commonjs` (Babel 8 since ADR-076). JavaScript stays untransformed, exactly as before. `moduleFileExtensions` is `["js", "ts", "json"]` — `js` first, so every existing resolution is unchanged — and `testMatch` and `collectCoverageFrom` gained the `.ts` twins of every `.js` entry. Thresholds are unchanged at 100%. **This replaces ADR-038's `@swc/jest`** for the `spyOn` reason in the context.
6. **Lint covers `.ts` (P9-02, part).** `eslint.config.js` adds typescript-eslint `strictTypeChecked` + `stylisticTypeChecked` for `**/*.ts`, type-aware (`projectService`; typed linting runs on the TypeScript 6 API, ADR-076), with every rule in the standards document as an error. Two refinements: `no-namespace` allows `declare global { namespace … }` (`allowDeclarations`), which is how a global is augmented; and `no-restricted-properties` bans `process.env` outside `src/config/`. Before this, ESLint matched **no** `.ts` file ("File ignored because no matching configuration was supplied"), so a conversion silently removed its file from the lint gate.
7. **Shared types live in `backend/src/types/` (owner instruction, 2026-09-28).** It holds backend-internal shared types: augmentations of runtime and library globals, the request/principal context, branded ids, the response envelope, and domain/model types used across layers. This **agrees with** ADR-038 and the standards document, which already place `express.d.ts` and `ids.ts` there (P9-05). A **cross-workspace contract** stays in `packages/contracts` (P9-22, ADR-038), not here. A type derived from a constant's value stays beside the value (`AuditAction` in `constants/auditActions.ts`) so the two cannot drift. It is seeded with **one** file, `node-process.d.ts` (`process.pkg`, read by `utils/packaged.util.ts`), and a `README.md` stating what belongs there. **Guard:** `no-restricted-syntax` makes a `declare global` block, or a type or interface named `*Envelope`/`ApiResponse*`, an error in any `.ts` file outside `src/types/`. The coordinator's note named this "open question Q-29"; no Q-29 exists in `TASKS/BACKLOG.md` or anywhere else in the repository on 2026-09-28, so this ADR records the placement as decided rather than citing a question that was never written.
8. **The first conversions (P9-03 canary, P9-08 part).** `utils/packaged.util` and eight constants modules — `auditActions`, `platformTenant`, `qmsConstants`, `tenantAdminSettings`, `tenantConstants`, `tenantLogo`, `tenantStatus`, `webhookEvents` — are `.ts`. Each had no uncommitted change when converted, imports nothing, and is read by JavaScript callers only. Types are derived from values (`as const`, `(typeof X)[number]`); `Object.freeze` stays wherever it was, and nothing was frozen that was not. Three predicate parameters are typed as the values their JavaScript callers can pass (`string | number | null | undefined`), so the `String(…)` call stays exactly as it was; `isActiveTenantStatus` now spells `x === undefined || x === null ? "" : x` as `x ?? ""`, which is the same expression. `isTenantAdminSettingKey` became a type predicate, which is a compile-time narrowing only. **Not converted, on purpose:** `utils/storagePath.util` — `activityLog.a14.stdout.test.js` spawns a plain `node` child that `require.resolve`s it by extensionless path, so converting it means changing that test; `utils/appPath.util` waits with it. `constants/rateLimitConstants`, `systemActors` and `tenantSecretSettings` had uncommitted changes from other agents. `constants/index` imports `roleConstants` and `appConstants`, which come first.

### Evidence (2026-09-28, Node 26.10.0, TypeScript 7.0.2)

| Check | Result |
|---|---|
| `npm run typecheck` (TypeScript 7, `--noEmit`) | exit 0 |
| …failing direction: `src/utils/zzP9probe.a087.ts` with `const x: number = "x"` | exit 1, `TS2322` — probe deleted |
| `npm run build:dist` | "471 JavaScript files copied, 9 TypeScript files compiled -> dist/"; `diff -rq src dist/src` shows only the 9 `.js` files that exist as `.ts` in `src`, so every copied file is byte-identical |
| …failing direction: a `.ts` file importing `constants/appConstants` (still `.js`) | exit 1, `TS7016` (rule 1) — probe deleted |
| …failing direction: `x.js` and `x.ts` side by side | exit 1, "a module exists as both .js and .ts" — probe deleted |
| Behaviour identity: each original (`git show HEAD:…`) against its compiled `dist/` module | same export names in the same order, deep-equal values, same freeze state at every depth, and the same result from every exported function over 15 sample inputs (`undefined`, `null`, `""`, cases of `"active"`, numbers, `{}`, `[]`, the platform id, an object with a custom `toString`…): 60 checks, all identical |
| jest collects and fails a `.ts` test | a probe test asserting `expect(true).toBe(false)` was collected and **failed** (`FAIL src/tests/p9probe/probe.a087.test.ts`) — probe deleted |
| The converted modules' own tests, unchanged | `src/tests/utils/packaged.test.js` (6 cases), `appPath.test.js`, `storagePath.test.js`, the `env` tests: 30 passed |
| Full backend suite, `npm run test:coverage -- --ci --forceExit` | **642 suites passed, 24 skipped (666); 12,808 tests passed, 155 skipped; 100% statements, branches, functions and lines**; `packaged.util.ts` listed at 100/100/100/100; 173 s. No test file was changed by a conversion |
| `npx eslint` on the 9 converted files, `src/types/node-process.d.ts` and `scripts/build-dist.ts` | 0 problems (after the lint findings recorded in item 8 were resolved) |
| …the shared-types guard, failing direction: a `declare global` and an `interface ListEnvelope` in `src/utils/` | 2 errors, "Shared types live in src/types/" — probe deleted |
| `docker build -f backend/Dockerfile .` from the repository root (builder `node:26.10.0-alpine`, pinned digest) | exit 0. Inside the builder, `swagger:generate` ran under tsx, `build:dist` printed "471 JavaScript files copied, 9 TypeScript files compiled" (TypeScript 7 on alpine), and pkg built `node26-linux-x64` |
| The image booted on a disposable network with `pgvector/pgvector:pg18`, Redis 8.6 and RabbitMQ 3.13 (the digests CI uses) | `GET /health` → **200 `{"status":"ok"}` after 5 s**; 63 migrations applied; "Server running on port 3000". The binary seeded the PLATFORM tenant `00000000-0000-4000-8000-000000000001` (from the converted `platformTenant.ts`), and `enum_audit_logs_action` holds exactly the eight `AUDIT_ACTIONS`. `/app/src/templates`, `/app/swagger.json`, `/app/docs` and `/app/public` listed present. Image, containers and network removed afterwards |

### Alternatives considered

| Alternative | Why not |
|---|---|
| **Emit the whole tree with `tsc` (`allowJs` emit)** | re-prints ~470 unconverted files and adds `"use strict"` to each — a behaviour change to every file nobody converted (context, item 2) |
| **Emit `.ts` beside the source (`src/x.js` next to `src/x.ts`)** | a generated `.js` in the source tree shadows the `.ts` for jest (it resolves `.js` first) and gets committed or linted by accident; two files per module is the ambiguity the build now refuses |
| **A CommonJS `require` hook registered in `index.js`** | changes the entry point's behaviour, and pkg's snapshot does not run `.ts` anyway |
| **`@swc/jest` (ADR-038)** | breaks `jest.spyOn` on every converted export (context, item 3) |
| **ts-jest** | needs the TypeScript compiler API, which TypeScript 7 does not ship; on the TypeScript 6 package it would check with a different compiler from the gate |
| **esbuild or swc as the release emitter, `tsc --noEmit` as the gate** | TypeScript 7 emits CommonJS correctly and fast (probed: the 9 files in under a second inside `build:dist`), so a second emitter adds a tool without adding anything |
| **Keep `turbo run typecheck` as the gate** | it skips a package with no such script and exits 0, and today it cannot resolve the workspace at all |
| **Convert `storagePath.util` and edit the a14 test** | a conversion that changes a test cannot be shown to be behaviour-identical; it waits for its own change |
| **Put shared types in `packages/contracts` now** | that workspace is for the frontend-facing contract (P9-22) and does not exist; backend-internal types would leak into the frontend's dependency |

### Implications, including the bad ones

- **Plain `node` can no longer run backend source.** Anything that does — an old runbook line, a script someone keeps locally — fails with `MODULE_NOT_FOUND` on the first converted module it reaches. The package scripts, the Makefile and CI were moved to tsx; `docs/DEVOPS/01-CI-CD.md`, `docs/SECURITY/03-AUTHENTICATION-SECURITY.md`, `docs/STORAGE/04-TENANT-STORAGE.md` and `backend/README.md` still contain `node src/…` command lines in prose and are listed for the docs owner.
- **A test that spawns plain `node` on source blocks conversion of what it loads.** Today that is `activityLog.a14.stdout.test.js` (it loads `activityLog.middleware` and `storagePath.util`). P9-05a, which converts both, must change how that test launches its child (e.g. `--import tsx`), in its own change.
- **Nothing type-checks during `jest`.** A type error in a `.ts` test passes the suite and fails `npm run typecheck`; the gate is the typecheck, and it must run (CI, `make verify`, pre-push).
- **`typecheck` accepts a `.ts` → `.js` import; only `build:dist` refuses it.** The base config keeps `allowJs` for editor resolution. So rule 1 fails at build time, not at typecheck time.
- **The lint ratchet now sees `.ts` files**, and deleting a `.js` file removes its old errors from the count. The ratchet was already red when this landed (1,051 errors against a baseline of 950, from other in-flight changes); the nine originals had **0** lint errors, so these conversions do not move it.
- **`dist/` now holds two things** — the assembled tree and pkg's binaries. `build:dist` removes only `dist/index.js` and `dist/src/`.
- **Typed linting runs on TypeScript 6** while the check runs on TypeScript 7; a construct only one of them understands shows up as a lint-only or check-only error until typescript-eslint supports 7 (ADR-076).

### Amendment 1 (2026-09-28, later the same day) — the ratchet, the test transform, the rest of `constants/`, and one reverted conversion

1. **The ratchet (P9-04).** `backend/scripts/ts-ratchet.ts` (`npm run ratchet`) keeps the floor as the **sorted list of every counted `.js` file** in `backend/.ts-ratchet.json`, not a number. It fails when any counted `.js` path is not on the list — a new file or a renamed one — so converting one file cannot make room for adding another. When files have gone and none is new, it rewrites the list and passes, so the lower floor is committed with the conversion. Counted: `index.js`, `src/**`, `__tests__/**`, `scripts/**`. Not counted: the backend-root tool files (`jest.config.js`, `jest.e2e.config.js`, `jest.transform.js`, `eslint.config.js`). Migrations are counted; P9-23 decides how they leave. It runs in `make verify` (`ts-ratchet`), CI's backend-lint job and the pre-push hook. **Tests count too** (ADR-038: the count covers `backend/src`), so a new test file must be `.ts` from now on — for a test of a module that is still `.js`, that means importing JavaScript into a `.ts` test, which `typecheck` accepts (`allowJs`) and the build never sees (tests are not built).
2. **The test transform is `backend/jest.transform.js`, not babel-jest.** babel-jest 30 loads the **root** `@babel/core`, 7.29.7, with the backend's Babel 8 presets (ADR-076). Babel 7's parser keeps a call's type arguments under `typeParameters`; Babel 8's TypeScript plugin strips `typeArguments`; so `new AsyncLocalStorage<T>()` reached jest with `<T>` still in it. The first converted module that wrote an explicit type argument failed to parse, and **every suite that loaded it failed** — the "240 suites, 446 × Jest encountered an unexpected token, 79% coverage" run the Phase 8 agent saw. The transformer calls the **backend's** `@babel/core` 8 with the same two presets; jest instruments its output for coverage. ADR-076's probe (a `declare` field) could not catch this: it has no type arguments. `jest.e2e.config.js` still passed `allowDeclareFields`, which Babel 8 rejects; it now uses the same transformer.
3. **`constants/` is converted except one file (P9-08).** Also converted: `appConstants`, `attachmentResources`, `roleConstants`, `index` (the barrel), `rateLimitConstants`, `systemActors` and `tenantSecretSettings` — 15 of 16. `routeGateExemptions` has another agent's uncommitted change and waits. How the new ones were done:
   - **Key order is kept.** Declarations follow the old `module.exports` order, or an `export { … }` list at the end reproduces it.
   - **`ROLE_LEVELS` `satisfies Record<keyof typeof ROLE_NAMES, number>`**, so a role in `ROLE_NAMES` without a level no longer compiles. Probed: adding `P9_PROBE_ROLE` to `ROLE_NAMES` gave `TS2741 … Property 'P9_PROBE_ROLE' is missing`.
   - **The barrel captures values at load.** It uses `export const X = role.X`, not `export … from`, which would compile to a live, non-writable getter.
   - **Three line-level lint directives, each with a reason:**
     - `SUPER_ADMIN_ROLE_ID` still reads `process.env` at module load (P9-06 moves the read to `src/config/`) and keeps `||`: an empty variable has always meant "use the default".
     - The barrel re-exports the `@deprecated` `ROLE_PERMISSIONS` for its JavaScript callers.
     - `utils/storagePath.util.ts` reads `APP_STORAGE_PATH`, for the same two reasons as `SUPER_ADMIN_ROLE_ID`.
4. **`utils/storagePath.util` and `utils/appPath.util` are converted (P9-05a, part).** They use `export =` so `require()` still returns the function itself. `activityLog.a14.stdout.test.js` now launches its child with `--import tsx`, because the child loads backend source; **that is the one test change**, and the child script is unchanged.
5. **`middlewares/tenantContext.middleware` was converted, then reverted.** The owner's scope for this pass is constants and pure utilities, and this middleware is the root of tenant isolation. The conversion passed its own tests and a 13-shape identity comparison. But the full run showed that `tenantHierarchy.visibility.q05.test.js` reads `tenantContext.middleware.js` **as text** (to prove the tenant context never reads the hierarchy), so converting it also means changing an isolation guard. The file is restored byte for byte from `HEAD` (`git status` clean) and its floor entry is restored. The draft `.ts` and the two types it needed (`src/types/express.d.ts`, `src/types/ids.ts`) are kept outside the tree for P9-05a's own reviewed change. Nothing converted uses them, so under the owner's "no speculative types" rule they are not in `src/types/` either. **P9-05 therefore still has only `node-process.d.ts`.**

**Evidence:**

| Check | Result |
|---|---|
| Identity: the 15 converted constants and `packaged.util`, originals (`git show HEAD:`) against `dist/` | **402 checks identical** — export names and order, deep-equal values, freeze state, and every exported function's result over 28 sample inputs (including `"toString"` for the rate-limit lookups, and a settings object carrying secret keys). `SUPER_ADMIN_ROLE_ID` checked with the variable unset, empty and set |
| Identity: `storagePath.util` and `appPath.util` | 60 calls identical across `APP_STORAGE_PATH` unset / empty / set × packaged / not; not-packaged results compared relative to each module's own root (their `__dirname` differs by construction) |
| `npm run ratchet` failing direction | a new `src/utils/zzRatchetProbe.a087.js` → exit 1 naming it; removed → exit 0; each conversion lowered the floor (1208 → 1201, then one entry put back for the reverted file) |
| Full suite after the revert | `npm run test:coverage -- --ci --forceExit` exit 0: 642/666 suites (24 skipped), 12,808 tests (155 skipped), 100/100/100/100 |
| Full suite after the last three constants | exit 0: 642/666 suites (24 skipped), 12,808 tests (155 skipped), 100/100/100/100 |
| `node dist/index.js` (the assembled tree, plain Node 26, no database) | loaded every module, "Authorization wiring validated: 171 dynamicAccess gate(s), 11 role-menu assignment(s), 12 role name(s)" — the converted `roleConstants` through the converted barrel — then "Initializing database connection". The Docker image was not rebuilt for this amendment |

### Amendment 2 (2026-09-28) — the logger, the tenant context, and two logger-dependent utilities

**Decided by the orchestrator** under the owner's standing instruction to settle these by best practice.

1. **New backend test files are `.ts`.** The ratchet counts tests (Amendment 1, item 1), and that is kept on purpose. `docs/ENGINEERING/09-TESTING-CONVENTIONS.md` says so.
2. **The tenant store keeps `null` for "no tenant".** `tenantScope.util` keeps mapping `null` to the deny sentinel `NO_TENANT_UUID`. The P9-05a card asked the store to hold the sentinel; that request is withdrawn, because the code wins and a conversion never changes behaviour. The card is amended to match.

**`middlewares/activityLog.middleware` is TypeScript (P9-05a).**
- **Environment reads:** it reads the environment at load exactly as before. It is wrapped in a region-level lint directive that gives the reason: P9-06 moves these reads to `src/config/`.
- **`||` stays** wherever the JavaScript had it, because an empty string has always meant "unset".
- **Error spread:** the spread of an `Error` into the redacted copy goes through an `object`-typed alias. At run time it copies the same own enumerable properties; the alias only stops the checker assuming `name` and `message` are among them.
- **`createDir`:** the rotating-file options keep `createDir`, which the transport's type declarations do not list. It sits behind an intersection type, not a cast.
- **Record typing:** the winston record is built key by key in its original order, and then asserted as `TransformableInfo` (a variable, not an object literal).
- **Tests:** unchanged. `activityLog.a14.stdout.test.js` already launches its child with `--import tsx` (Amendment 1).
- **New shared types:** `src/types/express.d.ts` (`requestId`, `user`, `tenantId` on `Request`) and `src/types/ids.ts` (`TenantId`) land now, because this module is their first converted user.

**`middlewares/tenantContext.middleware` is TypeScript (P9-05a), under the orchestrator's four gates. All passed.**

| Gate | Evidence |
|---|---|
| (a) q05 guard | `tenantHierarchy.visibility.q05.test.js` reads `tenantContext.middleware.ts`. Its two assertions are unchanged (no `/hierarch/i`, no `/descendant\|ancestor\|parent_?code/i` in the source). **Failing direction:** a planted line `// planted: reads the tenant hierarchy (descendants)` gave "1 failed, 11 passed". With the line removed, 12 passed |
| (b) identity | Original vs `dist/`, **80 checks identical**: 15 request shapes, compared on store, `next` calls, return value and the store after `run`. Shapes include `tenantId` `""`, `0` and `null`; `user` `null`, `{}` and a role of `null`; `SUPERADMIN`, `SUPER_ADMIN` and lower-case; and two PLATFORM-context requests (the operator, and an ordinary role pointed at the PLATFORM id). Also covered: the no-context case (`getStore()` is `undefined` in both, including after a nested system `run`), and the path utilities' 60 calls |
| (c) isolation suites | 39 suites, **1,192 tests passed**. They include `tenantScope.test`, `.sequelize`, `.includes.a87`, `.bulkDestroy.w33`, `.hookless.w34`, `rawSqlTenantPredicate.d05`, `includes.a90`/`a109`, `maintenance.includes.a190`, `qms.includes.a75`, `includeRequired.d12`, every `*.twoTenant*` suite (apiKeys, batchJobs, calibrationDevices, certificates.a145, customDomains, finance, maintenance, meteredBilling, notifications, risk, stock, supplierScorecard, vendor, warehouse, webhooks, search.a56), `tenant.edit.a63`, `user.profile.a63`, `scim.crossTenantOracle.a37`, `user.service.crossTenant.az04`, the four `tenantHierarchy.*` suites, both `denyPlatformAuthoring` suites, `jobContext.w12` and `tenantContext.test`. The full run: every suite passed. Coverage was 99.62% only because helper 2's five `utils/*.ts` files sat beside their `.js` twins mid-conversion, so jest loaded the `.js` and never measured the `.ts`. `tenantContext.middleware.ts` itself was 100/100/100/100 |
| (d) live PostgreSQL 18 | PostgreSQL **18.6** (pgvector image, CI digest), migrated by booting the backend from source (`node --import tsx index.js`, "Database queries now run as the application role "callibrator_app""). A scratch script then switched every connection with the backend's own `enterApplicationRole` and established contexts through the converted `tenantContextMiddleware`. **13 checks passed:** `current_user` is `callibrator_app`; A reads its own warehouse by id; A cannot read B's warehouse by id (`null`, i.e. 404), by an explicit `where` on its id, or by asking for B's `tenantId` (the hook forces A's own id, as built); A's list holds only A's row; A's update of B's row touched 0 rows; B cannot read A's row; a request with no tenant sees neither row (deny by default); and B's row is unchanged. The containers were removed afterwards |

**`utils/dbReady.util` and `utils/circuitBreaker.util` are TypeScript (P9-09 b).**
- **dbReady:** keeps a bare `import "sequelize"`. The `.js` required sequelize for a JSDoc type, and the import keeps that module load where it was.
- **circuitBreaker, late binding:** `exports.getBreaker(...)` was late-bound. It is now a named self-import, which both emitters compile to a property read on the module's exports at call time. The identity script proves that replacing the export still reaches `withCircuitBreaker`.
- **circuitBreaker, fields:** class fields are `declare`d, so both emitters create each property in the constructor, in the same order, as before.
- **circuitBreaker, null arithmetic:** `Date.now() - null` became `Date.now() - Number(x)`, which is the same number and has no branch. An earlier `?? 0` had added a branch the tests cannot reach, and cost 100% branch coverage.
- **Identity:** dbReady 15 checks and circuitBreaker a 22-step trace (states, errors, log calls, listener calls, property order, pool, late binding), all identical. Both files are at 100% coverage.

**Not converted, with the reason:**
- `utils/generateSwagger.util`: it imports `docs/components` and `docs/tags`, which are JavaScript (P9-21).
- `utils/upload.util`: it imports `utils/fileValidation.util`, which is JavaScript with another agent's uncommitted change.
- `utils/tenantScope.util`: it is the tenant-isolation engine. It gets its own step under the same four gates, and `rawSqlTenantPredicate.d05` walks only `.js` files, so it must learn `.ts` first (below).
- `constants/routeGateExemptions`: still carries another agent's uncommitted change.

**Found (helper 2, confirmed here): source-walking guards ignore `.ts`.** At least 16 guard suites filter on `.js` when they walk the source tree: `systemActors.a124`, `auditInTransaction.p611`, `includeRequired.d12`, `unscopedModels.d17`, `denyPlatformAuthoring.a127`, `dynamicAccessSlugs.a07`, `routePermissionGuard.p604`, `swaggerValidatorAlignment.p608`, `uploadAfterGate.a78`, `migration.service`, `signatureEvidence.d18`, `unboundedFindAll.d24`, `webhookEmit.a11`, `istanbulIgnore.a32`, `jobContext.w12`, `rawSqlTenantPredicate.d05` and `schedulerSwitch.w02`. A converted file therefore leaves each such guard **silently**. For the files converted so far this loses nothing: none holds raw SQL, an `istanbul ignore`, a scheduler, a system-actor literal, a route, a model include or an audit call. But the next layers do. **Every such guard must accept `.ts` before its layer converts**, or a guard reports green having scanned less. This is recorded as a precondition on P9-09 (tenantScope), P9-10, P9-12…P9-21.

**Build fact:** `import * as x from "<commonjs module>"` compiles, under Babel, to an interop helper whose branches are counted against the importing file. Where the import was a self-import, it cost 100% branch coverage. Named imports, or `export =` modules imported by default, do not have this problem.

### Amendment 3 (2026-09-28) — the twelve true-leaf utilities (P9-09, helper 2)

**Converted** (`.ts`, `.js` removed): `utils/{activationToken, appError, auditActor, auditRedaction, csp, dbRole, env, fileResponse, keyring, mfaPolicy, password, schemaVerify}.util`. Each requires nothing unconverted. The require graphs, and the leaves that wait with their reasons, are in `MEMORY/records/2026-09-28-p9-09-utils-leaves.md`: `fileValidation`, `otp`, `response`, `ssrf` and `migrationLock` have another agent's uncommitted diff; `controllerWrapper` depends on two of those; `jsonShape` depends on a validator; `jwt` belongs to P9-12 and has no `@types/jsonwebtoken`.

**Decisions:**

1. **Injected dependencies are typed by the members used, in the module.** `dbRole` and `schemaVerify` type the Sequelize instance and the logger as local structural interfaces. Raw-SQL rows are typed once at the query boundary (`as Row[]` from `unknown[]`). `dbRole`'s single `pg_roles` row is typed as a non-empty tuple, so a missing row still fails where it did. `auditActor` takes a structural `AuditActorRequest` instead of Express's `Request`, because it reads `req.impersonatorId`, which `src/types/express.d.ts` does not declare. When a `.ts` caller first passes a real `Request`, the field moves into the augmentation (ask the lead) and the local type can go.
2. **`AppError`'s hierarchy is typed in `utils/appError.util.ts`, with no shared type.** `toJSON()` returns a module-local `AppErrorBody`. Fields are `declare`d, so the own-property order is unchanged. **`ApiResponse<T>` is not added yet.** `response.util` is its only builder and is not convertible today; the type lands with it as `src/types/apiResponse.ts` (agreed with the lead: no speculative types).
3. **As-built coercions stay, each with a line-level lint directive and a reason.** These are `||` where empty meant unset, `String(x)`/`Number(x)` on what a JavaScript caller passes, and the three `process.env` reads (P9-06). Rewrites are made only where the value is identical for every input:
   - `a && a.b` became `a?.b` where the result is only tested for truth or passed to `|| null`;
   - `return resolve()` became `resolve(); return;` in a callback whose return value is never read;
   - `split(";")[0]` became `split(";", 1).join("")`. The first form needs `?? ""` under `noUncheckedIndexedAccess`, and that branch is unreachable: it cost 100% branch coverage on the first full run.
4. **Named imports for CommonJS libraries** (`createHash`, `hash`/`compare`, `config`). Both emitters compile them to a property read at call time, so `jest.spyOn(crypto, …)` and `jest.mock("bcryptjs", factory)` still apply.

**Accepted differences, each checked:**
- `password.util`'s two exports now have a `name`. `exports.x = async () => …` gave `""`; `export const x` gives `"hashPassword"` and `"comparePassword"`. Nothing reads either.
- The emitted files begin with `"use strict"`. None of the twelve assigns an undeclared name, uses `this` in a plain function, or writes to a frozen object.

**The guard gap (Amendment 2) is not "nothing lost" for these files.** `dbRole` and `schemaVerify` hold raw `sequelize.query` SQL. Today it names `pg_roles`, `information_schema` and catalog tables, never a tenant-scoped table, so `rawSqlTenantPredicate.d05` had nothing to flag in them. But a future edit to either file is no longer scanned until that guard accepts `.ts`.

**Evidence:**
- **Checks:** `npm run typecheck` exit 0; `npx eslint` on the 12 files, 0 problems.
- **Identity:** originals (`git show HEAD:`) against `dist/`, **1,197 checks, 1,195 identical**. The 2 differences are the `Function.name` pair above.
- **Ratchet:** 1197 → 1183.
- **Own suites:** 14 suites, 146 tests passed.
- **Full run:** `npm run test:coverage -- --ci --forceExit` exit 0, 642/666 suites (24 skipped), 12,808 tests (155 skipped), 100/100/100/100.

### Amendment 4 (2026-09-28) — every source-scanning guard reads `.ts`; `tenantScope` is TypeScript

**Decided by the orchestrator:** the guard sweep is a precondition for every further layer.

**1. The sweep: 20 guard suites.** These are the 17 named in Amendment 2, plus `jsonShape.d27`, which also filters on `.model.js`. The 20 include `istanbulIgnore.a32`, which helper 1 had already converted under ADR-092; I built on that and did not overwrite it. `migrationLock.p803.live` is fixed separately in item 5.

**What changed in the guards:**
- Each file filter now accepts `.ts`. The `.model.js` filters now accept `.model.(js|ts)`.
- Guards that name a file by its extension now accept both: p604's mount check strips `.(js|ts)`, and p611's audit-service exemption matches either.
- The four guards that **parse** source with espree now parse a `.ts` file with `@typescript-eslint/typescript-estree`, a new backend devDependency (8.70.1): `includeRequired.d12`, `unscopedModels.d17`, `signatureEvidence.d18` and `unboundedFindAll.d24`. typescript-estree yields the same ESTree node shapes; the visitors walk past the TS-only nodes. Declaration files (`.d.ts`) are skipped.
- `includeRequired.d12` also learned the TypeScript spelling of a model rename, `import { User as U } from "../models"`, beside the existing `const { User: U } = require(...)`.
- No allow-list needed re-keying: no guard lists a file that has converted (checked by searching every guard for the old `.js` path of each converted module).

**Bite proof, per guard.** For each guard, a scratch `.ts` file carrying the forbidden pattern was planted inside the scanned tree. Only that guard was run, it had to FAIL, and the plant was removed (scratch `p9/bite.js`, results in `p9/bite-results.json`). **All 20 bit:**

| Guard | Plant (removed afterwards) | Failed on |
|---|---|---|
| `systemActors.a124` | `utils/zzP9plant.a087.ts`: `"system:probe-invented"` | "no source file invents a 'system:' actor". The first plant, `system:p9-invented`, missed: the guard's pattern is `[a-z-]` with no digits. This was a plant error, not a guard error |
| `auditInTransaction.p611` | a service calling `logAction({ action: "CREATE" })` with no transaction | "every logAction call passes a transaction" |
| `0019-signature-crypto-fields.d29` | a migration with `context.queryInterface \|\| context` | "is frozen to the sixteen reviewed migrations" |
| `includeRequired.d12` | a service with a bare `{ model: User }` include; again with `import { User as U }` | the production-include rule, naming `zzP9plant.a087.service.ts:3 User` |
| `unscopedModels.d17` | `KanbanColumn.findOne({ where: { id } })` | "no unreviewed child-model query omits the parent key" |
| `denyPlatformAuthoring.a127` | a route `POST /sign` with no guard | "every other candidate is in the reviewed NOT_GUARDED list" |
| `dynamicAccessSlugs.a07` | `dynamicAccess("p9-no-such-slug", "read")` | the RUNTIME and count-agreement tests |
| `routePermissionGuard.p604` | an ungated, unmounted route | "every route is gated or exempted" and "every route module is mounted" |
| `swaggerValidatorAlignment.p608` | an undocumented validated route | "no divergence beyond the pinned list" |
| `uploadAfterGate.a78` | `upload.single()` after `dynamicAccess` | "every upload-after-gate route is in the reviewed list" |
| `migration.service` | `db.sync({ force: true })` | "no application source forces a sync" |
| `signatureEvidence.d18` | `SignatureRecord.destroy({ where: {} })` | "no force: true destroy and no bulk destroy" |
| `unboundedFindAll.d24` | `Vendor.findAll({ where: {} })` | "no service adds an unbounded findAll that is not on the reviewed list" |
| `webhookEmit.a11` | two steps: a catalogue event with no emit site made it fail; then a planted `.ts` service as the ONLY emit site made it pass | proves the scan reads `.ts` (this guard fails on absence, so a plant alone cannot make it fail). The catalogue was restored byte for byte |
| `jobContext.w12` | `{ isSystemTask: true }` outside jobContext | "no source file but jobContext.util sets isSystemTask: true" |
| `rawSqlTenantPredicate.d05` | `sequelize.query("SELECT * FROM kanban_projects")` | "every statement that names a tenant-scoped table … mentions tenant_id" |
| `schedulerSwitch.w02` | `cron.schedule` without `scheduleSetting` | "every cron.schedule call site reads its expression through scheduleSetting" |
| `bodylessBody.a09` | a validator whose `validate` returns `undefined` | "validate(undefined, <required schema>) is refused" |
| `jsonShape.d27` | a model with an undeclared JSONB column | "finds the fourteen JSON/JSONB columns" and two more |
| `istanbulIgnore.a32` | a bare `/* istanbul ignore next */` | "every directive states why" and "the count does not rise above 30" |

**2. `utils/tenantScope.util` is TypeScript (P9-09), under the same four gates as `tenantContext`.**

**How the types were written.** They are **local structural interfaces** for the parts of Sequelize this module reads, private members included (`_scope`, `_conformIncludes`, `_expandIncludeAll`, `_getIncludedAssociation`). The models are not typed yet (P9-10), and JavaScript callers may pass anything, so every defensive check the `.js` made is still made. Every line-level lint directive gives its reason:
- `||` stays as built.
- `include.required === undefined` is not rewritten as `??=`, which would also overwrite an explicit `null`.
- `String(owner)` stays, so a tenant id of any JavaScript type compares as its string.
- The "unnecessary condition" after `_conformIncludes` is kept: that call mutates `options`, and the checker cannot see it.
- `withTenantPredicate` gained a `typeof where === "object"` test in front of its prototype check. A primitive's prototype is never `Object.prototype`, so the result is the same; the test only narrows the type for the spread.

| Gate | Evidence |
|---|---|
| (a) the guards that watch it bite on it | A planted `getDataVisibilityScope` in `tenantScope.util.ts` fails q05 ("no source file calls a hierarchy visibility helper"). A planted `sequelize.query("SELECT * FROM kanban_projects")` in it fails d05, naming `utils/tenantScope.util.ts: kanban_projects`. The file was restored byte for byte (`cmp`) |
| (b) identity | **2,810 checks identical** (scratch `p9/compare6.js`) between the original (with its original `tenantContext`) and the compiled `dist/` (with the compiled one). Every export was compared across 6 contexts (none, system, super admin, tenant, `tenantId` null, `tenantId` ""). The comparison covered: `tenantKeyOf` over 8 model shapes; `resolveScope` over 6 option shapes; `applyTenantWhere` over 5 model shapes × 3 `byField` values × 8 `where` shapes × 2 `skipTenantScope` values; `applyTenantToIncludes` over 13 include trees (defaultScope `where`, explicit `required: false` and `null`, separate / limit / pseudo / skip, a throwing association, a `through` model, a literal `where`) × 2 conform modes × 2 skip values; the three create-shaped guards over 8 rows and 3 keys; `applyTenantAssignmentBulk` over 6 instance lists × 4 `fields` shapes; `refuseScopedTruncate`; `scopeHooklessStatics` (the wrapped `aggregate` and `increment`, their recorded calls, idempotence); and `register` (hook names and order, each hook invoked). Mutated options, return values, thrown messages and `Op` symbol keys were all compared |
| (c) isolation suites | 40 suites, **1,196 tests passed**, with `tenantScope.util.ts` at **100/100/100/100**. These are the 39 suites of Amendment 2 plus `uuidDefaults.a116`. The full run passed as well (below) |
| (d) live PostgreSQL 18.6 as `callibrator_app` | The same script as Amendment 2, extended with the A-87 include shape and W-34/D-01 checks. **18/18 passed.** It confirmed that `tenantScope` and `tenantContext` are both the `.ts` modules and that queries run as `callibrator_app`, plus the 13 earlier checks and five new ones: a LEFT include of B's warehouse through A's storage location joins as `null`; an INNER include drops that row and keeps A's own; `count` sees only A's warehouse; `bulkCreate` of a B row from A's context is refused with the exact D-01 message; A cannot update B's row. The containers were removed afterwards |

**3. Evidence at the boundary.**
- `npm run typecheck`: exit 0.
- `npx eslint` on every touched file: 0 errors. `node scripts/ci/eslint-ratchet.js`: "0 error(s), 287 warning(s); baseline 0".
- `npm run ratchet`: 1182, at the floor.
- `npm run test:coverage -- --ci --forceExit`: exit 0, 683 of 707 suites (24 skipped), 12,890 tests (155 skipped), **100/100/100/100**.

**4. Follow-ups recorded (not done here).**
- **D-12 and the branded default-scoped set.** Once the models convert, `includeRequired.d12` should assert that the branded default-scoped set equals the runtime set (the P9-10 spec asks for this).
- **Ordering gap.** `utils/jsonShape.util` imports `validators/iot.validator`, so both must be `.ts` before the first model with a JSON column converts. This is recorded on the P9-09 and P9-10 cards.

**5. `migrationLock.p803.live.test.js` starts `scripts/migrate.js` with `--import tsx`.** The migrate script loads the logger, which is TypeScript, so a plain `node` child can no longer resolve it. The test is live and skipped without a database, which is why no unit run showed the break. The fix was made; the test was not run live here.

**6. Still not converted.**
- `constants/routeGateExemptions` carries another agent's uncommitted change, and the docs-and-authz agent is editing route gates.
- `utils/upload` waits for `utils/fileValidation`. `fileValidation`, `otp`, `response`, `ssrf` and `controllerWrapper` are now free (helper 1 finished) and are next. Their identity baseline must be the **working-copy** `.js`, not `HEAD`, because helper 1's lint edits are in them uncommitted.

### Amendment 5 (2026-09-29) — the released leaves, the last constant, `ApiResponse<T>`, and the baseline against a converted image

**1. Seven more modules are TypeScript.** They are `utils/otp`, `ssrf`, `fileValidation`, `response`, `controllerWrapper` and `upload`, plus `constants/routeGateExemptions`, which leaves **no JavaScript in `constants/`**.
- **Baseline for the identity checks.** Each file was taken from the **working copy**, not `HEAD`, because helper 1's committed-later lint edits were in them. The copies were snapshotted before conversion (scratch `p9/wc/`), each was confirmed unchanged at the moment it was removed (`cmp`), and each was compared against its compiled `dist/` module.
- **What the conversions preserve:**
  - **Late-bound calls.** Wherever the `.js` called `exports.x(...)` (otp's `hashOTP`; fileValidation's `isDangerousExtension`, `isExposableError`, `publicErrorMessage` and `sanitizeError`), a named self-import reads the export at call time, so a replacement still reaches the caller. The identity scripts test this.
  - **Load-time capture.** Wherever the `.js` destructured another module at load (controllerWrapper's three helpers; upload's `v4`, logger, `AppError` and `validateFileMagicBytes`), a `const` captures the value at load the same way.
  - **CommonJS builtins are default imports** (`import fs from "fs"`, `dns`, `net`, `path`, `crypto`). The module object itself is used, so `dns.promises.lookup` is read at call time and the tests' `jest.spyOn(dns.promises, "lookup")` still reaches ssrf. A namespace import would have gone through an interop copy.
  - **Export key order** is kept with an `export { … }` list in the `.js` assignment order.
- **Two load-level differences, both without an observable effect.**
  - `upload` now requires `uuid` **after** its other imports instead of fourth. uuid 14 is ESM-only, so it is loaded with a `require` (a type-only import satisfies the checker: `import type * as UuidModule from "uuid" with { "resolution-mode": "import" }`), and a `require` statement runs after the hoisted imports. uuid has no load-time side effect.
  - `upload` builds its unused module-level default uploader as `void multer({...})` instead of `const upload = multer({...})`. The name would have collided with the exported `upload`; the construction still happens at load.
- **Lint directives, each with a reason:**
  - `process.env` is read per call or at load, as built (P9-06 moves these reads).
  - `||` is kept where `??` would change what an empty string or `0` does.
  - upload's `return next(err)` callbacks are unchanged: `no-confusing-void-expression` is disabled for that file, because `next` returns nothing.
  - Buffer `slice` (deprecated, the same view as `subarray`) is kept.
- **Evidence:**
  - otp, ssrf, fileValidation, response, controllerWrapper: **695 checks identical** (`p9/compare7.js`). They cover 24 IPs, 13 URLs and 5 DNS answers through the SSRF guards; 10 real files × 11 MIME types through `validateFileMagicBytes`; every envelope helper in production and development (the JSON bodies compared as strings, so key order counts); and both controller wrappers over 11 error shapes × 2 environments × 3 API-key states.
  - upload: **41 checks identical** (`p9/compare8.js`). 14 real multipart requests went through the real multer, covering the quarantine, promotion, magic-byte rejection, size limit and file-count limit paths, and what is left in quarantine was compared too. The public guard, the static-file options and headers, `mountPublicUploads`, `getUploadUrl` and `deleteUpload` were also compared.
  - routeGateExemptions: exports, deep values, freeze state and key order in all 24 route files, and `publicRoutes()` (41 routes) identical.

**2. `ApiResponse<T>` is in `src/types/apiResponse.ts`.** It holds `ApiSuccessResponse<T>`, `ApiErrorResponse` and their union. It is typed from what `response.util` builds, its first converted user; `meta` is a top-level sibling of `data`. `express.d.ts` gained the request fields these modules read: `apiKeyAuthorized`, `uploadFolder`, `allowedMimes`, `allowedExtensions` and `uploadFilename` on `Request`, and `isApiKey` on the principal.

**3. One lint rule is switched off, in `eslint.config.js`.** `@typescript-eslint/non-nullable-type-assertion-style` asks for `x!` instead of `x as T`, which is the `!` that `no-non-null-assertion` bans. With both rules on, a checked narrowing could satisfy neither. Two directives written for it earlier were removed, from circuitBreaker and tenantScope. Helper 1 had finished, and I was the only agent at the time.

**4. `jest.config.js` drops `src/constants/**/*.js` from `collectCoverageFrom`.** No `.js` file remains there, and `coverageScope.p614` refuses a pattern that matches nothing. `src/constants/**/*.ts` stays.

**5. The P9-00 baseline passes against a converted image (P9-01b's last item).**
- **Setup:** helper 1's stack (`MEMORY/records/P9-00.md`, the same three compose files and overlay), with the build context pointed at the **working tree**.
- **The image:** built by compose from `backend/Dockerfile` on Node 26.10.0-alpine. `build:dist`: "438 JavaScript files copied, 44 TypeScript files compiled".
- **Boot:** `[schema-verify] OK: 72 tables, 867 columns and 8 control objects match the models`, then "queries now run as the application role callibrator_app". Templates, `swagger.json`, `docs` and `public` were present.
- **Seed:** `seeding` 200, then `seed-demo` 200.
- **Runs:** three consecutive runs of `BASE_URL=http://127.0.0.1:25000 npm run test:e2e`, spaced for the `tenantCreate` budget:
  - A: 12:11:43 +07:00, 53 of 54 suites passed (1 skipped), 392 tests passed, 5 skipped, 19.3 s.
  - B: 12:13:23 +07:00, the same result, 17.3 s.
  - C: 12:15:38 +07:00 with a JSON report. The **same 53 specs with the same per-spec pass counts as the P9-00 set**, from `auth` (32) to `workflows` (5); `liveContract.smoke` skipped (opt-in, 5 tests); 0 failed.
- **Access log across A and B:** 1,042 requests, **0 × 429**, and 5xx only **2 × `POST /api/v1/ai/query` 500**. These are the same figures the baseline recorded (no AI provider on the stack; `ai.e2e` accepts it).
- **Cleanup:** `down -v`, then the image was removed; the `.env` with secrets was deleted.
- **This is also the end-of-round Docker rebuild and boot.**

### Amendment 6 (2026-09-29) — round 6: the context-dependent utils, `jobContext` under the isolation gates, `migrationLock` live, `jsonShape` with `iot.validator`, and P9-06 part 1

**1. Seven more modules are TypeScript.** They are `utils/authorizationWiring`, `publicBaseUrl`, `schedulerSwitch`, `jobContext`, `migrationLock` and `jsonShape`, plus `validators/iot.validator`. **30 of the 36 `utils/` are now `.ts`.** The six left cannot convert yet: `kmsVerify` (P9-18), `jwt` (P9-12), `generateSwagger` (P9-21), and `checkMenu`, `session` and `seedMenuGroups` (after P9-10). The identity baseline was the working-copy `.js`, snapshotted before removal (scratch `p9/wc2/`).
- **`authorizationWiring`, `publicBaseUrl`, `schedulerSwitch`: 150 checks identical** (`p9/compare9.js`). The originals were placed into a copy of `dist/src`, so their `__dirname`-relative scans read the same route tree and seed.
  - `authorizationWiring` still scans `routes/api/*.route.js` only, and reads `seedMenuGroups.util.js` by name. Both reads must learn `.ts` before P9-21 (routes) and P9-10 (`seedMenuGroups`); this is noted on the P9-09 card.
- **`jobContext`, under the four tenant-isolation gates the owner set:**
  - (a) **The watching guards bite on the `.ts` file.** A planted `isSystemTask: true`, and a literal `runAsSystem` reason in another `.ts` file, each failed their w12 guard. With the plants removed, `jobContext.w12` passed 12/12.
    - Its one expectation changed from `utils/jobContext.util.js` to `utils/jobContext.util.ts`; that is a file-name expectation, the kind of test edit these conversions allow.
  - (b) **141 identity checks identical** (`p9/compare10.js`), across contexts: nested, concurrent, thrown and absent.
  - (c) **The isolation suites, `backgroundJobs.w12` and the scheduler suites:** 71 suites and 1,563 tests passed, at 100%.
  - (d) **Live on PostgreSQL 18.6 as `callibrator_app`: 15/15 passed** (`p9/live-jobcontext.js`):
    - A `runForTenant(A)` job's read sees only A. B by id is `null`. A bulk update touches only A's row. Writing a B row is refused. Deleting B's row by code deletes nothing, and B's row is untouched afterwards.
    - `runAsSystem` refuses an unlisted reason before running anything. With a listed reason it spans both tenants.
    - As built, a `create` naming B **inside** an A job is stamped A: validation (`allowNull`) runs before `beforeCreate`, so the create must name *a* tenant, and the hook then overwrites it with the context's. That is recorded as it is, not changed.
  - The live suites `backgroundJobs.w12` (8), `calibrationScheduler.w03` (3), `batch.w17` (2) and `tenantHookless.w34` (6) also passed on PostgreSQL 18.
- **`migrationLock`: 21 checks identical** (`p9/compare11.js`). These use fake connections over the lock-held, lock-after-n-tries, timeout, throw and migrator paths, plus `resolveTimeoutMs` over 8 values.
  - **The p803 live suite passed 4/4 on PostgreSQL 18**, on the scratch database `callibrator_p9_scratch`, including "npm run migrate WAITS for a held lock" (5,077 ms).
- **`jsonShape` + `iot.validator`: 266 checks identical** (`p9/compare12.js`). They cover every `JSON_SHAPES` key over 15 values, the tolerance schema over 12 inputs, and both body schemas.
  - `iot.validator` stays **Joi, byte for byte**; P9-11 keeps its Joi → Zod move. Helper 3's `iot.validator.contract.test.ts` passed **unchanged**.
  - This closes helper 3's ordering gap: both files had to be `.ts` before the first model with a JSON column converts.
  - `jsonShape` sets `shapeKey` with `Object.assign(validator, { shapeKey: key })`. That is the same property on the same function, and gives a typed `ShapeValidator`.

**2. P9-06 part 1: `src/config/env.ts`, and no `process.env` in a converted module outside `src/config/`.**
- **The accessors.** Each reproduces exactly the expression it replaces, and reads at **call** time; nothing is cached at load.
  - `env(name)` is `process.env[name]`.
  - `envOr(name, fallback)` is `process.env[name] || fallback`. It keeps `||` on purpose: an **empty** variable has always meant "use the default" here.
  - `environment()` is the live `process.env` object itself, for functions that take an injectable `env`.
  - `isProduction()` is `NODE_ENV === "production"`.
- **The retrofit.** Every `no-restricted-properties` directive written in Stage B is gone; `grep` finds `process.env` outside `src/config/` only in comments. The retrofitted modules are:
  - `appError`, `controllerWrapper`, `dbRole`, `fileValidation`, `response`, `schemaVerify`, `storagePath` and `upload`;
  - `constants/roleConstants` and `middlewares/activityLog`, whose region directive went too;
  - and this round's `publicBaseUrl`, `schedulerSwitch` and `migrationLock`.
- **Evidence:**
  - **62 environment cases identical** (`p9/compare13.js`). Each case is a fresh process, because several reads happen at load, and each observes all ten retrofitted modules at once. The cases cover `NODE_ENV`, `SUPER_ADMIN_ROLE_ID`, `APP_STORAGE_PATH`, `LOG_TO_FILE`, `LOG_LEVEL`, `DB_APP_ROLE`, `SCHEMA_VERIFY` and `MAX_FILE_SIZE`, each unset, **empty** and set, in both the packaged and the source layout. The originals and the compiled modules also crash identically in the one packaged case whose logger cannot create its directory.
    - `MAX_FILE_SIZE` feeds a module-private constant, so it is checked by its compiled expression.
  - A new test, **`src/tests/config/env.p906.test.ts`** (4 tests), pins each accessor's semantics against hand-written expectations. It **bites**: with `envOr` switched to `??`, 1 of its 4 tests fails.
    - `src/config/` is outside the coverage figure (ADR-085 scope), so this test is its only direct measure.
  - `activityLog.a14.stdout` still passes.
- **Not in part 1: the Zod schema over every variable, and a boot that fails listing every problem.** That changes behaviour, because a boot that starts today could refuse, so it is its own change (P9-06 part 2). The unconverted `.js` still read `process.env` directly and move as they convert.

**3. The round-end boundary.**
- **Full backend coverage run** (`npm run test:coverage -- --ci --forceExit`): **698 of 722 suites passed (24 skipped), 13,052 tests passed (155 skipped), 100% on all four measures**. That run preceded `env.p906.test.ts`, which passed on its own run (4/4).
- **Typecheck:** TypeScript 7 `--noEmit` clean.
- **Lint:** `eslint-ratchet` 0 errors against a baseline of 0.
- **Ratchet floor:** 1172 → 1167 → **1165**.
- **Build:** `build:dist` compiles **52** TypeScript files beside 431 JavaScript files.

**4. The end-of-round Docker rebuild and boot.**
- **Image:** built by compose from `backend/Dockerfile` (Node 26.10.0-alpine) on the P9-00 scratch stack. The `.env` was generated with fresh secrets the way `make secrets` does, with `ALLOW_SEEDING=true`, `FORCE_HTTPS=false`, `VIRUS_SCAN_PROVIDER=none`, and `DB_APP_ROLE` defaulted to `callibrator_app`. `build:dist`: "431 JavaScript files copied, 52 TypeScript files compiled".
- **Boot:** `[schema-verify] OK: 72 tables, 867 columns and 8 control objects match the models`; queries run as the application role `callibrator_app`; the authorization wiring validated 171 `dynamicAccess` gates; `/health` returned 200.
- **Seed and login:** seeding returned 200, and login as the seeded super admin succeeded.
- **Restart:** "roles table agrees with ROLE_LEVELS for 11 seeded role(s)". This exercises `SUPER_ADMIN_ROLE_ID` through `envOr`.
- **Files:** `docs`, `public` and `swagger.json` were present in `/app`.
- **Cleanup:** `down -v --rmi local`; no container, image, network or volume is left, and the `.env` was deleted.

### Amendment 7 (2026-09-29) — P9-10 starts: the model pattern amended, batches 1 (Kanban) and 2 (inventory)

**1. The spec's model pattern does not compile for models that name each other; it is amended.** This is a deviation from `MEMORY/specs/P9-10-model-typing-pattern.md` items 1 and 2, recorded here and in the spec's header.
- **The failure.** The spec's pattern puts `class X extends Model<InferAttributes<X>, …> { declare … }` inside the factory. It fails with **TS2502** as soon as two converted models refer to each other through `Models[...]`, for example `KanbanCard.project` and `KanbanProject.cards`. Each factory's return type is inferred from its class, and the class's base type (`InferAttributes<X>`, which reads every field) needs the other factory's return type, and so round.
  - I reproduced it with two models in scratch (`p9/cyc`, `p9/cyc2`), both with the spec's `function` form and with a `const` arrow. The spec's probes never met it: they converted one model of each pair.
- **Decision: the pattern as built** (`src/models/initModel.ts`):
  - The row type is a **module-level interface**: `interface X extends Model<InferAttributes<X>, InferCreationAttributes<X>> { …attributes, NonAttribute associations, instance methods… }`.
  - The statics are a second interface: `XStatics { associate; restoreStatic; readonly defaultScoped?: DefaultScoped }`.
  - The factory is an **explicitly typed** `const defineModel: DefineX = (db, DataTypes) => { … }`. That keeps the arrow the `.js` had; a `function` declaration would add a `prototype`.
  - The class is built with `initModel<X, XStatics>(class extends Model {}, attributes, { …options, modelName, sequelize: db })`.
  - **At run time this is exactly `db.define`:** `define` sets `options.modelName` and `options.sequelize`, then calls `init` on a fresh anonymous `class extends Model {}`.
- **Unchanged from the spec:**
  - `export =`;
  - timestamps declared but never passed to `init`;
  - the defaultScope `where: { is_deleted: false }` and `includeDeleted: { where: null }`, each with its reasoned `@ts-expect-error` (probes 3 and 2). Both directives are **used**: the typecheck would fail on an unused one;
  - `Models` in `src/types/models.ts` until the barrel converts;
  - statics and prototype methods assigned as the `.js` assigned them. Function names therefore stay what they were: `X.associate = (…) => …` stays nameless, where `Object.assign({ associate })` would have named it `associate`.
- **`initModel` makes one assertion:** the class Sequelize initialised is `ModelStatic<X> & XStatics`. It is the same claim a `declare` field makes. The statics are assigned on the next lines; the brand is phantom and never read.
- **Alternatives considered:**

  | Option | Why not |
  |---|---|
  | The spec's class with `declare` fields | Does not compile for mutually referring models (TS2502) |
  | Keep the class, merge a module-level interface into it | Compiles, but needs `no-unsafe-declaration-merging` and `no-empty-object-type` disabled in every model file |
  | `db.define<X, Omit<…>>()` itself | No assertion at all, but no class form for the 16 models written as `class X extends Model {}` with methods, so two patterns. Kept as the fallback if the assertion proves a problem |
  | Module-level class | Breaks the tests that re-`init` a factory on their own Sequelize (spec item 1) |
- **Bad implications:**
  - Attributes are no longer `declare` fields on a class. They are interface members, so `this` inside a prototype method must be annotated (`function (this: Warehouse)`).
  - Every model now has three small type declarations: the interface, the statics and the factory type.
  - `docs/ENGINEERING/04` § Models is amended to this pattern, referencing this amendment. The spec's own open question 3 had asked for that.

**2. Batch 1 — Kanban (9):** `kanbanCard`, `kanbanCardAssignee`, `kanbanCardLabel`, `kanbanCardRelation`, `kanbanColumn`, `kanbanLabel`, `kanbanProject`, `kanbanProjectMember`, `kanbanSprint`. **Batch 2 — inventory (6):** `warehouse`, `storageLocation`, `stock`, `stockTransfer`, `stockAdjustment`, `stockOpname`. **15 of 71 models are `.ts`.**
- **Baseline:** the working-copy `.js`, identical to `HEAD` for all fifteen. Each was snapshotted to scratch `p9/models-wc/` and confirmed unchanged (`cmp`) when removed.
- **Brands:** `UserId` was added to `src/types/ids.ts` (the Kanban and inventory user keys); tenant keys are `TenantId`.
- **ENUMs** come from `as const` tuples (`DataTypes.ENUM(...WAREHOUSE_STATUSES)`), which give the same values and so the same column.
- **STRING columns** documented as a closed list but not enforced (Kanban `priority`, `status`, `accessLevel`, `type`) are typed `string`, because that is what the database holds.
- **The brand:** `Warehouse` and `Stock` are the first default-scoped models converted, and carry `readonly defaultScoped: DefaultScoped`.

**3. The four checks (ADR-092 item 4), at each batch boundary:**
- **(a) Typecheck:** TypeScript 7 `--noEmit` is clean.
  - **New `src/tests/models/modelTypes.p910.test.ts`** pins ten negative checks, each a used `@ts-expect-error`: a raw string or a `TenantId` where a `TenantId` / `UserId` goes, a missing required attribute, `is_deleted` in values, an ENUM outside its list, an unknown attribute or an association in a `where`, and a DECIMAL-style numeric read as a string. It also has 3 runtime tests: a fresh class per Sequelize, timestamps `allowNull: false`, and the column-key defaultScope.
  - **It bites:** widening `Warehouse.status` to `string`, or `KanbanProject.tenantId` to `string`, each fails the typecheck with TS2578.
- **(b) Definition equality over the WHOLE barrel** (`p9/compareModels.js`). A twin of `dist/src` holds the `.js` originals; both barrels load on unconnected Sequelize instances with associations run. The harness compares for **every** model:
  - name, table and primary key;
  - `rawAttributes` (DataTypes by constructor and SQL);
  - options, and `Object.keys(options)`;
  - `_scope`, scope names and indexes;
  - hooks and associations (type, target, `as`, keys, through, options);
  - the prototype's and the class's own keys and property descriptors, with function names and lengths.

  Results:
  - After each batch: **71 models plus the barrel keys identical**.
  - **The harness bites:** each of these fails it: an unknown option key, `createdAt` declared in `init`, `allowNull` flipped, a named `associate` function, an extra static, a changed association alias.
  - A named class and a moved known option are indistinguishable at run time, as Sequelize's `init` makes them.
- **(c) The model guard suites** are green, together with the migration suites that re-`init` factories on their own Sequelize (the spec's module-shape regression), `jsonShape.d27` and `rawSqlTenantPredicate.d05`: 67 suites and 2,089 tests after batch 2. The inventory and Kanban unit, route, controller, service and two-tenant suites are included.
- **(d) The models' own figure,** by ADR-092's named command widened to `src/models/**/*.{js,ts}`:
  - after batch 1: 95.49 / 75.32 / 95.14 / 95.41;
  - after batch 2: 95.57 / 75.32 / 95.14 / 95.50;
  - ADR-092's reference was 93.5 / 65.58 / 93.17 / 93.39. The figure did not fall, and every converted model and `initModel` is at 100%.

**4. D-12's follow-up is done.** `includeRequired.d12` now asserts that, among the converted `.model.ts` files, the models declaring `defaultScoped: DefaultScoped` **equal** the models whose runtime defaultScope carries a `where`.
- It asserts at least 15 converted files and the presence of `Stock` and `Warehouse`.
- **It bites** both ways: a stray brand on `KanbanSprint` and a removed brand on `Warehouse` each fail it. A synthetic case pins that a brand inside a comment does not count.

**5. No production `.ts` file may import the `.js` models barrel.** This is a new `no-restricted-imports` entry in `backend/eslint.config.js` for `src/**/*.ts`; tests are exempt, because they type the barrel locally.
- The pattern matches `../models`, `../models/index`, `./index` and `.`.
- **It bites:** planted imports of `../models`, `./index` and `.` each fail. `../types/models` and `./initModel` pass.
- **Why it matters:** the plant showed a type taken from the `.js` barrel is `any`, which is the reason the rule exists.

**6. Live on PostgreSQL 18.6 as `callibrator_app`.** The scratch databases were booted as `index.js` boots (`runSchemaSetup`: `db.sync()` then 63 migrations, 75 tables) with the **converted** models. After each batch:
- `dataLayer.dbD` 6/6 (including D-26's enum mirror against `pg_enum`, and the Kanban project delete), `dataLayer.dbC` 4/4 and `bulkDestroyRoutes.w33` 12/12 (including the paranoid `KanbanProject` delete) passed on the booted database.
- `dataLayer.dbB` 10/10 and `dataIntegrity.p6` 22/22 passed on fresh empty databases.
- **Batch 2 live probe, 21/21** (`p9/live-inventory.js`):
  - defaults as before; an ENUM outside its list is refused;
  - `softDelete` hides the row through the defaultScope;
  - a bare include of a soft-deleted `Warehouse` **drops** its stock (INNER JOIN), and `required: false` keeps it with `warehouse: null`;
  - `restoreStatic` restores one row, and from tenant A it touches none of B's;
  - B's row is unchanged.
- The container and its volume were removed.

**7. The boundaries.** Full `npm run test:coverage -- --ci --forceExit`:
- after batch 1: 699 suites, 13,058 tests;
- after batch 2: **700 suites, 13,061 tests**, 100% on all four measures;
- ESLint ratchet: 0 errors;
- `ts-ratchet` floor: 1165 → **1150**;
- `build:dist`: 416 JavaScript files copied, 69 TypeScript files compiled.

### Amendment 8 (2026-09-29) — P9-10 batches 3–4: the class variant, D-21 and D-27 typing, and `initModel`'s timestamp parameter

**1. The class variant, for the 16 models the JavaScript wrote as `class X extends Model { static associate(){…} }`.** It was settled on batch 3, which holds 9 of them.
- The factory keeps an inner class with the same members (`class XModel extends Model { static associate(models: Models): void {…} }`). It passes that class to `initModel` in place of `class extends Model {}`, and returns the typed result.
- Statics and methods stay **class members, so they stay non-enumerable**, as they were. A method reading attributes declares `this: X`.
- The class's own name differs (`XModel`), but `init` sets `name` to the `modelName` with the same descriptor, as for the anonymous class `define` made. The descriptor comparison holds it identical.
- **Proved:** making `associate` enumerable in the compiled file fails the full-barrel comparison. A reassignment onto the existing non-enumerable method changes nothing and correctly passes. `modelTypes.p910` asserts `Object.keys(Workflow)` has no `associate` and its descriptor is `enumerable: false`.
- **One recorded difference, not a model difference:** these 16 files exported an **anonymous** arrow (`module.exports = (sequelize) => …`). Converted, the factory is the typed `const defineModel`, so the module export's `Function.name` is `"defineModel"`, not `""`.
  - An `export =` of an annotated arrow was tried in scratch; it re-enters the TS2502/TS7022 cycle.
  - Nothing reads a model factory's name. Every factory's arity is unchanged: `(sequelize)` stays one argument, and `(sequelize, DataTypes)` two.

**2. D-21 (DECIMAL)**, in `invoice` and `assetFinance`:
- The attribute is typed `number`, the getter's output.
- `toNumber` is `(value: unknown): unknown` with the JavaScript body unchanged: `null` **and `undefined`** returned as they are. The spec named `value ?? null` as the mistake not to make.
- Each getter declares `this: X` and returns `unknown`, which is Sequelize's own getter type.
- **Proved** by the harness's new behaviour check, which evaluates every attribute getter on built instances with sample values, all-null values and an empty build. It shows the string→number, `null` and `undefined` paths, and it bites on the `?? null` mistake and on a getter returning the raw string.
- `decimalGetters.d21` is green.
- **Live on PostgreSQL 18.6:** a real `NUMERIC` read back as 1250.5 / 250.25; `amountDue - amountPaid === 1000.25`; `raw: true` still returns the driver's string, as documented; and `min: 0` validation still refuses a negative price.

**3. D-27 (JSON)**, in `usageAlert`:
- `NotificationChannels = ("email" | "webhook")[]` is written by hand in `utils/jsonShape.util.ts`, **beside its Joi shape**, and added with the model that first uses it.
- `modelTypes.p910` pins it: `["sms"]` is a type error (a used `@ts-expect-error`), and the Joi validator also refuses `["sms"]` and accepts the typed sample.
- `jsonShape.d27` is green. **Live:** a write of `["sms"]` is refused with `SequelizeValidationError`.

**4. `initModel` gained a third type parameter, `Auto`,** naming the timestamp attributes Sequelize adds. The default is all three.
- `NotificationState` declares `deletedAt` itself: a per-user hide on a model that is **not** paranoid. It passes `"createdAt" | "updatedAt"`, so that column goes to `init` as before.
- This is types only; `modelTypes.p910` asserts `paranoid` is `false` and the column is nullable.
- **Live:** a hidden state row is still found.

**5. The harness's behaviour check.** For every model with a `get` or `set`, it builds instances four ways (sample values, shifted samples, all `null`, empty) and compares the getter outputs and `dataValues`. Generated `UUIDV4` and `NOW` defaults are normalised, so only their presence and type are compared.
- It covers the VIRTUAL getters (`Risk.rpn`, `SupplierScorecard.overallScore`) and D-21.
- It bites on a changed `rpn` formula.

**6. Batches:**
- **Batch 3, workflow/QMS/suppliers (11):** `workflow`, `workflowStep`, `workflowInstance`, `workflowAction`, `capa`, `nonConformance`, `sopDocument`, `sopTrainingAcknowledgment`, `vendor` (all class-shaped), `risk` and `supplierScorecard` (define, VIRTUAL getters).
- **Batch 4, billing/usage/notifications/operations (10):** `invoice`, `subscription`, `notification`, `notificationState`, `batchJob`, `maintenanceWorkOrder` (class-shaped), `planQuota`, `usageMetric`, `usageAlert` and `assetFinance` (define).
- **Total: 36 of 71.**
- The working-copy `.js` was the baseline: six of these files carried other agents' earlier uncommitted edits. Each was snapshotted and confirmed unchanged (`cmp`) when removed.
- `CalibrationDevice` joined the `Unconverted` entries in `Models`.
- **Held for their own batch,** as the owner directs: `Session`, `User`, `Tenant` and the tenant-isolation-critical models, with **`AuditLog`** (the compliance ledger) among them. That batch runs the isolation suites and a live two-tenant probe.

**7. The four checks and the boundaries.**

| Check | After batch 3 | After batch 4 |
|---|---|---|
| (a) TypeScript 7 typecheck | clean | clean |
| (b) Full-barrel definition equality | 71 identical (26 originals placed) | 71 identical (36 originals placed) |
| (c) Model guards, migrations, d05, d27 and the domain suites | 94 suites, 2,407 tests | 106 suites, 2,612 tests (`decimalGetters.d21` + `jsonShape.d27`: 89/89) |
| (d) Models' own figure | 95.73 / 75.32 / 95.14 / 95.66 | **95.87 / 75.32 / 95.14 / 95.81** |
| Full gate, 100% on all four measures | 700 suites, 13,061 tests | **700 suites, 13,065 tests** |

- Every converted model is at 100%.
- **Live on PostgreSQL 18.6 as `callibrator_app`** (schema booted by `runSchemaSetup` with the converted models), after each batch: `dbD` 6/6, `dbC` 4/4, `w33` 12/12, `dbB` 10/10, `p6` 22/22.
- **Per-batch probes:** batch 3 **25/25** (`p9/live-b3.js`); batch 4 **25/25** (`p9/live-b4.js`). They cover defaults, ENUM and email validation, VIRTUAL getters read back, D-21, D-27, joins, and tenant B never reading or updating A's rows.
- The container and its volume were removed. The three older dangling volumes were left alone, as directed.
- **Ratchets:** `ts-ratchet` floor 1150 → **1129**; the ESLint ratchet is at 0.
- **Build:** `build:dist` compiles 90 TypeScript files beside 395 JavaScript files.

### Amendment 9 (2026-09-29) — P9-10 batches 5–6: calibration and certificates, signatures; method behaviour in the equality check; `skipTenantScope` typed

**1. Batch 5, calibration and certificates (6):** `calibrationDevice`, `calibrationRecord`, `certificate`, `iotReading`, `attachment`, `documentChunk`. **Batch 6, signatures (4):** `eSignatureRecord`, `signatureRecord`, `signatureWorkflow`, `signatureWorkflowStep`. **46 of 71 models are `.ts`.**
- **Brands:** `CalibrationDevice`, `CalibrationRecord` and `Attachment` carry the D-12 brand. D-12 holds the branded set (now five models) equal to the runtime set.

**2. What these models carry, typed without changing it:**
- **A-29 `toJSON` override.** It is typed `function <T>(this: CalibrationDevice): T`, matching `Model#toJSON<T>()`. It stays anonymous, as before; helper 3's sketch named it, which would have changed `Function.name`. A reasoned directive covers `no-unnecessary-type-parameters`. `iotTokenHash` is declared as an attribute: an unscoped read and `create()` carry it.
- **P6-03 lifecycle columns** on `CalibrationRecord` are plain nullable attributes. The append-only guarantee is the database trigger and the grant, not a type.
- **Certificate.**
  - Its four transitions are typed instance methods with `this: Certificate`, anonymous as before. The two statics take the barrel as `CertificateModels`: `{ Certificate; Sequelize: typeof Sequelize & { Op } }`. Sequelize's typings omit the static `Op` that exists at run time.
  - `STATUS` and `CERTIFICATE_TYPES` gained `as const`, which is types only.
  - Kept with reasoned directives: `tenantCode || "T"` and `signedBy || approvedBy`, because an empty string must keep falling back.
  - The raw `COUNT` rows are asserted to `{ status; count }[]`.
  - One multi-line ternary keeps its original layout under `// prettier-ignore`, because the ESLint `indent` rule and Prettier disagree on it.
- **D-22.** Attachment's custom validator is typed `(value: unknown): void`, with `${String(value)}` in its message (the same text).
- **D-27, written beside the Joi shapes in `jsonShape.util.ts`:**
  - `UncertaintyBudget` and `IotMetrics` (`JsonObject`);
  - `CalibrationResults` (`JsonObject | ""`);
  - `ReadingTolerance` / `MetricBounds` (at least one of `min` / `max`);
  - `SignaturePolygon` (`JsonObject | JsonValue[]`);
  - `SignatureBiometricData` (`string | JsonObject`).

  `JsonValue` and `JsonObject` are in the new `src/types/json.ts`, per spec item 5.
- **`skipTenantScope` is typed** by module augmentation of `FindOptions`, in the new `src/types/sequelize.d.ts` (spec § Security). It only adds the optional key; nothing gets stricter, and nothing types tenant isolation itself.

**3. The equality harness now also checks behaviour, not only shape:**
- **Every function-valued attribute validator** (custom ones, and every D-27 `jsonShape`) is run on 20 fixed samples, comparing pass or the error message.
- **Instance methods** on built instances with `save()` stubbed: `toJSON` keys for every model; `softDelete` (the flag set and the save options); and Certificate's four transitions from every status, with `signedBy` null **and** `""`.
- **It bites on each plant:**
  - `toJSON` no longer stripping `iotTokenHash`;
  - `submitForApproval` landing on the wrong status;
  - `sign`'s `||` changed to `??`, which the empty-`signedBy` case catches;
  - `revoke` no longer idempotent;
  - the D-22 validator accepting everything;
  - a D-27 shape key swapped.

**4. The checks.**

| Check | Batch 5 | Batch 6 |
|---|---|---|
| (a) Typecheck | clean | clean |
| (b) Full-barrel equality, with validators and methods | 71 identical (42 originals placed) | 71 identical (46 placed) |
| (c) Model guards, migrations, d05, d27 and domain suites | 137 suites, 3,417 tests | 87 suites, 2,291 tests (`signatureEvidence.d18` + the eSignature two-tenant suite: 7/7; the Part 11 eSignature suites green) |
| (d) Models' own figure | 95.93 / 75.32 / 95.14 / 95.87 | **95.99 / 75.32 / 95.14 / 95.93** |
| Full gate, 100% | 700 suites, 13,065 tests | **700 suites, 13,065 tests** |

- Attachment and Certificate were already below 100% as JavaScript: they are two of ADR-092's ten. They did not fall: 84.61 → 86.66 and 88.13 → 88.52. The uncovered lines are the same code (`softDelete`, and the transition error paths).
- **Live on PostgreSQL 18.6 as `callibrator_app`,** with the schema booted by `runSchemaSetup` using the converted models:
  - **batch 5 probe, 41/41** (`p9/live-b5.js`):
    - A-29 on create, scoped read and unscoped read;
    - `softDelete` and **A-133** `restoreStatic`;
    - **Q-02**: retired to active refused by the trigger, while a remarks edit is untouched;
    - **P6-03**: a content change refused, DELETE refused, a void allowed once, and a void final;
    - Certificate numbering, and submit → approve → sign in one transaction, then revoke idempotent and `countByStatus`;
    - **D-22**: an unknown type refused, and a legacy free-string row still soft-deletable;
    - D-27 refusals, and tenant B touching nothing of A's, `restoreStatic` included.
  - **batch 6 probe, 18/18** (`p9/live-b6.js`): defaults, D-27 polygon and biometric round-trip and refusals, **D-18** hard delete of a signed step refused, the A-149 revoker FK, joins, and isolation.
  - **Live suites after each batch:** `dbD` 6/6, `dbC` 4/4, `w33` 12/12, `dbB` 10/10, **`p6` 22/22** and **`q02` (`calibrationDevice.retired.q02.live`) 10/10**.
  - The container and exactly its volume were removed.
- **A pre-existing finding, not caused by the models:** `keyRotation.s08.live` fails 2 of 5 on a fresh database. `keyRotation.service` walks `users.mfa_secret` / `mfa_pending_secret` since S-20 (migration 0086, commit `a31c601`), but the test's expected report, last touched in `8a11905`, lists no `users` rows.
  - No converted model is involved (`User` is JavaScript).
  - Recorded for the owner; not changed here.
- **Ratchets:** `ts-ratchet` floor 1129 → **1119**; the ESLint ratchet is at 0.
- **Build:** `build:dist` compiles 101 TypeScript files.

### Amendment 10 (2026-09-29) — P9-10 batches 7–8: content, tickets and GDPR; platform

**1. Batch 7, content/tickets/GDPR (8):** `post`, `category`, `postCategory`, `ticket`, `ticketComment`, `ticketCounter`, `consentRecord`, `dsarRequest`. **Batch 8, platform (5):** `customDomain`, `scimGroup`, `webhook`, `webhookDelivery`, `tenantBackup`. **59 of 71 models are `.ts`.**
- The baseline is `HEAD` `ce74932` (the working copy was clean), snapshotted and confirmed with `cmp` on removal.
- **Brands:** `Post`, `Category` and `Webhook` carry the D-12 brand, so eight models are branded. D-12 holds the set equal to the runtime set.
- **D-27 types, beside their Joi shapes:** `DsarDetails`, `WebhookPayload` and `TenantBackupMetadata` (`JsonObject`), and `WebhookEvents` (`string[]`; the event-name pattern is not in the type).
- **Generator changes** (scratch `p9/gen-models.js`): a model with no statics gets `TypedModel<X>` and no empty statics interface; `Models` is imported only where it is used.

**2. What these models carry, typed without changing it:**
- `Webhook`'s custom `isHttpUrl` validator tests `String(value)`. `RegExp#test` applies ToString to its argument, so the result is the same, and the harness's validator check holds it identical.
- `Webhook.softDelete(options = {})` keeps passing the caller's options, so the delete shares its audit row's transaction. **Live:** a rollback undoes it.
- **`TenantBackup`'s five statics** keep their unused trailing `models` parameter, renamed `_models`: the arity is unchanged, and a reasoned directive covers `no-unused-vars`, whose TypeScript rule has no `_` exemption. Also kept:
  - The `||` fallbacks are kept in a directive region.
  - `createBackup` still passes `name` and `description`. They are **not** attributes, so Sequelize drops them on insert, as before. A reasoned `@ts-expect-error` marks the line.
  - `updateStatus` accumulates the caller's keys in a `Record<string, unknown>`, as the JavaScript did.
  - The `{ transaction }` option objects are built exactly as before: one per call, and `undefined` when absent. A `null` would switch off Sequelize's CLS transaction. Each object is typed through a variable, then asserted, because object-literal assertions are banned.
  - `parseInt(String(limit), 10)` is the same parse, since `parseInt` applies ToString.
- **As-built facts the live probe pinned:**
  - The CMS (`Post`, `Category`, `PostCategory`) is platform-global by design (D-17). Tenant B reads a post created in A's context, and slugs are unique platform-wide.
  - A **bare** include of the default-scoped `Post` from a category whose only post is soft-deleted **removes the category row** (D-12's INNER JOIN); `required: false` keeps it. This is the documented defect shape, unchanged; the probe first expected an empty list and was corrected to the as-built behaviour.

**3. The checks.**

| Check | Batch 7 | Batch 8 |
|---|---|---|
| (a) Typecheck | clean | clean |
| (b) Full-barrel equality, with validators and methods | 71 identical | 71 identical |
| (c) Model guards, migrations, d05, d27 and domain suites | 77 suites, 2,137 tests | 99 suites, 2,638 tests |
| (d) Models' own figure | 96.08 / 75.32 / 95.14 / 96.03 | **96.14 / 75.32 / 95.14 / 96.09** |
| Full gate, 100% | 700 suites, 13,065 tests | **700 suites, 13,065 tests** |

- On ADR-092's below-100 list, `post`, `category`, `webhook` and `tenantBackup` all rose (80 → 85.71, 77.77 → 81.81, 84.61 → 86.66 and 87.03 → 87.93). The uncovered lines are the same code.
- **Live on PostgreSQL 18.6 as `callibrator_app`,** after each batch: `dbD` 6/6, `dbC` 4/4, `w33` 12/12, `dbB` 10/10, `p6` 22/22, `q02` 10/10.
- **Probes:** batch 7 **25/25** (`p9/live-b7.js`); batch 8 **26/26** (`p9/live-b8.js`).
  - Batch 8 covers:
    - the Webhook url validator, A-51 (no secret default) and D-27 events;
    - P6-13's `softDelete` in the caller's transaction;
    - every `TenantBackup` static, including a rolled-back `updateStatus`, an unknown id, and the `''` tag fallback;
    - CustomDomain defaults, the ScimGroup → role join, and isolation, including B's `hasValidBackups` for A being `false`.
  - The container and exactly its volume were removed.
- **Ratchets:** `ts-ratchet` floor 1119 → **1106**. The ESLint ratchet is at 0, and its warnings fell 283 → 278 as `tenantBackup.model.js`'s five unused-arg warnings went with the file.
- **Build:** `build:dist` compiles 114 TypeScript files.

**4. Remaining:** the tenant-isolation-critical batch (12), in the **same merge** as the barrel `models/index`, as the owner directs: `session`, `user`, `tenant`, `role`, `auditLog`, `apiKey`, `tenantKey`, `tenantSettings`, `tenantHierarchy`, `userMenuPermission`, `roleMenuPermission`, `menuGroup`.

### Amendment 11 (2026-09-29) — P9-10 DONE: the tenant-isolation-critical models and the barrel, in one merge

**1. The last 12 models and `models/index` are TypeScript. P9-10 is complete: 71 of 71 models, plus the barrel.**
- **The models:** `session`, `user`, `tenant`, `role`, `auditLog`, `apiKey`, `tenantKey`, `tenantSettings`, `tenantHierarchy`, `userMenuPermission`, `roleMenuPermission`, `menuGroup`.
- **Baseline:** `HEAD` `ce74932`, the working copy being identical. Each file was snapshotted and confirmed unchanged (`cmp`) when removed.

**2. How the special cases are typed, with no runtime change:**
- **`models/index.ts`:**
  - It calls the same 71 factories, in the same order, as `defineModel(db, DataTypes)`, through a one-line `define` helper.
  - The registry is an object literal typed `Models`, so a model missing from the map, or a map entry without its model, is a compile error. The literal replaces the `models[model.name] = model` loop and has the same key order.
  - The same `associate` loop; `"associate" in model` is equivalent here, because a model either has the function or lacks the key.
  - `Object.assign(db, { sequelize, Sequelize, Op })` for the three property writes: the same `[[Set]]`, in order.
  - `register(db)` after the associations, exactly where the `.js` called it. Hoisting the `tenantScope.util` **import** moves only a module load with no load-time effect.
  - The export object is copied verbatim, keys and order.
  - It is a pure `export =` module. A named `export type` beside it compiled, under **tsx/esbuild**, to a reference to an undefined binding (`models_module is not defined`). The live boot found this and Jest's Babel transform did not. `ModelsBarrel` lives in `src/types/models.ts`.
  - **One assertion:** `tenantScope`'s parameter type names Sequelize internals (`_scope`, `_conformIncludes`) that the public typings omit, so the instance is passed as that view.
- **`src/config/index.d.ts` (new).** The barrel is the first TypeScript importer of the still-JavaScript config, and under `allowJs: false` a `.ts` file cannot import a `.js` one without types. This declaration file declares exactly `index.js`'s exports (`db`, `Connection`, `Sequelize`). It emits nothing, and it goes when `index.js` converts (the rest of P9-06).
- **The lazy `kms.service` requires stay lazy.** User and TenantSettings `require` the JavaScript `kms.service` inside their factories, as the `.js` did, each typed by the functions it reads, following the Amendment 5 precedent. TenantSettings' `tenantSecretSettings` (TypeScript) is required in the factory too, to keep the load timing.
- **Tenant** keeps its four **named** hooks (`excludePlatformTenant`), typed by a parameter every Sequelize hook's options satisfy. The `includePlatformTenant` opt-in is part of that type.
- **User:**
  - The `getterMethods` are typed `this: User`, and declared on the row as `NonAttribute`.
  - `process.env.HOST_URL || ""` becomes `envOr("HOST_URL", "")`, the same semantics (P9-06).
  - The S-20 hooks read `options.attributes` / values through narrow local types (Sequelize internals).
  - `beforeUpsert`, a run-time hook shorthand missing from Sequelize's static typings, is called through a typed view; the same applies to TenantSettings.
- **Session** keeps its snake_case attributes. Its type makes `tenantId` a compile error in a where, in an update, and on an instance (TS2551), pinned by three used `@ts-expect-error`s in `modelTypes.p910.test.ts`. The unknown `underscoredAll` option is kept, and the options type accepts it, as the spec found.
- **TenantSettings' hooks** read `options.instance` / `options.attributes` / `options.where` through narrow local types, with `async` kept (as built, with reasoned directives).
- **The D-27 types** (`ApiKeyScopes`, `AuditLogChanges`, `TenantSettingsJson`) were added beside the Joi shapes. The P9-11 helper, with my clearance, converts `jsonShape.util.ts` and `iot.validator.ts` to Zod after this boundary; the types become `z.infer`.
- **Recorded finding, not fixed (ADR-038 rule 3):** `Role.prototype.softDelete` checks `this.is_system`, but the attribute is `isSystem`. The guard never fires, and a system role **can** be soft-deleted, as the live probe shows. The TypeScript keeps it, with a reasoned `@ts-expect-error`. The harness **bites** if the guard is "fixed" (`this.isSystem`), so the fix must be its own change. It is in BACKLOG as a finding for the owner.
- **`src/types/models.ts`** now holds all 71 entries; the `Unconverted` placeholder is gone.
- **Lint:** Amendment 7's `no-restricted-imports` rule, which barred production `.ts` files from importing the `.js` barrel, is retired.
- **D-12:** asserts exactly 71 converted files, and a branded set equal to the whole reviewed runtime list: 13 models (ApiKey, Attachment, CalibrationDevice, CalibrationRecord, Category, Post, Role, Session, Stock, Tenant, User, Warehouse, Webhook).

**3. "No consumer's view of any model changes."** The proof is the full-barrel equality **against the whole pre-batch JavaScript model layer**: the twin holds 72 JavaScript originals (71 models plus the `.js` barrel) against the compiled TypeScript.
- **It compares per model:**
  - definitions (attributes, options, scopes, indexes, associations, descriptors);
  - getter and setter behaviour (four build variants) and every validator outcome;
  - instance methods: `toJSON` keys **and values**, `softDelete`'s whole resulting state, and the Certificate transitions;
  - **hook behaviour:** Tenant's exclusion over five option shapes, User's S-20 paths, and TenantSettings' encrypt, refuse and decrypt paths.
- **It compares for the barrel:**
  - every key and **what it holds** (`model:X`, `<Sequelize ctor>`, `<Op>`), in key order;
  - that `sequelize === db`;
  - the **global hooks** registered on `db` (tenant isolation), by name and function;
  - that 71 models are registered.
- **Result:** identical, with `HOST_URL` set so that User's `picture` getter is exercised.
- **It bites** on each plant:
  - Tenant's exclusion ignoring `includePlatformTenant`, or comparing `=`;
  - S-20 accepting plaintext;
  - a secret setting stored plaintext;
  - Session's `softDelete` not revoking;
  - `picture` ignoring `HOST_URL`;
  - the Role guard "fixed";
  - a plural alias dropped, or an alias pointing at the wrong model;
  - the tenant-isolation hooks not registered;
  - `Op` not re-exported.

**4. The checks.** The tree state is recorded in scratch `p9/b9-tree-state.txt`: `ce74932` plus this batch plus the P9-11 helper's checkpoint.
- **What the helper's checkpoint contained:**
  - `validation.middleware.ts`, replacing the `.js`; it accepts Zod or Joi, with the Joi path byte-identical;
  - a new `validators/input.ts`, imported by nothing;
  - `validated?: unknown` in `express.d.ts`;
  - `zod ^4.6.5` in `package.json` and the lockfile.
- **What it did not contain:** no validator was converted, and `jsonShape.util.ts` and `iot.validator.ts` were untouched. The helper paused its edits for the boundary.
- **(a) Typecheck:** the whole tree is clean.
- **(b) Equality:** identical, as above.
- **(c) Suites:** 285 suites and 6,002 tests over the model, migration, guard, isolation, two-tenant and domain suites. That includes `twoTenantRoutes.guard`, the `tenantScope` suites, `tenant.platform.a125`, `user.mfaSeedAtRest.s20`, `tenantSettings.secrets.a150` / `bulkPaths.a177`, and `includeRequired.d12` (24/24).
- **(d) Models' own figure:** **96.59 / 75.32 / 95.19 / 96.59**, every model in `.ts`, against ADR-092's 93.5 / 65.58 / 93.17 / 93.39.
- **Full gate (08:27Z tree):** **700 suites and 13,065 tests passed**. Coverage was **99.84 / 99.7 / 99.75 / 99.84**, short of 100% in exactly the helper's two new, not-yet-tested files (`validation.middleware.ts` 52%, `validators/input.ts` 40%); every other file was at 100%.
- **Closing full gate (08:43Z tree, recorded in `p9/b9-tree-state-final.txt`, green):** after the helper added `validation.p911.test.ts`, and after the branded deny sentinel (§6), **701 suites, 13,076 tests, 100 / 100 / 100 / 100**. Typecheck clean, `ts-ratchet` at the floor (1092), ESLint ratchet 0, `build:dist` 129 TypeScript files, and the full-barrel equality identical again.
- **Live on PostgreSQL 18.6 as `callibrator_app`, through the TypeScript barrel:**
  - the schema boot (63 migrations, 75 tables);
  - **the final two-tenant probe, 54/54** (`p9/live-b9.js`). It covers:
    - the barrel's surface (no `db`, `sequelize === db`, `Op`, 71 models, aliases);
    - **A-125:** `findByPk`, listing, count and bulk update never reach PLATFORM, while the opt-in does;
    - **S-20:** plaintext refused on a bulk update and on `save()`, an envelope accepted;
    - User getters; reads, **includes** (User → role/tenant, Session → user, MenuGroup → permissions) and **bulk ops** (B's update and destroy of A's rows touch nothing);
    - **Session snake_case** (a camelCase `tenantId` where fails at run time too); Session `softDelete` / `restoreStatic`;
    - TenantSettings stored as an envelope and read decrypted, with a plaintext upsert refused;
    - D-27 on ApiKey and AuditLog; TenantKey's `privateKey` never selected; TenantHierarchy isolation;
    - RoleMenuPermission / UserMenuPermission `isIn`;
    - **AuditLog's 0033 actor CHECK** refusing a user row without a user, a system row not named `system:`, and any new `unknown` row.
  - the live suites: `dbD` 6/6, `dbC` 4/4, `w33` 12/12, `dbB` 10/10, `p6` 22/22, `q02` 10/10, and the isolation live suites **`backgroundJobs.w12` 8/8** and **`tenantHookless.w34` 6/6**.
  - The container and its volume were removed.
- **Recorded finding (for the owner):** audit rows are append-only **by the application only**. The live probe shows the application role holds **UPDATE and DELETE on `audit_logs`**, and there is no audit trigger. The docs call the table append-only; the database does not enforce it, unlike `calibration_records` (P6-03).
- **Docker and the P9-00 E2E baseline against the converted image:**
  - `build:dist` inside the image: 358 JavaScript files copied, **129 TypeScript files compiled**.
  - Boot: `[schema-verify] OK: 72 tables, 867 columns and 8 control objects`; application role `callibrator_app`; 171 gates validated; `/health` 200; seeding 200 and seed-demo 200.
  - **E2E run A (15:38:15 +07:00): 53 passed, 1 skipped; 392 tests passed, 5 skipped, 0 failed** (21.3 s).
  - **E2E run B (15:40:00, 65 s after A for the `tenantCreate` budget): the same result** (19.9 s).
  - The **per-spec pass counts of all 54 specs in A and in B equal the P9-00 reference set**, compared from the JSON reports. `E2E_MFA_STATE_FILE` was left unset (the P9-00 trap).
  - **Access log over both runs:** 1,042 requests (the two seed calls included), **0 × 429**, and 5xx only **2 × `POST /api/v1/ai/query` 500** — the same environment-dependent pair as the baseline (no AI provider).
  - **Teardown:** `down -v --rmi local`; no container, image or volume is left, and the `.env` was deleted.
- **Ratchets:** `ts-ratchet` floor **1092** (the helper ran it: 13 model and barrel `.js` files, plus its `validation.middleware.js`). The ESLint ratchet is at 0.

**6. The last P9-10 DoD line: `tenantScope`'s deny branch is a `TenantId`.** `NO_TENANT_UUID: TenantId = NO_TENANT_ID`, branded in `src/types/ids.ts`, the one place a brand assertion is allowed (a constant, never input). It is the same string. The diff is 4 insertions and 2 deletions, applied to the `HEAD` file without reformatting. The isolation suites (26 suites, 1,079 tests) and the full gate are green.

**7. Findings recorded for the owner** (TASKS/BACKLOG): Q-34 (`audit_logs` append-only only by the application), Q-35 (the Role `is_system` guard never fires), and Q-36 (`keyRotation.s08.live` stale since S-20).

**8. Next card in this lane.**
- **P9-07, the typed bind-parameter SQL helper,** is next. Every Stage C card's Definition of Done requires "raw SQL uses the P9-07 helper", so it comes first.
- **Then P9-12, identity and access (Stage C, services),** once P9-11 (the helper, validators) lands. P9-12's A-48 gate is closed (A-48 DONE).
- **Why the typed barrel matters for Stage C:** a `.ts` service now gets real model types from `require("../models")`.
- **Also still open in this lane:** P9-06 part 2 (the Zod environment schema and the fail-listing boot).

### Amendment 12 (2026-09-29) — P9-07: the bind-only SQL helper, its lint rule, and D-05 reading it

**1. `src/utils/sql.util.ts` is the one way TypeScript code runs raw SQL.**
- **Signature:** `sql<Row extends object>(runner, text, bind = [], { transaction }) → Promise<Row[]>`.
- **Accepted values:** `bind` takes `BindValue` only: string, number, bigint, boolean, Date, Buffer, null, or arrays of these.
- **`replacements` cannot be passed.**
  - The options type has no such key.
  - At run time a JavaScript caller that passes one gets a `TypeError` before anything reaches the database.
- **A statement naming `$n` beyond the bound values is refused** with a `TypeError`, again before the database.
  - This is the ADR-039 shape: `$1` sent as a replacement, which read all metered usage as zero.
  - `$n` inside a quoted string literal is not counted; `$` quoting and `::` casts are not placeholders.
- **What reaches Sequelize:** the helper passes `{ type: "SELECT" }`, adding `bind` and `transaction` only when given. A migrated call therefore makes **the same `query()` call** as before.
- **`Row` is the caller's claim about the row shape;** the driver checks nothing. `sql<any>` is a lint error (`no-explicit-any`), and a primitive `Row` is a compile error.

**2. Deviation from the card (ADR-038 rule 3): `sql(runner, text, bind)`, not `sql(text, bind)`.**
- **Why:** every raw-SQL module already receives or requires its Sequelize instance, and the unit tests pass a double. A helper that imported the instance itself would:
  - load the configuration and open a pool on import, for every module and test that uses it;
  - make the tests' injected doubles impossible without module mocking.
- **Alternatives considered:**
  - (a) `sql(text, bind)` importing `config/index`. Rejected for the import-time connection and the loss of injection.
  - (b) A factory `makeSql(runner)` returning `sql(text, bind)`. Rejected: one more indirection at every call site, and no more safety.
- **Bad implication:** a caller can pass the wrong runner (for example a bootstrap connection). The type accepts anything with the same `query`, as the raw call did.

**3. Enforcement:**
- **Lint (`backend/eslint.config.js`).**
  - In TypeScript application source, a `.query(...)` call on `sequelize` / `db` / `database`, or on `x.sequelize`, is a `no-restricted-syntax` error: "Run raw SQL through utils/sql.util#sql".
  - Exempt: `sql.util.ts`, TypeScript tests, and `src/migrations/**/*.ts`. Migrations run DDL through the QueryInterface outside any tenant; the helper is SELECT-only, and D-05 excludes migrations by design. The exemption was added when the first `.ts` migration (Q-34, `0091`) was announced; a plant in `src/migrations` is clean, and one in `src/utils` still errors.
  - Bite: a planted file with `sql<any>` and a direct `db.query` gets exactly those two errors. The tree has 0 offenders.
- **One reasoned exemption:** `dbReady.util.ts`'s `SELECT 1` connectivity ping keeps its direct call, under `eslint-disable-next-line` with the reason "a connectivity probe, not data access". Its test asserts that exact call.
- **D-05 (`tests/utils/rawSqlTenantPredicate.d05.test.js`)** now reads every `sql(...)` / `sql<Row>(...)` call, taking the statement from the second argument.
  - For helper calls, a statement naming a tenant-scoped table must **bind** its tenant predicate (`tenant_id = $n` or `"tenantId" = $n`). Merely mentioning it is not enough.
  - The rule is checked by synthetic sources: an interpolated `'${tenantId}'` and a missing predicate are both flagged, while the bound one and a global table are not.
  - The scan sees the 7 helper calls in the converted utilities.
- **The bound value is asserted:** `tests/utils/sql.p907.test.ts` (7 tests) checks that the tenant id is in `bind[0]` and absent from the statement text.

**4. Migrated call sites** (the converted utilities; each suite passes unchanged):
- `authorizationWiring.util.ts` (roles; its `QueryTypes` import goes);
- `dbRole.util.ts` (the application-role check);
- `schemaVerify.util.ts` (5 catalog queries).

None names a tenant-scoped table.

**What remains:** 19 direct `query(` calls in 11 JavaScript files. They move to the helper as their modules convert, which is the Stage C DoD line "raw SQL uses the P9-07 helper". D-05 keeps its existing presence check on them until then.

**5. Proof:**
- **Unit:** `sql.p907` 7/7, with `sql.util.ts` at 100%; `rawSqlTenantPredicate.d05` 6/6; the three migrated suites unchanged.
- **Live on PostgreSQL 18.6 as `callibrator_app`, with a fresh schema boot (75 tables): `p9/live-p907.js` 10/10.**
  - A bound tenant predicate returns exactly that tenant's row, for A and for B.
  - The control, without the predicate, returns both tenants' rows, because raw SQL bypasses the hooks.
  - `$1` as a replacement fails in PostgreSQL (the ADR-039 defect), while `sql()` refuses it with a `TypeError` before the database; `replacements` is refused at run time.
  - A transaction passes through: an update is visible inside it and gone after rollback.
  - A bound predicate for the wrong tenant updates nothing.
  - `enterApplicationRole` itself ran through the migrated `dbRole` check.
  - The container and volume were removed.
- **Joi→Zod (P9-11) did not change model JSON acceptance.** The full-barrel harness was run with `HEAD`'s Joi `jsonShape` / `iot.validator` overlaid into the JavaScript twin, and `P9_ACCEPT_ONLY=1`. The result was identical; only the messages differ, which is the P9-11 change. The helper independently counted 1,022 checks with 0 differences.

**6. Full gate (09:17Z tree: `ce74932` + P9-10 + P9-07 + the P9-11 helper with `joi` uninstalled and its service-test rewrites still finishing):**
- `npm run test:coverage`: **699 suites passed, 13,269 tests passed, 0 failed** (24 suites / 155 tests skipped — the env-gated live suites). Coverage 100 / 99.99 / 100 / 100.
- The only file short of 100% is the P9-11 helper's `validators/iot.validator.ts` (one branch, line 47), in its lane and reported to it. Every file in this lane is at 100%, including `sql.util.ts`.
- **Closed by the P9-11 helper's own run** (reported to this lane after `iot.validator.p911.test.ts` landed): `npm run test:coverage -- --ci --forceExit` exit 0, 700 of 724 suites / 13,272 tests passed, **100 / 100 / 100 / 100**.
- Typecheck clean; `ts-ratchet` at the floor (**1050**, after the helper removed 42 `.js`); ESLint ratchet 0; `build:dist` 319 JavaScript files copied, **169 TypeScript files compiled**.
- Also: the last Joi wording in this lane (two `appError.util.ts` comments, three `modelTypes.p910` comments/title) now says Zod or is neutral; `grep -rnwi joi` over the lane is empty.

### Amendment 13 (2026-09-29) — P9-12 batch 1: `jwt.util`, and the session, webauthn, userPermission and roles services

**1. Converted** (`.ts`; each `.js` removed after `cmp` against its snapshot): `utils/jwt.util`, `services/session.service`, `services/webauthn.service`, `services/userPermission.service`, `services/roles.service`.
- **Baseline:** the working copy, which includes the P9-11 Zod changes to `auth`/`user` (not these five).
- **Still to do in P9-12:** `user.service` and `auth.service` (batch 2), then `apiKey`, `sso`, `scim` and `oidcProvider`, released by the security-fixes agent after A-275/A-278/A-280 (ADR-094).

**2. The Stage C module pattern (decided here, for every service that follows).**
- **`export =` of one object literal,** in the original key order: `require()` returns the same shape as before, the same keys in the same order, and **no `__esModule` marker**. `roles.service` exports its class, as it did.
- **Internal calls go through that object.** A function that called a sibling through `exports.x(...)` now calls `service.x(...)`, the object `export =` exports. A spy on the module (`jest.spyOn(sessionService, "validateSession")`) still intercepts the internal call. A named ES export would not: Babel and tsc compile the reference differently.
- **A JavaScript `const { a, b } = require(m)` stays a load-time destructure,** from a default import (`import redis from "./redis.service"; const { get } = redis;`). A named ES import is a live lookup, which changes what a later spy on `m` affects.
- **A still-JavaScript dependency is imported through a sibling declaration file,** following the `config/index.d.ts` precedent. Under `allowJs: false` a `.ts` file cannot import a `.js` one untyped.
  - New: `services/redis.service.d.ts` and `services/audit.service.d.ts`, each an `export =` of exactly the module's export object, typed from its code.
  - A lazy `require()` of a JavaScript module keeps its laziness, typed inline (the Amendment 5 precedent): `auth.service` from webauthn, `menuGroup.service` from roles.
- **Types a consumer needs live in `src/types`** (an `export =` module cannot also export types: TS2309, and the tsx trap of Amendment 11). New: `src/types/auth.ts` (`TokenClaims`, `TokenPayload`, `DecodedToken`, `TokenPurpose`).
  - `TokenPayload` types every claim `unknown`; jsonwebtoken's `JwtPayload` types them `any`.
- **`src/types/sequelize.d.ts`:** `skipTenantScope` is accepted on the options of every operation the tenant hooks scope (count, update, destroy, restore, create, bulkCreate, upsert, save, instance destroy/restore), not only `find`. It is type-only.
- **`src/types/express.d.ts`:** `Request.impersonatorId?: string | null` and `AuthenticatedPrincipal.role.roleLevel / role_level`, added for the P9-19 middlewares. Each was checked against the JavaScript that sets or reads it.

**3. The one accepted surface change: function names.**
- `exports.x = async () => {}` created an **anonymous** function (`name === ""`); `const x = async () => {}` names it `"x"`.
- This is the same class of change as the `defineModel` factory name accepted in Amendment 8.
- Counted, not hidden, by the surface harness: 11 exports in session, 4 in userPermission. jwt, webauthn and roles already had named functions.

**4. Identity evidence.**
- **Export surface:** `p9/compareSurface.js` loads the original `.js` beside the compiled module inside `dist/src`.
  - It compares, per export: key order, enumerability, writability, getter or value, `typeof`, function `length` and `name` (with only the §3 difference accepted), class statics and prototype, and `__esModule`.
  - `dist` stopped loading mid-batch (the P9-22 contracts package resolves to TypeScript source), so the final run used `p9/compareSurfaceSrc.js`. It is the same comparison: the converted module is loaded from `src/` through tsx, and the original from scratch with its relative requires made absolute into `src/`, so both share every dependency instance. Nothing is written inside `src/`.
  - **Result: all five identical.** jwt.util (12 keys), session.service (16; 11 anonymous exports now named), webauthn.service (6), userPermission.service (4; 4 now named), roles.service (19 statics).
- **jwt.util behaviour:** `p9/compareJwt.js` ran **1,223 checks over 8 key-ring configurations**, all identical to the JavaScript. It covers:
  - the ring configurations: HS256; HS512 with a previous key; RS256 with the private key only; RS256 with public and previous keys; ES256; RS256 without a private key; empty and custom expiries;
  - the tokens: access and purpose tokens are byte-identical when minted in the same second, and each side's tokens verify on the other;
  - the refusals and their messages; a token whose `kid` names the current key but that was signed by the previous one; expiry pass-through; and the five load-time configuration refusals.
  - **Bite-tested:** each of 4 plants in the compiled file was detected. The plants were a changed default expiry, a changed refusal message, kid selection removed, and the type check disabled.
- **Tests: unchanged,** except the allowed re-key. `unboundedFindAll.d24` keys its allow-list by file name, so 7 entries moved from `.js::` to `.ts::` (session 1, userPermission 4, roles 2).
  - Per module, every suite that references it passed, with the module at **100 / 100 / 100 / 100**: jwt.util 50 suites / 941 tests; session 50 / 843; webauthn 6 / 113; userPermission 40 / 1,026; roles 40 / 806.
  - The failures seen in those runs were another agent's in-flight edits (risk and supplier-scorecard). That agent fixed them.
- **Typecheck:** the whole tree is clean for these files. **ESLint:** 0 errors on every file of this batch.

**5. Compiler-exposed defects, recorded and not fixed** (ADR-038 rule 3; TASKS/AUDIT-2026-09-REMEDIATION.md). Each is kept with a reasoned `@ts-expect-error` naming its id:
- **A-285 (medium):** `roles.service` reads `role.is_system`, but the attribute is `isSystem` (the Q-35 class, in the service). `updateRole`'s system-role guard never fires, and `deleteRole` **destroys** a system role instead of deactivating it.
- **A-286 (low):** `createRole` writes `is_system`, which Sequelize drops.
- **A-287 (low):** `createMenu` / `updateMenu` write `sort_order` and `is_active`, which Sequelize drops (A-148 fixed only `parent_id`). TypeScript reports only the first excess property of a literal, so one directive covers both; the comment says so.
- Not a defect, kept: `roles.service`'s `permissionType || permission_type` fallback. `permission_type` is not an attribute, so the fallback is dead on model rows; tests use it on doubles. It is now one helper, `permissionTypeOf`, instead of six inline copies.

**6. New guard: declaration drift.** `tests/guards/declarationDrift.p912.test.ts` compares, for every `x.d.ts` beside an `x.js` under `src/`, the keys the declaration names with the keys `require()` returns.
- **Found at once:** `audit.service.js` had gained two constants from another agent, `AUDIT_DEFAULT_WINDOW_DAYS` and `AUDIT_COUNT_CAP`, which the declaration did not name. The declaration now names them.
- **Bite-tested:** dropping a key fails the guard, and restoring it passes.

**7. Coverage config:** `collectCoverageFrom` now excludes `src/**/*.d.ts`. A declaration emits nothing, and without the exclusion the new ones counted as 0% files and failed the global gate. `coverageScope.p614` still passes.

**8. Packages** (owner rule; installed from the root with `^`):
- `@types/jsonwebtoken@^9.0.10` (new; jsonwebtoken ships no types) and `@types/qrcode@^1.5.6` (it resolved only by hoisting).
- `npm audit` 0. Neither has install scripts, so `allowScripts` is unchanged. Their dependencies are type packages only (`@types/ms`, `@types/node`).

**9. Tree state at this boundary.** Other agents are working in parallel: P9-19 middlewares, P9-22 contracts, the security-fixes agent, and the leaf-services helper.
- **The full coverage run was not green, for reasons outside this batch.** Its failures are all in other agents' in-flight files: stripeWebhook ×3, signingKeyWrap.s08, schedulerSwitch.w02, audit.platform.a125, audit.service, and the new auditPrincipal.util.ts (75% branches).
- **The ESLint ratchet reports 18 new errors, all in other agents' files:** two new test files for oidc/scim, and metricsAuth / denyPlatformAuthoring (P9-19).
- `dist` builds (303 JS copied, 189 TS compiled) but does not load: `@callibrator/contracts` still resolves to TypeScript source until the P9-22 build step lands.
- `ts-ratchet` floor 1045 → 1035.
- **Every file of this batch is at 100% and lint 0.**

### Amendment 14 (2026-09-30) — P9-12 conversions complete: user, auth, apiKey, sso, scim, oidcProvider, oidcJwks; the Stage C leaves; P9-19 round 1

**1. Converted under Amendment 13's pattern** (each `.js` removed after `cmp` against its snapshot):
- **Batch 2:** `services/user.service` and `services/auth.service`.
  - `auth.service` was snapshotted only after three other agents had finished their edits to it and confirmed the auth suites green: bootstrap (P10-16), security-followups (A-288 signInPolicy) and Phase 10 (P10-10/P10-12).
- **Batch 3:** `services/apiKey.service`, `services/sso.service`, `services/scim.service`, `services/oidcProvider.service` and `services/oidcJwks`.
  - `oidcJwks` is converted with the OIDC domain.
  - These were taken only after the security-fixes agent released them, with A-275/A-278/A-280 already in the JavaScript.
- **P9-12 has converted every module on its card:** `utils/jwt.util` and the session, webauthn, userPermission, roles, user, auth, apiKey, sso, scim and oidcProvider services, plus oidcJwks.

**2. Identity evidence** (`p9/compareSurfaceSrc.js`; the only accepted change is that anonymous `exports.x =` functions are now named after their key):

| Module | Keys | Newly named | Suites | Tests | Coverage |
|---|---|---|---|---|---|
| user.service | 17 | 12 | 25 | 584 | 100% |
| auth.service | 32 | 22 | 72 | 1,248 | 100% |
| apiKey.service | 6 | 6 | 17 | 405 | 100% |
| sso.service | 5 | 5 | 10 | 191 | 100% |
| oidcProvider.service | 17 | 16 | 5 | 356 (plus the oidc route suites, 6 / 138) | 100% |
| scim.service | 12 | 12 | 11 | 240 | 100% |
| oidcJwks | 6 | 6 | 13 | 244 | 100% |

- **Every suite failure in these runs was traced to another agent's in-flight file, and none is caused by a conversion:**
  - d24 entries for other agents' new services;
  - `bodyless.a09` attachment.upload;
  - `readGates.p604` get-assignments;
  - `passkeyLogin.p1010`, which timed out under load and passes 22/22 alone;
  - `sso.oidcRoundTrip.a68`, which failed identically with the ORIGINAL `sso.service.js` swapped back in, and passes after the SSRF agent's fix.
- The only test change is d24's allow-list, re-keyed from `.js::` to `.ts::` for user, auth, oidcProvider and scim.

**3. Types added or changed, all type-only:**
- `User.id` is now `CreationOptional<UserId>`. A user's id is a `UserId`, as `Session.user_id` already was. There was no fallout elsewhere in the tree.
- `TokenClaims` is `object`. A named claims interface (ActivationClaims) has no index signature, and jsonwebtoken signs any object.
- `session.service` createSession's `ipAddress` / `userAgent` / `device` are optional, because callers omit `device`.
- **New declarations:** `services/mfa.service.d.ts` (an exported class instance; its methods are on the prototype), `services/rateLimiter.redis.service.d.ts` and `services/emailQueue.service.d.ts`.
  - A member no converted module calls is `(...args: never[]) => unknown`. It cannot be called until someone types it, so its first TypeScript caller writes the type.
  - Plain-function modules declare their members as PROPERTIES, not methods, so a load-time destructure is sound (`unbound-method`). mfa keeps method syntax, because its methods use `this`.
- **`declarationDrift.p912` now counts a class instance's prototype methods.** It detects a plain object's prototype structurally (its prototype is `null`), because under Jest the module's realm is not the test's. Bite-tested.
- **Other agents have since added members to these declarations:** `storeIncr` / `storeTtl` / `countsFailuresByIp` (requestBudget, ADR-100) and `queueNotificationEmail` (notificationChannels). The drift guard holds each declaration to its module.

**4. File-level reasoned disables, first used here.**
- In `auth.service` and `scim.service` the as-built `||` fallbacks number in the dozens, and each treats `""` and `0` as absent. So `@typescript-eslint/prefer-nullish-coalescing` is disabled for the whole file, with that reason, instead of line by line.
- `scim.service` also disables `prefer-regexp-exec`, `no-base-to-string`, `no-unnecessary-type-conversion` and `only-throw-error`. Those cover its `match()` calls, its `String()` coercions of IdP input, and re-throwing a caught value as caught.
- `user.service` and `auth.service` disable `only-throw-error` for the whole file. Both throw plain `{ status, message }` objects, which the controllers read (the A-272 surface).
- **Every other directive is per line, with its reason.**

**5. Compiler-exposed defect, recorded and not fixed:**
- **A-295 (medium):** `user.service#editUser` writes `isActive: user.is_active`, and `is_active` is not an attribute. `updateUserSchema` strips the request's `is_active`, so every edit writes `isActive = undefined`, most likely NULL.
  - It is kept with a reasoned `@ts-expect-error`.
  - The effect on PostgreSQL is to be measured before the fix, which is its own change with a real-model test.

**6. Fixed as their own changes, not in the conversion:**
- A-285/A-286/A-287 and A-294, with the regression test `roles.attributes.a285.test.ts` (failing 7/10 before the fix, 10/10 after). The record is `2026-09-29-a285-a294-role-menu-attributes.md`.
- **A-294 was renumbered from A-288:** two agents claimed A-288 within minutes. The other agent's A-288 is cited in ADR-094, and mine was only in my own files.

**7. Stage C leaves, from the leaf-services helper** (record `2026-09-30-p9-stage-c-leaf-services.md`):
- **Converted, all under Amendment 13's pattern:** eleven services — `storage/signing`, `storage/keys`, `storage/config.service`, `quarantineSweep`, `featureFlag`, `email`, `reporting`, `content`, `contentMedia`, `alert` and `notificationChannels`.
- **Identity:** 11,635 checks against the working-copy `.js`. Every difference is the accepted `Function.name`.
- **Lazy requires:** a lazy `require` stays lazy where loading the dependency has effects (`alert` → `email`).
- **`search` waits for its own change:** its `replacements` SQL moves to `sql()` only in a change that may edit its tests.
- **Packages:** `@types/nodemailer`, `@types/mustache` and `@types/sanitize-html`.
- **A-297** (the content envelope) was fixed as its own change.

**8. P9-19 middlewares, round 1** (helper; record `2026-09-29-p9-19-middlewares-round1.md`):
- **Converted:** 10 middlewares — notFound, validateUuid, requestTimeout, globalSanitizer, accessLog, createFolder, errorHandlers, and, under the four gates, metricsAuth, rbac and denyPlatformAuthoring.
- **Evidence:** 11,053 + 853 identity checks, and a live PG18 boot.
- **New test:** `rbac.lowestBar.p919`, which is the first to catch a Math.min→Math.max plant.
- **Findings:** multipart bodies bypass globalSanitizer, and accessLog's errorLog is never mounted. Both are with the multipart-sanitizer agent.

**9. Not yet done for P9-12's DoD:** the full coverage gate on a quiet tree, and the P9-00 E2E baseline against a built image.
- At this boundary `npm run typecheck` and `build:dist` are red only in other agents' in-flight files: `accessRequest.service.p1005.test.ts`, `roles.fields.f19.test.ts` (F-19, ADR-105, from an agent now editing `roles.service.ts`), and `utils/ssrf.util.ts:307` (the SSRF agent).
- Both proofs run when those land.

**10. Packages:** `@types/jsonwebtoken` and `@types/qrcode` (Amendment 13). No new package in this amendment.

### Amendment 15 (2026-09-30) — Every module must LOAD: a load gate in `make verify` and CI, and `export =` stands alone

**What happened.** On 2026-09-30 the backend failed to boot while typecheck and the 100% jest gate were green:
- `certificate.model.ts` threw `jsonShape is not defined` at load;
- `webauthn.service.ts` threw `webauthn_service_module is not defined`.

The second came from a conversion shape nothing checked: an `export interface` beside `export =`. TypeScript accepts it, and Babel (jest) erases it, but tsx/esbuild compiles the module into a reference to an undefined `<file>_module`, which throws when the module is first required. Jest mocks a module's dependencies and typecheck executes nothing, so no gate ran a module's top level the way production does.

**Decision.**
1. **The load gate.** `backend/scripts/load-check.ts` (`npm run load:check`) requires every module in a child process with no mocks. The child gets placeholder configuration: a database and Redis on port 1, random secrets, and the P10-05 pepper. A module that throws at load fails the gate, listed with its error.
   - It runs two passes:
     - every module under `src/` (not `src/tests`, and not the `src/scripts` CLIs, which run on load), in one process;
     - a **fresh** process requiring what `index.js` requires, in its order, so that a circular-import failure only the boot order triggers shows up.
   - It has two modes:
     - the default loads `dist/` under plain `node`, the tree the image's pkg binary runs;
     - `-- --src` loads `src/` under `node --import tsx`, which is what `npm start` and CI's boot job run.
   - **Both modes are needed.** The `export =` defect exists only in tsx's output, because tsc compiles it correctly for `dist/`. A top-level `ReferenceError` fails in both.
   - It is wired into `make verify` (target `load-check`, after `build`) and into CI (job `backend-load`: `build:dist`, then both modes).
2. **`export =` stands alone** (lint, `backend/eslint.config.js` `EXPORT_EQUALS_ALONE`). In a module that uses `export =`, any `ExportNamedDeclaration` or `ExportDefaultDeclaration` is a `no-restricted-syntax` error. This includes `export interface` and `export type`. Types go in `src/types/` or a sibling `.d.ts`.
   - The rule is in every `.ts` block: application code, tests, migrations and `src/types`.
   - On 2026-09-30, 0 existing modules violated it.

**Evidence.**
- **The tree:** `npm run build:dist`, then `npm run load:check`: 527 modules, plus 102 in boot order, OK (dist via node). `npm run load:check -- --src`: 527 + 102, OK (src via tsx).
- **Src mode bites:** a planted `src/utils/zzLoadProbe.p9.ts` (`export interface` + `export =`) failed it with `zzLoadProbe_p9_module is not defined`.
- **Dist mode bites:** a planted `dist/src/utils/zzLoadProbe.js` that references an undefined `jsonShape` failed it.
- **The lint rule bites:** the same probe fails with the rule's message.
- Both probes were removed.

**Bad implications.**
- The gate proves a module loads, not that the app reaches readiness. CI's `boot-and-migrate` job still does that against PostgreSQL 18, but only through tsx, never through `dist/`, and `make verify` has no boot at all.
- A module whose load needs a live service is reported, not tolerated, because the placeholders connect nowhere. That is intended, but a module that validates configuration at load needs its placeholder added to the script, as `ACCESS_REQUEST_IP_PEPPER` did.
- Dist mode needs a fresh `build:dist` (about 4 minutes locally).
- Requiring every module in one process in path order can mask a failure that only another order triggers. Only the index.js boot order is checked separately.

### Amendment 16 (2026-09-30) — P9-23: the migrations are TypeScript; their names are frozen

(Placed by the Phase 9 lead from the P9-23 lane's text in `MEMORY/records/2026-09-30-p9-23-migrations.md`.)

1. **Names are strings in the manifest, not files.** Umzug keys `schema_migrations` by the manifest's name string. All 63 historical names (0001–0090) end `.js`, and they stay that way. A migration's name is `<module path>.js` for a `.ts` file too, fixed when first applied and never changed.
   - `migrator.js`'s requires are extensionless, so tsx and jest load the `.ts` and `dist/` loads the compiled `.js`. The manifest itself did not change.
   - `manifestNames.p923.test.ts` freezes the 63 names. It was typed by hand from a PG18 database's rows, written before any rename, and seen to fail on a tidied name. It also refuses a module present as both `.js` and `.ts`, and an unregistered file.
2. **Conversion is type-only, with a closed list of runtime-neutral edits:**
   - `export =` with the same object;
   - an in-function `require("sequelize")` becomes a top-level import;
   - `env()` in place of `process.env`;
   - JavaScript services stay `require`d in place, typed (Amendment 11's precedent).

   `||` is never turned into `??`, and the 16 D-29 fallbacks are kept literally. Lint's behaviour-changing suggestions are refused with `-- as built` line disables.
3. **Evidence standard for a migration:**
   - (a) a recording seeded-fuzz QueryInterface, original `.js` against compiled `.ts`, `up` and `down`, including refusal branches (37,800 runs, 0 differences);
   - (b) a normalised AST diff whose remaining lines are each argued neutral;
   - (c) live PG18: identical `schema_migrations`, schema-only dump and grants on a fresh build, and nothing pending on an upgrade.

   (a) alone missed an injected `||`→`??` change, so (b) is required, not optional.
4. **`src/migrations/**/*.ts` keeps Amendment 12's exemption** from the direct-query rule. Migrations still issue DDL and raw SQL through the QueryInterface outside any tenant.
5. **Bad implications:**
   - 0056 now reaches `fs`/`crypto`/`path` through `__importStar` namespace wrappers. This is live delegation, but a different object from the module.
   - Four migrations still `require` JavaScript services and get their types from local casts, not from the services. The casts can drift until Stage C converts those services.
   - The identity fuzz covered 63–75% of the lines of 0030, 0037, 0066 and 0086; their unit suites cover the rest.

### Amendment 17 (2026-09-30): the Phase 9 exit is on source; the `.js` tests move to P9-26

**ADR-109 §5** amends this ADR's exit as P9-24 carried it ("ratchet at zero, tests included; `allowJs: false`"). It is a working decision under the owner's delegation, awaiting the owner's confirmation.
- Phase 9 exits when every **non-test** source module is TypeScript and `allowJs: false` holds for source (`tsconfig.build.json`, item 3).
- The existing `.js` test files move to **P9-26** and are converted opportunistically.
- **Amendment 1's rule is unchanged:** the ratchet counts tests and refuses any new `.js` file.
- The base config's `allowJs`, and the ratchet itself, go when P9-26 empties the list.

### Amendment 18 (2026-09-30) — P9-15 / P9-17: warehouse and commercial services

(Placed by the Phase 9 lead from the services helper's text; record `MEMORY/records/2026-09-30-p9-15-17-warehouse-commercial-services.md`.)

- **Converted, all under Amendment 13's pattern:** `warehouse` and `stock` (P9-15); `billing`, `finance`, `stripeWebhook` and `meteredBilling` (P9-17). `quota` was converted earlier by the leaf helper (Amendment 19).
- **Identity:** 70,009 checks against the working-copy `.js`. Every difference is the accepted `Function.name` of `exports.x =` functions. Each harness caught every plant that applied, 33 in all.
- **Lazy requires stay lazy:** `stock` → `workflow.service`, `stripeWebhook` → the `stripe` SDK, `meteredBilling` → the models barrel. The harnesses prove each one.
- **Load-time environment reads stay load-time:** `stripeWebhook`'s two secrets. `NODE_ENV` stays per call.
- **Raw SQL moves to `sql()` in its own change, before the conversion:** `meteredBilling`'s two statements, with one test assertion changed and a fail-before of 1/56.
- **New `.d.ts` files beside still-JavaScript modules:** `webhook.service.d.ts` and `workflow.service.d.ts` (a class instance, prototype methods included). Only the members a converted caller uses are typed; the rest are `(...args: never[]) => unknown`. `declarationDrift.p912` holds both.
- **A swap is one step.** The `.ts` is built and proved in a scratch mirror of `src/`, then swapped in with the `.js` deleted. `build:dist` refuses an `x.js`/`x.ts` pair, and a half-done swap of `meteredBilling` blocked every lane's build once on 2026-09-30. This is now a rule for every Stage C swap.
- **Findings recorded, not fixed:** A-319 to A-322.

### Amendment 19 (2026-09-30) — Stage C leaves, rounds 2–4 (the leaf helper), including `tenantBackup` under the four isolation gates

(Placed by the Phase 9 lead; record `MEMORY/records/2026-09-30-p9-stage-c-leaf-services.md` §§ Round 2–4.)

- **Round 2 converted** `quota` (P9-17), `ownSessions` (P9-12 area, released by the lead), `webhookDeliveryPurge` (P9-18), `iotDevice` (P9-14), `sop` (P9-16) and `admin` (P9-13). Each was compared against the working-copy `.js`, and each harness was bitten by planted changes.
- **Round 3 converted** `iot` and `jobMonitor`.
  - `iot`: 103/103 identical; one `IotService` instance with `declare`d fields; `mqtt.connect` is a named import.
  - `jobMonitor`: 26 multi-step scenarios identical; `cron` is node-cron's default export; the `redis`, `sequelize` and models requires stay lazy.
  - The W-13 exemption is re-keyed to `jobMonitor.service.ts`.
- **Round 4 converted `tenantBackup`** under the four isolation gates, a pattern the other isolation-critical conversions (P9-13) follow:
  - **(a)** 9 planted defects, each caught by a watching suite, with the file restored byte for byte;
  - **(b)** an identity harness: 189/189 identical, and the zip written is byte-identical;
  - **(c)** 84 isolation and authz suites, 1,757 tests;
  - **(d)** a live PostgreSQL 18.6 probe as `callibrator_app`, 24/24. A's backup cannot be restored into B, and a crafted archive creates no account and changes no role, active flag, status, password or tenant.
  - The untrusted archive is typed `unknown` field by field, and every check in `assertRestorable`, `reconcileUsers` and `pickFields` is kept.
- **Bad implication:** the live probe's container stalled at removal, and cleaning it up is a manual step for its owner.

### Amendment 20 (2026-09-30) — P9-13 converted: networkSecurity, tenantHierarchy, customDomains, dataRetention, tenantLifecycle, tenant, tenantUpload

(Placed by the Phase 9 lead from the P9-13 helper's text. Record: `MEMORY/records/2026-09-30-p9-13-tenancy.md`. With `featureFlag`, `admin` and `tenantBackup` (Amendment 19), every module on the P9-13 card is TypeScript.)

1. **Converted under Amendment 13's pattern.** Each `.js` was removed after `cmp` against its working-copy snapshot. tenant.service's baseline includes A-320.
   - Every `.ts` was typechecked in scratch against the tree (build config, absolute imports) before the swap, so the tree stayed buildable.
   - One swap early on did leave a half-fixed `tenantHierarchy.service.ts` in `src/` for a moment, and it broke an image build. Amendment 18's one-step-swap rule is why.
2. **Identity:** 570,332 checks against the JavaScript, all identical. Each harness was bitten by plants in the compiled module.
   - The export surface is identical, except that 48 formerly anonymous functions are now named.
   - Two unused load-time names were dropped: tenantLifecycle's `isEnabled` (featureFlag.service is still loaded, as a side-effect import) and tenant's `MAX_LIMIT`.
   - Internal `exports.x` calls in dataRetention and tenantLifecycle now go through the export object.
3. **The isolation-critical `tenantHierarchy`, `tenantLifecycle` and `tenant` passed the four gates:**
   - (a) 29/29 planted defects caught;
   - (b) identity;
   - (c) 127 suites, 2,458 tests;
   - (d) a live PostgreSQL 18.6 two-tenant probe as `callibrator_app`, 41/41, plus the live suites w20, w15w16 and w12, 14/14.
4. **Compiler-exposed defects, kept with reasoned `@ts-expect-error`:**
   - A-326: an upper-case status is written into the lower-case ENUM; measured on PG18 as a 500.
   - A-327: a null or empty email is written into the NOT NULL `isEmail` column; measured as a 500.
   - A-328: `createdBy` is dropped.
   - The live probe also found A-329: a root's tree lists no children. The JavaScript has the same defect.
5. **Typing notes:**
   - `db.Sequelize.Op` / `.Transaction` and `db.sequelize` are typed through an intersection with the runtime statics that Sequelize's typings omit, never through `as unknown as`.
   - `parseInt(process.env.X)` becomes `parseInt(String(env("X")))`. That is identical, because parseInt applies ToString.
6. **No new package, no new declaration file, no `src/types` change.** The ts-ratchet stood at 890.
- **Bad implication:** A-326 and A-327 mean a tenant edit can answer 500 today. They are recorded and not fixed here, by rule 3, and they need their own change soon.

### Amendment 21 (2026-09-30) — The response envelope is a cross-workspace contract; its definition moves to `packages/contracts`

(Placed by the Phase 9 lead from the P9-22 helper's text. Record: `MEMORY/records/2026-09-29-p9-22-contracts.md`. The shape is unchanged: rows in `data`, and `meta` as a top-level sibling of `data`. The package's `test/envelope.test.ts` parses the REAL output of `utils/response.util`'s `success()` and `error()`, and it bites on `data.rows`, a missing `meta`, and `data.meta` / `data.items`.)

**Decision.** `ApiResponse<T>` and its parts were decided here (decision 7, Amendment 5) as backend-internal types in `backend/src/types/apiResponse.ts`. The envelope is the one shape the frontend parses on every call, so it is a cross-workspace contract, and decision 7 already sends those to `packages/contracts` (P9-22). The definition becomes Zod schemas in `packages/contracts/src/envelope.ts` (`apiResponse`, `apiListResponse`, `pageMeta`, `apiErrorResponse`), with the types inferred from them. `backend/src/types/apiResponse.ts` stays, and **re-exports** those types. It is still the only backend file that may declare or name an `*Envelope`/`ApiResponse*` type, so the `no-restricted-syntax` guard is unchanged. The types are the same shapes as before: `meta?: object`, `token`/`refreshToken`/`session?: unknown`, an error body with `details?` and extra top-level keys. `response.util.ts` compiles unchanged.

**Alternatives considered.** (1) Keep the envelope backend-only and have the frontend declare its own: that is two definitions, and the frontend's copy is exactly the hand-written belief P9-22 removes (`device.service.ts` still declares `data.rows`). (2) Define the types in the package and a separate Zod schema in the backend: two definitions again. (3) Move `backend/src/types/apiResponse.ts` out entirely and import the package everywhere: it breaks the decision-7 rule that the backend names the envelope in one place, and changes every importer for no gain.

**Implications, including the bad ones.** The backend's type-only module now depends on the workspace package. That is harmless at run time (types are erased; `response.util` emits no import of it), but the backend typecheck now also checks `envelope.ts` under backend flags. A change to the envelope schema is a two-workspace change. `pageMeta` requires `total` on every list response. A list endpoint that sends `meta` without `total` would fail a frontend parse that uses `apiListResponse`, and that is the point, but it has not yet been checked against all 53 route modules. The response step does that domain by domain.

**Evidence.** Backend typecheck: no new error (the two remaining errors are other lanes' guard tests). `src/tests/utils`: 1,763 passed. The package's `test/envelope.test.ts` passes against the real `response.util`, and the package is at 100%.

### Amendment 22 (2026-09-30) — P9-16 converted: workflow, qms, risk, supplierScorecard, vendor

(Placed by the Phase 9 lead from the services helper's text. Record: `MEMORY/records/2026-09-30-p9-16-quality-services.md`. With `sop` (Amendment 19), every module on the P9-16 card is TypeScript.)

- **Converted:** `workflow`, `qms`, `risk`, `supplierScorecard` and `vendor`, under Amendment 13's pattern. `workflow.service.d.ts` was retired.
- **Identity:** 3,163 checks. Every difference is the accepted `Function.name`. All 20 applied plants were caught.
- **A class instance converts as the instance.**
  - `export =` of `new X()`, with the `.js`'s added own properties assigned in order.
  - Internal calls stay `this.x`.
  - A lazily required still-JavaScript dependency is typed locally by the members called, so no `.d.ts` goes into another lane's directory.
- **`this.x` at a CommonJS module's top level is `module.exports.x`.** It converts to a call through the exported object.
- **Raw SQL with `replacements` moves to `sql()` first, in its own change** (qms `claimNumber`): 5 test doubles were updated, and the fail-before was 21/871.
- **`workflow` and `qms` passed the four gates.**
  - The guards bite on the `.ts` (d12, d24, d05, p611).
  - The live PostgreSQL 18.6 checks as `callibrator_app` passed: workflow 27/27, including ADR-101 separation of duties and the A-183 gates; qms 20/20, including the bound counter claim.
- **`auditCoverage.p611` now reads class-instance `.ts` files and multi-line method heads.** Without that change, a converted class service would have silently dropped out of the guard.
- **`scripts/load-check.ts` sets a random `STRIPE_SECRET_KEY` in its production child** (ADR-111), as it does the other required secrets.
- **Finding:** A-330 (vendor search uses a case-sensitive LIKE), open.

**Status:** Accepted, implemented 2026-09-28; amended 2026-09-28/30 (Amendments 1–22).

---

## ADR-092: The Behaviour Baseline Is the JavaScript Tree at `35ebd76`; the Lint Gate Is at Zero, Fixed Rule by Rule and Proved AST-Identical; One ESLint Config With Global Ignores of Its Own; `backend/.prettierrc` Governs the Backend; Models Stay Outside the 100% Figure

**Date:** 2026-09-28 · **Cards:** P9-00, P9-02 (rest), P9-02a (part), P9-03a · **Agent:** Phase 9 helper 1 · **Works with:** ADR-087 (the toolchain), ADR-085 (the coverage scope), ADR-077 (the live suite) · **Records:** `MEMORY/records/P9-00.md`, `MEMORY/records/2026-09-28-p9-helper-lint-baseline-coverage.md`

**Context.** Four Stage A cards were open beside the lead's conversions. P9-00 wanted a baseline "after the remediation, before the first conversion", but by 2026-09-28 the working tree already held converted modules and nine utils were mid-conversion, so `build:dist` refused it. The backend lint ratchet was red (1,050 errors against a baseline of 950). `backend/.eslintrc.js` still existed; ESLint's `ignores` sat beside `rules`; two Prettier files disagreed. P9-03a's findings were mostly closed by P6-14/A-32 (ADR-085), except the models question and one hole: the A-32 guard read `.js` files only.

### Decision

1. **P9-00: the baseline is `35ebd76`, not the working tree.** The committed `HEAD` has 0 `.ts` files under `backend/src`. It was exported with `git archive`, built by `backend/Dockerfile` on a disposable compose stack (PostgreSQL 18.6), seeded, and the live suite ran twice: **53 of 53 specs passed both times** (392 tests; `liveContract.smoke` skipped by design), 0 × 429 in the server log, 2 × `POST /ai/query` 500 with no AI provider (environment-dependent, as in ADR-077). The set, by spec name, is in `MEMORY/records/P9-00.md`. The SCIM spec the card expected to fail (A-49) passes. **Rule:** every conversion card and P9-01b's last item re-run this set against their own image; a spec that leaves the set is a behaviour change.
2. **P9-02: one ESLint config, global ignores alone, one Prettier config for the backend.** `backend/.eslintrc.js` is deleted. `dist/`, `coverage/`, `build/`, `docs/`, `*.config.js` move into a config object with **no other key** — the only form flat config treats as global. Checked with `ESLint#isPathIgnored` over every file under `backend/`: before, 474 `dist/` and 6 `coverage/` files were visited and `jest.config.js` was linted without the house rules; after, all ignored, and `src/` unchanged at 1,206 files. **`backend/.prettierrc` governs `backend/`** (Prettier takes the nearest file and never merges; `--find-config-path backend/index.js` → `backend/.prettierrc`). Its choices match the ESLint rules. The root `.prettierrc.js` is kept and **scoped by a header comment** saying it does not govern `backend/`.
3. **P9-02a: the 1,050 errors were fixed by ESLint's own fixers, restricted to the nine error-level rules** (`curly`, `indent`, `quotes`, `comma-dangle`, `no-trailing-spaces`, `eol-last`, `no-multiple-empty-lines`, `space-infix-ops`, `prefer-const`) through `ESLint({ fix: m => m.severity === 2 && ALLOWED.has(m.ruleId) })`, so **no warning-level fixer ran** (`prefer-arrow-callback` would change `this`). 127 files, none carrying another agent's uncommitted change at the time. **Proof, not review:** each fixed file was parsed with espree next to its `HEAD` version and compared with positions, quote style (`raw`), a one-statement block around an `if`/loop body, and expression-free template literals normalised: **126 of 127 AST-identical**; the one that is not, `meteredBilling.service.js`, differs by one hand edit (`let total;` + assignment became `const total = …`, the one `prefer-const` the fixer cannot do). The comparer is not vacuous: before template normalisation it flagged three files. Four dangling `{…}` blocks the fixer produced were rewrapped by hand. The 12 unused `eslint-disable` directives were removed the same way (12 of 12 AST-identical). **`backend/.eslint-baseline.json` is 0**, so any new error fails the ratchet.
4. **P9-03a: models stay outside the 100% figure; P9-10's "still at 100%" is replaced.** Measured with the whole suite and `--collectCoverageFrom "src/models/**/*.js"`: **93.5% statements, 65.58% branches, 93.17% functions, 93.39% lines**; 62 of 72 models at 100%, 10 below (`tenantBackup`, `role`, `session`, `category`, `post`, `attachment`, `webhook`, `certificate`, `tenant`, `user`). Bringing `models/` into the gate would fail it today and would mostly measure `sequelize.define` calls that run on `require`. For P9-10, "tests converted and still at 100%" means instead: (a) `npm run typecheck` passes with the models strict-typed; (b) for every converted model, its definition compared equal to the JavaScript original — `rawAttributes` (type, `allowNull`, `defaultValue`, `field`), `tableName`, the options (`paranoid`, `underscored`, `defaultScope`, `scopes`, hook names) and every association (`as`, `foreignKey`, type); (c) the model guard suites (`includeRequired.d12`, `enumMirrors.d26`, `softDeleteMechanisms.d25`, `tenantForeignKeys.a88`, `associationForeignKeys.a148`, `unscopedModels.d17`, `uuidDefaults.a116`) stay green; (d) the models' own figure, measured by that named command, does not fall. **The A-32 guard now reads `.ts`** (a converted file carries its `istanbul ignore` into TypeScript; proved by a probe `.ts` with a bare directive, which failed the guard). Its ceiling went from 31 to the count, **30**; all 30 carry a reason.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Baseline against the working tree | it did not build (`build:dist` refused nine half-converted utils), and it was already partly TypeScript — the card's abuse case "taking the baseline after the first conversion" |
| Reuse P6-02's green runs as the baseline | recorded by suite count, not spec name, and on an earlier tree; the card needs names and a reproducible commit |
| `npm run lint:fix` over `src/` | also applies warning-level fixers (`prefer-arrow-callback` changes `this` binding) — the card's abuse case "`--fix` run across the residue" |
| `prettier --write` as the sweep | not a gate anywhere; it rewraps to width 80 and would change far more lines than the lint errors; ESLint's rules are the gate, and they already encode `backend/.prettierrc`'s choices |
| Raise the ratchet baseline to the current count | hides errors; the card forbids it |
| Delete the root `.prettierrc.js` | then the frontend falls to Prettier's defaults; that is the frontend owner's decision (below) |
| Put `src/models/` into `collectCoverageFrom` now | fails the gate today (65.58% branches), and `jest.config.js` belongs to the lead's in-flight work |

### Implications, including the bad ones

- **`git blame` churns in 137 backend files** (whitespace, quotes, braces, removed directives). The change must be committed **on its own**, with a message saying it is formatting, and nothing else in it (P9-02a abuse case 1). The files are listed in the record.
- **The ratchet is at zero, so any agent's new lint error now fails `make lint-ratchet`, CI and pre-push.** That is the point, but an agent used to a red lint will meet it for the first time.
- **ESLint `indent` and Prettier can still disagree** on some constructs (`eslint-config-prettier` turns `indent` off, the house block turns it back on). ESLint is the gate; `npm run prettier:fix` is not safe to assume lint-clean.
- **`E2E_MFA_STATE_FILE` shares one state file across every identifier.** Set it only for a run that signs in as one identifier; otherwise a spec signing in as a user it created is handed the operator's cached session (a void first attempt at the baseline failed 41 tests this way).
- **The root `.prettierrc.js` says `singleQuote: true` while `frontend/src` has 2,043 double-quoted imports to 26 single** (counted 2026-09-28). A root `npm run format` would rewrite the frontend. Left to the frontend owner — not decided here.
- **P9-02a is not done:** 263 `no-unused-vars` and 19 `no-console` warnings need hand triage, and `no-unused-vars` goes to `error` only after that. Plain `eslint` could now replace the ratchet script; it has not.
- **`CLAUDE.md` § "Two Things Currently Failing" still says lint is red** (1,083 errors, baseline 950). That row is now false; `CLAUDE.md` was being edited by another agent, so it is left for them in the same change.

**Status:** Accepted, implemented 2026-09-28.

---

## ADR-088: The Quota Read Carries the Billing Gate; RAG Answers Only From the Source Types Its Gate Covers; Phase 5's Data Lake Is Closed as Superseded; Docs That Contradicted the Code Are Corrected

**Date:** 2026-09-27/28 · **Cards:** AZ-01, AZ-02, AZ-03 (`TASKS/AUDIT-2026-09-AUTHZ-MATRIX.md`), R-01…R-04 (`TASKS/AUDIT-2026-09-RECORDS.md`), DOC-01…DOC-17 (`TASKS/DOCS-GAP-2026-09.md`), P5-08 · **Extends:** ADR-058, ADR-056, A-94, ADR-086 · **Record:** `MEMORY/records/2026-09-27-az-authz-matrix-and-records.md`

**Context.** The authorization matrix listed 33 gap routes (G-01…G-06). By 2026-09-27 most had been gated by batches 5–6, but the board still said TODO, and two rows had no test that ran the real `dynamicAccess` against the real seeded grants: the QMS reads (only `routeGuards.a66.test.js`, which mocks the gate) and `GET /quota`. `GET /quota` was still on `auth` alone, exempted as `accepted` by ADR-058 because "`billing` is unreachable for every seeded tenant role (Q-20)". ADR-056 had granted `billing: read` to HEALTHCARE ADMIN and CALIBRATOR ADMIN the same day, so that reason was false. Separately, `POST /ai/query` was gated on `sop: read` (A-94) on the premise that the index holds only SOPs. Nothing enforced that premise: retrieval filtered on the tenant only.

### Decision

1. **`GET /quota` is gated `dynamicAccess("billing", "read")`, and its `accepted` exemption is removed.** Its only consumer is the billing page's `PlanQuotaCard`.
   - *For keeping it on `auth`:* the data is low-sensitivity counts; a future UI might want to warn any user near the seat limit; one more gate is one more way to lock someone out.
   - *For the gate:* it discloses the plan, entitlements, seat and storage usage — commercial information — to every role, including ROOM USER. Its one screen is already behind `billing`. The exemption's stated reason was false. Least privilege is the rule the matrix applies everywhere else.
   - **Decided: gate.** A future non-billing consumer gets its own endpoint or a recorded decision.
   - Proven by `quota.gate.az01.test.js` (13 tests; restoring `auth` alone fails 9).
2. **The QMS reads are proven, not re-gated.** `qms.gate.az01.test.js` (66 tests) drives all six QMS routes through the real gate over the real seed. Removing the `GET /nc` gate fails 8 tests.
3. **RAG retrieval filters `source_type = ANY($4)` over `RAG_READABLE_SOURCE_TYPES` (`["SopDocument"]`, `ai.service.js`).**
   - *Alternative:* per-chunk permission filtering by the source's menu slug. That is the correct end state, but it needs a slug column on `document_chunks` and a migration, with only one source type today.
   - *Alternative:* leave it and rely on "only one ingester". That reach is invisible until someone adds a second ingester.
   - **Decided:** the allow-list. It makes the `sop: read` gate's premise structural. Widening it becomes a gate decision.
   - Proven by `ai.ragReach.az02.test.js`. The SQL was also run once against pgvector on PostgreSQL 18.6.
4. **`GET /dashboard/metrics` stays `accepted`.** It is not a matrix row. Gating it needs `dashboard` granted to FACILITY MAINTENANCE and WAREHOUSE STAFF, which requires a migration, and is left for the owner.
5. **P5-08 (data lake) is closed as superseded by P8-04, not built.** P8-07 measured the trigger (ADR-086 §3), and the decided path is query-shaped fixes and then a read replica. Phase 5 is recorded as DONE with one card deliberately not built.
6. **Documents that contradicted the code were corrected in place, each spot marked "(ADR-088)":**
   - the `createTwoTenants()` passages in 12 documents. The fixture is synchronous and in memory with no SQL, and the E2E sample used helpers that do not exist;
   - the pre-A-06 `/health` payload in 11 documents;
   - rate-limit tables in `API/00`, `SECURITY/08` and `ARCHITECTURE/06`, which listed `authLimiter`/`otpLimiter`. Both are defined in `backend/index.js` and never mounted. Those tables also said sign-in can lock accounts (not since A-185) and named `X-RateLimit-*` headers where the limiter sends draft-6 `RateLimit-*`;
   - the Swagger paths (`/docs`, `/docs.json`, not `/api-docs`, `/swagger.json`);
   - `SECURITY/04`'s claim that an ungated route admits every API key. The wrapper refuses an unauthorized key;
   - WEBHOOK/ and SEARCH/ line citations and states: A-50, A-56 and A-23 are fixed, and there are eight webhook routes;
   - the embedded-broker line in `TESTING/05`;
   - the stale IoT example in `DEVELOPER/README`;
   - the failing-gates sections of `CLAUDE.md`, `TASKS/README.md` and `TASKS/PROGRESS.md`.

   The per-document list is in the record.

### Implications, including the bad ones

- **Behaviour changes for custom roles.** A custom role without `billing` loses `GET /quota`. An API key needs a `billing` scope to call it.
- **A second RAG source type needs a code change as well as an ingester.** That is the point, but it will surprise whoever adds one.
- **The AZ-02 filter is proven by SQL shape plus one manual run on PostgreSQL 18.6.** No suite runs it against PostgreSQL.
- **`STORAGE/04` still has two contradictions.** It says nothing outside `storageMigration.service.js` touches `storageKey`, but `attachmentFileSweep.service.js` does. It also dates the A-40 fix inconsistently. Another agent's uncommitted diff held that file, so it was left alone.
- **Code comments that disagree with the code were reported, not changed:**
  - "secret is stripped" in `webhooks.route.js` and `webhook.controller.js`;
  - `v1:` envelope comments in `webhook.service.js` and `webhook.model.js`;
  - the `node src/scripts/…` usage line in `migrateStorage.js`.
- **A-02's claim about who holds `custom-domains` disagrees with the seed.** The seed gives WRITE to SUPERADMIN only and READ to HEALTHCARE ADMIN only. This is recorded as an open question in `MEMORY/specs/A-02-tenant-config-access.md`.

**Status:** Accepted, implemented 2026-09-27/28.

---

## ADR-089: Dual-Backend Target Architecture (TypeScript & Go), Multi-Frontend & Shared Component Strategy

**Decision:** Callibrator adopts a dual-backend target architecture consisting of the existing TypeScript backend (`backend/src/`) and a future Go backend engine (`backend-go/`), supported by a multi-frontend integration pattern and root-level shared components (`shared/`).

**Rationale:**
- The existing TypeScript backend is mature, serving 53 route modules and 71 Sequelize models. Retaining it avoids a risky and disruptive immediate rewrite.
- A future Go backend engine provides high throughput, lower memory consumption, and superior concurrency for high-density workloads (IoT ingest, telemetry, read APIs).
- Decoupling frontend integration targets via backend API adapters and root-level shared UI components ensures UI surfaces remain clean, maintainable, and backend-agnostic.
- Positioning all Go implementation work in Phase 999 ensures Phase 9 (TypeScript Backend Migration) and Upstream PHP Feature Adoption remain unblocked.

**Alternatives Considered:**
- Complete immediate replacement of TypeScript backend with Go — rejected due to massive operational risk and breakage of 674 backend tests.
- Single monolith in TypeScript indefinitely — rejected because Go offers significant latency and footprint advantages for target scaling scenarios.
- Embedded microservices rewrite — rejected because tenant isolation is cheapest and safest when maintained inside structured monolith boundaries.

**Implications:**
- TypeScript backend remains fully supported as the reference implementation.
- Go backend is built as an additional backend engine under Phase 999.
- Frontend logic and presentation controls live in backend-agnostic `shared/` components.
- Roadmap sequence: Existing Phases -> Phase 9 -> Upstream PHP Feature Adoption -> Phase 999.
- Current scope is strictly planning and documentation only; zero Go source code implementation in current phase.

**Status:** Accepted (Planning & Specification: 2026-09-27; Implementation: Phase 999)

---

## ADR-077: The Live E2E Suite Is Green in One Run on a Disposable Compose Stack; Specs Follow the Documented Contract, Not Observed Behaviour; Path UUIDs Are Checked for Shape Only; the Browser Suite Is a Five-Check Smoke Built on the Existing puppeteer-core

**Date:** 2026-09-28 · **Cards:** P6-02, A-20 (BACKLOG U-02, U-07) · **Record:**
`MEMORY/records/2026-09-28-p6-02-e2e-green.md`

**Context**

The live E2E suite had never passed in one uninterrupted run (U-02). The browser suite that six
documents described (`automate/`, 71 Playwright tests) was not in the repository, and
`make test-browser` ran `npx playwright test` against nothing (U-07, A-20).

The suite was run against a disposable local stack: `docker compose -p callib-e2e` with the base
file, the dev overlay and a named-volume overlay, on ports 25000 (backend) and 25001 (frontend),
seeded through `GET /migration/seeding` and `GET /migration/seed-demo`. The first run failed 12 of
53 suites (24 tests). Each failure was put in one of two classes:

- **The application was wrong.** Eleven defects, each fixed with a unit or route test that fails
  without the fix (mutation-checked).
- **The spec was stale.** It asserted behaviour the product has deliberately changed since the spec
  was written, or used a fixture the validators now refuse. The spec was moved to the documented
  contract and says why in a comment.

**Decision**

1. **What "green" means for P6-02.** Every spec that `find backend/src/tests/e2e -name '*.test.js'`
   finds (54 on 2026-09-28) runs in one `npm run test:e2e`. Nothing is skipped to reach green. The
   one skipped suite is `liveContract.smoke.test.js`, which is opt-in by design (`LIVE_CONTRACT=1`)
   and is not one of the 53 contract specs. The run has **no 429**, checked in the server's access
   log and not only in the Jest output. Every 5xx the suite tolerates is named as
   environment-dependent. Two consecutive runs must both be green.
2. **Application fixes (each named with its test in the record):**
   - `utils/jsonShape.util.js`: a JSON column's shape check lets `null` through. Nullness is
     `allowNull`'s decision. A calibration-record correction copying a record with no `results`
     answered 500.
   - `eSignature.service#generateKeyPair` answers the row `id` that `DELETE /key-pairs/:keyPairId`
     takes, as well as the `keyId`.
   - `tenantBackup.controller` passes the models barrel to the services. It had passed
     `req.models`, which nothing sets, so every tenant backup answered 500.
   - `middlewares/validateUuid.middleware.js` accepts the **shape** PostgreSQL's `uuid` type
     accepts (8-4-4-4-12 hex digits), not only RFC 4122 versions 1–5. Every seeded menu group id is
     `a0000000-0000-0000-0000-…` (version nibble 0), so a permission override on a seeded menu
     group could never be deleted, and a UUIDv7 would also have been refused. The middleware still
     keeps a non-uuid away from a query, where the cast fails as a 500.
   - `PATCH /vendors/:vendorId/qualify` gets a validator. The value is matched case-insensitively
     and stored in the enum's upper case. The frontend sends `approved` and `rejected`; both had
     reached PostgreSQL as invalid enum values and answered 500.
   - `backend/Dockerfile` creates `/app/exports` and gives it to the app user. It had never been
     created, so every `POST /gdpr/export` failed with EACCES.
   - `gdpr.service` uses archiver 8's `new ZipArchive(...)`. archiver 8 is ESM with no default
     export, so `archiver("zip")` threw "archiver is not a function". Every unit test had mocked
     archiver as a function. A test now exercises the real library.
   - `response.util#login` answers the opaque `refreshToken` at the top level for password
     sign-in, the MFA step and impersonation. `sso.controller#issueSsoTokens` also returns the
     refresh token it generated and then dropped. The Next routes already read `refreshToken` into
     an httpOnly cookie and strip it from the browser body (F-05, F-62). Because the backend never
     sent it, no browser session could be renewed. The suite's two refresh tests had passed without
     asserting anything.
   - `liveContract.smoke.test.js`: its CLI branch ran inside Jest (`require.main === module` is
     true for a Jest test file) and `process.exit(1)` killed the whole suite. It is now guarded by
     `JEST_WORKER_ID`.
   - Frontend `api/client.ts`: a 403 carrying `MFA_ENROLMENT_REQUIRED` or
     `PASSWORD_CHANGE_REQUIRED` never opens the access-denied modal, including on that gate's own
     page. On `/dashboard/mfa` the layout's POST menu fetch opened the modal. The modal's refusal
     re-fetched the menu, and the loop (about 150 requests) kept the modal over the enrolment form.
     **A new platform operator could not enrol, so could not use the product.**
   - Frontend `components/ui/Table/Table.tsx`: a cell given as JSX renders as the element. It had
     rendered `String(value)`, which is "[object Object]" on every such column; the device list is
     one of them.
3. **Stale specs, moved to the contract:**
   - `data-retention`: set a policy on `notifications`. `audit_logs` is refused (ADR-069), and the
     spec now asserts that 400.
   - `predictive-maintenance`: approving with no pending recommendation is **409**, a state
     conflict, not 400.
   - `menuGroups`: delete sends `menuGroupId`, which the controller reads and the frontend sends.
     The route's Swagger block said `id` and is corrected.
   - `sop`: a controlled procedure is released by someone other than its author. The author gets
     409. A second administrator, created and deleted by the spec, publishes the document.
   - `api-keys`: a scope is `<menu slug>:<read|write>`; the spec now uses `equipment:read`.
   - `vendors`, `http`: `@e2e.test` and `@e2e.invalid` are not IANA TLDs, so Joi's `email()`
     refuses them before the route runs. The specs use `example.com`. `http` also stops
     hard-coding `localhost:5000`.
   - `auth`: the wrong-password probe uses a per-run identifier (A-185 pauses an identifier and
     address after five failures). The refresh tests sign in as a user the spec creates, and assert
     unconditionally.
   - `gdpr`: export is **200** with a download link. The 500 it tolerated was the missing
     directory, not "no provider".
4. **A-20: the browser suite is `automate/smoke.browser.js`.** It is a five-check smoke driven by
   the repository's existing `puppeteer-core` and an installed Chrome/Chromium, with no new
   dependency:
   - password sign-in routes a new operator to MFA enrolment;
   - enrolment from the secret on the page, with recovery codes issued;
   - sign-in again with password and code;
   - `/dashboard/devices` renders a device created through the API;
   - every document carried a nonce CSP, with no violations and no page errors.

   `make test-browser` runs it. The 71-test claim is withdrawn everywhere it was made.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| For A-20: drop every browser reference and record that browser coverage is the CSP agent's one-off check (ADR-071) | cheaper and adds no file to maintain, but it would have left the MFA enrolment loop and the "[object Object]" table undetected. Both were found only by this smoke's first runs, and 1,386 frontend unit tests passed with both defects present. A one-off check proves one day; a script re-proves every release |
| Restore a Playwright suite | a new dependency and browser download for four checks; the audit's 71 tests cannot be reconstructed from anything in the repository |
| Keep the version-1–5 UUID pattern and give seeded rows v4 ids | the seeded ids are referenced by migrations and constants; re-keying them is a data migration for a validator's taste, and UUIDv7 would still be refused |
| Mark the throttled `auth` specs as allowed-429 | that is abuse case 3 on the P6-02 card: a 429 counted as a pass |
| Run the suite against the dev server (`npm run dev`) instead of the compose image | the image is what deploys. The `/app/exports` and archiver defects exist only in the packaged binary under a non-root user, and a dev server would have hidden both |

**Implications — including the bad ones**

- `POST /ai/query` still answers **500** with no AI key configured. The spec accepts it, and it is
  named here as environment-dependent. A missing provider should be a 503 or a 409 with an
  explanation; that is not fixed here.
- `tenants.e2e` creates a tenant, and three other specs create disposable ones. `tenantCreate` is
  limited to 10 a minute, so back-to-back runs **less than a minute apart** can meet a 429 there.
  The recorded green pair was run after the window had passed. The limiter is right; the suite's
  budget is simply tight.
- `/app/exports` is not a volume. A container recreate drops pending GDPR downloads, and the
  subject asks again.
- The browser smoke is five checks. It does not cover realtime notifications, the verification
  page, the three list states, or keyboard access (docs/TESTING/06 keeps them as the
  specification).
- The login answer now carries the refresh token in its body. That was always the contract the
  Next routes were written against, and they strip it from what the browser sees. A direct API
  caller (a test, a script) now receives it.
- A path parameter such as `ffffffff-ffff-ffff-ffff-ffffffffffff` now passes the middleware; it
  reaches the handler and is a 404 there, never a query error.

**Status:** Accepted, implemented 2026-09-28.

---

## ADR-081: A By-the-Book Production Start Works: Probes Are Exempt from the HTTPS Redirect, No Overlay Requires a Setting Nothing Reads, and `make` Refuses Default Credentials, Unsafe Broker Passwords and a Missing Certificate

**Date:** 2026-09-28 · **Findings:** S-09 (remainder), S-13, S-23, S-25, S-31, S-33, S-34 (`TASKS/AUDIT-2026-09-INFRA.md`) · **Extends:** ADR-066 (S-09, S-23, S-17), ADR-060 (the scheduler switch), ADR-065 and A-256 (the ACME stub's removal), ADR-076 (`acme-client` removed)

**Context**

`make env; make secrets; make up ENV=prod` had never been run in order. It was run on 2026-09-28 against a copy of the working tree.

- **How it was run:** GNU Make 4.4.1 ran in a container (`docker:29-cli` plus `make`, `bash` and `node`) and drove the host Docker daemon. The compose project was `sdeploy-s09`.
- **The one departure from the book:** nginx published `127.0.0.1:19580` and `127.0.0.1:19543` instead of `80` and `443`, which were not free.

The run found four things that either stopped it or would have shipped:

1. **`docker compose config` refused the prod overlay.** The overlay required `ACME_DIRECTORY_URL` through `${…:?}`. `.env.example` ships that line commented out, and no code has read the variable since the ACME stub was removed (A-256).
2. **The backend never became healthy.** The backend had migrated, verified its schema and connected to all three datastores, but the healthcheck could not pass.
   - The prod overlay sets `FORCE_HTTPS=true`.
   - The compose healthcheck is `wget http://localhost:3000/health`. The redirect sent it to `https://localhost:3000`, which nothing serves.
   - `make up` failed with `container … is unhealthy`.
   - A kubelet `httpGet` probe counts any 3xx as success. Every Helm values file sets `FORCE_HTTPS: "true"`, so under Helm the readiness probe passed while the database was down.
3. **nginx restarted forever.** `nginx/default.conf` loads `volumes/certs/fullchain.pem`, and no step creates that file. `make up` still printed "backend healthy" and exited 0, because `wait-healthy` watches only the backend.
4. **Preflight passed with `DB_PASS=CHANGE_ME`.** Nothing refused `JWT_ACCESS_SECRET=CHANGE_ME` either, because the backend checks only that the two JWT secrets are set and differ. `make secrets` did not print `DB_PASS`.

The card also asked whether `make secrets` prints a password that is safe in a URL. It does: hex is URL-safe. A password chosen by hand might not be, because compose places it in `amqp://USER:PASS@rabbitmq:5672` verbatim.

**Decision**

1. **The probe paths `/health`, `/live` and `/ready` are exempt from the `FORCE_HTTPS` redirect.**
   - The middleware is `routes/internal/health.route.js#forceHttps`. `index.js` mounts it where the inline copy used to be.
   - Every other plain-HTTP request is still redirected.
   - The probes return a verdict and nothing else (A-06), so answering them over HTTP discloses nothing.
2. **No manifest requires or renders a setting nothing reads.**
   - The prod overlay's `ACME_DIRECTORY_URL` guard is removed, and so is the staging overlay's default.
   - `make preflight`'s `acme-staging` check is removed.
   - Under `certificates.acme.enabled`, the Helm ConfigMap renders only `CUSTOM_DOMAINS_ENABLED`. It no longer renders `TLS_AUTO_PROVISION` or `ACME_*`, and the NOTES staging warning is gone.
   - `directoryUrl` and `accountEmail` stay in the values schema, so an existing override still renders.
   - Both env templates say that no certificate is issued automatically.
3. **`make check-env` refuses two more inputs.** Every `make up` runs it.
   - A `RABBITMQ_USER` or `RABBITMQ_PASS` containing any character outside `A-Z a-z 0-9 . _ ~ -`.
   - For `ENV=staging|prod`, a missing or empty `volumes/certs/fullchain.pem` or `privkey.pem`.
4. **`make preflight` refuses a placeholder `DB_PASS`, `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET`.** A placeholder is an empty value, `CHANGE_ME*`, `change-this*` or `your_*`. `make secrets` now prints `DB_PASS` too.
5. **The rest of the scope was verified and closed as it stood.**
   - **S-13, frontend half:** S-29 had already done it. The image runs `npm ci` against the committed root lockfile. Its base image is pinned by digest, and bun is gone. apk reads its two repositories over `https://`, and nothing disables verification.
   - **S-23:** ADR-066 had already done it. Swagger is off in production unless `SWAGGER_ENABLED=true`. The stale comment in `vm-http.conf` is corrected.
   - **S-31:** the chart renders the three ClamAV keys, as recorded.
   - **S-33:** ADR-060/P7-02 and the quarantine sweep had already done it. The Redis minute claim holds two replicas to one run, and the sweep removes abandoned files.
   - **S-34:** both documents were already amended on 2026-09-24 (`beb0c4b`), and ADR-066 records the S-17 deviation.

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Keep `ACME_DIRECTORY_URL` required and add it to `.env.example` | it would demand a value that does nothing, which is a control in name only. The guard should come back with code that reads the variable |
| Make the healthcheck send `X-Forwarded-Proto: https` | the fix would have to go into every manifest: compose, the Helm probes, and any load balancer an operator adds. The next manifest forgets it. The application fixes it once for every caller |
| Set `FORCE_HTTPS=false` in prod, as the VM overlay does | it drops the application layer of HTTPS enforcement, which `docs/DEVOPS/03` keeps deliberately so the application does not depend on the proxy being right |
| Percent-encode the RabbitMQ password in compose | compose interpolation cannot encode. Encoding it in `.env` would break `RABBITMQ_DEFAULT_PASS`, which reads the same value raw |
| Make `make up` wait for nginx and the frontend too | worth doing, but it still fails late and says less than a refusal before `up` does. The refusal came first |
| Refuse placeholder secrets in the backend at boot | the right long-term place. It changes the backend's startup contract in every environment, including tests. Left open |

**Implications, including the bad ones**

- **`/health`, `/live` and `/ready` answer over plain HTTP in production.** Anyone who reaches the backend port directly reads an up/down verdict. That is no more than a TCP connect tells them, and nginx still redirects the public edge.
- **A staging or prod `make up` now needs a certificate on disk before it starts.** An operator who terminates TLS elsewhere has to supply one or change the nginx config. This is deliberate: the alternative is a crash-looping nginx behind a green `make up`.
- **An existing `.env` that still holds `DB_PASS=CHANGE_ME` now fails preflight.** Changing the value in `.env` alone breaks the backend's login, because postgres reads it only at first initialisation. It needs `ALTER ROLE` as well, and the refusal says so.
- **The CI compose step still writes an `ACME_DIRECTORY_URL` line** (`.github/workflows/ci.yml:362`). The line is harmless, and it was left alone because that file belongs to another workstream.
- **The Helm charts still only render.** Nothing was deployed to a cluster.

**Evidence** (2026-09-28; commands and output are in `MEMORY/records/2026-09-28-adr081-deploy-by-the-book.md`)

- **The by-the-book run:**
  - `make env`, then `make secrets` (10 lines pasted), then `make preflight ENV=prod TAG=sdeploy-s09` passed.
  - `make images` built both images on Node 26.10.0.
  - `make up ENV=prod` exited 0 with the backend healthy.
- **The full stack:** after a stand-in certificate, all eight services were healthy or completed. Clamav, the frontend and nginx ran under the prod overlay for the first time.
- **The edge:** `https://…/health` answered 200 through nginx, and plain HTTP answered 301. `/docs` and `/docs.json` answered 404 on the backend under `NODE_ENV=production`.
- **Credentials and privileges:** RabbitMQ listed one connection, from user `callibrator`. An unauthenticated `redis-cli ping` answered `NOAUTH`. The backend ran as uid 997 with `CapEff` 0.
- **The refusals:**
  - Preflight exited 2 on each of `DB_PASS=CHANGE_ME`, `JWT_ACCESS_SECRET=CHANGE_ME`, an empty `JWT_REFRESH_SECRET`, `RABBITMQ_PASS=p@ss:w/rd`, `RABBITMQ_PASS=guest` and an empty `REDIS_PASSWORD`.
  - `check-env ENV=prod` exited 2 without certificates and 0 with them.
- **Tests:**
  - New: `health.forceHttps.s09.test.js`.
  - Existing, passing: `health.route.test.js`, `health.jobs.p702.test.js`, `quarantineSweep.s33.test.js`, `quarantineSweepScheduler.s33.test.js`, `jobMonitor.service.p702.test.js`, `appRoutes.a253.test.js`, `csp.p708.test.js` and `upload.quarantine.s17.test.js`.

**Status:** Accepted, implemented 2026-09-28.

---

## ADR-082: CI Stages Are Proved by Running Their Own Steps in Their Own Images; a Bounded Job That Leaves Work Behind Is a Warning Alert; the Alert Route Is Stated at Boot; Log Shipping Has Run

**Date:** 2026-09-28 · **Findings:** P7-01, P7-02, P7-03, M-13, W-17 (the `incomplete`/`truncated` outcomes) · **Cited before it was written** by `jobMonitor.service.js`, `alert.service.js`, `retentionScheduler.middleware.js` and `quarantineSweepScheduler.middleware.js` (audit finding F-28: the agent that wrote those citations was stopped before writing this record; this is it).

**Context.** ADR-066 left three stages of `.github/workflows/ci.yml` never run in their CI form (`backend-test`, `boot-and-migrate`, `dependency-audit`), alert routing that nobody had configured and whose end-to-end path was untested, two bounded jobs (W-17) whose "stopped early" outcomes were only counts in an `info` line, and a Vector template that had never shipped a line. No GitHub runner is available; Docker is.

**Decision**

- **A CI stage counts as run locally only when its own `run:` steps execute verbatim in its own images.** A generator (`gen-job.py`, scratch) reads `ci.yml` and emits each job's steps with the workflow and job `env`, `working-directory`, `bash -eo pipefail`, `$GITHUB_ENV` and `if: always()` semantics. The runner is Ubuntu 24.04 (`buildpack-deps:noble`) with the official Node 26.10.0 tarball (sha256-checked), as `setup-node` installs it. Service containers are the workflow's digest-pinned images, sharing the runner's network namespace so `localhost:5432/6379/5672` resolve as on GitHub, and started only once healthy. The workspace is a **Linux git checkout** of HEAD plus the uncommitted diff (LF, index file modes), because a Windows-tree copy was not faithful (CRLF scripts, no `.git`).
- **Three CI defects that running found are fixed.**
  - `boot-and-migrate` ran `npm ci` under the job's `NODE_ENV=production`, which **omits devDependencies**, among them `tsx`. Both boots (`node --import tsx`) died with `ERR_MODULE_NOT_FOUND`. It is now `npm ci --include=dev`.
  - `npm run migrate:status` (and `migrate`) never exited (M-13). umzug's CLI returned, but the open Sequelize pool kept the event loop alive, with plain `node` as well as `tsx`. The step would have hung until the 20-minute job timeout. `src/scripts/migrate.js` now closes the pool when the command finishes. A failed command still exits 1.
  - `backend-test` failed the 100% branch gate because **coverage depended on `.env`**. The workstation's `.env` has no `MAX_FILE_SIZE`; CI copies `.env.example`, which sets it, so only one side of `parseInt(process.env.MAX_FILE_SIZE) || 5 MB` ran in each place (`tenant.route.js` ×3, `upload.util.js`). `maxFileSize.envFallback.p701.test.js` pins both sides whatever `.env` holds.
- **A successful run that left work behind raises `job.<name>.incomplete` at severity `warning`** (`runMonitored`'s `isIncomplete` option). It covers the retention sweep with `incomplete > 0` (out of `RETENTION_SWEEP_BUDGET_MS`) and the quarantine sweep with `truncated` (at `QUARANTINE_SWEEP_MAX_ENTRIES`). It is throttled like a failure: the first of a streak, then once per `JOB_ALERT_REPEAT_HOURS`, then one `resolved`. A run that also failed alerts as a failure only. The job's state carries `lastIncomplete`/`consecutiveIncomplete`, and the metric is `callibrator_job_last_run_incomplete`.
- **Alert routing stays `ALERT_WEBHOOK_URL` (Slack-compatible `text` + structured `alert`) and/or `ALERT_EMAIL_TO`, and the boot log states the route.** `describeRouting()` names the webhook's host only, since the URL is a credential. It reports an unparseable URL at boot, and it warns at boot when nothing is routed. The route is tested end to end against a real HTTP receiver (`alertRouting.p702.test.js`).
- **Vector's alert label moves to its own sink.** One Loki sink with `labels.alert = "{{ alert.key }}"` failed its template on every non-alert line (`template_failed`, and the label was dropped). `route._unmatched` now goes to `loki` and `route.alerts` goes to `loki_alerts`.
- **The deploy-config compose step no longer writes `ACME_DIRECTORY_URL`** (ADR-081: nothing reads it).

**Alternatives considered**

| Alternative | Why not |
|---|---|
| `act` | not required, and it needs its own runner images. The generator runs the same `run:` text with fewer moving parts. Its gap is `uses:` steps, which the container stands in for |
| Copying the Windows working tree into the container | it failed six `prePushHook.a19` tests that pass on a real checkout (CRLF in the hook, no `.git`). A stage "failing" for a reason CI would not have is noise |
| Dropping `NODE_ENV=production` from the boot job | the boot is meant to prove the production code path. Only the install needs the dev tools |
| `process.exit()` after the migrate CLI | can truncate piped stdout, which the step `tee`s and greps. Closing the pool lets the process end naturally |
| Deleting `MAX_FILE_SIZE` from `backend/.env.example`, or unsetting it in the CI step | hides the dependency instead of removing it. The next variable with a fallback repeats it. The test controls its own env |
| Treating `incomplete`/`truncated` as a failure | the work continues next run, so nothing is lost yet. A `critical` every night for a backlog trains people to ignore the channel (P7-02's abuse case) |
| Logging the full webhook URL at boot | a Slack incoming-webhook URL is its own bearer token |

**Implications, including the bad ones**

- **The workflow has still never run on GitHub.** "Passed locally" means the steps passed in a stand-in for `ubuntu-24.04`. The runner image, the `setup-node` cache and GitHub's service-container networking are approximated, not the real thing. `backend-lint` (the ratchet is red: 1,061 against 950), `frontend`/`next build`, `secret-scan` and `deploy-config`'s helm steps were not re-run by this ADR.
- **`boot-and-migrate` installs the dev tree** (~1,400 packages instead of ~660). It proves the boot and migration code under `NODE_ENV=production`, not the image. The image runs `build:dist` output under pkg and is not exercised here (M-11 still stands).
- The `backend-test` stage passes on a quiet tree snapshot (HEAD `c905e74` plus the working tree on 2026-09-28). Like every 100% gate it is sensitive to concurrent work.
- **The incomplete alert is new traffic.** A tenant set whose backlog outgrows one run's budget produces one `warning` a day until it is cleared. That is the intent, and it is also the thing to tune (`RETENTION_SWEEP_BUDGET_MS`).
- **No deployment has an alert route or a log shipper configured.** Both are operator decisions. The code and the evidence say they work; nobody reads a channel yet.
- **Vector's `loki` healthcheck fails once when Loki starts after Vector** (503). Vector keeps running and ships once Loki is ready. The compose file has no `depends_on` for an external Loki.

**Status:** Accepted, implemented 2026-09-28. The evidence is in `MEMORY/records/2026-09-28-p7-01-02-03.md`.

---

## ADR-090: Theme Colour Tokens Are Chosen to Pass 4.5:1 as Text on Their Own Tints, in Both Themes; the Dark Primary and Destructive Are Light Fills With Dark Text; Every Page Has One `<main>` and One `<h1>`; Icon-Only Controls Are Named After Their Object

**Date:** 2026-09-29 · **Findings:** F-12 (the WCAG 2.1 AA browser sweep) · **Builds on** ADR-074 (F-12's labels and dialogs), ADR-071 (CSP), ADR-077 (browser smoke)

**Context.** F-12's component work (ADR-074) made the primitives and the overlays accessible, but no page had ever been checked in a browser: axe-core's `color-contrast`, landmark and heading rules cannot run in jsdom. A sweep of all 70 routes in headless Chrome (axe-core 4.x from `node_modules`, tags `wcag2a/2aa/21a/21aa` plus `best-practice`, a real HEALTHCARE_ADMIN session on a throwaway PostgreSQL 18 stack seeded with `seedAll` + `seedDemoData`) found **513 WCAG failures in the light theme and 304 in the dark**, plus 50 best-practice findings in each. **465 of the 513 light failures and 256 of the 304 dark ones were colour contrast**, and they came from a handful of tokens in `frontend/src/app/globals.css`, not from individual screens:

| Token (light) | Was | Failure |
|---|---|---|
| `--muted-foreground` slate-500 `#64748b` | 4.34:1 on `--muted`, 4.21:1 on any `/10` tint | 208 nodes: every muted caption on a muted surface, the table header row, the pagination bar |
| `--primary` blue-600 `#2563eb` | 4.49:1 on `bg-primary/10` | 79 nodes: the active sidebar item, primary badges, the page counter |
| `--success` emerald-600, `--warning` amber-600, `--info` sky-600, `--destructive` rose-600 | 2.6–4.5:1 on their `/10` tints; **white on amber-600 3.2:1, on emerald-600 3.8:1, on sky-600 4.1:1** | every status badge and alert |

In the dark theme `--primary` blue-500 was 3.98:1 as text on `--card` and **3.68:1 under its own white foreground**, so no single blue satisfied both uses; the same for rose-500. The remaining failures were markup: 36 icon-only buttons with no name, 6 unnamed `<select>`s, 4 empty `<th>`s, `aria-label` on plain `<div>`/`<span>`s, five public pages with no `<main>`, three with no `<h1>`, and 11 heading-level skips.

**Decision**

- **A theme colour token is chosen so that it passes WCAG 1.4.3 (4.5:1) in every way it is used, not only on white.** For the light theme that means: as text on `--background` and `--card`, **as text on its own `/10` and `/15` tint** over either (the codebase's badge and alert pattern, 150+ uses), and its `-foreground` on the solid fill. For the dark theme: as text on `--background` and `--card`, on its own `/10` tint, and its `-foreground` on the solid. The values:

  | Token | Light (was → is) | Dark (was → is) |
  |---|---|---|
  | `--muted-foreground` | slate-500 → **slate-600 `#475569`** | slate-400, unchanged |
  | `--primary` / `-foreground` | blue-600 → **blue-700 `#1d4ed8`** / white | blue-500 / white → **blue-400 `#60a5fa` / slate-900 `#0f172a`** |
  | `--destructive` / `-foreground` | rose-600 → **rose-700 `#be123c`** / white | rose-500 / white → **rose-400 `#fb7185` / rose-950 `#4c0519`** |
  | `--success` | emerald-600 → **`#046c4e`** (between emerald-700 and -800) | emerald-500, unchanged |
  | `--warning` | amber-600 → **amber-800 `#92400e`** | amber-500, unchanged |
  | `--info` | sky-600 → **sky-700 `#0369a1`** | sky-400, unchanged |
  | `--accent` | cyan-700 → **cyan-800 `#155e75`** | cyan-400, unchanged |

  The policy is executable: `frontend/src/components/ui/a11y.adr090.test.tsx` reads the two theme blocks out of `globals.css` and asserts every one of those ratios, so a token edited back below the line fails the component suite (jsdom cannot measure contrast; this test does not need to).
- **In the dark theme, primary and destructive are light fills with dark text**, the pattern accent, success, warning and info already used there. A hard-coded `text-white` on `bg-destructive` (`NotificationBell`, `warehouse/DeleteConfirmModal`) now uses `text-destructive-foreground`.
- **No opacity on text to de-emphasise it.** `text-muted-foreground/60` (sidebar group labels, 2.2:1) and `opacity-60` on the pagination total (2.9:1) are removed; hierarchy comes from size and weight.
- **Every page has one `<main>` and one `<h1>`**, and headings do not skip levels: the auth and callback pages (`/login`, `/register`, `/activation`, `/oauth/consent`, `/sso-callback`) render their outer container as `<main>`; `/blog` and `/news` make their page heading the `<h1>` (`SectionHeading as="h1"`); `CardHeader`'s string title is an `<h2>` (a dashboard page's title is the `<h1>`); `Alert`'s title is a paragraph, not a heading, because an alert can appear anywhere in the outline.
- **An icon-only control is named after its object** — `aria-label={\`Edit ${device.name}\`}`, not "Edit" — so a screen reader's button list distinguishes twenty rows' actions; the icon is `aria-hidden`. A visual `<label>` that sits beside its control is associated with `htmlFor` and an `id` (78 more fields across 26 forms), never replaced by an `aria-label` (F-12's abuse case).

**Alternatives considered**

| Alternative | Why not |
|---|---|
| Fix contrast per screen (`text-slate-700` where axe complained) | 465 nodes in 60 pages trace to six tokens; per-screen overrides would drift from the theme and fail again on the next screen built from the tokens |
| Keep the brand blues and darken only the `/10` tint backgrounds | the tint is a Tailwind opacity of the same token; a separate tint token per status is ten new tokens and every `bg-x/10` in the codebase rewritten |
| A different light `--primary` for text and for fills (`--primary-text`) | two blues that differ by a shade look like a mistake, and every `text-primary` would need auditing to choose; blue-700 passes both uses |
| Dark primary blue-500 with a darker blue-600 fill | fails as text on the card (3.98:1); the fill-vs-text split is the problem above in the other theme |
| Checking only the WCAG-tagged rules | landmarks and heading order are axe `best-practice`, but they are how a screen-reader user moves around a page (1.3.1, 2.4.1, 2.4.6); both sets were fixed and are reported separately |
| Adding the sweep to the repository as a suite | the task kept its scripts scratch-only, and a browser suite that needs a seeded stack is ADR-077's shape to extend deliberately, not a side effect of this pass |

**Implications, including the bad ones**

- **The product looks different.** Light-theme status colours are one to two steps darker (the warning amber is now brown-orange), muted text is darker, and the dark theme's primary buttons are light blue with dark text. That is a visible brand change made for conformance; if the owner wants the old blues back, the only compliant route is a different tint pattern, not the old values.
- **A tenant's brand colour is not checked.** `TenantBrandingProvider` overrides `--primary` with whatever colour the tenant set and picks black or white foreground by luminance; nothing guarantees 4.5:1 for that colour as text or on its tint. Open, below.
- **The sweep covers what one role sees.** It signed in as a seeded HEALTHCARE_ADMIN; screens that role cannot open (rendered as an access-denied or error state), rows that only exist with more data, and states behind interactions other than the first "Add/New/Create" dialog on each page were not exercised. 24 dialogs were opened and passed axe plus the keyboard contract (focus in, Tab trapped, Escape closes, focus restored) in both themes; the others were not.
- **Automated tools catch a fraction of WCAG failures.** No screen reader was run (F-12's Definition of Done still owes one form and one dialog walked with NVDA or VoiceOver), and 200% zoom and reduced motion were not re-checked.
- The heading changes alter the document outline; a test querying `getByRole("heading", { level: 3 })` for a card title would need updating (none did).

**Open**

| Question | State |
|---|---|
| Contrast of a tenant-set brand `--primary` | **closed** by Amendment 1 below — derived per theme at render; the save path shows the result and does not refuse |
| An axe pass in the browser suite (`automate/smoke.browser.js`) | **closed** by Amendment 1 below — `automate/a11y.browser.js`, run by `make test-browser` |

**Status:** Accepted, implemented 2026-09-29. Evidence: the F-12 card's "Browser sweep (ADR-090)" section in `TASKS/AUDIT-2026-09-FRONTEND.md`.

### Amendment 1 (2026-09-29, later): a tenant's brand colour is derived per theme, never refused; reduced motion is global; the sweep is in the browser suite

**Context.** Two of the items left open above. (1) `TenantBrandingProvider` wrote a tenant's `primaryColor` straight into `--primary` for **both** themes and guessed black or white text by a luminance threshold. `#ffff00` read at 1.07:1 as text on the light card; a navy such as `#1e3a8a` at 1.6:1 on the dark card. (2) The sweep lived in scratch scripts. When it was rebuilt as a suite, it also found that reduced motion is honoured only class by class: the sign-in page's fade and scale entrances and the landing page's ping and nav transitions still ran under `prefers-reduced-motion: reduce`. It found contrast failures the original sweep never reached, because they sat below the fold on `/`: the partner marquee's `text-muted-foreground/60` at 2.45:1, and the "how it works" step numbers in `text-primary/25` at 1.48:1. Both were fixed and then **superseded**: Phase 10 (ADR-098) deleted those landing sections on 2026-09-30 while this work was in flight.

**The debate (brand colour).** *(a) Validate on save.* The backend refuses a colour below 4.5:1 as text and on its `/10` tint, or picks a foreground for it. For: the administrator sees the rule, the stored colour is the rendered one, and any other renderer (e-mail, PDF) inherits a safe value. Against, and it decides the question: **no single colour can pass both themes.** As text at 4.5:1 it needs a relative luminance of at most 0.183 on the light card (`#ffffff`) and at least 0.214 on the dark card (`#1e293b`). A save-time rule could therefore only refuse every colour for one theme or the other. Storing two colours would need a migration and a second field that nobody asked for. Auto-picking a foreground fixes the fill but not the colour as text, where most of ADR-090's 79 primary failures were. *(b) Derive at render.* The frontend turns the one stored colour into one primary per theme, keeping its hue and saturation and moving only its lightness (darker in light, lighter in dark), and only as far as the ADR-090 rule needs. A colour that already passes is used exactly as chosen. For: it always yields a readable result, it keeps the brand's identity, and the administrator is never refused a legitimate brand. Against: the rendered shade can differ from the stored one (see below), and a second renderer would have to reuse the derivation.

**Decision**

- **(b), with the save path made honest about it.** `frontend/src/lib/brandColor.ts` (`accessibleBrandPalette`) derives the light and dark primary and foreground from the tenant's `#RRGGBB`. It checks against the same surfaces and tints as the ADR-090 table (light: `--background`, `--card`, `--muted`, and the `/10` and `/15` tints over each; dark: the same with the `/10` tint), and a test fails if those surfaces drift from `globals.css`. `TenantBrandingProvider` sets `--brand-primary-{light,dark}` and `--brand-primary-foreground-{light,dark}` on `<html>` and marks it `data-tenant-brand`. `globals.css` picks the pair under `:root[data-tenant-brand]` / `:root.dark[data-tenant-brand]`, so a theme switch needs no script. The provider never writes `--primary` itself, and removes one an earlier build left behind.
- **The save path.** The tenant form (`TenantFormFields`) shows, under the colour field, the shade each theme will render and whether it was "adjusted for contrast". The field's `<label>` is now associated with it. The backend validator (`tenant.validator.ts`) stays **form-only** (`#RRGGBB`) **by decision**, with a comment saying why, and `tenant.brandColor.adr090.test.ts` pins that a low-contrast colour is accepted, so a well-meant "reject bad colours" rule does not come back.
- **Reduced motion is global.** A last block in `globals.css` ends every animation and transition at once (`0.01ms`, one iteration; the entrance classes use `forwards`, so content lands visible) under `reduce`. The one exception is `animate-spin`: a spinner is a status, and a frozen one reads as a hang.
- **The sweep is a suite.** `automate/a11y.browser.js` runs after the smoke in `make test-browser`. It uses the same `puppeteer-core` and `axe-core`, with no new dependency. It checks WCAG 2.1 AA + best-practice axe on 6 public and 20 dashboard pages in both themes, the six key create dialogs' focus contract in both themes, reflow at 200% zoom, reduced motion, and the brand colour (`#ffff00` set on the run's tenant, then restored).

**Alternatives considered:** (a) above; storing a light and a dark brand colour (a migration and a second field for a problem the derivation solves); mixing toward black or white in RGB instead of moving HSL lightness (it drifts the hue more for saturated colours); keeping the per-class reduced-motion blocks and adding the missing classes (the next entrance class would be missed again, the way these were).

**Implications, including the bad ones**

- **What renders can differ from what the tenant typed.** `#ffff00` renders in the light theme as a dark olive-yellow. The form says so before saving, but a brand manager may still object. The only compliant alternative is a different colour, not the same one.
- **The derivation lives in the frontend only.** Anything else that renders the brand colour (an e-mail template, a PDF, a native client) must reuse it or re-derive it. Today nothing else does (`primaryColor` is read by `tenant.service.js` and the frontend only).
- **Global reduced motion also stops decorative loops that were fine**, and any future animation that carries meaning (a progress bar) must opt out explicitly the way `animate-spin` does.
- The suite needs a running, seeded stack and takes about ten minutes, because every page waits for its `<h1>` and for its animations to end. It is not in `make verify`.

**Status:** Accepted, implemented 2026-09-29. Evidence: `MEMORY/records/2026-09-29-feauto-a11y-f05-brand.md`. This closes the "brand `--primary`" and "axe in the browser suite" rows of the Open table above.

---

## ADR-093: Request Validation Is Zod and Joi Is Removed; the Validation 400 Keeps Its Status, Envelope and Message, and the Wording Inside `details` Changes; One Middleware and One Helper

**Date:** 2026-09-29 · **Card:** P9-11 · **Decided by** the owner (relayed by the coordinator, 2026-09-29), overriding the orchestrator's earlier "fully byte-compatible `details`" · **Realises** ADR-038's runtime-validation row · **Answers** the P9-11 spec's open questions 1, 2 and 4 (`MEMORY/specs/P9-11-validation-error-contract.md`) · **Works with** ADR-087 (toolchain; a conversion never changes behaviour — amended here for this card by the owner's decision), ADR-092 (lint at zero) · **Record:** `MEMORY/records/2026-09-29-p9-11-validators-zod.md`

**Context.**
- The P9-11 spec found five validation-400 surfaces, not one: A, `validate(schema)`; B, metered billing's own `validateBody`/`validateQuery` (another envelope, and a generic 500-style message in production); C, each validator file's own helper, in four shapes; D, a helper's throw answered by `asyncHandler`, whose `errors` never reach the wire; E, direct `schema.validate` calls in controllers and services. 41 contract suites pinned surfaces A, B, C and D byte for byte.
- The orchestrator first decided `details` must stay byte-compatible. The helper found that native Zod cannot do that. The wording differs for every issue kind, and so does acceptance. Joi's uuid accepted braces and no hyphens, its email checked the IANA TLD list, `Joi.date()` parsed any `Date`-parsable string, its number conversion refused `""`, `trim()` ran before `allow("")`, and its object output kept the input's key order.
- The only byte-compatible route was a Joi re-implementation on top of Zod. It was prototyped and then withdrawn, because the owner decided otherwise before it landed.
- **The owner's decision:** the project is in development. Replace Joi with Zod in every validator, in one change. Remove the `joi` package. Keep the HTTP contract that matters (status, envelope, the top-level message, `details` only outside production). Let the wording inside `details` change, and list every changed string.

### Decision

1. **Zod replaces Joi, and `joi` is gone.**
   - `zod` `^4.6.5` is a direct backend dependency (`npm install zod@latest --workspace backend`). `joi` is uninstalled (`npm uninstall joi --workspace backend`), and its transitive `@hapi/*` packages leave the lockfile with it.
   - Nothing else depended on joi (`npm ls joi --all` showed only the backend; the frontend never used it).
   - `npm audit`: 0. `npm ls --all`: exit 0. No new install script, so `allowScripts` is unchanged.
   - Package swaps under the owner's standing rule: **joi 18.2.9 → zod 4.6.5**. The reason is ADR-038: the schema is the runtime check and the request type.
2. **The validators.** Every `backend/src/validators/*.validator.js` is a Zod `.ts` module; `iot.validator.ts` moved from Joi too.
   - `fields.ts` holds the shared field schemas and the explicit conversions (item 6). `input.ts` holds the one input helper (item 4).
   - `audit.validator` and `webauthn.validator` are **deleted**. They exported only the dropped helper, and nothing imported them. Their contract suites went with them.
   - `calibrationDeviceReinstate.validator.ts` is new. The reinstate schema lived in its service (surface E). It is its own module because its statuses are a deliberate subset of the device ENUM, while `calibrationDevices.validator` is held `equal` to the ENUM by D-26.
   - `gdpr.validator#rectifiedEmailSchema` replaces gdpr.service's inline Joi email check.
3. **`validate(schema, { from })` is the only way to use a schema as middleware.**
   - `middlewares/validation.middleware.ts` checks `req.body` by default. An absent body is checked as `{}` (A-09).
   - `{ from: "query" | "params" | [...] }` checks the declared source, or the merge of several. In a merge a **path parameter always wins**, whatever order is written.
   - On success the parsed value is on `req.validated`, declared in `src/types/express.d.ts` as `unknown` and read typed with `validated(req, schema)`, which refuses a schema the request was not validated by. `req.body` is replaced only when the source is the body, as before, so existing handlers are unchanged.
   - Passing `schema.parse` (or `safeParse`, `parseAsync`) to a router is TS2769 in a `.ts` route. `.js` routes are held to the same rule by a new source guard, `tests/guards/schemaAsMiddleware.p911.test.ts`, which has a bite test.
4. **Surfaces B, C and E are unified.**
   - **B is folded.** `meteredBilling.route` mounts `validate(schema)` and `validate(schema, { from: "query" })`, and `validateBody`/`validateQuery` are deleted. A metered-billing 400 now has the common envelope, and in production it says "Validation Error" instead of the generic "An unexpected error occurred". `req.query` is still not reassigned.
   - **C is replaced by `validators/input.ts`**:
     - `validateInput(data, schema)` returns the value, or throws the plain `{ status: 400, message: "Validation failed", errors: [{ field, message }] }` that most callers already threw;
     - `checkInput(data, schema)` answers `{ ok, value }` or `{ ok: false, errors }`;
     - `fieldErrors(zodError)` gives the field errors.
     - Both helpers check `data ?? {}`. No validator module exports a helper of its own, and the rewritten `bodylessBody.a09` guard holds that.
   - Callers moved:
     - controllers: calibrationDevices, calibrationRecords, certificate, certificatePdf, dataRetention, featureFlag, networkSecurity, oidcProvider, scim, stock, tenant, tenantLifecycle, warehouse (`validateInput`); user, sso, iot, menuGroup, tenantHierarchy (`checkInput`);
     - services: stock, user, warehouse, tenant, certificate, calibrationDevices, calibrationRecords (`validateInput`); auth, calibrationDevices' CSV import, calibrationDeviceReinstate (`checkInput`).
   - Each caller keeps its own throw or answer shape; only the source of the field list changed. The four helpers that threw a key-map (`{ tenantId: "…" }`) now throw the list. That shape never reached the wire (surface D).
   - `auth.controller`'s three helper calls discarded their result (auth.service validates), so they are deleted.
   - **E:** tenantHierarchy.controller, menuGroup.controller, calibrationDevices.service (×2), calibrationRecords.service, calibrationDeviceReinstate.service and gdpr.service no longer call `schema.validate`.
5. **What stays of the HTTP contract, and what changes.** Unchanged:
   - HTTP 400;
   - `{ success: false, status: 400, message, data: null }`, in that key order;
   - the top-level `message`: "Validation Error" from `validate()`, "Validation failed" from the helpers;
   - `details: [{ field, message }]` **only outside production**, with `field` the path joined by dots.

   The wording inside `details` is Zod's, except where a schema carried a message of its own: the password rule, "Passwords do not match", "Domain is required" / "Must be a valid hostname", "ids is required" / "Select at least one notification to delete", the tenant logo rule, the webhook `secret` refusal, "Provide iotEnabled and/or readingTolerance", "endDate must be after startDate", and admin's flag problems. Every contract-suite string that changed is in the table below.

   **No frontend code reads `details`.** `client.ts` reads `message`. On the auth routes the service answers "Validation failed" with no `details` at all. So no user-visible text changed, and no further `.error` overrides were needed for login or registration.
6. **Conversion is explicit, per field, and narrower than `z.coerce`.**
   - `fields.ts` provides `numeric(schema)`, `booleanish()`, `dateLike()`, `isoDate()`, `isoDateText()`, `caseless(values, "upper" | "lower")`, `optionalText(max)`, `nullableText(max)`, `jsonObject()` and `uuid()` (`z.guid()`).
   - A string is converted only when it spells a number, or "true"/"false". `z.coerce.number()` would turn `""`, `null`, `true` and `[]` into numbers, and `z.coerce.boolean()` turns `"false"` into `true`.
   - `numeric` refuses a number beyond the safe-integer range, as before.
   - Unknown keys are stripped (`z.object`'s default). Nothing is `.strict()` except the iot tolerance bounds, where a misspelt bound was already refused. The roles menu bodies stay open (`z.looseObject({})`), as they always were; declaring them is its own change.
7. **`utils/jsonShape` is Zod** (cleared by the lead).
   - The same 14 keys, frozen; `jsonShape(key)` still returns `validator` (arity 1, `shapeKey`).
   - The D-27 types are now the shapes' `z.infer` (`MetricBounds` keeps its at-least-one-of union).
   - Acceptance is unchanged: `null` and `undefined` pass, as before (Sequelize validates an unset JSON column with `undefined`; found by `tenantBackup.twoTenant`). Only the text after "has the wrong shape:" changed.

### Acceptance differences, measured — not assumed

A differential run (scratch `p911/differential.ts`) set every exported object schema of every Joi validator at `HEAD` against its Zod successor, under the options the application used (`abortEarly: false`, `stripUnknown: true`).
- **Coverage of the run:** 155 schemas and **232,655 generated payloads**, of 1,501 per schema, drawn from each key's type, limits, allowed values and edge cases.
- **Every payload-level acceptance difference falls into one of two classes** (351 payloads, 0 unexplained):
  - **a UUID in braces, or without hyphens.** Joi accepted it; Zod refuses it ("Invalid GUID"). That is a deliberate tightening: every client sends the canonical form;
  - **an email whose top-level domain is not on the IANA list.** Joi refused it; Zod accepts it. The new check does not consult the list, and adding it back would mean a TLD-list dependency.
- **Four differences were found and removed before landing:**
  - `registerSchema.lastName` trims before its length rule, so "  " is again the empty last name;
  - `addDomain.domain` accepts an IP address, or a name whose last label starts with a letter, as Joi's `hostname()` did; Zod's own accepts "123";
  - `fields.numeric` refuses unsafe numbers;
  - `fields.email()` is an RFC 5322 dot-atom pattern with RFC 5321's limits (64 characters before the `@`, 254 in all). Zod's default pattern refused `%`, `!` and `#` in the local part, which Joi accepted; the services-test agent found this through A-128's `a_b%c@…` case. The length limits were found when the live E2E `http` spec's 50,000-character email answered 401, where Joi had answered 400.
- **Output differences on accepted payloads:**
  - the list-query `status` filter of `getAllTenantsQuery` and `getAllUsersQuery` is upper-cased, and that of `getWarehousesQuery` lower-cased. Joi returned the matched spelling. No controller reads these three filters;
  - `createCalibrationRecordSchema.calibrationDate` defaults to a `Date`, not Joi's millisecond number. The DATE column stores the same instant.
- **The test agents found four more, which no test pinned:**
  - `isoDate()` refuses "2026", "2026-01", a "+0700" offset without a colon, and an impossible date such as "2026-02-30". Joi accepted them, and rolled the last over to 2026-03-02;
  - a webhook `url` spelt "HTTPS://…" is accepted, where Joi refused it;
  - a duplicate webhook event is reported at `events`, not `events.1`.
- **`jsonShape` + the iot tolerance:** 14 keys × 73 samples = **1,022 checks, 0 differences** against the Joi originals (scratch `p911/compare-jsonshape.ts`). The lead's full-barrel model harness, with the Joi originals overlaid, agrees independently.

### Not fixed by this change (audit items)

- **A-272:** surface D. A thrown validation failure reaches the wire as "Validation failed" with `details: "[object Object]"`. It is pinned by `middleware.contract.test.ts`, and the fix belongs in `controllerWrapper.util`.
- **A-273:** `dataRetention`, `featureFlag` and `tenantLifecycle` merge `{ ...req.params, ...req.body }` with **the body winning**. The fix is `validate(schema, { from: ["params", "body"] })`.
- **A-274:** the unused `includeDeleted` scopes on 13 models (P9-10 spec, open question 2).
- **Fixed by the fold, as the owner decided:** metered billing's generic production 400 (surface B).

### Every contract-suite string that changed

- **How the literals were re-recorded.** The 38 per-validator suites keep the same payloads and the same schemas as before. Their literal `details` were re-recorded from the Zod validators by scratch `p911/gen-contracts.ts`, which also wrote the old/new pairs to `p911/contract-diff.json`.
- **What changed.** There are 79 `details` strings in total, and **2 are unchanged** ("Domain is required", "ids is required"). Every other string changed as the table below shows.
- `vendor.qualifyVendor` now reports **one** entry where Joi reported two (`any.only` and `string.base` for the same key).
- `admin`'s own message lost its quotes: `"flags" is required` → `flags is required`.

| Suite (schema) | Joi `details` (before) | Zod `details` (now) |
|---|---|---|
| `admin` `updateTenantFlagsSchema` | `flags`: "flags" is required | `flags`: flags is required |
| `auth` `registerSchema` | `firstName`: "firstName" is required; `username`: "username" is required; `email`: "email" is required; `password`: "password" is required | `firstName`: Invalid input: expected string, received undefined; `username`: Invalid input: expected string, received undefined; `email`: Invalid input: expected string, received undefined; `password`: Invalid input: expected string, received undefined |
| `billing` `updateSubscription` | `(root)`: "value" must contain at least one of [planId, status, billingCycle] | `(root)`: Provide at least one of planId, status, billingCycle |
| `calibrationDevices` `getCalibrationDevicesQuery` | `page`: "page" must be a number | `page`: Invalid input: expected number, received object |
| `calibrationRecords` `getCalibrationRecordsQuery` | `page`: "page" must be a number | `page`: Invalid input: expected number, received object |
| `certificate` `approveCertificateSchema` | `authMethod`: "authMethod" is required; `authPayload`: "authPayload" is required; `meaning`: "meaning" is required | `authMethod`: Invalid option: expected one of "password"|"mfa"; `authPayload`: Invalid input: expected string, received undefined; `meaning`: Invalid input: expected string, received undefined |
| `content` `createPost` | `type`: "type" is required; `title`: "title" is required | `type`: Invalid option: expected one of "BLOG"|"NEWS"; `title`: Invalid input: expected string, received undefined |
| `customDomains` `addDomain` | `domain`: Domain is required | `domain`: Domain is required |
| `dataRetention` `retentionPolicySchema` | `tenantId`: "tenantId" is required; `policyKey`: "policyKey" is required; `days`: "days" is required | `tenantId`: Invalid input: expected string, received undefined; `policyKey`: Invalid input: expected string, received undefined; `days`: Invalid input: expected number, received undefined |
| `eSignature` `createWorkflow` | `documentId`: "documentId" is required; `signers`: "signers" is required; `subject`: "subject" is required | `documentId`: Invalid input: expected string, received undefined; `signers`: Invalid input: expected array, received undefined; `subject`: Invalid input: expected string, received undefined |
| `featureFlag` `flagValueSchema` | `tenantId`: "tenantId" is required; `flagKey`: "flagKey" is required; `enabled`: "enabled" is required | `tenantId`: Invalid input: expected string, received undefined; `flagKey`: Invalid input: expected string, received undefined; `enabled`: Invalid input: expected boolean, received undefined |
| `finance` `createAssetFinance` | `deviceId`: "deviceId" is required; `purchasePrice`: "purchasePrice" is required; `purchaseDate`: "purchaseDate" is required; `usefulLifeYears`: "usefulLifeYears" is required | `deviceId`: Invalid input: expected string, received undefined; `purchasePrice`: Invalid input: expected number, received undefined; `purchaseDate`: Invalid input; `usefulLifeYears`: Invalid input: expected number, received undefined |
| `gdpr` `requestErasure` | `reason`: "reason" is required; `confirm`: "confirm" is required | `reason`: Invalid input: expected string, received undefined; `confirm`: Invalid input: expected boolean, received undefined |
| `iot` `deviceIdSchema` | `deviceId`: "deviceId" is required | `deviceId`: Invalid input: expected string, received undefined |
| `kanban` `createCard` | `columnId`: "columnId" is required; `title`: "title" is required | `columnId`: Invalid input: expected string, received undefined; `title`: Invalid input: expected string, received undefined |
| `maintenance` `createWorkOrder` | `deviceId`: "deviceId" is required; `title`: "title" is required; `type`: "type" is required | `deviceId`: Invalid input: expected string, received undefined; `title`: Invalid input: expected string, received undefined; `type`: Invalid option: expected one of "Preventative"|"Breakdown"|"Repair" |
| `menuGroup` `assignMenuGroupSchema` | `roleId`: "roleId" is required; `menuGroupId`: "menuGroupId" is required | `roleId`: Invalid input: expected string, received undefined; `menuGroupId`: Invalid input: expected string, received undefined |
| `meteredBilling` `createUsageAlert` | `metricName`: "metricName" is required; `threshold`: "threshold" is required | `metricName`: Invalid input: expected string, received undefined; `threshold`: Invalid input: expected number, received undefined |
| `networkSecurity` `geofenceSchema` | `latitude`: "latitude" is required; `longitude`: "longitude" is required | `latitude`: Invalid input: expected number, received undefined; `longitude`: Invalid input: expected number, received undefined |
| `notification` `deleteManySchema` | `ids`: ids is required | `ids`: ids is required |
| `oidc` `oidcClientSchema` | `name`: "name" is required; `redirectUris`: "redirectUris" is required | `name`: Invalid input: expected string, received undefined; `redirectUris`: Invalid input: expected array, received undefined |
| `qms` `createCapaSchema` | `ncId`: "ncId" is required; `title`: "title" is required; `actionPlan`: "actionPlan" is required | `ncId`: Invalid input: expected string, received undefined; `title`: Invalid input: expected string, received undefined; `actionPlan`: Invalid input: expected string, received undefined |
| `roles` `assignRoleSchema` | `userId`: "userId" is required; `roleId`: "roleId" is required | `userId`: Invalid input: expected string, received undefined; `roleId`: Invalid input: expected string, received undefined |
| `scim` `scimUserSchema` | `userName`: "userName" is required | `userName`: Invalid input: expected string, received undefined |
| `session` `revokeSessionSchema` | `reason`: "reason" must be a string | `reason`: Invalid input: expected string, received object |
| `sso` `ssoLoginSchema` | `tenantCode`: "tenantCode" is required | `tenantCode`: Invalid input: expected string, received undefined |
| `stock` `createTransferSchema` | `fromWarehouseId`: "fromWarehouseId" is required; `toWarehouseId`: "toWarehouseId" is required; `itemName`: "itemName" is required; `quantity`: "quantity" is required | `fromWarehouseId`: Invalid input: expected string, received undefined; `toWarehouseId`: Invalid input: expected string, received undefined; `itemName`: Invalid input: expected string, received undefined; `quantity`: Invalid input: expected number, received undefined |
| `storage` `updateStorageSettingsSchema` | `provider`: "provider" is required | `provider`: Invalid discriminator value. Expected 's3' | 'nfs' |
| `tenant` `createTenantSchema` | `name`: "name" is required; `code`: "code" is required | `name`: Invalid input: expected string, received undefined; `code`: Invalid input: expected string, received undefined |
| `tenantBackup` `createBackupSchema` | `name`: "name" is required | `name`: Invalid input: expected string, received undefined |
| `tenantHierarchy` `createSubOrganization` | `name`: "name" is required | `name`: Invalid input: expected string, received undefined |
| `tenantLifecycle` `suspendTenantSchema` | `tenantId`: "tenantId" is required; `reason`: "reason" is required | `tenantId`: Invalid input: expected string, received undefined; `reason`: Invalid input: expected string, received undefined |
| `ticket` `createTicket` | `subject`: "subject" is required | `subject`: Invalid input: expected string, received undefined |
| `user` `createUserSchema` | `username`: "username" is required; `firstName`: "firstName" is required; `lastName`: "lastName" is required; `email`: "email" is required; `password`: "password" is required; `roleId`: "roleId" is required | `username`: Invalid input: expected string, received undefined; `firstName`: Invalid input: expected string, received undefined; `lastName`: Invalid input: expected string, received undefined; `email`: Invalid input: expected string, received undefined; `password`: Invalid input: expected string, received undefined; `roleId`: Invalid input: expected string, received undefined |
| `vendor` `qualifyVendor` | `approvalStatus`: "approvalStatus" must be one of [APPROVED, PENDING, REJECTED, CONDITIONAL]; `approvalStatus`: "approvalStatus" must be a string | `approvalStatus`: Invalid input: expected string, received object |
| `warehouse` `createLocationSchema` | `warehouseId`: "warehouseId" is required; `name`: "name" is required; `code`: "code" is required | `warehouseId`: Invalid input: expected string, received undefined; `name`: Invalid input: expected string, received undefined; `code`: Invalid input: expected string, received undefined |
| `webhook` `createWebhookSchema` | `url`: "url" is required; `events`: "events" is required | `url`: Invalid input: expected string, received undefined; `events`: Invalid input: expected array, received undefined |
| `workflow` `createWorkflowSchema` | `name`: "name" is required; `resourceType`: "resourceType" is required; `steps`: "steps" is required | `name`: Invalid input: expected string, received undefined; `resourceType`: Invalid option: expected one of "Certificate"|"StockTransfer"|"MaintenanceWorkOrder"; `steps`: Invalid input: expected array, received undefined |

Also changed, outside the per-validator table:
- **`middleware.contract.test.ts`** (the bodyless and path-not-merged cases): `"tenantId" is required` → `Invalid input: expected string, received undefined`. Its surface-D case (`"[object Object]"`) is **unchanged** (A-272).
- **`meteredBilling.validator.contract.test.ts`**: one case for the folded route replaces the two surface-B cases. It sends `?page=0` to `validate(getBillingHistory, { from: "query" })` and expects the common 400, in both modes, with `page`: `Too small: expected number to be >=1`.
- **`audit.validator.contract.test.ts` and `webauthn.validator.contract.test.ts`** are deleted with their modules.

### Alternatives considered

| Alternative | Why not |
|---|---|
| **A Joi-compatible engine on Zod.** It was prototyped: the Joi 18 flow ported behind a Zod type, so every contract byte and every acceptance stayed | about 1,000 lines of a validation library to maintain, whose only purpose is to reproduce the one being removed. The owner's decision overtook it before it landed |
| **Native Zod, with a formatter that restates messages in Joi's words** (the spec's first proposal) | it reproduces the text but not the acceptance (uuid braces, email TLDs, date parsing, number conversion, key order), so a "byte-compatible" 400 would still hide a behaviour change. The owner also lifted the wording requirement |
| **Keep Joi** | its types do not reach the handler (ADR-038), and it means two libraries for one job |
| **`z.coerce` for conversion** | it converts `""`, `null`, `true` and `[]` to numbers, and `"false"` to `true`. `fields.ts` converts only what spells a value |
| **Fix surface D in this change** | the fix is in `controllerWrapper.util` (the lead's lane) and changes a pinned wire body. It is A-272, its own change |
| **Make every path-parameter controller use `validate(schema, { from })` now** | the three body-wins controllers would change which `tenantId` they act on, a behaviour change that needs its own review (A-273). The option exists and is tested |

### Implications, including the bad ones

- **`details` text changed on every validation 400.** No frontend code reads it, but a script or an integrator that matched Joi's wording breaks.
  - The live-contract smoke (`liveContract.smoke.test.js`) used to complete request bodies from Joi's words. It now restates Zod messages in those words (`restate()`) and reads schemas through `z.toJSONSchema`.
- **UUIDs in braces or without hyphens are now refused** at every id field.
- **Emails are no longer checked against the IANA TLD list.**
- **`isoDate()` refuses four spellings Joi accepted:** `"2026"`, `"2026-01"`, an offset without a colon, and an impossible day.
- **A status filter in a list query is case-folded:** upper case for tenants and users, lower case for warehouses. No controller reads these three filters today.
- **A controller that throws `validateInput` still loses the field list on the wire** (A-272). This change neither made it worse nor fixed it.
- **`z.infer` is the request type, but most controllers are still JavaScript.** No route uses the typed `validated(req, schema)` or `req.validated` yet. The three body-wins merges (A-273) are the first candidates.
- **The JSON column shapes accept exactly what they did, but their error text changed.** A test or a log search on the text after "has the wrong shape:" breaks.

### Evidence

| Check | Result |
|---|---|
| Contract suites, `npm test -- src/tests/contracts/validation` | **39 suites, 45 tests passed** (38 per-validator suites plus `middleware.contract`) |
| Differential, Joi at `HEAD` against Zod, under the application's options | 155 schemas, 232,655 payloads. Every payload-level acceptance difference is a braced or unhyphenated uuid, or an email TLD outside the IANA list: 351 payloads, **0 unexplained** |
| `jsonShape` and the iot tolerance, against the Joi originals | **1,022 checks, 0 differences**. The lead's full-barrel harness, with the Joi originals overlaid, agrees |
| Validator tests (rewritten by three agents), each validator's own figure | all 39 validator modules, `fields.ts` and `input.ts` at **100/100/100/100**. No test was left pinning a Joi acceptance that Zod lost |
| Full backend gate, `npm run test:coverage -- --ci --forceExit` | exit 0: **700 of 724 suites passed (24 skipped), 13,272 tests passed (155 skipped), 100/100/100/100** |
| `npm run typecheck` (TypeScript 7) | clean |
| `npx eslint src/` | **0 errors** (237 warnings, none of a new kind) |
| `npm run ratchet` | floor **1092 → 1050** (42 `.js` files gone), at the floor |
| `npm uninstall joi --workspace backend`, then `npm audit` and `npm ls --all` | joi and its `@hapi/*` packages are gone from the lockfile; **0 vulnerabilities**; `npm ls` exit 0 |
| `grep -rnwi joi backend/src backend/index.js` | **empty** |
| Live E2E, first image, built from the tree at 09:41Z (P9-00 method, project `callib-p911`, port 25100, fresh volumes, seeded) | runs B and C: **53/53 specs, 392 tests**, per spec **equal to P9-00**. Run A failed on the oversized email (last row) |
| Live E2E, final image, built from a snapshot of the working tree at 10:05Z | runs D (10:32Z) and E (10:34Z): **53/53 specs, 396 tests, 0 failed**. Per spec equal to P9-00 except `certificates` at 12 tests (P9-00: 8); another agent added those four to the spec in the working tree, and all four pass. Server log over D and E: **0 × 429**; the only 5xx were 2 × `POST /ai/query` 500 (no AI provider, as in P9-00). The stack, volumes, network and image were removed |
| Why the final image used a snapshot | the shared tree was mid-P9-12, and `build:dist` refused it because `utils/jwt.util` existed as both `.js` and `.ts`. The snapshot keeps the `.js` half |
| The E2E failure that was fixed | run A on the first image: `http` › "oversized email handled gracefully" answered **401**, where Joi had answered 400. Zod's email accepted a 50,000-character local part, and the login then failed. `fields.email()` gained RFC 5321's limits |
| Frontend `npm test` | 157 suites, 1,408 tests passed |

**Status:** Accepted, implemented 2026-09-29.

---

## ADR-095: Audit Rows Are Append-Only in the Database and Only Masking May Change Them; a System Role Cannot Be Soft-Deleted; the Backend Renders No Certificate PDF — the Frontend Renders It From a Data Document Whose Hash Binds Every Printed Field

**Date:** 2026-09-29 · **Findings:** Q-34, Q-35, Q-36 (`TASKS/BACKLOG.md`), M-11 / ADR-078 D-1 ·
**Authority:** the orchestrator decided Q-34 to Q-36 by best practice. For M-11 it first asked for a
packaging fix, then relayed the **owner's decision (2026-09-29): certificate PDF rendering moves to the
frontend**. · **Record:** [`records/2026-09-29-adr095-audit-append-only-pdf-frontend.md`](records/2026-09-29-adr095-audit-append-only-pdf-frontend.md)

### 1. Q-34 — `audit_logs` is append-only as a database constraint (migration 0091)

**Context.** ADR-051 Q-12 says audit rows are never purged, but only the services made it so. A live probe
as `callibrator_app` on PostgreSQL 18.6 showed the application role holding UPDATE and DELETE on
`audit_logs` (0057's blanket DML grant), with no trigger. `calibration_records` has had both layers since
0057. **One legitimate UPDATE exists:** GDPR masking (A-135,
`dataRetention.service#maskAuditTrail`). It replaces a data subject's `ip_address`, `user_agent` and
personal/network values inside `changes` with `"[REDACTED]"`. ADR-051 chose masking over deletion, so it must
keep working. Nothing else in `backend/src` updates or deletes an audit row. Every audit FK is RESTRICT
(0030), so no FK action rewrites one either.

**Debated for the masking path.**

| Option | For | Against |
|---|---|---|
| (a) Forbid every UPDATE | simplest trigger; strongest "immutable" reading | breaks GDPR masking, which ADR-051 decided on; an erasure request could then only be met by deleting rows, the thing Q-12 forbids |
| (b) A narrow SECURITY DEFINER masking function; direct UPDATE refused | a single, reviewable write path | the trigger still has to let the definer through. Whatever tells it "the caller is the definer" (a GUC, `current_user`) the owner can also produce, so the owner's direct UPDATE is not really refused. It also moves the masking rules into SQL, beside the service |
| **(c) The trigger admits exactly the masking SHAPE, for every role (chosen)** | no bypass exists to be abused; the owner is held by the same rule; the service is unchanged | the trigger must understand the shape of `changes`, so a recursive jsonb comparison is needed |

**Decision (c).** Migration `0091-audit-logs-append-only.ts`, the first TypeScript migration. Its
manifest name, `0091-audit-logs-append-only.js`, keeps the `.js` convention (P9-23). It runs in one
transaction:
- `audit_logs_masks_only(old jsonb, new jsonb)` (IMMUTABLE, recursive) is true when `new` is `old` with
  values under object keys replaced by the mask. The key sets and array lengths must stay the same, and the
  root is never replaced.
- The trigger `audit_logs_append_only` (BEFORE UPDATE OR DELETE, per row) and `audit_logs_no_truncate`
  (BEFORE TRUNCATE):
  - DELETE and TRUNCATE are refused (`42501`).
  - An UPDATE passes only when every column but `ip_address`, `user_agent` and `changes` is unchanged
    (compared as "everything except those three", so a column added later is covered too), `ip_address`
    and `user_agent` change only *to* the mask, and `changes` passes `audit_logs_masks_only`. A mask is
    final.
- Both triggers are **ENABLE ALWAYS**, which goes beyond 0057: they fire even under
  `session_replication_role = replica`, so only DDL on the table gets past them.
- `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM callibrator_app`, then `GRANT UPDATE (ip_address,
  user_agent, changes)`. This is the second, independent layer.
- The migration throws if the table or the role is absent, and is idempotent. `down` drops both triggers and
  both functions and gives back table-wide UPDATE and DELETE. No row is touched.
- The boot schema check (`utils/schemaVerify.util.ts` EXPECTED_OBJECTS) now names both triggers: 10 control
  objects.

**Evidence.**
- `tests/migrations/0091-audit-logs-append-only.test.ts` passes 10/10: the statements, a refusal instead of a
  skip, idempotence, `down`, role-name safety, and the trigger's mask equal to `dataRetention.service`'s
  `PII_MASK`.
- `tests/services/auditLogAppendOnly.q34.live.test.ts` on `pgvector/pgvector:pg18` (PostgreSQL 18.6), with
  the owner a **superuser** as in compose. Two scratch databases:
  - `Q34_MODE=upgrade`, 7/7: `sync()` + migrations up to 0090, audit rows written, then 0091 over them.
    **Fail-before in the same run:** before 0091, `callibrator_app` DELETEs an audit row and rewrites its
    `action`, and the owner DELETEs one.
  - `Q34_MODE=fresh`, 7/7: `runSchemaSetup`, the boot path, 64 migrations.
  - Each mode asserts the following:
    - **As `callibrator_app`** (`SET ROLE`): DELETE, TRUNCATE and `UPDATE action` are refused by privilege;
      a non-mask `ip_address` and a forged `changes` are refused by the trigger; INSERT still works.
    - **As the owner:** DELETE, `DELETE` of all rows, TRUNCATE (plain and CASCADE) and ten forging UPDATEs
      are refused by the trigger, still refused under `session_replication_role = replica`, and the row is
      unchanged afterwards. The owner may mask, and cannot un-mask.
    - **`dataRetention.maskPII` run as `callibrator_app`** through `enterApplicationRole` masks two rows
      exactly and audits itself. A second pass masks 0.
    - `down`, then `up` twice, restores the control.
  - Grants read back through `information_schema` on the fresh database: INSERT and SELECT on the table,
    UPDATE on the three columns only.
- The backend image booted: the migrations applied, 0091 among them, then
  `[schema-verify] OK: 72 tables, 867 columns and 10 control objects`. In that database, `callibrator_app`'s
  DELETE is refused by privilege and the owner's by the trigger.

**Implications, the bad ones included.**
- A later migration that must rewrite audit rows (none should) has to `ALTER TABLE audit_logs DISABLE
  TRIGGER …` in its own transaction, say why, and re-enable it. That is deliberate friction.
- Masking accepts `"[REDACTED]"` under **any** object key, not only the service's key lists. A caller with
  UPDATE on the three columns can therefore erase any value inside `changes`, a resource id for example. It
  can never forge or restore one. Binding the key list into SQL was rejected: the service would drift from
  it and fail loudly at the first new key.
- The live suites whose cleanup does `DELETE FROM audit_logs` (`batchJob.w07`, `calibrationScheduler.w03`,
  `tenantHardDelete.w20`) state that they run on a `db.sync()` schema without migrations. Run on a migrated
  database, their cleanup is refused. That is correct, and noted here.
- `enterApplicationRole`'s boot self-check still probes only `calibration_records`. Extending it to
  `audit_logs` is left open (O-1 below).

### 2. Q-35 — `Role.prototype.softDelete` refuses a system role

The guard read `this.is_system`, which is always undefined (the attribute is `isSystem`). One line in
`models/role.model.ts` fixes it; the Phase 9 lead was told first and flipped its model-equality harness.
Nothing in `backend/src` calls `Role#softDelete` today, so no route changes. The guard now holds for the next
caller. Test: `tests/models/roleSoftDelete.q35.test.ts` passes 2/2. **Fail-before:** 1/2, "Received promise
resolved instead of rejected", with a SUPERADMIN role marked deleted.

### 3. Q-36 — `keyRotation.s08.live` covers the S-20 seeds, and is green

The rehearsal now seeds users' TOTP seeds as well: one sealed `mfa_secret` and one sealed
`mfa_pending_secret` under key A, plus one **pre-0086 plaintext** seed. It reads them back as login does
(`mfa.openSecret`). The expected report names every target, with both the rewrapped and the converted
count: users `mfa_secret` 1 rewrapped and 1 converted, `mfa_pending_secret` 1. It expects 8 re-wraps and
1 conversion in total, 9 envelopes under key B afterwards, and the interrupted-rotation step now fails
under key A alone, as intended. Before, step 2's first assertion failed, so step 5 ran against un-rotated
rows and "passed" for the wrong reason. **Result:** `DATA_PG_LIVE_TEST=1 … keyRotation.s08.live` on
PostgreSQL 18.6 passes **5/5** (it was 3/5).

### 4. M-11 — the backend renders no certificate PDF

**Context.** ADR-078 D-1: in the shipped pkg binary, `POST /certificates/:id/pdf` answered 500. puppeteer 25
is ES-module-only, and Node's ESM loader cannot read pkg's `/snapshot`.

Two findings came out of the work:
- Loading puppeteer from a real `node_modules` shipped beside the binary did load it in the image. Chromium
  then died with SIGTRAP ("chrome_crashpad_handler: --database is required") because uid 997 had no home
  directory. With a home directory, the image rendered a real PDF (`%PDF-1.4`, 77,547 bytes, QR and verify
  URL present).
- The rendered PDF printed the draft watermark as escaped text (`<div class="watermark">draft</div>`). The
  generic substitution loop escaped the block before its raw pass. This was fixed (test first), then removed
  with the renderer.

**The owner then decided that PDF rendering moves to the frontend.** The options debated before that
decision:
- (a) Make pkg include the ESM package: tried by the P7-04 drill, and it did not work.
- (b) Load puppeteer from disk beside the binary: it works, as proven above, but it ships ~29 MB of modules
  plus Chromium.
- (c) Run `node dist/index.js` on a Node image: pkg's packaged-mode path logic diverges.
- (d) Render elsewhere.

The owner chose (d), in the frontend.

**Integrity: what is hashed and signed now.** Nothing in this codebase ever hashed or signed the PDF bytes:
- The printed `integrityHash` was SHA-256 over a canonical JSON of certificate DATA.
- The Part 11 `documentHash` (`certificate.service#logSignature`) is over certificate data.
- The HMAC was returned but never persisted or verified (A-241).

So "the stored-PDF hash" needs no successor.

| Option | For | Against |
|---|---|---|
| Keep only v1 | no change | v1 omits summary, conditions and notes. The server-stored file used to be the authoritative copy a third party could view; without it, a printout's summary could be altered and still match |
| Hash the frontend-rendered bytes | "the file is signed" | the bytes are produced in a browser that nobody attests; the server would sign whatever it was sent |
| **v2 over every printed certificate column, v1 kept unchanged (chosen)** | every printed field of the certificate row is bound; issued printouts still verify; the scheme is named inside the payload | two hashes on the verification page; names of people, the device and the tenant are printed live and not bound |

**Decision.**
- **Backend.**
  - New `services/certificateDocument.service.ts`. It holds the v1 payload, moved **byte for byte**
    (pinned against the original function and a fixed hex, 6 fixtures), and the v2
    `certificate-content-v2` payload (v1's fields + summary, conditions, notes, calibratedBy, approvedBy,
    digitalSignature and its key id; the scheme name inside).
  - `toCertificateDocument` and `getCertificateDocument`. Every include is `required: false`, names only
    and never an email, and the server HMAC over v2 is returned to authenticated callers.
  - New route `GET /certificates/:certificateId/document` (auth, validateUuid,
    `dynamicAccess("certificate","read")`), enveloped. Another tenant's certificate is a 404.
  - `POST /certificates/:certificateId/pdf` is **removed**.
  - `GET /:certificateId/pdf` serves only a PDF **stored before this change** (`getStoredPdf`) and never
    renders; with no stored file it answers an enveloped 404 naming `/document`.
  - The public `GET /verify/:number` keeps `integrityHash` (v1) and adds `integrity` (v2). For a signed,
    non-withdrawn certificate it adds `document`, the same fields its stored PDF printed, without the HMAC.
    `documentUrl` and the stored-document capability are unchanged, so old files stay viewable.
  - `templates/certificate.html`, the puppeteer path, Chromium, `fonts-liberation` and
    `PUPPETEER_EXECUTABLE_PATH` (Dockerfile, compose, the three Helm values files, the configmap and
    `.env.example`) are removed.
  - `puppeteer` moves to backend **devDependencies**. The documentation generators and
    `automate/smoke.browser.js` still use it; the lockfile diff only flags its closure `dev`.
- **Frontend.**
  - `lib/certificatePdf.ts` (jsPDF, already a dependency) renders the document: every field, a watermark
    for anything unsigned, the QR of the server's `verifyUrl`, and "Integrity (certificate-content-v2,
    SHA-256): <hash>".
  - Text outside Latin-1 is folded (accents) or printed as `?`.
  - The PDF is downloaded as a Blob.
  - The certificates table fetches `/document` and then renders.
  - The public verification page offers "Download certificate PDF" from `document`, shows both hashes,
    and still frames a stored PDF.
  - Debated before building:
    - (a) jsPDF client-side generation was **chosen**: a real downloadable file, testable byte for byte,
      already a dependency, no `eval`, and it injects no script.
    - (b) A print stylesheet plus `window.print()` produces no file and cannot be tested for `%PDF`.
    - (c) A Next server route would move Chromium into the frontend image, against the owner's intent.
- **Existing certificates.** No column changes, so no migration. The v1 hash is recomputed from data and
  still matches every issued printout. Stored files stay in `uploads/certificates` and are served as
  before.

**Evidence.**
- Backend tests:
  - `certificateDocument.service.m11.test.ts` 34/34.
  - `certificatePdf.service.test.js` 34/34.
  - `certificatePdf.controller.test.js` 9/9.
  - `certificates.lifecycle.twoTenant.test.ts` with the new `@two-tenant … GET /:certificateId/document`
    marker, cross-tenant 404, the owner's control, and `twoTenantRoutes.guard` green.
  - `certificateFrame.p708`, `certificates.route`, `denyPlatformAuthoring.a127`,
    `certificates.approve.a62`, `certificates.twoTenant.a145`, `email.templates` and
    `istanbulIgnore.a32` are updated and green.
  - Coverage of every touched backend file is 100/100/100/100.
- Frontend tests:
  - `lib/certificatePdf.test.ts` 14/14: a real jsPDF render read back byte for byte.
  - `lib/certificatePdf.download.test.ts` 1/1.
  - `verify/[certificateNumber]/__tests__/page.m11.test.tsx` 5/5.
  - `CertificatesTable.m11.test.tsx` 2/2.
  - `calibration.service.test.ts` passes, including the new endpoint.
- Image and live check (details in the record):
  - The backend image is **664 MB, down from 1.68 GB** with Chromium.
  - The API on the image: the document 200, the stored `/pdf` enveloped 404, `POST /pdf` 404, submit →
    approve → sign, and verify `valid` with `document` whose v2 hash equals the authenticated one.
  - `automate/smoke.browser.js` passes **7/7**: the dashboard PDF and the public verification-page PDF, each
    a real `%PDF` with the QR image, the number and the v2 hash, and 0 CSP violations.
  - `pdftotext` of the saved PDF shows every field and the hash.
  - The P9-00 E2E baseline, runs A and B: 52/53 suites (395 tests); `certificates.e2e` 12/12. The one
    failure, `ai.e2e` (409 vs 200/500), is another lane's in-flight A-281 change.

**Implications, the bad ones included.**
- **The PDF bytes are no longer a server-produced artifact.** A holder's PDF is only as trustworthy as its
  match against the verification page. The QR and the v2 hash make that match checkable, but nothing
  signs the file itself. Before, the server-stored PDF was the reference copy.
- Two renderings of the same certificate can differ in layout: the browser's fonts do not matter, but
  jsPDF versions do. Only the data is attested.
- Names printed for people, the device and the tenant come from live rows and are not hashed. A later
  rename changes the printout, not the hash. Nameless accounts print "-" where the old template printed
  their email.
- jsPDF's standard fonts are Latin-1: a name in another script prints as `?`. Embedding a Unicode font is
  the fix if a tenant needs it.
- `GET /:certificateId/pdf` now 404s for every certificate issued after this change. Clients must use
  `/document`. `POST /:id/pdf` is gone, and the `certificate:generate` permission still gates the other
  routes it gated.
- The Helm and compose memory limits were sized for Chromium and were **not** re-sized (marked in place).

**Status:** Accepted, implemented 2026-09-29.

### Amendment 1 (2026-09-30) — the open items closed: the boot self-check covers `audit_logs`, live suites drop a database instead of deleting audit rows, memory re-sized, a Unicode font in the PDF

Record: [`records/2026-09-30-adr095-followups.md`](records/2026-09-30-adr095-followups.md).

- **O-1.** `enterApplicationRole` (`utils/dbRole.util.ts`) now refuses the boot unless the application role
  has no DELETE and no TRUNCATE on `audit_logs`, keeps INSERT, and may UPDATE **exactly** `changes`,
  `ip_address` and `user_agent`. A missing masking grant is refused as well as an extra one: without it GDPR
  masking (A-135) fails at the first erasure request. So a database where 0091's REVOKE is missing, or
  0057's blanket grant came back, no longer boots. *Alternative considered:* check only DELETE, as for
  `calibration_records`. Rejected: TRUNCATE and a table-wide UPDATE rewrite the trail just as well.
  *Bad implication:* a deployment whose role deliberately lacks the masking grant, for example one that
  never masks, must grant it or set `DB_APP_ROLE=none`.
- **O-2.** A live suite that writes audit rows now gets a database of its own
  (`tests/fixtures/disposableDatabase.ts`, `liveBoot.ts`). It boots the database as the backend does, runs as
  `callibrator_app`, and drops the database afterwards. Eight suites were moved, the three named above and
  five more that also deleted audit rows. *Alternatives considered:* (a) `ALTER TABLE … DISABLE TRIGGER` in
  the cleanup: rejected, since a control that tests switch off is one that shared code can switch off; (b) a
  schema per suite: rejected, since Sequelize's `search_path` would have to follow every pooled connection
  and the migrations name `public`; (c) a test-only SQL function that bypasses the trigger: rejected, as it
  is a bypass living in the database. *Bad implications:* each suite pays a full sync + migrate (≈10 min on
  a loaded host; `LIVE_DB_TEMPLATE` copies a booted database to avoid it). DB_USER needs `CREATEDB`. A run
  killed mid-way leaves its `*_scratch` database behind.
- **O-4.** Backend memory limits were re-sized to measured need: 1Gi (Helm default and staging, compose
  staging and vm) and 1536Mi / 1536M (production). They were 4Gi/4G (2Gi/2G staging). Measured on the image
  under boot, seeding, E2E and browser-smoke load: cgroup peak 306 MiB, Node VmHWM 337 MiB. *Bad
  implication:* E2E load is not a production tenant's export. The first OOM-kill, if any, will come from an
  unmeasured path, which is why the headroom is 3× (4.5× in production) and not tighter. The charts render,
  but they are not known to deploy.
- **O-5.** The frontend embeds Noto Sans (OFL, self-hosted, subset to Latin/Latin Extended incl. Vietnamese,
  Greek and Cyrillic, 135 KB per weight), fetched only when a PDF is rendered. A character outside the font
  folds to its base letter or prints `?`. If the font cannot be fetched, the PDF falls back to Helvetica. The
  hashes are unchanged: they are over data. *Not covered:* Arabic, Hebrew, CJK, Thai and Indic scripts. They
  would need per-script fonts (CJK alone is megabytes) and Arabic shaping.
- **O-6.** `automate/smoke.browser.js` ran live, 7/7, and ADR-101's separate approver works. The run needed
  three smoke fixes that are not ADR-101's: reading text through the PDF's ToUnicode CMaps, following the
  A-293 verification token, and reading the P10 page's English copy.
- O-3 (A-285) and O-7 stay with their lanes.

---

## Open Decisions

Recorded so a future reader can tell whether their idea was evaluated and rejected, or genuinely never considered.

| Question | State |
|---|---|
| `REVOKE UPDATE, DELETE` on `calibration_records` | **closed** — done by ADR-062: a trigger for every role plus the application-role REVOKE (P6-03) |
| A separate `LOGIN` application role with no path back to the owner | **open** — the stronger form of ADR-062's `SET ROLE` (which `RESET ROLE` undoes); needs a second credential in every deployment template, Helm included |
| A composite unique on `(tenant_id, serial_number)` | **closed** — done by ADR-049 (migration `0026`); **not partial on `is_deleted`, decided by ADR-078** (a soft-deleted device keeps its serial; restore, ADR-075, is the way back) |
| Serial uniqueness per `(tenant, manufacturer, model, serial)` | **open** — ADR-078: the honest answer to two different instruments sharing a serial; nobody has asked yet |
| Mandatory MFA for role level 10 | should happen (PR-3) |
| A build guard failing any route without a permission gate | should happen — the most likely authorization defect has no mechanism against it |
| Post-migration column verification | **closed** — every boot verifies the schema and refuses on a mismatch (ADR-062, P6-05) |
| JSDoc with `checkJs` on the backend | **closed** — superseded by strict TypeScript (ADR-038) |
| ESM for the backend | open — deliberately deferred until the TypeScript migration completes (ADR-038) |
| Row Level Security as defence in depth | **open** — PostgreSQL-only (ADR-039) removes one of ADR-029's three reasons against it; the fail-open risk and per-request cost remain |
| Partitioning `iot_readings` and `audit_logs` | deferred until retention alone stops being enough |
| A read replica for reporting | deferred until reporting measurably affects operational p95 |
| Per-signer signing keys instead of per-tenant | **open** — ADR-040 signs with a tenant key held by the service, which proves the service signed for that user, not that the user did. Non-repudiation against the operator needs per-user key material and an enrolment flow |
| Moving the e-signature private keys under `kms.service.js` | **closed** — migration `0058` re-wraps them as KMS envelopes with tenant AAD (ADR-062) |
| A trusted timestamp (RFC 3161) on signatures | **open** — `signedAt` is the application's own clock, bound into the payload but attested by nothing |
| A rotation procedure for `CERT_SIGNING_SECRET` and `ENCRYPT_KEY` | **closed by ADR-062**, except the rehearsal against a copy of production data, which is still owed (`docs/SECURITY/13-KEY-ROTATION.md`) |
| Serving the application on a custom domain (resolve the tenant from `Host`, issue and renew TLS) | **open** — ADR-065 removed the uncalled stubs; a verified domain is a claim only. Needs its own design: a spoofed `Host`, a principal whose tenant differs from the domain's, certificate storage and renewal |
| Tenant-owned roles (`roles.tenant_id`, `UNIQUE (tenant_id, name)`) | **open** — ADR-064 keeps roles global; revisit when a tenant needs a custom role |
| An archival process for an offboarded tenant's retained records | **open** — ADR-064: a tenant purge refuses while any regulated record remains, so offboarded tenants accumulate until this exists |

## ADR-094: An OIDC Consent Belongs to the Client's Tenant; a Payment Lifts Only Dunning's Suspension; Users Named in a Body Are Checked Inside the Record's Tenant; Operator Changes to a Tenant Are Audited Twice and Name Their Target in the Path; an API Key Is a System Actor; a Missing AI Provider Is 409

**Date:** 2026-09-29 · **Cards:** A-275, A-276, A-277, A-278, A-279, A-280, A-281, A-282 · **Decided by** the security-fixes agent, under the owner's standing instruction: argue each decision from two opposing viewpoints, choose best practice, and record it · **Works with** ADR-048 (tenant-scoped includes), ADR-051 Q-13/Q-17 (actors, and the operator in a tenant's trail), ADR-075 (the A-37 rule: a SCIM key is `system:scim`), A-165 (an operator change is recorded under PLATFORM and under the tenant) · **Record:** `MEMORY/records/2026-09-29-security-fixes-a275-a282.md`

**Context.** Recent agent reports found seven defects that were not yet on the board. Fixing them turned up an eighth (A-282):

- **A-275.** `POST /oidc/authorize/decision` minted an authorization code for any signed-in user, whatever tenant the staged request's client belonged to. `GET /authorize/request/:id` showed the request to any user too.
- **A-276.** The Stripe webhook set `active` on every payment and `suspended` on repeated failure, unconditionally and with no audit row. A paid invoice lifted a suspension the platform operator had imposed, and re-activated an offboarded tenant.
- **A-277.** A ticket's `assignedTo`, a kanban member's `userId` and a card's `assigneeIds` were stored as given.
- **A-278.** Mutations committed with no audit row: SCIM user writes, API-key create and revoke, e-signature key create and delete, vendor, risk, scorecard and asset-finance writes, and four of the six tenant-lifecycle transitions.
- **A-279.** `cancelOffboarding` answered a state conflict with 400.
- **A-280.** The network-security PUTs and the OIDC client routes acted on `req.user.tenantId`, which for the operator is always their home tenant.
- **A-281.** `POST /ai/query` answered 500 when no provider was configured.
- **A-282.** `auditActor(req)` names `req.user.id` as the audit row's user. For an API key that is the key's id, and `audit_logs.user_id` references `users` (migration 0030).

### Decision

1. **A-275 — only a signed-in user of the client's own tenant may see or decide an authorization request.**
   - `oidcProvider.service#loadDecidableRequest` compares the staged request's `tenantId` with `user.tenantId`, the account's **home** tenant, never the x-tenant-id override.
   - Missing, expired and another tenant's requests all get one answer: `GET` 404, `POST` 404 "Authorization request not found". A foreign attempt neither consumes the request nor mints a code.
   - A platform client lives in the operator's home tenant, so the operator decides it by the same rule. No special case is needed.
   - A decision writes one row in the client's tenant (`APPROVE`, or `UPDATE` for a denial, resource `OidcClient`). The code is minted **inside** that row's transaction. `redis.set` answers `false` rather than throwing, so a code it would not store is a 503 that rolls the row back.
   - The consent-screen read (`GET /authorize/request/:requestId`) leaves the guard's `capability` list. It is now covered by a two-tenant test.
   - *For another rule:* "any authenticated user" is simpler, and the request id is 24 random bytes. *Against it:* the code's `sub` is the user and its `tenant_id` is the client's tenant. Anyone who learns an id (from a shared link, a log or a referrer) is then vouched for by a tenant they do not belong to. The unguessable id is a CSRF measure, not an authorisation. *Also rejected:* letting the super admin decide any tenant's request. The resulting token would name a platform account inside a hospital's relying party, which is the A-90 shape.
2. **A-276 — a payment lifts only dunning's own suspension.**
   - Dunning suspends only an **active** tenant. It marks the suspension as its own: `suspension_reason = "billing:dunning"` and no `suspended_by` (`constants/tenantSuspension.ts`).
   - `invoice.paid` and a subscription update to Active lift only a suspension that carries both marks.
   - An operator's suspension and an offboarding are **kept**, and the payment is recorded against them (`BILLING_PAYMENT_STATUS_KEPT`), so the operator sees that it arrived. Dunning never relabels an operator's suspension.
   - Conversely, `suspendTenant` by the operator **replaces** a dunning suspension, so a later payment cannot lift what the operator decided.
   - Every decision writes one row under PLATFORM and one under the tenant, in the same transaction as the tenant write. The actor is the new system actor `system:billing-webhook`, and the row names the Stripe event.
   - *For letting payment lift any suspension:* the most common reason to suspend is non-payment, and auto-resume saves the operator a step. *Against it:* an operator suspends for other reasons too (fraud review, contract end, a data-protection hold). A payment event is a billing fact, not a decision about those reasons. And an offboarded tenant coming back to life is the worst outcome available.
   - *Why not a new column:* the two marks together are unambiguous, because an operator suspension always names the operator. They need no migration, and the state stays on the columns `docs/MULTI-TENANCY/01` already documents.
3. **A-277 — a user named in a body must be a user of the record's tenant.**
   - That is the caller's own tenant for a new ticket, the ticket's tenant for an update (the super admin works every queue), the project's tenant for a kanban member or card assignee, and the risk's tenant for a risk's `assignedTo` (found while fixing the card, same shape).
   - Missing, soft-deleted and another tenant's users are **one 404**, following A-129's signer rule: "Assignee not found in this organisation" / "User not found in this organisation". Nothing is written. The tenant predicate is explicit, because a super admin's context skips the hooks.
   - *For 400:* the request is malformed. *For 404:* the codebase already answers a foreign signer with 404 (A-129). One status for "no such user here" keeps the existence oracle closed whichever way it is asked.
   - *Considered and rejected:* allowing the super admin as a ticket assignee. After ADR-048 the assignee would read as `null` to every tenant user (A-90), so the ticket would look unassigned to the requester.
4. **A-278 — every listed mutation writes its row inside its transaction** (`auditService.logAction(entry, { transaction })`; the P6-11 guard stays green):
   - SCIM user create, replace, patch and delete: a key is `system:scim` with `changes.apiKeyId` (A-37); a super admin's JWT is that user. Role and status values are recorded; names and addresses are not.
   - API-key create and revoke: the row names the key's id and display prefix, never the key or its hash.
   - E-signature key create and delete: the key's id and `keyId`, never key material. The delete's response also stops passing its message as `meta`.
   - Vendor create, update, delete and qualify; risk create, update and delete; scorecard create, update and delete; asset-finance create (including a revival), update and delete: `before`/`after` of the fields the body named.
   - Tenant `suspend`, `resume`, `grace-period` and `offboard/cancel`, by the operator: one row under PLATFORM and one under the tenant (A-165). `cancelOffboarding` also returns `lifecycle_status` to `ACTIVE`.
   - **Webhook PATCH without a URL change was already audited.** `webhook.service#updateWebhook`, tested by `webhook.service.test.js` › "updates without a secret, audited in a transaction, when the url is unchanged". That report was stale, and nothing was changed.
5. **A-279 — the transitions answer a state conflict with 409 that explains the state.**
   - `cancelOffboarding` of a tenant that is not offboarded: `This tenant is "<status>", not offboarded …`.
   - `suspend` and `resume` of an **offboarded** tenant: `This tenant is offboarded: it cannot be suspended/resumed. Cancel the offboarding first …`. Resume used to leave `offboarded_at` set on an active tenant.
6. **A-280 — the operator names the target tenant in the path.**
   - New `superAdminOnly` routes: `GET|PUT /network-security/tenants/:tenantId/ip-allowlist` and `…/geofence`, and `GET|POST /oidc/tenants/:tenantId/clients`, `POST …/clients/:clientId/rotate-secret` and `DELETE …/clients/:clientId`. Each takes `validateUuid`, and a tenant that does not exist (or the hidden PLATFORM tenant) is 404.
   - The home-tenant routes stay. For the OIDC clients they are the **platform** clients. Every write is audited under PLATFORM and the tenant.
   - *For the x-tenant-id header:* it already exists. *Against it:* it is invisible in the URL and the logs, it silently falls back to the home tenant when it names a suspended tenant, and CLAUDE.md never lets a tenant id come from the body or a header for a write. The platform routes already name the tenant in the path (`/tenants/:tenantId/suspend`, `dataRetention/:tenantId/…`).
   - *For letting a tenant administrator set their own allowlist:* it is self-service. *Against it:* a wrong CIDR locks the tenant out, and recovery then needs the operator. Who may set it is a product decision, so it stays with the operator (**Q-38**).
7. **A-281 — a missing AI provider is 409; a provider that failed is 502.**
   - The 409's message names the settings to configure.
   - *For 503:* the feature is unavailable. *Against it:* 503 means "temporarily, retry". Clients and proxies retry it, and it counts as a server error on every dashboard, while this is a tenant configuration that no retry will change.
   - *For 409:* the request conflicts with the tenant's current state, and CLAUDE.md surfaces a 409 as a state explanation.
   - An upstream failure is a 502 (bad gateway), not a 500.
8. **A-282 — an API key is recorded as `system:api-key`, with `changes.apiKeyId`, never as a user.**
   - The rule is `utils/auditPrincipal.util.ts` (`auditPrincipal(req)`, `auditEntryActor`, `actorChanges`), used by the A-278 vendor, risk, scorecard and finance writes, which keys can reach.
   - `SYSTEM_ACTORS` gains `API_KEY` and `BILLING_WEBHOOK`. The closed-list test lists both.

### Alternatives considered
The decision items above each carry their own. The rejected ones: no tenant check on consent; payment lifting every suspension; a dedicated suspension-source column; 400 for a foreign user; the x-tenant-id override as the target; 503 for a missing AI provider; changing `auditActor` itself for every caller in this change.

### Consequences
- **Good.**
  - A consent can no longer cross tenants.
  - A payment can no longer undo an operator's decision.
  - Foreign user ids are refused before anything is written.
  - Every listed mutation is attributable.
  - The operator can act on any tenant's allowlist and OIDC clients, and the path says which.
  - An AI misconfiguration no longer reads as an outage.
- **Bad, or still open.**
  - **A-282 is partial.** The other audited services a key can reach still pass `auditActor(req)`, so on PostgreSQL an API-key write to them would fail its foreign key and roll back. This was verified from code, not against the database. Each needs `auditPrincipal`, and the next step is a guard that finds `auditActor(req)` on a key-reachable route.
  - `offboardTenant` still writes one row (the tenant's), not A-165's two.
  - The Stripe plan change (`maybeUpdateTenantPlan`) is still unaudited.
  - The frontend has no screen for the new `/tenants/:tenantId/…` routes. They are API only.
  - The IP allowlist and geofence are **not enforced at sign-in**: `evaluateLoginSecurity` has no caller outside its own route (**A-288**). This ADR makes them settable per tenant; it does not make them effective.
  - Other bodies that name a user id have not been swept for the A-277 shape. Only the four above were checked.
- **Evidence.** Each test is named in the record, with the run that failed on the tree before the fix.

---

## ADR-099: The First Super Admin Gets a One-Time Password, Revealed Only in a File Inside the Container; Its First Use Yields a Password-Change Token, Not a Session

**Date:** 2026-09-29 · **Task:** P10-16 · **Authority:** owner request (2026-09-29): "the first superadmin is created with a randomly generated password … used for the first login only; the password must be changed after login; the random password expires immediately once it has been used". Owner decision the same day: the value is visible **only inside the container** (file, 0600; never stdout/stderr, API, audit, database plaintext or environment). · **Spec:** [`specs/P10-16-superadmin-bootstrap-otp.md`](specs/P10-16-superadmin-bootstrap-otp.md) · **Record:** [`records/2026-09-29-superadmin-bootstrap-otp.md`](records/2026-09-29-superadmin-bootstrap-otp.md)

**Context.** `migration.service.js` seeded `sys@mail.com` with the public password `123123`, and **every** call to the seed endpoint re-hashed `123123` onto the existing account, which reset the operator's password to the public default. A-123/A-215 (administrator temporary passwords) set a must-change flag and a 72 h expiry. Under them a correct temporary password still opens a normal session, gated route by route in `auth.middleware`, and it keeps working until it is changed. That is not "first login only".

**Decision.**
1. **New column `users.password_one_time`** (migration 0094, model `passwordOneTime`). It is set only by the bootstrap and by the recovery CLI. A `User` `beforeSave` hook clears it whenever `password` changes without it, so every existing password writer leaves an account non-one-time with no edit.
2. **Bootstrap (`services/bootstrapCredential.service.ts`, called by `seedUsers`).** The system super admin is created only when none exists. Its password is 24 characters from `crypto.randomInt` over 61 unambiguous characters, with every class present (≈142 bits). The database holds only the bcrypt hash. The account is created with `password_one_time`, `must_change_password` and an expiry 72 h out. The audit row (`CREATE`, actor `system:bootstrap`, no secret) and the file write happen inside the creating transaction. An existing `sys@mail.com` is never given a new password by the seed.
3. **Reveal: a file.** `storagePath(".bootstrap/superadmin-password")`, which is `/app/.bootstrap/superadmin-password` in the image (created in the Dockerfile as `app:app` 0700, and not a volume in compose or Helm). The file is written `wx`, mode 0600, and chmod 0600. Stdout carries a one-line pointer with the path and the hostname. The seed response carries the path only. The file is deleted when the password is consumed, and a boot sweep deletes it when no unexpired one-time password exists.
4. **First sign-in.** A hook in `loginUser`, after every refusal check, hands a one-time account to `firstSignIn`. There, a conditional `UPDATE … WHERE password_one_time = true` sets it false and sets the expiry to **now**, in one transaction with the audit row (`ONE_TIME_PASSWORD_CONSUMED`). The loser of a concurrent sign-in gets the wrong-password 401. The answer is a `typ: "password-change"` purpose token (10 min, bound to the credential state by `pf`). It opens **no session**, and `verifyAccessToken` refuses it, so `auth` refuses it on every route. From then on the one-time password is an expired temporary password: A-215's path answers it with the same 401 as a wrong password, and the throttle counts it.
5. **`POST /api/v1/auth/first-sign-in/password`** (public; `{ token, newPassword }` checked by the existing password rule). The new password must differ from the one-time one, checked against the kept hash. A conditional update on the old hash sets the new password and clears all three flags; the same transaction revokes all sessions and writes the audit row. The answer is "sign in again". That sign-in follows P6-07: an operator without MFA must enrol.
6. **Retire the known default.** At boot, any live super admin whose hash matches `123123` is rotated to a fresh one-time password, with a file and an audit row. This covers the deployments seeded before this change.
7. **Recovery CLI.** `src/scripts/rotateBootstrapPassword.ts` is run on the host through `npm run bootstrap:rotate`, or in the container as `./backend rotate-bootstrap-password`, dispatched by `index.js` before the server starts. It is for super admins only, takes `--requested-by` and `--ticket`, runs in one transaction (rotate, revoke sessions, audit, file), and prints only the pointer.
8. **No environment override.** The owner forbids the value in an environment variable. The E2E harness completes the bootstrap itself from `E2E_BOOTSTRAP_PASSWORD`, which the operator reads with `docker exec … cat`, and it sets `E2E_OPERATOR_PASSWORD`. The specs no longer hard-code `123123`.

**Alternatives considered.**
| Option | Rejected because |
|---|---|
| Print the password in the startup log / seed response | `docker logs` and HTTP responses leave the container (owner decision); logs are retained and shipped |
| Reuse A-123 as-is (normal gated session) | the password keeps signing in until changed, which breaks "first login only", and the owner asked for no session |
| Burn the hash at first use (replace it with a random one) | loses the hash that "new ≠ one-time" needs; keeping the one-time value elsewhere is a second secret |
| Store the one-time value's hash in the purpose token | a JWT is readable by its holder; claims carry identifiers only |
| `SUPERADMIN_BOOTSTRAP_PASSWORD` env override for dev/E2E | the owner forbids the value in env; the harness can drive the real flow |
| Generate at every boot when no super admin exists | seeding is an explicit operator act today (ALLOW_SEEDING); a boot-time create would make a fresh database a live account without the operator asking |
| No TTL on an unused bootstrap password | an unused privileged credential sitting in a container file forever; 72 h matches A-215 |

**Consequences.**
- **Good.**
  - No deployment carries a public super-admin password, including existing ones (item 6).
  - Re-seeding no longer resets the operator.
  - The first-use token cannot reach any route but one.
  - A second use of the password is indistinguishable from a wrong password.
- **Bad, or still open.**
  - A lost file, or a password unused for 72 h, needs the CLI: `docker exec` rights are the recovery path.
  - If the change is abandoned after first use (the token lives 10 minutes), the account is locked until the CLI runs.
  - **Multi-replica (Helm):** the file lives in the pod that ran the seed or CLI, so run them with one replica or `kubectl exec` into the pod the pointer names. Helm is not known to deploy (see BACKLOG § Unverified Claims).
  - The concurrent loser's 401 is not counted by the login throttle (the winner consumed the password, so there is nothing left to guess).
  - Item 6 rotates a VM operator still on `123123` at the next deploy. The operator must read the file after that deploy (runbook updated).
  - ~~Administrator temporary passwords (A-123) keep their gated-session behaviour.~~ Superseded by Amendment 1.

### Amendment 1 (2026-09-30) — every administrator-set password is one-time (Q-49); demo seeding refused in production

**Authority:** working decision by the coordinating session, under the owner's delegation to choose best practice (Q-49, `TASKS/BACKLOG.md`). It awaits the owner's confirmation.

**Decision.**
1. **Every password an administrator sets for another user is one-time.** This covers `user.service#userCreate` (the administrator chose the password) and `#resetUserPassword` (a random 16-character temporary password, shown **once** in the administrator's response to hand over, never emailed). Both saves pass `{ oneTimePassword: true }`. Hash only, must-change, 72 h expiry (A-215, unchanged). The first sign-in consumes it exactly as the bootstrap's does: a `password-change` token, **no session**. A second use is the wrong-password 401. **This changes a Part 11 credential path:** before, an admin-created or admin-reset account's first sign-in opened a normal session, gated by `auth.middleware` to change-password/logout/verify (A-123). Now no session exists until the holder has chosen a password. The A-123 gate stays for accounts flagged before this change.
2. **How the flag is set (model).** `User` `beforeSave`: when the password changes, `passwordOneTime = options.oneTimePassword === true || (the save set the attribute to true)`, otherwise false. The attribute alone was not enough: an instance `update` drops a field whose value did not change, so re-resetting an account that is already one-time looked like an ordinary password change and cleared the flag. `oneTimePassword` is typed on `SaveOptions`/`CreateOptions`/`InstanceUpdateOptions` (`types/sequelize.d.ts`). Static `Users.update` runs no instance hook, so its writers set the attribute explicitly (bootstrapCredential.service does).
3. **Invitation preferred.** For a NEW account in a tenant whose mail delivery works, the invitation link (P10-15) is preferred over an admin-chosen password: no administrator ever knows the credential. The one-time temporary password stays for tenants without mail and for resets. Wiring userCreate to send an invitation instead is P10-15's (access-request lane), not done here.
4. **Demo seeding is development-only.** The demo users share the known password `Demo123!`, and "SEED_DEMO must never be true in production" was enforced only by `make preflight`. `migration.service#assertDemoSeedingPermitted` now refuses `seedDemoData` with 403 when `NODE_ENV=production`, before anything is written. That covers the route, the controller and `scripts/seedDemo.js`. No other hard-coded default password exists in a seeder: the load-test SQL `scripts/load/p807-seed.sql` copies the demo admin, so it is development-only as well.

**Alternatives considered.** Making demo users one-time: rejected, because `liveContract.smoke` signs in as them and a demo stack is disposable by definition, so refusing production is the stricter and simpler rule. Leaving A-123 as-is: rejected, because the owner's rule ("a password someone else chose signs in once") applies to an administrator exactly as to the bootstrap. Detecting "one-time" from the attribute alone: rejected (point 2).

**Consequences.**
- Good: no administrator-chosen password ever opens a session.
- Bad: an account whose holder abandons the change step (10 minutes) needs another admin reset. `liveContract.smoke` and anything using demo users need a non-production stack (`NODE_ENV=development`). Pending A-123 passwords set before this change are not converted; they expire within 72 h under A-215 (no backfill migration).
- Evidence: `backend/src/tests/services/adminTemporaryPassword.p1016.test.ts` (8), which fails before (3 failures with the two save options removed).

## ADR-100: The QR Carries a Verification Token and a Bare Number Gets a Minimal Verdict; a Tenant's Allowlist and Geofence Are Enforced at Every Sign-in but Never Bind the Operator; Tenant Administrators Set Their Own, Behind a Self-lockout Guard; Public Auth Endpoints Have Request Budgets That Count Successes; One SSO-start Refusal; Emailed Links From Configuration Only

**Date:** 2026-09-29 · **Cards:** A-293, A-288 (and Q-38), A-291, A-292, A-289, A-282 (remainder), A-304, A-305, A-272 · **Decided by** the security-followups agent under the owner's standing delegation (decide by best practice, record it), and the main session's working decision for A-293 · **Works with** ADR-094 (the A-280 operator routes, the A-282 principal), ADR-095 (M-11: the frontend renders the certificate PDF and its QR from the document's `verifyUrl`), ADR-093 (the validation 400), ADR-098 (Phase 10), A-83 (a refusal after the credential), A-185 (the sign-in throttle), A-16 (req.ip is the client) · **Record:** `MEMORY/records/2026-09-29-security-followups.md`

### Context
- **A-293.** Certificate numbers are sequential (`CERT-YYYYMMDD-<code>-NNNN`), and the public verification returned the device, its serial, the signer and the document, behind only the global limiter. A script could walk a tenant's customers, inventory and signatories.
- **A-288.** A tenant's IP allowlist and geofence could be set (A-280) but were enforced nowhere: `evaluateLoginSecurity` had no caller. **Q-38** asked who may set them.
- **A-291.** `authLimiter` and `otpLimiter` were declared in `index.js` and never mounted. The auth throttles count failures only, so successful registrations and OTP requests (each one sends a mail) were bounded only by the global limiter. Per-IP failure counting was off unless configured.
- **A-292.** The SSO start answered 404 for an unknown organisation code and 400 (in three wordings) for a known code without SSO. That is an oracle for the customer list and for each customer's configuration.
- **A-289.** The activation link was built from the request's `Origin`/`Host`. A forged header put an attacker's domain into a genuine mail.
- **A-272.** A validation failure thrown inside a controller reached the wire as `details: "[object Object]"`.
- **A-282, A-304, A-305.** Left open by ADR-094, or found since (Decision 9).

### Decision
1. **A-293: the verification token.** Every certificate has a `verification_token`: 24 random bytes, base64url (192 bits), NOT NULL, UNIQUE.
   - Migration 0096 back-fills every row, soft-deleted ones included, and swallows no error.
   - The model generates the token on every create: a default, plus create hooks that overwrite any value a caller passes. It is never accepted from a request body.
   - It is stored **in the clear, not hashed**. The frontend re-renders a certificate's PDF and QR from `GET /certificates/:id/document` at any time, so it must be able to print the same token. Anyone who can read the row already reads everything the token discloses.
   - **The link.** The QR and verify link is `CERT_VERIFY_BASE_URL/<number>?t=<token>`. The API fallback form is `…/api/v1/certificates/verify/<number>?token=<token>`.
   - **The right token.** `GET /certificates/verify/:number?token=` with the right token (compared in constant time) returns the **full** verdict, as before, plus `disclosure: "full"`.
   - **A bare number or a wrong token.** Both get the same answer, the **minimal** verdict. It contains:
     - found, valid, status, revoked, expired, withdrawn;
     - the number and type;
     - the issuing tenant;
     - the issue and valid-until dates;
     - the integrity hashes;
     - `disclosure: "minimal"`.

     It contains no device, serial, signer, document, document link or verify URL.
   - **Already-printed QR codes** carry no token, so they resolve to the minimal verdict.
     - **There is no redirect.** A redirect to the tokened URL would hand the token to anyone holding a number.
     - The integrity hashes stay in the minimal verdict. They are one-way over data that includes random UUIDs, and they are how the holder of an old printout detects tampering.
   - **Rate limits, per address.**
     - Every request counts against `certificateVerifyToken` (300 per 15 min).
     - Every answer that is not the full verdict (no token, a wrong token, an unknown number) also counts against `certificateVerify` (60 per 15 min). This is decided after the lookup, so appending a junk `?token=` buys an enumerator nothing.
     - This refines the working decision ("a request with a token counts against 300"). It was the sub-agent's call, accepted here.
   - *Rejected alternatives:*
     - Hashing the token: it could not be reprinted.
     - An HMAC of the id as the token: rotating the secret would break every printed QR.
     - A rate limit alone: it slows a walk but does not stop one.
     - Dropping the public fields for everyone: the person holding the scanned QR is who the full verdict exists for.
2. **A-288: the allowlist and geofence are enforced at sign-in** (`services/signInPolicy.service.ts#assertSignInPermitted`). They are checked at every point that issues a session: password (`loginUser`, through the shared `assertMaySignIn`), the MFA step, the SSO exchange, passkey verify-login, and token refresh.
   - **The allowlist is the network control.**
     - It is checked on every path, refresh included. A session that leaves the allowed network ends at its next refresh, and its refresh token is revoked (`NETWORK_POLICY`).
     - Matching is IPv4 and IPv6, through `net.BlockList`. An IPv4-mapped IPv6 address matches its IPv4 range; the old matcher refused every such address, and that is the form Node reports on a dual-stack socket.
     - The evaluation route now uses the same matcher.
   - **The geofence is an attestation, not a control.**
     - There is no server-side geolocation, so the location is the one the **device reports** in the sign-in body (`location: { latitude, longitude }`).
     - It keeps honest devices from signing in off-site. It does not stop an attacker, who can report any location. The allowlist is the control.
     - With a geofence configured, a sign-in that carries no location is refused (fail closed) with `code: "LOCATION_REQUIRED"`. The sign-in page then asks the browser for a position once and retries.
     - It is checked on password, MFA and passkey sign-ins.
     - It is **not** checked on SSO: a federated sign-in's device and location context belongs to the identity provider's conditional access.
     - It is not checked on refresh, which has no user present to attest a location.
   - **What a refusal says.**
     - A 403 with one fixed message, whichever check failed. It never names the list, the fence or a distance.
     - A top-level `code` (`NETWORK_POLICY` or `LOCATION_REQUIRED`) in every environment (`controllerWrapper#sendCaughtError`; only an UPPER_SNAKE token is sent).
     - It is answered only **after** the credential is proved (the A-83 rule), so it says nothing about whether an account exists.
     - It is answered before the throttle is cleared, before the MFA token, the session and any one-time (bootstrap) sign-in. A refused network cannot redeem a one-time password.
     - A wrong password from outside the network is still the plain 401.
   - **Audit.**
     - Every refusal writes one row in the tenant: action `LOGIN`, resourceType `SignInPolicy`, `changes: { outcome: "refused", reason, method }`, and the address.
     - The row is written in its own transaction, because the refusal is itself the event.
     - There is no new audit action value: that would need an `ALTER TYPE` migration and a D-26 change for one row type. The distinct resourceType keeps these rows out of any count of LOGIN rows on Session.
   - **The lock-out-safe path: a tenant's policy never refuses a platform operator.**
     - The operator's home is an ordinary hospital tenant (A-125), whose administrators may now set its allowlist. If the policy applied to the operator, a tenant could lock out the one account that recovers it.
     - The operator stays behind mandatory MFA (P6-07).
     - A sign-in the policy would have refused is recorded under PLATFORM (`outcome: "operator-exempt"`).
     - An impersonation refresh is the operator's act and is not checked either.
   - *Rejected alternatives:*
     - Refusing with the plain 401. It would hide a correct password from an outsider, but it sends a legitimate user to reset a password that is not wrong, and the refusal already comes after the credential, as A-83's does.
     - Step-up instead of refusal. No second factor is bound to a network.
     - Enforcing on operators, with an environment break-glass. Recovery would then need a restart by whoever holds the host, during the very incident the policy caused.
     - A GeoIP database. It is a new data dependency with its own licence and update cycle, and still an approximation. It is recorded as the way to make the geofence a real control.
3. **Q-38: tenant administrators MAY set their own tenant's allowlist and geofence.**
   - `PUT /network-security/ip-allowlist` and `/geofence` are gated by `network-security: write` and act on the caller's own tenant. The grant is seeded for HEALTHCARE ADMIN, and migration 0098 raises existing `read` grants.
   - **The self-lockout guard** (`assertChangeKeepsCaller`) answers **409 `SELF_LOCKOUT`**, explaining what to add, in two cases:
     - an allowlist that does not contain the address the change is made from;
     - a geofence without the caller's `currentLocation` inside it.

     An empty allowlist cannot lock anyone out.
   - The guard does not bind the operator, who acts on any tenant through the A-280 `/tenants/:tenantId/…` routes. That is the override.
   - Every write is still audited under PLATFORM and under the tenant (A-280).
   - *For operator-only:* a wrong CIDR locks a tenant out. *Against:* the hospital knows its own networks and changes them, and routing every change through the operator delays hardening. The guard removes the lock-out case that the operator-only rule existed for.
4. **A-291: request budgets** (`middlewares/requestBudget.middleware.ts`).
   - Every request is counted, successes included, in the shared store. On a Redis fault the store falls back to memory; it never skips the count.
   - Keys are the client address, plus an optional key derived from the request.
   - Production figures:

     | Endpoint | Budget |
     |---|---|
     | Sign-in | 300 per 15 min |
     | MFA sign-in | 60 per 15 min |
     | Register | 10 per hour |
     | Send-OTP and reset | 20 per hour |
     | Send-OTP, per mailed-to address | 3 per 15 min |
     | SAML and OIDC start (shared) | 60 per 15 min |

     - Sign-in is generous because a hospital signs in from one NAT address. The per-account defences remain A-185 and A-81.
     - The mailed-to address is hashed and counted whether or not an account has it, so the 429 is not an oracle.
   - Outside production the figures are multiplied by `RATE_LIMIT_NON_PRODUCTION_FACTOR` (default 100), just as the global limiter is raised there.
   - **The 429** is the error envelope plus `retryAfter` and a `Retry-After` header. `authPreCheck`'s lockout 429s now send the header too.
   - `authLimiter` and `otpLimiter` are deleted: they were per-process and never mounted.
   - **Per-IP failure counting is ON by default in production.** With `AUTH_RATE_LIMIT_BY_IP` unset it is on in production; `"false"` turns it off. Since A-16 the edge-resolved address is req.ip, and the reference VM has run with the setting on since A-67.
5. **A-292: one SSO-start refusal.**
   - An unknown code, SSO disabled, no SAML entry point and no OIDC client all get the same answer: **404 "Single sign-on is not available for this organisation code"**. The real reason is logged.
   - The refusal is exported as `ssoUnavailable`, for the Phase 10 `POST /auth/sso/start`.
   - *Why 404, not 400:* "there is no SSO for this code" is a not-found. A 400 would suggest the request itself was malformed.
   - Residuals, recorded and not fixed: a timing difference (one query against two), and a misconfigured OIDC authority that fails later than the check.
6. **A-289: emailed links come from configuration only** (`utils/publicLinkOrigin.util.ts#emailLinkOrigin`).
   - The origin is `FRONTEND_URL`, else `HOST_URL`: the order every other emailed link already uses (A-171), since `/activation` is a front-end page. It is never a request header.
   - In production an unset origin is a **500, raised before the account is created or anything is mailed**. Outside production the fallback is the dev server.
7. **A-272: a validation failure thrown in a controller now answers exactly as `validate()` does.** That is a 400, "Validation Error", with `details: [{ field, message }]` outside production. The contract suite compares the two layers' wires byte for byte.
8. **Frontend.**
   - The verify page reads `t`. For the minimal verdict it adds a line saying full details appear when the QR code is scanned.
   - The PDF's QR prints the document's tokened `verifyUrl` unchanged.
   - The sign-in page's `LOCATION_REQUIRED` retry was built by the Phase 10 frontend lead, in its rewrite of `useLoginForm`.
9. **A-282, A-304, A-305.**
   - **A-282 — every audited write an API key can reach names the key as `system:api-key`** (`changes.apiKeyId`), never as a user (the key id in `audit_logs.user_id` fails its FK and rolls the write back on PostgreSQL). The key-reachable routes are those where a middleware sets `req.apiKeyAuthorized` (a `dynamicAccess` scope, `allowApiKey`, the SCIM gate); every other key is refused by `controllerWrapper#apiKeyBlocked`. Converted: workflow, maintenance, calibration devices, records and scheduler (a manual run by a key is the key), billing, predictive maintenance, stock, tenant (actor, settings, logos), attachments (a key's upload stores `uploaded_by` NULL), CMS media, and the network-security writes. `auditPrincipal` passes a job's `{ systemActor }` through (key, then user, then system actor) and normalises the user agent to one string. **Guard:** `guards/apiKeyAuditPrincipal.a282.guard.test.ts` maps every key-reachable handler to its controller export and fails on `auditActor(` or `userId: req.user.id` there; a reviewed PENDING_OWNER list fails when an entry is fixed, so it cannot go stale (it held certificate create/update/delete/submit until ADR-101's owner converted them, 2026-09-30). The network-security PUTs also refuse a key outright (`denyApiKey`): a leaked key must not widen or lock a tenant's sign-in. *Limit:* the guard reads the controller layer; a service that audits a caller id under another name is caught by review only.
   - **A-304 — `GET /dashboard/metrics` is gated by `dynamicAccess(home, read)`.** It is the home page's load call; every seeded role holds `home: read`, while `dashboard: read` is missing for FACILITY MAINTENANCE and WAREHOUSE STAFF (why it had been exempted). The exemption is removed from `constants/routeGateExemptions.ts`; the tenant comes from the principal, a `?tenantId` is ignored.
   - **A-305 — `offboardTenant` writes A-165's two rows** (PLATFORM and the tenant, one transaction), for the operator and for the scheduler — the PLATFORM row is what outlives an offboarded tenant. **The Stripe plan change** runs in a transaction on the locked tenant row and writes two rows as `system:billing-webhook` (`BILLING_PLAN_CHANGE`, the Stripe event id, the plan before and after); an unchanged or unknown plan, or a missing tenant, writes nothing.
   - *Rejected:* a central rewrite in `audit.service` of any `userId` equal to the request's key id (hides the defect at every call site instead of fixing it, and needs the request in the audit layer).

### Alternatives considered
Each decision above carries its own.

### Consequences
- **Good.**
  - A certificate number no longer discloses equipment, serials or signatories.
  - A tenant's network policy takes effect, including against a stolen refresh token used from elsewhere.
  - Hospital administrators can harden their own tenant without a support ticket, and without locking themselves out.
  - Registration and OTP mail are bounded per caller and per mailbox.
  - The SSO start no longer lists customers.
  - Activation mail cannot be poisoned.
  - A controller's validation 400 has the same shape as the middleware's.
- **Bad, or still open.**
  - The geofence stays an attestation, not a control, until a server-side location source (GeoIP) exists. A client can report any location.
  - Old printed QR codes show only the minimal verdict. Their holders have the printed fields on paper, the verdict and the hash, but do not see the signer on screen.
  - No network policy binds the operator. A platform-level allowlist for operators is not built.
  - ~~The allowlist validator accepts IPv4 only~~ — closed by Amendment 1 §3.
  - ~~The geofence form sends no `currentLocation`~~ — closed by Amendment 1 §4.
  - ~~Migrations 0096 and 0098 not run on PostgreSQL~~ — run and verified by Amendment 1 §2.
  - ~~The SSO-start refusal differs in timing~~ — a latency floor, Amendment 1 §5; a slow or broken IdP discovery is still slower than the floor.
  - ~~An API key cannot perform writes whose data columns reference users (**Q-51**)~~ — decided and closed by Amendment 1 §1 (migration 0105; person-only decisions refuse a key).
  - The certificate create/update/delete/submit audit rows were converted by ADR-101's owner on 2026-09-30; the guard's PENDING_OWNER list is empty.


### Amendment 1 (2026-09-30) — Closing the open items. Working decisions by the coordinator, under the owner's delegation

**Record:** `MEMORY/records/2026-09-29-security-followups.md` § Amendment 1.

1. **Q-51: an API key is a row's actor, not a user (migration 0105).**
   - **The change.**
     - `calibration_records.performed_by`, `stock_adjustments.adjusted_by` and `stock_transfers.requested_by` become nullable.
     - Each of those tables gains a nullable `api_key_id` UUID, a foreign key to `api_keys(id)`, `ON UPDATE CASCADE ON DELETE RESTRICT`, with an index.
     - A CHECK that exactly one actor is set: `num_nonnulls(<user column>, api_key_id) = 1`. The constraints are `calibration_records_actor_exactly_one`, `stock_adjustments_actor_exactly_one` and `stock_transfers_requester_exactly_one`.
   - **How the migration applies it.**
     - The CHECK is added `NOT VALID`.
     - Before validating, the migration counts violating rows and **throws, naming the count** if there are any. It does not guess an actor.
     - It then runs `VALIDATE CONSTRAINT` in its own transaction, which takes SHARE UPDATE EXCLUSIVE, so reads and writes continue.
     - `down` refuses while any key-authored row exists, and otherwise reverts in one transaction.
   - **Where the actor comes from.** `utils/auditPrincipal.util.ts#rowActor(auditPrincipal(req))`. It is never taken from the body: Zod strips the field, and the services set it after any spread. A correction keeps its original's actor. `api_key_id` on a calibration record is content: the append-only trigger and the application role's UPDATE grant leave it immutable (the app role gets 42501).
   - *Why RESTRICT, not SET NULL.* SET NULL would leave a row with no actor, which the CHECK refuses. Keys are revoked by soft delete, so RESTRICT blocks nothing in normal use. It also keeps "which key did this" answerable for the life of the row.
   - **Tenant safety.** A key belongs to one tenant, and auth stamps the row's tenant from the key. This is enforced by the application, not by a composite foreign key — the same as the user columns (recorded as open).
   - **Decisions that are a person's refuse a key with `denyApiKey`** (403, nothing written):
     - a transfer's approval, completion or cancellation (`PATCH /stock/transfer/:id` — `approved_by` stays user-only, separation of duties);
     - a stock opname (`POST /stock/opname` — `stock_opnames.performed_by`, the same defect, outside Q-51's list);
     - a calibration record's void (`POST /calibration-records/:id/void` — `voided_by`; a void is final);
     - **a workflow decision** (`POST /workflows/instances/:instanceId/action`). A key scoped `warehouse:write` reached it, and approving a StockTransfer wrote the key id into `approved_by`. Found while closing Q-51.
   - Audit rows are unchanged (`system:api-key`).
   - *Rejected alternatives:*
     - Refusing keys on every write that names a user: an integration that records calibrations or stock movements is the point of a key.
     - A body-named human performer: an unauthenticated claim.
     - Two key columns on `stock_transfers`: the approver is a person.
2. **Migrations verified on a disposable PostgreSQL 18** (pgvector/pgvector:pg18). Migrations 0096, 0098 and 0105 were run on a **fresh** database (77 applied through 0105) and on an **upgraded** one (migrated to 0095, then seeded with five token-less certificates — one soft-deleted — and HEALTHCARE ADMIN `read`).
   - **Results.**
     - `verification_token` is NOT NULL, with `certificates_verification_token_unique`. There are 0 nulls, 5 distinct tokens, each 32 characters long, and the soft-deleted row is filled.
     - HEALTHCARE ADMIN has `network-security: write`.
     - The 0105 columns are nullable. The foreign keys have `confdeltype = 'r'`, and all three CHECKs have `convalidated = true`.
   - **As `callibrator_app`:**
     - it can read the new columns;
     - it can insert a key-authored adjustment, transfer and record;
     - an insert with neither actor, or with both, fails with 23514;
     - before 0105, an insert with the key id in a user column failed with 23503 (the fail-before).
   - **Down then up** cycles cleanly for all three migrations.
   - **Consequence recorded: 0096's `down` then `up` regenerates every token, so every printed QR code stops resolving to the full verdict.** Never run 0096's down on a database whose certificates have been printed.
3. **The allowlist validator accepts IPv6** (`validators/networkSecurity.validator.ts#normaliseAllowlistEntry`).
   - It accepts an IPv4 or IPv6 address or CIDR, with the prefix range-checked. Entries are trimmed and IPv6 is lower-cased.
   - An IPv4-mapped entry (`::ffff:a.b.c.d[/n≥96]`) is stored as its IPv4 form, the way the sign-in matcher and `ssrf.util` treat a mapped address.
   - One message on refusal: "Expected an IPv4 or IPv6 address or CIDR".
   - The old pattern also let `999.1.1.1` and `/33` through.
4. **The network-security page.**
   - **A geofence save sends this device's `currentLocation`.** The browser asks for consent (10-second timeout).
     - When no position is available, the page says why it matters.
     - It still sends the save: an operator is exempt, and a tenant administrator sees the server's 409 explanation.
   - **The page follows ADR-102.**
     - The allowlist add/remove/remove-all controls and the geofence form are rendered only with `usePermissions().canWrite("network-security")`. They are absent from the DOM otherwise, and before the permissions load. The super admin passes, and the F-19 confirmations are kept.
     - A reader sees the list and the geofence as text.
     - The page's first client-side CIDR check accepts IPv6. The server validates.
5. **The SSO-start refusal has a latency floor** (`sso.controller.js#withSsoRefusalFloor`).
   - Every SSO_UNAVAILABLE refusal from `/sso/login`, `/sso/oidc/login` and Phase 10's `startSsoFor` is held to at least `SSO_REFUSAL_FLOOR_MS` (default 400 ms) after the request arrived. That is longer than either refusal path's own work, so an unknown code and a known code without SSO cannot be told apart by latency.
   - Successes and other errors are not delayed: a successful start is already distinguishable by its answer.
   - *For comparable work instead* (a settings read for a missing tenant): it narrows the gap without closing it, and it breaks again whenever either path changes. The floor holds whatever the paths do.
   - *Residual:* a refusal whose own work exceeds the floor — an enabled tenant whose IdP discovery document is slow or down — is still slower. That tells the caller only that a code has SSO **configured**, and it is reachable only by a code that has it.

**Still open after this amendment.**
- Row-to-key tenant equality is enforced by the application only.
- ~~Adjustment, transfer and record lists show no actor for a key-authored row~~ — closed by Amendment 2.
- The geofence remains an attestation until a GeoIP source exists.


### Amendment 2 (2026-09-30) — Lists name the key that wrote a row

- **Backend.** The calibration-record list and detail reads (`calibrationRecords.service.js`) and the stock adjustment and transfer lists (`stock.service.ts#fetchAdjustments`, `#fetchTransfers`) include `apiKey` as `ApiKey.scope("includeDeleted")`, `as: "apiKey"`, with `attributes: ["id", "name", "keyPrefix"]` and `required: false`.
  - **Never `keyHash`.**
  - It is a LEFT JOIN, because ApiKey's defaultScope carries a `where` and a bare include would drop every user-written row.
  - It is scoped to the tenant by the hooks (ADR-048), so another tenant's key reads as `null`.
  - `includeDeleted` makes a revoked (soft-deleted) key still name the rows it wrote.
  - Stock adjustments and transfers have no separate detail read.
  - The swagger schemas document `apiKey`.
- **Frontend.** `src/lib/actorLabel.ts` returns the user's name, else "API key: <name>", else `-`. It is used where the user actor showed before: the stock adjustments table, the transfers table (requester), the calibration records table (Performed By), and the stock CSV exports. The types carry `apiKey`.
- *Rejected:* showing the key prefix. The name is what an administrator chose to recognise the key by, and the prefix is only needed on the API-keys page.


### Amendment 3 (2026-09-30) — A model never indexes a column that a later migration adds (a deploy blocker, fixed and guarded)

**Found by** the live PG18 agent. **Evidence:** a sub-agent's run, cited in the record § Amendment 3.

- **The defect.** Boot runs `db.sync()` BEFORE the migrator. On an existing database, `sync()` skips CREATE TABLE but still builds every model index the table lacks. Amendment 1's three models declared `indexes: [{ fields: ["api_key_id"] }]` on a column that only migration 0105 adds. So upgrading a database built by the previous release (ce74932) failed with `column "api_key_id" does not exist — CREATE INDEX calibration_records_api_key_id`, and 0105 never ran. Fresh databases hid the defect, because `sync()` creates the column there.
- **The fix.** The three model index declarations are removed. The indexes belong to 0105 alone, which creates identical ones (`<table>_api_key_id`). Schema-verify compares named expected objects, not model indexes, so it needs no change. The 0105 test now asserts that no model declares an index on `api_key_id`.
- **The rule.** A model may not declare an index, or a unique constraint, on a column that a migration adds. That index is the migration's. The only exceptions are columns that every supported upgrade base already has. Today the supported base is ce74932, last migration 0090.
- **Guards:**
  - **Static guard, in the unit gate:** `tests/guards/modelIndexColumns.am3.guard.test.ts`.
    - It evaluates every migration (.js and .ts) for added columns per table, then compares every model's `indexes` and unique attributes against them.
    - A reviewed ALLOW list, keyed `table.column` with a written reason, fails if an entry goes stale. Its only entry is `invoices.stripe_invoice_id`: a unique attribute that `sync()` emits only inside CREATE TABLE, whose column migration 0002 adds before the base.
    - It fails on a re-added `api_key_id` index.
  - **Live upgrade-boot test:** `tests/migrations/upgradeBoot.am3.live.test.ts`, run with `AM3_UPGRADE_LIVE_TEST=1`.
    - It extracts the base release's backend with `git archive` (no checkout) and builds the scratch database with THAT tree's own boot schema step.
    - It writes the rows that release would hold, then runs the CURRENT tree's schema step with no manual migrate.
    - It asserts that the migrations after the base apply, schema-verify passes, the 0105 and 0096 objects exist, the rows survive, and a second boot applies nothing.
    - This holds the whole class of defect, not only the index shape.
    - Building the ce74932 base needs `AM3_BASE_NODE_MODULES` with `joi`, which that release still used.
- **Sweep.** No other index-on-a-later-column case exists in 0091–0106.
- *Rejected:*
  - Moving `db.sync()` after the migrator: migrations assume the tables `sync()` creates on a fresh database (ADR-087's boot order), so that is a boot-order change with its own risks.
  - `sync({ alter: true })`: it rewrites columns on production data.
- **Open.** CI does not run the live upgrade test (see the record for how it could). The CLAUDE.md "Traps" row is the coordinator's, at close.


### Amendment 4 (2026-10-01) — A-331: no response carries a credential (the route, the model, the boundary)

**Found by** the P9-22 helper while converting roles. **Severity:** high.

- **The defect.** `POST /roles/assign` answered the return value of `roles.service#assignRoleToUser`, which was `User.findByPk(userId)` after the update. That is the whole row serialised: the bcrypt password hash, the MFA seed envelopes, the recovery-code hashes, the OTP hash and counters, and the WebAuthn credential columns. The route is `rbac(["SUPERADMIN"])`, so only an operator saw it — but it put every credential of the target account in a response body, in logs and in any proxy that records bodies.
- **1. The route.** The service returns a named projection (`assignedUserView`): id, username, email, firstName, lastName, tenantId, roleId, status, isActive. The P9-22 helper's converted controller (`roles.controller.ts`) sends only that, and its OpenAPI block documents those nine fields.
- **2. The model: defence in depth.** `models/secretAttributes.ts` lists, per model, the attributes that `toJSON()` drops. It is installed once, in the models barrel, after the associations are set up:
  - **User:** password, the MFA seed envelopes and pending state, the last used step, the recovery codes, the OTP code and its counters, and the WebAuthn credential id, public key and sign count;
  - **ApiKey:** keyHash;
  - **Session:** token_hash;
  - **Webhook:** secret, previousSecret;
  - **TenantKey:** privateKey;
  - **AccessRequest:** invitationTokenHash, sourceIpHash;
  - **CalibrationDevice:** iotTokenHash (it already had its own override, which is kept).

  So `JSON.stringify(row)` — what Express does — can never carry these, whatever a future handler forgets. The instance still reads them (`user.password`, `row.get("keyHash")`), so sign-in and verification are unchanged. A secret a caller must see ONCE (a new webhook secret, a new API key) is returned by its service as a field it names itself, never through the row. An unknown model name in the list fails at load.
  - *Considered:* a defaultScope `attributes.exclude`. It would break every read that needs the value (sign-in reads the hash) unless each one used `.unscoped()`, and `.unscoped()` also drops the soft-delete predicate. The toJSON layer protects the output without touching the reads.
  - *Not done:* OIDC client secrets and storage/KMS credentials are not model rows. They live in TenantSettings (envelopes, masked by `tenant.service`) and Redis, so the boundary scan below covers them.
- **3. S-20: the boundary.** `tests/support/secretScan.ts` finds a credential KEY (the list above, its snake_case columns, and generic names such as `passwordHash`, `clientSecretHash`, `secretAccessKey`) or a password-hash-shaped VALUE (bcrypt, argon2) anywhere in a body.
  - It scans every response the route suites get through `fixtures/routeClient.ts#call` (a finding rejects the call), and every body a real Express `res.json` serialises in a test (`tests/setup/secretScan.setup.ts`, registered in `jest.config.js` `setupFilesAfterEnv`; the finding fails the test in `afterEach`, not inside `res.json`, where the error handler would hide it as a 500).
  - The one reviewed exception is a webhook's one-time secret on its create, update and rotate routes.
  - The first full run with the scanner on found **no leak** besides A-331 itself. The only finding was that allowed webhook rotation, mounted at a test base path, which widened the exception's pattern.
- **4. Unprojected reads.** About 60 `findByPk`/`findOne`/`findAll` calls on these models have no `attributes` list. Reviewed: each one either stays inside its service (sign-in, verification, bootstrap, GDPR internals) or is returned through a projection (`apiKey.service#publicKey`, `webhook.service#publicWebhook`, the auth `signInResponse`). The ones that reach a handler (`auth.service#getAuthUserWithTenant` → `req.user`, which `/auth/verify` and the profile routes read; `webhook.service#loadOwned`; `apiKey.service#loadOwned`) are now covered by the toJSON layer and the scan in any case. The list is in the record.
- **Open.**
  - The scan covers the route suites that drive a router (routeClient) or a real Express app. It does not cover controller unit tests with hand-made `res` doubles, which also mock their services.
  - A response built by hand with a credential under a name outside the list is caught only if the value is hash-shaped.

---

## ADR-101: A Certificate's Author May Not Approve It (Separation of Duties), Refused With a 403 Inside the Tenant

**Date:** 2026-09-29 · **Task:** UI-correctness fixes (audit docs/UI-UX/research/01 §4.2, 03 F2 and §4.1 step 7) · **Authority:** owner delegated the decision to best practice (2026-09-29) · **Record:** [`records/2026-09-29-ui-correctness-fixes.md`](records/2026-09-29-ui-correctness-fixes.md)

**Context.** The certificate state machine is draft → pending_approval (submit) → approved (approve, re-authenticated) → signed → revoked (`certificate.service.js` `TRANSITION_REFUSALS`). Nothing stopped the user who drafted or submitted a certificate from approving it — `approveCertificate` checked the state and the credential, never the person. ISO/IEC 17025 §7.8.1.2 (results reviewed and authorised before release) and 21 CFR Part 11 §11.10(g) (authority checks) read the approval as an independent review; a self-approval is none. The certificate stored its author (`created_by`) but not its submitter.

**Decision.**
1. **The author may not approve.** A user who drafted the certificate (`createdBy`) or submitted it (`submittedBy`) is refused approval — on `POST /certificates/:id/approve` and at **every** approving step of the certificate's approval workflow (`workflow.service#takeAction` → `certificate.service#refuseSelfApprovalInWorkflow`), not only the final one. Another user holding `certificate` write approves the same row unchanged.
2. **403, not 409.** CLAUDE.md: 409 is an invalid state transition; 403 is a permission failure inside the caller's own tenant. The certificate's state allows approval (another user succeeds on it as it is); what is refused is this caller's authority over this record. The message names the rule ("…you drafted or submitted this certificate… separation of duties…"), so it is not read as a missing grant. The state rule still comes first: the author approving a **draft** gets the 409 "submit it first".
3. **Checked before re-authentication and before anything is written.** The guard runs under the row lock, before `verifySignatureAuth`: a refusal consumes no one-time MFA code and writes no certificate change, signature record or APPROVE audit row (asserted).
4. **`certificates.submitted_by`** (migration **0095**, TypeScript; uuid, nullable, FK users ON DELETE RESTRICT, index `certificates_submitted_by` for D-20). `submitCertificateForApproval` stamps it with the caller in the same save as the status; the SUBMIT_FOR_APPROVAL audit row carries it in `after`. The migration back-fills certificates past `draft` from their latest SUBMIT_FOR_APPROVAL audit row, within the certificate's own tenant; one with no such row keeps NULL and the guard falls back to `createdBy`.
5. **UI.** The certificates table follows the state machine exactly: Submit for approval on a draft (Approve is no longer offered there — it 409'd), Approve on pending_approval, E-Sign on approved, Revoke on any state but revoked. For its author, Approve is disabled with the reason next to it (`aria-describedby`). A refusal (409 or 403) is shown inside the approval dialog as the backend states it.

**Alternatives considered.**
| Option | Rejected because |
|---|---|
| 409 for self-approval | 409 means the record's state forbids the transition; here the state allows it and a different user succeeds — it is the person, not the state |
| Only the creator (no `submitted_by`) | the submitter is the one who asserts the draft is ready; a resubmission by someone else would slip through |
| Derive the submitter from `audit_logs` at approve time | a query into an append-only log on every approval, and the rule would silently weaken if the audit row shape changed; a column is explicit and indexed |
| A tenant setting to allow self-approval (small labs) | a compliance control that can be switched off per tenant needs an owner decision; left as an Open Question if a single-person lab asks |
| Enforce in the UI only | the API would still accept it; the UI is not a control |

**Consequences.**
- **Good.** Approval is an independent review in every path (direct and workflow); the attribution (drafted / submitted / approved) is on the record; the UI can no longer offer an action the backend refuses.
- **Bad, or still open.** A tenant with a single user holding `certificate` write can no longer approve its own certificates — it needs a second approver. Certificates created before 0095 with no SUBMIT_FOR_APPROVAL audit row fall back to `createdBy` only. The seeded defaults give `certificate` write only to the level-8 admins (03 F4), so a tenant needs two admins to issue a certificate.

---


## ADR-102: The Sidebar and Every Page's Write Actions Derive From the One Effective Permission the API Checks

**Date:** 2026-09-29 · **Task:** UI-correctness fixes (audit docs/UI-UX/research/01 §2.2 S6/S7, §3.1, §3.3, §5.4; 03 F1, F3, F5–F9) · **Authority:** owner delegated the decisions to best practice (2026-09-29) · **Record:** [`records/2026-09-29-ui-correctness-fixes.md`](records/2026-09-29-ui-correctness-fixes.md)

**Context.** Three rules decided access and they disagreed:
- the API (`dynamicAccess` → `roles.service#getRolePermissionsMatrix`) grants a menu and its **direct children**, and a per-user override (`user_menu_permissions`, A-35) replaces the role's grant;
- the sidebar (`menuGroup.service#getRoleMenuAssignments`) showed a node when it **or any ancestor** was granted and ignored per-user overrides — a `management` grant showed ~30 Management pages the API refused;
- six page hooks decided their write buttons from **hard-coded role names** (`hasWriteAccess = role.name === "SUPERADMIN" || … "WAREHOUSE STAFF"`) — CALIBRATOR ADMIN (server: `equipment` write) saw none, WAREHOUSE STAFF (server: `equipment` read) saw buttons that 403'd.
Several pages are served by a gate other than their own grant (rbac levels, another slug), and two routes (`/dashboard/stock`, `/dashboard/storage`) had no menu entry.

**Decision.**
1. **One function.** `services/effectivePermission.service.ts` (new, TypeScript): the role matrix (unchanged rule: grant + direct children), replaced per key by the user's override (`none` revokes), `write` implies `read`, any verb but `read` needs `write`, the super admin passes. `dynamicAccess#checkMenuPermission` now reads it (no behaviour change: the existing dynamicAccess, Q-20 and A-07 suites pass unchanged). The sidebar and the pages read the same function.
2. **The sidebar shows what the API serves.** A leaf is shown when the effective permission grants `read` on its slug **and** every gate its page's load call is behind passes — `constants/menuPageAccess.ts` `MENU_PAGE_GATES` quotes each such gate from its route file (rbac SUPERADMIN / TENANT_ADMIN level, another slug, the ticket service's "not the super admin"), and `effectivePermission.adr102.test.ts` fails when a quoted gate leaves its route file. `rbacAllows` mirrors `rbac()` and is tested against it for every seeded role. A group is shown when a leaf below it is. The requester's own menu includes their overrides; a super admin previewing another role gets that role's.
3. **`GET /api/v1/menu-groups/my-permissions`** → `{ superAdmin, permissions: { slug: "read" | "write" } }`, loaded with the menu (`menuStore.effectivePermissions`). Pages use `usePermissions().canWrite(<slug their write API is gated on>)`: devices `calibration`, calibration records `calibration`, certificates `certificate`, stock and warehouse `warehouse`, maintenance `maintenance`, vendors `vendors`, billing `billing`. Until it loads — or if it fails — nothing is writable (fewer buttons, never one that 403s). Home's quick actions and user list follow it too (Add User on `users` write; New Tenant and Roles for the super admin; the `/users/all` call only with `users` read).
4. **Grants that keep pages reachable** (seed `ROLE_MENU_ASSIGNMENTS`; migration **0097** for seeded databases): `stock` to every role holding `warehouse`, same type; `storage` write to role level ≥ 8; `tenants`, `tenant-hierarchy`, `kanban`, `api-keys`, `webhooks`, `attachments` to the non-super-admin roles holding `management`, each only when that page's API gate already passes for the role. None of these slugs is a `dynamicAccess` gate anywhere (tested), so **no grant widens API access** — they only let the menu show pages the API already served.
5. **New menu entries:** Stock (top level, after Warehouse, icon Package) and Object Storage (Management › Content, icon HardDrive). **Home** maps to `/dashboard`, shown once beside Dashboard. `/dashboard/warehouse` redirects to `/dashboard/warehouses` (temporary; `src/lib/redirects.ts`).
6. **"Crossed" slugs are not renamed.** Slug `calibration` shows `/dashboard/devices` and gates the device API; `certificate` shows `/dashboard/calibration` and gates the certificate API — each slug shows the page its API guards, so grant and page agree; only labels differ (a redesign concern). The Calibration Scheduler, whose page loads from a `maintenance`-gated route, is the one real mismatch, fixed as a page gate, not by a slug migration that would move every grant and override.

**Alternatives considered.**
| Option | Rejected because |
|---|---|
| Make the API cascade like the sidebar did | widens access for every role at once (Q-20 found the one-level rule deliberate) |
| Keep the cascade and hide refused items client-side per page | two sources again; the next page added drifts |
| Put permissions in the JWT | stale until re-login; overrides and grant changes would not apply |
| Rename `calibration`/`certificate` slugs to match labels | moves every role grant, override and API-key scope; changes nothing a user can do |
| Keep hard-coded role lists, corrected | the same defect on the next grant change; `docs/FRONTEND/05-RBAC-IN-UI.md` forbids it |

**Consequences.**
- **Good.** No seeded role sees a sidebar entry whose page 403s (menuEffectiveAccess.adr102, per role, on the real seed and the real dynamicAccess); a per-user grant or revocation reaches the menu; write buttons match the API for every role; the Stock module and storage settings are reachable.
- **Bad, or still open.** HEALTHCARE / CALIBRATOR ADMIN and ENGINEERING MANAGER lose menu entries that only 403'd (Roles, Menu Groups, Blog & News, …) — correct, but visible. The page-gate table is maintained by hand (the test catches a changed gate, not a new page with a new gate). Pages not in this change still hide nothing for read-only roles (audit §5.4 lists ~24); they should adopt `usePermissions` as they are touched. The permissions cache (1 h) still delays a grant change; flush `permissions:*` after migration 0097.

---


## ADR-103 — The API contract is generated code-first from Zod; Scalar behind sign-in replaces Swagger UI (reserved 2026-09-29, P9-25; full text at the end of this file)

## ADR-105 — Role Display Name, Level and Active are accepted by the API, not removed from the dialog (reserved 2026-09-30, F-19 fixes; full text follows)

## ADR-098: The Public Surfaces Are Rebuilt Dark and Cinematic, Indonesian First, With No Unverified Proof; Request Access Replaces Self-Registration; Sign-in Becomes Identifier-First; a Passkey Button Waits for a Pre-Authentication Ceremony

**Date:** 2026-09-29 · **Status:** Accepted for Phase 10 (§1–§7, §9–§10 on the owner's brief); §8 are working decisions **awaiting the owner's confirmation** · **Phase:** 10 · **Record:** `MEMORY/records/2026-09-29-P10-00-phase-10-11-planning.md`

**Context.** The owner answered a brainstorm on the landing, sign-in, register and public verification pages (`docs/UI-UX/research/00-owner-brief-landing-auth.md`, binding). Two research files read the market and the code: `research/04-competitor-landing-and-auth.md` and `research/05-landing-auth-audit.md`. They found the live landing built on fabricated proof (fictional testimonials with randomuser.me faces, invented hospitals, unsourced numbers, HIPAA/SOC 2/SNARS badge chips), a register page that promises a workspace and creates a tenant-less user (ADR-075), a sign-in that asks users for a SAML/OIDC choice, no forgot-password page, no `autocomplete` (WCAG 2.1 SC 1.3.5), and ~305 KiB gzip of animation JavaScript on the landing. Several `docs/` documents disagree with the owner's brief; this ADR is the deviation record for all of them. The design spec is `docs/UI-UX/20-LANDING-AUTH-REVAMP.md`; the board is `TASKS/PHASE-10-LANDING-AUTH-REVAMP.md`.

### Decision

1. **`docs/UI-UX/19-IMMERSIVE-REVAMP-PLAN.md` Part I (landing, login, register) is superseded** by doc 20: no WebGL 3D hero, no Lenis, no GSAP/SplitText, no Motion on public pages, no testimonials, no pricing, no badge chips, no marquee. Part II (blog and news) stays; blog and news take the new public header and footer.
2. **`14-PUBLIC-SURFACES-UX.md` is amended:** the landing's sections become hero · problem · features and workflow story · compliance and security ("supports", never a badge) · certificate verification · how we work · FAQ · contact; the "Trust: the standards" and "Pricing" rows go. Auth screens become a cinematic split-screen with a light motion budget instead of "deliberately plain". The verification page's rules are unchanged, and it is **not indexed** (it was not: `robots.ts` and the page's metadata did not cover it).
3. **A dark-only public palette, one accent, a serif display.** Public surfaces (landing, `/login`, `/request-access`, `/forgot-password`, `/invitation`, `/activation`, `/verify/*`) use a separate `--pub-*` token set under `data-surface="public"`: near-black neutrals and the brand teal `#00DAB4` as the only accent, with the contrast ratios computed in doc 20 §4.2 and re-checked by a unit test. Display **Instrument Serif**, body **Plus Jakarta Sans** (both SIL OFL 1.1, `next/font/local` from committed files), data **JetBrains Mono**. The dashboard's ADR-090 tokens and fonts do not change. The tenant colour is **not** applied on public surfaces (logo and name only).
4. **Indonesian by default, English by a toggle, on public surfaces only.** Typed dictionary modules (`id.ts` the source, `en.ts` typed against it), a `locale` cookie read by the root layout (which sets `<html lang>`), a Server Action behind a `<form>` for the toggle — no library, no inline script, works without JavaScript. `00-DESIGN-DIRECTION.md` § Language is amended for public surfaces; the dashboard stays English until Phase 11 decides.
5. **The passkey button appears only when a pre-authentication ceremony exists.** Every WebAuthn route sits behind `router.use(auth)` (`webauthn.route.js:13`), so passkeys are a step-up today. P10-10 adds public `POST /auth/passkey/options` and `/verify` (no `allowCredentials` before authentication, a ceremony-bound challenge, one reviewed `skipTenantScope` for the credential lookup, the same post-authentication rules as password sign-in). Spec: `MEMORY/specs/P10-10-passkey-login.md`.
6. **Request access is a new public, unauthenticated write** (this ADR is the record the spec template requires for a public endpoint): `POST /api/v1/access-requests`, rate-limited, honeypot, no captcha, Zod through `validate()`, the same neutral 202 for new, duplicate, over-cap and honeypot submissions, an audit row in the transaction with no personal data in `changes`, no email to the requester at submit. The `access_requests` table is **platform-owned and has no `tenantId`** (its tenant link is named `provisionedTenantId` so the global hooks do not scope it). The queue is **super-admin only through `rbac(SUPER_ADMIN)` on the admin router**, not `dynamicAccess`: approving creates a tenant, which A-76 made a platform operation precisely because a menu grant reached tenant administrators. Approval reuses `tenant.service.js#createTenant` with a new optional outer transaction. Spec: `MEMORY/specs/P10-05-request-access.md`.
7. **No separate mockup gate.** The brief's row "hi-fi HTML mockups first → owner approval → implementation" was reported superseded by the owner on 2026-09-29 (execution starts when the documents are ready); the owner reviews on the running build. Recorded here because the brief says otherwise.
8. **Working decisions, set by the coordinating session on 2026-09-29, awaiting the owner's confirmation.** The coordinating session reported that the owner delegated these to it ("decide the best recommendation and best practice"). The delegation is not recorded first-hand in the repository, so each stands as a working decision that implementation follows and the owner may overturn (`TASKS/BACKLOG.md` Q-39 … Q-47):
   1. **Name:** "Device Calibrator" on every public surface (it matches the logo and `APP_NAME`'s default); "Callibrator" is the codename; "HDC" is not used. (Q-43)
   2. **Accreditation:** SNARS is never named; *mendukung persiapan akreditasi rumah sakit (standar akreditasi Kemenkes)* / *supports hospital accreditation readiness (Ministry of Health standards)*; no regulation or decree number is cited; a legal review of the exact names is a pre-release item. (Q-39, Q-40)
   3. **`POST /auth/register`:** disabled in production behind a flag (default off in production); its 409s made neutral where it is enabled. (Q-44, A-290, P10-12)
   4. **First administrator on approval:** an invitation link (single-use, time-limited purpose token that sets the password), created in the approval's transaction; no temporary password — the random one-time password is for the super-admin bootstrap only (ADR-099). (Q-45, P10-05, P10-15)
   5. **Passkeys:** a user-verifying passkey counts as phishing-resistant MFA and skips the TOTP step, platform operators included; ADR-059's TOTP rule is amended when P10-10 lands. (Q-46)
   6. **Request retention:** a pending request nobody decides expires after 90 days; rejected, spam and expired requests are kept 12 months, then purged by the existing retention job; an approved request keeps its tenant link. (Q-42)
   7. **Certificate enumeration (A-293):** a random verification token of at least 128 bits in the QR/verify link; a lookup by number returns only a minimal verdict (valid / revoked / expired, issuing tenant, dates; no serial, no signer) under a per-IP rate limit. Reported as being implemented by a security agent (the request budgets are ADR-100); Phase 10 tracks it as P10-16 and does not re-plan it. (Q-47)
   8. **Contact channels:** `NEXT_PUBLIC_CONTACT_WHATSAPP`, `NEXT_PUBLIC_CONTACT_EMAIL`; a channel whose value is empty is hidden, never a placeholder. (Q-41)
   9. **No pricing, no trial.**
9. **Identifier-first sign-in; SSO discovered by email domain, not by account.** One form (email or username → password, or a redirect to the tenant's identity provider); the protocol comes from the tenant's configuration and the user never chooses it. `POST /auth/login/discover` answers from a list of email domains that **only the super admin** can attach to a tenant, so the answer depends on the domain, never on whether an account exists. An organisation-code fallback (`POST /auth/sso/start`) gives one generic refusal for unknown, disabled and misconfigured (A-292).
10. **`08-COLOR-SYSTEM.md` § The Verification Page lists the six verdicts the page computes** (valid, revoked, withdrawn, expired, not found, not yet valid), not four; `07-TYPOGRAPHY.md` gains the public serif display, scoped to public surfaces, with the rule that transcribable values stay in the mono face.

### Rationale

- **The owner's brief is binding** on mood, accent, fonts, language, CTAs, register model, sign-in methods and proof. Where the research disagreed (below), the owner's choice stands.
- **Every public claim must be true today.** The fabricated proof carries legal risk (UU 8/1999 Pasal 9 and 17; the FTC's 16 CFR 465 by analogy) and is the opposite of what a compliance buyer needs; research 05 classified every current string against the code, and P10-11 turns the rule into a test.
- **Dark and one accent were the owner's choice;** the brand teal `#00DAB4` already exists (08) and passes 10.90:1 on the chosen background, so no new brand colour is introduced.
- **No i18n library now:** about 250 strings on six pages; a typed dictionary makes a missing translation a compile error and stays CSP-safe. The flat-key shape migrates to `next-intl` mechanically if Phase 11 adopts it.
- **Identifier-first by domain** removes the protocol question and the account oracle together; the tenant-code fallback keeps tenants without a domain claim working.

### Alternatives Considered

| Alternative | Why not |
|---|---|
| **Research 04's recommendation: a light page with one dark "grand" hero band, Plus Jakarta Sans as the display face** | Rejected by the owner (brief: "dark cinematic", "serif display + sans body"). Recorded because it is the more accessible option for bright offices and projectors (see Bad Implications) |
| Keep 19 Part I (WebGL 3D hero, GSAP, Lenis) | ~305 KiB gzip JS on `/`, LCP tied to hydration (the hero `<h1>` starts at opacity 0), three animation systems; the owner asked for "subtle and premium" |
| Keep self-registration and fix it | It creates a tenant-less account nobody can use (ADR-075), enumerates, squats addresses and mails anyone; the owner chose Request access |
| `dynamicAccess` on the queue | A menu grant can reach tenant roles; creating a tenant is platform-only (A-76) |
| `next-intl` now | A dependency and a request-config layer for six pages; deferred to Phase 11 |
| `Accept-Language` negotiation | The owner chose Indonesian as the default for everyone |
| SSO discovery by account lookup | An account oracle |
| A passkey button now, calling the existing endpoints | They need a session; the button would do nothing |
| Tenant colour on the public pages | Cannot be contrast-checked against near-black in advance; breaks the one-accent rule |
| Temporary password for the first administrator (research 05 Q-4's other option) | A credential that travels out of band; an invitation proves the mailbox and sets the password in one step (working decision §8.4) |

### Implications — Including the Bad Ones

- **Dark-only public pages are harder to read in bright rooms and on projectors,** where hospital committees review vendors; users who need a light theme get none on these pages. Forced-colours mode must still work (it is in P10-13's checks), but the page is not designed for light.
- **The accent and the success green have the same luminance** (1.03:1); they differ only in hue. The rule "the accent never touches a verdict, every status carries its word and icon" is a convention, enforced only by review and the axe/visual checks.
- **A third and fourth font family** on public pages (~90 KB woff2 budget). Instrument Serif has only Regular and Italic; nobody may use it below 32 px or bold.
- **Two i18n mechanisms later** if Phase 11 adopts `next-intl` and the public dictionaries are not migrated at the same time.
- **The domain-discovery answer discloses that a hospital's domain uses SSO on this platform**, i.e. that it is a customer — the same fact a tenant-branded login link discloses. If the owner rejects that, discovery is dropped and only organisation links remain.
- **A public write endpoint** will receive spam; the honeypot and budgets bound it, they do not stop it. The table holds personal data of people who may never hold an account: retention, DSAR erasure by email and a privacy notice are required before go-live.
- **The approval transaction spans two services** (tenant and user creation); `createTenant` gains an outer-transaction option whose misuse (committing a transaction it does not own) would be a defect class of its own. Its existing tests must pass unmodified.
- **The page will look emptier** after P10-00 removes the fabricated proof, before the redesign lands. That is intended.
- **§8's working decisions may be overturned** by the owner; the ones with code consequences (8.3 register flag, 8.4 invitation, 8.5 passkey-as-MFA, 8.7 verification token) would then need follow-up changes.

### Documents amended

`docs/UI-UX/00-DESIGN-DIRECTION.md` (§ Language, § Two Audiences), `07-TYPOGRAPHY.md` (public display face), `08-COLOR-SYSTEM.md` (public palette, tenant branding on public pages, six verdicts), `14-PUBLIC-SURFACES-UX.md` (§ Landing, § Auth Screens, § SEO), `19-IMMERSIVE-REVAMP-PLAN.md` (Part I superseded) — each with a note referencing this ADR.


### Amendment 1 (2026-09-30) — the Phase 10 frontend as built, and where it departs from doc 20

**Records:** `MEMORY/records/2026-09-30-P10-frontend-as-built.md` (index) and one record per card. Each departure below was made during implementation; none changes a decision above, and each is open for the owner to overturn.

| # | Doc 20 said | As built | Why | Bad implication |
|---|---|---|---|---|
| 1 | §4.3: Latin + Latin Extended subsets; serif Regular and Italic | **Latin only**; Instrument Serif Regular only | Indonesian uses nothing beyond Basic Latin; no design element uses italic; four files, 57.4 KB (budget 90 KB) | a Latin-Extended letter (é, ş) on a public page falls back to the system face |
| 2 | §4.3: preload only body 400 and display 400 | `next/font/local` preloads every file of a family: display 400 + body 400/500/600 | one family per `localFont` call; splitting weights into separate families breaks `font-weight` | ~24 KB more preloaded on public pages |
| 3 | §11.1 `landing.verify.help`: "printed … next to the QR code" | "printed at the top of the certificate" | checked against `lib/certificatePdf.ts` (number in the top block, QR in the footer) — §11's "[confirm in P10-03]" | none |
| 4 | §11.1 `landing.security.auditRows` ships | **withheld** from the page (key kept) | its own condition (the audit `REVOKE` and migration 0091 confirmed on the reference deployment as the application role) is not met | the security list is one item shorter until it is |
| 5 | §6.5 lookup field | built behind `CERTIFICATE_LOOKUP_ENABLED = false` | P10-14 is not DONE (its live check is open) | none; flipping it is one reviewed line |
| 6 | P10-06: the page does not go live before the privacy notice (Q-42), vs §6.1: the request-access link is always present | the link is present (landing, sign-in, footer); the consent text names the Privacy Notice but **does not link it** (none exists) | §6.1 needs a way forward when no contact channel is configured | **release blocker**: the privacy notice must exist before the public deployment (§14) |
| 7 | §7.5 / P10-10: the passkey button only once P10-10 is DONE | shown where WebAuthn exists, since the backend ceremony merged (ADR-108), at the coordinator's instruction; `PASSKEY_SIGN_IN_ENABLED` hides it | the endpoints exist and are tested; DONE waits only for the virtual-authenticator E2E | a live-ceremony regression is user-visible before P10-13 catches it |
| 8 | §5 item 2: the root layout sets `<html lang>` from the cookie | it does, **except under `/dashboard`**, which stays `en` (the proxy passes the path in `x-pathname`) | the dashboard is English until Phase 11; `lang="id"` on English content fails SC 3.1.1 | one more request header the proxy owns |
| 9 | §5 item 4: strings to client components "as props or through one MessagesProvider" | one `MessagesProvider`; **outside a provider it falls back to English** | unit tests render client components alone; every page wraps its islands in a provider with the request's locale | a client component rendered outside `AuthShell`/the verify shell shows English |
| 10 | A-288 (ADR-100) on the passkey path | a `LOCATION_REQUIRED` answer runs ONE new ceremony with the position | a ceremony is single-use, so the assertion cannot be resent | the user touches the authenticator twice on a geofenced tenant |
| 11 | §6.9 removes the old landing sections | every old landing section, `data/landing.ts`, the motion helpers only they used, and the last seven Pexels photos are deleted | nothing public uses them | blog and news still use `LandingLayout` (Lenis/GSAP) and have not taken the new header and footer (§1 of this ADR) — open (**closed by Amendment 2**) |

### Amendment 2 (2026-09-30) — the public pages' JavaScript, the AC-7 measurement, and blog/news on the public surface

**Record:** `MEMORY/records/2026-09-30-P10-perf-blog.md` · **Card:** P10-13 (the performance part) · **Amends:** doc 20 §13 AC-7 (the measurement), doc 19 §11 (the blog/news chrome).

**Context.** Lighthouse mobile Performance was 73–91 on the public pages and `/verify/*` shipped ~180 KB of first-load JavaScript against a 120 KB budget. The cause was structural: the ROOT layout rendered the signed-in app's client providers (theme, tenant branding, the session check with axios and the auth store behind it, toasts), so every public page downloaded and hydrated them; the session check even called the backend from pages that have no session.

**Decisions.**

| # | Decision | Alternatives considered | Bad implication |
|---|---|---|---|
| 1 | The providers move to `app/dashboard/layout.tsx` (`components/AppProviders.tsx`). The root layout keeps `<html>`, fonts and the nonce'd theme-init script only. The dashboard's pages are not moved or restyled. | **(a) a `(public)` route group** with its own layout: needs the public routes moved into it and, to be lean, the providers out of the root anyway — the providers moving DOWN is the part that matters, and it leaves every URL and file where it was. **(b) Render the providers conditionally on the path in the root layout:** a client reference imported by a layout is in every page's bundle whether rendered or not — no saving. | A future signed-in route OUTSIDE `/dashboard` gets no providers unless it wraps itself in `AppProviders`. A toast raised just before leaving the dashboard (e.g. at sign-out) is not shown on the public page it lands on. `AuthInitializer` now skips a session already in the store (the client-side step from sign-in), so the dashboard does not re-verify a session proved a moment earlier. |
| 2 | Inter and Space Grotesk (the dashboard's faces) are declared in the root layout with `preload: false`. | Import them in the dashboard layout: their CSS variables must sit on `<html>` (portals, `body`), which only the root layout renders. | ~70 KB of fonts is no longer preloaded on the dashboard's first load; they load when its CSS first uses them (`display: swap`, a brief fallback-font swap on the first visit), then from cache. |
| 3 | Client bundles carry no full dictionary: the translator lives in `i18n/translate.ts` (no dictionary imports); `MessagesProvider`'s English fallback outside a provider is **development and test only** (a `NODE_ENV` branch the production build drops); `useLoginForm` / `FirstPasswordChangeForm` no longer export English-dictionary constants (their tests build them). | Keep the fallback: ~21 KB of English in every public island for a branch no page takes. | In production a client component rendered outside a `MessagesProvider` shows **keys**, not English (Amendment 1 #9 is now "English in development and tests"). |
| 4 | `i18n/apiErrors` checks `isAxiosError` itself (`err.isAxiosError === true`, what axios does) instead of importing axios. | — | If axios ever changed the marker, readApiFailure would treat its errors as unknown (a network message). |
| 5 | Public pages and the root error / not-found boundaries draw icons from `components/icons/static.tsx`, generated from lucide's paths by `scripts/gen-static-icons.mjs`. lucide-react 1.x marks its `Icon` base `"use client"`, so every lucide icon — even in a server component — is client JavaScript. | Keep lucide: its runtime sat on every page through the root not-found boundary. | Two icon sources: a new icon on a public page must be added to the generator's list (the dashboard keeps lucide-react). |
| 6 | The root not-found boundary and the verification page's home link use `<a>`, not `next/link` (a deliberate, commented `no-html-link-for-pages` exception). Turbopack put a second copy of the Link runtime in each chunk group that referenced it. | Keep `Link`: ~3 KB twice on `/verify/*`. | No prefetch or client-side navigation from a 404 page or the verification header. |
| 7 | **AC-7 is measured in brotli, per file, by `frontend/scripts/bundle-budget.mjs`** (first load = `rootMainFiles` ∪ the route's client-reference `entryJSFiles`); CI and `make verify` run it after `next build` against `frontend/bundle-budget.json`, which also holds gzip ceilings and regression ceilings for the other public routes. | "`next build` output" (doc 20): Next 16 prints no sizes. **gzip:** react-dom + the Next and Turbopack runtimes alone are **127.4 KB gzip / 109.0 KB brotli**, so `/verify/*` ≤ 120 KB gzip is unreachable with React 19 whatever the page does. | The number depends on the encoding the edge serves; nginx here sends gzip (level 1 by default), and brotli reaches browsers only where the edge (Cloudflare) recompresses. The gzip ceilings in the budget file keep that side from regressing. |
| 8 | Blog and news (index and `[slug]`) render in `components/public/ContentShell.tsx` (public header whose anchors lead to `/#…`, footer, `--pub-*` tokens); chrome strings are dictionary keys (`content.*`); the category filter is a server component; the gradient "Sign in" band on an article is replaced by the landing's contact heading and the request-access link; titles say "Device Calibrator" (Q-43). `LandingLayout`, `Navigation`, `Footer`, `AnimatedBackground` and `components/landing/_shared` are deleted. | Keep `LandingLayout` for blog/news: it loaded Lenis and GSAP (~86 KB brotli) on every blog and news page. | Post bodies are authored in one language and are shown as written under either locale. `.article-prose` has public-surface overrides in `public-surface.css`; a new prose element styled in `globals.css` needs one there too. |

**Result** (the record has every number): first-load JS brotli `/` 150.6 → 123.4 KB, `/verify/*` 155.4 → 117.9 KB (AC-7 met), `/login` 161.2 → 150.2, blog/news 237 → 119. Lighthouse (mobile, 5 runs, median, interleaved before/after on a shared host with `benchmarkIndex` ~1075): `/` 75 → 76, `/login` 85 → 81, `/verify/*` 77 → 82, `/request-access` 80 → 80, `/blog` 70 → 89, a blog article 73 → 86 — **AC-5/AC-6 still not met on this host**; the medians of the first four moved within the run-to-run spread. The streamed blog/news pages first measured CLS 0.28–0.32 (the footer drawn above the fold, then moved); `ContentShell`'s `<main>` is now at least a viewport tall and the trace shows no shift.

---

## ADR-096: The Audit List Reads a 90-Day Window by Default and Counts at Most 10,000 Rows; the Dashboard Holds at Most Four Connections; Kanban Lists Count in One Grouped Query; the Lists Have Per-Tenant Order Indexes

**Date:** 2026-09-29 · **Cards:** P8-04 (query-shaped fixes), D-30 · **Builds on:** ADR-086 §3 (the P8-07 measurement and the P8-04 decision), ADR-063 (0062's audit indexes), ADR-064 (0067) · **Migration:** `0093` · **Record:** `MEMORY/records/2026-09-29-p804-query-shape.md`

**Context.** ADR-086 §3 measured the backend under load (P8-07). PostgreSQL was the saturated resource. The audit list's exact `count(*)` over the tenant's whole history was 39 of 72 sampled active queries: a parallel sequential scan of 500,000 rows. The dashboard ran 20 aggregates in one `Promise.all` against a 20-connection pool. The P8-04 debate decided on query-shaped fixes first — a bounded or estimated count and a default audit window — and a read replica only if p95 still fails after them.

This change carries out those fixes. It also audits the other list and detail services for N+1s, missing indexes and sequential scans. The audit ran on a throwaway `pgvector/pgvector:pg18` built the way the app builds it (`runSchemaSetup`: `db.sync()` and then the migrator) and seeded with:
- the demo seed and `scripts/load/p807-seed.sql`: 2 × 5,000 devices, 2 × 50,000 records, 2 × 500,000 audit rows and 4.32M `iot_readings`;
- a scratch generator for two more tenants (60/40): 5,000 devices, 50,000 records, 20,000 certificates, 200,000 audit rows, 20,000 attachments, 10,000 stocks and adjustments, 5,000 transfers, 10,000 work orders, 20,000 notifications, 80 kanban boards × 100 cards × 10 sprints. Every row carries its tenant column.

46 scenarios drove the REAL services inside the tenant context `tenantContext.middleware` builds. Each statement they issued was captured through Sequelize's `logging` callback and re-run under `EXPLAIN (ANALYZE, BUFFERS)` (best of 5).

**Findings**

| # | Finding | Evidence (before) |
|---|---|---|
| 1 | **Audit list: exact count over all history** on every page request | 500k-row tenant: Parallel Seq Scan, 24,513 buffers, **329 ms**. Under k6 audit-only load (5 VU) the pre-fix backend answered **408 after 30 s** and then logged `ERR_HTTP_HEADERS_SENT` (the request timeout fired while the count was still running) |
| 2 | **Kanban `listProjects` N+1**: one card count plus `resolveAccess` (project `findOne` + members `findAll`) per board | **122 statements** for a member with 40 boards, 81 for a super admin; live PG18: 5 statements for 1 board, **92 for 30** |
| 3 | **Kanban `listSprints` N+1**: one count per sprint plus the backlog | 14 statements for 10 sprints (16 for 12 on live PG18) |
| 4 | Lists ordered by a column no per-tenant index serves | certificates `created_at DESC`: Seq Scan + sort of 12,000 rows, 50 ms · work orders `created_at DESC`: Seq Scan + sort, 43 ms · devices `name` at page 200: bitmap scan + top-N sort of 5,000, 40 ms · stocks `item_name`: Seq Scan + sort, 16 ms · attachments `created_at DESC`: Seq Scan · records `calibration_date DESC`: an Index Scan Backward on the global `(calibration_date)` index that discards the other tenants' rows (25,512 rows removed, 27,842 buffers) |
| 5 | Dashboard: 20 aggregates in one `Promise.all` against a pool of 20 (ADR-086 §3) | one request can hold every connection |
| 6 | `attachment.listOrphans` (D-22's report): hashed subplans that seq-scan each parent table across every tenant | **3.0–3.7 s**, 62–82k buffers. Left open (below) |
| 7 | `stock.getInventoryReport` loads every stock row of the tenant to sum them in JavaScript | 1 query, 6 ms at 6,000 rows. Unbounded, but D-24's reviewed list already carries it. Left open |
| 8 | `eSignature.getEligibleSigners` checks the permission per user | 1 statement in practice: the permission matrix is cached per role. Not an N+1 at the database |

No other list or detail service issued a query per row. Devices, records, certificates, stock, maintenance, notifications, attachments and search each issue a fixed 1–3 statements.

### Decision

1. **Audit list: a default window and a bounded count (findings 1; API change).**
   - A request with no `startDate`, no `endDate` and no `resourceId` reads the last **90 days** (`AUDIT_DEFAULT_WINDOW_DAYS`).
   - `meta.window = { from, to, defaulted }` says which window was read. A caller that wants older rows passes a `startDate`.
   - A single resource's history (`resourceId`) is not windowed. It is bounded by the resource, and 0062's `(tenant_id, resource_type, resource_id)` index serves it.
   - `meta.total` counts at most **10,000** rows (`AUDIT_COUNT_CAP`). `meta.totalIsCapped: true` says the total is then a lower bound. `totalPages` follows the capped total. A page past it is still served if asked for.
   - The count is **raw SQL through `utils/sql.util#sql`**, a constant statement with every filter bound (`$2::uuid IS NULL OR user_id = $2`, …). It reads `SELECT 1 … LIMIT $9` inside `count(*)`, over 0062's `(tenant_id, created_at)` index.
   - **Its tenant is the one the hook would force.** Raw SQL bypasses the hooks, so `countTenantId` uses `tenantScope.util#resolveScope`:
     - a tenant principal binds its context tenant;
     - a context with no tenant binds `NO_TENANT_UUID`;
     - the controller's `tenantId` is bound only where the hook would not filter (super admin, system task, no context).
   - **Frontend:** the audit page shows "Showing the last 90 days (since <date>). Set a Start Date to see older entries." when `meta.window.defaulted` is true. Under the pager it shows "More than 10,000 entries match. Narrow the dates or filters for an exact count." when `meta.totalIsCapped` is true.
2. **Kanban: one grouped count (findings 2–3).**
   - `listProjects` runs `KanbanCard.count({ group: ["projectId"] })` once. It reads each board's access level from the memberships query it already ran, now reading `accessLevel` too.
   - The rule is `resolveAccess`'s: a super admin and the creator are owners; anyone else gets their best membership level, or null.
   - `listSprints` runs `count({ group: ["sprintId"] })` once; the NULL group is the backlog.
   - Statements: 122 → 3, 81 → 2, 14 → 4.
3. **Dashboard: at most `DASHBOARD_CONCURRENCY = 4` aggregates hold a connection at once (finding 5).**
   - The same 20 queries run through `runBounded`, in order. The first rejection rejects the whole, as `Promise.all` did, and starts no more tasks.
   - The query shapes are unchanged, so no dashboard figure can change.
4. **Migration `0093`: six per-tenant ORDER BY indexes, built `CONCURRENTLY` as 0062 builds them (finding 4).**
   - `calibration_records (tenant_id, calibration_date DESC)`, `certificates (tenant_id, created_at DESC)`, `calibration_devices (tenant_id, name)`, `maintenance_work_orders (tenant_id, created_at DESC)`, `attachments (tenant_id, created_at DESC)` and `stocks (tenant_id, item_name)`.
   - An INVALID index left by an interrupted build is dropped and rebuilt.
   - The indexes are declared on no model (`sync()` runs first; D-13). `0093` is TypeScript, and its manifest name keeps `.js` (P9-23).

### Before / after — `EXPLAIN (ANALYZE, BUFFERS)`, PostgreSQL 18, execution time of every statement a call issued (best of 5)

The host was a shared desktop Docker engine running about 20 other agents' stacks, so the times are noisy. The buffer counts are stable.

| Service call | Statements | Exec ms | Buffers |
|---|---|---|---|
| audit list, 500k-row tenant, page 200 | 2 → 2 | **328.8 → 7.0** | 24,513 → 2,033 |
| audit list, 120k-row tenant | 2 → 2 | 88.6 → 5.1 | 4,798 → 157 |
| audit list, page 200 | 2 → 2 | 65.2 → 21.2 | 5,045 → 404 |
| audit list, `action=DELETE` | 2 → 2 | 40.3 → 23.4 | 4,804 → 2,624 |
| kanban `listProjects`, member of 40 boards | **122 → 3** | 30.1 → 2.9 | 4,567 → 382 |
| kanban `listProjects`, super admin | **81 → 2** | 25.9 → 3.2 | 4,444 → 379 |
| kanban `listSprints`, 10 sprints | **14 → 4** | 2.3 → 0.9 | 165 → 126 |
| certificates list | 2 → 2 | 57.1 → 5.5 | 1,033 → 593 |
| certificates list, `status` | 2 → 2 | 26.4 → 4.4 | 1,033 → 599 |
| work orders list | 2 → 2 | 47.0 → 4.1 | 563 → 385 |
| devices list, page 200 | 2 → 2 | 42.6 → 4.5 | 355 → 260 |
| devices list, page 1 | 2 → 2 | 6.5 → 1.6 | 225 → 136 |
| stock list | 2 → 2 | 19.2 → 3.1 | 913 → 519 |
| attachments list | 2 → 2 | 21.6 → 17.5 | 1,202 → 631 |
| dashboard, 500k-row tenant | 21 → 21 | 72.0 → 47.8 | 5,169 → 3,637 |
| records list, page 200 | 2 → 2 | 87.9 → 60.6 | 29,352 → 29,352 (see below) |

The plan changes behind the rows:
- certificates, work orders, stocks and devices: `Seq Scan`/bitmap scan + `Sort` → `Index Scan using <table>_tenant_id_<order>`;
- the audit count: `Parallel Seq Scan` over 500,000 rows → `Index Only Scan using audit_logs_tenant_id_created_at`, stopping at 10,001 rows.

### Load — `scripts/load/p807-baseline.k6.js`, A/B on the same host state

Before: the tree without this change's service edits, and without the 0093 indexes. After: the working tree, with them. One backend process from source (`node --import tsx`, `NODE_ENV=production`), `grafana/k6` in a container, 10 VU for 60 s mixed, then 5 VU for 30 s each on audit only and dashboard only. Round 1 is discarded: the pre-fix backend timed out the k6 login in `setup`, so every later round warms up first. Rounds 2–4 are below.

| Round | Tree | Mixed req/s | Mixed p95 s (devices / find / records / audit / dashboard) | Mixed 408s | Audit-only req/s · p95 s | Dashboard-only req/s · p95 s |
|---|---|---|---|---|---|---|
| 2 | before | 3.6 | 0.86 / 1.30 / 2.08 / 30.24 / 0.84 | 6 | 3.6 · 4.19 | 4.8 · 2.07 |
| 2 | after | 16.5 | 0.93 / 0.90 / 0.92 / 1.08 / 1.06 | 0 | 7.3 · 1.20 | 7.1 · 0.84 |
| 3 | before | 10.0 | 1.84 / 1.45 / 2.41 / 2.51 / 1.28 | 0 | 2.0 · 4.33 | 7.3 · 1.16 |
| 3 | after | 8.9 | 3.96 / 1.24 / 4.27 / 1.59 / 2.33 | 0 | 13.3 · 0.71 | 1.8 · 3.37 |
| 4 | before | 15.8 | 0.85 / 0.82 / 1.09 / 1.47 / 0.86 | 0 | 5.5 · 1.76 | 4.3 · 2.03 |
| 4 | after | 2.4 | 8.61 / 8.68 / 11.39 / 9.01 / 10.05 | 0 | 4.0 · 1.86 | 6.3 · 1.06 |

**0 tenant leaks and 0 5xx in every run.** The only 408s were the pre-fix audit list's (6 in round 2's mixed run, 5 in round 1).

**What these runs show, and what they do not.** The host was a shared desktop Docker engine running about 20 other agents' stacks and test suites (CPU per container sampled at 100–650%). Run-to-run noise was larger than most effects:
- round 4's *after* mixed run fell to 2.4 req/s with 9–11 s p95 on every endpoint, including the untouched devices list, with no error in the backend log;
- round 4's *before* mixed run was the best of all eight.

So the end-to-end numbers are **not evidence of a p95 improvement**, and this ADR does not claim one. Two things held regardless:
- **Only the pre-fix audit list ever timed out:** 408s after 30 s in rounds 1 and 2, with `ERR_HTTP_HEADERS_SENT` in the backend log. None of the post-fix runs had a 408.
- Audit-only throughput was higher after the fix in rounds 2 and 3 (3.6 → 7.3, 2.0 → 13.3 req/s) and level in round 4 (5.5 → 4.0).

The server-side evidence above (buffers, plans, statement counts) is what the decision rests on.

**The dashboard bound is not shown to help.** Its effect is inside the noise: dashboard-only p95 went 2.07 → 0.84 s in round 2, 1.16 → 3.37 s in round 3, and 2.03 → 1.06 s in round 4. What the bound guarantees is structural: one dashboard request can no longer hold the whole pool (`queryCount.p804.live` asserts at most 4 connections). Whether 4 is the right figure is a question for a quiet host (below).

### Alternatives considered

| Alternative | Why not |
|---|---|
| **An estimated count** (`pg_class.reltuples`, or `EXPLAIN`'s row estimate) | it is per table, not per tenant and filter; the planner's estimate for a filtered tenant can be off by orders of magnitude, and a compliance screen showing an invented number is worse than one showing "10,000+" |
| **Drop the total entirely (keyset "next page" only)** | the frontend pager and every list's envelope carry `meta.total`; a bounded total keeps the contract and removes the cost |
| **No default window, only the cap** | the capped count still reads up to 10,001 rows on every request, and the rows query's `OFFSET` walks history; the window bounds both, and an old row is one `startDate` away |
| **Batch the dashboard's 20 aggregates into a few `FILTER` queries** | fewer statements, but raw SQL or `literal` fragments for every figure, and every soft-delete scope (`is_deleted`, paranoid `deleted_at`) replicated by hand — a class of mistake this codebase has made before (A-75); the bound keeps every query as it was and is provably figure-identical |
| **Raise the pool instead of bounding the fan-out** | ADR-086 §3: PostgreSQL is already the saturated resource; a bigger pool only lets more queries queue inside it |
| **Also cap the devices and records list counts** | P8-07 names them too, but their totals are 5,000 and 50,000 per tenant — bounded by the inventory, not by time. They are not changed here, and their exact counts cost 2–36 ms. Left open |
| **A `(tenant_id, action, created_at)` audit index** | the window already bounds the action-filtered count at 23 ms on 65k windowed rows; add it if the filter becomes common |

### Implications, including the bad ones

- **API change.** A client that called `GET /audit` with no dates and expected the whole history now gets 90 days. It is told so in `meta.window` and on the page. No other client of the list exists in the repository: the GDPR export and the masking read the trail through their own services.
- **`meta.total` is a lower bound past 10,000.** The pager shows 1,000 pages of 10, and the note says there are more. A tenant with more than 10,000 rows in 90 days (about 110 a day) always sees the note until it narrows the filters.
- **The count is raw SQL.** It is the first raw statement in `audit.service`. It binds `tenant_id = $1` (rawSqlTenantPredicate.d05 checks that), and it takes its tenant from the same `resolveScope` the hook uses. A future filter added to the rows query must be added to `AUDIT_COUNT_SQL` too, or the count and the rows disagree. The unit guard pins the bind positions.
- **The records list does not use its new index on this data.** With three tenants each holding about a third of the table, the planner costs the global `(calibration_date)` index below the per-tenant one, and keeps it. With the old index dropped inside a rolled-back transaction, the per-tenant index read 592 buffers instead of 21,839. With many tenants, the per-tenant index is the cheaper plan by the planner's own arithmetic. That is the production shape, but it is **not demonstrated here**.
- **The dashboard is up to about 5× more serial.** 20 queries run 4 at a time, so an idle system's dashboard latency is about 5 sequential query rounds instead of 1. That costs tens of milliseconds when each aggregate is a few milliseconds.
- **`memoryDb` evaluates a grouped `count`** (`{ attr, count }` per key, NULL a key of its own), so `kanban.twoTenant` still runs through it. Any other grouped aggregate is still refused.
- **Sequelize's `beforeQuery` hook fires twice per statement** in this build (observed: 4 hook calls for 2 logged statements). The live guard counts statements through `logging`, and connections through the connection manager.

### Evidence

- **Unit guard** `src/tests/services/queryShape.p804.test.ts`, 15 tests:
  - audit: bounded count through `sql()` with `tenant_id = $1`, no `findAndCountAll`/`count`, cap and lower bound, default window, explicit dates, a resource not windowed, the count tenant from the context;
  - dashboard: peak ≤ 4 with all 20 queries run, and `runBounded` ordering and stop-on-reject;
  - kanban: 40 boards → 3 / 2 model calls with the same levels, one grouped count for sprints.
  - **Fail-before:** 14 of 15 failed on the tree without this change's service edits (`git worktree add <scratchpad>/perf/wt HEAD`, backend `src` copied from the working tree and the three services restored to their pre-fix text; the worktree was removed afterwards, junctions removed with `rm` on the link). kanban: `Expected: 3, Received: 82`, `Expected: 2, Received: 81`, `Expected number of calls: 1, Received: 11`.
- **Live guard** `src/tests/services/queryCount.p804.live.test.ts` (opt-in `P804_PG_LIVE_TEST=1`, a database named `*scratch*`), 4 tests. **4 of 4 passed** on PostgreSQL 18 (`pgvector/pgvector:pg18`) built by `runSchemaSetup`:
  - listProjects: the same count for 1 and 30 boards, ≤ 3;
  - listSprints: ≤ 4;
  - audit: 2 statements, total capped at 10,000 of 12,000;
  - dashboard: 21 statements, ≤ 4 connections.
  - **Fail-before:** 4 of 4 failed on the pre-fix tree: `Expected: 5, Received: 92` (listProjects, 30 boards), `Expected: <= 4, Received: 16` (listSprints), `Received: 12000` (the audit total, exact), and `DASHBOARD_CONCURRENCY` undefined.
- **Migration** `src/tests/migrations/0093-list-order-indexes.test.ts`, 8 tests: CONCURRENTLY, idempotent, INVALID rebuilt, failure propagates, `down` exact, registered, no model declares them. **On PG18:** `0093` applied through the migrator in 29.9 s over the loaded database, and `pg_index.indisvalid` is true for all six.
- **Adapted, not weakened:**
  - `audit.service.test.js`: `findAll` + `sql` doubles. "omits createdAt" became "applies the default window".
  - `audit.platform.a125.test.js`: the double answers the bounded count; it now also asserts that the count binds the hook-forced tenant (`total` 2, not PLATFORM's 1).
  - `kanban.service.test.js`: grouped-count doubles; "swallows resolveAccess errors" became "a membership row with no level gives no access".
- **Frontend** `src/app/dashboard/audit/__tests__/page.window.p804.test.tsx`: 4 tests (window note shown and hidden, capped note shown and hidden). The audit folder's 4 suites pass (25 tests).

### Open

- The **dashboard concurrency figure** (4) and the dashboard's p95 need a load run on a quiet, dedicated host. This host could not separate the effect from noise.
- `attachment.listOrphans` takes 3–4 s at 20,000 attachments (finding 6). It is D-22's report and admin-only. The fix is a rewrite of its polymorphic anti-join (per-type `NOT EXISTS` joined on the parent's `(tenant_id, id)`), for D-22's owner.
- The **devices and records list counts** are still exact (P8-07 named them). They are cheap at today's inventory. Cap them the same way if a tenant's record count makes them measurable.
- `stock.getInventoryReport` aggregates in JavaScript over every stock row (D-24's reviewed list).
- **P8-04's replica decision.** On this host, with these fixes, the audit endpoint that dominated the P8-07 sample is no longer the ceiling. Whether p95 still fails is a question for the dedicated-host run P8-07 already asks for.

**Status:** Accepted — implemented 2026-09-29.

---

## ADR-097: `@callibrator/contracts` — One Zod Schema for the Backend Validator and the Frontend Type; the Package Ships TypeScript Source, and Only the Backend's Release Tree Gets a Compiled Copy

**Date:** 2026-09-29 · **Card:** P9-22 · **Implements:** ADR-038 (shared-contracts row), ADR-087 decision 7 (cross-workspace contracts are not `backend/src/types/`) · **Works with:** ADR-044 / ADR-046 (npm workspaces, one root lockfile, images built from the root), ADR-093 (Joi → Zod, P9-11) · **Does not settle:** Q-48 (`packages/contracts` vs ADR-089's `shared/contracts`)

**Context.** The frontend's request types were hand-written copies of what its authors believed the API accepted, and ADR-030 already called them "a belief about the API, not a guarantee". P9-11 (ADR-093) made every backend request validator a Zod schema, which is both the runtime check and a type. P9-22 puts those schemas where both ends can import them. The package has five consumers, and each loads code differently:

| Consumer | How it loads `@callibrator/contracts` |
|---|---|
| backend and frontend typechecks (TypeScript 7 by path; Node16 / bundler resolution) | the `types` condition |
| backend jest (the Babel 8 transformer) | the resolver follows the workspace symlink to its realpath outside `node_modules`, so the `.ts` is transformed. The frontend's imports are `import type` today, erased by ts-jest before anything loads |
| backend `npm start` / `dev` / migrations (tsx) | tsx compiles any `.ts` |
| frontend `next build` (Turbopack) and its standalone server | the bundler compiles it (`transpilePackages`) |
| backend `node dist/index.js` and the pkg binary | **plain Node: it cannot load `.ts`** (ADR-087 context, item 1) |

### Decision

1. **Layout.** `packages/contracts/src/<domain>.ts` has one module per API domain, holding request schemas and the types derived from them (`z.input` for what a client sends, `z.output` for what the handler receives). `src/fields.ts` holds the shared field schemas and `src/index.ts` is a barrel of **named** re-exports. A module imports only `zod` and its siblings: no Node API, no DOM, no environment. The package's lint enforces that (`no-restricted-globals` on `process`, `window`, `document`), and so does `types: []` in its tsconfig.
2. **The package ships TypeScript source.** `package.json` `exports` maps `.` and `./*` to `./src/*.ts` for both `types` and `default`, so every consumer except the release tree reads the one source. The manifest declares **no `"type"`**. With `"type": "commonjs"`, Turbopack refused the first frontend *value* import (`contentHtml`, the A-298 agent's) with "Specified module format (CommonJs) is not matching the module format of the source code (EcmaScript Modules)". With no `type`, it infers ESM from the syntax, while TypeScript (Node16), tsx and Babel still treat the files as CommonJS. The compiled copy in `backend/dist` declares `"type": "commonjs"` itself. Proved on 2026-09-30 by a `next build` with that runtime import bundled. There is no `packages/contracts/dist`, so there is no build that can go stale, and the typecheck cannot disagree with what jest or Next executes.
3. **Only the backend's release tree gets JavaScript.** `backend/scripts/build-dist.ts` gains step 4, after the backend compile. It runs TypeScript 7 on `packages/contracts/tsconfig.build.json` with `--outDir backend/dist/node_modules/@callibrator/contracts` (CommonJS), checks that every source module was emitted, and writes a compiled `package.json` (`main ./index.js`, `exports` `./*.js`). A `require` from `dist/src/**` walks up to `dist/node_modules` before it reaches the workspace symlink, in plain Node and in pkg. `zod` still resolves from the root `node_modules`, so the backend and the contracts share one instance. The step is additive: the existing "N copied, M compiled" line is unchanged, and a compile failure exits 1 through `fail()`.
4. **The backend keeps its module names.** `backend/src/validators/vendor.validator.ts` and `calibrationDevices.validator.ts` re-export the package's schema **objects** under the same names, and `validators/fields.ts` re-exports the field helpers. `validate()`, `enumMirrors.d26`, `swaggerValidatorAlignment.p608` and the contract suites rely on object identity and schema introspection, so re-exports keep all of them unchanged. The re-exports are named, never `export *`: Babel's CommonJS interop for `export *` is a loop whose branches put `fields.ts` at 75% in the backend's 100% gate (measured).
5. **The frontend infers.** `frontend/src/api/services/vendor.service.ts` and `device.service.ts` define `VendorCreateInput`, `VendorUpdateInput`, `VendorQualifyInput`, `DeviceCreateInput` and `DeviceUpdateInput` as the contract's `z.input` types (plus `{ id }` for updates). `VendorType`, `VendorStatus` and `DeviceStatus` come from the schemas' own value lists. Response types (`Vendor`, `Device`) stay hand-written: the package has no response schemas yet. The device form keeps its own UI shape (`DeviceFormState`), which must stay assignable to the contract where it is submitted. `next.config.ts` lists the package in `transpilePackages`, so a future value import (client-side validation) is bundled, never externalised to a standalone server that cannot load `.ts`.
6. **One Zod.** The package declares `zod ^4.6.5`, the same range as the backend. npm hoists one copy to the root, and `packages/contracts/test/package.test.ts` asserts that the package, `backend/` and `frontend/` resolve `zod` to the **same file** (major 4). A second copy would make two `ZodType` classes. The nested `zod@3` under `chromium-bidi` (puppeteer) is not reachable from any of the three, and the test resolves from each workspace, not globally.
7. **Types-only change in the move.** `numeric`, `booleanish` and `dateLike` declare the input they convert (`number | string`, `boolean | string`, `Date | string | number`) through `z.preprocess`'s third type parameter, instead of `unknown`. Without this, `z.input` of every numeric or date field is `unknown`, and the frontend type would accept anything. The runtime is byte-identical: the conversion functions still take `unknown`.
8. **Workspaces, and the pnpm file (G-09).** The root `package.json` already listed `packages/*`, and `pnpm-workspace.yaml` deliberately did not ("no shared package"). npm is authoritative (ADR-044), so the npm declaration stands. `pnpm-workspace.yaml` now lists `packages/*` as well, so the two at least agree, and its comment says it does not install anything. Deleting the file is still G-09. Both workspaces depend on `"@callibrator/contracts": "^0.1.0"`, which the lockfile records as a `link` to `packages/contracts`.
9. **Images (ADR-046).** Both Dockerfiles copy `packages/contracts/package.json` with the other manifests before `npm ci`, which refuses a lockfile that names a workspace it cannot see. They copy `packages/contracts/` with the source: the backend before `build:dist`, the frontend before `next build`. Both `Dockerfile.dockerignore` allow-lists re-include `packages/contracts` and exclude its `node_modules` and tests.
10. **Gates.** The package has its own `lint` (`packages/contracts/eslint.config.js`, which mirrors the backend's TypeScript block: strictTypeChecked + stylisticTypeChecked, `no-explicit-any`, the enum ban, `consistent-type-imports`), its own `typecheck` (TypeScript 7 under the backend's flags, plus `test/tsconfig.json`), and its own `test`. The test runs the backend's `fields.p911`, `vendor.validator` and `calibrationDevices.validator` suites plus `test/package.test.ts`, with **100%** thresholds. The backend's jest cannot measure the package: jest instruments only files under its `rootDir`, and `backend/` does not contain `packages/` (probed: the package reads 0% there while its tests pass). So the package's jest config uses the repository root as `rootDir`, and runs from `backend/` so that Babel finds the backend's Babel 8 plugins. All three are wired into `make lint`, `make typecheck`, `make test` and CI's backend-lint job, each run directly, because turbo would skip them silently.
11. **Location (Q-48, not settled here).** ADR-089 plans a root `shared/contracts` for Phase 999. ADR-038 and ADR-087 put Phase 9's contracts in `packages/contracts`, and CLAUDE.md forbids creating `shared/` before Phase 999. This ADR builds what Phase 9 decided and records the conflict as Q-48. Consumers import by package name only, so a later move changes the workspace glob, the Dockerfile lines and the `CONTRACTS` path in `build-dist.ts`, but no import.

### The first slice

Moved: `fields` (P9-11's `backend/src/validators/fields.ts`; its definitions now live in `packages/contracts/src/fields.ts`, **not** in the backend, which P9-11's record and ADR-093 name as the canonical location), `vendor` (`createVendor`, `updateVendor`, `qualifyVendor`) and `calibrationDevices` (the list query, id param, create and update schemas). The P9-11 helper cleared all three as settled before the move.

**What the typed contract caught on its first compile.** The vendor page's create call sent `rating`, which `createVendor` does not declare. `validate()` stripped it, so **no create has ever stored a rating** (Q-37). The frontend no longer sends it on create; it still sends it on update, and nothing stored changes. `useVendors.test.ts` pinned the fabricated field and was updated with it. The old `VendorQualifyInput` also typed `scorecard` as an object, where the API takes an integer from 0 to 100. Nothing sent it.

### Alternatives considered

| Alternative | Why not |
|---|---|
| **The package builds its own `dist/`, and `exports` points at it** | every consumer then depends on a build step having run, and on its output being current. An edited schema would be type-checked from the source and executed from a stale build: the one disagreement this card exists to remove |
| **Conditional exports (`"source"` for tooling, `"default"` → built JS)** | plain Node, tsx and jest all resolve with `node`/`require`/`default`. Separating them needs `--conditions` on every script, a jest `customExportConditions` and a Turbopack equivalent, which are three mechanisms kept in sync by hand |
| **Load the `.ts` with Node 26's type stripping in the binary** | pkg snapshots `.ts` as an asset, not a script. Node 26 also refuses stripping under `node_modules`, and relative imports would need `.ts` extensions, which TypeScript accepts only with `allowImportingTsExtensions` (an emit restriction on the backend build). Not provable inside pkg |
| **Add `../packages/contracts` to the backend's tsconfig and compile it into `dist/src`** | it breaks `rootDir: "."` (TS6059), and puts package code in the backend's tree under the backend's paths, so a `require("@callibrator/contracts")` still resolves elsewhere |
| **Keep the frontend's hand-written interfaces and add a test comparing them** | a test generated from the code it tests verifies consistency, not correctness (CLAUDE.md § Evidence). The compiler comparison is the one that cannot drift |
| **Measure the package inside the backend's 100% gate** | jest does not instrument outside `rootDir` (probed). Widening the backend's `rootDir` to the repository changes every path in its config, and that is the lead's decision, for no gain over a package-level gate |
| **`shared/contracts` now (ADR-089)** | CLAUDE.md: no `shared/` before Phase 999, and ADR-038 and ADR-087 name `packages/contracts`. It is Q-48, an owner decision, not a helper's |

### Implications, including the bad ones

- **Every backend build compiles the package twice over:** once as part of the backend typecheck, under the backend's flags, and once in `build:dist` for the release tree. The package is small (4 modules), so the cost is under a second, and it grows with each domain moved.
- **Source-only exports make the package unusable outside this monorepo**, for example if it were published to a registry. That is intended: it is `private`. The scope `@callibrator` is unregistered on npm. The lockfile pins the package as a `link`, so `npm ci` never looks at the registry, but a future `npm install` of a misspelled name in that scope would.
- **The frontend typechecks the package under its own looser settings, and the backend under its strict ones.** Code in the package must satisfy both, and the package's own typecheck uses the stricter set.
- **Changing a contract schema now changes the frontend's types.** That is the point, and it will make a backend-only schema change a two-workspace change in review.
- **`build:dist` owns `dist/node_modules/@callibrator/contracts`.** It removes and recreates only that directory. Anything else placed in `dist/node_modules` is left alone.
- **The Docker frontend build type-checks the package source.** The frontend allow-list must keep `packages/contracts/src`, and a test file added to `src/` is excluded by the `**/*.test.*` rule. The image has no jest types, the same trap as `frontend/src/tests` on 2026-09-27.
- **Response schemas are not in this slice.** `Vendor` and `Device` are still hand-written beliefs. The device service's `data.rows` fallback is exactly the kind of shape a response schema would pin (CLAUDE.md § The Response Envelope).

### Evidence

Recorded in `MEMORY/records/2026-09-29-p9-22-contracts.md`.

### Amendment 1 (2026-10-01) — nine more domains; constants canonical in the package; one envelope; the frontend's request types are ADR-103's generated contract

**1. The package owns the schemas, and ADR-103 owns the frontend's form of them.** P9-25 (ADR-103, owner-decided) generates `backend/openapi.json` code-first from the same Zod schemas `validate()` enforces, and generates the frontend's types from it (`openapi-typescript` → `frontend/src/api/generated/schema.d.ts`, `openapi-fetch`). ADR-103 item 11 names those generated `paths` types as a migrated service's canonical request types. The coordinator ruled (2026-10-01) that the two are layered, not rivals:
- `@callibrator/contracts` holds the **schemas**. The backend `validate()` and the `<route>.openapi.ts` modules reference them.
- On the frontend, a service's request types are the generated `paths` types once its route module is code-first (P9-25 with P9-20/P9-21).
- `z.input` from the package is the **interim** form until then. No further service is converted to `z.input`. The eight already on it (the first slice's `device`, and this round's `warehouse`, `stock`, `maintenance`, calibration records, `user`, `roles`) move to the generated types with their routes. `vendor.service.ts` already has (ADR-103's pilot).

This amends decision 5 and the P9-22 plan's step 2. Decision 5's "the frontend infers" is superseded by ADR-103 item 11 for every code-first route.

**2. Nine more domains moved** (`warehouse`, `stock`, `maintenance`, `calibrationRecords`, `user`, `roles`, `certificate`, `qms`, `tenant`). Each body moved byte-identical (diffed against copies saved before the move), except that three import paths now point at the package's own constants (item 3). Each backend validator became a named re-export of the same objects. No importer changed. `z.input` / `z.output` types were added per schema.

**3. Constants the schemas read are canonical in the package** (the Phase 9 lead approved it). `DEFAULT_LIMIT` / `MAX_LIMIT` (`pagination.ts`), `NC_STATUSES` / `NC_SEVERITIES` / `CAPA_STATUSES` with their types (`qmsValues.ts`), and `STORED_LOGO_NAME` (`tenantLogo.ts`) are defined in the package. `backend/src/constants/appConstants.ts`, `qmsConstants.ts` and `tenantLogo.ts` re-export the **same bindings**. `QMS_NUMBERING` stays in the backend (SQL identifiers). `test/constants.test.ts` asserts `===` identity and that the arrays are frozen. `enumMirrors.d26` passes unchanged: it requires the constants modules, and those now hand out the package's arrays. The models (`capa`, `nonConformance`) now load the package, which `load:check` proves in dist mode through `dist/node_modules`.

**4. The barrel stops at the first slice.** Domain modules reuse names (`calibrationDeviceIdSchema` is in two of them, `updateRoleSchema` in two), so later domains are imported by subpath only.

**5. One envelope.** P9-25 wrote Zod envelope schemas for the OpenAPI document (`backend/src/docs/openapi/envelope.ts`). P9-22 had written a second set for the types. They are now **one** set, in `packages/contracts/src/envelope.ts`: P9-25's `PaginationMeta`, `envelope`, `listEnvelope`, `emptyEnvelope`, `ErrorEnvelope` and `RateLimitBody`, moved verbatim with their `.meta()` annotations. The backend `ApiSuccessResponse` / `ApiListResponse` / `ApiErrorResponse` / `ApiResponse` types are built on them.
- `backend/src/docs/openapi/envelope.ts` re-exports the schemas and keeps only the OpenAPI error-response components.
- `backend/src/types/apiResponse.ts` re-exports the types (the ADR-087 amendment the lead is placing).
- **Pagination is required, the generic `meta` is not.** This follows what the code emits, not taste. A paginated list's `meta` requires `total`, `page`, `limit` and `totalPages`: exactly what `response.util#paginate` returns and every paginated service builds. A success body's own `meta` stays optional (`meta?: object`), as `success()` sets it only when given.
- `test/envelope.test.ts` parses the real `success()` / `error()` / `paginate()` output. It refuses `data.rows`, `data.meta`/`items`, a list without `meta` and a partial `meta`.

**Evidence (2026-10-01):**
- **`openapi.json`.** `npm run openapi:generate`: "417 operations, 12 code-first", and the output is **byte-identical** (`cmp`) to the file before the envelope move. `openapi:check`: current. `openapi:lint` (Spectral): "no new error; 18 baselined legacy error(s)". `openapiRoutes.p925` 11/11. The P9-25 route suites (`--testPathPatterns "openapi|apiDocs|p925|p608|response.util|envelope"`): 147 passed, and 1 failed in p608 (below).
- **Package.** 379 tests, 100/100/100/100 over 19 modules. Typecheck and lint clean.
- **Backend.** Typecheck 0 errors. Contract, validator, model and guard suites: 116 suites, 2,334 tests. `--testPathPatterns "certificate|qms|tenant|capa|nonConformance|pagination|appConstants|constants"`: 149 suites passed, 1 failed (`0067-foreign-key-and-tenant-indexes`, other lanes' `api_key_id` indexes).
- **Build and load.** `build:dist` on the live tree: "186 JavaScript files copied, 363 TypeScript files compiled", then "@callibrator/contracts, 19 TypeScript files compiled". `load:check` OK in src (tsx) and dist (node) modes. In dist, `qmsConstants.NC_STATUSES === ` the compiled `dist/node_modules/@callibrator/contracts/qmsValues.js`'s.
- **Frontend.** Typecheck clean. The six services' suites and dashboards: 25 suites, 310 tests.
- **Found, not mine, left to its lane:** p608 "rest of the tree" fails on `PATCH /api/v1/roles/:id`: "accepted by the validator but undocumented: nameToShow, roleLevel". `updateRoleSchema` gained those fields under F-19 / ADR-105 before this move (the copy saved before the move has them), and neither the route's JSDoc nor `swaggerValidatorAlignment.knownDrift.json` was updated.

**Implications, including the bad ones.**
- The backend's constants modules for pagination, QMS values and the logo pattern are now thin re-exports. An edit to the value belongs in `packages/contracts`, and a developer editing the backend file finds only a pointer.
- Every model that reads QMS constants loads the package, so a broken package build now breaks model loading, not only validation. `load:check` in dist mode is the gate that catches it.
- Two forms of frontend request type (interim `z.input`, canonical generated) coexist until every route is code-first. A reviewer must know which one a service is on; each service file says so in its header comment.
- The package now carries OpenAPI documentation text (`.meta()` descriptions and examples). That is harmless on the frontend, where it is data only, but it makes the package the place those descriptions are edited.

### Amendment 2 (2026-10-01) — every request schema but two lives in the package; the two that stay, and why

**1. 40 of 42 validator modules are in `@callibrator/contracts`.**
- **The 29 moved this round:** `auth`, `billing`, `calibrationDeviceReinstate`, `content`, `customDomains`, `dataRetention`, `eSignature`, `featureFlag`, `finance`, `gdpr`, `kanban`, `menuGroup`, `meteredBilling`, `notification`, `oidc`, `scim`, `session`, `sso`, `storage`, `tenantBackup`, `tenantHierarchy`, `tenantLifecycle`, `ticket`, `webhook`, `workflow`, `iot`, `webauthnCredential`, `publicAuth`, `accessRequest`.
- **How they moved:** each body moved byte-identical (diffed against copies saved before the move, with the one rewritten import path allowed for). Each backend `validators/<d>.validator.ts` is a named re-export of the same objects.
- **The import rewrites:** `publicAuth`'s import of `./auth.validator` became the package sibling `./auth`. `accessRequest`'s import of `../constants/accessRequest` became `./accessRequestValues` (item 3).
- **One tree change the move carried:** `iot`'s tree state vs `HEAD` is P9-11's own Joi → Zod change (ADR-093), which the P9-11 helper had declared settled.

**2. Two modules stay backend-only, decided with the Phase 9 lead:**
- **`networkSecurity.validator.ts`** checks addresses with Node's `net.isIP`. The package loads in the browser and uses no Node API (decision 1). A hand-written IP parser is where parsing edge cases hide, and replacing `isIP` is a behaviour question, not a move.
- **`admin.validator.ts`** reads `isRedactedSettingKey` from `constants/tenantSecretSettings`. That module is the backend's encryption policy: it decides which `tenant_settings` values the TenantSettings model seals as KMS envelopes (S-20, migration 0035). It must not ship in a package the frontend bundles, or be edited as a "contract".
  - Its functions would also become re-exported bindings, which `jest.spyOn` cannot redefine.
  - Its route (tenant flags, operator-only) has no frontend reader.

**3. One more canonical constant set.** `accessRequestValues.ts` holds the four access-request ENUM vocabularies (`FACILITY_TYPES`, `DEVICE_COUNT_BANDS`, `REQUEST_LOCALES`, `ACCESS_REQUEST_STATUSES`) and their types. `backend/src/constants/accessRequest.ts` re-exports the same arrays and keeps the retention and cap numbers, and `test/constants.test.ts` asserts `===`. The model, migration 0099 and the service now read the package through that module.

**4. The package's own gate follows the move.** Its jest `testMatch` runs every backend validator suite (not networkSecurity's, which loads the backend configuration) plus `test/`. `test/accessRequest.test.ts` restates the access-request schema expectations, because their only backend suite (`phase10.units.p1005`) needs the whole backend and an in-memory database.

**5. p608 fixed in `roles.route.js` JSDoc, not in `roles.openapi.ts`.** `PATCH /roles/:id` now documents `nameToShow` and `roleLevel` (added to `updateRoleSchema` under F-19 / ADR-105). ADR-103 item 12 has a module's code-first docs ride with its P9-20/P9-21 conversion, and `roles.route.js` is still JavaScript. `openapi.json` differs from before only by those two properties, and `frontend/src/api/generated/schema.d.ts` was regenerated.

**Evidence (2026-10-01):**
- **Package.** 1,057 tests, 44 suites, 100/100/100/100 over 49 modules. Typecheck and lint clean.
- **Backend.**
  - Typecheck: 0 errors.
  - ESLint on `src/validators/` and `constants/accessRequest.ts`: clean.
  - Contract, validator, model and guard suites: 116 suites, 2,334 tests.
  - Domain sweep (`--testPathPatterns` over scim, sso, session, auth, oidc, webauthn, passkey, accessRequest, p1005, iot and every other moved domain, plus p608, openapi and p925): **324 suites, 6,010 tests passed, 0 failed**. That includes the P9-12 identity suites the lead named.
- **Build and load.** `build:dist` on the live tree: "185 JavaScript files copied, 364 TypeScript files compiled", then "@callibrator/contracts, 49 TypeScript files compiled". `load:check` OK in src (tsx) and dist (node) modes.
- **Contract docs.** `openapi:check` current. p608, `openapiRoutes.p925` and `apiDocs.p925`: 26/26. Frontend typecheck clean, `api:types:check` current.

**Implications, including the bad ones.**
- Nearly every backend request schema is now edited in `packages/contracts`, and a backend developer opening `validators/<d>.validator.ts` finds only a re-export. This is the point of P9-22, and it moves where reviews happen.
- Migration 0099 now reads its ENUM values through the package. The values are identical, but a frozen migration's inputs now live in a shared package. Changing a vocabulary there without a migration that alters the type is still a defect (the rule `qmsConstants` already states).
- Two validator modules stay outside the package on purpose. A future "finish P9-22" sweep must not move them without revisiting item 2.

**Status:** Accepted — first slice implemented 2026-09-29; amended 2026-10-01 (Amendments 1–2).

---

## ADR-104 — A tenant-chosen URL the server calls goes through a pinned, redirect-free SSRF guard; a development allow-list exists and production ignores it

**Date:** 2026-09-29 · **Status:** Accepted, implemented · **Record:** `MEMORY/records/2026-09-29-a176-ssrf.md` · **Cards:** A-176 (open note closed), A-306, A-307

**Context.** `oidc_authority` and `ai_base_url` are tenant-admin settings (A-176's allow-list) that the backend itself fetches: OIDC discovery, JWKS and the token POST, and the AI vendor calls. These calls used plain axios, with no host check and redirects followed. The webhook sender and the S3 driver had `utils/ssrf.util`, but only as a text/DNS check made *before* the HTTP client resolves the host again. The DAST (2026-09-29) reconfirmed the gap.

### Decision

1. Every call to a tenant-chosen URL goes through `ssrf.util`:
   - `assertOutboundUrl` runs first: https only in production; no loopback, private, link-local/metadata, ULA, multicast or reserved host; IPv4-mapped/compatible/NAT64 IPv6 in dotted **and** hex form (A-306).
   - Then axios gets `ssrfSafeAxiosOptions`:
     - agents whose `lookup` refuses any internal answer, so the checked address is the dialled one;
     - `maxRedirects: 0`;
     - `proxy: false`;
     - a timeout;
     - a 2 MiB response cap.
   - The S3 SDK gets the same agents for a tenant endpoint.
2. The URL is also checked **when it is saved** (`PATCH /tenants/settings`): a 400 naming the key; an empty value clears it.
3. The operator's own URLs (`OPENAI_BASE_URL`, a trusted S3 endpoint, alert/ClamAV/MQTT/SMTP env) are **not** guarded. They are legitimately internal and not tenant input.
4. **`SSRF_DEV_ALLOW_HOSTS`** (comma-separated host names), read through `config/env`, lets named internal hosts through **outside production only**. `isProduction()` makes the list empty.
5. The CORS policy moves to `middlewares/corsPolicy.middleware.ts`. A rejected origin is `AppError(403)`, not a plain Error (which was a 500).

### Alternatives considered

| Alternative | Why not |
|---|---|
| Resolve-then-request (the webhook's pattern) | leaves a DNS-rebinding window between the two resolutions |
| Follow redirects and re-validate each hop (`beforeRedirect`) | more code and more ways to be wrong. No legitimate IdP discovery or AI endpoint needs a redirect; a 3xx becomes a clear failure (502 for discovery) |
| An egress proxy or network policy | right as defence in depth, but it is deployment, not code, and it cannot be tested here. Also, `proxy: false` means these calls ignore `HTTP(S)_PROXY`, so an egress proxy would have to be transparent |
| A CIDR allow-list for development | too easy to write `10.0.0.0/8` and ship it. Host names are narrower, and production ignores them anyway |
| https-only in every environment | breaks local IdPs and model servers. Production is where it matters |

### Implications (including the bad ones)

- A deployment whose tenant uses an IdP or AI endpoint on a private network (an on-premises Keycloak, a self-hosted model server) **stops working in production**. The fix is a public, TLS-terminated address. There is no production override, by design; asking for one is an owner decision (it would be an Open Question).
- `proxy: false`: a deployment that reaches the internet only through an explicit forward proxy cannot reach IdPs or AI vendors from these call sites.
- Every AI call now has a 60 s timeout; it had none.
- An IdP whose discovery URL redirects (for example http→https) now fails with 502 instead of following. Configure the final URL.
- ~~The webhook sender still resolves twice (A-307, open).~~ Closed by Amendment 1.

### Amendment 1 (2026-09-30): webhook delivery connects through the pinned lookup (A-307)

**Context.** `webhook.service#attemptDelivery` checked the host with `assertResolvedHostIsPublic` and then sent with Node's `fetch`. `fetch` takes no agent and resolved the host again to connect.

**Decision.** Add `ssrf.util#pinnedFetch(url, init)`. It is fetch-shaped: same init, `{ ok, status }` result, `AbortError` on abort or timeout. Underneath it is axios with `ssrfSafeAxiosOptions`, plus:
- `validateStatus: () => true`;
- `responseType: "stream"`, with the stream destroyed unread;
- an identity `transformRequest`, so the signed body goes out byte for byte.

`attemptDelivery` calls it instead of `fetch`. Everything else is unchanged: the pre-check, signing, headers, `WEBHOOK_TIMEOUT_MS`, the 3xx-as-failure rule, retries and backoff, and the delivery row.

**Alternatives.**

| Alternative | Why not |
|---|---|
| Keep `fetch`, pass an undici `Agent({ connect: { lookup } })` as `dispatcher` | Proven to work on Node 26 with undici 7.29.1. But `undici` is only a transitive dependency (`@scalar/api-reference`, `@yao-pkg/pkg`), and declaring it needed a `package.json`/`package-lock.json` change while other lanes had both in flight. It also mixes the npm undici with Node's bundled one |
| Call axios directly in the service | Every webhook test asserts on a fetch-shaped call. A fetch-shaped helper keeps them unchanged: the doubles forward `pinnedFetch` to `global.fetch` |

**Implications.**
- The request's own headers now come from axios, not undici. It sends `User-Agent: axios/<v>` and `Accept: application/json, text/plain, */*` instead of `node` and `*/*`. Receivers verify the `X-Webhook-*` headers, which are unchanged.
- The `HTTP(S)_PROXY` environment variables are ignored (`proxy: false`), as for the other tenant-chosen URLs.
- A connection refused by the pinned lookup is recorded as `lastError` "SSRF guard: <host> resolves to a disallowed (internal) address". Before, such a request was delivered.



## ADR-106: The Helm Charts Are Validated on a kind Cluster, Not Yet a Production One; the Chart Derives Every Public Origin, Exposes the Seeding Toggle, Rolls the Backend on Configuration Change, Publishes `/health`, and Sizes Its Probes for a Slow Boot

**Date:** 2026-09-30 · **Card:** P7-06 · **Record:** [`records/2026-09-30-p7-06-helm-kind-cluster.md`](./records/2026-09-30-p7-06-helm-kind-cluster.md) · **Extends:** ADR-066 (chart secrets), ADR-081 (probe paths exempt from `FORCE_HTTPS`), ADR-086 (the schema lock)

### Context

The charts had only ever rendered (U-01). P7-06 asked for a real install. None had been possible because no cluster was reachable. On 2026-09-29/30 one was built locally:

- **Cluster:** kind v0.33.0 (checksum-verified), Kubernetes 1.37.0, one node, kindnet, local-path, ingress-nginx v1.15.1.
- **Datastores**, in the cluster, from the digests compose pins: PostgreSQL 18.6 + pgvector 0.8.6, Redis 8.6, RabbitMQ 3.13 and clamd 1.4.
- **Images:** built from HEAD `ce74932`. The working tree could not build while Phase 9 conversions were in flight: first a module present as both `.js` and `.ts`, then TypeScript errors in half-converted validators.

The unmodified chart passed `kubectl apply --dry-run=server` and installed. Its pods became Ready. The backend migrated 63 migrations, verified its schema and switched to `callibrator_app`. But seven things were wrong, and each was found only in the cluster:

1. **`checksum/config` was always `""`.** Nothing set `configChecksum`, so an upgrade that changed only the ConfigMap left the backend on the old environment. In revision 2, `CALIBRATION_SCHEDULER` changed in the ConfigMap but was absent from the running process, and the pod was the same one.
2. **The seeding toggle could not be set.** `ALLOW_SEEDING` was not rendered, so a Helm install on an empty database could not be seeded: `/migration/seeding` answered 401, with no super admin to authenticate.
3. **Three public origins fell back to development addresses.** `FRONTEND_URL`, `OIDC_ISSUER` and `PUBLIC_BASE_URL` were not rendered. `/oidc/.well-known/openid-configuration` advertised `issuer: http://localhost:5000`.
4. **`/health` was not on the ingress.** It fell through to the frontend's 404 page. Compose's nginx publishes it.
5. **Probes used the kubelet's 1 s timeout.** The frontend had no startup probe, so `/` (server-rendered) timed out and Next was killed twice while starting.
6. **The backend startup budget (30 × 10 s) was shorter than `MIGRATION_LOCK_TIMEOUT_MS` (600 s).** Two replicas booting on an empty database were both killed by the kubelet before the schema step finished. A waiting replica is killed before the lock's own, logged bound can apply.
7. **NOTES.txt described the migration race and the Redis adapter as unsolved**, after ADR-086 and A-54 had solved them.

A defect outside the chart was found too: with `FORCE_HTTPS=true`, sign-in through the frontend fails. See Implications.

### Decision

1. **The umbrella ConfigMap derives `FRONTEND_URL`, `OIDC_ISSUER` and `PUBLIC_BASE_URL` from `ingress.host`**, as it already did `HOST_URL`. The ingress serves `/oidc` at the root, so the issuer is the root.
2. **`backend.env.ALLOW_SEEDING` is a value** (default `""`), rendered into the ConfigMap. While it is `"true"`, NOTES.txt prints a warning and the seed-then-unset procedure.
3. **`checksum/config` defaults to the SHA-256 of the backend subchart's own values** (every `backend.*` and `global.*`), unless `configChecksum` is set. It does **not** cover `ingress.host`, `certificates.*`, `alerts.*` or the Secret, and the template comment says so.
4. **The ingress publishes `/health` (`pathType: Exact`) to the backend.** `/live` and `/ready` stay unpublished, as in nginx.
5. **Every probe has `timeoutSeconds`** (`probes.timeoutSeconds`, default 5). **The frontend gets a `startupProbe`** on `/` (`probes.startupFailureThreshold`, default 36 × 5 s).
6. **The backend startup budget is `probes.startup.failureThreshold` × 10 s, default 72 (12 min).** That is above the 600 s lock timeout. Raise the two together.
7. **The status is stated as proven, and no further.**
   - `Chart.yaml` now carries `callibrator.io/validation-status: kind-validated`, at chart version 0.2.0.
   - NOTES.txt, `docs/DEVOPS/09-KUBERNETES.md` and `CLAUDE.md` say "installs on one local kind cluster; not known to deploy on a production cluster".
   - P7-06 is closed against its own Definition of Done, on kind. "Deploys to production" remains U-01, open.
8. **`FORCE_HTTPS` stays `"true"` in the chart.** The sign-in failure is filed as an application defect, not worked around in the chart.

### Alternatives considered

| Option | For | Against | Verdict |
|---|---|---|---|
| Checksum the rendered ConfigMap (`include (print $.Template.BasePath "/configmap.yaml")`) | covers every key | the Deployment is in the subchart, which cannot render the umbrella's template with the umbrella's values | rejected |
| Move the backend Deployment into the umbrella | exact checksum | a structural change to a chart just validated for the first time | rejected for now |
| Only document `kubectl rollout restart` after every upgrade | no template change | the defect is silent; an operator who forgets runs the old configuration indefinitely | rejected; kept only for the uncovered keys |
| Hard-code `ALLOW_SEEDING` in an overlay values file | no new value | there is no first-boot overlay; a value is visible in `helm get values` and warned about in NOTES | rejected |
| Set `FORCE_HTTPS: "false"` in the chart (as the VM overlay does) | sign-in works at once | drops the application layer of HTTPS enforcement, which ADR-081 kept deliberately | rejected |
| Fix the Next auth handlers to send `X-Forwarded-Proto` in this change | the actual fix | frontend code outside this card, under active edit by other agents; it needs its own tests | filed, not done here |
| A startup budget of exactly 600 s | matches the lock | the probe and the lock timer start at different moments, so the waiter and the kubelet would race | 720 s chosen |

### Implications, including the bad ones

- **Not proven:**
  - a managed CNI;
  - a real StorageClass (RWX, snapshots);
  - more than one node (pod spread, drains across nodes). Two backend replicas shared the RWO local-path volumes only because they ran on one node;
  - cert-manager, and an external secrets operator;
  - the prod and staging values files on a cluster. They render and pass kubeconform;
  - an image built from the current working tree, including ADR-099's bootstrap password, which the cluster never ran.
- **Sign-in through the ingress with the shipped `FORCE_HTTPS: "true"` fails.**
  - `frontend/src/app/api/v1/auth/login/route.ts`, `refresh` and `sso-session` fetch `BACKEND_INTERNAL_URL` over HTTP without `X-Forwarded-Proto`.
  - The backend redirects 301 to `https://<service>:3000`, and the fetch fails with a TLS error. The `[...path]` proxy does set the header.
  - The compose prod overlay has the same shape (`FORCE_HTTPS=true`, `BACKEND_INTERNAL_URL=http://backend:3000`), so production compose sign-in is suspect too.
  - The kind run signed in with `FORCE_HTTPS: "false"`, in scratch values only.
- **A backend value change now restarts the backend on upgrade.** That is intended, but it is new: a values-only upgrade that used to leave the pods alone now rolls them.
- **A backend that genuinely hangs at boot is now detected after 12 minutes instead of 5.**
- **Two releases sharing one Redis share the Socket.IO adapter channel**, because Redis pub/sub is not database-scoped. This was noticed, not tested. Give each release its own Redis before sharing one.
- **Part of the kind run's timeouts were the environment, not the chart.** The kind node ran on a Docker Desktop VM shared with other agents' stacks, and load reached 100 on 16 CPUs. That produced API-server and probe timeouts. Findings 5 and 6 stand regardless: they are budgets that a slow node exceeds.

---

## ADR-107: A Signed Certificate Snapshots What It Prints, and a v3 Hash Binds the Snapshot (Q-50)

**Date:** 2026-09-30 · **Status:** Accepted as a **working decision** by the coordinating session, under the owner's delegation to decide by best practice. It **awaits the owner's confirmation**. · **Record:** [`records/2026-09-30-a303-tenant-profile.md`](./records/2026-09-30-a303-tenant-profile.md) § Q-50 · **Extends:** ADR-095 (M-11: the document, the v1/v2 hashes), ADR-100 (A-293: the verification token) · **Answers:** Q-50

### Context

A-303 printed the issuing laboratory's address and contact on certificates, from the **live** tenant row, like the tenant name. ISO/IEC 17025 7.8 (and 7.8.2 for the laboratory's name and address) treats an issued report's content as fixed.

A live read breaks that in three places:
- A tenant rename or move after signing changed an already-signed certificate.
- So did a relabelled device or a renamed person.
- Nothing detected it, because v2 deliberately does not hash live references. Binding a live row would make every rename look like tampering.

### Decision

1. **Snapshot at signing.** `certificate.service#signCertificate` records what the certificate prints, inside the sign transaction after the signer is set, on the new JSONB column `certificates.signed_snapshot` (migration **0103**). It is written by the same save as the signature. The snapshot holds:
   - the issuing tenant's name, email, phone, address, city, state, zipCode, country and website;
   - the instrument's name, serial number, manufacturer and model;
   - the calibrated-by, approved-by and signed-by names.

   `captureSignedSnapshot` (in `certificateDocument.service`) builds it. Its D-27 shape is `Certificate.signedSnapshot`: strict, and versioned (`version: 1`).
2. **v3 scheme `certificate-content-v3`.** The payload is v2's certificate-row fields, in v2's order, then the snapshot in a **fixed key order** (`canonicalSnapshot`), so it binds every printed field.
   - The fixed key order matters because PostgreSQL returns JSONB keys re-ordered: the run below got `device,issuer,version,signedBy,approvedBy,calibratedBy` back.
   - A certificate with a snapshot prints v3, and its authenticated HMAC is over the v3 hash.
   - v3 is never computed for a certificate without a snapshot. `buildContentPayloadV3` throws, so a deleted snapshot cannot pass as v3.
3. **Printing.** A certificate with a snapshot is printed **from the snapshot**, and the document says `contentAsOf: "signing"`. This includes a signed certificate later revoked.
   - Any other certificate (draft, pending, approved, or signed before ADR-107) is printed from the live rows (`contentAsOf: "live"`).
   - A draft, pending or approved certificate carries the frontend PDF's watermark.
   - The PDF adds "Issuer, instrument and signatories as recorded at signing." under the hash of a v3 certificate.
4. **Verification.**
   - The public verdict's `issuedTo` and the full verdict's `device` are what the certificate prints: the snapshot for v3.
   - `integrity.scheme` (already reported, and shown by the verify page's label) names v2 or v3.
   - The minimal verdict still omits device, signer and document (A-293).
5. **No back-fill.** A certificate signed before ADR-107 keeps `signed_snapshot = NULL`: v2, plus v1 as `legacyHash`, printed live and verified exactly as before. A snapshot made now would record today's rows as if they had been the rows at signing, which is an invented fact.

### Alternatives considered

- **Bind the live issuer into v2.** Rejected. It changes every v2 hash already printed, and every later rename would fail verification. This is the reason v2 excluded live names in the first place.
- **Snapshot only the issuer**, as Q-50 was first framed. Rejected. v3 must bind "every printed field", and the instrument and people are printed from live rows too. Snapshotting all printed references is what makes "a rename after signing changes nothing" true for the whole document.
- **Separate columns instead of one JSONB.** Rejected: 16 columns for one immutable record. One strict, versioned JSONB with a D-27 shape is smaller, and `version` leaves room for a v2 snapshot shape.
- **Also persist the v3 hash or its HMAC at signing.** Not done. The printed hash is the external anchor: the holder compares it with the hash the verification page recomputes, and a database edit changes the recomputed one. Persisting an HMAC would additionally detect a *coordinated* edit of the row and the stored hash. That is A-241's open question (the HMAC is "neither persisted nor verifiable by a third party"). It is not decided here.
- **Back-fill snapshots for signed certificates.** Rejected; see decision 5.

### Implications, including the bad ones

- **The Part 11 e-signature record's `documentHash` is unchanged.** It is `certificate.service#logSignature`'s own SHA-256 over id, number, device, record, status and signature, and it does not bind the snapshot. The v3 hash does. Aligning the two is a later decision, not taken here.
- **A `down` of 0103 on a database that has signed with v3 drops the snapshots.** Those certificates then have no v3 hash to recompute, and their printed v3 hash cannot be re-verified. The down is a data loss, as the migration header says.
- **A certificate signed after ADR-107 prints v3.** A holder of an older printout of the same certificate, made while it was a draft, has a v2 hash that no longer matches. Such a printout was never an issued certificate: it was watermarked.
- **The snapshot freezes the issuer data at signing.** A correction to the issuer afterwards is not shown on already-signed certificates. That is the point; reissue is the route (revoke, then a new certificate).
- **Existing unit suites that double the whole models barrel** (`certificate.service`, `certificate.audit.a41`, `certificate.transitionLock.a167`, `webhookEmit.a11`) now stub `captureSignedSnapshot`. The real snapshot is exercised by `certificates.signSnapshot.q50` on the real models.

### Evidence

- `tests/services/certificateDocument.snapshot.q50.test.ts` (10 tests), with an independent, hand-written oracle for the v3 payload:
  - a rename, move, relabel or person rename after signing changes nothing;
  - tampering with any snapshot key changes the v3 hash;
  - the result does not depend on JSONB key order;
  - a v2 certificate's hash and HMAC are still computed the old way (independent oracle).
- `tests/routes/certificates.signSnapshot.q50.test.ts` (8 tests), through the real router and service on `memoryDb`:
  - the sign step stores the snapshot in its transaction;
  - the document prints v3 from it, unchanged by later renames;
  - the public verification reports v3 and the as-signed issuer and instrument;
  - an old signed certificate stays v2 with nothing written;
  - a refused signing stores nothing.
- `tests/migrations/0103-certificate-signed-snapshot.test.ts` (6 tests), including "back-fills nothing".
- **PostgreSQL 18.6** (a disposable container):
  - up added `signed_snapshot jsonb`, nullable;
  - a second up was a no-op;
  - an already-signed row kept NULL;
  - a JSONB round trip re-ordered the keys, and the v3 hash was equal;
  - down removed the column.

---

## ADR-103: The API Contract Is Generated Code-First From the Zod Schemas `validate()` Enforces; Scalar, Self-Hosted and Behind Sign-In, Replaces Swagger UI; CI Fails a Stale, Invalid or Breaking Contract and a Route With No Document

**Date:** 2026-09-30 · **Card:** P9-25 (WIP: foundation done; per-route migration rides with P9-20/P9-21) · **Decided by** the owner (brief: `MEMORY/specs/P9-25-owner-brief-api-contract.md`, binding) · **Spec:** `MEMORY/specs/P9-25-api-contract-code-first.md` · **Record:** `MEMORY/records/2026-09-29-P9-25-api-contract-foundation.md` · **Works with** ADR-093 (Zod validators), ADR-097 (`@callibrator/contracts`), ADR-087 (ratchet), P7-08 (CSP split), S-23/A-253 (`SWAGGER_ENABLED`)

### Context
- As built: 417 `@swagger` JSDoc YAML blocks in 55 route files → `swagger-jsdoc` → `swagger.json` → Swagger UI at `/docs`, **unauthenticated** wherever mounted (off in production unless `SWAGGER_ENABLED=true`). Every request body was written twice, as a Zod validator and as uncompiled YAML. P6-08 caught body drift after the fact and pinned 20+ divergences.
- Swagger-jsdoc drops a block with broken YAML **silently**: the route disappears from the contract (found here on `PATCH /tenants/edit`).
- Four JSDoc `$ref`s named components that do not exist; oasdiff cannot even load such a document.

### Decision
1. **Source of truth: the Zod schema.** A route module `routes/api/<name>.route.*` gets a sibling `<name>.openapi.ts` that default-exports `defineRouteDocs({ router, mount, tag, tenantScoped, operations })` (`src/docs/openapi/operation.ts`). Each operation names the **same schema object** its `validate()` mounts (from `validators/` or `@callibrator/contracts`). Library: **`zod-openapi` 6** (Zod 4 native `.meta()`, OpenAPI **3.1**). `DocumentedOperation.success` is `data` / `list` / `empty` (200/201; 202 empty added by the Phase 10 lane for the neutral intake).
2. **Responses are the envelope** (`src/docs/openapi/envelope.ts`): `{ success, status, message, data }`; a list adds a top-level `meta` beside `data`. Standard error responses 400/401/403/404/409/429 as components with examples; 404 carries the cross-tenant rule, 409 the state explanation. The 429 body is documented **as it is** (not the envelope — a recorded gap, see Consequences).
3. **Operation metadata:** `x-permission` (the gate), `x-audited`, `x-rate-limit` (the global limiter's values, pinned against `index.js` by a test), `x-source`, `x-public` for a route with no auth. A `:param` operation on a tenant-owned resource carries the "another tenant's id is 404" note.
4. **`x-permission` cannot lie — by test, not by construction.** It is declared in `.openapi.ts` and **compared with the mounted chain** by `tests/guards/openapiRoutes.p925.test.ts`, which tags `dynamicAccess`/`rbac` before any router loads (the P6-04 technique) and fails when the declaration differs from the chain's gate, or `security` from the chain's `auth`.
5. **The published document** = code-first ∪ remaining JSDoc (`scripts/openapi/build.ts#buildDocument`). JSDoc is normalised 3.0 → 3.1 (`nullable`, boolean exclusive bounds). An operation documented both ways, or a component defined twice differently, **fails generation**. Broken JSDoc YAML fails generation (`failOnErrors: true`).
6. **Committed, not regenerated on build.** `npm run openapi:generate` writes `backend/openapi.json` (deterministic: sorted keys, `servers: [{url: "/"}]`). `npm run openapi:check` fails when it is stale — in `npm run build`, the Dockerfile (replacing `swagger:generate`), `make openapi` (in `verify`) and CI. `swagger.json`, `docs/swagger.js`, `utils/generateSwagger.util.js` and `swagger-ui-express`/`swagger-ui-dist` usage are removed.
7. **Gates** (`make openapi`, CI job `api-contract`):
   - **Spectral** (`backend/.spectral.yaml`, `@stoplight/spectral-cli`): code-first operations at ERROR (operationId, summary, tags, security declared, `x-public` when public, `x-permission` when secured, `x-audited`, `x-rate-limit`, 404 on a `{param}` path, path-parameter examples, error-component examples); legacy JSDoc at WARN. Legacy ERRORs sit in a **shrink-only** baseline (`openapi.spectral-baseline.json`, 18 on 2026-09-30): a new one fails, a fixed one must be deleted. A code-first error is never baselined.
   - **oasdiff 1.32.1** (checksum-pinned in CI): `breaking` against `origin/main`'s `openapi.json`, `--fail-on ERR`. Without the binary locally the script prints **SKIPPED** and exits 0 — never a pass it did not run. The first commit (no base file) is reported and skipped.
   - **Route-without-doc guard** (`openapiRoutes.p925`): every mounted route has an operation, or is in `openapiRoutes.undocumented.json` — a shrink-only list of the routes with no document when P9-25 landed (76), with its reason.
   - **Frontend types current:** `npm run api:types:check` (openapi-typescript `--check`).
8. **Docs UI: Scalar** (`@scalar/api-reference`, MIT), **self-hosted**: the page (no inline script), `assets/scalar.js` (the package's standalone bundle; shipped beside the binary as `docs-ui/scalar.standalone.js` by the Dockerfile) and `assets/init.js` (fonts, telemetry, persisted auth, AI agent and MCP off). CSP `API_DOCS_CSP_DIRECTIVES`: same-origin script/style/font/connect only, **tighter** than the API default (no `https:` style/font origins).
9. **Behind sign-in.** `routes/internal/apiDocs.route.ts`: `auth → denyApiKey → rbac([TENANT_ADMIN])` on every path — the gate of the other developer surfaces (API keys, webhooks); the super admin passes by rbac's bypass; an API key never. Mounted by `src/docs/apiDocs.ts` at `/docs`, `/docs.json` and **`/api/v1/docs`** — the last is how a browser gets in: the backend authenticates by Bearer only, and the frontend's `/api/v1/[...path]` proxy turns the session cookie into it (`proxy.ts` does not set its CSP on `/api`, so the backend's policy reaches the browser).
10. **`SWAGGER_ENABLED` keeps its name and defaults** (on outside production, off in production unless `true`; `false` off everywhere) and now means "mount the **signed-in** reference". No setting publishes the contract anonymously. `/documentation` and `/standards` (A-253) are unchanged: same switch, still unauthenticated where mounted.
11. **Frontend client:** `openapi-typescript` (types → `frontend/src/api/generated/schema.d.ts`, `npm run api:types`) + `openapi-fetch` (`frontend/src/api/typed.ts`). Its transport is the existing `api.*` (axios) — refresh-once on 401, the password-change/MFA redirects, the access-denied store and F-07's normalised rejection are unchanged, and page tests that mock `@/api/client` keep working. `vendor.service.ts` is the pilot; its request types are the contract's (the canonical form), not `z.input`.
12. **Migration is per module with Phase 9:** a route converted under P9-20/P9-21 moves its docs to `.openapi.ts` and deletes its JSDoc in the same change. Pilot: `vendor` (6 operations); P6-08's two vendor `KNOWN_DRIFT` entries are gone. The Phase 10 lane already wrote `accessRequests.openapi.ts` and `authPublic.openapi.ts` on this API.

### Alternatives considered
- **Design-first YAML** (hand-written `openapi.yaml`, code generated or validated against it). Rejected by the owner: a third copy of every shape, and the Zod schema already is the enforced contract; YAML drift is exactly what P6-08 kept finding.
- **Keep swagger-jsdoc** and strengthen P6-08. Rejected: the comment stays uncompiled and every shape is still written twice; P6-08 compares keys only, never types, enums or bounds.
- **`@asteasolutions/zod-to-openapi`**: registry-based, Zod-3-era API (`extendZodWithOpenApi` patches the prototype), OpenAPI 3.0 by default. Rejected for `zod-openapi`, which uses Zod 4's native `.meta()` and targets 3.1.
- **Zod 4's native `z.toJSONSchema`** with a hand-built OpenAPI wrapper. Rejected: we would re-implement parameters, component reuse, input/output splitting and `$ref` handling that `zod-openapi` already does on top of the same function.
- **Deriving `x-permission` at generation time** by monkeypatching the gate factories: works under jest (Babel CJS exports are writable) but NOT under `tsx`, whose esbuild CJS output defines exports as getters — the patch silently fails, and it would break again when P9-19 converts `dynamicAccess` to `.ts`. **Tagging the factories in production code** (a non-enumerable symbol on each middleware) was the other route; rejected for now because `dynamicAccess`/`rbac`/`validation` are being converted by other lanes, and a declared-then-verified value gives the same guarantee (a lie fails CI).
- **Public docs**, **Swagger UI kept**, **Redoc**: public is refused by the owner; Swagger UI needed `swagger-ui-dist` and loads its assets as several files with inline styles; Redoc has no "try it". Scalar was the owner's choice.
- **An `/api/v1/docs` page in the Next app** (rendering Scalar's React component): rejected for the foundation — it moves the reference into the frontend's nonce CSP and bundle; the proxy path achieves "behind the app's sign-in" with no frontend page.

### Consequences
- **Good.** For a code-first route the published request body cannot differ from the enforced one; a new route with no document, a wrong `x-permission`, a stale `openapi.json`, broken JSDoc YAML, a dangling `$ref`, a new Spectral error and a breaking change each fail CI. The contract is no longer readable anonymously. The frontend gets compile-time paths/bodies for migrated services.
- **Bad, and open.**
  - **Heavy dependency:** `@scalar/api-reference` pulls ~430 packages (Vue, the AI SDK). Its `ai`/`@ai-sdk/*`/`undici` versions carried advisories; **root `overrides` scoped to `@scalar/api-reference`** lift them (`npm audit` 0). Those overrides must be revisited on every Scalar upgrade. Only the 4.4 MB standalone bundle ships in the image.
  - `openapi-typescript` 7.13 declares `peer typescript ^5.x`; a root override pins it to the TypeScript 6 compatibility package — it only needs the API.
  - `x-permission` is declared-and-verified, not derived; `x-audited` is declared and **not** verified (the P6-11 audit guard covers the behaviour, not this flag).
  - The published request body is the schema's **input** side, rendered canonical (a number, an ISO date string); the validator also accepts lenient forms. Stricter than the validator, never looser.
  - The global limiter's 429 body is `{ status: "Error", message }`, **not the envelope** — documented as it is; fixing it is a behaviour change (BACKLOG).
  - The vendor contract exposed two gaps: `notes` is accepted and **not stored** (no column; Q-52), and `rating` is not accepted on create (Q-37).
  - The legacy half still has 76 undocumented routes (several are JSDoc under the **wrong path**, e.g. `/api/v1/e-signature` for the `/api/v1/esignature` mount, `/api/v1/oidc` for `/oidc`), 18 Spectral errors and ~936 warnings (382 missing operationIds). They shrink module by module.
  - oasdiff has never run against a base on `main` (there is none until this lands) and CI has never run on GitHub (P7-01).
  - Swagger-jsdoc's YAML is still parsed at generation; the JSDoc half goes when the last route moves.

---

## ADR-108: The Phase 10 Backend as Built — Access Requests, the Invitation, Identifier-First Discovery, the SSO Start, Passwordless Passkeys and the Registration Flag, With Their Deviations From the Specs

**Date:** 2026-09-30 · **Status:** Accepted (as built; **Amendment 1**: several passkeys per user). It inherits the ADR-098 §8 working decisions Q-42, Q-44, Q-45 and Q-46, which **still await the owner's confirmation** · **Cards:** P10-04 (backend), P10-05, P10-07, P10-10, P10-12, P10-15 · **Amends:** ADR-059 (7: operator MFA), the A-160 rule "a passkey does not count" · **Migrations:** 0099, 0100, 0101 · **Record:** `MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md`

### Context
The specs `MEMORY/specs/P10-05-request-access.md` and `P10-10-passkey-login.md` and the doc 20 §7.2 outline were written before implementation. Building them against the code of 2026-09-30 exposed places where the spec named a mechanism that no longer fits, or left a choice open. Following the deviation protocol, each divergence is recorded here, and the spec documents point to this ADR.

### Decision (what was built)
1. **`access_requests`** (model `AccessRequest`, migration **0099**). It has no tenant column, and the link is `provisioned_tenant_id`, as the spec says. Two things differ from the spec:
   - **The tenant link is not a model reference.** Every model foreign key to `tenants` is a Q-16 tenant column (RESTRICT, NOT NULL, `tenantId`). `tenantForeignKeys.a88` and `associationForeignKeys.a148` hold that rule, and a nullable SET NULL link from a platform table would contradict it. So 0099 adds the constraint on both paths: `access_requests_provisioned_tenant_id_fkey` → tenants, ON DELETE SET NULL. The model has no `provisionedTenant` association.
   - **The invitation columns live on the request row:** `invitation_token_hash` (unique, partial), `invitation_expires_at`, `invitation_sent_at` and `invitation_accepted_at`.

   D-20 indexes cover all three foreign keys. `status` + `decided_at` carry a CHECK (BR-P10-3). There is **no** unique `work_email`.
2. **The invitation token is 256 random bits, not a JWT purpose token.** Only its sha256 is stored. The spec said "the pattern of `generatePurposeToken` / `activationClaims`", but the P10-15 DoD needs a token that can be spent **once** and re-issued, which invalidates the old one. A stateless JWT does neither without a store, and the request row is that store. Being no JWT, it can never be accepted as an access, activation, MFA or password-change token, nor any of those as it. That abuse case is closed by construction.
3. **Approval runs in ONE transaction under `FOR UPDATE`.** It calls `tenant.service#createTenant`, which gains a 4th parameter `{ transaction }`: with it, createTenant never finishes the outer transaction and writes the cache in `afterCommit`. Approval also creates the first administrator: a random bcrypt hash nobody holds, `isEmailVerified: false`, and `HEALTHCARE ADMIN` (or `CALIBRATOR ADMIN` for a calibration lab). Then come the invitation, the request update, and the APPROVE, CREATE Tenant and CREATE User audit rows. The email goes out after commit, on `emailLinkOrigin()` (A-289).
   - **An address already held by an account is a 409** with a state explanation, from `user.service#assertIdentityFree` (A-128). It is **not** held to A-128's per-administrator conflict budget: only the super admin reaches this route, and a super admin can list every account, so the 409 discloses nothing.
   - **`maxUsers` is not accepted.** The Tenant model has no such column (A-303), and the seat limit is `limitSeats`, the multipart-sanitizer lane's change.
4. **The public intake is guarded by an ADR-100 `requestBudget("accessRequest")`, 5 an hour per address, not by `endpointRateLimiter`.** The security lane's reason: a request budget counts every request and keys only what is asked. The same holds for `loginDiscover`, `passkeyLogin` and `invitationAccept`; the SSO start shares `ssoStart` with `/sso/login` and `/sso/oidc/login`. The passkey spec's `authPreCheck("passkeyLogin")` is replaced by the budget **plus** the account's A-185 sign-in throttle. That throttle is checked before verification and counted on every failure against a known credential, so passkey and password guessing share one ceiling.
5. **Configuration lives in `config/publicAccess.ts`** (through `env.ts`'s helpers), not in `env.ts` itself. The variables are `SELF_REGISTRATION_ENABLED`, `ACCESS_REQUEST_NOTIFY_EMAIL` and `ACCESS_REQUEST_IP_PEPPER`. The pepper is required in production: the access-request route module refuses to load without it, so boot fails.
6. **The queue page is `/dashboard/access-requests`, not `/dashboard/admin/access-requests`.** The dashboard has no `admin/` segment, and `menuGroup.service#mapSlugToPath` maps the slug `access-requests` there by default. The menu slug goes to SUPERADMIN only (ROLE_MENU_ASSIGNMENTS, the seed, migration **0101**, `MENU_PAGE_GATES` = super admin).
7. **Retention (Q-42)** is `accessRequest.service#runAccessRequestRetention`, run by the nightly retention scheduler after the tenant sweep, batched at 500 rows, and audited as `system:access-request-retention`. A failure there fails the run.
   - **DSAR erasure by address** is `POST /admin/access-requests/erasure` on the admin router, not the GDPR router: the GDPR router keys on a user, and a requester may have none. It deletes the requests that never became a tenant and masks an approved one.
8. **P10-12:** when `SELF_REGISTRATION_ENABLED` is off (the production default), a gate first in the register chain calls `next("router")`, so the request answers the application's own `404 Route not found`, as an absent route does. It runs before the budget, any lookup, any write or any mail. Where registration is enabled, a new address, a taken email and a taken username get one answer, `202 "If the address can be registered, an activation link has been sent"`. A taken case still pays for the bcrypt hash (timing), and writes and mails nothing.
9. **P10-10 passkey sign-in.** It uses a ceremony-bound, single-use, 120 s challenge (`GETDEL`) and no `allowCredentials`. The credential is looked up once with `skipTenantScope`, and 0100 makes the credential id unique. It requires user verification, checks the user handle, and refuses and audits a counter regression. The counter is checked by our code (library counter 0), so a regression is refused **and audited**. The audit actor is `system:auth-lockout`, with the account as the resource (the A-126 rule).
   - **The shared post-credential path** is `auth.service#assertMaySignIn` + `completePasswordlessSignIn`, extracted from `loginUser` with no behaviour change.
10. **Q-46 (working decision), amending ADR-059 item 7 and A-160.** A session whose `amr` is `passkey` satisfies P6-07's operator-MFA rule and every tenant MFA policy (`mfaPolicy#isMultiFactorMethod`). A user-verifying passkey is possession of a device-bound key plus the biometric or PIN that unlocks it, and the signature is bound to the origin: phishing-resistant multi-factor (NIST SP 800-63B). An account that signed in with a **password** gets nothing from an enrolled passkey; A-160's reason for that still holds. No TOTP step follows a passkey.
11. **P10-04.** An SSO email-domain claim is a `tenant_settings` key, `sso_email_domains`, written only by the super admin (`GET`/`PUT /admin/tenants/:id/sso-domains`). It is not in `TENANT_ADMIN_SETTING_KEYS`, so no tenant can claim a domain. A domain has at most one claimant, and public mailbox domains are refused.
    - **Discovery answers by domain only.** An SSO that cannot start falls back to the password step.
    - **`POST /auth/sso/start`** is `sso.controller#startSsoFor`. It chooses OIDC when an OIDC client is configured, else SAML, and answers every refusal, including an unreachable IdP, with the A-292 404.

### Alternatives considered
- **A JWT invitation token** with a `jti` deny-list in Redis. Rejected: two stores for one fact, and a Redis flush would make a spent token valid again.
- **A second tenant-creation path inside the approval.** Rejected by the spec's abuse case: the outer-transaction option keeps one path.
- **Keeping `endpointRateLimiter` / `authPreCheck` as the specs named them.** Rejected on the security lane's advice (item 4). `authPreCheck` counts per user and token, which a pre-authentication ceremony has none of.
- **A model association for the provisioned tenant** with the Q-16 guards widened to allow a SET NULL non-tenant link. Rejected: it widens a guard that exists to stop exactly that shape. The constraint is kept, in the migration.
- **Counting an enrolled passkey as MFA for a password session.** Rejected, as A-160 already reasoned: only the method the session actually signed in with counts.

### Consequences
- **Good.** The public intake says nothing about who asked before. An approval is one transaction, and it is proven on PostgreSQL 18 that two concurrent approvals create one tenant (`accessRequest.p1005.live.test.ts`). An invitation cannot be replayed. A passkey is a full sign-in with the same refusals as a password sign-in.
- **Bad, and open.**
  - A passkey sign-in skips TOTP **for super admins**. If the owner overturns Q-46, `isMultiFactorMethod` must return false and `completePasswordlessSignIn` must hand off to the MFA step.
  - ~~A user has one passkey.~~ Several since Amendment 1.
  - Discovery tells anyone that a claimed domain uses SSO here (the ADR-098 residual).
  - The live E2E (virtual authenticator; submit → approve → accept → sign in) has **not** run.
  - The public `/request-access` and `/invitation` pages are the frontend lead's.
  - The request budget and throttle fail over to process memory when Redis is down (the rate limiter's outage policy), so with N replicas the limits are N×.

### Amendment 1 (2026-09-30): several passkeys per user

**Decided by the coordinator under the owner's delegation** (best practice). A user may hold several passkeys, for example a phone, a laptop and a security key. Each can be named, renamed and removed from the Passkeys page. Removing a passkey must never lock the account out.

- **Storage.** A new table, **`webauthn_credentials`** (model `WebauthnCredential`, migration **0104**), holds the credentials, not the four `users.webauthn_*` columns.
  - Columns: `user_id` → users ON DELETE CASCADE, a unique `credential_id` (the uniqueness 0100 gave the old column; still no oracle, for the reason stated there), `public_key`, `sign_count`, `name`, `transports` (a D-27 shape: the WebAuthn transport names), and `last_used_at`.
  - The table is a **child of its user**, not tenant-scoped by column (unscopedModels.d17, group `child`). Every query names the owning user: the signed-in caller, or the account a credential id names before sign-in.
  - 0104 moves every one-per-user passkey into the table and clears the old credential columns. `users.webauthn_enabled` stays, as the derived "has at least one passkey" flag. Dropping the old columns is a later contract step.
- **Flag off voids everything.** Whoever turns `webauthnEnabled` off, in an instance save, removes every passkey of that user in the same transaction, through a User model `beforeSave` hook: remove-all, an administrator's passkey reset (user.service), a GDPR erasure (gdpr.service). None of those services had to change.
  - A registration after the flag was off purges any leftover row first, so a reset passkey never comes back.
  - The passkey sign-in requires the flag to be on.
- **Routes** (webauthn.route.js, all `auth`, kind `self`):
  - `GET /webauthn/credentials` lists the passkeys, never the credential id or the key.
  - `PATCH /webauthn/credentials/:id` renames one, audited as WEBAUTHN_RENAME.
  - `DELETE /webauthn/credentials/:id` removes one, audited as WEBAUTHN_REVOKE.
  - `POST /verify-registration` takes a `name` and is audited as WEBAUTHN_REGISTER, with the passkey's row id, name and count held — never the credential id or the key.
  - A user may hold at most **10** passkeys.
  - The options exclude the user's own passkeys, and the step-up allows any of them.
- **Another user's passkey id is a 404**, whether it belongs to another user in the same tenant or in another tenant, and nothing is written. The `@two-tenant` test is `webauthnCredentials.twoTenant.test.ts`.
- **The lock-out guard is the A-213 re-authentication.** Removing a passkey needs the current password, plus a current code or recovery code when MFA is on, proven inside the same transaction. The last passkey can therefore only be removed by someone who has just shown that the password sign-in works, so the account can never be left with no way in. Without that proof the answer is a 400 and nothing is removed.
  - Rejected alternative: a separate "is another method usable?" check. Whether an account "has" a usable password is not knowable from the row (random hashes exist for invited, SSO and reset accounts). A proof in hand is.
  - Consequence: a federated (SSO-only) user cannot remove a passkey, because they cannot re-authenticate with a password. They sign in through their IdP; an administrator can reset their passkeys.
- **Alternatives considered.** A JSON array of credentials on the user row: rejected, because it gives no unique index across users and makes the pre-authentication lookup a scan. Several nullable column sets: rejected.
- **Bad, and open.**
  - The old `users.webauthn_credential_id / _public_key / _sign_count` columns remain, empty, until a later contract migration drops them. 0100's index on them stays, harmless.
    - That migration is written and **not registered**: `migrations/pending/drop-legacy-user-webauthn-columns.ts`. It runs after the VM deploy is verified, and is tracked on the P10-10 card.
  - **A half-enrolled legacy credential** (an id with no public key) is dropped by 0104, not moved, because it cannot sign anyone in (decided 2026-09-30 after the live PG18 check). 0104 logs the count; no identifier is logged.
  - A bulk (static) update of `webauthnEnabled` bypasses the purge hook. No code does one; the next registration purges anyway.
  - The step-up sign-count update is not audited separately (the P6-11 lane noted it).
- **Evidence:** `MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md` § Amendment 1.

---

## ADR-105: Role Display Name, Level and Active Are Accepted by the API, Not Removed From the Dialog

**Date:** 2026-09-30 · **Status:** Accepted · **Card:** F-19 · **Record:** `MEMORY/records/2026-09-30-f19-fixes.md`

**Context.** The role dialog (`roles/components/RolesModal.tsx`) offers Display Name, Role Level and Active. The API took only some of them:
- `POST /roles` read name, description and (since A-294) `roleLevel`;
- `PATCH /roles/:id` read name, description and `status`.

So a Display Name was never stored, a level edit answered 200 and changed nothing, and a role could not be created inactive. Worse, the frontend read `isActive`, which the backend never sends (the row carries `status`). Every role therefore showed Inactive, and an edit sent `status: "active"`, silently re-activating an inactive role. All three fields are real `roles` columns (`nameToShow`, `roleLevel`, `status`, `models/role.model.ts`).

### Decision

1. **Wire the fields; do not remove them.**
   - `createRoleSchema` accepts `nameToShow` (≤100) and `status` (`active` | `inactive`).
   - `updateRoleSchema` accepts `nameToShow` and `roleLevel` (integer 1–8, the same bound as create).
   - `roles.controller` passes them through, and `roles.service` stores them. A blank display name is stored as null.
2. **ROLE_LEVELS rules.**
   - A level never exceeds `min(TENANT_ADMIN = 8, the caller's own level)`. The validator refuses a level above 8 (400).
   - The service refuses an edit above the ceiling (403, a permission failure in the caller's tenant) and clamps a create, as A-294 already did.
   - **A system role's level is fixed.** Asking to change it is a **409** with a state explanation ("`X` is a system role; its level (N) is fixed…"), and nothing is written. An unchanged level is accepted and not written.
3. **Audit.** Every change keeps its A-41 audit row inside the transaction, with the level and display name in `before` / `after`. No cache is invalidated for a level change: `rbac()` reads the role level from the principal loaded on each request (`authService.getAuthUserWithTenant`), and the cached permission matrix is keyed by menu grants, not by level.
4. **Frontend.**
   - `role.service` derives `isActive` from `status` and sends every field.
   - The edit dialog sends the level only when it changed.
   - The level input is bounded at 8, and is read-only for a system role.
5. **The house envelope.** `GET /roles` and `GET /roles/menus` now answer a top-level `meta` instead of `pagination`. This was the last named envelope exception; the live contract harness flags `pagination`.

### Alternatives considered

| Alternative | Why not |
|---|---|
| Remove Display Name, Level and Active from the dialog | The columns exist and are read elsewhere (`nameToShow` in the tables and the user role pickers). A role with no settable level fails every privileged gate (the CLAUDE.md trap), and a role that cannot be deactivated from the screen is a gap too |
| Let a system role's level change | The seeded gates (`rbac()` by level) were built around the seeded levels. Changing, say, SUPERADMIN's 10 would lock the platform out |
| 403 for a system role's level | Nothing about the caller's permission is wrong; the role's state forbids it. That is a 409 with an explanation (CLAUDE.md) |
| Keep `pagination` on the role lists | That shape rendered empty lists elsewhere. The frontend services were the only consumers and changed in the same change |

### Implications (including the bad ones)

- A level change takes effect on the **next request** of every holder of the role. There is no confirmation step in the dialog beyond Save.
- The caller-level ceiling is belt-and-braces today, because every role write route is `rbac(["SUPERADMIN"])`: the super admin's 10 is capped at 8 anyway. It starts to matter only if role writes are ever opened to tenant administrators.
- Clients reading `pagination` from `GET /roles` or `/roles/menus` break. The repository has none left (frontend `role.service`, the kanban and permissions fixtures were updated).
- A role created **inactive** grants nothing (`getRolePermissionsMatrix` returns `{}` for a non-active role) until it is activated.

### Amendment 1 (2026-09-30): two follow-ups from the same F-19 pass

1. **Acknowledging an ARCHIVED SOP is a 409.**
   - **Who decided:** the coordinator, under the owner's delegation.
   - **Why:** an archived SOP is no longer in force. `sop.service.ts` `acknowledgeTraining` looked only at the acknowledgement row, so a pending one left from before archiving could still be completed.
   - **Now:** after the not-found and already-completed checks, it loads the document and answers `409 "This SOP is archived and no longer requires acknowledgement."`, writing nothing. The SOP screen already offered the action only on a PUBLISHED document that requires training.
   - **Alternatives:**
     - Hide the button only. Rejected: the UI and the API would disagree, and the API would record training on a withdrawn procedure.
     - Delete or expire the pending rows at archive time. Rejected: it destroys the evidence of who never read it, and no archive transition exists in the API yet.
   - **Bad implication:** pending rows for archived SOPs stay PENDING for ever. A training report must read them as "not applicable", not "overdue".
   - **Doc:** `docs/API/10-QMS-API.md` (SOP section) amended.
2. **The verify instruction names a TXT record.**
   - **The bug:** `customDomains.service.js` `verifyDomain` answered `dnsRecord.type: "CNAME"`, while `checkDnsTxtRecord` resolves a TXT record at `_domain_verify.<domain>`. A tenant who followed the instruction could never verify.
   - **Now:** it says `TXT`. This is a bug fix, not a decision; it is recorded here because this pass found it.

---

## ADR-109: What "Complete" Means for the Phases 0–10 Stop — Rotation Rehearsed on a Restored VM Copy, All 15 Unaudited Services in Scope, Phase 7 on kind With Real Alert and Log Destinations, Phase 8 Recorded Card by Card, Phase 9 Exits on Source (Tests Move to P9-26); Q-51, Q-52, Q-53 and V-13 Decided

**Date:** 2026-09-30 · **Status:** **Working decisions, awaiting the owner's confirmation.** The main (coordinating) session took them under the owner's explicit delegation, *"decide the best recommendation and best practice"*. They have the same standing as Q-39…Q-47 (ADR-098 §8). If the owner overturns an item, it is amended here, not silently reversed · **Cards:** P6-10, P6-11, the P7 exit (P7-02, P7-03, P7-06, U-01), the P8 exit, P9-24, **P9-26 (new)**, Q-51, Q-52, Q-53, V-13 · **Amends:** ADR-087 (the Phase 9 exit "ratchet at zero, tests included"; Amendment 17 there points here) · **Source:** `TASKS/OPEN-WORK-2026-09-30.md` §1 and §6 · **Record:** `MEMORY/records/2026-09-30-board-hygiene-decisions.md`

### Context

The goal is "Phases 0–10 complete, then stop". `OPEN-WORK-2026-09-30.md` §6 lists the items no agent can close, because each needs a decision the owner had not made:
- what counts as production data for a rotation rehearsal;
- which mutations must be audited;
- whether a kind cluster is enough;
- what "complete" means for a phase with no exit;
- whether 693 test files must be converted;
- four contract questions.

The owner delegated these calls. Each one is recorded here with its alternatives and its bad implications, so the owner can confirm or overturn it with the reasoning in front of them.

### Decision

1. **P6-10: the rehearsal target.** Key rotation is rehearsed against **a restored copy of the VM database, taken after the closing deploy**, on a disposable restore and never on the VM itself.
   - For this stop, that restore is the "copy of production data" the DoD asks for.
   - The VM is wiped at the closing deploy (`RUNBOOK-POSTGRES-18-UPGRADE.md` § Owner Decision), so its data is seeded, not hospital data.
   - **A rehearsal on real hospital data is a post-go-live check.** It is owed once the first real tenant's data exists.
2. **P6-11: the covered set.** **All 15** mutating services that write no audit row today are **in scope**: `apiKey`, `kanban`, `ticket`, `vendor`, `warehouse` and the rest, as listed in the addendum to `MEMORY/specs/A-41-audit-inside-transaction.md`.
   - Each one writes its audit row inside its transaction, as the 38 files already covered do.
   - An agent is implementing this. P6-11 closes when the addendum lists all 15 as covered and `auditInTransaction.p611.test.js` still passes.
   - **Amendment 2026-09-30 (working decisions, under the same delegation; [record](./records/2026-09-30-p6-11-audit-coverage.md)).** Implemented. Three allow-list judgements made while implementing it are **accepted**:
     - (a) `notification.service` is **not audited**. A notification is a derived message, and W-04 already writes it beside the caller's own audit row. Read, hide and delete are the user's own inbox state. One row per "mark as read" in the append-only `audit_logs` (0091) would be noise, not attribution.
     - (b) `ai.service#ingestDocument` is **not audited**. It rebuilds a derived RAG index, and its only writer is the `backfillEmbeddings` CLI.
     - (c) `featureFlag.initializeTenantFlags` **without an actor writes no row**. That caller is the development-only demo seeder, which audits none of the demo data it creates. The route passes the principal and is audited.
     - Also decided: the 19 "known gaps" the guard found **outside** the 15 are in scope too, because an audit trail of how a data-subject request was handled is required evidence under GDPR and UU PDP. Of these: GDPR consent, restriction, preferences and DSAR (6), SCIM groups (4), `sop.createDocument`, storage configuration (2), `auth.registerUser`, `sso.provisionUser` and `billing.getSubscription` (a read that creates) are now audited, with no personal data or credentials in the row. `workflow.startWorkflow` is **reclassified**, not audited: each caller runs it inside its own transaction and records `workflowInstanceId` in its own row, and a guard test pins that. Stock (3) was audited the same day by the services helper (A-321; `stock.opnameAudit.p611.test.ts`), so the guard lists no known gap.
     - Alternatives considered: auditing notifications and inbox state (rejected: volume without attribution value), and a second row per workflow start (rejected: it duplicates the caller's row and breaks "one row per mutation"). Bad implication: a deletion from the user's own inbox leaves no audit trace. If the owner wants one, it is one `logAction` in `notification.service#removeForUser`.
3. **The Phase 7 exit.**
   - **"The Helm charts are known to deploy"** is met by **P7-06 on kind** (ADR-106). **U-01** (a production cluster) becomes a **post-go-live** check. The A-310 re-run on kind with `FORCE_HTTPS: "true"` stays in the phase.
   - **"Wakes somebody"** covers a failing job and a failed audit write. It needs a **real alert destination and a real log sink** on the deployment, and both are **owner-supplied values**:
     - `ALERT_WEBHOOK_URL`, `ALERT_EMAIL_TO`, or both. The email route needs a working `MAIL_HOST` / `MAIL_PORT` / `MAIL_USER` / `MAIL_PASSWORD` / `MAIL_FROM`.
     - The log sink's endpoint and credentials for the Vector shipper. `deploy/observability/vector.toml` ships `http://loki:3100`.
   - Both exit lines stay unticked until a failing job and a failed audit write are **seen to arrive** at those destinations.
4. **Phase 8: "complete for this stop".** Phase 8 has no exit and keeps none. For this stop, it counts as complete when every card is recorded in one of these states:
   - **DONE:** P8-03.
   - **Not triggered,** with the measurement: P8-05, P8-06.
   - **Blocked, with the blocker named:** P8-01 (an S3/NFS target and an ambient credential chain) and P8-08 (a residency requirement).

   **The P8-04 re-measure is still owed.** The D-30/ADR-096 query fixes are in, so the p95 is measured again, and a replica is built only if it still fails. Whether the open live checks on P8-02 and P8-07 block the stop is left to the owner.
5. **The Phase 9 exit (amends ADR-087).** Phase 9 exits when **every non-test backend source module is TypeScript** and **`allowJs: false` holds for source**.
   - `tsconfig.build.json` already sets `allowJs: false`, so the build refuses a `.ts` → `.js` import.
   - The existing **`.js` test files** move to a new card, **P9-26**. OPEN-WORK §0 counts 693. On disk on 2026-09-30 there are 696 `.js` files in the test tree, 684 of them `*.test.js`.
   - P9-26 converts them **opportunistically**: when a test is being edited anyway, or when its module's conversion needs it. A conversion never changes an assertion.
   - **The ratchet stays.** It still refuses any **new** `.js` file, **tests included** (ADR-087 Amendment 1, unchanged).
   - The base `tsconfig.json` keeps `allowJs` only so that `typecheck` can read the remaining `.js` tests. It drops it, and the ratchet goes, once P9-26 has emptied the list.
6. **Three contract questions.**
   - **Q-51: a nullable `api_key_id` actor column with an exactly-one CHECK.**
     - The tables and their user columns are `calibration_records` (`performed_by`), `stock_adjustments` (`adjusted_by`) and `stock_transfers` (`requested_by`).
     - On each, the user column becomes nullable and an `api_key_id` FK to `api_keys` is added (ON DELETE RESTRICT).
     - `CHECK (num_nonnulls(<user column>, api_key_id) = 1)` makes every row name exactly one actor.
     - This is being implemented: migration `0105-api-key-actor-columns.ts`; tests `apiKeyActor.q51.test.ts`, `apiKeyActor.q51.live.test.ts` and `rowActor.q51.test.ts`.
   - **Q-52: add a `notes` column to vendors.**
     - A migration adds `vendors.notes`, the model declares it, and a test proves it round-trips through create and update.
     - The contract (`packages/contracts/src/vendor.ts`) stays as it is, which is what makes this the non-breaking choice.
     - **Amended 2026-09-30 (main session, correctness batch — [record](./records/2026-09-30-correctness-batch.md)):** the contract does change, once: `notes` is bounded at **2,000** characters (`VENDOR_NOTES_MAX`). oasdiff reports a new request `maxLength` as breaking; it breaks no working client, because before migration 0106 every value was accepted and silently dropped, so no client can have relied on a longer note being kept.
     - **Corrected 2026-09-30:** the "Alternatives Considered" row below said removing `notes` "throws away a field the vendor form offers". The vendor form did **not** offer it: `VendorModal.tsx` had no notes field, and only the API contract carried it. The form now has a Notes textarea (create and edit, a counter to 2,000), and the vendor list shows the note under the name.
   - **Q-53: the global limiter's 429 answers in the envelope.** The body becomes `{ success: false, status: 429, message, data: null }`, and the response carries `Retry-After` as the other 429s do (A-260). `message` stays in the body under the same key.
7. **V-13: 403.** When an SOP's author tries to publish it, the refusal is **403** with the explanation, not 409.
   - The refusal is about the caller, not the document's state: another user can publish the same document as it is. This follows ADR-101 (a certificate's author may not approve it).
   - An already-published or archived SOP stays **409**.
   - A tenant with a single administrator can then never publish. That case is **Q-54**, an open question for the owner, and no exception is built.

### Alternatives Considered

| # | Alternative | Why not |
|---|---|---|
| 1 | Keep P6-10 open until real hospital data exists | Phase 6 would stay open indefinitely for a reason outside engineering. The procedure has been rehearsed twice, on seeded data and on drill data. A third rehearsal on the post-deploy database proves it on the schema and data shape that will actually run |
| 1 | Rehearse on the live VM database | A failed rehearsal would damage the only deployment. The point of a copy is that it may break |
| 2 | Put only the compliance-bearing subset of the 15 in scope (e.g. `warehouse`, `vendor`, `apiKey`) | `CLAUDE.md` states the rule without qualification: *every mutation writes an audit row*. A covered set chosen by "which ones matter" is the abuse case P6-11 names ("whichever services were easy to change"), and the next auditor would re-ask the question for every service |
| 3 | Require a production cluster for Phase 7 | None exists or is reachable (U-01). The phase would be blocked on an environment, not on work |
| 3 | Count "wakes somebody" as met by the boot log naming the route, or by the local receiver test (`alertRouting.p702`) | A route nobody reads wakes nobody. The local test proves the client, not that a person is reached |
| 4 | Declare Phase 8 complete outright, or keep it open forever | The first hides blocked and untriggered cards behind a word. The second makes "Phases 0–10 complete" unreachable by design |
| 5 | Keep "tests included" in the exit (ADR-087 as written) | Weeks of conversion that changes no production behaviour, at the tail of the phase, with the highest risk of a bulk edit changing an assertion by accident |
| 5 | Drop tests from the ratchet as well | The floor would rise again with every new test. Refusing a new `.js` test costs nothing, and it keeps the list shrinking |
| 5 | Remove `allowJs` from the base config now | `typecheck` could no longer read the `.js` tests that import `.ts` source, so the type gate would lose sight of every test |
| 6 | Q-51: `denyApiKey` on those routes (403) | The integrations that need these writes (an instrument feed recording a calibration, a stock sync) would have no path at all |
| 6 | Q-51: require the body to name a human performer | A Part 11 record would name a person who did not perform the act. That false attribution is worse than naming the key |
| 6 | Q-52: remove `notes` from the schemas | A breaking contract change (oasdiff flags it), and it throws away a field the vendor form offers |
| 6 | Q-53: leave the 429 as `{ status: "Error", message }` | It is the one error that breaks the envelope `CLAUDE.md` makes a rule. The frontend reads `message`, which both shapes carry |
| 7 | V-13: keep 409 | It contradicts `CLAUDE.md` § Status Codes, and ADR-101's reasoning for a rule of the same shape |

### Implications, Including the Bad Ones

- **All seven items are working decisions.** Until the owner confirms them, every document that relies on one says so. If the owner overturns one, the cards that cite this ADR change with it.
- **P6-10:**
  - The rehearsal proves the procedure on **seeded** data.
  - A real-data surprise, such as a value encrypted under a key id the ring does not hold or a volume far larger than the drill's, can only show up after go-live.
  - That check must actually be scheduled. Otherwise it becomes the "written and never rehearsed" abuse case.
- **P6-11:**
  - Fifteen services gain audit writes inside their transactions. Their writes can now **fail because an audit insert failed**, as the 38 covered files already can.
  - Kanban and ticket activity add audit volume. The 90-day default audit window (ADR-096) absorbs it; storage does not.
- **Phase 7:**
  - The phase cannot close without the owner's values.
  - A kind cluster has no managed CNI, no real StorageClass and no cert-manager, so the first production install may still find chart defects (U-01 lists them).
- **Phase 8:** "Complete for this stop" is a label on a snapshot. A trigger can fire the next day, so the board must still be read as a set of standing triggers.
- **Phase 9:**
  - After the phase closes, the tests may stay in two languages for a long time.
  - Reviewers must know that a `.js` test is legacy and a new test must be `.ts`. `CLAUDE.md` and `AGENTS.md` must say so when P9-24 lands.
  - Type errors in `.js` tests stay invisible to `typecheck` (`checkJs: false`), as they are today.
- **Q-51:**
  - Three tables' actor columns become nullable. Every reader that assumed `performed_by`, `adjusted_by` or `requested_by` is never null must now handle a key actor. For example, a report that joins users will drop or blank key-authored rows unless it also reads `api_key_id`.
  - The CHECK is added NOT VALID, then validated. An existing row that names no actor would stop validation, so it must be resolved first.
  - A hard delete of an API key that authored rows is refused (RESTRICT).
- **Q-52:**
  - A new column joins a regulated set of tables, so the DSAR export and the retention job must deliberately include or ignore it.
  - Notes sent before the migration were dropped and cannot be recovered.
- **Q-53:** A consumer that matched `status: "Error"` in the limiter's body breaks. None is known in the repository; an external client may exist.
- **V-13:**
  - A client that treated the author's 409 as a state problem now sees a 403, and may show "no permission" unless it reads the message.
  - A tenant with a single administrator cannot publish an SOP at all until Q-54 is decided.

---


## ADR-110: A Quota Overage Suspends Only an Active Free-Plan Tenant, Judged by `Tenant.plan`, Under Its Own Reason and System Actor

**Date:** 2026-09-30 · **Status:** Accepted (implemented by the services helper; the ADR is written by the Phase 9 lead) · **Finding:** A-322 · **Record:** `MEMORY/records/2026-09-30-a319-a322-commercial-fixes.md` · **Relates to:** ADR-094 (suspension marks)

### Decision

A quota overage (`meteredBilling#enforceQuotas`) suspends a tenant **only** if it is ACTIVE and on the free plan.
- **The plan is judged by `Tenant.plan`.** `professional`, `business` and `enterprise` are paid. The Stripe webhooks keep the plan in step.
- **The suspension's marks:**
  - reason `"billing:quota"` (new `QUOTA_SUSPENSION_REASON`), with no `suspended_by`;
  - actor `system:usage-quota`, a new system actor.
- **One transaction** writes the lifecycle setting and the audit rows, under both PLATFORM and the tenant, and it locks the tenant row.
- A tenant in any other status is left as it is.
- A payment does **not** lift a quota suspension; an operator does.

### Alternatives considered

- **Judge the plan by the `Subscription` row's status.** Rejected: `getSubscription` auto-creates a `"basic"` row, so the row's existence says nothing about payment.
- **Reuse `system:billing-webhook` as the actor.** Rejected: no Stripe event is involved, and the audit trail would name a cause that did not happen.
- **Remove the auto-suspend.** Rejected: the coordinator asked for the semantics to be fixed, not removed.

### Implications

- A free tenant suspended for quota stays suspended until an operator acts, even if it upgrades. That is deliberate, but it is a support cost.
- **Nothing calls `enforceQuotas` yet,** so this defines behaviour that no scheduler exercises today. Wiring it to a scheduler is a separate decision.
- **Evidence:** a fail-before of 7 of 9 on the A-322 tests (named in the record).

---

## ADR-111: In Production With Billing Enabled, a Missing `STRIPE_SECRET_KEY` Stops the Boot

**Date:** 2026-09-30 · **Status:** Accepted (decided by the main session under the owner's delegation, from the gitleaks triage; implemented and written by the services helper) · **Record:** `MEMORY/records/2026-09-30-p9-16-quality-services.md` § ADR-111 · **Relates to:** the CERT_SIGNING_SECRET guard (`certificateDocument.service#requireSigningSecret`), P10-05's `assertPublicAccessConfig`

### Decision

`stripeWebhook.service` fell back to the placeholder `sk_test_placeholder` whenever `STRIPE_SECRET_KEY` was unset, production included. A deployment wired to Stripe but missing the key booted and billed against a fake credential, and nothing said so.

- **The rule.** In production (`NODE_ENV=production`) with billing enabled, a missing or blank `STRIPE_SECRET_KEY` stops the boot. The error names the variable and the way out: "STRIPE_SECRET_KEY is required in production when billing is enabled (ADR-111). Set it, or set BILLING_ENABLED=false on a deployment that does not bill through Stripe."
- **Where it runs.** New `src/config/billing.ts` (`stripeSecretKey()`, `billingEnabled()`, `STRIPE_KEY_PLACEHOLDER`) reads the environment through `config/env.ts`. `stripeWebhook.service` calls `stripeSecretKey()` once, at its own load, which the boot reaches through the billing routes. It is a load-time refusal, as the CERT_SIGNING_SECRET guard is.
- **"Billing enabled"** is `BILLING_ENABLED=true`. `BILLING_ENABLED=false` turns it off. Unset (or any other value), billing is enabled exactly when `STRIPE_WEBHOOK_SECRET` is set: a deployment wired to Stripe's webhooks is billing.
- **Outside production** the placeholder stays allowed, for development and the test suites.
- **The load gate** (`scripts/load-check.ts`, Amendment 15 of ADR-087) gives its production-mode child a random `STRIPE_SECRET_KEY`, as it does every other required secret. The gate therefore loads the module whatever the developer's `.env` says about billing. It does not set `BILLING_ENABLED=false`, which would stop the gate loading through the guarded path.
- **The gitleaks allowlist entry** `\bsk_test_placeholder\b` is kept as it is. The literal moved from `stripeWebhook.service.ts` to `config/billing.ts`, and the entry is path-independent.

### Alternatives considered

- **Refuse whenever the key is missing in production, billing or not.** Rejected: a production deployment that does not sell through Stripe (an on-premises hospital install) would need a fake key to boot, which is the problem this ADR removes.
- **A new required flag with no inference** (billing enabled only by `BILLING_ENABLED=true`). Rejected: the deployment that most needs the guard is one wired to Stripe's webhooks that never heard of the new flag. Inferring from `STRIPE_WEBHOOK_SECRET` covers it, and `BILLING_ENABLED=false` is the explicit way out.
- **Refuse at the first Stripe call instead of at load.** Rejected: that is the silent failure moved later, a 500 on the first webhook instead of a boot that names the variable.

### Implications

- **A production deployment with `STRIPE_WEBHOOK_SECRET` set and no `STRIPE_SECRET_KEY` no longer starts.** That is the intent, but an operator upgrading such a deployment must set the key, or `BILLING_ENABLED=false`, before the rollout. The Helm chart passes `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` only when `secrets.stripeSecretKey` / `secrets.stripeWebhookSecret` are set (both empty by default in `values.yaml`), so a chart release that sets the webhook secret must also set the key. The compose overlays set neither.
- **A blank key is now a missing key everywhere.** Outside production, a blank `STRIPE_SECRET_KEY` of spaces used to be passed to the Stripe client as-is; it now falls back to the placeholder. This matches the empty-means-default idiom of `envOr`.
- **Evidence.** `tests/services/stripeSecretKey.adr111.test.ts` loads the real module in an isolated registry per case: 3 refusals and 5 cases that still start. Fail-before: 3 of 8 failed against the old module (every refusal case). After the change, 8/8, and every stripeWebhook suite passes (78 tests). `npm run load:check` passes in both modes, including with `BILLING_ENABLED=true` in the parent environment.

---

## ADR-112: A Tenant Edit Does Not Change the Tenant's Status — Status Moves Only Through the Tenant Lifecycle

**Date:** 2026-09-30 · **Status:** Accepted (the Phase 9 lead; A-326 was assigned by the coordinator, "fix first") · **Findings:** A-326, A-327 · **Record:** `MEMORY/records/2026-09-30-a326-a329-tenant-edit-hierarchy.md` · **Relates to:** ADR-094 (suspension marks), A-63 (a tenant admin may not change status)

### Context

`PATCH /tenants/edit` accepted a `status`, and `tenant.service#updateTenant` wrote it directly. The validator upper-cases the status (ACTIVE / INACTIVE / SUSPENDED), but `tenants.status` is the lower-case ENUM (active / suspended / deleted). So every edit that carried a status failed on PostgreSQL with `invalid input value for enum`, answered as a 500, and the edit modal always resubmits the status. `INACTIVE` has no ENUM value at all.

A direct write would also have been wrong on its own terms. A suspension is a lifecycle transition: `POST /tenants/:id/suspend` and `/resume` write the ADR-094 marks (reason, suspended_by, the audit rows). An edit that set `suspended` would leave a suspended tenant with none of them.

### Decision

An edit never writes `status`.
- **The current status resubmitted, in any case,** is no change, so the modal's round trip saves.
- **A different status is a 409 with a state explanation:** "This tenant is "active". Its status changes through the tenant lifecycle (POST /tenants/:id/suspend or /resume), not through an edit".
- **A value the ENUM does not have** (`INACTIVE`) is a 400.
- **A tenant admin sending a different status** is still a 403 (A-63). That check runs first.
- **A-327:** a null or empty email in an edit is a 400 before anything is written. Previously it reached the NOT NULL, isEmail column and answered 500.

### Alternatives considered

- **Map the upper-case value to lower case and write it.** Rejected: it creates suspensions without their ADR-094 marks and audit rows, and `INACTIVE` still has nowhere to go.
- **Strip `status` from the validator.** Rejected: the frontend still sends it, and a super admin's changed status would then be silently ignored, a 200 that says a change happened when it didn't (the A-303 class).
- **Add `inactive` to the ENUM.** Rejected: nothing reads it, and no lifecycle transition defines what it means.

### Implications

- **The frontend's `EditTenantModal`** still offers Active / Inactive / Suspended to a super admin. Choosing another value now gets a 409 explaining where to go, instead of a 500. The select should become read-only, pointing to the lifecycle actions; that is a frontend follow-up, recorded on A-326.
- **`updateTenant` reads the ENUM from the model** (`Tenant.getAttributes().status.values`), so hand-written model doubles need `getAttributes`. Two test doubles gained it.
- **Evidence:**
  - `tests/routes/tenant.statusEmail.a326a327.test.ts`: 6 of 9 failed before, 9/9 pass after.
  - A live PostgreSQL 18 check as `callibrator_app`: 11/11. The before state is the P9-13 probe's measured 500s.

---

End of ADRs. Update this document as new decisions are made, and record a deviation as an ADR rather than editing a `docs/` document quietly.
