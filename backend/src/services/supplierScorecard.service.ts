/**
 * Supplier scorecards: periodic quality/delivery/service evaluations of a
 * vendor (ISO 13485 §7.4 supplier monitoring), audited in their transactions
 * (A-278).
 *
 * P9-16 (ADR-087, Stage C): converted from supplierScorecard.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order). `updateScorecard` and `deleteScorecard` call
 * `getScorecardById` through the exported object, as the `.js` did through
 * `this` (which at a CommonJS module's top level is `module.exports`), so a spy
 * on the export still intercepts it. The three models, `AppError`, `db`,
 * `auditService` and the two audit helpers are captured once at load, as the
 * `.js` destructured them.
 */
import type { CreationAttributes, Transaction, WhereOptions } from "sequelize";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { db as loadedDb } from "../config";
import loadedAuditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
  type AuditActorInput,
} from "../utils/auditPrincipal.util";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { SupplierScorecard, Vendor, User } = models;
const AppError = LoadedAppError;
const db = loadedDb;
const auditService = loadedAuditService;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;

type ScorecardRow = ModelInstance<"SupplierScorecard">;

/**
 * A-278 (ADR-094) — a supplier-scorecard change commits with one audit row in its
 * transaction. The actor is a user, or an API key as `system:api-key` (A-282).
 *
 * @param transaction
 * @param actor - auditPrincipal(req)
 * @param tenantId
 * @param action
 * @param id
 * @param changes - { operation, before, after }
 */
const auditSupplierScorecard = (
  transaction: Transaction,
  actor: AuditActorInput,
  tenantId: TenantId,
  action: "CREATE" | "UPDATE" | "DELETE",
  id: string,
  changes: Record<string, unknown>,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId,
      ...auditEntryActor(actor),
      action,
      resourceType: "SupplierScorecard",
      resourceId: id,
      changes: { ...changes, ...actorChanges(actor) },
    },
    { transaction },
  );

/** The named attributes of a row, as plain values (null when absent). */
const pick = (row: object, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]));

/** A scorecard as the controller passes it (validated by the contract's schema since A-336). */
type ScorecardInput = Record<string, unknown> & { vendorId?: unknown };

const createScorecard = async (tenantId: TenantId, data: ScorecardInput, userId: UserId, actor: AuditActorInput = { userId }): Promise<ScorecardRow> => {
  const vendor = await Vendor.findOne({ where: { id: data.vendorId as string, tenantId } });
  if (!vendor) {throw new AppError(404, "Vendor not found");}

  return db.transaction(async (transaction) => {
    const scorecard = await SupplierScorecard.create({ ...(data as CreationAttributes<ScorecardRow>), tenantId, evaluatedBy: userId }, { transaction });
    await auditSupplierScorecard(transaction, actor, tenantId, "CREATE", scorecard.id, {
      operation: "SCORECARD_CREATE",
      before: {},
      after: pick(scorecard, Object.keys(data)),
    });
    return scorecard;
  });
};

/** The list query as the controller passes it. */
interface ScorecardQuery {
  limit?: number | string;
  page?: number | string;
  vendorId?: string | null;
  status?: string | null;
}

interface ScorecardList {
  rows: ScorecardRow[];
  total: number;
  page: number;
  totalPages: number;
}

const getScorecards = async (tenantId: TenantId, query: ScorecardQuery): Promise<ScorecardList> => {
  const { limit = 10, page = 1, vendorId, status } = query;
  const offset = ((page as number) - 1) * (limit as number);

  const where: Record<string, unknown> = { tenantId };
  if (vendorId) {where["vendorId"] = vendorId;}
  if (status) {where["status"] = status;}

  const { count, rows } = await SupplierScorecard.findAndCountAll({
    where: where as WhereOptions,
    limit: parseInt(limit as string),
    offset: parseInt(offset as unknown as string),
    order: [["evaluationDate", "DESC"]],
    include: [
      { model: Vendor, as: "vendor", attributes: ["id", "name"] },
      // LEFT JOIN (A-90): without it User's defaultScope makes this INNER, and
      // a scorecard whose evaluator was deleted or is outside the tenant vanished.
      { model: User, as: "evaluator", attributes: ["id", "firstName", "lastName", "email"], required: false },
    ],
  });

  return {
    rows,
    total: count,
    page: parseInt(page as string),
    totalPages: Math.ceil(count / (limit as number)),
  };
};

const getScorecardById = async (tenantId: TenantId, id: string): Promise<ScorecardRow> => {
  const scorecard = await SupplierScorecard.findOne({
    where: { id, tenantId },
    include: [
      { model: Vendor, as: "vendor", attributes: ["id", "name"] },
      // LEFT JOIN (A-90): without it User's defaultScope makes this INNER, and
      // a scorecard whose evaluator was deleted or is outside the tenant vanished.
      { model: User, as: "evaluator", attributes: ["id", "firstName", "lastName", "email"], required: false },
    ],
  });
  if (!scorecard) {throw new AppError(404, "Scorecard not found");}
  return scorecard;
};

const updateScorecard = async (tenantId: TenantId, id: string, data: ScorecardInput, actor: AuditActorInput = {}): Promise<ScorecardRow> => {
  const scorecard = await service.getScorecardById(tenantId, id);
  // A-336 (2026-10-01): a changed vendor must be the caller's tenant's, as on
  // create. Another tenant's and a missing vendor are ONE 404 (the predicate
  // is explicit: a super admin's context skips the tenant hooks).
  if (data.vendorId !== undefined) {
    const vendor = await Vendor.findOne({ where: { id: data.vendorId as string, tenantId }, attributes: ["id"] });
    if (!vendor) {throw new AppError(404, "Vendor not found");}
  }
  const fields = Object.keys(data);
  const before = pick(scorecard, fields);
  await db.transaction(async (transaction) => {
    await scorecard.update(data as Parameters<ScorecardRow["update"]>[0], { transaction });
    await auditSupplierScorecard(transaction, actor, tenantId, "UPDATE", scorecard.id, {
      operation: "SCORECARD_UPDATE",
      before,
      after: pick(scorecard, fields),
    });
  });
  return scorecard;
};

const deleteScorecard = async (tenantId: TenantId, id: string, actor: AuditActorInput = {}): Promise<true> => {
  const scorecard = await service.getScorecardById(tenantId, id);
  await db.transaction(async (transaction) => {
    await scorecard.destroy({ transaction });
    await auditSupplierScorecard(transaction, actor, tenantId, "DELETE", scorecard.id, {
      operation: "SCORECARD_DELETE",
      before: pick(scorecard, ["vendorId", "status"]),
    });
  });
  return true;
};

const service = {
  createScorecard,
  getScorecards,
  getScorecardById,
  updateScorecard,
  deleteScorecard,
};

export = service;
