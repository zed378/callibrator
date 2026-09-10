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
- Session binding to IP/user agent for anomaly detection

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

**Status:** Accepted

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

**Status:** Accepted

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

**Status:** Accepted

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
- Sessions carry `ip_address`, `user_agent` and `device`. Strict IP binding breaks users on mobile networks; the balance struck in `sessionSecurity.middleware.js` is a product decision and should be stated rather than emergent.
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

## Open Decisions

Recorded so a future reader can tell whether their idea was evaluated and rejected, or genuinely never considered.

| Question | State |
|---|---|
| `REVOKE UPDATE, DELETE` on `calibration_records` | **should happen** — the append-only rule is currently a convention, not a constraint (PR-2) |
| A composite unique on `(tenant_id, serial_number)` | should happen — the current global unique is a weak cross-tenant oracle |
| Mandatory MFA for role level 10 | should happen (PR-3) |
| A build guard failing any route without a permission gate | should happen — the most likely authorization defect has no mechanism against it |
| Post-migration column verification | should happen — a blanket-catch migration is recorded as applied while doing nothing |
| JSDoc with `checkJs` on the backend | open — buys editor-level checking without a rewrite (ADR-030) |
| Partitioning `iot_readings` and `audit_logs` | deferred until retention alone stops being enough |
| A read replica for reporting | deferred until reporting measurably affects operational p95 |
| A rotation procedure for `CERT_SIGNING_SECRET` and `ENCRYPT_KEY` | **open, and cheap to design in advance** — neither is practically rotatable today, so "rotate the key" is not currently an available incident response |

---

End of ADRs. Update this document as new decisions are made, and record a deviation as an ADR rather than editing a `docs/` document quietly.
