/**
 * A-84 — POST /esignature/sign (and /verify, /history) had no permission gate.
 *
 * They mounted `auth` (+ `denyApiKey` on /sign) and nothing else — CLAUDE.md:
 * every route needs a gate. They are now gated on their own menu,
 * `esignature`. Gating on `qms` would have locked TECHNICIAN and every other
 * non-admin signer out.
 *
 * A-129 (ADR-051 Q-19) narrowed the default grant: the technical roles hold
 * `esignature: write`; USER, ROOM USER and WAREHOUSE STAFF hold nothing on it,
 * and a workflow can no longer name a signer without the grant.
 *
 * Behaviour tests through the real router and the real `dynamicAccess`. Only
 * `auth` (to set the principal) and the controller (where "reached" is
 * observed) are stubbed; the permission matrix is built from
 * ROLE_MENU_ASSIGNMENTS exactly as the seed builds role_menu_permissions from
 * it (the harness of workflows.access.a58.test.js), so a fixture friendlier
 * than production cannot make a test pass.
 */

import type { Request, Response, NextFunction } from "express";

let currentUser: unknown = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<typeof import("../../middlewares/auth.middleware")>(
    "../../middlewares/auth.middleware",
  );
  return {
    ...actual,
    auth: (req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: unknown }).user = currentUser;
      next();
    },
  };
});

jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn(),
}));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../models", () => ({
  User: { findByPk: jest.fn() },
  Tenants: { findByPk: jest.fn() },
}));

// Body validation runs AFTER the gate and is not what is under test.
jest.mock("../../middlewares/validation.middleware", () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const reached = (name: string) =>
  jest.fn((_req: unknown, res: { status: (c: number) => { json: (p: unknown) => unknown } }) =>
    res.status(200).json({ success: true, handler: name }),
  );

const controllerMock = {
  getKeyPairs: reached("getKeyPairs"),
  createKeyPair: reached("createKeyPair"),
  deleteKeyPair: reached("deleteKeyPair"),
  getWorkflows: reached("getWorkflows"),
  createWorkflow: reached("createWorkflow"),
  getWorkflow: reached("getWorkflow"),
  updateWorkflow: reached("updateWorkflow"),
  deleteWorkflow: reached("deleteWorkflow"),
  signDocument: reached("signDocument"),
  verifySignature: reached("verifySignature"),
  getSignatureHistory: reached("getSignatureHistory"),
  getSignerWorkflows: reached("getSignerWorkflows"),
  getSignerWorkflow: reached("getSignerWorkflow"),
  getEligibleSigners: reached("getEligibleSigners"),
  cancelWorkflow: reached("cancelWorkflow"),
};

jest.mock("../../controllers/eSignature.controller", () => controllerMock);

import fs from "fs";
import path from "path";
/* eslint-disable @typescript-eslint/no-require-imports */
const RolesService = require("../../services/roles.service") as typeof import("../../services/roles.service");
const { getUserOverrideMatrix } = require("../../services/userPermission.service") as typeof import("../../services/userPermission.service");
const controller = require("../../controllers/eSignature.controller") as typeof controllerMock;
const { ROLE_NAMES, ROLE_IDS, ROLE_MENU_ASSIGNMENTS, MENU_SLUGS } = require("../../constants") as typeof import("../../constants");
const {
  parseGates,
  checkRouteGates,
  seededMenuVocabulary,
} = require("../../utils/authorizationWiring.util") as typeof import("../../utils/authorizationWiring.util");
const router = require("../../routes/api/eSignature.route") as { handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => void };
/* eslint-enable @typescript-eslint/no-require-imports */

interface HttpResponse {
  status: number;
  body: unknown;
}

const http = (method: string, url: string, body: Record<string, unknown> = {}): Promise<HttpResponse> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      setHeader() {
        return this;
      },
    };
    const req = {
      method: method.toUpperCase(),
      url,
      originalUrl: "/api/v1/esignature" + url,
      body,
      query: {},
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    (router as unknown as { handle: (req: unknown, res: unknown, next: (err?: { status?: number; message?: string }) => void) => void }).handle(req, res, (err?: { status?: number; message?: string }) =>
      resolve({
        status: err ? err.status || 500 : 404,
        body: { message: err?.message ?? "no route" },
      }),
    );
  });

