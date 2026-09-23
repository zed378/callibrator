/**
 * restoreStatic() actually un-deletes the row — D-07
 *
 * The defect these tests exist for is invisible from the call site: the models
 * passed `{ is_deleted: false }` as the VALUES of `Model.update`, and Sequelize
 * v6 intersects an update's values against the model's *attribute* names
 * (`lib/model.js`, `options.fields = _.intersection(...)`). The attribute is
 * `isDeleted`, so the intersection was empty, `update` short-circuited to
 * `[0]` without issuing any statement, and the caller was handed a
 * success-shaped result. Nothing was ever restored.
 *
 * So these tests must assert the EFFECT, never the call. Asserting
 * `update` was called with `{ is_deleted: false }` passes against the broken
 * code — that is the trap.
 *
 * There is no test database in this suite (no sqlite driver is installed), so
 * the effect is observed at the lowest layer Sequelize reaches before the
 * driver: `queryInterface.bulkUpdate`, which receives the values already mapped
 * to physical column names by `Utils.mapValueFieldNames`, and the where clause
 * already mapped by `Utils.mapOptionFieldNames`. Real Sequelize does all of the
 * attribute resolution, scope injection and field mapping; only the socket is
 * replaced, by an in-memory row that the update is applied to. The row is then
 * read back through the model's own declared `defaultScope` predicate.
 *
 * What this does NOT cover: that PostgreSQL accepts the generated SQL, and the
 * global tenant-isolation hooks (registered on the shared instance in
 * `models/index.js`), which these standalone models do not carry.
 */

const { Sequelize, DataTypes, Op } = require("sequelize");

/**
 * Evaluate a mapped Sequelize where clause against one in-memory row. Only the
 * shapes this path really produces are understood — a plain equality, the
 * `{ [Op.eq]: null }` paranoid clause, and the `Op.and` wrapper that combines
 * them. Anything else throws rather than matching, so a where clause this
 * harness does not understand fails the test instead of passing it.
 */
const matchesWhere = (row, where) => {
  if (Array.isArray(where)) {
    return where.every((clause) => matchesWhere(row, clause));
  }
  const keys = [
    ...Object.keys(where),
    ...Object.getOwnPropertySymbols(where),
  ];
  return keys.every((key) => {
    const expected = where[key];
    if (key === Op.and) {
      return matchesWhere(row, expected);
    }
    if (expected !== null && typeof expected === "object") {
      if (Op.eq in expected) {
        return row[key] === expected[Op.eq];
      }
      throw new Error(`unsupported predicate on ${String(key)}`);
    }
    return row[key] === expected;
  });
};

/**
 * The seven models whose `restoreStatic` was the no-op. `session.model.js` is
 * deliberately absent: Session uniquely declares its attributes in snake_case
 * (`is_deleted` at :76), so `{ is_deleted: false }` IS its attribute name there
 * and the same three lines are correct. It is left untouched.
 */
const MODELS = [
  ["CalibrationDevice", "calibrationDevice"],
  ["CalibrationRecord", "calibrationRecord"],
  ["Role", "role"],
  ["Stock", "stock"],
  ["Tenant", "tenant"],
  ["User", "user"],
  ["Warehouse", "warehouse"],
];

/**
 * Build a model against a real Sequelize instance that never opens a socket,
 * backed by a one-row in-memory table.
 */
const buildHarness = (fileName) => {
  const sequelize = new Sequelize("callibrator_test", "app", "secret", {
    dialect: "postgres",
    logging: false,
  });

  const defineModel = require(`../../models/${fileName}.model`);
  const Model = defineModel(sequelize, DataTypes);

  // The stored row, in PHYSICAL column spelling — this is the database. Every
  // one of these models is `paranoid: true` while `softDelete()` only flips
  // `isDeleted`, so a soft-deleted row really does carry a null `deleted_at`.
  const row = { id: "row-1", is_deleted: true, deleted_at: null };

  const rowMatches = (where) => matchesWhere(row, where);

  jest
    .spyOn(sequelize.getQueryInterface(), "bulkUpdate")
    .mockImplementation(async (_table, values, where) => {
      if (!rowMatches(where)) {
        return 0;
      }
      Object.assign(row, values);
      return 1;
    });

  /**
   * Read the row back the way every ordinary query reads it: through the
   * model's declared defaultScope predicate. A row still carrying
   * `is_deleted: true` is invisible and this returns null.
   */
  const readUnderDefaultScope = () => {
    const scoped = Model.options.defaultScope.where;
    return rowMatches(scoped) ? row : null;
  };

  return { Model, row, readUnderDefaultScope };
};

describe("restoreStatic (D-07)", () => {
  describe.each(MODELS)("%s", (modelName, fileName) => {
    it("declares the soft-delete flag as the camelCase attribute isDeleted", () => {
      const { Model } = buildHarness(fileName);

      // The premise of the defect. If this ever flips to snake_case the
      // remaining assertions would pass for the wrong reason.
      expect(Model.rawAttributes.isDeleted).toBeDefined();
      expect(Model.rawAttributes.is_deleted).toBeUndefined();
      expect(Model.rawAttributes.isDeleted.field).toBe("is_deleted");
    });

    it("writes is_deleted = false to the stored row", async () => {
      const { Model, row } = buildHarness(fileName);
      expect(row.is_deleted).toBe(true);

      await Model.restoreStatic("row-1");

      // The persisted value, in the column the database really has. Against the
      // pre-fix code no statement was issued at all and this stayed true.
      expect(row.is_deleted).toBe(false);
    });

    it("makes the restored row visible under the default scope again", async () => {
      const { Model, readUnderDefaultScope } = buildHarness(fileName);
      expect(readUnderDefaultScope()).toBeNull();

      await Model.restoreStatic("row-1");

      expect(readUnderDefaultScope()).not.toBeNull();
    });

    it("reports one affected row rather than a success-shaped zero", async () => {
      const { Model } = buildHarness(fileName);

      const result = await Model.restoreStatic("row-1");

      // Pre-fix this was `[0]` — the shape of success with none of it.
      expect(result[0]).toBe(1);
    });

    it("leaves a row that is not soft-deleted alone", async () => {
      const { Model, row } = buildHarness(fileName);
      row.is_deleted = false;
      const touchedBefore = row.updated_at;

      const result = await Model.restoreStatic("row-1");

      expect(result[0]).toBe(0);
      expect(row.updated_at).toBe(touchedBefore);
    });

    it("does not restore a different row's id", async () => {
      const { Model, row } = buildHarness(fileName);

      const result = await Model.restoreStatic("some-other-row");

      expect(result[0]).toBe(0);
      expect(row.is_deleted).toBe(true);
    });
  });
});
