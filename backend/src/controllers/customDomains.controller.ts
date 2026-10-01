/**
 * Custom Domains Controller
 *
 * Handles custom domain and vanity subdomain endpoints.
 *
 * P9-20 (ADR-087): converted from customDomains.controller.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order). The service is the module object; `success`,
 * `asyncHandler` and `auditActor` are captured at load, as the `.js`
 * destructured them. The `.js` also destructured `error` and `logger` and never
 * used them; those unused names are gone.
 */
import type { Request, Response } from "express";

// The service exports its functions at the top level, so import the module
// object — NOT `{ customDomainsService }` (which was undefined and made every
// endpoint throw at runtime).
import customDomainsService from "../services/customDomains.service";
import { success as loadedSuccess } from "../utils/response.util";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import type { TenantId } from "../types/ids";

const success = loadedSuccess;
const asyncHandler = loadedAsyncHandler;
const auditActor = loadedAuditActor;

/**
 * The principal `auth` put on the request. Read by destructuring, as the `.js`
 * did, so a request without one fails with the same TypeError.
 */
interface Caller {
  tenantId: TenantId;
}

/** The path parameter `validateUuid("domainId")` checked. */
interface DomainParams {
  domainId: string;
}

/** The body `validate(addDomain)` leaves on the request. */
interface AddDomainBody {
  domain?: string;
  type?: "custom" | "subdomain" | "vanity" | null;
  sslEnabled?: unknown;
}

/**
 * Get all custom domains for current tenant
 */
const getCustomDomains = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Caller;

  const domains = await customDomainsService.getTenantDomains(tenantId);

  return success(res, domains, "Custom domains retrieved");
});

/**
 * Add a custom domain
 */
const addCustomDomain = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Caller;
  const { domain, type, sslEnabled } = req.body as AddDomainBody;

  // A-186: the actor is audited with the domain and told how to verify it.
  const result = await customDomainsService.addDomain(
    tenantId,
    {
      domain,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty type means "subdomain"
      type: type || "subdomain",
      sslEnabled: sslEnabled !== false,
    },
    undefined,
    auditActor(req),
  );

  return success(res, result, null, "Custom domain added", 201);
});

/**
 * Verify domain DNS records
 */
const verifyDomain = asyncHandler(async (req: Request, res: Response) => {
  const { domainId } = req.params as unknown as DomainParams;
  const { tenantId } = req.user as Caller;

  const result = await customDomainsService.verifyDomain(tenantId, domainId, auditActor(req));

  return success(res, result, "Domain verification initiated");
});

/**
 * Remove a custom domain
 */
const removeCustomDomain = asyncHandler(async (req: Request, res: Response) => {
  const { domainId } = req.params as unknown as DomainParams;
  const { tenantId } = req.user as Caller;

  await customDomainsService.removeDomain(tenantId, domainId, auditActor(req));

  return success(res, null, "Custom domain removed");
});

/**
 * Get domain status
 */
const getDomainStatus = asyncHandler(async (req: Request, res: Response) => {
  const { domainId } = req.params as unknown as DomainParams;
  const { tenantId } = req.user as Caller;

  const status = await customDomainsService.getDomainStatus(tenantId, domainId);

  return success(res, status, "Domain status retrieved");
});

/**
 * Set default domain
 */
const setDefaultDomain = asyncHandler(async (req: Request, res: Response) => {
  const { domainId } = req.params as unknown as DomainParams;
  const { tenantId } = req.user as Caller;

  const result = await customDomainsService.setDefaultDomain(
    tenantId,
    domainId,
    auditActor(req),
  );

  return success(res, result, "Default domain set");
});

/**
 * Generate DNS records for domain
 */
const getDnsRecords = asyncHandler(async (req: Request, res: Response) => {
  const { domainId } = req.params as unknown as DomainParams;
  const { tenantId } = req.user as Caller;

  const records = await customDomainsService.getDnsRecords(tenantId, domainId);

  return success(res, records, "DNS records generated");
});

const controller = {
  getCustomDomains,
  addCustomDomain,
  verifyDomain,
  removeCustomDomain,
  getDomainStatus,
  setDefaultDomain,
  getDnsRecords,
};

export = controller;
