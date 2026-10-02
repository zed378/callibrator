/**
 * SCIM 2.0 provisioning: `/api/v1/scim/v2` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from scim.route.js. Every route, gate and
 * middleware is in the same order as before, and the inline `scimAuthShim`
 * and `requireApiKeyOrAdmin` have the same bodies (checked against the
 * mounted route table, the closures by their compiled source). The contract
 * is code-first: scim.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this
 * file carried is gone.
 */
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import scimController from "../../controllers/scim.controller";
import { auth } from "../../middlewares/auth.middleware";
import { scopeAllows as loadedScopeAllows } from "../../services/apiKey.service";
import { MENU_SLUGS as loadedMenuSlugs } from "../../constants/roleConstants";
// N-01: the one super-admin predicate (both spellings).
import { isSuperAdmin as loadedIsSuperAdmin } from "../../utils/role.util";

// Load-time captures, as the `.js` destructured them: the closures below call
// these bindings, not property reads at call time (ADR-087 Amendment 13).
const scopeAllows = loadedScopeAllows;
const MENU_SLUGS = loadedMenuSlugs;
const isSuperAdmin = loadedIsSuperAdmin;

// `Router` is `express.Router` (the same function).
const router = Router();

// SCIM typically authenticates using a Bearer token (API Key).
// Our tryApiKeyAuth handles "Authorization: ApiKey <key>".
// We can use the existing `auth` middleware which supports this.
// NOTE: SCIM actually sends "Authorization: Bearer <token>".
// We will build a small shim middleware for SCIM specifically if needed,
// but for now `auth` is fine if the IdP is configured to send `ApiKey <key>`.
// However, standard SCIM uses `Bearer <token>`, so let's allow `auth`
// and instruct admins to configure the IdP to send the API Key as a Bearer token.
// The `auth` middleware treats `Bearer <token>` as JWT, which might fail.
// So we should add a tiny middleware here to rewrite Bearer -> ApiKey if it's an API Key.

// @ts-expect-error -- as built: `res` is unused; the shim keeps the `.js`'s (req, res, next) signature and compiled source
const scimAuthShim = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ") && authHeader.length > 30 && !authHeader.includes(".")) {
    // Looks like an API key (no dots, not a JWT). Rewrite it.
    req.headers.authorization = authHeader.replace("Bearer ", "ApiKey ");
  }
  next();
};

router.use(scimAuthShim);
router.use(auth);

// We should also verify that the authenticated user is a service account/API key
// or has super admin privileges, not just a random user.
// A-250: an API key is a SCIM service account only when it carries the `scim`
// scope — `scim:read` for GET, `scim:write` for everything else. Before this,
// ANY key passed (A-27 fact 3): a key a tenant admin minted as `stock:read`
// for an integration could provision users and rewrite group membership.
const SCIM_READ_METHODS = new Set(["GET", "HEAD"]);
/**
 * A request past `auth`, its principal an API key: auth.middleware puts the
 * key's scopes on it (`apiKeyScopes`), which the principal type does not name.
 */
type AuthedRequest = Request & { user: NonNullable<Request["user"]> & { apiKeyScopes?: unknown } };

const keyMayUseScim = (req: Request): boolean =>
  scopeAllows(
    (req as AuthedRequest).user.apiKeyScopes,
    MENU_SLUGS.SCIM,
    SCIM_READ_METHODS.has(req.method) ? "read" : "write",
  );

/* eslint-disable @typescript-eslint/no-confusing-void-expression -- as built: the gate returns what next() and res.json() return, as the `.js` did (Express ignores it) */
const requireApiKeyOrAdmin = (req: Request, res: Response, next: NextFunction) => {
  if ((req.user?.isApiKey && keyMayUseScim(req)) || isSuperAdmin(req.user)) {
    // A-03: SCIM is one of the few endpoints meant for a service account. It
    // authorizes the key here, by its `scim` scope — V-05: one of the two
    // writers of apiKeyAuthorized (the other is dynamicAccess), pinned by
    // tests/guards/apiKeyAuthorizedWriters.v05.guard.test.ts.
    req.apiKeyAuthorized = true;
    return next();
  }
  return res.status(403).json({ schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], detail: "SCIM endpoints require an API key scoped scim:read (GET) or scim:write", status: "403" });
};
/* eslint-enable @typescript-eslint/no-confusing-void-expression */

router.use(requireApiKeyOrAdmin);

router.get("/Users", scimController.getUsers);

router.get("/Users/:id", scimController.getUserById);

router.post("/Users", scimController.createUser);

router.put("/Users/:id", scimController.updateUser);

router.patch("/Users/:id", scimController.patchUser);

router.delete("/Users/:id", scimController.deleteUser);

router.get("/Groups", scimController.getGroups);
router.get("/Groups/:id", scimController.getGroupById);
router.post("/Groups", scimController.createGroup);
router.put("/Groups/:id", scimController.updateGroup);
router.patch("/Groups/:id", scimController.patchGroup);
router.delete("/Groups/:id", scimController.deleteGroup);

export = router;
