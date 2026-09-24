/**
 * A-74 — the QMS validators, against the models' own ENUMs.
 *
 * The value sets are read from the REAL models on an unconnected
 * PostgreSQL-dialect Sequelize — the column definitions, not the validator's
 * constants — so a value added to one and not the other fails here.
 */
const { Sequelize, DataTypes } = require("sequelize");
const {
  createNCSchema,
  updateNCSchema,
  createCapaSchema,
  updateCapaSchema,
} = require("../../validators/qms.validator");

const sequelize = new Sequelize({ dialect: "postgres", logging: false });
const NonConformance = require("../../models/nonConformance.model")(sequelize, DataTypes);
const Capa = require("../../models/capa.model")(sequelize, DataTypes);

const enumOf = (model, attribute) => [...model.getAttributes()[attribute].values];

/** Every value a schema's `valid()` rule on `key` accepts. */
const allowed = (schema, key) => [...schema.extract(key).describe().allow];

const UUID = "11111111-1111-4111-8111-111111111111";

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
    expect(createNCSchema.validate({ title: "t", description: "d" }).error).toBeUndefined();
    const full = createNCSchema.validate({
      title: "t",
      description: "d",
      severity: "CRITICAL",
      deviceId: UUID,
      dateIdentified: "2026-09-01",
      rootCause: "",
    });
    expect(full.error).toBeUndefined();
  });

  it.each([
    ["an out-of-enum severity", { title: "t", description: "d", severity: "APOCALYPTIC" }],
    ["a missing title", { description: "d" }],
    ["a blank title", { title: "  ", description: "d" }],
    ["a missing description", { title: "t" }],
    ["a non-uuid deviceId", { title: "t", description: "d", deviceId: "dev-1" }],
    ["a non-date dateIdentified", { title: "t", description: "d", dateIdentified: "yesterday" }],
  ])("rejects %s", (name, body) => {
    expect(createNCSchema.validate(body).error).toBeDefined();
  });

  it("does not accept a tenantId — it is stripped, never trusted", () => {
    const { value, error } = createNCSchema.validate(
      { title: "t", description: "d", tenantId: UUID },
      { stripUnknown: true },
    );
    expect(error).toBeUndefined();
    expect(value).not.toHaveProperty("tenantId");
  });
});

describe("A-74 — createCapaSchema", () => {
  it("accepts a minimal and a full body", () => {
    expect(createCapaSchema.validate({ ncId: UUID, title: "t", actionPlan: "p" }).error).toBeUndefined();
    expect(
      createCapaSchema.validate({ ncId: UUID, title: "t", actionPlan: "p", assignedTo: null, dueDate: "2026-10-01" })
        .error,
    ).toBeUndefined();
  });

  it.each([
    ["a missing ncId", { title: "t", actionPlan: "p" }],
    ["a non-uuid ncId", { ncId: "nc-1", title: "t", actionPlan: "p" }],
    ["a missing title", { ncId: UUID, actionPlan: "p" }],
    ["a missing actionPlan", { ncId: UUID, title: "t" }],
    ["a non-uuid assignedTo", { ncId: UUID, title: "t", actionPlan: "p", assignedTo: "u-1" }],
  ])("rejects %s", (name, body) => {
    expect(createCapaSchema.validate(body).error).toBeDefined();
  });

  it("strips a status — a CAPA is always created as DRAFT", () => {
    const { value } = createCapaSchema.validate(
      { ncId: UUID, title: "t", actionPlan: "p", status: "CLOSED" },
      { stripUnknown: true },
    );
    expect(value).not.toHaveProperty("status");
  });
});
