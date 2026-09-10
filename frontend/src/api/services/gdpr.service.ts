import { api } from "../client";

/**
 * GDPR / CCPA data-subject rights.
 *
 * Every endpoint acts on the CALLING user — the subject is taken from the JWT
 * (req.user.id), so no userId is ever sent.
 *
 * Backend: src/routes/api/gdpr.route.js (mounted /api/v1/gdpr)
 *   POST /export                    Art. 20 portability
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
 */

const BASE = "/api/v1/gdpr";

// ---------- Types ----------

export type ConsentCategory =
  | "analytics"
  | "marketing"
  | "functional"
  | "necessary";

export interface DsarRequest {
  id: string;
  type?: string;
  status?: string;
  reason?: string | null;
  createdAt?: string;
  completedAt?: string | null;
}

export interface ConsentRecord {
  id: string;
  category?: ConsentCategory | string;
  consent?: boolean;
  ipAddress?: string | null;
  createdAt?: string;
}

/** What PUT /gdpr/consent actually returns — a summary, not the rows. */
export interface ConsentUpdateResult {
  updated: number;
  consent: boolean;
  categories: string[];
}

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
 * metadata. (Verified against the live endpoint.)
 */
export interface ProcessingRecord {
  controller: string;
  tenantId: string;
  subjectId: string;
  generatedAt: string;
  activities: ProcessingActivity[];
}

export interface ExportResult {
  /** Contents vary by deployment; treated as an opaque snapshot. */
  [key: string]: unknown;
}

export interface RectifyResult {
  field?: string;
  value?: unknown;
  updated?: boolean;
}

export interface RestrictResult {
  restricted?: boolean;
  reason?: string;
}

/** POST /erasure — both fields are required; confirm MUST be true. */
export interface ErasureRequestInput {
  reason: string;
  confirm: true;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const gdprService = {
  /** POST /gdpr/export — exports the calling user's data. Takes no body. */
  exportData: async (): Promise<ExportResult> => {
    const response = await api.post<BackendResponse<ExportResult>>(
      `${BASE}/export`,
    );
    return response.data;
  },

  /**
   * POST /gdpr/erasure — files a right-to-erasure DSAR. Returns 201.
   * `reason` is required and `confirm` must be literally true.
   */
  requestErasure: async (input: ErasureRequestInput): Promise<DsarRequest> => {
    // The backend returns only { dsarId } for a freshly-created DSAR; normalise
    // to the DsarRequest shape (id + a known-pending status).
    const response = await api.post<BackendResponse<{ dsarId: string }>>(
      `${BASE}/erasure`,
      input,
    );
    return { id: response.data?.dsarId, status: "pending" };
  },

  /** GET /gdpr/erasure/:requestId */
  getErasureRequest: async (requestId: string): Promise<DsarRequest> => {
    const response = await api.get<BackendResponse<DsarRequest>>(
      `${BASE}/erasure/${requestId}`,
    );
    return response.data;
  },

  /**
   * PUT /gdpr/consent — grants or withdraws consent for a set of categories
   * in one call. The IP is recorded server-side from the request.
   */
  updateConsent: async (
    categories: ConsentCategory[],
    consent: boolean,
  ): Promise<ConsentUpdateResult> => {
    // The backend returns a summary { updated, consent, categories }, NOT the
    // created ConsentRecord rows. Type it accordingly (the UI only checks that
    // the call succeeded, then refetches the history).
    const response = await api.put<BackendResponse<ConsentUpdateResult>>(
      `${BASE}/consent`,
      { categories, consent },
    );
    return response.data;
  },

  /** GET /gdpr/consent/history — plain array in data. */
  getConsentHistory: async (): Promise<ConsentRecord[]> => {
    const response = await api.get<BackendResponse<ConsentRecord[]>>(
      `${BASE}/consent/history`,
    );
    return response.data ?? [];
  },

  /** GET /gdpr/processing — the full Article 30 record. */
  getProcessingRecord: async (): Promise<ProcessingRecord> => {
    // The backend names these fields `legalBasis` / `dataCategories`; the UI
    // reads `lawfulBasis` / `categories`. Normalise each activity so the
    // compliance screen shows the basis and categories instead of blanks.
    const response = await api.get<
      BackendResponse<
        Omit<ProcessingRecord, "activities"> & {
          activities: (ProcessingActivity & {
            legalBasis?: string;
            dataCategories?: string[];
          })[];
        }
      >
    >(`${BASE}/processing`);
    const record = response.data;
    return {
      ...record,
      activities: (record?.activities ?? []).map((a) => ({
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

  /** PUT /gdpr/rectify — corrects a single field on the calling user. */
  rectifyData: async (
    field: string,
    value: unknown,
  ): Promise<RectifyResult> => {
    const response = await api.put<BackendResponse<RectifyResult>>(
      `${BASE}/rectify`,
      { field, value },
    );
    return response.data;
  },

  /** POST /gdpr/restrict — `reason` is required. */
  restrictProcessing: async (reason: string): Promise<RestrictResult> => {
    const response = await api.post<BackendResponse<RestrictResult>>(
      `${BASE}/restrict`,
      { reason },
    );
    return response.data;
  },
};

export default gdprService;
