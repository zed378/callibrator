/**
 * Sessions: `/api/v1/sessions` (index.js mounts it). The caller's own
 * sessions (Q-08), and the platform operator's view across tenants.
 *
 * P9-21 (ADR-087): converted from session.route.js. Every route, gate and
 * middleware is in the same order as before, `router.use(auth)` first and
 * `/mine` before `/:id` (checked against the mounted route table). The
 * contract is code-first: session.openapi.ts (P9-25, ADR-103); the `@swagger`
 * JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { getAllSessions, getSessionById, revokeSession, revokeAllUserSessions, deleteSession, getSessionStats } from "../../controllers/session.controller";
import { validate } from "../../middlewares/validation.middleware";
import { revokeAllSessionsSchema, revokeSessionSchema } from "../../validators/session.validator";
import { listOwnSessions, revokeOwnSession } from "../../controllers/ownSessions.controller";

// `Router` is `express.Router` (the same function).
const router = Router();

// All session routes require authentication
router.use(auth);

/* ------------------------------------------------------------------ */
/* Q-08 (ADR-084): the caller's OWN sessions                          */
/* ------------------------------------------------------------------ */
// Registered before "/:id" so "mine" is never read as a session id. There is
// no concurrent-session cap and no IP/user-agent binding (ADR-084); this list
// and its per-session revoke are the control instead.
router.get("/mine", denyApiKey, listOwnSessions);

router.post("/mine/:id/revoke", denyApiKey, validateUuid("id"), revokeOwnSession);

/* ------------------------------------------------------------------ */
/* GET /api/v1/sessions/stats                                         */
/* ------------------------------------------------------------------ */
router.get("/stats", rbac(["SUPERADMIN"]), getSessionStats);

/* ------------------------------------------------------------------ */
/* GET /api/v1/sessions                                                 */
/* ------------------------------------------------------------------ */
router.get("/", rbac(["SUPERADMIN"]), getAllSessions);

/* ------------------------------------------------------------------ */
/* GET /api/v1/sessions/:id                                             */
/* ------------------------------------------------------------------ */
router.get("/:id", validateUuid("id"), rbac(["SUPERADMIN"]), getSessionById);

/* ------------------------------------------------------------------ */
/* POST /api/v1/sessions/:id/revoke                                     */
/* ------------------------------------------------------------------ */
router.post("/:id/revoke", validateUuid("id"), rbac(["SUPERADMIN"]), validate(revokeSessionSchema), revokeSession);

/* ------------------------------------------------------------------ */
/* POST /api/v1/sessions/user/:userId/revoke-all                        */
/* ------------------------------------------------------------------ */
router.post("/user/:userId/revoke-all", rbac(["SUPERADMIN"]), validate(revokeAllSessionsSchema), revokeAllUserSessions);

/* ------------------------------------------------------------------ */
/* DELETE /api/v1/sessions/:id                                          */
/* ------------------------------------------------------------------ */
router.delete("/:id", validateUuid("id"), rbac(["SUPERADMIN"]), deleteSession);

export = router;
