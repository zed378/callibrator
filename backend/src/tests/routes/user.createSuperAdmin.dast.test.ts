/**
 * DAST 2026-09-29 (MEMORY/records/2026-09-29-dast-live-probe.md): a tenant
 * administrator asking POST /users/create for a SUPER_ADMIN account was
 * refused — correctly — but in production the refusal read 400 "An
 * unexpected error occurred". A permission failure inside the caller's own
 * tenant is a 403 with a message that says so (CLAUDE.md § Status Codes).
 *
 * Root cause (at HEAD ce74932): user.controller#handleValidation threw a plain
 * `Error` carrying status 400, and A-132's rule shows a plain Error's message
 * in production only when it is marked `expose` — so every validation refusal
 * on the user routes was masked as "An unexpected error occurred". The working
 * tree's controllerWrapper (ADR-100, `isValidationFailure`) now answers that
 * throw as "Validation Error"; this suite pins it on the user route, and pins
 * the SUPER_ADMIN refusal itself (user.service#userCreate, 403) with it.
 *
 * REAL router, dynamicAccess, enforceSeatQuota, controller, user service and
 * audit service on the REAL models and tenant hooks (fixtures/memoryDb).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/user.route";
import type * as RoleConstants from "../../constants/roleConstants";
import { environment } from "../../config/env";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/user.route");
const { SUPER_ADMIN_ROLE_ID } = jest.requireActual<typeof RoleConstants>("../../constants/roleConstants");

const penv = environment();
const savedEnv = penv["NODE_ENV"];

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
});

afterEach(() => {
  penv["NODE_ENV"] = savedEnv;
});

describe("POST /users/create — a tenant admin asking for a SUPER_ADMIN (DAST 2026-09-29)", () => {
  it.each(["production", "test"])("is a 403 that says why (NODE_ENV=%s), and creates nothing", async (nodeEnv) => {
    const fx = twoTenants();
    const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
    seedTenants(mdb, fx, [admin]);
    mdb.seed("Role", { id: SUPER_ADMIN_ROLE_ID, name: "SUPERADMIN", isSystem: true, roleLevel: 10, status: "active" });
    penv["NODE_ENV"] = nodeEnv;
    as(admin);

    const res = await call(router, "POST", "/create", {
      body: {
        username: "escalate1",
        firstName: "Esca",
        lastName: "Late",
        email: "escalate1@hospital-a.test",
        password: "Str0ng!Passw0rd",
        roleId: SUPER_ADMIN_ROLE_ID,
      },
    });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/SUPER_ADMIN/);
    expect(JSON.stringify(res.body)).not.toMatch(/unexpected error/i);
  });

  it("a body the validator refuses is a 400 that says so in production, not a masked error", async () => {
    const fx = twoTenants();
    const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
    seedTenants(mdb, fx, [admin]);
    penv["NODE_ENV"] = "production";
    as(admin);

    const res = await call(router, "POST", "/create", {
      body: {
        username: "esca_late", // the username rule is letters and digits only
        firstName: "Esca",
        lastName: "Late",
        email: "escalate2@hospital-a.test",
        password: "Str0ng!Passw0rd",
        roleId: SUPER_ADMIN_ROLE_ID,
      },
    });

    expect(res.status).toBe(400);
    // The one validation shape (ADR-100, controllerWrapper#isValidationFailure).
    expect((res.body as { message?: string }).message).toBe("Validation Error");
    expect(JSON.stringify(res.body)).not.toMatch(/unexpected error/i);
  });
});
