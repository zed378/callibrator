const { v4: uuidv4 } = require("uuid");

/**
 * UUID Validation Middleware
 * Validates that `:id` params are valid UUIDs before reaching the controller.
 * Prevents errors and improves security by rejecting malformed IDs early.
 *
 * Usage:
 *   router.get("/:id", validateUuid("id"), controller);
 *
 * Can be chained for multiple params:
 *   router.delete("/:aId/roles/:bId", validateUuid("aId", "bId"), controller);
 */

// P6-02 (ADR-077): the SHAPE PostgreSQL's uuid type accepts — 32 hex digits
// in 8-4-4-4-12 — not only RFC 4122 versions 1-5. The version-1-5 pattern
// refused ids this system itself stores: every seeded menu group id is
// `a0000000-0000-0000-0000-…` (version nibble 0), so
// DELETE /user-permissions/:userId/:menuGroupId answered 400 for every seeded
// menu group, and a UUIDv7 would be refused too. What the middleware exists
// for is unchanged: a value that is not a uuid at all never reaches a query
// (where the cast would fail as a 500); an unknown well-formed id is the
// handler's 404.
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validateUuid = (...paramNames) => {
  return (req, res, next) => {
    for (const paramName of paramNames) {
      const value = req.params[paramName];

      if (value === undefined || value === "") {
        return next();
      }

      if (!uuidRegex.test(value)) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: `Invalid ${paramName}: must be a valid UUID (e.g., ${uuidv4()})`,
        });
      }
    }
    next();
  };
};

module.exports = { validateUuid };
