// src/services/certificatePdf.service.ts
//
// Certificate verification and the STORED certificate PDFs.
//
// M-11 (ADR-095, owner decision 2026-09-29): the backend no longer RENDERS
// certificate PDFs. The frontend renders them from GET /certificates/:id/document
// (services/certificateDocument.service.ts), which also defines the integrity
// hashes. What stays here:
//
//  - the public verification endpoint, which now also publishes the document
//    DATA of a signed certificate (the fields its PDF printed before);
//  - the PDFs the backend rendered BEFORE this change. They stay on disk under
//    uploads/certificates/<random>.pdf and stay reachable exactly as before:
//    GET /certificates/:id/pdf (auth + certificate:read + tenant), and for the
//    public verification page a short-lived HMAC capability minted by the
//    verification endpoint for a SIGNED certificate
//    (GET /certificates/verify/:certificateNumber/document?token=...).
//    Nothing writes a new one. `filePath` is a storage locator
//    (`certificates/<file>`), not a URL; only its basename is ever used.
//
// P9-14 (ADR-087, Stage C): converted from certificatePdf.service.js with no
// behaviour change. `export =` keeps the exact object `require()` returned (the
// same keys, in the same order; the three re-exports are certificateDocument's
// own values, read at load). `fs`, `path`, the four models, `storagePath`,
// `signing` and `verificationTokenMatches` are captured at load, in the `.js`'s
// require order; certificateDocument's functions are read at call time, as the
// `.js`'s `certificateDocument.x(...)` did. CERT_SIGNING_SECRET and
// CERT_DOCUMENT_URL_TTL_SEC are still read ONCE, at load (config/env).

import fs from "fs";
import path from "path";
import models from "../models";
import storagePath from "../utils/storagePath.util";
import signing from "./storage/signing";
import {
  computeIntegrityHash,
  computeSignature,
  SIGNATURE_KEY_ID,
  ISSUER_ATTRIBUTES,
  toCertificateDocument,
} from "./certificateDocument.service";
import { verificationTokenMatches as loadedVerificationTokenMatches } from "../utils/certificateVerificationToken";
import { env } from "../config/env";

const { Certificate, CalibrationDevice, Tenant, User } = models;
const verificationTokenMatches = loadedVerificationTokenMatches;

const SIGNING_SECRET = env("CERT_SIGNING_SECRET");
/* istanbul ignore next -- fail-fast startup guard: certificate signatures are
   the platform's trust anchor, so we never fall back to a hardcoded default. */
if (!SIGNING_SECRET) {
  throw new Error("CERT_SIGNING_SECRET is required (no insecure default)");
}
/** The secret, known present past the guard above. */
const SECRET: string = SIGNING_SECRET;

// ADR-042 step 4 — the public verification page's document capability.
// An hour, not the attachment links' five minutes: the page mints a fresh one
// on every load, so the TTL only has to outlive one person reading one
// certificate (an auditor with the tab open), and the bookmark a third party
// keeps is the verification page, never this URL.
const DOCUMENT_URL_TTL_SEC = Number(env("CERT_DOCUMENT_URL_TTL_SEC")) || 3600;
// Domain-separated from every other HMAC made with the same secret.
const documentKey = (certificateNumber: unknown): string => `certificate-document:${String(certificateNumber)}`;

/** A host-relative, expiring URL to a signed certificate's stored PDF. */
const mintDocumentUrl = (certificateNumber: string): string => {
  const { token } = signing.sign(documentKey(certificateNumber), DOCUMENT_URL_TTL_SEC, SECRET);
  return `/api/v1/certificates/verify/${encodeURIComponent(certificateNumber)}/document?token=${token}`;
};

