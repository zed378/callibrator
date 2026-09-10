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
 *   GET    /workflows                ?status
 *   POST   /workflows
 *   GET    /workflows/:workflowId
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

export interface SignatureStep {
  id: string;
  workflowId?: string;
  userId?: string;
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

export interface SignDocumentInput {
  /** The workflow step being signed. */
  stepId: string;
  polygon?: Record<string, unknown> | null;
  biometricData?: string | null;
  /** Server defaults to "password". */
  authenticationMethod?: AuthenticationMethod;
  ipAddress?: string;
  userAgent?: string;
}

export interface SignatureHistoryParams {
  userId?: string;
  startDate?: string;
  endDate?: string;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const eSignatureService = {
  /** GET /key-pairs — backend wraps the list as data.keyPairs. */
  getKeyPairs: async (): Promise<KeyPair[]> => {
    const response = await api.get<BackendResponse<{ keyPairs: KeyPair[] }>>(
      `${BASE}/key-pairs`,
    );
    return response.data?.keyPairs ?? [];
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

  /** GET /workflows — backend wraps the list as data.workflows. */
  getWorkflows: async (status?: string): Promise<SignatureWorkflow[]> => {
    const response = await api.get<
      BackendResponse<{ workflows: SignatureWorkflow[] }>
    >(`${BASE}/workflows`, { params: status ? { status } : {} });
    return response.data?.workflows ?? [];
  },

  /** GET /workflows/:workflowId */
  getWorkflow: async (workflowId: string): Promise<SignatureWorkflow> => {
    const response = await api.get<BackendResponse<SignatureWorkflow>>(
      `${BASE}/workflows/${workflowId}`,
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
   * POST /sign — signs one workflow step.
   * stepId travels in the body (the route has no path param).
   * Rejected for API-key auth (denyApiKey).
   */
  signDocument: async (input: SignDocumentInput): Promise<SignatureRecord> => {
    const response = await api.post<BackendResponse<SignatureRecord>>(
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

  /** GET /history — backend wraps the list as data.signatures. */
  getSignatureHistory: async (
    params: SignatureHistoryParams = {},
  ): Promise<SignatureRecord[]> => {
    const response = await api.get<
      BackendResponse<{ signatures: SignatureRecord[] }>
    >(`${BASE}/history`, { params });
    return response.data?.signatures ?? [];
  },
};

export default eSignatureService;
