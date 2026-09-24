import { api } from "../client";

/**
 * E-Signature (21 CFR Part 11).
 *
 * The tenant/user come from the caller's JWT.
 * Backend: src/routes/api/eSignature.route.js — mounted at /api/v1/esignature
 * (NOT /e-signature; the route file's swagger comments say otherwise and are
 * stale).
 *   GET    /key-pairs
 *   POST   /key-pairs                (denies API keys)
 *   DELETE /key-pairs/:keyPairId
 *   GET    /workflows                ?status       (management: qms)
 *   POST   /workflows
 *   GET    /workflows/:workflowId
 *   GET    /my-workflows             ?stepStatus   (signer view, A-91)
 *   GET    /my-workflows/:workflowId              (signer view, A-91)
 *   PUT    /workflows/:workflowId
 *   DELETE /workflows/:workflowId
 *   POST   /sign                     (denies API keys)
 *   POST   /verify
 *   GET    /history                  ?userId&startDate&endDate
 */

const BASE = "/api/v1/esignature";

// ---------- Types ----------

export type KeyPairAlgorithm = "RSA" | "ECDSA" | "Ed25519";
export type KeySize = 2048 | 3072 | 4096;
export type AuthenticationMethod = "password" | "mfa" | "webauthn" | "totp";

export interface KeyPair {
  id: string;
  label?: string;
  algorithm?: KeyPairAlgorithm;
  keySize?: KeySize;
  publicKey?: string;
  createdAt?: string;
  expiresAt?: string | null;
}

export interface Signer {
  userId: string;
  email: string;
  name: string;
}

export interface SignatureWorkflow {
  id: string;
  documentId: string;
  subject?: string;
  message?: string;
  status?: string;
  signers?: Signer[];
  steps?: SignatureStep[];
  expiresAt?: string | null;
  createdAt?: string;
}

/**
 * One signer's slot, as backend/src/models/signatureWorkflowStep.model.js
 * returns it inside GET /workflows/:id → data.steps. The signer is
 * `signerId` (there is no `userId` on a step). Only that user can sign the
 * step — anyone else gets 403 (A-65).
 */
export interface SignatureStep {
  id: string;
  workflowId?: string;
  stepNumber?: number;
  signerId?: string | null;
  signerEmail?: string;
  signerName?: string;
  status?: string;
  signedAt?: string | null;
}

export interface SignatureRecord {
  id: string;
  stepId?: string;
  userId?: string;
  documentId?: string;
  signedAt?: string;
  authenticationMethod?: AuthenticationMethod;
  ipAddress?: string;
  userAgent?: string;
}

export interface VerifyResult {
  valid: boolean;
  signatureId?: string;
  signedAt?: string;
  reason?: string;
}

export interface CreateKeyPairInput {
  /** Server defaults: RSA / 2048. */
  algorithm?: KeyPairAlgorithm;
  keySize?: KeySize;
  label?: string;
}

export interface CreateWorkflowInput {
  documentId: string;
  signers: Signer[];
  subject: string;
  message?: string;
  expiresAt?: string;
}

/** The methods the backend can re-verify at the moment of signing (A-65). */
export type SigningAuthMethod = "password" | "mfa";

/**
 * POST /sign body. Signing re-authenticates the signer: `authPayload` is their
 * password or current MFA code, matching `authenticationMethod`. There is no
 * ipAddress / userAgent — the backend records the connection's own, and
 * ignores any in the body (A-65).
 */
export interface SignDocumentInput {
  /** The workflow step being signed. */
  stepId: string;
  /** Server defaults to "password". */
  authenticationMethod?: SigningAuthMethod;
  /** The signer's password or MFA code. Never stored. */
  authPayload: string;
  /** The meaning of the signature (21 CFR 11.50), max 255. */
  reason?: string;
  polygon?: Record<string, unknown> | null;
  biometricData?: string | null;
}

/**
 * What POST /sign returns in `data`: eSignature.service#signDocument's
 * `{ signatureId, certificate }`, the certificate being
 * generateSignatureCertificate()'s summary of the signature.
 */
export interface SignDocumentResult {
  signatureId: string;
  certificate: {
    signatureId: string;
    workflowId: string;
    documentId: string;
    signerId: string;
    signedAt: string;
    signatureHash: string;
    signatureValue: string;
    signingKeyId: string;
    signatureScheme: string;
    algorithm: string;
    ipAddress: string | null;
    userAgent: string | null;
    verificationUrl: string;
  };
}

export interface SignatureHistoryParams {
  userId?: string;
  startDate?: string;
  endDate?: string;
}

/** The caller's own step status, for GET /my-workflows?stepStatus=. */
export type SignerStepStatus = "waiting" | "pending" | "signed" | "declined";

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
  meta?: { total: number };
}

// ---------- Service ----------

