/**
 * What the inspection catalogue's services share (P21-01; ADR-125; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 4, § 8, § 10): the views every answer is built
 * from, the page meta, the LIKE escape, the audit actor and the 409 of a unique-index race.
 *
 * The catalogue is GLOBAL (no tenant, no facility column): the tenant hooks leave its models
 * alone, so the route is the only write control (`superAdminOnly`, held by
 * tests/guards/inspectionCatalogueGlobal.guard). No view carries an actor (`createdBy`,
 * `publishedBy`, …), `notes`, or a legacy key: who on the platform wrote a row is not tenant data
 * (spec § 8.3), and an operator reads it from the audit trail.
 *
 * Named exports only (ADR-087 Am. 15). Writes nothing.
 */
import { UniqueConstraintError } from "sequelize";
import {
  inspectionContentOf,
  type InspectionItemContent,
  type InspectionItemContentInput,
  type InspectionOutcome,
} from "@callibrator/contracts/inspectionValues";
import type { CatalogueLifecycleStatus, TemplateVersionStatus } from "@callibrator/contracts/states";
import { AppError } from "../utils/appError.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import type { UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

/** The page meta of a list answer (a top-level sibling of `data`). */
export interface PageMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

/** A page of rows and its meta. */
export interface Page<T> {
  readonly rows: T[];
  readonly meta: PageMeta;
}

/** @returns the meta of page `page` of `total` rows */
export const pageMeta = (total: number, page: number, limit: number): PageMeta => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
});

/** The value LIKE matches literally (`%`, `_` and `\` escaped). */
export const likeLiteral = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

/** The user an operator write names in `created_by` / `updated_by` (null for a system actor). */
export const actorUserId = (actor: AuditActorInput): UserId | null => (actor.userId ?? null) as UserId | null;

/**
 * A unique index refused the write after the service's own pre-check (a race): the same 409 the
 * pre-check answers; anything else passes through.
 */
export const conflictOr = (error: unknown, message: string): unknown =>
  error instanceof UniqueConstraintError ? new AppError(409, message) : error;

/** A device type as every reader sees it. */
export interface DeviceTypeView {
  readonly id: string;
  readonly name: string;
  readonly status: CatalogueLifecycleStatus;
}

/** @returns the view of a DeviceType row */
export const deviceTypeView = (row: ModelInstance<"DeviceType">): DeviceTypeView => ({ id: row.id, name: row.name, status: row.status });

/** The content columns, read from a definition or a template item. */
export const contentOf = (row: InspectionItemContent): InspectionItemContent => ({
  section: row.section,
  label: row.label,
  inputKind: row.inputKind,
  unit: row.unit,
  symbol: row.symbol,
  settingText: row.settingText,
  settingValue: row.settingValue,
  limitOp: row.limitOp,
  limitValue: row.limitValue,
  limitLow: row.limitLow,
  limitHigh: row.limitHigh,
  limitNominal: row.limitNominal,
  limitTolerance: row.limitTolerance,
  limitText: row.limitText,
  validMin: row.validMin,
  validMax: row.validMax,
  warnMin: row.warnMin,
  warnMax: row.warnMax,
  allowedOutcomes: [...row.allowedOutcomes],
});

/** The content columns as a model writes them (a mutable outcome array). */
export type StoredContent = Omit<InspectionItemContent, "allowedOutcomes"> & { allowedOutcomes: InspectionOutcome[] };

/** @returns what an operator wrote, as the columns store it (unit normalised, limit parsed — spec § 6) */
export const storedContent = (input: InspectionItemContentInput): StoredContent => {
  const content = inspectionContentOf(input);
  return { ...content, allowedOutcomes: [...content.allowedOutcomes] };
};

/** An item of a version, as every reader sees it. */
export type TemplateItemView = InspectionItemContent & {
  readonly id: string;
  readonly itemDefinitionId: string;
  readonly origin: "base" | "type";
  readonly required: boolean;
  readonly sortOrder: number;
};

/** @returns the view of an InspectionTemplateItem row */
export const templateItemView = (row: ModelInstance<"InspectionTemplateItem">): TemplateItemView => ({
  id: row.id,
  itemDefinitionId: row.itemDefinitionId,
  origin: row.origin,
  ...contentOf(row),
  required: row.required,
  sortOrder: row.sortOrder,
});

/** A version's header, as every reader sees it (no actor). */
export interface TemplateVersionSummary {
  readonly id: string;
  readonly templateId: string;
  readonly deviceTypeId: string | null;
  readonly status: TemplateVersionStatus;
  readonly versionNumber: number | null;
  readonly baseVersionId: string | null;
  readonly rebasedFromVersionId: string | null;
  readonly contentHash: string | null;
  readonly changeNote: string | null;
  readonly revision: number;
  readonly publishedAt: Date | null;
  readonly retiredAt: Date | null;
  readonly discardedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A version with its items in read order. */
export type TemplateVersionView = TemplateVersionSummary & { readonly items: TemplateItemView[] };

/** @returns the summary of an InspectionTemplateVersion row whose template's type is `deviceTypeId` */
export const versionSummary = (row: ModelInstance<"InspectionTemplateVersion">, deviceTypeId: string | null): TemplateVersionSummary => ({
  id: row.id,
  templateId: row.templateId,
  deviceTypeId,
  status: row.status,
  versionNumber: row.versionNumber,
  baseVersionId: row.baseVersionId,
  rebasedFromVersionId: row.rebasedFromVersionId,
  contentHash: row.contentHash,
  changeNote: row.changeNote,
  revision: row.revision,
  publishedAt: row.publishedAt,
  retiredAt: row.retiredAt,
  discardedAt: row.discardedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
