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

## Open Decisions

Recorded so a future reader can tell whether their idea was evaluated and rejected, or genuinely never considered.

| Question | State |
|---|---|
| `REVOKE UPDATE, DELETE` on `calibration_records` | **closed** — done by ADR-062: a trigger for every role plus the application-role REVOKE (P6-03) |
| A separate `LOGIN` application role with no path back to the owner | **open** — the stronger form of ADR-062's `SET ROLE` (which `RESET ROLE` undoes); needs a second credential in every deployment template, Helm included |
| A composite unique on `(tenant_id, serial_number)` | **closed** — done by ADR-049 (migration `0026`); not partial on `is_deleted` |
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

---

End of ADRs. Update this document as new decisions are made, and record a deviation as an ADR rather than editing a `docs/` document quietly.
