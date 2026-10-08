/**
 * Route authorization exemptions — P6-04.
 *
 * Every route registered under `src/routes` (and every route `index.js` or
 * `docs/apiDocs.ts` registers directly on the app) must carry a PERMISSION GATE
 * in its middleware chain: `dynamicAccess(...)`, `rbac(...)`, `checkRoleLevel(...)`,
 * `abac(...)` or `superAdminOnly`. `auth` is authentication, not authorization,
 * and `denyApiKey` only narrows who may call — neither is a gate.
 *
 * A route that is ungated ON PURPOSE is listed here, with its kind and a reason
 * a reviewer can check. The guard (`tests/routes/routePermissionGuard.p604.test.js`)
 * fails on:
 *   - a route with no gate and no entry here (the defect this exists to stop),
 *   - an entry naming a route that no longer exists, or that is now gated
 *     (the list may only shrink by being edited, never rot),
 *   - an entry whose kind contradicts its chain (`public` behind `auth`, or
 *     anything but `public` without `auth`),
 *   - a `service` entry whose named check does not exist in the named file,
 *   - an `inline` entry whose named guard function is not in the chain.
 *
 * This is the ONE list. P9-21's `public()` route marker is to read its public
 * entries from here (`publicRoutes()` below), not keep a second copy.
 *
 * Kinds:
 *   public   — no `auth` at all; the route's own defence is named in `reason`.
 *   self     — authenticated; acts only on the caller's own records.
 *   service  — authenticated; authorized below the route. `check` names
 *              "<file under src>#<function>", which must exist.
 *   inline   — authenticated (or bootstrap); gated by a guard function defined
 *              in the router file. `gate` names it; it must be in the chain.
 *   pending  — known gap owned by another open card (`card`).
 *   accepted — deliberately left at `auth` by a recorded decision (`decision`).
 *
 * Keys: route file relative to `src/routes` (or `index.js` / `docs/apiDocs.ts`),
 * then "METHOD /path" exactly as the router registers it.
 */

// P9-08 (ADR-087 Amendment 5): converted from routeGateExemptions.js with no
// behaviour change. The kinds are literal types; every entry is checked against
// `RouteGateExemption` (a misspelt field or kind no longer compiles). Nothing
// is frozen that was not.

const PUBLIC = "public" as const;
const SELF = "self" as const;
const SERVICE = "service" as const;
const INLINE = "inline" as const;
const PENDING = "pending" as const;
const ACCEPTED = "accepted" as const;

const KINDS = [PUBLIC, SELF, SERVICE, INLINE, PENDING, ACCEPTED] as const;

/** One exemption kind. */
export type ExemptionKind = (typeof KINDS)[number];

/** A reviewed reason why a route carries no permission gate. */
export interface RouteGateExemption {
  kind: ExemptionKind;
  reason: string;
  /** SERVICE: the service function that enforces access ("services/x.service.js#fn"). */
  check?: string;
  /** INLINE: the name of the middleware in the chain that enforces access. */
  gate?: string;
  /** PENDING: the open card that owns the gap. */
  card?: string;
  /** ACCEPTED: the recorded decision. */
  decision?: string;
}

const LOGIN_SURFACE = "the login surface: no session exists yet; rate limiter (A-30) and lockout counters";
const SSO_CALLBACK = "SAML/OIDC single sign-on: the IdP (or the browser it redirects) is the caller; the response signature is validated in sso.service";
const OWN_SESSION = "acts only on the caller's own session or credentials (req.user.id)";
const OWN_MFA = "manages the caller's own second factor; the account is req.user.id";
const OWN_GDPR = "data-subject right exercised on the caller's OWN data (gdpr.controller#actor: req.user.id)";
const OWN_NOTIFICATION = "the caller's own notifications only: every query is notification.service#recipientScope(tenantId, userId)";
const OWN_WEBAUTHN = "the caller's own passkeys (req.user.id); WebAuthn ceremony";

