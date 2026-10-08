/**
 * P9-20 / P9-25 (ADR-103) — the contract of `certificates.route.ts`,
 * code-first. Two routes are PUBLIC (no `auth`): the verification verdict and
 * the capability-gated document, both behind the `certificateVerifyToken`
 * budget (A-293). Every other route carries `auth` and a `dynamicAccess` gate
 * on the `certificate` resource; the authoring acts also refuse the platform
 * tenant (`denyPlatformAuthoring`, A-127/A-145). The query, params and bodies
 * are the schemas the CONTROLLER validates (`validators/certificate.validator`
 * → `@callibrator/contracts/certificate`); approve's body is also enforced by
 * `validate()` on the route (A-62: a body `approvedBy` is stripped).
 * Approve, sign and revoke are Part 11 signatures: the caller re-authenticates
 * (password or MFA code), and a wrong credential is a 401 that writes a
 * SIGNATURE_AUTH_FAILED audit row (A-126). Examples are synthetic.
 */
import { z } from "zod";
import { personDisplay } from "@callibrator/contracts/people";
import {
  approveCertificateSchema,
  certificateIdSchema,
  createCertificateSchema,
  getCertificatesQuery,
  revokeCertificateSchema,
  signCertificateSchema,
  updateCertificateSchema,
} from "../../validators/certificate.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { CERTIFICATE_STATUSES } from "@callibrator/contracts/states";

const timestamp = z.iso.datetime();
const STATUSES = CERTIFICATE_STATUSES; // P9-05: the one list

/** A person a certificate names (users.first_name, last_name and email are NOT NULL). */
const CertificatePerson = z.object({ id: z.guid(), firstName: z.string(), lastName: z.string(), email: z.string() });

/** The instrument a read joins (`device`; the detail read adds `category`). */
const CertificateDevice = z.object({
  id: z.guid(),
  name: z.string(),
  serialNumber: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  category: z.string().nullable().optional().meta({ description: "Detail read only" }),
});

/** A certificate as the API answers it (the model row's JSON, with its joins on reads). */
const Certificate = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    calibrationRecordId: z.guid().nullable(),
    deviceId: z.guid(),
    certificateNumber: z.string(),
    type: z.enum(["calibration", "maintenance", "verification"]),
    status: z.enum(STATUSES),
    calibratedBy: z.guid().nullable(),
    approvedBy: z.guid().nullable(),
    submittedBy: z.guid().nullable(),
    signedBy: z.guid().nullable(),
    digitalSignature: z.string().nullable(),
    digitalSignatureKeyId: z.string().nullable(),
    signedAt: timestamp.nullable(),
    issueDate: timestamp.nullable(),
    validUntil: timestamp.nullable(),
    standard: z.string().nullable(),
    summary: z.string().nullable(),
    conditions: z.string().nullable(),
    notes: z.string().nullable(),
    createdBy: z.guid().nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    // P9-25 item 11 (2026-10-02): the joins the reads carry (certificate.service's
    // list and detail includes, every one a LEFT JOIN: null when the row is gone).
    device: CertificateDevice.nullable().optional(),
    calibratedByUser: CertificatePerson.nullable().optional(),
    approvedByUser: CertificatePerson.nullable().optional(),
    signedByUser: CertificatePerson.nullable().optional(),
    calibratedByDisplay: personDisplay.nullable().optional().meta({ description: "P21-09e (P19-04 § 12): how the person is shown — a name, role, organisation, or redacted; never an id or e-mail" }),
    approvedByDisplay: personDisplay.nullable().optional().meta({ description: "P21-09e (P19-04 § 12): how the person is shown — a name, role, organisation, or redacted; never an id or e-mail" }),
    signedByDisplay: personDisplay.nullable().optional().meta({ description: "P21-09e (P19-04 § 12): how the person is shown — a name, role, organisation, or redacted; never an id or e-mail" }),
    calibrationRecord: z
      .object({ id: z.guid(), calibrationDate: timestamp, isCompliant: z.boolean().nullable(), notes: z.string().nullable() })
      .nullable()
      .optional()
      .meta({ description: "Detail read only" }),
    tenant: z
      .object({ id: z.guid(), name: z.string(), code: z.string().nullable() })
      .nullable()
      .optional()
      .meta({ description: "Detail read only" }),
  })
  .loose()
  .meta({
    id: "Certificate",
    description:
      "A calibration certificate (ISO 17025 §7.8): draft → pending_approval → approved → signed, or revoked. " +
      "Reads include the device, the people and (detail) the record and tenant.",
    example: {
      id: "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      calibrationRecordId: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
      deviceId: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      certificateNumber: "HOSP-20300115-0001",
      type: "calibration",
      status: "draft",
      calibratedBy: null,
      approvedBy: null,
      submittedBy: null,
      signedBy: null,
      digitalSignature: null,
      digitalSignatureKeyId: null,
      signedAt: null,
      issueDate: "2030-01-15T00:00:00.000Z",
      validUntil: "2031-01-15T00:00:00.000Z",
      standard: "ISO 17025",
      summary: null,
      conditions: null,
      notes: null,
      createdBy: "7c8d9e0f-1a2b-4c3d-9e4f-5a6b7c8d9e0f",
      createdAt: "2030-01-15T09:00:00.000Z",
      updatedAt: "2030-01-15T09:00:00.000Z",
    },
  });

