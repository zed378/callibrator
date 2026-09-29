/**
 * Branded identifiers (P9-05, docs/ENGINEERING/04 § Branded identifiers).
 *
 * `tenantId` and `userId` are both UUID strings and appear together in
 * hundreds of calls; swapping them compiles as plain strings. A brand makes
 * the swap a compile error. Brands are types only: at run time a `TenantId`
 * is the same string it always was.
 *
 * Seeded with the ONE brand a converted module uses (the tenant context store,
 * middlewares/tenantContext.middleware.ts). The validating constructor
 * (`toTenantId`) and the other brands (`UserId`, `DeviceId`, …) are added by
 * the first converted module that turns a raw string into one — no speculative
 * types (src/types/README.md). A brand assertion (`value as TenantId`) is
 * allowed ONLY in that constructor, in this file.
 */
declare const brand: unique symbol;

/** A nominal type: `T` that only its constructor can produce. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** A tenant's id (`tenants.id`, a UUID). */
export type TenantId = Brand<string, "TenantId">;

/**
 * A user's id (`users.id`, a UUID). Added by P9-10's first model batch
 * (ADR-087 Amendment 7): the Kanban models declare their user keys with it.
 */
export type UserId = Brand<string, "UserId">;
