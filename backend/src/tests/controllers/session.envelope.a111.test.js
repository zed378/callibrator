/**
 * A-111 — GET /sessions sent `data: { sessions, meta }`, breaking the envelope
 * (CLAUDE.md: rows in `data`, pagination in a TOP-LEVEL `meta`, a sibling of
 * `data`; never `data.meta`).
 *
 * session.controller.test.js mocks response.util, so it pins the arguments the
 * controller passes, not the body a client receives. This test runs the REAL
 * response.util and asserts on the JSON body itself.
 */

const mockSessions = { findAndCountAll: jest.fn() };

jest.mock("../../models", () => ({
  Sessions: mockSessions,
  Users: {},
  Roles: {},
  Tenants: {},
}));

const sessionController = require("../../controllers/session.controller");

const SESSION = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";
const USER = "550e8400-e29b-41d4-a716-446655440000";

const resDouble = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe("A-111 — GET /sessions answers the standard envelope", () => {
  it("puts the rows in data and the pagination in a top-level meta", async () => {
    mockSessions.findAndCountAll.mockResolvedValueOnce({
      count: 21,
      rows: [
        {
          id: SESSION,
          user_id: USER,
          is_revoked: false,
          expired_at: new Date(Date.now() + 86400000),
          user: { username: "tech1", email: "t@x.test" },
        },
      ],
    });
    const res = resDouble();
    const next = jest.fn();

    await sessionController.getAllSessions(
      { query: { page: "2", limit: "20" }, user: { id: USER } },
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: SESSION, userId: USER, username: "tech1" });
    expect(body.meta).toEqual({ total: 21, page: 2, limit: 20, totalPages: 2 });
    // the old shape must not come back
    expect(body.data.sessions).toBeUndefined();
    expect(body.data.meta).toBeUndefined();
  });

  it("an empty page is an empty array, not an object", async () => {
    mockSessions.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });
    const res = resDouble();

    await sessionController.getAllSessions({ query: {}, user: { id: USER } }, res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.data).toEqual([]);
    expect(body.meta).toMatchObject({ total: 0 });
  });
});
