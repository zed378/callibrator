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
 */

/**
 * Super Admin Role ID
 * MUST match the Roles seed data exactly
 * If changed, update both this file AND the seed script
 */
const SUPER_ADMIN_ROLE_ID =
  process.env.SUPER_ADMIN_ROLE_ID || "9be20605-cc6a-4d91-8246-9756b4a1754b";

/**
 * Role names - internal system identifiers
 * These should be snake_case or SCREAMING_CASE for programmatic use
 */
const ROLE_NAMES = {
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
};

/**
 * Role display names - user-friendly names shown in UI
 */
const ROLE_DISPLAY_NAMES = {
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
};

/**
 * Role IDs (UUIDs for seeding)
 * These UUIDs are used when seeding the database with default roles
 * Must match the IDs in the seed scripts
 */
const ROLE_IDS = {
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
};

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
const ROLE_LEVELS = {
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
};

/**
 * Built-in roles that cannot be deleted
 */
const BUILTIN_ROLES = Object.values(ROLE_NAMES);

/**
 * Menu group slugs available in the system
 */
const MENU_SLUGS = {
  HOME: "home",
  DASHBOARD: "dashboard",
  ACCOUNT: "account",
  MANAGEMENT: "management",
  SECURITY: "security",
  PROFILE: "profile",
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
};

/**
 * Sub-routes under the Profile menu group
 * These are not separate menu groups, but pages within the profile menu
 */
const PROFILE_SUB_ROUTES = {
  PROFILE: "profile",
  CHANGE_PASSWORD: "change-password",
};

/**
 * Default permission level for menu access
 */
const PERMISSION_TYPES = {
  READ: "read",
  WRITE: "write",
};

/**
 * Role-to-menu permission assignments
 *
 * Default menu access for each role. Every role gets access to:
 * - profile: User profile management (includes profile page and change password)
 *
 * Additional menu access is granted based on role privilege level.
 *
 * Permission types:
 * - "read": View-only access to the menu group
 * - "write": Full access (view + edit) to the menu group
 *
 * Note: Profile sub-routes (profile page, change password) are contained
 * within the "profile" menu group. Assigning "write" permission to "profile"
 * grants access to both the profile page and change password functionality.
 */
const ROLE_MENU_ASSIGNMENTS = [
  {
    roleName: ROLE_NAMES.SUPER_ADMIN,
    description: "Full access to all system menus",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
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
    },
    permissionType: "write",
  },
    {
    roleName: ROLE_NAMES.HEALTCARE_ADMIN,
    description: "Healthcare admin with management access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
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
      [MENU_SLUGS.NETWORK_SECURITY]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.SCIM]: PERMISSION_TYPES.READ,
      // Quality/compliance work is core to this role; billing and
      // platform-governance screens stay read-only.
      [MENU_SLUGS.QMS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.SOP]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.WORKFLOWS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.FINANCE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.METERED_BILLING]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.GDPR]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.CUSTOM_DOMAINS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.BATCH_JOBS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TENANT_HIERARCHY]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RESPONSE]: PERMISSION_TYPES.WRITE,
    },
    permissionType: "write",
  },
  {
    roleName: ROLE_NAMES.CALIBRATOR_ADMIN,
    description: "Calibrator admin with management access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
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
      [MENU_SLUGS.WORKFLOWS]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.FINANCE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.BATCH_JOBS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.KANBAN]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RESPONSE]: PERMISSION_TYPES.WRITE,
    },
    permissionType: "write",
  },
  {
    roleName: ROLE_NAMES.ENGINEERING_MANAGER,
    description: "Engineering manager with management access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
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
      [MENU_SLUGS.WORKFLOWS]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.FINANCE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.KANBAN]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RESPONSE]: PERMISSION_TYPES.WRITE,
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.SUPERVISOR,
    description: "Supervisor with dashboard and account access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.ACCOUNT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.KANBAN]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RESPONSE]: PERMISSION_TYPES.WRITE,
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.TECHNICIAN,
    description: "Technician with basic operational access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.KANBAN]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.HEALTHCARE_TECHNICIAN,
    description: "Healthcare technician with basic access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.FACILITY_MAINTENANCE,
    description: "Facility maintenance staff with home access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.WAREHOUSE_STAFF,
    description: "Warehouse staff with home access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
    },
    permissionType: "write",
  },
  {
    roleName: ROLE_NAMES.ROOM_USER,
    description: "Room user with home and dashboard access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
    },
    permissionType: "read",
  },
  {
    roleName: ROLE_NAMES.USER,
    description: "Basic user with minimal access",
    menus: {
      [MENU_SLUGS.PROFILE]: PERMISSION_TYPES.WRITE,
      [MENU_SLUGS.HOME]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.DASHBOARD]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.ACCOUNT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.WAREHOUSE]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.EQUIPMENT]: PERMISSION_TYPES.READ,
      [MENU_SLUGS.TICKETS_RAISE]: PERMISSION_TYPES.WRITE,
    },
    permissionType: "read",
  },
];

/**
 * Legacy role permissions (deprecated - kept for backward compatibility)
 * @deprecated Use ROLE_MENU_ASSIGNMENTS instead
 */
const ROLE_PERMISSIONS = {
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
const ROLE_SEEDING_ORDER = [
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

module.exports = {
  SUPER_ADMIN_ROLE_ID,
  ROLE_NAMES,
  ROLE_DISPLAY_NAMES,
  ROLE_IDS,
  ROLE_LEVELS,
  BUILTIN_ROLES,
  MENU_SLUGS,
  PROFILE_SUB_ROUTES,
  PERMISSION_TYPES,
  ROLE_MENU_ASSIGNMENTS,
  ROLE_PERMISSIONS,
  ROLE_SEEDING_ORDER,
};
