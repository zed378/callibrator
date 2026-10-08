/**
 * P21-04 — the IPM report's contracts (P19-06 spec § 5, § 6, § 9, § 10; P19-02 spec § 7.2, § 11).
 *
 * The canonical payload is pinned to strings WRITTEN BY HAND from the definition of scheme
 * `ipm-report-v1` (spec § 6) — not generated from the function (CLAUDE.md § Evidence): a key
 * reordering, a dropped field, a changed decimal form or a lost NFC step fails it. Synthetic data only.
 */
import {
  IPM_REPORT_NUMBER,
  IPM_REPORT_SCHEME,
  IPM_SIGNATURE_REFUSALS,
  IPM_VERIFY_TOKEN,
  canonicalIpmReportPayload,
  ipmReportDocumentQuery,
  ipmReportNumber,
  ipmReportPayloadOfDocument,
  ipmReportReadOrder,
  ipmSignature,
  ipmSignatureBody,
  ipmVerifyQuery,
  type IpmReportDocumentLike,
  type IpmReportPayloadInput,
  type IpmReportResult,
} from "../src/ipmReport";
import {
  DEFAULT_TIME_ZONE,
  IPM_DUE_STATES,
  compactDay,
  computeIpmDue,
  isTimeZone,
  missingRequiredItems,
  zonedDay,
  type AnsweredResult,
  type RequirableItem,
} from "../src/inspectionValues";
import { IPM_DUE_FILTERS, ipmDueQuery, ipmSessionSubmit, ipmSessionSubmitBody, ipmSessionVoid, ipmSessionVoidBody } from "../src/inspectionSessions";

const S1 = "5e550000-0000-4000-8000-0000000000f1";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const V1 = "7e7e7e7e-0000-4000-8000-000000000003";
const B64 = "b".repeat(64);

const row = (over: Partial<IpmReportResult>): IpmReportResult => ({
  section: "function",
  inputKind: "tri_state",
  label: "Synthetic power-on check",
  templateItemId: "7e7e0000-0000-4000-8000-0000000000a4",
  adHoc: false,
  unit: null,
  symbol: null,
  setting: null,
  reference: null,
  limitText: null,
  outcome: "pass",
  cleanliness: null,
  measuredValue: null,
  measuredValue1: null,
  measuredValue2: null,
  textValue: null,
  rawValue: null,
  computedOutcome: null,
  outcomeSource: "technician",
  warnFlag: false,
  disagreementFlag: false,
  sortOrder: 1,
  id: "r2",
  ...over,
});

const ENVIRONMENT = row({
  section: "environment",
  inputKind: "measured",
  label: "Synthetic room temperature",
  templateItemId: "7e7e0000-0000-4000-8000-0000000000a5",
  unit: "°C",
  outcome: null,
  outcomeSource: null,
  measuredValue: "24.50",
  id: "r1",
});

const ROOT: IpmReportPayloadInput = {
  reportNumber: "IPM-F-0001-20261008-003",
  sessionId: S1,
  supersedesReportNumber: null,
  issuer: { name: "Lab Sintetis", email: "lab@example.test", phone: null, address: "Jl. Sintetis 1", city: "Kota", state: null, zipCode: null, country: "ID", website: null },
  facility: { id: F1, name: "Facility One", code: "F-0001", kind: "hospital", address: null },
  device: {
    name: "Alat sintetis 1",
    manufacturer: null,
    model: null,
    serialNumber: "SN-1",
    qrCode: "TST000001",
    deviceTypeId: null,
    deviceTypeName: null,
    lastCalibrationDate: "2026-01-15",
    nextCalibrationDate: null,
  },
  room: "Ruang 1",
  floor: "2",
  visitNumber: 1,
  legacyVisitNumber: null,
  performedAt: "2026-10-08T02:00:00.000Z",
  submittedAt: "2026-10-08T03:00:00.000Z",
  timeZone: "Asia/Jakarta",
  checklist: { templateVersionId: V1, versionNumber: 2, contentHash: B64 },
  // Given out of order: the payload prints environment before function.
  results: [row({}), ENVIRONMENT],
  inspectionOutcome: "pass",
  maintenanceOutcome: "pass",
  recommendation: "fit_for_use",
  notes: null,
  performer: { name: "Teknisi Sintetis", role: "TECHNICIAN", organisation: "Lab Sintetis" },
  capturedOffline: false,
  imported: false,
};

