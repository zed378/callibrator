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

Nothing in the request path has ever compared a session's `ip_address` or `user_agent` against the incoming request. The only code that claimed to, `sessionSecurity.middleware.js`, was imported by nothing and its SQL targeted a `"Sessions"` table with camelCase columns that does not exist; it was deleted under audit finding A-12. This ADR is the origin of a claim that reached six `docs/` files as fact, which is the PR-4 failure shape. It stands as the decision that was taken; the controls it describes are a **target**, and whether they should be built — and how they behave on a changed IP — is Q-08 in [`../TASKS/BACKLOG.md`](../TASKS/BACKLOG.md).

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
- Sessions carry `ip_address`, `user_agent` and `device`. They are **recorded and never checked** — corrected 2026-09-23. `sessionSecurity.middleware.js`, named here as where the balance was struck, was dead code and was deleted under A-12. Strict IP binding breaks users on mobile networks, so the balance is a product decision; it is Q-08 in [`../TASKS/BACKLOG.md`](../TASKS/BACKLOG.md), not something the code currently expresses.
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

**Status:** Accepted

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

## Open Decisions

Recorded so a future reader can tell whether their idea was evaluated and rejected, or genuinely never considered.

| Question | State |
|---|---|
| `REVOKE UPDATE, DELETE` on `calibration_records` | **should happen** — the append-only rule is currently a convention, not a constraint (PR-2) |
| A composite unique on `(tenant_id, serial_number)` | should happen — the current global unique is a weak cross-tenant oracle |
| Mandatory MFA for role level 10 | should happen (PR-3) |
| A build guard failing any route without a permission gate | should happen — the most likely authorization defect has no mechanism against it |
| Post-migration column verification | should happen — a blanket-catch migration is recorded as applied while doing nothing |
| JSDoc with `checkJs` on the backend | **closed** — superseded by strict TypeScript (ADR-038) |
| ESM for the backend | open — deliberately deferred until the TypeScript migration completes (ADR-038) |
| Row Level Security as defence in depth | **open** — PostgreSQL-only (ADR-039) removes one of ADR-029's three reasons against it; the fail-open risk and per-request cost remain |
| Partitioning `iot_readings` and `audit_logs` | deferred until retention alone stops being enough |
| A read replica for reporting | deferred until reporting measurably affects operational p95 |
| Per-signer signing keys instead of per-tenant | **open** — ADR-040 signs with a tenant key held by the service, which proves the service signed for that user, not that the user did. Non-repudiation against the operator needs per-user key material and an enrolment flow |
| Moving the e-signature private keys under `kms.service.js` | **open** — they are the only tenant secret still wrapped with `ENCRYPT_KEY` directly (ADR-040); the change needs a re-wrap of existing keys |
| A trusted timestamp (RFC 3161) on signatures | **open** — `signedAt` is the application's own clock, bound into the payload but attested by nothing |
| A rotation procedure for `CERT_SIGNING_SECRET` and `ENCRYPT_KEY` | **open, and cheap to design in advance** — neither is practically rotatable today, so "rotate the key" is not currently an available incident response |

---

End of ADRs. Update this document as new decisions are made, and record a deviation as an ADR rather than editing a `docs/` document quietly.
