/**
 * The inspection catalogue's request schemas (P21-01; ADR-125 and its Amendments 1–3; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 8.2, § 8.4): device types, the item library,
 * templates and their versions, and the tenants' proposals.
 *
 * An item's content is a discriminated union on `inputKind`, so a limit on a `tri_state` item or
 * a setting on a `measured` one is refused by the shape itself; the rest of the item rules (the
 * section's kinds and outcomes, the unit of a limit, the ranges — `inspectionContentProblems`)
 * run as a refinement, so the 400 comes before the service. The operator writes a limit as TEXT;
 * the server parses it (`parseLimit`) — the structured columns are never taken from a client.
 *
 * Route forms carry the path parameter and the body together (`validate(schema, { from:
 * ["params", "body"] })`, the path-parameter trap); the `…Body` forms are the bodies alone (the
 * OpenAPI documents them). Response shapes are the route modules' `*.openapi.ts` (ADR-103).
 *
 * Imports nothing but `zod` and its siblings (both ends load it).
 */
import { z } from "zod";
import { booleanish, numeric, uuid } from "./fields";
import { MAX_LIMIT } from "./pagination";
import { CATALOGUE_LIFECYCLE_STATUSES, TEMPLATE_PROPOSAL_STATUSES, TEMPLATE_VERSION_STATUSES } from "./states";
import {
  INSPECTION_OUTCOMES,
  INSPECTION_SECTIONS,
  INSPECTION_INPUT_KINDS,
  INSPECTION_SECTION_RULES,
  TEMPLATE_PROPOSAL_KINDS,
  inspectionContentOf,
  inspectionContentProblems,
  parseDecimal,
} from "./inspectionValues";

/** At most this many items in one version (spec § 4.5). */
export const MAX_VERSION_ITEMS = 300;
/** At most this many items of one section in one version. */
export const MAX_SECTION_ITEMS = 60;
/** At most this many items in one proposal (spec § 4.6; D-27). */
export const MAX_PROPOSAL_ITEMS = 100;

const page = numeric(z.number().int().min(1)).default(1);
const limit = numeric(z.number().int().min(1).max(MAX_LIMIT)).default(25);
const revision = numeric(z.number().int().min(0));

/** Whether `v` holds a control character (C0 or DEL) — whitespace is collapsed first. */
const hasControl = (v: string): boolean => {
  for (let i = 0; i < v.length; i += 1) {
    const code = v.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
};

/** A label or a name as stored: inner whitespace collapsed, trimmed, 1–255, no control character. */
const singleLine = z
  .string()
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(255)
      .refine((v) => !hasControl(v), { error: "Must not contain control characters" }),
  );

/** A note of 3–2000 characters (a change note, a reason, a decision). */
const note = z.string().trim().min(3).max(2000);

/** A decimal as entered: a string or a number `parseDecimal` accepts. */
const decimal = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .refine((v) => v === null || v === undefined || parseDecimal(v).value !== null, {
    error: "Must be a plain decimal: one separator (, or .), no digit grouping",
  });

const shortText = (max: number): z.ZodOptional<z.ZodNullable<z.ZodString>> => z.string().trim().max(max).nullable().optional();

const outcomes = z
  .array(z.enum(INSPECTION_OUTCOMES))
  .max(INSPECTION_OUTCOMES.length)
  .refine((v) => new Set(v).size === v.length, { error: "Each outcome once" });

const lifecycleFilter = z.enum([...CATALOGUE_LIFECYCLE_STATUSES, "all"]);

// ==========================================
// AN ITEM'S CONTENT (§ 4.2, § 5, § 6)
// ==========================================

const head = { section: z.enum(INSPECTION_SECTIONS), label: singleLine, symbol: shortText(50) };
const ranges = { validMin: decimal, validMax: decimal, warnMin: decimal, warnMax: decimal };
const unit = z.string().trim().min(1).max(20);

