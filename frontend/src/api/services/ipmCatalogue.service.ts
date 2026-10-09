import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type QueryOf, type components } from "../typed";

/**
 * P22-01 — the inspection catalogue (P19-01 spec § 8.2; P21-01, ADR-125 Am. 3): device types, the
 * item library, checklist templates and their versions, the published catalogue document, and the
 * tenants' proposals. Every call is on the GENERATED client, so a path, parameter or body the
 * backend does not publish is a compile error here.
 *
 * Backend: `backend/src/routes/api/deviceTypes.route.ts` (`/api/v1/device-types`),
 * `ipm.route.ts` (`/api/v1/ipm/...`), and the admin router (`/api/v1/admin/ipm/template-proposals`).
 *
 *  - reads of published content and active types: `calibration` | `ipm` | `ipm-templates` read;
 *  - every catalogue write, the library, drafts and the version history: the platform operator
 *    (super admin) only;
 *  - proposals: `ipm-templates` read / write in the caller's tenant; refused (403) to a
 *    facility-bound account.
 *
 * Lists answer the house envelope: rows in `data`, paging in a TOP-LEVEL `meta`.
 */

export type DeviceType = components["schemas"]["DeviceType"];
export type ItemDefinition = components["schemas"]["InspectionItemDefinition"];
export type InspectionTemplate = components["schemas"]["InspectionTemplate"];
export type TemplateVersion = components["schemas"]["InspectionTemplateVersion"];
export type TemplateVersionSummary = components["schemas"]["InspectionTemplateVersionSummary"];
export type TemplateItem = components["schemas"]["InspectionTemplateItem"];
export type PublishResult = components["schemas"]["InspectionPublishResult"];
export type PublishedCatalogue = components["schemas"]["InspectionPublishedCatalogue"];
export type PublishedVersion = PublishedCatalogue["versions"][number];
export type Proposal = components["schemas"]["InspectionTemplateProposal"];
export type ProposalQueueRow = components["schemas"]["InspectionTemplateProposalQueueRow"];
export type PageMeta = components["schemas"]["PaginationMeta"];
/** What a template's retire / reactivate answers: its id, its status, the version retired with it. */
export type TemplateLifecycle = DataOf<Op<"/api/v1/ipm/templates/{templateId}/retire", "post">>;

export type DeviceTypeQuery = QueryOf<Op<"/api/v1/device-types", "get">>;
export type ItemDefinitionQuery = QueryOf<Op<"/api/v1/ipm/item-definitions", "get">>;
export type TemplateQuery = QueryOf<Op<"/api/v1/ipm/templates", "get">>;
export type ProposalQuery = QueryOf<Op<"/api/v1/ipm/template-proposals", "get">>;

export type CreateItemDefinitionBody = JsonBody<Op<"/api/v1/ipm/item-definitions", "post">>;
export type UpdateItemDefinitionBody = JsonBody<Op<"/api/v1/ipm/item-definitions/{itemDefinitionId}", "patch">>;
/** An item's content as written: a union on `inputKind`, the limit as TEXT (the server parses it). */
export type ItemContentBody = CreateItemDefinitionBody["content"];
export type DraftItemInput = JsonBody<Op<"/api/v1/ipm/template-versions/{versionId}/items", "put">>["items"][number];
export type CreateProposalBody = JsonBody<Op<"/api/v1/ipm/template-proposals", "post">>;
export type ProposalItemInput = NonNullable<CreateProposalBody["proposedItems"]>[number];
export type AcceptProposalBody = JsonBody<Op<"/api/v1/admin/ipm/template-proposals/{proposalId}/accept", "post">>;
export type DraftSource = NonNullable<JsonBody<Op<"/api/v1/ipm/templates/{templateId}/versions", "post">>["copyFrom"]>;

/** One page of a list: the rows, and the paging the envelope carried beside them. */
export interface Paged<T> {
  rows: T[];
  meta: PageMeta;
}

/** The rows in `data` and the top-level `meta`; a missing `meta` reads as one page of what came. */
const paged = <T>(answer: { data: T[] | null; meta?: PageMeta | null }, page = 1): Paged<T> => {
  const rows = answer.data ?? [];
  return {
    rows,
    meta: answer.meta ?? { total: rows.length, page, limit: rows.length, totalPages: 1 },
  };
};

