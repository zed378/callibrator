/**
 * A-162 — the user service's credential resets call the backend's real routes
 * (backend/src/routes/api/user.route.js: POST /users/:userId/mfa/reset and
 * POST /users/:userId/password/reset) and unwrap `data`; the list carries
 * `mfaEnabled` so the page can offer "Reset MFA" only where there is MFA.
 *
 * A mock proves the client, not the contract (CLAUDE.md): the routes' own
 * behaviour is asserted in backend/src/tests/routes/user.mfaReset.a141.test.js
 * and user.passwordReset.a162.test.js.
 *
 * Fail-before (baseline 2a157f1): resetMfa and resetPassword did not exist,
 * and transformUser dropped mfaEnabled.
 */
import { userService } from "./user.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mocked = api as unknown as { get: jest.Mock; post: jest.Mock };

beforeEach(() => jest.clearAllMocks());

describe("A-162: userService credential resets", () => {
  it("resetMfa posts to /users/:id/mfa/reset and returns data", async () => {
    mocked.post.mockResolvedValue({
      success: true,
      data: { id: "u-2", mfaEnabled: false, sessionsRevoked: 2 },
    });

    const result = await userService.resetMfa("u-2");

    expect(mocked.post).toHaveBeenCalledWith("/api/v1/users/u-2/mfa/reset");
    expect(result).toEqual({ id: "u-2", mfaEnabled: false, sessionsRevoked: 2 });
  });

  it("resetPassword posts to /users/:id/password/reset and returns the temporary password", async () => {
    mocked.post.mockResolvedValue({
      success: true,
      data: { id: "u-2", temporaryPassword: "Abcd3fghJkmn7pqr", mustChangePassword: true, sessionsRevoked: 1 },
    });

    const result = await userService.resetPassword("u-2");

    expect(mocked.post).toHaveBeenCalledWith("/api/v1/users/u-2/password/reset");
    expect(result.temporaryPassword).toBe("Abcd3fghJkmn7pqr");
  });

  it("the id is path-encoded", async () => {
    mocked.post.mockResolvedValue({ success: true, data: {} });

    await userService.resetPassword("a/b");

    expect(mocked.post).toHaveBeenCalledWith("/api/v1/users/a%2Fb/password/reset");
  });

  it("the users list keeps mfaEnabled and mustChangePassword", async () => {
    mocked.get.mockResolvedValue({
      success: true,
      message: "ok",
      data: [
        { id: "u-1", username: "a", email: "a@x.test", mfaEnabled: true, mustChangePassword: false },
        { id: "u-2", username: "b", email: "b@x.test" },
      ],
      meta: { total: 2, page: 1, limit: 50, totalPages: 1 },
    });

    const { data } = await userService.getAll();

    expect(data.map((u) => [u.mfaEnabled, u.mustChangePassword])).toEqual([
      [true, false],
      [false, false],
    ]);
  });
});
