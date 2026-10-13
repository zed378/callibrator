/**
 * P24-02e — the transform's register steps (services/upstreamImport/transform/inventory.ts) over a
 * statement double: the value rules of P19-03 § 10 (QR, serial, condition, accessories, inventory
 * date, rooms, laboratories), the device plan in every branch (insert, update, skip, the four
 * quarantine reasons and the move, the registrant), and what each step sends. The same statements
 * run on PostgreSQL 18 in migrations/upstreamTransform.p2402e.live.
 *
 * Synthetic values only.
 */
import type { Transaction } from "sequelize";
import { TRANSFORM_STEPS, type StepContext } from "../../../services/upstreamImport/transform/steps";
import {
  DEVICE_SOURCE,
  FORMER_USERS,
  accessoriesOf,
  conditionOf,
  inventoryDateOf,
  planDevices,
  roomKeyOf,
  runDevices,
  runRooms,
  runVendors,
  serialOf,
  textOf,
  vendorKeyOf,
  type DeviceInput,
  type StagedDeviceRow,
} from "../../../services/upstreamImport/transform/inventory";
import { STEP_AUDITED } from "../../../services/upstreamImport/transform/auditRows";
import type { SqlQueryOptions, SqlRunner } from "../../../utils/sql.util";

const RUN = "a2402000-0000-4000-8000-0000000000f5";
const TENANT = "a2402000-0000-4000-8000-0000000000a1";
const TX = { id: "tx" } as unknown as Transaction;
const FAC_1 = "a2402000-0000-4000-8000-0000000000c1";
const FAC_2 = "a2402000-0000-4000-8000-0000000000c2";
const TYPE = "a2402000-0000-4000-8000-0000000000d1";
const USER = "a2402000-0000-4000-8000-0000000000d2";
const LAB = "a2402000-0000-4000-8000-0000000000d3";
const ROOM = "a2402000-0000-4000-8000-0000000000d4";
const OTHER = "a2402000-0000-4000-8000-0000000000d5";

interface Call {
  text: string;
  bind: readonly unknown[];
  transaction: unknown;
}

const double = (rules: [RegExp, (call: Call) => object[]][] = []): SqlRunner & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    query: (text: string, options: SqlQueryOptions) => {
      const call = { text, bind: options.bind ?? [], transaction: options.transaction };
      calls.push(call);
      const rule = rules.find(([pattern]) => pattern.test(text));
      return Promise.resolve(rule ? rule[1](call) : []);
    },
  };
};

const context = (runner: SqlRunner): StepContext => ({ runId: RUN, runner, transaction: TX, tenantId: TENANT, sourceZone: "Asia/Jakarta" });

