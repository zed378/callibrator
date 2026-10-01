// P9-16 (ADR-087, Stage C leaves): converted from sop.service.js with no
// behaviour change. `export =` keeps the exact object `require()` returned (the
// same keys, in the same order). The three models, `db` and `AppError` are
// captured once at load, as the `.js` destructured them; `auditService` is the
// module object, read at call time.
import { Op, type CreationAttributes, type Transaction, type WhereOptions } from "sequelize";
import models from "../models";
// NOT `db` from the models barrel (that export is the registry's own handle) —
// the config module is what exports the Sequelize instance.
import { db as loadedDb } from "../config";
import auditService from "./audit.service";
import { actorChanges, auditEntryActor } from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import { AppError as LoadedAppError } from "../utils/appError.util";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const {
  SopDocument,
  SopTrainingAcknowledgment,
  User,
} = models;
const db = loadedDb;
const AppError = LoadedAppError;

type SopDocumentRow = ModelInstance<"SopDocument">;
type AcknowledgmentRow = ModelInstance<"SopTrainingAcknowledgment">;
type UserRow = ModelInstance<"User">;

/** A new SOP, as the validator shaped it. */
interface CreateDocumentInput {
  title: SopDocumentRow["title"];
  version?: SopDocumentRow["version"] | null;
  contentUrl?: SopDocumentRow["contentUrl"];
  requiresTraining?: boolean | null;
}

/** One page of documents. */
interface DocumentPage {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  documents: SopDocumentRow[];
}

// A-28. Statuses from which an SOP can be released. PUBLISHED and ARCHIVED are
// terminal for this action and are reported as 409 state explanations.
const PUBLISHABLE_STATES = ["DRAFT", "UNDER_REVIEW"];

/** D-24 (ADR-070): users read, and acknowledgements inserted, this many at a time. */
const TRAINING_FANOUT_BATCH = 500;

/**
 * D-24 (ADR-070) — assign a published SOP's training to every user of the
 * tenant, a batch at a time. It used to read every user of the tenant into
 * memory and insert one acknowledgement per user in ONE statement — a
 * statement whose size, and whose bind-parameter count (PostgreSQL's limit is
 * 65,535), grew with the tenant. Now: keyset pages by id (stable while rows
 * are added), only the id selected, one bulkCreate per page, all inside the
 * publish's transaction — so the release is still all or nothing.
 *
 * @param tenantId - the tenant
 * @param documentId - the published SOP
 * @param transaction - the publish's transaction
 * @returns how many acknowledgements were assigned
 */
const assignTraining = async (tenantId: TenantId, documentId: string, transaction: Transaction): Promise<number> => {
  let assigned = 0;
  let afterId: string | null = null;
  for (;;) {
    const users: UserRow[] = await User.findAll({
      where: afterId ? { tenantId, id: { [Op.gt]: afterId } } : { tenantId },
      attributes: ["id"],
      order: [["id", "ASC"]],
      limit: TRAINING_FANOUT_BATCH,
      transaction,
    });
    if (users.length > 0) {
      await SopTrainingAcknowledgment.bulkCreate(
        users.map((user) => ({ tenantId, documentId, userId: user.id, status: "PENDING" })),
        { transaction },
      );
      assigned += users.length;
    }
    if (users.length < TRAINING_FANOUT_BATCH) {
      return assigned;
    }
    // users.length === TRAINING_FANOUT_BATCH here, so the last row exists.
    afterId = (users[users.length - 1] as UserRow).id;
  }
};

/**
 * P6-11 (2026-09-30): a controlled document exists from its DRAFT onwards
 * (ISO 13485 4.2.4), so its creation commits with one audit row in its
 * transaction. `actor` is auditPrincipal(req); without one, the author.
 */
