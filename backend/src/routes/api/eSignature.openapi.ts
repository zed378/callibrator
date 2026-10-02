/**
 * P9-20 / P9-25 (ADR-103) — the contract of `eSignature.route.ts`, code-first.
 *
 * Every route carries `auth`. Key pairs and workflow management are gated on
 * `qms` (read to list, write to change; A-28); the signer's own view, signing,
 * verification and the history are gated on `esignature` (A-84/A-91). The
 * writes refuse an API key (`denyApiKey`), and signing refuses the platform
 * tenant (A-127). Bodies are the schemas `validate()` enforces on each route
 * (`validators/eSignature.validator` → `@callibrator/contracts/eSignature`).
 * Responses are the house envelope; the services answer plain objects or rows.
 * Examples are synthetic.
 */
import { z } from "zod";
import {
  cancelWorkflow,
  createKeyPair,
  createWorkflow,
  signDocument,
  verifySignature,
} from "../../validators/eSignature.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

const timestamp = z.iso.datetime();
const WORKFLOW_STATUSES = ["pending", "in_progress", "completed", "cancelled", "expired"] as const;
const STEP_STATUSES = ["waiting", "pending", "signed", "declined"] as const;

/** A signing key, public metadata only (the private key is never sent). */
const KeyPair = z
  .object({
    id: z.guid(),
    keyId: z.string(),
    keyType: z.string(),
    algorithm: z.string(),
    publicKey: z.string(),
    createdAt: timestamp,
  })
  .meta({
    id: "ESignatureKeyPair",
    description: "A tenant signing key (RS256). Its private key is a KMS envelope at rest and is never returned.",
    example: {
      id: "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
      keyId: "key-1900000000000-07070707",
      keyType: "esignature",
      algorithm: "RS256",
      publicKey: "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
      createdAt: "2030-01-15T09:00:00.000Z",
    },
  });

/** A newly generated key: its id, keyId and public key (`privateKey` is always "[REDACTED]"). */
const GeneratedKeyPair = z
  .object({ id: z.guid(), keyId: z.string(), publicKey: z.string(), privateKey: z.literal("[REDACTED]") })
  .meta({ id: "ESignatureGeneratedKeyPair" });

/** One signer's step. */
const WorkflowStep = z
  .object({
    id: z.guid(),
    workflowId: z.guid(),
    stepNumber: z.number().int(),
    signerId: z.guid().nullable(),
    signerName: z.string().nullable(),
    signerEmail: z.string(),
    status: z.enum(STEP_STATUSES),
    signedAt: timestamp.nullable(),
  })
  .loose()
  .meta({ id: "SignatureWorkflowStep" });

/** A signature workflow, with its steps on the single reads. */
const Workflow = z
  .object({
    id: z.guid(),
    documentId: z.string(),
    subject: z.string(),
    message: z.string().nullable(),
    status: z.enum(WORKFLOW_STATUSES),
    expiresAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    expired: z.boolean().optional().meta({ description: "The signer view only: past its expiry date (A-169)." }),
    steps: z.array(WorkflowStep).optional(),
  })
  .loose()
  .meta({
    id: "SignatureWorkflow",
    description: "A document to be signed by named users of the tenant, in order (21 CFR Part 11).",
    example: {
      id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
      documentId: "SOP-0042",
      subject: "Please sign this document",
      message: "",
      status: "pending",
      expiresAt: "2030-01-22T09:00:00.000Z",
      createdAt: "2030-01-15T09:00:00.000Z",
      updatedAt: "2030-01-15T09:00:00.000Z",
    },
  });

const CreatedWorkflow = z
  .object({
    workflowId: z.guid(),
    signers: z.array(z.object({ userId: z.guid(), email: z.string(), name: z.string(), status: z.enum(STEP_STATUSES) })),
  })
  .meta({ id: "SignatureWorkflowCreated" });

const SignatureCertificate = z
  .object({
    signatureId: z.guid(),
    certificate: z
      .object({
        signatureId: z.guid(),
        workflowId: z.guid(),
        documentId: z.string(),
        signerId: z.guid(),
        signedAt: timestamp,
        signatureHash: z.string(),
        signatureValue: z.string().nullable(),
        signingKeyId: z.string().nullable(),
        signatureScheme: z.string().nullable(),
        algorithm: z.string(),
        ipAddress: z.string().nullable(),
        userAgent: z.string().nullable(),
        verificationUrl: z.string(),
      })
      .loose(),
  })
  .meta({ id: "SignatureResult", description: "The signature made: RS256 over the canonical payload, with the tenant's key." });

