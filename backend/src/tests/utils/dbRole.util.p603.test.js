/**
 * P6-03 — utils/dbRole.util.js: the backend drops to the application role
 * after migrating, and refuses to boot if that role could still delete a
 * calibration record.
 *
 * These prove the logic against doubles. That PostgreSQL really refuses the
 * DELETE as that role is proved in services/dataIntegrity.p6.live.test.js
 * ("DELETE on calibration_records is refused by privilege", and the
 * MUTATION CHECK beside it) — a mock proves the client, not the contract.
 */
const {
  resolveAppRole,
  enterApplicationRole,
  switchConnection,
  SWITCHED,
  HOOK_NAME,
  AUDIT_MASKABLE_COLUMNS,
} = require("../../utils/dbRole.util");

const logger = () => ({ info: jest.fn(), warn: jest.fn() });

const GOOD = {
  currentUser: "callibrator_app",
  superuser: false,
  canDelete: false,
  canUpdateAll: false,
  canInsert: true,
  auditCanDelete: false,
  auditCanTruncate: false,
  auditCanInsert: true,
  auditUpdatableColumns: ["changes", "ip_address", "user_agent"],
};

const fakeSequelize = (check) => ({
  addHook: jest.fn(),
  query: jest.fn().mockResolvedValue([check]),
});

describe("resolveAppRole", () => {
  it.each([[undefined], [""], ["none"]])("%p turns switching off", (value) => {
    expect(resolveAppRole({ DB_APP_ROLE: value })).toBeNull();
  });

  it("returns a plain identifier", () => {
    expect(resolveAppRole({ DB_APP_ROLE: "callibrator_app" })).toBe("callibrator_app");
  });

  it.each([["App"], ["app; DROP TABLE x"], ['"quoted"'], ["1app"]])("refuses %p", (value) => {
    expect(() => resolveAppRole({ DB_APP_ROLE: value })).toThrow(/not a plain lower-case identifier/);
  });

  it("reads process.env by default", () => {
    const saved = process.env.DB_APP_ROLE;
    process.env.DB_APP_ROLE = "role_from_env";
    try {
      expect(resolveAppRole()).toBe("role_from_env");
    } finally {
      if (saved === undefined) {
        delete process.env.DB_APP_ROLE;
      } else {
        process.env.DB_APP_ROLE = saved;
      }
    }
  });
});

describe("switchConnection", () => {
  it("runs SET ROLE once per connection, then marks it", async () => {
    const connection = { query: jest.fn().mockResolvedValue({}) };
    const hook = switchConnection("callibrator_app");
    await hook(connection);
    await hook(connection);
    expect(connection.query).toHaveBeenCalledTimes(1);
    expect(connection.query).toHaveBeenCalledWith("SET ROLE callibrator_app");
    expect(connection[SWITCHED]).toBe("callibrator_app");
  });

  it("does not mark a connection whose SET ROLE failed, so the next acquisition retries", async () => {
    const connection = { query: jest.fn().mockRejectedValue(new Error("permission denied to set role")) };
    await expect(switchConnection("callibrator_app")(connection)).rejects.toThrow("permission denied");
    expect(connection[SWITCHED]).toBeUndefined();
  });
});

