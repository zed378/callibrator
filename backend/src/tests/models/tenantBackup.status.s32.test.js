/**
 * S-32 — the tenant-backup status constants the code writes must be exactly
 * the members of the `status` column's ENUM.
 *
 * STATUS carried RESTORING, RESTORED and DELETING, which the ENUM never had.
 * tenantBackup.service wrote them, and on PostgreSQL each write fails with
 * `invalid input value for enum enum_tenant_backups_status` — so every
 * restore and every HTTP delete failed on a real database (reproduced on
 * PostgreSQL 16, 2026-09-24). The service unit tests mocked the model with
 * their own STATUS object and could not see it.
 *
 * Two independent sources are compared: the ENUM declared on the attribute
 * (what sync() creates in the database) and the STATUS object (what the code
 * writes), plus every `TenantBackup.STATUS.<X>` the backup services name.
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");
const defineTenantBackup = require("../../models/tenantBackup.model");

const sequelize = new Sequelize("postgres://u:p@127.0.0.1:1/none", { logging: false });
const TenantBackup = defineTenantBackup(sequelize, DataTypes);

describe("S-32 tenant backup STATUS vs the status ENUM", () => {
  afterAll(() => sequelize.close());

  it("STATUS is exactly the ENUM's members", () => {
    const enumValues = [...TenantBackup.rawAttributes.status.values].sort();
    expect(Object.values(TenantBackup.STATUS).sort()).toEqual(enumValues);
  });

  it("no backup service names a STATUS member the ENUM does not have", () => {
    const files = ["tenantBackup.service.js", "scheduledBackup.service.js"].map((f) =>
      path.join(__dirname, "../../services", f),
    );
    const named = new Set();
    for (const file of files) {
      for (const [, key] of fs.readFileSync(file, "utf8").matchAll(/TenantBackup\.STATUS\.([A-Z_]+)/g)) {
        named.add(key);
      }
    }
    expect(named.size).toBeGreaterThan(3); // the scan found the uses it is guarding
    for (const key of named) {
      expect(TenantBackup.STATUS).toHaveProperty(key);
    }
  });

  it("updateStatus no longer copies filePath into the VARCHAR(255) backupPath", async () => {
    const row = { update: jest.fn(async (data) => data) };
    jest.spyOn(TenantBackup, "findByPk").mockResolvedValue(row);
    const longPath = `/${"a".repeat(300)}/tenant_x.zip`;

    await TenantBackup.updateStatus("id-1", { status: "completed", filePath: longPath }, null, { transaction: "TX" });

    expect(TenantBackup.findByPk).toHaveBeenCalledWith("id-1", { transaction: "TX" });
    const [data, options] = row.update.mock.calls[0];
    expect(data).not.toHaveProperty("backupPath");
    expect(data.filePath).toBe(longPath);
    expect(options).toEqual({ transaction: "TX" });
    expect(TenantBackup.rawAttributes.filePath.type.options.length).toBe(500);
  });
});
