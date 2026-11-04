/**
 * Personal e-signatures and their applications (P21-15; ADR-140; spec
 * MEMORY/specs/P21-15-operator-esignature.md v2 § 2 – § 4).
 *
 * Every user creates ONE e-signature: a visual specimen (sanitised SVG) and a personal RSA key pair
 * whose private half the server holds under the KMS ring. Each time it is APPLIED to a document the
 * system writes an application binding the signer, the meaning, the instant and the SHA-256 of the
 * document's canonical content, signed with the personal key, with its own public verification link.
 * The e-signature is NOT the certificate's tenant-key signature (ADR-040), which stays unchanged.
 *
 * THE CANONICAL FORMS (§ 3). Pure functions, used by the backend when it signs and verifies and by
 * the public verification page to recompute the hash in the browser:
 *  - `calrec-data-v1`: a calibration record's data as `[name, value]` pairs in a FIXED order, every
 *    value a string, null written as `""`, `results` with its object keys sorted at every depth;
 *  - `file-sha256`: the SHA-256 of a file's bytes, computed in the browser — the file never leaves it;
 *  - the SIGNED PAYLOAD (`esig-app-v1-rsa-sha256`): `[name, value]` pairs naming the application.
 * A change to any form is a NEW scheme beside it, never an edit (golden tests pin each).
 *
 * The hash itself is computed by the caller (`node:crypto` on the server, `crypto.subtle` in the
 * browser): this module imports nothing but `zod` and its siblings, so both ends load it.
 */
import { z } from "zod";
import { uuid } from "./fields";

// ==========================================
// VALUES
// ==========================================

/** The signed payload's scheme: RSA (the personal key) over SHA-256. */
export const ESIG_APP_SCHEME = "esig-app-v1-rsa-sha256";
/** A calibration record's canonical data. */
export const CALREC_DATA_SCHEME = "calrec-data-v1";
/** A certificate's canonical data: what the certificate SAYS, never its flow state (ADR-140 § 6). */
export const CERT_DATA_SCHEME = "cert-data-v1";
/** A file hashed in the browser. */
export const FILE_SHA256_SCHEME = "file-sha256";

/** The content schemes migration 0149's CHECK admits. */
export const ESIG_CONTENT_SCHEMES = Object.freeze([CALREC_DATA_SCHEME, CERT_DATA_SCHEME, FILE_SHA256_SCHEME] as const);
export type EsigContentScheme = (typeof ESIG_CONTENT_SCHEMES)[number];

/** What an application is affixed to (migration 0149's CHECK; extensible by migration). */
export const ESIG_DOCUMENT_TYPES = Object.freeze(["calibration_record", "certificate", "document"] as const);
export type EsigDocumentType = (typeof ESIG_DOCUMENT_TYPES)[number];

/** What an application means (Part 11 § 11.50). */
export const ESIG_MEANINGS = Object.freeze(["performed", "reviewed", "approved", "authored", "acknowledged"] as const);
export type EsigMeaning = (typeof ESIG_MEANINGS)[number];

/** The meanings a calibration record takes: its performer's, or another person's review. */
export const CALREC_ESIG_MEANINGS = Object.freeze(["performed", "reviewed"] as const);

/** The meanings a certificate takes: its calibrator's, or its approver's or signer's approval. */
export const CERT_ESIG_MEANINGS = Object.freeze(["performed", "approved"] as const);

/** How the signer re-authenticated (§ 11.200 (a)). */
export const ESIG_AUTH_METHODS = Object.freeze(["password", "mfa"] as const);
export type EsigAuthMethod = (typeof ESIG_AUTH_METHODS)[number];

/** A user e-signature's lifecycle. A superseded or revoked one still verifies its past applications. */
export const ESIG_STATUSES = Object.freeze(["active", "superseded", "revoked"] as const);
export type EsigStatus = (typeof ESIG_STATUSES)[number];

/** A verification token: 24 CSPRNG bytes as base64url, 32 characters (ADR-100). */
export const ESIG_VERIFY_TOKEN = /^[A-Za-z0-9_-]{32}$/;

/** The public verdict, the field a reader branches on (§ 4). */
export const ESIG_VERDICTS = Object.freeze(["valid", "content_changed", "invalid"] as const);
export type EsigVerdict = (typeof ESIG_VERDICTS)[number];

/** A signed record's lifecycle now, shown BESIDE a verdict, never in its place. */
export const ESIG_DOCUMENT_STATES = Object.freeze(["current", "superseded", "voided", "revoked"] as const);
export type EsigDocumentState = (typeof ESIG_DOCUMENT_STATES)[number];

