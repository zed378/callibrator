/**
 * A-111 — GET /sessions sent `data: { sessions, meta }`, breaking the envelope
 * (CLAUDE.md: rows in `data`, pagination in a TOP-LEVEL `meta`, a sibling of
 * `data`; never `data.meta`).
 *
 * session.controller.test.js mocks response.util, so it pins the arguments the
 * controller passes, not the body a client receives. This test runs the REAL
 * response.util and asserts on the JSON body itself.
 */
import type { Request, Response } from "express";
import type * as SessionController from "../../controllers/session.controller";

const mockSessions = { findAndCountAll: jest.fn() };

jest.mock("../../models", () => ({
  Sessions: mockSessions,
  Users: {},
  Roles: {},
  Tenants: {},
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the controller is TypeScript with `export =` (ADR-087 Am. 15: no named import beside it)
const sessionController = require("../../controllers/session.controller") as typeof SessionController;

const SESSION = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";
const USER = "550e8400-e29b-41d4-a716-446655440000";

interface ResDouble {
    status: jest.Mock;
    json: jest.Mock;
}

const resDouble = (): ResDouble => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

/** The JSON body the controller answered (the audit.controller house pattern). */
const bodyOf = (res: ResDouble): Record<string, unknown> =>
    (res.json.mock.calls[0] as unknown[])[0] as Record<string, unknown>;

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
            { query: { page: "2", limit: "20" }, user: { id: USER } } as unknown as Request,
            res as unknown as Response,
            next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = bodyOf(res);
    expect(body["success"]).toBe(true);
    expect(Array.isArray(body["data"])).toBe(true);
    expect(body["data"]).toHaveLength(1);
    expect(body["data"]).toMatchObject([{ id: SESSION, userId: USER, username: "tech1" }]);
    expect(body["meta"]).toEqual({ total: 21, page: 2, limit: 20, totalPages: 2 });
    // the old shape must not come back
    expect((body["data"] as Record<string, unknown>)["sessions"]).toBeUndefined();
    expect((body["data"] as Record<string, unknown>)["meta"]).toBeUndefined();
  });

  it("an empty page is an empty array, not an object", async () => {
    mockSessions.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });
    const res = resDouble();

    await sessionController.getAllSessions(
            { query: {}, user: { id: USER } } as unknown as Request,
            res as unknown as Response,
            jest.fn(),
    );

    const body = bodyOf(res);
    expect(body["data"]).toEqual([]);
    expect(body["meta"]).toMatchObject({ total: 0 });
  });
});
