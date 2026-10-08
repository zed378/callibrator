/**
 * Role Constants
 *
 * Centralized role-related constants including role names, IDs, display names,
 * hierarchy levels, and menu assignments.
 * These values must stay in sync with the database seed data.
 *
 * Migration path:
 * - When updating roles, update both this file AND the seed scripts
 * - ROLE_IDS UUIDs are used in database seeding
 * - ROLE_NAMES are used throughout the application for role checks
 * - ROLE_DISPLAY_NAMES are used for UI display purposes
 * - ROLE_MENU_ASSIGNMENTS define default menu access per role
 *
 * P9-08 (ADR-087): converted from roleConstants.js with no behaviour change.
 * `as const` and `satisfies` are types only; nothing is frozen that was not.
 * ROLE_LEVELS `satisfies` a record over every ROLE_NAMES key, so a role added
 * to ROLE_NAMES without a level no longer compiles (it used to fail every
 * privileged gate silently — CLAUDE.md, The Traps).
 */

import { envOr } from "../config/env";

/**
 * Super Admin Role ID
 * MUST match the Roles seed data exactly
 * If changed, update both this file AND the seed script
 */
export const SUPER_ADMIN_ROLE_ID: string =
  // Read at module load, as it always was; an EMPTY variable means "use the
  // default" (envOr: unset or "" -> the default).
  envOr("SUPER_ADMIN_ROLE_ID", "9be20605-cc6a-4d91-8246-9756b4a1754b");

/**
 * Role names - internal system identifiers
 * These should be snake_case or SCREAMING_CASE for programmatic use
 */
export const ROLE_NAMES = {
  SUPER_ADMIN: "SUPERADMIN",
  HEALTCARE_ADMIN: "HEALTHCARE ADMIN",
  CALIBRATOR_ADMIN: "CALIBRATOR ADMIN",
  USER: "USER",
  TECHNICIAN: "TECHNICIAN",
  SUPERVISOR: "SUPERVISOR",
  ENGINEERING_MANAGER: "ENGINEERING MANAGER",
  HEALTHCARE_TECHNICIAN: "HEALTHCARE TECHNICIAN",
  FACILITY_MAINTENANCE: "FACILITY MAINTENANCE",
  WAREHOUSE_STAFF: "WAREHOUSE STAFF",
  ROOM_USER: "ROOM USER",
  // Logical authorization tier — NOT a seeded DB role. Represents the
  // "tenant administrator" level (equal to HEALTHCARE_ADMIN / CALIBRATOR_ADMIN)
  // and is used by rbac() to gate tenant-scoped admin routes (e.g. tenant
  // backups) via role-level comparison, since no single "TENANT_ADMIN" role
  // exists in the seed data.
  TENANT_ADMIN: "TENANT_ADMIN",
} as const;

/** A key of ROLE_NAMES (`SUPER_ADMIN`, `TENANT_ADMIN`, …). */
export type RoleKey = keyof typeof ROLE_NAMES;

/** A role name as stored in `roles.name` (`SUPERADMIN`, `HEALTHCARE ADMIN`, …). */
export type RoleName = (typeof ROLE_NAMES)[RoleKey];

/**
 * Role display names - user-friendly names shown in UI
 */
export const ROLE_DISPLAY_NAMES = {
  [ROLE_NAMES.SUPER_ADMIN]: "Super Admin",
  [ROLE_NAMES.HEALTCARE_ADMIN]: "Admin Faskes",
  [ROLE_NAMES.CALIBRATOR_ADMIN]: "Admin Kalibrator",
  [ROLE_NAMES.USER]: "Normal User",
  [ROLE_NAMES.TECHNICIAN]: "Teknisi",
  [ROLE_NAMES.SUPERVISOR]: "Penyelia",
  [ROLE_NAMES.ENGINEERING_MANAGER]: "Manajer Teknik",
  [ROLE_NAMES.HEALTHCARE_TECHNICIAN]: "Teknisi Faskes",
  [ROLE_NAMES.FACILITY_MAINTENANCE]: "IPSRS",
  [ROLE_NAMES.WAREHOUSE_STAFF]: "Gudang",
  [ROLE_NAMES.ROOM_USER]: "User Ruangan",
} as const;

/**
 * Role IDs (UUIDs for seeding)
 * These UUIDs are used when seeding the database with default roles
 * Must match the IDs in the seed scripts
 */
