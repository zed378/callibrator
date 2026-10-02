/**
 * Quality: non-conformances and CAPAs, `/api/v1/qms` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from qms.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table).
 *
 * The contract is code-first: qms.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { MENU_SLUGS } from "../../constants";
import {
  createNCSchema,
  updateNCSchema,
  createCapaSchema,
  updateCapaSchema,
} from "../../validators/qms.validator";
import {
  createNC,
  getNCs,
  updateNC,
  createCapa,
  getCapas,
  updateCapa,
} from "../../controllers/qms.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

router.use(auth);

// A-66 — authorization. Until 2026-09-24 every route here carried `auth` (and
// the mutations `denyApiKey`) and nothing else, so any authenticated user in a
// tenant could raise, edit and approve NCs and CAPAs. Each route is now gated
// on the seeded `qms` menu group ("Quality (NC & CAPA)"):
//   read  — HEALTHCARE ADMIN, CALIBRATOR ADMIN (write implies read),
//           ENGINEERING MANAGER (read)
//   write — HEALTHCARE ADMIN, CALIBRATOR ADMIN
// (ROLE_MENU_ASSIGNMENTS in constants/roleConstants.js; SUPER_ADMIN bypasses.)
// `update` normalizes to `write` in dynamicAccess — the matrix stores only
// read/write. Every other role now gets 403 in its own tenant.

// Non-Conformance Routes
// Mutations require an interactive user session (denyApiKey): a scoped service
// account must not be able to create/modify quality records (CAPA/NC).
// A-74: validated before the controller — an out-of-enum severity or a missing
// title is a 400 here, not a database error reported as 500.
router.post(
  "/nc",
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validate(createNCSchema),
  createNC,
);
router.get("/nc", dynamicAccess(MENU_SLUGS.QMS, "read"), getNCs);
router.patch(
  "/nc/:id",
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "update"),
  validate(updateNCSchema),
  updateNC,
);

// CAPA Routes
router.post(
  "/capa",
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "write"),
  validate(createCapaSchema),
  createCapa,
);
router.get("/capa", dynamicAccess(MENU_SLUGS.QMS, "read"), getCapas);
router.patch(
  "/capa/:id",
  denyApiKey,
  dynamicAccess(MENU_SLUGS.QMS, "update"),
  validate(updateCapaSchema),
  updateCapa,
);

export = router;
