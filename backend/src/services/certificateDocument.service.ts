/**
 * M-11 (ADR-095, owner decision 2026-09-29) — the certificate DOCUMENT is data.
 *
 * The backend no longer renders certificate PDFs: it had to ship Chromium in
 * its image, and the pkg binary could not load the ES-module puppeteer at all
 * (ADR-078 D-1). The frontend renders the PDF from what this module serves:
 * every printed field, the verification URL the QR code carries, and the
 * integrity hashes the public verification page recomputes.
 *
 * INTEGRITY — two schemes, both over certificate DATA, never over PDF bytes
 * (nothing in this codebase ever hashed or signed the rendered file):
 *
 *  - `certificate-canonical-json-v1` (INTEGRITY_SCHEME_V1): the hash printed on
 *    every PDF the backend rendered before this change. Its canonical payload
 *    is UNCHANGED (moved here byte for byte from certificatePdf.service), so an
 *    already-issued printout still matches the verification page.
 *  - `certificate-content-v2` (INTEGRITY_SCHEME_V2): printed on every PDF the
 *    frontend renders. It binds every column of the certificate row the
 *    document prints — v1's fields plus summary, conditions, notes, the ids of
 *    who calibrated, approved and signed, and the e-signature value and its
 *    key id — so no printed certificate field can be altered on a printout
 *    without the verification page showing a different hash. Signed and
 *    revoked certificates cannot be edited (certificate.service), so a signed
 *    certificate's v2 hash is stable. Names of people, of the device and of
 *    the tenant are printed from the LIVE referenced rows and are NOT hashed:
 *    binding them would make a later rename look like tampering. The same
 *    holds for the issuer's address and contact (A-303, `issuer` below): a
 *    laboratory that moves would otherwise fail verification on every
 *    certificate it ever signed. Binding them needs them SNAPSHOT on the
 *    certificate at signing (a new scheme), not read live.
 *
 * The HMAC `signature` over the v2 hash (CERT_SIGNING_SECRET, key id beside
 * it) is returned to authenticated callers only, as the old generate route
 * returned it over v1; it is still neither persisted nor verifiable by a third
 * party (A-241) — the verification page, not the HMAC, is what a holder uses.
 */
import * as crypto from "crypto";
import { env } from "../config/env";
import { keyIdOf } from "../utils/keyring.util";
import models from "../models";
import type { CertificateSignedSnapshot } from "../utils/jsonShape.util";
import type { Transaction } from "sequelize";

export const INTEGRITY_SCHEME_V1 = "certificate-canonical-json-v1";
export const INTEGRITY_SCHEME_V2 = "certificate-content-v2";
/**
 * ADR-107 (Q-50): v2's fields PLUS the snapshot of what the certificate prints
 * (issuer, instrument, people), taken at signing. A certificate signed from
 * ADR-107 on prints v3; one signed before it has no snapshot and stays v2.
 */
export const INTEGRITY_SCHEME_V3 = "certificate-content-v3";

/**
 * CERT_SIGNING_SECRET, or a thrown error at load: certificate signatures are
 * the platform's trust anchor, so there is never a hardcoded default.
 */
export const requireSigningSecret = (value: string | undefined = env("CERT_SIGNING_SECRET")): string => {
  if (!value) {
    throw new Error("CERT_SIGNING_SECRET is required (no insecure default)");
  }
  return value;
};

const SIGNING_SECRET = requireSigningSecret();

/** P6-10: the HMAC names the key that made it — a fingerprint of CERT_SIGNING_SECRET. */
export const SIGNATURE_KEY_ID = `hmac-sha256:${keyIdOf(Buffer.from(SIGNING_SECRET))}`;