export const ROLE_IDS = {
  SUPER_ADMIN: "9be20605-cc6a-4d91-8246-9756b4a1754b",
  HEALTCARE_ADMIN: "cd8ce1a8-138e-4a4d-8ae2-2f52ad3a8d08",
  CALIBRATOR_ADMIN: "ce5bc0f9-b342-45d1-b08a-b626c6026a7f",
  USER: "e7e1cdd1-14fe-440f-89ec-b0bcd7041f9c",
  TECHNICIAN: "752e324a-e426-4cc9-ae2d-639b1a7a2785",
  SUPERVISOR: "137404e9-c995-4437-be17-d1af64ab3c30",
  ENGINEERING_MANAGER: "74101285-c256-4cb9-951d-24ed6547a9cb",
  HEALTHCARE_TECHNICIAN: "b85b324b-9b80-4c36-85b8-46db21872bdf",
  FACILITY_MAINTENANCE: "5e724805-02ba-498f-a7f0-6b415c8f69fe",
  WAREHOUSE_STAFF: "e50b664b-451c-45a9-8c83-f65b94a8afdf",
  ROOM_USER: "6fdd1212-9c4f-45d5-b3bf-5335892be7c0",
} as const;

/**
 * Role hierarchy levels
 * Higher numbers = higher privilege
 *
 * - 10: SUPER_ADMIN - Has full access to all resources
 * - 8: HEALTHCARE_ADMIN, CALIBRATOR_ADMIN - Administrators
 * - 7: ENGINEERING_MANAGER - Management
 * - 6: SUPERVISOR - Supervision
 * - 5: TECHNICIAN, HEALTHCARE_TECHNICIAN - Technical staff
 * - 4: FACILITY_MAINTENANCE, WAREHOUSE_STAFF - Operational staff
 * - 3: ROOM_USER - Regular users with limited access
 * - 1: USER - Basic access (profile only)
 */
export const ROLE_LEVELS = {
  SUPER_ADMIN: 10,
  // Logical tier (see ROLE_NAMES.TENANT_ADMIN) — same level as the admin roles.
  TENANT_ADMIN: 8,
  HEALTCARE_ADMIN: 8,
  CALIBRATOR_ADMIN: 8,
  ENGINEERING_MANAGER: 7,
  SUPERVISOR: 6,
  TECHNICIAN: 5,
  HEALTHCARE_TECHNICIAN: 5,
  FACILITY_MAINTENANCE: 4,
  WAREHOUSE_STAFF: 4,
  ROOM_USER: 3,
  USER: 1,
} as const satisfies Record<RoleKey, number>;

/**
 * Built-in roles that cannot be deleted
 */
export const BUILTIN_ROLES: RoleName[] = Object.values(ROLE_NAMES);

/**
 * Menu group slugs available in the system
 */
