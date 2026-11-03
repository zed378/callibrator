import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";

/**
 * P21-15 (ADR-140) — personal e-signatures, on the GENERATED client:
 *
 *  - `GET/POST /esignature/me`, `POST /esignature/me/revoke` — the caller's own e-signature (a specimen
 *    and a personal key held on the server under KMS); create, replace and revoke re-enter a credential
 *    (a 401 is a wrong credential, not an expired session — `client.ts` CREDENTIAL_ENDPOINTS);
 *  - `GET /esignature/me/applications` — what the caller has signed (rows in `data`, page in `meta`);
 *  - `POST /esignature/documents` — a file signed by the SHA-256 the browser computed; the file is
 *    never uploaded;
 *  - `GET/POST /calibration-records/:id/esignatures` — the applications on a record, and signing it.
 *
 * Not the generic workflow service (`eSignature.service`): that one binds free document ids with no
 * content hash.
 */
type S = components["schemas"];
export type MyEsignature = S["MyEsignature"];
export type MyEsignatureState = S["MyEsignatureState"];
export type EsignatureApplication = S["EsignatureApplication"];
export type CreateBody = JsonBody<Op<"/api/v1/esignature/me", "post">>;
export type RevokeBody = JsonBody<Op<"/api/v1/esignature/me/revoke", "post">>;
export type DocumentBody = JsonBody<Op<"/api/v1/esignature/documents", "post">>;
export type RecordSignBody = JsonBody<Op<"/api/v1/calibration-records/{calibrationRecordId}/esignatures", "post">>;

export const personalEsignatureService = {
  mine: async (): Promise<MyEsignatureState> => (await typedApi.GET("/api/v1/esignature/me").then(unwrap)).data,

  save: async (body: CreateBody): Promise<MyEsignature> => (await typedApi.POST("/api/v1/esignature/me", { body }).then(unwrap)).data,

  revoke: async (body: RevokeBody): Promise<MyEsignature> => (await typedApi.POST("/api/v1/esignature/me/revoke", { body }).then(unwrap)).data,

  signDocument: async (body: DocumentBody): Promise<EsignatureApplication> => (await typedApi.POST("/api/v1/esignature/documents", { body }).then(unwrap)).data,

  recordApplications: async (calibrationRecordId: string): Promise<EsignatureApplication[]> =>
    (await typedApi.GET("/api/v1/calibration-records/{calibrationRecordId}/esignatures", { params: { path: { calibrationRecordId } } }).then(unwrap)).data,

  signRecord: async (calibrationRecordId: string, body: RecordSignBody): Promise<EsignatureApplication> =>
    (await typedApi.POST("/api/v1/calibration-records/{calibrationRecordId}/esignatures", { params: { path: { calibrationRecordId } }, body }).then(unwrap)).data,
};
