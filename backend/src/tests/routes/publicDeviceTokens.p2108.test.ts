/**
 * P21-08 — a device's public link, for staff (ADR-138 § 1, Am. 1 § 1, § 6, § 7; spec
 * MEMORY/specs/P19-07-public-device-page.md § 4 – § 6, § 12 PD-1, PD-4, PD-5, PD-8):
 *  - two tenants: another tenant's device answers 404 on all four routes, identical to a missing one,
 *    and nothing is written; the owning tenant reaches it;
 *  - two facilities: a facility-bound account is refused (403 FACILITY_ROUTE_REFUSED) on all four,
 *    for its own facility's device too, before a parameter is read;
 *  - issue / rotate / revoke: the state machine with its 409 codes, the token shown once and stored
 *    only as its SHA-256, one audit row per act (the hash prefix, never the token), a failed audit
 *    write rolling the act back;
 *  - the device's delete revokes its link (`device_deleted`); the link URL from configuration.
 *
 * @two-tenant api/calibrationDevices.route.ts GET /:calibrationDeviceId/public-token
 * @two-tenant api/calibrationDevices.route.ts POST /:calibrationDeviceId/public-token
 * @two-tenant api/calibrationDevices.route.ts POST /:calibrationDeviceId/public-token/rotate
 * @two-tenant api/calibrationDevices.route.ts DELETE /:calibrationDeviceId/public-token
 *
 * REAL: the router chain, the controller, the services, the models and the tenant + facility hooks
 * over memoryDb. Synthetic data only.
 */
import { createHash } from "node:crypto";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as TenantSuite from "../fixtures/twoTenantSuite";
import type { Principal } from "../fixtures/routeClient";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import type * as TokenService from "../../services/publicDeviceToken.service";
import type DevicesServiceModule from "../../services/calibrationDevices.service";
import type AuditServiceModule from "../../services/audit.service";
import type ModelsModule from "../../models";
import type * as JobContext from "../../utils/jobContext.util";
import type * as PersonDisplay from "../../services/personDisplay.service";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import { environment } from "../../config/env";
import type { TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../config/socket", () => ({ getIo: () => ({ to: () => ({ emit: () => undefined }) }) }));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof TenantSuite>("../fixtures/twoTenantSuite");
const devices = jest.requireActual<typeof DevicesRoute>("../../routes/api/calibrationDevices.route");
const tokens = jest.requireActual<typeof TokenService>("../../services/publicDeviceToken.service");
const devicesService = jest.requireActual<typeof DevicesServiceModule>("../../services/calibrationDevices.service");
const auditService = jest.requireActual<typeof AuditServiceModule>("../../services/audit.service");
const models = jest.requireActual<typeof ModelsModule>("../../models");
const personDisplay = jest.requireActual<typeof PersonDisplay>("../../services/personDisplay.service");

const ENV = environment();
const ROUTE_FILE = "api/calibrationDevices.route.ts";
const BASE = "/api/v1/calibration-devices";
const LINK_B = "1d000000-0000-4000-8000-0000000000fb";

interface Res {
  status: number;
  body: { data?: Record<string, unknown> | null; message?: string; code?: string };
  headers: Record<string, unknown>;
}

let world: IpmWorld;
let tenantCtx: SuiteContext;

const send = (who: Principal | null, method: string, path: string): Promise<Res> => {
  as(who);
  return call(devices, method, path, { routeFile: ROUTE_FILE, baseUrl: BASE }) as Promise<Res>;
};
const links = (): Record<string, unknown>[] => mdb.rows("PublicDeviceToken");
const audits = (): Record<string, unknown>[] => mdb.rows("AuditLog");
const sha = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
const activeLinkOfB = (): Record<string, unknown> => ({
  id: LINK_B,
  tenantId: world.tenantB,
  deviceId: IPM.DB,
  tokenHash: "b".repeat(64),
  createdBy: world.other.id,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  revokedAt: null,
  revokedBy: null,
  revokedReason: null,
});

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  tenantCtx = { owner: world.other, other: world.staff };
  delete ENV["PUBLIC_DEVICE_BASE_URL"];
  delete ENV["FRONTEND_URL"];
});

afterEach(() => {
  jest.restoreAllMocks();
});

