/**
 * P21-06 — the recap reads (spec P19-05 § 8; ADR-133 Am. 3; 09-REPORT-LAYOUTS § 4.3, § 5): the
 * paged `GET /calibration-records` the browser builds the four upstream recaps and the calibration
 * export from. No backend file is produced (ADR-126 § 8).
 *
 *  - `dateField` (calibration | created) with `fromDay`/`toDay` (inclusive days of the tenant's
 *    zone) and/or `from`/`to` (instants); `entryKind`; `clientFacilityId`; `qrCode` (normalised, in
 *    context — a sticker out of view is an empty page); `sort`; `limit` ≤ 200;
 *  - each row: the device's QR, the room SNAPSHOT ("—" when none), `effective`, the performer's
 *    display, and the facility for provider staff only;
 *  - `latestOnly`: one raw read (answered here — memoryDb refuses raw SQL) with the tenant
 *    predicate bound and, for a bound reader, its facility bound (G-14); the page keeps its order.
 *    The SQL itself runs on PostgreSQL 18 in `calibrationRecap.p2106.live`.
 *
 * REAL: the router chain, the controller, the services, the models and the hooks over memoryDb.
 * Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as RecordsRoute from "../../routes/api/calibrationRecords.route";
import type * as RecapService from "../../services/calibrationRecap.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const records = jest.requireActual<typeof RecordsRoute>("../../routes/api/calibrationRecords.route");
const recap = jest.requireActual<typeof RecapService>("../../services/calibrationRecap.service");
const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");

const R = Object.freeze({
  /** D1 (F1): an external entry on 2026-09-01 input 2026-09-02, a full record on 2026-06-01. */
  D1_EXT: "c0000000-0000-4000-8000-0000002106a1",
  D1_FULL: "c0000000-0000-4000-8000-0000002106a2",
  /** D2 (F2): a full record on 2026-09-01 input 2026-09-01. */
  D2_FULL: "c0000000-0000-4000-8000-0000002106b1",
});

interface Res {
  status: number;
  body: { data?: Record<string, unknown>[]; meta?: Record<string, unknown>; message?: string };
}

let world: IpmWorld;
let seen: { statement: string; bind: unknown[] }[];
let answer: Record<string, unknown>[];

