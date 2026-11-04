/**
 * A11-DB-03 (the 2026-11 audit) — a migration's idempotency guard tolerates
 * only the failure it is FOR.
 *
 * Six `catch` blocks in four early migrations swallowed every error: a
 * permission failure, a dropped connection or a statement timeout read as
 * "the table is absent" (or "the index exists"), the migration went on, and
 * its manifest row was written — the trap CLAUDE.md names. Each now tolerates
 * its one expected failure and rethrows anything else. This suite drives each
 * guard both ways.
 */
import { DataTypes } from "sequelize";

import m0001 from "../../migrations/0001-underscore-class-models";
import m0005 from "../../migrations/0005-add-batch-jobs";
import m0012 from "../../migrations/0012-enable-rls-policies";
import m0014 from "../../migrations/0014-add-user-webauthn-fields";

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const ABSENT = new Error('relation "x" does not exist');
const DENIED = new Error("permission denied for table x");

/** A QueryInterface double: every method a jest.fn the case configures. */
const context = (overrides: Record<string, unknown> = {}): never => {
  const double: Record<string, unknown> = {
    describeTable: jest.fn(),
    createTable: jest.fn(),
    addColumn: jest.fn(),
    addIndex: jest.fn(),
    removeIndex: jest.fn(),
    removeColumn: jest.fn(),
    renameColumn: jest.fn(),
    dropTable: jest.fn(),
    sequelize: { Sequelize: { DataTypes }, getDialect: () => "postgres", query: jest.fn() },
    ...overrides,
  };
  return double as never;
};

describe("A11-DB-03 — migration guards tolerate only their own failure", () => {
  it("0001: an absent table is skipped; a denied describe propagates", async () => {
    await expect(m0001.up({ context: context({ describeTable: jest.fn().mockRejectedValue(ABSENT) }) })).resolves.toBeUndefined();
    await expect(m0001.up({ context: context({ describeTable: jest.fn().mockRejectedValue(DENIED) }) })).rejects.toBe(DENIED);
  });

  it("0005: an absent table is created; a denied describe propagates and creates nothing", async () => {
    const created = context({ describeTable: jest.fn().mockRejectedValue(ABSENT) }) as unknown as { createTable: jest.Mock };
    await m0005.up({ context: created as never });
    expect(created.createTable).toHaveBeenCalledWith("batch_jobs", expect.any(Object));

    const denied = context({ describeTable: jest.fn().mockRejectedValue(DENIED) }) as unknown as { createTable: jest.Mock };
    await expect(m0005.up({ context: denied as never })).rejects.toBe(DENIED);
    expect(denied.createTable).not.toHaveBeenCalled();
  });

  it("0012: an absent table is skipped, up and down; any other failure propagates", async () => {
    const absent = context();
    (absent as unknown as { sequelize: { query: jest.Mock } }).sequelize.query.mockRejectedValue(ABSENT);
    await expect(m0012.up({ context: absent })).resolves.toBeUndefined();
    await expect(m0012.down({ context: absent })).resolves.toBeUndefined();

    const denied = context();
    (denied as unknown as { sequelize: { query: jest.Mock } }).sequelize.query.mockRejectedValue(DENIED);
    await expect(m0012.up({ context: denied })).rejects.toBe(DENIED);
    await expect(m0012.down({ context: denied })).rejects.toBe(DENIED);
  });

  it("0014: an existing index on up and an absent one on down are tolerated; other failures propagate", async () => {
    const desc = jest.fn().mockResolvedValue({ webauthn_credential_id: {}, webauthn_public_key: {}, webauthn_counter: {} });
    const exists = new Error('relation "users_webauthn_credential_id" already exists');

    await expect(m0014.up({ context: context({ describeTable: desc, addIndex: jest.fn().mockRejectedValue(exists) }) })).resolves.toBeUndefined();
    await expect(m0014.up({ context: context({ describeTable: desc, addIndex: jest.fn().mockRejectedValue(DENIED) }) })).rejects.toBe(DENIED);

    await expect(m0014.down({ context: context({ describeTable: desc, removeIndex: jest.fn().mockRejectedValue(ABSENT) }) })).resolves.toBeUndefined();
    await expect(m0014.down({ context: context({ describeTable: desc, removeIndex: jest.fn().mockRejectedValue(DENIED) }) })).rejects.toBe(DENIED);
  });
});
