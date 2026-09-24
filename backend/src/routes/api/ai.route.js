const express = require("express");
const router = express.Router();
const aiController = require("../../controllers/ai.controller");
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../../constants/roleConstants");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

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

/**
 * @swagger
 * /api/v1/ai/ocr:
 *   post:
 *     summary: Certificate OCR extraction
 *     description: Extracts structured data from an uploaded certificate image or PDF. Requires `certificate` write access.
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: OCR extraction completed successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Missing `certificate` write access
 */
router.post(
  "/ocr",
  dynamicAccess("certificate", "write"),
  upload.single("file"),
  aiController.processOcr,
);
/**
 * @swagger
 * /api/v1/ai/query:
 *   post:
 *     summary: RAG document Q&A
 *     description: Answers a question over indexed documents using retrieval-augmented generation. Requires `sop` read access.
 *     tags: [AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               question:
 *                 type: string
 *     responses:
 *       200:
 *         description: Answer generated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Missing `sop` read access
 */
router.post("/query", dynamicAccess(MENU_SLUGS.SOP, "read"), aiController.queryRAG);

module.exports = router;
