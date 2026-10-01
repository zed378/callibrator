/**
 * A-74 — the QMS validators, against the models' own ENUMs.
 *
 * The value sets are read from the REAL models on an unconnected
 * PostgreSQL-dialect Sequelize — the column definitions, not the validator's
 * constants — so a value added to one and not the other fails here.
 *
 * P9-11 (ADR-093): the schemas are Zod; they are exercised through the shared
 * checkInput (validators/input), which always strips unknown keys.
 */
const { Sequelize, DataTypes } = require("sequelize");
const {
  createNCSchema,
  updateNCSchema,
  createCapaSchema,
  updateCapaSchema,
} = require("../../validators/qms.validator");
const { checkInput } = require("../../validators/input");

const sequelize = new Sequelize({ dialect: "postgres", logging: false });
const NonConformance = require("../../models/nonConformance.model")(sequelize, DataTypes);
const Capa = require("../../models/capa.model")(sequelize, DataTypes);

const enumOf = (model, attribute) => [...model.getAttributes()[attribute].values];

/**
 * Every value a schema's enum rule on `key` accepts (optional/nullable unwrapped).
 *
 * @param {import("zod").ZodObject} schema - an object schema
 * @param {string} key - the field
 * @returns {string[]} the enum's options
 */
const allowed = (schema, key) => {
  let field = schema.shape[key];
  while (typeof field.unwrap === "function") {
    field = field.unwrap();
  }
  return [...field.options];
};

const UUID = "11111111-1111-4111-8111-111111111111";
const NOTHING_TO_UPDATE = [{ field: "", message: "Provide at least one field to update" }];

describe("A-74 — QMS validators follow the model ENUMs", () => {
  it.each([
    ["createNCSchema.severity", createNCSchema, "severity", NonConformance, "severity"],
    ["updateNCSchema.severity", updateNCSchema, "severity", NonConformance, "severity"],
    ["updateNCSchema.status", updateNCSchema, "status", NonConformance, "status"],
    ["updateCapaSchema.status", updateCapaSchema, "status", Capa, "status"],
  ])("%s accepts exactly the column's ENUM", (name, schema, key, model, attribute) => {
    expect(allowed(schema, key)).toEqual(enumOf(model, attribute));
  });
});

describe("A-74 — createNCSchema", () => {
  it("accepts a minimal and a full body", () => {
    expect(checkInput({ title: "t", description: "d" }, createNCSchema).ok).toBe(true);
    const full = checkInput(
      {
        title: "t",
        description: "d",
        severity: "CRITICAL",
        deviceId: UUID,
        dateIdentified: "2026-09-01",
        rootCause: "",
      },
      createNCSchema,
    );
    expect(full.ok).toBe(true);
    expect(full.value.dateIdentified).toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });

  it("accepts null deviceId and rootCause", () => {
    expect(checkInput({ title: "t", description: "d", deviceId: null, rootCause: null }, createNCSchema).ok).toBe(true);
  });

  it.each([
    [
      "an out-of-enum severity",
      { title: "t", description: "d", severity: "APOCALYPTIC" },
      "severity",
      'Invalid option: expected one of "LOW"|"MEDIUM"|"HIGH"|"CRITICAL"',
    ],
    ["a missing title", { description: "d" }, "title", "Invalid input: expected string, received undefined"],
    ["a blank title", { title: "  ", description: "d" }, "title", "Too small: expected string to have >=1 characters"],
    ["a missing description", { title: "t" }, "description", "Invalid input: expected string, received undefined"],
    ["a non-uuid deviceId", { title: "t", description: "d", deviceId: "dev-1" }, "deviceId", "Invalid GUID"],
    ["a non-date dateIdentified", { title: "t", description: "d", dateIdentified: "yesterday" }, "dateIdentified", "Invalid input"],
  ])("rejects %s", (name, body, field, message) => {
    expect(checkInput(body, createNCSchema).errors).toEqual([{ field, message }]);
  });

  it("does not accept a tenantId — it is stripped, never trusted", () => {
    const result = checkInput({ title: "t", description: "d", tenantId: UUID }, createNCSchema);
    expect(result.ok).toBe(true);
    expect(result.value).not.toHaveProperty("tenantId");
  });
});

