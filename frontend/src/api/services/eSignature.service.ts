import { typedApi, unwrap, type JsonBody, type Op, type QueryOf, type components } from "../typed";
import type { PaginatedResponse } from "@/types";

/**
 * E-Signature (21 CFR Part 11).
 *
 * The tenant/user come from the caller's JWT.
 * Backend: src/routes/api/eSignature.route.ts — mounted at /api/v1/esignature
 * (NOT /e-signature).
 *   GET    /key-pairs
 *   POST   /key-pairs                (denies API keys)
 *   DELETE /key-pairs/:keyPairId
 *   GET    /workflows                ?status       (management: qms)
 *   POST   /workflows                signers by userId only (A-129)
 *   GET    /signers                  users a workflow may name (qms write, A-129)
 *   GET    /workflows/:workflowId
 *   GET    /my-workflows             ?stepStatus   (signer view, A-91)
 *   GET    /my-workflows/:workflowId              (signer view, A-91)
 *   PUT    /workflows/:workflowId
 *   DELETE /workflows/:workflowId    409 once any step is signed (A-130)
 *   POST   /workflows/:workflowId/cancel             (A-130)
 *   POST   /sign                     (denies API keys; `reason` required)
 *   POST   /verify
 *   GET    /history                  ?userId&startDate&endDate&page&limit (D-24: paginated)
 *
 * P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
 * contract's (backend/src/routes/api/eSignature.openapi.ts). The exported
 * names are unchanged.
 */

type B = "/api/v1/esignature";
type Schemas = components["schemas"];

// ---------- Types ----------

export type CreateKeyPairInput = JsonBody<Op<`${B}/key-pairs`, "post">>;
export type KeyPairAlgorithm = NonNullable<CreateKeyPairInput["algorithm"]>;
export type KeySize = NonNullable<CreateKeyPairInput["keySize"]>;

/** A tenant signing key as GET /key-pairs lists it (the public half only). */
export type KeyPair = Schemas["ESignatureKeyPair"];
/** What POST /key-pairs answers: the private half is never sent. */
export type GeneratedKeyPair = Schemas["ESignatureGeneratedKeyPair"];

/**
 * POST /workflows body (A-129, ADR-051 Q-19, A-86): each signer is a user of
 * the tenant, by id. The backend reads the name and email from the user
 * record and ignores any in the body; an email-only signer is refused (400).
 */
export type CreateWorkflowInput = JsonBody<Op<`${B}/workflows`, "post">>;
export type Signer = CreateWorkflowInput["signers"][number];
export type UpdateWorkflowInput = JsonBody<Op<`${B}/workflows/{workflowId}`, "put">>;

/**
 * One row of GET /signers — an active user of the tenant holding
 * `esignature` write, i.e. a user POST /workflows will accept as a signer.
 */
export type EligibleSigner = Schemas["EligibleSigner"];

/** What POST /workflows returns in `data`: `{ workflowId, signers }`. */
export type CreatedWorkflow = Schemas["SignatureWorkflowCreated"];

export type SignatureWorkflow = Schemas["SignatureWorkflow"];

/**
 * One signer's slot inside GET /workflows/:id → data.steps. The signer is
 * `signerId` (there is no `userId` on a step). Only that user can sign the
 * step — anyone else gets 403 (A-65).
 */
export type SignatureStep = Schemas["SignatureWorkflowStep"];

/**
 * A row of GET /history. `ipAddress`, `userAgent` and `biometricData` are
 * present only for a caller holding `qms` read; everyone else gets their own
 * signatures without them (A-129, F-9).
 */
export type SignatureRecord = Schemas["SignatureRecord"];
export type AuthenticationMethod = SignatureRecord["authenticationMethod"];

/** POST /verify: `valid` is true ONLY for a verified signature; `verificationStatus` says why not. */
export type VerifyResult = Schemas["SignatureVerification"];

