/**
 * A-297 — the CMS service's own answers follow the response envelope, and its
 * failures are AppErrors.
 *
 * Before A-297 `content.service` answered its two lists as
 * `{ data: { rows, count, meta } }` (the `data.rows` / `data.meta` shape
 * CLAUDE.md forbids) and threw plain `{ status, message }` objects from every
 * catch block. The controller unwrapped the lists, so the WIRE was already
 * right; these tests pin both layers:
 *
 *  1. the service: rows in `data`, pagination in a top-level `meta`, no
 *     `data.rows` / `data.meta` / `data.count`; every failure an `AppError`
 *     (an AppError it raised passes through as the same instance, anything
 *     else is wrapped with its status and message kept);
 *  2. the wire, through the real controller and response.util: `data` is the
 *     row array and `meta` its sibling — what `frontend/src/api/services/
 *     content.service.ts` and `frontend/src/lib/content.api.ts` read.
 *
 * Only the database and the transaction are doubles; the service, the
 * controller, AppError and response.util are the real modules.
 */
import type { Request, Response } from "express";
import type ContentService from "../../services/content.service";
import type * as AppErrorModule from "../../utils/appError.util";

interface FakeRow {
  id: string;
  toJSON: () => Record<string, unknown>;
}

const row = (id: string): FakeRow => ({ id, toJSON: () => ({ id }) });

/** The response fields these tests read. */
interface Answer {
  data?: unknown;
  meta?: unknown;
  message?: unknown;
}

const mockPost = {
  findAndCountAll: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  unscoped: jest.fn(),
};
const mockCategory = {
  findAll: jest.fn(),
  findByPk: jest.fn(),
  create: jest.fn(),
  unscoped: jest.fn(),
};

jest.mock("../../models", () => ({ Post: mockPost, Category: mockCategory }));
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(() => Promise.resolve({ commit: jest.fn(), rollback: jest.fn() })) },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above, as every service test here does
const contentService = require("../../services/content.service") as typeof ContentService;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the JavaScript controller, loaded after the mocks
const contentController = require("../../controllers/content.controller") as Record<
  string,
  (req: Request, res: Response, next: () => void) => Promise<unknown>
>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real AppError class the service must throw
const { AppError } = require("../../utils/appError.util") as typeof AppErrorModule;

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.findAndCountAll.mockResolvedValue({ count: 3, rows: [row("p-1"), row("p-2")] });
});

describe("A-297 — the service answers in the envelope", () => {
  it.each([
    ["listPosts", () => contentService.listPosts({ page: "2", limit: "2" })],
    ["listPublishedPosts", () => contentService.listPublishedPosts({ page: "2", limit: "2" })],
  ])("%s puts the rows in data and the pagination in a top-level meta", async (_name, call) => {
    const result: Answer = await call();

    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toEqual([{ id: "p-1" }, { id: "p-2" }]);
    expect(result.meta).toEqual({ total: 3, page: 2, limit: 2, totalPages: 2 });
    expect(result).not.toHaveProperty("data.rows");
    expect(result).not.toHaveProperty("data.meta");
    expect(result).not.toHaveProperty("data.count");
  });
});

describe("A-297 — every failure is an AppError", () => {
  it("passes the service's own 404 through as an AppError", async () => {
    mockPost.findByPk.mockResolvedValue(null);

    const failure: unknown = await contentService.getPostById("missing").catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ status: 404, message: "Post not found" });
  });

  it("wraps a database error in an AppError, keeping its status and message", async () => {
    mockPost.findAndCountAll.mockRejectedValue(Object.assign(new Error("relation missing"), { status: 503 }));

    const failure: unknown = await contentService.listPosts({}).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ status: 503, message: "relation missing" });
  });

  it("answers 500 with the fallback message for an error that carries neither", async () => {
    mockCategory.findAll.mockRejectedValue(new Error(""));

    const failure: unknown = await contentService.listCategories().catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ status: 500, message: "Failed to fetch categories" });
  });
});

describe("A-297 — the wire, through the real controller", () => {
  const call = async (handler: string, req: Partial<Request>): Promise<{ status: number; body: Answer }> => {
    const captured: { status: number; body: Answer } = { status: 0, body: {} };
    const res = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(payload: Answer) {
        captured.body = payload;
        return this;
      },
      setHeader: jest.fn(),
    } as unknown as Response;
    const handle = contentController[handler];
    if (!handle) {throw new Error(`no handler ${handler}`);}
    await handle(req as Request, res, jest.fn());
    return captured;
  };

  it.each(["listPosts", "listPublishedPosts"])("%s answers data: rows and meta as a sibling", async (handler) => {
    const { status, body } = await call(handler, { query: { page: "2", limit: "2" } });

    expect(status).toBe(200);
    expect(body.data).toEqual([{ id: "p-1" }, { id: "p-2" }]);
    expect(body.meta).toEqual({ total: 3, page: 2, limit: 2, totalPages: 2 });
  });

  it("answers a missing post 404 with its message", async () => {
    mockPost.findByPk.mockResolvedValue(null);

    const { status, body } = await call("getPost", { params: { id: "missing" } });

    expect(status).toBe(404);
    expect(body.message).toBe("Post not found");
  });
});
