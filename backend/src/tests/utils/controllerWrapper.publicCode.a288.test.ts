/**
 * ADR-100 — a thrown error's `publicCode` reaches the body as a top-level
 * `code` (the sign-in page reads LOCATION_REQUIRED / NETWORK_POLICY, the
 * network-security page SELF_LOCKOUT), in every environment; only an
 * UPPER_SNAKE token is sent.
 */
import type { Request, Response } from "express";
import { asyncHandler, asyncHandlerWithMapping } from "../../utils/controllerWrapper.util";
import { AppError } from "../../utils/appError.util";
import { environment } from "../../config/env";

const env = environment();
const savedNodeEnv = env["NODE_ENV"];
afterEach(() => {
  env["NODE_ENV"] = savedNodeEnv ?? "test";
});

const run = (thrown: unknown): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(payload: Record<string, unknown>) {
        resolve(payload);
        return res;
      },
      setHeader() {
        return res;
      },
    };
    void asyncHandler(async () => {
      await Promise.resolve();
      throw thrown;
    })({ headers: {} } as unknown as Request, res as unknown as Response, () => undefined);
  });

const coded = (code: unknown): AppError => Object.assign(new AppError(403, "Refused"), { publicCode: code });

it.each(["test", "production"])("%s: a well-formed code is sent as `code`", async (mode) => {
  env["NODE_ENV"] = mode;
  expect(await run(coded("NETWORK_POLICY"))).toMatchObject({ success: false, status: 403, message: "Refused", code: "NETWORK_POLICY" });
});

it.each([["lower-case"], ["NOT OK"], [42], [""]])("an ill-formed code %p is not sent", async (bad) => {
  expect(await run(coded(bad))).not.toHaveProperty("code");
});

it("asyncHandlerWithMapping (no details argument) sends the code too", async () => {
  const payload = await new Promise<Record<string, unknown>>((resolve) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(p: Record<string, unknown>) {
        resolve(p);
        return res;
      },
      setHeader() {
        return res;
      },
    };
    void asyncHandlerWithMapping(async () => {
      await Promise.resolve();
      throw coded("SELF_LOCKOUT");
    })({ headers: {} } as unknown as Request, res as unknown as Response, () => undefined);
  });
  expect(payload).toMatchObject({ status: 403, code: "SELF_LOCKOUT" });
});