/** The content recomputed now against the signed hash (the staff reads). */
export const ESIG_INTEGRITY_STATES = Object.freeze(["intact", "changed"] as const);
export type EsigIntegrityState = (typeof ESIG_INTEGRITY_STATES)[number];

/** The top-level codes of the refusals (§ 2, § 4), each beside its explanation. */
export const ESIG_CODES = Object.freeze({
  platform: "ESIG_PLATFORM",
  none: "ESIG_NONE",
  notPerformer: "ESIG_NOT_PERFORMER",
  notApprover: "ESIG_NOT_APPROVER",
  certificateNotApproved: "CERT_NOT_APPROVED",
  certificateRevoked: "CERT_REVOKED",
  alreadyApplied: "ESIG_ALREADY_APPLIED",
  specimen: "ESIG_SPECIMEN_INVALID",
  recordVoided: "CALREC_VOIDED",
  recordSuperseded: "CALREC_SUPERSEDED",
  recordExternal: "CALREC_EXTERNAL",
} as const);
export type EsigCode = (typeof ESIG_CODES)[keyof typeof ESIG_CODES];

// ==========================================
// THE SPECIMEN (§ 2.1)
// ==========================================

/** The largest specimen of paths only, and the largest that embeds one raster image. */
export const SPECIMEN_MAX_BYTES = 64 * 1024;
export const SPECIMEN_IMAGE_MAX_BYTES = 256 * 1024;

const PRESENTATION = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "fill-opacity", "opacity", "transform"];

/** The allow-list: element → its attributes. Anything else is refused, never repaired. */
const SPECIMEN_ELEMENTS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  svg: new Set(["xmlns", "viewBox", "width", "height", "version", "preserveAspectRatio", ...PRESENTATION]),
  g: new Set(PRESENTATION),
  path: new Set(["d", ...PRESENTATION]),
  polyline: new Set(["points", ...PRESENTATION]),
  polygon: new Set(["points", ...PRESENTATION]),
  line: new Set(["x1", "y1", "x2", "y2", ...PRESENTATION]),
  circle: new Set(["cx", "cy", "r", ...PRESENTATION]),
  ellipse: new Set(["cx", "cy", "rx", "ry", ...PRESENTATION]),
  rect: new Set(["x", "y", "width", "height", "rx", "ry", ...PRESENTATION]),
  image: new Set(["href", "x", "y", "width", "height", "preserveAspectRatio"]),
});

