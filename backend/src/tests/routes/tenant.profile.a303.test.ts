/**
 * A-303 — the tenant profile (address and contact) is stored, validated, and
 * `maxUsers` is not an edit field.
 *
 * `PATCH /tenants/edit` accepted description, phone, address, city, state,
 * zipCode, country and website, and tenant.service#updateTenant wrote them —
 * but none was a Tenant attribute, so Sequelize dropped every one and the 200
 * said otherwise. ISO/IEC 17025 7.8.2 requires the issuing laboratory's name
 * and address on every certificate, so they are now columns (migration 0100)
 * and model attributes (coordinator decision under the owner's delegation,
 * MEMORY/records/2026-09-29-multipart-sanitizer.md § A-303).
 *
 * `maxUsers` is a plan/quota value the platform sets. It was never an attribute
 * either (the seat limit is `limitSeats`), so a super admin's "change" stored
 * nothing. It is no longer an edit field: the house contract for an unknown
 * body key is to STRIP it (validators/input.ts), so it is ignored — no 403, no
 * write, no audit entry.
 *
 * REAL router, dynamicAccess (checkTenant real; matrix granted), controller,
 * tenant service and audit service on the REAL models and tenant hooks
 * (fixtures/memoryDb). Doubled: `auth`, the Redis endpoint limiter, the storage
 * quota and the upload middleware (multipart is A-296's suite).
 */
import type { RequestHandler } from "express";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as UploadUtil from "../../utils/upload.util";
import type * as RouteModule from "../../routes/api/tenant.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/rateLimiter.redis.service", () => ({
  endpointRateLimiter: (): RequestHandler => (_req, _res, next) => {
    next();
  },
}));
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  enforceStorageQuota: (): RequestHandler => (_req, _res, next) => {
    next();
  },
}));
jest.mock("../../utils/upload.util", () => ({
  ...jest.requireActual<typeof UploadUtil>("../../utils/upload.util"),
  upload: (): RequestHandler => (_req, _res, next) => {
    next();
  },
  deleteUpload: () => Promise.resolve(),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/tenant.route");

const PROFILE = {
  description: "Laboratorium kalibrasi alat kesehatan",
  phone: "+62 21-555 0100",
  address: "Jl. Kesehatan No. 10",
  city: "Jakarta Pusat",
  state: "DKI Jakarta",
  zipCode: "10110",
  country: "Indonesia",
  website: "https://lab.example.id",
} as const;

let tenantA = "";
let admin: Principal;
let superAdmin: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  tenantA = fx.tenantA.id;
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  superAdmin = fx.superAdmin;
  seedTenants(mdb, fx, [admin, superAdmin]);
});

const stored = (): Record<string, unknown> => {
  const row = mdb.rows("Tenant").find((t) => t["id"] === tenantA);
  if (!row) {
    throw new Error("tenant A is not seeded");
  }
  return row;
};

const edit = (body: Record<string, unknown>): ReturnType<typeof call> =>
  call(router, "PATCH", "/edit", { body: { tenantId: tenantA, ...body }, baseUrl: "/api/v1/tenants" });

const auditChanges = (): Record<string, unknown>[] =>
  mdb
    .committed()
    .filter((w) => w.model === "AuditLog")
    .map((w) => ((w.values as Record<string, unknown> | undefined)?.["changes"] ?? {}) as Record<string, unknown>);

describe("A-303: PATCH /tenants/edit stores the tenant profile", () => {
  it("a tenant admin's profile fields are stored, and audited", async () => {
    as(admin);
    const res = await edit({ ...PROFILE });
    expect(res.status).toBe(200);
    expect(stored()).toMatchObject(PROFILE);
    const [changes] = auditChanges();
    expect(changes).toMatchObject({ address: { before: null, after: PROFILE.address } });
  });

  it("a later partial edit keeps the fields it does not name", async () => {
    as(admin);
    await edit({ ...PROFILE });
    const res = await edit({ city: "Bandung" });
    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ ...PROFILE, city: "Bandung" });
  });

  it("an empty string clears an optional field", async () => {
    as(admin);
    await edit({ ...PROFILE });
    await edit({ website: "", phone: "" });
    expect(stored()["website"]).toBe("");
    expect(stored()["phone"]).toBe("");
  });
});

describe("A-303: the profile is validated", () => {
  it.each([
    ["javascript:alert(1)"],
    ["ftp://lab.example.id"],
    ["data:text/html,<script>x</script>"],
    ["lab.example.id"],
  ])("website %s is refused (http and https only)", async (website) => {
    as(admin);
    const res = await edit({ website });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("website");
    expect(stored()["website"] ?? null).toBeNull();
  });

  it.each([["call me maybe"], ["12"], ["+62 21 <b>5</b>"], ["1".repeat(40)]])("phone %s is refused", async (phone) => {
    as(admin);
    const res = await edit({ phone });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("phone");
  });

  it.each([["+62 21-555 0100"], ["(021) 555-0100"], ["0812 3456 7890"], ["+1 415 555 0100 ext. 12"]])(
    "phone %s is accepted",
    async (phone) => {
      as(admin);
      const res = await edit({ phone });
      expect(res.status).toBe(200);
      expect(stored()["phone"]).toBe(phone);
    },
  );

  it("http:// is accepted as well as https://", async () => {
    as(admin);
    expect((await edit({ website: "http://lab.example.id/about" })).status).toBe(200);
    expect(stored()["website"]).toBe("http://lab.example.id/about");
  });
});

describe("A-303: maxUsers is not an edit field (stripped, per the house contract for unknown keys)", () => {
  it("a tenant admin sending maxUsers gets no 403: the key is ignored and nothing about it is written", async () => {
    as(admin);
    const res = await edit({ maxUsers: 500, city: "Surabaya" });
    expect(res.status).toBe(200);
    expect(stored()["city"]).toBe("Surabaya");
    expect(stored()).not.toHaveProperty("maxUsers");
    expect(JSON.stringify(auditChanges())).not.toContain("maxUsers");
  });

  it("a super admin's maxUsers is ignored too — the seat limit is the platform's plan value, not an edit field", async () => {
    as(superAdmin);
    const res = await edit({ maxUsers: 50 });
    expect(res.status).toBe(200);
    expect(stored()).not.toHaveProperty("maxUsers");
    expect(JSON.stringify(auditChanges())).not.toContain("maxUsers");
  });
});
