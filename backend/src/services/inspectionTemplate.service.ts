/**
 * Inspection templates and their versions (P21-01; ADR-125 § 2 – § 6, Am. 1 – 3; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 4.3 – § 4.5, § 7.1 – § 7.3, § 7.6, § 8, § 10).
 *
 * THE AGGREGATE. A template (one per device type, plus the one base template) owns its versions,
 * and a version its items. Every write runs in one transaction under a row lock on the TEMPLATE
 * (`SELECT … FOR UPDATE`, taken before the version's), so two operators cannot publish, edit or
 * open drafts of one template at once. Invariants: at most one published version and one open
 * (operator) draft per template; a published or retired version never changes (the database's
 * triggers hold it for every role — this service's own 409 fires first); a type version embeds
 * exactly the base items it was published with.
 *
 * PUBLISH (§ 7.2). A draft's own items are checked (`inspectionContentProblems`), a TYPE draft gets
 * the base's published items materialised into it (`origin = base`), the template's previous
 * published version is retired, the version number is max + 1, the content hash is SHA-256 of the
 * contract's canonical text (`canonicalTemplateVersion`), and one APPROVE audit row is written —
 * all in the transaction. Publishing the BASE rebases every active type template that has a
 * published version (§ 7.3): a new published version of its type items + the new base items, the
 * old one retired, one audit row each. A rebase version is inserted as a draft carrying
 * `rebased_from_version_id` and published in the same transaction: migration 0125 leaves such a
 * row out of the one-open-draft index, so a type template's operator draft is untouched
 * (ADR-125 Am. 3).
 *
 * READS. Published and retired versions are catalogue content (any catalogue reader); drafts and
 * discarded drafts are the operator's — a 404 to anyone else, indistinguishable from a missing id.
 * The published catalogue document (§ 8.3) carries the active device types and every published
 * version with its items; its strong ETag covers both, computed before the document is loaded.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { createHash } from "node:crypto";
import { Op, type Transaction, type WhereOptions } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { AppError } from "../utils/appError.util";
import { auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import {
  INSPECTION_SECTIONS,
  TEMPLATE_ITEM_ORIGINS,
  canonicalTemplateVersion,
  inspectionContentProblems,
  type CanonicalTemplateItemInput,
} from "@callibrator/contracts/inspectionValues";
import type {
  CreateDraftInput,
  ListTemplatesQueryInput,
  ListVersionsQueryInput,
  PublishVersionInput,
  ReplaceDraftItemsInput,
  UpdateDraftInput,
} from "@callibrator/contracts/inspectionCatalogue";
import { MAX_SECTION_ITEMS } from "@callibrator/contracts/inspectionCatalogue";
import type { CatalogueLifecycleStatus } from "@callibrator/contracts/states";
import type { DeviceTypeId, InspectionTemplateId, InspectionTemplateVersionId } from "../types/ids";
import type { ModelInstance } from "../types/models";
import {
  actorUserId,
  conflictOr,
  contentOf,
  pageMeta,
  storedContent,
  templateItemView,
  versionSummary,
  type Page,
  type StoredContent,
  type TemplateItemView,
  type TemplateVersionSummary,
  type TemplateVersionView,
} from "./inspectionCatalogue.shared";

type TemplateRow = ModelInstance<"InspectionTemplate">;
type VersionRow = ModelInstance<"InspectionTemplateVersion">;
type ItemRow = ModelInstance<"InspectionTemplateItem">;

const TEMPLATE_NOT_FOUND = "Checklist template not found";
const VERSION_NOT_FOUND = "Checklist version not found";

/** One template in the operator's list. */
export interface TemplateListRow {
  readonly id: string;
  readonly deviceTypeId: string | null;
  readonly deviceTypeName: string | null;
  readonly status: CatalogueLifecycleStatus;
  readonly publishedVersion: { readonly id: string; readonly versionNumber: number | null; readonly publishedAt: Date | null } | null;
  readonly openDraft: { readonly id: string; readonly revision: number; readonly createdAt: Date } | null;
  readonly createdAt: Date;
}

/** What a publish did. */
export interface PublishResult {
  readonly version: TemplateVersionView;
  readonly retiredVersionId: string | null;
  /** The type versions a BASE publish created (§ 7.3); empty for a type publish. */
  readonly rebasedVersionIds: string[];
}

/** A published version in the catalogue document (§ 8.3). */
export interface PublishedVersionDocument {
  readonly id: string;
  readonly templateId: string;
  readonly deviceTypeId: string | null;
  readonly versionNumber: number | null;
  readonly baseVersionId: string | null;
  readonly contentHash: string | null;
  readonly publishedAt: Date | null;
  readonly items: TemplateItemView[];
}

