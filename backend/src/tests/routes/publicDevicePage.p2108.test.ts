/**
 * P21-08 — the public device page `GET /api/v1/public/devices/:token` (ADR-138 § 2 – § 6, Am. 1
 * § 3 – § 5, § 8, § 9; spec MEMORY/specs/P19-07-public-device-page.md § 7 – § 9, § 12 FT-106, PD-2,
 * PD-3, PD-6, PD-7):
 *  - the answer: the exact field set under `minimal` and `minimal_with_report`; no serial, QR number,
 *    room, person or id anywhere in the body; the public status mapping; a retired device shown;
 *  - enumeration: a malformed, unknown or revoked token, a deleted device, an ended facility, a
 *    suspended or deleted tenant, a page that is off, unset or unparseable — ONE identical 404
 *    (status, body, headers);
 *  - the token's tenant only: tenant B's sticker shows tenant B's device and obeys tenant B's setting;
 *  - the headers on 200, 404 and 429; the budgets (per address, every 404 again, the global key);
 *  - the log: the path token redacted to its hash prefix (activity and access logs).
 *
 * REAL: the router chain, the controller, the services, the models and the tenant + facility hooks
 * over memoryDb; the request budgets over the rate limiter's memory store. Synthetic data only.
 */
import { createHash } from "node:crypto";
import morgan from "morgan";
import type { Request } from "express";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as PublicRoute from "../../routes/api/publicDevices.route";
import type * as PageService from "../../services/publicDevicePage.service";
import type * as ActivityLog from "../../middlewares/activityLog.middleware";
import type RateLimiterModule from "../../services/rateLimiter.redis.service";
import { API_ENDPOINTS } from "../../constants/rateLimitConstants";
import type ModelsModule from "../../models";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import { environment } from "../../config/env";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const publicRoute = jest.requireActual<typeof PublicRoute>("../../routes/api/publicDevices.route");
const pageService = jest.requireActual<typeof PageService>("../../services/publicDevicePage.service");
const { sanitizeUrl } = jest.requireActual<typeof ActivityLog>("../../middlewares/activityLog.middleware");
const rateLimiter = jest.requireActual<typeof RateLimiterModule>("../../services/rateLimiter.redis.service");
// The access log registers its `safe-url` token on morgan when it loads.
jest.requireActual("../../middlewares/accessLog.middleware");

const ENV = environment();
/** Synthetic tokens: D1's (tenant A, F1), D2's (tenant A, F2), DB's (tenant B), a revoked one. */
const TOKEN = Object.freeze({
  D1: "Zx3kQ9vN2mP4rT6wY8aC1d",
  D2: "Zx3kQ9vN2mP4rT6wY8aC2d",
  DB: "Zx3kQ9vN2mP4rT6wY8aCbd",
  REVOKED: "Zx3kQ9vN2mP4rT6wY8aCrd",
  UNKNOWN: "Zx3kQ9vN2mP4rT6wY8aCzz",
});
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const NOT_FOUND = { success: false, status: 404, code: "PUBLIC_DEVICE_NOT_FOUND", message: "No device answers to this link.", data: null };

interface Res {
  status: number;
  body: Record<string, unknown> & { data?: Record<string, unknown> | null };
  headers: Record<string, unknown>;
}

let world: IpmWorld;

const sha = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
const link = (n: number, tenantId: string, deviceId: string, token: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `1d000000-0000-4000-8000-00000000000${String(n)}`,
  tenantId,
  deviceId,
  tokenHash: sha(token),
  createdBy: tenantId === world.tenantA ? world.staff.id : world.other.id,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  revokedAt: null,
  revokedBy: null,
  revokedReason: null,
  ...extra,
});
const setting = (tenantId: string, value: string): void => {
  mdb.seed("TenantSettings", { id: tenantId === world.tenantA ? "5e770000-0000-4000-8000-00000000000a" : "5e770000-0000-4000-8000-00000000000b", tenantId, key: "public_device_page", value });
};
const setRow = (model: string, id: string, values: Record<string, unknown>): void => {
  const live = mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown };
  Object.assign(live.rowsOf(live.model(model)).find((r) => r["id"] === id) as Record<string, unknown>, values);
};
const open = (token: string): Promise<Res> => {
  as(null);
  return call(publicRoute, "GET", `/${encodeURIComponent(token)}`, { routeFile: "api/publicDevices.route.ts", baseUrl: "/api/v1/public/devices" }) as Promise<Res>;
};
const withoutDetails = (body: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(body).filter(([key]) => key !== "details"));
const withFactor = async (run: () => Promise<void>): Promise<void> => {
  const saved = ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"];
  ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = "1";
  try {
    await run();
  } finally {
    if (saved === undefined) {
      delete ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"];
    } else {
      ENV["RATE_LIMIT_NON_PRODUCTION_FACTOR"] = saved;
    }
  }
};

