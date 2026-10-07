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
 * The list of DECIMAL attributes is DISCOVERED from the models, so a new
 * DECIMAL column without a getter fails here.
 */

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { db: new Sequelize({ dialect: "postgres", logging: false }) };
});

const models = require("../../models");

const allModels = [...new Set(Object.values(models.sequelize.models))];
const allDecimals = allModels.flatMap((model) =>
  Object.entries(model.rawAttributes)
    .filter(([, attribute]) => attribute.type && attribute.type.key === "DECIMAL")
    .map(([name]) => [model.name, name, model]),
);

/*
 * ADR-125 Amendment 2 (P20-03): the inspection catalogue's limits and ranges are
 * EXACT decimal strings, by design — the opposite of this rule, and reviewed: a
 * limit is compared on scaled integers, never on binary floats (spec P19-01
 * § 6.1, "0.1 + 0.2 problems do not exist at a limit boundary"), and the
 * canonical content hash (§ 7.6) is taken over the decimal text. A number
 * getter would round 0.7000001 and could print 1e-7. Each is held below to
 * read back as the string the database returned.
 */
const CATALOGUE_DECIMALS = [
  "settingValue",
  "limitValue",
  "limitLow",
  "limitHigh",
  "limitNominal",
  "limitTolerance",
  "validMin",
  "validMax",
  "warnMin",
  "warnMax",
];
const EXACT_DECIMAL_STRINGS = new Set(
  ["InspectionItemDefinition", "InspectionTemplateItem"].flatMap((m) => CATALOGUE_DECIMALS.map((a) => `${m}.${a}`)),
);
const decimals = allDecimals.filter(([m, a]) => !EXACT_DECIMAL_STRINGS.has(`${m}.${a}`));
const exact = allDecimals.filter(([m, a]) => EXACT_DECIMAL_STRINGS.has(`${m}.${a}`));

describe("D-21 — every DECIMAL attribute reads as a number", () => {
  it("found the six reviewed DECIMAL columns (a discovery that finds none tests nothing)", () => {
    expect(decimals.map(([m, a]) => `${m}.${a}`).sort()).toEqual([
      "AssetFinance.purchasePrice",
      "AssetFinance.salvageValue",
      "Invoice.amountDue",
      "Invoice.amountPaid",
      // Q-55 (migration 0107, 2026-10-01).
      "MaintenanceWorkOrder.actualCost",
      "MaintenanceWorkOrder.estimatedCost",
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

  it("the reviewed exact-decimal columns (ADR-125 Am. 2) are exactly the catalogue's twenty, every one found", () => {
    expect(exact.map(([m, a]) => `${m}.${a}`).sort()).toEqual([...EXACT_DECIMAL_STRINGS].sort());
  });

  it.each(exact)("%s.%s (ADR-125 Am. 2): reads back as the exact decimal string, not a float", (_m, attribute, model) => {
    const row = model.build({ [attribute]: "0.7000001" }, { raw: true, isNewRecord: false });
    expect(row[attribute]).toBe("0.7000001");
    expect(row.toJSON()[attribute]).toBe("0.7000001");
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
