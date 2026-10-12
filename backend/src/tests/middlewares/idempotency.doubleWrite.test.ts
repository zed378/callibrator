/**
 * The `Idempotency-Key` middleware must never write a second answer, and never reject — a request
 * that ends in an error crashed the API process (de2e938, `POST /ipm/sessions/:id/submit` with a
 * key on an incomplete draft): `asyncHandler` answered the 400 through the middleware's deferred
 * `res.json`, forwarded the error to `errorHandler`, which — seeing `headersSent` still false while
 * the key was being settled — answered AGAIN; the second deferred send threw
 * ERR_HTTP_HEADERS_SENT inside the promise chain → an unhandled rejection → index.ts shut down.
 *
 * Over a REAL Express app and HTTP server (a response double cannot throw ERR_HTTP_HEADERS_SENT):
 * the real middleware, `asyncHandler`, `errorHandler`; the key service and the permission read
 * doubled. Every case asserts ONE answer with the first status, the key settled once with it, and
 * no unhandled rejection; each request is then sent again under the same key (a refused request
 * frees its key, so the "replay" runs again and must behave the same).
 */
import http from "http";
import type { AddressInfo } from "net";
import express, { type NextFunction, type Request, type Response } from "express";
import type * as IdempotencyMiddleware from "../../middlewares/idempotency.middleware";
import type * as Wrapper from "../../utils/controllerWrapper.util";
import type * as ErrorHandlers from "../../middlewares/errorHandlers.middleware";
import type * as AppErrorModule from "../../utils/appError.util";
import type * as CodedErrorModule from "../../utils/codedError.util";

const begin = jest.fn();
const release = jest.fn();
jest.mock("../../services/idempotency.service", () => ({
  ...jest.requireActual<object>("../../services/idempotency.service"),
  beginIdempotentRequest: (...a: unknown[]) => begin(...a) as unknown,
  releaseIdempotentRequest: (...a: unknown[]) => release(...a) as unknown,
}));
jest.mock("../../services/effectivePermission.service", () => ({
  accessOf: () => "write",
  loadPermissionSources: () => Promise.resolve({}),
}));

const { idempotency } = jest.requireActual<typeof IdempotencyMiddleware>("../../middlewares/idempotency.middleware");
const { asyncHandler } = jest.requireActual<typeof Wrapper>("../../utils/controllerWrapper.util");
const { errorHandler } = jest.requireActual<typeof ErrorHandlers>("../../middlewares/errorHandlers.middleware");
const { AppError } = jest.requireActual<typeof AppErrorModule>("../../utils/appError.util");
const { CodedError } = jest.requireActual<typeof CodedErrorModule>("../../utils/codedError.util");

const KEY = "2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d";
const keyed = idempotency({ slug: "ipm", read: () => Promise.resolve({ id: "x" }) });

let base = "";
let server: http.Server;
const rejections: unknown[] = [];
const onRejection = (reason: unknown): void => {
  rejections.push(reason);
};

beforeAll(async () => {
  process.on("unhandledRejection", onRejection);
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { user: { id: "a1000000-0000-4000-8000-000000000001", role: { id: "r" } }, tenantId: "a1000000-0000-4000-8000-0000000000a1" });
    next();
  });
  // A controller's rejection (as the services' throws reach asyncHandler).
  const fail = (err: () => Error) => asyncHandler(() => Promise.reject(err()));
  app.post("/fail400/:id", keyed, fail(() => new AppError(400, "The IPM is incomplete.")));
  app.post("/fail409/:id", keyed, fail(() => new CodedError(409, "IPM_NOT_DRAFT", "Only a draft can be submitted.")));
  app.post("/fail500/:id", keyed, fail(() => new Error("database went away")));
  app.post("/twice/:id", keyed, (_req: Request, res: Response) => {
    res.status(400).json({ first: true });
    res.status(500).json({ second: true });
  });
  app.post("/direct/:id", keyed, (_req: Request, res: Response) => {
    res.status(400).json({ deferred: true });
    res.status(418).send("direct");
  });
  app.post("/unserialisable/:id", keyed, (_req: Request, res: Response) => {
    res.status(400).json({ n: BigInt(1) });
  });
  app.post("/ok/:id", keyed, (_req: Request, res: Response) => {
    res.status(201).json({ created: true });
  });
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  process.off("unhandledRejection", onRejection);
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  jest.clearAllMocks();
  rejections.length = 0;
  begin.mockResolvedValue({ kind: "proceed", handle: { rowId: "k1", completed: false } });
  release.mockResolvedValue(undefined);
});

/** POST with the key; the raw body text (a second answer would corrupt or break it). */
const post = async (path: string): Promise<{ status: number; text: string }> => {
  const res = await fetch(`${base}${path}/a1000000-0000-4000-8000-0000000000f1`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": KEY },
    body: "{}",
  });
  return { status: res.status, text: await res.text() };
};

/** Let any deferred send, and any rejection it would raise, run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

describe("Idempotency-Key: a request that ends in an error is answered once, and never rejects", () => {
  it.each([
    ["/fail400", 400, "The IPM is incomplete."],
    ["/fail409", 409, "IPM_NOT_DRAFT"],
    ["/fail500", 500, ""],
  ])("%s: one answer with its status, the key settled once with it, no unhandled rejection — twice under the key", async (path, status, text) => {
    for (const attempt of [1, 2]) {
      const answer = await post(path);
      await settle();
      expect({ attempt, status: answer.status }).toEqual({ attempt, status });
      expect(answer.text).toContain(text);
      expect(() => JSON.parse(answer.text) as unknown).not.toThrow();
      expect(release).toHaveBeenCalledTimes(attempt);
      expect(release).toHaveBeenLastCalledWith({ rowId: "k1", completed: false }, status);
      expect(rejections).toEqual([]);
    }
  });

  it("a handler that answers twice: only the first answer leaves; the key is settled with its status", async () => {
    const answer = await post("/twice");
    await settle();
    expect(answer).toEqual({ status: 400, text: JSON.stringify({ first: true }) });
    expect(release.mock.calls).toEqual([[{ rowId: "k1", completed: false }, 400]]);
    expect(rejections).toEqual([]);
  });

  it("another writer answering while the key settles: that answer stands, the deferred one is dropped", async () => {
    const answer = await post("/direct");
    await settle();
    expect(answer).toEqual({ status: 418, text: "direct" });
    expect(rejections).toEqual([]);
  });

  it("a key that cannot be settled still answers; a body that cannot be serialised answers 500, never hangs", async () => {
    release.mockRejectedValueOnce(new Error("db down"));
    expect(await post("/fail400")).toMatchObject({ status: 400 });
    expect((await post("/unserialisable")).status).toBe(500);
    await settle();
    expect(rejections).toEqual([]);
  });

  it("a success is answered once with its status", async () => {
    expect(await post("/ok")).toEqual({ status: 201, text: JSON.stringify({ created: true }) });
    await settle();
    expect(rejections).toEqual([]);
  });
});