// The name a browser should save a download as. This is a Content-Disposition
// label only — it is never used as a path, and the file on disk keeps its
// random name (ADR-042 step 1, S-01).
const downloadFileName = (certificateNumber: unknown): string =>
  `${String(certificateNumber).replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;

/** A service answer the controller forwards. */
interface Outcome<T> {
  success: boolean;
  status: number;
  message?: string;
  data?: T;
}

interface StoredPdf {
  absPath: string;
  fileName: string;
  fileSize?: unknown;
}

/**
 * The PDF the backend rendered for a certificate before M-11, if it has one.
 * Nothing renders a missing one any more: a certificate with no stored file,
 * or whose file is gone, is a 404 that names where its document now comes from.
 */
const getStoredPdf = async (tenantId: string, certificateId: string): Promise<Outcome<StoredPdf>> => {
  const cert = await Certificate.findOne({
    where: { id: certificateId, tenantId },
    attributes: ["id", "certificateNumber", "filePath", "fileSize"],
  });
  if (!cert) {
    return { success: false, status: 404, message: "Certificate not found" };
  }
  const absPath = cert.filePath
    ? storagePath("uploads", "certificates", path.basename(cert.filePath))
    : null;
  if (!absPath || !fs.existsSync(absPath)) {
    return {
      success: false,
      status: 404,
      message:
        "This certificate has no stored PDF. Certificate PDFs are rendered by the application " +
        "from GET /certificates/:id/document (ADR-095).",
    };
  }
  return {
    success: true,
    status: 200,
    data: {
      absPath,
      // The on-disk name is random; the saved-as name stays readable.
      fileName: downloadFileName(cert.certificateNumber),
      fileSize: cert.fileSize,
    },
  };
};

// ------------------------------------------------------------------
// PUBLIC VERIFICATION
// ------------------------------------------------------------------
//
// A-293 (ADR-100) — two verdicts. Certificate numbers are sequential, so the
// number alone is public knowledge: walking them used to publish every
// certificate's device, serial number, signers and document.
//
//  - `token` equal to the certificate's verification token (its QR code
//    carries it; compared in constant time) → the FULL verdict, as before,
//    `disclosure: "full"`.
//  - no token, or any other value → the MINIMAL verdict, `disclosure:
//    "minimal"`: status, issuer, dates and the integrity hashes (one-way over
//    data that includes random UUIDs; how the holder of an old printout detects
//    tampering). No device, serial, signer, document, documentUrl or verifyUrl.
//    A wrong token answers exactly like no token, and a QR printed before the
//    token existed still resolves here — to this verdict, with no redirect (a
//    redirect to the tokened URL would hand the token to anyone with a number).
//  - not found is unchanged.
/**
 * @param certificateNumber
 * @param options - `token` as the query gave it (any type)
 */
