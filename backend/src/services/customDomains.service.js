/**
 * Custom Domains Service
 *
 * Manages per-tenant custom domains (vanity subdomains, CNAME records, TLS
 * certificates). Backed by the CustomDomain model. Domain-management operations
 * are keyed by the domain record id (matching the controller contract); tenant
 * resolution is by hostname.
 *
 * Usage:
 *   const svc = require('./services/customDomains.service');
 *   await svc.addDomain(tenantId, { domain: 'app.example.com', type: 'subdomain' });
 *   const tenant = await svc.resolveTenantByDomain('app.example.com');
 */

const crypto = require("crypto");
const dns = require("dns").promises;
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { db } = require("../config");
const storagePath = require("../utils/storagePath.util");
const auditService = require("./audit.service");
const { ROLE_NAMES } = require("../constants/roleConstants");

// ==========================================
// CONFIGURATION
// ==========================================

const CUSTOM_DOMAINS_ENABLED = () =>
  process.env.CUSTOM_DOMAINS_ENABLED === "true";
const DEFAULT_SUBDOMAIN = () => process.env.DEFAULT_SUBDOMAIN || "app";
const DNS_CHECK_INTERVAL = () => parseInt(process.env.DNS_CHECK_INTERVAL) || 300;
const TLS_AUTO_PROVISION = () => process.env.TLS_AUTO_PROVISION === "true";

const DOMAIN_STATUS = {
  PENDING_VERIFICATION: "pending_verification",
  ACTIVE: "active",
  VERIFICATION_FAILED: "verification_failed",
  DELETING: "deleting",
  DELETED: "deleted",
};

const DOMAIN_TYPE = {
  CUSTOM: "custom",
  SUBDOMAIN: "subdomain",
  VANITY: "vanity",
};

// ==========================================
// HELPERS
// ==========================================

/** Validate domain format. */
function isValidDomain(domain) {
  const domainRegex =
    /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[A-Za-z]{2,}$/;
  return domainRegex.test(domain);
}

function generateVerificationToken() {
  return `callibrator-verify=${crypto.randomBytes(16).toString("hex")}`;
}

/**
 * Check the DNS TXT record for domain ownership: resolve
 * `_domain_verify.<domain>` and confirm the expected token is present. A missing
 * record / lookup error resolves to `false` (unverified), never throws.
 */
async function checkDnsTxtRecord(domain, expectedToken) {
  try {
    const records = await dns.resolveTxt(`_domain_verify.${domain}`);
    // resolveTxt returns string[][] (each record may be split into chunks).
    const values = records.map((chunks) => chunks.join(""));
    return values.includes(expectedToken);
  } catch (err) {
    logger.debug("DNS TXT lookup failed", { domain, error: err.message });
    return false;
  }
}

/** DNS records the tenant must add to verify + route their domain. */
function getDnsVerificationInstructions(domain, token) {
  return {
    verification: {
      type: "TXT",
      name: `_domain_verify.${domain}`,
      value: token || "callibrator-verify=[TOKEN]",
    },
    cname: {
      type: "CNAME",
      name: domain,
      value: "cname.callibrator.io.",
    },
    instructions: [
      "1. Add the TXT record to verify domain ownership",
      "2. Add the CNAME record to point traffic to Callibrator",
      "3. Click 'Verify' after DNS propagates (up to 48 hours)",
      TLS_AUTO_PROVISION()
        ? "4. TLS certificate will be auto-provisioned via Let's Encrypt"
        : "4. Contact support to enable TLS for your domain",
    ],
  };
}

/** Load a tenant-owned domain record by id (404 if absent). */
async function loadOwned(tenantId, domainId) {
  const { CustomDomain } = require("../models");
  const record = await CustomDomain.findOne({
    where: { id: domainId, tenantId },
  });
  if (!record) {
    throw new AppError(404, "Domain not found");
  }
  return record;
}

/**
 * The page a tenant verifies its domains on: the Custom Domains page of the
 * public web front end — FRONTEND_URL, else HOST_URL, as the e-signature
 * emails build theirs (A-158).
 *
 * @returns {string|null} absolute URL, or null when no origin is configured
 */
function customDomainsPageUrl() {
  const origin = (process.env.FRONTEND_URL || process.env.HOST_URL || "").replace(/\/+$/, "");
  return origin ? `${origin}/dashboard/custom-domains` : null;
}

/**
 * The roles whose holders administer a tenant — who hears about a domain added
 * to it (A-186).
 */
