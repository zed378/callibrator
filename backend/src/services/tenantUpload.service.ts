// P9-13 (ADR-087, Stage C): converted from tenantUpload.service.js with no
// behaviour change. `export =` keeps the exact object `require()` returned
// (the same keys, in the same order; the two formerly anonymous
// `exports.x = async () => …` functions are now named after their key, the one
// accepted surface change). They call `changeLogo` directly, as before. Every
// load-time destructure is kept as a capture at load (`Tenants`, `db`,
// `logger`, `AppError`, `deleteUpload`, `auditEntryActor`, `actorChanges`);
// `auditService` is the module object. An API key still acts as
// `system:api-key` with its id in `changes` (A-282).
import type { Transaction } from "sequelize";

import models from "../models";
import { db as loadedDb } from "../config";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { deleteUpload as loadedDeleteUpload } from "../utils/upload.util";
import auditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
} from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import type { ModelInstance } from "../types/models";

const { Tenants } = models;
const db = loadedDb;
const logger = loadedLogger;
const AppError = LoadedAppError;
const deleteUpload = loadedDeleteUpload;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;

type TenantRow = ModelInstance<"Tenant">;

/** A thrown value, read the way the `.js` read it (`error.message`). */
interface Thrown {
  message?: unknown;
}

/** The request's audit actor, plus whether it is the platform operator. */
interface LogoActor extends AuditActorInput {
  actorIsSuperAdmin?: boolean;
  tenantId?: string | null;
}

/** The service's own response object (the controller reads it). */
interface LogoResult {
  data: { logo: string | null };
  message: string;
  status: 200;
}

// ==========================================
// TENANT LOGO UPLOAD SERVICE
// ==========================================

/** The "no logo" sentinel — never a file of this tenant's to delete. */
const LOGO_PLACEHOLDER = "default.svg";
const LOGO_FOLDER = "uploads/public/tenant";

/**
 * The stored logo filename of a tenant, or null when it has none of its own.
 *
 * @param {object} tenant
 * @returns {string|null}
 */
const ownLogoFile = (tenant: TenantRow): string | null => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a stored logo is coerced as the `.js` coerced it
  const stored = tenant.logo ? String(tenant.logo).split("/").pop() : null;
  return stored && stored !== LOGO_PLACEHOLDER ? stored : null;
};

/**
 * A-96. Change a tenant's `logo`: the row update and its audit row share ONE
 * transaction (CLAUDE.md, A-41), and the file the change stops referencing is
 * deleted only AFTER the commit. It used to be deleted first, so a failed
 * update left the tenant pointing at a file that no longer existed.
 *
 * `actor` defaults to "nobody": a non-super-admin may change only their own
 * tenant; any other id is 404 "Tenant not found", like a missing one
 * (`tenants` is not tenant-scoped, so findByPk alone would load anyone's). On
 * the HTTP path checkTenant has already refused that at the gate; this is the
 * service holding its own line, as updateTenant does (A-63).
 *
 * @param {object} p
 * @param {string} p.tenantId
 * @param {string|null} p.next - the new logo value
 * @param {string} p.operation - changes.operation for the audit row
 * @param {string|null} p.updatedBy - the acting user id (from req.user)
 * @param {{actorIsSuperAdmin?: boolean, tenantId?: (string|null),
 *   ipAddress?: (string|null), userAgent?: (string|null)}} p.actor
 * @param {boolean} p.skipWhenNoLogo - a remove with nothing to remove writes nothing
 * @returns {Promise<{changed: boolean}>}
 */
