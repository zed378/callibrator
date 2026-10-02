// src/api/services/risk.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/risk.openapi.ts). The names are unchanged.
import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";

// ---------- Types ----------

type ById = "/api/v1/risk/{id}";
type UpdateBody = JsonBody<Op<ById, "put">>;
type CreateBody = JsonBody<Op<"/api/v1/risk", "post">>;

export type RiskStatus = NonNullable<UpdateBody["status"]>;
export type RiskCategory = NonNullable<CreateBody["category"]>;

/** A risk row; a list or single read also carries its people (RiskWithPeople). */
export type Risk = components["schemas"]["Risk"];
export type RiskWithPeople = components["schemas"]["RiskWithPeople"];

/**
 * What the risk form sends on either write: the update body (the create fields
 * and `status`). On create, `status` is server-owned (a risk starts OPEN) and
 * the validator drops it — the form sends it as built.
 */
export type RiskCreateInput = UpdateBody & { title: string };

export type RiskUpdateInput = UpdateBody;

/** F-19: `meta` of a paged list — a top-level sibling of `data` (house envelope). */
export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** One page of rows with the backend's `meta`. */
export interface ListPage<T> {
  rows: T[];
  meta: ListMeta;
}


// ---------- Service ----------

const byId = (id: string) => ({ params: { path: { id } } });

export const riskService = {
  /**
   * List risks for the current tenant. GET /api/v1/risk
   */
  list: async (params?: {
    status?: string;
    category?: string;
    page?: number;
    limit?: number;
  }): Promise<RiskWithPeople[]> =>
    (await typedApi.GET("/api/v1/risk", { params: { query: params } }).then(unwrap)).data,

  /**
   * One page of risks with the backend's `meta` (F-19). The backend's default
   * page is 10 rows, so a caller that ignores `meta` silently shows only the
   * first 10.
   */
  listPage: async (params: {
    status?: string;
    category?: string;
    page: number;
    limit: number;
  }): Promise<ListPage<RiskWithPeople>> => {
    const response = await typedApi.GET("/api/v1/risk", { params: { query: params } }).then(unwrap);
    const rows = Array.isArray(response.data) ? response.data : [];
    const total = response.meta?.total ?? rows.length;
    const limit = response.meta?.limit ?? params.limit;
    return {
      rows,
      meta: {
        total,
        page: response.meta?.page ?? params.page,
        limit,
        totalPages: response.meta?.totalPages ?? Math.max(1, Math.ceil(total / limit)),
      },
    };
  },

  /**
   * Get a single risk. GET /api/v1/risk/:id
   */
  getById: async (id: string): Promise<RiskWithPeople> =>
    (await typedApi.GET("/api/v1/risk/{id}", byId(id)).then(unwrap)).data,

  /**
   * Create a risk. POST /api/v1/risk
   */
  create: async (data: RiskCreateInput): Promise<Risk> =>
    // As built: `status` rides along (see RiskCreateInput); the create body does not read it.
    (await typedApi.POST("/api/v1/risk", { body: data as CreateBody }).then(unwrap)).data,

  /**
   * Update a risk. PUT /api/v1/risk/:id
   */
  update: async (id: string, data: RiskUpdateInput): Promise<Risk> =>
    (await typedApi.PUT("/api/v1/risk/{id}", { ...byId(id), body: data }).then(unwrap)).data,

  /**
   * Delete a risk. DELETE /api/v1/risk/:id
   */
  delete: async (id: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/risk/{id}", byId(id));
  },
};

export default riskService;
