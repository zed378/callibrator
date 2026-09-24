/**
 * D-21 — DECIMAL columns read back as numbers, not strings.
 *
 * node-postgres returns NUMERIC as a string ("1250.00") by design, and
 * Sequelize passes it through. `amountDue + amountPaid` then concatenates and
 * `"90.00" > "1000.00"` is true. Every DECIMAL attribute now has a getter
 * that returns a number (NULL stays NULL).
 *
 * `Model.build(values, { raw: true, isNewRecord: false })` is how Sequelize
 * materialises a row it read (the pg driver's strings go in untouched), so
 * this exercises the same path as a SELECT. The live PostgreSQL proof is in
 * tests/services/dataLayer.dbB.live.test.js.
 *
 * The list of DECIMAL attributes is DISCOVERED from the models, so a fifth
 * DECIMAL column without a getter fails here.
 */

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { db: new Sequelize({ dialect: "postgres", logging: false }) };
});

const models = require("../../models");

const allModels = [...new Set(Object.values(models.sequelize.models))];
const decimals = allModels.flatMap((model) =>
  Object.entries(model.rawAttributes)
    .filter(([, attribute]) => attribute.type && attribute.type.key === "DECIMAL")
    .map(([name]) => [model.name, name, model]),
);

describe("D-21 — every DECIMAL attribute reads as a number", () => {
  it("found the four reviewed DECIMAL columns (a discovery that finds none tests nothing)", () => {
    expect(decimals.map(([m, a]) => `${m}.${a}`).sort()).toEqual([
      "AssetFinance.purchasePrice",
      "AssetFinance.salvageValue",
      "Invoice.amountDue",
      "Invoice.amountPaid",
    ]);
  });

  it.each(decimals)("%s.%s: a row read back as '1250.50' is the number 1250.5", (_m, attribute, model) => {
    const row = model.build({ [attribute]: "1250.50" }, { raw: true, isNewRecord: false });
    expect(typeof row[attribute]).toBe("number");
    expect(row[attribute]).toBe(1250.5);
    expect(typeof row.get(attribute)).toBe("number");
    expect(typeof row.toJSON()[attribute]).toBe("number");
  });

  it.each(decimals)("%s.%s: NULL stays NULL (not 0)", (_m, attribute, model) => {
    const row = model.build({ [attribute]: null }, { raw: true, isNewRecord: false });
    expect(row[attribute]).toBeNull();
  });

  it("arithmetic and comparison are numeric, not string", () => {
    const invoice = models.Invoice.build(
      { amountDue: "90.00", amountPaid: "1000.00" },
      { raw: true, isNewRecord: false },
    );
    expect(invoice.amountDue + invoice.amountPaid).toBe(1090);
    expect(invoice.amountDue > invoice.amountPaid).toBe(false);
  });
});
