/**
 * The client-facility dimension's reviewed lists (ADR-124 and its Amendments 1–2; spec
 * MEMORY/specs/P19-04-client-facilities.md § 7, § 10; P18-03 spec § 4.1).
 *
 * P20-07 (the database layer) adds the one list the database itself enforces:
 * FACILITY_BOUND_ROLES, which migration 0123's `users_bound_role_check` trigger holds for every
 * write path the hooks do not see (the ETL, SCIM, a hand-written UPDATE). The migration writes
 * the names out as literals (a migration is frozen once applied); a test holds the two equal.
 *
 * P21-09a adds the two lists the hooks read (utils/tenantScope.util.ts, spec § 7.5, § 7.6):
 * FACILITY_READABLE (the tenant models a bound principal reads through a context-derived rule) and
 * FACILITY_SCOPE_SKIPS (every reviewed `skipFacilityScope`, held to the source by
 * tests/guards/skipFacilityScope.guard). TARGET, added by P21-09b: FACILITY_ACCESSIBLE_ROUTES.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { ROLE_NAMES } from "./roleConstants";

/**
 * The roles a facility-bound user (`users.client_facility_id` set) may hold — the four upstream
 * facility actors map to them (P18-03 § 4.1). No new role; `ROLE_LEVELS` unchanged. Any other role
 * on a bound row is refused (400 by the service, P21-09; by the database trigger, now).
 */
export const FACILITY_BOUND_ROLES = Object.freeze([
  ROLE_NAMES.HEALTCARE_ADMIN,
  ROLE_NAMES.HEALTHCARE_TECHNICIAN,
  ROLE_NAMES.FACILITY_MAINTENANCE,
  ROLE_NAMES.ROOM_USER,
] as const);

/** One role a facility-bound user may hold. */
export type FacilityBoundRole = (typeof FACILITY_BOUND_ROLES)[number];

/** A ceiling cell: the most a bound role may hold on a slug (absent = none). */
export type CeilingAccess = "read" | "write";

/**
 * P21-09c — the bound menu ceiling (P18-03 § 5.2, Matrix B; ADR-124 Am. 1 § 1): for a BOUND
 * principal the effective permission is min(role matrix ⊕ override, ceiling[role][slug]); a slug
 * absent here is NONE, so a bound user never holds a provider-administration menu whatever its
 * role or a per-user override says. Keyed by role NAME (the four of FACILITY_BOUND_ROLES; any
 * other role name on a bound principal gets the empty ceiling — fail closed). Read by
 * services/effectivePermission.ts only, so `dynamicAccess`, the sidebar and
 * `GET /menu-groups/my-permissions` cannot disagree. The ceiling never ADDS a grant: bound
 * `HEALTHCARE TECHNICIAN` `calibration` W is effective because UD-4 (b) (P20-06) grants it.
 * Held to the seeded slugs and the marked routes by tests/services/effectivePermission.boundCeiling
 * (G-P1) and tests/guards/boundCeilingRoutes.guard (G-P3).
 */
const SHARED_CEILING = {
  home: "read",
  dashboard: "read",
  "profile-page": "write",
  "change-password": "write",
  equipment: "read",
  certificate: "read",
  maintenance: "read",
  "ipm-templates": "read",
  warehouse: "read",
} as const satisfies Record<string, CeilingAccess>;

export const BOUND_MENU_CEILING: Readonly<Record<FacilityBoundRole, Readonly<Record<string, CeilingAccess>>>> = Object.freeze({
  [ROLE_NAMES.HEALTCARE_ADMIN]: Object.freeze({ ...SHARED_CEILING, calibration: "read", ipm: "read" }),
  [ROLE_NAMES.HEALTHCARE_TECHNICIAN]: Object.freeze({ ...SHARED_CEILING, calibration: "write", ipm: "write", esignature: "write" }),
  [ROLE_NAMES.FACILITY_MAINTENANCE]: Object.freeze({ ...SHARED_CEILING, calibration: "read", ipm: "read", esignature: "write" }),
  [ROLE_NAMES.ROOM_USER]: Object.freeze({ ...SHARED_CEILING, calibration: "read", ipm: "read" }),
});

/** The two context-derived rule kinds (spec § 7.5). Any other kind does not compile. */
export type FacilityReadableRule = "own-facility" | "own-user";

/** One `FACILITY_READABLE` entry. */
export interface FacilityReadableEntry {
  /** `own-facility`: the attribute equals the context's facility; `own-user`: the context's user. */
  readonly rule: FacilityReadableRule;
  /** The model ATTRIBUTE the rule compares (per model: `Session` is snake-case — the CLAUDE.md trap). */
  readonly attribute: string;
  readonly reason: string;
  /** The test file (under src/tests) that exercises the entry; G-12 checks it exists and names the model. */
  readonly test: string;
}

/**
 * The tenant-scoped models WITHOUT a facility column that a bound principal may still read — each
 * through one rule on one attribute, from the context only (ADR-124 Am. 1 § 5, AM-8; spec § 7.5).
 * Every other tenant model without a facility column is provider-internal: DENY for bound
 * principals (the hooks write NO_TENANT_ID on the tenant column). Keyed by model name.
 */
