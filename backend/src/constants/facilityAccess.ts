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
  // P20-04 (ADR-126 Am. 1 § 8, G-S11): a bound technician records and replays its own capture keys.
  IdempotencyKey: {
    rule: "own-user",
    attribute: "userId",
    reason: "own idempotency keys (a bound technician's capture writes); an API key's row has no user and is hidden",
    test: "models/idempotencyKeys.facility.test.ts",
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
  "services/certificateDocument.service.ts#DOCUMENT_INCLUDES":
    "P21-09e (spec § 12 rule 6): the people of a facility's certificate document are provider staff; their printed names (id, first and last name) are read for a bound viewer too, so its document and content hash equal the provider's",
  "services/gdpr.service.ts#pagesOf":
    "P21-09e (P18-03 § 10.2, S-4): an Article 15 export reads the SUBJECT's own rows — every caller's `where` names the tenant and the subject — and a bound subject's export must not silently omit the rows the facility deny hides (UU PDP, GDPR Art. 15)",
  "services/storage/config.service.ts#getTenantConfig":
    "P21-09e (P18-03 § 10.2, A-5 / A-6): the tenant's storage driver settings for a bound user's own upload or download; without it a bring-your-own-bucket tenant's files are looked for in the platform store. Never returned to the caller",
  "services/quota.service.ts#getStorageUsageMb":
    "P21-09e (P18-03 § 10.2, A-5 / S-7): the storage quota bounds the tenant's bytes; scoped to the uploader's facility it would under-count and fail open. A sum only",
  "services/auth.service.ts#passwordManagedBy":
    "P21-09e (P18-03 § 10.2, S-1): names the identity provider in a federated bound user's password-change refusal; the user's own tenant, two settings keys, no row returned",
  // P21-04 (ADR-126 Am. 5):
  "services/ipmSettings.service.ts#ipmSettingsOf":
    "P21-04 (P18-03 § 10.2, G-13): the tenant's IPM policy (time zone, interval, countersigning, the side-effects switch) for a bound technician's submit, report and signature — four keys of the user's own tenant, parsed, never returned",
  "services/ipmSubmit.service.ts#nextReportNumber":
    "P21-04 (P19-06 § 5): the report-number sequence counts the tenant's numbers of one facility code and day — a device moved to another facility keeps its numbers, so a bound reader's facility predicate would re-issue one (23505); only the numbers are read, under the advisory lock",
  "services/ipmReport.service.ts#verifyReport":
    "P21-04 (P19-06 § 9.2): the public verification has no principal; the session is resolved by its 192-bit token alone (global unique, random — no oracle, ADR-100), then the superseding report's number in the token's own tenant",
  // P21-02a / P21-05 (ADR-132 Am. 2, ADR-133 Am. 2):
  "services/deviceSettings.service.ts#deviceSettingsOf":
    "P21-02a (P18-03 § 10.2, G-13): the tenant's device policy (QR prefix and digits, the working set's cap, the due-soon window, the zone) for a bound technician's register reads and writes; five keys of the user's own tenant, parsed, never returned",
  "services/deviceReads.service.ts#labNames":
    "P21-02a (P19-03 § 4.1, AM-5): a device's calibration laboratory is a provider vendor (denied to a bound reader per include); its NAME alone is read for the facility's device display; the vendor's id and row are never returned to it",
  "services/personDisplay.service.ts#displayPeople":
    "P21-09e (spec § 12): the author of a facility's record is provider staff or a person of another facility; the tenant predicate stays, and a bound viewer gets a redacted display for another facility's people — never an id, e-mail or username",
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
    // P21-09e: the MFA and password self routes, with the reviewed reads of P18-03 § 10.2.
    "POST /pass-is-valid": { kind: "self", reason: "S-1: check the caller's own current password (its own row, in its facility)" },
    "POST /just-update-password": { kind: "self", reason: "S-1: change the caller's own password; the IdP label is a reviewed skip (passwordManagedBy)" },
    "POST /mfa/setup": { kind: "self", reason: "S-1: start the caller's own second factor" },
    "POST /mfa/verify": { kind: "self", reason: "S-1: confirm the caller's own second factor" },
    "POST /mfa/disable": { kind: "self", reason: "S-1: turn off the caller's own second factor (re-authenticated)" },
  },
  "api/session.route.ts": {
    "GET /mine": { kind: "self", reason: "S-2: own sessions — Session is FACILITY_READABLE by user_id" },
    "POST /mine/:id/revoke": { kind: "self", reason: "S-2: revoke one own session; another user's (of any facility) is the same 404" },
  },
  "api/notifications.route.ts": {
    "GET /": { kind: "self", reason: "S-5: own notifications — Notification is FACILITY_READABLE by userId; tenant broadcasts are hidden" },
    "PATCH /read-all": { kind: "self", reason: "S-5: mark own notifications read (the readable rule bounds the bulk update)" },
    "PATCH /:notificationId/read": { kind: "self", reason: "S-5: one own notification; a broadcast or another user's is the same 404" },
    "DELETE /all": { kind: "self", reason: "S-5: remove own notifications (the readable rule bounds it)" },
    "DELETE /bulk": { kind: "self", reason: "S-5: remove some own notifications (ids outside the rule are not found)" },
    "DELETE /:notificationId": { kind: "self", reason: "S-5: remove one own notification; another's is the same 404" },
  },
  "api/webauthn.route.ts": {
    "GET /status": { kind: "self", reason: "S-3: the caller's own passkey status (webauthn_credentials is keyed by user, C-9)" },
    "POST /registration-options": { kind: "self", reason: "S-3: register a passkey for the caller" },
    "POST /verify-registration": { kind: "self", reason: "S-3: confirm the caller's new passkey" },
    "POST /disable": { kind: "self", reason: "S-3: remove every own passkey (re-authenticated)" },
    "GET /credentials": { kind: "self", reason: "S-3: the caller's own passkeys" },
    "PATCH /credentials/:id": { kind: "self", reason: "S-3: rename an own passkey; another user's is the same 404" },
    "DELETE /credentials/:id": { kind: "self", reason: "S-3: delete an own passkey (re-authenticated); another user's is the same 404" },
  },
  "api/gdpr.route.ts": {
    "POST /export": { kind: "self", reason: "S-4: the subject's own Article 15 export — complete, through the reviewed pagesOf skip (P18-03 § 10.2)" },
    "GET /exports/:exportId/download": { kind: "self", reason: "S-4: the caller's own export; its manifest must name the caller, else 404" },
    "POST /erasure": { kind: "self", reason: "S-4: the subject's own erasure request (DsarRequest is FACILITY_READABLE by userId)" },
    "GET /erasure/:requestId": { kind: "self", reason: "S-4: one own erasure request; another's is the same 404" },
    "PUT /consent": { kind: "self", reason: "S-4: the subject's own consent (ConsentRecord, own-user rule)" },
    "GET /consent/history": { kind: "self", reason: "S-4: the subject's own consent history" },
    "GET /processing": { kind: "self", reason: "S-4: the processing register as it applies to the caller (static)" },
    "PUT /rectify": { kind: "self", reason: "S-4: rectify the subject's own profile field; the e-mail check is a reviewed skip (assertEmailFree)" },
    "POST /restrict": { kind: "self", reason: "S-4: the subject's own restriction request" },
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
    "POST /:userId/avatar": {
      kind: "self",
      selfParam: "userId",
      reason: "S-7: own avatar only (another id is refused before the handler); the quota read is a reviewed skip (getStorageUsageMb)",
    },
    "DELETE /:userId/avatar": { kind: "self", selfParam: "userId", reason: "S-7: remove the caller's own avatar" },
  },
  "api/clientFacilities.route.ts": {
    "GET /mine": { kind: "self", reason: "S-8: the caller's own facility (ClientFacility is FACILITY_READABLE by id = own)" },
  },
  // P21-09e — the domain rows of P18-03 § 8.2, each with its two-facility suite (G-07).
  "api/calibrationDevices.route.ts": {
    "GET /": { kind: "read", reason: "A-1: the facility's inventory (the hooks force the facility predicate)" },
    "GET /:calibrationDeviceId": { kind: "read", reason: "A-1: one device of the facility; another facility's is the same 404 as a missing one" },
    "POST /": { kind: "write", reason: "A-2: HEALTHCARE TECHNICIAN (UD-4 (b)) registers a device in its own facility — stamped, another facility refused (404)" },
    "PUT /:calibrationDeviceId": { kind: "write", reason: "A-3: edit a device of the facility; a bound writer cannot change its status or point it at a location it cannot read" },
    "GET /by-qr/:qrCode": {
      kind: "read",
      reason: "N-13 (P21-02a, A-12 / C-11): the QR lookup in context; unknown, deleted, another facility's and another tenant's QR are the same 404",
    },
    "GET /:calibrationDeviceId/ipm-sessions": {
      kind: "read",
      reason: "A-10 (P21-03, N-2): a device's IPM history — the device is read in context first, another facility's is the 404",
    },
    // P21-02b (spec P19-03 § 7.2, N-6; A-13 / C-10): the register photos of a device of the facility.
    "POST /:calibrationDeviceId/photos": {
      kind: "write",
      reason: "N-6 (P21-02b): a photo of a device of the facility — the device is read in context before the file is read; another facility's is the 404 and nothing is stored",
    },
    "DELETE /:calibrationDeviceId/photos/:attachmentId": {
      kind: "write",
      reason: "N-6 (P21-02b): soft-delete a photo of a device of the facility; a photo of another device, facility or tenant is the same 404",
    },
  },
  // P21-03 (spec P19-02 § 10.1): IPM sessions — reads N-2, draft writes N-3 (within the bound ceiling only HEALTHCARE
  // TECHNICIAN holds `ipm` write). The void (N-4, P21-04) stays unmarked.
  "api/ipmSessions.route.ts": {
    "GET /": { kind: "read", reason: "A-10 (N-2): the facility's IPM sessions (the hooks force the facility predicate)" },
    "GET /:sessionId": { kind: "read", reason: "A-10 (N-2): one session of the facility; another facility's is the same 404 as a missing one" },
    "POST /": { kind: "write", reason: "A-10 (N-3): a draft for a device of the facility — the device is read in context, another facility's is the 404" },
    "PATCH /:sessionId": { kind: "write", reason: "A-10 (N-3): the creator's own draft header (another creator's draft: 403)" },
    "PUT /:sessionId/results": { kind: "write", reason: "A-10 (N-3): the creator's own draft results, checked against the pinned version" },
    "POST /:sessionId/discard": { kind: "write", reason: "A-10 (N-3): the creator discards its own draft (the administrator's discard is unbound only)" },
    "POST /:sessionId/corrections": { kind: "write", reason: "A-10 (N-3): a correction draft of an effective session of the facility" },
    // P21-04 (ADR-126 Am. 5): the submit (N-3), the report document (N-2) and the signature (N-5 — the ONLY marked
    // `esignature` route; `/esignature/*` stays unmarked). The void (N-4) stays unmarked.
    "POST /:sessionId/submit": { kind: "write", reason: "A-10 (N-3): the creator submits its own draft of the facility; the report is issued in the same transaction" },
    "GET /:sessionId/report-document": { kind: "read", reason: "A-10 (N-2): the report document of a session of the facility; a draft previews to its creator only" },
    "POST /:sessionId/signatures": {
      kind: "write",
      reason: "A-11 (N-5): the performer signs its report; the facility's own IPSRS countersigns — never the submitter, never for another facility (404)",
    },
  },
  // P21-04 (P19-02 § 11): "due" — the raw read carries facilityClause (G-14) for a bound principal.
  "api/ipmReports.route.ts": {
    "GET /due": { kind: "read", reason: "C-13 (N-9): the facility's devices whose IPM is due; the raw read binds the facility (facilityClause)" },
  },
  // P21-02a (UD-10, P19-03 § 6.4, A-9): rooms are facility rows; a bound reader sees its facility's
  // rooms only (provider stores have no facility, so the hooks never return them).
  "api/warehouse.route.ts": {
    "GET /": { kind: "read", reason: "A-9: the facility's rooms (the hooks force the facility predicate; stores are never listed for it)" },
    "GET /:warehouseId": { kind: "read", reason: "A-9: one room of the facility; another facility's room and every store are the same 404" },
  },
  "api/calibrationRecords.route.ts": {
    "GET /": { kind: "read", reason: "A-4: the facility's calibration records, with the performer display (A-90)" },
    "GET /:calibrationRecordId": { kind: "read", reason: "A-4: one record of the facility, with the performer display" },
  },
  "api/attachments.route.ts": {
    "POST /": {
      kind: "write",
      reason:
        "A-5: a device photo of the facility, with calibration write; an IPM photo of the caller's own draft, with ipm write (P21-03) — standalone and other types refused (C-4)",
      boundGate: "boundUploadGate",
    },
    "GET /": { kind: "read", reason: "A-6: the facility's files, with the uploader display" },
    "GET /:id": { kind: "read", reason: "A-6: one file of the facility" },
    "GET /:id/download": { kind: "read", reason: "A-6: the bytes, after the row is loaded in context and its key checked (FT-77)" },
    "POST /:id/signed-url": { kind: "read", reason: "A-6: a v3 link (bound issuer, the row's facility), TTL capped (AM-22)" },
  },
  "api/certificates.route.ts": {
    "GET /": { kind: "read", reason: "A-7: the facility's certificates, with the people's displays" },
    "GET /:certificateId": { kind: "read", reason: "A-7: one certificate of the facility" },
    "GET /:certificateId/document": { kind: "read", reason: "A-7: its document data (signed: the snapshot; unsigned: the printed names)" },
    "GET /:certificateId/pdf": { kind: "read", reason: "A-7: a stored PDF of the facility's certificate" },
  },
  "api/maintenance.route.ts": {
    "GET /": { kind: "read", reason: "A-8: the facility's work orders (vendor and assignee includes are LEFT, provider-internal)" },
    "GET /:orderId": { kind: "read", reason: "A-8: one work order of the facility, with the assignee display" },
  },
  // P21-01 (ADR-125 § 6, spec P19-01 § 8.1): the GLOBAL catalogue's reads — no facility-owned rows,
  // the same content for every reader; the operator routes and the proposals stay unmarked.
  "api/deviceTypes.route.ts": {
    "GET /": { kind: "read", reason: "global content (ADR-125 § 6), no facility-owned rows: the device-type picker" },
    "GET /:deviceTypeId": { kind: "read", reason: "global content (ADR-125 § 6), no facility-owned rows: one device type, any status" },
  },
  "api/ipm.route.ts": {
    "GET /templates/published": { kind: "read", reason: "global content (ADR-125 § 6), no facility-owned rows: the published checklists (ADR-127 offline download)" },
    "GET /template-versions/:versionId": {
      kind: "read",
      reason: "global content (ADR-125 § 6), no facility-owned rows: a published or retired checklist version (a draft is a 404)",
    },
  },
});