const list = (who: Principal, query: Record<string, unknown> = {}): Promise<Res> => {
  as(who);
  return call(records, "GET", "/", { query, routeFile: "api/calibrationRecords.route.ts", baseUrl: "/api/v1/calibration-records" }) as Promise<Res>;
};
const ids = (res: Res): unknown[] => (res.body.data ?? []).map((r) => r["id"]);

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed("TenantSettings", [
    { tenantId: world.tenantA, key: "tenant_time_zone", value: "Asia/Jakarta" },
    { tenantId: world.tenantA, key: "device_qr_code_prefix", value: "TST" },
    { tenantId: world.tenantA, key: "device_qr_code_digits", value: "6" },
  ]);
  const record = (id: string, deviceId: string, facility: string, over: Record<string, unknown>): Record<string, unknown> => ({
    id,
    tenantId: world.tenantA,
    deviceId,
    clientFacilityId: facility,
    performedBy: world.staff.id,
    isDeleted: false,
    ...over,
  });
  mdb.seed("CalibrationRecord", [
    // 2026-09-01T20:00Z is 2026-09-02 03:00 in Jakarta: a Jakarta-day filter must place it on the 2nd.
    record(R.D1_EXT, IPM.D1, IPM.F1, { calibrationDate: new Date("2026-09-01T00:00:00Z"), createdAt: new Date("2026-09-01T20:00:00Z"), entryKind: "external_date", externalLabName: "Lab Sintetis", roomSnapshot: "Ruang 1", floorSnapshot: "2" }),
    record(R.D1_FULL, IPM.D1, IPM.F1, { calibrationDate: new Date("2026-06-01T00:00:00Z"), createdAt: new Date("2026-06-01T05:00:00Z"), entryKind: "full_record" }),
    record(R.D2_FULL, IPM.D2, IPM.F2, { calibrationDate: new Date("2026-09-01T00:00:00Z"), createdAt: new Date("2026-09-01T05:00:00Z"), entryKind: "full_record", isCompliant: true }),
  ]);
  seen = [];
  answer = [];
  mdb.onQuery((statement: string, options: { bind?: unknown }) => {
    seen.push({ statement, bind: (options.bind as unknown[] | undefined) ?? [] });
    return answer;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the recap filters (09 § 4.3)", () => {
  it("by INPUT day in the tenant's zone: the external entry typed at 03:00 Jakarta time on 2026-09-02", async () => {
    const day2 = await list(world.staff, { dateField: "created", fromDay: "2026-09-02", toDay: "2026-09-02" });
    const day1 = await list(world.staff, { dateField: "created", fromDay: "2026-09-01", toDay: "2026-09-01", sort: "createdAt" });
    expect([ids(day2), ids(day1)]).toEqual([[R.D1_EXT], [R.D2_FULL]]);
  });

  it("by calibration day; a range; instants and days together (the narrower lower bound wins)", async () => {
    const sept = await list(world.staff, { fromDay: "2026-08-01", toDay: "2026-09-30" });
    const narrowDay = await list(world.staff, { from: "2026-01-01T00:00:00Z", fromDay: "2026-08-01" });
    const narrowInstant = await list(world.staff, { from: "2026-08-15T00:00:00Z", fromDay: "2026-01-01", to: "2026-12-31T00:00:00Z" });
    const until = await list(world.staff, { toDay: "2026-06-30" });
    expect([ids(sept).sort(), ids(narrowDay).sort(), ids(narrowInstant).sort(), ids(until)]).toEqual([
      [R.D1_EXT, R.D2_FULL].sort(),
      [R.D1_EXT, R.D2_FULL].sort(),
      [R.D1_EXT, R.D2_FULL].sort(),
      [R.D1_FULL],
    ]);
  });

  it("entryKind; clientFacilityId for provider staff", async () => {
    const external = await list(world.staff, { entryKind: "external_date" });
    const f2 = await list(world.staff, { clientFacilityId: IPM.F2 });
    expect([ids(external), ids(f2)]).toEqual([[R.D1_EXT], [R.D2_FULL]]);
  });

  it("qrCode: normalised (a bare number padded), in context; out of view or another device → an empty page", async () => {
    const byNumber = await list(world.staff, { qrCode: "1" });
    const sameDevice = await list(world.staff, { qrCode: "TST000001", deviceId: IPM.D1 });
    const otherDevice = await list(world.staff, { qrCode: "TST000001", deviceId: IPM.D2 });
    const unknown = await list(world.staff, { qrCode: "TST000999" });
    const foreign = await list(world.bound, { qrCode: "TST000002" });
    expect([ids(byNumber).sort(), ids(sameDevice).length, ids(otherDevice), ids(unknown), ids(foreign)]).toEqual([[R.D1_EXT, R.D1_FULL].sort(), 2, [], [], []]);
    expect(unknown.body.meta).toMatchObject({ total: 0, totalPages: 0 });
  });

  it("limit: 200 accepted, 201 refused", async () => {
    expect([(await list(world.staff, { limit: 200 })).status, (await list(world.staff, { limit: 201 })).status]).toEqual([200, 400]);
  });
});

