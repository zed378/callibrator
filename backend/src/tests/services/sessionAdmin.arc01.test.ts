/**
 * ARC-01 + BUG-02 (the 2026-11 audit) — the session management service.
 *
 * The controller no longer opens a transaction or queries a model. What moved
 * keeps its behaviour, and two reads that still disagreed with the list's
 * `revoked` filter now agree with it:
 *  - the stats' `revoked` count is every ENDED session: revoked, or
 *    deactivated without being revoked;
 *  - a deactivated (not revoked, not expired) session can be deleted, as an
 *    ended one; a live one still cannot.
 */
import { Op } from "sequelize";

import type SessionAdminService from "../../services/sessionAdmin.service";

const mockTransaction = { id: "tx" };
const mockSessions = {
  findByPk: jest.fn(),
  count: jest.fn(),
};
const mockLogAction = jest.fn().mockResolvedValue({});

jest.mock("../../models", () => ({
  Sessions: mockSessions,
  Users: { unscoped: jest.fn() },
  Roles: {},
  Tenants: {},
  sequelize: { transaction: jest.fn((fn: (t: unknown) => unknown) => fn(mockTransaction)) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: mockLogAction }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const service = require("../../services/sessionAdmin.service") as typeof SessionAdminService;

const FUTURE = new Date(Date.now() + 3_600_000);
const principal = { userId: "u1", apiKeyId: null, ipAddress: "127.0.0.1", userAgent: "jest" };
const owner = { userId: "u1", isAdmin: false };

describe("ARC-01 — sessionAdmin.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("a session deactivated without being revoked can be deleted, with its audit row in the same transaction", async () => {
    const destroy = jest.fn();
    mockSessions.findByPk.mockResolvedValue({
      id: "s1",
      user_id: "u1",
      tenant_id: "t1",
      is_revoked: false,
      is_active: false,
      expired_at: FUTURE,
      destroy,
    });

    await service.deleteSession("s1", owner, principal);

    expect(destroy).toHaveBeenCalledWith({ transaction: mockTransaction });
    expect(mockLogAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DELETE", resourceType: "session", resourceId: "s1", tenantId: "t1" }),
      { transaction: mockTransaction },
    );
  });

  it("a live session still cannot be deleted (400), and nothing is written", async () => {
    const destroy = jest.fn();
    mockSessions.findByPk.mockResolvedValue({
      id: "s1",
      user_id: "u1",
      is_revoked: false,
      is_active: true,
      expired_at: FUTURE,
      destroy,
    });

    await expect(service.deleteSession("s1", owner, principal)).rejects.toMatchObject({ status: 400 });
    expect(destroy).not.toHaveBeenCalled();
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("the stats' revoked count is every ended session: revoked, or deactivated", async () => {
    mockSessions.count.mockResolvedValue(0);

    await service.sessionStats("u1");

    expect(mockSessions.count).toHaveBeenCalledWith({
      where: { user_id: "u1", [Op.or]: [{ is_revoked: true }, { is_active: false }] },
    });
  });
});
