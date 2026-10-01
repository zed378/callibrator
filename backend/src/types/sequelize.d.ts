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
  // P9-12 (ADR-087 Amendment 13): the hooks honour the opt-out on every
  // operation they scope (registerTenantScope in utils/tenantScope.util.ts),
  // so the options of each such operation accept it too.
  interface CountOptions {
    /** Opt out of the global tenant predicate for this operation (reviewed, greppable). */
    skipTenantScope?: boolean;
  }
  interface UpdateOptions {
    /** Opt out of the global tenant predicate for this operation (reviewed, greppable). */
    skipTenantScope?: boolean;
  }
  interface DestroyOptions {
    /** Opt out of the global tenant predicate for this operation (reviewed, greppable). */
    skipTenantScope?: boolean;
  }
  interface RestoreOptions {
    /** Opt out of the global tenant predicate for this operation (reviewed, greppable). */
    skipTenantScope?: boolean;
  }
  interface CreateOptions {
    /** Opt out of the global tenant predicate for this operation (reviewed, greppable). */
    skipTenantScope?: boolean;
  }
  interface BulkCreateOptions {
    /** Opt out of the global tenant predicate for this operation (reviewed, greppable). */
    skipTenantScope?: boolean;
  }
  interface UpsertOptions {
    /** Opt out of the global tenant predicate for this operation (reviewed, greppable). */
    skipTenantScope?: boolean;
  }
  interface SaveOptions {
    /** Opt out of the global tenant predicate for this operation (reviewed, greppable). */
    skipTenantScope?: boolean;
  }
  interface InstanceDestroyOptions {
    /** Opt out of the global tenant predicate for this operation (reviewed, greppable). */
    skipTenantScope?: boolean;
  }
  interface InstanceRestoreOptions {
    /** Opt out of the global tenant predicate for this operation (reviewed, greppable). */
    skipTenantScope?: boolean;
  }
  // P10-16 (ADR-099 Amendment 1): a password written with this option is
  // ONE-TIME — its first sign-in yields a password-change token, not a
  // session (models/user.model.ts beforeSave). Any other password write clears
  // the flag. The User model is the only reader.
  interface SaveOptions {
    /** The password this save writes signs in once (P10-16). */
    oneTimePassword?: boolean;
  }
  interface CreateOptions {
    /** The password this create writes signs in once (P10-16). */
    oneTimePassword?: boolean;
  }
  interface InstanceUpdateOptions {
    /** The password this update writes signs in once (P10-16). */
    oneTimePassword?: boolean;
  }
}
