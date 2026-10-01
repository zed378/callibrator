/**
 * P10-16 (ADR-099) — the controller of POST /auth/first-sign-in/password, and
 * its place on the auth router: PUBLIC (no `auth` in the chain — the caller
 * has no session, only the password-change token in the body).
 *
 * Real: the controller, asyncHandler, response.util and the auth router's
 * route table. Doubled: the service (its behaviour is bootstrapCredential.p1016).
 */
import type * as Controller from "../../controllers/firstSignIn.controller";
import type * as AppErrorUtil from "../../utils/appError.util";

const mockComplete = jest.fn<Promise<unknown>, unknown[]>();
jest.mock("../../services/bootstrapCredential.service", () => ({
  completeFirstSignInPasswordChange: (...args: unknown[]) => mockComplete(...args),
}));

const { changeFirstSignInPassword } = jest.requireActual<typeof Controller>("../../controllers/firstSignIn.controller");
const { AppError } = jest.requireActual<typeof AppErrorUtil>("../../utils/appError.util");

interface FakeRes {
  statusCode: number;
  body: Record<string, unknown> | undefined;
  headersSent: boolean;
  status: (code: number) => FakeRes;
  json: (body: Record<string, unknown>) => FakeRes;
  setHeader: () => void;
}
const makeRes = (): FakeRes => {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    setHeader: () => undefined,
  };
  return res;
};

const run = async (req: Record<string, unknown>) => {
  const res = makeRes();
  await changeFirstSignInPassword(
    req as never,
    res as never,
    jest.fn(),
  );
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /auth/first-sign-in/password — controller", () => {
  it("passes the body, the address and the user agent, and answers 200 with signInRequired", async () => {
    mockComplete.mockResolvedValue({
      success: true,
      status: 200,
      message: "Password changed. Sign in with your new password.",
      data: { signInRequired: true },
    });
    const res = await run({
      body: { token: "t", newPassword: "Chosen-Pass-42" },
      ip: "203.0.113.7",
      headers: { "user-agent": "jest" },
    });
    expect(mockComplete).toHaveBeenCalledWith(
      { token: "t", newPassword: "Chosen-Pass-42" },
      { ipAddress: "203.0.113.7", userAgent: "jest" },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { signInRequired: true } });
  });

  it("sends null for a missing address and a non-string user agent", async () => {
    mockComplete.mockResolvedValue({ success: true, status: 200, message: "ok", data: { signInRequired: true } });
    await run({ body: {}, headers: { "user-agent": ["a", "b"] } });
    expect(mockComplete).toHaveBeenCalledWith({}, { ipAddress: null, userAgent: null });
  });

  it("answers the service's refusal with its status", async () => {
    mockComplete.mockRejectedValue(new AppError(401, "Invalid or expired password-change token"));
    const res = await run({ body: {}, headers: {} });
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ success: false, message: "Invalid or expired password-change token" });
  });
});

describe("the route", () => {
  it("is mounted on the auth router as POST /first-sign-in/password with no auth middleware", () => {
    // auth.route is JavaScript: typed by the express Router internals the test reads.
    const router = jest.requireActual<{
      stack: { route?: { path: string; methods: Record<string, boolean>; stack: { name: string; handle: unknown }[] } }[];
    }>("../../routes/api/auth.route");
    const layer = router.stack.find((l) => l.route?.path === "/first-sign-in/password");
    expect(layer?.route?.methods["post"]).toBe(true);
    const handlers = layer?.route?.stack ?? [];
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.handle).toBe(changeFirstSignInPassword);
  });
});
