/**
 * AI features: `/api/v1/ai` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from ai.route.js. Every route and middleware is in
 * the same order as before (checked against the mounted route table). The
 * contract is code-first: ai.openapi.ts (P9-25, ADR-103); the `@swagger`
 * JSDoc this file carried is gone.
 */
import { Router } from "express";
import aiController from "../../controllers/ai.controller";
import { auth } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS } from "../../constants/roleConstants";
// A-296: the upload helper, so the multipart fields are sanitized like a JSON
// body (multer is used only in utils/upload.util).
import { uploadToMemory } from "../../utils/upload.util";

// `Router` is `express.Router` (the same function).
const router = Router();

router.use(auth);

// A-94 (P6-04): both routes mounted `auth` only, so any authenticated
// principal could spend the tenant's AI budget and query its knowledge base.
// No new menu slug: each gate is the seeded screen whose data the route serves.
//
//  - /ocr   `certificate` write — certificate OCR is the intake step of a
//           certificate record. `certificate` is a child of `equipment`, so the
//           seeded holders of equipment WRITE keep it: HEALTHCARE ADMIN and
//           CALIBRATOR ADMIN (and the SUPERADMIN bypass). The gate runs BEFORE
//           multer, so a refused request never buffers the file.
//  - /query `sop` read — the RAG store holds SOP documents only today
//           (scripts/backfillEmbeddings.js is its only ingester), so an answer
//           discloses nothing the SOP screen does not already show the caller.
//           Seeded holders: HEALTHCARE ADMIN, CALIBRATOR ADMIN, ENGINEERING
//           MANAGER (and SUPERADMIN). A new source type ingested into
//           document_chunks must add its own slug here (requireAll), or this
//           gate starts disclosing it to SOP readers.
// Tests: routes/ai.gate.a94.test.js (the seeded matrix, role by role).

router.post(
  "/ocr",
  dynamicAccess("certificate", "write"),
  uploadToMemory({ maxFileSize: 5 * 1024 * 1024 }), // 5MB limit
  aiController.processOcr,
);
router.post("/query", dynamicAccess(MENU_SLUGS.SOP, "read"), aiController.queryRAG);

export = router;
