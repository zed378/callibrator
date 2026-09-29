/**
 * P9-11 contract pin — `validators/audit.validator.js`.
 *
 * This file exports NO schema ("Audit endpoints are read-only and do not
 * require payload validation") and nothing in `backend/src` imports it, so
 * there is no audit 400 to pin through `validate(schema)`. What it does
 * export is the two helpers every other validator file copies; they are
 * pinned here against a local schema so a Zod rewrite of the shared helper
 * shape is held to the same output. Deleting this file is its own change, not
 * part of a conversion (ADR-038 rule 3). See ./harness.ts.
 */
import Joi from "joi";
import { formatErrors, validate as validateHelper } from "../../../validators/audit.validator";
import { captureHelper, joiResultDetails } from "./harness";

const localSchema = Joi.object({
  action: Joi.string().required(),
  limit: Joi.number().integer(),
});

describe("P9-11 contract: validators/audit.validator.js", () => {
  it("exports no schema", () => {
    const exported = Object.keys(jest.requireActual<Record<string, unknown>>("../../../validators/audit.validator"));
    expect(exported.sort()).toEqual(["formatErrors", "validate"]);
  });

  it("validate(data, schema) returns Joi's result with every error (abortEarly false) and a bodyless {}", () => {
    expect(joiResultDetails(captureHelper(() => validateHelper(undefined, localSchema)))).toEqual([
      { field: "action", message: '"action" is required' },
    ]);
    expect(joiResultDetails(captureHelper(() => validateHelper({ limit: "x", extra: 1 }, localSchema)))).toEqual([
      { field: "action", message: '"action" is required' },
      { field: "limit", message: '"limit" must be a number' },
    ]);
  });

  it("formatErrors joins the path with dots", () => {
    expect(
      formatErrors([
        { path: ["a", 0, "b"], message: "m1" },
        { path: [], message: "m2" },
      ]),
    ).toEqual([
      { field: "a.0.b", message: "m1" },
      { field: "", message: "m2" },
    ]);
  });
});
