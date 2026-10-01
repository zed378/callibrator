/**
 * P10-04 (ADR-098 §7.2) — identifier-first sign-in: which step comes after
 * the identifier, decided by the email's DOMAIN, never by the account.
 *
 *   discover("ana@rs-contoh.co.id")  → { next: "sso", redirectUrl }  when a
 *                                       tenant with SSO on has claimed the domain
 *   discover(anything else)          → { next: "password" }
 *
 * NO ACCOUNT IS LOOKED UP. The answer depends only on the domain, which is not
 * a secret, so an existing and a non-existent address in the same domain get
 * the same answer (the P10-04 test pins it). The residual, recorded in
 * ADR-098: the answer tells anyone that a domain uses SSO here, i.e. that the
 * hospital is a customer — the fact a hospital-branded login link discloses.
 *
 * A DOMAIN CLAIM is platform-controlled: `tenant_settings.sso_email_domains`
 * (a JSON array) is written ONLY by the super admin (PUT
 * /admin/tenants/:id/sso-domains). It is not in TENANT_ADMIN_SETTING_KEYS, so
 * a tenant cannot claim `gmail.com` or a rival hospital's domain for itself.
 * A domain is claimed by at most one tenant, and a public mailbox provider's
 * domain by none.
 *
 * Any failure to start the SSO of a claimed domain falls back to the password
 * step (the organisation-code link remains), with the reason logged.
 */
import type { Response } from "express";
import { Op } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { AppError } from "../utils/appError.util";
import { logger } from "../middlewares/activityLog.middleware";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { toTenantId } from "../types/ids";

const { TenantSettings, Tenant } = models;

/** The tenant_settings key of a tenant's claimed email domains. */
export const SSO_EMAIL_DOMAINS_KEY = "sso_email_domains";

/**
 * Mailbox providers anyone can hold an address at: never claimable, since a
 * claim would send every user of the provider to one hospital's IdP. Not
 * exhaustive — the super admin is the control; this stops the obvious slip.
 */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = Object.freeze([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.id",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "zoho.com",
]);

/** What discovery answers. */
export type Discovery = { next: "password" } | { next: "sso"; redirectUrl: string };

/** sso.controller.js#startSsoFor, as this module calls it (the controller is JavaScript). */
interface SsoStarter {
  startSsoFor: (tenantCode: string, res: Response) => Promise<{ redirectUrl: string; protocol: string }>;
}

const ssoController = (): SsoStarter =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a lazy require of a JavaScript controller, typed by the one function used
  require("../controllers/sso.controller") as SsoStarter;

const PASSWORD: Discovery = Object.freeze({ next: "password" });

/** The domain of an email-shaped identifier, lower-cased, or null for a username. */
export const domainOf = (identifier: string): string | null => {
  const at = identifier.lastIndexOf("@");
  if (at <= 0 || at === identifier.length - 1) {
    return null;
  }
  return identifier.slice(at + 1).trim().toLowerCase();
};

/** A stored claim, parsed; a malformed value claims nothing. */
export const parseDomains = (value: string | null): string[] => {
  if (value === null || value === "") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string") : [];
  } catch {
    return [];
  }
};

/** The tenant id claiming `domain`, or null. Platform-wide by nature: a claim is looked up before any tenant is known. */
const claimantOf = async (domain: string): Promise<string | null> => {
  const rows = await TenantSettings.findAll({
    where: { key: SSO_EMAIL_DOMAINS_KEY },
    attributes: ["tenantId", "value"],
    // Pre-authentication: the tenant is what this lookup finds (one key, no user data).
    skipTenantScope: true,
  });
  const match = rows.find((row) => parseDomains(row.value).includes(domain));
  return match ? match.tenantId : null;
};

/**
 * The next sign-in step for `identifier`.
 *
 * @param res - the response, on which an OIDC start sets its browser-binding cookie
 */
export const discoverSignIn = async (identifier: string, res: Response): Promise<Discovery> => {
  const domain = domainOf(identifier);
  if (domain === null) {
    return PASSWORD;
  }
  const tenantId = await claimantOf(domain);
  if (tenantId === null) {
    return PASSWORD;
  }
  const tenant = await Tenant.findByPk(tenantId, { attributes: ["id", "code"] });
  if (!tenant?.code) {
    return PASSWORD;
  }
  try {
    const { redirectUrl } = await ssoController().startSsoFor(tenant.code, res);
    return { next: "sso", redirectUrl };
  } catch (err) {
    logger.info("Sign-in discovery fell back to the password step", {
      tenantId,
      reason: (err as Error).message,
    });
    return PASSWORD;
  }
};

/** The domains a tenant has claimed (super admin view). */
export const getSsoEmailDomains = async (tenantId: string): Promise<string[]> => {
  const row = await TenantSettings.findOne({
    where: { tenantId: toTenantId(tenantId), key: SSO_EMAIL_DOMAINS_KEY },
    skipTenantScope: true,
  });
  return parseDomains(row ? row.value : null);
};

/**
 * Replace a tenant's claimed domains (super admin only — the admin router).
 * 404 unknown tenant; 400 a public mailbox domain; 409 a domain another
 * tenant has claimed (named, with the claimant's code: the super admin sees
 * every tenant). Audited under PLATFORM in the same transaction.
 */
export const setSsoEmailDomains = async (
  tenantId: string,
  domains: readonly string[],
  actor: { userId: string; ipAddress: string | null; userAgent: string | null },
): Promise<string[]> => {
  const unique = [...new Set(domains.map((d) => d.toLowerCase()))].sort();
  const publicOnes = unique.filter((d) => PUBLIC_EMAIL_DOMAINS.includes(d));
  if (publicOnes.length > 0) {
    throw new AppError(400, `A public mailbox domain cannot be claimed: ${publicOnes.join(", ")}`);
  }
  const id = toTenantId(tenantId);
  return db.transaction(async (transaction) => {
    const tenant = await Tenant.findByPk(id, { transaction, attributes: ["id", "code"] });
    if (!tenant) {
      throw new AppError(404, "Tenant not found");
    }
    const others = await TenantSettings.findAll({
      where: { key: SSO_EMAIL_DOMAINS_KEY, tenantId: { [Op.ne]: id } },
      transaction,
      lock: transaction.LOCK.UPDATE,
      skipTenantScope: true,
    });
    for (const other of others) {
      const taken = parseDomains(other.value).filter((d) => unique.includes(d));
      if (taken.length > 0) {
        const holder = await Tenant.findByPk(other.tenantId, { transaction, attributes: ["code"] });
        throw new AppError(
          409,
          `${taken.join(", ")} is already claimed by tenant ${holder?.code ?? other.tenantId}; remove it there first.`,
        );
      }
    }
    const existing = await TenantSettings.findOne({
      where: { tenantId: id, key: SSO_EMAIL_DOMAINS_KEY },
      transaction,
      skipTenantScope: true,
    });
    const before = parseDomains(existing ? existing.value : null);
    const value = JSON.stringify(unique);
    if (existing) {
      await existing.update({ value }, { transaction });
    } else {
      await TenantSettings.create({ tenantId: id, key: SSO_EMAIL_DOMAINS_KEY, value }, { transaction });
    }
    await auditService.logAction(
      {
        tenantId: PLATFORM_TENANT_ID,
        userId: actor.userId,
        action: "UPDATE",
        resourceType: "Tenant",
        resourceId: id,
        changes: { operation: "SSO_EMAIL_DOMAINS_SET", before: { domains: before }, after: { domains: unique } },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
      { transaction },
    );
    return unique;
  });
};
