/**
 * A-263 — the super admin lifecycle responses returned the raw Tenant row.
 *
 * `suspend`, `resume`, `grace-period`, `offboard` and `cancel-offboarding`
 * answered with the Tenant instance itself, whose `settings` JSONB can still
 * carry a credential mirrored there before migration 0035 scrubbed it (or by
 * any path that still writes one). A-179 closed the same leak on
 * GET /tenant-lifecycle/:tenantId/export; these five went out unredacted.
 *
 * What is real: the controller, tenantLifecycle.service, the Tenant model
 * (a built instance of the REAL model, serialized by its own toJSON through
 * the REAL response.util), constants/tenantSecretSettings.js. What is faked:
 * the database — Tenant.findByPk returns the built row, save/upsert resolve,
 * and the offboarding transaction and its audit row are stubbed.
 *
 * The credential-shaped keys and values are written out by hand (CLAUDE.md
 * § Evidence): the claim is "these never leave the server", not "whatever the
 * redactor redacts is redacted".
 */
import type { Request, Response, NextFunction } from "express";
import type * as SequelizeType from "sequelize";

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeType>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async () => {
    await Promise.resolve();
    throw new Error("no database in this test");
  };
  db.transaction = (async <T>(work: (t: unknown) => Promise<T>): Promise<T> => {
    await Promise.resolve();
    return work({ LOCK: {} });
  }) as unknown as typeof db.transaction;
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

interface TenantInstanceDouble {
  id: string;
  name: string;
  subdomain: string;
  code: string;
  email: string;
  status: string;
  settings: Record<string, unknown> | null;
  save: () => Promise<unknown>;
}

interface ModelsDouble {
  Tenant: {
    build: (values: Record<string, unknown>, options?: { isNewRecord?: boolean }) => TenantInstanceDouble;
    findByPk: (id: string) => Promise<TenantInstanceDouble | null>;
    prototype: {
      save: () => Promise<unknown>;
    };
  };
  TenantSettings: {
    upsert: (values: Record<string, unknown>) => Promise<[unknown, boolean | null]>;
  };
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

interface TenantLifecycleControllerDouble {
  suspendTenant: Handler;
  resumeTenant: Handler;
  enterGracePeriod: Handler;
  offboardTenant: Handler;
  cancelOffboarding: Handler;
}

interface CallResult {
  status: number;
  text: string;
  body: {
    data: {
      status?: string;
      settings?: Record<string, unknown> | null;
      id?: string;
      tenant?: {
        status?: string;
        settings?: Record<string, unknown> | null;
        id?: string;
      };
    };
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const models = require("../../models") as ModelsDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const controller = require("../../controllers/tenantLifecycle.controller") as TenantLifecycleControllerDouble;

const TENANT = "11111111-1111-4111-8111-111111111111";
const OPERATOR = "99999999-9999-4999-8999-999999999999";

/** Credentials a tenant row's settings JSONB could carry — none may be answered. */
const SECRETS: Record<string, string> = {
  ai_api_key: "sk-live-MIRRORED-IN-TENANTS-SETTINGS",
  aiApiKey: "sk-live-CAMELCASE-MIRRORED-KEY-0000", // camelCase, as a hand-written mirror would name it
  smtpPassword: "SMTP-CAMELCASE-PASSWORD-correcthorse",
  smtp_password: "SMTP-PASSWORD-hunter2",
  storage_credentials: "S3-SECRET-ACCESS-KEY-wJalrXUtnFEMI",
  oidc_rp_portal: "OIDC-RP-SECRET-SHA256-deadbeef",
  webhook_signing_secret: "whsec_LIVE-SIGNING-SECRET",
};

/** Ordinary settings that must survive the redaction. */
const ORDINARY: Record<string, string> = { theme: "dark", timezone: "Asia/Jakarta", sso_idp_cert: "-----BEGIN CERTIFICATE-----" };

let tenant: TenantInstanceDouble | undefined;

const buildTenant = (status: string): TenantInstanceDouble =>
  models.Tenant.build(
    {
      id: TENANT,
      name: "Hospital A",
      subdomain: "hospital-a",
      code: "HOSP-A",
      email: "admin@hospital-a.test",
      status,
      settings: { ...ORDINARY, ...SECRETS },
    },
    { isNewRecord: false },
  );

const call = (handler: Handler, params: Record<string, string> = {}, body: Record<string, unknown> = {}): Promise<CallResult> =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        // What goes on the wire: the same serialization express applies.
        resolve({
          status: this.statusCode,
          text: JSON.stringify(payload),
          body: JSON.parse(JSON.stringify(payload)) as CallResult["body"],
        });
        return this;
      },
    };
    const req = {
      params: { tenantId: TENANT, ...params },
      body,
      user: { id: OPERATOR, tenantId: null, role: { name: "SUPERADMIN" } },
      headers: {},
      ip: "192.0.2.1",
      get: () => undefined,
    };
    handler(req as unknown as Request, res as unknown as Response, reject);
  });

