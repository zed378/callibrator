/**
 * A-288 (ADR-100) — the passkey sign-in (POST /webauthn/verify-login) asks the
 * tenant's network policy AFTER the assertion is proven and before success is
 * reported; the device-reported `location` is taken out of the body and not
 * handed to the WebAuthn verifier. The policy itself is signInPolicy.a288; the
 * SSO exchange is sso.exchangeStatus.a83 › "A-288".
 */
import type { Request, Response } from "express";
import type * as AppErrorModule from "../../utils/appError.util";

jest.mock("../../services/webauthn.service", () => ({ verifyLogin: jest.fn(() => Promise.resolve({ success: true })) }));
jest.mock("../../services/signInPolicy.service", () => ({ assertSignInPermitted: jest.fn(() => Promise.resolve()) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the controller is JavaScript (CommonJS)
const controller = require("../../controllers/webauthn.controller") as { verifyLogin: (req: Request, res: Response, next: () => void) => Promise<void> };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a jest double of a JavaScript module
const webauthnService = require("../../services/webauthn.service") as { verifyLogin: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a jest double
const policy = require("../../services/signInPolicy.service") as { assertSignInPermitted: jest.Mock };
const { AppError } = jest.requireActual<typeof AppErrorModule>("../../utils/appError.util");

const USER = { id: "a2880000-0000-4000-8000-0000000000e1", tenantId: "a2880000-0000-4000-8000-0000000000e2" };
const LOCATION = { latitude: -6.2, longitude: 106.8 };

const run = (body: unknown, extra: Partial<Request> = {}): Promise<{ status: number; body: Record<string, unknown> }> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(payload: Record<string, unknown>) {
        res.headersSent = true;
        resolve({ status: res.statusCode, body: payload });
        return res;
      },
      setHeader() {
        return res;
      },
    };
    void controller.verifyLogin(
      { body, user: USER, ip: "198.51.100.4", headers: { "user-agent": "ua" }, ...extra } as unknown as Request,
      res as unknown as Response,
      () => undefined,
    );
  });

beforeEach(() => {
  jest.clearAllMocks();
});

it("verifies the assertion WITHOUT the location, then asks the policy with it (method passkey)", async () => {
  const answer = await run({ id: "cred", response: {}, location: LOCATION });
  expect(answer.status).toBe(200);
  expect(webauthnService.verifyLogin).toHaveBeenCalledWith(USER.tenantId, USER.id, { id: "cred", response: {} });
  expect(policy.assertSignInPermitted).toHaveBeenCalledWith(
    { id: USER.id, tenantId: USER.tenantId },
    { ip: "198.51.100.4", userAgent: "ua", location: LOCATION, method: "passkey" },
  );
});

it("a refusal is 403 with the policy's code, and success is not reported", async () => {
  const refusal = Object.assign(new AppError(403, "Your organisation requires your device's location to sign in."), {
    publicCode: "LOCATION_REQUIRED",
  });
  policy.assertSignInPermitted.mockRejectedValueOnce(refusal);
  const answer = await run({ id: "cred" });
  expect(answer.status).toBe(403);
  expect(answer.body).toMatchObject({ success: false, code: "LOCATION_REQUIRED" });
});

it("a failed assertion never reaches the policy", async () => {
  webauthnService.verifyLogin.mockRejectedValueOnce(new AppError(401, "WebAuthn authentication failed"));
  expect((await run({ id: "cred" })).status).toBe(401);
  expect(policy.assertSignInPermitted).not.toHaveBeenCalled();
});

it("no body, no address, no user agent: empty assertion and nulls", async () => {
  const bare: Partial<Request> = { ip: undefined, headers: {} };
  await run(undefined, bare);
  expect(webauthnService.verifyLogin).toHaveBeenCalledWith(USER.tenantId, USER.id, {});
  expect(policy.assertSignInPermitted).toHaveBeenCalledWith(expect.anything(), {
    ip: null,
    userAgent: null,
    location: undefined,
    method: "passkey",
  });
});