const verifyByCertificateNumber = async (
  certificateNumber: string,
  { baseUrl, token }: { baseUrl?: string; token?: unknown } = {},
): Promise<Outcome<Record<string, unknown>>> => {
  // A-130 (F-11, ADR-051 A-107) — `paranoid: false`. A soft-deleted
  // certificate used to answer "No certificate matches this number", which to
  // a third party holding the printed copy reads as a forgery — and a deleted
  // REVOKED certificate lost the one fact the holder needed. The row is
  // reported as it stands, marked `withdrawn`, and never as valid.
  //
  // Every include is `required: false`: User has a defaultScope, so a bare
  // include would drop the certificate whenever a referenced user is gone.
  const person = ["id", "firstName", "lastName"];
  const cert = await Certificate.findOne({
    where: { certificateNumber },
    paranoid: false,
    include: [
      {
        model: CalibrationDevice,
        as: "device",
        attributes: ["id", "name", "serialNumber", "manufacturer", "model"],
        required: false,
      },
      // A-303 / ADR-107: the issuer's address and contact, for a certificate
      // with no signing snapshot (the document prints them live).
      { model: Tenant, as: "tenant", attributes: [...ISSUER_ATTRIBUTES], required: false },
      { model: User, as: "calibratedByUser", attributes: person, required: false },
      { model: User, as: "approvedByUser", attributes: person, required: false },
      { model: User, as: "signedByUser", attributes: person, required: false },
    ],
  });

  if (!cert) {
    return {
      success: true,
      status: 200,
      data: { found: false, valid: false, message: "No certificate matches this number." },
    };
  }

  const now = new Date();
  const revoked = cert.status === "revoked";
  const signed = cert.status === "signed";
  const expired = !!(cert.validUntil && new Date(cert.validUntil) < now);
  const withdrawn = !!cert.deletedAt;
  const valid = signed && !revoked && !expired && !withdrawn;
  const document = toCertificateDocument(cert, { baseUrl });

  if (!verificationTokenMatches(cert.verificationToken, token)) {
    const { scheme, algorithm, hash, legacyHash } = document.integrity;
    return {
      success: true,
      status: 200,
      data: {
        found: true,
        valid,
        status: cert.status,
        revoked,
        expired,
        withdrawn,
        certificateNumber: cert.certificateNumber,
        type: cert.type,
        // ADR-107: the issuer as the certificate prints it — the signing
        // snapshot for a v3 certificate, the live tenant name otherwise.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty issuer is null (ADR-038 rule 3)
        issuedTo: document.issuedBy || null,
        issueDate: cert.issueDate,
        validUntil: cert.validUntil,
        integrity: { scheme, algorithm, hash, legacyHash },
        disclosure: "minimal",
      },
    };
  }

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): empty values are null */
  return {
    success: true,
    status: 200,
    data: {
      disclosure: "full",
      found: true,
      valid,
      status: cert.status,
      revoked,
      expired,
      withdrawn,
      certificateNumber: cert.certificateNumber,
      type: cert.type,
      standard: cert.standard || null,
      // ADR-107: as printed — from the signing snapshot for a v3 certificate.
      issuedTo: document.issuedBy || null,
      device: document.device
        ? { name: document.device.name, serialNumber: document.device.serialNumber }
        : null,
      issueDate: cert.issueDate,
      validUntil: cert.validUntil,
      signedBy: document.signedBy,
      signedAt: cert.signedAt,
      // The v1 hash — what every PDF the backend rendered printed. Kept, with
      // its meaning unchanged, so an already-issued printout still matches.
      integrityHash: document.integrity.legacyHash,
      // M-11 (ADR-095): the hash every frontend-rendered PDF prints, which
      // binds every printed certificate field — `integrity.scheme` names it:
      // v3 (ADR-107) for a certificate signed with a snapshot, v2 before.
      integrity: document.integrity,
      verifyUrl: document.verifyUrl,
      // ADR-042 step 2 / A-57 — this endpoint is unauthenticated, so what it
      // returns is published to anyone who walks the certificate number. Only
      // an ISSUED certificate's document is published: `signed` is the only
      // status that means the tenant has stood behind the result. A revoked or
      // withdrawn certificate publishes none (its verdict above is what a
      // third party needs); an expired one still does — it was properly issued.
      //
      // `document` is the certificate's DATA, from which the verification page
      // renders the PDF (M-11). It is exactly what the stored PDF printed.
      document: signed && !withdrawn ? document : null,
      // A PDF the backend rendered before M-11, if this certificate has one:
      // a short-lived capability, verified again — status included — when it
      // is fetched (getVerifiedDocument).
      documentUrl: signed && !withdrawn && cert.filePath ? mintDocumentUrl(cert.certificateNumber) : null,
    },
  };
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
};

/**
 * Resolve the public verification page's stored-document capability.
 *
 * The token is checked BEFORE the database is touched. The certificate is then
 * re-checked as it stands now, not as it stood when the token was minted: a
 * certificate revoked or withdrawn inside the token's lifetime stops yielding
 * its document at once. Not found, not signed, withdrawn and never-rendered are
 * the same 404.
 *
 * @param certificateNumber
 * @param token - `<exp>.<hmac>` from mintDocumentUrl
 */
const getVerifiedDocument = async (certificateNumber: string, token: unknown): Promise<Outcome<StoredPdf>> => {
  if (!signing.verify(documentKey(certificateNumber), token, SECRET)) {
    return { success: false, status: 403, message: "Invalid or expired document link" };
  }
  const cert = await Certificate.findOne({
    where: { certificateNumber },
    attributes: ["id", "certificateNumber", "status", "filePath"],
  });
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the .js's `!cert || ...` (ADR-038 rule 3)
  if (!cert || cert.status !== "signed" || !cert.filePath) {
    return { success: false, status: 404, message: "Certificate document not found" };
  }
  const absPath = storagePath("uploads", "certificates", path.basename(cert.filePath));
  if (!fs.existsSync(absPath)) {
    return { success: false, status: 410, message: "Certificate document is no longer available" };
  }
  return {
    success: true,
    status: 200,
    data: { absPath, fileName: downloadFileName(cert.certificateNumber) },
  };
};

export = {
  // Re-exported: the integrity functions live in certificateDocument.service (M-11).
  computeIntegrityHash,
  computeSignature,
  SIGNATURE_KEY_ID,
  getStoredPdf,
  verifyByCertificateNumber,
  getVerifiedDocument,
  mintDocumentUrl,
};