const KANBAN: RouteGateExemption = {
  kind: SERVICE,
  check: "services/kanban.service.ts#assertAccess",
  reason: "project membership plus a minimum level, checked by kanban.service#assertAccess (viewer/editor/owner) on every call",
};
const KANBAN_CREATE: RouteGateExemption = {
  kind: SERVICE,
  check: "services/kanban.service.ts#createProject",
  reason: "creating a project makes the caller its owner; every later act on it goes through kanban.service#assertAccess",
};
const TICKETS: RouteGateExemption = {
  kind: SERVICE,
  check: "services/ticket.service.ts#loadTicket",
  reason: "ticket.service scopes every read to the raiser or a responder (tenantScope / isResponder / assertCanManage via loadTicket)",
};
const SCIM: RouteGateExemption = {
  kind: INLINE,
  gate: "requireApiKeyOrAdmin",
  reason: "SCIM service account: an API key carrying the `scim` scope (A-250), or SUPERADMIN",
};

const ROUTE_GATE_EXEMPTIONS: Record<string, Record<string, RouteGateExemption>> = {
  "api/clientFacilities.route.ts": {
    "GET /mine": { kind: SELF, reason: "P21-09 (S-8): the caller's own client facility, or null when unbound — read through the facility rule id = own" },
  },
  "api/session.route.ts": {
    "GET /mine": { kind: SELF, reason: "Q-08 (ADR-084): lists the caller's own sessions only — ownSessions.service filters on req.user.id" },
    "POST /mine/:id/revoke": { kind: SELF, reason: "Q-08 (ADR-084): revokes one of the caller's own sessions — another user's is 404 (ownSessions.service)" },
  },
  "api/auth.route.ts": {
    "POST /register": { kind: PUBLIC, reason: LOGIN_SURFACE },
    "POST /login": { kind: PUBLIC, reason: LOGIN_SURFACE },
    "POST /mfa/login": { kind: PUBLIC, reason: `${LOGIN_SURFACE}; requires the MFA challenge token from /login` },
    "POST /first-sign-in/password": {
      kind: PUBLIC,
      reason: `${LOGIN_SURFACE}; P10-16 (ADR-099): the password-change token from a one-time password's first /login is the capability`,
    },
    "POST /send-otp": { kind: PUBLIC, reason: `${LOGIN_SURFACE}; password-reset OTP, answer does not disclose whether the account exists` },
    "POST /reset-password": { kind: PUBLIC, reason: `${LOGIN_SURFACE}; the OTP is the capability` },
    "POST /refresh": { kind: PUBLIC, reason: "the refresh token is the credential (rotated, bound to its session)" },
    "GET /activation": { kind: PUBLIC, reason: "account activation link; the activation token is the capability" },
    "GET /sso/metadata": { kind: PUBLIC, reason: "SAML service-provider metadata — public by specification" },
    "GET /sso/metadata/:tenantCode": { kind: PUBLIC, reason: "SAML service-provider metadata — public by specification" },
    "POST /sso/login": { kind: PUBLIC, reason: SSO_CALLBACK },
    "POST /sso/callback": { kind: PUBLIC, reason: SSO_CALLBACK },
    "POST /sso/callback/:tenantCode": { kind: PUBLIC, reason: SSO_CALLBACK },
    "POST /sso/oidc/login": { kind: PUBLIC, reason: SSO_CALLBACK },
    "GET /sso/oidc/callback": { kind: PUBLIC, reason: SSO_CALLBACK },
    "GET /sso/oidc/callback/:tenantCode": { kind: PUBLIC, reason: SSO_CALLBACK },
    "POST /sso/oidc/callback": { kind: PUBLIC, reason: SSO_CALLBACK },
    "POST /sso/oidc/callback/:tenantCode": { kind: PUBLIC, reason: SSO_CALLBACK },
    "POST /sso/exchange": { kind: PUBLIC, reason: "single-use SSO exchange code (A-60) is the capability; rate limited" },
    "POST /verify": { kind: SELF, reason: "\"who am I\" — returns the caller's own principal" },
    "POST /logout": { kind: SELF, reason: OWN_SESSION },
    "POST /logout-all": { kind: SELF, reason: OWN_SESSION },
    "POST /socket-token": { kind: SELF, reason: "mints a short-lived Socket.IO token for the caller's own session" },
    "POST /pass-is-valid": { kind: SELF, reason: "checks the caller's own current password" },
    "POST /just-update-password": { kind: SELF, reason: OWN_SESSION },
    "POST /mfa/setup": { kind: SELF, reason: OWN_MFA },
    "POST /mfa/verify": { kind: SELF, reason: OWN_MFA },
    "POST /mfa/disable": { kind: SELF, reason: OWN_MFA },
    "POST /impersonate": {
      kind: SERVICE,
      check: "services/auth.service.ts#impersonateUser",
      reason: "auth.service#impersonateUser refuses any caller whose role is not SUPERADMIN (403) before it resolves the target",
    },
    "POST /impersonate/exit": { kind: SELF, reason: "ends the caller's own impersonation session (logout of that session)" },
  },
  "api/attachments.route.ts": {
    "GET /:id/signed": { kind: PUBLIC, reason: "signed attachment URL — the HMAC signature and expiry are the capability (owned by the storage/attachments work)" },
  },
  "api/storage.route.ts": {
    "GET /object": { kind: PUBLIC, reason: "signed file download — the HMAC-signed path is the capability (owned by the storage/attachments work)" },
  },
  "api/billing.route.ts": {
    "POST /webhook": { kind: PUBLIC, reason: "Stripe is the caller; Stripe signature verified over the raw body" },
  },
  "api/certificates.route.ts": {
    "GET /verify/:certificateNumber": { kind: PUBLIC, reason: "QR code on a printed certificate, scanned by anyone; the number alone yields the minimal verdict, the certificate's verification token (carried by the QR) the full one (A-293)" },
    "GET /verify/:certificateNumber/document": { kind: PUBLIC, reason: "the signed-PDF link from the public verification page; a signed, expiring token is the capability (as for /storage/object)" },
  },
  "api/ipmReports.route.ts": {
    "GET /verify/:reportNumber": {
      kind: PUBLIC,
      reason:
        "IPM report verification by capability token (ADR-126 Am. 2): the printed report's QR carries a 192-bit token; a malformed, unknown or mismatched link is one identical 404; per-address request budgets (ADR-100)",
    },
  },
  "api/content.route.ts": {
    "GET /posts/public": { kind: PUBLIC, reason: "the public site; published rows only, read-only" },
    "GET /posts/public/:slug": { kind: PUBLIC, reason: "the public site; published rows only, read-only" },
    "GET /categories/public": { kind: PUBLIC, reason: "the public site; read-only" },
  },
  "api/iot.route.ts": {
    "POST /ingest": { kind: PUBLIC, reason: "devices have no session; the per-device X-IoT-Token is the credential (A-29, A-45)" },
  },
  "api/tenant.route.ts": {
    "GET /public": { kind: PUBLIC, reason: "login-page branding for an active tenant id the caller already holds: id, name, code, colour, logo only" },
  },
  "api/oidc.route.ts": {
    "GET /.well-known/openid-configuration": { kind: PUBLIC, reason: "OIDC discovery — public by specification" },
    "GET /.well-known/jwks.json": { kind: PUBLIC, reason: "OIDC signing keys (public halves) — public by specification" },
    "GET /authorize": { kind: PUBLIC, reason: "OIDC authorization endpoint; validates client_id and redirect_uri, then hands the browser to the login/consent flow" },
    "POST /token": { kind: PUBLIC, reason: "OIDC token endpoint; client authentication (secret) plus the single-use authorization code" },
    "GET /userinfo": { kind: PUBLIC, reason: "OIDC userinfo; the OIDC access token (Bearer) is the credential, verified in the controller" },
    "GET /authorize/request/:requestId": { kind: SELF, reason: "the caller's own pending consent request" },
    "POST /authorize/decision": { kind: SELF, reason: "the caller's own consent decision" },
  },
  "api/gdpr.route.ts": {
    "POST /export": { kind: SELF, reason: OWN_GDPR },
    "GET /exports/:exportId/download": {
      kind: SELF,
      reason: `${OWN_GDPR}; the export's manifest must name the caller and their tenant, else 404 (gdpr.service#getExportDownload, A-360)`,
    },
    "POST /erasure": { kind: SELF, reason: OWN_GDPR },
    "GET /erasure/:requestId": { kind: SELF, reason: `${OWN_GDPR}; another member's request is 404 unless the caller holds gdpr read (A-252)` },
    "PUT /consent": { kind: SELF, reason: OWN_GDPR },
    "GET /consent/history": { kind: SELF, reason: OWN_GDPR },
    "GET /processing": { kind: SELF, reason: "the Article 30 processing register as it applies to the caller" },
    "PUT /rectify": { kind: SELF, reason: OWN_GDPR },
    "POST /restrict": { kind: SELF, reason: OWN_GDPR },
  },
  "api/notifications.route.ts": {
    "GET /": { kind: SELF, reason: OWN_NOTIFICATION },
    "PATCH /:notificationId/read": { kind: SELF, reason: OWN_NOTIFICATION },
    "PATCH /read-all": { kind: SELF, reason: OWN_NOTIFICATION },
    "DELETE /all": { kind: SELF, reason: OWN_NOTIFICATION },
    "DELETE /bulk": { kind: SELF, reason: OWN_NOTIFICATION },
    "DELETE /:notificationId": { kind: SELF, reason: OWN_NOTIFICATION },
    "POST /test": {
      kind: SELF,
      reason: "realtime self-test to the caller; the tenant-wide form (scope: \"tenant\") needs notifications write via tenantBroadcastGate (A-251)",
    },
  },
  // Phase 10 (ADR-098) — the public ways in. Each is behind an ADR-100 request
  // budget per client address; the defence of each is named.
  "api/accessRequests.route.ts": {
    "POST /": {
      kind: PUBLIC,
      reason:
        "P10-05 (ADR-098 §6): the access-request intake — one neutral 202 for new, duplicate, capped and honeypot submissions; per-address budget and per-email cap; stores a request, grants nothing",
    },
  },
  "api/authPublic.route.ts": {
    "POST /login/discover": {
      kind: PUBLIC,
      reason: "P10-04: identifier-first discovery answered by email DOMAIN only — no account is looked up",
    },
    "POST /sso/start": {
      kind: PUBLIC,
      reason: "P10-04: SSO start by organisation code; one A-292 refusal for every reason (the ssoStart budget)",
    },
    "POST /passkey/options": {
      kind: PUBLIC,
      reason: "P10-10: starts a passkey ceremony; no identifier in, no allowCredentials out (no account oracle)",
    },
    "POST /passkey/verify": {
      kind: PUBLIC,
      reason: `${LOGIN_SURFACE}; P10-10: the user-verifying passkey assertion is the credential`,
    },
    "POST /invitation/accept": {
      kind: PUBLIC,
      reason: "P10-15: the single-use, time-limited invitation token is the capability; one 400 for any bad link",
    },
  },
  "api/webauthn.route.ts": {
    "GET /status": { kind: SELF, reason: OWN_WEBAUTHN },
    "POST /registration-options": { kind: SELF, reason: OWN_WEBAUTHN },
    "POST /verify-registration": { kind: SELF, reason: OWN_WEBAUTHN },
    "POST /login-options": { kind: SELF, reason: OWN_WEBAUTHN },
    "POST /verify-login": { kind: SELF, reason: OWN_WEBAUTHN },
    "POST /disable": { kind: SELF, reason: OWN_WEBAUTHN },
    // ADR-108 Amendment 1: the caller's own passkeys; another user's id is 404 (webauthn.service#ownPasskey).
    "GET /credentials": { kind: SELF, reason: OWN_WEBAUTHN },
    "PATCH /credentials/:id": { kind: SELF, reason: OWN_WEBAUTHN },
    "DELETE /credentials/:id": { kind: SELF, reason: OWN_WEBAUTHN },
  },
  "api/sop.route.ts": {
    "POST /:id/acknowledge": {
      kind: SELF,
      reason: "the caller attests their OWN training on an SOP (ISO 13485 §6.2); the roles that must acknowledge hold no sop menu (A-28)",
    },
  },
  "api/tenantHierarchy.route.ts": {
    "GET /tree": { kind: SELF, reason: "the caller's own tenant's tree (req.user.tenantId only)" },
    "GET /:tenantId/children": { kind: INLINE, gate: "ownTenantGuard", reason: "own tenant or SUPERADMIN, else 404 (A-01)" },
    "GET /:tenantId/descendants": { kind: INLINE, gate: "ownTenantGuard", reason: "own tenant or SUPERADMIN, else 404 (A-01)" },
    "GET /:tenantId/ancestors": { kind: INLINE, gate: "ownTenantGuard", reason: "own tenant or SUPERADMIN, else 404 (A-01)" },
    "GET /:tenantId/parent": { kind: INLINE, gate: "ownTenantGuard", reason: "own tenant or SUPERADMIN, else 404 (A-01)" },
  },
  "api/menuGroups.route.ts": {
    "POST /filter": { kind: INLINE, gate: "ownRoleOnly", reason: "the caller's own role's menu only, or SUPERADMIN (AZ-01 G-06)" },
    "POST /get-assignments": { kind: INLINE, gate: "ownRoleOnly", reason: "the caller's own role's menu only, or SUPERADMIN (AZ-01 G-06)" },
    "GET /menu-groups": { kind: INLINE, gate: "ownRoleOnly", reason: "the sidebar: the caller's own role's menu only, or SUPERADMIN (AZ-01 G-06)" },
    "GET /my-permissions": { kind: SELF, reason: "ADR-102: the caller's own effective menu permissions (menuGroup.service#getMyPermissions reads req.user only)" },
  },
  "api/scim.route.ts": {
    "GET /Users": SCIM,
    "GET /Users/:id": SCIM,
    "POST /Users": SCIM,
    "PUT /Users/:id": SCIM,
    "PATCH /Users/:id": SCIM,
    "DELETE /Users/:id": SCIM,
    "GET /Groups": SCIM,
    "GET /Groups/:id": SCIM,
    "POST /Groups": SCIM,
    "PUT /Groups/:id": SCIM,
    "PATCH /Groups/:id": SCIM,
    "DELETE /Groups/:id": SCIM,
  },
  "api/kanban.route.ts": {
    "GET /projects": { kind: SERVICE, check: "services/kanban.service.ts#listProjects", reason: "lists only the projects the caller is a member of" },
    "POST /projects": KANBAN_CREATE,
    "GET /projects/:projectId": KANBAN,
    "PATCH /projects/:projectId": KANBAN,
    "DELETE /projects/:projectId": KANBAN,
    "GET /projects/:projectId/metrics": KANBAN,
    "POST /projects/:projectId/members": KANBAN,
    "PATCH /projects/:projectId/members/:memberId": KANBAN,
    "DELETE /projects/:projectId/members/:memberId": KANBAN,
    "POST /projects/:projectId/columns": KANBAN,
    "POST /projects/:projectId/columns/reorder": KANBAN,
    "PATCH /projects/:projectId/columns/:columnId": KANBAN,
    "DELETE /projects/:projectId/columns/:columnId": KANBAN,
    "POST /projects/:projectId/labels": KANBAN,
    "PATCH /projects/:projectId/labels/:labelId": KANBAN,
    "DELETE /projects/:projectId/labels/:labelId": KANBAN,
    "GET /projects/:projectId/sprints": KANBAN,
    "POST /projects/:projectId/sprints": KANBAN,
    "POST /projects/:projectId/sprints/migrate": KANBAN,
    "PATCH /projects/:projectId/sprints/:sprintId": KANBAN,
    "DELETE /projects/:projectId/sprints/:sprintId": KANBAN,
    "POST /projects/:projectId/cards": KANBAN,
    "GET /projects/:projectId/cards/:cardId": KANBAN,
    "PATCH /projects/:projectId/cards/:cardId": KANBAN,
    "PATCH /projects/:projectId/cards/:cardId/move": KANBAN,
    "DELETE /projects/:projectId/cards/:cardId": KANBAN,
    "POST /projects/:projectId/cards/:cardId/relations": KANBAN,
    "DELETE /projects/:projectId/cards/:cardId/relations/:relationId": KANBAN,
  },
  "api/tickets.route.ts": {
    "GET /": { kind: SERVICE, check: "services/ticket.service.ts#tenantScope", reason: "a raiser sees their own tickets; a responder role (RESPONDER_ROLES) the queue — ticket.service#listTickets" },
    "POST /": { kind: SELF, reason: "raises a ticket as the caller (every role raises: tickets-raise)" },
    "GET /metrics": { kind: SERVICE, check: "services/ticket.service.ts#isResponder", reason: "scoped by ticket.service#getMetrics to what the caller may see" },
    "GET /:ticketId": TICKETS,
    "PATCH /:ticketId": { kind: SERVICE, check: "services/ticket.service.ts#assertCanManage", reason: "ticket.service#updateTicket: raiser or responder, via assertCanManage" },
    "DELETE /:ticketId": { kind: SERVICE, check: "services/ticket.service.ts#assertCanManage", reason: "ticket.service#deleteTicket via assertCanManage" },
    "POST /:ticketId/assign": { kind: SERVICE, check: "services/ticket.service.ts#isResponder", reason: "responders only — ticket.service#assignTicket" },
    "POST /:ticketId/comments": TICKETS,
  },
  // A-304 (ADR-100): api/dashboard.route.ts GET /metrics is gated on `home`
  // read (every role holds it) and is no longer exempt.
  "internal/health.route.ts": {
    "GET /live": { kind: PUBLIC, reason: "liveness probe; dependency-free, discloses nothing (A-06/A-15)" },
    "GET /ready": { kind: PUBLIC, reason: "readiness probe; aggregate verdict only (A-06/A-15)" },
    "GET /health": { kind: PUBLIC, reason: "compose/Helm health check; aggregate verdict only (A-06/A-15)" },
    "GET /metrics": { kind: INLINE, gate: "metricsAuth", reason: "Prometheus scrape of job metrics; the scraper has no session — bearer METRICS_TOKEN checked by metricsAuth" },
  },
  "internal/migration.route.ts": {
    "GET /up": { kind: INLINE, gate: "superAdminOrBootstrap", reason: "SUPERADMIN, or ALLOW_SEEDING=true during bootstrap" },
    "GET /seeding": { kind: INLINE, gate: "superAdminOrBootstrap", reason: "SUPERADMIN, or ALLOW_SEEDING=true during bootstrap — seeding an empty database has no user to authenticate" },
    "GET /seed-demo": { kind: INLINE, gate: "superAdminOrBootstrap", reason: "SUPERADMIN, or ALLOW_SEEDING=true; also requires SEED_DEMO=true" },
  },
  // Registered directly on the app, outside src/routes. Read from source text.
  "index.ts": {
    "GET /": { kind: PUBLIC, reason: "root liveness banner: a fixed string" },
  },
  // P9-25 (ADR-103): docs/swagger.js became docs/apiDocs.ts. The contract and its
  // reference UI (/docs, /docs.json, /api/v1/docs) are no longer app-level public
  // routes: they are routers under routes/internal/apiDocs.route.ts, walked and
  // gated (auth + denyApiKey + rbac TENANT_ADMIN) like every other route.
  "docs/apiDocs.ts": {
    // A-253: moved here from index.js; not registered in production unless SWAGGER_ENABLED=true.
    "GET /documentation": { kind: PUBLIC, reason: "developer HTML documentation; registered only where the API contract is published (off in production, A-253)" },
    "GET /standards": { kind: PUBLIC, reason: "developer coding-standards page; registered only where the API contract is published (off in production, A-253)" },
  },
};

/**
 * The public (unauthenticated) routes, as "file METHOD /path" strings — the
 * list P9-21's `public()` marker is to read.
 *
 * @returns public routes
 */
const publicRoutes = (): string[] =>
  Object.entries(ROUTE_GATE_EXEMPTIONS).flatMap(([file, routes]) =>
    Object.entries(routes)
      .filter(([, entry]) => entry.kind === PUBLIC)
      .map(([route]) => `${file} ${route}`),
  );

const EXEMPTION_KINDS = { PUBLIC, SELF, SERVICE, INLINE, PENDING, ACCEPTED };

export {
  ROUTE_GATE_EXEMPTIONS,
  EXEMPTION_KINDS,
  KINDS,
  publicRoutes,
};
