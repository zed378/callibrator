/**
 * P9-18 — five behaviours of migration.service no suite asserted. The
 * service's conversion to TypeScript planted each as a defect in a scratch
 * mirror, and all 19 suites that name the module still passed:
 *
 *  1. A-259: ONE demo calibration record is enough to refuse the unseed. The
 *     records are append-only (ADR-062); the threshold is "any", not "many".
 *  2. A-125: seeding the default tenant creates the PLATFORM tenant first.
 *  3. A-125: the PLATFORM lookup passes `includePlatformTenant` — the Tenant
 *     hooks hide that row from every other query, so without it the seed
 *     would not find it and would try to create it again.
 *  4. The role seeds `bulkCreate` with `ignoreDuplicates`: two boots seeding
 *     at once must not fail on the unique role name.
 *  5. The demo seed's feature-flag count is the rows it ADDED (after - before),
 *     so a re-run reports 0.
 */

// P20-07: tenant creation also makes the tenant's self client facility (services/clientFacility,
// proven on memoryDb by clientFacility.service.p2007 and on PostgreSQL by clientFacilities.p2007.live).
// A fixture here: this suite is about the tenant, so the facility is a stand-in.
jest.mock("../../services/clientFacility.service", () => ({
  SELF_FACILITY_CODE: "SELF",
  selfFacilityName: (name: string): string => name,
  createSelfFacility: jest.fn(() => Promise.resolve({ id: "5e1f0000-0000-4000-8000-0000000000f0" })),
}));
import type * as MigrationServiceModule from "../../services/migration.service";

interface MockModel {
  findAll: jest.Mock;
  findOne: jest.Mock;
  findOrCreate: jest.Mock;
  create: jest.Mock;
  bulkCreate: jest.Mock;
  destroy: jest.Mock;
  count: jest.Mock;
}

const mockTx = { id: "tx" };

jest.mock("../../config", () => ({
  db: { transaction: jest.fn((work: (t: unknown) => Promise<unknown>) => work(mockTx)) },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../services/bootstrapCredential.service", () => ({
  ensureSystemSuperAdmin: jest.fn(() => Promise.resolve({ created: false })),
}));
jest.mock("../../services/featureFlag.service", () => ({ initializeTenantFlags: jest.fn(() => Promise.resolve(undefined)) }));
jest.mock("../../utils/seedMenuGroups.util", () => ({ seedMenuGroups: jest.fn(() => Promise.resolve(undefined)) }));
jest.mock("../../utils/password.util", () => ({ hashPassword: jest.fn(() => Promise.resolve("hashed")) }));
jest.mock("../../models", () => {
  const model = (): Record<string, jest.Mock> => {
    let n = 0;
    return {
      findAll: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(() => Promise.resolve(null)),
      findOrCreate: jest.fn(() => {
        n += 1;
        return Promise.resolve([{ id: `row-${String(n)}`, seq: 0, cardSeq: 0, save: jest.fn(() => Promise.resolve(undefined)) }, false]);
      }),
      create: jest.fn((values: object) => Promise.resolve({ id: "new", ...values })),
      bulkCreate: jest.fn(() => Promise.resolve([])),
      destroy: jest.fn(() => Promise.resolve(1)),
      count: jest.fn(() => Promise.resolve(0)),
    };
  };
  const names = [
    "Users", "Roles", "MenuGroup", "RoleMenuPermission", "Warehouse", "StorageLocation", "Stock",
    "StockTransfer", "StockAdjustment", "StockOpname", "Tenant", "Vendor", "SupplierScorecard",
    "CalibrationDevice", "CalibrationRecord", "Certificate", "MaintenanceWorkOrder", "IotReading",
    "NonConformance", "Capa", "SopDocument", "Risk", "Workflow", "WorkflowStep", "Ticket", "TicketComment",
    "TicketCounter", "KanbanProject", "KanbanColumn", "KanbanCard", "KanbanLabel", "Notification", "Post",
    "Category", "PostCategory", "TenantSettings",
  ];
  return Object.fromEntries(names.map((name) => [name, model()]));
});

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above */
const models = require("../../models") as unknown as Record<string, MockModel>;
const migrationService = require("../../services/migration.service") as typeof MigrationServiceModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const PLATFORM_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const m = (name: string): MockModel => models[name] as MockModel;
/** A mock's recorded calls, typed. */
const calls = (mock: jest.Mock): unknown[][] => mock.mock.calls as unknown[][];

describe("migration.service — pins found by the P9-18 planted defects", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("A-259: a single demo calibration record refuses the whole unseed", async () => {
    m("CalibrationDevice").findAll.mockResolvedValueOnce([{ id: "dev-1" }]);
    m("CalibrationRecord").count.mockResolvedValueOnce(1);

    const result = await migrationService.unseedDemoData();

    expect(result.refused).toBe(true);
    expect(result.deleted).toEqual({});
    expect(result.errors[0]).toMatch(/hold 1 calibration record\(s\)/);
    for (const name of ["Post", "Certificate", "CalibrationDevice", "Users", "Tenant"]) {
      expect(m(name).destroy).not.toHaveBeenCalled();
    }
  });

  it("A-125: seedAll creates the PLATFORM tenant before the default one, looked up with includePlatformTenant", async () => {
    await migrationService.seedAll();

    const lookups = calls(m("Tenant").findOne).map((call) => call[0] as { where: { id: string }; includePlatformTenant?: boolean });
    expect(lookups[0]).toMatchObject({ where: { id: PLATFORM_TENANT_ID }, paranoid: false, includePlatformTenant: true });
    const created = calls(m("Tenant").create).map((call) => (call[0] as { id: string }).id);
    expect(created[0]).toBe(PLATFORM_TENANT_ID);
    expect(created).toHaveLength(2);
  });

  it("A-125: a PLATFORM tenant the lookup finds is not created again", async () => {
    m("Tenant").findOne.mockImplementation((options: { where: { id: string } }) =>
      Promise.resolve(options.where.id === PLATFORM_TENANT_ID ? { id: PLATFORM_TENANT_ID } : null),
    );

    await migrationService.seedPlatformTenant();
    expect(m("Tenant").create).not.toHaveBeenCalled();
    m("Tenant").findOne.mockReset();
    m("Tenant").findOne.mockResolvedValue(null);
  });

  it("the role seeds insert with ignoreDuplicates, so concurrent boots do not fail on a role name", async () => {
    await migrationService.seedAllRoles();

    expect(m("Roles").bulkCreate).toHaveBeenCalledTimes(2);
    for (const call of calls(m("Roles").bulkCreate)) {
      expect(call[1]).toEqual({ ignoreDuplicates: true });
    }
  });

  it("the demo seed counts only the feature flags it added (a re-run reports 0)", async () => {
    m("Users").findOne.mockResolvedValue({ id: "sys-user" });
    m("TenantSettings").count.mockResolvedValueOnce(4).mockResolvedValueOnce(9);

    const first = await migrationService.seedDemoData();
    expect(first.errors).toEqual([]);
    expect(first.created.featureFlags).toBe(5);

    m("TenantSettings").count.mockResolvedValueOnce(9).mockResolvedValueOnce(9);
    const again = await migrationService.seedDemoData();
    expect(again.created.featureFlags).toBe(0);
    m("Users").findOne.mockReset();
    m("Users").findOne.mockResolvedValue(null);
  });
});
