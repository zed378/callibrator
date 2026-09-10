import { api } from "../client";

// ---------- Types ----------

export type RiskStatus = "OPEN" | "MITIGATED" | "CLOSED" | "ACCEPTED";

export type RiskCategory =
  | "OPERATIONAL"
  | "FINANCIAL"
  | "COMPLIANCE"
  | "STRATEGIC"
  | "SAFETY";

export interface Risk {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  category: string;
  /** 1-5 */
  severity: number;
  /** 1-5 */
  likelihood: number;
  /** Virtual: severity * likelihood */
  rpn: number;
  status: string;
  mitigationPlan?: string;
  identifiedBy?: string;
  assignedTo?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RiskCreateInput {
  title: string;
  description?: string;
  category?: RiskCategory | string;
  severity?: number;
  likelihood?: number;
  status?: RiskStatus | string;
  mitigationPlan?: string;
  assignedTo?: string;
  dueDate?: string;
}

export type RiskUpdateInput = Partial<RiskCreateInput>;

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const riskService = {
  /**
   * List risks for the current tenant. GET /api/v1/risk
   */
  list: async (params?: {
    status?: RiskStatus | string;
    category?: RiskCategory | string;
    page?: number;
    limit?: number;
  }): Promise<Risk[]> => {
    const response = await api.get<BackendResponse<Risk[]>>("/api/v1/risk", {
      params,
    });
    return response.data;
  },

  /**
   * Get a single risk. GET /api/v1/risk/:id
   */
  getById: async (id: string): Promise<Risk> => {
    const response = await api.get<BackendResponse<Risk>>(
      `/api/v1/risk/${id}`,
    );
    return response.data;
  },

  /**
   * Create a risk. POST /api/v1/risk
   */
  create: async (data: RiskCreateInput): Promise<Risk> => {
    const response = await api.post<BackendResponse<Risk>>(
      "/api/v1/risk",
      data,
    );
    return response.data;
  },

  /**
   * Update a risk. PUT /api/v1/risk/:id
   */
  update: async (id: string, data: RiskUpdateInput): Promise<Risk> => {
    const response = await api.put<BackendResponse<Risk>>(
      `/api/v1/risk/${id}`,
      data,
    );
    return response.data;
  },

  /**
   * Delete a risk. DELETE /api/v1/risk/:id
   */
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/v1/risk/${id}`);
  },
};

export default riskService;
