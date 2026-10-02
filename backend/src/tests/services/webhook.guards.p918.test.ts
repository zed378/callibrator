/**
 * P9-18 (webhook, four gates): three guards no suite pinned, found by planted
 * defects during the conversion.
 *
 * - Registration refuses an internal URL BEFORE anything is stored. Every
 *   suite stubs `assertSafeUrl`, so removing the call from createWebhook left
 *   them green; the update path was covered, the create path was not.
 * - A webhook is loaded by its id AND the caller's tenant. The tenant hooks
 *   would also scope it on a request path, which is why the two-tenant suite
 *   stayed green, but the explicit predicate is the stated rule (A-51 404s).
 * - Each delivery re-resolves the registered host (`assertResolvedHostIsPublic`)
 *   BEFORE anything is sent. That is the backstop against a hostname that
 *   resolves internally, and the A-307 suite exercised only pinnedFetch.
 */
const mockAssertSafeUrl = jest.fn();
const mockResolved = jest.fn();
const mockPinnedFetch = jest.fn();
const mockFindOne = jest.fn();
const mockCreate = jest.fn();
const mockDeliveryFindOne = jest.fn();

jest.mock("../../utils/ssrf.util", () => ({
  assertSafeUrl: mockAssertSafeUrl,
  assertResolvedHostIsPublic: mockResolved,
  pinnedFetch: mockPinnedFetch,
}));
jest.mock("../../models", () => ({
  Webhook: { findOne: mockFindOne, create: mockCreate },
  WebhookDelivery: { findOne: mockDeliveryFindOne },
}));
jest.mock("../../config", () => ({
  db: {
    transaction: (fn: (t: object) => Promise<unknown>) => fn({ tx: 1 }),
    query: jest.fn().mockResolvedValue([{ id: "d1", tenantId: "5ea5c400-0000-4000-8000-0000000000a1" }]),
  },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../services/kms.service", () => ({
  encryptData: (_t: string, p: string) => `v1:${p}`,
  decryptData: (_t: string, p: string) => p,
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const webhook = require("../../services/webhook.service") as {
  createWebhook: (tenantId: string, input: Record<string, unknown>, actor?: object) => Promise<{ secret: string }>;
  getWebhook: (tenantId: string, id: string) => Promise<unknown>;
  _dispatchDelivery: (id: string, tenantId: string) => Promise<unknown>;
};

const TENANT = "5ea5c400-0000-4000-8000-0000000000a1";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("webhook — registration, lookup and the delivery backstop", () => {
  it("an internal URL is refused at registration, before any row is written", async () => {
    mockAssertSafeUrl.mockImplementation(() => {
      throw Object.assign(new Error("URL host resolves to a disallowed (internal) address"), { status: 400 });
    });
    await expect(
      webhook.createWebhook(TENANT, { url: "http://169.254.169.254/latest", events: ["*"] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockAssertSafeUrl).toHaveBeenCalledWith("http://169.254.169.254/latest");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("a caller-supplied secret is never used: the stored secret is the generated one", async () => {
    mockAssertSafeUrl.mockReset();
    mockCreate.mockImplementation((values: Record<string, unknown>) =>
      Promise.resolve({ ...values, id: "w1", createdAt: new Date(0) }),
    );
    const created = await webhook.createWebhook(TENANT, { url: "https://r.example.com/h", events: ["*"], secret: "attacker" });
    expect(created.secret).not.toBe("attacker");
    expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
    const [[stored]] = mockCreate.mock.calls as [[{ secret: string }]];
    expect(stored.secret).toBe(`v1:${created.secret}`);
  });

  it("a webhook is loaded by its id AND the caller's tenant", async () => {
    mockFindOne.mockResolvedValue(null);
    await expect(webhook.getWebhook(TENANT, "w9")).rejects.toMatchObject({ status: 404 });
    expect(mockFindOne).toHaveBeenCalledWith({ where: { id: "w9", tenantId: TENANT } });
  });

  it("a delivery re-resolves the host, and sends nothing when it now resolves internally", async () => {
    mockDeliveryFindOne.mockResolvedValue({
      id: "d1",
      tenantId: TENANT,
      webhookId: "w1",
      event: "certificate.signed",
      attempts: 0,
      payload: {},
      createdAt: new Date(0),
      update: jest.fn().mockResolvedValue({}),
    });
    mockFindOne.mockResolvedValue({
      id: "w1",
      tenantId: TENANT,
      url: "https://rebinds.example.com/h",
      isActive: true,
      secret: "s",
      previousSecret: null,
      previousSecretExpiresAt: null,
    });
    mockResolved.mockRejectedValue(new Error("URL host resolves to a disallowed (internal) address"));

    await webhook._dispatchDelivery("d1", TENANT);

    expect(mockResolved).toHaveBeenCalledWith("https://rebinds.example.com/h");
    expect(mockPinnedFetch).not.toHaveBeenCalled();
  });
});