twoTenantSuite({
  module: "public device link (P21-08, PD-5)",
  router: devices,
  mdb,
  context: () => tenantCtx,
  routes: [
    { key: "GET /:calibrationDeviceId/public-token", method: "GET", path: (id) => `/${id}/public-token`, id: () => IPM.DB, ownerStatus: 200 },
    {
      key: "POST /:calibrationDeviceId/public-token",
      method: "POST",
      path: (id) => `/${id}/public-token`,
      id: () => IPM.DB,
      ownerStatus: 201,
      writes: ["PublicDeviceToken", "AuditLog"],
    },
    {
      key: "POST /:calibrationDeviceId/public-token/rotate",
      method: "POST",
      path: (id) => `/${id}/public-token/rotate`,
      id: () => IPM.DB,
      before: () => mdb.seed("PublicDeviceToken", activeLinkOfB()),
      ownerStatus: 201,
      writes: ["PublicDeviceToken", "AuditLog"],
    },
    {
      key: "DELETE /:calibrationDeviceId/public-token",
      method: "DELETE",
      path: (id) => `/${id}/public-token`,
      id: () => IPM.DB,
      before: () => mdb.seed("PublicDeviceToken", activeLinkOfB()),
      ownerStatus: 200,
      writes: ["PublicDeviceToken", "AuditLog"],
    },
  ],
});

describe("two facilities — not facility-accessible (PD-4: a facility account never mints a public link)", () => {
  it.each([
    ["GET", "/public-token"],
    ["POST", "/public-token"],
    ["POST", "/public-token/rotate"],
    ["DELETE", "/public-token"],
  ])("%s %s: a bound account is refused 403 for its own facility's device, identical to an invalid id", async (method, suffix) => {
    const own = await send(world.bound, method, `/${IPM.D1}${suffix}`);
    const invalid = await send(world.bound, method, `/not-a-uuid${suffix}`);
    expect([own.status, own.body.code]).toEqual([403, "FACILITY_ROUTE_REFUSED"]);
    expect(invalid.body).toEqual(own.body);
    expect(links()).toEqual([]);
  });

  it("unbound staff reach a device of either facility", async () => {
    expect((await send(world.staff, "POST", `/${IPM.D1}/public-token`)).status).toBe(201);
    expect((await send(world.staff, "POST", `/${IPM.D2}/public-token`)).status).toBe(201);
  });
});

