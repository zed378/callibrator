/**
 * The audit trail: `/api/v1/audit` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from audit.route.js. Every route and middleware is
 * in the same order as before (checked against the mounted route table). The
 * contract is code-first: audit.openapi.ts (P9-25, ADR-103); the `@swagger`
 * JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import auditController from "../../controllers/audit.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

// Accept both the model name and the seeded menu identifiers ("Audit Logs"
// name / "audit" slug) — the permission matrix is keyed by menu name AND slug,
// and no menu group is named "AuditLogs".
router.get(
  "/",
  auth,
  dynamicAccess("audit", "read", {
    checkTenant: true,
  }),
  auditController.fetchAuditLogs,
);

export = router;