/** The published catalogue document (§ 8.3) — what a client works from, online or offline (ADR-127). */
export interface PublishedCatalogue {
  readonly schema: "inspection-catalogue-v1";
  readonly deviceTypes: { readonly id: string; readonly name: string }[];
  readonly versions: PublishedVersionDocument[];
}

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------

/** The origin of a template's OWN items: a type template's are `type`, the base template's `base`. */
const ownOrigin = (template: TemplateRow): "base" | "type" => (template.deviceTypeId ? "type" : "base");

const sectionIndex = (s: string): number => (INSPECTION_SECTIONS as readonly string[]).indexOf(s);
const originIndex = (o: string): number => (TEMPLATE_ITEM_ORIGINS as readonly string[]).indexOf(o);

/** Read order (spec § 4.5): section registry order, base before type, sort_order. */
const inReadOrder = <T extends { section: string; origin: string; sortOrder: number; id: string }>(items: readonly T[]): T[] =>
  [...items].sort(
    (a, b) =>
      sectionIndex(a.section) - sectionIndex(b.section) ||
      originIndex(a.origin) - originIndex(b.origin) ||
      // sort_order is unique per (version, section, origin) — the position index of 0112.
      a.sortOrder - b.sortOrder,
  );

/** SHA-256 (lower-case hex) of the canonical text (spec § 7.6). */
const hashOf = (
  template: TemplateRow,
  versionNumber: number,
  baseVersionId: string | null,
  items: readonly CanonicalTemplateItemInput[],
): string =>
  createHash("sha256")
    .update(canonicalTemplateVersion({ templateId: template.id, deviceTypeId: template.deviceTypeId, versionNumber, baseVersionId, items }), "utf8")
    .digest("hex");

/** A draft's hash for the audit trail (version number 0, no base): the edit history is reconstructible from it. */
const draftHash = (template: TemplateRow, items: readonly ItemRow[]): string => hashOf(template, 0, null, items);

