/**
 * Q-38 (ADR-100) — a tenant administrator sets its OWN tenant's allowlist and
 * geofence (`network-security: write`), and a change that would refuse the
 * caller's own next sign-in is 409 SELF_LOCKOUT, explained. The platform
 * operator is not bound by the guard. Before Q-38 both PUTs were
 * `superAdminOnly`, and the tenant administrator's role held `read` only.
 *
 * The controller and the real guard (signInPolicy.service) run; the storage
 * service is doubled. The route gate and the seed are read from source.
 */
import * as fs from "fs";
import * as path from "path";
import type { Request, Response } from "express";
import type * as RoleConstants from "../../constants/roleConstants";

jest.mock("../../services/networkSecurity.service", () => ({
  setTenantIpAllowlist: jest.fn((tenantId: string, cidrs: string[]) => Promise.resolve({ tenantId, allowlist: cidrs })),
  setTenantGeofence: jest.fn((tenantId: string, g: object) => Promise.resolve({ tenantId, geofence: g })),
  DEFAULT_GEOFENCE_RADIUS_KM: 50,
}));

type Handler = (req: Request, res: Response, next: () => void) => Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the controller is JavaScript (CommonJS)
const controller = require("../../controllers/networkSecurity.controller") as Record<string, Handler | undefined>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a jest double
const service = require("../../services/networkSecurity.service") as { setTenantIpAllowlist: jest.Mock; setTenantGeofence: jest.Mock };
const { ROLE_MENU_ASSIGNMENTS, ROLE_NAMES, MENU_SLUGS } = jest.requireActual<typeof RoleConstants>(
  "../../constants/roleConstants",
);

const TENANT = "a3800000-0000-4000-8000-000000000001";
const ADMIN = { id: "a3800000-0000-4000-8000-000000000002", tenantId: TENANT, role: { name: "HEALTHCARE ADMIN", roleLevel: 5 } };
const OPERATOR = { ...ADMIN, role: { name: "SUPERADMIN", roleLevel: 10 } };

const run = (handler: string, body: object, user: object, ip = "192.0.2.7"): Promise<{ status: number; body: Record<string, unknown> }> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(payload: Record<string, unknown>) {
        res.headersSent = true;
        resolve({ status: res.statusCode, body: payload });
        return res;
      },
      setHeader() {
        return res;
      },
    };
    const fn = controller[handler];
    if (!fn) {
      throw new Error(`no handler ${handler}`);
    }
    void fn({ body, user, ip, headers: {} } as unknown as Request, res as unknown as Response, () => undefined);
  });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Q-38 — the allowlist", () => {
  it("a list without the caller's address is 409 SELF_LOCKOUT naming it, and nothing is stored", async () => {
    const answer = await run("setIpAllowlist", { cidrs: ["10.0.0.0/8"] }, ADMIN);
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ success: false, code: "SELF_LOCKOUT" });
    expect(String(answer.body["message"])).toContain("192.0.2.7");
    expect(service.setTenantIpAllowlist).not.toHaveBeenCalled();
  });

  it("a list containing the caller is stored for the caller's own tenant", async () => {
    const answer = await run("setIpAllowlist", { cidrs: ["192.0.2.0/24"] }, ADMIN);
    expect(answer.status).toBe(200);
    expect(service.setTenantIpAllowlist).toHaveBeenCalledWith(TENANT, ["192.0.2.0/24"], expect.objectContaining({ userId: ADMIN.id }));
  });

  it("no address and no role: the guard names the address as unknown", async () => {
    const answer = await new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
      const res = {
        statusCode: 200,
        status(code: number) {
          res.statusCode = code;
          return res;
        },
        json(payload: Record<string, unknown>) {
          resolve({ status: res.statusCode, body: payload });
          return res;
        },
        setHeader() {
          return res;
        },
      };
      const fn = controller["setIpAllowlist"];
      void fn?.({ body: { cidrs: ["10.0.0.0/8"] }, user: { id: ADMIN.id, tenantId: TENANT }, headers: {} } as unknown as Request, res as unknown as Response, () => undefined);
    });
    expect(answer.status).toBe(409);
    expect(String(answer.body["message"])).toContain("(unknown)");
  });

  it("the operator is not bound by the guard (the override)", async () => {
    expect((await run("setIpAllowlist", { cidrs: ["10.0.0.0/8"] }, OPERATOR)).status).toBe(200);
  });
});

describe("Q-38 — the geofence", () => {
  it("needs the caller's current location (409 without it), inside the fence (409 outside)", async () => {
    const fence = { latitude: -6.2, longitude: 106.8, radiusKm: 30 };
    expect((await run("setGeofence", fence, ADMIN)).body).toMatchObject({ code: "SELF_LOCKOUT" });
    expect((await run("setGeofence", { ...fence, currentLocation: { latitude: 1.35, longitude: 103.8 } }, ADMIN)).status).toBe(409);
    expect(service.setTenantGeofence).not.toHaveBeenCalled();
    const ok = await run("setGeofence", { latitude: -6.2, longitude: 106.8, currentLocation: { latitude: -6.25, longitude: 106.85 } }, ADMIN);
    expect(ok.status).toBe(200);
    expect(service.setTenantGeofence).toHaveBeenCalledWith(TENANT, { latitude: -6.2, longitude: 106.8 }, expect.anything());
  });
});

describe("Q-38 — who may write", () => {
  const ROUTE = fs.readFileSync(path.join(__dirname, "../../routes/api/networkSecurity.route.ts"), "utf8");

  it("the home-tenant PUTs are gated by network-security write, not superAdminOnly", () => {
    // denyApiKey first: a key may not change where a tenant signs in from.
    expect(ROUTE).toMatch(/router\.put\("\/ip-allowlist", denyApiKey, canWriteNetworkSecurity,/);
    expect(ROUTE).toMatch(/router\.put\("\/geofence", denyApiKey, canWriteNetworkSecurity,/);
    expect(ROUTE).toMatch(/const canWriteNetworkSecurity = dynamicAccess\(MENU_SLUGS\.NETWORK_SECURITY, "write"/);
  });

  it("the tenant administrator role is seeded with write", () => {
    const admin = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === ROLE_NAMES.HEALTCARE_ADMIN);
    expect(admin?.menus[MENU_SLUGS.NETWORK_SECURITY]).toBe("write");
  });
});
