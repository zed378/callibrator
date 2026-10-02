/**
 * A-278 / A-282 (ADR-094) — vendor, risk, supplier-scorecard and asset-finance
 * writes commit with one audit row in their own transaction, and an API key
 * is recorded as `system:api-key`, never as a user.
 *
 * Before: none of these writes was audited. And `auditActor(req)` names
 * `req.user.id`, which for an API key is the KEY's id: `audit_logs.user_id`
 * references `users` (migration 0030), so on PostgreSQL such a row fails its
 * foreign key and the write rolls back. memoryDb enforces no foreign key, so
 * this suite asserts the shape that satisfies it: a system actor, the key's
 * id in `changes.apiKeyId`, `user_id` NULL.
 *
 * REAL routers, gates, validators, controllers, services, audit service and
 * models (fixtures/memoryDb); every role holds every menu (grantAllMenus).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type {
  Principal,
  TenantRow,
  TwoTenantWorld,
} from "../fixtures/routeClient";
import type { Row } from "../fixtures/memoryDb";
import type * as VendorRoutes from "../../routes/api/vendor.route";
import type * as RiskRoutes from "../../routes/api/risk.route";
import type * as ScorecardRoutes from "../../routes/api/supplierScorecard.route";
import type * as FinanceRoutes from "../../routes/api/finance.route";

/** An asymmetric matcher, typed so it can sit inside an object literal. */
const containing = (fields: Record<string, unknown>): unknown =>
  expect.objectContaining(fields) as unknown;

