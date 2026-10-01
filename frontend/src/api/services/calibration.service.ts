import { api } from "../client";
import { PaginatedResponse } from "@/types";
import type {
  CorrectCalibrationRecordInput,
  CreateCalibrationRecordInput,
  VoidCalibrationRecordInput,
} from "@callibrator/contracts/calibrationRecords";

export interface Calibration {
  id: string;
  tenantId: string;
  deviceId: string;
  performedBy: string;
  calibrationDate: string;
  dueDate?: string;
  standard?: string;
  results?: Record<string, unknown>;
  isCompliant: boolean | null;
  certificateNumber?: string;
  certificateFileUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  device?: {
    id: string;
    name: string;
    serialNumber: string;
    manufacturer: string;
    model: string;
    category?: string;
  };
  performer?: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
  } | null;
  /** Q-51 (ADR-100 Am. 2): the API key that wrote the row, when no user did. */
  apiKey?: { id: string; name: string; keyPrefix?: string | null } | null;
}

// P9-22 (ADR-097): the request bodies are the backend validator's own schemas
// (@callibrator/contracts/calibrationRecords), not a hand-written copy.
export type CalibrationCreateInput = CreateCalibrationRecordInput;

/**
 * P6-03 — a calibration record is append-only. A correction writes a NEW
 * record that supersedes `id`; fields omitted are carried over from it.
 * `reason` is required (the backend refuses a blank one).
 */
export type CalibrationCorrectionInput = CorrectCalibrationRecordInput & {
  id: string;
};

