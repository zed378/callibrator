/**
 * A-340: the rate limiter offers no session revokers that revoke nothing.
 *
 * `rateLimiter.redis.service#revokeTokenByHash` and `#revokeAllUserTokens`
 * updated `sessions` through camelCase keys (`isRevoked`, `tokenHash`,
 * `userId`, `revokedReason`, `isActive`). The `Session` model's attributes are
 * snake_case (`is_revoked`, `token_hash`, …), so Sequelize dropped the
 * values. The `where` named columns that do not exist, so the update could
 * only fail and be logged. No route, controller, service, script or screen
 * called either function.
 *
 * Decision (A-340, the coordinator, as A-333): remove the dead pair. Session
 * revocation already has one working home, session.service (`revokeSession`,
 * `revokeAllSessions`, `revokeOtherSessions`, `revokeSessionById`).
 *
 * This test failed before the change: both functions were exported and the
 * source still named them.
 */
import fs from "fs";
import path from "path";

jest.mock("../../services/redis.service", () => ({ getRedisConnection: jest.fn(() => null) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const limiter = require("../../services/rateLimiter.redis.service") as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real session service, to show where revocation lives
const sessionService = require("../../services/session.service") as Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real model, to read its attributes
const models = require("../../models") as { Sessions: { getAttributes(): Record<string, unknown> } };

const REPO = path.resolve(__dirname, "../../../..");
const DEAD = /\brevokeTokenByHash\b|\brevokeAllUserTokens\b/;

/** Every source file of the backend, frontend and browser suites (tests aside). */
const sources = (dir: string): string[] => {
  if (!fs.existsSync(dir)) {return [];}
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["node_modules", ".next", "dist", "tests", "coverage"].includes(entry.name) ? [] : sources(full);
    }
    return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [full] : [];
  });
};

describe("A-340 — no session revokers that revoke nothing", () => {
  it("the rate limiter does not offer revokeTokenByHash or revokeAllUserTokens", () => {
    expect(limiter).not.toHaveProperty("revokeTokenByHash");
    expect(limiter).not.toHaveProperty("revokeAllUserTokens");
  });

  it("nothing in the backend, frontend or browser suites names them", () => {
    const files = [
      ...sources(path.join(REPO, "backend", "src")),
      ...sources(path.join(REPO, "backend", "scripts")),
      ...sources(path.join(REPO, "frontend", "src")),
      ...sources(path.join(REPO, "automate")),
    ];
    expect(files.length).toBeGreaterThan(100);
    const naming = files.filter((file) => DEAD.test(fs.readFileSync(file, "utf8"))).map((file) => path.relative(REPO, file));
    expect(naming).toEqual([]);
  });

  it("revocation lives in session.service, which is still offered", () => {
    for (const name of ["revokeSession", "revokeAllSessions", "revokeOtherSessions", "revokeSessionById"]) {
      expect(typeof sessionService[name]).toBe("function");
    }
  });

  it("the reason: Session's attributes are snake_case, not the keys the pair wrote", () => {
    const attributes = Object.keys(models.Sessions.getAttributes());
    expect(attributes).toEqual(expect.arrayContaining(["is_revoked", "token_hash", "revoked_reason", "is_active"]));
    for (const camel of ["isRevoked", "tokenHash", "revokedReason", "isActive"]) {
      expect(attributes).not.toContain(camel);
    }
  });
});
