/**
 * Custom Domains Service
 *
 * Manages per-tenant custom domains (vanity subdomains and CNAME records) and
 * their DNS ownership verification. Backed by the CustomDomain model.
 * Domain-management operations are keyed by the domain record id (matching the
 * controller contract).
 *
 * NOT IMPLEMENTED (A-256, ADR-065): serving the application ON a
 * custom domain. Nothing resolves a tenant from the request's Host, and no TLS
 * certificate is issued for a domain. `resolveTenantByDomain` and
 * `provisionTLSCertificate` had no caller anywhere and were removed rather than
 * left for the next route to inherit: selecting a tenant from a Host header is
 * a tenant-isolation decision (which principal may act where, what a spoofed
 * Host selects) that needs its own design, and the ACME stub wrote challenge
 * files and created CA accounts with no caller, no persistence of what it
 * issued and no renewal. A verified domain is, today, a verified CLAIM.
 *
 * Usage:
 *   const svc = require('./services/customDomains.service');
 *   await svc.addDomain(tenantId, { domain: 'app.example.com', type: 'subdomain' });
 *
 * P9-13 (ADR-087, Stage C): converted from customDomains.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order; the formerly anonymous
 * `exports.x = async () => …` functions are now named after their key, the one
 * accepted surface change). The functions never called each other through
 * `exports`, so they still call each other directly. `crypto` is the module
 * object; `dns` is `require("dns").promises`, captured at load as before, so a
 * spy on `dns.promises.resolveTxt` still applies. `logger`, `AppError`, `db`
 * and `ROLE_NAMES` are captured at load; `auditService` is the module object.
 * Every `require("../models")` and the `emailQueue.service` require stay lazy,
 * inside the functions that use them, and the environment is read at call
 * time, as before.
 */

import crypto from "crypto";
import dnsModule from "dns";
import type { Op as OpNamespace, Transaction } from "sequelize";

import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { db as loadedDb } from "../config";
import auditService from "./audit.service";
import type EmailQueueService from "./emailQueue.service";
import { ROLE_NAMES as LOADED_ROLE_NAMES } from "../constants/roleConstants";
import { env } from "../config/env";
import type { AuditAction } from "../constants/auditActions";
import type { TenantId } from "../types/ids";
import type { ModelInstance, ModelsBarrel } from "../types/models";

const dns = dnsModule.promises;
const logger = loadedLogger;
const AppError = LoadedAppError;
const db = loadedDb;
const ROLE_NAMES = LOADED_ROLE_NAMES;

type CustomDomainRow = ModelInstance<"CustomDomain">;
type UserRow = ModelInstance<"User">;

/** `db.Sequelize` as the `.js` read it: the constructor carries `Op` at run time; Sequelize's typings omit the static. */
type SequelizeWithOp = typeof db.Sequelize & { Op: typeof OpNamespace };

/** `db.Sequelize.Op`, read at call time as the `.js` read it. */
const opOf = (): typeof OpNamespace => (db.Sequelize as SequelizeWithOp).Op;

/** The barrel, required when the calling function runs (never at this module's load), as the `.js` did. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: each function loads the barrel when it runs (see the file header)
const loadModels = (): ModelsBarrel => require("../models") as ModelsBarrel;

/** A thrown value, read the way the `.js` read it (`err.name`, `err.message`). */
interface Thrown {
  name?: unknown;
  message?: unknown;
}

/** Who acted: auditActor(req). */
interface DomainActor {
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | readonly string[] | null;
}

type DomainType = CustomDomainRow["domainType"];

/** The object form of addDomain's second argument (the controller's). */
interface DomainInput {
  domain?: string | undefined;
  type?: DomainType | null;
  sslEnabled?: unknown;
}

interface DnsInstructions {
  verification: { type: "TXT"; name: string; value: string };
  cname: { type: "CNAME"; name: string; value: string };
  instructions: string[];
}

// ==========================================
// CONFIGURATION
// ==========================================

const CUSTOM_DOMAINS_ENABLED = (): boolean =>
  env("CUSTOM_DOMAINS_ENABLED") === "true";
// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty variable means "app"
const DEFAULT_SUBDOMAIN = (): string => env("DEFAULT_SUBDOMAIN") || "app";
// parseInt applies ToString to its argument, so String(undefined) → NaN, as parseInt(undefined) was.
const DNS_CHECK_INTERVAL = (): number => parseInt(String(env("DNS_CHECK_INTERVAL"))) || 300;

