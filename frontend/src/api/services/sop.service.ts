import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";

/**
 * SOP — controlled documents and their training acknowledgments.
 *
 * The tenant/author come from the caller's JWT.
 * Backend: src/routes/api/sop.route.ts (mounted /api/v1/sop)
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

// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/sop.openapi.ts). The names are unchanged.

// ---------- Types ----------

export type SopDocument = components["schemas"]["SopDocument"];
export type TrainingAcknowledgment = components["schemas"]["SopTrainingAcknowledgment"];

/** Backend persists uppercase — the full ENUM of models/sopDocument.model.ts. */
export type SopStatus = SopDocument["status"];
export type TrainingStatus = TrainingAcknowledgment["status"];
export type SopAuthor = NonNullable<SopDocument["author"]>;

/** Shape the backend actually returns for GET /sop. */
export interface SopPage {
  rows: SopDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Only these fields are read by the backend; everything else is ignored. */
export type SopCreateInput = JsonBody<Op<"/api/v1/sop", "post">>;

export interface SopListParams {
  page?: number;
  limit?: number;
  /** The page's filter select offers only the SopStatus values. */
  status?: SopStatus | string;
}

/** The older flat answer the list still accepts (`data.documents`). */
interface RawSopList {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  documents: SopDocument[];
}

const byId = (id: string) => ({ params: { path: { id } } });

// ---------- Service ----------

export const sopService = {
  /** GET /sop — rows arrive under data.documents, not data.rows. */
  listDocuments: async (params: SopListParams = {}): Promise<SopPage> => {
    // sop.controller getDocuments answers the house envelope — the documents
    // in `data`, pagination in a top-level `meta` (c131729). Reading only the
    // older flat `data.documents` shape, every list came back empty. Both are
    // read; the envelope wins.
    const query = { ...params, status: params.status as SopStatus | undefined };
    const response = await typedApi.GET("/api/v1/sop", { params: { query } }).then(unwrap);
    const data: RawSopList | SopDocument[] | null = response.data;
    const raw: Partial<RawSopList> = Array.isArray(data)
      ? { documents: data, ...response.meta }
      : (data ?? {});
    return {
      rows: raw.documents ?? [],
      total: raw.total ?? 0,
      page: raw.page ?? params.page ?? 1,
      limit: raw.limit ?? params.limit ?? 10,
      totalPages: raw.totalPages ?? 1,
    };
  },

  /**
   * POST /sop — documentNumber and status ("DRAFT") are assigned server-side.
   */
  createDocument: async (input: SopCreateInput): Promise<SopDocument> => {
    return (await typedApi.POST("/api/v1/sop", { body: input }).then(unwrap)).data;
  },

  /**
   * PATCH /sop/:id/publish — flips the document to PUBLISHED and, when
   * requiresTraining is true, creates a PENDING acknowledgment for every user
   * in the tenant. This is the only way training gets assigned.
   */
  publishDocument: async (documentId: string): Promise<SopDocument> => {
    return (await typedApi.PATCH("/api/v1/sop/{id}/publish", byId(documentId)).then(unwrap)).data;
  },

  /**
   * POST /sop/:documentId/acknowledge — marks the calling user's training for
   * that document COMPLETED. 404s if no acknowledgment was generated for them.
   */
  acknowledgeTraining: async (
    documentId: string,
  ): Promise<TrainingAcknowledgment> => {
    return (await typedApi.POST("/api/v1/sop/{id}/acknowledge", byId(documentId)).then(unwrap)).data;
  },
};

export default sopService;