const Verification = z
  .object({
    valid: z.boolean(),
    verificationStatus: z.enum(["valid", "invalid", "revoked", "not_found", "workflow_missing", "unverifiable_legacy", "unverifiable_key_missing", "error"]),
    reason: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({
    id: "SignatureVerification",
    description: "`valid` is true ONLY for a cryptographically verified signature; branch on `verificationStatus`.",
    example: { valid: true, verificationStatus: "valid", reason: "Signature verified against tenant key key-1900000000000-07070707." },
  });

const SignatureRecord = z
  .object({
    id: z.guid(),
    workflowId: z.guid(),
    workflowStepId: z.guid(),
    userId: z.guid(),
    signedAt: timestamp,
    signatureAlgorithm: z.string(),
    signatureReason: z.string().nullable(),
    authenticationMethod: z.string(),
    status: z.string(),
    // P9-25 item 11: present only for a caller holding `qms` read (A-129, F-9;
    // HISTORY_REDACTED_ATTRIBUTES) — named so a client can read them.
    ipAddress: z.string().nullable().optional().meta({ description: "`qms` readers only" }),
    userAgent: z.string().nullable().optional().meta({ description: "`qms` readers only" }),
    biometricData: z.unknown().optional().meta({ description: "JSON (D-27 `SignatureRecord.biometricData`) or null; `qms` readers only" }),
  })
  .loose()
  .meta({
    id: "SignatureRecord",
    description: "A signature made. Without `qms` read the caller sees only their own, without IP address, user agent or biometrics (A-129).",
  });

const EligibleSigner = z
  .object({ id: z.guid(), name: z.string(), email: z.string() })
  .meta({ id: "EligibleSigner", description: "An active user of the tenant holding `esignature:write`." });

const uuidParam = (name: string, what: string, example: string): z.ZodObject =>
  z.object({ [name]: z.guid().meta({ description: what, example }) });
const keyPairParams = uuidParam("keyPairId", "The key pair's row id", "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b");
const workflowParams = uuidParam("workflowId", "The signature workflow's id", "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e");

const qms = (action: "read" | "write"): { kind: "dynamicAccess"; resource: string; action: string } => ({ kind: "dynamicAccess", resource: "qms", action });
const esig = (action: "read" | "write"): { kind: "dynamicAccess"; resource: string; action: string } => ({ kind: "dynamicAccess", resource: "esignature", action });
const NO_API_KEY = "An API key is refused (403).";
const CLOSED = "The workflow is completed or cancelled (or expired, for an edit): a closed workflow does not change.";

export default defineRouteDocs({
  router: "api/eSignature.route",
  mount: "/api/v1/esignature",
  tag: "E-Signature",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/key-pairs",
      operationId: "listSigningKeyPairs",
      summary: "List the tenant's signing keys",
      permission: qms("read"),
      audited: false,
      success: { status: 200, description: "The keys, newest first; the count in the top-level `meta`", list: KeyPair },
    },
    {
      method: "post",
      path: "/key-pairs",
      operationId: "createSigningKeyPair",
      summary: "Generate a signing key",
      description: `RS256, created with one audit row in the same transaction (A-278). ${NO_API_KEY}`,
      permission: qms("write"),
      audited: true,
      body: createKeyPair,
      success: { status: 201, description: "The new key's public part", data: GeneratedKeyPair },
    },
    {
      method: "delete",
      path: "/key-pairs/:keyPairId",
      operationId: "deleteSigningKeyPair",
      summary: "Delete a signing key (soft)",
      description: `Signatures it made stay verifiable: verification reads deleted keys too. ${NO_API_KEY}`,
      permission: qms("write"),
      audited: true,
      params: keyPairParams,
      success: { status: 200, description: "Deleted", empty: true },
    },
    {
      method: "get",
      path: "/workflows",
      operationId: "listSignatureWorkflows",
      summary: "List the tenant's signature workflows",
      permission: qms("read"),
      audited: false,
      query: z.object({ status: z.enum(WORKFLOW_STATUSES).optional() }),
      success: { status: 200, description: "The workflows, newest first; the count in the top-level `meta`", list: Workflow },
    },
    {
      method: "post",
      path: "/workflows",
      operationId: "createSignatureWorkflow",
      summary: "Create a signature workflow",
      description:
        "Every signer must be an active user of the tenant holding `esignature:write` (400 naming the signer otherwise; 404 for a user the tenant does not have). " +
        `Names and emails come from the user rows, never the body. The first signer is emailed after the commit. ${NO_API_KEY}`,
      permission: qms("write"),
      audited: true,
      body: createWorkflow,
      success: { status: 201, description: "The workflow and its signers", data: CreatedWorkflow },
    },
    {
      method: "get",
      path: "/workflows/:workflowId",
      operationId: "getSignatureWorkflow",
      summary: "Get one signature workflow (management)",
      permission: qms("read"),
      audited: false,
      params: workflowParams,
      success: { status: 200, description: "The workflow, with its steps in order", data: Workflow },
    },
    {
      method: "put",
      path: "/workflows/:workflowId",
      operationId: "updateSignatureWorkflow",
      summary: "Edit a workflow's subject, message or expiry",
      description: `Only those three fields change; a body changing none writes nothing. ${NO_API_KEY}`,
      permission: qms("write"),
      audited: true,
      params: workflowParams,
      body: z
        .object({ subject: z.string().optional(), message: z.string().nullable().optional(), expiresAt: z.iso.datetime().optional() })
        .meta({ description: "Not validated on the route: any other field is ignored." }),
      conflict: CLOSED,
      success: { status: 200, description: "The workflow", data: Workflow },
    },
    {
      method: "delete",
      path: "/workflows/:workflowId",
      operationId: "deleteSignatureWorkflow",
      summary: "Delete a workflow with no signatures (soft)",
      description: NO_API_KEY,
      permission: qms("write"),
      audited: true,
      params: workflowParams,
      conflict: "The workflow carries signatures (21 CFR 11.70: a signature stays linked to what it signs) — cancel it instead — or is completed.",
      success: { status: 200, description: "Deleted", empty: true },
    },
    {
      method: "post",
      path: "/workflows/:workflowId/cancel",
      operationId: "cancelSignatureWorkflow",
      summary: "Cancel a workflow",
      description: `Final; the signatures already made are kept. An expired workflow may be cancelled. ${NO_API_KEY}`,
      permission: qms("write"),
      audited: true,
      params: workflowParams,
      body: cancelWorkflow,
      conflict: "The workflow is completed or already cancelled.",
      success: { status: 200, description: "Cancelled", empty: true },
    },
    {
      method: "get",
      path: "/signers",
      operationId: "listEligibleSigners",
      summary: "The users a workflow may name as signers",
      permission: qms("write"),
      audited: false,
      success: { status: 200, description: "Active users holding `esignature:write`, by name; the count in the top-level `meta`", list: EligibleSigner },
    },
    {
      method: "get",
      path: "/my-workflows",
      operationId: "listMySignatureWorkflows",
      summary: "The workflows naming the caller as a signer",
      description: "An expired workflow is left out unless the caller already signed or declined in it (A-169).",
      permission: esig("read"),
      audited: false,
      query: z.object({ stepStatus: z.enum(STEP_STATUSES).optional().meta({ description: "Only where the caller's own step has this status (400 for another value)." }) }),
      success: { status: 200, description: "The caller's workflows; the count in the top-level `meta`", list: Workflow },
    },
    {
      method: "get",
      path: "/my-workflows/:workflowId",
      operationId: "getMySignatureWorkflow",
      summary: "One workflow the caller is named in",
      description: "A workflow that does not name the caller is the same 404 as another tenant's.",
      permission: esig("read"),
      audited: false,
      params: workflowParams,
      success: { status: 200, description: "The workflow, with its steps", data: Workflow },
    },
    {
      method: "post",
      path: "/sign",
      operationId: "signDocument",
      summary: "Sign a workflow step",
      description:
        "Only the step's own signer (403 otherwise), only a pending step, and only after re-authentication with the signer's password or MFA code " +
        "(401 on a wrong one, recorded as SIGNATURE_AUTH_FAILED). The meaning (`reason`) is bound into the signature. IP address and user agent " +
        `come from the connection, never the body. A signature attempted after the workflow's expiry records the expiry, then answers 409. ${NO_API_KEY} ` +
        "The platform tenant signs nothing (403, A-127).",
      permission: esig("write"),
      audited: true,
      body: signDocument,
      conflict: "The step is not pending (not yet its turn, already signed, declined), or the workflow is cancelled or expired; or the tenant has no signing key.",
      success: { status: 200, description: "The signature made", data: SignatureCertificate },
    },
    {
      method: "post",
      path: "/verify",
      operationId: "verifySignature",
      summary: "Verify a signature",
      permission: esig("read"),
      audited: false,
      body: verifySignature,
      success: { status: 200, description: "The verdict", data: Verification },
    },
    {
      method: "get",
      path: "/history",
      operationId: "getSignatureHistory",
      summary: "Signature history",
      description:
        "With `qms` read: the tenant's signatures, the `userId` filter honoured. Without it: the caller's own only, without IP address, user agent or biometrics.",
      permission: esig("read"),
      audited: false,
      query: z.object({
        userId: z.guid().optional(),
        startDate: z.iso.datetime().optional(),
        endDate: z.iso.datetime().optional(),
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).optional(),
      }),
      success: { status: 200, description: "A page of signatures, newest first; pagination in the top-level `meta`", list: SignatureRecord },
    },
  ],
});
