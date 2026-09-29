/**
 * The constants barrel.
 *
 * P9-08 (ADR-087): converted from index.js with no behaviour change. Each
 * export is a `const` captured when this module loads — exactly what the old
 * `module.exports = { X: role.X, … }` object did — not an `export … from`
 * re-export, which would compile to a live, non-writable getter.
 */
import * as role from "./roleConstants";
import * as app from "./appConstants";
import * as tenant from "./tenantConstants";
import { AUDIT_ACTIONS as auditActions } from "./auditActions";

// Role constants
export const SUPER_ADMIN_ROLE_ID = role.SUPER_ADMIN_ROLE_ID;
export const ROLE_NAMES = role.ROLE_NAMES;
export const ROLE_IDS = role.ROLE_IDS;
export const ROLE_LEVELS = role.ROLE_LEVELS;
export const BUILTIN_ROLES = role.BUILTIN_ROLES;
// The barrel has always exported it; its JavaScript callers still read it here.
// eslint-disable-next-line @typescript-eslint/no-deprecated -- kept for the callers listed in roleConstants (deprecated there)
export const ROLE_PERMISSIONS = role.ROLE_PERMISSIONS;
export const MENU_SLUGS = role.MENU_SLUGS;
export const PROFILE_SUB_ROUTES = role.PROFILE_SUB_ROUTES;
export const PERMISSION_TYPES = role.PERMISSION_TYPES;
export const ROLE_MENU_ASSIGNMENTS = role.ROLE_MENU_ASSIGNMENTS;
// Tenant constants
export const TENANT_PERMISSIONS = tenant.TENANT_PERMISSIONS;
// App constants
export const DEFAULT_TENANT = app.DEFAULT_TENANT;
export const DEFAULT_PAGE = app.DEFAULT_PAGE;
export const DEFAULT_LIMIT = app.DEFAULT_LIMIT;
export const MAX_LIMIT = app.MAX_LIMIT;
export const USER_STATUS = app.USER_STATUS;
export const OTP_LENGTH = app.OTP_LENGTH;
export const OTP_EXPIRY_MINUTES = app.OTP_EXPIRY_MINUTES;
export const OTP_MAX_REQUESTS = app.OTP_MAX_REQUESTS;
export const OTP_REQUEST_WINDOW_MINUTES = app.OTP_REQUEST_WINDOW_MINUTES;
export const PASSWORD_MIN_LENGTH = app.PASSWORD_MIN_LENGTH;
export const PASSWORD_SALT_ROUNDS = app.PASSWORD_SALT_ROUNDS;
export const DEFAULT_SESSION_EXPIRY_HOURS = app.DEFAULT_SESSION_EXPIRY_HOURS;
export const MAX_SESSIONS_PER_USER = app.MAX_SESSIONS_PER_USER;
export const DEFAULT_BACKUP_RETENTION_DAYS = app.DEFAULT_BACKUP_RETENTION_DAYS;
export const MAX_BACKUP_RETENTION_DAYS = app.MAX_BACKUP_RETENTION_DAYS;
export const BACKUP_DIR = app.BACKUP_DIR;
// `trust proxy` hop count (A-16)
export const TRUST_PROXY_HOPS = app.TRUST_PROXY_HOPS;
// audit_logs.action ENUM
export const AUDIT_ACTIONS = auditActions;
