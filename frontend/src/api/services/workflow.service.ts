import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";

/**
 * Approval workflows and their running instances.
 *
 * The tenant comes from the caller's JWT.
 * Backend: src/routes/api/workflows.route.ts (mounted /api/v1/workflows)
 *   GET    /                              list workflows
 *   POST   /                              create
 *   GET    /:id
 *   PUT    /:id
 *   DELETE /:id
 *   GET    /instances/pending             tasks awaiting the caller
 *   POST   /instances/:instanceId/action  approve / reject
 *
 * Neither list endpoint paginates — `data` is a plain array (getWorkflows is a
 * bare findAll; getPendingTasks returns a filtered array). There is no
 * per-workflow instances route.
 *
 * P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
 * contract's (backend/src/routes/api/workflows.openapi.ts). The exported
 * names are unchanged.
 */

type Schemas = components["schemas"];

// ---------- Types ----------

export type WorkflowCreateInput = JsonBody<Op<"/api/v1/workflows", "post">>;

/** PUT accepts a partial; steps (when present) must still be well-formed. resourceType is fixed at creation. */
export type WorkflowUpdateInput = JsonBody<Op<"/api/v1/workflows/{id}", "put">>;

/** Exactly the resources the validator accepts. */
export type WorkflowResourceType = WorkflowCreateInput["resourceType"];

export type WorkflowStepInput = WorkflowCreateInput["steps"][number];

export type Workflow = Schemas["Workflow"];
export type WorkflowStep = Schemas["WorkflowStep"];

/**
 * A pending instance awaiting the caller (GET /instances/pending), with its
 * workflow (name, resource type, steps) and the decisions already taken.
 */
export type WorkflowInstance = Schemas["WorkflowPendingTask"];

/**
 * POST /instances/:instanceId/action. `action` is "APPROVED" or "REJECTED"
 * (uppercase); the comment is `comments` (plural). A-182 — approving a
 * Certificate is an electronic signature (21 CFR Part 11): the caller
 * re-authenticates with `authMethod`, `authPayload` and `meaning`, as for
 * POST /certificates/:id/approve (400 without them); not sent for a rejection
 * or for other record types.
 */
export type SubmitActionInput = JsonBody<Op<"/api/v1/workflows/instances/{instanceId}/action", "post">>;

/** The only actions submitAction accepts — uppercase. */
export type WorkflowAction = SubmitActionInput["action"];

/** The instance status after the action. */
export type SubmitActionResult = Schemas["WorkflowDecision"];

const byId = (id: string) => ({ params: { path: { id } } });

// ---------- Service ----------

export const workflowService = {
  /** GET /workflows — data is a plain array (not paginated). */
  getAll: async (): Promise<Workflow[]> =>
    (await typedApi.GET("/api/v1/workflows").then(unwrap)).data ?? [],

  /** GET /workflows/:id */
  getById: async (id: string): Promise<Workflow> =>
    (await typedApi.GET("/api/v1/workflows/{id}", byId(id)).then(unwrap)).data,

  /** POST /workflows — returns 201. */
  create: async (data: WorkflowCreateInput): Promise<Workflow> =>
    (await typedApi.POST("/api/v1/workflows", { body: data }).then(unwrap)).data,

  /** PUT /workflows/:id — resourceType is fixed at creation. */
  update: async (id: string, data: WorkflowUpdateInput): Promise<Workflow> =>
    (await typedApi.PUT("/api/v1/workflows/{id}", { ...byId(id), body: data }).then(unwrap)).data,

  /** DELETE /workflows/:id */
  delete: async (id: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/workflows/{id}", byId(id));
  },

  /**
   * GET /workflows/instances/pending — instances awaiting the calling user,
   * filtered server-side by their role. Plain array.
   */
  getPendingInstances: async (): Promise<WorkflowInstance[]> =>
    (await typedApi.GET("/api/v1/workflows/instances/pending").then(unwrap)).data ?? [],

  /**
   * POST /workflows/instances/:instanceId/action
   * `action` must be "APPROVED" or "REJECTED"; the comment field is `comments`.
   */
  actionOnInstance: async (
    instanceId: string,
    data: SubmitActionInput,
  ): Promise<SubmitActionResult> =>
    (
      await typedApi
        .POST("/api/v1/workflows/instances/{instanceId}/action", { params: { path: { instanceId } }, body: data })
        .then(unwrap)
    ).data,

  /** Convenience wrappers around actionOnInstance. */
  approve: (instanceId: string, comments?: string): Promise<SubmitActionResult> =>
    workflowService.actionOnInstance(instanceId, {
      action: "APPROVED",
      comments,
    }),

  reject: (instanceId: string, comments?: string): Promise<SubmitActionResult> =>
    workflowService.actionOnInstance(instanceId, {
      action: "REJECTED",
      comments,
    }),
};

export default workflowService;
