/**
 * WebAuthn validator tests
 */
const Joi = require("joi");
const { validate } = require("../../validators/webauthn.validator");

describe("WebAuthn Validators", () => {
  it("should validate registration options", () => {
    expect(() =>
      validate(
        {
          challenge: "abc123",
          rp: { name: "Test RP" },
          user: { id: "user-id", name: "user@example.com", displayName: "User" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        },
        Joi.object({
          challenge: Joi.string().required(),
          rp: Joi.object({ name: Joi.string().required() }).required(),
          user: Joi.object({
            id: Joi.string().required(),
            name: Joi.string().required(),
            displayName: Joi.string().required(),
          }).required(),
          pubKeyCredParams: Joi.array().items(
            Joi.object({ type: Joi.string().required(), alg: Joi.number().required() })
          ).min(1).required(),
        }),
      ),
    ).not.toThrow();
  });

  it("should reject missing challenge", () => {
    expect(() =>
      validate(
        {
          rp: { name: "Test RP" },
          user: { id: "user-id", name: "user@example.com", displayName: "User" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        },
        Joi.object({
          challenge: Joi.string().required(),
          rp: Joi.object({ name: Joi.string().required() }).required(),
          user: Joi.object({
            id: Joi.string().required(),
            name: Joi.string().required(),
            displayName: Joi.string().required(),
          }).required(),
          pubKeyCredParams: Joi.array().items(
            Joi.object({ type: Joi.string().required(), alg: Joi.number().required() })
          ).min(1).required(),
        }),
      ),
    ).toThrow();
  });

  it("should reject missing rp name", () => {
    expect(() =>
      validate(
        {
          challenge: "abc123",
          rp: {},
          user: { id: "user-id", name: "user@example.com", displayName: "User" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        },
        Joi.object({
          challenge: Joi.string().required(),
          rp: Joi.object({ name: Joi.string().required() }).required(),
          user: Joi.object({
            id: Joi.string().required(),
            name: Joi.string().required(),
            displayName: Joi.string().required(),
          }).required(),
          pubKeyCredParams: Joi.array().items(
            Joi.object({ type: Joi.string().required(), alg: Joi.number().required() })
          ).min(1).required(),
        }),
      ),
    ).toThrow();
  });
});