describe("each row's recap facts", () => {
  it("provider staff: the device's QR, the room snapshot or —, effective, the facility; the performer's display", async () => {
    const res = await list(world.staff, { deviceId: IPM.D1 });
    const [ext, full] = res.body.data ?? [];
    expect(ext).toMatchObject({ id: R.D1_EXT, room: { name: "Ruang 1", floor: "2" }, effective: true, externalLabName: "Lab Sintetis", clientFacility: { id: IPM.F1, name: "Facility One", code: "F-0001" } });
    expect((ext?.["device"] as Record<string, unknown>)["qrCode"]).toBe("TST000001");
    expect(full).toMatchObject({ id: R.D1_FULL, room: { name: "—", floor: "—" } });
    expect(ext?.["performerDisplay"]).toBeTruthy();
  });

  it("a bound reader: its facility's rows only, no facility block; another facility named → empty (G-22)", async () => {
    const own = await list(world.bound);
    const foreign = await list(world.bound, { clientFacilityId: IPM.F2 });
    expect([ids(own).sort(), (own.body.data ?? []).some((r) => "clientFacility" in r), ids(foreign)]).toEqual([[R.D1_EXT, R.D1_FULL].sort(), false, []]);
  });
});

describe("latestOnly — one raw read, the tenant and the facility bound (G-14)", () => {
  it("provider staff: the page's ids in the read's order, the total from the read; no facility clause", async () => {
    answer = [
      { id: R.D2_FULL, total: 2 },
      { id: R.D1_EXT, total: 2 },
    ];
    const res = await list(world.staff, { latestOnly: "true", sort: "createdAt", fromDay: "2026-09-01", entryKind: "full_record", isCompliant: "true" });
    expect(seen).toHaveLength(1);
    const { statement, bind } = seen[0] as { statement: string; bind: unknown[] };
    expect(statement).toContain("r.tenant_id = $1");
    expect(statement).toContain("DISTINCT ON (r.device_id)");
    expect(statement).toContain("ORDER BY created_at DESC, id DESC");
    expect(statement).not.toContain("r.client_facility_id = $11");
    expect(bind.slice(0, 5)).toEqual([world.tenantA, null, "full_record", null, true]);
    expect(bind).toHaveLength(10);
    // The rows come back through the models (the other filters hold too), in the read's order.
    expect(res.body.meta).toMatchObject({ total: 2 });
    expect(ids(res)).toEqual([R.D2_FULL]);
  });

  it("a bound F1 reader: its facility bound at $11; nothing found → an empty page", async () => {
    const res = await list(world.bound, { latestOnly: "true" });
    const { statement, bind } = seen[0] as { statement: string; bind: unknown[] };
    expect([statement.includes("r.client_facility_id = $11"), bind[10]]).toEqual([true, IPM.F1]);
    expect([ids(res), res.body.meta]).toEqual([[], expect.objectContaining({ total: 0 })]);
  });

  it("calibration order by default; the range on created_at for dateField=created", async () => {
    answer = [{ id: R.D1_EXT, total: 1 }];
    const res = await list(world.staff, { latestOnly: "true", dateField: "created", toDay: "2026-09-02" });
    const { statement, bind } = seen[0] as { statement: string; bind: unknown[] };
    expect([statement.includes("r.created_at < $8::timestamptz"), statement.includes("ORDER BY created_at DESC"), bind[7]]).toEqual([true, true, new Date("2026-09-02T17:00:00Z")]);
    expect(ids(res)).toEqual([R.D1_EXT]);
  });
});

describe("the recap service's edges", () => {
  it("a blank sticker names no device; the facts outside any request context are provider staff's", async () => {
    expect(await recap.qrDeviceId(world.tenantA, "   ")).toBeNull();
    const facts = await recap.recapFacts([{ id: "x", clientFacilityId: null, supersededById: "y" }]);
    expect(facts).toEqual([{ id: "x", clientFacilityId: null, supersededById: "y", room: { name: "—", floor: "—" }, effective: false, clientFacility: null }]);
    const store = { tenantId: world.tenantA, isSuperAdmin: false, isSystemTask: false, clientFacilityId: null, facilityBound: false } as unknown as TenantContext.TenantContextStore;
    const inContext = await tenantStorage.run(
      store,
      () => recap.recapFacts([{ id: "x", clientFacilityId: "f0000000-0000-4000-8000-000000000000", supersededById: null }]),
    );
    expect(inContext[0]?.["clientFacility"]).toBeNull();
  });
});
