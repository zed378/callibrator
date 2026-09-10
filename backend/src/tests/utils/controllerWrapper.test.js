const { asyncHandler, asyncHandlerWithMapping } = require("../../utils/controllerWrapper.util");

describe("asyncHandler", () => {
  it("should catch async errors and pass to express error handler", async () => {
    const mockFn = asyncHandler(async (req, res) => {
      throw new Error("Test error");
    });

    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await mockFn(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.message).toBe("Test error");
    expect(error.status).toBe(500);
  });

  it("should pass successful response to next normally", async () => {
    const mockFn = asyncHandler(async (req, res) => {
      return { success: true };
    });

    const req = {};
    const res = {};
    const next = jest.fn();

    await mockFn(req, res, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("should handle sync errors", async () => {
    const mockFn = asyncHandler(async (req, res) => {
      throw new Error("Sync error");
    });

    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await mockFn(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.message).toBe("Sync error");
  });

  it("should handle successful async operations", async () => {
    const mockFn = asyncHandler(async (req, res) => {
      return { data: "test" };
    });

    const req = {};
    const res = {};
    const next = jest.fn();

    await mockFn(req, res, next);

    expect(next).not.toHaveBeenCalled();
  });
});

describe("asyncHandlerWithMapping", () => {
  // This used to assert res.json was NOT called on success, which pinned the
  // bug: handlers that return an envelope (admin, qms, sop, batchJob) produced
  // no response at all and hung until the 30s timeout → 503.
  it("should send a returned envelope and not call sendError", async () => {
    const mockFn = asyncHandlerWithMapping(async () => {
      return { success: true, status: 200, message: "ok", data: { a: 1 } };
    });
    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      headersSent: false,
    };
    const next = jest.fn();

    await mockFn(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      status: 200,
      message: "ok",
      data: { a: 1 },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should honour the status on a returned envelope", async () => {
    const mockFn = asyncHandlerWithMapping(async () => ({
      success: true,
      status: 201,
      message: "created",
      data: null,
    }));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), headersSent: false };

    await mockFn({}, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("should not double-send when the handler already responded", async () => {
    const mockFn = asyncHandlerWithMapping(async (req, res) => {
      res.status(200).json({ sent: "by handler" });
      res.headersSent = true;
      return { success: true, status: 200, message: "ignored", data: null };
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), headersSent: false };

    await mockFn({}, res, jest.fn());

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ sent: "by handler" });
  });

  it("should do nothing when the handler returns undefined", async () => {
    const mockFn = asyncHandlerWithMapping(async () => undefined);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), headersSent: false };

    await mockFn({}, res, jest.fn());

    expect(res.json).not.toHaveBeenCalled();
  });

  it("should map error message patterns to status codes", async () => {
    const mockFn = asyncHandlerWithMapping(
      async () => {
        throw new Error("Invalid credentials passed");
      },
      {
        credentials: 401,
        verify: 403,
      }
    );

    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await mockFn(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("should fall back to 500 status when no pattern matches", async () => {
    const mockFn = asyncHandlerWithMapping(
      async () => {
        throw new Error("Some unhandled internal error");
      },
      {
        credentials: 401,
      }
    );

    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    await mockFn(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("should handle error with missing message and stack, and catch response errors when next is not a function", async () => {
    const mockFn = asyncHandler(async (req, res) => {
      const err = new Error();
      delete err.message;
      delete err.stack;
      throw err;
    });

    const req = {};
    const res = {
      status: jest.fn().mockImplementation(() => {
        throw new Error("Response helper failed");
      }),
      json: jest.fn(),
    };

    await expect(mockFn(req, res)).resolves.not.toThrow();
  });

  it("should handle missing message in asyncHandlerWithMapping", async () => {
    const mockFn = asyncHandlerWithMapping(
      async () => {
        const err = new Error();
        delete err.message;
        throw err;
      },
      {
        credentials: 401,
      }
    );

    const req = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await mockFn(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
