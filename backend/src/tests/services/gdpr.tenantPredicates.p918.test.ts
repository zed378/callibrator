/**
 * P9-18 (gdpr, four gates): every subject read and write names the tenant
 * explicitly.
 *
 * Found by planted defects during the conversion. Three plants left every
 * gdpr suite green: dropping `tenantId` from the Article 15 profile read, from
 * the consent withdrawal, and from the consent history. The global tenant
 * hooks would still scope a request-path call, but the export also runs from
 * jobs and sweeps (runForTenant), and an explicit predicate is the stated rule
 * for subject data (A-151). This test pins each predicate to the caller's
 * tenant. The expected values are written here by hand, not read from the
 * service.
 */
const mockUserFindOne = jest.fn();
const mockConsentUpdate = jest.fn();
const mockConsentFindAll = jest.fn();
const mockLogAction = jest.fn();

// P8-01 (ADR-086 Amendment 1): an export's archive and manifest are kept in
// the tenant's storage; the double keeps the real key rules
// (fixtures/fakeStorage) and holds the bytes in memory.
jest.mock("../../services/storage", () => jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage());
jest.mock("../../config", () => ({
  db: { transaction: async (fn: (t: object) => Promise<unknown>) => fn({ tx: 1 }) },
}));
jest.mock("../../models", () => ({
  User: { findOne: mockUserFindOne },
  Role: {},
  ConsentRecord: { update: mockConsentUpdate, findAll: mockConsentFindAll },
}));
jest.mock("../../services/audit.service", () => ({ logAction: mockLogAction }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const gdpr = require("../../services/gdpr.service") as {
  exportUserData: (tenantId: string, userId: string) => Promise<unknown>;
  withdrawConsent: (tenantId: string, userId: string, purpose: string) => Promise<unknown>;
  getConsentHistory: (tenantId: string, userId: string) => Promise<unknown>;
};

const TENANT = "5ea5c400-0000-4000-8000-0000000000a1";
const SUBJECT = "5ea5c400-0000-4000-8000-0000000000e1";

const whereOf = (mock: jest.Mock, argIndex: number): Record<string, unknown> => {
  const call = mock.mock.calls[0] as unknown[];
  return (call[argIndex] as { where: Record<string, unknown> }).where;
};

describe("gdpr — the tenant predicate is explicit on subject data", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogAction.mockResolvedValue({});
  });

  it("the Article 15 profile read is scoped to the subject AND the tenant", async () => {
    mockUserFindOne.mockResolvedValue(null);
    await expect(gdpr.exportUserData(TENANT, SUBJECT)).rejects.toMatchObject({ status: 404 });
    expect(whereOf(mockUserFindOne, 0)).toEqual({ id: SUBJECT, tenantId: TENANT });
  });

  it("a consent withdrawal updates only the tenant's granted rows for the subject", async () => {
    mockConsentUpdate.mockResolvedValue([1]);
    await gdpr.withdrawConsent(TENANT, SUBJECT, "marketing");
    expect(whereOf(mockConsentUpdate, 1)).toEqual({
      tenantId: TENANT,
      userId: SUBJECT,
      purpose: "marketing",
      status: "granted",
    });
  });

  it("the consent history reads only the tenant's rows for the subject", async () => {
    mockConsentFindAll.mockResolvedValue([]);
    await gdpr.getConsentHistory(TENANT, SUBJECT);
    expect(whereOf(mockConsentFindAll, 0)).toEqual({ tenantId: TENANT, userId: SUBJECT });
  });
});
