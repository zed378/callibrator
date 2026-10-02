/**
 * A-334 — the admin session list and detail answered `createdAt: undefined`
 * and `location: "N/A"` for every session.
 *
 * `session.controller` read `session.created_at` and `session.location`. The
 * Session model's timestamp attribute is `createdAt` (`underscored: true`
 * renames the COLUMN, not the attribute), and the list query is `raw: true`,
 * whose keys are attribute names, so `created_at` was always undefined. There
 * is no location column at all, so `location` was a constant placeholder;
 * the session page never shows it. The old unit suite mocked rows carrying
 * `created_at`, the shape no query returns.
 *
 * Here the rows are what the model answers (attribute names), and the real
 * controller and envelope run. Fail-before: `createdAt` was undefined in both
 * answers and `location` was "N/A".
 */
import type { Request, Response } from "express";

const CREATED = new Date("2026-09-24T08:00:00Z");

const row = {
  id: "a3340000-0000-4000-8000-000000000001",
  user_id: "a3340000-0000-4000-8000-000000000002",
  tenant_id: "a3340000-0000-4000-8000-000000000003",
  ip_address: "203.0.113.4",
  user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120",
  device: null,
  expired_at: new Date("2099-01-01T00:00:00Z"),
  is_revoked: false,
  is_active: true,
  revoked_at: null,
  revoked_reason: null,
  last_activity_at: null,
  createdAt: CREATED,
  user: { username: "alice", email: "alice@example.test", firstName: "A", lastName: "L", role: { nameToShow: "Admin" } },
  tenant: { name: "Acme" },
};

const mockSessions = {
  findAndCountAll: jest.fn(() => Promise.resolve({ count: 1, rows: [row] })),
  findByPk: jest.fn(() => Promise.resolve(row)),
};

jest.mock("../../models", () => ({
  Sessions: mockSessions,
  Users: {},
  Roles: {},
  Tenants: {},
  sequelize: { transaction: (cb: (tx: string) => unknown) => cb("TX") },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the controller is `export =` (CommonJS)
const controller = require("../../controllers/session.controller") as Record<string, Handler>;

const run = (handler: string, req: Partial<Request>): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(payload: Record<string, unknown>) {
        res.headersSent = true;
        resolve(payload);
        return res;
      },
    };
    void (controller[handler] as Handler)(req as Request, res as unknown as Response, (err?: unknown) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });

describe("A-334 — the session list and detail carry the real creation time", () => {
  it("the list answers each session's createdAt and no invented location", async () => {
    const body = await run("getAllSessions", { query: {} });
    const [first] = body["data"] as Record<string, unknown>[];
    expect(first?.["createdAt"]).toEqual(CREATED);
    expect(first).not.toHaveProperty("location");
  });

  it("the detail answers the session's createdAt and no invented location", async () => {
    const body = await run("getSessionById", { params: { id: row.id } });
    const data = body["data"] as Record<string, unknown>;
    expect(data["createdAt"]).toEqual(CREATED);
    expect(data).not.toHaveProperty("location");
  });
});
