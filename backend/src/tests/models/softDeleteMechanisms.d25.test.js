/**
 * D-25 (ADR-064, ADR-083) — two soft-delete mechanisms coexist: paranoid
 * `deleted_at`, and an `isDeleted` boolean behind a defaultScope.
 *
 * ADR-064 decided that `paranoid` is the mechanism for NEW models, and left the
 * models that carry both unconverted. ADR-083 records why they stay so: the
 * conversion (fold `is_deleted` into `deleted_at`) touches every service that
 * writes the flag, `search.service`'s raw SQL, the orphan report, the
 * attachment cascade and restore, and the append-only `calibration_records`
 * trigger — too wide to do while those files are being changed, and a
 * behaviour change for every `restore`. What is safe, and done here, is to
 * make the current state a checked rule instead of an observation:
 *
 *  - the models that carry `isDeleted` are exactly the reviewed list — a NEW
 *    model with the flag fails here (use `paranoid`);
 *  - on every one of them the defaultScope filters `is_deleted = false`, so a
 *    default read excludes a row deleted by EITHER mechanism (paranoid adds
 *    `deleted_at IS NULL` on top). Which flag is authoritative is therefore
 *    moot for reads: a row is live only when both say so. For writes the
 *    application's soft delete sets `isDeleted`; `deleted_at` is set only by a
 *    `destroy()`.
 *
 * `Session` carries `is_deleted` (the attribute itself is snake_case, see
 * CLAUDE.md's traps) and is not paranoid.
 */

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { db: new Sequelize({ dialect: "postgres", logging: false }) };
});

const models = require("../../models");

const allModels = [...new Set(Object.values(models.sequelize.models))];

/** The reviewed models that carry BOTH `isDeleted` and paranoid `deleted_at`. */
const DUAL = Object.freeze([
  "ApiKey",
  "Attachment",
  "CalibrationDevice",
  "CalibrationRecord",
  "Category",
  "Post",
  "Role",
  "Stock",
  "Tenant",
  "User",
  "Warehouse",
  "Webhook",
]);

/** The reviewed models that carry the flag and are NOT paranoid. */
const FLAG_ONLY = Object.freeze(["Session"]);

const flagOf = (Model) => {
  const attributes = Model.getAttributes();
  return attributes.isDeleted || attributes.is_deleted || null;
};

describe("D-25 — the soft-delete mechanism of every model is a reviewed decision", () => {
  it("the models carrying an is_deleted flag are exactly the reviewed ones; new models are paranoid", () => {
    const dual = allModels.filter((M) => flagOf(M) && M.options.paranoid).map((M) => M.name).sort();
    const flagOnly = allModels.filter((M) => flagOf(M) && !M.options.paranoid).map((M) => M.name).sort();
    expect(dual).toEqual([...DUAL]);
    expect(flagOnly).toEqual([...FLAG_ONLY]);
  });

  it("every flagged model's defaultScope excludes is_deleted rows, so a default read needs both flags to say live", () => {
    for (const name of [...DUAL, ...FLAG_ONLY]) {
      const Model = models.sequelize.models[name];
      expect({ name, field: flagOf(Model).field }).toEqual({ name, field: "is_deleted" });
      const where = (Model.options.defaultScope || {}).where || {};
      expect({ name, filters: where.is_deleted === false || where.isDeleted === false }).toEqual({
        name,
        filters: true,
      });
    }
  });

  it("the paranoid models declare deleted_at, which Sequelize adds as IS NULL to every default read", () => {
    for (const name of DUAL) {
      const Model = models.sequelize.models[name];
      expect({ name, deletedAt: Model.getAttributes().deletedAt && Model.getAttributes().deletedAt.field }).toEqual({
        name,
        deletedAt: "deleted_at",
      });
    }
  });
});
