/**
 * The IPM checklist catalogue and the tenants' proposals: `/api/v1/ipm` (index.ts mounts it).
 * P21-01 (ADR-125 § 2 – § 6, Am. 1 – 3; spec MEMORY/specs/P19-01-inspection-catalogue.md § 8).
 *
 *  - CATALOGUE READS — the published document (`GET /templates/published`, strong ETag, 304) and
 *    one version by id: any catalogue reader (`calibration` | `ipm` | `ipm-templates` read, G-2),
 *    marked facility-accessible (global content). A draft's id is a 404 to anyone but the operator.
 *  - OPERATOR — the item library, templates, drafts, publish, discard, the version history: the
 *    platform operator only (`superAdminOnly`, JWT only), every write on
 *    tests/guards/inspectionCatalogueGlobal.guard's inventory; `:id` routes allow-listed
 *    `platform` in twoTenantRoutes.guard.
 *  - PROPOSALS (tenant side) — `ipm-templates` read / write, NOT facility-accessible (a proposal is
 *    provider business: a bound principal meets 403 here and DENY in the hooks); writes refuse an
 *    API key; another tenant's proposal is a 404 (ipmTemplateProposals.twoTenant). The operator's
 *    queue and decisions are on the admin router.
 *
 * Contract: ipm.openapi.ts (ADR-103).
 */
import { Router } from "express";
import { auth, denyApiKey, superAdminOnly } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validate } from "../../middlewares/validation.middleware";
import {
  createDraft,
  createItemDefinition,
  createProposal,
  createTemplate,
  itemDefinitionIdParams,
  listItemDefinitionsQuery,
  listProposalsQuery,
  listTemplatesQuery,
  listVersionsQuery,
  proposalIdParams,
  publishVersion,
  replaceDraftItems,
  templateIdParams,
  templateVersionIdParams,
  updateDraft,
  updateItemDefinition,
} from "@callibrator/contracts/inspectionCatalogue";
import {
  createChecklist,
  createDefinition,
  discard,
  getChecklistVersion,
  getDefinition,
  getOwnProposal,
  listChecklists,
  listChecklistVersions,
  listDefinitions,
  listOwnProposals,
  openDraft,
  publish,
  published,
  reactivateChecklist,
  replaceItems,
  retireChecklist,
  retireDefinition,
  submitProposal,
  updateDefinition,
  updateNote,
  withdrawOwnProposal,
} from "../../controllers/inspectionCatalogue.controller";

const router = Router();

// ── Catalogue reads ──────────────────────────────────────────────────────────
router.get("/templates/published", auth, dynamicAccess(["calibration", "ipm", "ipm-templates"], "read"), published);
router.get(
  "/template-versions/:versionId",
  auth,
  dynamicAccess(["calibration", "ipm", "ipm-templates"], "read"),
  validate(templateVersionIdParams, { from: "params" }),
  getChecklistVersion,
);

// ── Operator: the item library ───────────────────────────────────────────────
router.get("/item-definitions", auth, denyApiKey, superAdminOnly, validate(listItemDefinitionsQuery, { from: "query" }), listDefinitions);
router.get(
  "/item-definitions/:itemDefinitionId",
  auth,
  denyApiKey,
  superAdminOnly,
  validate(itemDefinitionIdParams, { from: "params" }),
  getDefinition,
);
router.post("/item-definitions", auth, denyApiKey, superAdminOnly, validate(createItemDefinition), createDefinition);
router.patch(
  "/item-definitions/:itemDefinitionId",
  auth,
  denyApiKey,
  superAdminOnly,
  validate(updateItemDefinition, { from: ["params", "body"] }),
  updateDefinition,
);
router.post(
  "/item-definitions/:itemDefinitionId/retire",
  auth,
  denyApiKey,
  superAdminOnly,
  validate(itemDefinitionIdParams, { from: "params" }),
  retireDefinition,
);

// ── Operator: templates and versions ─────────────────────────────────────────
router.get("/templates", auth, denyApiKey, superAdminOnly, validate(listTemplatesQuery, { from: "query" }), listChecklists);
router.post("/templates", auth, denyApiKey, superAdminOnly, validate(createTemplate), createChecklist);
router.post("/templates/:templateId/retire", auth, denyApiKey, superAdminOnly, validate(templateIdParams, { from: "params" }), retireChecklist);
router.post(
  "/templates/:templateId/reactivate",
  auth,
  denyApiKey,
  superAdminOnly,
  validate(templateIdParams, { from: "params" }),
  reactivateChecklist,
);
router.post("/templates/:templateId/versions", auth, denyApiKey, superAdminOnly, validate(createDraft, { from: ["params", "body"] }), openDraft);
router.get("/template-versions", auth, denyApiKey, superAdminOnly, validate(listVersionsQuery, { from: "query" }), listChecklistVersions);
router.put(
  "/template-versions/:versionId/items",
  auth,
  denyApiKey,
  superAdminOnly,
  validate(replaceDraftItems, { from: ["params", "body"] }),
  replaceItems,
);
router.patch("/template-versions/:versionId", auth, denyApiKey, superAdminOnly, validate(updateDraft, { from: ["params", "body"] }), updateNote);
router.post(
  "/template-versions/:versionId/publish",
  auth,
  denyApiKey,
  superAdminOnly,
  validate(publishVersion, { from: ["params", "body"] }),
  publish,
);
router.post(
  "/template-versions/:versionId/discard",
  auth,
  denyApiKey,
  superAdminOnly,
  validate(templateVersionIdParams, { from: "params" }),
  discard,
);

// ── Proposals (tenant side) ──────────────────────────────────────────────────
router.get("/template-proposals", auth, dynamicAccess("ipm-templates", "read"), validate(listProposalsQuery, { from: "query" }), listOwnProposals);
router.post("/template-proposals", auth, denyApiKey, dynamicAccess("ipm-templates", "write"), validate(createProposal), submitProposal);
router.get(
  "/template-proposals/:proposalId",
  auth,
  dynamicAccess("ipm-templates", "read"),
  validate(proposalIdParams, { from: "params" }),
  getOwnProposal,
);
router.post(
  "/template-proposals/:proposalId/withdraw",
  auth,
  denyApiKey,
  dynamicAccess("ipm-templates", "write"),
  validate(proposalIdParams, { from: "params" }),
  withdrawOwnProposal,
);

export = router;
