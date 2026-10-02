import { api } from "../client";
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";

/**
 * GDPR / CCPA data-subject rights.
 *
 * Every endpoint acts on the CALLING user — the subject is taken from the JWT
 * (req.user.id), so no userId is ever sent.
 *
 * Backend: src/routes/api/gdpr.route.ts (mounted /api/v1/gdpr)
 *   POST /export                    Art. 20 portability — writes the archive
 *   GET  /exports/:exportId/download   the archive (a ZIP), own export only (A-360)
 *   POST /erasure                   Art. 17 — recorded as a DSAR
 *   GET  /erasure/:requestId
 *   PUT  /consent                   { categories, consent }
 *   GET  /consent/history
 *   GET  /processing                Art. 30
 *   PUT  /rectify                   Art. 16 — { field, value }
 *   POST /restrict                  Art. 18 — { reason }
 *
 * There is no erasure LIST route — only submit and read-one.
 * The read endpoints return plain arrays in `data` (no rows/meta wrapper).
 *
 * P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
 * contract's (backend/src/routes/api/gdpr.openapi.ts). The exported names are
 * unchanged.
 */

type G = "/api/v1/gdpr";

// ---------- Types ----------

export type ConsentCategory = JsonBody<Op<`${G}/consent`, "put">>["categories"][number];

/**
 * A DSAR. GET /erasure/:requestId answers the row; POST /erasure answers only
 * `{ dsarId }`, which the service normalises to `{ id, status: "pending" }`.
 */
export type DsarRequest = Partial<DataOf<Op<`${G}/erasure/{requestId}`, "get">>> & { id: string };

/**
 * A ConsentRecord row: the category is `purpose` and the decision `status`
 * ("granted" | "withdrawn") — there is no `category` or `consent` attribute.
 */
export type ConsentRecord = components["schemas"]["ConsentRecord"];

/** What PUT /gdpr/consent actually returns — a summary, not the rows. */
export type ConsentUpdateResult = DataOf<Op<`${G}/consent`, "put">>;

/** The Article 30 record as the backend sends it (`legalBasis`, `dataCategories`). */
type ProcessingDocument = DataOf<Op<`${G}/processing`, "get">>;

/**
 * One processing activity as the UI reads it: the backend's `legalBasis` /
 * `dataCategories` under the UI's names (`getProcessingRecord` maps them).
 * Activities carry no id.
 */
export interface ProcessingActivity {
  id?: string;
  purpose?: string;
  lawfulBasis?: string;
  categories?: string[];
  retention?: string;
}

/**
 * GET /processing returns an Article 30 record-of-processing document, not a
 * bare list: the activities sit under `activities` alongside controller
 * metadata.
 */
export type ProcessingRecord = Omit<ProcessingDocument, "activities"> & { activities: ProcessingActivity[] };

/**
 * POST /export: the export's id, its download URL, expiry and size — the
 * metadata of the archive, not the data. The archive itself is
 * `downloadExport(exportId)` (A-360).
 */
export type ExportResult = DataOf<Op<`${G}/export`, "post">>;

export type RectifyResult = DataOf<Op<`${G}/rectify`, "put">>;

export type RestrictResult = DataOf<Op<`${G}/restrict`, "post">>;

/** POST /erasure — both fields are required; confirm MUST be true. */
export interface ErasureRequestInput {
  reason: string;
  confirm: true;
}

// ---------- Service ----------

