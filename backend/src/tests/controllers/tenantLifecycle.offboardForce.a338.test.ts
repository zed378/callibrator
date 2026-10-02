/**
 * A-338 — POST /api/v1/tenants/:tenantId/offboard never read `force`.
 *
 * The module reference (docs/BACKEND/10-MODULE-REFERENCE.md, tenant lifecycle
 * §11) specifies offboarding as "idempotent unless `force`", the service
 * implements it (`offboardTenant(tenantId, force)` re-offboards a tenant that
 * is already `deleted`: a new `offboardedAt` and retention deadline, audited
 * with `force: true`), and the frontend client sends `{ force }`. The
 * controller validated the PATH only (a Zod object strips unknown keys), so
 * `force` was always `false`.
 *
 * The real controller and the real schema run; the service is doubled at the
 * module boundary. Fail-before: every call received `false`.
 */
import type { Request, Response } from "express";

const mockOffboard = jest.fn<Promise<unknown>, [string, unknown, unknown]>();
jest.mock("../../services/tenantLifecycle.service", () => ({ offboardTenant: mockOffboard }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the controller is `export =` (CommonJS)
const controller = require("../../controllers/tenantLifecycle.controller") as Record<
  string,
  (req: Request, res: Response, next: (err?: unknown) => void) => Promise<void>
>;

const TENANT = "a3380000-0000-4000-8000-0000000000a1";

const run = (body: unknown): Promise<{ status: number; error?: unknown }> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json() {
        resolve({ status: res.statusCode });
        return res;
      },
    };
    const req = { params: { tenantId: TENANT }, body, user: { id: "u1" }, ip: "203.0.113.1", headers: {} };
    void (controller["offboardTenant"] as NonNullable<(typeof controller)[string]>)(
      req as unknown as Request,
      res as unknown as Response,
      (err?: unknown) => {
        resolve({ status: (err as { status?: number } | undefined)?.status ?? 500, error: err });
      },
    );
  });

beforeEach(() => {
  mockOffboard.mockReset();
  mockOffboard.mockResolvedValue({ tenant: { id: TENANT } });
});

describe("A-338 — offboard reads the operator's force", () => {
  it("passes force: true from the body", async () => {
    await run({ force: true });
    expect(mockOffboard.mock.calls[0]?.[1]).toBe(true);
  });

  it("reads a form-style \"true\" as true (booleanish)", async () => {
    await run({ force: "true" });
    expect(mockOffboard.mock.calls[0]?.[1]).toBe(true);
  });

  it("no body, or force false, is an ordinary (idempotent) offboard", async () => {
    await run(undefined);
    await run({ force: false });
    expect(mockOffboard.mock.calls.map((c) => c[1])).toEqual([false, false]);
  });

  it("a force that is not a boolean is a 400, and nothing is offboarded", async () => {
    const answer = await run({ force: "maybe" });
    expect(answer.status).toBe(400);
    expect(mockOffboard).not.toHaveBeenCalled();
  });
});