export const MENU_SLUGS = {
  HOME: "home",
  DASHBOARD: "dashboard",
  ACCOUNT: "account",
  MANAGEMENT: "management",
  SECURITY: "security",
  // A-80: the seeded slug of the Profile page (seedMenuGroups.util.js, a child
  // of Account; menuGroup.service maps it to /dashboard/profile). This said
  // "profile", which no menu group has, so the seed skipped the grant for
  // every role. The boot assertion now refuses an assignment slug the seed
  // does not create (authorizationWiring.util.js#checkRoleMenuAssignments).
  PROFILE: "profile-page",
  WAREHOUSE: "warehouse",
  EQUIPMENT: "equipment",
  CONTENT: "content",
  RISK: "risk",
  SUPPLIER_SCORECARD: "supplier-scorecard",
  PREDICTIVE_MAINTENANCE: "predictive-maintenance",
  FEATURE_FLAGS: "feature-flags",
  TENANT_LIFECYCLE: "tenant-lifecycle",
  DATA_RETENTION: "data-retention",
  OIDC: "oidc",
  WEBAUTHN: "webauthn",
  NETWORK_SECURITY: "network-security",
  SCIM: "scim",
  QMS: "qms",
  SOP: "sop",
  WORKFLOWS: "workflows",
  FINANCE: "finance",
  METERED_BILLING: "metered-billing",
  GDPR: "gdpr",
  CUSTOM_DOMAINS: "custom-domains",
  BATCH_JOBS: "batch-jobs",
  TENANT_HIERARCHY: "tenant-hierarchy",
  KANBAN: "kanban",
  // Support desk is two menus: everyone-except-super-admin raises tickets to the
  // platform; a responder role (or the super admin) works the response queue.
  TICKETS_RAISE: "tickets-raise",
  TICKETS_RESPONSE: "tickets-response",
  // A-84: the e-signature signing surface (POST /esignature/sign, /verify,
  // /history). Separate from QMS on purpose: a signer is whoever a workflow
  // names, commonly a role with no `qms` menu. A-129 (ADR-051 Q-19): granted
  // `write` to the technical roles only — not USER, ROOM USER or WAREHOUSE
  // STAFF — see ROLE_MENU_ASSIGNMENTS and migration 0031.
  ESIGNATURE: "esignature",
  // A-118: the AI Assistant page (/dashboard/ai-assistant). A MENU entry only —
  // the page's two calls are gated by the slugs of what they touch:
  // POST /ai/ocr on `certificate` write, POST /ai/query on `sop` read. Granted
  // by default to exactly the roles that hold one of those (below; migration
  // 0038 for databases seeded before it existed).
  AI_ASSISTANT: "ai-assistant",
  // Q-20 (ADR-056): four Management pages the seed creates and
  // route gates name, which no role but SUPERADMIN reached — the matrix
  // inherits a grant ONE level down, and they sit two below `management`.
  // Granted by slug to the roles below; migration 0054 for seeded databases.
  USERS: "users",
  VENDORS: "vendors",
  BILLING: "billing",
  AUDIT: "audit",
  // ADR-102: /dashboard/stock (top level, next to Warehouse; its API is gated
  // by `warehouse`) and /dashboard/storage (Management › Content; its API is
  // rbac TENANT_ADMIN) had no menu entry. Migration 0097 for seeded databases.
  STOCK: "stock",
  STORAGE: "storage",
  // ADR-102: pages the old sidebar showed by cascading a `management` grant
  // two levels down and whose API serves them through a gate OTHER than their
  // own grant (constants/menuPageAccess). The sidebar now reads the effective
  // permission (one level), so these are granted by slug to the roles that
  // could use them — migration 0097 for seeded databases.
  TENANTS: "tenants",
  API_KEYS: "api-keys",
  WEBHOOKS: "webhooks",
  ATTACHMENTS: "attachments",
  // P10-07 (ADR-098 §6): the super admin's access-request queue
  // (/dashboard/access-requests). SUPERADMIN only; migration 0101.
  ACCESS_REQUESTS: "access-requests",
  // P24-06: the super admin's SQL-dump import (/dashboard/upstream-sql-import).
  // SUPERADMIN only; migration 0116.
  UPSTREAM_SQL_IMPORT: "upstream-sql-import",
  // P20-06 (spec P18-01-02 § 4.1): the seeded slug of the device register
  // (/dashboard/devices). The routes name it as the literal "calibration";
  // the member exists so the UD-4 (b) rows below can name it.
  CALIBRATION: "calibration",
  // P20-06 (spec P18-03 § 7, P18-01-02 § 3.1; migration 0124): IPM sessions and
  // the IPM checklists under Equipment, client facilities under
  // Management › Organisation.
  IPM: "ipm",
  IPM_TEMPLATES: "ipm-templates",
  CLIENT_FACILITIES: "client-facilities",
} as const;

/** A seeded menu-group slug. */
export type MenuSlug = (typeof MENU_SLUGS)[keyof typeof MENU_SLUGS];

/**
 * Sub-routes under the Profile menu group
 * These are not separate menu groups, but pages within the profile menu
 */
export const PROFILE_SUB_ROUTES = {
  PROFILE: "profile",
  CHANGE_PASSWORD: "change-password",
} as const;

/**
 * Default permission level for menu access
 */
export const PERMISSION_TYPES = {
  READ: "read",
  WRITE: "write",
} as const;

/** `read` or `write`. */
export type PermissionType = (typeof PERMISSION_TYPES)[keyof typeof PERMISSION_TYPES];

/** One role's default menu grants. */
export interface RoleMenuAssignment {
  roleName: RoleName;
  description: string;
  menus: Partial<Record<MenuSlug, PermissionType>>;
  permissionType: PermissionType;
}

/**
 * Role-to-menu permission assignments
 *
 * Default menu access for each role. Every role gets access to:
 * - profile-page: the user's own Profile page (MENU_SLUGS.PROFILE)
 *
 * Additional menu access is granted based on role privilege level.
 *
 * Permission types:
 * - "read": View-only access to the menu group
 * - "write": Full access (view + edit) to the menu group
 *
 * Note (A-80): `profile-page` and `change-password` are SIBLING children of
 * the `account` menu group in the seed. A grant on `profile-page` does not
 * include `change-password`; a grant on `account` cascades to both.
 * Every key here must be a slug the seed creates — the boot assertion refuses
 * to start otherwise.
 */
