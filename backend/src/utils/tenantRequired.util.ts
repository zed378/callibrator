/**
 * A-369 (ADR-075 Amendment 1) — only a platform account may have no tenant.
 *
 * The tenant hooks (utils/tenantScope.util#resolveScope) skip scoping for a super admin and
 * deny everything to any other principal without a tenant: such a principal's scope matches
 * NO_TENANT_UUID, so even its OWN user row is invisible to it. A non-super-admin account with
 * `tenant_id` NULL could sign in (the LOGIN row was skipped, "LOGIN not audited: the user has
 * no tenant") and then answered 401 "Invalid session" on every request, because
 * auth.service#verifyUserSession could not find the user. `POST /users/create` by a super
 * admin who named no tenant made exactly that account.
 *
 * The rule, in one place:
 *  - an account is created, or given a role, only with a tenant unless the role is the super
 *    admin's (`assertTenantForRole`, 400 `TENANT_REQUIRED`);
 *  - an existing tenant-less non-platform account is refused at sign-in, after the credential,
 *    before any token or session (`tenantlessSignInRefusal`, 403 `ACCOUNT_HAS_NO_TENANT`).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { CodedError } from "./codedError.util";
import { isSuperAdminRoleName } from "./role.util";
import { SUPER_ADMIN_ROLE_ID } from "../constants/roleConstants";

/** A role as far as this rule reads it. */
export interface RoleLike {
  id?: unknown;
  name?: string | null;
}

export const TENANT_REQUIRED_CODE = "TENANT_REQUIRED";
export const TENANT_REQUIRED_MESSAGE =
  "Choose the organisation this account belongs to. Only a super admin account can exist without one.";

export const ACCOUNT_HAS_NO_TENANT_CODE = "ACCOUNT_HAS_NO_TENANT";
export const ACCOUNT_HAS_NO_TENANT_MESSAGE =
  "This account is not assigned to an organisation, so it cannot sign in. Ask an administrator to assign it.";

/**
 * Whether a role is the platform's (the super admin's) — the only role the tenant hooks let
 * work without a tenant.
 *
 * @param role - the role, or nothing
 */
export const isPlatformRole = (role: RoleLike | null | undefined): boolean =>
  !!role && (String(role.id) === SUPER_ADMIN_ROLE_ID || isSuperAdminRoleName(role.name));

/**
 * Refuse a non-platform role for an account with no tenant.
 *
 * @param tenantId - the account's tenant (after the caller's own resolution)
 * @param role - the role it is given
 * @throws {CodedError} 400 `TENANT_REQUIRED`
 */
export const assertTenantForRole = (tenantId: string | null | undefined, role: RoleLike): void => {
  if (tenantId || isPlatformRole(role)) {
    return;
  }
  throw new CodedError(400, TENANT_REQUIRED_CODE, TENANT_REQUIRED_MESSAGE);
};

/**
 * The sign-in refusal for a tenant-less non-platform account, or null when it may sign in.
 *
 * @param user - the account, loaded with its role
 */
export const tenantlessSignInRefusal = (user: {
  tenantId?: string | null;
  role?: RoleLike | null;
}): CodedError | null =>
  user.tenantId || isPlatformRole(user.role)
    ? null
    : new CodedError(403, ACCOUNT_HAS_NO_TENANT_CODE, ACCOUNT_HAS_NO_TENANT_MESSAGE);