export const FACILITY_READABLE = Object.freeze({
  ClientFacility: {
    rule: "own-facility",
    attribute: "id",
    reason: "the bound user's own facility row (AM-8)",
    test: "utils/tenantScope.facilityDeny.test.ts",
  },
  Session: {
    rule: "own-user",
    attribute: "user_id",
    reason: "own sessions (a snake-case model)",
    test: "utils/tenantScope.facilityDeny.test.ts",
  },
  Notification: {
    rule: "own-user",
    attribute: "userId",
    reason: "own notifications; a tenant broadcast (no user) is hidden",
    test: "utils/tenantScope.facilityDeny.test.ts",
  },
  ConsentRecord: {
    rule: "own-user",
    attribute: "userId",
    reason: "own consent records",
    test: "utils/tenantScope.facilityDeny.test.ts",
  },
  DsarRequest: {
    rule: "own-user",
    attribute: "userId",
    reason: "own data-subject requests",
    test: "utils/tenantScope.facilityDeny.test.ts",
  },
} as const satisfies Record<string, FacilityReadableEntry>);

/** A model name with a `FACILITY_READABLE` rule. */
export type FacilityReadableModel = keyof typeof FACILITY_READABLE;

/**
 * Every reviewed `skipFacilityScope: true` in src/, keyed `"<file under src>#<function>"`, with
 * why the facility predicate must not apply there (spec § 7.6). Each use also carries a
 * `// skipFacilityScope: <reason>` comment. tests/guards/skipFacilityScope.guard fails on a use
 * without an entry and on an entry without a use.
 */
export const FACILITY_SCOPE_SKIPS: Readonly<Record<string, string>> = Object.freeze({
  "services/user.service.ts#assertIdentityFree":
    "the username/e-mail unique index is global (A-128): a bound user's own profile edit must meet every holder; only `id` is read, never returned",
  "services/gdpr.service.ts#assertEmailFree":
    "the e-mail unique index is global: a bound subject's rectification must meet every holder; only `id` is read, never returned",
});

/** What a bound principal may do on a marked route (P18-03 § 9). */
export type FacilityRouteKind = "read" | "write" | "self";

/** One `FACILITY_ACCESSIBLE_ROUTES` entry. */
export interface FacilityAccessibleRoute {
  readonly kind: FacilityRouteKind;
  readonly reason: string;
  /** A `self` route whose path parameter must name the caller (S-7): another id is refused before the handler. */
  readonly selfParam?: string;
  /** The extra check a bound principal must pass on this route (A-5's resource rule) — none marked yet. */
  readonly boundGate?: string;
}

/**
 * The routes a facility-BOUND principal may call — every other mounted route answers it 403
 * `FACILITY_ROUTE_REFUSED` before a parameter is read (ADR-124 § 7, Am. 1 § 3; spec § 7.7; the
 * P18-03 § 8 Matrix D rows). Keyed exactly like routeGateExemptions: route file (relative to
 * src/routes) → `"METHOD /path"` (the route's own path in its router).
 *
 * ONE reviewed list (no per-route tag a later edit can drop): tests/guards/facilityAccessibleRoutes
 * .guard refuses an entry on an administrative route (G-09), and tests/routes/facilityRouteDefault
 * calls every unmarked mounted route as a bound principal and expects 403 (G-10).
 *
 * P21-09b marks the SELF routes a bound account needs to exist (S-1, S-2, S-5, S-6, S-7, S-8)
 * WITHOUT a path parameter that names another row, except S-7's `selfParam` — the self routes
 * with an `:id` (`POST /sessions/mine/:id/revoke`, the notification `:notificationId` routes), the
 * MFA and password self routes (they read tenant policy, which needs the reviewed settings skip of
 * P18-03 § 10.2), the GDPR and WebAuthn self routes and every domain row (A-1 …) are marked by
 * the later P21-09 cards with their two-facility tests.
 */
export const FACILITY_ACCESSIBLE_ROUTES: Readonly<Record<string, Readonly<Record<string, FacilityAccessibleRoute>>>> = Object.freeze({
  "api/auth.route.ts": {
    "POST /verify": { kind: "self", reason: "S-1: who am I — returns the facility scope and the scope fingerprint (AM-26)" },
    "POST /logout": { kind: "self", reason: "S-1: sign out" },
    "POST /logout-all": { kind: "self", reason: "S-1: sign out everywhere" },
    "POST /socket-token": { kind: "self", reason: "S-1: the socket token; the handshake joins the facility room only (AM-19)" },
    "POST /impersonate/exit": { kind: "self", reason: "S-1: end an impersonation (the logout handler)" },
  },
  "api/session.route.ts": {
    "GET /mine": { kind: "self", reason: "S-2: own sessions — Session is FACILITY_READABLE by user_id" },
  },
  "api/notifications.route.ts": {
    "GET /": { kind: "self", reason: "S-5: own notifications — Notification is FACILITY_READABLE by userId; tenant broadcasts are hidden" },
    "PATCH /read-all": { kind: "self", reason: "S-5: mark own notifications read (the readable rule bounds the bulk update)" },
  },
  "api/menuGroups.route.ts": {
    "GET /my-permissions": { kind: "self", reason: "S-6: own effective permissions" },
    "POST /filter": { kind: "self", reason: "S-6: own role's menu (ownRoleOnly)" },
    "POST /get-assignments": { kind: "self", reason: "S-6: own role's menu assignments (ownRoleOnly)" },
    "GET /menu-groups": { kind: "self", reason: "S-6: the sidebar of the caller's own role (ownRoleOnly)" },
  },
  "api/user.route.ts": {
    "PATCH /:userId/profile": {
      kind: "self",
      selfParam: "userId",
      reason: "S-7: own profile only — the strict contract has no clientFacilityId, roleId, tenantId or status (AM-14)",
    },
  },
  "api/clientFacilities.route.ts": {
    "GET /mine": { kind: "self", reason: "S-8: the caller's own facility (ClientFacility is FACILITY_READABLE by id = own)" },
  },
});