const DOMAIN_ADMIN_ROLES = [ROLE_NAMES.HEALTCARE_ADMIN, ROLE_NAMES.CALIBRATOR_ADMIN];

/**
 * Who is told that a domain was added (A-186): the user who added it, and
 * every active administrator of the tenant, each once.
 *
 * Until 2026-09-24 this was `User.findOne({ where: { tenantId }, order:
 * createdAt ASC })` — the tenant's OLDEST user, whoever that was: often the
 * seeded first account, possibly a technician, possibly someone long gone. A
 * domain pointed at a tenant is a security event (it is where that tenant's
 * users will sign in), so it goes to the people who administer the tenant, and
 * the DNS records go to the person who has to add them.
 *
 * @param {string} tenantId
 * @param {string} requesterId - the acting user (auditActor(req).userId)
 * @returns {Promise<Array<{email: string, firstName: (string|null)}>>}
 */
async function domainNotificationRecipients(tenantId, requesterId) {
  const { User, Role } = require("../models");
  const attributes = ["id", "email", "firstName"];
  const [requester, admins] = await Promise.all([
    User.findOne({ where: { id: requesterId, tenantId }, attributes }),
    User.findAll({
      where: { tenantId, isActive: true },
      attributes,
      // required: true on purpose — the role IS the filter.
      include: [{ model: Role, as: "role", attributes: [], where: { name: DOMAIN_ADMIN_ROLES }, required: true }],
    }),
  ]);
  const byAddress = new Map();
  for (const user of [requester, ...admins]) {
    if (user && user.email && !byAddress.has(user.email.toLowerCase())) {
      byAddress.set(user.email.toLowerCase(), user);
    }
  }
  return [...byAddress.values()];
}

/**
 * Tell the requester and the tenant's administrators that a domain needs
 * verification (best-effort).
 *
 * A-166 — this called `emailQueueService.queueEmail`, which emailQueue.service
 * has never exported: every call threw a TypeError that the catch logged at
 * warn, so no verification email was ever sent. It now sends through the real
 * `queueNotificationEmail` (the path notifications and e-signature use), with
 * the DNS records to add in the body. The link it carried,
 * `https://<domain>/verify`, pointed at the very domain that was not yet
 * routed here; it is now the Custom Domains page, where "Verify" runs the
 * check.
 *
 * A-186 — recipients: see domainNotificationRecipients.
 *
 * Never throws — the domain has already been added — but every failure is
 * logged at ERROR, with ids only and no email address.
 *
 * @param {string} tenantId
 * @param {string} domain
 * @param {string} token - the TXT value the tenant must publish
 * @param {string} requesterId - the user who added the domain
 * @returns {Promise<boolean>} whether the email was accepted for at least one recipient
 */
async function sendDomainVerificationEmail(tenantId, domain, token, requesterId) {
  const context = { tenantId, domain };
  try {
    const recipients = await domainNotificationRecipients(tenantId, requesterId);

    if (recipients.length === 0) {
      logger.error("Domain verification email was not sent: neither the requester nor any tenant administrator has an email address", context);
      return false;
    }

    const actionUrl = customDomainsPageUrl();
    if (!actionUrl) {
      logger.error("Domain verification email has no link: neither FRONTEND_URL nor HOST_URL is set", context);
    }

    const records = getDnsVerificationInstructions(domain, token);
    const message = [
      `The domain ${domain} was added to your organisation and is waiting for verification.`,
      `1. Add a TXT record named ${records.verification.name} with the value ${records.verification.value}`,
      `2. Add a CNAME record for ${records.cname.name} pointing to ${records.cname.value}`,
      '3. Once DNS has propagated (up to 48 hours), open Custom Domains and choose "Verify".',
    ].join("\n\n");
    const { queueNotificationEmail } = require("./emailQueue.service");
    let accepted = 0;
    for (const recipient of recipients) {
      const ok = await queueNotificationEmail({
        email: recipient.email,
        firstName: recipient.firstName || "",
        title: `Verify domain: ${domain}`,
        message,
        actionUrl,
      });
      accepted += ok ? 1 : 0;
    }
    if (accepted === 0) {
      throw new Error("the email queue did not accept the message");
    }
    if (accepted < recipients.length) {
      logger.error("Domain verification email reached only some recipients", {
        ...context,
        accepted,
        recipients: recipients.length,
      });
    }
    logger.info("Domain verification email queued", { ...context, recipients: accepted });
    return true;
  } catch (err) {
    logger.error("Domain verification email was not sent", { ...context, error: err.message });
    return false;
  }
}

