/**
 * P7-04 drill finding D-3 (ADR-078) — a tenant backup taken through the API
 * exported NO users.
 *
 * The validator (tenantBackup.validator#createBackupSchema) and the UI
 * (BackupCreateModal) send backupType "FULL" / "USER_ONLY"; the model's
 * BACKUP_TYPES and the scheduled backup use "full" / "user_only". The export
 * compared them case-sensitively, so in the drill on PostgreSQL 18 both
 * tenants' "FULL" archives held the tenant row and `"users": []`
 * (recordCount 0) while each tenant had an administrator.
 *
 * Harness: the REAL models barrel on an unconnected PostgreSQL-dialect
 * Sequelize whose `query` plays the database (tenantBackup.secrets.a139).
 */
import type * as SequelizeModule from "sequelize";
import type TenantBackupService from "../../services/tenantBackup.service";
import type { FakeStorageModule } from "../fixtures/fakeStorage";
import type { TenantId, UserId } from "../../types/ids";

const mockDb: { rows: Record<string, Record<string, unknown>[]>; statements: string[] } = { rows: {}, statements: [] };

// P8-01 (ADR-086 Amendment 1): the archive is put into the tenant's storage.
jest.mock("../../services/storage", () =>
  jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage(),
);
jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  (db as unknown as { query: unknown }).query = (sql: string | { query: string }, options: { plain?: boolean; model?: { bulkBuild: (rows: unknown[], opts: unknown) => unknown[] } } = {}) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockDb.statements.push(text);
    const table = (/FROM "([a-z_]+)"/.exec(text) || [])[1];
    const stored = table ? mockDb.rows[table] : undefined;
    if (!/^SELECT /i.test(text) || !stored || !options.model) {
      return Promise.resolve(options.plain ? null : []);
    }
    // Answer with the SELECTed columns only, keyed by attribute, as the
    // database driver would: `"first_name" AS "firstName"` -> firstName.
    const selectList = text.slice("SELECT ".length, text.indexOf(" FROM "));
    const picked = stored.map((row) => {
      const out: Record<string, unknown> = {};
      const re = /"([a-z_]+)"(?: AS "([A-Za-z_]+)")?/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(selectList)) !== null) {
        const column = m[1] ?? "";
        const attribute = m[2] ?? column;
        if (Object.prototype.hasOwnProperty.call(row, column)) {
          out[attribute] = row[column];
        }
      }
      return out;
    });
    const built = options.model.bulkBuild(picked, { raw: true, isNewRecord: false });
    return Promise.resolve(options.plain ? built[0] ?? null : built);
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as tenantBackup.secrets.a139 does */
import fs from "fs";
import { Readable } from "stream";
import JSZip from "jszip";
require("../../models");
const models = require("../../models") as {
  TenantBackup: {
    BACKUP_TYPES: { FULL: string };
    createBackup: jest.Mock;
    updateStatus: jest.Mock;
    findByPk: jest.Mock;
  };
  sequelize: { transaction: jest.Mock };
};
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as {
  tenantStorage: { run<T>(store: object, fn: () => T): T };
};
const tenantBackupService = require("../../services/tenantBackup.service") as typeof TenantBackupService;
const storage = require("../../services/storage") as FakeStorageModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "11111111-1111-4111-8111-111111111111" as TenantId;
const USER = "33333333-3333-4333-8333-333333333333" as UserId;
const BACKUP = "22222222-2222-4222-8222-222222222222";

const asTenant = <T>(fn: () => T): T => tenantStorage.run({ tenantId: TENANT }, fn);

const userRow = (): Record<string, unknown> => ({
  id: USER, tenant_id: TENANT, role_id: null, username: "nurse.jane", email: "jane@hospital.test",
  first_name: "Jane", last_name: "Doe", status: "ACTIVE", is_active: true, is_deleted: false, deleted_at: null,
});
const tenantRow = (): Record<string, unknown> => ({ id: TENANT, name: "Hospital A", code: "HA", status: "active", is_deleted: false, deleted_at: null });

/** Run createBackup for real with this backupType and return the parsed data file. */
const takeBackup = async (backupType: string): Promise<{ users: unknown[] }> => {
  jest.spyOn(models.TenantBackup, "createBackup").mockResolvedValue({ id: BACKUP });
  jest.spyOn(models.sequelize, "transaction").mockImplementation((callback: (tx: unknown) => Promise<unknown>) => Promise.resolve(callback({})));
  jest.spyOn(models.TenantBackup, "updateStatus").mockResolvedValue(undefined);
  jest.spyOn(models.TenantBackup, "findByPk").mockResolvedValue({ id: BACKUP });
  jest.spyOn(fs, "existsSync").mockReturnValue(true);
  jest.spyOn(fs, "createReadStream").mockImplementation(() => Readable.from([Buffer.from("zip")]) as unknown as fs.ReadStream);
  const result = await asTenant(() =>
    tenantBackupService.createBackup({ tenantId: TENANT, createdById: USER, name: "drill", backupType, models: models as unknown as Parameters<typeof tenantBackupService.createBackup>[0]["models"] }),
  );
  expect(result.status).toBe(201);
  // P8-01: the archive is in the tenant's storage, not written to disk.
  const written = [...storage.__objects.values()][0]?.body;
  storage.__reset();
  if (!written) {
    throw new Error("no archive written to fake storage");
  }
  const zip = await JSZip.loadAsync(written);
  const name = Object.keys(zip.files).find((n) => n.startsWith("tenant_data_"));
  if (!name || !zip.files[name]) {
    throw new Error("no tenant_data_ file in the archive");
  }
  return JSON.parse(await zip.files[name].async("string")) as { users: unknown[] };
};

beforeEach(() => {
  jest.restoreAllMocks();
  mockDb.statements = [];
  mockDb.rows = { users: [userRow()], tenants: [tenantRow()] };
});

describe("D-3 — the backup type the API sends selects the users", () => {
  it('"FULL" (what the validator and the UI send) exports the tenant\'s users', async () => {
    const data = await takeBackup("FULL");
    expect(data.users).toEqual([expect.objectContaining({ id: USER, email: "jane@hospital.test" })]);
  });

  it('"USER_ONLY" exports the users too', async () => {
    const data = await takeBackup("USER_ONLY");
    expect(data.users).toHaveLength(1);
  });

  it('"full" (the scheduled backup\'s constant) still does', async () => {
    const data = await takeBackup(models.TenantBackup.BACKUP_TYPES.FULL);
    expect(data.users).toHaveLength(1);
  });

  it('"PARTIAL" exports the tenant row only, as before', async () => {
    const data = await takeBackup("PARTIAL");
    expect(data.users).toEqual([]);
    expect(mockDb.statements.some((s) => /FROM "users"/.test(s))).toBe(false);
  });
});
