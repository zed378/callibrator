import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";

/**
 * P23-02 — the IPM report (P19-06 § 7, § 10; built by P21-04, ADR-126 Am. 2, Am. 5), on the
 * GENERATED client:
 *
 *  - `GET /ipm/sessions/:id/report-document` — the data document the report is drawn from (a
 *    preview for the draft's creator, the issued report otherwise). `render=pdf` is passed when the
 *    reader downloads: the server writes the audit row BEFORE it answers (G-R10), so every
 *    downloaded PDF is rendered from a fresh, audited read — never from the copy on screen.
 *  - `POST /ipm/sessions/:id/signatures` — the performer's signature or the IPSRS countersignature,
 *    with the credential re-entered now (a 401 is a wrong credential, not an expired session —
 *    `client.ts` CREDENTIAL_PATTERNS).
 */
type S = components["schemas"];
export type IpmReportDocument = S["IpmReportDocument"];
export type IpmReportSignature = S["IpmReportSignature"];
export type SignatureBody = JsonBody<Op<"/api/v1/ipm/sessions/{sessionId}/signatures", "post">>;

export const ipmReportService = {
  document: async (sessionId: string, render?: { lang: "id" | "en" }): Promise<IpmReportDocument> =>
    (
      await typedApi
        .GET("/api/v1/ipm/sessions/{sessionId}/report-document", {
          params: { path: { sessionId }, ...(render ? { query: { render: "pdf" as const, lang: render.lang } } : {}) },
        })
        .then(unwrap)
    ).data,

  sign: async (sessionId: string, body: SignatureBody): Promise<IpmReportSignature> =>
    (await typedApi.POST("/api/v1/ipm/sessions/{sessionId}/signatures", { params: { path: { sessionId } }, body }).then(unwrap)).data,
};