const TAG = /<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z][a-zA-Z0-9:-]*="[^"<>]*")*)\s*(\/?)>/y;
const ATTRIBUTE = /([a-zA-Z][a-zA-Z0-9:-]*)="([^"<>]*)"/g;
const IMAGE_HREF = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const DANGEROUS_VALUE = /javascript:|url\s*\(|expression\s*\(|&/i;

/** A text's UTF-8 length in bytes (this module runs in the browser and in Node, with no DOM or Node types). */
const utf8Length = (text: string): number => {
  let bytes = 0;
  for (const char of text) {
    // A character of a string always has a code point.
    const code = Number(char.codePointAt(0));
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
};

/**
 * Check a specimen against the allow-list (§ 2.1): one `<svg>` root holding only the listed
 * elements and attributes, no text, no entity, no external reference, an `<image>` only as a PNG or
 * JPEG data URI, at most 64 KB (256 KB with an image).
 *
 * @param svg - the specimen as submitted
 * @returns null when it is acceptable, else why not
 */
export const specimenProblem = (svg: string): string | null => {
  const bytes = utf8Length(svg);
  if (bytes > SPECIMEN_IMAGE_MAX_BYTES) {
    return "too large";
  }
  const stack: string[] = [];
  let sawRoot = false;
  let hasImage = false;
  let position = 0;
  const source = svg.trim();
  while (position < source.length) {
    const next = source.indexOf("<", position);
    // The source is trimmed, so what follows the last tag is never whitespace alone.
    if (next === -1 || source.slice(position, next).trim() !== "") {
      return "text content is not allowed";
    }
    TAG.lastIndex = next;
    const match = TAG.exec(source);
    if (!match) {
      return "not an allowed tag";
    }
    const [whole, closing, rawName, attributes, selfClosing] = match as unknown as [string, string, string, string, string];
    const name = rawName;
    const allowed = SPECIMEN_ELEMENTS[name];
    if (!allowed) {
      return `element <${name}> is not allowed`;
    }
    if (closing) {
      if (stack.pop() !== name) {
        return "unbalanced tags";
      }
    } else {
      if (stack.length === 0 && (sawRoot || name !== "svg")) {
        return "the root must be one <svg>";
      }
      if (stack.length > 0 && name === "svg") {
        return "a nested <svg> is not allowed";
      }
      sawRoot = true;
      for (const [, attribute, value] of attributes.matchAll(ATTRIBUTE) as IterableIterator<[string, string, string]>) {
        if (!allowed.has(attribute)) {
          return `attribute ${attribute} is not allowed on <${name}>`;
        }
        if (name === "image" && attribute === "href") {
          if (!IMAGE_HREF.test(value)) {
            return "an image must be a PNG or JPEG data URI";
          }
          hasImage = true;
        } else if (DANGEROUS_VALUE.test(value)) {
          return `attribute ${attribute} has a value that is not allowed`;
        }
      }
      if (!selfClosing) {
        stack.push(name);
      }
    }
    position = next + whole.length;
  }
  if (!sawRoot || stack.length > 0) {
    return "the root must be one complete <svg>";
  }
  return !hasImage && bytes > SPECIMEN_MAX_BYTES ? "too large" : null;
};

// ==========================================
// THE CANONICAL CALIBRATION-RECORD DATA (§ 3)
// ==========================================

/** The canonical data's member names, in their fixed order. */
export const CALREC_DATA_FIELDS = Object.freeze([
  "schemeVersion",
  "tenantId",
  "recordId",
  "deviceId",
  "clientFacilityId",
  "calibrationDate",
  "dueDate",
  "standard",
  "results",
  "measurementUncertainty",
  "isCompliant",
  "entryKind",
  "performedBy",
  "calibrationVendorId",
  "externalLabName",
  "notes",
] as const);
export type CalrecDataField = (typeof CALREC_DATA_FIELDS)[number];

/** Canonical content as pairs: what is hashed, and what the public verdict shows. */
export type CanonicalPairs = readonly (readonly [string, string])[];

/** A calibration day: a `Date`, or text whose first ten characters are `YYYY-MM-DD`. */
type DayValue = Date | string | null | undefined;

/** The record's members the canonical data reads (the model row satisfies it). */
export interface CalibrationRecordDataInput {
  readonly tenantId: string;
  readonly id: string;
  readonly deviceId: string;
  readonly clientFacilityId?: string | null;
  readonly calibrationDate: DayValue;
  readonly dueDate?: DayValue;
  readonly standard?: string | null;
  readonly results?: unknown;
  readonly measurementUncertainty?: number | string | null;
  readonly isCompliant?: boolean | null;
  readonly entryKind?: string | null;
  readonly performedBy?: string | null;
  readonly calibrationVendorId?: string | null;
  readonly externalLabName?: string | null;
  readonly notes?: string | null;
}

const text = (value: string | null | undefined): string => value ?? "";

/** The calendar day of a stored instant, in UTC (the column is written at midnight UTC). */
const dayOf = (value: DayValue): string => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  return typeof value === "string" ? value.slice(0, 10) : "";
};

/** A JSON value with every object's keys sorted, at every depth. */
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, sortKeys(source[key])]));
  }
  return value;
};

/**
 * A calibration record's data as the canonical pairs (`calrec-data-v1`).
 *
 * @param record - the calibration record
 * @returns the sixteen `[name, value]` pairs, in the fixed order
 */
export const calibrationRecordDataPairs = (record: CalibrationRecordDataInput): readonly (readonly [CalrecDataField, string])[] => {
  const uncertainty = record.measurementUncertainty;
  const compliant = record.isCompliant;
  return [
    ["schemeVersion", CALREC_DATA_SCHEME],
    ["tenantId", record.tenantId],
    ["recordId", record.id],
    ["deviceId", record.deviceId],
    ["clientFacilityId", text(record.clientFacilityId)],
    ["calibrationDate", dayOf(record.calibrationDate)],
    ["dueDate", dayOf(record.dueDate)],
    ["standard", text(record.standard)],
    ["results", record.results === null || record.results === undefined ? "" : JSON.stringify(sortKeys(record.results))],
    ["measurementUncertainty", uncertainty === null || uncertainty === undefined ? "" : String(uncertainty)],
    ["isCompliant", compliant === null || compliant === undefined ? "" : String(compliant)],
    ["entryKind", text(record.entryKind)],
    ["performedBy", text(record.performedBy)],
    ["calibrationVendorId", text(record.calibrationVendorId)],
    ["externalLabName", text(record.externalLabName)],
    ["notes", text(record.notes)],
  ];
};

