/**
 * API keys (service accounts): `/api/v1/api-keys` (index.js mounts it).
 * TENANT_ADMIN only, and JWT only (`denyApiKey`).
 *
 * P9-21 (ADR-087): converted from apiKeys.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table). The contract is code-first: apiKeys.openapi.ts (P9-25,
 * ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { ROLE_NAMES } from "../../constants";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { requireFeature } from "../../middlewares/enforceQuota.middleware";
import apiKeyController from "../../controllers/apiKey.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

// Managing API keys is JWT-only (denyApiKey) so a scoped service account can
// never mint or revoke keys — that would be a privilege-escalation path.
//
// It is also TENANT_ADMIN-only (A-27). Until 2026-09-23 any authenticated
// user could mint a key with any scopes it named, and SCIM accepts any API
// key as a service account — so the lowest-privilege account could issue
// itself a "*" key and provision a SUPERADMIN user with it.
const adminOnly = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])];

router.post("/", ...adminOnly, requireFeature("api_keys"), apiKeyController.create);

router.get("/", ...adminOnly, apiKeyController.list);

router.get("/:id", ...adminOnly, validateUuid("id"), apiKeyController.getOne);

router.delete("/:id", ...adminOnly, validateUuid("id"), apiKeyController.revoke);

export = router;
