/**
 * A-116 — Sequelize's UUID defaults are real in unit runs.
 *
 * `<rootDir>/__mocks__/uuid.js` (plus a `moduleNameMapper` entry) replaced the
 * `uuid` package for EVERY require in a unit run — Sequelize's own included.
 * Sequelize generates `DataTypes.UUIDV4` / `UUIDV1` defaults through that
 * package (utils.toDefaultValue), so every UUIDV4 default in a unit run was
 * the constant `12345678-1234-1234-1234-123456789012` and UUIDV1 threw
 * (`uuid.v1 is not a function`). A test that built two rows, or that relied
 * on distinct ids (a Map keyed by id, a uniqueness assertion, a lookup of
 * "the other" row), was testing something production never does.
 *
 * The mock is gone; a test that wants a deterministic id mocks `uuid` in its
 * own file. This file must pass WITHOUT any such mock.
 *
 * Runs on an unconnected PostgreSQL-dialect Sequelize; `build()` never
 * touches the database.
 */
jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async () => [];
  return { db };
});

const { DataTypes } = require("sequelize");
const models = require("../../models");

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V1 = /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("A-116 — UUID defaults are generated, not a mocked constant", () => {
  it("two CalibrationDevice.build() rows get different, valid v4 ids", () => {
    const a = models.CalibrationDevice.build({});
    const b = models.CalibrationDevice.build({});

    expect(a.id).toMatch(V4);
    expect(b.id).toMatch(V4);
    expect(a.id).not.toBe(b.id);
  });

  it("every model whose primary key defaults to UUIDV4 builds distinct ids", () => {
    const withV4 = Object.values(models).filter(
      (m) =>
        m &&
        typeof m.build === "function" &&
        m.rawAttributes?.id?.defaultValue instanceof DataTypes.UUIDV4,
    );
    // Guard against the filter silently matching nothing.
    expect(withV4.length).toBeGreaterThan(10);

    const repeated = withV4
      .map((m) => ({ name: m.name, ids: [m.build({}).id, m.build({}).id] }))
      .filter(({ ids }) => ids[0] === ids[1] || !V4.test(ids[0]));
    expect(repeated).toEqual([]);
  });

  it("a UUIDV1 default generates a valid v1 id instead of throwing", () => {
    const { db } = require("../../config");
    const Probe = db.define("A116Probe", {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV1, primaryKey: true },
    });

    const a = Probe.build({});
    const b = Probe.build({});

    expect(a.id).toMatch(V1);
    expect(a.id).not.toBe(b.id);
  });

  it("application code gets the real uuid too", () => {
    const { v4 } = require("uuid");
    const a = v4();
    expect(a).toMatch(V4);
    expect(v4()).not.toBe(a);
  });
});
