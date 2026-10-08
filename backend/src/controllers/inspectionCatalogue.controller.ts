/**
 * The inspection catalogue's handlers (P21-01; ADR-125; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 8.2, § 8.3): device types, the item library,
 * templates and versions, the published catalogue document, and the proposals (tenant side and
 * the operator's queue). Every body, query and parameter arrives validated
 * (`validate(schema, { from })` on the route) and is read with `validated(req, schema)`; a
 * proposal's tenant comes from the request context, never from input.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import { auditPrincipal } from "../utils/auditPrincipal.util";
import { isSuperAdmin } from "../utils/role.util";
import {
  acceptProposal as acceptProposalSchema,
  createDeviceType as createDeviceTypeSchema,
  createDraft as createDraftSchema,
  createItemDefinition as createItemDefinitionSchema,
  createProposal as createProposalSchema,
  createTemplate as createTemplateSchema,
  deviceTypeIdParams,
  itemDefinitionIdParams,
  listDeviceTypesQuery,
  listItemDefinitionsQuery,
  listProposalsQuery,
  listTemplatesQuery,
  listVersionsQuery,
  proposalIdParams,
  publishVersion as publishVersionSchema,
  rejectProposal as rejectProposalSchema,
  renameDeviceType as renameDeviceTypeSchema,
  replaceDraftItems as replaceDraftItemsSchema,
  templateIdParams,
  templateVersionIdParams,
  updateDraft as updateDraftSchema,
  updateItemDefinition as updateItemDefinitionSchema,
} from "@callibrator/contracts/inspectionCatalogue";
import { createDeviceType, getDeviceType, listDeviceTypes, renameDeviceType, setDeviceTypeStatus } from "../services/deviceType.service";
import {
  createItemDefinition,
  getItemDefinition,
  listItemDefinitions,
  retireItemDefinition,
  updateItemDefinition,
} from "../services/inspectionItemDefinition.service";
import {
  createDraft,
  createTemplate,
  discardDraft,
  getVersion,
  listTemplates,
  listVersions,
  publishedCatalogue,
  publishedCatalogueEtag,
  publishVersion,
  replaceDraftItems,
  setTemplateStatus,
  updateDraftNote,
} from "../services/inspectionTemplate.service";
import {
  acceptProposal,
  createProposal,
  getProposal,
  listProposalQueue,
  listProposals,
  rejectProposal,
  withdrawProposal,
} from "../services/inspectionProposal.service";
import {
  toDeviceTypeId,
  toInspectionItemDefinitionId,
  toInspectionTemplateId,
  toInspectionTemplateProposalId,
  toInspectionTemplateVersionId,
  type TenantId,
} from "../types/ids";

// ------------------------------------------------------------------
// DEVICE TYPES
// ------------------------------------------------------------------

/** GET /device-types. */
export const listTypes = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listDeviceTypes(validated(req, listDeviceTypesQuery));
  success(res, rows, meta, "Device types retrieved", 200);
});

/** GET /device-types/:deviceTypeId. */
export const getType = asyncHandler(async (req: Request, res: Response) => {
  const { deviceTypeId } = validated(req, deviceTypeIdParams);
  success(res, await getDeviceType(toDeviceTypeId(deviceTypeId)), "Device type retrieved", 200);
});

/** POST /device-types. */
export const createType = asyncHandler(async (req: Request, res: Response) => {
  success(res, await createDeviceType(validated(req, createDeviceTypeSchema), auditPrincipal(req)), "Device type created", 201);
});

/** PATCH /device-types/:deviceTypeId. */
export const renameType = asyncHandler(async (req: Request, res: Response) => {
  const { deviceTypeId, name } = validated(req, renameDeviceTypeSchema);
  success(res, await renameDeviceType(toDeviceTypeId(deviceTypeId), name, auditPrincipal(req)), "Device type renamed", 200);
});

/** POST /device-types/:deviceTypeId/retire. */
export const retireType = asyncHandler(async (req: Request, res: Response) => {
  const { deviceTypeId } = validated(req, deviceTypeIdParams);
  success(res, await setDeviceTypeStatus(toDeviceTypeId(deviceTypeId), "retired", auditPrincipal(req)), "Device type retired", 200);
});

