/**
 * ADR-100 amendment (2026-09-30), A-292 — an SSO-start refusal's LATENCY is
 * not an oracle. An unknown organisation code is refused after one query, a
 * known code without SSO after two; every refusal is now held to a common
 * floor (SSO_REFUSAL_FLOOR_MS), so the two are measured here to differ by a
 * bounded amount, not exactly. With the floor at 0 (the behaviour before) the
 * same measurement shows the gap.
 *
 * The real sso.controller handlers run; the tenant lookup and the settings
 * read are doubled, the settings read taking a deliberate 250 ms. The two
 * paths are compared on jest's fake clock (2026-10-09, after a CI flake on
 * `d0fea5c`: wall-clock medians of three differed by 340 ms on a loaded
 * runner): they must answer at the same virtual instant, the floor, and not
 * before it. The `withSsoRefusalFloor` cases below keep REAL-clock floor checks.
 */
import type { Request, Response } from "express";
import { environment } from "../../config/env";

jest.mock("../../models", () => ({
  Tenants: { findOne: jest.fn() },
  Users: {},
  sequelize: {},
}));
jest.mock("../../services/tenant.service", () => ({ getTenantSettings: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

interface Double {
  findOne: jest.Mock;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a jest double of the JavaScript models barrel
const { Tenants } = require("../../models") as { Tenants: Double };
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a jest double
const tenantService = require("../../services/tenant.service") as { getTenantSettings: jest.Mock };
type Handler = (req: Request, res: Response, next: () => void) => Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the controller is JavaScript (CommonJS)
const sso = require("../../controllers/sso.controller") as {
  ssoLogin: Handler;
  oidcLogin: Handler;
  startSsoFor: (code: string, res: object) => Promise<unknown>;
  withSsoRefusalFloor: <A extends unknown[], R>(work: (...args: A) => Promise<R>) => (...args: A) => Promise<R>;
  SSO_UNAVAILABLE: string;
};

const SETTINGS_MS = 250;
const FLOOR_MS = 600;

jest.setTimeout(30000);

const env = environment();
const saved = env["SSO_REFUSAL_FLOOR_MS"];
afterAll(() => {
  env["SSO_REFUSAL_FLOOR_MS"] = saved ?? "400";
});

const slowSettings = (): Promise<unknown> =>
  new Promise((resolve) =>
    setTimeout(() => {
      resolve({ data: { settings: { sso_enabled: "false" } } });
    }, SETTINGS_MS),
  );

/** One handler call on the clock in force: when it answered (ms after it started; null = not yet) and with what. */
interface Answer {
  ms: number | null;
  status: number | null;
}

const start = (handler: Handler, tenantCode: string): Answer => {
  const answer: Answer = { ms: null, status: null };
  const started = Date.now();
  const res = {
    statusCode: 200,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json() {
      answer.ms = Date.now() - started;
      answer.status = res.statusCode;
      return res;
    },
    setHeader() {
      return res;
    },
  };
  void handler({ body: { tenantCode }, headers: {} } as unknown as Request, res as unknown as Response, () => undefined);
  return answer;
};

/**
 * A-292 on a FAKE clock (jest's modern timers fake `Date.now` and `setTimeout` alike): the measure is the
 * controller's own arithmetic, not the runner's scheduling. Wall-clock medians compared within a
 * tolerance flaked on a loaded CI runner (340 ms against a 150 ms bound on `d0fea5c`) with the code
 * unchanged; on a fake clock the two refusals must answer at the SAME instant, and not one tick before
 * the floor — a stronger claim than "within 150 ms".
 *
 * @param handler - the controller handler under test
 * @param before - virtual ms to run before the first look
 * @returns each path's answer after `before` virtual ms, and once every timer has run
 */
const onFakeClock = async (handler: Handler, before: number): Promise<{ early: Answer[]; done: Answer[] }> => {
  Tenants.findOne.mockResolvedValueOnce(null);
  const unknownCode = start(handler, "nope");
  Tenants.findOne.mockResolvedValueOnce({ id: "t1", code: "acme" });
  tenantService.getTenantSettings.mockImplementationOnce(slowSettings);
  const knownWithoutSso = start(handler, "acme");
  await jest.advanceTimersByTimeAsync(before);
  const early = [{ ...unknownCode }, { ...knownWithoutSso }];
  await jest.advanceTimersByTimeAsync(FLOOR_MS + SETTINGS_MS);
  return { early, done: [unknownCode, knownWithoutSso] };
};

describe.each([
  ["POST /sso/login", (): Handler => sso.ssoLogin],
  ["POST /sso/oidc/login", (): Handler => sso.oidcLogin],
])("%s", (_name, handlerOf) => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2030-01-15T09:00:00Z") });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("an unknown code and a known code without SSO answer at the same instant: exactly the floor, nothing before it", async () => {
    env["SSO_REFUSAL_FLOOR_MS"] = String(FLOOR_MS);
    const { early, done } = await onFakeClock(handlerOf(), FLOOR_MS - 1);
    // One tick before the floor, neither has answered: the floor holds both.
    expect(early.map((a) => a.ms)).toEqual([null, null]);
    expect(done).toEqual([
      { ms: FLOOR_MS, status: 404 },
      { ms: FLOOR_MS, status: 404 },
    ]);
  });

  it("control: with no floor (the behaviour before), the extra query shows as exactly its own time", async () => {
    env["SSO_REFUSAL_FLOOR_MS"] = "0";
    const { early, done } = await onFakeClock(handlerOf(), 0);
    // The unknown code answers at once; the known one only after the settings read.
    expect(early.map((a) => a.ms)).toEqual([0, null]);
    expect(done).toEqual([
      { ms: 0, status: 404 },
      { ms: SETTINGS_MS, status: 404 },
    ]);
  });
});

describe("withSsoRefusalFloor", () => {
  it("does not delay a success or an error that is not the SSO refusal", async () => {
    env["SSO_REFUSAL_FLOOR_MS"] = String(FLOOR_MS);
    const started = Date.now();
    await expect(sso.withSsoRefusalFloor(() => Promise.resolve("ok"))()).resolves.toBe("ok");
    await expect(sso.withSsoRefusalFloor(() => Promise.reject(new Error("boom")))()).rejects.toThrow("boom");
    // A thrown null (no message) is not the refusal either.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the null branch is what is tested
    await expect(sso.withSsoRefusalFloor(() => Promise.reject(null))()).rejects.toBeNull();
    expect(Date.now() - started).toBeLessThan(FLOOR_MS / 2);
  });

  it("the floor defaults to 400 ms when unset", async () => {
    Reflect.deleteProperty(env, "SSO_REFUSAL_FLOOR_MS");
    const started = Date.now();
    await expect(
      sso.withSsoRefusalFloor(() => Promise.reject(new Error(sso.SSO_UNAVAILABLE)))(),
    ).rejects.toThrow(sso.SSO_UNAVAILABLE);
    expect(Date.now() - started).toBeGreaterThanOrEqual(395);
  });

  it("startSsoFor is floored too (the Phase 10 /auth/sso/start)", async () => {
    env["SSO_REFUSAL_FLOOR_MS"] = String(FLOOR_MS);
    Tenants.findOne.mockResolvedValueOnce(null);
    const started = Date.now();
    await expect(sso.startSsoFor("nope", {})).rejects.toThrow(sso.SSO_UNAVAILABLE);
    expect(Date.now() - started).toBeGreaterThanOrEqual(FLOOR_MS - 5);
  });
});