describe("A-74 — createCapaSchema", () => {
  it("accepts a minimal and a full body", () => {
    expect(checkInput({ ncId: UUID, title: "t", actionPlan: "p" }, createCapaSchema).ok).toBe(true);
    const full = checkInput(
      { ncId: UUID, title: "t", actionPlan: "p", assignedTo: null, dueDate: "2026-10-01" },
      createCapaSchema,
    );
    expect(full.ok).toBe(true);
    expect(full.value.dueDate).toEqual(new Date("2026-10-01T00:00:00.000Z"));
  });

  it.each([
    ["a missing ncId", { title: "t", actionPlan: "p" }, "ncId", "Invalid input: expected string, received undefined"],
    ["a non-uuid ncId", { ncId: "nc-1", title: "t", actionPlan: "p" }, "ncId", "Invalid GUID"],
    ["a missing title", { ncId: UUID, actionPlan: "p" }, "title", "Invalid input: expected string, received undefined"],
    ["a missing actionPlan", { ncId: UUID, title: "t" }, "actionPlan", "Invalid input: expected string, received undefined"],
    ["a non-uuid assignedTo", { ncId: UUID, title: "t", actionPlan: "p", assignedTo: "u-1" }, "assignedTo", "Invalid GUID"],
  ])("rejects %s", (name, body, field, message) => {
    expect(checkInput(body, createCapaSchema).errors).toEqual([{ field, message }]);
  });

  it("strips a status — a CAPA is always created as DRAFT", () => {
    const result = checkInput({ ncId: UUID, title: "t", actionPlan: "p", status: "CLOSED" }, createCapaSchema);
    expect(result.ok).toBe(true);
    expect(result.value).not.toHaveProperty("status");
  });
});

describe("updateNCSchema", () => {
  it("accepts a one-field update, an empty description included", () => {
    expect(checkInput({ status: "OPEN" }, updateNCSchema).value).toEqual({ status: "OPEN" });
    expect(checkInput({ description: "" }, updateNCSchema).value).toEqual({ description: "" });
  });

  it("refuses an empty body", () => {
    expect(checkInput({}, updateNCSchema).errors).toEqual(NOTHING_TO_UPDATE);
  });

  it("refuses a body of only unknown keys (they are stripped first)", () => {
    expect(checkInput({ foo: 1 }, updateNCSchema).errors).toEqual(NOTHING_TO_UPDATE);
  });

  it("refuses an empty title", () => {
    expect(checkInput({ title: "" }, updateNCSchema).errors).toEqual([
      { field: "title", message: "Too small: expected string to have >=1 characters" },
    ]);
  });
});

describe("updateCapaSchema", () => {
  it("accepts dates as text or milliseconds, and nulls", () => {
    const result = checkInput(
      { dueDate: "2026-10-01", completedDate: 1700000000000, approvedBy: null, verificationNotes: "" },
      updateCapaSchema,
    );
    expect(result.ok).toBe(true);
    expect(result.value.dueDate).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    expect(result.value.completedDate).toEqual(new Date(1700000000000));
  });

  it("refuses an empty body", () => {
    expect(checkInput({}, updateCapaSchema).errors).toEqual(NOTHING_TO_UPDATE);
  });

  it("refuses an empty actionPlan", () => {
    expect(checkInput({ actionPlan: "" }, updateCapaSchema).errors).toEqual([
      { field: "actionPlan", message: "Too small: expected string to have >=1 characters" },
    ]);
  });

  it("refuses a non-date dueDate", () => {
    expect(checkInput({ dueDate: "garbage" }, updateCapaSchema).errors).toEqual([
      { field: "dueDate", message: "Invalid input: expected date, received string" },
    ]);
  });
});
