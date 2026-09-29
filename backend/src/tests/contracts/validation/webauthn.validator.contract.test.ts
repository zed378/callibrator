/**
 * P9-11 contract pin — `validators/webauthn.validator.js`.
 *
 * This file exports no schema, only a `validate(data, schema)` helper, and
 * nothing in `backend/src` imports it. Its throw shape is the third of the
 * helper shapes in validators/ (an object keyed by the FIRST path segment),
 * pinned here against a local schema. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import Joi from "joi";
import { validate as validateHelper } from "../../../validators/webauthn.validator";
import { captureHelper } from "./harness";

const localSchema = Joi.object({
  credential: Joi.object({ id: Joi.string().required() }).required(),
  name: Joi.string().max(3),
});

describe("P9-11 contract: validators/webauthn.validator.js", () => {
  it("exports no schema", () => {
    const exported = Object.keys(jest.requireActual<Record<string, unknown>>("../../../validators/webauthn.validator"));
    expect(exported).toEqual(["validate"]);
  });

  it("throws { status, message, errors } with errors keyed by the first path segment", () => {
    expect(captureHelper(() => validateHelper({ credential: {}, name: "long" }, localSchema))).toEqual({
      kind: "thrownValue",
      value: {
        status: 400,
        message: "Validation failed",
        errors: {
          credential: '"credential.id" is required',
          name: '"name" length must be less than or equal to 3 characters long',
        },
      },
    });
  });

  it("returns the stripped value when valid", () => {
    expect(captureHelper(() => validateHelper({ credential: { id: "c" }, extra: 1 }, localSchema))).toEqual({
      kind: "returned",
      value: { credential: { id: "c" } },
    });
  });
});