export const ROLE_MENU_ASSIGNMENTS: RoleMenuAssignment[] = [
  {
    roleName: ROLE_NAMES.SUPER_ADMIN,
    description: "Full access to all system menus",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      // A-84 / A-129 (ADR-051 Q-19): the roles whose work includes attesting
      // records may sign — the admin roles, ENGINEERING MANAGER, SUPERVISOR,
      // TECHNICIAN, HEALTHCARE TECHNICIAN and FACILITY MAINTENANCE. USER,
      // ROOM USER and WAREHOUSE STAFF do not: least privilege, as they do no
      // technical work. A workflow cannot be created naming a signer without
      // this grant (eSignature.service#createSignatureWorkflow), so leaving a
      // role out cannot strand a workflow. A tenant grants it per role or per
      // user in the permissions screen when it has a reason.
      [MENU_SLUGS.ESIGNATURE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.ACCOUNT]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.MANAGEMENT]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.SECURITY]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.CONTENT]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.RISK]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.SUPPLIER_SCORECARD]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.PREDICTIVE_MAINTENANCE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.FEATURE_FLAGS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TENANT_LIFECYCLE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.DATA_RETENTION]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.OIDC]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.WEBAUTHN]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.NETWORK_SECURITY]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.SCIM]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.QMS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.SOP]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.AI_ASSISTANT]: PERMISSION_TYPES.READ, // A-118: holds `sop`
      [MENU_SLUGS.WORKFLOWS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.FINANCE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.METERED_BILLING]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.GDPR]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.CUSTOM_DOMAINS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.BATCH_JOBS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TENANT_HIERARCHY]: PERMISSION_TYPES.WRITE,
      // The platform operator answers the cross-tenant support desk but never
      // raises tickets, so it gets response only (no raise menu).
      [MENU_SLUGS.TICKETS_RESPONSE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.STOCK]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.STORAGE]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      // P10-07: approving a request creates a tenant (A-76) — the platform's alone.
      [MENU_SLUGS.ACCESS_REQUESTS]: PERMISSION_TYPES.WRITE, // migration 0101
      // P24-06: the upstream SQL-dump import is a platform operation.
      [MENU_SLUGS.UPSTREAM_SQL_IMPORT]: PERMISSION_TYPES.WRITE, // migration 0116
      [MENU_SLUGS.IPM]: PERMISSION_TYPES.WRITE, // P20-06 (migration 0124)
      [MENU_SLUGS.IPM_TEMPLATES]: PERMISSION_TYPES.WRITE, // P20-06 (migration 0124)
      [MENU_SLUGS.CLIENT_FACILITIES]: PERMISSION_TYPES.WRITE, // P20-06 (migration 0124)
    },
    permissionType: "write",
  },
  {
    roleName: ROLE_NAMES.HEALTCARE_ADMIN,
    description: "Healthcare admin with management access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.ESIGNATURE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.ACCOUNT]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.MANAGEMENT]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.RISK]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.SUPPLIER_SCORECARD]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.PREDICTIVE_MAINTENANCE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.FEATURE_FLAGS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TENANT_LIFECYCLE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DATA_RETENTION]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.OIDC]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WEBAUTHN]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.NETWORK_SECURITY]: PERMISSION_TYPES.WRITE, // Q-38 (ADR-100, migration 0098): its own allowlist and geofence
      [MENU_SLUGS.SCIM]: PERMISSION_TYPES.READ,
      // Quality/compliance work is core to this role; billing and
      // platform-governance screens stay read-only.
      [MENU_SLUGS.QMS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.SOP]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.AI_ASSISTANT]: PERMISSION_TYPES.READ, // A-118: holds `sop`
      [MENU_SLUGS.WORKFLOWS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.FINANCE]: PERMISSION_TYPES.READ,
      // ADR-043: metered-billing moved from rbac([TENANT_ADMIN]) to
      // dynamicAccess("metered-billing", …). READ here would have turned one
      // silent lockout into another — a tenant admin could see usage but never
      // set a usage alert. Managing the tenant's own billing alerts is
      // tenant-admin work, which is what the rbac gate meant.
      [MENU_SLUGS.METERED_BILLING]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.GDPR]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.CUSTOM_DOMAINS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.BATCH_JOBS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TENANT_HIERARCHY]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RESPONSE]: PERMISSION_TYPES.WRITE,
      // Q-20: a tenant administrator manages its own tenant's users and
      // vendors (every route is tenant-scoped, and user.service refuses to
      // create or grant SUPERADMIN), reads its own subscription and invoices
      // (PATCH /billing/subscription can set `status` — a platform override,
      // so no write), and reviews its own tenant's audit trail
      // (21 CFR 11.10(e); /audit is tenant-scoped). `content` is the
      // platform-wide public blog and stays SUPERADMIN-only.
      [MENU_SLUGS.USERS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.VENDORS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.BILLING]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.AUDIT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.STOCK]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.STORAGE]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.TENANTS]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.KANBAN]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.API_KEYS]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.WEBHOOKS]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.ATTACHMENTS]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.CLIENT_FACILITIES]: PERMISSION_TYPES.WRITE, // P20-06 (migration 0124)
    },
    permissionType: "write",
  },
  {
    roleName: ROLE_NAMES.CALIBRATOR_ADMIN,
    description: "Calibrator admin with management access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.ESIGNATURE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.ACCOUNT]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.MANAGEMENT]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.RISK]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.SUPPLIER_SCORECARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.PREDICTIVE_MAINTENANCE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.FEATURE_FLAGS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TENANT_LIFECYCLE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DATA_RETENTION]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.QMS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.SOP]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.AI_ASSISTANT]: PERMISSION_TYPES.READ, // A-118: holds `sop`
      [MENU_SLUGS.WORKFLOWS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.FINANCE]: PERMISSION_TYPES.READ,
      // ADR-043: CALIBRATOR ADMIN had no metered-billing row at all, so it was
      // denied the whole surface once the gate became dynamicAccess. Same tier
      // as HEALTHCARE ADMIN, same grant.
      [MENU_SLUGS.METERED_BILLING]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.BATCH_JOBS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.KANBAN]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RESPONSE]: PERMISSION_TYPES.WRITE,
      // Q-20: same tier as HEALTHCARE ADMIN, same grants (see there).
      [MENU_SLUGS.USERS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.VENDORS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.BILLING]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.AUDIT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.STOCK]: PERMISSION_TYPES.READ, // ADR-102 (migration 0097)
      [MENU_SLUGS.STORAGE]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.TENANTS]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.TENANT_HIERARCHY]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.API_KEYS]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.WEBHOOKS]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.ATTACHMENTS]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
      [MENU_SLUGS.CLIENT_FACILITIES]: PERMISSION_TYPES.WRITE, // P20-06 (migration 0124)
    },
    permissionType: "write",
  },
  {
    roleName: ROLE_NAMES.ENGINEERING_MANAGER,
    description: "Engineering manager with management access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.ESIGNATURE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.ACCOUNT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.MANAGEMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.RISK]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.SUPPLIER_SCORECARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.PREDICTIVE_MAINTENANCE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.QMS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.SOP]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.AI_ASSISTANT]: PERMISSION_TYPES.READ, // A-118: holds `sop`
      [MENU_SLUGS.WORKFLOWS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.FINANCE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.KANBAN]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RESPONSE]: PERMISSION_TYPES.WRITE,
      // Q-20: reads the vendor list its supplier scorecards and work orders
      // name; managing vendors stays with the admin roles.
      [MENU_SLUGS.VENDORS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.STOCK]: PERMISSION_TYPES.READ, // ADR-102 (migration 0097)
      [MENU_SLUGS.TENANTS]: PERMISSION_TYPES.READ, // ADR-102 (migration 0097)
      [MENU_SLUGS.TENANT_HIERARCHY]: PERMISSION_TYPES.READ, // ADR-102 (migration 0097)
      [MENU_SLUGS.ATTACHMENTS]: PERMISSION_TYPES.READ, // ADR-102 (migration 0097)
      [MENU_SLUGS.CLIENT_FACILITIES]: PERMISSION_TYPES.READ, // P20-06 (migration 0124)
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.SUPERVISOR,
    description: "Supervisor with dashboard and account access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.ESIGNATURE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.ACCOUNT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.KANBAN]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RESPONSE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.STOCK]: PERMISSION_TYPES.READ, // ADR-102 (migration 0097)
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.TECHNICIAN,
    description: "Technician with basic operational access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.ESIGNATURE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.CALIBRATION]: PERMISSION_TYPES.WRITE, // UD-4 (b), working decision 2026-10-08 (migration 0124)
      [MENU_SLUGS.IPM]: PERMISSION_TYPES.WRITE, // P20-06 (migration 0124)
      [MENU_SLUGS.KANBAN]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.STOCK]: PERMISSION_TYPES.READ, // ADR-102 (migration 0097)
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.HEALTHCARE_TECHNICIAN,
    description: "Healthcare technician with basic access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.ESIGNATURE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.CALIBRATION]: PERMISSION_TYPES.WRITE, // UD-4 (b), working decision 2026-10-08 (migration 0124)
      [MENU_SLUGS.IPM]: PERMISSION_TYPES.WRITE, // P20-06 (migration 0124)
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.STOCK]: PERMISSION_TYPES.READ, // ADR-102 (migration 0097)
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.FACILITY_MAINTENANCE,
    description: "Facility maintenance staff with home access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.ESIGNATURE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      // P20-06: a self-served hospital's IPSRS captures IPM; a bound one is
      // capped to read by the bound menu ceiling (P18-03 § 5). `calibration`
      // is NOT widened for this role (UD-4 (b) names the technicians only).
      [MENU_SLUGS.IPM]: PERMISSION_TYPES.WRITE, // P20-06 (migration 0124)
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.STOCK]: PERMISSION_TYPES.READ, // ADR-102 (migration 0097)
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.WAREHOUSE_STAFF,
    description: "Warehouse staff with home access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      // No ESIGNATURE (A-129, ADR-051 Q-19; revoked by migration 0031).
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.STOCK]: PERMISSION_TYPES.WRITE, // ADR-102 (migration 0097)
    },
    permissionType: "write",
  },
  {
    roleName: ROLE_NAMES.ROOM_USER,
    description: "Room user with home and dashboard access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      // No ESIGNATURE (A-129, ADR-051 Q-19; revoked by migration 0031).
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.STOCK]: PERMISSION_TYPES.READ, // ADR-102 (migration 0097)
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.USER,
    description: "Basic user with minimal access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      // No ESIGNATURE (A-129, ADR-051 Q-19; revoked by migration 0031).
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.ACCOUNT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.STOCK]: PERMISSION_TYPES.READ, // ADR-102 (migration 0097)
    },
    permissionType: "read",
  },
];

