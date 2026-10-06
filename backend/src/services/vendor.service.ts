/**
 * Vendors: calibration labs and parts suppliers — the ISO 13485 approved
 * supplier file — audited in their transactions (A-278).
 *
 * P9-16 (ADR-087, Stage C): converted from vendor.service.js with no behaviour
 * change. `export =` keeps the exact object `require()` returned (the same
 * keys, in the same order). No method calls a sibling. `Op`, `db`, the model,
 * `AppError`, the two limits, `auditService` and the two audit helpers are
 * captured once at load, as the `.js` destructured them. redis.service is
 * still loaded at this module's load, as the `.js` required it; the `.js`
 * destructured `get`, `set`, `delPattern` and `cacheKeys` from it and used none
 * of them.
 *
 * As built, not changed here: the catch blocks throw plain `{ status, message }`
 * objects, which the controller reads (the file-level `only-throw-error`
 * exemption below); `fetchVendors` answers `data: { rows, count, meta }`, which
 * the controller unwraps. Its search was a case-sensitive `LIKE` until A-330.
 */
/* eslint-disable @typescript-eslint/only-throw-error -- as built (ADR-038 rule 3): the catch blocks throw { status, message } objects, which vendor.controller and asyncHandler read */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): `||` treats 0, "" and NaN as absent throughout this file */
import { Op as LoadedOp, type CreationAttributes, type Transaction, type WhereOptions } from "sequelize";
import { db as loadedDb } from "../config";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT, MAX_LIMIT as LOADED_MAX_LIMIT } from "../constants";
import "./redis.service";
import loadedAuditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
  type AuditActorInput,
} from "../utils/auditPrincipal.util";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const Op = LoadedOp;
const db = loadedDb;
const { Vendors } = models;
const AppError = LoadedAppError;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const MAX_LIMIT = LOADED_MAX_LIMIT;
const auditService = loadedAuditService;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;

type VendorRow = ModelInstance<"Vendor">;
type PlainRecord = Record<string, unknown>;

/** A caught value, read for the two fields the thrown object carries. */
interface CaughtError {
  status?: unknown;
  message?: unknown;
}

/**
 * A-278 (ADR-094) — a vendor change commits with one audit row in its
 * transaction. Vendors are ISO 13485 approved suppliers: who changed one, and
 * how, is part of the supplier file. The actor is a user, or an API key as
 * `system:api-key` (A-282).
 *
 * @param transaction
 * @param actor - auditPrincipal(req)
 * @param tenantId
 * @param action
 * @param vendorId
 * @param changes - { operation, before, after }
 */
const auditVendor = (
  transaction: Transaction,
  actor: AuditActorInput,
  tenantId: TenantId,
  action: "CREATE" | "UPDATE" | "DELETE",
  vendorId: string,
  changes: Record<string, unknown>,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId,
      ...auditEntryActor(actor),
      action,
      resourceType: "Vendor",
      resourceId: vendorId,
      changes: { ...changes, ...actorChanges(actor) },
    },
    { transaction },
  );

const QUALIFY_FIELDS = Object.freeze(["approvalStatus", "scorecard", "lastAuditDate", "nextAuditDate"]);

/** The named attributes of a row, as plain values (null when absent). */
const pick = (row: object, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]));

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const transformVendor = (vendor: unknown): PlainRecord | null => {
  if (!vendor) {return null;}
  const v = vendor as { toJSON?: () => PlainRecord };
  return v.toJSON ? v.toJSON() : { ...(vendor as PlainRecord) };
};

const transformVendors = (rows: unknown[] | null | undefined): (PlainRecord | null)[] => (rows || []).map(transformVendor);

/** The service's answer; the controller forwards it. */
interface ServiceResult<T> {
  success: true;
  status: number;
  message: string;
  data?: T;
}

// ------------------------------------------------------------------
// GET ALL VENDORS
// ------------------------------------------------------------------

/** The list query as the controller passes it (validated; a JavaScript caller may pass anything). */
interface FetchVendorsQuery {
  tenantId: TenantId;
  find?: string | null;
  page?: number | string;
  limit?: number | string;
  status?: string | null;
  type?: string | null;
}

interface VendorListData {
  rows: (PlainRecord | null)[];
  count: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const fetchVendors = async ({
  tenantId,
  find,
  page = 1,
  limit = DEFAULT_LIMIT,
  status,
  type,
}: FetchVendorsQuery): Promise<ServiceResult<VendorListData>> => {
  try {
    const whereClause: Record<string, unknown> = { tenantId };

    if (find) {
      // A-330: ILIKE (it was a case-sensitive LIKE, so "acme" missed "Acme Labs").
      whereClause["name"] = { [Op.iLike]: `%${find}%` };
    }
    if (status) {
      whereClause["status"] = status;
    }
    if (type) {
      whereClause["type"] = type;
    }

    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Number(page) - 1) * safeLimit;

    const { count, rows } = await Vendors.findAndCountAll({
      where: whereClause as WhereOptions,
      limit: safeLimit,
      offset,
      order: [["createdAt", "DESC"], ["id", "DESC"]],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch vendors successful",
      data: {
        rows: transformVendors(rows),
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: safeLimit,
          totalPages: Math.ceil(count / safeLimit),
        },
      },
    };
  } catch (error) {
    const e = error as CaughtError;
    throw {
      status: e.status || 500,
      message: e.message || "Failed to fetch vendors",
    };
  }
};

