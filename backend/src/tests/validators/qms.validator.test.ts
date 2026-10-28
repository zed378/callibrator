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
import type { z } from "zod";
import { DataTypes, Sequelize } from "sequelize";
import {
  createNCSchema,
  updateNCSchema,
  createCapaSchema,
  updateCapaSchema,
} from "../../validators/qms.validator";
import { checkInput } from "../../validators/input";
import type defineNonConformanceModel from "../../models/nonConformance.model";
import type defineCapaModel from "../../models/capa.model";

const sequelize = new Sequelize({ dialect: "postgres", logging: false });
// eslint-disable-next-line @typescript-eslint/no-require-imports -- model factories are CommonJS (export =)
const defineNonConformance = require("../../models/nonConformance.model") as typeof defineNonConformanceModel;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- model factories are CommonJS (export =)
const defineCapa = require("../../models/capa.model") as typeof defineCapaModel;
const NonConformance = defineNonConformance(sequelize, DataTypes);
const Capa = defineCapa(sequelize, DataTypes);

interface EnumAttribute {
    readonly values?: readonly string[];
}

interface EnumModel {
    getAttributes(): Record<string, EnumAttribute>;
}

const enumOf = (model: EnumModel, attribute: string): string[] => [...(model.getAttributes()[attribute]?.values ?? [])];

/**
 * Every value a schema's enum rule on `key` accepts (optional/nullable unwrapped).
 */
const allowed = (schema: z.ZodType, key: string): string[] => {
  let field = (schema as unknown as { shape: Record<string, { unwrap?: () => unknown; options?: string[] }> }).shape[
    key
  ] as { unwrap?: () => unknown; options?: string[] };
  while (typeof field.unwrap === "function") {
    field = field.unwrap() as { unwrap?: () => unknown; options?: string[] };
  }
  return [...(field.options ?? [])];
};

const UUID = "11111111-1111-4111-8111-111111111111";
const NOTHING_TO_UPDATE = [{ field: "", message: "Provide at least one field to update" }];

describe("A-74 — QMS validators follow the model ENUMs", () => {
  it.each([
    ["createNCSchema.severity", createNCSchema, "severity", NonConformance, "severity"],
    ["updateNCSchema.severity", updateNCSchema, "severity", NonConformance, "severity"],
    ["updateNCSchema.status", updateNCSchema, "status", NonConformance, "status"],
    ["updateCapaSchema.status", updateCapaSchema, "status", Capa, "status"],
  ])(
    "%s accepts exactly the column's ENUM",
    (_name: string, schema: z.ZodType, key: string, model: EnumModel, attribute: string) => {
      expect(allowed(schema, key)).toEqual(enumOf(model, attribute));
    },
  );
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
    if (full.ok) {
      expect(full.value.dateIdentified).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    }
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
    [
      "a missing description",
      { title: "t" },
      "description",
      "Invalid input: expected string, received undefined",
    ],
    ["a non-uuid deviceId", { title: "t", description: "d", deviceId: "dev-1" }, "deviceId", "Invalid GUID"],
    [
      "a non-date dateIdentified",
      { title: "t", description: "d", dateIdentified: "yesterday" },
      "dateIdentified",
      "Invalid input",
    ],
  ])("rejects %s", (_name: string, body: Record<string, unknown>, field: string, message: string) => {
    const result = checkInput(body, createNCSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([{ field, message }]);
    }
  });

  it("does not accept a tenantId — it is stripped, never trusted", () => {
    const result = checkInput({ title: "t", description: "d", tenantId: UUID }, createNCSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("tenantId");
    }
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
    if (full.ok) {
      expect(full.value.dueDate).toEqual(new Date("2026-10-01T00:00:00.000Z"));
    }
  });

  it.each([
    ["a missing ncId", { title: "t", actionPlan: "p" }, "ncId", "Invalid input: expected string, received undefined"],
    ["a non-uuid ncId", { ncId: "nc-1", title: "t", actionPlan: "p" }, "ncId", "Invalid GUID"],
    ["a missing title", { ncId: UUID, actionPlan: "p" }, "title", "Invalid input: expected string, received undefined"],
    [
      "a missing actionPlan",
      { ncId: UUID, title: "t" },
      "actionPlan",
      "Invalid input: expected string, received undefined",
    ],
    ["a non-uuid assignedTo", { ncId: UUID, title: "t", actionPlan: "p", assignedTo: "u-1" }, "assignedTo", "Invalid GUID"],
  ])("rejects %s", (_name: string, body: Record<string, unknown>, field: string, message: string) => {
    const result = checkInput(body, createCapaSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([{ field, message }]);
    }
  });

  it("strips a status — a CAPA is always created as DRAFT", () => {
    const result = checkInput({ ncId: UUID, title: "t", actionPlan: "p", status: "CLOSED" }, createCapaSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("status");
    }
  });
});

describe("updateNCSchema", () => {
  it("accepts a one-field update, an empty description included", () => {
    const status = checkInput({ status: "OPEN" }, updateNCSchema);
    expect(status.ok).toBe(true);
    if (status.ok) {
      expect(status.value).toEqual({ status: "OPEN" });
    }
    const description = checkInput({ description: "" }, updateNCSchema);
    expect(description.ok).toBe(true);
    if (description.ok) {
      expect(description.value).toEqual({ description: "" });
    }
  });

  it("refuses an empty body", () => {
    const result = checkInput({}, updateNCSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(NOTHING_TO_UPDATE);
    }
  });

  it("refuses a body of only unknown keys (they are stripped first)", () => {
    const result = checkInput({ foo: 1 }, updateNCSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(NOTHING_TO_UPDATE);
    }
  });

  it("refuses an empty title", () => {
    const result = checkInput({ title: "" }, updateNCSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { field: "title", message: "Too small: expected string to have >=1 characters" },
      ]);
    }
  });
});

describe("updateCapaSchema", () => {
  it("accepts dates as text or milliseconds, and nulls", () => {
    const result = checkInput(
      { dueDate: "2026-10-01", completedDate: 1700000000000, approvedBy: null, verificationNotes: "" },
      updateCapaSchema,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.dueDate).toEqual(new Date("2026-10-01T00:00:00.000Z"));
      expect(result.value.completedDate).toEqual(new Date(1700000000000));
    }
  });

  it("refuses an empty body", () => {
    const result = checkInput({}, updateCapaSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(NOTHING_TO_UPDATE);
    }
  });

  it("refuses an empty actionPlan", () => {
    const result = checkInput({ actionPlan: "" }, updateCapaSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { field: "actionPlan", message: "Too small: expected string to have >=1 characters" },
      ]);
    }
  });

  it("refuses a non-date dueDate", () => {
    const result = checkInput({ dueDate: "garbage" }, updateCapaSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { field: "dueDate", message: "Invalid input: expected date, received string" },
      ]);
    }
  });
});