/**
 * A-186 — a change to a tenant's domains, recorded in the tenant's audit trail
 * inside the change's transaction. A failed insert is re-thrown by logAction
 * and rolls the change back.
 *
 * @param {object} transaction
 * @param {string} tenantId
 * @param {object} actor - auditActor(req)
 * @param {{action: string, resourceId: string, changes: object}} row
 */
const auditDomainChange = (transaction, tenantId, actor, { action, resourceId, changes }) =>
  auditService.logAction(
    {
      tenantId,
      userId: actor.userId,
      action,
      resourceType: "CustomDomain",
      resourceId,
      changes,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    },
    { transaction },
  );

// ==========================================
// DOMAIN MANAGEMENT
// ==========================================

/**
 * List a tenant's (non-deleted) domains.
 */
exports.getTenantDomains = async (tenantId) => {
  try {
    const { CustomDomain } = require("../models");
    return await CustomDomain.findAll({
      where: { tenantId, status: { [db.Sequelize.Op.ne]: DOMAIN_STATUS.DELETED } },
      order: [["createdAt", "DESC"]],
    });
  } catch (err) {
    logger.error("Failed to get tenant domains", {
      tenantId,
      error: err.message,
    });
    return [];
  }
};

/**
 * Add a custom domain. Accepts either a string domain or an
 * { domain, type, sslEnabled } object (the controller passes the object form).
 */
