/**
 * Client-facility administration (P21-09; ADR-124 Am. 2 § 3; spec
 * MEMORY/specs/P19-04-client-facilities.md § 4.4 – § 4.6, § 13, § 16).
 *
 * The provider's (unbound) administration of the facilities it serves: list, read, create, edit,
 * the status lifecycle (active / inactive / ended, every 409 of § 4.4 with its explanation),
 * delete of a facility nothing references, the bound users of a facility — and the bound user's
 * own facility (`GET /client-facilities/mine`, S-8). The self facility is made by
 * clientFacility.service#createSelfFacility in every tenant-creation path.
 *
 * Every mutation writes its audit row inside its transaction (§ 16); contact fields are personal
 * data (UU PDP) — an audit row records that they changed, never their values. Every read is in
 * the caller's context: another tenant's facility is a 404, indistinguishable from a missing one.
 * Leaving `active` revokes the bound users' sessions in the same transaction (AM-1); their sockets
 * close on the next re-check (config/socket, AM-20).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { Op, UniqueConstraintError, type Transaction, type WhereOptions } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import sessionService from "./session.service";
import { AppError } from "../utils/appError.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { tenantStorage } from "../middlewares/tenantContext.middleware";
import type {
  ClientFacilityCreateInput,
  ClientFacilityListQueryInput,
  ClientFacilityStatusChangeInput,
  ClientFacilityUpdateInput,
} from "@callibrator/contracts/clientFacilities";
import type { ClientFacilityStatus } from "@callibrator/contracts/states";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

type FacilityRow = ModelInstance<"ClientFacility">;

/** The fields every answer may carry — never `legacyId`, `logoStorageKey` or `tenantId`. */
export interface ClientFacilityView {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly kind: string;
  readonly isSelf: boolean;
  readonly status: ClientFacilityStatus;
  readonly statusReason: string | null;
  readonly statusChangedAt: Date | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly province: string | null;
  readonly postalCode: string | null;
  readonly phone: string | null;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The bound user's own facility (S-8): what the app shell shows. */
export interface ClientFacilityMine {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly kind: string;
  readonly isSelf: boolean;
  readonly status: ClientFacilityStatus;
}

/** The personal-data fields: audited as "changed", never by value. */
const CONTACT_FIELDS = ["contactName", "contactEmail", "contactPhone"] as const;
/** The organisational fields an edit may change, in order. */
const DETAIL_FIELDS = ["name", "code", "kind", "address", "city", "province", "postalCode", "phone"] as const;

const NOT_FOUND = "Client facility not found";

/** The view of a row. */
export const facilityView = (row: FacilityRow): ClientFacilityView => ({
  id: row.id,
  name: row.name,
  code: row.code,
  kind: row.kind,
  isSelf: row.isSelf,
  status: row.status,
  statusReason: row.statusReason ?? null,
  statusChangedAt: row.statusChangedAt ?? null,
  address: row.address ?? null,
  city: row.city ?? null,
  province: row.province ?? null,
  postalCode: row.postalCode ?? null,
  phone: row.phone ?? null,
  contactName: row.contactName ?? null,
  contactEmail: row.contactEmail ?? null,
  contactPhone: row.contactPhone ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** The value LIKE matches literally (`%`, `_` and `\` escaped). */
const likeLiteral = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

/** The facility `id` of the caller's tenant, or the 404. */
const loadFacility = async (tenantId: TenantId, id: string, transaction?: Transaction): Promise<FacilityRow> => {
  const row = await models.ClientFacility.findOne({
    where: { id, tenantId },
    ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!row) {
    throw new AppError(404, NOT_FOUND);
  }
  return row;
};

/**
 * The 409 when another facility of the tenant already uses the code or (case- and
 * space-insensitively, as 0117's index) the name — never another tenant's (no oracle).
 */
const assertUnique = async (
  tenantId: TenantId,
  { name, code }: { name?: string | undefined; code?: string | undefined },
  excludeId: string | null,
  transaction: Transaction,
): Promise<void> => {
  const or: WhereOptions[] = [];
  if (code) {
    or.push({ code });
  }
  if (name) {
    or.push({ name: { [Op.iLike]: likeLiteral(name) } });
  }
  if (or.length === 0) {
    return;
  }
  const clash = await models.ClientFacility.findOne({
    where: { tenantId, [Op.or]: or, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
    attributes: ["id"],
    transaction,
  });
  if (clash) {
    throw new AppError(409, "A facility with this code or name already exists.");
  }
};

/** A unique-index race after the pre-check: the same 409. */
const duplicateOr = (error: unknown): unknown =>
  error instanceof UniqueConstraintError ? new AppError(409, "A facility with this code or name already exists.") : error;

/** The audit entry's actor fields. */
const actorOf = (actor: AuditActorInput): ReturnType<typeof auditEntryActor> => auditEntryActor(actor);

/** Which contact fields an input names (audited as changed, not by value). */
const contactsChanged = (input: Readonly<Record<string, unknown>>): string[] => CONTACT_FIELDS.filter((f) => f in input);

/** The organisational fields of `row` an input names, as an audit before/after. */
const detailsOf = (source: Readonly<Record<string, unknown>>, input: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(DETAIL_FIELDS.filter((f) => f in input).map((f) => [f, source[f] ?? null]));

// ------------------------------------------------------------------
// READS
// ------------------------------------------------------------------

/**
 * `GET /client-facilities/mine` (S-8): the caller's own facility, or null for an unbound caller.
 * In a bound context the readable rule (`id = own`) is the only row the hooks return.
 *
 * @returns the facility, or null
 */
export const getMine = async (): Promise<ClientFacilityMine | null> => {
  const ctx = tenantStorage.getStore();
  if (!ctx?.facilityBound || !ctx.clientFacilityId) {
    return null;
  }
  const row = await models.ClientFacility.findOne({
    where: { id: ctx.clientFacilityId },
    attributes: ["id", "name", "code", "kind", "isSelf", "status"],
  });
  return row ? { id: row.id, name: row.name, code: row.code, kind: row.kind, isSelf: row.isSelf, status: row.status } : null;
};

/**
 * `GET /client-facilities`: a page of the tenant's facilities. Rows in `data`, paging in `meta`.
 *
 * @param tenantId - the caller's tenant
 * @param query - the validated list query
 * @returns rows and meta
 */
export const listFacilities = async (
  tenantId: TenantId,
  query: ClientFacilityListQueryInput,
): Promise<{ rows: ClientFacilityView[]; meta: { total: number; page: number; limit: number; totalPages: number } }> => {
  const where: Record<string | symbol, unknown> = { tenantId };
  if (query.status) {
    where["status"] = query.status;
  }
  if (query.kind) {
    where["kind"] = query.kind;
  }
  if (query.q) {
    const like = `%${likeLiteral(query.q)}%`;
    where[Op.or] = [{ name: { [Op.iLike]: like } }, { code: { [Op.iLike]: like } }];
  }
  const { rows, count } = await models.ClientFacility.findAndCountAll({
    where: where as WhereOptions,
    order: [[query.sort, query.sort === "createdAt" ? "DESC" : "ASC"], ["id", "ASC"]],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });
  return {
    rows: rows.map(facilityView),
    meta: { total: count, page: query.page, limit: query.limit, totalPages: Math.ceil(count / query.limit) },
  };
};

/**
 * `GET /client-facilities/:clientFacilityId`.
 *
 * @param tenantId - the caller's tenant
 * @param id - the facility
 * @returns the facility (404 for another tenant's or a missing one)
 */
export const getFacility = async (tenantId: TenantId, id: string): Promise<ClientFacilityView> =>
  facilityView(await loadFacility(tenantId, id));

/**
 * `GET /client-facilities/options`: the pickers' and the provider filter's short list.
 *
 * @param tenantId - the caller's tenant
 * @returns `{ id, name, code, status, isSelf }`, by name
 */
export const facilityOptions = async (
  tenantId: TenantId,
): Promise<{ id: string; name: string; code: string; status: ClientFacilityStatus; isSelf: boolean }[]> => {
  const rows = await models.ClientFacility.findAll({
    where: { tenantId },
    attributes: ["id", "name", "code", "status", "isSelf"],
    order: [["name", "ASC"], ["id", "ASC"]],
  });
  return rows.map((r) => ({ id: r.id, name: r.name, code: r.code, status: r.status, isSelf: r.isSelf }));
};

/**
 * `GET /client-facilities/:clientFacilityId/users`: the facility's bound users.
 *
 * @param tenantId - the caller's tenant
 * @param id - the facility
 * @returns the users (id, names, role, status), by name
 */
export const facilityUsers = async (
  tenantId: TenantId,
  id: string,
): Promise<{ id: string; username: string; firstName: string | null; lastName: string | null; roleId: string | null; status: string | null }[]> => {
  await loadFacility(tenantId, id);
  const users = await models.User.findAll({
    where: { tenantId, clientFacilityId: id },
    attributes: ["id", "username", "firstName", "lastName", "roleId", "status"],
    order: [["firstName", "ASC"], ["id", "ASC"]],
  });
  return users.map((u) => ({
    id: u.id,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    roleId: u.roleId,
    status: u.status,
  }));
};

// ------------------------------------------------------------------
// WRITES
// ------------------------------------------------------------------

/**
 * `POST /client-facilities`: a new client facility of the caller's tenant (never a self one —
 * `isSelf`, `status` and `tenantId` are not in the contract).
 *
 * @param tenantId - the caller's tenant
 * @param input - the validated body
 * @param actor - who creates it
 * @returns the facility
 */
export const createFacility = async (
  tenantId: TenantId,
  input: ClientFacilityCreateInput,
  actor: AuditActorInput,
): Promise<ClientFacilityView> => {
  try {
    return await db.transaction(async (transaction) => {
      await assertUnique(tenantId, input, null, transaction);
      const row = await models.ClientFacility.create(
        { ...input, tenantId, isSelf: false, status: "active", createdBy: (actor.userId ?? null) as UserId | null },
        { transaction },
      );
      await auditService.logAction(
        {
          tenantId,
          ...actorOf(actor),
          action: "CREATE",
          resourceType: "ClientFacility",
          resourceId: row.id,
          clientFacilityId: row.id,
          changes: {
            operation: "CREATE_CLIENT_FACILITY",
            before: {},
            after: { name: row.name, code: row.code, kind: row.kind, status: row.status },
            contactFieldsChanged: contactsChanged(input),
          },
        },
        { transaction },
      );
      return facilityView(row);
    });
  } catch (error) {
    throw duplicateOr(error);
  }
};

/**
 * `PATCH /client-facilities/:clientFacilityId`: its organisational and contact fields (the self
 * facility's name, kind and address are editable too; its code is `SELF`, fixed).
 *
 * @param tenantId - the caller's tenant
 * @param id - the facility
 * @param input - the validated body (at least one field)
 * @param actor - who edits it
 * @returns the facility
 */
export const updateFacility = async (
  tenantId: TenantId,
  id: string,
  input: ClientFacilityUpdateInput,
  actor: AuditActorInput,
): Promise<ClientFacilityView> => {
  try {
    return await db.transaction(async (transaction) => {
      const row = await loadFacility(tenantId, id, transaction);
      if (row.isSelf && input.code !== undefined && input.code !== row.code) {
        throw new AppError(409, "The tenant's own facility keeps its code SELF.");
      }
      await assertUnique(tenantId, input, row.id, transaction);
      const before = detailsOf(row.get({ plain: true }), input);
      // exactOptionalPropertyTypes: only the fields the body names reach the UPDATE.
      const changes = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
      await row.update({ ...changes, updatedBy: (actor.userId ?? null) as UserId | null }, { transaction });
      await auditService.logAction(
        {
          tenantId,
          ...actorOf(actor),
          action: "UPDATE",
          resourceType: "ClientFacility",
          resourceId: row.id,
          clientFacilityId: row.id,
          changes: {
            operation: "UPDATE_CLIENT_FACILITY",
            before,
            after: detailsOf(row.get({ plain: true }), input),
            contactFieldsChanged: contactsChanged(input),
          },
        },
        { transaction },
      );
      return facilityView(row);
    });
  } catch (error) {
    throw duplicateOr(error);
  }
};

/** Who changes a status: its audit actor, and whether it is a tenant administrator (`ended → active`). */
export interface StatusActor extends AuditActorInput {
  readonly tenantAdmin: boolean;
}

/**
 * The 409 (or 403) a status change meets, or null (spec § 4.4, row by row).
 *
 * @param row - the facility
 * @param to - the requested status
 * @param tenantAdmin - whether the actor passes `rbac([TENANT_ADMIN])`
 * @returns the refusal, or null
 */
export const statusRefusal = (row: Pick<FacilityRow, "isSelf" | "status">, to: ClientFacilityStatus, tenantAdmin: boolean): AppError | null => {
  if (row.isSelf) {
    return new AppError(409, "The tenant's own facility cannot be deactivated or ended — it holds the tenant's own devices.");
  }
  if (row.status === to) {
    return new AppError(409, `This facility is already ${to}.`);
  }
  if (row.status === "ended" && to === "inactive") {
    return new AppError(409, "An ended facility can only be reinstated to active.");
  }
  if (row.status === "ended" && to === "active" && !tenantAdmin) {
    return new AppError(403, "Only a tenant administrator can reinstate an ended facility.");
  }
  return null;
};

/**
 * `POST /client-facilities/:clientFacilityId/status` (§ 4.4): one transaction — the status, its
 * reason and who changed it; when it LEAVES `active`, every session of the facility's bound users
 * is revoked (AM-1; their liveness cache clears after commit); one audit row with the count.
 *
 * @param tenantId - the caller's tenant
 * @param id - the facility
 * @param input - `{ status, reason }`
 * @param actor - who changes it
 * @returns the facility and how many sessions were revoked
 */
export const changeFacilityStatus = async (
  tenantId: TenantId,
  id: string,
  input: ClientFacilityStatusChangeInput,
  actor: StatusActor,
): Promise<{ facility: ClientFacilityView; sessionsRevoked: number }> =>
  db.transaction(async (transaction) => {
    const row = await loadFacility(tenantId, id, transaction);
    const refusal = statusRefusal(row, input.status, actor.tenantAdmin);
    if (refusal) {
      throw refusal;
    }
    const from = row.status;
    await row.update(
      {
        status: input.status,
        statusReason: input.reason,
        statusChangedAt: new Date(),
        statusChangedBy: (actor.userId ?? null) as UserId | null,
        updatedBy: (actor.userId ?? null) as UserId | null,
      },
      { transaction },
    );
    let sessionsRevoked = 0;
    if (from === "active") {
      const bound = await models.User.findAll({ where: { tenantId, clientFacilityId: row.id }, attributes: ["id"], paranoid: false, transaction });
      for (const user of bound) {
        sessionsRevoked += await sessionService.revokeOtherSessions(user.id, null, "FACILITY_STATUS_CHANGED", { transaction });
      }
    }
    await auditService.logAction(
      {
        tenantId,
        ...actorOf(actor),
        action: "UPDATE",
        resourceType: "ClientFacility",
        resourceId: row.id,
        clientFacilityId: row.id,
        changes: { operation: "CHANGE_CLIENT_FACILITY_STATUS", from, to: input.status, reason: input.reason, sessionsRevoked },
      },
      { transaction },
    );
    return { facility: facilityView(row), sessionsRevoked };
  });

/**
 * `DELETE /client-facilities/:clientFacilityId` (§ 4.6): only a facility created by mistake — not
 * the self facility, and nothing may reference it (devices, deleted ones too; users, bound or
 * formerly; rooms; moves). Otherwise 409 with the counts read in the provider's own context.
 *
 * @param tenantId - the caller's tenant
 * @param id - the facility
 * @param actor - who deletes it
 */
export const deleteFacility = async (tenantId: TenantId, id: string, actor: AuditActorInput): Promise<void> =>
  db.transaction(async (transaction) => {
    const row = await loadFacility(tenantId, id, transaction);
    if (row.isSelf) {
      throw new AppError(409, "The tenant's own facility cannot be deleted.");
    }
    const where = { tenantId, clientFacilityId: row.id };
    const devices = await models.CalibrationDevice.unscoped().count({ where, paranoid: false, transaction });
    const users = await models.User.unscoped().count({ where, paranoid: false, transaction });
    const rooms = await models.Warehouse.unscoped().count({ where, paranoid: false, transaction });
    const moves = await models.ClientFacilityMove.count({
      where: { tenantId, [Op.or]: [{ fromClientFacilityId: row.id }, { toClientFacilityId: row.id }] },
      transaction,
    });
    if (devices + users + rooms + moves > 0) {
      throw new AppError(
        409,
        `This facility holds ${String(devices)} devices and ${String(users)} users; end it instead — its history is kept.`,
      );
    }
    await row.destroy({ transaction });
    await auditService.logAction(
      {
        tenantId,
        ...actorOf(actor),
        action: "DELETE",
        resourceType: "ClientFacility",
        resourceId: row.id,
        clientFacilityId: row.id,
        changes: { operation: "DELETE_CLIENT_FACILITY", name: row.name, code: row.code },
      },
      { transaction },
    );
  });