/** A person as the includes load them. */
export interface CertificatePerson {
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * The issuing tenant as the include loads it (A-303: name, address, contact).
 * ISO/IEC 17025 7.8.2 puts the laboratory's name and address on the report.
 */
export interface CertificateIssuerSource {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  website?: string | null;
}

/** The issuer a document prints: every member present, absent ones null. */
export type CertificateIssuer = { [K in keyof CertificateIssuerSource]-?: string | null };

/** The tenant columns the document include loads, in print order. */
export const ISSUER_ATTRIBUTES = [
  "id",
  "name",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zipCode",
  "country",
  "website",
] as const;

/** The certificate row and its includes — the members read here. */
export interface CertificateSource {
  certificateNumber: string;
  tenantId: string;
  deviceId: string;
  calibrationRecordId?: string | null;
  type?: string | null;
  status?: string | null;
  standard?: string | null;
  issueDate?: Date | string | null;
  validUntil?: Date | string | null;
  summary?: string | null;
  conditions?: string | null;
  notes?: string | null;
  calibratedBy?: string | null;
  approvedBy?: string | null;
  signedBy?: string | null;
  signedAt?: Date | string | null;
  digitalSignature?: string | null;
  digitalSignatureKeyId?: string | null;
  /** A-293: the QR code's secret; NOT hashed (it is not a printed certificate field). */
  verificationToken?: string | null;
  tenant?: CertificateIssuerSource | null;
  device?: {
    name?: string | null;
    serialNumber?: string | null;
    manufacturer?: string | null;
    model?: string | null;
  } | null;
  calibratedByUser?: CertificatePerson | null;
  approvedByUser?: CertificatePerson | null;
  signedByUser?: CertificatePerson | null;
  /** ADR-107: set once, at signing (captureSignedSnapshot); null before, and for a certificate signed before ADR-107. */
  signedSnapshot?: CertificateSignedSnapshot | null;
}

/** The hashes a printed certificate carries, and how to recompute them. */
export interface CertificateIntegrity {
  /** v3 for a certificate with a signing snapshot (ADR-107), v2 otherwise. */
  scheme: typeof INTEGRITY_SCHEME_V2 | typeof INTEGRITY_SCHEME_V3;
  algorithm: "SHA-256";
  hash: string;
  /** The pre-M-11 hash (`certificate-canonical-json-v1`), printed on server-rendered PDFs. */
  legacyHash: string;
  /** Authenticated callers only. */
  signature?: string;
  signatureKeyId?: string;
}

/** Everything the frontend prints on a certificate PDF. */
export interface CertificateDocument {
  certificateNumber: string;
  type: string;
  status: string;
  issuedBy: string | null;
  /** A-303: the issuing laboratory (live tenant row, NOT hashed); null when not loaded. */
  issuer: CertificateIssuer | null;
  device: { name: string | null; serialNumber: string | null; manufacturer: string | null; model: string | null } | null;
  standard: string | null;
  issueDate: string | null;
  validUntil: string | null;
  summary: string | null;
  conditions: string | null;
  notes: string | null;
  calibratedBy: string | null;
  approvedBy: string | null;
  signedBy: string | null;
  signedAt: string | null;
  verifyUrl: string;
  integrity: CertificateIntegrity;
  /**
   * ADR-107: "signing" — the issuer, instrument and people are the snapshot
   * taken at signing (v3); "live" — they are the current rows (a draft, or a
   * certificate signed before ADR-107, v2).
   */
  contentAsOf: "signing" | "live";
}

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

/** The issuer block of the document (A-303). */
export const toIssuer = (tenant: CertificateIssuerSource | null | undefined): CertificateIssuer | null =>
  tenant
    ? {
      name: tenant.name ?? null,
      email: tenant.email ?? null,
      phone: tenant.phone ?? null,
      address: tenant.address ?? null,
      city: tenant.city ?? null,
      state: tenant.state ?? null,
      zipCode: tenant.zipCode ?? null,
      country: tenant.country ?? null,
      website: tenant.website ?? null,
    }
    : null;

/**
 * v1 — the canonical payload the backend-rendered PDFs printed. UNCHANGED:
 * the same keys, order and normalisation as certificatePdf.service had.
 */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- `||` as built: an empty string hashed as null in every printed v1 hash */
export const buildCanonicalPayload = (cert: CertificateSource): string =>
  JSON.stringify({
    certificateNumber: cert.certificateNumber,
    tenantId: cert.tenantId,
    deviceId: cert.deviceId,
    calibrationRecordId: cert.calibrationRecordId || null,
    type: cert.type,
    status: cert.status,
    standard: cert.standard || null,
    issueDate: iso(cert.issueDate),
    validUntil: iso(cert.validUntil),
    signedBy: cert.signedBy || null,
    signedAt: iso(cert.signedAt),
  });
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

/** v2 — every column of the certificate row a document prints, in a fixed order. */
/** The certificate-row fields v2 and v3 bind, in their fixed order (M-11). */
const contentFields = (cert: CertificateSource): Record<string, string | null> => ({
  certificateNumber: cert.certificateNumber,
  tenantId: cert.tenantId,
  deviceId: cert.deviceId,
  calibrationRecordId: cert.calibrationRecordId ?? null,
  type: cert.type ?? null,
  status: cert.status ?? null,
  standard: cert.standard ?? null,
  issueDate: iso(cert.issueDate),
  validUntil: iso(cert.validUntil),
  summary: cert.summary ?? null,
  conditions: cert.conditions ?? null,
  notes: cert.notes ?? null,
  calibratedBy: cert.calibratedBy ?? null,
  approvedBy: cert.approvedBy ?? null,
  signedBy: cert.signedBy ?? null,
  signedAt: iso(cert.signedAt),
  digitalSignature: cert.digitalSignature ?? null,
  digitalSignatureKeyId: cert.digitalSignatureKeyId ?? null,
});

/** v2 — every column of the certificate row a document prints. Unchanged by ADR-107 (the same keys, in the same order). */
export const buildContentPayload = (cert: CertificateSource): string =>
  JSON.stringify({ scheme: INTEGRITY_SCHEME_V2, ...contentFields(cert) });

/**
 * The snapshot in a FIXED key order. PostgreSQL returns a JSONB object with its
 * keys re-ordered (shortest first), so the hash must not depend on the order
 * the row comes back in.
 */
export const canonicalSnapshot = (snapshot: CertificateSignedSnapshot): CertificateSignedSnapshot => ({
  version: snapshot.version,
  issuer: {
    name: snapshot.issuer.name,
    email: snapshot.issuer.email,
    phone: snapshot.issuer.phone,
    address: snapshot.issuer.address,
    city: snapshot.issuer.city,
    state: snapshot.issuer.state,
    zipCode: snapshot.issuer.zipCode,
    country: snapshot.issuer.country,
    website: snapshot.issuer.website,
  },
  device: snapshot.device
    ? {
      name: snapshot.device.name,
      serialNumber: snapshot.device.serialNumber,
      manufacturer: snapshot.device.manufacturer,
      model: snapshot.device.model,
    }
    : null,
  calibratedBy: snapshot.calibratedBy,
  approvedBy: snapshot.approvedBy,
  signedBy: snapshot.signedBy,
});

/**
 * v3 (ADR-107) — v2's fields, then the signing snapshot. Only for a certificate
 * that HAS a snapshot; a certificate without one is v2 (a missing snapshot is
 * never hashed as null, which would let a deleted snapshot pass as v3).
 */
export const buildContentPayloadV3 = (cert: CertificateSource): string => {
  if (!cert.signedSnapshot) {
    throw new Error(`Certificate ${cert.certificateNumber} has no signing snapshot: it is v2, not v3`);
  }
  return JSON.stringify({
    scheme: INTEGRITY_SCHEME_V3,
    ...contentFields(cert),
    snapshot: canonicalSnapshot(cert.signedSnapshot),
  });
};

const sha256 = (text: string): string => crypto.createHash("sha256").update(text).digest("hex");

/** The v1 hash (legacy printouts). */
export const computeIntegrityHash = (cert: CertificateSource): string => sha256(buildCanonicalPayload(cert));

/** The v2 hash (frontend-rendered printouts). */
export const computeContentHash = (cert: CertificateSource): string => sha256(buildContentPayload(cert));

/** The v3 hash (ADR-107): certificates signed with a snapshot. */
export const computeContentHashV3 = (cert: CertificateSource): string => sha256(buildContentPayloadV3(cert));

/** HMAC-SHA256 of a hash under CERT_SIGNING_SECRET. */
export const computeSignature = (hash: string): string =>
  crypto.createHmac("sha256", SIGNING_SECRET).update(hash).digest("hex");

/**
 * The URL a scanned QR resolves to: the configured verification page, else the
 * public API's verification endpoint (as the backend-rendered PDFs printed).
 *
 * A-293 (ADR-100): it carries the certificate's verification token — `?t=` on
 * the page, `?token=` on the API — which is what unlocks the full public
 * verdict. A walked number, or a QR printed before the token existed, gets
 * the minimal one. With no token the URL is the token-less one.
 */
export const resolveVerifyUrl = (
  certificateNumber: string,
  baseUrl?: string | null,
  verificationToken?: string | null,
): string => {
  const withToken = (url: string, param: "t" | "token"): string =>
    verificationToken ? `${url}?${param}=${encodeURIComponent(verificationToken)}` : url;
  const explicit = env("CERT_VERIFY_BASE_URL");
  if (explicit) {
    return withToken(`${explicit.replace(/\/$/, "")}/${certificateNumber}`, "t");
  }
  // `||` as built: an empty base falls through to the next one.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const base = (baseUrl || env("PUBLIC_BASE_URL") || "http://localhost:5000").replace(/\/$/, "");
  return withToken(`${base}/api/v1/certificates/verify/${certificateNumber}`, "token");
};

/**
 * A person's printed name, or null. Unlike the backend template, a nameless
 * account does NOT fall back to its email: the document is also published on
 * the public verification page, and a staff member's address is not a
 * certificate field.
 */
export const personName = (u: CertificatePerson | null | undefined): string | null => {
  const name = [u?.firstName, u?.lastName].filter(Boolean).join(" ");
  return name === "" ? null : name;
};

/**
 * The document for `cert`. `withSignature` adds the server HMAC (authenticated
 * callers only). The signer is printed only once the certificate is signed or
 * revoked, as the backend template did.
 */
export const toCertificateDocument = (
  cert: CertificateSource,
  { baseUrl, withSignature = false }: { baseUrl?: string | null | undefined; withSignature?: boolean } = {},
): CertificateDocument => {
  const status = cert.status ?? "draft";
  // ADR-107: a certificate signed with a snapshot is printed FROM it and hashed v3.
  const snapshot = cert.signedSnapshot ?? null;
  const hash = snapshot ? computeContentHashV3(cert) : computeContentHash(cert);
  const integrity: CertificateIntegrity = {
    scheme: snapshot ? INTEGRITY_SCHEME_V3 : INTEGRITY_SCHEME_V2,
    algorithm: "SHA-256",
    hash,
    legacyHash: computeIntegrityHash(cert),
  };
  if (withSignature) {
    integrity.signature = computeSignature(hash);
    integrity.signatureKeyId = SIGNATURE_KEY_ID;
  }
  const signerShown = status === "signed" || status === "revoked";
  const live = {
    issuer: toIssuer(cert.tenant),
    device: cert.device
      ? {
        name: cert.device.name ?? null,
        serialNumber: cert.device.serialNumber ?? null,
        manufacturer: cert.device.manufacturer ?? null,
        model: cert.device.model ?? null,
      }
      : null,
    calibratedBy: personName(cert.calibratedByUser),
    approvedBy: personName(cert.approvedByUser),
    signedBy: personName(cert.signedByUser),
  };
  const printed = snapshot ? canonicalSnapshot(snapshot) : live;
  return {
    certificateNumber: cert.certificateNumber,
    type: cert.type ?? "calibration",
    status,
    issuedBy: printed.issuer?.name ?? null,
    issuer: printed.issuer,
    device: printed.device,
    standard: cert.standard ?? null,
    issueDate: iso(cert.issueDate),
    validUntil: iso(cert.validUntil),
    summary: cert.summary ?? null,
    conditions: cert.conditions ?? null,
    notes: cert.notes ?? null,
    calibratedBy: printed.calibratedBy,
    approvedBy: printed.approvedBy,
    signedBy: signerShown ? printed.signedBy : null,
    signedAt: signerShown ? iso(cert.signedAt) : null,
    verifyUrl: resolveVerifyUrl(cert.certificateNumber, baseUrl, cert.verificationToken),
    integrity,
    contentAsOf: snapshot ? "signing" : "live",
  };
};

/** The certificate as the sign step holds it (the locked row). */
export interface SnapshotSubject {
  tenantId: string;
  deviceId: string;
  calibratedBy?: string | null;
  approvedBy?: string | null;
  signedBy?: string | null;
}

/**
 * ADR-107 (Q-50) — what the certificate prints, as it stands at the moment of
 * signing: the issuing tenant's name, address and contact, the instrument, and
 * the three people. Read inside the sign transaction (`transaction`), after the
 * signer is set, so the snapshot is exactly what the v3 hash then binds.
 *
 * A reference that no longer resolves (a deleted user or device) is recorded
 * as null, as the live document would print it.
 */
export const captureSignedSnapshot = async (
  cert: SnapshotSubject,
  transaction: Transaction | null = null,
): Promise<CertificateSignedSnapshot> => {
  const tenant = (await models.Tenant.findByPk(cert.tenantId, {
    attributes: [...ISSUER_ATTRIBUTES],
    transaction,
  })) as CertificateIssuerSource | null;
  const device = (await models.CalibrationDevice.findByPk(cert.deviceId, {
    attributes: ["id", "name", "serialNumber", "manufacturer", "model"],
    transaction,
  })) as CertificateSource["device"];
  const person = async (id: string | null | undefined): Promise<string | null> =>
    id
      ? personName(
        (await models.User.findByPk(id, { attributes: PERSON_ATTRIBUTES, transaction })),
      )
      : null;
  return {
    version: 1,
    issuer: toIssuer(tenant ?? {}) as CertificateSignedSnapshot["issuer"],
    device: device
      ? {
        name: device.name ?? null,
        serialNumber: device.serialNumber ?? null,
        manufacturer: device.manufacturer ?? null,
        model: device.model ?? null,
      }
      : null,
    calibratedBy: await person(cert.calibratedBy),
    approvedBy: await person(cert.approvedBy),
    signedBy: await person(cert.signedBy),
  };
};

const PERSON_ATTRIBUTES = ["id", "firstName", "lastName"];

/**
 * Every include is `required: false` (CLAUDE.md, the first trap): User has a
 * defaultScope, so a bare include would be an INNER JOIN and a certificate
 * whose approver was deleted — or authored by the super admin (A-90) — would
 * vanish. `paranoid` is left on: a withdrawn certificate has no document here.
 */
const DOCUMENT_INCLUDES = (): object[] => [
  { model: models.CalibrationDevice, as: "device", required: false },
  { model: models.Tenant, as: "tenant", attributes: [...ISSUER_ATTRIBUTES], required: false },
  // P21-09e (spec § 12 rule 6): a facility-bound viewer of its facility's UNSIGNED certificate sees
  // the same printed names (and so the same content hash) as provider staff — names only.
  {
    model: models.User,
    as: "calibratedByUser",
    attributes: PERSON_ATTRIBUTES,
    required: false,
    // skipFacilityScope: the certificate's people are provider staff (no facility); names only (FACILITY_SCOPE_SKIPS).
    skipFacilityScope: true,
  },
  {
    model: models.User,
    as: "approvedByUser",
    attributes: PERSON_ATTRIBUTES,
    required: false,
    // skipFacilityScope: the certificate's people are provider staff (no facility); names only (FACILITY_SCOPE_SKIPS).
    skipFacilityScope: true,
  },
  {
    model: models.User,
    as: "signedByUser",
    attributes: PERSON_ATTRIBUTES,
    required: false,
    // skipFacilityScope: the certificate's people are provider staff (no facility); names only (FACILITY_SCOPE_SKIPS).
    skipFacilityScope: true,
  },
];

/** The result shape the controllers turn into an envelope (as the other certificate services). */
export type DocumentResult =
  | { success: true; status: 200; data: CertificateDocument }
  | { success: false; status: 404; message: string };

/**
 * GET /certificates/:id/document — the caller's own tenant only. The global
 * tenant hooks scope the read as well; the explicit predicate keeps the
 * service safe for any caller. Another tenant's certificate, a soft-deleted
 * one and a missing one are the same 404.
 */
export const getCertificateDocument = async (
  tenantId: string,
  certificateId: string,
  { baseUrl }: { baseUrl?: string | null | undefined } = {},
): Promise<DocumentResult> => {
  const cert = (await models.Certificate.findOne({
    where: { id: certificateId, tenantId },
    include: DOCUMENT_INCLUDES(),
  })) as CertificateSource | null;
  if (!cert) {
    return { success: false, status: 404, message: "Certificate not found" };
  }
  return { success: true, status: 200, data: toCertificateDocument(cert, { baseUrl, withSignature: true }) };
};
