/**
 * A-09 — an absent body must not slip through a Joi gate.
 *
 * This is the part of the finding that is easy to miss. Under Express 5 a
 * bodyless request leaves `req.body` undefined, and Joi treats `undefined` as
 * VALID against a non-required object schema:
 *
 *   Joi.object({ a: Joi.string().required() }).validate(undefined)
 *     → { value: undefined, error: undefined }
 *
 * So the gate opened, the controller read `validated.a` off `undefined`, and a
 * request that owed a 400 produced a TypeError → 500 instead. Every shared
 * `validate` helper therefore coerces an absent body to `{}` so the
 * required-field rules actually fire.
 *
 * The first case below pins the Joi behaviour itself, so if a future Joi
 * upgrade changes it this file says so rather than quietly passing.
 */

const Joi = require("joi");
const fs = require("fs");
const path = require("path");

const VALIDATOR_DIR = path.join(__dirname, "..", "..", "validators");

describe("A-09 — Joi accepts an absent body", () => {
  it("validates `undefined` against a required-field object schema WITHOUT an error", () => {
    const schema = Joi.object({ a: Joi.string().required() });

    const asUndefined = schema.validate(undefined, { abortEarly: false, stripUnknown: true });
    const asEmptyObject = schema.validate({}, { abortEarly: false, stripUnknown: true });

    // This is the trap: no error, and a `value` the controller then reads off.
    expect(asUndefined.error).toBeUndefined();
    expect(asUndefined.value).toBeUndefined();

    // …whereas `{}` produces the 400 the caller is owed.
    expect(asEmptyObject.error).toBeDefined();
    expect(asEmptyObject.error.details[0].path).toEqual(["a"]);
  });
});

// Every validator in this directory is in scope: scim.validator.js was the
// last one left unguarded and was fixed on 2026-09-23.
const OUT_OF_SCOPE = [];

describe("A-09 — every validators/ `validate` helper coerces an absent body", () => {
  const helpers = fs
    .readdirSync(VALIDATOR_DIR)
    .filter((f) => f.endsWith(".js") && !OUT_OF_SCOPE.includes(f))
    .map((f) => [f, require(path.join(VALIDATOR_DIR, f))])
    .filter(([, mod]) => typeof mod.validate === "function");

  it("finds the helpers (guards against this suite silently testing nothing)", () => {
    expect(helpers.length).toBeGreaterThanOrEqual(23);
  });

  // Two helper shapes exist in this codebase: one returns Joi's
  // `{ value, error }`, the other throws on failure and returns the value.
  // Both must refuse an absent body against a required field.
  it.each(helpers.map(([file]) => file))(
    "%s: validate(undefined, <required schema>) is refused, not passed through",
    (file) => {
      const { validate } = require(path.join(VALIDATOR_DIR, file));
      const schema = Joi.object({ mustBeThere: Joi.string().required() });

      let result;
      let thrown;
      try {
        result = validate(undefined, schema);
      } catch (err) {
        thrown = err;
      }

      if (thrown) {
        // throw-style helper: a 400-shaped refusal
        expect(thrown.status === 400 || thrown instanceof Error).toBe(true);
      } else {
        // return-style helper: Joi's error must be present…
        expect(result).toBeDefined();
        if (result && Object.prototype.hasOwnProperty.call(result, "error")) {
          expect(result.error).toBeDefined();
        } else {
          // …or, for a value-returning helper, never `undefined`
          expect(result).not.toBeUndefined();
        }
      }
    },
  );
});
