/**
 * The contract of `ipm.route.ts`, code-first (ADR-103): the IPM checklist catalogue — the published
 * document and versions (any catalogue reader), the operator's library, templates and drafts, and
 * the tenants' proposals (P21-01; ADR-125; spec MEMORY/specs/P19-01-inspection-catalogue.md § 7,
 * § 8). Examples are synthetic.
 */
import { z } from "zod";
import {
  createDraftBody,
  createItemDefinition,
  createProposal,
  createTemplate,
  draftNoteBody,
  itemDefinitionIdParams,
  listItemDefinitionsQuery,
  listProposalsQuery,
  listTemplatesQuery,
  listVersionsQuery,
  proposalIdParams,
  replaceDraftItemsBody,
  templateIdParams,
  templateVersionIdParams,
  updateItemDefinitionBody,
} from "@callibrator/contracts/inspectionCatalogue";
import { CATALOGUE_LIFECYCLE_STATUSES } from "@callibrator/contracts/states";
import { defineRouteDocs } from "../../docs/openapi/operation";
import {
  ItemDefinition,
  PublishedCatalogue,
  PublishResult,
  TemplateListRow,
  TemplateProposal,
  TemplateVersion,
  TemplateVersionSummary,
} from "../../docs/openapi/inspectionCatalogueSchemas";

const id = (schema: z.ZodType, description: string): z.ZodType => schema.meta({ description, example: "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4" });
const versionParams = z.object({ versionId: id(templateVersionIdParams.shape.versionId, "The checklist version's id") });
const templateParams = z.object({ templateId: id(templateIdParams.shape.templateId, "The checklist template's id") });
const definitionParams = z.object({ itemDefinitionId: id(itemDefinitionIdParams.shape.itemDefinitionId, "The item definition's id") });
const proposalParams = z.object({ proposalId: id(proposalIdParams.shape.proposalId, "The proposal's id") });

const read = { kind: "dynamicAccess", resource: ["calibration", "ipm", "ipm-templates"], action: "read" } as const;
const operator = { kind: "superAdminOnly" } as const;
const OPERATOR = "The platform operator only (super admin; an API key is refused).";
const AUDITED = "Audited under the platform tenant, inside the transaction.";
const DRAFT_STATE =
  "The version is not an open draft (published, retired or discarded — the message names its state and when), or the body's " +
  "`revision` is not the draft's (another save came first: reload).";
const UNMARKED = "Not available to a facility-bound account (403 FACILITY_ROUTE_REFUSED).";

