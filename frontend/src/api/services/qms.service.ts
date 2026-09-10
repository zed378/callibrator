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
 * List endpoints return data as
 * `{ total, page, limit, totalPages, nonConformances | capas }` — the rows are
 * under a named key, not `data.rows`, and there is no top-level `meta`.
 */

const BASE = "/api/v1/qms";

// ---------- Types ----------

/** Backend persists uppercase. */
export type NcStatus = "OPEN" | "IN_PROGRESS" | "CLOSED" | "CANCELLED";
export type NcSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type CapaStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "APPROVED"
  | "CANCELLED";

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
  description?: string;
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
  actionPlan?: string;
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

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

/** Raw list payloads, keyed by resource. */
interface RawNcList {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  nonConformances: NonConformance[];
}

interface RawCapaList {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  capas: Capa[];
}

/** Normalize the backend's named-key list into a uniform page. */
const toPage = <T,>(
  raw: { total?: number; page?: number; limit?: number; totalPages?: number },
  rows: T[] | undefined,
  params: ListParams,
): QmsPage<T> => ({
  rows: rows ?? [],
  total: raw?.total ?? 0,
  page: raw?.page ?? params.page ?? 1,
  limit: raw?.limit ?? params.limit ?? 10,
  totalPages: raw?.totalPages ?? 1,
});

// ---------- Service ----------

export const qmsService = {
  // ----- Non-Conformances -----

  /** GET /qms/nc */
  listNonConformances: async (
    params: ListParams = {},
  ): Promise<QmsPage<NonConformance>> => {
    const response = await api.get<BackendResponse<RawNcList>>(`${BASE}/nc`, {
      params,
    });
    return toPage(response.data, response.data?.nonConformances, params);
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
    const response = await api.get<BackendResponse<RawCapaList>>(
      `${BASE}/capa`,
      { params },
    );
    return toPage(response.data, response.data?.capas, params);
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
   * Convenience: close out a CAPA.
   * The backend has no effectiveness-review concept; approval is recorded via
   * approvedBy + verificationNotes.
   */
  approveCapa: (
    id: string,
    approvedBy: string,
    verificationNotes?: string,
  ): Promise<Capa> =>
    qmsService.updateCapa(id, {
      status: "APPROVED",
      approvedBy,
      verificationNotes,
    }),
};

export default qmsService;