describe("issue, rotate, revoke (Am. 1 § 6; PD-1)", () => {
  it("issue: 201, the token once (22 base64url characters) and its URL; only the SHA-256 is stored; no-store", async () => {
    const res = await send(world.staff, "POST", `/${IPM.D1}/public-token`);
    const { token, url, issuedAt } = res.body.data as { token: string; url: string; issuedAt: string };
    expect([res.status, /^[A-Za-z0-9_-]{22}$/.test(token), url, typeof issuedAt, res.headers["cache-control"]]).toEqual([
      201,
      true,
      `http://localhost:3000/d/${token}`,
      "string",
      "no-store",
    ]);
    const [row] = links();
    expect(row).toMatchObject({ tenantId: world.tenantA, deviceId: IPM.D1, tokenHash: sha(token), createdBy: world.staff.id });
    expect(row?.["revokedAt"] ?? null).toBeNull();
    expect(JSON.stringify(links())).not.toContain(token);
  });

  it("a second issue is 409 PUBLIC_TOKEN_ACTIVE and changes nothing", async () => {
    await send(world.staff, "POST", `/${IPM.D1}/public-token`);
    const before = mdb.dump();
    const again = await send(world.staff, "POST", `/${IPM.D1}/public-token`);
    expect([again.status, again.body.code, again.body.data]).toEqual([409, "PUBLIC_TOKEN_ACTIVE", null]);
    expect(mdb.dump()).toEqual(before);
  });

  it("rotate: the old link revoked as `rotated` by the caller, a new one active — one transaction, one audit row", async () => {
    const first = (await send(world.staff, "POST", `/${IPM.D1}/public-token`)).body.data as { token: string };
    const rotated = await send(world.staff, "POST", `/${IPM.D1}/public-token/rotate`);
    const second = rotated.body.data as { token: string };
    expect([rotated.status, second.token === first.token]).toEqual([201, false]);
    const old = links().find((l) => l["tokenHash"] === sha(first.token));
    const now = links().find((l) => l["tokenHash"] === sha(second.token));
    expect([old?.["revokedReason"], old?.["revokedBy"], old?.["revokedAt"] instanceof Date, now?.["revokedAt"] ?? null]).toEqual(["rotated", world.staff.id, true, null]);
    const ops = audits().map((a) => (a["changes"] as { operation: string }).operation);
    expect(ops).toEqual(["ISSUE_PUBLIC_DEVICE_LINK", "ROTATE_PUBLIC_DEVICE_LINK"]);
  });

  it("revoke: 200 with the time; then revoke and rotate are 409 PUBLIC_TOKEN_NONE", async () => {
    await send(world.staff, "POST", `/${IPM.D1}/public-token`);
    const revoked = await send(world.staff, "DELETE", `/${IPM.D1}/public-token`);
    expect([revoked.status, typeof revoked.body.data?.["revokedAt"], links()[0]?.["revokedReason"]]).toEqual([200, "string", "revoked"]);
    for (const [method, suffix] of [
      ["DELETE", "/public-token"],
      ["POST", "/public-token/rotate"],
    ] as const) {
      const res = await send(world.staff, method, `/${IPM.D1}${suffix}`);
      expect([res.status, res.body.code]).toEqual([409, "PUBLIC_TOKEN_NONE"]);
    }
  });

  it("every audit row names the device and the hash prefix — never the token or the full hash", async () => {
    const { token } = (await send(world.staff, "POST", `/${IPM.D1}/public-token`)).body.data as { token: string };
    await send(world.staff, "DELETE", `/${IPM.D1}/public-token`);
    const rows = audits();
    expect(rows.map((a) => [a["resourceType"], a["resourceId"], a["clientFacilityId"], a["action"]])).toEqual([
      ["CalibrationDevice", IPM.D1, IPM.F1, "CREATE"],
      ["CalibrationDevice", IPM.D1, IPM.F1, "UPDATE"],
    ]);
    expect((rows[0]?.["changes"] as { issued: { hashPrefix: string } }).issued.hashPrefix).toBe(sha(token).slice(0, 8));
    expect((rows[1]?.["changes"] as { revoked: { reason: string } }).revoked.reason).toBe("revoked");
    const text = JSON.stringify(rows);
    expect([text.includes(token), text.includes(sha(token))]).toEqual([false, false]);
  });

  it("a failed audit write rolls the issue back (the audit row is inside the transaction)", async () => {
    jest.spyOn(auditService, "logAction").mockRejectedValueOnce(new Error("audit down"));
    const res = await send(world.staff, "POST", `/${IPM.D1}/public-token`);
    expect(res.status).toBe(500);
    expect(mdb.committed().filter((w) => w.model === "PublicDeviceToken")).toEqual([]);
  });

  it("a racing insert (the partial UNIQUE) is the 409; any other insert failure is not", async () => {
    const unique = Object.assign(new Error("duplicate"), { name: "SequelizeUniqueConstraintError" });
    const create = jest.spyOn(models.PublicDeviceToken, "create").mockRejectedValueOnce(unique);
    expect((await send(world.staff, "POST", `/${IPM.D1}/public-token`)).body.code).toBe("PUBLIC_TOKEN_ACTIVE");
    create.mockRejectedValueOnce(new Error("disk full"));
    expect((await send(world.staff, "POST", `/${IPM.D1}/public-token`)).status).toBe(500);
    create.mockRejectedValueOnce("not an error");
    expect((await send(world.staff, "POST", `/${IPM.D1}/public-token`)).status).toBe(500);
  });

  it("a link is minted by a person: no user in the principal is 403", async () => {
    await expect(tokens.issueLink(world.tenantA as TenantId, IPM.D1, {})).rejects.toMatchObject({ status: 403 });
  });
});