export default defineRouteDocs({
  router: "api/ipm.route",
  mount: "/api/v1/ipm",
  tag: "Inspection Catalogue",
  tenantScoped: false,
  operations: [
    {
      method: "get",
      path: "/templates/published",
      operationId: "getPublishedInspectionCatalogue",
      summary: "The published checklist catalogue",
      description:
        "Every published checklist version with its items in read order, and the active device types — one document, not a page. " +
        "A strong `ETag` covers both (version id : content hash, device type id : name); a matching `If-None-Match` answers **304** " +
        "with no body. `Cache-Control: private, no-cache`. Any one of `calibration`, `ipm` or `ipm-templates` read; reachable by a " +
        "facility-bound account (global content). No actor is returned.",
      permission: read,
      audited: false,
      success: { status: 200, description: "The catalogue document", data: PublishedCatalogue },
    },
    {
      method: "get",
      path: "/template-versions/:versionId",
      operationId: "getInspectionTemplateVersion",
      summary: "One checklist version",
      description:
        "A published or retired version with its items (old sessions pin retired ones; the report renders from it). A draft or a " +
        "discarded draft is the operator's: anyone else gets 404, identical to a missing id.",
      permission: read,
      audited: false,
      params: versionParams,
      success: { status: 200, description: "The version", data: TemplateVersion },
    },
    {
      method: "get",
      path: "/item-definitions",
      operationId: "listInspectionItemDefinitions",
      summary: "List the item library",
      description: `By section, label, id. ${OPERATOR}`,
      permission: operator,
      audited: false,
      query: listItemDefinitionsQuery,
      success: { status: 200, description: "A page of definitions; pagination in the top-level `meta`", list: ItemDefinition },
    },
    {
      method: "get",
      path: "/item-definitions/:itemDefinitionId",
      operationId: "getInspectionItemDefinition",
      summary: "One item definition",
      description: OPERATOR,
      permission: operator,
      audited: false,
      params: definitionParams,
      success: { status: 200, description: "The definition", data: ItemDefinition },
    },
    {
      method: "post",
      path: "/item-definitions",
      operationId: "createInspectionItemDefinition",
      summary: "Add an item to the library",
      description:
        "The content is a union on `inputKind`; the limit is TEXT (`limitText`), parsed by the server (`≤ 0,5 mA`, `± 10 %`, " +
        `\`N – N °C\`; anything else is kept as text and never evaluated). A unit mismatch between the limit and the item is a 400. ${OPERATOR} ${AUDITED}`,
      permission: operator,
      audited: true,
      body: createItemDefinition,
      success: { status: 201, description: "The definition", data: ItemDefinition },
    },
    {
      method: "patch",
      path: "/item-definitions/:itemDefinitionId",
      operationId: "updateInspectionItemDefinition",
      summary: "Edit a library item",
      description:
        "An active definition: its content (same section and input kind — 400 otherwise), its default and its notes. Drafts and " +
        `versions hold copies: only a later copy sees the edit. ${OPERATOR} ${AUDITED}`,
      permission: operator,
      audited: true,
      params: definitionParams,
      body: updateItemDefinitionBody,
      conflict: "The definition is retired.",
      success: { status: 200, description: "The definition", data: ItemDefinition },
    },
    {
      method: "post",
      path: "/item-definitions/:itemDefinitionId/retire",
      operationId: "retireInspectionItemDefinition",
      summary: "Retire a library item",
      description: `It can no longer be added to a draft; existing copies are untouched. ${OPERATOR} ${AUDITED}`,
      permission: operator,
      audited: true,
      params: definitionParams,
      conflict: "The definition is already retired.",
      success: { status: 200, description: "The definition", data: ItemDefinition },
    },
    {
      method: "get",
      path: "/templates",
      operationId: "listInspectionTemplates",
      summary: "List checklist templates",
      description: `With each one's published version and open draft. ${OPERATOR}`,
      permission: operator,
      audited: false,
      query: listTemplatesQuery,
      success: { status: 200, description: "A page of templates; pagination in the top-level `meta`", list: TemplateListRow },
    },
    {
      method: "post",
      path: "/templates",
      operationId: "createInspectionTemplate",
      summary: "Create a device type's checklist",
      description: `One per device type, for an active type (the base checklist exists from the start). ${OPERATOR} ${AUDITED}`,
      permission: operator,
      audited: true,
      body: createTemplate,
      conflict: "The device type is retired, or already has a checklist.",
      success: { status: 201, description: "The template (no version yet)", data: TemplateListRow },
    },
    {
      method: "post",
      path: "/templates/:templateId/retire",
      operationId: "retireInspectionTemplate",
      summary: "Retire a checklist",
      description: `Its published version is retired with it; new sessions for the type use the base checklist. ${OPERATOR} ${AUDITED}`,
      permission: operator,
      audited: true,
      params: templateParams,
      conflict: "The template is already retired, or it is the base checklist (never retired).",
      success: {
        status: 200,
        description: "The template's status and the version retired with it",
        data: z.object({ id: z.guid(), status: z.enum(CATALOGUE_LIFECYCLE_STATUSES), retiredVersionId: z.guid().nullable() }),
      },
    },
    {
      method: "post",
      path: "/templates/:templateId/reactivate",
      operationId: "reactivateInspectionTemplate",
      summary: "Reactivate a checklist",
      description: `It has no published version until its next publish. ${OPERATOR} ${AUDITED}`,
      permission: operator,
      audited: true,
      params: templateParams,
      conflict: "The template is active, or it is the base checklist.",
      success: {
        status: 200,
        description: "The template's status",
        data: z.object({ id: z.guid(), status: z.enum(CATALOGUE_LIFECYCLE_STATUSES), retiredVersionId: z.guid().nullable() }),
      },
    },
    {
      method: "post",
      path: "/templates/:templateId/versions",
      operationId: "createInspectionTemplateDraft",
      summary: "Open a draft",
      description: `Empty, or (default) a copy of the published version's own items. One open draft per template. ${OPERATOR} ${AUDITED}`,
      permission: operator,
      audited: true,
      params: templateParams,
      body: createDraftBody,
      conflict: "The template already has an open draft, or it is retired.",
      success: { status: 201, description: "The draft", data: TemplateVersion },
    },
    {
      method: "get",
      path: "/template-versions",
      operationId: "listInspectionTemplateVersions",
      summary: "One checklist's version history",
      description: `Every status, newest first. ${OPERATOR}`,
      permission: operator,
      audited: false,
      query: listVersionsQuery,
      success: { status: 200, description: "A page of version headers; pagination in the top-level `meta`", list: TemplateVersionSummary },
    },
    {
      method: "put",
      path: "/template-versions/:versionId/items",
      operationId: "replaceInspectionDraftItems",
      summary: "Save a draft's items",
      description:
        "Replaces the draft's items wholesale, at the `revision` the editor read; the revision moves on. Each item names its library " +
        "definition (an active one); its content, when given, is the operator's edit of the copy. The array order is the order inside " +
        `each section. ${OPERATOR} ${AUDITED}`,
      permission: operator,
      audited: true,
      params: versionParams,
      body: replaceDraftItemsBody,
      conflict: DRAFT_STATE,
      success: { status: 200, description: "The draft", data: TemplateVersion },
    },
    {
      method: "patch",
      path: "/template-versions/:versionId",
      operationId: "updateInspectionDraftNote",
      summary: "Save a draft's change note",
      description: `${OPERATOR} ${AUDITED}`,
      permission: operator,
      audited: true,
      params: versionParams,
      body: draftNoteBody,
      conflict: DRAFT_STATE,
      success: { status: 200, description: "The draft", data: TemplateVersion },
    },
    {
      method: "post",
      path: "/template-versions/:versionId/publish",
      operationId: "publishInspectionTemplateVersion",
      summary: "Publish a draft",
      description:
        "Checks every item (400 names each problem), materialises the base checklist into a type version, retires the previous " +
        "published version, numbers it, computes its content hash, all in one transaction. Publishing the BASE also publishes a " +
        `rebased version of every published type checklist (\`rebasedVersionIds\`). ${OPERATOR} ${AUDITED}`,
      permission: operator,
      audited: true,
      params: versionParams,
      body: draftNoteBody,
      conflict: `${DRAFT_STATE} Or the template is retired, or the base checklist has no published version yet.`,
      success: { status: 200, description: "What the publish did", data: PublishResult },
    },
    {
      method: "post",
      path: "/template-versions/:versionId/discard",
      operationId: "discardInspectionDraft",
      summary: "Discard a draft",
      description: `Terminal; the rows are kept. ${OPERATOR} ${AUDITED}`,
      permission: operator,
      audited: true,
      params: versionParams,
      conflict: "Only a draft can be discarded.",
      success: { status: 200, description: "The discarded version", data: TemplateVersion },
    },
    {
      method: "get",
      path: "/template-proposals",
      operationId: "listInspectionTemplateProposals",
      summary: "The tenant's catalogue proposals",
      description: `\`ipm-templates\` read. The caller's tenant only, newest first. ${UNMARKED}`,
      permission: { kind: "dynamicAccess", resource: "ipm-templates", action: "read" },
      audited: false,
      query: listProposalsQuery,
      success: { status: 200, description: "A page of proposals; pagination in the top-level `meta`", list: TemplateProposal },
    },
    {
      method: "post",
      path: "/template-proposals",
      operationId: "createInspectionTemplateProposal",
      summary: "Propose a catalogue change",
      description:
        "`ipm-templates` write; an API key is refused. A new device type, items to add, change or retire. Nothing is copied into the " +
        `catalogue on acceptance: the operator opens a draft and adds each item. Audited in the tenant. ${UNMARKED}`,
      permission: { kind: "dynamicAccess", resource: "ipm-templates", action: "write" },
      audited: true,
      body: createProposal,
      success: { status: 201, description: "The proposal", data: TemplateProposal },
    },
    {
      method: "get",
      path: "/template-proposals/:proposalId",
      operationId: "getInspectionTemplateProposal",
      summary: "One proposal",
      description: `Another tenant's proposal is a 404, identical to a missing one. ${UNMARKED}`,
      permission: { kind: "dynamicAccess", resource: "ipm-templates", action: "read" },
      audited: false,
      params: proposalParams,
      success: { status: 200, description: "The proposal", data: TemplateProposal },
    },
    {
      method: "post",
      path: "/template-proposals/:proposalId/withdraw",
      operationId: "withdrawInspectionTemplateProposal",
      summary: "Withdraw a proposal",
      description: `\`ipm-templates\` write; a submitted proposal of the caller's tenant only. Audited in the tenant. ${UNMARKED}`,
      permission: { kind: "dynamicAccess", resource: "ipm-templates", action: "write" },
      audited: true,
      params: proposalParams,
      conflict: "The proposal was already accepted, rejected or withdrawn (the message says when).",
      success: { status: 200, description: "The proposal", data: TemplateProposal },
    },
  ],
});
