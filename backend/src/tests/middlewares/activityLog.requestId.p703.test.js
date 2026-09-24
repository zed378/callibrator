/**
 * P7-03 — every log line written while a request is being served carries that
 * request's id, not only the two per-request lines activityLogger writes. The
 * real logger, the real format chain and the real middleware; the JSON
 * written to the console transport is captured.
 */
const { logger, activityLogger, requestContext, requestIdFormat } = require("../../middlewares/activityLog.middleware");

const captureLines = () => {
  const lines = [];
  const transport = logger.transports.find((t) => t.name === "console");
  const spy = jest.spyOn(transport, "log").mockImplementation((info, callback) => {
    lines.push(info);
    if (callback) {
      callback();
    }
  });
  return { lines, restore: () => spy.mockRestore() };
};

describe("P7-03 request id on every line", () => {
  it("a line logged deep inside a request — after an await — carries the request's id", async () => {
    const { lines, restore } = captureLines();
    const req = { requestId: "req-abc-123", ip: "127.0.0.1", method: "GET", originalUrl: "/api/v1/devices" };
    const res = { getHeader: () => "req-abc-123", setHeader: jest.fn(), on: jest.fn() };

    await new Promise((resolve) => {
      activityLogger(req, res, async () => {
        await new Promise((r) => setImmediate(r));
        logger.error("a service failed", { tenantId: "t-1" });
        resolve();
      });
    });
    restore();

    const serviceLine = lines.find((l) => l.message === "a service failed");
    expect(serviceLine.requestId).toBe("req-abc-123");
    expect(serviceLine.tenantId).toBe("t-1");
  });

  it("an explicit requestId is never overwritten, and a line outside any request has none", () => {
    const format = requestIdFormat();
    requestContext.run({ requestId: "ctx-id" }, () => {
      expect(format.transform({ message: "x", requestId: "own-id" }).requestId).toBe("own-id");
      expect(format.transform({ message: "x" }).requestId).toBe("ctx-id");
    });
    expect(format.transform({ message: "x" })).not.toHaveProperty("requestId");
    requestContext.run({}, () => {
      expect(format.transform({ message: "x" })).not.toHaveProperty("requestId");
    });
  });

  it("an excluded path (/health) still runs the rest of the request in the context", () => {
    const req = { requestId: "h-1", ip: "x", method: "GET", originalUrl: "/health" };
    const res = { getHeader: () => "h-1", setHeader: jest.fn(), on: jest.fn() };
    let seen;
    activityLogger(req, res, () => {
      seen = requestContext.getStore();
    });
    expect(seen).toEqual({ requestId: "h-1" });
    expect(res.on).not.toHaveBeenCalled();
  });
});
