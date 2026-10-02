import { typedApi, unwrap, type JsonBody, type Op, type QueryOf, type components } from "../typed";

/**
 * QMS — Non-Conformances (NC) and Corrective/Preventive Actions (CAPA).
 *
 * The tenant/reporter come from the caller's JWT.
 * Backend: src/routes/api/qms.route.ts (mounted /api/v1/qms)
 *   POST   /nc          (denies API keys)
 *   GET    /nc          ?page&limit&status
 *   PATCH  /nc/:id      (denies API keys)
 *   POST   /capa        (denies API keys)
 *   GET    /capa        ?page&limit&status
 *   PATCH  /capa/:id    (denies API keys)
 *
 * There are only these six. There is no per-id GET, no DELETE, and no /stats.
 * NCs live at /nc — NOT /non-conformances.
 *
 * Every route is gated on the `qms` menu (A-66): reads need `read`, mutations
 * `write`. A caller without it gets 403.
 *
 * List endpoints use the house envelope (backend qms.controller.ts): the rows
 * ARE `data` (an array), and pagination is a top-level `meta` sibling —
 * `{ data: [...], meta: { total, page, limit, totalPages } }`. Not `data.rows`,
 * not `data.nonConformances`, not `data.meta`.
 *
 * P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
 * contract's (backend/src/routes/api/qms.openapi.ts). The exported names are
 * unchanged.
 */

type Q = "/api/v1/qms";
type Schemas = components["schemas"];

// ---------- Types ----------

/**
 * A non-conformance. A list read also carries its reporter and device
 * (NonConformanceListItem); a write's answer is the bare row.
 */
export type NonConformance = Schemas["NonConformance"] &
  Partial<Pick<Schemas["NonConformanceListItem"], "reporter" | "device">>;

/**
 * A CAPA. A list read also carries its NC and assignee (CapaListItem); a
 * write's answer is the bare row.
 */
export type Capa = Schemas["Capa"] & Partial<Pick<Schemas["CapaListItem"], "nonConformance" | "assignee">>;

export type NcStatus = NonConformance["status"];
export type NcSeverity = NonConformance["severity"];
export type CapaStatus = Capa["status"];

export type NcReporter = NonNullable<Schemas["NonConformanceListItem"]["reporter"]>;
export type NcDevice = NonNullable<Schemas["NonConformanceListItem"]["device"]>;

/**
 * The backend ENUMs, verbatim (models/nonConformance.model.ts,
 * models/capa.model.ts; enforced by the qms validators). Anything else is a
 * 400. These used to list IN_PROGRESS/CANCELLED for NCs and
 * COMPLETED/APPROVED/CANCELLED for CAPAs — none of which the backend accepts.
 * Each list is checked against the contract's enum (`satisfies`).
 */
export const NC_STATUSES = [
  "OPEN",
  "UNDER_INVESTIGATION",
  "CAPA_REQUIRED",
  "CLOSED",
] as const satisfies readonly NcStatus[];
export const NC_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const satisfies readonly NcSeverity[];
export const CAPA_STATUSES = [
  "DRAFT",
  "OPEN",
  "IN_PROGRESS",
  "VERIFICATION",
  "CLOSED",
] as const satisfies readonly CapaStatus[];

/** Shape the service returns for both list endpoints. */
export interface QmsPage<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** `description` is required (A-89): NOT NULL, and the validator refuses it empty (A-74). */
export type NcCreateInput = JsonBody<Op<`${Q}/nc`, "post">>;

/** Only these fields are applied by the backend. */
export type NcUpdateInput = JsonBody<Op<`${Q}/nc/{id}`, "patch">>;

/** `ncId` is required (404 if the NC does not exist); `actionPlan` too (A-89). */
export type CapaCreateInput = JsonBody<Op<`${Q}/capa`, "post">>;

/** Only these fields are applied by the backend. */
export type CapaUpdateInput = JsonBody<Op<`${Q}/capa/{id}`, "patch">>;

export interface ListParams {
  page?: number;
  limit?: number;
  status?: string;
}