jest.mock("../../config", () => ({
  db: jest
    .requireActual<typeof MemoryDbModule>("../fixtures/memoryDb")
    .memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest
  .requireActual<typeof MemoryDbModule>("../fixtures/memoryDb")
  .memoryDb();
const { twoTenants, seedTenants, as, call, grantAllMenus } = jest.requireActual<
  typeof RouteClient
>("../fixtures/routeClient");
const vendors = jest.requireActual<typeof VendorRoutes>(
  "../../routes/api/vendor.route",
);
const risks = jest.requireActual<typeof RiskRoutes>(
  "../../routes/api/risk.route",
);
const scorecards = jest.requireActual<typeof ScorecardRoutes>(
  "../../routes/api/supplierScorecard.route",
);
const finance = jest.requireActual<typeof FinanceRoutes>(
  "../../routes/api/finance.route",
);

const KEY_ID = "ab000000-0000-4000-8000-0000000000b1";
const VENDOR_A = "a1000000-0000-4000-8000-000000000001";
const RISK_A = "a1000000-0000-4000-8000-000000000002";
const SCORECARD_A = "a1000000-0000-4000-8000-000000000003";
const DEVICE_A = "a1000000-0000-4000-8000-000000000004";
const FINANCE_A = "a1000000-0000-4000-8000-000000000005";

const apiKey = (tenant: TenantRow, scopes: string[]): Principal => ({
  id: KEY_ID,
  username: "integration",
  tenantId: tenant.id,
  tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
  role: { id: "", name: "API_KEY", roleLevel: 0 },
  isActive: true,
  status: "ACTIVE",
  isApiKey: true,
  apiKeyScopes: scopes,
});

let fx: TwoTenantWorld;
let admin: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("Vendor", {
    id: VENDOR_A,
    tenantId: fx.tenantA.id,
    name: "Lab A",
    type: "CalibrationLab",
  });
  mdb.seed("Risk", {
    id: RISK_A,
    tenantId: fx.tenantA.id,
    title: "Pump drift",
    status: "Open",
    severity: 3,
    likelihood: 3,
  });
  mdb.seed("SupplierScorecard", {
    id: SCORECARD_A,
    tenantId: fx.tenantA.id,
    vendorId: VENDOR_A,
    evaluationDate: "2026-09-01",
    qualityScore: 4,
    deliveryScore: 4,
    serviceScore: 4,
  });
  mdb.seed("CalibrationDevice", {
    id: DEVICE_A,
    tenantId: fx.tenantA.id,
    name: "Infusion pump",
    serialNumber: "SN-1",
  });
  mdb.seed("AssetFinance", {
    id: FINANCE_A,
    tenantId: fx.tenantA.id,
    deviceId: DEVICE_A,
    purchasePrice: 1000,
    purchaseDate: "2025-01-01",
    usefulLifeYears: 5,
  });
});

/** The one committed audit row, and whether it shares a transaction with a write to `model`. */
const oneRowWith = (model: string): Row => {
  const committed = mdb.committed();
  const audits = committed.filter((w) => w.model === "AuditLog");
  expect(audits).toHaveLength(1);
  const writeTx = new Set(
    committed.filter((w) => w.model === model).map((w) => w.tx),
  );
  expect(audits[0]?.tx).not.toBeNull();
  expect(writeTx.has(audits[0]?.tx ?? null)).toBe(true);
  return mdb.rows("AuditLog")[0] ?? {};
};

const byKey = (tenantId: string): Record<string, unknown> => ({
  tenantId,
  userId: null,
  actorType: "system",
  actorName: "system:api-key",
});

describe("A-278 / A-282 — vendors, written by an API key", () => {
  const key = (): Principal => apiKey(fx.tenantA, ["vendors:write"]);

  it("POST: one CREATE row as system:api-key naming the key", async () => {
    as(key());
    const res = await call(vendors, "POST", "/", {
      body: { name: "Lab B", type: "CalibrationLab" },
    });
    expect(res.status).toBe(201);
    expect(oneRowWith("Vendor")).toMatchObject({
      ...byKey(fx.tenantA.id),
      action: "CREATE",
      resourceType: "Vendor",
      changes: containing({ operation: "VENDOR_CREATE", apiKeyId: KEY_ID }),
    });
  });

  it("PATCH: one UPDATE row with the value before and after", async () => {
    as(key());
    const res = await call(vendors, "PATCH", `/${VENDOR_A}`, {
      body: { name: "Lab A (renamed)" },
    });
    expect(res.status).toBe(200);
    expect(oneRowWith("Vendor")).toMatchObject({
      ...byKey(fx.tenantA.id),
      action: "UPDATE",
      resourceId: VENDOR_A,
      changes: containing({
        before: { name: "Lab A" },
        after: { name: "Lab A (renamed)" },
        apiKeyId: KEY_ID,
      }),
    });
  });

  it("DELETE: one DELETE row", async () => {
    as(key());
    const res = await call(vendors, "DELETE", `/${VENDOR_A}`);
    expect(res.status).toBe(200);
    expect(oneRowWith("Vendor")).toMatchObject({
      ...byKey(fx.tenantA.id),
      action: "DELETE",
      resourceId: VENDOR_A,
    });
  });

  it("a user's qualification is recorded as that user", async () => {
    as(admin);
    const res = await call(vendors, "PATCH", `/${VENDOR_A}/qualify`, {
      body: { approvalStatus: "APPROVED" },
    });
    expect(res.status).toBe(200);
    expect(oneRowWith("Vendor")).toMatchObject({
      userId: admin.id,
      actorType: "user",
      changes: containing({ operation: "VENDOR_QUALIFY" }),
    });
  });
});

describe("A-278 — risks, scorecards and asset finance, written by a user", () => {
  it("risk POST and PUT each commit one row with the write", async () => {
    as(admin);
    expect(
      (
        await call(risks, "POST", "/", {
          body: { title: "New risk", severity: 2, likelihood: 2 },
        })
      ).status,
    ).toBe(201);
    oneRowWith("Risk");
    mdb.reset();
    seedTenants(mdb, fx, [admin]);
    mdb.seed("Risk", {
      id: RISK_A,
      tenantId: fx.tenantA.id,
      title: "Pump drift",
      status: "Open",
      severity: 3,
      likelihood: 3,
    });

    expect(
      (
        await call(risks, "PUT", `/${RISK_A}`, {
          // A-335: status is one of RISK_STATUSES (the model's upper-case vocabulary).
          body: { status: "MITIGATED" },
        })
      ).status,
    ).toBe(200);
    expect(oneRowWith("Risk")).toMatchObject({
      userId: admin.id,
      action: "UPDATE",
      changes: containing({
        before: { status: "Open" },
        after: { status: "MITIGATED" },
      }),
    });
  });

  it("risk DELETE commits one row with the delete", async () => {
    as(admin);
    expect((await call(risks, "DELETE", `/${RISK_A}`)).status).toBeLessThan(
      300,
    );
    expect(oneRowWith("Risk")).toMatchObject({
      action: "DELETE",
      resourceId: RISK_A,
    });
  });

  it("scorecard PUT commits one row with the write", async () => {
    as(admin);
    expect(
      (
        await call(scorecards, "PUT", `/${SCORECARD_A}`, {
          body: { qualityScore: 5 },
        })
      ).status,
    ).toBe(200);
    expect(oneRowWith("SupplierScorecard")).toMatchObject({
      action: "UPDATE",
      changes: containing({ operation: "SCORECARD_UPDATE" }),
    });
  });

  it("asset finance PATCH commits one row with the value before and after", async () => {
    as(admin);
    expect(
      (
        await call(finance, "PATCH", `/${FINANCE_A}`, {
          body: { usefulLifeYears: 6 },
        })
      ).status,
    ).toBe(200);
    expect(oneRowWith("AssetFinance")).toMatchObject({
      action: "UPDATE",
      changes: containing({
        before: { usefulLifeYears: 5 },
        after: { usefulLifeYears: 6 },
      }),
    });
  });
});