/** The integrity block a verdict carries (Q-50: v3 for a certificate signed with a snapshot). */
const Integrity = z.object({
  scheme: z.enum(["certificate-content-v2", "certificate-content-v3"]),
  algorithm: z.literal("SHA-256"),
  hash: z.string(),
  legacyHash: z.string(),
  signature: z.string().optional().meta({ description: "Authenticated document only: the server HMAC over `hash`" }),
  signatureKeyId: z.string().optional(),
});

/** The issuing laboratory as the certificate prints it (A-303; the live tenant row, NOT hashed). */
const Issuer = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  zipCode: z.string().nullable(),
  country: z.string().nullable(),
  website: z.string().nullable(),
});

/**
 * What a certificate PDF prints (M-11, ADR-095; `certificateDocument.service`'s
 * CertificateDocument, field for field — P9-25 item 11 made it exact, 2026-10-02).
 */
const CertificateDocument = z
  .object({
    certificateNumber: z.string(),
    type: z.string(),
    status: z.string(),
    issuedBy: z.string().nullable(),
    issuer: Issuer.nullable(),
    device: z
      .object({
        name: z.string().nullable(),
        serialNumber: z.string().nullable(),
        manufacturer: z.string().nullable(),
        model: z.string().nullable(),
      })
      .nullable(),
    standard: z.string().nullable(),
    issueDate: timestamp.nullable(),
    validUntil: timestamp.nullable(),
    summary: z.string().nullable(),
    conditions: z.string().nullable(),
    notes: z.string().nullable(),
    calibratedBy: z.string().nullable(),
    approvedBy: z.string().nullable(),
    signedBy: z.string().nullable(),
    signedAt: timestamp.nullable(),
    verifyUrl: z.string(),
    integrity: Integrity,
    contentAsOf: z.enum(["signing", "live"]).meta({
      description: "signing: the issuer, instrument and people as recorded at signing (ADR-107); live: the current rows",
    }),
  })
  .meta({ id: "CertificateDocument" });

/** The public verdict (`certificatePdf.service#verifyByCertificateNumber`). */
const Verification = z
  .object({
    found: z.boolean(),
    valid: z.boolean(),
    message: z.string().optional().meta({ description: "Only on an unknown number." }),
    disclosure: z.enum(["minimal", "full"]).optional(),
    status: z.enum(STATUSES).optional(),
    revoked: z.boolean().optional(),
    expired: z.boolean().optional(),
    withdrawn: z.boolean().optional(),
    certificateNumber: z.string().optional(),
    type: z.string().optional(),
    issuedTo: z.string().nullable().optional(),
    issueDate: timestamp.nullable().optional(),
    validUntil: timestamp.nullable().optional(),
    integrity: Integrity.optional(),
    standard: z.string().nullable().optional().meta({ description: "Full verdict only (as below)." }),
    device: z.record(z.string(), z.unknown()).nullable().optional(),
    signedBy: z.unknown().optional(),
    signedAt: timestamp.nullable().optional(),
    verifyUrl: z.string().optional(),
    document: CertificateDocument.nullable().optional(),
    documentUrl: z.string().nullable().optional(),
  })
  .loose()
  .meta({
    id: "CertificateVerification",
    description:
      "The MINIMAL verdict (no token, or a wrong one) carries found, valid, status, revoked, expired, withdrawn, number, type, " +
      "issuedTo, the dates and the integrity hashes; the FULL verdict (the certificate's own verification token) adds the device, " +
      "the signer, the published document, its verifyUrl and, for a PDF stored before M-11, a short-lived documentUrl.",
    example: {
      found: true,
      valid: true,
      status: "signed",
      revoked: false,
      expired: false,
      withdrawn: false,
      certificateNumber: "HOSP-20300115-0001",
      type: "calibration",
      issuedTo: "Example Hospital",
      issueDate: "2030-01-15T00:00:00.000Z",
      validUntil: "2031-01-15T00:00:00.000Z",
      integrity: { scheme: "certificate-content-v3", algorithm: "SHA-256", hash: "0".repeat(64), legacyHash: "1".repeat(64) },
      disclosure: "minimal",
    },
  });