describe("enterApplicationRole", () => {
  it("off: warns on every boot and touches nothing", async () => {
    const sequelize = fakeSequelize(GOOD);
    const log = logger();
    await expect(enterApplicationRole({ sequelize, logger: log, env: {} })).resolves.toBeNull();
    expect(sequelize.addHook).not.toHaveBeenCalled();
    expect(sequelize.query).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/DB_APP_ROLE is not set/));
  });

  it("on: installs the afterPoolAcquire hook, then proves the switch as the role", async () => {
    const sequelize = fakeSequelize(GOOD);
    const log = logger();
    await expect(
      enterApplicationRole({ sequelize, logger: log, env: { DB_APP_ROLE: "callibrator_app" } }),
    ).resolves.toBe("callibrator_app");
    expect(sequelize.addHook).toHaveBeenCalledWith("afterPoolAcquire", HOOK_NAME, expect.any(Function));
    // The hook is installed BEFORE the proof query, so the proof runs switched.
    expect(sequelize.addHook.mock.invocationCallOrder[0]).toBeLessThan(
      sequelize.query.mock.invocationCallOrder[0],
    );
    expect(sequelize.query.mock.calls[0][0]).toMatch(/has_table_privilege\('calibration_records', 'DELETE'\)/);
    expect(sequelize.query.mock.calls[0][0]).toMatch(/has_table_privilege\('audit_logs', 'DELETE'\)/);
    expect(sequelize.query.mock.calls[0][0]).toMatch(/has_table_privilege\('audit_logs', 'TRUNCATE'\)/);
    expect(sequelize.query.mock.calls[0][0]).toMatch(/has_column_privilege\('audit_logs', a\.attnum, 'UPDATE'\)/);
    expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/application role "callibrator_app"/));
  });

  it.each([
    [{ currentUser: "postgres" }, /current_user is "postgres", not "callibrator_app"/],
    [{ superuser: true }, /the role is a superuser/],
    [{ canDelete: true }, /can DELETE from calibration_records/],
    [{ canUpdateAll: true }, /can UPDATE every column of calibration_records/],
    [{ canInsert: false }, /cannot INSERT into calibration_records/],
    // ADR-095 O-1 — audit_logs as migration 0091 leaves it.
    [{ auditCanDelete: true }, /can DELETE from audit_logs/],
    [{ auditCanTruncate: true }, /can TRUNCATE audit_logs/],
    [{ auditCanInsert: false }, /cannot INSERT into audit_logs/],
    // 0057's blanket grant, 0091 not applied: every column is updatable.
    [
      { auditUpdatableColumns: ["action", "changes", "created_at", "id", "ip_address", "user_agent"] },
      /may UPDATE audit_logs columns \[action, changes, created_at, id, ip_address, user_agent\], not exactly the maskable \[changes, ip_address, user_agent\]/,
    ],
    // A missing column grant breaks GDPR masking (A-135): refused as well.
    [{ auditUpdatableColumns: ["changes", "ip_address"] }, /may UPDATE audit_logs columns \[changes, ip_address\]/],
    [{ auditUpdatableColumns: [] }, /may UPDATE audit_logs columns \[\]/],
  ])("REFUSES the boot when %j", async (override, message) => {
    const sequelize = fakeSequelize({ ...GOOD, ...override });
    await expect(
      enterApplicationRole({ sequelize, logger: logger(), env: { DB_APP_ROLE: "callibrator_app" } }),
    ).rejects.toThrow(message);
  });

  it("accepts the maskable columns in any order the catalog returns them", async () => {
    const sequelize = fakeSequelize({ ...GOOD, auditUpdatableColumns: ["user_agent", "changes", "ip_address"] });
    await expect(
      enterApplicationRole({ sequelize, logger: logger(), env: { DB_APP_ROLE: "callibrator_app" } }),
    ).resolves.toBe("callibrator_app");
    expect(AUDIT_MASKABLE_COLUMNS).toEqual(["changes", "ip_address", "user_agent"]);
  });

  it("names every defect at once", async () => {
    const sequelize = fakeSequelize({ ...GOOD, superuser: true, canDelete: true });
    await expect(
      enterApplicationRole({ sequelize, logger: logger(), env: { DB_APP_ROLE: "callibrator_app" } }),
    ).rejects.toThrow(/superuser; the role can DELETE/);
  });

  it("uses process.env when no env is passed", async () => {
    const saved = process.env.DB_APP_ROLE;
    delete process.env.DB_APP_ROLE;
    try {
      const sequelize = fakeSequelize(GOOD);
      await expect(enterApplicationRole({ sequelize, logger: logger() })).resolves.toBeNull();
    } finally {
      if (saved !== undefined) {
        process.env.DB_APP_ROLE = saved;
      }
    }
  });
});