const DOMAIN_STATUS = {
  PENDING_VERIFICATION: "pending_verification",
  ACTIVE: "active",
  VERIFICATION_FAILED: "verification_failed",
  DELETING: "deleting",
  DELETED: "deleted",
} as const;

const DOMAIN_TYPE = {
  CUSTOM: "custom",
  SUBDOMAIN: "subdomain",
  VANITY: "vanity",
} as const;

// ==========================================
// HELPERS
// ==========================================

/** Validate domain format. */
function isValidDomain(domain: string): boolean {
  const domainRegex =
    /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[A-Za-z]{2,}$/;
  return domainRegex.test(domain);
}

function generateVerificationToken(): string {
  return `callibrator-verify=${crypto.randomBytes(16).toString("hex")}`;
}

/**
 * Check the DNS TXT record for domain ownership: resolve
 * `_domain_verify.<domain>` and confirm the expected token is present. A missing
 * record / lookup error resolves to `false` (unverified), never throws.
 */
async function checkDnsTxtRecord(domain: string, expectedToken: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(`_domain_verify.${domain}`);
    // resolveTxt returns string[][] (each record may be split into chunks).
    const values = records.map((chunks) => chunks.join(""));
    return values.includes(expectedToken);
  } catch (err) {
    logger.debug("DNS TXT lookup failed", { domain, error: (err as Thrown).message });
    return false;
  }
}

/** DNS records the tenant must add to verify + route their domain. */
function getDnsVerificationInstructions(domain: string, token: string | null | undefined): DnsInstructions {
  return {
    verification: {
      type: "TXT",
      name: `_domain_verify.${domain}`,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty token shows the placeholder
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
      // A-256: no certificate is ever issued automatically (the ACME stub had
      // no caller); promising one misled the tenant.
      "4. Contact support to enable TLS for your domain",
    ],
  };
}

/** A-223 — the one answer to "this domain cannot be claimed". */
const DOMAIN_TAKEN =
  "This domain is already registered and verified by an organisation on this platform. " +
  "It can be added here once that registration is removed.";

/**
 * A-223 — whether another tenant holds `domain` ACTIVE (verified). Global on
 * purpose (skipTenantScope): the question is platform-wide, as the partial
 * unique index `custom_domains_domain_active_uq` (migration 0070) is. Only the
 * yes/no leaves this function — never whose it is.
 *
 * @param {string} tenantId
 * @param {string} domain - lower-case
 * @returns {Promise<boolean>}
 */
async function activeClaimElsewhere(tenantId: TenantId, domain: string): Promise<boolean> {
  const { CustomDomain } = loadModels();
  const holder = await CustomDomain.findOne({
    where: {
      domain,
      status: DOMAIN_STATUS.ACTIVE,
      tenantId: { [opOf().ne]: tenantId },
    },
    attributes: ["id"],
    skipTenantScope: true,
  });
  return Boolean(holder);
}

/**
 * A-223 — refuse an add that cannot succeed, BEFORE writing (409, never the
 * unique index's 500):
 *  - this tenant already has the domain, not removed -> 409;
 *  - another tenant holds it ACTIVE -> 409 (DOMAIN_TAKEN).
 * A REMOVED domain no longer blocks anyone: removal is a soft delete
 * (status `deleted`, kept for the audit trail), and uniqueness now covers
 * only rows that are not deleted. A PENDING claim in another tenant does not
 * block either — ownership is proven by the DNS record, and the first to
 * verify holds the domain; a pending claim held a domain against its real
 * owner forever when uniqueness was global.
 *
 * @param {string} tenantId
 * @param {string} domain - lower-case
 */
async function assertDomainClaimable(tenantId: TenantId, domain: string): Promise<void> {
  const { CustomDomain } = loadModels();
  const own = await CustomDomain.findOne({
    where: { tenantId, domain, status: { [opOf().ne]: DOMAIN_STATUS.DELETED } },
    attributes: ["id", "status"],
  });
  if (own) {
    throw new AppError(409, `This domain is already registered for your organisation (status: ${own.status}).`);
  }
  if (await activeClaimElsewhere(tenantId, domain)) {
    throw new AppError(409, DOMAIN_TAKEN);
  }
}

