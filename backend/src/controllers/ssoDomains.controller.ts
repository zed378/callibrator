/**
 * P10-04 (ADR-098 §7.2) — the super admin's SSO email-domain claim of a
 * tenant (admin router: `auth` + `rbac(SUPER_ADMIN)`). Read by the public
 * identifier-first discovery (services/loginDiscovery.service.ts).
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { ssoEmailDomainsSchema } from "../validators/publicAuth.validator";
import { uuid } from "../validators/fields";
import { getSsoEmailDomains, setSsoEmailDomains } from "../services/loginDiscovery.service";
import { actorIdOf, requestOriginOf } from "../utils/requestOrigin.util";

/** GET /admin/tenants/:id/sso-domains — `:id` validated as a UUID. */
export const tenantIdParamsSchema = z.object({ id: uuid() });

export const getDomains = asyncHandler(async (req: Request, res: Response) => {
  const { id } = validated(req, tenantIdParamsSchema);
  success(res, { domains: await getSsoEmailDomains(id) }, "SSO email domains retrieved", 200);
});

/** PUT /admin/tenants/:id/sso-domains — replaces the list; audited. */
export const putDomains = asyncHandler(async (req: Request, res: Response) => {
  const { id, domains } = validated(req, ssoEmailDomainsSchema);
  const { ip, userAgent } = requestOriginOf(req);
  const saved = await setSsoEmailDomains(id, domains, { userId: actorIdOf(req), ipAddress: ip, userAgent });
  success(res, { domains: saved }, "SSO email domains saved", 200);
});
