/**
 * The contract of `publicEsignatures.route.ts`, code-first (ADR-103): the public verification of an
 * e-signature application (P21-15; ADR-140; spec MEMORY/specs/P21-15-operator-esignature.md v2 § 4).
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { EsignatureVerification } from "../../docs/openapi/esignatureSchemas";

export default defineRouteDocs({
  router: "api/publicEsignatures.route",
  mount: "/api/v1/public/esignatures",
  tag: "Public E-signature Verification",
  tagDescription: "The verification of one e-signature application, by its link's capability token (ADR-140)",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/:applicationId",
      operationId: "verifyEsignatureApplication",
      summary: "Verify an e-signature application (no auth)",
      description:
        "The target of an application's link and QR. Shows the verdict (`valid`, `content_changed`, `invalid`; a document is `valid` or `invalid`, the reader " +
        "compares the file) and its explanation in Indonesian and English, the e-signature's state (`active`, `superseded`, `revoked` with its day), the " +
        "record's state, the signer's name, role and organisation, the specimen, the key fingerprint and public key, the meaning, the time, the organisation, " +
        "the document type and title, the content hash, the canonical content of a record and a minimal summary. Never an e-mail, an address, an agent, the " +
        "token, or an internal id outside the canonical content. A malformed, unknown or mismatched link answers the same 404. Every answer carries " +
        "`Cache-Control: no-store` and `X-Robots-Tag: noindex`. Per client address every request counts against 300 per 15 minutes and every answer that is " +
        "not a verdict also against 60; beyond either, 429 with Retry-After.",
      permission: null,
      audited: false,
      params: z.object({ applicationId: z.string().meta({ description: "The application's id", example: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a" }) }),
      query: z.object({ token: z.string().optional().meta({ description: "The link's token (32 base64url characters)", example: "q3kZ0x9VbN2mP4rT6wY8aC1dE3fG5hJ7" }) }),
      success: { status: 200, description: "The verdict", data: EsignatureVerification },
    },
  ],
});
