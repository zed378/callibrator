/**
 * A-124 (ADR-051 Q-13) — the closed list of system actors, and its agreement
 * with the schema (model ENUM, migration 0033) and with every job that names
 * itself in the code.
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");
const {
  ACTOR_TYPES,
  ACTOR_TYPE_VALUES,
  SYSTEM_ACTORS,
  SYSTEM_ACTOR_NAMES,
  ACTOR_NAME_MAX_LENGTH,
} = require("../../constants/systemActors");
const migration = require("../../migrations/0033-audit-log-actor");

const AuditLog = require("../../models/auditLog.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);

const SRC = path.join(__dirname, "../..");

/** Every .js file under src/, except tests. */
const sourceFiles = (dir = SRC) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {return entry.name === "tests" ? [] : sourceFiles(full);}
    // ADR-087 Amendment 4: .ts too — a converted file must not leave this guard.
    return /\.(js|ts)$/.test(entry.name) ? [full] : [];
  });

describe("A-124 — system actors", () => {
  it("actor types are user, system and unknown — independently of the constant", () => {
    // Independent list: ADR-051 Q-13 (user, system) plus the backfill's 'unknown'.
    expect([...ACTOR_TYPE_VALUES]).toEqual(["user", "system", "unknown"]);
    expect(ACTOR_TYPES).toEqual({ USER: "user", SYSTEM: "system", UNKNOWN: "unknown" });
  });

  it("the model ENUM and migration 0033's type both equal the constant", () => {
    const attrs = AuditLog.getAttributes();
    expect([...attrs.actorType.type.values]).toEqual([...ACTOR_TYPE_VALUES]);
    expect([...migration.ACTOR_TYPES]).toEqual([...ACTOR_TYPE_VALUES]);
    expect(attrs.actorType.allowNull).toBe(false);
    expect(attrs.actorType.field).toBe(migration.TYPE_COLUMN);
    expect(attrs.actorName.field).toBe(migration.NAME_COLUMN);
    expect(attrs.actorName.type.options.length).toBe(ACTOR_NAME_MAX_LENGTH);
    expect(migration.NAME_LENGTH).toBe(ACTOR_NAME_MAX_LENGTH);
  });

  it("the list is closed and frozen, and every name is a 'system:' name that fits the column", () => {
    expect(Object.isFrozen(SYSTEM_ACTORS)).toBe(true);
    expect(Object.isFrozen(SYSTEM_ACTOR_NAMES)).toBe(true);
    expect(SYSTEM_ACTOR_NAMES).toEqual([
      "system:retention-purge",
      "system:tenant-lifecycle",
      "system:scheduled-backup",
      "system:auth-lockout", // A-126
      "system:break-glass", // P6-07
      "system:calibration-scan", // W-04 / W-30
      "system:iot-ingest", // W-04: the anomaly alert only (ADR-069)
      "system:batch-job", // W-04: batch-job state changes (ADR-069)
      "system:webhook-delivery-purge", // ADR-070: finished deliveries past retention
      "system:scim", // A-37 (ADR-075): an IdP's SCIM API key
      "system:attachment-file-sweep", // D-22 (ADR-083): deleted attachments' files past retention
      "system:api-key", // A-282 (ADR-094): a tenant API key (service account)
      "system:billing-webhook", // A-276 (ADR-094): a signed Stripe event changing a tenant's status
      "system:bootstrap", // P10-16 (ADR-099): first super admin, default retirement, recovery CLI
      "system:access-request-intake", // P10-05 (ADR-098 §6): a request received through the public intake
      "system:access-request-retention", // P10-05 (Q-42): pending requests expired, decided ones deleted after 12 months
      "system:usage-quota", // A-322: a free-plan tenant suspended by quota enforcement
      "system:storage-migration", // P8-01 (ADR-086 Am. 1): a row's bytes moved into storage by the operator's CLI
      "system:catalogue-seed", // P20-03 (ADR-125 Am. 1): migration 0112 publishes the base checklist, version 1
      "system:upstream-sql-import", // P24-06: the SQL-dump import's worker, reconciliation and file purge
    ]);
    for (const name of SYSTEM_ACTOR_NAMES) {
      expect(name).toMatch(/^system:[a-z][a-z-]*$/);
      expect(name.length).toBeLessThanOrEqual(ACTOR_NAME_MAX_LENGTH);
    }
  });

  it("no source file invents a 'system:' actor that is not on the list", () => {
    const invented = [];
    for (const file of sourceFiles()) {
      const text = fs.readFileSync(file, "utf8");
      for (const [, name] of text.matchAll(/['"`](system:[a-z][a-z-]*)['"`]/g)) {
        if (!SYSTEM_ACTOR_NAMES.includes(name)) {
          invented.push(`${path.relative(SRC, file)}: ${name}`);
        }
      }
    }
    expect(invented).toEqual([]);
  });
});