/** POST /device-types/:deviceTypeId/reactivate. */
export const reactivateType = asyncHandler(async (req: Request, res: Response) => {
  const { deviceTypeId } = validated(req, deviceTypeIdParams);
  success(res, await setDeviceTypeStatus(toDeviceTypeId(deviceTypeId), "active", auditPrincipal(req)), "Device type reactivated", 200);
});

// ------------------------------------------------------------------
// THE ITEM LIBRARY (operator)
// ------------------------------------------------------------------

/** GET /ipm/item-definitions. */
export const listDefinitions = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listItemDefinitions(validated(req, listItemDefinitionsQuery));
  success(res, rows, meta, "Item definitions retrieved", 200);
});

/** GET /ipm/item-definitions/:itemDefinitionId. */
export const getDefinition = asyncHandler(async (req: Request, res: Response) => {
  const { itemDefinitionId } = validated(req, itemDefinitionIdParams);
  success(res, await getItemDefinition(toInspectionItemDefinitionId(itemDefinitionId)), "Item definition retrieved", 200);
});

/** POST /ipm/item-definitions. */
export const createDefinition = asyncHandler(async (req: Request, res: Response) => {
  success(res, await createItemDefinition(validated(req, createItemDefinitionSchema), auditPrincipal(req)), "Item definition created", 201);
});

/** PATCH /ipm/item-definitions/:itemDefinitionId. */
export const updateDefinition = asyncHandler(async (req: Request, res: Response) => {
  success(res, await updateItemDefinition(validated(req, updateItemDefinitionSchema), auditPrincipal(req)), "Item definition updated", 200);
});

/** POST /ipm/item-definitions/:itemDefinitionId/retire. */
export const retireDefinition = asyncHandler(async (req: Request, res: Response) => {
  const { itemDefinitionId } = validated(req, itemDefinitionIdParams);
  success(res, await retireItemDefinition(toInspectionItemDefinitionId(itemDefinitionId), auditPrincipal(req)), "Item definition retired", 200);
});

// ------------------------------------------------------------------
// TEMPLATES AND VERSIONS
// ------------------------------------------------------------------

/** GET /ipm/templates (operator). */
export const listChecklists = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listTemplates(validated(req, listTemplatesQuery));
  success(res, rows, meta, "Checklist templates retrieved", 200);
});

/** POST /ipm/templates. */
export const createChecklist = asyncHandler(async (req: Request, res: Response) => {
  const { deviceTypeId } = validated(req, createTemplateSchema);
  success(res, await createTemplate(toDeviceTypeId(deviceTypeId), auditPrincipal(req)), "Checklist template created", 201);
});

/** POST /ipm/templates/:templateId/retire. */
export const retireChecklist = asyncHandler(async (req: Request, res: Response) => {
  const { templateId } = validated(req, templateIdParams);
  success(res, await setTemplateStatus(toInspectionTemplateId(templateId), "retired", auditPrincipal(req)), "Checklist template retired", 200);
});

/** POST /ipm/templates/:templateId/reactivate. */
export const reactivateChecklist = asyncHandler(async (req: Request, res: Response) => {
  const { templateId } = validated(req, templateIdParams);
  success(res, await setTemplateStatus(toInspectionTemplateId(templateId), "active", auditPrincipal(req)), "Checklist template reactivated", 200);
});

/** POST /ipm/templates/:templateId/versions — open a draft. */
export const openDraft = asyncHandler(async (req: Request, res: Response) => {
  success(res, await createDraft(validated(req, createDraftSchema), auditPrincipal(req)), "Draft created", 201);
});

/** GET /ipm/template-versions?templateId= (operator). */
export const listChecklistVersions = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listVersions(validated(req, listVersionsQuery));
  success(res, rows, meta, "Checklist versions retrieved", 200);
});

/** GET /ipm/template-versions/:versionId — a draft is the operator's (404 to anyone else). */
export const getChecklistVersion = asyncHandler(async (req: Request, res: Response) => {
  const { versionId } = validated(req, templateVersionIdParams);
  success(res, await getVersion(toInspectionTemplateVersionId(versionId), isSuperAdmin(req.user)), "Checklist version retrieved", 200);
});

