import type { NextFunction, Request, Response } from "express";
import { asyncHandler, asyncHandlerWithMapping } from "../../utils/controllerWrapper.util";

interface ResDouble {
  status: jest.Mock;
  json: jest.Mock;
  headersSent?: boolean;
}

const reqOf = (): Request => ({}) as unknown as Request;
const resOf = (extra: Partial<ResDouble> = {}): ResDouble => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
  ...extra,
});
const nextOf = (): NextFunction => jest.fn();
const noNext = (): NextFunction => undefined as unknown as NextFunction;

describe("asyncHandler", () => {
  it("should catch async errors and pass to express error handler", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the wrapper calls the handler with (req, res)
    const mockFn = asyncHandler(async (_req: Request, _res: Response) => {
      await Promise.resolve();
      throw new Error("Test error");
    });

    const req = reqOf();
    const res = resOf();
    const next = jest.fn();

    await mockFn(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    const error = (next.mock.calls[0] as unknown[])[0] as Error & { status?: number };
    expect(error.message).toBe("Test error");
    expect(error.status).toBe(500);
  });

  it("should pass successful response to next normally", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the wrapper calls the handler with (req, res)
    const mockFn = asyncHandler(async (_req: Request, _res: Response) => {
      await Promise.resolve();
      return { success: true };
    });

    const req = reqOf();
    const res = resOf();
    const next = jest.fn();

    await mockFn(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("should handle sync errors", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the wrapper calls the handler with (req, res)
    const mockFn = asyncHandler(async (_req: Request, _res: Response) => {
      await Promise.resolve();
      throw new Error("Sync error");
    });

    const req = reqOf();
    const res = resOf();
    const next = jest.fn();

    await mockFn(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalled();
    const error = (next.mock.calls[0] as unknown[])[0] as Error;
    expect(error.message).toBe("Sync error");
  });

  it("should handle successful async operations", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the wrapper calls the handler with (req, res)
    const mockFn = asyncHandler(async (_req: Request, _res: Response) => {
      await Promise.resolve();
      return { data: "test" };
    });

    const req = reqOf();
    const res = resOf();
    const next = jest.fn();

    await mockFn(req, res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
  });
});

describe("asyncHandlerWithMapping", () => {
  // This used to assert res.json was NOT called on success, which pinned the
  // bug: handlers that return an envelope (admin, qms, sop, batchJob) produced
  // no response at all and hung until the 30s timeout → 503.
  it("should send a returned envelope and not call sendError", async () => {
    const mockFn = asyncHandlerWithMapping(async () => {
      await Promise.resolve();
      return { success: true, status: 200, message: "ok", data: { a: 1 } };
    });
    const req = reqOf();
    const res = resOf({ headersSent: false });
    const next = nextOf();

    await mockFn(req, res as unknown as Response, next);

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
    const mockFn = asyncHandlerWithMapping(async () => {
      await Promise.resolve();
      return {
        success: true,
        status: 201,
        message: "created",
        data: null,
      };
    });
    const res = resOf({ headersSent: false });

    await mockFn(reqOf(), res as unknown as Response, nextOf());

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("should not double-send when the handler already responded", async () => {
    const mockFn = asyncHandlerWithMapping(async (_req: Request, res: Response) => {
      await Promise.resolve();
      const double = res as unknown as ResDouble;
      const sent = double.status(200) as unknown as Pick<ResDouble, "json">;
      void sent.json({ sent: "by handler" });
      double.headersSent = true;
      return { success: true, status: 200, message: "ignored", data: null };
    });
    const res = resOf({ headersSent: false });

    await mockFn(reqOf(), res as unknown as Response, nextOf());

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ sent: "by handler" });
  });

  it("should do nothing when the handler returns undefined", async () => {
    const mockFn = asyncHandlerWithMapping(async () => {
      await Promise.resolve();
      return undefined;
    });
    const res = resOf({ headersSent: false });

    await mockFn(reqOf(), res as unknown as Response, nextOf());

    expect(res.json).not.toHaveBeenCalled();
  });

  it("should map error message patterns to status codes", async () => {
    const mockFn = asyncHandlerWithMapping(
      async () => {
        await Promise.resolve();
        throw new Error("Invalid credentials passed");
      },
      {
        credentials: 401,
        verify: 403,
      },
    );

    const req = reqOf();
    const res = resOf();
    const next = nextOf();

    await mockFn(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("should fall back to 500 status when no pattern matches", async () => {
    const mockFn = asyncHandlerWithMapping(
      async () => {
        await Promise.resolve();
        throw new Error("Some unhandled internal error");
      },
      {
        credentials: 401,
      },
    );

    const req = reqOf();
    const res = resOf();
    const next = nextOf();

    await mockFn(req, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("should handle error with missing message and stack, and catch response errors when next is not a function", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the wrapper calls the handler with (req, res)
    const mockFn = asyncHandler(async (_req: Request, _res: Response) => {
      await Promise.resolve();
      const err = new Error() as unknown as Record<string, unknown>;

      delete err["message"];

      delete err["stack"];
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the .js threw the stripped error; the wrapper must survive it
      throw err;
    });

    const req = reqOf();
    const res: ResDouble = {
      status: jest.fn().mockImplementation(() => {
        throw new Error("Response helper failed");
      }),
      json: jest.fn(),
    };

    await expect(mockFn(req, res as unknown as Response, noNext())).resolves.not.toThrow();
  });

  it("should handle missing message in asyncHandlerWithMapping", async () => {
    const mockFn = asyncHandlerWithMapping(
      async () => {
        await Promise.resolve();
        const err = new Error() as unknown as Record<string, unknown>;

        delete err["message"];
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the .js threw the stripped error; the wrapper must survive it
        throw err;
      },
      {
        credentials: 401,
      },
    );

    const req = reqOf();
    const res = resOf();

    await mockFn(req, res as unknown as Response, noNext());
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
