/**
 * ADR-100 amendment (2026-09-30), A-292 — an SSO-start refusal's LATENCY is
 * not an oracle. An unknown organisation code is refused after one query, a
 * known code without SSO after two; every refusal is now held to a common
 * floor (SSO_REFUSAL_FLOOR_MS), so the two are measured here to differ by a
 * bounded amount, not exactly. With the floor at 0 (the behaviour before) the
 * same measurement shows the gap.
 *
 * The real sso.controller handlers run; the tenant lookup and the settings
 * read are doubled, the settings read taking a deliberate 250 ms. The bound
 * (150 ms) is wide enough for a loaded machine's timer jitter and still well
 * under the 250 ms gap the control measures without the floor.
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
/** The bound on the difference: timer and scheduling jitter on a loaded machine. */
const BOUND_MS = 150;

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

/** Milliseconds a handler takes to answer, and the status it answered. */
const timed = (handler: Handler, tenantCode: string): Promise<{ ms: number; status: number }> =>
  new Promise((resolve) => {
    const started = Date.now();
    const res = {
      statusCode: 200,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json() {
        resolve({ ms: Date.now() - started, status: res.statusCode });
        return res;
      },
      setHeader() {
        return res;
      },
    };
    void handler({ body: { tenantCode }, headers: {} } as unknown as Request, res as unknown as Response, () => undefined);
  });

/** Median of three runs of each path. */
const gap = async (handler: Handler): Promise<{ unknown: number; disabled: number; statuses: number[] }> => {
  const unknownRuns: number[] = [];
  const disabledRuns: number[] = [];
  const statuses: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    Tenants.findOne.mockResolvedValueOnce(null);
    const u = await timed(handler, "nope");
    Tenants.findOne.mockResolvedValueOnce({ id: "t1", code: "acme" });
    tenantService.getTenantSettings.mockImplementationOnce(slowSettings);
    const d = await timed(handler, "acme");
    unknownRuns.push(u.ms);
    disabledRuns.push(d.ms);
    statuses.push(u.status, d.status);
  }
  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[1] ?? 0;
  return { unknown: median(unknownRuns), disabled: median(disabledRuns), statuses };
};

describe.each([
  ["POST /sso/login", (): Handler => sso.ssoLogin],
  ["POST /sso/oidc/login", (): Handler => sso.oidcLogin],
])("%s", (_name, handlerOf) => {
  it(`an unknown code and a known code without SSO answer within ${String(BOUND_MS)} ms of each other, both at or after the floor`, async () => {
    env["SSO_REFUSAL_FLOOR_MS"] = String(FLOOR_MS);
    const { unknown, disabled, statuses } = await gap(handlerOf());
    expect(new Set(statuses)).toEqual(new Set([404]));
    expect(unknown).toBeGreaterThanOrEqual(FLOOR_MS - 5);
    expect(disabled).toBeGreaterThanOrEqual(FLOOR_MS - 5);
    expect(Math.abs(disabled - unknown)).toBeLessThan(BOUND_MS);
  });

  it("control: with no floor (the behaviour before), the extra query shows", async () => {
    env["SSO_REFUSAL_FLOOR_MS"] = "0";
    const { unknown, disabled } = await gap(handlerOf());
    expect(disabled - unknown).toBeGreaterThanOrEqual(SETTINGS_MS - 30);
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
