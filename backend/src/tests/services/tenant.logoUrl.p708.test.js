/**
 * P7-08 / ADR-071 (amendment, 2026-09-25) — a tenant logo is an uploaded
 * file, never a URL.
 *
 * The content origin's CSP (`img-src 'self' data: blob:` plus the API origin)
 * blocks an absolute third-party logo, and serving one would hotlink a third
 * party with every viewer's IP and Referer. `tenants.logo` was a free string.
 *
 *  - Writing: the tenant validator accepts only a bare stored file name.
 *  - Reading, migration-free: an existing absolute value is not served —
 *    `logoBaseUrl` is null, so the UI shows its fallback (the Building icon /
 *    default favicon) rather than a blocked, broken image. A legacy
 *    same-origin path is reduced to its file name and still served.
 *
 * Fail-before: against HEAD, `logoBaseUrl` for `https://cdn.example.com/x.png`
 * was `<HOST_URL>/uploads/public/tenant/https://cdn.example.com/x.png`, and the
 * validator accepted every URL and path below.
 */

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
  del: jest.fn(),
  delPattern: jest.fn(),
  cacheKeys: {
    tenant: (id) => `tenant:${id}`,
    tenantByCode: (code) => `tenant:code:${code}`,
    tenantSettings: (id) => `tenant:settings:${id}`,
  },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../config", () => ({ db: { transaction: jest.fn() } }));
jest.mock("../../models", () => ({
  Tenants: { findOne: jest.fn() },
  Users: {},
  TenantSettings: {},
}));

const { Tenants } = require("../../models");
const tenantService = require("../../services/tenant.service");
const {
  validate,
  createTenantSchema,
  updateTenantSchema,
} = require("../../validators/tenant.validator");

const brandingFor = async (logo) => {
  Tenants.findOne.mockResolvedValue({
    toJSON: () => ({ id: "t-1", name: "Acme", code: "ACM", primaryColor: null, logo }),
  });
  return (await tenantService.getPublicBranding("t-1")).logoBaseUrl;
};

const STORED = "1758600000000-4242-9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f.png";

describe("P7-08 — an existing logo value is served only when it names an uploaded file", () => {
  it("an uploaded file name is served from the public tenant folder", async () => {
    expect(await brandingFor(STORED)).toMatch(new RegExp(`/uploads/public/tenant/${STORED}$`));
  });

  it("a legacy same-origin path is reduced to its file name", async () => {
    expect(await brandingFor(`/uploads/public/tenant/${STORED}`)).toMatch(
      new RegExp(`/uploads/public/tenant/${STORED}$`),
    );
    expect(await brandingFor("/uploads/tenant/old.png")).toMatch(/\/uploads\/public\/tenant\/old\.png$/);
  });

  it.each([
    "https://cdn.example.com/logo.png",
    "http://tracker.example/pixel.gif",
    "//cdn.example.com/logo.png",
    "data:image/png;base64,iVBORw0KGgo=",
    "javascript:alert(1)",
  ])("an absolute value (%s) is not served: null, so the UI falls back", async (logo) => {
    expect(await brandingFor(logo)).toBeNull();
  });

  it.each([
    "/uploads/public/tenant/default.svg", // the placeholder, behind a path
    "/uploads/public/tenant/", // no file name
    "/uploads/public/tenant/.hidden.png", // a dotfile
    "logo with spaces.png",
  ])("a value that is not a stored file name (%s) is not served", async (logo) => {
    expect(await brandingFor(logo)).toBeNull();
  });

  it("no logo and the placeholder stay null (unchanged)", async () => {
    expect(await brandingFor(null)).toBeNull();
    expect(await brandingFor("default.svg")).toBeNull();
  });
});

describe("P7-08 — the validator accepts only a stored file name for logo", () => {
  it.each([createTenantSchema, updateTenantSchema])("accepts an uploaded name, empty and null", (schema) => {
    const base = schema === createTenantSchema ? { name: "Acme", code: "ACME" } : {};
    expect(validate({ ...base, logo: STORED }, schema).logo).toBe(STORED);
    expect(validate({ ...base, logo: "" }, schema).logo).toBe("");
    expect(validate({ ...base, logo: null }, schema).logo).toBeNull();
  });

  it.each([
    "https://example.com/logo.png",
    "//example.com/logo.png",
    "data:image/png;base64,AAAA",
    "/uploads/public/tenant/x.png",
    "../x.png",
    ".hidden.png",
  ])("refuses %s with a 400 naming the rule", (logo) => {
    for (const schema of [createTenantSchema, updateTenantSchema]) {
      const base = schema === createTenantSchema ? { name: "Acme", code: "ACME" } : {};
      let caught;
      try {
        validate({ ...base, logo }, schema);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.status ?? caught.statusCode).toBe(400);
      expect(JSON.stringify(caught.errors ?? caught.message)).toMatch(/uploaded file name/);
    }
  });
});
