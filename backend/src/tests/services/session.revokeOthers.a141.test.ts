/**
 * A-141 — session.service#revokeOtherSessions: replacing or disabling an
 * authenticator signs out every OTHER session of the user; an administrator's
 * MFA reset signs out all of them.
 *
 * Fail-before: the function did not exist (replacing an authenticator revoked
 * nothing).
 *
 * The where clause is asserted as the SQL predicate it becomes: every live
 * session of the user except the caller's, with the tenant scope skipped (the
 * user id is server-derived; a tenant-less principal's scope would otherwise
 * match NO_TENANT_UUID and revoke nothing).
 */
import { Op, type Transaction } from "sequelize";
import type * as SessionServiceModule from "../../services/session.service";
import type { UserId } from "../../types/ids";

jest.mock("../../models", () => ({
  Sessions: { update: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the mocked barrel, typed as its mocks
const { Sessions } = require("../../models") as {
    Sessions: { update: jest.Mock };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the module under test is `export =` (CommonJS), as built
const { revokeOtherSessions } = require("../../services/session.service") as typeof SessionServiceModule;

const USER_ID = "11111111-1111-4111-8111-111111111111" as UserId;

beforeEach(() => {
  jest.clearAllMocks();
  Sessions.update.mockResolvedValue([4]);
});

describe("A-141: revokeOtherSessions", () => {
  it("revokes every live session of the user except the one named, and says how many", async () => {
    const tx = { id: "tx" } as unknown as Transaction;

    const count = await revokeOtherSessions(USER_ID, "sess-mine", "MFA_ROTATED", { transaction: tx });

    expect(count).toBe(4);
    expect(Sessions.update).toHaveBeenCalledWith(
      {
        is_revoked: true,
        revoked_at: expect.any(Date) as unknown,
        revoked_reason: "MFA_ROTATED",
        is_active: false,
      },
      {
        where: { user_id: USER_ID, is_revoked: false, id: { [Op.ne]: "sess-mine" } },
        transaction: tx,
        skipTenantScope: true,
      },
    );
  });

  it("with no session to keep, revokes them all", async () => {
    await revokeOtherSessions(USER_ID, null, "MFA_ADMIN_RESET");

    const [, options] = Sessions.update.mock.calls[0] as [unknown, { where: unknown; transaction: unknown }];
    expect(options.where).toEqual({ user_id: USER_ID, is_revoked: false });
    expect(options.transaction).toBeUndefined();
  });
});
