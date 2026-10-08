/**
 * P21-04 — the IPM report document and its public verification (P19-06 spec § 6, § 9, § 10;
 * ADR-126 Am. 2, Am. 5): § 10.1 row by row; the strict key set of the document (FT-71); the hash
 * recomputed at every read — a stored hash altered answers `mismatch`, is logged and counted, and the
 * document is still served; `render` audited BEFORE the body (a failed audit write fails the read);
 * the verification by token only, one identical 404 for everything that is not a verdict, both
 * request budgets, no id / tenant / token / void reason in the verdict.
 *
 * REAL: the routers' chains, the controller, the services, the models and the tenant + facility hooks
 * over memoryDb. Synthetic data only.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import type * as ReportsRoute from "../../routes/api/ipmReports.route";
import type * as ReportService from "../../services/ipmReport.service";
import type AuditServiceModule from "../../services/audit.service";
import type * as ActivityLog from "../../middlewares/activityLog.middleware";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import { IPM_RESULTS, answerAdvisoryLocks, issueSession } from "../fixtures/ipmIssue";
import { environment } from "../../config/env";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../config/socket", () => ({ getIo: () => ({ to: () => ({ emit: () => undefined }) }) }));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const sessions = jest.requireActual<typeof SessionsRoute>("../../routes/api/ipmSessions.route");
const reports = jest.requireActual<typeof ReportsRoute>("../../routes/api/ipmReports.route");
const reportService = jest.requireActual<typeof ReportService>("../../services/ipmReport.service");
const auditService = jest.requireActual<typeof AuditServiceModule>("../../services/audit.service");
const { logger } = jest.requireActual<typeof ActivityLog>("../../middlewares/activityLog.middleware");

const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
/** The process environment (config/env#environment: the same object the services read). */
const ENV = environment();
const NOT_FOUND = { success: false, status: 404, message: "No IPM report matches this link.", data: null };

interface Res {
  status: number;
  body: { data?: Record<string, unknown> | null; message?: string; code?: string; success?: boolean };
}

let world: IpmWorld;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  answerAdvisoryLocks(mdb);
  delete ENV["IPM_VERIFY_BASE_URL"];
  delete ENV["CERT_VERIFY_BASE_URL"];
});

afterEach(() => {
  jest.restoreAllMocks();
});

const send = (principal: Principal | null, method: string, url: string, body: unknown = {}, query: Record<string, unknown> = {}): Promise<Res> => {
  as(principal);
  return call(sessions, method, url, { body, query, routeFile: "api/ipmSessions.route.ts" }) as Promise<Res>;
};
const verify = (number: string, query: Record<string, unknown> = {}): Promise<Res> => {
  as(null);
  return call(reports, "GET", `/verify/${encodeURIComponent(number)}`, { query, routeFile: "api/ipmReports.route.ts", baseUrl: "/api/v1/ipm" }) as Promise<Res>;
};
const data = (res: Res): Record<string, unknown> => res.body.data as Record<string, unknown>;
const row = (model: string, id: string): Record<string, unknown> => mdb.rows(model).find((r) => r["id"] === id) as Record<string, unknown>;
const setRow = (model: string, id: string, values: Record<string, unknown>): void => {
  const live = mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown };
  Object.assign(live.rowsOf(live.model(model)).find((r) => r["id"] === id) as Record<string, unknown>, values);
};
const issue = (header: Record<string, unknown> = {}): Promise<string> => issueSession(send, world.staff, IPM.D1, header);
const tokenOf = (id: string): string => row("InspectionSession", id)["verificationToken"] as string;
const numberOf = (id: string): string => row("InspectionSession", id)["reportNumber"] as string;