export const gdprService = {
  /** POST /gdpr/export — exports the calling user's data. Takes no body. */
  exportData: async (): Promise<ExportResult> =>
    (await typedApi.POST("/api/v1/gdpr/export").then(unwrap)).data,

  /**
   * GET /gdpr/exports/:exportId/download — the archive POST /export wrote (a
   * ZIP of JSON files), for the calling user only; anything else is a 404.
   * Not an envelope: read as a blob, or axios would parse it as JSON and
   * nothing would be saved (A-360, ADR-114). The path is built from the id,
   * never taken from the answer's `downloadUrl` as given.
   */
  downloadExport: async (exportId: string): Promise<Blob> =>
    api.get<Blob>(`/api/v1/gdpr/exports/${encodeURIComponent(exportId)}/download`, {
      responseType: "blob",
    }),

  /**
   * POST /gdpr/erasure — files a right-to-erasure DSAR. Returns 201.
   * `reason` is required and `confirm` must be literally true.
   */
  requestErasure: async (input: ErasureRequestInput): Promise<DsarRequest> => {
    // The backend returns only { dsarId } for a freshly-created DSAR; normalise
    // to the DsarRequest shape (id + a known-pending status).
    const response = await typedApi.POST("/api/v1/gdpr/erasure", { body: input }).then(unwrap);
    // Defensive, as built: a body without `data` gives no id.
    return { id: response.data?.dsarId as string, status: "pending" };
  },

  /** GET /gdpr/erasure/:requestId */
  getErasureRequest: async (requestId: string): Promise<DsarRequest> =>
    (await typedApi.GET("/api/v1/gdpr/erasure/{requestId}", { params: { path: { requestId } } }).then(unwrap)).data,

  /**
   * PUT /gdpr/consent — grants or withdraws consent for a set of categories
   * in one call. The IP is recorded server-side from the request.
   */
  updateConsent: async (
    categories: ConsentCategory[],
    consent: boolean,
  ): Promise<ConsentUpdateResult> =>
    // The backend returns a summary { updated, consent, categories }, NOT the
    // created ConsentRecord rows (the UI only checks that the call succeeded,
    // then refetches the history).
    (await typedApi.PUT("/api/v1/gdpr/consent", { body: { categories, consent } }).then(unwrap)).data,

  /** GET /gdpr/consent/history — plain array in data. */
  getConsentHistory: async (): Promise<ConsentRecord[]> =>
    (await typedApi.GET("/api/v1/gdpr/consent/history").then(unwrap)).data ?? [],

  /** GET /gdpr/processing — the full Article 30 record. */
  getProcessingRecord: async (): Promise<ProcessingRecord> => {
    // The backend names these fields `legalBasis` / `dataCategories`; the UI
    // reads `lawfulBasis` / `categories`. Normalise each activity so the
    // compliance screen shows the basis and categories instead of blanks.
    const record = (await typedApi.GET("/api/v1/gdpr/processing").then(unwrap)).data;
    // As built: an activity already in the UI's vocabulary is kept as it is.
    const activities = (record?.activities ?? []) as (ProcessingDocument["activities"][number] & ProcessingActivity)[];
    return {
      ...record,
      activities: activities.map((a) => ({
        id: a.id,
        purpose: a.purpose,
        retention: a.retention,
        lawfulBasis: a.lawfulBasis ?? a.legalBasis,
        categories: a.categories ?? a.dataCategories,
      })),
    };
  },

  /** Convenience: just the activities from the Article 30 record. */
  getProcessingActivities: async (): Promise<ProcessingActivity[]> => {
    const record = await gdprService.getProcessingRecord();
    return record?.activities ?? [];
  },

  /**
   * PUT /gdpr/rectify — corrects a single field on the calling user.
   * A-214: an email change needs `currentPassword` and, on an MFA account, a
   * current `code` (or `recoveryCode`); other fields need neither.
   */
  rectifyData: async (
    field: string,
    value: unknown,
    reauth?: { currentPassword: string; code?: string; recoveryCode?: string },
  ): Promise<RectifyResult> =>
    (await typedApi.PUT("/api/v1/gdpr/rectify", { body: { field, value, ...(reauth ?? {}) } }).then(unwrap)).data,

  /** POST /gdpr/restrict — `reason` is required. */
  restrictProcessing: async (reason: string): Promise<RestrictResult> =>
    (await typedApi.POST("/api/v1/gdpr/restrict", { body: { reason } }).then(unwrap)).data,
};

export default gdprService;
