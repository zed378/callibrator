/**
 * P21-01 (ADR-103, ADR-125) — the inspection catalogue's answers as the routes give them, shared by
 * deviceTypes.openapi.ts, ipm.openapi.ts and admin.openapi.ts. Response documentation only: nothing
 * validates against it. The fields are the views of services/inspectionCatalogue.shared,
 * services/inspectionItemDefinition, services/inspectionTemplate and services/inspectionProposal:
 * no actor (`createdBy`, `publishedBy`, `decidedBy`), no legacy key, and `notes` only on the
 * operator's definition view. Examples are synthetic.
 */
import { z } from "zod";
import {
  INSPECTION_INPUT_KINDS,
  INSPECTION_LIMIT_OPS,
  INSPECTION_OUTCOMES,
  INSPECTION_SECTIONS,
  TEMPLATE_ITEM_ORIGINS,
  TEMPLATE_PROPOSAL_KINDS,
} from "@callibrator/contracts/inspectionValues";
import { CATALOGUE_LIFECYCLE_STATUSES, TEMPLATE_PROPOSAL_STATUSES, TEMPLATE_VERSION_STATUSES } from "@callibrator/contracts/states";

const decimal = z.string().nullable().meta({ description: "An exact decimal as a string (never a binary float)", example: "0.5" });
const nullableText = z.string().nullable();
const at = z.iso.datetime();

export const DeviceType = z
  .object({ id: z.guid(), name: z.string(), status: z.enum(CATALOGUE_LIFECYCLE_STATUSES) })
  .meta({
    id: "DeviceType",
    description: "A device type of the global inspection catalogue (ADR-125)",
    example: { id: "d7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7", name: "Test Device Type A", status: "active" },
  });

const content = {
  section: z.enum(INSPECTION_SECTIONS),
  label: z.string(),
  inputKind: z.enum(INSPECTION_INPUT_KINDS),
  unit: nullableText,
  symbol: nullableText,
  settingText: nullableText,
  settingValue: decimal,
  limitOp: z.enum(INSPECTION_LIMIT_OPS).nullable(),
  limitValue: decimal,
  limitLow: decimal,
  limitHigh: decimal,
  limitNominal: decimal,
  limitTolerance: decimal,
  limitText: nullableText.meta({ description: "The limit as written — what the report prints" }),
  validMin: decimal,
  validMax: decimal,
  warnMin: decimal,
  warnMax: decimal,
  allowedOutcomes: z.array(z.enum(INSPECTION_OUTCOMES)),
};

export const ItemDefinition = z
  .object({
    id: z.guid(),
    ...content,
    defaultRequired: z.boolean(),
    notes: nullableText.meta({ description: "Operator-only; never copied into a version" }),
    status: z.enum(CATALOGUE_LIFECYCLE_STATUSES),
    createdAt: at,
    updatedAt: at,
  })
  .meta({ id: "InspectionItemDefinition", description: "A library item definition (operator only)" });

export const TemplateItem = z
  .object({
    id: z.guid().meta({ description: "The id a session's result pins" }),
    itemDefinitionId: z.guid(),
    origin: z.enum(TEMPLATE_ITEM_ORIGINS),
    ...content,
    required: z.boolean(),
    sortOrder: z.number().int(),
  })
  .meta({ id: "InspectionTemplateItem", description: "One item of a checklist version, frozen with it" });

const versionHeader = {
  id: z.guid(),
  templateId: z.guid(),
  deviceTypeId: z.guid().nullable().meta({ description: "null for the base checklist" }),
  status: z.enum(TEMPLATE_VERSION_STATUSES),
  versionNumber: z.number().int().nullable(),
  baseVersionId: z.guid().nullable(),
  rebasedFromVersionId: z.guid().nullable(),
  contentHash: nullableText.meta({ description: "SHA-256 (hex) of the canonical content (spec § 7.6)" }),
  changeNote: nullableText,
  revision: z.number().int(),
  publishedAt: at.nullable(),
  retiredAt: at.nullable(),
  discardedAt: at.nullable(),
  createdAt: at,
  updatedAt: at,
};

export const TemplateVersionSummary = z
  .object(versionHeader)
  .meta({ id: "InspectionTemplateVersionSummary", description: "A checklist version's header (no items)" });

export const TemplateVersion = z
  .object({ ...versionHeader, items: z.array(TemplateItem) })
  .meta({ id: "InspectionTemplateVersion", description: "A checklist version with its items in read order" });

export const TemplateListRow = z
  .object({
    id: z.guid(),
    deviceTypeId: z.guid().nullable(),
    deviceTypeName: nullableText,
    status: z.enum(CATALOGUE_LIFECYCLE_STATUSES),
    publishedVersion: z.object({ id: z.guid(), versionNumber: z.number().int().nullable(), publishedAt: at.nullable() }).nullable(),
    openDraft: z.object({ id: z.guid(), revision: z.number().int(), createdAt: at }).nullable(),
    createdAt: at,
  })
  .meta({ id: "InspectionTemplate", description: "A checklist template with its published version and open draft (operator)" });

export const PublishResult = z
  .object({ version: TemplateVersion, retiredVersionId: z.guid().nullable(), rebasedVersionIds: z.array(z.guid()) })
  .meta({ id: "InspectionPublishResult", description: "The published version, the one it retired and (for the base) the rebased type versions" });

export const PublishedCatalogue = z
  .object({
    schema: z.literal("inspection-catalogue-v1"),
    deviceTypes: z.array(z.object({ id: z.guid(), name: z.string() })),
    versions: z.array(
      z.object({
        id: z.guid(),
        templateId: z.guid(),
        deviceTypeId: z.guid().nullable(),
        versionNumber: z.number().int().nullable(),
        baseVersionId: z.guid().nullable(),
        contentHash: nullableText,
        publishedAt: at.nullable(),
        items: z.array(TemplateItem),
      }),
    ),
  })
  .meta({ id: "InspectionPublishedCatalogue", description: "The active device types and every published checklist version (ADR-127 offline download)" });

const proposalFields = {
  id: z.guid(),
  kind: z.enum(TEMPLATE_PROPOSAL_KINDS),
  deviceTypeId: z.guid().nullable(),
  proposedDeviceTypeName: nullableText,
  basedOnVersionId: z.guid().nullable(),
  proposedItems: z.array(z.record(z.string(), z.unknown())),
  reason: z.string(),
  status: z.enum(TEMPLATE_PROPOSAL_STATUSES),
  submittedBy: z.guid(),
  decidedAt: at.nullable(),
  decisionNote: nullableText,
  resultingVersionId: z.guid().nullable().meta({ description: "The draft an acceptance opened or linked" }),
  withdrawnAt: at.nullable(),
  createdAt: at,
  updatedAt: at,
};

export const TemplateProposal = z
  .object(proposalFields)
  .meta({ id: "InspectionTemplateProposal", description: "A tenant's proposal for the catalogue (its own tenant's only)" });

export const TemplateProposalQueueRow = z
  .object({
    ...proposalFields,
    tenantId: z.guid(),
    tenantName: z.string().nullable().meta({ description: "The tenant's display name only (null when the tenant row is gone)" }),
  })
  .meta({ id: "InspectionTemplateProposalQueueRow", description: "A proposal in the operator's queue, with its tenant" });