/** Load a tenant-owned domain record by id (404 if absent). */
async function loadOwned(tenantId: TenantId, domainId: string): Promise<CustomDomainRow> {
  const { CustomDomain } = loadModels();
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
function customDomainsPageUrl(): string | null {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty variable falls through to the next
  const origin = (env("FRONTEND_URL") || env("HOST_URL") || "").replace(/\/+$/, "");
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
async function domainNotificationRecipients(tenantId: TenantId, requesterId: string | null | undefined): Promise<UserRow[]> {
  const { User, Role } = loadModels();
  const attributes = ["id", "email", "firstName"];
  const [requester, admins] = await Promise.all([
    // @ts-expect-error -- as built: the requester id is auditActor(req)'s plain string (the `users.id` attribute is a branded UserId), and for an API key it is null, which matches no requester (`id IS NULL`); the admins still get the email. Not a defect.
    User.findOne({ where: { id: requesterId, tenantId }, attributes }),
    User.findAll({
      where: { tenantId, isActive: true },
      attributes,
      // required: true on purpose — the role IS the filter.
      include: [{ model: Role, as: "role", attributes: [], where: { name: DOMAIN_ADMIN_ROLES }, required: true }],
    }),
  ]);
  const byAddress = new Map<string, UserRow>();
  for (const user of [requester, ...admins]) {
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain, @typescript-eslint/no-unnecessary-condition -- as built: `user && user.email && …`
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
async function sendDomainVerificationEmail(
  tenantId: TenantId,
  domain: string,
  token: string,
  requesterId: string | null | undefined,
): Promise<boolean> {
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: the email queue is loaded on first use, never at this module's load (see the file header)
    const { queueNotificationEmail } = require("./emailQueue.service") as typeof EmailQueueService;
    let accepted = 0;
    for (const recipient of recipients) {
      const ok = await queueNotificationEmail({
        email: recipient.email,
        // As built: an empty first name reads as "" (`||`, never `??`).
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
    logger.error("Domain verification email was not sent", { ...context, error: (err as Thrown).message });
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
const auditDomainChange = (
  transaction: Transaction,
  tenantId: TenantId,
  actor: DomainActor,
  { action, resourceId, changes }: { action: AuditAction; resourceId: string; changes: Record<string, unknown> },
): Promise<unknown> =>
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
const getTenantDomains = async (tenantId: TenantId): Promise<CustomDomainRow[]> => {
  try {
    const { CustomDomain } = loadModels();
    return await CustomDomain.findAll({
      where: { tenantId, status: { [opOf().ne]: DOMAIN_STATUS.DELETED } },
      order: [["createdAt", "DESC"]],
    });
  } catch (err) {
    logger.error("Failed to get tenant domains", {
      tenantId,
      error: (err as Thrown).message,
    });
    return [];
  }
};

/**
 * Add a custom domain. Accepts either a string domain or an
 * { domain, type, sslEnabled } object (the controller passes the object form).
 */
const addDomain = async (
  tenantId: TenantId,
  domainInput: DomainInput | string | null | undefined,
  typeArg: DomainType = "subdomain",
  actor: DomainActor = {},
): Promise<{ id: string; domain: string; status: CustomDomainRow["status"]; sslEnabled: boolean; verification: DnsInstructions }> => {
  if (!CUSTOM_DOMAINS_ENABLED()) {
    throw new AppError(400, "Custom domains are disabled");
  }

  let domain: string | null | undefined;
  let type = typeArg;
  let sslEnabled = true;
  if (domainInput && typeof domainInput === "object") {
    domain = domainInput.domain;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty type means "subdomain"
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
  // A-223: DNS names are case-insensitive; one spelling is stored.
  domain = domain.toLowerCase();

  await assertDomainClaimable(tenantId, domain);

  try {
    const { CustomDomain } = loadModels();
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
    // A-223: a concurrent add of the same domain that passed the check above
    // lost the race on the unique index — the same conflict, not a 500.
    const failure = err as Thrown;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain -- as built: `err && err.name === …` tolerates a thrown non-object
    if (failure && failure.name === "SequelizeUniqueConstraintError") {
      throw new AppError(409, DOMAIN_TAKEN);
    }
    logger.error("Failed to add domain", {
      tenantId,
      domain,
      error: failure.message,
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
const verifyDomain = async (
  tenantId: TenantId,
  domainId: string,
  actor: DomainActor = {},
): Promise<
  | { verified: false; reason: string }
  | {
      verified: boolean;
      status: CustomDomainRow["status"];
      record: string | null;
      dnsRecord: { type: "TXT"; name: string; value: string };
    }
> => {
  if (!CUSTOM_DOMAINS_ENABLED()) {
    return { verified: false, reason: "Custom domains disabled" };
  }

  const record = await loadOwned(tenantId, domainId);
  if (record.status === DOMAIN_STATUS.DELETED) {
    throw new AppError(409, "This domain was removed and cannot be verified. Add it again to start a new verification.");
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty stored token gets a fresh one
  const token = record.verificationToken || generateVerificationToken();

  // Real DNS ownership check; both outcomes are reachable. Never throws.
  const verified = await checkDnsTxtRecord(record.domain, token);
  const before = { status: record.status };

  // A-223: a domain is ACTIVE for one organisation at a time (the partial
  // unique index of migration 0070). Another organisation's active claim
  // stands until it removes it; its DNS record is not ours to overrule here.
  if (verified && record.status !== DOMAIN_STATUS.ACTIVE && (await activeClaimElsewhere(tenantId, record.domain))) {
    throw new AppError(409, DOMAIN_TAKEN);
  }

  const persist = db.transaction(async (transaction) => {
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
  try {
    await persist;
  } catch (err) {
    // A-223: another organisation verified the same domain between the check
    // above and this commit, and won the unique index — the same conflict.
    const failure = err as Thrown;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain -- as built: `err && err.name === …` tolerates a thrown non-object
    if (failure && failure.name === "SequelizeUniqueConstraintError") {
      throw new AppError(409, DOMAIN_TAKEN);
    }
    throw err;
  }

  return {
    verified,
    status: record.status,
    record: verified ? token : null,
    // F-19: the check above resolves a TXT record (checkDnsTxtRecord); the
    // instruction said CNAME, so a tenant following it could never verify.
    dnsRecord: {
      type: "TXT",
      name: `_domain_verify.${record.domain}`,
      value: token,
    },
  };
};

/**
 * Remove a domain (by record id) — soft delete (status = deleted).
 */
const removeDomain = async (
  tenantId: TenantId,
  domainId: string,
  actor: DomainActor = {},
): Promise<{ success: true; id: string }> => {
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
      error: (err as Thrown).message,
    });
    throw new AppError(500, "Failed to remove domain");
  }
};

/**
 * Get the status of a domain (by record id).
 */
const getDomainStatus = async (
  tenantId: TenantId,
  domainId: string,
): Promise<{
  id: string;
  domain: string;
  status: CustomDomainRow["status"];
  sslEnabled: boolean;
  isDefault: boolean;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
}> => {
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
const setDefaultDomain = async (
  tenantId: TenantId,
  domainId: string,
  actor: DomainActor = {},
): Promise<{ id: string; domain: string; isDefault: true }> => {
  const record = await loadOwned(tenantId, domainId);
  if (record.status === DOMAIN_STATUS.DELETED) {
    throw new AppError(400, "A deleted domain cannot be set as default");
  }

  const { CustomDomain } = loadModels();
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
const getDnsRecords = async (tenantId: TenantId, domainId: string): Promise<DnsInstructions> => {
  const record = await loadOwned(tenantId, domainId);
  return getDnsVerificationInstructions(record.domain, record.verificationToken);
};

// ==========================================
// UTILITIES
// ==========================================

const getStatus = (): { enabled: boolean; defaultSubdomain: string; dnsCheckInterval: number; tlsAutoProvision: false } => ({
  enabled: CUSTOM_DOMAINS_ENABLED(),
  defaultSubdomain: DEFAULT_SUBDOMAIN(),
  dnsCheckInterval: DNS_CHECK_INTERVAL(),
  // A-256: kept in the answer's shape, and true to what exists: no
  // certificate is provisioned, whatever TLS_AUTO_PROVISION says.
  tlsAutoProvision: false,
});

const service = {
  getTenantDomains,
  addDomain,
  verifyDomain,
  removeDomain,
  getDomainStatus,
  setDefaultDomain,
  getDnsRecords,
  getStatus,
  DOMAIN_STATUS,
  DOMAIN_TYPE,
};

export = service;
