/**
 * A-369 (ADR-075 Am. 1) — the two coded refusals of a tenant-less non-super-admin account, as the
 * OpenAPI document states them (utils/tenantRequired.util is the one source of the codes and texts):
 *
 *  - 400 `TENANT_REQUIRED`: creating a user, or changing a user's role, to a non-platform role with
 *    no tenant (user.service#userCreate / #userRoleUpdate);
 *  - 403 `ACCOUNT_HAS_NO_TENANT`: a sign-in (password or passkey) of such an account, refused after
 *    the credential and before any token, session or one-time password (auth.service#assertMaySignIn).
 *
 * The body is the error envelope with the TOP-LEVEL `code` a CodedError adds; the other refusals of
 * the same status carry no `code`, so it is optional. Named exports only.
 */
import { z } from "zod";
import { ErrorEnvelope } from "./envelope";
import type { ErrorBody } from "./operation";
import { ACCOUNT_HAS_NO_TENANT_CODE, ACCOUNT_HAS_NO_TENANT_MESSAGE, TENANT_REQUIRED_CODE, TENANT_REQUIRED_MESSAGE } from "../../utils/tenantRequired.util";

const coded = (code: string, when: string) =>
  ErrorEnvelope.extend({
    code: z.enum([code]).optional().meta({ description: `\`${code}\` when ${when}; absent on the status's other refusals` }),
  });

/** The 400 of a user create or role change: a validation failure, or `TENANT_REQUIRED`. */
export const tenantRequired400: ErrorBody = {
  description:
    "The request failed validation, or (top-level `code` `TENANT_REQUIRED`, A-369) the account would have a non-platform role " +
    "and no tenant — only a super admin account exists without one.",
  body: coded(TENANT_REQUIRED_CODE, "the account would have a non-platform role and no tenant"),
  example: { success: false, status: 400, message: TENANT_REQUIRED_MESSAGE, data: null, code: TENANT_REQUIRED_CODE },
};

/** The 403 of a sign-in: the tenant's policy or a suspension, or `ACCOUNT_HAS_NO_TENANT`. */
export const accountHasNoTenant403: ErrorBody = {
  description:
    "Refused by the tenant's sign-in policy or a suspension, or (top-level `code` `ACCOUNT_HAS_NO_TENANT`, A-369) the account " +
    "belongs to no tenant: refused after the credential, before any token, session or one-time password.",
  body: coded(ACCOUNT_HAS_NO_TENANT_CODE, "the account belongs to no tenant"),
  example: { success: false, status: 403, message: ACCOUNT_HAS_NO_TENANT_MESSAGE, data: null, code: ACCOUNT_HAS_NO_TENANT_CODE },
};