describe("the link's state (never the token or its hash)", () => {
  it("no link yet: inactive, the tenant's setting (off when unset)", async () => {
    const res = await send(world.staff, "GET", `/${IPM.D1}/public-token`);
    expect(res.body.data).toEqual({ active: false, issuedAt: null, issuedBy: null, lastRevokedAt: null, setting: "off" });
  });

  it("an active link: who issued it and when; the last revocation; the setting as stored", async () => {
    mdb.seed("TenantSettings", { id: "5e770000-0000-4000-8000-000000000001", tenantId: world.tenantA, key: "public_device_page", value: "minimal" });
    await send(world.staff, "POST", `/${IPM.D1}/public-token`);
    await send(world.staff, "POST", `/${IPM.D1}/public-token/rotate`);
    const data = (await send(world.staff, "GET", `/${IPM.D1}/public-token`)).body.data as Record<string, unknown>;
    expect([data["active"], typeof data["issuedAt"], typeof data["lastRevokedAt"], data["setting"]]).toEqual([true, "string", "string", "minimal"]);
    expect(Object.keys(data["issuedBy"] as object).sort()).toEqual(["name", "organisation", "redacted", "role"]);
    expect(Object.keys(data).sort()).toEqual(["active", "issuedAt", "issuedBy", "lastRevokedAt", "setting"]);
  });

  it("an issuer with no user row is shown as the platform's support (personDisplay), never an id; no display at all reads as null", async () => {
    mdb.seed("PublicDeviceToken", { ...activeLinkOfB(), id: "1d000000-0000-4000-8000-0000000000fa", tenantId: world.tenantA, deviceId: IPM.D1, createdBy: "eeeeeeee-0000-4000-8000-00000000dead" });
    const shown = (await send(world.staff, "GET", `/${IPM.D1}/public-token`)).body.data?.["issuedBy"];
    expect(JSON.stringify(shown)).not.toContain("eeeeeeee");
    jest.spyOn(personDisplay, "displayPeople").mockResolvedValueOnce(new Map());
    expect((await send(world.staff, "GET", `/${IPM.D1}/public-token`)).body.data?.["issuedBy"]).toBeNull();
  });

  it("an unknown stored setting reads as off (fail closed)", async () => {
    mdb.seed("TenantSettings", { id: "5e770000-0000-4000-8000-000000000002", tenantId: world.tenantA, key: "public_device_page", value: "everything" });
    expect((await send(world.staff, "GET", `/${IPM.D1}/public-token`)).body.data?.["setting"]).toBe("off");
  });
});

describe("the device's delete revokes its link (Am. 1 § 7, PD-8)", () => {
  it("delete with an active link: revoked as `device_deleted` by the deleting user, with its own audit row", async () => {
    await send(world.staff, "POST", `/${IPM.D1}/public-token`);
    as(world.staff);
    const res = await send(world.staff, "DELETE", `/${IPM.D1}`);
    expect(res.status).toBe(200);
    expect(links()[0]).toMatchObject({ revokedReason: "device_deleted", revokedBy: world.staff.id });
    expect(audits().map((a) => (a["changes"] as { operation?: string }).operation)).toContain("REVOKE_PUBLIC_DEVICE_LINK");
  });

  it("delete with no link revokes nothing; a delete by no user leaves `revokedBy` empty", async () => {
    expect((await send(world.staff, "DELETE", `/${IPM.D2}`)).status).toBe(200);
    expect(links()).toEqual([]);
    const { runForTenant } = jest.requireActual<typeof JobContext>("../../utils/jobContext.util");
    mdb.seed("PublicDeviceToken", activeLinkOfB());
    await runForTenant(world.tenantB, () => devicesService.deleteCalibrationDevice(world.tenantB as TenantId, IPM.DB, { systemActor: "system:retention-purge" }));
    expect(links()[0]).toMatchObject({ revokedReason: "device_deleted", revokedBy: null });
  });
});

describe("the link's URL comes from configuration, never from the request (ADR-100)", () => {
  it("PUBLIC_DEVICE_BASE_URL, else FRONTEND_URL + /d, else the development default", () => {
    expect(tokens.publicDeviceUrl("abc")).toBe("http://localhost:3000/d/abc");
    ENV["FRONTEND_URL"] = "https://app.example.test/";
    expect(tokens.publicDeviceUrl("abc")).toBe("https://app.example.test/d/abc");
    ENV["PUBLIC_DEVICE_BASE_URL"] = "https://kalibrasi.example.test/d/";
    expect(tokens.publicDeviceUrl("abc")).toBe("https://kalibrasi.example.test/d/abc");
  });
});