/** The content of an item, by input kind (spec § 5.2). */
export const inspectionItemContent = z
  .discriminatedUnion("inputKind", [
    z.strictObject({ ...head, inputKind: z.literal("check"), allowedOutcomes: outcomes.optional() }),
    z.strictObject({ ...head, inputKind: z.literal("tri_state"), allowedOutcomes: outcomes.optional() }),
    z.strictObject({ ...head, inputKind: z.literal("condition_clean"), allowedOutcomes: outcomes.optional() }),
    z.strictObject({ ...head, inputKind: z.literal("text") }),
    z.strictObject({ ...head, inputKind: z.literal("measured"), unit, ...ranges, allowedOutcomes: outcomes.optional() }),
    z.strictObject({
      ...head,
      inputKind: z.literal("measured_with_limit"),
      unit,
      limitText: shortText(100),
      ...ranges,
      allowedOutcomes: outcomes.optional(),
    }),
    z.strictObject({
      ...head,
      inputKind: z.literal("setting_measured_reference"),
      unit,
      settingText: shortText(50),
      settingValue: decimal,
      limitText: shortText(100),
      ...ranges,
      allowedOutcomes: outcomes.optional(),
    }),
  ])
  .superRefine((value, ctx) => {
    for (const message of inspectionContentProblems(inspectionContentOf(value))) {
      ctx.addIssue({ code: "custom", message });
    }
  });
export type InspectionItemContentBody = z.output<typeof inspectionItemContent>;

// ==========================================
// DEVICE TYPES (§ 7.1)
// ==========================================

/** `GET /device-types` — every reader may ask for `retired` or `all` (a device's retired type still resolves). */
export const listDeviceTypesQuery = z.strictObject({
  search: z.string().trim().min(1).max(100).optional(),
  status: lifecycleFilter.default("active"),
  page,
  limit,
});
export type ListDeviceTypesQueryInput = z.output<typeof listDeviceTypesQuery>;

/** `:deviceTypeId`. */
export const deviceTypeIdParams = z.object({ deviceTypeId: uuid() });

/** `POST /device-types`. */
export const createDeviceType = z.strictObject({ name: singleLine });
export type CreateDeviceTypeInput = z.output<typeof createDeviceType>;

/** `PATCH /device-types/:deviceTypeId` — the body alone. */
export const renameDeviceTypeBody = z.strictObject({ name: singleLine });
/** `PATCH /device-types/:deviceTypeId` as the route validates it (params + body). */
export const renameDeviceType = z.strictObject({ deviceTypeId: uuid(), name: singleLine });
export type RenameDeviceTypeInput = z.output<typeof renameDeviceType>;

// ==========================================
// THE ITEM LIBRARY (operator)
// ==========================================

/** `GET /ipm/item-definitions`. */
export const listItemDefinitionsQuery = z.strictObject({
  section: z.enum(INSPECTION_SECTIONS).optional(),
  inputKind: z.enum(INSPECTION_INPUT_KINDS).optional(),
  status: lifecycleFilter.default("active"),
  search: z.string().trim().min(1).max(100).optional(),
  page,
  limit,
});
export type ListItemDefinitionsQueryInput = z.output<typeof listItemDefinitionsQuery>;

/** `:itemDefinitionId`. */
export const itemDefinitionIdParams = z.object({ itemDefinitionId: uuid() });

const definitionExtras = {
  defaultRequired: z.boolean().optional(),
  /** Operator-only: never copied into a version, never returned to a tenant. */
  notes: z.string().trim().max(2000).nullable().optional(),
};

/** `POST /ipm/item-definitions`. */
export const createItemDefinition = z.strictObject({ content: inspectionItemContent, ...definitionExtras });
export type CreateItemDefinitionInput = z.output<typeof createItemDefinition>;

const definitionChangeShape = { content: inspectionItemContent.optional(), ...definitionExtras };
const someChange = (v: Readonly<Record<string, unknown>>): boolean =>
  ["content", "defaultRequired", "notes"].some((k) => v[k] !== undefined);

/** `PATCH /ipm/item-definitions/:itemDefinitionId` — the body alone. */
export const updateItemDefinitionBody = z
  .strictObject(definitionChangeShape)
  .refine(someChange, { error: "Change at least one field" });
/** `PATCH /ipm/item-definitions/:itemDefinitionId` as the route validates it (params + body). */
export const updateItemDefinition = z
  .strictObject({ itemDefinitionId: uuid(), ...definitionChangeShape })
  .refine(someChange, { error: "Change at least one field" });
