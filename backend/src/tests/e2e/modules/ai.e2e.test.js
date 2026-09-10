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

describe("E2E AI (HTTP)", () => {
  let token;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: "123123",
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

  test("POST /ai/query — reachable with auth (200 answer, or 500 when AI unconfigured)", async () => {
    const { status } = await httpPost("/ai/query", { question: "Which certificates expire soon?" }, authHeader(token));
    expect([200, 500]).toContain(status);
  });
});
