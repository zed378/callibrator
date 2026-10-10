/**
 * P23-02 — a SYNTHETIC issued IPM report document (P19-06 § 10.2), as the server serves it: no real
 * person, facility, device or value (the Phase 12 privacy rule). Used by the renderer's golden test,
 * the report page and the verification page.
 */
import type { components } from "@/api/typed";

type Doc = components["schemas"]["IpmReportDocument"];

const item = (over: Record<string, unknown>): Record<string, unknown> => ({
  section: "function",
  inputKind: "tri_state",
  label: "Item",
  templateItemId: "00000000-0000-4000-8000-000000000001",
  adHoc: false,
  unit: null,
  symbol: null,
  setting: null,
  reference: null,
  limitText: null,
  outcome: null,
  cleanliness: null,
  measuredValue: null,
  measuredValue1: null,
  measuredValue2: null,
  textValue: null,
  rawValue: null,
  computedOutcome: null,
  outcomeSource: null,
  warnFlag: false,
  disagreementFlag: false,
  required: true,
  ...over,
});

export const ipmReportDoc = (over: Partial<Doc> = {}): Doc => ({
  scheme: "ipm-report-v1",
  kind: "issued",
  sessionId: "5a000000-0000-4000-8000-000000000001",
  reportNumber: "IPM-SC-20261010-007",
  verifyUrl: "https://kalibrasi.example/verify/ipm/IPM-SC-20261010-007?t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  status: "submitted",
  lineage: { supersedesReportNumber: null, supersededByReportNumber: null, supersededAt: null, voidedAt: null },
  issuer: { name: "Synthetic Calibration Co", email: "lab@synthetic.example", phone: "+62 21 000", address: "Jalan Contoh 1", city: "Jakarta", state: null, zipCode: "10110", country: "Indonesia", website: null },
  facility: { id: "5c000000-0000-4000-8000-000000000001", name: "Synthetic Clinic", code: "SC", kind: "clinic", address: null },
  device: {
    name: "Synthetic infusion pump",
    manufacturer: "Synthetic Make",
    model: "SP-1",
    serialNumber: "SN-0001",
    qrCode: "QR-000123",
    deviceTypeId: null,
    deviceTypeName: "Infusion pump",
    lastCalibrationDate: "2026-03-01",
    nextCalibrationDate: "2027-03-01",
  },
  room: "ICU",
  floor: "2",
  visitNumber: 7,
  legacyVisitNumber: null,
  performedAt: "2026-10-10T02:00:00.000Z",
  submittedAt: "2026-10-10T03:00:00.000Z",
  timeZone: "Asia/Jakarta",
  checklist: { templateVersionId: "5d000000-0000-4000-8000-000000000001", versionNumber: 3, contentHash: "ab".repeat(32) },
  sections: [
    { section: "environment", items: [item({ section: "environment", inputKind: "measured", label: "Room temperature", unit: "°C", measuredValue: "22.5" })] },
    { section: "physical", items: [item({ section: "physical", inputKind: "condition_clean", label: "Main unit", outcome: "minor_damage", cleanliness: "dirty", outcomeSource: "technician" })] },
    {
      section: "electrical_safety",
      items: [item({ section: "electrical_safety", inputKind: "measured_with_limit", label: "Chassis leakage", unit: "µA", measuredValue: "45", limitText: "≤ 100 µA", outcome: "pass", computedOutcome: "pass", outcomeSource: "computed" })],
    },
    {
      section: "performance",
      items: [
        item({ section: "performance", inputKind: "setting_measured_reference", label: "Flow rate", unit: "mL/h", setting: "10 mL/h", measuredValue1: "12", measuredValue2: "10", reference: "10 ± 1", outcome: "pass", computedOutcome: "fail", outcomeSource: "technician", disagreementFlag: true }),
      ],
    },
    { section: "maintenance_task", items: [item({ section: "maintenance_task", inputKind: "text", label: "Part replaced", textValue: "Fuse" })] },
  ] as Doc["sections"],
  inspectionOutcome: "pass",
  maintenanceOutcome: "pass",
  recommendation: "needs_repair",
  notes: "Synthetic note",
  performer: { name: "Synthetic Technician", role: "HEALTHCARE TECHNICIAN", organisation: "Synthetic Calibration Co" },
  signatures: [
    { kind: "performer", name: "Synthetic Technician", role: "HEALTHCARE TECHNICIAN", organisation: "Synthetic Calibration Co", meaning: "authorship", signedAt: "2026-10-10T03:05:00.000Z", authMethod: "password", valid: true },
  ],
  countersignEnabled: true,
  integrity: { scheme: "ipm-report-v1", hash: "0123456789abcdef".repeat(4), state: "match" },
  flags: { capturedOffline: false, imported: false },
  generatedAt: "2026-10-10T04:00:00.000Z",
  ...over,
});
