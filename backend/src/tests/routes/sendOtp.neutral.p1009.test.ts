/**
 * P10-09 (doc 20 §9) — POST /auth/send-otp answers IDENTICALLY for a known and
 * an unknown address, pinned at the HTTP level: the REAL auth router, request
 * budgets, validator, controller and service (auth.service#requestOTP), over
 * the REAL models (fixtures/memoryDb).
 *
 * The service returns different internal messages for the two cases ("OTP
 * sent" / "If the account exists…"); the controller must discard them. Only
 * the email queue is doubled: a known address must be SENT a code and an
 * unknown one must not, which is how the test proves both branches ran.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as RateLimiter from "../../services/rateLimiter.redis.service";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/emailQueue.service", () => {
  const queueOtpEmail = jest.fn();
  const api = { queueOtpEmail, queueActivationEmail: jest.fn() };
  return { __esModule: true, default: api, ...api };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const rateLimiter = jest.requireActual<typeof RateLimiter>("../../services/rateLimiter.redis.service");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the auth router is JavaScript (CommonJS), loaded after the mocks
const router = require("../../routes/api/auth.route") as unknown;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the doubled queue, to see which branch ran
const emailQueue = require("../../services/emailQueue.service") as { queueOtpEmail: jest.Mock };

const TENANT = "e1e1e1e1-0000-4000-8000-0000000000e1";

beforeEach(() => {
  mdb.reset();
  as(null);
  (rateLimiter as unknown as { clearMemoryStore: () => void }).clearMemoryStore();
  emailQueue.queueOtpEmail.mockClear();
  mdb.seed("Tenant", { id: TENANT, name: "RS Contoh", code: "RSC", subdomain: "rsc", email: "rsc@x.test", status: "active" });
  mdb.seed("User", {
    id: "e2e2e2e2-0000-4000-8000-0000000000e2",
    tenantId: TENANT,
    email: "dewi@rs-contoh.test",
    username: "dewi",
    password: "x",
    firstName: "Dewi",
    lastName: "L",
    status: "ACTIVE",
    isActive: true,
  });
});

const sendOtp = (email: string, ip: string): Promise<RouteClient.RouteResponse> =>
  call(router, "POST", "/send-otp", { body: { email }, headers: { "x-forwarded-for": ip } });

describe("P10-09: send-otp is neutral at the HTTP layer", () => {
  it("a known and an unknown address get the same status, body and headers", async () => {
    const known = await sendOtp("dewi@rs-contoh.test", "198.51.100.1");
    expect(emailQueue.queueOtpEmail).toHaveBeenCalledTimes(1);

    const unknown = await sendOtp("nobody@rs-contoh.test", "198.51.100.2");
    // The unknown branch ran: nothing was sent.
    expect(emailQueue.queueOtpEmail).toHaveBeenCalledTimes(1);

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(unknown.headers).toEqual(known.headers);
    expect(JSON.stringify(known.body)).toContain("If the account exists");
  });
});