/** The certificate statistics (`certificate.service#getCertificateStats`). */
const CertificateStats = z
  .object({
    totalCertificates: z.number().int(),
    byStatus: z.record(z.string(), z.number().int()),
    byType: z.record(z.string(), z.number().int()),
    latestCertificate: Certificate.nullable(),
  })
  .meta({ id: "CertificateStats", description: "Totals, by status, by type, and the latest certificate." });

/** `:certificateId`, the validator's own field (`.meta()` clones it) with a synthetic example. */
const certificateIdParams = z.object({
  certificateId: certificateIdSchema.shape.certificateId.meta({
    description: "The certificate's id",
    example: "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f",
  }),
});
const numberParams = z.object({
  certificateNumber: z.string().meta({ description: "The printed certificate number", example: "HOSP-20300115-0001" }),
});

const gate = (action: string): { kind: "dynamicAccess"; resource: string; action: string } => ({
  kind: "dynamicAccess",
  resource: "certificate",
  action,
});
const PLATFORM = "The platform tenant authors nothing here (403, A-127/A-145).";
const SIGNATURE =
  "A Part 11 signature: the caller re-authenticates (password or MFA code; 401 on a wrong one, which is recorded as SIGNATURE_AUTH_FAILED, A-126).";

export default defineRouteDocs({
  router: "api/certificates.route",
  mount: "/api/v1/certificates",
  tag: "Certificates",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/verify/:certificateNumber",
      operationId: "verifyCertificate",
      summary: "Publicly verify a certificate (no auth)",
      description:
        "The target of the certificate's QR code. Certificate numbers are sequential, so the number alone unlocks only the MINIMAL verdict (A-293); " +
        "the certificate's verification token unlocks the FULL one, and a wrong token answers exactly like none. An unknown number answers " +
        "`{ found: false, valid: false, message }`. Per client address, every request counts against 300 per 15 minutes, and every answer that " +
        "is not the full verdict also against 60 per 15 minutes; beyond either, 429 with Retry-After.",
      permission: null,
      audited: false,
      params: numberParams,
      query: z.object({
        token: z.string().optional().meta({ description: "The certificate's verification token (from its QR code)", example: "q3kZ0x9VbN2mP4rT6wY8aC1dE3fG5hJ7" }),
      }),
      success: { status: 200, description: "The verdict", data: Verification },
    },
    {
      method: "get",
      path: "/verify/:certificateNumber/document",
      operationId: "getVerifiedCertificateDocument",
      summary: "The stored PDF of a signed certificate, via the verification capability (no auth)",
      description:
        "ADR-042 step 4. `token` is minted by the verification endpoint (its documentUrl) for a signed certificate only, and expires; the " +
        "certificate's status is re-checked on every fetch. Served inline as application/pdf with ETag and Range. Counts against the " +
        "300-per-15-minutes verification budget of the client address (A-293).",
      permission: null,
      audited: false,
      params: numberParams,
      query: z.object({
        token: z.string().meta({ description: "The capability the verification verdict's documentUrl carries", example: "eyJleHAiOjE5MDAwMDAwMDB9.c2lnbmF0dXJl" }),
      }),
      errors: [403],
      success: { status: 200, description: "The PDF", file: { contentType: "application/pdf" } },
    },
    {
      method: "get",
      path: "/",
      operationId: "listCertificates",
      summary: "List certificates",
      permission: gate("read"),
      audited: false,
      query: getCertificatesQuery,
      success: { status: 200, description: "A page of certificates; pagination in the top-level `meta`", list: Certificate },
    },
    {
      method: "post",
      path: "/",
      operationId: "createCertificate",
      summary: "Issue a draft certificate",
      description:
        `The device must be the caller's tenant's (else 404). The number is unique platform-wide (D-40). The tenant's approval workflow, if it has one, starts in the same transaction (A-190). ${PLATFORM}`,
      permission: gate("generate"),
      audited: true,
      body: createCertificateSchema,
      success: { status: 201, description: "The draft certificate", data: Certificate },
    },
    {
      method: "get",
      path: "/stats",
      operationId: "getCertificateStats",
      summary: "Certificate statistics",
      permission: gate("read"),
      audited: false,
      success: { status: 200, description: "Totals, by status, by type, latest", data: CertificateStats },
    },
    {
      method: "get",
      path: "/:certificateId",
      operationId: "getCertificate",
      summary: "Get one certificate",
      permission: gate("read"),
      audited: false,
      params: certificateIdParams,
      success: { status: 200, description: "The certificate, with its device, record, people and tenant", data: Certificate },
    },
    {
      method: "put",
      path: "/:certificateId",
      operationId: "updateCertificate",
      summary: "Edit a certificate's content",
      description: `Status is not editable: it changes only through submit, approve, sign and revoke (A-64). ${PLATFORM}`,
      permission: gate("generate"),
      audited: true,
      params: certificateIdParams,
      body: updateCertificateSchema,
      conflict:
        "The certificate is signed or revoked (no longer editable), or the body asks for a status other than its current one (the 409 names the transition to use).",
      success: { status: 200, description: "The edited certificate", data: Certificate },
    },
    {
      method: "delete",
      path: "/:certificateId",
      operationId: "deleteCertificate",
      summary: "Delete a draft or pending certificate (soft)",
      description: `Its attachments go with it (D-22). ${PLATFORM}`,
      permission: gate("generate"),
      audited: true,
      params: certificateIdParams,
      conflict: "The certificate is approved, signed or revoked: revoke it instead (a controlled record is never deleted).",
      success: { status: 200, description: "Deleted", empty: true },
    },
    {
      method: "post",
      path: "/:certificateId/approve",
      operationId: "approveCertificate",
      summary: "Approve a certificate",
      description:
        `${SIGNATURE} The approver is the caller, never the body (A-62). The author who drafted or submitted it may not approve it: 403, explained (ADR-101). ` +
        `A certificate in a pending approval workflow is approved there, not here. ${PLATFORM}`,
      permission: gate("approve"),
      audited: true,
      params: certificateIdParams,
      body: approveCertificateSchema,
      conflict: "Only a pending_approval certificate can be approved; or its approval workflow is pending (approve it there).",
      success: { status: 200, description: "The approved certificate", data: Certificate },
    },
    {
      method: "post",
      path: "/:certificateId/submit",
      operationId: "submitCertificate",
      summary: "Submit a draft certificate for approval",
      description: `draft → pending_approval. The submitter is recorded (they may not also approve, ADR-101). ${PLATFORM}`,
      permission: gate("approve"),
      audited: true,
      params: certificateIdParams,
      conflict: "Only a draft certificate can be submitted.",
      success: { status: 200, description: "The submitted certificate", data: Certificate },
    },
    {
      method: "post",
      path: "/:certificateId/sign",
      operationId: "signCertificate",
      summary: "Sign an approved certificate",
      description:
        `${SIGNATURE} What the certificate prints is fixed at signing (the Q-50 snapshot) and bound by the v3 integrity hash. ${PLATFORM}`,
      permission: gate("sign"),
      audited: true,
      params: certificateIdParams,
      body: signCertificateSchema,
      conflict: "Only an approved certificate can be signed, and only once.",
      success: { status: 200, description: "The signed certificate", data: Certificate },
    },
    {
      method: "post",
      path: "/:certificateId/revoke",
      operationId: "revokeCertificate",
      summary: "Revoke a certificate",
      description: `${SIGNATURE} Revocation is final; the public verdict goes on reporting it. ${PLATFORM}`,
      permission: gate("generate"),
      audited: true,
      params: certificateIdParams,
      body: revokeCertificateSchema,
      conflict: "The certificate is already revoked.",
      success: { status: 200, description: "The revoked certificate", data: Certificate },
    },
    {
      method: "get",
      path: "/:certificateId/document",
      operationId: "getCertificateDocument",
      summary: "The certificate's document data",
      description: "The data the frontend renders the certificate PDF from (M-11, ADR-095); the backend renders no PDF.",
      permission: gate("read"),
      audited: false,
      params: certificateIdParams,
      success: { status: 200, description: "The certificate document", data: CertificateDocument },
    },
    {
      method: "get",
      path: "/:certificateId/pdf",
      operationId: "downloadCertificatePdf",
      summary: "Download the PDF stored before M-11",
      description: "Only for a certificate that has one (404 otherwise). Nothing is rendered here.",
      permission: gate("read"),
      audited: false,
      params: certificateIdParams,
      success: { status: 200, description: "The stored PDF", file: { contentType: "application/pdf" } },
    },
  ],
});
