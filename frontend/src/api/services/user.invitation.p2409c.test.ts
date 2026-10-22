/**
 * P24-09c — userService's invitation calls go to the backend's real routes
 * (backend/src/routes/api/user.route.ts: GET / POST / DELETE /users/:userId/invitation)
 * and unwrap `data`; the users list carries `awaitingInvitation` so the page can
 * offer "Invite" only for an imported account still waiting for one.
 *
 * A mock proves the client, not the contract (CLAUDE.md): the routes' own
 * behaviour is asserted in backend/src/tests/routes/userInvitation.p2409a.test.ts.
 */
import { userService } from "./user.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mocked = api as unknown as { get: jest.Mock; post: jest.Mock; delete: jest.Mock };

beforeEach(() => jest.clearAllMocks());

describe("P24-09c: userService invitation calls", () => {
  it("reads the state", async () => {
    mocked.get.mockResolvedValue({ success: true, data: { awaitingInvitation: true, invitationsOpen: false } });
    expect(await userService.getInvitation("u-7")).toEqual({ awaitingInvitation: true, invitationsOpen: false });
    expect(mocked.get.mock.calls[0]?.[0]).toBe("/api/v1/users/u-7/invitation");
  });

  it("issues with the person's name, or an empty body; the id is path-encoded", async () => {
    mocked.post.mockResolvedValue({ success: true, data: { issuedAt: "a", expiresAt: "b", emailQueued: true } });
    expect(await userService.issueInvitation("u-7", { firstName: "Siti", lastName: "Rahma" })).toEqual({ issuedAt: "a", expiresAt: "b", emailQueued: true });
    expect(mocked.post).toHaveBeenCalledWith("/api/v1/users/u-7/invitation", { firstName: "Siti", lastName: "Rahma" });
    await userService.issueInvitation("a/b");
    expect(mocked.post).toHaveBeenLastCalledWith("/api/v1/users/a%2Fb/invitation", {});
  });

  it("revokes", async () => {
    mocked.delete.mockResolvedValue({ success: true, data: { revokedAt: "c" } });
    expect(await userService.revokeInvitation("u-7")).toEqual({ revokedAt: "c" });
    expect(mocked.delete).toHaveBeenCalledWith("/api/v1/users/u-7/invitation");
  });

  it("the users list keeps awaitingInvitation", async () => {
    mocked.get.mockResolvedValue({
      success: true,
      message: "ok",
      data: [
        { id: "u-1", username: "a", email: "a@x.test", awaitingInvitation: true },
        { id: "u-2", username: "b", email: "b@x.test" },
      ],
      meta: { total: 2, page: 1, limit: 50, totalPages: 1 },
    });
    const page = await userService.getAll();
    expect(page.data.map((u) => u.awaitingInvitation)).toEqual([true, false]);
  });
});
