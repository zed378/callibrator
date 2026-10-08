/**
 * P21-04 — the IPM report's electronic signatures, row by row of P19-06 spec § 7.1 – § 7.4 and § 13
 * (ADR-126 Am. 2, Am. 5; UD-17 a working decision): the performer signs its own report once; the
 * IPSRS countersignature needs the tenant's setting, the performer's signature first, a FACILITY
 * MAINTENANCE user of the session's facility (or the self facility's own IPSRS) who did not submit it
 * — each refusal asserting its top-level `code` AND its explanation; a wrong credential is the 401
 * with no signature; a stored hash that no longer matches cannot be signed; the signature binds the
 * stored hash; its audit row is inside the transaction; the countersigners are notified (AM-21) and
 * `ipm:signed` reaches the tenant and facility rooms only (G-19).
 *
 * REAL: the routers' chains, the controller, the services, the models and the tenant + facility hooks
 * over memoryDb; the credential check (certificate.service#verifySignerCredentials, tested by its
 * own suites) is a spy. Synthetic data only.
 */
import { UniqueConstraintError } from "sequelize";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TwoTenantWorld } from "../fixtures/routeClient";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import type * as SignatureService from "../../services/ipmSignature.service";
import type CertificateServiceModule from "../../services/certificate.service";
import type AuditServiceModule from "../../services/audit.service";
import type * as Recipients from "../../services/notificationRecipients";
import type ModelsModule from "../../models";
import { AppError } from "../../utils/appError.util";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import { answerAdvisoryLocks, issueSession } from "../fixtures/ipmIssue";
import { ROLE_NAMES } from "../../constants";
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
const signatureService = jest.requireActual<typeof SignatureService>("../../services/ipmSignature.service");
const certificateService = jest.requireActual<typeof CertificateServiceModule>("../../services/certificate.service");
const auditService = jest.requireActual<typeof AuditServiceModule>("../../services/audit.service");
const recipients = jest.requireActual<typeof Recipients>("../../services/notificationRecipients");
const models = jest.requireActual<typeof ModelsModule>("../../models");

const FM1 = "fa000000-0000-4000-8000-0000000000f1";
const FM2 = "fa000000-0000-4000-8000-0000000000f2";
const FMU = "fa000000-0000-4000-8000-0000000000aa";
const FMU2 = "fa000000-0000-4000-8000-0000000000ab";
const DSELF = "d1000000-0000-4000-8000-0000000000aa";

interface Res {
  status: number;
  body: { data?: Record<string, unknown> | null; message?: string; code?: string; headId?: string };
}

let world: IpmWorld;
let fm1: Principal;
let fm2: Principal;
let fmUnbound: Principal;
let fmUnbound2: Principal;
let credential: jest.SpyInstance;

const fmOf = (fx: TwoTenantWorld, id: string, facility: string | null): Principal => {
  const base = fx.principal(fx.tenantA, "FACILITY_MAINTENANCE");
  const principal = { ...base, id, clientFacilityId: facility } as unknown as Principal;
  mdb.seed("User", {
    id,
    tenantId: world.tenantA,
    username: `fm-${id.slice(-2)}`,
    email: `fm-${id.slice(-2)}@example.test`,
    password: "x",
    firstName: "IPSRS",
    lastName: id.slice(-2),
    roleId: base.role.id,
    clientFacilityId: facility,
    status: "ACTIVE",
    isActive: true,
  });
  return principal;
};

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  world = seedIpmWorld(mdb, fx, seedTenants);
  answerAdvisoryLocks(mdb);
  mdb.seed("Role", { id: fx.principal(fx.tenantA, "FACILITY_MAINTENANCE").role.id, name: ROLE_NAMES.FACILITY_MAINTENANCE, roleLevel: 5, status: "active" });
  fm1 = fmOf(fx, FM1, IPM.F1);
  fm2 = fmOf(fx, FM2, IPM.F2);
  fmUnbound = fmOf(fx, FMU, null);
  fmUnbound2 = fmOf(fx, FMU2, null);
  mdb.seed("CalibrationDevice", { id: DSELF, tenantId: world.tenantA, clientFacilityId: IPM.SELF, name: "Alat sintetis self", qrCode: "TST0000AA", deviceTypeId: IPM.TYPE, status: "active", isDeleted: false });
  mockEmits.length = 0;
  credential = jest.spyOn(certificateService, "verifySignerCredentials").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const send = (principal: Principal, method: string, url: string, body: unknown = {}): Promise<Res> => {
  as(principal);
  return call(sessions, method, url, { body, routeFile: "api/ipmSessions.route.ts" }) as Promise<Res>;
};
const sign = (principal: Principal, id: string, kind: "performer" | "countersign", over: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Res> => {
  as(principal);
  return call(sessions, "POST", `/${id}/signatures`, {
    body: { kind, authMethod: "password", authPayload: "synthetic-secret", meaningAcknowledged: true, ...over },
    headers,
    routeFile: "api/ipmSessions.route.ts",
  }) as Promise<Res>;
};
const issue = (principal: Principal = world.staff, deviceId: string = IPM.D1): Promise<string> =>
  issueSession(send, principal, deviceId);
const setRow = (model: string, id: string, values: Record<string, unknown>): void => {
  const live = mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown };
  Object.assign(live.rowsOf(live.model(model)).find((r) => r["id"] === id) as Record<string, unknown>, values);
};
const sessionRow = (id: string): Record<string, unknown> => mdb.rows("InspectionSession").find((r) => r["id"] === id) as Record<string, unknown>;
const signatures = (): Record<string, unknown>[] => mdb.rows("InspectionSessionSignature");
const audits = (operation: string): Record<string, unknown>[] =>
  mdb.rows("AuditLog").filter((a) => (a["changes"] as Record<string, unknown> | null)?.["operation"] === operation);
