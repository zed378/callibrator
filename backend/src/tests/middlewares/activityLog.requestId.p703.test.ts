/**
 * P7-03 — every log line written while a request is being served carries that
 * request's id, not only the two per-request lines activityLogger writes. The
 * real logger, the real format chain and the real middleware; the JSON
 * written to the console transport is captured.
 */
import type { Request, Response } from "express";
import type { TransformableInfo } from "logform";
import { logger, activityLogger, requestContext, requestIdFormat } from "../../middlewares/activityLog.middleware";

interface CapturedLine {
  message?: unknown;
  requestId?: string;
  tenantId?: string;
  [key: string]: unknown;
}

const captureLines = (): { lines: CapturedLine[]; restore: () => void } => {
  const lines: CapturedLine[] = [];
  const transport = logger.transports.find((t) => (t as unknown as { name?: string }).name === "console") as unknown as {
    log: (info: CapturedLine, callback?: () => void) => unknown;
  };
  const spy = jest.spyOn(transport, "log").mockImplementation((info: CapturedLine, callback?: () => void) => {
    lines.push(info);
    if (callback) {
      callback();
    }
    return undefined;
  });
  return { lines, restore: () => { spy.mockRestore(); } };
};

/** The winston format under test, with the result read as a plain record (the am5 house pattern). */
const transformed = (input: Record<string, unknown>): Record<string, unknown> =>
  requestIdFormat().transform(input as TransformableInfo) as unknown as Record<string, unknown>;

describe("P7-03 request id on every line", () => {
  it("a line logged deep inside a request — after an await — carries the request's id", async () => {
    const { lines, restore } = captureLines();
    const req = { requestId: "req-abc-123", ip: "127.0.0.1", method: "GET", originalUrl: "/api/v1/devices" };
    const res = { getHeader: () => "req-abc-123", setHeader: jest.fn(), on: jest.fn() };

    await new Promise<void>((resolve) => {
      const next = (): void => {
        void (async (): Promise<void> => {
          await new Promise((r) => setImmediate(r));
          logger.error("a service failed", { tenantId: "t-1" });
          resolve();
        })();
      };
      activityLogger(req as unknown as Request, res as unknown as Response, next);
    });
    restore();

    const serviceLine = lines.find((l) => l.message === "a service failed");
    expect(serviceLine?.requestId).toBe("req-abc-123");
    expect(serviceLine?.tenantId).toBe("t-1");
  });

  it("an explicit requestId is never overwritten, and a line outside any request has none", () => {
    requestContext.run({ requestId: "ctx-id" }, () => {
      expect(transformed({ message: "x", requestId: "own-id" })["requestId"]).toBe("own-id");
      expect(transformed({ message: "x" })["requestId"]).toBe("ctx-id");
    });
    expect(transformed({ message: "x" })).not.toHaveProperty("requestId");
    const empty: { requestId?: string } = {};
    requestContext.run(empty as { requestId: string }, () => {
      expect(transformed({ message: "x" })).not.toHaveProperty("requestId");
    });
  });

  it("an excluded path (/health) still runs the rest of the request in the context", () => {
    const req = { requestId: "h-1", ip: "x", method: "GET", originalUrl: "/health" };
    const res = { getHeader: () => "h-1", setHeader: jest.fn(), on: jest.fn() };
    let seen: unknown;
    activityLogger(
      req as unknown as Request,
      res as unknown as Response,
      () => {
        seen = requestContext.getStore();
      },
    );
    expect(seen).toEqual({ requestId: "h-1" });
    expect(res.on).not.toHaveBeenCalled();
  });
});