/** One raw statement over a facility-scoped table that a bound principal cannot reach. */
export interface RawSqlUnreachableEntry {
  readonly reason: string;
  /**
   * Where the statement runs from: `"<route file> <METHOD> <path>"` (each must be UNMARKED —
   * tests/utils/rawSqlFacilityPredicate.d05twin checks it against FACILITY_ACCESSIBLE_ROUTES) or
   * `"system: <what>"` for a job, a boot step or a CLI.
   */
  readonly reachableFrom: readonly string[];
}

/**
 * P21-09d — G-14 (spec § 8): raw statements naming a facility-scoped table WITHOUT
 * `facilityClause(`, keyed `"<file under src>#<table>"`. Each is reachable only from routes a bound
 * principal is refused (FACILITY_ROUTE_REFUSED) or from system work; marking one of those routes
 * makes the twin guard fail until the statement binds the clause and gains a live twin.
 */
export const RAW_SQL_UNREACHABLE_BY_BOUND: Readonly<Record<string, RawSqlUnreachableEntry>> = Object.freeze({
  "services/attachment.service.ts#attachments": {
    reason: "the orphan list (A-115): tenant-administrator housekeeping, `rbac([TENANT_ADMIN])`, never a facility read",
    reachableFrom: ["api/attachments.route.ts GET /orphans"],
  },
  "services/audit.service.ts#audit_logs": {
    reason: "the audit trail's capped count: the audit route is provider administration (P18-03 § 8.2, not marked)",
    reachableFrom: ["api/audit.route.ts GET /"],
  },
  "services/keyRotation.service.ts#${table}": {
    reason: "the operator's KMS key rotation (S-08) across every tenant's envelope tables; no request context",
    reachableFrom: ["system: npm run keys:rotate (operator CLI)"],
  },
  "services/qms.service.ts#${table}": {
    reason: "NC / CAPA numbering (`non_conformances`, `capas`): QMS is provider-internal (P18-03 § 8.2, not marked)",
    reachableFrom: ["api/qms.route.ts POST /nc", "api/qms.route.ts POST /capa"],
  },
  "services/search.service.ts#${table}": {
    reason: "global search (`calibration_devices`, `certificates`): search is not offered to bound principals (ADR-124 § 9, P18-03 § 16)",
    reachableFrom: ["api/search.route.ts GET /"],
  },
  "services/upstreamImport/stagingLoader.ts#${table}": {
    reason: "the SQL-dump import's staging schema (`upstream_import`), the import role's own tables; a worker, no principal",
    reachableFrom: ["system: the upstream SQL-dump import worker (P24-06)"],
  },
  "utils/kmsVerify.util.ts#${table}": {
    reason: "the boot-time KMS key check over every tenant's envelopes (ADR-078); reads key ids and counts only",
    reachableFrom: ["system: boot (ADR-078)"],
  },
});