/**
 * POST /sign body. Signing re-authenticates the signer: `authPayload` is their
 * password or current MFA code, matching `authenticationMethod`. There is no
 * ipAddress / userAgent — the backend records the connection's own, and
 * ignores any in the body (A-65). `reason` is the meaning of the signature
 * (21 CFR 11.50), required (A-129).
 */
export type SignDocumentInput = JsonBody<Op<`${B}/sign`, "post">>;

/** The methods the backend can re-verify at the moment of signing (A-65). */
export type SigningAuthMethod = NonNullable<SignDocumentInput["authenticationMethod"]>;

/**
 * What POST /sign returns in `data`: `{ signatureId, certificate }`, the
 * certificate summarising the signature.
 */
export type SignDocumentResult = Schemas["SignatureResult"];

/** GET /history filters (D-24, ADR-070: 1-based page, default 25, capped at 200). */
export type SignatureHistoryParams = QueryOf<Op<`${B}/history`, "get">>;

/** The caller's own step status, for GET /my-workflows?stepStatus=. */
export type SignerStepStatus = NonNullable<QueryOf<Op<`${B}/my-workflows`, "get">>["stepStatus"]>;

type WorkflowStatus = NonNullable<QueryOf<Op<`${B}/workflows`, "get">>["status"]>;

const workflow = (workflowId: string) => ({ params: { path: { workflowId } } });

// ---------- Service ----------

