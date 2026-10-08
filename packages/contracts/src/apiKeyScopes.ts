/**
 * API-key scopes (A-299) — what `POST /api-keys` accepts, as the create
 * dialog offers it.
 *
 * A scope is `"<resource>:<action>"`: the resource a seeded menu-group slug
 * (the name every `dynamicAccess` gate checks), the action `read` or `write`
 * (write implies read). No wildcard — `apiKey.service#assertScopes` refuses a
 * `*` resource or action (A-27), because a key that matches everything is an
 * administrator nobody named.
 *
 * This list is the ONE source of scope resources (A-311): the backend's
 * `apiKey.service#assertScopes` accepts exactly these, and the create dialog
 * offers exactly these. It was the values of `MENU_SLUGS` until A-311, which
 * left out five resources that `dynamicAccess` gates check (calibration,
 * certificate, maintenance, notifications, reports), so no key could ever
 * open those routes. Two backend guards hold it:
 * `tests/guards/apiKeyScopeCoverage.a311.guard.test.ts` fails when a gate
 * checks a resource not listed here, or a listed resource is not a seeded
 * menu slug; `tests/services/apiKey.scopeContract.a299.test.ts` sends every
 * scope built from this list through the real `createApiKey`.
 */

/** A scope's action. */
export const API_KEY_SCOPE_ACTIONS = ["read", "write"] as const;
export type ApiKeyScopeAction = (typeof API_KEY_SCOPE_ACTIONS)[number];

/** Every resource a scope may name: the seeded menu-group slugs. */
export const API_KEY_SCOPE_RESOURCES = [
  "home",
  "dashboard",
  "account",
  "management",
  "security",
  "profile-page",
  "warehouse",
  "equipment",
  "content",
  "risk",
  "supplier-scorecard",
  "predictive-maintenance",
  "feature-flags",
  "tenant-lifecycle",
  "data-retention",
  "oidc",
  "webauthn",
  "network-security",
  "scim",
  "qms",
  "sop",
  "workflows",
  "finance",
  "metered-billing",
  "gdpr",
  "custom-domains",
  "batch-jobs",
  "tenant-hierarchy",
  "kanban",
  "tickets-raise",
  "tickets-response",
  "esignature",
  "ai-assistant",
  "users",
  "vendors",
  "billing",
  "audit",
  "stock",
  "storage",
  "tenants",
  "api-keys",
  "webhooks",
  "attachments",
  "access-requests",
  // P24-06: the SQL-dump import's menu (its routes are super admin only: a key holding it reaches nothing).
  "upstream-sql-import",
  // P20-06 (spec P18-01-02 § 3.4, P18-03 § 12): read is assignable; IPM submit / correct / void
  // carry denyApiKey, as every client-facility write does.
  "ipm",
  "ipm-templates",
  "client-facilities",
  // A-311: gated by dynamicAccess, absent from MENU_SLUGS (`calibration` joined MENU_SLUGS in P20-06).
  "calibration",
  "certificate",
  "maintenance",
  "notifications",
  "reports",
] as const;
export type ApiKeyScopeResource = (typeof API_KEY_SCOPE_RESOURCES)[number];

/**
 * The scope string for a resource and an action.
 *
 * @param resource - a menu slug from API_KEY_SCOPE_RESOURCES
 * @param action - read or write
 * @returns `"<resource>:<action>"`
 */
export const apiKeyScope = (resource: ApiKeyScopeResource, action: ApiKeyScopeAction): string =>
  `${resource}:${action}`;
