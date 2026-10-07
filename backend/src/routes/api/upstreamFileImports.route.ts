/**
 * The rsync image import: `/api/v1/admin/upstream-file-imports` (index.ts mounts it). SUPER ADMIN
 * ONLY and JWT only: `auth`, then `denyApiKey` (a service key never drives an outbound SSH copy),
 * then `superAdminOnly` — for every route of this router. The import table has no tenant (it
 * names a TARGET tenant): the `:id` routes are allow-listed as `platform` in the two-tenant guard.
 *
 * Contract: upstreamFileImports.openapi.ts (ADR-103).
 */
import { Router } from "express";
import { auth, denyApiKey, superAdminOnly } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import {
  checkConnectionSchema,
  importIdSchema,
  listImportsSchema,
  startImportSchema,
} from "../../validators/upstreamFileImport.validator";
import { cancel, check, config, detail, list, start } from "../../controllers/upstreamFileImport.controller";

const router = Router();

router.use(auth);
router.use(denyApiKey);
router.use(superAdminOnly);

router.get("/config", config);
router.post("/check-connection", validate(checkConnectionSchema), check);
router.get("/", validate(listImportsSchema, { from: "query" }), list);
router.post("/", validate(startImportSchema), start);
router.get("/:id", validate(importIdSchema, { from: "params" }), detail);
router.post("/:id/cancel", validate(importIdSchema, { from: "params" }), cancel);

export = router;
