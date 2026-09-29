/**
 * Sequelize option augmentation (P9-10, spec § Security; counterpart of express.d.ts).
 *
 * `skipTenantScope: true` is the one reviewed opt-out of the global tenant
 * hooks (utils/tenantScope.util.ts; CLAUDE.md § Tenant isolation). Sequelize's
 * own option types do not know it, so a converted file passing it would not
 * compile. Augmentation only ADDS the optional key: nothing gets stricter, and
 * nothing here types tenant isolation itself — that stays at run time, in the
 * hooks. Added by the first converted file that passes it (certificate.model).
 */
import "sequelize";

declare module "sequelize" {
  interface FindOptions {
    /** Opt out of the global tenant predicate for this query (reviewed, greppable). */
    skipTenantScope?: boolean;
  }
}
