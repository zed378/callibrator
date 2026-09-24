const Joi = require("joi");

const tenantIdSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
});

const retentionPolicySchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
  policyKey: Joi.string().required(),
  days: Joi.number().integer().min(0).required(),
});

const legalHoldSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
  reason: Joi.string().optional(),
});

// A-135: masking the audit trail is per DATA SUBJECT (their user ids, in
// `subjectIds`), never per audit row id — naming rows would let an operator
// blank chosen rows' IP addresses, and an audit row id passed where a subject
// was meant would silently match nothing. `users` masking keeps `recordIds`.
const piiMaskSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
  entityType: Joi.string().required(),
  recordIds: Joi.when("entityType", {
    is: "audit_logs",
    then: Joi.forbidden(),
    otherwise: Joi.array().items(Joi.string().uuid()).min(1).required(),
  }),
  subjectIds: Joi.when("entityType", {
    is: "audit_logs",
    then: Joi.array().items(Joi.string().uuid()).min(1).required(),
    otherwise: Joi.forbidden(),
  }),
});

const anonymizeSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
  entityType: Joi.string().required(),
  options: Joi.object({
    keepDates: Joi.boolean().optional(),
    keepNumericIds: Joi.boolean().optional(),
  }).optional(),
});

// A-09 — Express 5 leaves `req.body` undefined when no body is sent. Joi
// treats `undefined` as valid against a non-required object schema and returns
// `{ value: undefined }` with no error, so the controller's `validated.x` then
// threw a TypeError — a 500 where a 400 was owed. `?? {}` makes the
// required-field rules fire instead.
const validate = (data, schema) => {
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
  tenantIdSchema,
  retentionPolicySchema,
  legalHoldSchema,
  piiMaskSchema,
  anonymizeSchema,
  validate,
};