/**
 * The canonical data of a calibration record: the JSON whose SHA-256 is the content hash.
 *
 * @param record - the calibration record
 * @returns the JSON text of the canonical pairs
 */
export const canonicalCalibrationRecordData = (record: CalibrationRecordDataInput): string => JSON.stringify(calibrationRecordDataPairs(record));

// ==========================================
// THE CANONICAL CERTIFICATE DATA (§ 3, ADR-140 § 6)
// ==========================================

/**
 * The certificate's canonical data's member names, in their fixed order: what the certificate SAYS.
 * Never `status`, `signedAt`, `signedBy`, `approvedBy`, `digitalSignature`, `signedSnapshot` or the
 * document's integrity hash — they change as the certificate moves through its flow (the integrity
 * hash exists only from signing), so an approval applied before signing would read as changed.
 */
export const CERT_DATA_FIELDS = Object.freeze([
  "schemeVersion",
  "tenantId",
  "certificateId",
  "certificateNumber",
  "type",
  "calibrationRecordId",
  "deviceId",
  "issueDate",
  "validUntil",
  "standard",
  "summary",
  "conditions",
  "notes",
  "calibratedBy",
] as const);
export type CertDataField = (typeof CERT_DATA_FIELDS)[number];

/** The certificate's members the canonical data reads (the model row satisfies it). */
export interface CertificateDataInput {
  readonly tenantId: string;
  readonly id: string;
  readonly certificateNumber: string;
  readonly type?: string | null;
  readonly calibrationRecordId?: string | null;
  readonly deviceId: string;
  readonly issueDate?: DayValue;
  readonly validUntil?: DayValue;
  readonly standard?: string | null;
  readonly summary?: string | null;
  readonly conditions?: string | null;
  readonly notes?: string | null;
  readonly calibratedBy?: string | null;
}

/**
 * A certificate's data as the canonical pairs (`cert-data-v1`).
 *
 * @param certificate - the certificate
 * @returns the fourteen `[name, value]` pairs, in the fixed order
 */
export const certificateDataPairs = (certificate: CertificateDataInput): readonly (readonly [CertDataField, string])[] => [
  ["schemeVersion", CERT_DATA_SCHEME],
  ["tenantId", certificate.tenantId],
  ["certificateId", certificate.id],
  ["certificateNumber", certificate.certificateNumber],
  ["type", text(certificate.type)],
  ["calibrationRecordId", text(certificate.calibrationRecordId)],
  ["deviceId", certificate.deviceId],
  ["issueDate", dayOf(certificate.issueDate)],
  ["validUntil", dayOf(certificate.validUntil)],
  ["standard", text(certificate.standard)],
  ["summary", text(certificate.summary)],
  ["conditions", text(certificate.conditions)],
  ["notes", text(certificate.notes)],
  ["calibratedBy", text(certificate.calibratedBy)],
];

/**
 * The canonical data of a certificate: the JSON whose SHA-256 is the content hash.
 *
 * @param certificate - the certificate
 * @returns the JSON text of the canonical pairs
 */
export const canonicalCertificateData = (certificate: CertificateDataInput): string => JSON.stringify(certificateDataPairs(certificate));

/** The fields of each canonical-pairs scheme the browser can recompute. */
const PAIR_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({ [CALREC_DATA_SCHEME]: CALREC_DATA_FIELDS, [CERT_DATA_SCHEME]: CERT_DATA_FIELDS });

/**
 * The canonical JSON of pairs a verdict served — what the verification page hashes in the browser,
 * so a reader need not trust the server's verdict. Pairs that are not exactly the scheme's canonical
 * form (another order, a missing or extra name, a value that is not a string) are refused.
 *
 * @param scheme - the application's content scheme
 * @param pairs - the verdict's `canonicalContent`
 * @returns the JSON text to hash, or null when the pairs are not canonical for the scheme
 */
export const canonicalJsonOfPairs = (scheme: string, pairs: unknown): string | null => {
  const fields = PAIR_FIELDS[scheme];
  if (!fields || !Array.isArray(pairs) || pairs.length !== fields.length) {
    return null;
  }
  const canonical = pairs.every((pair, index) => Array.isArray(pair) && pair.length === 2 && pair[0] === fields[index] && typeof pair[1] === "string");
  return canonical && (pairs[0] as unknown[])[1] === scheme ? JSON.stringify(pairs) : null;
};

