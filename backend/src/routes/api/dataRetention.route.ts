/**
 * Data retention: `/api/v1/tenants/:tenantId/...` (index.js mounts it on
 * `/api/v1/tenants`, beside tenant.route and tenantLifecycle.route).
 *
 * P9-21 (ADR-087): converted from dataRetention.route.js. Every route, gate
 * and middleware is in the same order as before, `router.use(auth)` first
 * (checked against the mounted route table). The contract is code-first:
 * dataRetention.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this file
 * carried is gone.
 */
import { Router } from "express";
import dataRetentionController from "../../controllers/dataRetention.controller";
import { auth, superAdminOnly } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants/roleConstants";

// `Router` is `express.Router` (the same function).
const router = Router();

router.use(auth);

/**
 * A-136: the two reads were gated on nothing but a token, so any role in any
 * tenant could read any tenant's retention periods and legal-hold state by
 * naming its id. They now need `data-retention: read` (seeded for the tenant
 * admin roles), and `checkTenant` answers 404 for a tenant id that is not the
 * caller's own — the same as for one that does not exist. The writes below
 * stay super-admin only.
 */
const canReadRetention = dynamicAccess(MENU_SLUGS.DATA_RETENTION, "read", { checkTenant: true });

router.get("/:tenantId/policy", canReadRetention, dataRetentionController.getRetentionPolicy);
router.put("/:tenantId/policy", superAdminOnly, dataRetentionController.setRetentionPolicy);
router.get("/:tenantId/legal-hold", canReadRetention, dataRetentionController.isOnLegalHold);
router.post("/:tenantId/legal-hold", superAdminOnly, dataRetentionController.enableLegalHold);
router.delete("/:tenantId/legal-hold", superAdminOnly, dataRetentionController.disableLegalHold);
router.post("/:tenantId/purge", superAdminOnly, dataRetentionController.purgeExpiredRecords);
router.post("/:tenantId/mask-pii", superAdminOnly, dataRetentionController.maskPII);
router.post("/:tenantId/anonymize", superAdminOnly, dataRetentionController.anonymizeDataset);

export = router;