const DOCUMENT_KEYS = [
  "checklist",
  "countersignEnabled",
  "device",
  "facility",
  "flags",
  "floor",
  "generatedAt",
  "inspectionOutcome",
  "integrity",
  "issuer",
  "kind",
  "legacyVisitNumber",
  "lineage",
  "maintenanceOutcome",
  "notes",
  "performedAt",
  "performer",
  "recommendation",
  "reportNumber",
  "room",
  "scheme",
  "sections",
  "sessionId",
  "signatures",
  "status",
  "submittedAt",
  "timeZone",
  "verifyUrl",
  "visitNumber",
];

describe("GET /ipm/sessions/:sessionId/report-document — § 10.1", () => {
  it("an issued report: its strict key set, the snapshots, the sections in read order, a configured QR link and integrity `match`", async () => {
    ENV["IPM_VERIFY_BASE_URL"] = "https://app.example.test/verify/ipm/";
    const id = await issue();
    const res = await send(world.bound, "GET", `/${id}/report-document`);
    expect([res.status, res.body.message]).toEqual([200, "IPM report document"]);
    const doc = data(res);
    expect(Object.keys(doc).sort()).toEqual(DOCUMENT_KEYS);
    expect(doc).toMatchObject({
      scheme: "ipm-report-v1",
      kind: "issued",
      status: "submitted",
      reportNumber: numberOf(id),
      verifyUrl: `https://app.example.test/verify/ipm/${numberOf(id)}?t=${tokenOf(id)}`,
      visitNumber: 2,
      timeZone: "Asia/Jakarta",
      facility: { id: IPM.F1, name: "Facility One", code: "F-0001" },
      checklist: { templateVersionId: IPM.TYPE_V1, versionNumber: 2, deviceTypeName: "Synthetic Pump Type", contentHash: "b".repeat(64) },
      signatures: [],
      countersignEnabled: false,
      integrity: { scheme: "ipm-report-v1", state: "match" },
      flags: { capturedOffline: false, imported: false },
    });
    expect(Object.keys(doc["issuer"] as object).sort()).toEqual(["address", "city", "country", "email", "logoUrl", "name", "phone", "state", "website", "zipCode"]);
    expect((doc["sections"] as { section: string }[]).map((s) => s.section)).toEqual(["environment", "other_safety", "electrical_safety", "function", "performance"]);
    const leak = (doc["sections"] as { items: Record<string, unknown>[] }[])[2]?.items[0];
    expect(leak).toMatchObject({ label: "Synthetic leakage check", unit: "µA", limitText: "≤ 100 µA", measuredValue: "50", computedOutcome: "pass", required: true });
    expect(leak).not.toHaveProperty("sortOrder");
    const text = JSON.stringify(doc);
    for (const secret of [world.tenantA, world.staff.id, "legacyKey", "clientRef", "sideEffects", "ipAddress", "workOrderId"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("the QR link falls back to CERT_VERIFY_BASE_URL + /ipm, then to the API form on PUBLIC_BASE_URL, then localhost", () => {
    ENV["CERT_VERIFY_BASE_URL"] = "https://app.example.test/verify";
    expect(reportService.ipmVerifyUrl("IPM-F-1-20261008-001", "tok/en")).toBe("https://app.example.test/verify/ipm/IPM-F-1-20261008-001?t=tok%2Fen");
    delete ENV["CERT_VERIFY_BASE_URL"];
    const saved = ENV["PUBLIC_BASE_URL"];
    ENV["PUBLIC_BASE_URL"] = "https://api.example.test/";
    expect(reportService.ipmVerifyUrl("IPM-F-1-20261008-001", "t")).toBe("https://api.example.test/api/v1/ipm/verify/IPM-F-1-20261008-001?token=t");
    delete ENV["PUBLIC_BASE_URL"];
    expect(reportService.ipmVerifyUrl("IPM-F-1-20261008-001", "t")).toBe("http://localhost:5000/api/v1/ipm/verify/IPM-F-1-20261008-001?token=t");
    if (saved !== undefined) {
      ENV["PUBLIC_BASE_URL"] = saved;
    }
  });

  it("the tenant's live logo is served, unhashed; an ad-hoc row prints its own unit and reference", async () => {
    setRow("Tenant", world.tenantA, { logo: "tenant-logo-1700000000000.png" });
    const id = await issueSession(send, world.staff, IPM.D1, {}, [
      { inputKind: "measured", templateItemId: IPM.ITEM_BASE_TEMP, value: "24.50" },
      { inputKind: "tri_state", templateItemId: IPM.ITEM_PLACEMENT, outcome: "pass" },
      { inputKind: "measured_with_limit", templateItemId: IPM.ITEM_LEAK, value: "50" },
      { inputKind: "setting_measured_reference", templateItemId: IPM.ITEM_PRESSURE, value1: "120", value2: "121", outcome: "pass" },
      { inputKind: "tri_state", templateItemId: IPM.ITEM_POWER, outcome: "pass" },
      { inputKind: "measured_with_limit", adHoc: { section: "electrical_safety", label: "Synthetic extra leakage", unit: "mA", symbol: "I", referenceText: "≤ 0.5" }, value: "0.2", outcome: "pass" },
    ]);
    const doc = data(await send(world.staff, "GET", `/${id}/report-document`));
    expect((doc["issuer"] as Record<string, unknown>)["logoUrl"]).toMatch(/tenant-logo-1700000000000\.png$/);
    const adHoc = (doc["sections"] as { section: string; items: Record<string, unknown>[] }[]).find((s) => s.section === "electrical_safety")?.items[1];
    expect(adHoc).toMatchObject({ adHoc: true, unit: "mA", symbol: "I", reference: "≤ 0.5", limitText: "≤ 0.5", required: false });
    expect((doc["integrity"] as Record<string, unknown>)["state"]).toBe("match");
  });

  it("a draft previews to its creator only — no number, link, integrity or signatures; anyone else in scope: 403", async () => {
    const res = await send(world.bound, "GET", `/${IPM.DRAFT1}/report-document`);
    expect(res.status).toBe(200);
    expect(data(res)).toMatchObject({
      kind: "preview",
      status: "draft",
      reportNumber: null,
      verifyUrl: null,
      visitNumber: null,
      submittedAt: null,
      integrity: null,
      signatures: [],
      device: { name: "Alat sintetis 1", qrCode: "TST000001" },
      checklist: { templateVersionId: IPM.TYPE_V1 },
    });
    const other = await send(world.bound2, "GET", `/${IPM.DRAFT1}/report-document`);
    expect([other.status, other.body.message]).toEqual([403, "Only the technician who started this IPM can preview it."]);
  });

  it("a correction draft's preview names the report it supersedes; a draft of a deleted device is a 404", async () => {
    const id = await issue();
    const correction = await send(world.staff, "POST", `/${id}/corrections`, { reason: "Synthetic correction" });
    const draftId = data(correction)["id"] as string;
    expect((data(await send(world.staff, "GET", `/${draftId}/report-document`))["lineage"] as Record<string, unknown>)["supersedesReportNumber"]).toBe(numberOf(id));
    setRow("CalibrationDevice", IPM.D1, { isDeleted: true });
    expect((await send(world.staff, "GET", `/${draftId}/report-document`)).status).toBe(404);
  });

  it("a draft pinned to no version (imported history corrected) previews as imported", async () => {
    setRow("InspectionSession", IPM.DRAFT1, { templateVersionId: null });
    expect(data(await send(world.bound, "GET", `/${IPM.DRAFT1}/report-document`))["checklist"]).toEqual({ imported: true });
  });

  it("a discarded draft has no report (409 IPM_NOT_SUBMITTED); an unknown id is a 404", async () => {
    setRow("InspectionSession", IPM.DRAFT1, { status: "discarded" });
    const res = await send(world.bound, "GET", `/${IPM.DRAFT1}/report-document`);
    expect([res.status, res.body.code, res.body.message]).toEqual([409, "IPM_NOT_SUBMITTED", "A discarded draft has no report."]);
    expect((await send(world.bound, "GET", `/${MISSING}/report-document`)).status).toBe(404);
  });

  it("an altered stored hash: `mismatch` shown, an error logged naming the session, counted — and the document still served", async () => {
    const id = await issue();
    setRow("InspectionSession", id, { reportContentHash: "0".repeat(64) });
    const error = jest.spyOn(logger, "error");
    const before = reportService.integrityMismatchCount();
    const doc = data(await send(world.staff, "GET", `/${id}/report-document`));
    expect(doc["integrity"]).toEqual({ scheme: "ipm-report-v1", hash: "0".repeat(64), state: "mismatch" });
    expect(error).toHaveBeenCalledWith("IPM report integrity mismatch", { code: "IPM_REPORT_INTEGRITY_MISMATCH", sessionId: id, scheme: "ipm-report-v1" });
    expect(reportService.integrityMismatchCount()).toBe(before + 1);
  });

  it("an imported report is marked imported (no checklist version, no signatures)", async () => {
    const id = await issue();
    setRow("InspectionSession", id, { legacyKey: "TST000001|2026-10-08", templateVersionId: null, reportHashScheme: null });
    const doc = data(await send(world.staff, "GET", `/${id}/report-document`));
    expect([doc["checklist"], doc["flags"], (doc["integrity"] as Record<string, unknown>)["scheme"]]).toEqual([
      { imported: true },
      { capturedOffline: false, imported: true },
      "ipm-report-v1",
    ]);
  });

  it("render=pdf writes one EXPORT audit row before the document (format, language, number — no content)", async () => {
    const id = await issue();
    const res = await send(world.bound, "GET", `/${id}/report-document`, {}, { render: "pdf", lang: "id" });
    expect(res.status).toBe(200);
    const rows = mdb.rows("AuditLog").filter((a) => (a["changes"] as Record<string, unknown> | null)?.["operation"] === "RENDER_IPM_REPORT");
    expect(rows).toEqual([expect.objectContaining({ action: "EXPORT", resourceType: "InspectionSession", resourceId: id, clientFacilityId: IPM.F1, userId: IPM.BOUND })]);
    expect(rows[0]?.["changes"]).toEqual({ operation: "RENDER_IPM_REPORT", format: "pdf", language: "id", reportNumber: numberOf(id), kind: "issued" });
    await send(world.bound, "GET", `/${IPM.DRAFT1}/report-document`, {}, { render: "print" });
    const preview = mdb.rows("AuditLog").filter((a) => (a["changes"] as Record<string, unknown> | null)?.["kind"] === "preview");
    expect(preview[0]?.["changes"]).toMatchObject({ format: "print", language: null, reportNumber: null });
    expect(mdb.rows("AuditLog").filter((a) => a["action"] === "EXPORT")).toHaveLength(2);
    await send(world.bound, "GET", `/${id}/report-document`);
    expect(mdb.rows("AuditLog").filter((a) => a["action"] === "EXPORT")).toHaveLength(2);
  });

  it("a failed render audit fails the read: 500, nothing rendered", async () => {
    const id = await issue();
    jest.spyOn(auditService, "logAction").mockRejectedValueOnce(new Error("forced"));
    const res = await send(world.staff, "GET", `/${id}/report-document`, {}, { render: "pdf" });
    expect([res.status, res.body.data ?? null]).toEqual([500, null]);
  });
});

describe("GET /ipm/verify/:reportNumber?token= — public, by token only (§ 9)", () => {
  it("the right token: the verdict, the signatures, the integrity and the document without its link — no id of a person, no tenant, no token", async () => {
    const id = await issue();
    const res = await verify(numberOf(id), { token: tokenOf(id) });
    expect([res.status, res.body.message]).toEqual([200, "IPM report verification result"]);
    const verdict = data(res);
    expect(verdict).toMatchObject({
      found: true,
      reportNumber: numberOf(id),
      status: "issued",
      supersededBy: null,
      voidedAt: null,
      issuer: { name: expect.any(String) as unknown },
      facility: { name: "Facility One" },
      device: { name: "Alat sintetis 1", qrCode: "TST000001", serialNumber: "SN-1" },
      visitNumber: 2,
      recommendation: "fit_for_use",
      signatures: [],
      countersignEnabled: false,
      integrity: { state: "match" },
      document: { kind: "issued", verifyUrl: null, sessionId: id },
    });
    const text = JSON.stringify(verdict);
    for (const secret of [world.tenantA, world.staff.id, tokenOf(id), "voidReason", "legacyKey", "clientRef"]) {
      expect(text).not.toContain(secret);
    }
  });

  it.each([
    ["no token", (n: string) => [n, {}]],
    ["a wrong token", (n: string) => [n, { token: "A".repeat(32) }]],
    ["a malformed token", (n: string) => [n, { token: "short" }]],
    ["a malformed number", () => ["not-a-number", { token: "A".repeat(32) }]],
    ["an unknown number with the right token", (_n: string, t: string) => ["IPM-F-0001-20200101-999", { token: t }]],
  ] as const)("%s → the one identical 404", async (_label, make) => {
    const id = await issue();
    const [number, query] = (make as (n: string, t: string) => [string, Record<string, unknown>])(numberOf(id), tokenOf(id));
    const res = await verify(number, query);
    const { success, status, message, data: body } = res.body as Record<string, unknown>;
    expect([res.status, { success, status, message, data: body }]).toEqual([404, NOT_FOUND]);
  });

  it("superseded: the newer report's number and date, never its token; voided: the date, never the reason", async () => {
    const id = await issue();
    const correction = await send(world.staff, "POST", `/${id}/corrections`, { reason: "Synthetic correction" });
    const draftId = data(correction)["id"] as string;
    await send(world.staff, "PUT", `/${draftId}/results`, { revision: 0, results: IPM_RESULTS });
    expect((await send(world.staff, "POST", `/${draftId}/submit`, { revision: 1 })).status).toBe(200);
    const superseded = data(await verify(numberOf(id), { token: tokenOf(id) }));
    expect([superseded["status"], superseded["supersededBy"]]).toEqual(["superseded", { reportNumber: numberOf(draftId), at: expect.any(String) as unknown }]);
    expect(JSON.stringify(superseded)).not.toContain(tokenOf(draftId));
    await send(world.admin, "POST", `/${draftId}/void`, { reason: "Synthetic duplicate visit" });
    const voided = data(await verify(numberOf(draftId), { token: tokenOf(draftId) }));
    expect([voided["status"], typeof voided["voidedAt"]]).toEqual(["voided", "string"]);
    expect(JSON.stringify(voided)).not.toContain("Synthetic duplicate visit");
  });

  it("a facility's report verifies with no principal at all (the reviewed token lookup)", async () => {
    const id = await issueSession(send, world.bound2, IPM.D1);
    expect((await verify(numberOf(id), { token: tokenOf(id) })).status).toBe(200);
  });

  it("only an answer that is not a verdict counts against ipmVerify (60 / 15 min per address) — beyond it 429; a verdict still answers", async () => {
    const id = await issue();
    const saved = ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"];
    ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = "1";
    try {
      let refused: Res | null = null;
      for (let i = 0; i < 61 && !refused; i += 1) {
        const res = await verify(numberOf(id), { token: "A".repeat(32) });
        refused = res.status === 429 ? res : null;
      }
      expect(refused?.body).toMatchObject({ success: false, status: 429, data: null });
      expect((await verify(numberOf(id), { token: tokenOf(id) })).status).toBe(200);
    } finally {
      if (saved === undefined) {
        delete ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"];
      } else {
        ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = saved;
      }
    }
  });

  it("an unforeseen failure is not turned into a 404", async () => {
    jest.spyOn(reportService, "verifyReport").mockRejectedValueOnce(new Error("boom"));
    expect((await verify("IPM-F-0001-20261008-001", { token: "A".repeat(32) })).status).toBe(500);
  });
});
