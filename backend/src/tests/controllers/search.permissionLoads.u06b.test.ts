/**
 * U-06b (ADR-120) — one GET /search loads the caller's permission sources
 * once, not six times, and still returns only the types the caller may read.
 *
 * Before: the route gate names three menus and loaded the role matrix and the
 * user's overrides once per menu; the controller then probed each of the three
 * types through the same gate, loading them again — six loads, twelve Redis
 * GETs and JSON parses per search, about 8% of the backend's CPU under the
 * U-06 search load (the record's profile). Now every gate and probe of ONE
 * request shares the first load (dynamicAccess.middleware#sourcesByRequest),
 * and the next request loads afresh.
 *
 * REAL route gate (dynamicAccess(SEARCH_MENUS, "read")), REAL controller, REAL
 * service; the database and the two permission STORES are doubles, so what is
 * counted is how often the stores are read, and what is asserted is the rows
 * that reach the response. [FB] marks the cases that failed before the change.
 */
import type { NextFunction, Request, Response } from "express";
import type * as DynamicAccessModule from "../../middlewares/dynamicAccess.middleware";

jest.mock("../../config", () => ({ db: { query: jest.fn() } }));
jest.mock("../../models", () => ({
  User: { findByPk: jest.fn() },
  Tenants: { findByPk: jest.fn() },
  ApiKey: {},
  Tenant: {},
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../services/roles.service", () => ({ getRolePermissionsMatrix: jest.fn() }));
jest.mock("../../services/userPermission.service", () => ({ getUserOverrideMatrix: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above */
const { db } = require("../../config") as { db: { query: jest.Mock } };
const roles = require("../../services/roles.service") as { getRolePermissionsMatrix: jest.Mock };
const overrides = require("../../services/userPermission.service") as { getUserOverrideMatrix: jest.Mock };
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware") as typeof DynamicAccessModule;
const { SEARCH_MENUS } = require("../../services/search.service") as { SEARCH_MENUS: string[] };
const searchController = require("../../controllers/search.controller") as {
  search: (req: Request, res: Response, next: NextFunction) => Promise<void>;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const ROWS: Record<string, Record<string, unknown>[]> = {
  calibration_devices: [{ id: "dev-1", name: "Infusion pump", rank: 0.5 }],
  stocks: [{ id: "stk-1", itemName: "Thermocouple", rank: 0.4 }],
  certificates: [{ id: "cert-1", certificateNumber: "C-1", rank: 0.3 }],
};
const tableOf = (text: string): string | undefined => Object.keys(ROWS).find((t) => text.includes(`"${t}"`));

interface Sent {
  status?: number;
  body?: { data: { results: { type: string; id: string }[] } };
}

/** GET /search?q=pump through the route gate, then the controller — one request object, as Express runs it. */
const search = async (user: Record<string, unknown>): Promise<Sent> => {
  const sent: Sent = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: NonNullable<Sent["body"]>) {
      sent.body = body;
      return res;
    },
  };
  const req = { params: {}, body: {}, query: { q: "pump" }, user, method: "GET", originalUrl: "/api/v1/search" };
  const gate = { passed: false };
  await dynamicAccess(SEARCH_MENUS as never, "read")(req as unknown as Request, res as unknown as Response, ((err?: unknown) => {
    gate.passed = !err;
  }) as NextFunction);
  if (gate.passed) {
    await searchController.search(req as unknown as Request, res as unknown as Response, jest.fn());
  }
  return sent;
};

const principal = (): Record<string, unknown> => ({ id: "user-1", tenantId: "tenant-1", role: { id: "role-1", name: "TECHNICIAN" } });
const types = (sent: Sent): string[] => [...new Set((sent.body?.data.results ?? []).map((r) => r.type))].sort();

beforeEach(() => {
  jest.clearAllMocks();
  roles.getRolePermissionsMatrix.mockResolvedValue({ calibration: ["read"], certificate: ["read"] });
  overrides.getUserOverrideMatrix.mockResolvedValue({});
  db.query.mockImplementation((text: string) => Promise.resolve(ROWS[tableOf(text) ?? ""] ?? []));
});

describe("U-06b — one permission load per search request", () => {
  it("[FB] reads the role matrix and the overrides once for the gate and all three probes", async () => {
    const sent = await search(principal());

    expect(sent.status).toBe(200);
    expect(roles.getRolePermissionsMatrix).toHaveBeenCalledTimes(1);
    expect(overrides.getUserOverrideMatrix).toHaveBeenCalledTimes(1);
  });

  it("A-04 holds: only the permitted types are searched and returned", async () => {
    const sent = await search(principal());

    expect(types(sent)).toEqual(["certificate", "device"]);
    expect(db.query.mock.calls.map(([text]: [string]) => tableOf(text)).sort()).toEqual(["calibration_devices", "certificates"]);
  });

  it("the next request loads again, so a changed grant applies to it", async () => {
    expect(types(await search(principal()))).toEqual(["certificate", "device"]);

    roles.getRolePermissionsMatrix.mockResolvedValue({ warehouse: ["read"] });
    const second = await search(principal());

    expect(types(second)).toEqual(["stock"]);
    expect(roles.getRolePermissionsMatrix).toHaveBeenCalledTimes(2);
  });

  it("a request whose principal is replaced is not answered from the first principal's load", async () => {
    const req = { params: {}, body: {}, query: {}, user: principal() };
    const res = { status: () => ({ json: jest.fn() }) };
    const gate = dynamicAccess("calibration", "read");
    const outcomes: boolean[] = [];
    const next = ((err?: unknown) => {
      outcomes.push(!err);
    }) as NextFunction;

    await gate(req as unknown as Request, res as unknown as Response, next);
    roles.getRolePermissionsMatrix.mockResolvedValue({});
    req.user = { id: "user-2", tenantId: "tenant-1", role: { id: "role-2", name: "WAREHOUSE STAFF" } };
    await gate(req as unknown as Request, res as unknown as Response, next);

    expect(outcomes).toEqual([true]);
    expect(roles.getRolePermissionsMatrix).toHaveBeenCalledTimes(2);
  });

  it("a failed load denies every probe of that request (next(err) is a denial, A-13), and the next request retries", async () => {
    roles.getRolePermissionsMatrix.mockRejectedValueOnce(new Error("redis and db down"));
    const first = await search(principal());
    expect(first.body).toBeUndefined();

    const second = await search(principal());
    expect(types(second)).toEqual(["certificate", "device"]);
  });

  it("a caller with none of the three menus is refused at the gate, with one load", async () => {
    roles.getRolePermissionsMatrix.mockResolvedValue({ users: ["read"] });

    const sent = await search(principal());

    expect(sent.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
    expect(roles.getRolePermissionsMatrix).toHaveBeenCalledTimes(1);
  });
});