/** PUT /ipm/template-versions/:versionId/items. */
export const replaceItems = asyncHandler(async (req: Request, res: Response) => {
  success(res, await replaceDraftItems(validated(req, replaceDraftItemsSchema), auditPrincipal(req)), "Draft items saved", 200);
});

/** PATCH /ipm/template-versions/:versionId — the change note. */
export const updateNote = asyncHandler(async (req: Request, res: Response) => {
  success(res, await updateDraftNote(validated(req, updateDraftSchema), auditPrincipal(req)), "Draft saved", 200);
});

/** POST /ipm/template-versions/:versionId/publish. */
export const publish = asyncHandler(async (req: Request, res: Response) => {
  success(res, await publishVersion(validated(req, publishVersionSchema), auditPrincipal(req)), "Checklist version published", 200);
});

/** POST /ipm/template-versions/:versionId/discard. */
export const discard = asyncHandler(async (req: Request, res: Response) => {
  const { versionId } = validated(req, templateVersionIdParams);
  success(res, await discardDraft(toInspectionTemplateVersionId(versionId), auditPrincipal(req)), "Draft discarded", 200);
});

/**
 * GET /ipm/templates/published — the catalogue document (§ 8.3), with its strong ETag computed
 * BEFORE the document is read: a matching `If-None-Match` is a 304 with no body and no item read.
 * The route sets its own validator (Express's automatic weak ETag never replaces a set one).
 */
export const published = asyncHandler(async (req: Request, res: Response) => {
  const etag = await publishedCatalogueEtag();
  res.set({ ETag: etag, "Cache-Control": "private, no-cache" });
  const asked = (req.headers["if-none-match"] ?? "")
    .split(",")
    .map((t) => t.trim());
  if (asked.includes(etag)) {
    res.status(304).end();
    return;
  }
  success(res, await publishedCatalogue(), "Published catalogue retrieved", 200);
});

// ------------------------------------------------------------------
// PROPOSALS
// ------------------------------------------------------------------

/** GET /ipm/template-proposals — the caller's tenant's. */
export const listOwnProposals = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listProposals(validated(req, listProposalsQuery));
  success(res, rows, meta, "Proposals retrieved", 200);
});

/** GET /ipm/template-proposals/:proposalId. */
export const getOwnProposal = asyncHandler(async (req: Request, res: Response) => {
  const { proposalId } = validated(req, proposalIdParams);
  success(res, await getProposal(toInspectionTemplateProposalId(proposalId)), "Proposal retrieved", 200);
});

/** POST /ipm/template-proposals. */
export const submitProposal = asyncHandler(async (req: Request, res: Response) => {
  success(res, await createProposal(req.tenantId as TenantId, validated(req, createProposalSchema), auditPrincipal(req)), "Proposal submitted", 201);
});

/** POST /ipm/template-proposals/:proposalId/withdraw. */
export const withdrawOwnProposal = asyncHandler(async (req: Request, res: Response) => {
  const { proposalId } = validated(req, proposalIdParams);
  success(res, await withdrawProposal(toInspectionTemplateProposalId(proposalId), auditPrincipal(req)), "Proposal withdrawn", 200);
});

/** GET /admin/ipm/template-proposals — the operator's queue across tenants. */
export const proposalQueue = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listProposalQueue(validated(req, listProposalsQuery));
  success(res, rows, meta, "Proposal queue retrieved", 200);
});

/** POST /admin/ipm/template-proposals/:proposalId/accept. */
export const accept = asyncHandler(async (req: Request, res: Response) => {
  success(res, await acceptProposal(validated(req, acceptProposalSchema), auditPrincipal(req)), "Proposal accepted", 200);
});

/** POST /admin/ipm/template-proposals/:proposalId/reject. */
export const reject = asyncHandler(async (req: Request, res: Response) => {
  success(res, await rejectProposal(validated(req, rejectProposalSchema), auditPrincipal(req)), "Proposal rejected", 200);
});
