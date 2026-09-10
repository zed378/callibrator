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

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