export interface Certificate {
  id: string;
  tenantId: string;
  calibrationRecordId?: string;
  deviceId: string;
  certificateNumber: string;
  type: "calibration" | "maintenance" | "verification";
  status: "draft" | "pending_approval" | "approved" | "signed" | "revoked";
  calibratedBy?: string;
  approvedBy?: string;
  signedBy?: string;
  /** Who drafted it. ADR-101: its author may not approve it. */
  createdBy?: string | null;
  /** Who submitted it for approval (ADR-101): may not approve it either. */
  submittedBy?: string | null;
  digitalSignature?: string;
  digitalSignatureKeyId?: string;
  signedAt?: string;
  issueDate?: string;
  validUntil?: string;
  standard?: string;
  summary?: string;
  conditions?: string;
  notes?: string;
  filePath?: string;
  fileSize?: string;
  createdAt: string;
  updatedAt: string;
  device?: {
    id: string;
    name: string;
    serialNumber: string;
    manufacturer: string;
    model: string;
  };
  calibratedByUser?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  approvedByUser?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  signedByUser?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

/**
 * M-11 (ADR-095) — what a certificate PDF prints. The backend renders no PDF;
 * GET /certificates/:id/document (authenticated) and the public verification
 * endpoint's `document` (signed certificates only) serve this, and
 * `lib/certificatePdf` renders it in the browser.
 */
export interface CertificateIntegrity {
  /**
   * The scheme `hash` follows: "certificate-content-v3" for a certificate
   * signed with a snapshot of what it prints (ADR-107), "certificate-content-v2"
   * for one signed before it, or not signed yet.
   */
  scheme: string;
  algorithm: "SHA-256";
  /** SHA-256 over every printed column of the certificate row. */
  hash: string;
  /** The pre-M-11 hash printed on PDFs the backend rendered. */
  legacyHash: string;
  /** Authenticated document only: the server HMAC over `hash`, and its key id. */
  signature?: string;
  signatureKeyId?: string;
}

/**
 * A-303: the issuing laboratory as the certificate prints it (ISO/IEC 17025
 * 7.8.2). The live tenant row — NOT covered by the integrity hash.
 */
export interface CertificateIssuer {
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  website: string | null;
}

export interface CertificateDocument {
  certificateNumber: string;
  type: string;
  status: string;
  issuedBy: string | null;
  /** A-303: absent from a backend older than the issuer block; null when the tenant was not loaded. */
  issuer?: CertificateIssuer | null;
  device: {
    name: string | null;
    serialNumber: string | null;
    manufacturer: string | null;
    model: string | null;
  } | null;
  standard: string | null;
  issueDate: string | null;
  validUntil: string | null;
  summary: string | null;
  conditions: string | null;
  notes: string | null;
  calibratedBy: string | null;
  approvedBy: string | null;
  signedBy: string | null;
  signedAt: string | null;
  /** What the QR code carries: the public verification page for this certificate. */
  verifyUrl: string;
  integrity: CertificateIntegrity;
  /**
   * ADR-107: "signing" — the issuer, instrument and people are as recorded at
   * signing (v3); "live" — the current rows (a draft, or a certificate signed
   * before ADR-107). Absent from a backend older than ADR-107.
   */
  contentAsOf?: "signing" | "live";
}

interface BackendCertificateDocumentResponse {
  success: boolean;
  status: number;
  message: string;
  data: CertificateDocument;
}

export interface CertificateCreateInput {
  deviceId: string;
  calibrationRecordId?: string;
  type?: "calibration" | "maintenance" | "verification";
  summary?: string;
  conditions?: string;
  notes?: string;
  standard?: string;
  validUntil?: string;
}

/**
 * PUT /certificates/:id edits the certificate's content only. There is no
 * `status`: the backend refuses a status change with a 409 (A-64) — status
 * moves only through submit / approve / sign / revoke, which re-authenticate.
 */
export interface CertificateUpdateInput extends Partial<CertificateCreateInput> {
  id: string;
}

/**
 * 21 CFR Part 11 signing credentials, required by approve/sign/revoke.
 * `authPayload` is the password or MFA code matching `authMethod`; `meaning`
 * records why the person signed (e.g. "Reviewed and approved").
 */
export interface ESignatureCredentials {
  authMethod: "password" | "mfa";
  authPayload: string;
  meaning: string;
}

export interface ApproveCertificateInput extends ESignatureCredentials {
  /** The approving user's id. */
  approvedBy: string;
}

export interface SignCertificateInput extends ESignatureCredentials {
  digitalSignature: string;
  digitalSignatureKeyId: string;
}

export interface RevokeCertificateInput extends ESignatureCredentials {
  reason: string;
}

// Backend response structures
interface BackendCalibrationsResponse {
  success: boolean;
  status: number;
  message: string;
  data: {
    rows: Calibration[];
    count: number;
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  };
}

interface BackendCalibrationResponse {
  success: boolean;
  status: number;
  message: string;
  data: Calibration;
}

interface BackendCertificatesResponse {
  success: boolean;
  status: number;
  message: string;
  data: {
    rows: Certificate[];
    count: number;
    meta: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  };
}

interface BackendCertificateResponse {
  success: boolean;
  status: number;
  message: string;
  data: Certificate;
}

interface BackendCertificateStatsResponse {
  success: boolean;
  status: number;
  message: string;
  data: {
    totalCertificates: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    latestCertificate?: Certificate;
  };
}

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
    const response = await api.get<BackendCalibrationsResponse>(
      "/api/v1/calibration-records",
      {
        params: { page, limit, deviceId, isCompliant, from, to },
      },
    );

