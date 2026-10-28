/**
 * P24-02h — the device rows' own calibration dates (`trx_inventory.tgl_kalibrasi`), decided by the
 * owner on 2026-10-28 (UD-8): the date the operator calibrated the device; the interval is set per
 * request or standard, so no due date is derived. `planInventoryDates` is pure: every branch is
 * driven here; the SQL runs on PostgreSQL 18 in upstreamTransform.p2402f.live.
 */
import {
  INVENTORY_DATE_SOURCE,
  planInventoryDates,
  type InventoryDateInput,
  type StagedInventoryDate,
} from "../../../services/upstreamImport/transform/calibrations";

const TENANT = "a2402800-0000-4000-8000-0000000000a1";
const KEY = "a2402800-0000-4000-8000-000000000001";
const DEVICE = "a2402800-0000-4000-8000-0000000000d1";
const FACILITY = "a2402800-0000-4000-8000-0000000000f1";
const EXISTING = "a2402800-0000-4000-8000-0000000000e1";

const row = (legacyId: string, raw: string, extra: Partial<StagedInventoryDate> = {}): StagedInventoryDate => ({
  sourceRowNumber: legacyId,
  legacyId,
  raw,
  room: null,
  rowHash: `h-${raw}`,
  targetId: null,
  mappedHash: null,
  targetPresent: false,
  targetClosed: false,
  ...extra,
});

const input = (rows: StagedInventoryDate[], extra: Partial<InventoryDateInput> = {}): InventoryDateInput => {
  let n = 0;
  return {
    rows,
    tenantId: TENANT,
    tenantName: "Penyedia Sintetis",
    today: "2026-10-28",
    devices: new Map([
      ["1", { id: DEVICE, facilityId: FACILITY }],
      ["2", { id: DEVICE, facilityId: FACILITY }],
    ]),
    effective: new Map(),
    keyId: KEY,
    newId: () => `new-${String((n += 1))}`,
    ...extra,
  };
};

describe("P24-02h the device's own calibration date", () => {
  it("is its own accounted column source: id_map and quarantine name `tgl_kalibrasi`", () => {
    expect(INVENTORY_DATE_SOURCE).toBe("tgl_kalibrasi");
  });

  it("quarantines a device that was not imported, a date that is no calendar day, and a future date", () => {
    const plan = planInventoryDates(input([row("9", "2025-01-01"), row("1", "2025-02-30"), row("2", "2026-10-29")]));
    expect(plan.insert).toEqual([]);
    expect(plan.mappings).toEqual([]);
    expect(plan.quarantine).toEqual([
      { sourceTable: "tgl_kalibrasi", sourceRowNumber: "1", legacyId: "1", reason: "value_out_of_range" },
      { sourceTable: "tgl_kalibrasi", sourceRowNumber: "2", legacyId: "2", reason: "future_calibration_date" },
      { sourceTable: "tgl_kalibrasi", sourceRowNumber: "9", legacyId: "9", reason: "no_device" },
    ]);
  });

  it("a new date is an external_date record by the import key, the device's room, no person and no due date", () => {
    const plan = planInventoryDates(input([row("1", "2025-04-01", { room: "  ICU  " })]));
    expect(plan.insert).toEqual([
      {
        id: "new-1",
        sourceRowNumber: "1",
        deviceId: DEVICE,
        facilityId: FACILITY,
        calibrationDate: "2025-04-01",
        performedBy: null,
        apiKeyId: KEY,
        roomSnapshot: "ICU",
        performerSnapshot: { name: "Upstream import", role: "import", organisation: "Penyedia Sintetis", source: "upstream-import" },
        supersedesId: null,
      },
    ]);
    expect(plan.mappings).toEqual([
      {
        sourceTable: "tgl_kalibrasi",
        legacyId: "1",
        targetTable: "calibration_records",
        targetId: "new-1",
        tenantId: TENANT,
        clientFacilityId: FACILITY,
        rowHash: "h-2025-04-01",
        sourceValues: null,
      },
    ]);
  });

  it("a timestamp keeps its day", () => {
    const plan = planInventoryDates(input([row("1", "2025-04-01 00:00:00")]));
    expect(plan.insert.map((r) => r.calibrationDate)).toEqual(["2025-04-01"]);
  });

  it("one calibration is one record: a date the device already has an effective record for maps onto it", () => {
    const plan = planInventoryDates(input([row("1", "2025-04-01")], { effective: new Map([[`${DEVICE}|2025-04-01`, EXISTING]]) }));
    expect(plan.insert).toEqual([]);
    expect(plan.mappings.map((m) => [m.sourceTable, m.legacyId, m.targetId])).toEqual([["tgl_kalibrasi", "1", EXISTING]]);
  });

  it("an unchanged date, or a record the operator voided or corrected, is left alone", () => {
    const unchanged = row("1", "2025-04-01", { targetId: EXISTING, targetPresent: true, mappedHash: "h-2025-04-01" });
    const closed = row("2", "2025-05-01", { targetId: EXISTING, targetPresent: true, mappedHash: "h-old", targetClosed: true });
    const plan = planInventoryDates(input([unchanged, closed]));
    expect(plan).toEqual({ insert: [], mappings: [], quarantine: [], needsKey: 0 });
  });

  it("a changed date is a correction of the record it mapped to", () => {
    const changed = row("1", "2025-04-03", { targetId: EXISTING, targetPresent: true, mappedHash: "h-2025-04-01" });
    const plan = planInventoryDates(input([changed], { effective: new Map([[`${DEVICE}|2025-04-03`, "other"]]) }));
    expect(plan.insert.map((r) => [r.calibrationDate, r.supersedesId])).toEqual([["2025-04-03", EXISTING]]);
    expect(plan.mappings.map((m) => m.targetId)).toEqual(["new-1"]);
  });

  it("without a usable import key, a date that needs a record is counted, never written", () => {
    const plan = planInventoryDates(input([row("1", "2025-04-01")], { keyId: null }));
    expect(plan).toEqual({ insert: [], mappings: [], quarantine: [], needsKey: 1 });
  });

  it("a mapped same-day date needs no key", () => {
    const plan = planInventoryDates(input([row("1", "2025-04-01")], { keyId: null, effective: new Map([[`${DEVICE}|2025-04-01`, EXISTING]]) }));
    expect(plan.needsKey).toBe(0);
    expect(plan.mappings.map((m) => m.targetId)).toEqual([EXISTING]);
  });
});