// ------------------------------------------------------------------
// GET SPECIFIC VENDOR
// ------------------------------------------------------------------
const getVendorById = async (tenantId: TenantId, vendorId: string): Promise<ServiceResult<PlainRecord | null>> => {
  try {
    const vendor = await Vendors.findOne({
      where: { id: vendorId, tenantId },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    return {
      success: true,
      status: 200,
      message: "Vendor retrieved successfully",
      data: transformVendor(vendor),
    };
  } catch (error) {
    const e = error as CaughtError;
    throw {
      status: e.status || 500,
      message: e.message || "Failed to retrieve vendor",
    };
  }
};

// ------------------------------------------------------------------
// CREATE VENDOR
// ------------------------------------------------------------------

/** A vendor as the controller passes it (validated; a JavaScript caller may pass anything). */
type VendorInput = Record<string, unknown>;

const createVendor = async (tenantId: TenantId, data: VendorInput, actor: AuditActorInput = {}): Promise<ServiceResult<PlainRecord | null>> => {
  try {
    const newVendor = await db.transaction(async (transaction) => {
      const created = await Vendors.create({ ...(data as CreationAttributes<VendorRow>), tenantId }, { transaction });
      await auditVendor(transaction, actor, tenantId, "CREATE", created.id, {
        operation: "VENDOR_CREATE",
        before: {},
        after: pick(created, Object.keys(data)),
      });
      return created;
    });

    return {
      success: true,
      status: 201,
      message: "Vendor created successfully",
      data: transformVendor(newVendor),
    };
  } catch (error) {
    const e = error as CaughtError;
    throw {
      status: e.status || 500,
      message: e.message || "Failed to create vendor",
    };
  }
};

// ------------------------------------------------------------------
// UPDATE VENDOR
// ------------------------------------------------------------------
const updateVendor = async (tenantId: TenantId, vendorId: string, data: VendorInput, actor: AuditActorInput = {}): Promise<ServiceResult<PlainRecord | null>> => {
  try {
    const vendor = await Vendors.findOne({
      where: { id: vendorId, tenantId },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    const fields = Object.keys(data);
    const before = pick(vendor, fields);
    await db.transaction(async (transaction) => {
      await vendor.update(data as Parameters<VendorRow["update"]>[0], { transaction });
      await auditVendor(transaction, actor, tenantId, "UPDATE", vendor.id, {
        operation: "VENDOR_UPDATE",
        before,
        after: pick(vendor, fields),
      });
    });

    return {
      success: true,
      status: 200,
      message: "Vendor updated successfully",
      data: transformVendor(vendor),
    };
  } catch (error) {
    const e = error as CaughtError;
    throw {
      status: e.status || 500,
      message: e.message || "Failed to update vendor",
    };
  }
};

// ------------------------------------------------------------------
// DELETE VENDOR
// ------------------------------------------------------------------
const deleteVendor = async (tenantId: TenantId, vendorId: string, actor: AuditActorInput = {}): Promise<ServiceResult<never>> => {
  try {
    const vendor = await Vendors.findOne({
      where: { id: vendorId, tenantId },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    await db.transaction(async (transaction) => {
      await vendor.destroy({ transaction });
      await auditVendor(transaction, actor, tenantId, "DELETE", vendor.id, {
        operation: "VENDOR_DELETE",
        before: pick(vendor, ["name", "approvalStatus"]),
      });
    });

    return {
      success: true,
      status: 200,
      message: "Vendor deleted successfully",
    };
  } catch (error) {
    const e = error as CaughtError;
    throw {
      status: e.status || 500,
      message: e.message || "Failed to delete vendor",
    };
  }
};

// ------------------------------------------------------------------
// QUALIFY VENDOR
// ------------------------------------------------------------------

/** The qualification as the controller passes it. */
interface QualifyInput {
  tenantId: TenantId;
  id: string;
  approvalStatus?: string | null;
  scorecard?: unknown;
  lastAuditDate?: Date | string | null;
  nextAuditDate?: Date | string | null;
  actor?: AuditActorInput;
}

const qualifyVendor = async ({ tenantId, id, approvalStatus, scorecard, lastAuditDate, nextAuditDate, actor = {} }: QualifyInput): Promise<PlainRecord | null> => {
  try {
    const vendor = await Vendors.findOne({
      where: { id, tenantId },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    const before = pick(vendor, QUALIFY_FIELDS);
    const target = vendor as unknown as Record<string, unknown>;
    if (approvalStatus) {target["approvalStatus"] = approvalStatus;}
    if (scorecard !== undefined) {target["scorecard"] = scorecard;}
    if (lastAuditDate) {target["lastAuditDate"] = lastAuditDate;}
    if (nextAuditDate) {target["nextAuditDate"] = nextAuditDate;}

    await db.transaction(async (transaction) => {
      await vendor.save({ transaction });
      await auditVendor(transaction, actor, tenantId, "UPDATE", vendor.id, {
        operation: "VENDOR_QUALIFY",
        before,
        after: pick(vendor, QUALIFY_FIELDS),
      });
    });

    return transformVendor(vendor);
  } catch (error) {
    const e = error as CaughtError;
    throw {
      status: e.status || 500,
      message: e.message || "Failed to qualify vendor",
    };
  }
};

export = {
  fetchVendors,
  getVendorById,
  createVendor,
  updateVendor,
  deleteVendor,
  qualifyVendor,
};