export const eSignatureService = {
  /**
   * GET /key-pairs — rows are `data` itself, the count in a top-level
   * `meta.total` (A-113; the backend used to wrap them as data.keyPairs).
   */
  getKeyPairs: async (): Promise<KeyPair[]> =>
    // Defensive, as built: a body without rows reads as none.
    (await typedApi.GET("/api/v1/esignature/key-pairs").then(unwrap)).data ?? [],

  /**
   * POST /key-pairs — the server generates the pair; never send a public key.
   * Rejected for API-key auth (denyApiKey).
   */
  createKeyPair: async (input: CreateKeyPairInput = {}): Promise<GeneratedKeyPair> =>
    (await typedApi.POST("/api/v1/esignature/key-pairs", { body: input }).then(unwrap)).data,

  /** DELETE /key-pairs/:keyPairId */
  deleteKeyPair: async (keyPairId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/esignature/key-pairs/{keyPairId}", { params: { path: { keyPairId } } });
  },

  /**
   * GET /workflows — rows are `data` itself, the count in a top-level
   * `meta.total` (A-106; the backend used to wrap them as data.workflows).
   */
  getWorkflows: async (status?: string): Promise<SignatureWorkflow[]> =>
    (
      await typedApi
        // The page's filter select offers only the contract's statuses.
        .GET("/api/v1/esignature/workflows", { params: { query: status ? { status: status as WorkflowStatus } : {} } })
        .then(unwrap)
    ).data ?? [],

  /** GET /workflows/:workflowId */
  getWorkflow: async (workflowId: string): Promise<SignatureWorkflow> =>
    (await typedApi.GET("/api/v1/esignature/workflows/{workflowId}", workflow(workflowId)).then(unwrap)).data,

  /**
   * GET /my-workflows — A-91, the signer view. The workflows in which a step
   * names the caller, gated on `esignature` (read), NOT `qms`: a technician
   * named as a signer can open what they must sign. Rows are `data` itself
   * (meta.total beside it), as for GET /workflows.
   * Steps carry no IP address or user agent.
   */
  getMyWorkflows: async (
    stepStatus?: SignerStepStatus,
  ): Promise<SignatureWorkflow[]> =>
    (
      await typedApi
        .GET("/api/v1/esignature/my-workflows", { params: { query: stepStatus ? { stepStatus } : {} } })
        .then(unwrap)
    ).data ?? [],

  /**
   * GET /my-workflows/:workflowId — one workflow naming the caller as a
   * signer. 404 when it does not name them (or is another tenant's).
   */
  getMyWorkflow: async (workflowId: string): Promise<SignatureWorkflow> =>
    (await typedApi.GET("/api/v1/esignature/my-workflows/{workflowId}", workflow(workflowId)).then(unwrap)).data,

  /**
   * POST /workflows — signers and subject are required server-side. Each
   * signer is `{ userId }` (A-129): 400 for an email-only, inactive or
   * unauthorised signer; 404 for one who is not a user of this tenant.
   */
  createWorkflow: async (input: CreateWorkflowInput): Promise<CreatedWorkflow> =>
    (await typedApi.POST("/api/v1/esignature/workflows", { body: input }).then(unwrap)).data,

  /**
   * GET /signers — the users a workflow may name (A-129). Rows are `data`
   * itself, the count in a top-level `meta.total`.
   */
  getEligibleSigners: async (): Promise<EligibleSigner[]> =>
    (await typedApi.GET("/api/v1/esignature/signers").then(unwrap)).data ?? [],

  /**
   * POST /workflows/:workflowId/cancel (A-130) — the way to withdraw a
   * workflow that has a signature, since it cannot be deleted. 409 when it is
   * completed or already cancelled.
   */
  cancelWorkflow: async (workflowId: string, reason?: string): Promise<void> => {
    await typedApi.POST("/api/v1/esignature/workflows/{workflowId}/cancel", {
      ...workflow(workflowId),
      body: reason ? { reason } : {},
    });
  },

  /** PUT /workflows/:workflowId */
  updateWorkflow: async (
    workflowId: string,
    input: UpdateWorkflowInput,
  ): Promise<SignatureWorkflow> =>
    (
      await typedApi
        .PUT("/api/v1/esignature/workflows/{workflowId}", { ...workflow(workflowId), body: input })
        .then(unwrap)
    ).data,

  /**
   * DELETE /workflows/:workflowId — 409 with an explanation once the workflow
   * has any signature (A-130, A-144); cancel it instead.
   */
  deleteWorkflow: async (workflowId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/esignature/workflows/{workflowId}", workflow(workflowId));
  },

  /**
   * POST /sign — signs one workflow step, as its assigned signer, after
   * re-authenticating (password or MFA code). stepId travels in the body (the
   * route has no path param). Rejected for API-key auth (denyApiKey).
   * 401 — wrong credential; 403 — not this step's signer; 404 — no such step.
   */
  signDocument: async (input: SignDocumentInput): Promise<SignDocumentResult> =>
    (await typedApi.POST("/api/v1/esignature/sign", { body: input }).then(unwrap)).data,

  /** POST /verify — signatureId in the body. */
  verifySignature: async (signatureId: string): Promise<VerifyResult> =>
    (await typedApi.POST("/api/v1/esignature/verify", { body: { signatureId } }).then(unwrap)).data,

  /**
   * GET /history — ONE PAGE of the history (D-24, ADR-070): rows are `data`
   * itself, pagination a top-level `meta` (A-106; the backend used to wrap
   * them as data.signatures, and until D-24 returned every signature).
   * Without `qms` read, only the caller's own signatures, `userId` ignored
   * (A-129).
   */
  getSignatureHistory: async (
    params: SignatureHistoryParams = {},
  ): Promise<PaginatedResponse<SignatureRecord>> => {
    const response = await typedApi.GET("/api/v1/esignature/history", { params: { query: params } }).then(unwrap);
    // Defensive, as built: a body without rows or `meta` still renders.
    const rows = Array.isArray(response?.data) ? response.data : [];
    const meta = response?.meta as Schemas["PaginationMeta"] | undefined;
    const total = meta?.total ?? rows.length;
    const limit = meta?.limit ?? params.limit ?? 25;
    return {
      success: response?.success ?? true,
      message: response?.message ?? "",
      data: rows,
      meta: {
        total,
        page: meta?.page ?? params.page ?? 1,
        limit,
        totalPages: meta?.totalPages ?? Math.max(1, Math.ceil(total / limit)),
      },
    };
  },
};

export default eSignatureService;
