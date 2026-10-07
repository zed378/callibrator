/**
 * A-07 / P9-19 — every menu slug the real seed creates
 * (`utils/seedMenuGroups.util.js`, `menuData`), as a literal type.
 *
 * `dynamicAccess(menu, action)` is decided against these slugs, verbatim and
 * case-sensitively: a role's permission matrix is keyed by them, and an API
 * key's scopes are slugs. A gate naming anything else is in nobody's matrix,
 * so it refuses every user while a key whose lower-cased scope happens to
 * match passes (the A-07 defect). Typing `dynamicAccess`'s resource as
 * `SeededMenuSlug` makes such a gate a COMPILE error in a TypeScript route.
 *
 * This is NOT `MENU_SLUGS` (constants/roleConstants): that is a known subset
 * of the seed (A-04 addendum, A-311) — `calibration`, `certificate`,
 * `maintenance`, `notifications` and `reports` gate routes and are not in it.
 *
 * `tests/constants/seededMenuSlugs.p919.test.ts` holds this list equal to the
 * slugs the seed source creates (read by `authorizationWiring#seededMenuSlugs`,
 * the A-58 boot check's own reader), and `MENU_SLUGS` inside it: a slug added
 * to the seed without being added here, or the reverse, fails the build.
 */
export const SEEDED_MENU_SLUGS = [
  "access-requests",
  "account",
  "ai-assistant",
  "api-keys",
  "attachments",
  "audit",
  "batch-jobs",
  "billing",
  "calibration",
  "calibration-scheduler",
  "certificate",
  "change-password",
  "content",
  "custom-domains",
  "dashboard",
  "data-retention",
  "equipment",
  "esignature",
  "feature-flags",
  "finance",
  "gdpr",
  "home",
  "kanban",
  "maintenance",
  "management",
  "menu-groups",
  "metered-billing",
  "mgmt-content",
  "mgmt-developer",
  "mgmt-finance",
  "mgmt-organization",
  "mgmt-partners",
  "mgmt-quality",
  "mgmt-work",
  "network-security",
  "notifications",
  "oidc",
  "permissions",
  "predictive-maintenance",
  "profile-page",
  "qms",
  "reports",
  "risk",
  "roles",
  "scim",
  "security",
  "sessions",
  "sop",
  "stock",
  "storage",
  "supplier-scorecard",
  "tenant-hierarchy",
  "tenant-lifecycle",
  "tenants",
  "tickets-raise",
  "tickets-response",
  "upstream-import",
  "upstream-sql-import",
  "user-permissions",
  "users",
  "vendors",
  "warehouse",
  "webauthn",
  "webhooks",
  "workflows",
] as const;

/** A menu slug the seed creates — what a `dynamicAccess` gate may name. */
export type SeededMenuSlug = (typeof SEEDED_MENU_SLUGS)[number];
