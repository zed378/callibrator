/**
 * E2E Tests: AI module (/api/v1/ai)
 *
 * Live smoke coverage:
 *  - POST /ai/ocr   — certificate OCR (multipart file upload; validates file)
 *  - POST /ai/query — RAG document Q&A
 *
 * NOTE: both handlers require a configured AI/embeddings backend. In an
 * environment where the AI provider is not configured, /ai/query returns 500
 * ("RAG query failed or AI not configured"). Treat that as an environment
 * dependency, not a routing defect.
 */
const { httpPost, extractToken, authHeader } = require("../setup");
// P10-16 (ADR-099): no default operator password — set E2E_OPERATOR_PASSWORD (see setup.js).
const { OPERATOR_PASSWORD } = require("../setup");

describe("E2E AI (HTTP)", () => {
  let token;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: OPERATOR_PASSWORD,
    });
    token = extractToken(body);
    expect(token).toBeTruthy();
  });

  test("POST /ai/query — 401 without auth", async () => {
    const { status } = await httpPost("/ai/query", { question: "hi" });
    expect(status).toBe(401);
  });

  test("POST /ai/ocr — 400 when no file is uploaded", async () => {
    const { status, body } = await httpPost("/ai/ocr", {}, authHeader(token));
    expect(status).toBe(400);
    expect(body).toHaveProperty("message");
  });

  // A-281 (2026-09-29-security-fixes-a275-a282): no provider configured is a
  // 409 naming the settings to configure, not a 500 (P10-13 found this spec
  // still expecting the 500).
  test("POST /ai/query — reachable with auth (200 answer, or 409 naming the settings when AI is unconfigured)", async () => {
    const { status, body } = await httpPost("/ai/query", { question: "Which certificates expire soon?" }, authHeader(token));
    expect([200, 409]).toContain(status);
    if (status === 409) {
      expect(body.message).toEqual(expect.any(String));
    }
  });
});
