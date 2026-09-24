import { api } from "../client";

/**
 * QMS — Non-Conformances (NC) and Corrective/Preventive Actions (CAPA).
 *
 * The tenant/reporter come from the caller's JWT.
 * Backend: src/routes/api/qms.route.js (mounted /api/v1/qms)
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
 * List endpoints use the house envelope (backend qms.controller.js): the rows
 * ARE `data` (an array), and pagination is a top-level `meta` sibling —
 * `{ data: [...], meta: { total, page, limit, totalPages } }`. Not `data.rows`,
 * not `data.nonConformances`, not `data.meta`.
 */

const BASE = "/api/v1/qms";

// ---------- Types ----------

/**
 * The backend ENUMs, verbatim (models/nonConformance.model.js,
 * models/capa.model.js; enforced by validators/qms.validator.js). Anything
 * else is a 400. These used to list IN_PROGRESS/CANCELLED for NCs and
 * COMPLETED/APPROVED/CANCELLED for CAPAs — none of which the backend accepts.
 */
export const NC_STATUSES = [
  "OPEN",
  "UNDER_INVESTIGATION",
  "CAPA_REQUIRED",
  "CLOSED",
] as const;
export type NcStatus = (typeof NC_STATUSES)[number];
export const NC_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type NcSeverity = (typeof NC_SEVERITIES)[number];
export const CAPA_STATUSES = [
  "DRAFT",
  "OPEN",
  "IN_PROGRESS",
  "VERIFICATION",
  "CLOSED",
] as const;
export type CapaStatus = (typeof CAPA_STATUSES)[number];

export interface NcReporter {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface NcDevice {
  id: string;
  name?: string;
  serialNumber?: string;
}

export interface NonConformance {
  id: string;
  /** Server-generated, e.g. "NC-00001". */
  ncNumber: string;
  title: string;
  description?: string;
  severity: NcSeverity;
  status: NcStatus;
  rootCause?: string | null;
  deviceId?: string | null;
  dateIdentified?: string;
  reportedBy?: string;
  reporter?: NcReporter;
  device?: NcDevice;
  createdAt?: string;
  updatedAt?: string;
}

export interface Capa {
  id: string;
  /** Server-generated, e.g. "CAPA-00001". */
  capaNumber: string;
  ncId: string;
  title: string;
  actionPlan?: string;
  status: CapaStatus;
  assignedTo?: string | null;
  dueDate?: string | null;
  completedDate?: string | null;
  approvedBy?: string | null;
  verificationNotes?: string | null;
  nonConformance?: { id: string; ncNumber: string; title: string };
  assignee?: NcReporter;
  createdAt?: string;
  updatedAt?: string;
}

/** Shape the backend actually returns for both list endpoints. */
export interface QmsPage<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface NcCreateInput {
  title: string;
  /** Required (A-89): NOT NULL, and the backend validator refuses it empty (A-74). */
  description: string;
  /** Server defaults to "MEDIUM". */
  severity?: NcSeverity;
  deviceId?: string;
  /** Server defaults to now. */
  dateIdentified?: string;
}

/** Only these fields are applied by the backend. */
export interface NcUpdateInput {
  title?: string;
  description?: string;
  status?: NcStatus;
  severity?: NcSeverity;
  rootCause?: string;
}

export interface CapaCreateInput {
  /** Required — the backend 404s if the NC does not exist. */
  ncId: string;
  title: string;
  /** Required (A-89): NOT NULL, and the backend validator refuses it empty (A-74). */
  actionPlan: string;
  assignedTo?: string;
  dueDate?: string;
}

/** Only these fields are applied by the backend. */
export interface CapaUpdateInput {
  title?: string;
  actionPlan?: string;
  status?: CapaStatus;
  assignedTo?: string;
  dueDate?: string;
  completedDate?: string;
  approvedBy?: string;
  verificationNotes?: string;
}

export interface ListParams {
  page?: number;
  limit?: number;
  status?: string;
}

interface PageMeta {
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
  /** Lists only — a SIBLING of `data`, never inside it. */
  meta?: PageMeta;
}

/** Normalize the house list envelope into a uniform page. */
const toPage = <T,>(
  response: BackendResponse<T[]> | undefined,
  params: ListParams,
): QmsPage<T> => {
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

// ---------- Service ----------

export const qmsService = {
  // ----- Non-Conformances -----

  /** GET /qms/nc */
  listNonConformances: async (
    params: ListParams = {},
  ): Promise<QmsPage<NonConformance>> => {
    const response = await api.get<BackendResponse<NonConformance[]>>(
      `${BASE}/nc`,
      { params },
    );
    return toPage(response, params);
  },

  /** POST /qms/nc — ncNumber and status are assigned server-side. */
  createNonConformance: async (
    input: NcCreateInput,
  ): Promise<NonConformance> => {
    const response = await api.post<BackendResponse<NonConformance>>(
      `${BASE}/nc`,
      input,
    );
    return response.data;
  },

  /** PATCH /qms/nc/:id */
  updateNonConformance: async (
    id: string,
    input: NcUpdateInput,
  ): Promise<NonConformance> => {
    const response = await api.patch<BackendResponse<NonConformance>>(
      `${BASE}/nc/${id}`,
      input,
    );
    return response.data;
  },

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
    const response = await api.get<BackendResponse<Capa[]>>(`${BASE}/capa`, {
      params,
    });
    return toPage(response, params);
  },

  /** POST /qms/capa — requires ncId; capaNumber/status are server-side. */
  createCapa: async (input: CapaCreateInput): Promise<Capa> => {
    const response = await api.post<BackendResponse<Capa>>(
      `${BASE}/capa`,
      input,
    );
    return response.data;
  },

  /** PATCH /qms/capa/:id */
  updateCapa: async (id: string, input: CapaUpdateInput): Promise<Capa> => {
    const response = await api.patch<BackendResponse<Capa>>(
      `${BASE}/capa/${id}`,
      input,
    );
    return response.data;
  },

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
