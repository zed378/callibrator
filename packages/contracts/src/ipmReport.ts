/**
 * The IPM report: its number, its verification link's shapes, its canonical content and the request
 * schemas of the report document, the signatures and the public verification (P21-04; ADR-126
 * Amendment 2 and Amendment 5; spec MEMORY/specs/P19-06-ipm-report-document.md § 5, § 6, § 7,
 * § 9, § 10, § 13).
 *
 * THE CANONICAL PAYLOAD (scheme `ipm-report-v1`, § 6). One pure function, used by the backend at
 * submit (the stored `report_content_hash`) and at every read (the integrity check), and by the
 * verification page to recompute the hash in the browser. It returns a JSON string with a FIXED key
 * order — never `JSON.stringify` of a JSONB value, which PostgreSQL re-orders (ADR-107). Every
 * string is NFC-normalised (a decomposed accent typed on a phone and its composed twin hash alike);
 * `null` is written as `null`, never omitted; decimals are the exact strings the model returns.
 * A later scheme is a NEW function beside this one, never an edit of it (ADR-095's rule).
 *
 * The hash is SHA-256 of the payload's UTF-8 bytes, lower-case hex — computed by the caller
 * (`node:crypto` on the server, `crypto.subtle` in the browser): this module imports nothing but
 * `zod` and its siblings (both ends load it).
 */
import { z } from "zod";
import { uuid } from "./fields";
import {
  INSPECTION_SECTIONS,
  INSPECTION_SIGNATURE_AUTH_METHODS,
  INSPECTION_SIGNATURE_KINDS,
  type InspectionSection,
} from "./inspectionValues";

/** The one hash scheme of an IPM report today. */
export const IPM_REPORT_SCHEME = "ipm-report-v1";

/** A report number: `IPM-<facility code>-<YYYYMMDD>-<NNN>` (§ 5; the sequence widens past 999, never truncated). */
export const IPM_REPORT_NUMBER = /^IPM-[A-Z0-9._-]{1,32}-\d{8}-\d{3,6}$/;

/** A verification token: 24 random bytes as base64url, 32 characters (ADR-100). */
export const IPM_VERIFY_TOKEN = /^[A-Za-z0-9_-]{32}$/;

/**
 * The report number of the `sequence`-th report of a facility on a day (§ 5).
 *
 * @param facilityCode - the facility's code at submit (`SELF` for a self-served hospital)
 * @param localDay - the submit date in the tenant's time zone, `YYYYMMDD`
 * @param sequence - 1-based, per tenant, facility and day
 * @returns the number, the sequence zero-padded to three digits
 */
export const ipmReportNumber = (facilityCode: string, localDay: string, sequence: number): string =>
  `IPM-${facilityCode}-${localDay}-${String(sequence).padStart(3, "0")}`;

/**
 * The 403 codes of the signature route (§ 7.1, § 13): who may not sign, each with its explanation
 * in the message beside the TOP-LEVEL `code`.
 */
export const IPM_SIGNATURE_REFUSALS = Object.freeze([
  "IPM_SIGNATURE_NOT_PERFORMER",
  "IPM_COUNTERSIGN_SOD",
  "IPM_COUNTERSIGN_ROLE",
  "IPM_COUNTERSIGN_FACILITY",
] as const);
export type IpmSignatureRefusal = (typeof IPM_SIGNATURE_REFUSALS)[number];

// ==========================================
// THE CANONICAL PAYLOAD (§ 6)
// ==========================================

/** A text value of the payload. */
type Text = string | null;

/** The issuer block as printed (the tenant at submit, ADR-107's fields). */
export interface IpmReportIssuer {
  readonly name: Text;
  readonly email: Text;
  readonly phone: Text;
  readonly address: Text;
  readonly city: Text;
  readonly state: Text;
  readonly zipCode: Text;
  readonly country: Text;
  readonly website: Text;
}

/** The facility snapshot. */
export interface IpmReportFacility {
  readonly id: string;
  readonly name: string;
  readonly code: Text;
  readonly kind: Text;
  readonly address: Text;
}