const createDocument = async (
  tenantId: TenantId,
  authorId: UserId,
  data: CreateDocumentInput,
  actor: AuditActorInput | null = { userId: authorId },
): Promise<SopDocumentRow> => {
  const { title, version, contentUrl, requiresTraining } = data;

  const docCount = await SopDocument.count({ where: { tenantId } });
  const documentNumber = `SOP-${String(docCount + 1).padStart(4, "0")}`;

  const values = {
    tenantId,
    authorId,
    documentNumber,
    title,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty version also reads as 1.0
    version: version || "1.0",
    contentUrl,
    requiresTraining: requiresTraining !== undefined ? requiresTraining : true,
    status: "DRAFT",
  };
  // As built: an absent contentUrl is passed as `undefined`, and requiresTraining as the caller sent it.
  return db.transaction(async (transaction: Transaction) => {
    const doc = await SopDocument.create(values as CreationAttributes<SopDocumentRow>, { transaction });
    await auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(actor),
        action: "CREATE",
        resourceType: "SopDocument",
        resourceId: doc.id,
        changes: {
          operation: "SOP_CREATE",
          after: {
            documentNumber: doc.documentNumber,
            title: doc.title,
            version: doc.version,
            status: doc.status,
            requiresTraining: doc.requiresTraining,
          },
          authorId,
          ...actorChanges(actor),
        },
      },
      { transaction },
    );
    return doc;
  });
};

const getDocuments = async (
  tenantId: TenantId,
  page: number | string = 1,
  limit: number | string = 10,
  status?: string | null,
): Promise<DocumentPage> => {
  // As built: a page or limit from the query string is used with JavaScript's own coercion.
  const offset = ((page as number) - 1) * (limit as number);
  const where: { tenantId: TenantId; status?: string } = { tenantId };
  if (status) {where.status = status;}

  const { count, rows } = await SopDocument.findAndCountAll({
    where: where as WhereOptions,
    limit: limit as number,
    offset,
    include: [
      // LEFT JOIN (A-90): User's defaultScope makes this INNER otherwise, and a
      // document whose author was deleted, or is outside the tenant (the super
      // admin authoring inside it), vanished from the list.
      { model: User, as: "author", attributes: ["id", "firstName", "lastName"], required: false },
    ],
    order: [["createdAt", "DESC"]],
  });

  return {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / (limit as number)),
    documents: rows,
  };
};

/**
 * Release a controlled procedure.
 *
 * A-28 — separation of duties. Until 2026-09-23 this set PUBLISHED with no
 * approver at all, and the only comment on the fan-out read "in a real app,
 * this might be filtered by role". An author could therefore write AND release
 * their own SOP, which ISO 13485 §4.2.4 document control and 21 CFR 11.10(d)
 * both forbid. The publisher must now be someone other than the author. That
 * refusal is a 403 with the explanation (V-13, ADR-109 §7, as ADR-101 for a
 * certificate): it is about the CALLER, not the document — the same document
 * in the same state is publishable by the next person. An already-published
 * or archived SOP is a state conflict and stays a 409.
 *
 * The status change, the training fan-out and the audit row are written in one
 * transaction: a release recorded without its audit row is unattributable, and
 * an audit row that outlives a rolled-back release records a release that
 * never happened.
 *
 * @param tenantId - the tenant
 * @param documentId - the SOP
 * @param publisherId - the authenticated caller releasing the SOP
 * @returns the published document
 */