exports.addDomain = async (tenantId, domainInput, typeArg = "subdomain", actor = {}) => {
  if (!CUSTOM_DOMAINS_ENABLED()) {
    throw new AppError(400, "Custom domains are disabled");
  }

  let domain;
  let type = typeArg;
  let sslEnabled = true;
  if (domainInput && typeof domainInput === "object") {
    domain = domainInput.domain;
    type = domainInput.type || "subdomain";
    sslEnabled = domainInput.sslEnabled !== false;
  } else {
    domain = domainInput;
  }

  if (!tenantId || !domain) {
    throw new AppError(400, "tenantId and domain are required");
  }
  if (!isValidDomain(domain)) {
    throw new AppError(400, "Invalid domain format");
  }

  const existing = await exports.getDomainByDomain(domain);
  if (existing) {
    throw new AppError(409, "Domain already assigned to another tenant");
  }

  try {
    const { CustomDomain } = require("../models");
    const verificationToken = generateVerificationToken();
    // A-186: the row and its audit row commit together.
    const record = await db.transaction(async (transaction) => {
      const created = await CustomDomain.create(
        {
          tenantId,
          domain,
          domainType: type,
          sslEnabled,
          status: DOMAIN_STATUS.PENDING_VERIFICATION,
          verificationToken,
        },
        { transaction },
      );
      await auditDomainChange(transaction, tenantId, actor, {
        action: "CREATE",
        resourceId: created.id,
        changes: {
          operation: "ADD_DOMAIN",
          before: {},
          after: { domain, domainType: type, sslEnabled, status: DOMAIN_STATUS.PENDING_VERIFICATION },
        },
      });
      return created;
    });

    // After the commit: never announce a domain that was rolled back.
    // The audit row above refused an add with no acting user (A-124), so the
    // requester is always named here.
    await sendDomainVerificationEmail(tenantId, domain, verificationToken, actor.userId);
    logger.info("Custom domain added", { tenantId, domain, type });

    return {
      id: record.id,
      domain: record.domain,
      status: record.status,
      sslEnabled: record.sslEnabled,
      verification: getDnsVerificationInstructions(domain, verificationToken),
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    logger.error("Failed to add domain", {
      tenantId,
      domain,
      error: err.message,
    });
    throw new AppError(500, "Failed to add domain");
  }
};

/**
 * Verify a domain (by record id) via its DNS TXT record.
 *
 * A-186: the outcome and its audit row commit together. A domain becoming
 * ACTIVE is the moment it starts resolving to this tenant, so every check is
 * attributable. A database failure is no longer reported as "not verified":
 * it propagates (500) and nothing is written.
 *
 * @param {string} tenantId
 * @param {string} domainId
 * @param {object} actor - auditActor(req)
 */
exports.verifyDomain = async (tenantId, domainId, actor = {}) => {
  if (!CUSTOM_DOMAINS_ENABLED()) {
    return { verified: false, reason: "Custom domains disabled" };
  }

  const record = await loadOwned(tenantId, domainId);
  const token = record.verificationToken || generateVerificationToken();

  // Real DNS ownership check; both outcomes are reachable. Never throws.
  const verified = await checkDnsTxtRecord(record.domain, token);
  const before = { status: record.status };

  await db.transaction(async (transaction) => {
    await record.update(
      {
        status: verified ? DOMAIN_STATUS.ACTIVE : DOMAIN_STATUS.VERIFICATION_FAILED,
        verifiedAt: verified ? new Date() : null,
        lastCheckedAt: new Date(),
        // A record with no token had a fresh one generated above; keep it, or
        // the TXT value the tenant is told to publish could never match.
        verificationToken: token,
      },
      { transaction },
    );
    await auditDomainChange(transaction, tenantId, actor, {
      action: "UPDATE",
      resourceId: record.id,
      changes: {
        operation: "VERIFY_DOMAIN",
        domain: record.domain,
        before,
        after: { status: record.status, verified },
      },
    });
  });

  return {
    verified,
    status: record.status,
    record: verified ? token : null,
    dnsRecord: {
      type: "CNAME",
      name: `_domain_verify.${record.domain}`,
      value: token,
    },
  };
};

/**
 * Remove a domain (by record id) — soft delete (status = deleted).
 */
exports.removeDomain = async (tenantId, domainId, actor = {}) => {
  if (!tenantId || !domainId) {
    throw new AppError(400, "tenantId and domainId are required");
  }

  const record = await loadOwned(tenantId, domainId);

  const before = { status: record.status, isDefault: record.isDefault };
  try {
    // A-186: the removal and its audit row commit together.
    await db.transaction(async (transaction) => {
      await record.update({ status: DOMAIN_STATUS.DELETED, isDefault: false }, { transaction });
      await auditDomainChange(transaction, tenantId, actor, {
        action: "DELETE",
        resourceId: record.id,
        changes: {
          operation: "REMOVE_DOMAIN",
          domain: record.domain,
          before,
          after: { status: DOMAIN_STATUS.DELETED, isDefault: false },
        },
      });
    });
    logger.info("Custom domain removed", { tenantId, domainId });
    return { success: true, id: record.id };
  } catch (err) {
    logger.error("Failed to remove domain", {
      tenantId,
      domainId,
      error: err.message,
    });
    throw new AppError(500, "Failed to remove domain");
  }
};

/**
 * Get the status of a domain (by record id).
 */
exports.getDomainStatus = async (tenantId, domainId) => {
  const record = await loadOwned(tenantId, domainId);
  return {
    id: record.id,
    domain: record.domain,
    status: record.status,
    sslEnabled: record.sslEnabled,
    isDefault: record.isDefault,
    verifiedAt: record.verifiedAt,
    lastCheckedAt: record.lastCheckedAt,
  };
};

/**
 * Set a domain (by record id) as the tenant's default, clearing the flag on the
 * tenant's other domains.
 */
exports.setDefaultDomain = async (tenantId, domainId, actor = {}) => {
  const record = await loadOwned(tenantId, domainId);
  if (record.status === DOMAIN_STATUS.DELETED) {
    throw new AppError(400, "A deleted domain cannot be set as default");
  }

  const { CustomDomain } = require("../models");
  // A-186: clearing the old default, setting the new one and the audit row
  // commit together — before, a failure between the two updates left the
  // tenant with no default domain.
  const before = { isDefault: Boolean(record.isDefault) };
  await db.transaction(async (transaction) => {
    await CustomDomain.update({ isDefault: false }, { where: { tenantId }, transaction });
    await record.update({ isDefault: true }, { transaction });
    await auditDomainChange(transaction, tenantId, actor, {
      action: "UPDATE",
      resourceId: record.id,
      changes: {
        operation: "SET_DEFAULT_DOMAIN",
        domain: record.domain,
        before,
        after: { isDefault: true },
      },
    });
  });

  logger.info("Default domain set", { tenantId, domainId });
  return { id: record.id, domain: record.domain, isDefault: true };
};

/**
 * Get the DNS records a tenant must configure for a domain (by record id).
 */
exports.getDnsRecords = async (tenantId, domainId) => {
  const record = await loadOwned(tenantId, domainId);
  return getDnsVerificationInstructions(record.domain, record.verificationToken);
};

/**
 * Find an active domain by its domain name (used for dedupe + resolution).
 */
exports.getDomainByDomain = async (domain) => {
  try {
    const { CustomDomain } = require("../models");
    return await CustomDomain.findOne({
      where: {
        domain,
        status: { [db.Sequelize.Op.ne]: DOMAIN_STATUS.DELETED },
      },
    });
  } catch (err) {
    logger.error("Failed to get domain", { domain, error: err.message });
    return null;
  }
};

// ==========================================
// TENANT RESOLUTION
// ==========================================

/**
 * Resolve a tenant by request hostname. Runs pre-auth (no tenant context) so it
 * matches across all tenants.
 */
exports.resolveTenantByDomain = async (hostname) => {
  if (!CUSTOM_DOMAINS_ENABLED()) {
    return null;
  }

  try {
    const { CustomDomain } = require("../models");
    const domainRecord = await CustomDomain.findOne({
      where: { domain: hostname, status: DOMAIN_STATUS.ACTIVE },
    });

    if (domainRecord) {
      logger.debug("Tenant resolved by custom domain", {
        hostname,
        tenantId: domainRecord.tenantId,
      });
      return {
        tenantId: domainRecord.tenantId,
        domain: domainRecord.domain,
      };
    }
  } catch (err) {
    logger.error("Domain resolution failed", {
      hostname,
      error: err.message,
    });
  }

  return null;
};

// ==========================================
// TLS CERTIFICATE MANAGEMENT
// ==========================================

/**
 * Provision a TLS certificate for a domain via ACME (Let's Encrypt) using the
 * HTTP-01 challenge. The challenge token is written under the served
 * `.well-known/acme-challenge/` directory; the domain must already resolve to
 * this server for issuance to succeed. The issued private key is encrypted at
 * rest with the tenant KMS envelope (never returned or logged in plaintext).
 *
 * Defaults to the Let's Encrypt STAGING directory; set ACME_DIRECTORY_URL to the
 * production directory for real certificates. Guarded by TLS_AUTO_PROVISION.
 *
 * @param {string} domain
 * @param {string} [tenantId] used to encrypt the private key via kms.service
 */
exports.provisionTLSCertificate = async (domain, tenantId) => {
  if (!TLS_AUTO_PROVISION()) {
    return { success: false, reason: "TLS auto-provisioning disabled" };
  }

  try {
    const acme = require("acme-client");
    const fs = require("fs");
    const path = require("path");

    const directoryUrl =
      process.env.ACME_DIRECTORY_URL || acme.directory.letsencrypt.staging;
    const challengeDir =
      process.env.ACME_CHALLENGE_DIR ||
      storagePath(".well-known", "acme-challenge");

    const accountKey = await acme.crypto.createPrivateKey();
    const client = new acme.Client({ directoryUrl, accountKey });

    const [certKey, csr] = await acme.crypto.createCsr({ commonName: domain });

    const certificate = await client.auto({
      csr,
      email: process.env.ACME_ACCOUNT_EMAIL || `admin@${domain}`,
      termsOfServiceAgreed: true,
      challengePriority: ["http-01"],
      challengeCreateFn: async (authz, challenge, keyAuthorization) => {
        if (challenge.type !== "http-01") {
          return;
        }
        await fs.promises.mkdir(challengeDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(challengeDir, challenge.token),
          keyAuthorization,
        );
      },
      challengeRemoveFn: async (authz, challenge) => {
        if (challenge.type !== "http-01") {
          return;
        }
        await fs.promises
          .unlink(path.join(challengeDir, challenge.token))
          .catch(() => {});
      },
    });

    // Encrypt the certificate private key at rest with the tenant KMS envelope.
    const encryptedPrivateKey = tenantId
      ? require("./kms.service").encryptData(tenantId, certKey.toString())
      : null;

    logger.info("TLS certificate provisioned via ACME", { domain });
    return {
      success: true,
      certificate: {
        domain,
        certificate: certificate.toString(),
        encryptedPrivateKey,
        issuedAt: new Date().toISOString(),
        issuer: "Let's Encrypt",
      },
    };
  } catch (err) {
    logger.error("TLS provisioning failed", { domain, error: err.message });
    return { success: false, reason: err.message };
  }
};

// ==========================================
// UTILITIES
// ==========================================

exports.getStatus = () => ({
  enabled: CUSTOM_DOMAINS_ENABLED(),
  defaultSubdomain: DEFAULT_SUBDOMAIN(),
  dnsCheckInterval: DNS_CHECK_INTERVAL(),
  tlsAutoProvision: TLS_AUTO_PROVISION(),
});

exports.DOMAIN_STATUS = DOMAIN_STATUS;
exports.DOMAIN_TYPE = DOMAIN_TYPE;
