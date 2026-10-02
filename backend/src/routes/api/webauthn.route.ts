/**
 * The signed-in user's passkeys: `/api/v1/webauthn` (index.js mounts it).
 * Every route acts on the caller's own passkeys; the passkey sign-in is
 * authPublic.route's.
 *
 * P9-21 (ADR-087): converted from webauthn.route.js. Every route, gate and
 * middleware is in the same order as before, `router.use(auth)` first
 * (checked against the mounted route table). The contract is code-first:
 * webauthn.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this file
 * carried is gone.
 */
import { Router } from "express";
import webauthnController from "../../controllers/webauthn.controller";
import { auth } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { list as listPasskeys, rename as renamePasskey, revoke as revokePasskey } from "../../controllers/webauthnCredentials.controller";
import { renamePasskeySchema, revokePasskeySchema } from "../../validators/webauthnCredential.validator";

// `Router` is `express.Router` (the same function).
const router = Router();

router.use(auth);

router.get("/status", webauthnController.getStatus);
router.post("/registration-options", webauthnController.getRegistrationOptions);
router.post("/verify-registration", webauthnController.verifyRegistration);
router.post("/login-options", webauthnController.getLoginOptions);
router.post("/verify-login", webauthnController.verifyLogin);
router.post("/disable", webauthnController.disable);

// ADR-108 Amendment 1 — several passkeys per user: the caller's own list, and
// rename / revoke one by its row id. Another user's id (in any tenant) is 404.
// Revoking needs the A-213 re-authentication, which is also the lock-out
// guard: the last passkey goes only after the password is proven.
router.get("/credentials", listPasskeys);
router.patch(
  "/credentials/:id",
  validate(renamePasskeySchema, { from: ["params", "body"] }),
  renamePasskey,
);
router.delete(
  "/credentials/:id",
  validate(revokePasskeySchema, { from: ["params", "body"] }),
  revokePasskey,
);

export = router;
