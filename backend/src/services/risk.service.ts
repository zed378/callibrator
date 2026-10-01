/**
 * The risk register (ISO 14971-style risks: severity × likelihood, a
 * mitigation plan and an owner), audited in its transactions (A-278).
 *
 * P9-16 (ADR-087, Stage C): converted from risk.service.js with no behaviour
 * change. `export =` keeps the exact object `require()` returned (the same
 * keys, in the same order: `ASSIGNEE_NOT_FOUND` first, where the `.js`
 * assigned it). `updateRisk` and `deleteRisk` call `getRiskById` through the
 * exported object, as the `.js` did through `this` (which at a CommonJS
 * module's top level is `module.exports`), so a spy on the export still
 * intercepts it. The two models, `AppError`, `db`, `auditService` and the two
 * audit helpers are captured once at load, as the `.js` destructured them.
 */
import type { CreationAttributes, WhereOptions } from "sequelize";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { db as loadedDb } from "../config";
import loadedAuditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
  type AuditActorInput,
} from "../utils/auditPrincipal.util";
import type { Transaction } from "sequelize";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { Risk, User } = models;
const AppError = LoadedAppError;
const db = loadedDb;
const auditService = loadedAuditService;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;

type RiskRow = ModelInstance<"Risk">;

/**
 * A-278 (ADR-094) — a risk-register change commits with one audit row in its
 * transaction. The actor is a user, or an API key as `system:api-key` (A-282).
 *
 * @param transaction
 * @param actor - auditPrincipal(req)
 * @param tenantId
 * @param action
 * @param id
 * @param changes - { operation, before, after }
 */
const auditRisk = (
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
      resourceType: "Risk",
      resourceId: id,
      changes: { ...changes, ...actorChanges(actor) },
    },
    { transaction },
  );

/** The named attributes of a row, as plain values (null when absent). */
const pick = (row: object, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]));

/**
 * A-277 (ADR-094) — a risk's `assignedTo` is a user of the risk's tenant.
 * Missing, soft-deleted and another tenant's are one 404 (A-129); the
 * predicate is explicit because a super admin's context skips the hooks.
 */
const ASSIGNEE_NOT_FOUND = "Assignee not found in this organisation";

const assertAssignee = async (tenantId: TenantId, assignedTo: unknown): Promise<void> => {
  if (!assignedTo) {return;}
  const user = await User.findOne({ where: { id: assignedTo as string, tenantId }, attributes: ["id"] });
  if (!user) {
    throw new AppError(404, ASSIGNEE_NOT_FOUND);
  }
};

/** A risk as the controller passes it (validated; a JavaScript caller may pass anything). */
type RiskInput = Record<string, unknown> & { assignedTo?: unknown };

const createRisk = async (tenantId: TenantId, data: RiskInput, userId: UserId, actor: AuditActorInput = { userId }): Promise<RiskRow> => {
  await assertAssignee(tenantId, data.assignedTo);
  return db.transaction(async (transaction) => {
    const risk = await Risk.create({ ...(data as CreationAttributes<RiskRow>), tenantId, identifiedBy: userId }, { transaction });
    await auditRisk(transaction, actor, tenantId, "CREATE", risk.id, {
      operation: "RISK_CREATE",
      before: {},
      after: pick(risk, Object.keys(data)),
    });
    return risk;
  });
};

/** The list query as the controller passes it. */
interface RiskQuery {
  limit?: number | string;
  page?: number | string;
  status?: string | null;
  category?: string | null;
}

interface RiskList {
  rows: RiskRow[];
  total: number;
  page: number;
  totalPages: number;
}

const getRisks = async (tenantId: TenantId, query: RiskQuery): Promise<RiskList> => {
  const { limit = 10, page = 1, status, category } = query;
  const offset = ((page as number) - 1) * (limit as number);

  const where: Record<string, unknown> = { tenantId };
  if (status) {where["status"] = status;}
  if (category) {where["category"] = category;}

  const { count, rows } = await Risk.findAndCountAll({
    where: where as WhereOptions,
    limit: parseInt(limit as string),
    offset: parseInt(offset as unknown as string),
    order: [["createdAt", "DESC"]],
    include: [
      { model: User, as: "identifier", attributes: ["id", "firstName", "lastName", "email"], required: false },
      { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"], required: false },
    ],
  });

  return {
    rows,
    total: count,
    page: parseInt(page as string),
    totalPages: Math.ceil(count / (limit as number)),
  };
};

const getRiskById = async (tenantId: TenantId, id: string): Promise<RiskRow> => {
  const risk = await Risk.findOne({
    where: { id, tenantId },
    include: [
      { model: User, as: "identifier", attributes: ["id", "firstName", "lastName", "email"], required: false },
      { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"], required: false },
    ],
  });
  if (!risk) {throw new AppError(404, "Risk not found");}
  return risk;
};

const updateRisk = async (tenantId: TenantId, id: string, data: RiskInput, actor: AuditActorInput = {}): Promise<RiskRow> => {
  const risk = await service.getRiskById(tenantId, id);
  await assertAssignee(risk.tenantId, data.assignedTo);
  const fields = Object.keys(data);
  const before = pick(risk, fields);
  await db.transaction(async (transaction) => {
    await risk.update(data as Parameters<RiskRow["update"]>[0], { transaction });
    await auditRisk(transaction, actor, tenantId, "UPDATE", risk.id, {
      operation: "RISK_UPDATE",
      before,
      after: pick(risk, fields),
    });
  });
  return risk;
};

const deleteRisk = async (tenantId: TenantId, id: string, actor: AuditActorInput = {}): Promise<true> => {
  const risk = await service.getRiskById(tenantId, id);
  await db.transaction(async (transaction) => {
    await risk.destroy({ transaction });
    await auditRisk(transaction, actor, tenantId, "DELETE", risk.id, {
      operation: "RISK_DELETE",
      before: pick(risk, ["title", "status"]),
    });
  });
  return true;
};

const service = {
  ASSIGNEE_NOT_FOUND,
  createRisk,
  getRisks,
  getRiskById,
  updateRisk,
  deleteRisk,
};

export = service;