const countersignOn = (): void => {
  mdb.seed("TenantSettings", { tenantId: world.tenantA, key: "ipm_countersign_enabled", value: "true" });
};
const expectCode = (res: Res, status: number, code: string, message: string | RegExp): void => {
  expect([res.status, res.body.code]).toEqual([status, code]);
  if (typeof message === "string") {
    expect(res.body.message).toBe(message);
  } else {
    expect(res.body.message).toMatch(message);
  }
};

describe("the performer's signature (§ 7.1 row 1, § 7.2)", () => {
  it("the performer signs once: the stored hash bound, its snapshot, the meaning, the audit row, the event — the credential re-checked", async () => {
    const id = await issue();
    mockEmits.length = 0;
    const res = await sign(world.staff, id, "performer");
    expect([res.status, res.body.message]).toEqual([201, "IPM report signed"]);
    expect(res.body.data).toMatchObject({ kind: "performer", meaning: "authorship", authMethod: "password", valid: true, signedAt: expect.any(String) as unknown });
    expect(res.body.data).not.toHaveProperty("signerId");
    const [row] = signatures();
    expect(row).toMatchObject({ sessionId: id, kind: "performer", signerId: world.staff.id, documentHash: sessionRow(id)["reportContentHash"], clientFacilityId: IPM.F1 });
    expect(Object.keys(row?.["signerSnapshot"] as object).sort()).toEqual(["name", "organisation", "role"]);
    expect(credential).toHaveBeenCalledWith(world.staff.id, "password", "synthetic-secret", expect.objectContaining({ resourceType: "InspectionSession", resourceId: id, operation: "SIGN_IPM_REPORT" }));
    expect(audits("SIGN_IPM_REPORT")).toEqual([expect.objectContaining({ action: "APPROVE", resourceId: id, clientFacilityId: IPM.F1 })]);
    expect(audits("SIGN_IPM_REPORT")[0]?.["changes"]).toEqual({ operation: "SIGN_IPM_REPORT", kind: "performer", reportNumber: sessionRow(id)["reportNumber"], documentHash: sessionRow(id)["reportContentHash"], authMethod: "password" });
    expect(mockEmits).toEqual([{ event: "ipm:signed", rooms: [`tenant_${world.tenantA}`, `facility_${world.tenantA}_${IPM.F1}`], payload: { sessionId: id, kind: "performer" } }]);
    const doc = (await send(world.staff, "GET", `/${id}/report-document`)).body.data as Record<string, unknown>;
    expect(doc["signatures"]).toEqual([expect.objectContaining({ kind: "performer", valid: true })]);

    expectCode(await sign(world.staff, id, "performer"), 409, "IPM_ALREADY_SIGNED", "The technician has already signed this report.");
  });

  it("the request's agent is kept on the row (at most 500 characters), never returned", async () => {
    const id = await issue();
    const res = await sign(world.staff, id, "performer", {}, { "user-agent": `Synthetic/${"x".repeat(600)}` });
    expect(res.status).toBe(201);
    expect(String(signatures()[0]?.["userAgent"])).toHaveLength(500);
    expect(JSON.stringify(res.body)).not.toContain("Synthetic/");
  });

  it("anyone else → 403 IPM_SIGNATURE_NOT_PERFORMER", async () => {
    const id = await issue();
    expectCode(await sign(world.bound, id, "performer"), 403, "IPM_SIGNATURE_NOT_PERFORMER", "Only the technician who performed this IPM can sign its report.");
    expect(signatures()).toEqual([]);
  });

  it("a wrong credential is the 401 of the credential check — nothing signed", async () => {
    const id = await issue();
    credential.mockRejectedValueOnce(new AppError(401, "Invalid password for e-signature."));
    const res = await sign(world.staff, id, "performer");
    expect([res.status, res.body.message]).toEqual([401, "Invalid password for e-signature."]);
    expect(signatures()).toEqual([]);
  });

  it("a stored hash that no longer matches cannot be signed (409 IPM_REPORT_INTEGRITY); the document marks a stale signature invalid", async () => {
    const id = await issue();
    expect((await sign(world.staff, id, "performer")).status).toBe(201);
    setRow("InspectionSession", id, { notes: "altered after the fact" });
    const doc = (await send(world.staff, "GET", `/${id}/report-document`)).body.data as Record<string, unknown>;
    expect(doc["signatures"]).toEqual([expect.objectContaining({ valid: false })]);
    countersignOn();
    expectCode(await sign(fm1, id, "countersign"), 409, "IPM_REPORT_INTEGRITY", "This report failed its integrity check and cannot be signed. The operator has been alerted.");
  });

  it.each([
    ["a draft", { status: "draft" }, 409, "IPM_NOT_SUBMITTED", "Only a submitted IPM report can be signed."],
    ["a discarded draft", { status: "discarded" }, 409, "IPM_NOT_SUBMITTED", "Only a submitted IPM report can be signed."],
    ["a voided report", { status: "voided", voidedAt: new Date("2026-10-04T00:00:00Z") }, 409, "IPM_VOIDED", "This IPM was voided on 2026-10-04; a voided report is never signed."],
    ["an imported report", { legacyKey: "TST000001|2026-10-08" }, 409, "IPM_REPORT_IMPORTED", "This report was imported from the previous system; imported reports are not signed electronically."],
  ] as const)("%s → %s %s", async (_label, values, status, code, message) => {
    const id = await issue();
    setRow("InspectionSession", id, values);
    expectCode(await sign(world.staff, id, "performer"), status, code, message);
  });

  it("a superseded report → 409 IPM_SUPERSEDED with the head's id (sign the latest version)", async () => {
    const id = await issue();
    const head = await issue();
    setRow("InspectionSession", id, { supersededById: head, supersededAt: new Date("2026-10-05T00:00:00Z") });
    const res = await sign(world.staff, id, "performer");
    expectCode(res, 409, "IPM_SUPERSEDED", `This IPM was corrected on 2026-10-05; sign the latest version (report ${String(sessionRow(head)["reportNumber"])}).`);
    expect(res.body.headId).toBe(head);
    setRow("InspectionSession", head, { reportNumber: null });
    expect((await sign(world.staff, id, "performer")).body.message).toBe("This IPM was corrected on 2026-10-05; sign the latest version (report pending).");
  });

  it("a race on the one-per-kind unique answers the 409, not a 500", async () => {
    const id = await issue();
    jest.spyOn(models.InspectionSessionSignature, "create").mockRejectedValueOnce(new UniqueConstraintError({}));
    expectCode(await sign(world.staff, id, "performer"), 409, "IPM_ALREADY_SIGNED", "The technician has already signed this report.");
    await sign(world.staff, id, "performer");
    countersignOn();
    jest.spyOn(models.InspectionSessionSignature, "create").mockRejectedValueOnce(new UniqueConstraintError({}));
    expectCode(await sign(fm1, id, "countersign"), 409, "IPM_ALREADY_COUNTERSIGNED", "This report has already been countersigned.");
    jest.spyOn(models.InspectionSessionSignature, "create").mockRejectedValueOnce(new Error("boom"));
    expect((await sign(fm1, id, "countersign")).status).toBe(500);
  });

  it("a failure after the audit write leaves neither the signature nor the audit row", async () => {
    const id = await issue();
    const real = auditService.logAction.bind(auditService);
    jest.spyOn(auditService, "logAction").mockImplementation(async (entry, options) => {
      if ((entry.changes as Record<string, unknown> | undefined)?.["operation"] === "SIGN_IPM_REPORT") {
        await real(entry, options);
        throw new Error("forced");
      }
      return real(entry, options);
    });
    expect((await sign(world.staff, id, "performer")).status).toBe(500);
    expect(signatures()).toEqual([]);
    expect(audits("SIGN_IPM_REPORT")).toEqual([]);
  });

  it("the service refuses an API key (a signature is a person's act)", async () => {
    await expect(
      signatureService.signReport(world.tenantA as TenantId, { sessionId: IPM.S1, kind: "performer", authMethod: "password", authPayload: "x", meaningAcknowledged: true }, { userId: null }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("the IPSRS countersignature (§ 7.1 row 2, § 7.3)", () => {
  it("the facility's bound IPSRS countersigns after the performer: meaning review, audited; the performer's signature notified it", async () => {
    countersignOn();
    const notify = jest.spyOn(recipients, "recipientsFor").mockResolvedValue({ broadcast: true, boundUserIds: [FM1, IPM.BOUND] });
    const id = await issue();
    expect((await sign(world.staff, id, "performer")).status).toBe(201);
    expect(notify).toHaveBeenCalledWith({ tenantId: world.tenantA, clientFacilityId: IPM.F1 }, "esignature", expect.anything());
    expect(mdb.rows("Notification").map((n) => n["userId"])).toEqual([FM1]);
    expect(audits("IPM_COUNTERSIGN_NOTICE")).toHaveLength(1);
    const res = await sign(fm1, id, "countersign");
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: "countersign", meaning: "review" });
    expect(audits("COUNTERSIGN_IPM_REPORT")).toEqual([expect.objectContaining({ action: "APPROVE", userId: FM1 })]);
    expectCode(await sign(fm1, id, "countersign"), 409, "IPM_ALREADY_COUNTERSIGNED", "This report has already been countersigned.");
    const doc = (await send(world.staff, "GET", `/${id}/report-document`)).body.data as Record<string, unknown>;
    expect((doc["signatures"] as { kind: string }[]).map((s) => s.kind)).toEqual(["performer", "countersign"]);
  });

  it("no notice when the facility has no IPSRS to notify", async () => {
    countersignOn();
    jest.spyOn(recipients, "recipientsFor").mockResolvedValue({ broadcast: true, boundUserIds: [] });
    const id = await issue();
    await sign(world.staff, id, "performer");
    expect(mdb.rows("Notification")).toEqual([]);
  });

  it("switched off (the default) → 409 IPM_COUNTERSIGN_DISABLED; no notice to anyone", async () => {
    const id = await issue();
    await sign(world.staff, id, "performer");
    expect(mdb.rows("Notification")).toEqual([]);
    expectCode(await sign(fm1, id, "countersign"), 409, "IPM_COUNTERSIGN_DISABLED", "Electronic countersigning is switched off for this tenant; the IPSRS signs the printed report instead.");
  });

  it("before the performer's signature → 409 IPM_REPORT_NOT_SIGNED", async () => {
    countersignOn();
    const id = await issue();
    expectCode(await sign(fm1, id, "countersign"), 409, "IPM_REPORT_NOT_SIGNED", "The technician has not signed this report yet; it can be countersigned after the technician's signature.");
  });

  it("another role → 403 IPM_COUNTERSIGN_ROLE", async () => {
    countersignOn();
    const id = await issue();
    await sign(world.staff, id, "performer");
    expectCode(await sign(world.bound, id, "countersign"), 403, "IPM_COUNTERSIGN_ROLE", "Only the facility's IPSRS (FACILITY MAINTENANCE) can countersign an IPM report.");
  });

  it("provider staff (an unbound IPSRS) on a CLIENT facility → 403 IPM_COUNTERSIGN_FACILITY", async () => {
    countersignOn();
    const id = await issue();
    await sign(world.staff, id, "performer");
    expectCode(await sign(fmUnbound, id, "countersign"), 403, "IPM_COUNTERSIGN_FACILITY", "Provider staff cannot countersign for a client facility; the facility's own IPSRS countersigns.");
  });

  it("another facility's IPSRS → 404, identical to a missing session; nothing written", async () => {
    countersignOn();
    const id = await issue();
    await sign(world.staff, id, "performer");
    const res = await sign(fm2, id, "countersign");
    expect([res.status, res.body.message]).toEqual([404, "IPM session not found"]);
    expect(signatures()).toHaveLength(1);
  });

  it("a self-served hospital: its own IPSRS countersigns; the IPSRS who performed and submitted the IPM cannot (403 IPM_COUNTERSIGN_SOD)", async () => {
    countersignOn();
    const id = await issue(fmUnbound, DSELF);
    expect((await sign(fmUnbound, id, "performer")).status).toBe(201);
    expectCode(await sign(fmUnbound, id, "countersign"), 403, "IPM_COUNTERSIGN_SOD", "The technician who performed and submitted this IPM cannot countersign it; another person must review it.");
    expect((await sign(fmUnbound2, id, "countersign")).status).toBe(201);
  });
});