    return toPaginated<Calibration>(response, page, limit);
  },

  getById: async (id: string): Promise<Calibration> => {
    const response = await api.get<BackendCalibrationResponse>(
      `/api/v1/calibration-records/${id}`,
    );
    return response.data;
  },

  create: async (data: CalibrationCreateInput): Promise<Calibration> => {
    const response = await api.post<BackendCalibrationResponse>(
      "/api/v1/calibration-records",
      data,
    );
    return response.data;
  },

  // P6-03 — there is no update and no delete: the backend has no PUT or
  // DELETE for a calibration record. Returns the NEW, superseding record.
  correct: async (data: CalibrationCorrectionInput): Promise<Calibration> => {
    const { id, ...rest } = data;
    const response = await api.post<BackendCalibrationResponse>(
      `/api/v1/calibration-records/${id}/corrections`,
      rest,
    );
    return response.data;
  },

  // A void is final: the record is kept, hidden, with the reason.
  void: async (id: string, reason: string): Promise<void> => {
    const body: VoidCalibrationRecordInput = { reason };
    await api.post(`/api/v1/calibration-records/${id}/void`, body);
  },

  // ==========================================
  // CERTIFICATES
  // ==========================================
  getAllCertificates: async (
    page = 1,
    limit = 20,
    deviceId?: string,
    status?: string[],
    type?: string[],
    certificateNumber?: string,
    from?: string,
    to?: string,
  ): Promise<PaginatedResponse<Certificate>> => {
    const response = await api.get<BackendCertificatesResponse>(
      "/api/v1/certificates",
      {
        params: { page, limit, deviceId, status, type, certificateNumber, from, to },
      },
    );

    return toPaginated<Certificate>(response, page, limit);
  },

  getCertificateById: async (id: string): Promise<Certificate> => {
    const response = await api.get<BackendCertificateResponse>(
      `/api/v1/certificates/${id}`,
    );
    return response.data;
  },

  /**
   * GET /certificates/:id/document — the data its PDF prints (M-11, ADR-095).
   * The PDF itself is rendered in the browser (lib/certificatePdf).
   */
  getCertificateDocument: async (id: string): Promise<CertificateDocument> => {
    const response = await api.get<BackendCertificateDocumentResponse>(
      `/api/v1/certificates/${id}/document`,
    );
    return response.data;
  },

  createCertificate: async (data: CertificateCreateInput): Promise<Certificate> => {
    const response = await api.post<BackendCertificateResponse>(
      "/api/v1/certificates",
      data,
    );
    return response.data;
  },

  updateCertificate: async (data: CertificateUpdateInput): Promise<Certificate> => {
    const { id, ...rest } = data;
    const response = await api.put<BackendCertificateResponse>(
      `/api/v1/certificates/${id}`,
      rest,
    );
    return response.data;
  },

  deleteCertificate: async (id: string): Promise<void> => {
    await api.delete(`/api/v1/certificates/${id}`);
  },

  /**
   * POST /certificates/:id/submit — draft → pending_approval. The next step,
   * approval, must come from another user (ADR-101). A certificate that is not
   * a draft answers 409 with the state explanation, which is shown as is.
   */
  submitCertificate: async (id: string): Promise<Certificate> => {
    const response = await api.post<BackendCertificateResponse>(
      `/api/v1/certificates/${id}/submit`,
      {},
    );
    return response.data;
  },

  /**
   * POST /certificates/:id/approve
   *
   * 21 CFR Part 11: approvedBy AND the e-signature triple (authMethod,
   * authPayload, meaning) are all required — this previously sent only
   * approvedBy and 400'd on every call.
   */
  approveCertificate: async (
    id: string,
    input: ApproveCertificateInput,
  ): Promise<Certificate> => {
    const response = await api.post<BackendCertificateResponse>(
      `/api/v1/certificates/${id}/approve`,
      input,
    );
    return response.data;
  },

  /** POST /certificates/:id/sign — signature + key id + the Part 11 triple. */
  signCertificate: async (
    id: string,
    input: SignCertificateInput,
  ): Promise<Certificate> => {
    const response = await api.post<BackendCertificateResponse>(
      `/api/v1/certificates/${id}/sign`,
      input,
    );
    return response.data;
  },

  /** POST /certificates/:id/revoke — reason + the Part 11 triple. */
  revokeCertificate: async (
    id: string,
    input: RevokeCertificateInput,
  ): Promise<Certificate> => {
    const response = await api.post<BackendCertificateResponse>(
      `/api/v1/certificates/${id}/revoke`,
      input,
    );
    return response.data;
  },

  getCertificateStats: async (): Promise<BackendCertificateStatsResponse["data"]> => {
    const response = await api.get<BackendCertificateStatsResponse>(
      "/api/v1/certificates/stats",
    );
    return response.data;
  },

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
