/**
 * A-331 (ADR-100 Amendment 4) — defence in depth: a row that reaches
 * `res.json` unfiltered can never serialise a credential. Each model listed in
 * models/secretAttributes.ts drops its credential attributes in `toJSON()`
 * (what JSON.stringify and Express call), through the REAL models barrel;
 * the instance still reads them (sign-in and verification need them).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ModelsBarrel from "../../models";
import type * as Secrets from "../../models/secretAttributes";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const models = jest.requireActual<typeof ModelsBarrel>("../../models") as unknown as Record<string, { build: (v: object) => { get: (k: string) => unknown; toJSON: () => Record<string, unknown> } }>;
const { SECRET_ATTRIBUTES, installSecretRedaction } = jest.requireActual<typeof Secrets>("../../models/secretAttributes");

beforeEach(() => {
  mdb.reset();
});

/** One value per listed attribute, so every one is present before serialisation. */
const withAll = (attributes: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(attributes.map((a) => [a, a === "mfaRecoveryCodes" ? ["x"] : a.endsWith("Count") || a === "mfaLastUsedStep" ? 1 : a.endsWith("At") ? new Date() : `v-${a}`]));

describe.each(Object.entries(SECRET_ATTRIBUTES))("%s", (name, attributes) => {
  it("toJSON() and JSON.stringify drop every listed attribute; the instance still has them", () => {
    const model = models[name];
    if (!model) {
      throw new Error(`no model ${name}`);
    }
    const row = model.build({ id: "a3310000-0000-4000-8000-0000000000aa", ...withAll(attributes) });
    const json = row.toJSON();
    const text = JSON.stringify(row);
    for (const attribute of attributes) {
      expect(json).not.toHaveProperty(attribute);
      expect(text).not.toContain(`"${attribute}"`);
    }
    // Only a column the model defines can be read back.
    const readable = attributes.filter((a) => row.get(a) !== undefined);
    expect(readable.length).toBeGreaterThan(0);
    expect(json).toHaveProperty("id");
  });
});

it("an unknown model name fails loudly (a stale list cannot pass silently)", () => {
  expect(() => installSecretRedaction({})).toThrow(/no model named/);
});

it("a toJSON that yields a non-object is passed through", () => {
  const Fake = function Fake(): void {
    // a model-shaped constructor
  } as unknown as { prototype: { toJSON: () => unknown } };
  Fake.prototype.toJSON = (): unknown => null;
  const loaded = Object.fromEntries(Object.keys(SECRET_ATTRIBUTES).map((n) => [n, Fake]));
  installSecretRedaction(loaded);
  expect(Fake.prototype.toJSON()).toBeNull();
});
