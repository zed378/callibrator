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
import type * as SequelizeModule from "sequelize";
import type { Sequelize } from "sequelize";
import { DataTypes } from "sequelize";

jest.mock("../../config", () => {
  const { Sequelize: MockedSequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new MockedSequelize({ dialect: "postgres", logging: false });
  db.query = (() => Promise.resolve([])) as unknown as typeof db.query;
  return { db };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real models barrel, read for its attribute definitions (house pattern: stateUnions.p905 guard)
const models = require("../../models") as unknown as Record<
  string,
  { build: (values: object) => { id: string }; getAttributes: () => Record<string, { defaultValue?: unknown }> }
>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real uuid package, unmocked: the assertion IS that no mock answers (uuid is ESM-only, so no static import under CommonJS)
const { v4 } = require("uuid") as { v4: () => string };

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V1 = /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("A-116 — UUID defaults are generated, not a mocked constant", () => {
  it("two CalibrationDevice.build() rows get different, valid v4 ids", () => {
    const device = models["CalibrationDevice"];
    if (device === undefined) {
      throw new Error("no model CalibrationDevice");
    }
    const a = device.build({});
    const b = device.build({});

    expect(a.id).toMatch(V4);
    expect(b.id).toMatch(V4);
    expect(a.id).not.toBe(b.id);
  });

  it("every model whose primary key defaults to UUIDV4 builds distinct ids", () => {
    const withV4 = Object.values(models).filter(
      (m) => typeof m.getAttributes === "function" && m.getAttributes()["id"]?.defaultValue instanceof DataTypes.UUIDV4,
    );
    // Guard against the filter silently matching nothing.
    expect(withV4.length).toBeGreaterThan(10);

    const repeated = withV4
      .map((m) => ({ ids: [m.build({}).id, m.build({}).id] }))
      .filter(({ ids }) => ids[0] === ids[1] || !V4.test(ids[0] ?? ""));
    expect(repeated).toEqual([]);
  });

  it("a UUIDV1 default generates a valid v1 id instead of throwing", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the mocked config above: the unconnected Sequelize this probe is defined on
    const { db } = require("../../config") as unknown as { db: Sequelize };
    const Probe = db.define("A116Probe", {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV1, primaryKey: true },
    });

    const a = Probe.build({ id: undefined }) as unknown as { id: string };
    const b = Probe.build({ id: undefined }) as unknown as { id: string };

    expect(a.id).toMatch(V1);
    expect(a.id).not.toBe(b.id);
  });

  it("application code gets the real uuid too", () => {
    const a = v4();
    expect(a).toMatch(V4);
    expect(v4()).not.toBe(a);
  });
});
