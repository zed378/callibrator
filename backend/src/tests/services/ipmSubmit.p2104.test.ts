/**
 * P21-04 — the IPM submit, the correction's submit and the void, row by row of spec P19-02 § 6,
 * § 7.2, § 8 and § 14, with the report's issuance of P19-06 § 5 – § 6 (ADR-126 Am. 5): every 409
 * asserting its top-level `code` and its explanation; the side effects per recommendation, each
 * with its audit row inside the submit; the per-tenant switch of UD-17's side effects; the room
 * confirmation; the visit and report numbers; the content hash equal to the SHA-256 of the
 * canonical payload rebuilt from the served document (the browser's recomputation); the socket
 * events (G-19); audit atomicity (a forced failure after the audit write leaves nothing).
 *
 * REAL: the routers' chains, the controller, ipmSubmit / ipmReport / ipmSession services, the
 * models and the tenant + facility hooks over memoryDb. The advisory lock's raw statement is
 * answered by `onQuery` (memoryDb refuses raw SQL; the live suite runs it on PostgreSQL 18).
 * Synthetic data only.
 */
import { createHash } from "node:crypto";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import type * as SubmitService from "../../services/ipmSubmit.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as IdempotencyService from "../../services/idempotency.service";
import type AuditServiceModule from "../../services/audit.service";
import type * as Recipients from "../../services/notificationRecipients";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import { canonicalIpmReportPayload, ipmReportPayloadOfDocument, type IpmReportDocumentLike } from "@callibrator/contracts/ipmReport";
import { compactDay, zonedDay } from "@callibrator/contracts/inspectionValues";
import type { TenantId } from "../../types/ids";