beforeEach(() => {
  mdb.reset();
  rateLimiter.clearMemoryStore();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
  mdb.seed("PublicDeviceToken", [
    link(1, world.tenantA, IPM.D1, TOKEN.D1),
    link(2, world.tenantA, IPM.D2, TOKEN.D2),
    link(3, world.tenantB, IPM.DB, TOKEN.DB),
    link(4, world.tenantA, IPM.D1, TOKEN.REVOKED, { revokedAt: new Date("2026-10-02T00:00:00Z"), revokedBy: world.staff.id, revokedReason: "rotated" }),
  ]);
  setting(world.tenantA, "minimal");
  delete ENV["IPM_VERIFY_BASE_URL"];
  delete ENV["CERT_VERIFY_BASE_URL"];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the answer (§ 8: an allow-list)", () => {
  it("minimal: exactly the device's identity, its facility's name, the calibration status and the last IPM date", async () => {
    const res = await open(TOKEN.D1);
    expect([res.status, res.body["success"], res.body.data]).toEqual([
      200,
      true,
      {
        device: { name: "Alat sintetis 1", type: "Synthetic Pump Type", manufacturer: null, model: null },
        facility: { name: "Facility One" },
        calibration: { status: "not_scheduled", nextDueDate: null },
        lastIpmDate: "2026-10-01",
        report: null,
      },
    ]);
  });

  it("never a serial, a QR number, a room, a person or any id — anywhere in the body (PD-3)", async () => {
    setRow("CalibrationDevice", IPM.D1, { locationId: IPM.ROOM1, manufacturer: "Maker", model: "M-1" });
    const text = JSON.stringify((await open(TOKEN.D1)).body);
    for (const forbidden of ["SN-1", "TST000001", "Ruang", "Teknisi", world.tenantA, IPM.D1, IPM.F1, TOKEN.D1, sha(TOKEN.D1)]) {
      expect([forbidden, text.includes(forbidden)]).toEqual([forbidden, false]);
    }
    expect(UUID.test(text)).toBe(false);
  });

  it("minimal_with_report: the link to the last report's verification page, only when it has a number", async () => {
    setRow("TenantSettings", "5e770000-0000-4000-8000-00000000000a", { value: "minimal_with_report" });
    expect((await open(TOKEN.D1)).body.data?.["report"]).toBeNull();
    setRow("InspectionSession", IPM.S1, { reportNumber: "IPM-F-0001-20261001-001", verificationToken: "q3kZ0x9VbN2mP4rT6wY8aC1dE3fG5hJ7" });
    expect((await open(TOKEN.D1)).body.data?.["report"]).toEqual({
      verifyUrl: "http://localhost:5000/api/v1/ipm/verify/IPM-F-0001-20261001-001?token=q3kZ0x9VbN2mP4rT6wY8aC1dE3fG5hJ7",
    });
  });

  it("the status: current, due soon (an IPM's request too), overdue, retired (no date), not scheduled", async () => {
    const at = (days: number): Date => new Date(Date.now() + days * 86_400_000);
    const cases: [Record<string, unknown>, string, boolean][] = [
      [{ nextCalibrationDate: at(200), nextCalibrationDateSource: "manual" }, "current", true],
      [{ nextCalibrationDate: at(5), nextCalibrationDateSource: "manual" }, "due_soon", true],
      [{ nextCalibrationDate: at(200), nextCalibrationDateSource: "manual", calibrationRequestedAt: new Date(), calibrationRequestedBySessionId: IPM.S1 }, "due_soon", true],
      [{ nextCalibrationDate: at(-5), nextCalibrationDateSource: "manual", calibrationRequestedAt: null, calibrationRequestedBySessionId: null }, "overdue", true],
      [{ status: "retired" }, "retired", false],
      [{ status: "inactive" }, "not_scheduled", true],
    ];
    for (const [values, status, dated] of cases) {
      setRow("CalibrationDevice", IPM.D1, values);
      const calibration = (await open(TOKEN.D1)).body.data?.["calibration"] as { status: string; nextDueDate: string | null };
      expect([status, calibration.status, calibration.nextDueDate !== null]).toEqual([status, status, dated]);
    }
  });

  it("the optional fields: no type, no status, a maker and a model, no IPM yet; a report link needs its token too", async () => {
    setRow("TenantSettings", "5e770000-0000-4000-8000-00000000000a", { value: "minimal_with_report" });
    setRow("CalibrationDevice", IPM.D2, { deviceTypeId: null, status: null, manufacturer: "Maker", model: "M-2", nextCalibrationDate: new Date("2030-01-01T00:00:00Z"), nextCalibrationDateSource: "manual" });
    setRow("InspectionSession", IPM.S2, { status: "voided" });
    expect((await open(TOKEN.D2)).body.data).toEqual({
      device: { name: "Alat sintetis 2", type: null, manufacturer: "Maker", model: "M-2" },
      facility: { name: "Facility Two" },
      calibration: { status: "current", nextDueDate: "2030-01-01" },
      lastIpmDate: null,
      report: null,
    });
    setRow("InspectionSession", IPM.S2, { status: "submitted", reportNumber: "IPM-F-0002-20261001-001", verificationToken: null });
    expect((await open(TOKEN.D2)).body.data?.["report"]).toBeNull();
  });

  it("a stored hash that does not equal the presented one (a lookup that matched by accident) is the 404", async () => {
    const models = jest.requireActual<typeof ModelsModule>("../../models");
    const found = await models.PublicDeviceToken.findOne({ where: { id: "1d000000-0000-4000-8000-000000000001" }, skipTenantScope: true, skipFacilityScope: true });
    if (!found) {
      throw new Error("fixture");
    }
    const spy = jest.spyOn(models.PublicDeviceToken, "findOne");
    spy.mockResolvedValueOnce(Object.assign(found, { tokenHash: "c".repeat(64) }));
    expect((await open(TOKEN.D1)).status).toBe(404);
    spy.mockResolvedValueOnce(Object.assign(found, { tokenHash: "short" }));
    expect((await open(TOKEN.D1)).status).toBe(404);
  });

  it("the token's own tenant: tenant B's sticker shows tenant B's device — and obeys tenant B's setting (PD-6)", async () => {
    expect(withoutDetails((await open(TOKEN.DB)).body)).toEqual(NOT_FOUND);
    setting(world.tenantB, "minimal");
    const data = (await open(TOKEN.DB)).body.data as { device: { name: string }; facility: { name: string } };
    expect([data.device.name, data.facility.name]).toEqual(["Alat sintetis B", "Facility B"]);
  });

  it("a device of another facility of the tenant is shown by its own sticker (the page is the device's, not a facility's)", async () => {
    expect(((await open(TOKEN.D2)).body.data as { facility: { name: string } }).facility.name).toBe("Facility Two");
  });
});

