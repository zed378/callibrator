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
    return entry.name.endsWith(".js") ? [full] : [];
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