export const eSignatureService = {
  /**
   * GET /key-pairs — rows are `data` itself, the count in a top-level
   * `meta.total` (A-113; the backend used to wrap them as data.keyPairs).
   */
  getKeyPairs: async (): Promise<KeyPair[]> => {
    const response = await api.get<BackendResponse<KeyPair[]>>(
      `${BASE}/key-pairs`,
    );
    return response.data ?? [];
  },

  /**
   * POST /key-pairs — the server generates the pair; never send a public key.
   * Rejected for API-key auth (denyApiKey).
   */
  createKeyPair: async (input: CreateKeyPairInput = {}): Promise<KeyPair> => {
    const response = await api.post<BackendResponse<KeyPair>>(
      `${BASE}/key-pairs`,
      input,
    );
    return response.data;
  },

  /** DELETE /key-pairs/:keyPairId */
  deleteKeyPair: async (keyPairId: string): Promise<void> => {
    await api.delete<BackendResponse<null>>(`${BASE}/key-pairs/${keyPairId}`);
  },

  /**
   * GET /workflows — rows are `data` itself, the count in a top-level
   * `meta.total` (A-106; the backend used to wrap them as data.workflows).
   */
  getWorkflows: async (status?: string): Promise<SignatureWorkflow[]> => {
    const response = await api.get<BackendResponse<SignatureWorkflow[]>>(
      `${BASE}/workflows`,
      { params: status ? { status } : {} },
    );
    return response.data ?? [];
  },

  /** GET /workflows/:workflowId */
  getWorkflow: async (workflowId: string): Promise<SignatureWorkflow> => {
    const response = await api.get<BackendResponse<SignatureWorkflow>>(
      `${BASE}/workflows/${workflowId}`,
    );
    return response.data;
  },

  /**
   * GET /my-workflows — A-91, the signer view. The workflows in which a step
   * names the caller, gated on `esignature` (read), NOT `qms`: a technician
   * named as a signer can open what they must sign. Rows are `data` itself
   * (meta.total beside it), as for GET /workflows.
   * Steps carry no IP address or user agent.
   */
  getMyWorkflows: async (
    stepStatus?: SignerStepStatus,
  ): Promise<SignatureWorkflow[]> => {
    const response = await api.get<BackendResponse<SignatureWorkflow[]>>(
      `${BASE}/my-workflows`,
      { params: stepStatus ? { stepStatus } : {} },
    );
    return response.data ?? [];
  },

  /**
   * GET /my-workflows/:workflowId — one workflow naming the caller as a
   * signer. 404 when it does not name them (or is another tenant's).
   */
  getMyWorkflow: async (workflowId: string): Promise<SignatureWorkflow> => {
    const response = await api.get<BackendResponse<SignatureWorkflow>>(
      `${BASE}/my-workflows/${workflowId}`,
    );
    return response.data;
  },

  /** POST /workflows — signers and subject are required server-side. */
  createWorkflow: async (
    input: CreateWorkflowInput,
  ): Promise<SignatureWorkflow> => {
    const response = await api.post<BackendResponse<SignatureWorkflow>>(
      `${BASE}/workflows`,
      input,
    );
    return response.data;
  },

  /** PUT /workflows/:workflowId */
  updateWorkflow: async (
    workflowId: string,
    input: Partial<CreateWorkflowInput>,
  ): Promise<SignatureWorkflow> => {
    const response = await api.put<BackendResponse<SignatureWorkflow>>(
      `${BASE}/workflows/${workflowId}`,
      input,
    );
    return response.data;
  },

  /** DELETE /workflows/:workflowId */
  deleteWorkflow: async (workflowId: string): Promise<void> => {
    await api.delete<BackendResponse<null>>(`${BASE}/workflows/${workflowId}`);
  },

  /**
   * POST /sign — signs one workflow step, as its assigned signer, after
   * re-authenticating (password or MFA code). stepId travels in the body (the
   * route has no path param). Rejected for API-key auth (denyApiKey).
   * 401 — wrong credential; 403 — not this step's signer; 404 — no such step.
   */
  signDocument: async (input: SignDocumentInput): Promise<SignDocumentResult> => {
    const response = await api.post<BackendResponse<SignDocumentResult>>(
      `${BASE}/sign`,
      input,
    );
    return response.data;
  },

  /** POST /verify — signatureId in the body. */
  verifySignature: async (signatureId: string): Promise<VerifyResult> => {
    const response = await api.post<BackendResponse<VerifyResult>>(
      `${BASE}/verify`,
      { signatureId },
    );
    return response.data;
  },

  /**
   * GET /history — rows are `data` itself, the count in a top-level
   * `meta.total` (A-106; the backend used to wrap them as data.signatures).
   */
  getSignatureHistory: async (
    params: SignatureHistoryParams = {},
  ): Promise<SignatureRecord[]> => {
    const response = await api.get<BackendResponse<SignatureRecord[]>>(
      `${BASE}/history`,
      { params },
    );
    return response.data ?? [];
  },
};

export default eSignatureService;
