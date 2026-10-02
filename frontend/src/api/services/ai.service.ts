// src/api/services/ai.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. The calls and the types are
// read off `paths` (src/api/generated/schema.d.ts, `npm run api:types`, from
// backend/src/routes/api/ai.openapi.ts); the exported names are unchanged, so
// no caller changed.
import { api } from "../client";
import { typedApi, unwrap, type components } from "../typed";

// ---------- Types ----------

/**
 * The OCR fields the certificate form reads. The contract publishes the OCR
 * result as an open object (the provider decides what it extracts), so the
 * fields the UI reads are named here, every one optional.
 */
export interface CertificateOcrResult {
  certificateNumber?: string;
  calibrationDate?: string;
  dueDate?: string;
  vendorName?: string;
  deviceSerialNumber?: string;
  status?: "PASS" | "FAIL" | string;
}

export type RagQueryResult = components["schemas"]["RagAnswer"];

// ---------- Service ----------

export const aiService = {
  /**
   * Extract structured fields from a certificate image/PDF via OCR.
   * POST /api/v1/ai/ocr (multipart form-data; field name: "file").
   * Stays on `api`: a multipart body is not a JSON body the typed client sends.
   */
  ocr: async (file: File): Promise<CertificateOcrResult> => {
    const form = new FormData();
    form.append("file", file);
    const response = await api.post<{ data: components["schemas"]["CertificateOcrResult"] }>("/api/v1/ai/ocr", form);
    return response.data as CertificateOcrResult;
  },

  /**
   * Ask a question answered over tenant documents (RAG).
   * POST /api/v1/ai/query
   */
  query: async (question: string): Promise<RagQueryResult> => {
    const response = await typedApi.POST("/api/v1/ai/query", { body: { question } }).then(unwrap);
    return response.data;
  },
};

export default aiService;
