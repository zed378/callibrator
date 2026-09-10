import { api } from "../client";

/**
 * Approval workflows and their running instances.
 *
 * The tenant comes from the caller's JWT.
 * Backend: src/routes/api/workflows.route.js (mounted /api/v1/workflows)
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
 */

const BASE = "/api/v1/workflows";

// ---------- Types ----------

/** Exactly the resources the validator accepts. */
export type WorkflowResourceType =
  | "Certificate"
  | "StockTransfer"
  | "MaintenanceWorkOrder";

/** The only actions submitAction accepts — uppercase. */
export type WorkflowAction = "APPROVED" | "REJECTED";

export interface WorkflowStep {
  id?: string;
  /** 1-based. Named stepOrder, not `order`. */
  stepOrder: number;
  roleId: string;
  requiredApprovals?: number;
}

export interface Workflow {
  id: string;
  tenantId?: string;
  name: string;
  resourceType: WorkflowResourceType;
  isActive?: boolean;
  steps?: WorkflowStep[];
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  workflow?: Workflow;
  tenantId?: string;
  resourceId?: string;
  resourceType?: WorkflowResourceType;
  status?: string;
  currentStepOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkflowStepInput {
  stepOrder: number;
  roleId: string;
  requiredApprovals?: number;
}

export interface WorkflowCreateInput {
  name: string;
  resourceType: WorkflowResourceType;
  isActive?: boolean;
  /** At least one step is required. */
  steps: WorkflowStepInput[];
}

/** PUT accepts a partial; steps (when present) must still be well-formed. */
export interface WorkflowUpdateInput {
  name?: string;
  isActive?: boolean;
  steps?: WorkflowStepInput[];
}

export interface SubmitActionInput {
  action: WorkflowAction;
  /** Named `comments` (plural) server-side. */
  comments?: string | null;
}

export interface SubmitActionResult {
  /** The instance status after the action. */
  status: string;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const workflowService = {
  /** GET /workflows — data is a plain array (not paginated). */
  getAll: async (): Promise<Workflow[]> => {
    const response = await api.get<BackendResponse<Workflow[]>>(BASE);
    return response.data ?? [];
  },

  /** GET /workflows/:id */
  getById: async (id: string): Promise<Workflow> => {
    const response = await api.get<BackendResponse<Workflow>>(`${BASE}/${id}`);
    return response.data;
  },

  /** POST /workflows — returns 201. */
  create: async (data: WorkflowCreateInput): Promise<Workflow> => {
    const response = await api.post<BackendResponse<Workflow>>(BASE, data);
    return response.data;
  },

  /** PUT /workflows/:id — resourceType is fixed at creation. */
  update: async (id: string, data: WorkflowUpdateInput): Promise<Workflow> => {
    const response = await api.put<BackendResponse<Workflow>>(
      `${BASE}/${id}`,
      data,
    );
    return response.data;
  },

  /** DELETE /workflows/:id */
  delete: async (id: string): Promise<void> => {
    await api.delete<BackendResponse<null>>(`${BASE}/${id}`);
  },

  /**
   * GET /workflows/instances/pending — instances awaiting the calling user,
   * filtered server-side by their role. Plain array.
   */
  getPendingInstances: async (): Promise<WorkflowInstance[]> => {
    const response = await api.get<BackendResponse<WorkflowInstance[]>>(
      `${BASE}/instances/pending`,
    );
    return response.data ?? [];
  },

  /**
   * POST /workflows/instances/:instanceId/action
   * `action` must be "APPROVED" or "REJECTED"; the comment field is `comments`.
   */
  actionOnInstance: async (
    instanceId: string,
    data: SubmitActionInput,
  ): Promise<SubmitActionResult> => {
    const response = await api.post<BackendResponse<SubmitActionResult>>(
      `${BASE}/instances/${instanceId}/action`,
      data,
    );
    return response.data;
  },

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
