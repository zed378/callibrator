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
const mockDb = { rows: {}, statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockDb.statements.push(text);
    const table = (text.match(/FROM "([a-z_]+)"/) || [])[1];
    const stored = mockDb.rows[table];
    if (!/^SELECT /i.test(text) || !stored || !options.model) {
      return options.plain ? null : [];
    }
    // Answer with the SELECTed columns only, keyed by attribute, as the
    // database driver would: `"first_name" AS "firstName"` -> firstName.
    const selectList = text.slice("SELECT ".length, text.indexOf(" FROM "));
    const picked = stored.map((row) => {
      const out = {};
      const re = /"([a-z_]+)"(?: AS "([A-Za-z_]+)")?/g;
      let m;
      while ((m = re.exec(selectList)) !== null) {
        const column = m[1];
        const attribute = m[2] || m[1];
        if (Object.prototype.hasOwnProperty.call(row, column)) {
          out[attribute] = row[column];
        }
      }
      return out;
    });
    const built = options.model.bulkBuild(picked, { raw: true, isNewRecord: false });
    return options.plain ? built[0] || null : built;
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

const fs = require("fs");
const { Readable } = require("stream");
const JSZip = require("jszip");
const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const tenantBackupService = require("../../services/tenantBackup.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const BACKUP = "22222222-2222-4222-8222-222222222222";

const asTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);

const userRow = () => ({
  id: USER, tenant_id: TENANT, role_id: null, username: "nurse.jane", email: "jane@hospital.test",
  first_name: "Jane", last_name: "Doe", status: "ACTIVE", is_active: true, is_deleted: false, deleted_at: null,
});
const tenantRow = () => ({ id: TENANT, name: "Hospital A", code: "HA", status: "active", is_deleted: false, deleted_at: null });

/** Run createBackup for real with this backupType and return the parsed data file. */
const takeBackup = async (backupType) => {
  let written = null;
  jest.spyOn(models.TenantBackup, "createBackup").mockResolvedValue({ id: BACKUP });
  jest.spyOn(models.sequelize, "transaction").mockImplementation(async (callback) => callback({}));
  jest.spyOn(models.TenantBackup, "updateStatus").mockResolvedValue(undefined);
  jest.spyOn(models.TenantBackup, "findByPk").mockResolvedValue({ id: BACKUP });
  jest.spyOn(fs, "existsSync").mockReturnValue(true);
  jest.spyOn(fs, "writeFileSync").mockImplementation((_path, buffer) => {
    written = buffer;
  });
  jest.spyOn(fs, "createReadStream").mockImplementation(() => Readable.from([Buffer.from("zip")]));
  const result = await asTenant(() =>
    tenantBackupService.createBackup({ tenantId: TENANT, createdById: USER, name: "drill", backupType, models }),
  );
  expect(result.status).toBe(201);
  const zip = await JSZip.loadAsync(written);
  const name = Object.keys(zip.files).find((n) => n.startsWith("tenant_data_"));
  return JSON.parse(await zip.files[name].async("string"));
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
