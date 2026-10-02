/**
 * P9-18 / P9-25 (ADR-103) — the contract of `ai.route.ts`, code-first.
 *
 * Both routes sit behind `router.use(auth)` and a menu gate (A-94): OCR on
 * `certificate` write (the gate runs before multer, so a refused request never
 * buffers the file), question answering on `sop` read (the store holds SOP
 * documents only). A tenant with no AI provider gets 409, naming what to
 * configure; a provider that was asked and failed is 502 (A-281). Neither body
 * is validated by a schema on the route: the controller reads the field it
 * needs. Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";

const NOT_CONFIGURED = "No AI provider is configured for the tenant (an administrator sets the AI API key in the organisation's settings).";
const UPSTREAM = "A provider that was asked and returned nothing answers 502.";

export default defineRouteDocs({
  router: "api/ai.route",
  mount: "/api/v1/ai",
  tag: "AI",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/ocr",
      operationId: "processCertificateOcr",
      summary: "Certificate OCR extraction",
      description: `Extracts structured data from an uploaded certificate image or PDF (5 MB at most). 400 without a file. ${UPSTREAM}`,
      permission: { kind: "dynamicAccess", resource: "certificate", action: "write" },
      audited: false,
      bodyMediaType: "multipart/form-data",
      body: z.object({ file: z.string().meta({ format: "binary", description: "The certificate image or PDF" }) }),
      conflict: NOT_CONFIGURED,
      success: {
        status: 200,
        description: "The fields the provider extracted",
        data: z.object({}).loose().meta({ id: "CertificateOcrResult", example: { certificateNumber: "CAL-2030-0042", calibrationDate: "2030-01-15" } }),
      },
    },
    {
      method: "post",
      path: "/query",
      operationId: "queryDocuments",
      summary: "Answer a question over the tenant's SOP documents (RAG)",
      description: `400 without a question. ${UPSTREAM}`,
      permission: { kind: "dynamicAccess", resource: "sop", action: "read" },
      audited: false,
      body: z.object({ question: z.string().meta({ example: "How often are infusion pumps calibrated?" }) }).meta({ description: "Read by the controller; not validated by a schema on the route." }),
      conflict: NOT_CONFIGURED,
      success: {
        status: 200,
        description: "The answer",
        data: z.object({ answer: z.string() }).meta({ id: "RagAnswer", example: { answer: "Every 12 months, per SOP-0003." } }),
      },
    },
  ],
});
