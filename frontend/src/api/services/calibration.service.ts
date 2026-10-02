// src/api/services/calibration.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. Every call is typed by
// `paths`, and the records, certificates and certificate documents are the
// contract's own schemas (calibrationRecords.openapi.ts, certificates.openapi.ts);
// the request bodies are the contract's, which replaced the interim `z.input`
// types (ADR-097 Am. 1). The exported names are unchanged, so no caller changed.
import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";
import { PaginatedResponse } from "@/types";

type S = components["schemas"];

export type Calibration = S["CalibrationRecord"];

export type CalibrationCreateInput = JsonBody<Op<"/api/v1/calibration-records", "post">>;

/**
 * P6-03 — a calibration record is append-only. A correction writes a NEW
 * record that supersedes `id`; fields omitted are carried over from it.
 * `reason` is required (the backend refuses a blank one).
 */
export type CalibrationCorrectionInput = JsonBody<
  Op<"/api/v1/calibration-records/{calibrationRecordId}/corrections", "post">
> & {
  id: string;
};

export type Certificate = S["Certificate"];

/**
 * M-11 (ADR-095) — what a certificate PDF prints. The backend renders no PDF;
 * GET /certificates/:id/document (authenticated) and the public verification
 * endpoint's `document` (signed certificates only) serve this, and
 * `lib/certificatePdf` renders it in the browser.
 */
export type CertificateDocument = Omit<S["CertificateDocument"], "issuer" | "contentAsOf"> &
  // The backend always sends both; the renderer still prints a document from an
  // older backend without them (A-303, ADR-107), so they stay optional here.
  Partial<Pick<S["CertificateDocument"], "issuer" | "contentAsOf">>;
export type CertificateIntegrity = CertificateDocument["integrity"];
export type CertificateIssuer = NonNullable<CertificateDocument["issuer"]>;

export type CertificateCreateInput = JsonBody<Op<"/api/v1/certificates", "post">>;

/**
 * PUT /certificates/:id edits the certificate's content only. A status change
 * is refused with a 409 (A-64) — status moves only through submit / approve /
 * sign / revoke, which re-authenticate.
 */
export type CertificateUpdateInput = JsonBody<Op<"/api/v1/certificates/{certificateId}", "put">> & {
  id: string;
};

/**
 * 21 CFR Part 11 signing credentials, required by approve/sign/revoke.
 * `authPayload` is the password or MFA code matching `authMethod`; `meaning`
 * records why the person signed (e.g. "Reviewed and approved").
 */
export type ESignatureCredentials = JsonBody<Op<"/api/v1/certificates/{certificateId}/approve", "post">>;

/**
 * As built: the approve form also sends `approvedBy`; the contract does not read
 * it (the approver is the signed-in user, and the validator drops the field).
 */
export type ApproveCertificateInput = ESignatureCredentials & { approvedBy: string };
export type SignCertificateInput = JsonBody<Op<"/api/v1/certificates/{certificateId}/sign", "post">>;
export type CertificateStats = S["CertificateStats"];
export type RevokeCertificateInput = JsonBody<Op<"/api/v1/certificates/{certificateId}/revoke", "post">>;

/**
 * Defensive pagination normalizer. Backend lists normally return
 * `data: { rows, meta }`, but this guards against a plain-array `data`
 * or a missing `meta` so the UI never crashes reading `meta.total`.
 */
interface PageMeta {
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}

const toPaginated = <T>(
  response: {
    success: boolean;
    message: string;
    data: unknown;
    // House style: rows in `data` (array), pagination in `meta` at the TOP
    // level — a sibling of `data`, not `data.meta`.
    meta?: PageMeta;
  },
  page: number,
  limit: number,
): PaginatedResponse<T> => {
  const payload = response?.data as
    | { rows?: T[]; meta?: PageMeta }
    | T[]
    | null
    | undefined;

  const rows: T[] = Array.isArray(payload) ? payload : (payload?.rows ?? []);
  // Prefer the top-level meta; fall back to a nested `data.meta` for the few
  // legacy endpoints that still nest it.
  const meta =
    response?.meta ??
    (payload && !Array.isArray(payload) ? payload.meta : undefined);
  const total = meta?.total ?? rows.length;
  const lim = meta?.limit ?? limit;

  return {
    success: response?.success ?? true,
    message: response?.message ?? "",
    data: rows,
    meta: {
      total,
      page: meta?.page ?? page,
      limit: lim,
      totalPages: meta?.totalPages ?? Math.max(1, Math.ceil(total / lim)),
    },
  };
};

const cert = (certificateId: string) => ({ params: { path: { certificateId } } });
const record = (calibrationRecordId: string) => ({ params: { path: { calibrationRecordId } } });