/** The device snapshot (the calibration dates fix `09` L-1). */
export interface IpmReportDevice {
  readonly name: Text;
  readonly manufacturer: Text;
  readonly model: Text;
  readonly serialNumber: Text;
  readonly qrCode: Text;
  readonly deviceTypeId: Text;
  readonly deviceTypeName: Text;
  readonly lastCalibrationDate: Text;
  readonly nextCalibrationDate: Text;
}

/** One printed result row. */
export interface IpmReportResult {
  readonly section: InspectionSection;
  readonly inputKind: string;
  readonly label: string;
  readonly templateItemId: Text;
  readonly adHoc: boolean;
  readonly unit: Text;
  readonly symbol: Text;
  readonly setting: Text;
  readonly reference: Text;
  readonly limitText: Text;
  readonly outcome: Text;
  readonly cleanliness: Text;
  readonly measuredValue: Text;
  readonly measuredValue1: Text;
  readonly measuredValue2: Text;
  readonly textValue: Text;
  readonly rawValue: Text;
  readonly computedOutcome: Text;
  readonly outcomeSource: Text;
  readonly warnFlag: boolean;
  readonly disagreementFlag: boolean;
  /** Read order only (not printed, not hashed): the row's `sort_order` and id. */
  readonly sortOrder: number;
  readonly id: string;
}

/** A person as printed (the performer snapshot). */
export interface IpmReportPerson {
  readonly name: string;
  readonly role: Text;
  readonly organisation: Text;
}

/** The checklist the session pinned, or the import's marker. */
export type IpmReportChecklist =
  | { readonly templateVersionId: string; readonly versionNumber: number | null; readonly contentHash: Text }
  | { readonly imported: true };

/** Everything the report binds (§ 6): fixed at submit, never its later lifecycle. */
export interface IpmReportPayloadInput {
  readonly reportNumber: string;
  readonly sessionId: string;
  readonly supersedesReportNumber: Text;
  readonly issuer: IpmReportIssuer;
  readonly facility: IpmReportFacility;
  readonly device: IpmReportDevice;
  readonly room: Text;
  readonly floor: Text;
  readonly visitNumber: number;
  readonly legacyVisitNumber: number | null;
  /** ISO-8601 UTC with milliseconds. */
  readonly performedAt: string;
  readonly submittedAt: string;
  readonly timeZone: string;
  readonly checklist: IpmReportChecklist;
  readonly results: readonly IpmReportResult[];
  readonly inspectionOutcome: Text;
  readonly maintenanceOutcome: Text;
  readonly recommendation: Text;
  readonly notes: Text;
  readonly performer: IpmReportPerson;
  readonly capturedOffline: boolean;
  readonly imported: boolean;
}

/**
 * NFC for a text; anything that is not a string (null, or a member a JavaScript caller left out) is
 * written as `null` — a missing member never drops its key from the payload.
 */
const nfc = (value: Text): Text => (typeof value === "string" ? value.normalize("NFC") : null);

/** A non-text member: as given, or `null` when a JavaScript caller left it out. */
const v = <T>(value: T | undefined): T | null => value ?? null;

const sectionIndex = (section: string): number => (INSPECTION_SECTIONS as readonly string[]).indexOf(section);

/**
 * Results in printed order: the section order of INSPECTION_SECTIONS, then `sort_order`, then id.
 *
 * @param results - the rows, in any order
 * @returns a new array in read order
 */
