/**
 * Catalogue proposals — how a tenant asks the platform operator for a change (P21-01; ADR-125 § 5,
 * Am. 1 § 11; spec MEMORY/specs/P19-01-inspection-catalogue.md § 4.6, § 7.4, § 10).
 *
 * TENANT SIDE. A provider's administrator (`ipm-templates` write, unbound — the routes are not
 * facility-accessible) submits a proposal in ITS OWN tenant and may withdraw it while it is
 * `submitted`. The model is tenant-scoped by the hooks: another tenant's proposal is the 404 a
 * missing one is, and a facility-bound principal is denied by the hooks as well as the route.
 *
 * OPERATOR SIDE (the admin router, super admin — who skips the tenant hooks by design): the queue
 * across tenants, accept and reject. Accepting COPIES NOTHING from the proposal into the global
 * tables (§ 7.4): it opens (or links) a draft on the type's template, and the operator adds each
 * item to that draft explicitly — the "strip identifying text" review of ADR-125 § 5 is enforced by
 * construction. The decision's audit row is written in the PROPOSAL's tenant (the tenant reads its
 * own trail) and the submitter gets an in-app notification, both inside the decision's transaction.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { Transaction, WhereOptions } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import notificationService from "./notification.service";
import { openOrLinkDraft } from "./inspectionTemplate.service";
import { AppError } from "../utils/appError.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import type {
  AcceptProposalInput,
  CreateProposalInput,
  ListProposalsQueryInput,
  RejectProposalInput,
} from "@callibrator/contracts/inspectionCatalogue";
import type { TemplateProposalKind } from "@callibrator/contracts/inspectionValues";
import type { TemplateProposalStatus } from "@callibrator/contracts/states";
import type { DeviceTypeId, InspectionTemplateProposalId, InspectionTemplateVersionId, TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";
import type { ProposedItems } from "../utils/jsonShape.util";
import { actorUserId, pageMeta, type Page } from "./inspectionCatalogue.shared";

type ProposalRow = ModelInstance<"InspectionTemplateProposal">;

/** A proposal as its tenant (and the operator) reads it — never the operator's identity. */
export interface ProposalView {
  readonly id: string;
  readonly kind: TemplateProposalKind;
  readonly deviceTypeId: string | null;
  readonly proposedDeviceTypeName: string | null;
  readonly basedOnVersionId: string | null;
  readonly proposedItems: unknown[];
  readonly reason: string;
  readonly status: TemplateProposalStatus;
  readonly submittedBy: string;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
  readonly resultingVersionId: string | null;
  readonly withdrawnAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The operator's queue row: the view and the tenant it came from. */
export type ProposalQueueRow = ProposalView & { readonly tenantId: string };

const NOT_FOUND = "Proposal not found";

const proposalView = (row: ProposalRow): ProposalView => ({
  id: row.id,
  kind: row.kind,
  deviceTypeId: row.deviceTypeId,
  proposedDeviceTypeName: row.proposedDeviceTypeName,
  basedOnVersionId: row.basedOnVersionId,
  proposedItems: [...row.proposedItems],
  reason: row.reason,
  status: row.status,
  submittedBy: row.submittedBy,
  decidedAt: row.decidedAt,
  decisionNote: row.decisionNote,
  resultingVersionId: row.resultingVersionId,
  withdrawnAt: row.withdrawnAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** `2026-10-09`, from a stamp the state's CHECK makes NOT NULL. */
const day = (date: Date | null): string => (date as Date).toISOString().slice(0, 10);

/** The proposal `id` (in the caller's scope — the hooks decide it), locked, or the 404. */
const loadProposal = async (id: string, transaction: Transaction): Promise<ProposalRow> => {
  const row = await models.InspectionTemplateProposal.findOne({ where: { id }, transaction, lock: transaction.LOCK.UPDATE });
  if (!row) {
    throw new AppError(404, NOT_FOUND);
  }
  return row;
};

/** One audit row in the PROPOSAL's tenant, inside `transaction`. */
const audit = async (
  transaction: Transaction,
  actor: AuditActorInput,
  row: ProposalRow,
  action: "CREATE" | "UPDATE" | "APPROVE",
  operation: string,
  extra: Readonly<Record<string, unknown>>,
): Promise<void> => {
  await auditService.logAction(
    {
      tenantId: row.tenantId,
      ...auditEntryActor(actor),
      action,
      resourceType: "InspectionTemplateProposal",
      resourceId: row.id,
      changes: { operation, kind: row.kind, deviceTypeId: row.deviceTypeId, status: row.status, ...extra },
    },
    { transaction },
  );
};

/** A page of proposals in the caller's scope. */
const pageOf = async (query: ListProposalsQueryInput, order: "ASC" | "DESC"): Promise<{ rows: ProposalRow[]; count: number }> =>
  models.InspectionTemplateProposal.findAndCountAll({
    where: (query.status ? { status: query.status } : {}) as WhereOptions,
    order: [["createdAt", order], ["id", "ASC"]],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

// ------------------------------------------------------------------
// TENANT SIDE
// ------------------------------------------------------------------

/**
 * `GET /ipm/template-proposals`: the caller's tenant's proposals, newest first (the hooks scope
 * the read to the tenant).
 *
 * @param query - the validated query
 * @returns rows and meta
 */
export const listProposals = async (query: ListProposalsQueryInput): Promise<Page<ProposalView>> => {
  const { rows, count } = await pageOf(query, "DESC");
  return { rows: rows.map(proposalView), meta: pageMeta(count, query.page, query.limit) };
};

/**
 * `GET /ipm/template-proposals/:proposalId` — another tenant's is a 404.
 *
 * @param id - the proposal
 * @returns it
 */
export const getProposal = async (id: InspectionTemplateProposalId): Promise<ProposalView> => {
  const row = await models.InspectionTemplateProposal.findOne({ where: { id } });
  if (!row) {
    throw new AppError(404, NOT_FOUND);
  }
  return proposalView(row);
};

/**
 * `POST /ipm/template-proposals`: submit a proposal in the caller's tenant (never the body's).
 *
 * @param tenantId - the caller's tenant
 * @param input - the validated body
 * @param actor - the submitter
 * @returns the proposal
 */
export const createProposal = async (tenantId: TenantId, input: CreateProposalInput, actor: AuditActorInput): Promise<ProposalView> =>
  db.transaction(async (transaction) => {
    if (input.deviceTypeId) {
      const type = await models.DeviceType.findOne({ where: { id: input.deviceTypeId }, attributes: ["id"], transaction });
      if (!type) {
        throw new AppError(404, "Device type not found");
      }
    }
    if (input.basedOnVersionId) {
      const version = await models.InspectionTemplateVersion.findOne({ where: { id: input.basedOnVersionId }, attributes: ["id", "status"], transaction });
      if (!version || version.status === "draft" || version.status === "discarded") {
        throw new AppError(404, "Checklist version not found");
      }
    }
    const row = await models.InspectionTemplateProposal.create(
      {
        tenantId,
        kind: input.kind,
        deviceTypeId: (input.deviceTypeId ?? null) as DeviceTypeId | null,
        proposedDeviceTypeName: input.proposedDeviceTypeName ?? null,
        basedOnVersionId: (input.basedOnVersionId ?? null) as InspectionTemplateVersionId | null,
        // As JSON stores it: an absent optional field is absent, not `undefined`.
        proposedItems: JSON.parse(JSON.stringify(input.proposedItems)) as ProposedItems,
        reason: input.reason,
        status: "submitted",
        submittedBy: actorUserId(actor) as UserId,
      },
      { transaction },
    );
    await audit(transaction, actor, row, "CREATE", "SUBMIT_PROPOSAL", { itemCount: input.proposedItems.length });
    return proposalView(row);
  });

/**
 * `POST /ipm/template-proposals/:proposalId/withdraw` — a `submitted` proposal of the caller's
 * tenant only.
 *
 * @param id - the proposal
 * @param actor - who withdraws it
 * @returns the proposal
 */
export const withdrawProposal = async (id: InspectionTemplateProposalId, actor: AuditActorInput): Promise<ProposalView> =>
  db.transaction(async (transaction) => {
    const row = await loadProposal(id, transaction);
    if (row.status !== "submitted") {
      const when = row.status === "withdrawn" ? row.withdrawnAt : row.decidedAt;
      throw new AppError(409, `This proposal was ${row.status} on ${day(when)}; it can no longer be withdrawn.`);
    }
    await row.update({ status: "withdrawn", withdrawnAt: new Date(), withdrawnBy: actorUserId(actor) }, { transaction });
    await audit(transaction, actor, row, "UPDATE", "WITHDRAW_PROPOSAL", {});
    return proposalView(row);
  });

// ------------------------------------------------------------------
// OPERATOR SIDE (admin router)
// ------------------------------------------------------------------

/**
 * `GET /admin/ipm/template-proposals`: the operator's queue across tenants, oldest first.
 *
 * @param query - the validated query
 * @returns rows (with the tenant) and meta
 */
export const listProposalQueue = async (query: ListProposalsQueryInput): Promise<Page<ProposalQueueRow>> => {
  const { rows, count } = await pageOf(query, "ASC");
  return { rows: rows.map((r) => ({ ...proposalView(r), tenantId: r.tenantId })), meta: pageMeta(count, query.page, query.limit) };
};

/** The 409 of a proposal that is no longer `submitted`. */
const decided = (row: ProposalRow): AppError =>
  new AppError(409, `This proposal was already ${row.status} on ${day(row.status === "withdrawn" ? row.withdrawnAt : row.decidedAt)}.`);

/** Tell the submitter, inside the decision's transaction (delivered after COMMIT). */
const notifySubmitter = async (row: ProposalRow, transaction: Transaction): Promise<void> => {
  await notificationService.emitNotification(
    {
      tenantId: row.tenantId,
      userId: row.submittedBy,
      type: "SYSTEM",
      title: row.status === "accepted" ? "Checklist proposal accepted" : "Checklist proposal rejected",
      message:
        row.status === "accepted"
          ? "The platform operator accepted your checklist proposal; the change is being prepared."
          : "The platform operator rejected your checklist proposal. Open it to read the reason.",
      actionUrl: `/dashboard/ipm/template-proposals/${row.id}`,
    },
    { transaction },
  );
};

/**
 * `POST /admin/ipm/template-proposals/:proposalId/accept` (§ 7.4): opens or links a draft on the
 * type's template — for a new-type proposal, on the type the operator created and names here.
 *
 * @param input - the validated params + body
 * @param actor - the operator
 * @returns the proposal (with `resultingVersionId`)
 */
export const acceptProposal = async (input: AcceptProposalInput, actor: AuditActorInput): Promise<ProposalView> =>
  db.transaction(async (transaction) => {
    const row = await loadProposal(input.proposalId, transaction);
    if (row.status !== "submitted") {
      throw decided(row);
    }
    const deviceTypeId = row.kind === "new_device_type" ? input.deviceTypeId : row.deviceTypeId;
    if (!deviceTypeId) {
      throw new AppError(400, "Name the device type you created for this proposal (deviceTypeId).");
    }
    if (row.kind !== "new_device_type" && input.deviceTypeId !== undefined && input.deviceTypeId !== row.deviceTypeId) {
      throw new AppError(400, "This proposal is about another device type.");
    }
    const resultingVersionId = await openOrLinkDraft(deviceTypeId as DeviceTypeId, actor, transaction);
    await row.update(
      {
        status: "accepted",
        deviceTypeId: deviceTypeId as DeviceTypeId,
        decidedBy: actorUserId(actor),
        decidedAt: new Date(),
        decisionNote: input.decisionNote ?? null,
        resultingVersionId: resultingVersionId as InspectionTemplateVersionId,
      },
      { transaction },
    );
    await audit(transaction, actor, row, "APPROVE", "ACCEPT_PROPOSAL", {
      resultingVersionId,
      decisionNoteLength: input.decisionNote?.length ?? 0,
    });
    await notifySubmitter(row, transaction);
    return proposalView(row);
  });

/**
 * `POST /admin/ipm/template-proposals/:proposalId/reject` — the decision note is required.
 *
 * @param input - the validated params + body
 * @param actor - the operator
 * @returns the proposal
 */
export const rejectProposal = async (input: RejectProposalInput, actor: AuditActorInput): Promise<ProposalView> =>
  db.transaction(async (transaction) => {
    const row = await loadProposal(input.proposalId, transaction);
    if (row.status !== "submitted") {
      throw decided(row);
    }
    await row.update(
      { status: "rejected", decidedBy: actorUserId(actor), decidedAt: new Date(), decisionNote: input.decisionNote },
      { transaction },
    );
    await audit(transaction, actor, row, "UPDATE", "REJECT_PROPOSAL", { decisionNoteLength: input.decisionNote.length });
    await notifySubmitter(row, transaction);
    return proposalView(row);
  });