beforeEach(() => {
  jest.spyOn(models.Tenant, "findByPk").mockImplementation(async () => {
    await Promise.resolve();
    return tenant ?? null;
  });
  jest.spyOn(models.Tenant.prototype, "save").mockImplementation(async function save(this: unknown) {
    await Promise.resolve();
    return this;
  });
  jest.spyOn(models.TenantSettings, "upsert").mockResolvedValue([{}, true] as unknown as [unknown, boolean | null]);
});

afterEach(() => jest.restoreAllMocks());

const assertRedacted = (res: CallResult, tenantBody: { id?: string; settings?: Record<string, unknown> | null }) => {
  expect(res.status).toBe(200);
  for (const value of Object.values(SECRETS)) {
    expect(res.text).not.toContain(value);
  }
  for (const key of Object.keys(SECRETS)) {
    expect(tenantBody.settings).not.toHaveProperty(key);
  }
  expect(tenantBody.settings).toEqual(ORDINARY);
  expect(tenantBody.id).toBe(TENANT);
};

describe("A-263 — lifecycle responses never carry a credential from tenants.settings", () => {
  it("suspend answers the tenant without its credential-shaped settings", async () => {
    tenant = buildTenant("active");
    const res = await call(controller.suspendTenant, {}, { reason: "Unpaid invoice" });
    assertRedacted(res, res.body.data);
    expect(res.body.data.status).toBe("suspended");
  });

  it("suspend of an already-suspended tenant (the early return) is redacted too", async () => {
    tenant = buildTenant("suspended");
    const res = await call(controller.suspendTenant, {}, { reason: "Unpaid invoice" });
    assertRedacted(res, res.body.data);
  });

  it("resume answers the tenant without its credential-shaped settings", async () => {
    tenant = buildTenant("suspended");
    const res = await call(controller.resumeTenant);
    assertRedacted(res, res.body.data);
    expect(res.body.data.status).toBe("active");
  });

  it("grace-period answers the tenant without its credential-shaped settings", async () => {
    tenant = buildTenant("suspended");
    const res = await call(controller.enterGracePeriod);
    assertRedacted(res, res.body.data);
  });

  it("offboard answers { tenant } without its credential-shaped settings", async () => {
    tenant = buildTenant("active");
    const res = await call(controller.offboardTenant);
    assertRedacted(res, res.body.data.tenant as { id?: string; settings?: Record<string, unknown> | null });
    expect(res.body.data.tenant?.status).toBe("deleted");
  });

  it("offboard of an already-offboarded tenant (the early return, a bare row) is redacted too", async () => {
    tenant = buildTenant("deleted");
    const res = await call(controller.offboardTenant);
    assertRedacted(res, res.body.data);
  });

  it("cancel-offboarding answers the tenant without its credential-shaped settings", async () => {
    tenant = buildTenant("deleted");
    const res = await call(controller.cancelOffboarding);
    assertRedacted(res, res.body.data);
    expect(res.body.data.status).toBe("active");
  });

  it("the stored row is not changed by the redaction — only the response is", async () => {
    tenant = buildTenant("active");
    await call(controller.suspendTenant, {}, { reason: "Unpaid invoice" });
    expect(tenant.settings).toEqual({ ...ORDINARY, ...SECRETS });
  });

  it("a tenant whose settings are null is answered with null settings", async () => {
    tenant = buildTenant("active");
    tenant.settings = null;
    const res = await call(controller.suspendTenant, {}, { reason: "Unpaid invoice" });
    expect(res.body.data.settings).toBeNull();
  });

  it("a plain row (not an instance) is redacted the same way", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const service = require("../../services/tenantLifecycle.service") as { resumeTenant: jest.Mock };
    jest.spyOn(service, "resumeTenant").mockResolvedValueOnce({ id: TENANT, settings: { ...ORDINARY, ...SECRETS } });
    const res = await call(controller.resumeTenant);
    assertRedacted(res, res.body.data);
  });

  it("a row without a settings column is passed through, and no row is answered as null", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const service = require("../../services/tenantLifecycle.service") as { resumeTenant: jest.Mock; cancelOffboarding: jest.Mock };
    jest.spyOn(service, "resumeTenant").mockResolvedValueOnce({ id: TENANT, status: "active" });
    const bare = await call(controller.resumeTenant);
    expect(bare.body.data).toEqual({ id: TENANT, status: "active" });

    jest.spyOn(service, "cancelOffboarding").mockResolvedValueOnce(null);
    const none = await call(controller.cancelOffboarding);
    expect(none.body.data).toBeNull();
  });
});