/** Written by hand from spec § 6's key list. */
const ROOT_PAYLOAD =
  '{"scheme":"ipm-report-v1","reportNumber":"IPM-F-0001-20261008-003","sessionId":"5e550000-0000-4000-8000-0000000000f1",' +
  '"supersedesReportNumber":null,' +
  '"issuer":{"name":"Lab Sintetis","email":"lab@example.test","phone":null,"address":"Jl. Sintetis 1","city":"Kota","state":null,"zipCode":null,"country":"ID","website":null},' +
  '"facility":{"id":"f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1","name":"Facility One","code":"F-0001","kind":"hospital","address":null},' +
  '"device":{"name":"Alat sintetis 1","manufacturer":null,"model":null,"serialNumber":"SN-1","qrCode":"TST000001","deviceTypeId":null,"deviceTypeName":null,"lastCalibrationDate":"2026-01-15","nextCalibrationDate":null},' +
  '"room":"Ruang 1","floor":"2","visitNumber":1,"legacyVisitNumber":null,"performedAt":"2026-10-08T02:00:00.000Z","submittedAt":"2026-10-08T03:00:00.000Z","timeZone":"Asia/Jakarta",' +
  `"checklist":{"templateVersionId":"7e7e7e7e-0000-4000-8000-000000000003","versionNumber":2,"contentHash":"${B64}"},` +
  '"results":[' +
  '{"section":"environment","inputKind":"measured","label":"Synthetic room temperature","templateItemId":"7e7e0000-0000-4000-8000-0000000000a5","adHoc":false,"unit":"°C","symbol":null,"setting":null,"reference":null,"limitText":null,"outcome":null,"cleanliness":null,"measuredValue":"24.50","measuredValue1":null,"measuredValue2":null,"textValue":null,"rawValue":null,"computedOutcome":null,"outcomeSource":null,"warnFlag":false,"disagreementFlag":false},' +
  '{"section":"function","inputKind":"tri_state","label":"Synthetic power-on check","templateItemId":"7e7e0000-0000-4000-8000-0000000000a4","adHoc":false,"unit":null,"symbol":null,"setting":null,"reference":null,"limitText":null,"outcome":"pass","cleanliness":null,"measuredValue":null,"measuredValue1":null,"measuredValue2":null,"textValue":null,"rawValue":null,"computedOutcome":null,"outcomeSource":"technician","warnFlag":false,"disagreementFlag":false}' +
  '],' +
  '"inspectionOutcome":"pass","maintenanceOutcome":"pass","recommendation":"fit_for_use","notes":null,' +
  '"performer":{"name":"Teknisi Sintetis","role":"TECHNICIAN","organisation":"Lab Sintetis"},"capturedOffline":false,"imported":false}';

