import { api } from "../client";

/**
 * SOP — controlled documents and their training acknowledgments.
 *
 * The tenant/author come from the caller's JWT.
 * Backend: src/routes/api/sop.route.js (mounted /api/v1/sop)
 *   POST  /                 create a document
 *   GET   /                 ?page&limit&status
 *   PATCH /:id/publish      publish + fan out training tasks
 *   POST  /:id/acknowledge  acknowledge training for that document
 *
 * That is the whole API — four routes on /sop itself, NOT /sop/documents.
 * There is no per-id GET, no update, no delete, no archive, and no /stats.
 *
 * Training has no endpoints of its own: acknowledgments are created as a side
 * effect of publishing a document whose requiresTraining is true, and are
 * completed via POST /:id/acknowledge where :id is the DOCUMENT id (not an
 * acknowledgment id). There is no way to list them over HTTP today.
 */

const BASE = "/api/v1/sop";

// ---------- Types ----------

/** Backend persists uppercase. */
export type SopStatus = "DRAFT" | "PUBLISHED";
export type TrainingStatus = "PENDING" | "COMPLETED";

export interface SopAuthor {
  id: string;
  firstName?: string;
  lastName?: string;
}

export interface SopDocument {
  id: string;
  /** Server-generated, e.g. "SOP-0001". */
  documentNumber: string;
  title: string;
  /** Server defaults to "1.0". */
  version: string;
  contentUrl?: string | null;
  /** Server defaults to true. */
  requiresTraining: boolean;
  status: SopStatus;
  publishedDate?: string | null;
  authorId?: string;
  author?: SopAuthor;
  createdAt?: string;
  updatedAt?: string;
}

export interface TrainingAcknowledgment {
  id: string;
  documentId: string;
  userId: string;
  status: TrainingStatus;
  acknowledgedAt?: string | null;
}

/** Shape the backend actually returns for GET /sop. */
export interface SopPage {
  rows: SopDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Only these fields are read by the backend; everything else is ignored. */
export interface SopCreateInput {
  title: string;
  /** Defaults to "1.0" server-side. */
  version?: string;
  contentUrl?: string;
  /** Defaults to true server-side. */
  requiresTraining?: boolean;
}

export interface SopListParams {
  page?: number;
  limit?: number;
  status?: SopStatus | string;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

interface RawSopList {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  documents: SopDocument[];
}

// ---------- Service ----------

export const sopService = {
  /** GET /sop — rows arrive under data.documents, not data.rows. */
  listDocuments: async (params: SopListParams = {}): Promise<SopPage> => {
    const response = await api.get<BackendResponse<RawSopList>>(BASE, {
      params,
    });
    const raw = response.data;
    return {
      rows: raw?.documents ?? [],
      total: raw?.total ?? 0,
      page: raw?.page ?? params.page ?? 1,
      limit: raw?.limit ?? params.limit ?? 10,
      totalPages: raw?.totalPages ?? 1,
    };
  },

  /**
   * POST /sop — documentNumber and status ("DRAFT") are assigned server-side.
   */
  createDocument: async (input: SopCreateInput): Promise<SopDocument> => {
    const response = await api.post<BackendResponse<SopDocument>>(BASE, input);
    return response.data;
  },

  /**
   * PATCH /sop/:id/publish — flips the document to PUBLISHED and, when
   * requiresTraining is true, creates a PENDING acknowledgment for every user
   * in the tenant. This is the only way training gets assigned.
   */
  publishDocument: async (documentId: string): Promise<SopDocument> => {
    const response = await api.patch<BackendResponse<SopDocument>>(
      `${BASE}/${documentId}/publish`,
    );
    return response.data;
  },

  /**
   * POST /sop/:documentId/acknowledge — marks the calling user's training for
   * that document COMPLETED. 404s if no acknowledgment was generated for them.
   */
  acknowledgeTraining: async (
    documentId: string,
  ): Promise<TrainingAcknowledgment> => {
    const response = await api.post<BackendResponse<TrainingAcknowledgment>>(
      `${BASE}/${documentId}/acknowledge`,
    );
    return response.data;
  },
};

export default sopService;