/** Normalize the house list envelope into a uniform page. */
const toPage = <T,>(
  response: { data?: T[] | null; meta?: Partial<Schemas["PaginationMeta"]> | null } | undefined,
  params: ListParams,
): QmsPage<T> => {
  // Defensive, as built: a body without rows or `meta` still renders.
  const rows = Array.isArray(response?.data) ? response.data : [];
  const meta = response?.meta ?? {};
  return {
    rows,
    total: meta.total ?? rows.length,
    page: meta.page ?? params.page ?? 1,
    limit: meta.limit ?? params.limit ?? 10,
    totalPages: meta.totalPages ?? 1,
  };
};

const byId = (id: string) => ({ params: { path: { id } } });

// ---------- Service ----------

export const qmsService = {
  // ----- Non-Conformances -----

  /** GET /qms/nc */
  listNonConformances: async (
    params: ListParams = {},
  ): Promise<QmsPage<NonConformance>> => {
    const response = await typedApi
      // The page's status filter offers only the contract's statuses.
      .GET("/api/v1/qms/nc", { params: { query: params as QueryOf<Op<`${Q}/nc`, "get">> } })
      .then(unwrap);
    return toPage(response, params);
  },

  /** POST /qms/nc — ncNumber and status are assigned server-side. */
  createNonConformance: async (
    input: NcCreateInput,
  ): Promise<NonConformance> =>
    (await typedApi.POST("/api/v1/qms/nc", { body: input }).then(unwrap)).data,

  /** PATCH /qms/nc/:id */
  updateNonConformance: async (
    id: string,
    input: NcUpdateInput,
  ): Promise<NonConformance> =>
    (await typedApi.PATCH("/api/v1/qms/nc/{id}", { ...byId(id), body: input }).then(unwrap)).data,

  /** Convenience: status-only PATCH (there is no dedicated /status route). */
  updateNcStatus: (id: string, status: NcStatus): Promise<NonConformance> =>
    qmsService.updateNonConformance(id, { status }),

  /**
   * Convenience: record the investigation outcome.
   * The backend has no nested investigation object — only a flat rootCause.
   */
  setRootCause: (id: string, rootCause: string): Promise<NonConformance> =>
    qmsService.updateNonConformance(id, { rootCause }),

  // ----- CAPA -----

  /** GET /qms/capa */
  listCapas: async (params: ListParams = {}): Promise<QmsPage<Capa>> => {
    const response = await typedApi
      .GET("/api/v1/qms/capa", { params: { query: params as QueryOf<Op<`${Q}/capa`, "get">> } })
      .then(unwrap);
    return toPage(response, params);
  },

  /** POST /qms/capa — requires ncId; capaNumber/status are server-side. */
  createCapa: async (input: CapaCreateInput): Promise<Capa> =>
    (await typedApi.POST("/api/v1/qms/capa", { body: input }).then(unwrap)).data,

  /** PATCH /qms/capa/:id */
  updateCapa: async (id: string, input: CapaUpdateInput): Promise<Capa> =>
    (await typedApi.PATCH("/api/v1/qms/capa/{id}", { ...byId(id), body: input }).then(unwrap)).data,

  /** Convenience: status-only PATCH. */
  updateCapaStatus: (id: string, status: CapaStatus): Promise<Capa> =>
    qmsService.updateCapa(id, { status }),

  /**
   * Convenience: approve and close out a CAPA.
   *
   * There is no APPROVED status — the backend CAPA enum ends at CLOSED, and it
   * used to be sent "APPROVED", which the validator rejects with 400 (A-66).
   * Approval is recorded by sending any `approvedBy`: the backend IGNORES the
   * id and records the authenticated caller (A-62), and writes an APPROVE
   * audit row. Pass the current user's id; it must be a UUID to validate.
   */
  approveCapa: (
    id: string,
    approvedBy: string,
    verificationNotes?: string,
  ): Promise<Capa> =>
    qmsService.updateCapa(id, {
      status: "CLOSED",
      approvedBy,
      verificationNotes,
    }),
};

export default qmsService;
