/**
 * The inspection item library — operator only (P21-01; ADR-125; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 4.2, § 8.2, § 10).
 *
 * A definition is the cross-version identity of "the same check" (G-8). It is mutable while
 * active: an edit affects only drafts that copy it AFTERWARDS (drafts and versions hold copies).
 * A retired definition cannot be added to a draft (400 there); existing copies are untouched. The
 * limit is written as text and parsed here (`inspectionContentOf`, spec § 6.2); `notes` stays
 * with the operator — never copied into a version, never in an audit row's text (its length is).
 *
 * Every write records its audit row under the PLATFORM tenant inside its transaction.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { Op, type Transaction, type WhereOptions } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { AppError } from "../utils/appError.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import type { InspectionItemContent } from "@callibrator/contracts/inspectionValues";
import type {
  CreateItemDefinitionInput,
  ListItemDefinitionsQueryInput,
  UpdateItemDefinitionInput,
} from "@callibrator/contracts/inspectionCatalogue";
import type { InspectionItemDefinitionId } from "../types/ids";
import type { CatalogueLifecycleStatus } from "@callibrator/contracts/states";
import type { ModelInstance } from "../types/models";
import { actorUserId, contentOf, likeLiteral, pageMeta, storedContent, type Page } from "./inspectionCatalogue.shared";

type DefinitionRow = ModelInstance<"InspectionItemDefinition">;

/** A library definition, as the operator reads it. */
export type ItemDefinitionView = InspectionItemContent & {
  readonly id: string;
  readonly defaultRequired: boolean;
  readonly notes: string | null;
  readonly status: CatalogueLifecycleStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

const NOT_FOUND = "Item definition not found";

/** @returns the operator's view of a definition row */
const definitionView = (row: DefinitionRow): ItemDefinitionView => ({
  id: row.id,
  ...contentOf(row),
  defaultRequired: row.defaultRequired,
  notes: row.notes,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** The definition `id` (locked in `transaction`), or the 404. */
const loadDefinition = async (id: string, transaction?: Transaction): Promise<DefinitionRow> => {
  const row = await models.InspectionItemDefinition.findOne({
    where: { id },
    ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!row) {
    throw new AppError(404, NOT_FOUND);
  }
  return row;
};

/** One audit row for a definition, inside `transaction` — content before/after, `notes` by length only. */
const audit = async (
  transaction: Transaction,
  actor: AuditActorInput,
  row: DefinitionRow,
  action: "CREATE" | "UPDATE",
  operation: string,
  before: Readonly<Record<string, unknown>>,
): Promise<void> => {
  await auditService.logAction(
    {
      tenantId: PLATFORM_TENANT_ID,
      ...auditEntryActor(actor),
      action,
      resourceType: "InspectionItemDefinition",
      resourceId: row.id,
      changes: {
        operation,
        before,
        after: { ...contentOf(row), defaultRequired: row.defaultRequired, status: row.status, notesLength: row.notes?.length ?? 0 },
      },
    },
    { transaction },
  );
};

/**
 * `GET /ipm/item-definitions`: a page of the library, in section order, by label then id.
 *
 * @param query - the validated query
 * @returns rows and meta
 */
export const listItemDefinitions = async (query: ListItemDefinitionsQueryInput): Promise<Page<ItemDefinitionView>> => {
  const where: Record<string, unknown> = {};
  if (query.status !== "all") {
    where["status"] = query.status;
  }
  if (query.section) {
    where["section"] = query.section;
  }
  if (query.inputKind) {
    where["inputKind"] = query.inputKind;
  }
  if (query.search) {
    where["label"] = { [Op.iLike]: `%${likeLiteral(query.search)}%` };
  }
  const { rows, count } = await models.InspectionItemDefinition.findAndCountAll({
    where: where as WhereOptions,
    order: [["section", "ASC"], ["label", "ASC"], ["id", "ASC"]],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });
  return { rows: rows.map(definitionView), meta: pageMeta(count, query.page, query.limit) };
};

/**
 * `GET /ipm/item-definitions/:itemDefinitionId`.
 *
 * @param id - the definition
 * @returns it (404 when missing)
 */
export const getItemDefinition = async (id: InspectionItemDefinitionId): Promise<ItemDefinitionView> =>
  definitionView(await loadDefinition(id));

/**
 * `POST /ipm/item-definitions`.
 *
 * @param input - the validated body (content checked by the contract)
 * @param actor - the operator
 * @returns the new, active definition
 */
export const createItemDefinition = async (input: CreateItemDefinitionInput, actor: AuditActorInput): Promise<ItemDefinitionView> =>
  db.transaction(async (transaction) => {
    const by = actorUserId(actor);
    const row = await models.InspectionItemDefinition.create(
      {
        ...storedContent(input.content),
        defaultRequired: input.defaultRequired ?? true,
        notes: input.notes ?? null,
        status: "active",
        createdBy: by,
        updatedBy: by,
      },
      { transaction },
    );
    await audit(transaction, actor, row, "CREATE", "CREATE_ITEM_DEFINITION", {});
    return definitionView(row);
  });

/**
 * `PATCH /ipm/item-definitions/:itemDefinitionId`: its content (wholesale), its default and its
 * notes — an ACTIVE definition only. The section and input kind never change: they are part of
 * what "the same check" means across versions (G-8); a different check is a new definition.
 *
 * @param input - the validated params + body
 * @param actor - the operator
 * @returns the definition
 */
export const updateItemDefinition = async (input: UpdateItemDefinitionInput, actor: AuditActorInput): Promise<ItemDefinitionView> =>
  db.transaction(async (transaction) => {
    const row = await loadDefinition(input.itemDefinitionId, transaction);
    if (row.status !== "active") {
      throw new AppError(409, "This item definition is retired; it cannot be changed.");
    }
    if (input.content && (input.content.section !== row.section || input.content.inputKind !== row.inputKind)) {
      throw new AppError(400, "A definition keeps its section and input kind; create a new definition for a different check.");
    }
    const before = { ...contentOf(row), defaultRequired: row.defaultRequired, notesLength: row.notes?.length ?? 0 };
    await row.update(
      {
        ...(input.content ? storedContent(input.content) : {}),
        ...(input.defaultRequired === undefined ? {} : { defaultRequired: input.defaultRequired }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        updatedBy: actorUserId(actor),
      },
      { transaction },
    );
    await audit(transaction, actor, row, "UPDATE", "UPDATE_ITEM_DEFINITION", before);
    return definitionView(row);
  });

/**
 * `POST /ipm/item-definitions/:itemDefinitionId/retire`.
 *
 * @param id - the definition
 * @param actor - the operator
 * @returns the definition
 */
export const retireItemDefinition = async (id: InspectionItemDefinitionId, actor: AuditActorInput): Promise<ItemDefinitionView> =>
  db.transaction(async (transaction) => {
    const row = await loadDefinition(id, transaction);
    if (row.status === "retired") {
      throw new AppError(409, "This item definition is already retired.");
    }
    await row.update({ status: "retired", updatedBy: actorUserId(actor) }, { transaction });
    await audit(transaction, actor, row, "UPDATE", "RETIRE_ITEM_DEFINITION", { status: "active" });
    return definitionView(row);
  });
