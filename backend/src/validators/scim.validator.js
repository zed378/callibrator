const Joi = require("joi");

const scimUserSchema = Joi.object({
  userName: Joi.string().email().required(),
  name: Joi.object({
    givenName: Joi.string().optional(),
    familyName: Joi.string().optional(),
  }).optional(),
  emails: Joi.array().items(Joi.object({
    value: Joi.string().email().required(),
    type: Joi.string().optional(),
    primary: Joi.boolean().optional(),
  })).optional(),
  active: Joi.boolean().optional(),
  // roleId is accepted but constrained in the service: SCIM may never assign
  // SUPERADMIN or any system role (A-27).
  roleId: Joi.string().uuid().optional(),
});

const scimGroupSchema = Joi.object({
  // scim_groups.display_name is VARCHAR(255) (ADR-053).
  displayName: Joi.string().max(255).required(),
  // The role this tenant's group grants (ADR-053, A-39). Optional: standard
  // IdPs send only displayName and members; an unmapped group grants nothing
  // and refuses members until it is mapped. The service checks the role.
  roleId: Joi.string().uuid().optional(),
  members: Joi.array().items(Joi.object({
    value: Joi.string().uuid().required(),
    display: Joi.string().optional(),
  })).optional(),
});

const scimPatchSchema = Joi.object({
  Operations: Joi.array().items(Joi.object({
    op: Joi.string().valid("add", "remove", "replace").required(),
    // RFC 7644 § 3.5.2: an attribute path string, e.g. "active",
    // "name.givenName" or `members[value eq "<id>"]`. The service resolves it;
    // an unparseable path is a 400, never a silent no-op (A-33).
    path: Joi.string().optional(),
    // `{ "op": "replace", "path": "active", "value": false }` is the form Okta,
    // Entra ID and OneLogin send to deactivate a user. Until 2026-09-23 the
    // alternatives listed only object/array/string, so that payload was
    // rejected by the validator before the service ever saw it (A-33).
    value: Joi.alternatives().try(
      Joi.object(),
      Joi.array(),
      Joi.string(),
      Joi.boolean(),
      Joi.number(),
    ).optional(),
  })).required(),
});

const validate = (data, schema) => {
  // `data ?? {}` (A-09): Express 5 leaves req.body undefined when no body was
  // sent, and Joi treats `undefined` as VALID against a non-required object
  // schema — so an absent body walked through this gate and the controller's
  // first read of the result threw, turning an owed 400 into a 500. The SCIM
  // routes mount no body validator middleware, so this helper is the gate.
  const { error, value } = schema.validate(data ?? {}, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errors = {};
    error.details.forEach((detail) => {
      errors[detail.path[0]] = detail.message;
    });
    throw {
      status: 400,
      message: "Validation failed",
      errors,
    };
  }

  return value;
};

module.exports = {
  scimUserSchema,
  scimGroupSchema,
  scimPatchSchema,
  validate,
};
