/**
 * A-262 — userService.resetPasskey calls the backend's real route
 * (backend/src/routes/api/user.route.js: DELETE /users/:userId/webauthn) and
 * unwraps `data`; the users list carries `webauthnEnabled` so the page can
 * offer "Remove passkey" only where there is one.
 *
 * A mock proves the client, not the contract (CLAUDE.md): the route's own
 * behaviour is asserted in backend/src/tests/routes/user.passkeyReset.a262.test.js.
 *
 * Fail-before: resetPasskey did not exist, and transformUser dropped
 * webauthnEnabled.
 */
import { userService } from "./user.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mocked = api as unknown as { get: jest.Mock; delete: jest.Mock };

beforeEach(() => jest.clearAllMocks());

describe("A-262: userService.resetPasskey", () => {
  it("deletes /users/:id/webauthn and returns data", async () => {
    mocked.delete.mockResolvedValue({
      success: true,
      data: { id: "u-2", webauthnEnabled: false, sessionsRevoked: 2 },
    });

    const result = await userService.resetPasskey("u-2");

    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/users/u-2/webauthn");
    expect(result).toEqual({ id: "u-2", webauthnEnabled: false, sessionsRevoked: 2 });
  });

  it("the id is path-encoded", async () => {
    mocked.delete.mockResolvedValue({ success: true, data: {} });

    await userService.resetPasskey("a/b");

    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/users/a%2Fb/webauthn");
  });

  it("the users list keeps webauthnEnabled", async () => {
    mocked.get.mockResolvedValue({
      success: true,
      message: "ok",
      data: [
        { id: "u-1", username: "a", email: "a@x.test", webauthnEnabled: true },
        { id: "u-2", username: "b", email: "b@x.test" },
      ],
      meta: { total: 2, page: 1, limit: 50, totalPages: 1 },
    });

    const { data } = await userService.getAll();

    expect(data.map((u) => u.webauthnEnabled)).toEqual([true, false]);
  });
});
