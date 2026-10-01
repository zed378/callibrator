// P9-19 (ADR-087): converted from validateUuid.middleware.js with no behaviour
// change. uuid 14 is ESM-only, so it is loaded with require(esm) as the .js
// did (the utils/upload.util.ts precedent); the import below is type-only.
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type * as UuidModule from "uuid" with { "resolution-mode": "import" };

// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: require(esm)
const { v4: uuidv4 } = require("uuid") as typeof UuidModule;

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

const validateUuid = (...paramNames: string[]): RequestHandler => {
  // The handler returns what the .js returned (next()'s result, or the
  // Response from res.json); Express ignores it, and RequestHandler accepts it.
  return (req: Request, res: Response, next: NextFunction) => {
    for (const paramName of paramNames) {
      // Express types a declared path parameter as a string; a caller can name
      // one the route does not declare, which reads as undefined.
      const value = req.params[paramName] as string | undefined;

      if (value === undefined || value === "") {
        // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: `return next()`
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
    return undefined;
  };
};

export { validateUuid };
