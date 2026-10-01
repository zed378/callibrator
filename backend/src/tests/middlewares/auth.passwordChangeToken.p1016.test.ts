/**
 * P10-16 (ADR-099) — the password-change token a one-time password's first
 * sign-in returns reaches NOTHING but POST /auth/first-sign-in/password (a
 * public route that verifies it itself).
 *
 * What is real: jwt.util (the token is signed and verified with the configured
 * key) and auth.middleware. What is doubled: the services behind the
 * middleware — and the test asserts they are never reached: the token is
 * refused at verification, before any session or user lookup.
 *
 * The sample covers the routes an account under a forced password change or
 * MFA enrolment MAY still call (PASSWORD_CHANGE_ALLOWED / MFA_ENROLMENT_ALLOWED)
 * — the ones a gated session would pass — and ordinary and privileged routes.
 */
import type { NextFunction, Request, Response } from "express";
import type * as JwtUtil from "../../utils/jwt.util";

/** auth.middleware is JavaScript: typed by what the test uses. */
type Middleware = (req: Request, res: Response, next: NextFunction) => Promise<void>;
interface AuthMiddleware {
  auth: Middleware;
  optionalAuth: Middleware;
  PASSWORD_CHANGE_ALLOWED: Set<string>;
  MFA_ENROLMENT_ALLOWED: Set<string>;
}

const mockGetAuthUser = jest.fn<Promise<unknown>, unknown[]>();
const mockIsSessionLive = jest.fn<Promise<boolean>, unknown[]>();

jest.mock("../../services/auth.service", () => ({
  getAuthUserWithTenant: (...args: unknown[]) => mockGetAuthUser(...args),
}));
jest.mock("../../services/tenant.service", () => ({
  getTenantByCodeForMiddleware: jest.fn(),
  getTenantByIdForMiddleware: jest.fn(),
}));
jest.mock("../../services/apiKey.service", () => ({ verifyApiKey: jest.fn() }));
jest.mock("../../services/session.service", () => ({
  isSessionLive: (...args: unknown[]) => mockIsSessionLive(...args),
  runWithSession: (_sid: unknown, fn: () => unknown) => fn(),
}));
jest.mock("../../middlewares/tenantContext.middleware", () => ({
  tenantContextMiddleware: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const jwtUtil = jest.requireActual<typeof JwtUtil>("../../utils/jwt.util");
const { auth, optionalAuth, PASSWORD_CHANGE_ALLOWED, MFA_ENROLMENT_ALLOWED } =
  jest.requireActual<AuthMiddleware>("../../middlewares/auth.middleware");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const token = jwtUtil.generatePurposeToken({ id: USER_ID, pf: "fingerprint" }, "password-change");

interface FakeRes {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeRes;
  json: (body: unknown) => FakeRes;
}
const makeRes = (): FakeRes => {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
};

const call = async (method: string, fullPath: string) => {
  const cut = fullPath.indexOf("/", "/api/v1/".length);
  const req = {
    method,
    baseUrl: cut > 0 ? fullPath.slice(0, cut) : fullPath,
    path: cut > 0 ? fullPath.slice(cut) : "/",
    headers: { authorization: `Bearer ${token}` },
  } as unknown as Request;
  const res = makeRes();
  const next = jest.fn();
  await auth(req, res as unknown as Response, next);
  return { res, next };
};

const SAMPLE: readonly string[] = [
  ...PASSWORD_CHANGE_ALLOWED,
  ...MFA_ENROLMENT_ALLOWED,
  "GET /api/v1/users",
  "POST /api/v1/users",
  "GET /api/v1/tenants",
  "GET /api/v1/migration/seeding",
  "POST /api/v1/auth/impersonate",
  "GET /api/v1/calibration-devices",
  "POST /api/v1/sessions/user/x/revoke-all",
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the password-change token is not a bearer credential anywhere", () => {
  it.each(SAMPLE.map((route) => [route]))("%s → 401, and no session or user is looked up", async (route) => {
    const [method = "GET", fullPath = "/"] = route.split(" ");
    const { res, next } = await call(method, fullPath);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(mockIsSessionLive).not.toHaveBeenCalled();
    expect(mockGetAuthUser).not.toHaveBeenCalled();
  });

  it("optional auth treats it as no credential at all", async () => {
    const req = {
      method: "GET",
      baseUrl: "/api/v1/content",
      path: "/",
      headers: { authorization: `Bearer ${token}` },
    } as unknown as Request;
    const next = jest.fn();
    await optionalAuth(req, makeRes() as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect((req as unknown as { user?: unknown }).user).toBeUndefined();
    expect(mockGetAuthUser).not.toHaveBeenCalled();
  });

  it("is accepted only for its own purpose, and lives ten minutes", () => {
    const decoded = jwtUtil.verifyPurposeToken(token, "password-change") as Record<string, unknown>;
    expect(decoded["id"]).toBe(USER_ID);
    expect(Number(decoded["exp"]) - Number(decoded["iat"])).toBe(600);
    expect(() => jwtUtil.verifyPurposeToken(token, "mfa")).toThrow();
    expect(() => jwtUtil.verifyPurposeToken(token, "socket")).toThrow();
    expect(() => jwtUtil.verifyAccessToken(token)).toThrow();
  });
});