describe("P21-04 — canonicalIpmReportPayload (scheme ipm-report-v1)", () => {
  it("prints a root report exactly as the definition says (fixed key order, read order, nulls kept, decimals as strings)", () => {
    expect(IPM_REPORT_SCHEME).toBe("ipm-report-v1");
    expect(canonicalIpmReportPayload(ROOT)).toBe(ROOT_PAYLOAD);
  });

  it("does not depend on the input's key order", () => {
    const reordered = Object.fromEntries(Object.entries(ROOT).reverse()) as unknown as IpmReportPayloadInput;
    const issuer = Object.fromEntries(Object.entries(ROOT.issuer).reverse()) as unknown as IpmReportPayloadInput["issuer"];
    expect(canonicalIpmReportPayload({ ...reordered, issuer })).toBe(ROOT_PAYLOAD);
  });

  it("an imported correction: the import marker, the supersession, an ad-hoc row, and every text NFC-normalised", () => {
    const decomposed = "Catétan";
    const payload = canonicalIpmReportPayload({
      ...ROOT,
      supersedesReportNumber: "IPM-F-0001-20261008-001",
      legacyVisitNumber: 4,
      checklist: { imported: true },
      results: [
        row({
          section: "performance",
          inputKind: "setting_measured_reference",
          label: decomposed,
          templateItemId: null,
          adHoc: true,
          setting: "120",
          reference: "± 3",
          limitText: "± 3",
          measuredValue1: "119.0",
          measuredValue2: "121.5",
          rawValue: decomposed,
          textValue: decomposed,
          symbol: decomposed,
          unit: "mmHg",
          computedOutcome: "pass",
          id: "r9",
        }),
      ],
      notes: decomposed,
      room: decomposed,
      floor: null,
      performer: { name: decomposed, role: null, organisation: null },
      capturedOffline: true,
      imported: true,
    });
    expect(payload).toContain('"supersedesReportNumber":"IPM-F-0001-20261008-001"');
    expect(payload).toContain('"legacyVisitNumber":4');
    expect(payload).toContain('"checklist":{"imported":true}');
    expect(payload).toContain(
      '{"section":"performance","inputKind":"setting_measured_reference","label":"Catétan","templateItemId":null,"adHoc":true,"unit":"mmHg","symbol":"Catétan","setting":"120","reference":"± 3","limitText":"± 3","outcome":"pass","cleanliness":null,"measuredValue":null,"measuredValue1":"119.0","measuredValue2":"121.5","textValue":"Catétan","rawValue":"Catétan","computedOutcome":"pass","outcomeSource":"technician","warnFlag":false,"disagreementFlag":false}',
    );
    expect(payload).toContain('"notes":"Catétan"');
    expect(payload).toContain('"room":"Catétan","floor":null');
    expect(payload).toContain('"performer":{"name":"Catétan","role":null,"organisation":null},"capturedOffline":true,"imported":true}');
    expect(payload).not.toContain("é");
  });

  it("a member a JavaScript caller left out is written as null, never dropped", () => {
    const loose = JSON.parse(JSON.stringify(ROOT)) as Record<string, unknown>;
    delete loose["supersedesReportNumber"];
    delete loose["legacyVisitNumber"];
    delete loose["notes"];
    expect(canonicalIpmReportPayload(loose as unknown as IpmReportPayloadInput)).toBe(ROOT_PAYLOAD);
  });

  it("reads results in section order, then sort order, then id", () => {
    const ordered = ipmReportReadOrder([
      row({ section: "function", sortOrder: 2, id: "b" }),
      row({ section: "function", sortOrder: 1, id: "z" }),
      row({ section: "environment", sortOrder: 9, id: "y" }),
      row({ section: "function", sortOrder: 2, id: "a" }),
      row({ section: "function", sortOrder: 2, id: "a" }),
    ]);
    expect(ordered.map((r) => `${r.section}:${String(r.sortOrder)}:${r.id}`)).toEqual([
      "environment:9:y",
      "function:1:z",
      "function:2:a",
      "function:2:a",
      "function:2:b",
    ]);
    const tie = (id: string): IpmReportResult => row({ sortOrder: 1, id });
    expect(ipmReportReadOrder([tie("a"), tie("b")]).map((r) => r.id)).toEqual(["a", "b"]);
    expect(ipmReportReadOrder([tie("b"), tie("a")]).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("P21-04 — report numbers, tokens and codes", () => {
  it("formats per facility and day, zero-padded to three digits and widening past 999", () => {
    expect(ipmReportNumber("F-0001", "20261008", 3)).toBe("IPM-F-0001-20261008-003");
    expect(ipmReportNumber("SELF", "20261008", 1000)).toBe("IPM-SELF-20261008-1000");
    expect(IPM_REPORT_NUMBER.test("IPM-F-0001-20261008-003")).toBe(true);
    expect(IPM_REPORT_NUMBER.test("IPM-F-0001-2026108-003")).toBe(false);
    expect(IPM_VERIFY_TOKEN.test("q3kZ0x9VbN2mP4rT6wY8aC1dE3fG5hJ7")).toBe(true);
    expect(IPM_VERIFY_TOKEN.test("short")).toBe(false);
    expect(IPM_SIGNATURE_REFUSALS).toEqual(["IPM_SIGNATURE_NOT_PERFORMER", "IPM_COUNTERSIGN_SOD", "IPM_COUNTERSIGN_ROLE", "IPM_COUNTERSIGN_FACILITY"]);
  });
});

describe("P21-04 — ipmReportPayloadOfDocument (the browser's recomputation)", () => {
  const document = (over: Partial<IpmReportDocumentLike> = {}): IpmReportDocumentLike => ({
    sessionId: S1,
    reportNumber: ROOT.reportNumber,
    lineage: { supersedesReportNumber: null },
    issuer: ROOT.issuer,
    facility: ROOT.facility,
    device: ROOT.device,
    room: ROOT.room,
    floor: ROOT.floor,
    visitNumber: 1,
    legacyVisitNumber: null,
    performedAt: ROOT.performedAt,
    submittedAt: ROOT.submittedAt,
    timeZone: "Asia/Jakarta",
    checklist: { templateVersionId: V1, versionNumber: 2, contentHash: B64 },
    sections: [
      { section: "environment", items: [ENVIRONMENT] },
      { section: "function", items: [row({})] },
    ],
    inspectionOutcome: "pass",
    maintenanceOutcome: "pass",
    recommendation: "fit_for_use",
    notes: null,
    performer: ROOT.performer,
    flags: { capturedOffline: false, imported: false },
    ...over,
  });

  it("rebuilds the very payload the server hashed", () => {
    const input = ipmReportPayloadOfDocument(document()) as IpmReportPayloadInput;
    expect(canonicalIpmReportPayload(input)).toBe(ROOT_PAYLOAD);
  });

  it("an imported document keeps the import marker", () => {
    const input = ipmReportPayloadOfDocument(document({ checklist: { imported: true }, flags: { capturedOffline: false, imported: true } })) as IpmReportPayloadInput;
    expect(input.checklist).toEqual({ imported: true });
    expect(input.imported).toBe(true);
  });

  it.each([
    ["no report number", { reportNumber: null }],
    ["no visit number", { visitNumber: null }],
    ["no submit time", { submittedAt: null }],
  ] as const)("a preview (%s) has nothing to verify", (_label, over) => {
    expect(ipmReportPayloadOfDocument(document(over))).toBeNull();
  });
});

describe("P21-04 — request schemas", () => {
  it("the signature body is strict, needs the meaning acknowledged and a credential", () => {
    const body = { kind: "performer", authMethod: "password", authPayload: "secret", meaningAcknowledged: true };
    expect(ipmSignatureBody.safeParse(body).success).toBe(true);
    expect(ipmSignature.safeParse({ ...body, sessionId: S1 }).success).toBe(true);
    expect(ipmSignatureBody.safeParse({ ...body, meaningAcknowledged: false }).success).toBe(false);
    expect(ipmSignatureBody.safeParse({ ...body, authPayload: "" }).success).toBe(false);
    expect(ipmSignatureBody.safeParse({ ...body, signerId: S1 }).success).toBe(false);
    expect(ipmSignatureBody.safeParse({ ...body, kind: "witness" }).success).toBe(false);
  });

  it("the document query takes render and lang only", () => {
    expect(ipmReportDocumentQuery.parse({ sessionId: S1, render: "pdf", lang: "id" })).toEqual({ sessionId: S1, render: "pdf", lang: "id" });
    expect(ipmReportDocumentQuery.safeParse({ sessionId: S1, render: "docx" }).success).toBe(false);
  });

  it("the verification query is loose on the number's shape (the service answers 404), bounded in length", () => {
    expect(ipmVerifyQuery.safeParse({ reportNumber: "anything" }).success).toBe(true);
    expect(ipmVerifyQuery.safeParse({ reportNumber: "x".repeat(65) }).success).toBe(false);
  });

  it("submit takes the revision only; void a reason; due its filters", () => {
    expect(ipmSessionSubmit.parse({ sessionId: S1, revision: "3" })).toEqual({ sessionId: S1, revision: 3 });
    expect(ipmSessionSubmitBody.safeParse({ revision: 1, reportNumber: "IPM-X-20260101-001" }).success).toBe(false);
    expect(ipmSessionSubmitBody.safeParse({ revision: 1, verificationToken: "x" }).success).toBe(false);
    expect(ipmSessionVoid.parse({ sessionId: S1, reason: "  Duplicate visit  " })).toEqual({ sessionId: S1, reason: "Duplicate visit" });
    expect(ipmSessionVoidBody.safeParse({ reason: "x" }).success).toBe(false);
    expect(ipmDueQuery.parse({})).toEqual({ page: 1, limit: 25, state: "due" });
    expect(IPM_DUE_FILTERS).toEqual(["due", "never_inspected", "all_scheduled"]);
    expect(ipmDueQuery.safeParse({ state: "late" }).success).toBe(false);
  });
});

describe("P21-04 — missingRequiredItems (the submit's completeness)", () => {
  const item = (id: string, inputKind: RequirableItem["inputKind"], section: RequirableItem["section"], required = true): RequirableItem => ({
    id,
    section,
    label: `Item ${id}`,
    inputKind,
    required,
  });
  const result = (templateItemId: string | null, over: Partial<AnsweredResult> = {}): AnsweredResult => ({
    templateItemId,
    outcome: null,
    measuredValue: null,
    measuredValue1: null,
    textValue: null,
    ...over,
  });

  it.each([
    ["check", "tools_used", { outcome: "done" }],
    ["tri_state", "function", { outcome: "pass" }],
    ["condition_clean", "physical", { outcome: "good", cleanliness: "clean" }],
    ["measured", "environment", { measuredValue: "21" }],
    ["measured", "electrical_supply", { outcome: "not_applicable" }],
    ["measured_with_limit", "electrical_safety", { measuredValue: "50" }],
    ["setting_measured_reference", "performance", { measuredValue1: "120", outcome: "pass" }],
    ["text", "function", { textValue: "ok" }],
  ] as const)("a %s item (%s) is answered by %j", (kind, section, over) => {
    expect(missingRequiredItems([item("a", kind, section)], [result("a", over)])).toEqual([]);
  });

  it.each([
    ["check", "tools_used", {}],
    ["condition_clean", "physical", { outcome: "good" }],
    ["condition_clean", "physical", { outcome: "good", cleanliness: null }],
    ["measured", "environment", { outcome: "pass" }],
    ["setting_measured_reference", "performance", { measuredValue1: "120" }],
    ["setting_measured_reference", "performance", { outcome: "pass" }],
    ["text", "function", {}],
  ] as const)("a %s item (%s) with %j is missing", (kind, section, over) => {
    expect(missingRequiredItems([item("a", kind, section)], [result("a", over)])).toEqual([{ section, label: "Item a" }]);
  });

  it("an item with no result is missing; an optional one never; ad-hoc rows answer nothing; print order by section", () => {
    const items = [item("f", "tri_state", "function"), item("e", "measured", "environment"), item("o", "tri_state", "function", false)];
    expect(missingRequiredItems(items, [result(null, { outcome: "pass" })])).toEqual([
      { section: "environment", label: "Item e" },
      { section: "function", label: "Item f" },
    ]);
  });
});

describe("P21-04 — computeIpmDue and the zone helpers (ADR-126 § 6)", () => {
  const today = new Date("2026-10-15T05:00:00Z");
  const base = { status: "active", intervalOverride: null, tenantInterval: 1, lastEffectivePerformedAt: null, today, timeZone: DEFAULT_TIME_ZONE };

  it("zonedDay: 23:30 UTC on the last day of a month is the next month in Jakarta", () => {
    expect(zonedDay(new Date("2026-09-30T23:30:00Z"), "Asia/Jakarta")).toEqual({ year: 2026, month: 10, day: 1 });
    expect(zonedDay(new Date("2026-09-30T23:30:00Z"), "UTC")).toEqual({ year: 2026, month: 9, day: 30 });
    expect(compactDay({ year: 2026, month: 1, day: 5 })).toBe("20260105");
    expect([isTimeZone("Asia/Jakarta"), isTimeZone("Mars/Olympus")]).toEqual([true, false]);
    expect(IPM_DUE_STATES).toEqual(["not_scheduled", "never_inspected", "due", "ok"]);
  });

  it.each([
    ["a deleted device", { deleted: true }],
    ["a retired device", { status: "retired" }],
    ["an inactive device", { status: "inactive" }],
    ["interval 0 on the device (not under IPM)", { intervalOverride: 0 }],
    ["no interval anywhere", { tenantInterval: null }],
  ] as const)("%s is not scheduled", (_label, over) => {
    expect(computeIpmDue({ ...base, ...over })).toEqual({ state: "not_scheduled" });
  });

  it("never inspected under a schedule counts as due", () => {
    expect(computeIpmDue({ ...base, status: null })).toEqual({ state: "never_inspected", intervalMonths: 1 });
  });

  it("due in the month of the last effective IPM + the interval (tenant zone), ok before it; the device's interval wins", () => {
    // 2026-09-30 23:30 UTC is 1 October in Jakarta: + 1 month = November → ok in October.
    const lastAtMidnight = new Date("2026-09-30T23:30:00Z");
    expect(computeIpmDue({ ...base, lastEffectivePerformedAt: lastAtMidnight })).toEqual({
      state: "ok",
      dueMonth: "2026-11",
      lastPerformedAt: "2026-09-30T23:30:00.000Z",
      intervalMonths: 1,
    });
    // In UTC the same instant is September: due in October → due.
    expect(computeIpmDue({ ...base, lastEffectivePerformedAt: lastAtMidnight, timeZone: "UTC" })).toMatchObject({ state: "due", dueMonth: "2026-10" });
    // The device's own interval (12) over the tenant's (1); a December due month crosses the year.
    expect(computeIpmDue({ ...base, intervalOverride: 12, lastEffectivePerformedAt: new Date("2025-12-10T00:00:00Z") })).toMatchObject({
      state: "ok",
      dueMonth: "2026-12",
      intervalMonths: 12,
    });
  });
});