export const ipmReportReadOrder = <R extends Pick<IpmReportResult, "section" | "sortOrder" | "id">>(results: readonly R[]): R[] =>
  [...results].sort((a, b) => sectionIndex(a.section) - sectionIndex(b.section) || a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const resultOf = (r: IpmReportResult): Record<string, unknown> => ({
  section: r.section,
  inputKind: r.inputKind,
  label: nfc(r.label),
  templateItemId: v(r.templateItemId),
  adHoc: v(r.adHoc),
  unit: nfc(r.unit),
  symbol: nfc(r.symbol),
  setting: nfc(r.setting),
  reference: nfc(r.reference),
  limitText: nfc(r.limitText),
  outcome: v(r.outcome),
  cleanliness: v(r.cleanliness),
  measuredValue: v(r.measuredValue),
  measuredValue1: v(r.measuredValue1),
  measuredValue2: v(r.measuredValue2),
  textValue: nfc(r.textValue),
  rawValue: nfc(r.rawValue),
  computedOutcome: v(r.computedOutcome),
  outcomeSource: v(r.outcomeSource),
  warnFlag: v(r.warnFlag),
  disagreementFlag: v(r.disagreementFlag),
});

/**
 * The canonical content of an issued IPM report (scheme `ipm-report-v1`, spec § 6).
 *
 * @param input - the fields the report binds
 * @returns the JSON string whose SHA-256 is the report's content hash
 */
export const canonicalIpmReportPayload = (input: IpmReportPayloadInput): string => {
  const { issuer, facility, device, performer, checklist } = input;
  return JSON.stringify({
    scheme: IPM_REPORT_SCHEME,
    reportNumber: input.reportNumber,
    sessionId: input.sessionId,
    supersedesReportNumber: v(input.supersedesReportNumber),
    issuer: {
      name: nfc(issuer.name),
      email: nfc(issuer.email),
      phone: nfc(issuer.phone),
      address: nfc(issuer.address),
      city: nfc(issuer.city),
      state: nfc(issuer.state),
      zipCode: nfc(issuer.zipCode),
      country: nfc(issuer.country),
      website: nfc(issuer.website),
    },
    facility: { id: facility.id, name: nfc(facility.name), code: nfc(facility.code), kind: v(facility.kind), address: nfc(facility.address) },
    device: {
      name: nfc(device.name),
      manufacturer: nfc(device.manufacturer),
      model: nfc(device.model),
      serialNumber: nfc(device.serialNumber),
      qrCode: nfc(device.qrCode),
      deviceTypeId: v(device.deviceTypeId),
      deviceTypeName: nfc(device.deviceTypeName),
      lastCalibrationDate: v(device.lastCalibrationDate),
      nextCalibrationDate: v(device.nextCalibrationDate),
    },
    room: nfc(input.room),
    floor: nfc(input.floor),
    visitNumber: input.visitNumber,
    legacyVisitNumber: v(input.legacyVisitNumber),
    performedAt: input.performedAt,
    submittedAt: input.submittedAt,
    timeZone: input.timeZone,
    checklist: "imported" in checklist
      ? { imported: true }
      : { templateVersionId: checklist.templateVersionId, versionNumber: v(checklist.versionNumber), contentHash: v(checklist.contentHash) },
    results: ipmReportReadOrder(input.results).map(resultOf),
    inspectionOutcome: v(input.inspectionOutcome),
    maintenanceOutcome: v(input.maintenanceOutcome),
    recommendation: v(input.recommendation),
    notes: nfc(input.notes),
    performer: { name: nfc(performer.name), role: nfc(performer.role), organisation: nfc(performer.organisation) },
    capturedOffline: v(input.capturedOffline),
    imported: v(input.imported),
  });
};

/** The members of a served report document (§ 10.2) the canonical payload is rebuilt from. */
export interface IpmReportDocumentLike {
  readonly sessionId: string;
  readonly reportNumber: string | null;
  readonly lineage: { readonly supersedesReportNumber: Text };
  readonly issuer: IpmReportIssuer;
  readonly facility: IpmReportFacility;
  readonly device: IpmReportDevice;
  readonly room: Text;
  readonly floor: Text;
  readonly visitNumber: number | null;
  readonly legacyVisitNumber: number | null;
  readonly performedAt: string;
  readonly submittedAt: string | null;
  readonly timeZone: string;
  readonly checklist: { readonly templateVersionId: string; readonly versionNumber: number | null; readonly contentHash: Text } | { readonly imported: true };
  readonly sections: readonly { readonly section: InspectionSection; readonly items: readonly Omit<IpmReportResult, "sortOrder" | "id">[] }[];
  readonly inspectionOutcome: Text;
  readonly maintenanceOutcome: Text;
  readonly recommendation: Text;
  readonly notes: Text;
  readonly performer: IpmReportPerson;
  readonly flags: { readonly capturedOffline: boolean; readonly imported: boolean };
}

/**
 * The canonical payload's input rebuilt from a served ISSUED document — what the verification page
 * hashes in the browser (§ 9.4), so a reader need not trust the server's `integrity.state`. The
 * document's sections are already in read order; each item takes its position as its order.
 *
 * @param doc - an issued document (`kind: "issued"`)
 * @returns the payload input, or null for a preview (it has no number, so nothing to verify)
 */
export const ipmReportPayloadOfDocument = (doc: IpmReportDocumentLike): IpmReportPayloadInput | null => {
  if (doc.reportNumber === null || doc.visitNumber === null || doc.submittedAt === null) {
    return null;
  }
  let position = 0;
  const results = doc.sections.flatMap((section) => section.items.map((item) => ({ ...item, sortOrder: (position += 1), id: "" })));
  const { issuer } = doc;
  return {
    reportNumber: doc.reportNumber,
    sessionId: doc.sessionId,
    supersedesReportNumber: doc.lineage.supersedesReportNumber,
    issuer: {
      name: issuer.name,
      email: issuer.email,
      phone: issuer.phone,
      address: issuer.address,
      city: issuer.city,
      state: issuer.state,
      zipCode: issuer.zipCode,
      country: issuer.country,
      website: issuer.website,
    },
    facility: doc.facility,
    device: doc.device,
    room: doc.room,
    floor: doc.floor,
    visitNumber: doc.visitNumber,
    legacyVisitNumber: doc.legacyVisitNumber,
    performedAt: doc.performedAt,
    submittedAt: doc.submittedAt,
    timeZone: doc.timeZone,
    checklist: "imported" in doc.checklist
      ? { imported: true }
      : { templateVersionId: doc.checklist.templateVersionId, versionNumber: doc.checklist.versionNumber, contentHash: doc.checklist.contentHash },
    results,
    inspectionOutcome: doc.inspectionOutcome,
    maintenanceOutcome: doc.maintenanceOutcome,
    recommendation: doc.recommendation,
    notes: doc.notes,
    performer: doc.performer,
    capturedOffline: doc.flags.capturedOffline,
    imported: doc.flags.imported,
  };
};

// ==========================================
// REQUEST SCHEMAS (§ 8.1, § 9.2, § 10.1)
// ==========================================

/** `GET /ipm/sessions/:sessionId/report-document` — `render` audits the read (G-R10); `lang` is recorded only. */
export const IPM_REPORT_RENDER_FORMATS = Object.freeze(["pdf", "print"] as const);
export const IPM_REPORT_LANGUAGES = Object.freeze(["id", "en"] as const);
export const ipmReportDocumentQuery = z.strictObject({
  sessionId: uuid(),
  render: z.enum(IPM_REPORT_RENDER_FORMATS).optional(),
  lang: z.enum(IPM_REPORT_LANGUAGES).optional(),
});
export type IpmReportDocumentQuery = z.output<typeof ipmReportDocumentQuery>;
/** The query alone (the OpenAPI documents it). */
export const ipmReportDocumentQueryOnly = ipmReportDocumentQuery.omit({ sessionId: true });

const signatureShape = {
  kind: z.enum(INSPECTION_SIGNATURE_KINDS),
  authMethod: z.enum(INSPECTION_SIGNATURE_AUTH_METHODS),
  /** The password or the current MFA code, re-entered now (§ 7.2; never stored, never logged). */
  authPayload: z.string().min(1).max(1024),
  /** The signer read the meaning before signing (Part 11 § 11.50). */
  meaningAcknowledged: z.literal(true),
};
/** `POST /ipm/sessions/:sessionId/signatures` — the body alone. */
export const ipmSignatureBody = z.strictObject(signatureShape);
/** `POST /ipm/sessions/:sessionId/signatures` (params + body). */
export const ipmSignature = z.strictObject({ sessionId: uuid(), ...signatureShape });
export type IpmSignature = z.output<typeof ipmSignature>;

/**
 * `GET /ipm/verify/:reportNumber?token=` — LOOSE on purpose: a malformed number or token is the
 * same 404 as an unknown one (§ 9.2), so the shape is checked by the service, not refused as a 400.
 */
export const ipmVerifyQuery = z.strictObject({
  reportNumber: z.string().max(64),
  token: z.string().max(128).optional(),
});
export type IpmVerifyQuery = z.output<typeof ipmVerifyQuery>;