describe("one 404 for every failure (§ 7; FT-106, PD-2)", () => {
  const causes: [string, () => string][] = [
    ["a malformed token", () => "short"],
    ["a token with a slash-free foreign alphabet", () => "Zx3kQ9vN2mP4rT6wY8aC1d!"],
    ["an unknown token", () => TOKEN.UNKNOWN],
    ["a revoked token", () => TOKEN.REVOKED],
    ["a deleted device", () => (setRow("CalibrationDevice", IPM.D1, { isDeleted: true, deletedAt: new Date() }), TOKEN.D1)],
    ["an ended facility", () => (setRow("ClientFacility", IPM.F1, { status: "ended", statusReason: "Contract ended" }), TOKEN.D1)],
    ["a suspended tenant", () => (setRow("Tenant", world.tenantA, { status: "suspended" }), TOKEN.D1)],
    ["a deleted tenant", () => (setRow("Tenant", world.tenantA, { isDeleted: true, deletedAt: new Date() }), TOKEN.D1)],
    ["the page turned off", () => (setRow("TenantSettings", "5e770000-0000-4000-8000-00000000000a", { value: "off" }), TOKEN.D1)],
    ["an unparseable setting", () => (setRow("TenantSettings", "5e770000-0000-4000-8000-00000000000a", { value: "public" }), TOKEN.D1)],
    ["no setting at all (tenant B)", () => TOKEN.DB],
  ];

  // In production, as deployed: outside it the error envelope adds a development-only `details`.
  it.each(causes)("%s: the same status, body and headers (production)", async (_cause, prepare) => {
    const saved = ENV["NODE_ENV"];
    ENV["NODE_ENV"] = "production";
    try {
      const reference = await open(TOKEN.UNKNOWN);
      const res = await open(prepare());
      expect([res.status, res.body, res.headers]).toEqual([404, NOT_FOUND, reference.headers]);
    } finally {
      ENV["NODE_ENV"] = saved;
    }
  });

  it("an inactive facility still shows its device; a retired device is shown, not hidden", async () => {
    setRow("ClientFacility", IPM.F1, { status: "inactive", statusReason: "Paused" });
    setRow("CalibrationDevice", IPM.D1, { status: "retired" });
    const res = await open(TOKEN.D1);
    expect([res.status, (res.body.data?.["calibration"] as { status: string }).status]).toEqual([200, "retired"]);
  });

  it("an unforeseen failure is not turned into a 404", async () => {
    jest.spyOn(pageService, "readPublicDevice").mockRejectedValueOnce(new Error("boom"));
    expect((await open(TOKEN.D1)).status).toBe(500);
  });
});