export type UpdateItemDefinitionInput = z.output<typeof updateItemDefinition>;

// ==========================================
// TEMPLATES AND VERSIONS (§ 7.2, § 7.3)
// ==========================================

/** `:templateId`. */
export const templateIdParams = z.object({ templateId: uuid() });
/** `:versionId`. */
export const templateVersionIdParams = z.object({ versionId: uuid() });

/** `GET /ipm/templates` (operator). */
export const listTemplatesQuery = z.strictObject({
  deviceTypeId: uuid().optional(),
  status: z.enum(CATALOGUE_LIFECYCLE_STATUSES).optional(),
  hasDraft: booleanish().optional(),
  page,
  limit,
});
export type ListTemplatesQueryInput = z.output<typeof listTemplatesQuery>;

/** `POST /ipm/templates` — a TYPE template (the base exists from migration 0112). */
export const createTemplate = z.strictObject({ deviceTypeId: uuid() });
export type CreateTemplateInput = z.output<typeof createTemplate>;

/** Where a new draft starts: the template's published version's own items, or nothing. */
export const DRAFT_SOURCES = Object.freeze(["published", "empty"] as const);
const copyFrom = z.enum(DRAFT_SOURCES).default("published");
/** `POST /ipm/templates/:templateId/versions` — the body alone. */
export const createDraftBody = z.strictObject({ copyFrom });
/** `POST /ipm/templates/:templateId/versions` (params + body). */
export const createDraft = z.strictObject({ templateId: uuid(), copyFrom });
export type CreateDraftInput = z.output<typeof createDraft>;

/** `GET /ipm/template-versions?templateId=` (operator): one template's history. */
export const listVersionsQuery = z.strictObject({
  templateId: uuid(),
  status: z.enum(TEMPLATE_VERSION_STATUSES).optional(),
  page,
  limit,
});
export type ListVersionsQueryInput = z.output<typeof listVersionsQuery>;

/**
 * One item of a draft: the library definition it is (the cross-version identity, G-8), whether it
 * is required, and its content — omitted, the definition's content is copied; given, it is the
 * operator's edit of the copy (same section and input kind as the definition, checked by the
 * service). The order of the array is the order inside each section.
 */
export const templateItemInput = z.strictObject({
  itemDefinitionId: uuid(),
  required: z.boolean().optional(),
  content: inspectionItemContent.optional(),
});
export type TemplateItemInput = z.output<typeof templateItemInput>;

const itemsShape = {
  revision,
  items: z.array(templateItemInput).max(MAX_VERSION_ITEMS),
};

/** The same definition twice, or more than 60 items of one section, is refused. */
const checkItems = (value: { items: readonly TemplateItemInput[] }, ctx: z.RefinementCtx): void => {
  const ids = value.items.map((i) => i.itemDefinitionId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", path: ["items"], message: "A definition appears twice in the draft" });
  }
  const perSection = new Map<string, number>();
  for (const item of value.items) {
    if (item.content) {
      perSection.set(item.content.section, (perSection.get(item.content.section) ?? 0) + 1);
    }
  }
  for (const [section, count] of perSection) {
    if (count > MAX_SECTION_ITEMS) {
      ctx.addIssue({ code: "custom", path: ["items"], message: `At most ${String(MAX_SECTION_ITEMS)} items in the ${section} section` });
    }
  }
};

/** `PUT /ipm/template-versions/:versionId/items` — the body alone. */
export const replaceDraftItemsBody = z.strictObject(itemsShape).superRefine(checkItems);
/** `PUT /ipm/template-versions/:versionId/items` (params + body): the draft's items, replaced wholesale. */
export const replaceDraftItems = z.strictObject({ versionId: uuid(), ...itemsShape }).superRefine(checkItems);
export type ReplaceDraftItemsInput = z.output<typeof replaceDraftItems>;

const noteShape = { revision, changeNote: note };
/** `PATCH /ipm/template-versions/:versionId` and `POST …/publish` — the body alone. */
export const draftNoteBody = z.strictObject(noteShape);
/** `PATCH /ipm/template-versions/:versionId` (params + body). */
export const updateDraft = z.strictObject({ versionId: uuid(), ...noteShape });
export type UpdateDraftInput = z.output<typeof updateDraft>;
/** `POST /ipm/template-versions/:versionId/publish` (params + body). */
export const publishVersion = updateDraft;
export type PublishVersionInput = UpdateDraftInput;

