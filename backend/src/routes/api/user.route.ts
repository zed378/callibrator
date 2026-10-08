/**
 * Users: `/api/v1/users` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from user.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table and the module text). The contract is code-first:
 * user.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this file carried is
 * gone.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { rbac } from "../../middlewares/rbac.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { ROLE_NAMES } from "../../constants";
import { upload } from "../../utils/upload.util";
import { enforceSeatQuota, enforceStorageQuota } from "../../middlewares/enforceQuota.middleware";
import userController from "../../controllers/user.controller";
import { bindUser } from "../../controllers/clientFacility.controller";
import { userFacilityBinding } from "@callibrator/contracts/clientFacilities";

// `Router` is `express.Router` (the same function).
const router = Router();

/* ------------------------------------------------------------------ */
/* GET ALL USERS (paginated, searchable, tenant‑scoped)               */
/* ------------------------------------------------------------------ */
router.get(
  "/all",
  auth,
  dynamicAccess("users", "read", { checkTenant: true }),
  userController.getAllUsers,
);

/* ------------------------------------------------------------------ */
/* GET SPECIFIC USER                                                  */
/* ------------------------------------------------------------------ */
router.post(
  "/detail",
  auth,
  dynamicAccess("users", "read", { checkTenant: true }),
  userController.getSpecificUser,
);

/* ------------------------------------------------------------------ */
/* CHECK USERNAME AVAILABILITY                                        */
/* ------------------------------------------------------------------ */
// Username availability check requires authentication to prevent user enumeration
// See: commands-backend.md RBAC rules - every protected endpoint must verify valid auth token
// P6-04: the availability probe serves the create-user form, so it needs what
// creating a user needs — otherwise any account can enumerate usernames.
router.post(
  "/username-check",
  auth,
  dynamicAccess("users", "create"),
  userController.checkUsernameAvailability,
);

/* ------------------------------------------------------------------ */
/* UPDATE USER ROLE                                                   */
/* ------------------------------------------------------------------ */
router.post(
  "/role-update",
  auth,
  dynamicAccess("users", "update", { checkTenant: true }),
  // A-77: audited inside the service's transaction (userService.userRoleUpdate),
  // not by the post-response audit middleware, which could not undo a commit.
  userController.updateUserRole,
);

/* ------------------------------------------------------------------ */
/* CREATE USER                                                        */
/* ------------------------------------------------------------------ */
router.post(
  "/create",
  auth,
  dynamicAccess("users", "create", { checkTenant: true }),
  enforceSeatQuota(),
  // A-77: audited inside userService.userCreate's transaction.
  userController.createUser,
);

/* ------------------------------------------------------------------ */
/* EDIT USER                                                          */
/* ------------------------------------------------------------------ */
router.patch(
  "/edit",
  auth,
  // A-63: no `checkSelf`. The target here is `req.body.userId`, and the self
  // bypass no longer reads the body — ownership comes from the path only.
  dynamicAccess("users", "update", { checkTenant: true }),
  userController.editUser,
);

/* ------------------------------------------------------------------ */
/* UPDATE OWN PROFILE (A-63)                                          */
/* ------------------------------------------------------------------ */
router.patch(
  "/:userId/profile",
  auth,
  validateUuid("userId"),
  dynamicAccess("users", "update", { checkSelf: true, checkTenant: true }),
  userController.updateProfile,
);

/* ------------------------------------------------------------------ */
/* DELETE USER                                                        */
/* ------------------------------------------------------------------ */
router.delete(
  "/delete",
  auth,
  dynamicAccess("users", "delete", { checkTenant: true }),
  // A-77: audited inside userService.deleteUser's transaction.
  userController.deleteUser,
);

/* ------------------------------------------------------------------ */
/* UPLOAD USER AVATAR                                                 */
/* ------------------------------------------------------------------ */
router.post(
  "/:userId/avatar",
  auth,
  validateUuid("userId"),
  dynamicAccess("users", "update", { checkSelf: true, checkTenant: true }),
  enforceStorageQuota(),
  upload({
    folder: "uploads/public/profile",
    allowedMimes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
    maxFileSize: 2 * 1024 * 1024, // 2MB
  }),
  userController.uploadUserAvatar,
);

/* ------------------------------------------------------------------ */
/* REMOVE USER AVATAR                                                 */
/* ------------------------------------------------------------------ */
router.delete(
  "/:userId/avatar",
  auth,
  validateUuid("userId"),
  dynamicAccess("users", "update", { checkSelf: true, checkTenant: true }),
  userController.removeUserAvatar,
);

/* ------------------------------------------------------------------ */
/* ADMIN-ASSISTED MFA RESET (A-141)                                   */
/* ------------------------------------------------------------------ */
router.post(
  "/:userId/mfa/reset",
  auth,
  validateUuid("userId"),
  dynamicAccess("users", "update", { checkTenant: true }),
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  // Audited inside userService.resetUserMfa's transaction.
  userController.resetUserMfa,
);

/* ------------------------------------------------------------------ */
/* ADMIN-ASSISTED PASSKEY REMOVAL (A-262)                             */
/* ------------------------------------------------------------------ */
router.delete(
  "/:userId/webauthn",
  auth,
  validateUuid("userId"),
  dynamicAccess("users", "update", { checkTenant: true }),
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  // Audited inside userService.resetUserPasskey's transaction.
  userController.resetUserPasskey,
);

/* ------------------------------------------------------------------ */
/* ADMIN-ASSISTED PASSWORD RESET (A-162)                              */
/* ------------------------------------------------------------------ */
router.post(
  "/:userId/password/reset",
  auth,
  validateUuid("userId"),
  dynamicAccess("users", "update", { checkTenant: true }),
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  // Audited inside userService.resetUserPassword's transaction.
  userController.resetUserPassword,
);

/* ------------------------------------------------------------------ */
/* CLIENT-FACILITY BINDING (P21-09, ADR-124 Am. 2 § 6)                */
/* ------------------------------------------------------------------ */
// Bind, re-bind, unbind or confirm unbound — the ONE way a user's facility
// changes. NOT facility-accessible: a bound HEALTHCARE ADMIN gets 403 before
// the parameters are read. Refused (409) while FACILITY_BINDING_ENABLED is off
// (the pre-invitation gate). Audited (one row per facility) and the user's
// sessions revoked inside userFacilityBinding.service#setBinding's transaction.
router.put(
  "/:userId/client-facility",
  auth,
  denyApiKey,
  dynamicAccess("users", "update", { checkTenant: true }),
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  validate(userFacilityBinding, { from: ["params", "body"] }),
  bindUser,
);

export = router;
