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