export const calibrationService = {
  // ==========================================
  // CALIBRATION RECORDS
  // ==========================================
  getAll: async (
    page = 1,
    limit = 20,
    deviceId?: string,
    isCompliant?: boolean | null,
    from?: string,
    to?: string,
  ): Promise<PaginatedResponse<Calibration>> => {
    const response = await typedApi
      .GET("/api/v1/calibration-records", {
        params: { query: { page, limit, deviceId, isCompliant, from, to } },
      })
      .then(unwrap);

    return toPaginated<Calibration>(response, page, limit);
  },

  getById: async (id: string): Promise<Calibration> =>
    (await typedApi.GET("/api/v1/calibration-records/{calibrationRecordId}", record(id)).then(unwrap)).data,

  create: async (data: CalibrationCreateInput): Promise<Calibration> =>
    (await typedApi.POST("/api/v1/calibration-records", { body: data }).then(unwrap)).data,

  // P6-03 — there is no update and no delete: the backend has no PUT or
  // DELETE for a calibration record. Returns the NEW, superseding record.
  correct: async (data: CalibrationCorrectionInput): Promise<Calibration> => {
    const { id, ...rest } = data;
    return (
      await typedApi
        .POST("/api/v1/calibration-records/{calibrationRecordId}/corrections", { ...record(id), body: rest })
        .then(unwrap)
    ).data;
  },

  // A void is final: the record is kept, hidden, with the reason.
  void: async (id: string, reason: string): Promise<void> => {
    await typedApi.POST("/api/v1/calibration-records/{calibrationRecordId}/void", { ...record(id), body: { reason } });
  },

  // ==========================================
  // CERTIFICATES
  // ==========================================
  getAllCertificates: async (
    page = 1,
    limit = 20,
    deviceId?: string,
    status?: Certificate["status"][],
    type?: Certificate["type"][],
    certificateNumber?: string,
    from?: string,
    to?: string,
  ): Promise<PaginatedResponse<Certificate>> => {
    const response = await typedApi
      .GET("/api/v1/certificates", {
        params: { query: { page, limit, deviceId, status, type, certificateNumber, from, to } },
      })
      .then(unwrap);

    return toPaginated<Certificate>(response, page, limit);
  },

  getCertificateById: async (id: string): Promise<Certificate> =>
    (await typedApi.GET("/api/v1/certificates/{certificateId}", cert(id)).then(unwrap)).data,

  /**
   * GET /certificates/:id/document — the data its PDF prints (M-11, ADR-095).
   * The PDF itself is rendered in the browser (lib/certificatePdf).
   */
  getCertificateDocument: async (id: string): Promise<CertificateDocument> =>
    (await typedApi.GET("/api/v1/certificates/{certificateId}/document", cert(id)).then(unwrap)).data,

  createCertificate: async (data: CertificateCreateInput): Promise<Certificate> =>
    (await typedApi.POST("/api/v1/certificates", { body: data }).then(unwrap)).data,

  updateCertificate: async (data: CertificateUpdateInput): Promise<Certificate> => {
    const { id, ...rest } = data;
    return (await typedApi.PUT("/api/v1/certificates/{certificateId}", { ...cert(id), body: rest }).then(unwrap)).data;
  },

  deleteCertificate: async (id: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/certificates/{certificateId}", cert(id));
  },

  /**
   * POST /certificates/:id/submit — draft → pending_approval. The next step,
   * approval, must come from another user (ADR-101). A certificate that is not
   * a draft answers 409 with the state explanation, which is shown as is.
   */
  submitCertificate: async (id: string): Promise<Certificate> =>
    (
      await typedApi
        .POST("/api/v1/certificates/{certificateId}/submit", {
          ...cert(id),
          // As built: an empty JSON object, though the contract reads no body.
          body: {} as never,
        })
        .then(unwrap)
    ).data,

  /**
   * POST /certificates/:id/approve — the e-signature triple (authMethod,
   * authPayload, meaning) is required (21 CFR Part 11).
   */
  approveCertificate: async (id: string, input: ApproveCertificateInput): Promise<Certificate> =>
    (
      await typedApi
        .POST("/api/v1/certificates/{certificateId}/approve", {
          ...cert(id),
          // As built: `approvedBy` rides along; the contract does not read it.
          body: input as ESignatureCredentials,
        })
        .then(unwrap)
    ).data,

  /** POST /certificates/:id/sign — signature + key id + the Part 11 triple. */
  signCertificate: async (id: string, input: SignCertificateInput): Promise<Certificate> =>
    (await typedApi.POST("/api/v1/certificates/{certificateId}/sign", { ...cert(id), body: input }).then(unwrap)).data,

  /** POST /certificates/:id/revoke — reason + the Part 11 triple. */
  revokeCertificate: async (id: string, input: RevokeCertificateInput): Promise<Certificate> =>
    (await typedApi.POST("/api/v1/certificates/{certificateId}/revoke", { ...cert(id), body: input }).then(unwrap)).data,

  getCertificateStats: async (): Promise<CertificateStats> =>
    (await typedApi.GET("/api/v1/certificates/stats").then(unwrap)).data,

  /**
   * Absolute public verification URL for a certificate (the QR-code target).
   * The PDF is rendered client-side; the backend only serves the DB record and
   * this public verify endpoint.
   */
  getVerifyUrl: (certificateNumber: string): string => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/api/v1/certificates/verify/${encodeURIComponent(certificateNumber)}`;
  },
};