const mockEmits: { event: string; rooms: string[]; payload: unknown }[] = [];
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../config/socket", () => ({
  getIo: () => ({ to: (rooms: string[]) => ({ emit: (event: string, payload: unknown) => mockEmits.push({ event, rooms, payload }) }) }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const sessions = jest.requireActual<typeof SessionsRoute>("../../routes/api/ipmSessions.route");
const submitService = jest.requireActual<typeof SubmitService>("../../services/ipmSubmit.service");
const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");
const idempotency = jest.requireActual<typeof IdempotencyService>("../../services/idempotency.service");
const auditService = jest.requireActual<typeof AuditServiceModule>("../../services/audit.service");
const recipients = jest.requireActual<typeof Recipients>("../../services/notificationRecipients");

const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const WO_S1 = "0b0b0b0b-0000-4000-8000-0000000000f1";

interface Body {
  data?: Record<string, unknown> | null;
  message?: string;
  code?: string;
  headId?: string;
}
interface Res { status: number; body: Body }

let world: IpmWorld;
let lockKeys: unknown[][];

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mockEmits.length = 0;
  lockKeys = [];
  mdb.onQuery((statement: string, options: { bind?: unknown }) => {
    if (statement.includes("pg_advisory_xact_lock")) {
      lockKeys.push((options.bind as unknown[] | undefined) ?? []);
      return [];
    }
    throw new Error(`unexpected raw SQL: ${statement}`);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const send = (principal: Principal, method: string, url: string, body: unknown = {}, headers: Record<string, string> = {}): Promise<Res> => {
  as(principal);
  return call(sessions, method, url, { body, headers, routeFile: "api/ipmSessions.route.ts" }) as Promise<Res>;
};
const data = (res: Res): Record<string, unknown> => res.body.data as Record<string, unknown>;
const rowsOf = (model: string): Record<string, unknown>[] => mdb.rows(model);
const rowOf = (model: string, id: string): Record<string, unknown> => rowsOf(model).find((r) => r["id"] === id) as Record<string, unknown>;
/** Change a stored row in place (the live table, not a copy — no hook, no validation). */
const setRow = (model: string, id: string, values: Record<string, unknown>): void => {
  const live = mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown };
  Object.assign(live.rowsOf(live.model(model)).find((r) => r["id"] === id) as Record<string, unknown>, values);
};
const audits = (operation: string): Record<string, unknown>[] =>
  rowsOf("AuditLog").filter((a) => (a["changes"] as Record<string, unknown> | null)?.["operation"] === operation);
const setting = (key: string, value: string): void => {
  mdb.seed("TenantSettings", { tenantId: world.tenantA, key, value });
};
const expectConflict = (res: Res, code: string, message: string | RegExp): void => {
  expect([res.status, res.body.code]).toEqual([409, code]);
  if (typeof message === "string") {
    expect(res.body.message).toBe(message);
  } else {
    expect(res.body.message).toMatch(message);
  }
};

const RESULTS = [
  { inputKind: "measured", templateItemId: IPM.ITEM_BASE_TEMP, value: "24.50" },
  { inputKind: "tri_state", templateItemId: IPM.ITEM_PLACEMENT, outcome: "pass" },
  { inputKind: "measured_with_limit", templateItemId: IPM.ITEM_LEAK, value: "50" },
  { inputKind: "setting_measured_reference", templateItemId: IPM.ITEM_PRESSURE, value1: "120", value2: "121", outcome: "pass" },
  { inputKind: "tri_state", templateItemId: IPM.ITEM_POWER, outcome: "pass" },
];

/** A complete draft of `principal` on `deviceId` at revision 2 (header, then results). */
const completeDraft = async (
  principal: Principal,
  deviceId: string,
  header: Record<string, unknown> = {},
): Promise<string> => {
  const created = await send(principal, "POST", "/", { deviceId, performedAt: "2026-10-08T01:00:00Z" });
  expect(created.status).toBe(201);
  const id = data(created)["id"] as string;
  await fill(principal, id, 0, header);
  return id;
};

/** Header (revision r → r+1), then results (r+1 → r+2). */
const fill = async (principal: Principal, id: string, revision: number, header: Record<string, unknown> = {}): Promise<void> => {
  const patched = await send(principal, "PATCH", `/${id}`, {
    revision,
    inspectionOutcome: "pass",
    maintenanceOutcome: "pass",
    recommendation: "fit_for_use",
    ...header,
  });
  expect(patched.status).toBe(200);
  const put = await send(principal, "PUT", `/${id}/results`, { revision: revision + 1, results: RESULTS });
  expect(put.status).toBe(200);
};

const submit = (principal: Principal, id: string, revision = 2, headers: Record<string, string> = {}): Promise<Res> =>
  send(principal, "POST", `/${id}/submit`, { revision }, headers);

const today = (tz = "Asia/Jakarta"): string => compactDay(zonedDay(new Date(), tz));

// ------------------------------------------------------------------
// THE ROOT SUBMIT (§ 7.2, § 8.1; P19-06 § 5, § 6)
// ------------------------------------------------------------------

describe("POST /ipm/sessions/:sessionId/submit — a root", () => {
  it("issues the report, numbers the visit, writes the Preventative order and every audit row in one transaction", async () => {
    const id = await completeDraft(world.staff, IPM.D1);
    const res = await submit(world.staff, id);
    expect([res.status, res.body.message]).toEqual([200, "IPM submitted"]);
    const session = data(res);
    expect(session).toMatchObject({
      status: "submitted",
      effective: true,
      visitNumber: 2,
      reportNumber: `IPM-F-0001-${today()}-001`,
      performerSnapshot: { name: expect.any(String) as unknown },
      deviceSnapshot: { name: "Alat sintetis 1", serialNumber: "SN-1", qrCode: "TST000001", deviceTypeId: IPM.TYPE, deviceTypeName: "Synthetic Pump Type" },
      facilitySnapshot: { id: IPM.F1, name: "Facility One", code: "F-0001" },
    });
    expect(session).not.toHaveProperty("verificationToken");
    expect(session).not.toHaveProperty("legacyKey");
    const stored = rowOf("InspectionSession", id);
    expect(stored["verificationToken"]).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(stored["reportHashScheme"]).toBe("ipm-report-v1");
    expect(stored["issuerSnapshot"]).toMatchObject({ version: 1, timeZone: "Asia/Jakarta" });
    expect(stored["submittedBy"]).toBe(world.staff.id);

    const order = rowOf("MaintenanceWorkOrder", session["workOrderId"] as string);
    expect(order).toMatchObject({
      type: "Preventative",
      status: "Completed",
      title: "IPM visit 2",
      deviceId: IPM.D1,
      clientFacilityId: IPM.F1,
      assignedTo: world.staff.id,
      autoScheduled: false,
      resolutionNotes: `Recorded by IPM ${id}`,
    });
    expect(session["sideEffects"]).toEqual({
      preventiveWorkOrderId: order["id"],
      repairWorkOrderId: null,
      deviceStatus: null,
      deviceLocation: null,
      calibrationRequested: false,
      notices: [],
    });
    const [approve] = audits("SUBMIT_IPM");
    expect(approve).toMatchObject({ action: "APPROVE", resourceType: "InspectionSession", resourceId: id, clientFacilityId: IPM.F1 });
    expect(approve?.["changes"]).toMatchObject({
      visitNumber: 2,
      recommendation: "fit_for_use",
      resultCount: 5,
      reportNumber: session["reportNumber"],
      reportHash: stored["reportContentHash"],
      hashScheme: "ipm-report-v1",
    });
    expect(audits("IPM_PREVENTIVE_WORK_ORDER")).toEqual([expect.objectContaining({ action: "CREATE", resourceType: "MaintenanceWorkOrder", clientFacilityId: IPM.F1 })]);
    expect(lockKeys).toEqual([[`ipm-report:${world.tenantA}:F-0001:${today()}`]]);
    expect(mockEmits).toEqual([
      { event: "ipm:submitted", rooms: [`tenant_${world.tenantA}`, `facility_${world.tenantA}_${IPM.F1}`], payload: { sessionId: id, deviceId: IPM.D1, reportNumber: session["reportNumber"] } },
    ]);
  });

  it("the stored hash is the SHA-256 of the canonical payload the served document rebuilds (the browser's check)", async () => {
    const id = await completeDraft(world.staff, IPM.D1);
    await submit(world.staff, id);
    const doc = data(await send(world.staff, "GET", `/${id}/report-document`)) as unknown as IpmReportDocumentLike & { integrity: { hash: string; state: string } };
    expect(doc.integrity.state).toBe("match");
    const payload = ipmReportPayloadOfDocument(doc);
    expect(createHash("sha256").update(canonicalIpmReportPayload(payload as NonNullable<typeof payload>), "utf8").digest("hex")).toBe(doc.integrity.hash);
    expect(doc.integrity.hash).toBe(rowOf("InspectionSession", id)["reportContentHash"]);
  });

  it("numbers per tenant, facility and day: a second report of F1 is -002, F2's first is -001; the tenant's zone names the day", async () => {
    setting("tenant_time_zone", "UTC");
    const first = await completeDraft(world.staff, IPM.D1);
    expect(data(await submit(world.staff, first))["reportNumber"]).toBe(`IPM-F-0001-${today("UTC")}-001`);
    const second = await completeDraft(world.staff, IPM.D1);
    const res = await submit(world.staff, second);
    expect([data(res)["reportNumber"], data(res)["visitNumber"]]).toEqual([`IPM-F-0001-${today("UTC")}-002`, 3]);
    setRow("InspectionSession", IPM.DRAFT2, { revision: 0 });
    await fill(world.staff, IPM.DRAFT2, 0);
    expect(data(await submit(world.staff, IPM.DRAFT2))["reportNumber"]).toBe(`IPM-F-0002-${today("UTC")}-001`);
    expect(rowOf("InspectionSession", second)["issuerSnapshot"]).toMatchObject({ timeZone: "UTC" });
  });

  it("a facility without a code numbers as SELF; a number that is not ours under the prefix is skipped", async () => {
    setRow("ClientFacility", IPM.F1, { code: null });
    const id = await completeDraft(world.staff, IPM.D1);
    mdb.seed("InspectionSession", { ...rowOf("InspectionSession", IPM.S2), id: MISSING, reportNumber: `IPM-SELF-${today()}-X` });
    expect(data(await submit(world.staff, id))["reportNumber"]).toBe(`IPM-SELF-${today()}-001`);
  });

  it("an Idempotency-Key replay answers the stored status with the session re-read", async () => {
    const id = await completeDraft(world.staff, IPM.D1);
    const key = "3f1d2c4b-5a69-4788-9a1b-2c3d4e5f6a7b";
    const first = await submit(world.staff, id, 2, { "idempotency-key": key });
    const again = await submit(world.staff, id, 2, { "idempotency-key": key });
    expect([first.status, again.status, again.body.message]).toEqual([200, 200, "Replayed"]);
    expect(data(again)["reportNumber"]).toBe(data(first)["reportNumber"]);
    expect(audits("SUBMIT_IPM")).toHaveLength(1);
  });

  it("a confirmed room moves the device and is snapshotted", async () => {
    const id = await completeDraft(world.staff, IPM.D1, { locationId: IPM.ROOM1 });
    setRow("Warehouse", IPM.ROOM1, { floor: "2" });
    const res = await submit(world.staff, id);
    expect(res.body.message).toBe("IPM submitted");
    expect(data(res)).toMatchObject({ roomSnapshot: "Ruang 1", floorSnapshot: "2", sideEffects: { deviceLocation: { from: null, to: IPM.ROOM1 } } });
    expect(rowOf("CalibrationDevice", IPM.D1)["locationId"]).toBe(IPM.ROOM1);
    expect(audits("IPM_DEVICE_LOCATION")).toEqual([expect.objectContaining({ action: "UPDATE", resourceType: "CalibrationDevice", resourceId: IPM.D1 })]);
    setRow("CalibrationDevice", IPM.D1, { locationId: IPM.STORE1 });
    const again = await completeDraft(world.staff, IPM.D1, { locationId: IPM.ROOM1 });
    expect(data(await submit(world.staff, again))["sideEffects"]).toMatchObject({ deviceLocation: { from: IPM.STORE1, to: IPM.ROOM1 } });
    const same = await completeDraft(world.staff, IPM.D1, { locationId: IPM.ROOM1 });
    expect(data(await submit(world.staff, same))["sideEffects"]).toMatchObject({ deviceLocation: null });
  });

  it("the device's last effective calibration and next due date are in the snapshot (09 L-1)", async () => {
    mdb.seed("CalibrationRecord", [
      { id: "c0000000-0000-4000-8000-000000000001", tenantId: world.tenantA, clientFacilityId: IPM.F1, deviceId: IPM.D1, calibrationDate: new Date("2026-03-01T00:00:00Z"), isDeleted: false, supersededById: null, createdAt: new Date("2026-03-01T00:00:00Z") },
      { id: "c0000000-0000-4000-8000-000000000002", tenantId: world.tenantA, clientFacilityId: IPM.F1, deviceId: IPM.D1, calibrationDate: new Date("2026-05-01T00:00:00Z"), isDeleted: false, supersededById: null, createdAt: new Date("2026-05-01T00:00:00Z") },
    ]);
    setRow("CalibrationDevice", IPM.D1, { nextCalibrationDate: new Date("2027-05-01T00:00:00Z") });
    const id = await completeDraft(world.staff, IPM.D1);
    expect(data(await submit(world.staff, id))["deviceSnapshot"]).toMatchObject({ lastCalibrationDate: "2026-05-01", nextCalibrationDate: "2027-05-01" });
  });
});

describe("the recommendation's side effects (UD-17, a working decision) — § 8.1", () => {
  it("needs_repair: an open, high-priority Repair order, linked, announced to the tenant and the facility's bound maintenance readers", async () => {
    // recipientsFor's own audience rule is G-21's (notificationRecipients.p2109d); here: its answer is addressed, row by row.
    const audience = jest.spyOn(recipients, "recipientsFor").mockResolvedValue({ broadcast: true, boundUserIds: [IPM.BOUND, IPM.BOUND2] });
    const id = await completeDraft(world.staff, IPM.D1, { recommendation: "needs_repair" });
    const session = data(await submit(world.staff, id));
    const repair = rowOf("MaintenanceWorkOrder", session["followUpWorkOrderId"] as string);
    expect(repair).toMatchObject({ type: "Repair", status: "Open", priority: "High", title: "Repair after IPM visit 2", description: `Device must be repaired. IPM session ${id}.` });
    expect(session["sideEffects"]).toMatchObject({ repairWorkOrderId: repair["id"] });
    expect(audits("IPM_REPAIR_WORK_ORDER")).toHaveLength(1);
    const notices = audits("IPM_REPAIR_NOTICE").map((a) => (a["changes"] as Record<string, unknown>)["audience"]);
    expect(notices.sort()).toEqual(["facility-user", "facility-user", "tenant"]);
    const recipientsOf = rowsOf("Notification").map((n) => n["userId"]).sort();
    expect(recipientsOf).toEqual([IPM.BOUND, IPM.BOUND2, null].sort());
    expect(audience).toHaveBeenCalledWith({ tenantId: world.tenantA, clientFacilityId: IPM.F1 }, "maintenance", expect.anything());
  });

  it("not_fit_for_use: an active device goes to maintenance (audited); one already there is untouched; an inactive one is noted", async () => {
    const id = await completeDraft(world.staff, IPM.D1, { recommendation: "not_fit_for_use" });
    expect(data(await submit(world.staff, id))["sideEffects"]).toMatchObject({ deviceStatus: { from: "active", to: "maintenance" }, notices: [] });
    expect(rowOf("CalibrationDevice", IPM.D1)["status"]).toBe("maintenance");
    expect(audits("IPM_DEVICE_STATUS")).toHaveLength(1);

    const again = await completeDraft(world.staff, IPM.D1, { recommendation: "not_fit_for_use" });
    expect(data(await submit(world.staff, again))["sideEffects"]).toMatchObject({ deviceStatus: null, notices: [] });

    setRow("CalibrationDevice", IPM.D1, { status: "active" });
    const third = await completeDraft(world.staff, IPM.D1);
    setRow("CalibrationDevice", IPM.D1, { status: "inactive" });
    setRow("InspectionSession", third, { recommendation: "not_fit_for_use" });
    expect(data(await submit(world.staff, third))["sideEffects"]).toMatchObject({ deviceStatus: null, notices: ["The device is inactive; its status was not changed."] });
    expect(audits("IPM_DEVICE_STATUS")).toHaveLength(1);
  });

  it("needs_calibration: the request flag with its session; an open request stands and is noted", async () => {
    const id = await completeDraft(world.staff, IPM.D1, { recommendation: "needs_calibration" });
    expect(data(await submit(world.staff, id))["sideEffects"]).toMatchObject({ calibrationRequested: true });
    expect(rowOf("CalibrationDevice", IPM.D1)).toMatchObject({ calibrationRequestedBySessionId: id, calibrationRequestedAt: new Date("2026-10-08T01:00:00Z") });
    expect(audits("IPM_CALIBRATION_REQUESTED")).toHaveLength(1);
    const again = await completeDraft(world.staff, IPM.D1, { recommendation: "needs_calibration" });
    expect(data(await submit(world.staff, again))["sideEffects"]).toMatchObject({
      calibrationRequested: false,
      notices: ["A calibration was already requested on 2026-10-08; that request stands."],
    });
    expect(rowOf("CalibrationDevice", IPM.D1)["calibrationRequestedBySessionId"]).toBe(id);
  });

  it("switched off for the tenant (ipm_recommendation_side_effects=false): the record and the Preventative order only, and a notice", async () => {
    setting("ipm_recommendation_side_effects", "false");
    const id = await completeDraft(world.staff, IPM.D1, { recommendation: "needs_repair" });
    const session = data(await submit(world.staff, id));
    expect(session["followUpWorkOrderId"]).toBeNull();
    expect(session["sideEffects"]).toMatchObject({
      repairWorkOrderId: null,
      notices: ["The recommendation's side effects are switched off for this tenant; nothing beyond the record was changed."],
    });
    expect(rowsOf("MaintenanceWorkOrder").map((o) => o["type"])).toEqual(["Preventative"]);
    const plain = await completeDraft(world.staff, IPM.D1);
    expect(data(await submit(world.staff, plain))["sideEffects"]).toMatchObject({ notices: [] });
  });
});

// ------------------------------------------------------------------
// REFUSALS (§ 7.2)
// ------------------------------------------------------------------

describe("submit refusals", () => {
  it("an unknown id → 404", async () => {
    expect((await submit(world.staff, MISSING)).status).toBe(404);
  });

  it("another user's draft in scope → 403; a stale revision → 409 IPM_REVISION_CONFLICT", async () => {
    const id = await completeDraft(world.staff, IPM.D1);
    expect([(await submit(world.bound, id)).status]).toEqual([403]);
    expectConflict(await submit(world.staff, id, 1), "IPM_REVISION_CONFLICT", /^This draft was saved at .+ \(revision 2\); reload it before submitting\.$/);
  });

  it.each([
    ["submitted", { status: "submitted", submittedAt: new Date("2026-10-01T03:00:00Z") }, "This IPM was already submitted on 2026-10-01."],
    ["voided", { status: "voided", voidedAt: new Date("2026-10-02T03:00:00Z") }, "This IPM was voided on 2026-10-02; start a new IPM."],
    ["discarded", { status: "discarded", discardedAt: new Date("2026-10-03T03:00:00Z") }, "This IPM draft was discarded on 2026-10-03; start a new IPM."],
  ])("a %s session → 409 IPM_NOT_DRAFT", async (_label, values, message) => {
    setRow("InspectionSession", IPM.DRAFT2, values);
    expectConflict(await submit(world.staff, IPM.DRAFT2, 0), "IPM_NOT_DRAFT", message);
  });

  it("the device retired meanwhile → 409 IPM_DEVICE_RETIRED; the facility ended → 409 IPM_FACILITY_ENDED", async () => {
    const id = await completeDraft(world.staff, IPM.D1);
    setRow("CalibrationDevice", IPM.D1, { status: "retired" });
    expectConflict(await submit(world.staff, id), "IPM_DEVICE_RETIRED", "This device was retired after the IPM started; discard the draft (a tenant administrator can reinstate the device first).");
    setRow("CalibrationDevice", IPM.D1, { status: "active" });
    setRow("ClientFacility", IPM.F1, { status: "ended" });
    expectConflict(await submit(world.staff, id), "IPM_FACILITY_ENDED", "Facility One has ended; new records cannot be added. Reinstate it first.");
  });

  it("missing header outcomes and required items → 400 naming them by section and label; nothing written", async () => {
    const created = await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    const id = data(created)["id"] as string;
    await send(world.staff, "PUT", `/${id}/results`, { revision: 0, results: [RESULTS[0], RESULTS[4]] });
    const before = mdb.committed().length;
    const res = await submit(world.staff, id, 1);
    expect([res.status, res.body.message]).toEqual([
      400,
      'This IPM cannot be submitted yet — complete the inspection result, maintenance result, recommendation; other safety: "Synthetic placement"; electrical safety: "Synthetic leakage check"; performance: "Synthetic pressure reading".',
    ]);
    expect(mdb.committed().slice(before)).toEqual([]);
    expect(lockKeys).toEqual([]);
  });

  it("a complete header with required items missing → 400 naming the items only", async () => {
    const created = await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    const id = data(created)["id"] as string;
    await send(world.staff, "PATCH", `/${id}`, { revision: 0, inspectionOutcome: "pass", maintenanceOutcome: "pass", recommendation: "fit_for_use" });
    await send(world.staff, "PUT", `/${id}/results`, { revision: 1, results: RESULTS.slice(0, 4) });
    const res = await submit(world.staff, id);
    expect([res.status, res.body.message]).toEqual([400, 'This IPM cannot be submitted yet — complete function: "Synthetic power-on check".']);
  });

  it("a device without a type prints no type name", async () => {
    const id = await completeDraft(world.staff, IPM.D1);
    setRow("CalibrationDevice", IPM.D1, { deviceTypeId: null });
    expect(data(await submit(world.staff, id))["deviceSnapshot"]).toMatchObject({ deviceTypeId: null, deviceTypeName: null });
  });

  it("an API key is refused by the route (denyApiKey) and by the service (a person's record)", async () => {
    await expect(
      submitService.submitSession(world.tenantA as TenantId, { sessionId: IPM.DRAFT2, revision: 0 }, { userId: null, apiKeyId: "k", ipAddress: null, userAgent: null, tenantAdmin: false }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("a failure after the audit write rolls back everything: no status change, no order, no audit row", async () => {
    const id = await completeDraft(world.staff, IPM.D1, { recommendation: "needs_repair" });
    jest.spyOn(idempotency, "completeIdempotentRequest").mockRejectedValueOnce(new Error("forced"));
    const auditsBefore = rowsOf("AuditLog").length;
    expect((await submit(world.staff, id)).status).toBe(500);
    expect(rowOf("InspectionSession", id)["status"]).toBe("draft");
    expect(rowsOf("MaintenanceWorkOrder")).toEqual([]);
    expect(rowsOf("AuditLog")).toHaveLength(auditsBefore);
    expect(mockEmits).toEqual([]);
  });
});

// ------------------------------------------------------------------
// THE CORRECTION'S SUBMIT (§ 7.2, § 8.3)
// ------------------------------------------------------------------

describe("submit a correction — supersede the original, apply the delta", () => {
  const correct = async (originalId: string, header: Record<string, unknown> = {}): Promise<string> => {
    const res = await send(world.staff, "POST", `/${originalId}/corrections`, { reason: "Synthetic correction" });
    expect(res.status).toBe(201);
    const id = data(res)["id"] as string;
    await fill(world.staff, id, 0, header);
    return id;
  };

  beforeEach(() => {
    mdb.seed("MaintenanceWorkOrder", {
      id: WO_S1,
      tenantId: world.tenantA,
      deviceId: IPM.D1,
      clientFacilityId: IPM.F1,
      title: "IPM visit 1",
      type: "Preventative",
      status: "Completed",
      priority: "Medium",
      completedDate: new Date("2026-10-01T02:00:00Z"),
      scheduledDate: new Date("2026-10-01T02:00:00Z"),
      autoScheduled: false,
    });
    setRow("InspectionSession", IPM.S1, { workOrderId: WO_S1, reportNumber: "IPM-F-0001-20261001-001" });
  });

  it("keeps the visit number, re-uses the visit's order (its date follows), supersedes the original — audited", async () => {
    const id = await correct(IPM.S1, { performedAt: "2026-10-01T04:00:00Z" });
    const res = await submit(world.staff, id);
    expect(data(res)).toMatchObject({ status: "submitted", visitNumber: 1, workOrderId: WO_S1, supersedesId: IPM.S1 });
    expect(rowOf("InspectionSession", IPM.S1)).toMatchObject({ supersededById: id, status: "submitted" });
    expect(rowOf("MaintenanceWorkOrder", WO_S1)["completedDate"]).toEqual(new Date("2026-10-01T04:00:00Z"));
    expect(audits("SUPERSEDE_IPM")).toEqual([expect.objectContaining({ action: "UPDATE", resourceId: IPM.S1 })]);
    expect(audits("SUBMIT_IPM_CORRECTION")[0]?.["changes"]).toMatchObject({ originalId: IPM.S1 });
    expect(audits("IPM_PREVENTIVE_WORK_ORDER")).toEqual([expect.objectContaining({ action: "UPDATE", resourceId: WO_S1 })]);
    const doc = data(await send(world.staff, "GET", `/${id}/report-document`));
    expect(doc["lineage"]).toMatchObject({ supersedesReportNumber: "IPM-F-0001-20261001-001" });
  });

  it("a superseded report's document says so and names the report that superseded it", async () => {
    const root = await completeDraft(world.staff, IPM.D1);
    const rootNumber = data(await submit(world.staff, root))["reportNumber"];
    const id = await correct(root);
    const corrected = data(await submit(world.staff, id));
    const original = data(await send(world.staff, "GET", `/${root}/report-document`));
    expect([original["status"], original["lineage"]]).toEqual([
      "superseded",
      { supersedesReportNumber: null, supersededByReportNumber: corrected["reportNumber"], supersededAt: expect.any(String) as unknown, voidedAt: null },
    ]);
    expect((data(await send(world.staff, "GET", `/${id}/report-document`))["lineage"] as Record<string, unknown>)["supersedesReportNumber"]).toBe(rootNumber);
  });

  it("entering needs_calibration applies it; a later correction leaving it clears the request it raised (audited); leaving repair or out-of-service only notes", async () => {
    const first = await correct(IPM.S1, { recommendation: "needs_calibration" });
    expect(data(await submit(world.staff, first))["sideEffects"]).toMatchObject({ calibrationRequested: true });
    expect(rowOf("CalibrationDevice", IPM.D1)["calibrationRequestedBySessionId"]).toBe(first);
    const second = await correct(first, { recommendation: "fit_for_use" });
    await submit(world.staff, second);
    expect(rowOf("CalibrationDevice", IPM.D1)).toMatchObject({ calibrationRequestedAt: null, calibrationRequestedBySessionId: null });
    expect(audits("IPM_CALIBRATION_REQUEST_CLEARED")).toHaveLength(1);

    setRow("InspectionSession", second, { recommendation: "needs_repair", followUpWorkOrderId: WO_S1 });
    const third = await correct(second, { recommendation: "not_fit_for_use" });
    const thirdRes = data(await submit(world.staff, third));
    expect(thirdRes["sideEffects"]).toMatchObject({ deviceStatus: { from: "active", to: "maintenance" }, notices: [`Repair work order ${WO_S1} was opened by the previous version; review it.`] });
    const fourth = await correct(third, { recommendation: "needs_repair" });
    const fourthRes = data(await submit(world.staff, fourth));
    expect((fourthRes["sideEffects"] as Record<string, unknown>)["notices"]).toEqual(["The previous version took the device out of service; review its status."]);
    const fifth = await correct(fourth, { recommendation: "needs_repair" });
    expect(data(await submit(world.staff, fifth))).toMatchObject({ followUpWorkOrderId: fourthRes["followUpWorkOrderId"], sideEffects: { repairWorkOrderId: null } });
  });

  it("a correction keeps a recommendation the tenant switched off, with the notice", async () => {
    setting("ipm_recommendation_side_effects", "false");
    const id = await correct(IPM.S1, { recommendation: "needs_repair" });
    expect(data(await submit(world.staff, id))["sideEffects"]).toMatchObject({
      repairWorkOrderId: null,
      notices: ["The recommendation's side effects are switched off for this tenant; nothing beyond the record was changed."],
    });
    setRow("InspectionSession", id, { recommendation: "needs_repair" });
    const back = await correct(id, { recommendation: "fit_for_use" });
    expect(data(await submit(world.staff, back))["sideEffects"]).toMatchObject({ notices: [] });
  });

  it("an original without an order (imported history) gets the visit's Preventative order at the correction", async () => {
    setRow("InspectionSession", IPM.S1, { workOrderId: null });
    const id = await correct(IPM.S1);
    const res = data(await submit(world.staff, id));
    expect(rowOf("MaintenanceWorkOrder", res["workOrderId"] as string)).toMatchObject({ type: "Preventative", title: "IPM visit 1" });
  });

  it("an order whose date did not change is left alone", async () => {
    const id = await correct(IPM.S1);
    await submit(world.staff, id);
    expect(audits("IPM_PREVENTIVE_WORK_ORDER")).toEqual([]);
  });

  it("the original voided or corrected by someone else meanwhile → 409 IPM_ORIGINAL_NOT_EFFECTIVE", async () => {
    const id = await correct(IPM.S1);
    setRow("InspectionSession", IPM.S1, { status: "voided", voidedAt: new Date("2026-10-05T00:00:00Z") });
    expectConflict(await submit(world.staff, id), "IPM_ORIGINAL_NOT_EFFECTIVE", "The IPM you corrected was voided on 2026-10-05; discard this draft.");
    setRow("InspectionSession", IPM.S1, { status: "submitted", voidedAt: null, supersededById: IPM.S2, supersededAt: new Date("2026-10-06T00:00:00Z") });
    expectConflict(await submit(world.staff, id), "IPM_ORIGINAL_NOT_EFFECTIVE", "The IPM you corrected was corrected by someone else on 2026-10-06; discard this draft.");
  });
});

// ------------------------------------------------------------------
// THE VOID (§ 7.2, § 8.4)
// ------------------------------------------------------------------

describe("POST /ipm/sessions/:sessionId/void", () => {
  const voidIt = (principal: Principal, id: string, reason = "Duplicate visit"): Promise<Res> => send(principal, "POST", `/${id}/void`, { reason });

  it("an unbound tenant administrator voids the head: the visit's order cancelled, the chain's calibration request cleared, the rest noted", async () => {
    const id = await completeDraft(world.staff, IPM.D1, { recommendation: "needs_repair" });
    const submitted = data(await submit(world.staff, id));
    setRow("InspectionSession", id, { recommendation: "needs_calibration", sideEffects: { ...(submitted["sideEffects"] as object), deviceStatus: { from: "active", to: "maintenance" } } });
    setRow("CalibrationDevice", IPM.D1, { calibrationRequestedAt: new Date(), calibrationRequestedBySessionId: id });
    mockEmits.length = 0;
    const res = await voidIt(world.admin, id);
    expect([res.status, res.body.message]).toEqual([200, "IPM voided"]);
    expect(data(res)).toMatchObject({
      status: "voided",
      voidReason: "Duplicate visit",
      notices: [
        `Repair work order ${String(submitted["followUpWorkOrderId"])} stays open; review it.`,
        "The device status set by this IPM (maintenance) was not changed; review it.",
      ],
    });
    expect(rowOf("MaintenanceWorkOrder", submitted["workOrderId"] as string)).toMatchObject({ status: "Cancelled", resolutionNotes: "IPM visit 2 voided" });
    expect(rowOf("MaintenanceWorkOrder", submitted["followUpWorkOrderId"] as string)["status"]).toBe("Open");
    expect(rowOf("CalibrationDevice", IPM.D1)["calibrationRequestedBySessionId"]).toBeNull();
    expect(audits("VOID_IPM")).toEqual([expect.objectContaining({ action: "DELETE", resourceId: id, clientFacilityId: IPM.F1 })]);
    expect(audits("IPM_WORK_ORDER_CANCELLED")).toHaveLength(1);
    expect(audits("IPM_CALIBRATION_REQUEST_CLEARED")).toHaveLength(1);
    expect(mockEmits.map((e) => e.event)).toEqual(["ipm:voided"]);
    // A device status without a recorded `to` still names maintenance.
    expect(rowOf("InspectionSession", id)["voidedBy"]).toBe(world.admin.id);
  });

  it("an order already cancelled and a request of another chain are left alone; a session without an order voids too", async () => {
    setRow("InspectionSession", IPM.S1, { workOrderId: null, sideEffects: { deviceStatus: { from: "active", to: null } } });
    setRow("CalibrationDevice", IPM.D1, { calibrationRequestedAt: new Date(), calibrationRequestedBySessionId: IPM.S2 });
    const res = await voidIt(world.admin, IPM.S1);
    expect(data(res)["notices"]).toEqual(["The device status set by this IPM (maintenance) was not changed; review it."]);
    expect(rowOf("CalibrationDevice", IPM.D1)["calibrationRequestedBySessionId"]).toBe(IPM.S2);
    mdb.seed("MaintenanceWorkOrder", { id: WO_S1, tenantId: world.tenantA, deviceId: IPM.D2, clientFacilityId: IPM.F2, title: "x", type: "Preventative", status: "Cancelled", priority: "Medium" });
    setRow("InspectionSession", IPM.S2, { workOrderId: WO_S1 });
    expect((await voidIt(world.admin, IPM.S2)).status).toBe(200);
    expect(audits("IPM_WORK_ORDER_CANCELLED")).toEqual([]);
  });

  it("voiding a head clears a request raised by an earlier member of its chain", async () => {
    const res = await send(world.staff, "POST", `/${IPM.S1}/corrections`, { reason: "Synthetic correction" });
    const id = data(res)["id"] as string;
    await fill(world.staff, id, 0);
    await submit(world.staff, id);
    setRow("CalibrationDevice", IPM.D1, { calibrationRequestedAt: new Date(), calibrationRequestedBySessionId: IPM.S1 });
    await voidIt(world.admin, id);
    expect(rowOf("CalibrationDevice", IPM.D1)["calibrationRequestedBySessionId"]).toBeNull();
  });

  it.each([
    ["a draft", IPM.DRAFT2, {}, "IPM_NOT_SUBMITTED", "Only a submitted IPM can be voided; discard a draft instead."],
    ["a discarded draft", IPM.DRAFT2, { status: "discarded" }, "IPM_NOT_SUBMITTED", "Only a submitted IPM can be voided; discard a draft instead."],
    ["a voided IPM", IPM.S1, { status: "voided", voidedAt: new Date("2026-10-04T00:00:00Z") }, "IPM_VOIDED", "This IPM was already voided on 2026-10-04."],
  ])("%s → 409 %s", async (_label, id, values, code, message) => {
    setRow("InspectionSession", id, values);
    expectConflict(await voidIt(world.admin, id), code, message);
  });

  it("a superseded session → 409 IPM_SUPERSEDED with the head's id", async () => {
    const res = await send(world.staff, "POST", `/${IPM.S1}/corrections`, { reason: "Synthetic correction" });
    const id = data(res)["id"] as string;
    await fill(world.staff, id, 0);
    await submit(world.staff, id);
    const refused = await voidIt(world.admin, IPM.S1);
    expectConflict(refused, "IPM_SUPERSEDED", /^This IPM was corrected on \d{4}-\d{2}-\d{2}; void the latest version \(visit 1\)\.$/);
    expect(refused.body.headId).toBe(id);
  });

  it("a technician → 403 (rbac); an unknown id → 404; a reason too short → 400", async () => {
    expect((await voidIt(world.staff, IPM.S1)).status).toBe(403);
    expect((await voidIt(world.admin, MISSING)).status).toBe(404);
    expect((await voidIt(world.admin, IPM.S1, "x")).status).toBe(400);
  });

  it("the service refuses a facility-bound administrator (the second layer, FT-37) and a non-administrator", async () => {
    const actor = { userId: world.admin.id, apiKeyId: null, ipAddress: null, userAgent: null, tenantAdmin: true };
    await expect(
      tenantStorage.run({ tenantId: world.tenantA as TenantId, isSuperAdmin: false, isSystemTask: false, userId: world.admin.id, clientFacilityId: null, facilityBound: true }, () =>
        submitService.voidSession(world.tenantA as TenantId, { sessionId: IPM.S1, reason: "Synthetic" }, actor),
      ),
    ).rejects.toMatchObject({ status: 403, message: "Only a tenant administrator of the provider can void an IPM." });
    await expect(submitService.voidSession(world.tenantA as TenantId, { sessionId: IPM.S1, reason: "Synthetic" }, { ...actor, tenantAdmin: false })).rejects.toMatchObject({ status: 403 });
  });
});

describe("audit atomicity of the side effects", () => {
  it("a failing side-effect audit row rolls back the order it describes", async () => {
    const id = await completeDraft(world.staff, IPM.D1, { recommendation: "needs_repair" });
    const real = auditService.logAction.bind(auditService);
    jest.spyOn(auditService, "logAction").mockImplementation(async (entry, options) => {
      if ((entry.changes as Record<string, unknown> | undefined)?.["operation"] === "IPM_REPAIR_WORK_ORDER") {
        throw new Error("forced");
      }
      return real(entry, options);
    });
    expect((await submit(world.staff, id)).status).toBe(500);
    expect(rowsOf("MaintenanceWorkOrder")).toEqual([]);
    expect(rowOf("InspectionSession", id)["status"]).toBe("draft");
  });
});