// ==========================================
// THE SIGNED PAYLOAD (§ 3)
// ==========================================

/** What an application binds. */
export interface EsigPayloadInput {
  readonly tenantId: string;
  readonly applicationId: string;
  readonly esignatureId: string;
  readonly keyFingerprint: string;
  readonly documentType: string;
  readonly documentId: string | null;
  readonly contentScheme: string;
  readonly contentHash: string;
  readonly meaning: string;
  readonly signerUserId: string;
  /** ISO-8601 UTC with milliseconds — the stored `signed_at`, never a second clock reading. */
  readonly signedAt: string;
  readonly authMethod: string;
}

/**
 * The bytes the signer's personal key signs (`esig-app-v1-rsa-sha256`).
 *
 * @param input - what the application binds
 * @returns the JSON text of the signed pairs (a null document id is written as `""`)
 */
export const esignatureSignedPayload = (input: EsigPayloadInput): string =>
  JSON.stringify([
    ["scheme", ESIG_APP_SCHEME],
    ["tenantId", input.tenantId],
    ["applicationId", input.applicationId],
    ["esignatureId", input.esignatureId],
    ["keyFingerprint", input.keyFingerprint],
    ["documentType", input.documentType],
    ["documentId", input.documentId ?? ""],
    ["contentScheme", input.contentScheme],
    ["contentHash", input.contentHash],
    ["meaning", input.meaning],
    ["signerUserId", input.signerUserId],
    ["signedAt", input.signedAt],
    ["authMethod", input.authMethod],
  ]);

// ==========================================
// REQUEST SCHEMAS (§ 4)
// ==========================================

const credentialShape = {
  authMethod: z.enum(ESIG_AUTH_METHODS),
  /** The password or the current MFA code, re-entered now (never stored, never logged). */
  credential: z.string().min(1).max(1024),
};

/** `POST /esignature/me` — create, or replace the active one. */
export const createMyEsignature = z.strictObject({
  specimenSvg: z.string().min(1).max(SPECIMEN_IMAGE_MAX_BYTES),
  ...credentialShape,
});
export type CreateMyEsignature = z.output<typeof createMyEsignature>;

/** `POST /esignature/me/revoke`. */
export const revokeMyEsignature = z.strictObject({ ...credentialShape, reason: z.string().trim().min(3).max(500) });
export type RevokeMyEsignature = z.output<typeof revokeMyEsignature>;

/** `POST /esignature/users/:userId/revoke` — the body alone, and params + body. */
export const revokeUserEsignatureBody = z.strictObject({ reason: z.string().trim().min(3).max(500) });
export const revokeUserEsignature = z.strictObject({ userId: uuid(), reason: z.string().trim().min(3).max(500) });
export type RevokeUserEsignature = z.output<typeof revokeUserEsignature>;

/** `POST /calibration-records/:calibrationRecordId/esignatures` — the body alone, and params + body. */
export const applyRecordEsignatureBody = z.strictObject({ meaning: z.enum(CALREC_ESIG_MEANINGS), ...credentialShape });
export const applyRecordEsignature = z.strictObject({ calibrationRecordId: uuid(), meaning: z.enum(CALREC_ESIG_MEANINGS), ...credentialShape });
export type ApplyRecordEsignature = z.output<typeof applyRecordEsignature>;

/** `POST /certificates/:certificateId/esignatures` — the body alone, and params + body. */
export const applyCertificateEsignatureBody = z.strictObject({ meaning: z.enum(CERT_ESIG_MEANINGS), ...credentialShape });
export const applyCertificateEsignature = z.strictObject({ certificateId: uuid(), meaning: z.enum(CERT_ESIG_MEANINGS), ...credentialShape });
export type ApplyCertificateEsignature = z.output<typeof applyCertificateEsignature>;

/** `GET /certificates/:certificateId/esignatures`. */
export const certificateEsignaturesParams = z.strictObject({ certificateId: uuid() });

/** `GET /calibration-records/:calibrationRecordId/esignatures`. */
export const recordEsignaturesParams = z.strictObject({ calibrationRecordId: uuid() });

/** `POST /esignature/documents` — a file signed by its hash; the file is never uploaded. */
export const signDocument = z.strictObject({
  title: z.string().trim().min(1).max(255),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  meaning: z.enum(ESIG_MEANINGS),
  ...credentialShape,
});
export type SignDocument = z.output<typeof signDocument>;