const publishDocument = async (tenantId: TenantId, documentId: string, publisherId: UserId): Promise<SopDocumentRow> => {
  const doc = await SopDocument.findOne({ where: { id: documentId, tenantId } });
  if (!doc) {throw new AppError(404, "Document not found");}

  if (!PUBLISHABLE_STATES.includes(doc.status)) {
    throw new AppError(
      409,
      `SOP ${doc.documentNumber} is ${doc.status} and cannot be published. Only a DRAFT or UNDER_REVIEW document can be released; raise a new revision instead.`,
    );
  }

  if (String(doc.authorId) === String(publisherId)) {
    // V-13 (ADR-109 §7): a permission failure inside the tenant — 403, not 409.
    throw new AppError(
      403,
      `SOP ${doc.documentNumber} was authored by you and is still ${doc.status}. A controlled procedure must be released by someone other than its author — ask a second authorised user to publish it.`,
    );
  }

  const previousStatus = doc.status;

  await db.transaction(async (transaction: Transaction) => {
    doc.status = "PUBLISHED";
    doc.publishedDate = new Date();
    await doc.save({ transaction });

    if (doc.requiresTraining) {
      // Fan the acknowledgment out to every user in the tenant. Narrowing this
      // by role or department is an open question, not a judgement call: see
      // A-28 in TASKS/AUDIT-2026-09-REMEDIATION.md. D-24: in batches.
      await assignTraining(tenantId, doc.id, transaction);
    }

    await auditService.logAction(
      {
        tenantId,
        userId: publisherId,
        action: "APPROVE",
        resourceType: "SopDocument",
        resourceId: doc.id,
        changes: {
          before: { status: previousStatus },
          after: { status: "PUBLISHED", publishedDate: doc.publishedDate },
          documentNumber: doc.documentNumber,
          version: doc.version,
          authorId: doc.authorId,
        },
      },
      { transaction },
    );
  });

  return doc;
};

/**
 * Record that the caller has read an SOP — their ISO 13485 §6.2 training
 * record for that revision.
 *
 * A-145 — the acknowledgement and its audit row commit together, and a
 * completed acknowledgement is never rewritten. Until 2026-09-24 this saved
 * the row with no audit entry at all (an unattributable training record), and
 * a second click silently moved `acknowledgedAt` to "now" — the date the
 * training record attests could be changed after the fact. A repeat is now a
 * 409 that names the recorded date.
 *
 * The route carries denyPlatformAuthoring (ADR-051 Q-17): only the member
 * themselves may attest their own training.
 *
 * @param tenantId - the tenant
 * @param userId - the caller; only their own acknowledgement is found
 * @param documentId - the SOP
 * @returns the completed acknowledgement
 * @throws {AppError} 404 when no training is assigned to the caller for this
 *   document in this tenant (another tenant's document reads the same); 409
 *   when it was already acknowledged
 */
const acknowledgeTraining = async (tenantId: TenantId, userId: UserId, documentId: string): Promise<AcknowledgmentRow> => {
  const ack = await SopTrainingAcknowledgment.findOne({
    where: { tenantId, userId, documentId },
  });

  if (!ack) {
    throw new AppError(404, "Training acknowledgment not found");
  }

  if (ack.status === "COMPLETED") {
    const when = ack.acknowledgedAt ? new Date(ack.acknowledgedAt).toISOString() : "an earlier date";
    throw new AppError(
      409,
      `You already acknowledged this SOP on ${when}. A training record is not overwritten; if the procedure changed, a new revision must be published and acknowledged.`,
    );
  }

  // F-19 (ADR-105 Amendment 1): an ARCHIVED SOP is no longer in force, so a
  // training acknowledgement left pending from before it was archived no
  // longer applies — a state, not a permission, so a 409 that says so.
  const document = await SopDocument.findOne({ where: { id: documentId, tenantId } });
  if (document?.status === "ARCHIVED") {
    throw new AppError(409, "This SOP is archived and no longer requires acknowledgement.");
  }

  const previousStatus = ack.status;

  await db.transaction(async (transaction: Transaction) => {
    ack.status = "COMPLETED";
    ack.acknowledgedAt = new Date();
    await ack.save({ transaction });

    await auditService.logAction(
      {
        tenantId,
        userId,
        // No ENUM member of its own: the nearest action, with the operation
        // named in `changes` (constants/auditActions.js).
        action: "UPDATE",
        resourceType: "SopTrainingAcknowledgment",
        resourceId: ack.id,
        changes: {
          operation: "ACKNOWLEDGE_TRAINING",
          documentId,
          before: { status: previousStatus },
          after: { status: "COMPLETED", acknowledgedAt: ack.acknowledgedAt },
        },
      },
      { transaction },
    );
  });

  return ack;
};

export = {
  createDocument,
  getDocuments,
  TRAINING_FANOUT_BATCH,
  publishDocument,
  acknowledgeTraining,
};