// ==========================================
// PROPOSALS (§ 4.6, § 7.4)
// ==========================================

/**
 * One proposed item — tenant text, never trusted as catalogue content (§ 7.4: nothing is copied
 * on acceptance). Every field optional but the section, label and kind; `itemDefinitionId` names
 * the item a change or a retirement is about.
 */
export const proposalItemInput = z
  .strictObject({
    itemDefinitionId: uuid().optional(),
    section: z.enum(INSPECTION_SECTIONS),
    label: singleLine,
    inputKind: z.enum(INSPECTION_INPUT_KINDS),
    unit: shortText(20),
    symbol: shortText(50),
    settingText: shortText(50),
    limitText: shortText(100),
    ...ranges,
    allowedOutcomes: outcomes.optional(),
    required: z.boolean().optional(),
    note: shortText(500),
  })
  .refine((v) => INSPECTION_SECTION_RULES[v.section].inputKinds.includes(v.inputKind), {
    error: "The section does not take that kind of item",
  });
export type ProposalItemInput = z.output<typeof proposalItemInput>;

/** What each proposal kind needs. */
const checkProposal = (
  value: { kind: string; deviceTypeId?: string | undefined; proposedDeviceTypeName?: string | undefined; proposedItems: readonly ProposalItemInput[] },
  ctx: z.RefinementCtx,
): void => {
  const isNew = value.kind === "new_device_type";
  if (isNew !== (value.proposedDeviceTypeName !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["proposedDeviceTypeName"], message: "A new-type proposal names the type; no other kind does" });
  }
  if (isNew === (value.deviceTypeId !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["deviceTypeId"], message: "Name the device type the proposal is about (not for a new type)" });
  }
  if (value.kind !== "new_device_type" && value.proposedItems.length === 0) {
    ctx.addIssue({ code: "custom", path: ["proposedItems"], message: "Propose at least one item" });
  }
  if (
    (value.kind === "change_items" || value.kind === "retire_items") &&
    value.proposedItems.some((i) => i.itemDefinitionId === undefined)
  ) {
    ctx.addIssue({ code: "custom", path: ["proposedItems"], message: "A change or a retirement names the item it is about" });
  }
};

/** `POST /ipm/template-proposals`. The tenant is the caller's, never the body's. */
export const createProposal = z
  .strictObject({
    kind: z.enum(TEMPLATE_PROPOSAL_KINDS),
    deviceTypeId: uuid().optional(),
    proposedDeviceTypeName: singleLine.optional(),
    basedOnVersionId: uuid().optional(),
    proposedItems: z.array(proposalItemInput).max(MAX_PROPOSAL_ITEMS).default([]),
    reason: note,
  })
  .superRefine(checkProposal);
export type CreateProposalInput = z.output<typeof createProposal>;

/** `:proposalId`. */
export const proposalIdParams = z.object({ proposalId: uuid() });

/** `GET /ipm/template-proposals` and the operator queue. */
export const listProposalsQuery = z.strictObject({
  status: z.enum(TEMPLATE_PROPOSAL_STATUSES).optional(),
  page,
  limit,
});
export type ListProposalsQueryInput = z.output<typeof listProposalsQuery>;

const acceptShape = { decisionNote: note.optional(), deviceTypeId: uuid().optional() };
/** `POST /admin/ipm/template-proposals/:proposalId/accept` — the body alone. */
export const acceptProposalBody = z.strictObject(acceptShape);
/** Accept (params + body); `deviceTypeId` names the type the operator created for a new-type proposal. */
export const acceptProposal = z.strictObject({ proposalId: uuid(), ...acceptShape });
export type AcceptProposalInput = z.output<typeof acceptProposal>;

/** `POST /admin/ipm/template-proposals/:proposalId/reject` — the body alone (the note is required). */
export const rejectProposalBody = z.strictObject({ decisionNote: note });
/** Reject (params + body). */
export const rejectProposal = z.strictObject({ proposalId: uuid(), decisionNote: note });
export type RejectProposalInput = z.output<typeof rejectProposal>;
