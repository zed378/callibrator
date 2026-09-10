const { error } = require("../utils/response.util");

exports.validate = (schema) => {
  return (req, res, next) => {
    const { error: validationError, value } = schema.validate(req.body, {
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
