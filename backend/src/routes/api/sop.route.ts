/**
 * SOP document control and training, `/api/v1/sop` (index.js mounts it).
 *
 * P9-21 (ADR-087): converted from sop.route.js. Every route, gate and
 * middleware is in the same order as before (checked against the mounted
 * route table); the controller's handlers are destructured at load, as
 * before. The contract is code-first: sop.openapi.ts (P9-25, ADR-103); the
 * `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { denyPlatformAuthoring } from "../../middlewares/denyPlatformAuthoring.middleware"; // A-145, ADR-051 Q-17
import sopController from "../../controllers/sop.controller";

// `Router` is `express.Router` (the same function).
const router = Router();
const {
  createDocument,
  getDocuments,
  publishDocument,
  acknowledgeTraining,
} = sopController;

// A-28 — authorization.
//
// Until 2026-09-23 every route here carried `auth` alone, so any role could
// author AND publish a controlled procedure with no review at all.
//
// Authoring and publishing are now gated on `sop` (MENU_SLUGS.SOP): write is
// held by SUPERADMIN, HEALTHCARE ADMIN and CALIBRATOR ADMIN; ENGINEERING
// MANAGER holds read. Publishing additionally requires a signer distinct from
// the author — separation of duties, enforced in sop.service#publishDocument
// and refused with a 409 state explanation, not a generic error.
//
// POST /:id/acknowledge is deliberately left on `auth`: acknowledging training
// is a self-service act on the caller's OWN acknowledgment row (the service
// filters by req.user.id), and the roles that must acknowledge an SOP —
// technicians, warehouse, room users — hold no `sop` menu at all. Gating it
// would make assigned training impossible to complete.
//
// A-145 (ADR-051 Q-17, ADR-052) — publishing and acknowledging are Part 11
// authoring acts and carry denyPlatformAuthoring:
//  - publishing releases a controlled procedure under ISO 13485 §4.2.4 document
//    control; the audit row names the publisher as the approver, and
//    separation of duties compares that person with the author. A platform
//    operator impersonating a member would release it in the member's name.
//  - acknowledging training writes the member's ISO 13485 §6.2 training
//    record: it attests that THIS person read THIS revision. Nobody may
//    attest that for someone else — under impersonation the record would name
//    the member while an operator clicked.
router.use(auth);

// Document Routes
router.post("/", dynamicAccess(MENU_SLUGS.SOP, "write"), createDocument);
router.get("/", dynamicAccess(MENU_SLUGS.SOP, "read"), getDocuments);
// Releasing a controlled procedure is a human act (21 CFR 11.10(d)), so no
// API key may perform it, and the publisher may not be the author.
router.patch(
  "/:id/publish",
  validateUuid("id"),
  denyApiKey,
  dynamicAccess(MENU_SLUGS.SOP, "write"),
  denyPlatformAuthoring,
  publishDocument,
);

// Training Routes
router.post("/:id/acknowledge", validateUuid("id"), denyApiKey, denyPlatformAuthoring, acknowledgeTraining);

export = router;