const ids = (): (() => string) => {
  let n = 0;
  return () => `a2402000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
};

const device = (legacyId: string, row: Record<string, unknown>, values: Partial<StagedDeviceRow> = {}): StagedDeviceRow => ({
  sourceRowNumber: String(Number(legacyId) + 100),
  legacyId,
  rowHash: legacyId.padStart(64, "f"),
  targetId: null,
  decision: "new",
  targetPresent: false,
  targetDeleted: false,
  targetFacilityId: null,
  row: { id_client: 1, id_alat: 1, no_qrcode: `QR-${legacyId}`, nama_alat: `Alat ${legacyId}`, ...row },
  ...values,
});

const input = (rows: StagedDeviceRow[], extra: Partial<DeviceInput> = {}): DeviceInput => ({
  rows,
  tenantId: TENANT,
  qr: { prefix: "TST", digits: 6 },
  facilities: new Map([["1", FAC_1], ["2", FAC_2]]),
  types: new Map([["1", { id: TYPE, name: "Pompa Infus" }]]),
  users: new Map([["7", { id: USER, snapshot: { name: "Teknisi", role: "TECHNICIAN", organisation: "Penyedia" } }]]),
  formerUsers: new Map(),
  vendors: new Map([["lab sintetis", LAB]]),
  rooms: new Map([[`${FAC_1}|icu|2`, ROOM]]),
  takenQr: new Map(),
  takenSerial: new Map(),
  newId: ids(),
  ...extra,
});

describe("P24-02e the registry", () => {
  it("steps 6, 7 and 8 are built; the derived laboratories and rooms audit themselves", () => {
    expect(TRANSFORM_STEPS.find((s) => s.id === "vendors")).toMatchObject({ run: runVendors, sources: [] });
    expect(TRANSFORM_STEPS.find((s) => s.id === "warehouses")).toMatchObject({ run: runRooms, sources: [] });
    expect(TRANSFORM_STEPS.find((s) => s.id === "calibration_devices")).toMatchObject({ run: runDevices, sources: [DEVICE_SOURCE] });
    expect(DEVICE_SOURCE).toEqual({ table: "trx_inventory", legacyId: 's."id"::text' });
    expect(STEP_AUDITED.has("vendors") && STEP_AUDITED.has("warehouses") && !STEP_AUDITED.has("calibration_devices")).toBe(true);
    expect(FORMER_USERS).toBe("upstream_import.former_users");
  });
});

describe("P24-02e value rules", () => {
  it("text members: strings and numbers; anything else is absent", () => {
    expect(textOf({ a: "x", b: 7, c: true, d: null }, "a")).toBe("x");
    expect(textOf({ b: 7 }, "b")).toBe("7");
    expect(textOf({ c: true }, "c")).toBeNull();
    expect(textOf({}, "d")).toBeNull();
  });

  it("laboratory and room keys: cleaned, case-insensitive, empty is none; a floor is optional", () => {
    expect(vendorKeyOf("  Lab   Sintetis ")).toEqual({ key: "lab sintetis", name: "Lab Sintetis" });
    expect(vendorKeyOf(" ")).toBeNull();
    expect(roomKeyOf(FAC_1, " ICU ", "2")).toEqual({ key: `${FAC_1}|icu|2`, name: "ICU", floor: "2" });
    expect(roomKeyOf(FAC_1, "IGD", null)).toEqual({ key: `${FAC_1}|igd|`, name: "IGD", floor: null });
    expect(roomKeyOf(FAC_1, null, "2")).toBeNull();
  });

  it("serials: placeholders, short and dash/zero-only values are none", () => {
    expect(serialOf(" SN-0001 ")).toBe("SN-0001");
    for (const placeholder of [null, "", "-", "0", "00", "--", "000.0", "N/A", "Tidak Ada", "none", "ab"]) {
      expect(serialOf(placeholder)).toBeNull();
    }
  });

  it("condition (§ 4.4): Baik/Laik good, Tidak Baik not good, Rusak broken; empty none; anything else unknown", () => {
    expect(conditionOf("Baik")).toEqual({ condition: "good", known: true });
    expect(conditionOf(" laik ")).toEqual({ condition: "good", known: true });
    expect(conditionOf("Tidak  Baik")).toEqual({ condition: "not_good", known: true });
    expect(conditionOf("RUSAK")).toEqual({ condition: "broken", known: true });
    expect(conditionOf(null)).toEqual({ condition: null, known: true });
    expect(conditionOf("constructor")).toEqual({ condition: null, known: false });
  });

  it("accessories: Ada true, Tidak false, empty none, anything else unknown", () => {
    expect(accessoriesOf("Ada")).toEqual({ value: true, known: true });
    expect(accessoriesOf("tidak")).toEqual({ value: false, known: true });
    expect(accessoriesOf(null)).toEqual({ value: null, known: true });
    expect(accessoriesOf("Lengkap")).toEqual({ value: null, known: false });
  });

  it("inventory dates: a real day from 1990 on; a timestamp keeps its day", () => {
    expect(inventoryDateOf("2024-01-05")).toBe("2024-01-05");
    expect(inventoryDateOf("2024-01-05T08:00:00")).toBe("2024-01-05");
    expect(inventoryDateOf("1985-01-01")).toBeNull();
    expect(inventoryDateOf("2024-02-30")).toBeNull();
    expect(inventoryDateOf("05/01/2024")).toBeNull();
    expect(inventoryDateOf(null)).toBeNull();
  });
});

describe("P24-02e the device plan", () => {
  it("a new device: every column by § 10, the registrant's snapshot, the mapping with its facility", () => {
    const plan = planDevices(
      input([
        device("101", {
          id_user: 7, no_qrcode: " qr-a001 ", merk: " Merk ", type: "T-1", sn: "SN-1", nama_ruangan: "icu", lantai: "2", kondisi_alat: "Baik",
          lab_kalibrasi: "LAB  Sintetis", aksesoris: "Ada", tgl_inventory: "2024-01-05",
        }),
      ]),
    );
    expect(plan.insert).toEqual([
      {
        id: "a2402000-0000-4000-8000-000000000001", sourceRowNumber: "201", facilityId: FAC_1, name: "Alat 101", serialNumber: "SN-1", manufacturer: "Merk",
        model: "T-1", category: "Pompa Infus", status: "active", locationId: ROOM, deviceTypeId: TYPE, qrCode: "QR-A001", inventoriedOn: "2024-01-05",
        accessoriesComplete: true, condition: "good", vendorId: LAB, createdBy: USER, registrantSnapshot: { name: "Teknisi", role: "TECHNICIAN", organisation: "Penyedia" },
      },
    ]);
    expect(plan.mappings).toEqual([
      {
        sourceTable: "trx_inventory", legacyId: "101", targetTable: "calibration_devices", targetId: "a2402000-0000-4000-8000-000000000001", tenantId: TENANT,
        clientFacilityId: FAC_1, rowHash: "101".padStart(64, "f"), sourceValues: { no_qrcode: " qr-a001 " },
      },
    ]);
    expect(plan.quarantine).toEqual([]);
  });

  it("the raw values the transform changed are kept; unknown references leave the column empty", () => {
    const plan = planDevices(
      input([
        device("102", {
          id_alat: 99, id_user: 99, no_qrcode: "42", sn: "-", kondisi_alat: "Laik", aksesoris: "Lengkap", tgl_inventory: "1985-01-01",
          tgl_kalibrasi: "2025-04-01", nama_ruangan: "Lab", lab_kalibrasi: "Lab Baru",
        }),
        device("103", { id_user: 98, kondisi_alat: "Rusak", id_alat: null, nama_ruangan: null, lab_kalibrasi: null }),
        device("104", { kondisi_alat: "Bagus" }),
      ], { formerUsers: new Map([["98", 4]]) }),
    );
    expect(plan.insert.map((d) => [d.qrCode, d.deviceTypeId, d.category, d.serialNumber, d.condition, d.status, d.accessoriesComplete, d.locationId, d.vendorId])).toEqual([
      ["TST000042", null, null, null, "good", "active", null, null, null],
      ["QR-103", null, null, null, "broken", "inactive", null, null, null],
      ["QR-104", TYPE, "Pompa Infus", null, null, "active", null, null, null],
    ]);
    expect(plan.mappings.map((m) => m.sourceValues)).toEqual([
      { no_qrcode: "42", sn: "-", id_alat: "99", kondisi_alat: "Laik", aksesoris: "Lengkap", tgl_inventory: "1985-01-01", tgl_kalibrasi: "2025-04-01" },
      null,
      { kondisi_alat: "Bagus" },
    ]);
    // 98 already had number 4; 99 gets the next one. No id_user: no registrant at all.
    expect(plan.formerUsers).toEqual([{ legacyId: "99", number: 5 }]);
    expect(plan.insert.map((d) => [d.createdBy, d.registrantSnapshot])).toEqual([
      [null, { name: "Former upstream user #5", role: null, organisation: null }],
      [null, { name: "Former upstream user #4", role: null, organisation: null }],
      [null, null],
    ]);
  });

  it("ties on the numeric id are ordered by the text: the same id twice is two rows, two departed ids two numbers", () => {
    const plan = planDevices(input([device("07", { id_user: "08", no_qrcode: "QR-07B" }), device("7", { id_user: "8", no_qrcode: "QR-7A" })]));
    expect(plan.insert.map((d) => d.qrCode)).toEqual(["QR-07B", "QR-7A"]);
    expect(plan.formerUsers).toEqual([{ legacyId: "08", number: 1 }, { legacyId: "8", number: 2 }]);
  });

  it("serial duplicates inside one facility: the lowest legacy id keeps it; another facility may hold the same; a device of the register holding it wins", () => {
    const plan = planDevices(
      input(
        [
          device("12", { sn: "SN-DUP" }),
          device("11", { sn: "SN-DUP" }),
          device("13", { sn: "SN-DUP", id_client: 2 }),
          device("14", { sn: "SN-OPER" }),
        ],
        { takenSerial: new Map([[`${FAC_1}|SN-OPER`, OTHER]]) },
      ),
    );
    expect(plan.insert.map((d) => [d.sourceRowNumber, d.serialNumber])).toEqual([
      ["111", "SN-DUP"],
      ["112", null],
      ["113", "SN-DUP"],
      ["114", null],
    ]);
    expect(plan.mappings.find((m) => m.legacyId === "12")?.sourceValues).toEqual({ sn: "SN-DUP" });
  });

  it("quarantine: a facility not imported, an invalid QR or an empty name, a case collision, a QR the register holds", () => {
    const plan = planDevices(
      input(
        [
          device("1", { id_client: 9 }),
          device("2", { id_client: null }),
          device("3", { no_qrcode: "!!" }),
          device("4", { no_qrcode: null }),
          device("5", { nama_alat: "  " }),
          device("6", { no_qrcode: "QR-x" }),
          device("7", { no_qrcode: "qr-X" }),
          device("8", { no_qrcode: "QR-OPER" }),
          device("9", { no_qrcode: "1234567" }),
        ],
        { takenQr: new Map([["QR-OPER", OTHER]]) },
      ),
    );
    expect(plan.quarantine.map((q) => [q.legacyId, q.reason])).toEqual([
      ["1", "facility_not_imported"],
      ["2", "facility_not_imported"],
      ["3", "value_out_of_range"],
      ["4", "value_out_of_range"],
      ["5", "value_out_of_range"],
      ["7", "qr_case_collision"],
      ["8", "qr_in_use"],
      ["9", "value_out_of_range"],
    ]);
    expect(plan.insert.map((d) => d.qrCode)).toEqual(["QR-X"]);
  });

  it("re-runs: unchanged skipped, changed updated in place, deleted left alone, another facility quarantined as a move", () => {
    const target = (id: string, extra: Partial<StagedDeviceRow> = {}): Partial<StagedDeviceRow> => ({
      targetId: id, targetPresent: true, targetFacilityId: FAC_1, ...extra,
    });
    const plan = planDevices(
      input(
        [
          device("1", {}, target("d-1", { decision: "unchanged" })),
          device("2", { nama_alat: "Baru" }, target("d-2", { decision: "changed" })),
          device("3", {}, target("d-3", { decision: "changed", targetDeleted: true })),
          device("4", { id_client: 2 }, target("d-4", { decision: "changed" })),
          device("5", {}, { targetId: "d-gone", decision: "changed" }),
        ],
        { takenQr: new Map([["QR-1", "d-1"], ["QR-2", "d-2"]]) },
      ),
    );
    expect(plan.update.map((d) => [d.id, d.name])).toEqual([["d-2", "Baru"]]);
    expect(plan.insert.map((d) => d.qrCode)).toEqual(["QR-5"]);
    expect(plan.quarantine.map((q) => [q.legacyId, q.reason])).toEqual([["4", "facility_changed"]]);
    expect(plan.mappings.map((m) => m.legacyId)).toEqual(["2", "5"]);
  });
});

describe("P24-02e the derived steps", () => {
  it("nothing staged: no laboratory, no room, no device read", async () => {
    for (const run of [runVendors, runRooms, runDevices]) {
      const runner = double();
      await run(context(runner));
      expect(runner.calls).toHaveLength(1);
      expect(runner.calls[0]?.text).toContain("to_regclass");
    }
  });

  it("laboratories: the first spelling of each name, an existing one adopted, the rest created and audited — bound", async () => {
    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [/lab_kalibrasi' AS raw/, () => [{ raw: "Lab Sintetis" }, { raw: "lab  sintetis" }, { raw: "Lab Lain" }, { raw: " " }]],
      [/FROM vendors/, () => [{ id: LAB, key: "lab lain" }]],
    ]);
    await runVendors(context(runner));
    const read = runner.calls.find((c) => c.text.includes("FROM vendors"));
    expect(read?.bind).toEqual([TENANT, ["lab sintetis", "lab lain"]]);
    expect(read?.text).toContain("type = 'CalibrationLab' AND deleted_at IS NULL");
    const insert = runner.calls.find((c) => c.text.startsWith("INSERT INTO vendors"));
    expect(insert?.bind[0]).toBe(TENANT);
    expect(insert?.bind[2]).toEqual(["Lab Sintetis"]);
    const audit = runner.calls.find((c) => c.text.startsWith("INSERT INTO audit_logs"));
    expect(audit?.bind.slice(0, 5)).toEqual([TENANT, "system:upstream-transform", "Vendor", RUN, "vendors"]);
    expect(audit?.bind[6]).toEqual([null]);
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
  });

  it("laboratories that all exist write nothing", async () => {
    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [/lab_kalibrasi' AS raw/, () => [{ raw: "Lab Lain" }]],
      [/FROM vendors/, () => [{ id: LAB, key: "lab lain" }]],
    ]);
    await runVendors(context(runner));
    expect(runner.calls.some((c) => c.text.startsWith("INSERT"))).toBe(false);
  });

  it("rooms: per facility, an existing one adopted, the rest numbered after the tenant's last R- code and audited with their facility", async () => {
    const runner = double([
      [/to_regclass/, () => [{ present: true }]],
      [/nama_ruangan' AS room/, () => [
        { facilityId: FAC_1, room: "ICU", floor: "2" },
        { facilityId: FAC_1, room: " icu ", floor: "2" },
        { facilityId: FAC_1, room: "IGD", floor: null },
        { facilityId: FAC_2, room: "ICU", floor: "2" },
        { facilityId: FAC_2, room: null, floor: "1" },
      ]],
      [/FROM warehouses\s+WHERE tenant_id = \$1 AND kind = 'room'/, () => [{ id: ROOM, facilityId: FAC_1, name: "ICU", floor: "2" }, { id: OTHER, facilityId: FAC_1, name: "", floor: null }]],
      [/max\(substring/, () => [{ n: 7 }]],
    ]);
    await runRooms(context(runner));
    expect(runner.calls.find((c) => c.text.includes("nama_ruangan' AS room"))?.text).toContain("d.id IS NULL OR d.client_facility_id = m.target_id");
    const insert = runner.calls.find((c) => c.text.startsWith("INSERT INTO warehouses"));
    expect(insert?.bind.slice(2)).toEqual([[FAC_1, FAC_2], ["IGD", "ICU"], ["R-0008", "R-0009"], [null, "2"]]);
    const audit = runner.calls.find((c) => c.text.startsWith("INSERT INTO audit_logs"));
    expect(audit?.bind.slice(2, 5)).toEqual(["Warehouse", RUN, "warehouses"]);
    expect(audit?.bind[6]).toEqual([FAC_1, FAC_2]);
  });

  it("rooms: nothing missing writes nothing; no earlier code starts at R-0001", async () => {
    const none = double([
      [/to_regclass/, () => [{ present: true }]],
      [/nama_ruangan' AS room/, () => [{ facilityId: FAC_1, room: "ICU", floor: "2" }]],
      [/FROM warehouses\s+WHERE tenant_id = \$1 AND kind = 'room'/, () => [{ id: ROOM, facilityId: FAC_1, name: "icu", floor: "2" }]],
    ]);
    await runRooms(context(none));
    expect(none.calls.some((c) => c.text.startsWith("INSERT"))).toBe(false);
    const first = double([
      [/to_regclass/, () => [{ present: true }]],
      [/nama_ruangan' AS room/, () => [{ facilityId: FAC_1, room: "ICU", floor: null }]],
    ]);
    await runRooms(context(first));
    expect(first.calls.find((c) => c.text.startsWith("INSERT INTO warehouses"))?.bind[4]).toEqual(["R-0001"]);
  });
});

describe("P24-02e the devices step", () => {
  const staged = [
    device("101", { id_user: 7, sn: "SN-1", nama_ruangan: "ICU", lantai: "2", lab_kalibrasi: "Lab Sintetis", kondisi_alat: "Baik" }),
    device("102", { id_user: 99, no_qrcode: "!!" }),
    device("103", { id_user: 8 }, { targetId: "d-103", targetPresent: true, targetFacilityId: FAC_1, decision: "changed" }),
    device("104", { no_qrcode: null }),
    device("105", { id_user: 9 }),
    device("106", {}),
  ];
  const world = (extra: [RegExp, (call: Call) => object[]][] = []): SqlRunner & { calls: Call[] } =>
    double([
      ...extra,
      [/to_regclass/, () => [{ present: true }]],
      [/AS row/, () => staged],
      [/FROM tenant_settings/, () => [{ key: "device_qr_code_prefix", value: "TST" }, { key: "device_qr_code_digits", value: null }]],
      [/source_table = \$1 AND legacy_id/, (c) =>
        c.bind[0] === "mst_faskes" ? [{ legacyId: "1", targetId: FAC_1 }, { legacyId: "2", targetId: OTHER }]
          : c.bind[0] === "mst_alat" ? [{ legacyId: "1", targetId: TYPE }, { legacyId: "5", targetId: OTHER }]
            : [{ legacyId: "7", targetId: USER }, { legacyId: "8", targetId: OTHER }, { legacyId: "9", targetId: ROOM }]],
      [/FROM client_facilities WHERE/, () => [{ id: FAC_1 }]],
      [/FROM device_types/, () => [{ id: TYPE, name: "Pompa Infus" }]],
      [/FROM users u/, () => [
        { id: USER, firstName: "Teknisi", lastName: " ", role: "TECHNICIAN", organisation: "Penyedia" },
        { id: ROOM, firstName: " ", lastName: null, role: null, organisation: "Penyedia" },
      ]],
      [/former_users/, () => [{ legacyId: "50", number: 3 }]],
      [/FROM vendors/, () => [{ id: LAB, key: "lab sintetis" }]],
      [/FROM warehouses/, () => [{ id: ROOM, facilityId: FAC_1, name: "ICU", floor: "2" }]],
      [/qr_code AS "qrCode"/, () => [{ id: "d-103", qrCode: "QR-103" }]],
      [/serial_number AS serial/, () => [{ id: OTHER, facilityId: FAC_2, serial: "SN-1" }]],
    ]);

  it("reads every reference in the provider tenant, numbers a departed registrant, inserts and updates — every value bound", async () => {
    const runner = world();
    await runDevices(context(runner));
    const read = runner.calls.find((c) => c.text.includes("AS row"));
    expect(read?.bind).toEqual([RUN, TENANT]);
    expect(read?.text).toContain("t.client_facility_id AS \"targetFacilityId\"");
    expect(runner.calls.find((c) => c.text.includes("FROM tenant_settings"))?.bind).toEqual([TENANT, ["device_qr_code_prefix", "device_qr_code_digits"]]);
    expect(runner.calls.find((c) => c.text.includes("FROM users u"))?.bind).toEqual([TENANT, [USER, OTHER, ROOM]]);
    const former = runner.calls.find((c) => c.text.startsWith(`INSERT INTO ${FORMER_USERS}`));
    // 8 maps to a person outside the tenant: as gone as 99 — both numbered after the 3 already given.
    expect(former?.bind).toEqual([RUN, ["8", "99"], [4, 5]]);
    const insert = runner.calls.find((c) => c.text.startsWith("INSERT INTO calibration_devices"));
    expect(insert?.bind.slice(0, 2)).toEqual([RUN, TENANT]);
    expect(insert?.bind[insert.bind.length - 1]).toBe("Asia/Jakarta");
    expect(insert?.bind[13]).toEqual(["QR-101", "QR-105", "QR-106"]);
    expect(insert?.bind[19]).toEqual([
      JSON.stringify({ name: "Teknisi", role: "TECHNICIAN", organisation: "Penyedia" }),
      JSON.stringify({ name: "Unnamed user", role: null, organisation: "Penyedia" }),
      null,
    ]);
    expect(insert?.text).toContain("AT TIME ZONE $21");
    const update = runner.calls.find((c) => c.text.startsWith("UPDATE calibration_devices"));
    expect(update?.bind[0]).toBe(TENANT);
    expect(update?.bind[1]).toEqual(["d-103"]);
    expect(update?.text).not.toContain("client_facility_id =");
    expect(update?.text).toContain("t.deleted_at IS NULL");
    expect(update?.bind[17]).toEqual([null]);
    expect(update?.bind[18]).toEqual([JSON.stringify({ name: "Former upstream user #4", role: null, organisation: null })]);
    expect(runner.calls.find((c) => c.text.includes("INSERT INTO upstream_import.quarantine"))?.bind).toContain("value_out_of_range");
    expect(runner.calls.every((c) => c.transaction === TX)).toBe(true);
  });

  it("nothing to write: no departed registrant, no insert, no update", async () => {
    const runner = world([[/AS row/, () => [device("101", { id_client: 9 })]]]);
    await runDevices(context(runner));
    expect(runner.calls.some((c) => /INSERT INTO (calibration_devices|upstream_import.former_users)|UPDATE calibration_devices/.test(c.text))).toBe(false);
  });
});