const ID = "11111111-1111-4111-8111-111111111111";
const TENANT = "33333333-3333-4333-8333-333333333333";

const matrixFor = (roleName?: string) => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  const matrix: Record<string, string[]> = {};
  for (const [slug, permission] of Object.entries(entry ? entry.menus : {})) {
    matrix[slug] = [permission as string];
  }
  return matrix;
};

const asRole = (roleName: string) => {
  currentUser = { id: ID, tenantId: TENANT, role: { id: roleName, name: roleName } };
};

// Every role the seed inserts (ROLE_IDS is the seeded list; TENANT_ADMIN is a
// logical tier, not a role). SUPERADMIN bypasses the matrix and is covered by
// the bypass, not by this list.
const SEEDED_ROLES = Object.keys(ROLE_IDS)
  .map((key) => (ROLE_NAMES as Record<string, string>)[key] as string)
  .filter((name) => name !== ROLE_NAMES.SUPER_ADMIN);

// A-129 (ADR-051 Q-19): the roles that do no technical work.
const NON_SIGNING_ROLES = [ROLE_NAMES.USER, ROLE_NAMES.ROOM_USER, ROLE_NAMES.WAREHOUSE_STAFF];
const SIGNING_ROLES = SEEDED_ROLES.filter((name) => !NON_SIGNING_ROLES.includes(name as never));

const SIGN = ["post", "/sign", "signDocument"] as const;
const READS = [
  ["post", "/verify", "verifySignature"],
  ["get", "/history", "getSignatureHistory"],
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = null;
  (RolesService.getRolePermissionsMatrix as jest.Mock).mockImplementation(async (roleId: string) => matrixFor(roleId));
  (getUserOverrideMatrix as jest.Mock).mockResolvedValue({});
});

