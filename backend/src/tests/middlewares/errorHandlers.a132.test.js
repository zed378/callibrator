/**
 * A-132 — production hid every thrown 4xx explanation.
 *
 * `fileValidation.util#sanitizeError` replaced the message of ANY error with
 * "An unexpected error occurred…" in production, so a 409 state explanation
 * ("this certificate is in draft and must be submitted first") never reached a
 * user. The rule now, identical on all three error paths — the global
 * `errorHandler` (next(err)), `asyncHandler`, and `asyncHandlerWithMapping`:
 *
 * - a 4xx operational error (an AppError, a plain `{ status, message }` object
 *   the code threw on purpose, or an http-errors error marked `expose`) keeps
 *   its message;
 * - a 5xx, or a 4xx status on an arbitrary Error the code did not classify,
 *   gets the generic message and the request id.
 *
 * Exercised through a real Express app over HTTP, so the response the client
 * actually receives is what is asserted.
 */
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const express = require("express");
const { errorHandler } = require("../../middlewares/errorHandlers.middleware");
const {
  asyncHandler,
  asyncHandlerWithMapping,
} = require("../../utils/controllerWrapper.util");
const { AppError, ConflictError } = require("../../utils/appError.util");

const STATE_EXPLANATION =
  "This certificate is in draft and must be submitted first";
const INTERNALS = 'relation "secret_table" does not exist on db.internal:5432';
const GENERIC = "An unexpected error occurred. Please try again later.";

const buildApp = () => {
  const app = express();
  app.use((req, res, next) => {
    req.requestId = "req-a132";
    next();
  });

  const raw500 = () => new Error(INTERNALS);
  const unclassified403 = () => Object.assign(new Error(INTERNALS), { status: 403 });

  // next(err) straight to the global handler
  app.get("/direct/409", (req, res, next) => next(new ConflictError(STATE_EXPLANATION)));
  app.get("/direct/500", (req, res, next) => next(raw500()));
  app.get("/direct/unclassified-403", (req, res, next) => next(unclassified403()));
  app.get("/direct/nonoperational-400", (req, res, next) =>
    next(new AppError(400, INTERNALS, false)),
  );
  app.get("/direct/expose-400", (req, res, next) =>
    next(Object.assign(new Error("Unexpected token } in JSON"), { status: 400, expose: true })),
  );
  // asyncHandler
  app.get("/wrapped/409", asyncHandler(async () => {
    throw new ConflictError(STATE_EXPLANATION);
  }));
  app.get("/wrapped/500", asyncHandler(async () => {
    throw raw500();
  }));
  app.get("/wrapped/validation", asyncHandler(async () => {
    throw { status: 400, message: "Validation failed", errors: { days: "\"days\" is required" } };
  }));
  app.get("/wrapped/unclassified-403", asyncHandler(async () => {
    throw unclassified403();
  }));
  // asyncHandlerWithMapping
  app.get("/mapped/409", asyncHandlerWithMapping(async () => {
    throw new ConflictError(STATE_EXPLANATION);
  }));
  app.get("/mapped/500", asyncHandlerWithMapping(async () => {
    throw raw500();
  }));
  app.get("/mapped/by-map", asyncHandlerWithMapping(async () => {
    throw new Error("Invalid credentials");
  }, { credentials: 401 }));

  app.use(errorHandler);
  return app;
};

describe("A-132 — error messages in production", () => {
  const originalEnv = process.env.NODE_ENV;
  let server;
  let base;

  beforeAll(async () => {
    process.env.NODE_ENV = "production";
    server = buildApp().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalEnv;
    await new Promise((resolve) => server.close(resolve));
  });

  const get = async (path) => {
    const res = await fetch(base + path);
    return { status: res.status, body: await res.json() };
  };

  describe("in production a thrown 409 keeps its state explanation", () => {
    it.each(["/direct/409", "/wrapped/409", "/mapped/409"])("%s", async (path) => {
      const { status, body } = await get(path);

      expect(status).toBe(409);
      expect(body.success).toBe(false);
      expect(body.message).toBe(STATE_EXPLANATION);
    });

    it("a validation 400 keeps its message", async () => {
      const { status, body } = await get("/wrapped/validation");

      expect(status).toBe(400);
      expect(body.message).toBe("Validation failed");
    });

    it("an http-errors 400 marked expose keeps its message", async () => {
      const { status, body } = await get("/direct/expose-400");

      expect(status).toBe(400);
      expect(body.message).toBe("Unexpected token } in JSON");
    });

    it("a status the errorMap assigned keeps its message", async () => {
      const { status, body } = await get("/mapped/by-map");

      expect(status).toBe(401);
      expect(body.message).toBe("Invalid credentials");
    });
  });

  describe("in production a raw 500 is still generic", () => {
    it.each(["/direct/500", "/wrapped/500", "/mapped/500"])("%s", async (path) => {
      const { status, body } = await get(path);

      expect(status).toBe(500);
      expect(body.message).toBe(GENERIC);
      expect(JSON.stringify(body)).not.toContain("secret_table");
      expect(body.requestId).toBe("req-a132");
    });

    it.each([
      "/direct/unclassified-403",
      "/wrapped/unclassified-403",
      "/direct/nonoperational-400",
    ])("a 4xx the code did not classify as operational is generic too: %s", async (path) => {
      const { body } = await get(path);

      expect(body.message).toBe(GENERIC);
      expect(JSON.stringify(body)).not.toContain("secret_table");
      expect(body.requestId).toBe("req-a132");
    });
  });
});

describe("A-132 — the exposure rule, unit by unit", () => {
  const {
    isExposableError,
    publicErrorMessage,
    GENERIC_ERROR_MESSAGE,
  } = require("../../utils/fileValidation.util");
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("a thrown non-object is never exposable", () => {
    expect(isExposableError("boom", 400)).toBe(false);
    expect(isExposableError(null, 400)).toBe(false);
    expect(publicErrorMessage("boom", 400, true)).toBe(GENERIC_ERROR_MESSAGE);
  });

  it("in production field errors travel only with an exposable message", () => {
    const { sanitizeError } = require("../../utils/fileValidation.util");
    const fieldErrors = { days: "required" };

    expect(
      sanitizeError({ status: 400, message: "Validation failed", errors: fieldErrors }, true).errors,
    ).toEqual(fieldErrors);
    expect(
      sanitizeError(Object.assign(new Error(INTERNALS), { errors: [{ instance: {} }] }), true),
    ).not.toHaveProperty("errors");
  });

  it("an exposable 4xx with no message falls back to the default text", () => {
    expect(publicErrorMessage({ status: 404 }, 404, true)).toBe("Internal server error");
  });

  it("a wrapped controller with no request id reports 'unknown' in production", async () => {
    process.env.NODE_ENV = "production";
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await asyncHandler(async () => {
      throw new Error(INTERNALS);
    })(undefined, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: GENERIC_ERROR_MESSAGE, requestId: "unknown" }),
    );
  });

  it("a mapped client error with no message keeps the default text", async () => {
    process.env.NODE_ENV = "production";
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const err = new Error("Invalid credentials");

    await asyncHandlerWithMapping(async () => {
      throw err;
    }, { credentials: 401 })({ requestId: "r" }, res);
    expect(res.json.mock.calls[0][0].message).toBe("Invalid credentials");

    const bare = { message: "", status: 409, toString: () => "credentials" };
    res.json.mockClear();
    await asyncHandlerWithMapping(async () => {
      throw bare;
    }, {})({ requestId: "r" }, res);
    expect(res.json.mock.calls[0][0].message).toBe("Internal server error");
  });
});