const typeId = (deviceTypeId: string) => ({ params: { path: { deviceTypeId } } });
const definitionId = (itemDefinitionId: string) => ({ params: { path: { itemDefinitionId } } });
const templateId = (id: string) => ({ params: { path: { templateId: id } } });
const versionId = (id: string) => ({ params: { path: { versionId: id } } });
const proposalId = (id: string) => ({ params: { path: { proposalId: id } } });

export const ipmCatalogueService = {
  // ── Device types ──────────────────────────────────────────────────────────
  /** GET /device-types — `status` active by default; ordered by name, then id. */
  listDeviceTypes: async (query: DeviceTypeQuery = {}): Promise<Paged<DeviceType>> =>
    paged(await typedApi.GET("/api/v1/device-types", { params: { query } }).then(unwrap), query.page),

  /** POST /device-types — 409 when the name exists (the message says when it is retired). */
  createDeviceType: async (name: string): Promise<DeviceType> =>
    (await typedApi.POST("/api/v1/device-types", { body: { name } }).then(unwrap)).data,

  /** PATCH /device-types/:id — an active type only. */
  renameDeviceType: async (id: string, name: string): Promise<DeviceType> =>
    (await typedApi.PATCH("/api/v1/device-types/{deviceTypeId}", { ...typeId(id), body: { name } }).then(unwrap)).data,

  retireDeviceType: async (id: string): Promise<DeviceType> =>
    (await typedApi.POST("/api/v1/device-types/{deviceTypeId}/retire", typeId(id)).then(unwrap)).data,

  reactivateDeviceType: async (id: string): Promise<DeviceType> =>
    (await typedApi.POST("/api/v1/device-types/{deviceTypeId}/reactivate", typeId(id)).then(unwrap)).data,

  // ── The item library (operator) ───────────────────────────────────────────
  listItemDefinitions: async (query: ItemDefinitionQuery = {}): Promise<Paged<ItemDefinition>> =>
    paged(await typedApi.GET("/api/v1/ipm/item-definitions", { params: { query } }).then(unwrap), query.page),

  createItemDefinition: async (body: CreateItemDefinitionBody): Promise<ItemDefinition> =>
    (await typedApi.POST("/api/v1/ipm/item-definitions", { body }).then(unwrap)).data,

  /** PATCH — same section and input kind; a later copy into a draft sees the edit, nothing else does. */
  updateItemDefinition: async (id: string, body: UpdateItemDefinitionBody): Promise<ItemDefinition> =>
    (await typedApi.PATCH("/api/v1/ipm/item-definitions/{itemDefinitionId}", { ...definitionId(id), body }).then(unwrap)).data,

  retireItemDefinition: async (id: string): Promise<ItemDefinition> =>
    (await typedApi.POST("/api/v1/ipm/item-definitions/{itemDefinitionId}/retire", definitionId(id)).then(unwrap)).data,

  // ── Templates and versions (operator) ─────────────────────────────────────
  /** GET /ipm/templates — each with its published version and open draft. */
  listTemplates: async (query: TemplateQuery = {}): Promise<Paged<InspectionTemplate>> =>
    paged(await typedApi.GET("/api/v1/ipm/templates", { params: { query } }).then(unwrap), query.page),

  /** POST /ipm/templates — a device type's checklist (the base exists from the start). */
  createTemplate: async (deviceTypeId: string): Promise<InspectionTemplate> =>
    (await typedApi.POST("/api/v1/ipm/templates", { body: { deviceTypeId } }).then(unwrap)).data,

  /** POST …/retire — its published version is retired with it (`retiredVersionId`). */
  retireTemplate: async (id: string): Promise<TemplateLifecycle> =>
    (await typedApi.POST("/api/v1/ipm/templates/{templateId}/retire", templateId(id)).then(unwrap)).data,

  reactivateTemplate: async (id: string): Promise<TemplateLifecycle> =>
    (await typedApi.POST("/api/v1/ipm/templates/{templateId}/reactivate", templateId(id)).then(unwrap)).data,

  /** POST /ipm/templates/:id/versions — one open draft per template (409 otherwise). */
  openDraft: async (id: string, copyFrom: DraftSource): Promise<TemplateVersion> =>
    (await typedApi.POST("/api/v1/ipm/templates/{templateId}/versions", { ...templateId(id), body: { copyFrom } }).then(unwrap)).data,

  /** GET /ipm/template-versions?templateId= — every status, newest first. */
  listVersions: async (id: string, page = 1, limit = 25): Promise<Paged<TemplateVersionSummary>> =>
    paged(
      await typedApi.GET("/api/v1/ipm/template-versions", { params: { query: { templateId: id, page, limit } } }).then(unwrap),
      page,
    ),

  /** GET /ipm/template-versions/:id — with its items in read order. */
  getVersion: async (id: string): Promise<TemplateVersion> =>
    (await typedApi.GET("/api/v1/ipm/template-versions/{versionId}", versionId(id)).then(unwrap)).data,

  /** PUT …/items — wholesale, at the revision the editor read (409 when another save came first). */
  saveDraftItems: async (id: string, revision: number, items: DraftItemInput[]): Promise<DataOf<Op<"/api/v1/ipm/template-versions/{versionId}/items", "put">>> =>
    (await typedApi.PUT("/api/v1/ipm/template-versions/{versionId}/items", { ...versionId(id), body: { revision, items } }).then(unwrap)).data,

  saveDraftNote: async (id: string, revision: number, changeNote: string): Promise<TemplateVersion> =>
    (await typedApi.PATCH("/api/v1/ipm/template-versions/{versionId}", { ...versionId(id), body: { revision, changeNote } }).then(unwrap)).data,

  /** POST …/publish — 400 names each problem; publishing the base rebases every published type checklist. */
  publishDraft: async (id: string, revision: number, changeNote: string): Promise<PublishResult> =>
    (await typedApi.POST("/api/v1/ipm/template-versions/{versionId}/publish", { ...versionId(id), body: { revision, changeNote } }).then(unwrap)).data,

  discardDraft: async (id: string): Promise<TemplateVersion> =>
    (await typedApi.POST("/api/v1/ipm/template-versions/{versionId}/discard", versionId(id)).then(unwrap)).data,

  // ── The published catalogue (every reader) ────────────────────────────────
  /** GET /ipm/templates/published — one document (not a page): active types and published versions. */
  getPublishedCatalogue: async (): Promise<PublishedCatalogue> =>
    (await typedApi.GET("/api/v1/ipm/templates/published").then(unwrap)).data,

  // ── Proposals (the caller's tenant) ───────────────────────────────────────
  listProposals: async (query: ProposalQuery = {}): Promise<Paged<Proposal>> =>
    paged(await typedApi.GET("/api/v1/ipm/template-proposals", { params: { query } }).then(unwrap), query.page),

  createProposal: async (body: CreateProposalBody): Promise<Proposal> =>
    (await typedApi.POST("/api/v1/ipm/template-proposals", { body }).then(unwrap)).data,

  withdrawProposal: async (id: string): Promise<Proposal> =>
    (await typedApi.POST("/api/v1/ipm/template-proposals/{proposalId}/withdraw", proposalId(id)).then(unwrap)).data,

  // ── The operator's proposal queue (admin router) ──────────────────────────
  listProposalQueue: async (query: ProposalQuery = {}): Promise<Paged<ProposalQueueRow>> =>
    paged(await typedApi.GET("/api/v1/admin/ipm/template-proposals", { params: { query } }).then(unwrap), query.page),

  /** Accept: opens or links a draft; nothing is copied from the proposal. */
  acceptProposal: async (id: string, body: AcceptProposalBody): Promise<Proposal> =>
    (await typedApi.POST("/api/v1/admin/ipm/template-proposals/{proposalId}/accept", { ...proposalId(id), body }).then(unwrap)).data,

  rejectProposal: async (id: string, decisionNote: string): Promise<Proposal> =>
    (await typedApi.POST("/api/v1/admin/ipm/template-proposals/{proposalId}/reject", { ...proposalId(id), body: { decisionNote } }).then(unwrap)).data,
};

export default ipmCatalogueService;
