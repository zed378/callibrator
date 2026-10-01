/**
 * A-09 — an absent body must not slip through a validation gate.
 *
 * Under Express 5 a bodyless request leaves `req.body` undefined. The old validator treated
 * `undefined` as VALID against a non-required object schema, so the gate
 * opened, the controller read `validated.a` off `undefined`, and a request
 * that owed a 400 produced a TypeError → 500 instead. Zod refuses `undefined`
 * against an object schema, but the rule stays explicit: every way to check
 * input checks an absent body as `{}`, so the required-field rules fire and
 * the caller gets the field-level 400.
 *
 * P9-11 (ADR-093): the per-file `validate` helpers are gone. There are three
 * ways to check input — the `validate(schema)` middleware and
 * `validators/input`'s `checkInput` / `validateInput` — and this file holds
 * all three, plus the rule that no validator file brings back a helper of its
 * own.
 */

const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const { checkInput, validateInput } = require("../../validators/input");
const { validate } = require("../../middlewares/validation.middleware");

const VALIDATOR_DIR = path.join(__dirname, "..", "..", "validators");
const schema = z.object({ mustBeThere: z.string() });
const REQUIRED = [{ field: "mustBeThere", message: "Invalid input: expected string, received undefined" }];

describe("A-09 — an absent body is checked as {}", () => {
  it("checkInput(undefined) and checkInput(null) report the required field", () => {
    expect(checkInput(undefined, schema)).toEqual({ ok: false, errors: REQUIRED });
    expect(checkInput(null, schema)).toEqual({ ok: false, errors: REQUIRED });
  });

  it("validateInput(undefined) throws the 400, never returns undefined", () => {
    let thrown;
    try {
      validateInput(undefined, schema);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toEqual({ status: 400, message: "Validation failed", errors: REQUIRED });
  });

  it("validate(schema) answers 400 for a request with no body", () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    validate(schema)({ body: undefined }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("A-09 / P9-11 — no validator file brings back a helper of its own", () => {
  const modules = fs
    .readdirSync(VALIDATOR_DIR)
    .filter((f) => /\.validator\.(js|ts)$/.test(f))
    .map((f) => [f, require(path.join(VALIDATOR_DIR, f))]);

  it("finds the validator modules (guards against this suite silently testing nothing)", () => {
    expect(modules.length).toBeGreaterThanOrEqual(35);
  });

  it.each(modules.map(([file]) => file))("%s exports no validate / formatErrors helper", (file) => {
    const mod = require(path.join(VALIDATOR_DIR, file));
    expect({ file, validate: typeof mod.validate, formatErrors: typeof mod.formatErrors }).toEqual({
      file,
      validate: "undefined",
      formatErrors: "undefined",
    });
  });
});
