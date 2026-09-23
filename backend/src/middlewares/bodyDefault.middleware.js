// src/middlewares/bodyDefault.middleware.js
//
// A-09 — Express 5 leaves `req.body` **undefined** when no body was sent.
// Express 4 gave `{}`.
//
// Every `const { x } = req.body` and every `req.body.x` in a controller then
// throws a TypeError, which the error handler reports as a **500** — on a
// request that should have been a 400 (missing required field), or, on a
// DELETE/GET whose body is genuinely optional, on a request that should have
// succeeded outright.
//
// It is not only a crash: Joi treats `undefined` as valid against a
// non-required object schema, so the validators did not catch it either
// (`schema.validate(undefined)` → `{ value: undefined }`, no error). Those
// helpers are guarded too; this middleware is the request-level guarantee that
// every downstream handler sees an object.
//
// Mounted immediately after the body parsers in index.js, so it runs before
// the sanitizer, the routers and every route-level validator.
//
// It only fills an ABSENT body. A parsed object, an array, a string and a
// Buffer (raw-body routes) are all left exactly as the parser produced them.

const bodyDefault = (req, res, next) => {
  if (req.body === undefined) {
    req.body = {};
  }
  next();
};

module.exports = { bodyDefault };
