const express = require("express");
const router = express.Router();
const aiController = require("../../controllers/ai.controller");
const { auth } = require("../../middlewares/auth.middleware");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

router.use(auth);

/**
 * @swagger
 * /api/v1/ai/ocr:
 *   post:
 *     summary: Certificate OCR extraction
 *     description: Extracts structured data from an uploaded certificate image or PDF. Requires authentication.
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
 */
router.post("/ocr", upload.single("file"), aiController.processOcr);
/**
 * @swagger
 * /api/v1/ai/query:
 *   post:
 *     summary: RAG document Q&A
 *     description: Answers a question over indexed documents using retrieval-augmented generation. Requires authentication.
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
 */
router.post("/query", aiController.queryRAG);

module.exports = router;