/** How a message names the template: "the base checklist" or `the checklist for "<type>"`. */
const templateLabel = async (template: TemplateRow, transaction: Transaction): Promise<string> => {
  if (!template.deviceTypeId) {
    return "the base checklist";
  }
  // The key is RESTRICT (0112): the type exists.
  const type = (await models.DeviceType.findOne({ where: { id: template.deviceTypeId }, attributes: ["name"], transaction })) as ModelInstance<"DeviceType">;
  return `the checklist for "${type.name}"`;
};

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** `2026-10-09` — the date a 409 names (a stamp the state's CHECK makes NOT NULL). */
const day = (date: Date | null): string => (date as Date).toISOString().slice(0, 10);

/** The template `id` locked FOR UPDATE in `transaction`, or the 404. */
const lockTemplate = async (id: string, transaction: Transaction): Promise<TemplateRow> => {
  const template = await models.InspectionTemplate.findOne({ where: { id }, transaction, lock: transaction.LOCK.UPDATE });
  if (!template) {
    throw new AppError(404, TEMPLATE_NOT_FOUND);
  }
  return template;
};

/** The version `id` and its template, both locked — template first (one lock order everywhere). */
const lockVersion = async (id: string, transaction: Transaction): Promise<{ template: TemplateRow; version: VersionRow }> => {
  const found = await models.InspectionTemplateVersion.findOne({ where: { id }, attributes: ["id", "templateId"], transaction });
  if (!found) {
    throw new AppError(404, VERSION_NOT_FOUND);
  }
  const template = await lockTemplate(found.templateId, transaction);
  const version = await models.InspectionTemplateVersion.findOne({ where: { id }, transaction, lock: transaction.LOCK.UPDATE });
  return { template, version: version as VersionRow };
};

/** The 409 of a version that is not an open draft, naming its state. */
const notADraft = async (template: TemplateRow, version: VersionRow, transaction: Transaction): Promise<AppError> => {
  if (version.status === "discarded") {
    return new AppError(409, `This draft was discarded on ${day(version.discardedAt)}; create a new draft.`);
  }
  return new AppError(
    409,
    `Version ${String(version.versionNumber)} of ${await templateLabel(template, transaction)} was published on ${day(version.publishedAt)} ` +
      "and cannot be changed — create a new draft.",
  );
};

/** An open draft, at the revision the caller last read (optimistic concurrency, § 7.2). */
const assertEditable = async (template: TemplateRow, version: VersionRow, revision: number, transaction: Transaction): Promise<void> => {
  if (version.status !== "draft") {
    throw await notADraft(template, version, transaction);
  }
  if (version.revision !== revision) {
    throw new AppError(
      409,
      `This draft was saved at ${version.updatedAt.toISOString()} (revision ${String(version.revision)}); reload it before saving.`,
    );
  }
};

const itemsOf = async (versionId: string, transaction: Transaction | null): Promise<ItemRow[]> =>
  models.InspectionTemplateItem.findAll({ where: { versionId }, transaction });

/** The template's published version, if any. */
const publishedOf = async (templateId: string, transaction: Transaction): Promise<VersionRow | null> =>
  models.InspectionTemplateVersion.findOne({ where: { templateId, status: "published" }, transaction });

/** The template's open OPERATOR draft (a rebase draft never outlives its transaction). */
const openDraftOf = async (templateId: string, transaction: Transaction): Promise<VersionRow | null> =>
  models.InspectionTemplateVersion.findOne({ where: { templateId, status: "draft", rebasedFromVersionId: null }, transaction });

/** Copy `items` into version `versionId` (new ids — results pin a version's own item ids). */
const copyItems = async (
  versionId: string,
  items: readonly ItemRow[],
  origin: "base" | "type",
  transaction: Transaction,
): Promise<ItemRow[]> =>
  models.InspectionTemplateItem.bulkCreate(
    items.map((item) => ({
      versionId: versionId as InspectionTemplateVersionId,
      itemDefinitionId: item.itemDefinitionId,
      origin,
      ...contentOf(item),
      allowedOutcomes: [...item.allowedOutcomes],
      required: item.required,
      sortOrder: item.sortOrder,
    })),
    { transaction },
  );

/** One audit row for a template or a version, under the PLATFORM tenant, inside `transaction`. */
const audit = async (
  transaction: Transaction,
  actor: AuditActorInput,
  entry: { action: "CREATE" | "UPDATE" | "APPROVE"; resourceType: string; resourceId: string; changes: Record<string, unknown> },
): Promise<void> => {
  await auditService.logAction({ tenantId: PLATFORM_TENANT_ID, ...auditEntryActor(actor), ...entry }, { transaction });
};

/** A version's full view: header + items in read order. */
const viewOf = async (version: VersionRow, deviceTypeId: string | null, transaction: Transaction | null = null): Promise<TemplateVersionView> => ({
  ...versionSummary(version, deviceTypeId),
  items: inReadOrder(await itemsOf(version.id, transaction)).map(templateItemView),
});

// ------------------------------------------------------------------
// TEMPLATES (§ 7.1)
// ------------------------------------------------------------------

/**
 * `GET /ipm/templates` (operator): templates with their published version and open draft.
 *
 * @param query - the validated query
 * @returns rows and meta
 */
export const listTemplates = async (query: ListTemplatesQueryInput): Promise<Page<TemplateListRow>> => {
  const where: Record<string | symbol, unknown> = {};
  if (query.deviceTypeId) {
    where["deviceTypeId"] = query.deviceTypeId;
  }
  if (query.status) {
    where["status"] = query.status;
  }
  if (query.hasDraft !== undefined) {
    const drafts = await models.InspectionTemplateVersion.findAll({ where: { status: "draft" }, attributes: ["templateId"] });
    where["id"] = { [query.hasDraft ? Op.in : Op.notIn]: drafts.map((d) => d.templateId) };
  }
  const { rows, count } = await models.InspectionTemplate.findAndCountAll({
    where: where as WhereOptions,
    include: [{ model: models.DeviceType, as: "deviceType", attributes: ["id", "name"], required: false }],
    order: [["createdAt", "ASC"], ["id", "ASC"]],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });
  const versions = await models.InspectionTemplateVersion.findAll({
    where: { templateId: { [Op.in]: rows.map((r) => r.id) }, status: { [Op.in]: ["published", "draft"] } },
  });
  return {
    rows: rows.map((t) => {
      const published = versions.find((v) => v.templateId === t.id && v.status === "published");
      const draft = versions.find((v) => v.templateId === t.id && v.status === "draft");
      return {
        id: t.id,
        deviceTypeId: t.deviceTypeId,
        deviceTypeName: t.deviceType?.name ?? null,
        status: t.status,
        publishedVersion: published ? { id: published.id, versionNumber: published.versionNumber, publishedAt: published.publishedAt } : null,
        openDraft: draft ? { id: draft.id, revision: draft.revision, createdAt: draft.createdAt } : null,
        createdAt: t.createdAt,
      };
    }),
    meta: pageMeta(count, query.page, query.limit),
  };
};

/** Create the type template of `deviceTypeId` in `transaction` (audited). */
const createTemplateIn = async (
  deviceTypeId: DeviceTypeId,
  actor: AuditActorInput,
  transaction: Transaction,
): Promise<{ template: TemplateRow; typeName: string }> => {
  const type = await models.DeviceType.findOne({ where: { id: deviceTypeId }, attributes: ["id", "name", "status"], transaction });
  if (!type) {
    throw new AppError(404, "Device type not found");
  }
  if (type.status !== "active") {
    throw new AppError(409, `The device type "${type.name}" is retired; reactivate it before giving it a checklist.`);
  }
  const existing = await models.InspectionTemplate.findOne({ where: { deviceTypeId }, attributes: ["id"], transaction });
  if (existing) {
    throw new AppError(409, `A checklist for "${type.name}" already exists.`);
  }
  const by = actorUserId(actor);
  const template = await models.InspectionTemplate.create({ deviceTypeId, status: "active", createdBy: by, updatedBy: by }, { transaction });
  await audit(transaction, actor, {
    action: "CREATE",
    resourceType: "InspectionTemplate",
    resourceId: template.id,
    changes: { operation: "CREATE_TEMPLATE", before: {}, after: { deviceTypeId, status: "active" } },
  });
  return { template, typeName: type.name };
};

/**
 * `POST /ipm/templates`: the checklist of a device type (no version yet).
 *
 * @param deviceTypeId - an ACTIVE type without a template
 * @param actor - the operator
 * @returns the template's list row
 */
export const createTemplate = async (deviceTypeId: DeviceTypeId, actor: AuditActorInput): Promise<TemplateListRow> => {
  try {
    const { template, typeName } = await db.transaction(async (transaction) => createTemplateIn(deviceTypeId, actor, transaction));
    return { id: template.id, deviceTypeId, deviceTypeName: typeName, status: template.status, publishedVersion: null, openDraft: null, createdAt: template.createdAt };
  } catch (error) {
    throw conflictOr(error, "A checklist for this device type already exists.");
  }
};

/**
 * `POST /ipm/templates/:templateId/retire` · `/reactivate` (§ 7.1). Retiring retires the
 * published version in the same transaction (new sessions for the type use the base, § 7.5). The
 * base template is never retired: every type falls back to it.
 *
 * @param id - the template
 * @param to - the status it moves to
 * @param actor - the operator
 * @returns the template's id, status and the version retired with it
 */
export const setTemplateStatus = async (
  id: InspectionTemplateId,
  to: CatalogueLifecycleStatus,
  actor: AuditActorInput,
): Promise<{ id: string; status: CatalogueLifecycleStatus; retiredVersionId: string | null }> =>
  db.transaction(async (transaction) => {
    const template = await lockTemplate(id, transaction);
    const label = await templateLabel(template, transaction);
    if (!template.deviceTypeId) {
      throw new AppError(409, "The base checklist is never retired: every device type falls back to it.");
    }
    if (template.status === to) {
      throw new AppError(409, to === "retired" ? `${capitalised(label)} is already retired.` : `${capitalised(label)} is active.`);
    }
    const by = actorUserId(actor);
    let retiredVersionId: string | null = null;
    if (to === "retired") {
      const published = await publishedOf(template.id, transaction);
      if (published) {
        await published.update({ status: "retired", retiredAt: new Date(), retiredBy: by, updatedBy: by }, { transaction });
        retiredVersionId = published.id;
      }
    }
    await template.update({ status: to, updatedBy: by }, { transaction });
    await audit(transaction, actor, {
      action: "UPDATE",
      resourceType: "InspectionTemplate",
      resourceId: template.id,
      changes: {
        operation: to === "retired" ? "RETIRE_TEMPLATE" : "REACTIVATE_TEMPLATE",
        before: { status: to === "retired" ? "active" : "retired" },
        after: { status: to },
        deviceTypeId: template.deviceTypeId,
        retiredVersionId,
      },
    });
    return { id: template.id, status: to, retiredVersionId };
  });

// ------------------------------------------------------------------
// VERSIONS (§ 7.2)
// ------------------------------------------------------------------

/** Open a draft on a locked, active template in `transaction` (audited). */
const createDraftIn = async (
  template: TemplateRow,
  copyFrom: "published" | "empty",
  actor: AuditActorInput,
  transaction: Transaction,
): Promise<VersionRow> => {
  const label = await templateLabel(template, transaction);
  if (template.status !== "active") {
    throw new AppError(409, `${capitalised(label)} is retired; reactivate it first.`);
  }
  const open = await openDraftOf(template.id, transaction);
  if (open) {
    throw new AppError(409, `${capitalised(label)} already has an open draft, created on ${day(open.createdAt)} — edit or discard it.`);
  }
  const by = actorUserId(actor);
  const draft = await models.InspectionTemplateVersion.create({ templateId: template.id, status: "draft", revision: 0, createdBy: by, updatedBy: by }, { transaction });
  const published = copyFrom === "published" ? await publishedOf(template.id, transaction) : null;
  const source = published ? (await itemsOf(published.id, transaction)).filter((i) => i.origin === ownOrigin(template)) : [];
  const items = await copyItems(draft.id, source, ownOrigin(template), transaction);
  await audit(transaction, actor, {
    action: "CREATE",
    resourceType: "InspectionTemplateVersion",
    resourceId: draft.id,
    changes: {
      operation: "CREATE_DRAFT",
      templateId: template.id,
      copiedFromVersionId: published?.id ?? null,
      revision: { before: null, after: 0 },
      itemCount: { before: 0, after: items.length },
      draftHash: { before: null, after: draftHash(template, items) },
    },
  });
  return draft;
};

/**
 * `POST /ipm/templates/:templateId/versions`: open a draft — empty, or a copy of the published
 * version's own items.
 *
 * @param input - the validated params + body
 * @param actor - the operator
 * @returns the draft with its items
 */
export const createDraft = async (input: CreateDraftInput, actor: AuditActorInput): Promise<TemplateVersionView> => {
  try {
    return await db.transaction(async (transaction) => {
      const template = await lockTemplate(input.templateId, transaction);
      const draft = await createDraftIn(template, input.copyFrom, actor, transaction);
      return viewOf(draft, template.deviceTypeId, transaction);
    });
  } catch (error) {
    throw conflictOr(error, "This checklist already has an open draft — edit or discard it.");
  }
};

/**
 * The draft a proposal's acceptance opens or links (§ 7.4): the type's template (created when it
 * has none), its open draft, or a new one copying the published version. Runs in the caller's
 * transaction, so the proposal's decision and the draft commit together.
 *
 * @param deviceTypeId - the type the proposal is about (an active one)
 * @param actor - the operator
 * @param transaction - the decision's transaction
 * @returns the draft's id
 */
export const openOrLinkDraft = async (deviceTypeId: DeviceTypeId, actor: AuditActorInput, transaction: Transaction): Promise<string> => {
  const existing = await models.InspectionTemplate.findOne({ where: { deviceTypeId }, attributes: ["id"], transaction });
  const template = existing ? await lockTemplate(existing.id, transaction) : (await createTemplateIn(deviceTypeId, actor, transaction)).template;
  const open = template.status === "active" ? await openDraftOf(template.id, transaction) : null;
  return (open ?? (await createDraftIn(template, "published", actor, transaction))).id;
};

/**
 * `GET /ipm/template-versions?templateId=` (operator): one template's history, every status.
 *
 * @param query - the validated query
 * @returns rows (headers, no items) and meta
 */
export const listVersions = async (query: ListVersionsQueryInput): Promise<Page<TemplateVersionSummary>> => {
  const template = await models.InspectionTemplate.findOne({ where: { id: query.templateId }, attributes: ["id", "deviceTypeId"] });
  if (!template) {
    throw new AppError(404, TEMPLATE_NOT_FOUND);
  }
  const { rows, count } = await models.InspectionTemplateVersion.findAndCountAll({
    where: { templateId: template.id, ...(query.status ? { status: query.status } : {}) },
    order: [["createdAt", "DESC"], ["id", "ASC"]],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });
  return { rows: rows.map((v) => versionSummary(v, template.deviceTypeId)), meta: pageMeta(count, query.page, query.limit) };
};

/**
 * `GET /ipm/template-versions/:versionId`: one version with its items in read order. A draft or a
 * discarded draft is the operator's: anyone else gets the 404 a missing id gets.
 *
 * @param id - the version
 * @param operator - whether the caller is the platform operator
 * @returns the version
 */
export const getVersion = async (id: InspectionTemplateVersionId, operator: boolean): Promise<TemplateVersionView> => {
  const version = await models.InspectionTemplateVersion.findOne({ where: { id } });
  if (!version || (!operator && (version.status === "draft" || version.status === "discarded"))) {
    throw new AppError(404, VERSION_NOT_FOUND);
  }
  const template = await models.InspectionTemplate.findOne({ where: { id: version.templateId }, attributes: ["deviceTypeId"] });
  return viewOf(version, template?.deviceTypeId ?? null);
};

/** The stored rows of a draft's new items, in array order (sort order counted per section). */
const draftRows = async (
  template: TemplateRow,
  versionId: string,
  input: ReplaceDraftItemsInput,
  transaction: Transaction,
): Promise<(StoredContent & { versionId: InspectionTemplateVersionId; itemDefinitionId: ItemRow["itemDefinitionId"]; origin: "base" | "type"; required: boolean; sortOrder: number })[]> => {
  const ids = input.items.map((i) => i.itemDefinitionId);
  const definitions = await models.InspectionItemDefinition.findAll({ where: { id: { [Op.in]: ids } }, transaction });
  const perSection = new Map<string, number>();
  return input.items.map((item, index) => {
    const definition = definitions.find((d) => d.id === item.itemDefinitionId);
    if (!definition) {
      throw new AppError(400, `Item ${String(index + 1)}: unknown item definition.`);
    }
    if (definition.status !== "active") {
      throw new AppError(400, `Item ${String(index + 1)}: the definition "${definition.label}" is retired; it cannot be added to a draft.`);
    }
    const content = item.content ? storedContent(item.content) : { ...contentOf(definition), allowedOutcomes: [...definition.allowedOutcomes] };
    if (content.section !== definition.section || content.inputKind !== definition.inputKind) {
      throw new AppError(400, `Item ${String(index + 1)}: an item keeps its definition's section and input kind.`);
    }
    const sortOrder = perSection.get(content.section) ?? 0;
    if (sortOrder >= MAX_SECTION_ITEMS) {
      throw new AppError(400, `At most ${String(MAX_SECTION_ITEMS)} items in the ${content.section} section.`);
    }
    perSection.set(content.section, sortOrder + 1);
    return {
      versionId: versionId as InspectionTemplateVersionId,
      itemDefinitionId: definition.id,
      origin: ownOrigin(template),
      ...content,
      required: item.required ?? definition.defaultRequired,
      sortOrder,
    };
  });
};

/**
 * `PUT /ipm/template-versions/:versionId/items`: replace a draft's items wholesale (a draft is
 * edited as a document), at the revision the caller read; the revision moves on.
 *
 * @param input - the validated params + body
 * @param actor - the operator
 * @returns the draft with its new items
 */
export const replaceDraftItems = async (input: ReplaceDraftItemsInput, actor: AuditActorInput): Promise<TemplateVersionView> =>
  db.transaction(async (transaction) => {
    const { template, version } = await lockVersion(input.versionId, transaction);
    await assertEditable(template, version, input.revision, transaction);
    const rows = await draftRows(template, version.id, input, transaction);
    const before = await itemsOf(version.id, transaction);
    await models.InspectionTemplateItem.destroy({ where: { versionId: version.id }, transaction });
    const after = await models.InspectionTemplateItem.bulkCreate(rows, { transaction });
    await version.update({ revision: version.revision + 1, updatedBy: actorUserId(actor) }, { transaction });
    await audit(transaction, actor, {
      action: "UPDATE",
      resourceType: "InspectionTemplateVersion",
      resourceId: version.id,
      changes: {
        operation: "EDIT_DRAFT_ITEMS",
        revision: { before: input.revision, after: version.revision },
        itemCount: { before: before.length, after: after.length },
        draftHash: { before: draftHash(template, before), after: draftHash(template, after) },
      },
    });
    return viewOf(version, template.deviceTypeId, transaction);
  });

/**
 * `PATCH /ipm/template-versions/:versionId`: the draft's change note.
 *
 * @param input - the validated params + body
 * @param actor - the operator
 * @returns the draft
 */
export const updateDraftNote = async (input: UpdateDraftInput, actor: AuditActorInput): Promise<TemplateVersionView> =>
  db.transaction(async (transaction) => {
    const { template, version } = await lockVersion(input.versionId, transaction);
    await assertEditable(template, version, input.revision, transaction);
    await version.update({ changeNote: input.changeNote, revision: version.revision + 1, updatedBy: actorUserId(actor) }, { transaction });
    await audit(transaction, actor, {
      action: "UPDATE",
      resourceType: "InspectionTemplateVersion",
      resourceId: version.id,
      changes: { operation: "EDIT_DRAFT_NOTE", revision: { before: input.revision, after: version.revision }, changeNoteLength: input.changeNote.length },
    });
    return viewOf(version, template.deviceTypeId, transaction);
  });

/**
 * `POST /ipm/template-versions/:versionId/discard`: a draft becomes `discarded` (terminal; its
 * rows are kept).
 *
 * @param id - the draft
 * @param actor - the operator
 * @returns the discarded version
 */
export const discardDraft = async (id: InspectionTemplateVersionId, actor: AuditActorInput): Promise<TemplateVersionView> =>
  db.transaction(async (transaction) => {
    const { template, version } = await lockVersion(id, transaction);
    if (version.status !== "draft") {
      throw new AppError(409, `Only a draft can be discarded; this version is ${version.status}.`);
    }
    const by = actorUserId(actor);
    await version.update({ status: "discarded", discardedAt: new Date(), discardedBy: by, updatedBy: by }, { transaction });
    await audit(transaction, actor, {
      action: "UPDATE",
      resourceType: "InspectionTemplateVersion",
      resourceId: version.id,
      changes: { operation: "DISCARD_DRAFT", before: { status: "draft" }, after: { status: "discarded" }, revision: version.revision },
    });
    return viewOf(version, template.deviceTypeId, transaction);
  });

/**
 * Publish a draft of `template` in `transaction`: materialise the base (a type template), retire
 * the published version, number, hash, stamp and audit (§ 7.2, § 7.6). The draft's own items are
 * already checked by the caller.
 */
const publishIn = async (
  template: TemplateRow,
  draft: VersionRow,
  base: { version: VersionRow; items: readonly ItemRow[] } | null,
  changeNote: string,
  actor: AuditActorInput,
  transaction: Transaction,
): Promise<{ retiredVersionId: string | null }> => {
  const own = await itemsOf(draft.id, transaction);
  const baseCopies = base ? await copyItems(draft.id, base.items, "base", transaction) : [];
  const by = actorUserId(actor);
  const now = new Date();
  const previous = await publishedOf(template.id, transaction);
  if (previous) {
    await previous.update({ status: "retired", retiredAt: now, retiredBy: by, updatedBy: by }, { transaction });
  }
  const numbered = await models.InspectionTemplateVersion.findAll({
    where: { templateId: template.id, versionNumber: { [Op.ne]: null } },
    attributes: ["versionNumber"],
    transaction,
  });
  const versionNumber = Math.max(0, ...numbered.map((v) => Number(v.versionNumber))) + 1;
  const baseVersionId: InspectionTemplateVersionId | null = base ? base.version.id : null;
  const contentHash = hashOf(template, versionNumber, baseVersionId, [...own, ...baseCopies]);
  await draft.update(
    {
      status: "published",
      versionNumber,
      baseVersionId,
      contentHash,
      changeNote,
      publishedAt: now,
      // Exactly one publisher (0112's CHECK): the operator, or the system actor of a seed or an import.
      ...(by ? { publishedBy: by } : { publishedBySystem: String(actor.systemActor) }),
      updatedBy: by,
    },
    { transaction },
  );
  await audit(transaction, actor, {
    action: "APPROVE",
    resourceType: "InspectionTemplateVersion",
    resourceId: draft.id,
    changes: {
      operation: draft.rebasedFromVersionId ? "REBASE_TEMPLATE_VERSION" : "PUBLISH_TEMPLATE_VERSION",
      templateId: template.id,
      versionNumber,
      contentHash,
      baseVersionId,
      retiredVersionId: previous?.id ?? null,
      rebasedFromVersionId: draft.rebasedFromVersionId,
      changeNote,
    },
  });
  return { retiredVersionId: previous?.id ?? null };
};

/** § 7.3: every active type template with a published version, rebased onto `base` (template locks in id order). */
const rebaseTypes = async (
  base: { version: VersionRow; items: readonly ItemRow[] },
  actor: AuditActorInput,
  transaction: Transaction,
): Promise<string[]> => {
  const types = await models.InspectionTemplate.findAll({
    where: { status: "active", deviceTypeId: { [Op.ne]: null } },
    order: [["id", "ASC"]],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const created: string[] = [];
  for (const template of types) {
    const published = await publishedOf(template.id, transaction);
    if (!published) {
      continue;
    }
    const by = actorUserId(actor);
    const draft = await models.InspectionTemplateVersion.create(
      { templateId: template.id, status: "draft", revision: 0, rebasedFromVersionId: published.id, createdBy: by, updatedBy: by },
      { transaction },
    );
    const typeItems = (await itemsOf(published.id, transaction)).filter((i) => i.origin === "type");
    await copyItems(draft.id, typeItems, "type", transaction);
    await publishIn(template, draft, base, `Rebased onto base version ${String(base.version.versionNumber)}`, actor, transaction);
    created.push(draft.id);
  }
  return created;
};

/**
 * `POST /ipm/template-versions/:versionId/publish` (§ 7.2, § 7.3).
 *
 * @param input - the validated params + body (`revision`, `changeNote`)
 * @param actor - the operator
 * @returns the published version, the version it retired and, for the base, the rebased versions
 */
export const publishVersion = async (input: PublishVersionInput, actor: AuditActorInput): Promise<PublishResult> =>
  db.transaction(async (transaction) => {
    const { template, version } = await lockVersion(input.versionId, transaction);
    if (version.status !== "draft") {
      throw new AppError(409, `Only a draft can be published; this version is ${version.status}.`);
    }
    await assertEditable(template, version, input.revision, transaction);
    const label = await templateLabel(template, transaction);
    if (template.status !== "active") {
      throw new AppError(409, `${capitalised(label)} is retired; reactivate it first.`);
    }
    const own = await itemsOf(version.id, transaction);
    if (own.length === 0) {
      throw new AppError(400, "A checklist version needs at least one item.");
    }
    const problems = own.flatMap((item) => inspectionContentProblems(contentOf(item)));
    if (problems.length > 0) {
      throw new AppError(400, problems.join(" "));
    }
    let base: { version: VersionRow; items: ItemRow[] } | null = null;
    if (template.deviceTypeId) {
      const baseTemplate = await models.InspectionTemplate.findOne({ where: { deviceTypeId: null }, attributes: ["id"], transaction });
      const baseVersion = baseTemplate ? await publishedOf(baseTemplate.id, transaction) : null;
      if (!baseVersion) {
        throw new AppError(409, "The base checklist has no published version; publish the base first.");
      }
      base = { version: baseVersion, items: await itemsOf(baseVersion.id, transaction) };
      const inBase = new Set(base.items.map((i) => i.itemDefinitionId));
      const twice = own.filter((i) => inBase.has(i.itemDefinitionId));
      if (twice.length > 0) {
        throw new AppError(400, `${twice.map((i) => `"${i.label}"`).join(", ")} is already in the base checklist; remove it from this one.`);
      }
    }
    const { retiredVersionId } = await publishIn(template, version, base, input.changeNote, actor, transaction);
    const rebasedVersionIds = template.deviceTypeId ? [] : await rebaseTypes({ version, items: own }, actor, transaction);
    return { version: await viewOf(version, template.deviceTypeId, transaction), retiredVersionId, rebasedVersionIds };
  });

// ------------------------------------------------------------------
// THE PUBLISHED CATALOGUE (§ 8.3)
// ------------------------------------------------------------------

/**
 * The strong ETag of the published catalogue: SHA-256 over the sorted `version id:content hash`
 * lines and the sorted `device type id:name` lines (the active types are in the document, so they
 * are in the validator — ADR-125 Am. 1 § 10). Cheap: no item is read.
 *
 * @returns `"<hex>"`
 */
export const publishedCatalogueEtag = async (): Promise<string> => {
  const [versions, types] = await Promise.all([
    models.InspectionTemplateVersion.findAll({ where: { status: "published" }, attributes: ["id", "contentHash"] }),
    models.DeviceType.findAll({ where: { status: "active" }, attributes: ["id", "name"] }),
  ]);
  const lines = [
    // A published version always has its hash (0112's publish CHECK).
    ...versions.map((v) => `version:${v.id}:${String(v.contentHash)}`).sort(),
    ...types.map((t) => `type:${t.id}:${t.name}`).sort(),
  ];
  return `"${createHash("sha256").update(lines.join("\n"), "utf8").digest("hex")}"`;
};

/**
 * `GET /ipm/templates/published`: the active device types and every published version with its
 * items in read order — no actor, no operator note.
 *
 * @returns the document
 */
export const publishedCatalogue = async (): Promise<PublishedCatalogue> => {
  const [versions, types] = await Promise.all([
    models.InspectionTemplateVersion.findAll({ where: { status: "published" }, order: [["id", "ASC"]] }),
    models.DeviceType.findAll({ where: { status: "active" }, attributes: ["id", "name"], order: [["name", "ASC"], ["id", "ASC"]] }),
  ]);
  const ids = versions.map((v) => v.id);
  const [templates, items] = await Promise.all([
    models.InspectionTemplate.findAll({ where: { id: { [Op.in]: versions.map((v) => v.templateId) } }, attributes: ["id", "deviceTypeId"] }),
    models.InspectionTemplateItem.findAll({ where: { versionId: { [Op.in]: ids } } }),
  ]);
  return {
    schema: "inspection-catalogue-v1",
    deviceTypes: types.map((t) => ({ id: t.id, name: t.name })),
    versions: versions.map((v) => ({
      id: v.id,
      templateId: v.templateId,
      deviceTypeId: templates.find((t) => t.id === v.templateId)?.deviceTypeId ?? null,
      versionNumber: v.versionNumber,
      baseVersionId: v.baseVersionId,
      contentHash: v.contentHash,
      publishedAt: v.publishedAt,
      items: inReadOrder(items.filter((i) => i.versionId === v.id)).map(templateItemView),
    })),
  };
};
