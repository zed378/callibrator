const { error } = require("../utils/response.util");

exports.validate = (schema) => {
  return (req, res, next) => {
    // A-09 — Express 5 leaves `req.body` undefined when no body is sent (Express 4
    // gave `{}`). Joi treats `undefined` as valid against a non-required object
    // schema, so `schema.validate(undefined)` returns `{ value: undefined }` with
    // NO error: the gate opened and `req.body` was then set to `undefined`, and the
    // first `req.body.x` in the controller threw a TypeError — a 500 on a request
    // that should have been a 400. Defaulting to `{}` makes the required-field
    // rules fire, which is the 400 the caller deserves.
    const { error: validationError, value } = schema.validate(req.body ?? {}, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (validationError) {
      const formattedErrors = validationError.details.map((item) => ({
        field: item.path.join("."),
        message: item.message,
      }));

      // Signature is error(res, message, statusCode, details) — the args were
      // previously passed as (details, message, statusCode), so `statusCode`
      // received the string "Validation Error" and Express threw
      // "Invalid status code", turning every validation failure into a 500.
      return error(res, "Validation Error", 400, formattedErrors);
    }

    req.body = value;
    next();
  };
};