/** `GET /esignature/me/applications` — paged. */
export const myApplicationsQuery = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type MyApplicationsQuery = z.output<typeof myApplicationsQuery>;

/**
 * `GET /public/esignatures/:applicationId?token=` — LOOSE on purpose: a malformed id or token is the
 * same 404 as an unknown one, so the shape is checked by the service, not refused as a 400.
 */
export const publicEsignatureQuery = z.strictObject({
  applicationId: z.string().max(64),
  token: z.string().max(128).optional(),
});
export type PublicEsignatureQuery = z.output<typeof publicEsignatureQuery>;

// ==========================================
// ANSWERS — the OpenAPI and the frontend types read these
// ==========================================

const signer = z.strictObject({ name: z.string(), role: z.string().nullable(), organisation: z.string().nullable() });

/** An e-signature as its owner sees it: never a key's private half. */
export const myEsignatureView = z.strictObject({
  id: z.guid(),
  version: z.number().int(),
  status: z.enum(ESIG_STATUSES),
  specimenSvg: z.string(),
  keyFingerprint: z.string(),
  createdAt: z.iso.datetime(),
  supersededAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});

/** `GET /esignature/me`: the active one, or null, and every earlier version (no specimen keys). */
export const myEsignatureState = z.strictObject({
  active: myEsignatureView.nullable(),
  history: z.array(myEsignatureView),
});

/** An application as the staff routes answer it: never the signer's id, address, agent or the token. */
export const esignatureApplicationView = z.strictObject({
  id: z.guid(),
  documentType: z.enum(ESIG_DOCUMENT_TYPES),
  documentId: z.guid().nullable(),
  documentTitle: z.string(),
  meaning: z.enum(ESIG_MEANINGS),
  signer,
  specimenSvg: z.string(),
  keyFingerprint: z.string(),
  contentScheme: z.enum(ESIG_CONTENT_SCHEMES),
  contentHash: z.string(),
  authMethod: z.enum(ESIG_AUTH_METHODS),
  signedAt: z.iso.datetime(),
  verifyUrl: z.string(),
  /** The content recomputed now — null for a `document` (the server has no file). */
  integrity: z.enum(ESIG_INTEGRITY_STATES).nullable(),
});

/** One explanation, in both public languages. */
const bilingual = z.strictObject({ id: z.string(), en: z.string() });

/** The public verdict (§ 4): exactly these members, nothing else. */
export const publicEsignatureVerdict = z.strictObject({
  verdict: z.enum(ESIG_VERDICTS),
  explanation: bilingual,
  esignatureState: z.enum(ESIG_STATUSES),
  esignatureStateAt: z.string().nullable(),
  documentState: z.enum(ESIG_DOCUMENT_STATES).nullable(),
  documentStateAt: z.string().nullable(),
  signedAt: z.iso.datetime(),
  meaning: z.enum(ESIG_MEANINGS),
  signer,
  specimenSvg: z.string(),
  keyFingerprint: z.string(),
  publicKeyPem: z.string(),
  organisation: z.strictObject({ name: z.string().nullable() }),
  documentType: z.enum(ESIG_DOCUMENT_TYPES),
  documentTitle: z.string(),
  contentScheme: z.enum(ESIG_CONTENT_SCHEMES),
  contentHash: z.string(),
  /** `[name, value]` pairs for a record (two strings each; canonicalJsonOfPairs checks the order), null for a document. */
  canonicalContent: z.array(z.array(z.string()).length(2)).nullable(),
  summary: z
    .strictObject({
      deviceName: z.string().nullable(),
      brand: z.string().nullable(),
      model: z.string().nullable(),
      serialNumber: z.string().nullable(),
      calibrationDate: z.string().nullable(),
      dueDate: z.string().nullable(),
      isCompliant: z.boolean().nullable(),
    })
    .nullable(),
});
export type PublicEsignatureVerdict = z.output<typeof publicEsignatureVerdict>;

/**
 * An e-signature as the certificate's full public verdict and its renderer show it: who, what it
 * means, when, the specimen and the link to its own verification. Never an id or the token beyond the link.
 */
export const certificateEsignatureMark = z.strictObject({
  meaning: z.enum(ESIG_MEANINGS),
  name: z.string(),
  role: z.string().nullable(),
  organisation: z.string().nullable(),
  signedAt: z.iso.datetime(),
  specimenSvg: z.string(),
  verifyUrl: z.string(),
});
export type CertificateEsignatureMark = z.output<typeof certificateEsignatureMark>;