/**
 * Legacy role permissions (deprecated - kept for backward compatibility)
 * @deprecated Use ROLE_MENU_ASSIGNMENTS instead
 */
export const ROLE_PERMISSIONS: Partial<Record<RoleName, "ALL" | string[]>> = {
  [ROLE_NAMES.SUPER_ADMIN]: "ALL",
  [ROLE_NAMES.HEALTCARE_ADMIN]: [
    "user:tenant:create",
    "user:tenant:read",
    "user:tenant:update",
    "user:tenant:delete",
    "user:tenant:assign",
    "user:self:update",
    "user:self:read",
    "tenant:tenant:read",
    "tenant:tenant:assign",
    "tenant:self:update",
    "tenant:self:read",
    "tenant:backup:create",
    "tenant:backup:read",
    "tenant:backup:restore",
    "tenant:backup:delete",
  ],
  [ROLE_NAMES.CALIBRATOR_ADMIN]: [
    "user:tenant:create",
    "user:tenant:read",
    "user:tenant:update",
    "user:tenant:delete",
    "user:tenant:assign",
    "user:self:update",
    "user:self:read",
    "tenant:tenant:read",
    "tenant:tenant:assign",
    "tenant:self:update",
    "tenant:self:read",
    "tenant:backup:create",
    "tenant:backup:read",
    "tenant:backup:restore",
    "tenant:backup:delete",
  ],
  [ROLE_NAMES.USER]: ["user:self:update", "user:self:read"],
};

/**
 * Role seeding order (for database seeding)
 * Roles with higher levels must be created first for foreign key references
 */
export const ROLE_SEEDING_ORDER: RoleName[] = [
  ROLE_NAMES.SUPER_ADMIN,
  ROLE_NAMES.HEALTCARE_ADMIN,
  ROLE_NAMES.CALIBRATOR_ADMIN,
  ROLE_NAMES.USER,
  ROLE_NAMES.ENGINEERING_MANAGER,
  ROLE_NAMES.SUPERVISOR,
  ROLE_NAMES.TECHNICIAN,
  ROLE_NAMES.HEALTHCARE_TECHNICIAN,
  ROLE_NAMES.FACILITY_MAINTENANCE,
  ROLE_NAMES.WAREHOUSE_STAFF,
  ROLE_NAMES.ROOM_USER,
];
