import { api } from "../client";

// ---------- Types ----------

export type SupplierScorecardStatus = "APPROVED" | "PROBATION" | "DISQUALIFIED";

export interface SupplierScorecard {
  id: string;
  tenantId: string;
  vendorId: string;
  evaluationDate: string;
  /** 0-100 */
  qualityScore: number;
  deliveryScore: number;
  serviceScore: number;
  /** Virtual: round((quality + delivery + service) / 3) */
  overallScore: number;
  status: string;
  comments?: string;
  evaluatedBy?: string;
  nextEvaluationDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierScorecardCreateInput {
  vendorId: string;
  evaluationDate: string;
  qualityScore?: number;
  deliveryScore?: number;
  serviceScore?: number;
  status?: SupplierScorecardStatus | string;
  comments?: string;
  nextEvaluationDate?: string;
}

export type SupplierScorecardUpdateInput = Partial<SupplierScorecardCreateInput>;

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const supplierScorecardService = {
  /**
   * List supplier scorecards. GET /api/v1/supplier-scorecard
   */
  list: async (params?: {
    vendorId?: string;
    status?: string;
  }): Promise<SupplierScorecard[]> => {
    const response = await api.get<BackendResponse<SupplierScorecard[]>>(
      "/api/v1/supplier-scorecard",
      { params },
    );
    return response.data;
  },

  /**
   * Get a single scorecard. GET /api/v1/supplier-scorecard/:id
   */
  getById: async (id: string): Promise<SupplierScorecard> => {
    const response = await api.get<BackendResponse<SupplierScorecard>>(
      `/api/v1/supplier-scorecard/${id}`,
    );
    return response.data;
  },

  /**
   * Create a scorecard. POST /api/v1/supplier-scorecard
   */
  create: async (
    data: SupplierScorecardCreateInput,
  ): Promise<SupplierScorecard> => {
    const response = await api.post<BackendResponse<SupplierScorecard>>(
      "/api/v1/supplier-scorecard",
      data,
    );
    return response.data;
  },

  /**
   * Update a scorecard. PUT /api/v1/supplier-scorecard/:id
   */
  update: async (
    id: string,
    data: SupplierScorecardUpdateInput,
  ): Promise<SupplierScorecard> => {
    const response = await api.put<BackendResponse<SupplierScorecard>>(
      `/api/v1/supplier-scorecard/${id}`,
      data,
    );
    return response.data;
  },

  /**
   * Delete a scorecard. DELETE /api/v1/supplier-scorecard/:id
   */
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/v1/supplier-scorecard/${id}`);
  },
};

export default supplierScorecardService;