describe("the headers (§ 8; PD-7)", () => {
  it("no-store, noindex and no-referrer on a 200 and a 404", async () => {
    for (const token of [TOKEN.D1, TOKEN.UNKNOWN]) {
      const { headers } = await open(token);
      expect([headers["cache-control"], headers["x-robots-tag"], headers["referrer-policy"]]).toEqual(["no-store", "noindex, nofollow", "no-referrer"]);
    }
  });
});

describe("the budgets (ADR-138 § 4, Am. 1 § 8)", () => {
  it("every 404 counts again (30 per address): the 31st miss is 429 with Retry-After and the headers; a real sticker still answers", async () => {
    await withFactor(async () => {
      let refused: Res | null = null;
      for (let i = 0; i < 31 && !refused; i += 1) {
        const res = await open(TOKEN.UNKNOWN);
        refused = res.status === 429 ? res : null;
      }
      expect([refused?.body["status"], typeof refused?.headers["retry-after"], refused?.headers["cache-control"]]).toEqual([429, "string", "no-store"]);
      expect((await open(TOKEN.D1)).status).toBe(200);
    });
  });

  it("every request counts (120 per address): the 121st is 429", async () => {
    await withFactor(async () => {
      for (let i = 0; i < 120; i += 1) {
        expect((await open(TOKEN.D1)).status).toBe(200);
      }
      expect((await open(TOKEN.D1)).status).toBe(429);
    });
  });

  it("the global ceiling is its own budget, below the per-address one: beyond it, 429 for everyone", async () => {
    const global = API_ENDPOINTS.publicDevicePageGlobal;
    const saved = global.maxRequests;
    global.maxRequests = 2;
    try {
      await withFactor(async () => {
        expect([(await open(TOKEN.D1)).status, (await open(TOKEN.D2)).status, (await open(TOKEN.DB)).status]).toEqual([200, 200, 429]);
      });
    } finally {
      global.maxRequests = saved;
    }
  });
});

describe("the log never carries the token (ADR-138 § 6, Am. 1 § 9; PD-6)", () => {
  it("the activity log's URL: the path token replaced by `~` and its hash's first 8 hex characters", () => {
    const url = `/api/v1/public/devices/${TOKEN.D1}?lang=en&token=x`;
    expect(sanitizeUrl(url)).toBe(`/api/v1/public/devices/~${sha(TOKEN.D1).slice(0, 8)}?lang=en&token=[REDACTED]`);
    expect(sanitizeUrl("/api/v1/public/devices/%E0%A4%A")).toBe(`/api/v1/public/devices/~${sha("%E0%A4%A").slice(0, 8)}`);
    expect(sanitizeUrl("/api/v1/calibration-devices")).toBe("/api/v1/calibration-devices");
  });

  it("the access log's `safe-url` token replaces the path token the same way (other URLs as they are)", () => {
    const tokens = morgan as unknown as Record<string, (req: Pick<Request, "originalUrl" | "url">, res: object) => string>;
    const safe = tokens["safe-url"];
    const device: Pick<Request, "originalUrl" | "url"> = { originalUrl: `/api/v1/public/devices/${TOKEN.D1}`, url: "/" };
    const other: Pick<Request, "originalUrl" | "url"> = { originalUrl: "", url: "/api/v1/calibration-devices" };
    expect(safe?.(device, {})).toBe(`/api/v1/public/devices/~${sha(TOKEN.D1).slice(0, 8)}`);
    expect(safe?.(other, {})).toBe("/api/v1/calibration-devices");
  });
});