const changeLogo = async ({
  tenantId,
  next,
  operation,
  updatedBy,
  actor,
  skipWhenNoLogo,
}: {
  tenantId: string | undefined;
  next: string | null;
  operation: string;
  updatedBy: string | null | undefined;
  actor: LogoActor;
  skipWhenNoLogo: boolean;
}): Promise<{ changed: boolean }> => {
  const transaction: Transaction = await db.transaction();
  let replaced: string | null | undefined;
  try {
    const tenant = await Tenants.findByPk(tenantId, { transaction });

    const foreign =
      Boolean(tenant) &&
      actor.actorIsSuperAdmin !== true &&
      String((tenant as TenantRow).id) !== String(actor.tenantId);
    if (!tenant || foreign) {
      if (foreign) {
        logger.warn("tenantUpload.service: cross-tenant logo change refused", {
          reason: "cross-tenant",
          tenantId: String(tenantId),
          actorTenantId: String(actor.tenantId),
          operation,
        });
      }
      throw new AppError(404, "Tenant not found");
    }

    replaced = ownLogoFile(tenant);
    if (skipWhenNoLogo && !replaced) {
      // Nothing to change, so nothing to audit.
      await transaction.rollback();
      return { changed: false };
    }

    const before = tenant.logo ?? null;
    // Store only the filename.
    await tenant.update({ logo: next }, { silent: true, transaction });

    await auditService.logAction(
      {
        tenantId: tenant.id,
        // A-282 (ADR-100): an API key is system:api-key, its id in changes.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id reads as no user
        ...auditEntryActor({ ...actor, userId: updatedBy || null }),
        action: "UPDATE",
        resourceType: "Tenant",
        resourceId: tenant.id,
        changes: { operation, logo: { before, after: next }, ...actorChanges(actor) },
      },
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    // Every throw above happens before the commit.
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is ignored
    await transaction.rollback().catch(() => {});
    throw error;
  }

  // Never the file just stored (a re-upload under the same name).
  if (replaced && replaced !== next) {
    try {
      await deleteUpload(replaced, LOGO_FOLDER);
    } catch (err) {
      // The change is committed; a leftover file is a storage leak, not a
      // reason to report it as failed.
      logger.warn(`Failed to delete replaced logo: ${replaced}`, err);
    }
  }
  return { changed: true };
};

/**
 * Update tenant logo
 * @param {string} tenantId - Tenant identifier
 * @param {string} filename - Uploaded filename
 * @param {string} updatedBy - User ID who updated
 * @param {object} [actor] - see changeLogo; defaults to nobody
 */
const updateTenantLogo = async (
  // P9-20: as the controller reads them from the request (type-only).
  tenantId: string | undefined,
  filename: string,
  updatedBy: string | null | undefined,
  actor: LogoActor = {},
): Promise<LogoResult> => {
  try {
    await changeLogo({
      tenantId,
      next: filename,
      operation: "UPDATE_LOGO",
      updatedBy,
      actor,
      skipWhenNoLogo: false,
    });

    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a null actor id is interpolated as "null"
    logger.info(`Tenant logo updated: ${tenantId} by ${updatedBy}`);

    return {
      data: { logo: filename },
      message: "Tenant logo updated successfully",
      status: 200,
    };
  } catch (error) {
    if (error instanceof AppError) {throw error;}
    logger.error("Error updating tenant logo", { error: (error as Thrown).message });
    throw new AppError(500, "Failed to update tenant logo");
  }
};

/**
 * Remove tenant logo
 * @param {string} tenantId - Tenant identifier
 * @param {string} updatedBy - User ID who updated
 * @param {object} [actor] - see changeLogo; defaults to nobody
 */
const removeTenantLogo = async (
  // P9-20: as the controller reads them from the request (type-only).
  tenantId: string | undefined,
  updatedBy: string | null | undefined,
  actor: LogoActor = {},
): Promise<LogoResult> => {
  try {
    const { changed } = await changeLogo({
      tenantId,
      next: null,
      operation: "REMOVE_LOGO",
      updatedBy,
      actor,
      skipWhenNoLogo: true,
    });

    if (changed) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a null actor id is interpolated as "null"
      logger.info(`Tenant logo removed: ${tenantId} by ${updatedBy}`);
    }

    return {
      data: { logo: null },
      message: "Tenant logo removed successfully",
      status: 200,
    };
  } catch (error) {
    if (error instanceof AppError) {throw error;}
    logger.error("Error removing tenant logo", { error: (error as Thrown).message });
    throw new AppError(500, "Failed to remove tenant logo");
  }
};

const service = {
  updateTenantLogo,
  removeTenantLogo,
};

export = service;
