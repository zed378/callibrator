import { api } from "../client";

// ---------- Types ----------

export interface CertificateOcrResult {
  certificateNumber?: string;
  calibrationDate?: string;
  dueDate?: string;
  vendorName?: string;
  deviceSerialNumber?: string;
  status?: "PASS" | "FAIL" | string;
}

export interface RagQueryResult {
  answer: string;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const aiService = {
  /**
   * Extract structured fields from a certificate image/PDF via OCR.
   * POST /api/v1/ai/ocr (multipart form-data; field name: "file")
   */
  ocr: async (file: File): Promise<CertificateOcrResult> => {
    const form = new FormData();
    form.append("file", file);
    const response = await api.post<BackendResponse<CertificateOcrResult>>(
      "/api/v1/ai/ocr",
      form,
    );
    return response.data;
  },

  /**
   * Ask a question answered over tenant documents (RAG).
   * POST /api/v1/ai/query
   */
  query: async (question: string): Promise<RagQueryResult> => {
    const response = await api.post<BackendResponse<RagQueryResult>>(
      "/api/v1/ai/query",
      { question },
    );
    return response.data;
  },
};

export default aiService;