describe("A-84 — the signing routes are gated on `esignature`", () => {
  it("every gate in eSignature.route.js resolves to a seeded menu group (the A-58 boot check)", () => {
    const file = path.join(__dirname, "../../routes/api/eSignature.route.ts");
    const gates = parseGates(fs.readFileSync(file, "utf8"), "eSignature.route.ts");
    const { errors, warnings } = checkRouteGates(gates, seededMenuVocabulary());

    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    // 3 signing routes (A-84) + the 2 signer-view reads (A-91).
    expect(gates.filter((g) => g.names?.includes(MENU_SLUGS.ESIGNATURE))).toHaveLength(5);
  });

  it("A-129: the technical roles hold `esignature: write`; USER, ROOM USER and WAREHOUSE STAFF hold nothing on it", () => {
    const grants = Object.fromEntries(
      ROLE_MENU_ASSIGNMENTS.map((a) => [a.roleName, (a.menus as Record<string, string>)[MENU_SLUGS.ESIGNATURE]]),
    );
    for (const roleName of [ROLE_NAMES.SUPER_ADMIN, ...SIGNING_ROLES]) {
      expect([roleName, grants[roleName]]).toEqual([roleName, "write"]);
    }
    for (const roleName of NON_SIGNING_ROLES) {
      expect([roleName, grants[roleName]]).toEqual([roleName, undefined]);
    }
    expect(SIGNING_ROLES).toHaveLength(7);
  });

  describe.each(NON_SIGNING_ROLES)("%s (A-129)", (roleName) => {
    it("is refused POST /sign, /verify and /history with 403, and never reaches a handler", async () => {
      asRole(roleName);

      for (const [method, url, handler] of [SIGN, ...READS]) {
        const res = await http(method, url, { stepId: ID, signatureId: ID });
        expect([url, res.status]).toEqual([url, 403]);
        expect(controller[handler as keyof typeof controller]).not.toHaveBeenCalled();
      }
    });
  });

  describe.each(SIGNING_ROLES)("%s", (roleName) => {
    it("reaches POST /sign", async () => {
      asRole(roleName);
      const res = await http(SIGN[0], SIGN[1], { stepId: ID });

      expect(res.status).toBe(200);
      expect(controller.signDocument).toHaveBeenCalledTimes(1);
    });

    it.each(READS)("reaches %s %s", async (method, url, handler) => {
      asRole(roleName);
      const res = await http(method, url, { signatureId: ID });

      expect(res.status).toBe(200);
      expect(controller[handler as keyof typeof controller]).toHaveBeenCalledTimes(1);
    });
  });

  it("SUPERADMIN reaches POST /sign through the bypass", async () => {
    asRole(ROLE_NAMES.SUPER_ADMIN);
    const res = await http("post", "/sign", { stepId: ID });

    expect(res.status).toBe(200);
  });

  it("the gate is live: a role whose `esignature` grant was withdrawn gets 403 and never reaches the handler", async () => {
    (RolesService.getRolePermissionsMatrix as jest.Mock).mockImplementation(async (roleId: string) => {
      const matrix = matrixFor(roleId);
      delete matrix[MENU_SLUGS.ESIGNATURE];
      return matrix;
    });
    asRole(ROLE_NAMES.TECHNICIAN);

    for (const [method, url, handler] of [SIGN, ...READS]) {
      const res = await http(method, url, { stepId: ID });
      expect(res.status).toBe(403);
      expect(controller[handler as keyof typeof controller]).not.toHaveBeenCalled();
    }
  });

  it("a per-user override of `none` withdraws signing from one user", async () => {
    (getUserOverrideMatrix as jest.Mock).mockResolvedValue({ [MENU_SLUGS.ESIGNATURE]: "none" });
    asRole(ROLE_NAMES.SUPERVISOR);

    const res = await http("post", "/sign", { stepId: ID });

    expect(res.status).toBe(403);
    expect(controller.signDocument).not.toHaveBeenCalled();
  });

  it("read-only `esignature` may verify and read history, but may not sign", async () => {
    (RolesService.getRolePermissionsMatrix as jest.Mock).mockImplementation(async (roleId: string) => ({
      ...matrixFor(roleId),
      [MENU_SLUGS.ESIGNATURE]: ["read"],
    }));
    asRole(ROLE_NAMES.USER);

    expect((await http("post", "/sign", { stepId: ID })).status).toBe(403);
    expect((await http("post", "/verify", { signatureId: ID })).status).toBe(200);
    expect((await http("get", "/history")).status).toBe(200);
  });

  it("an API key cannot sign even with an `esignature:write` scope (denyApiKey runs first)", async () => {
    currentUser = {
      id: "key-1",
      tenantId: TENANT,
      isApiKey: true,
      apiKeyScopes: ["esignature:write"],
      role: { id: "key", name: "API_KEY" },
    };

    const res = await http("post", "/sign", { stepId: ID });

    expect(res.status).toBe(403);
    expect(controller.signDocument).not.toHaveBeenCalled();
  });

  it("an API key needs an explicit `esignature` scope to verify", async () => {
    currentUser = {
      id: "key-1",
      tenantId: TENANT,
      isApiKey: true,
      apiKeyScopes: ["qms:read"],
      role: { id: "key", name: "API_KEY" },
    };

    const res = await http("post", "/verify", { signatureId: ID });

    expect(res.status).toBe(403);
    expect(controller.verifySignature).not.toHaveBeenCalled();
  });

  it("key-pair and workflow management stay on `qms` — a TECHNICIAN still cannot delete signing keys", async () => {
    asRole(ROLE_NAMES.TECHNICIAN);

    const res = await http("delete", "/key-pairs/" + ID);

    expect(res.status).toBe(403);
    expect(controller.deleteKeyPair).not.toHaveBeenCalled();
  });
});
