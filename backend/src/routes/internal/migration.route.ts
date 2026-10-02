/**
 * Migrations and seeding over HTTP: `/api/v1/migration` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from migration.route.js. Every route and
 * middleware is in the same order as before (checked against the mounted
 * route table, the three gates by their printed source). The environment is
 * read through config/env, at request time as before. The contract is
 * code-first: migration.openapi.ts (P9-25, ADR-103).
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { auth as loadedAuth, superAdminOnly as loadedSuperAdminOnly } from "../../middlewares/auth.middleware";
import { forbidden as loadedForbidden } from "../../utils/response.util";
import { env as loadedEnv } from "../../config/env";
import {
  migrate,
  dropTable,
  seeding,
  unseeding,
  seedDemo,
} from "../../controllers/migration.controller";

// `Router` is `express.Router` (the same function).
const router = Router();
const auth = loadedAuth;
const superAdminOnly = loadedSuperAdminOnly;
const forbidden = loadedForbidden;
const env = loadedEnv;

/* eslint-disable @typescript-eslint/no-confusing-void-expression -- as built: each gate answers what `next` (or the refusal) answers */
const allowDestructive = (_req: Request, res: Response, next: NextFunction): unknown => {
  if (
    env("NODE_ENV") === "production" ||
    env("ALLOW_DESTRUCTIVE_MIGRATION") !== "true"
  ) {
    return forbidden(
      res,
      "Destructive migration operations are disabled. Set ALLOW_DESTRUCTIVE_MIGRATION=true in a non-production environment to enable.",
    );
  }
  return next();
};

const superAdminOrBootstrap = (req: Request, res: Response, next: NextFunction): unknown => {
  if (env("ALLOW_SEEDING") === "true") {
    return next();
  }
  return auth(req, res, (err?: unknown) =>
    err ? next(err) : superAdminOnly(req, res, next),
  );
};

const allowDemoSeeding = (_req: Request, res: Response, next: NextFunction): unknown => {
  if (env("SEED_DEMO") !== "true") {
    return forbidden(
      res,
      "Demo data seeding is disabled. Set SEED_DEMO=true to enable.",
    );
  }
  return next();
};
/* eslint-enable @typescript-eslint/no-confusing-void-expression */

router.get("/up", superAdminOrBootstrap, migrate);
router.get("/down", auth, superAdminOnly, allowDestructive, dropTable);
router.get("/seeding", superAdminOrBootstrap, seeding);
router.get("/unseeding", auth, superAdminOnly, allowDestructive, unseeding);
router.get("/seed-demo", superAdminOrBootstrap, allowDemoSeeding, seedDemo);

export = router;
