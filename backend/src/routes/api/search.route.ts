/**
 * Unified search: `/api/v1/search` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from search.route.js. The route, its gate and its
 * middleware are in the same order as before (checked against the mounted
 * route table). The contract is code-first: search.openapi.ts (P9-25,
 * ADR-103); the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import searchController from "../../controllers/search.controller";
import { SEARCH_MENUS } from "../../services/search.service";

// `Router` is `express.Router` (the same function).
const router = Router();

// A-04. The route was `auth` alone: any authenticated principal could read
// every device, stock item and certificate in the tenant through search.
//
// The gate is OR over every menu a search result can come from, so a caller
// holding `read` on one of them still gets in and the controller then filters
// the result types to the ones that caller may actually read. A caller
// holding none of them is refused here -- and, because this gate runs, an
// API-key principal is authorized by its scopes rather than being blocked by
// the deny-by-default check in controllerWrapper.util (A-03).
router.get(
  "/",
  auth,
  dynamicAccess(SEARCH_MENUS, "read"),
  searchController.search,
);

export = router;
