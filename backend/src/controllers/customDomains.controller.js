/**
 * Custom Domains Controller
 *
 * Handles custom domain and vanity subdomain endpoints.
 */

// The service exports its functions at the top level, so import the module
// object — NOT `{ customDomainsService }` (which was undefined and made every
// endpoint throw at runtime).
const customDomainsService = require("../services/customDomains.service");
const { success, error } = require("../utils/response.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { logger } = require("../middlewares/activityLog.middleware");

/**
 * Get all custom domains for current tenant
 */
exports.getCustomDomains = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const domains = await customDomainsService.getTenantDomains(tenantId);

  return success(res, domains, "Custom domains retrieved");
});

/**
 * Add a custom domain
 */
exports.addCustomDomain = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { domain, type, sslEnabled } = req.body;

  const result = await customDomainsService.addDomain(tenantId, {
    domain,
    type: type || "subdomain",
    sslEnabled: sslEnabled !== false,
  });

  return success(res, result, null, "Custom domain added", 201);
});

/**
 * Verify domain DNS records
 */
exports.verifyDomain = asyncHandler(async (req, res) => {
  const { domainId } = req.params;
  const { tenantId } = req.user;

  const result = await customDomainsService.verifyDomain(tenantId, domainId);

  return success(res, result, "Domain verification initiated");
});

/**
 * Remove a custom domain
 */
exports.removeCustomDomain = asyncHandler(async (req, res) => {
  const { domainId } = req.params;
  const { tenantId } = req.user;

  await customDomainsService.removeDomain(tenantId, domainId);

  return success(res, null, "Custom domain removed");
});

/**
 * Get domain status
 */
exports.getDomainStatus = asyncHandler(async (req, res) => {
  const { domainId } = req.params;
  const { tenantId } = req.user;

  const status = await customDomainsService.getDomainStatus(tenantId, domainId);

  return success(res, status, "Domain status retrieved");
});

/**
 * Set default domain
 */
exports.setDefaultDomain = asyncHandler(async (req, res) => {
  const { domainId } = req.params;
  const { tenantId } = req.user;

  const result = await customDomainsService.setDefaultDomain(
    tenantId,
    domainId,
  );

  return success(res, result, "Default domain set");
});

/**
 * Generate DNS records for domain
 */
exports.getDnsRecords = asyncHandler(async (req, res) => {
  const { domainId } = req.params;
  const { tenantId } = req.user;

  const records = await customDomainsService.getDnsRecords(tenantId, domainId);

  return success(res, records, "DNS records generated");
});
