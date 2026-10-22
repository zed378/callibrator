/**
 * P24-08 (ADR-139 § 2, BACKLOG M-19) — an imported account awaiting its invitation is not opened by
 * the e-mail-code reset, and the reset says nothing about it. Pinned at the HTTP level: the REAL
 * auth router, request budgets, validator, controller and service (auth.service#requestOTP,
 * #processResetPassword), over the REAL models (fixtures/memoryDb).
 *
 * Fail-before: `send-otp` queued a code to the imported account, and `reset-password` with that
 * code set its password, verified its address and cleared `must_change_password` — a way in before
 * the pre-invitation gate and before the person behind a shared account was named.
 *
 * Only the e-mail queue is doubled, to see whether a code was sent.
 */
import * as crypto from "crypto";
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
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the auth router, loaded after the mocks
const router = require("../../routes/api/auth.route") as unknown;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the doubled queue, to see which branch ran
const emailQueue = require("../../services/emailQueue.service") as { queueOtpEmail: jest.Mock };

const TENANT = "f1f1f1f1-0000-4000-8000-0000000000f1";
const IMPORTED = "f2f2f2f2-0000-4000-8000-0000000000f2";
const OTP = "123456";
const NEW_PASSWORD = "Brand-new-Passw0rd!";
const UNUSABLE = "$2a$04$unusableunusableunusableunusableunusableunusableunusa";

let ip = 0;
const nextIp = (): string => `198.51.100.${String(++ip)}`;

const imported = (): MemoryDbModule.Row => {
  const found = mdb.rows("User").find((r) => r["id"] === IMPORTED);
  if (!found) {
    throw new Error("no imported user");
  }
  return found;
};

beforeEach(() => {
  mdb.reset();
  as(null);
  (rateLimiter as unknown as { clearMemoryStore: () => void }).clearMemoryStore();
  emailQueue.queueOtpEmail.mockClear();
  mdb.seed("Tenant", { id: TENANT, name: "Penyedia Kalibrasi", code: "PKS", subdomain: "pks", email: "pks@x.test", status: "active" });
  mdb.seed("User", {
    id: IMPORTED,
    tenantId: TENANT,
    email: "rs1a@example.test",
    username: "rs1a",
    password: UNUSABLE,
    firstName: "rs1a",
    lastName: "",
    status: "ACTIVE",
    isActive: true,
    isEmailVerified: false,
    mustChangePassword: true,
    awaitingInvitation: true,
    // Held as if a code had been issued before the marker (it cannot be, since the transform sets
    // both at insert): the reset must refuse on the marker, not on the missing code.
    otpCode: crypto.createHash("sha256").update(OTP).digest("hex"),
    otpExpiredAt: new Date(Date.now() + 60 * 60 * 1000),
  });
});

const post = (path: string, body: Record<string, unknown>): Promise<RouteClient.RouteResponse> =>
  call(router, "POST", path, { body, headers: { "x-forwarded-for": nextIp() } });

const resetBody = (email: string): Record<string, unknown> => ({ email, otp: OTP, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });

describe("P24-08: an account awaiting its invitation is closed to the e-mail-code reset", () => {
  it("send-otp sends it no code and answers exactly as for an unknown address", async () => {
    const awaiting = await post("/send-otp", { email: "rs1a@example.test" });
    const unknown = await post("/send-otp", { email: "nobody@example.test" });

    expect(emailQueue.queueOtpEmail).not.toHaveBeenCalled();
    expect(awaiting.status).toBe(200);
    expect(awaiting.body).toEqual(unknown.body);
    expect(awaiting.headers).toEqual(unknown.headers);
    // The stored code is the seeded one: no new code was written either.
    expect(imported()["otpCode"]).toBe(crypto.createHash("sha256").update(OTP).digest("hex"));
  });

  it("send-otp still sends a code to the same kind of account once it no longer awaits its invitation (the branch is the marker)", async () => {
    mdb.seed("User", {
      id: "f3f3f3f3-0000-4000-8000-0000000000f3",
      tenantId: TENANT,
      email: "invited@example.test",
      username: "invited",
      password: UNUSABLE,
      firstName: "Invited",
      lastName: "Person",
      status: "ACTIVE",
      isActive: true,
      mustChangePassword: true,
      awaitingInvitation: false,
    });
    await post("/send-otp", { email: "invited@example.test" });
    expect(emailQueue.queueOtpEmail).toHaveBeenCalledTimes(1);
  });

  it("reset-password refuses even a valid code, with the unknown address's answer, and changes nothing", async () => {
    const awaiting = await post("/reset-password", resetBody("rs1a@example.test"));
    const unknown = await post("/reset-password", resetBody("nobody@example.test"));

    expect(awaiting.status).toBe(400);
    expect(awaiting.status).toBe(unknown.status);
    expect(awaiting.body).toEqual(unknown.body);
    expect(imported()).toMatchObject({
      password: UNUSABLE,
      isEmailVerified: false,
      mustChangePassword: true,
      awaitingInvitation: true,
    });
  });
});
