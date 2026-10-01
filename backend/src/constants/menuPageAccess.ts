/**
 * ADR-102 — what the API requires before a menu entry's page can be used.
 *
 * A menu entry is shown only when the principal's EFFECTIVE permission (the
 * one `dynamicAccess` checks — role grant, inherited one level, then the
 * per-user override; services/effectivePermission.service.ts) grants `read`
 * on the entry's own slug AND every gate listed here for that slug passes.
 * A slug not listed is gated by its own grant alone, which is what most
 * routes check (`dynamicAccess(<slug>, "read")`).
 *
 * Each entry names the gate the page's LOAD call is behind, quoted from the
 * route file, because that is the call that 403s when it fails. A write gate
 * is not a visibility gate: the page hides its write actions itself
 * (frontend usePermissions, same source).
 *
 * A route file that changes a page's gate must change this table: the test
 * menuPageAccess.adr102.test.ts reads the route files and fails when a listed
 * gate no longer appears there.
 *
 * Why the slugs are not renamed (the audit's "crossed keys", F8/IA5): the
 * slug `calibration` shows /dashboard/devices and gates the device API; the
 * slug `certificate` shows /dashboard/calibration and gates the certificate
 * API. Each slug shows the page its API guards, so the grant and the page
 * agree. The Calibration Scheduler is the one real mismatch — its page loads
 * from a `maintenance`-gated route — and it is fixed here, as a gate, not by
 * a slug migration that would move every grant and override.
 */
import { ROLE_NAMES } from "./roleConstants";

/** The page's load call is behind `dynamicAccess(slug, "read")` on ANOTHER slug. */
export interface MenuGate {
  readonly kind: "menu";
  readonly slug: string;
}

/** The page's load call is behind `rbac(roles)` (allowHigher, as rbac.middleware). */
export interface RoleGate {
  readonly kind: "rbac";
  readonly roles: readonly string[];
}

/** The page's service refuses the super admin (BR-13: the platform does not raise tickets to itself). */
export interface NotSuperAdminGate {
  readonly kind: "notSuperAdmin";
}

export type PageGate = MenuGate | RoleGate | NotSuperAdminGate;

const menu = (slug: string): MenuGate => Object.freeze({ kind: "menu", slug });
const roles = (...names: string[]): RoleGate => Object.freeze({ kind: "rbac", roles: Object.freeze(names) });
const SUPER_ADMIN_ONLY = roles(ROLE_NAMES.SUPER_ADMIN);
const TENANT_ADMIN_LEVEL = roles(ROLE_NAMES.TENANT_ADMIN);

/**
 * slug → the gates its page's load call is behind, besides the slug's own
 * grant. Source of each (route file, handler):
 */
export const MENU_PAGE_GATES: Readonly<Record<string, readonly PageGate[]>> = Object.freeze({
  // tenant.route.js — POST /tenants/detail (a tenant user's own tenant; the
  // platform list GET /tenants/all is superAdminOnly): dynamicAccess("management", "read")
  tenants: [menu("management")],
  // roles.route.js — GET /roles: rbac(["SUPERADMIN"])
  roles: [SUPER_ADMIN_ONLY],
  // menuGroups.route.js — GET /menu-groups/menu-groups/admin: rbac(["SUPERADMIN"])
  "menu-groups": [SUPER_ADMIN_ONLY],
  // roles.route.js — the role × menu matrix: rbac(["SUPERADMIN"])
  permissions: [SUPER_ADMIN_ONLY],
  // userPermissions.route.js — rbac(["SUPERADMIN"])
  "user-permissions": [SUPER_ADMIN_ONLY],
  // session.route.js — rbac(["SUPERADMIN"])
  sessions: [SUPER_ADMIN_ONLY],
  // apiKeys.route.js — adminOnly: rbac([ROLE_NAMES.TENANT_ADMIN])
  "api-keys": [TENANT_ADMIN_LEVEL],
  // webhooks.route.js — webhookAdmin: rbac([ROLE_NAMES.TENANT_ADMIN])
  webhooks: [TENANT_ADMIN_LEVEL],
  // storage.route.js — storageAdmin: rbac([ROLE_NAMES.TENANT_ADMIN])
  storage: [TENANT_ADMIN_LEVEL],
  // attachments.route.js — GET /attachments: dynamicAccess(MENU_SLUGS.EQUIPMENT, "read")
  attachments: [menu("equipment")],
  // calibrationScheduler.route.js — GET /calibration-scheduler/due: dynamicAccess("maintenance", "read")
  "calibration-scheduler": [menu("maintenance")],
  // predictiveMaintenance.route.js — GET /recommendations: dynamicAccess("calibration", "read")
  "predictive-maintenance": [menu("calibration")],
  // scim.route.js — requireApiKeyOrAdmin: a SCIM-scoped API key or the super
  // admin, for reads too; a tenant role holding `scim` read got 403.
  scim: [SUPER_ADMIN_ONLY],
  // stock.route.js — every call: dynamicAccess("warehouse", "read" | "write")
  stock: [menu("warehouse")],
  // admin.route.js — the access-request queue (P10-07): router.use(rbac(["SUPER_ADMIN", "SUPERADMIN"]))
  "access-requests": [SUPER_ADMIN_ONLY],
  // ticket.service.js — the super admin may not raise a ticket (BR-13)
  "tickets-raise": [{ kind: "notSuperAdmin" }],
});

/**
 * The route file each MENU/RBAC gate above is quoted from, and the text that
 * must appear in it — read by menuPageAccess.adr102.test.ts. The file is named
 * WITHOUT its extension (P9-21): a route module is `.js` until it converts and
 * `.ts` after; the test reads whichever exists.
 */
export const MENU_PAGE_GATE_SOURCES: Readonly<Record<string, { readonly file: string; readonly text: string }>> =
  Object.freeze({
    tenants: { file: "tenant.route", text: 'dynamicAccess("management", "read", { checkTenant: true })' },
    roles: { file: "roles.route", text: 'rbac(["SUPERADMIN"])' },
    "menu-groups": { file: "menuGroups.route", text: 'rbac(["SUPERADMIN"])' },
    permissions: { file: "roles.route", text: 'rbac(["SUPERADMIN"])' },
    "user-permissions": { file: "userPermissions.route", text: 'rbac(["SUPERADMIN"])' },
    sessions: { file: "session.route", text: 'rbac(["SUPERADMIN"])' },
    "api-keys": { file: "apiKeys.route", text: "rbac([ROLE_NAMES.TENANT_ADMIN])" },
    webhooks: { file: "webhooks.route", text: "rbac([ROLE_NAMES.TENANT_ADMIN])" },
    storage: { file: "storage.route", text: "rbac([ROLE_NAMES.TENANT_ADMIN])" },
    attachments: { file: "attachments.route", text: 'router.get("/", auth, dynamicAccess(MENU_SLUGS.EQUIPMENT, "read")' },
    "calibration-scheduler": { file: "calibrationScheduler.route", text: '"maintenance", "read"' },
    "predictive-maintenance": { file: "predictiveMaintenance.route", text: '"calibration", "read"' },
    stock: { file: "stock.route", text: '"warehouse", "read"' },
    scim: { file: "scim.route", text: "keyMayUseScim(req)) || isSuperAdmin(req.user)" },
    "access-requests": { file: "admin.route", text: 'rbac(["SUPER_ADMIN", "SUPERADMIN"])' },
  });
