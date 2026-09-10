/**
 * E2E Tests: Content CMS (Blog & News) — /api/v1/content
 *
 * Verifies the platform-global content module end to end via real HTTP:
 * public read endpoints, admin post + category CRUD, and slug-check.
 * Content is NOT tenant-scoped. success() puts rows in `data`; list
 * pagination `meta` is a TOP-LEVEL sibling of data.
 */
const { httpGet, httpPost, httpPut, httpDelete, authHeader } = require("../setup");

// Express 5 exposes PATCH via httpPut? No — the harness only ships GET/POST/PUT/DELETE.
// The content update route is PATCH, so we issue it through a small local helper.
const { API_BASE, defaultHeaders } = require("../setup");
async function httpPatch(path, data = {}, headers = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { ...defaultHeaders, ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  const ct = resp.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await resp.json().catch(() => null) : null;
  return { status: resp.status, body };
}

let token;
async function login() {
  const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
  token = body.token || (body.data && body.data.token);
  return token;
}

describe("E2E Content CMS (HTTP)", () => {
  let categoryId;
  let postId;

  beforeAll(async () => {
    await login();
  });

  afterAll(async () => {
    if (postId) await httpDelete(`/content/posts/${postId}`, authHeader(token));
    if (categoryId) await httpDelete(`/content/categories/${categoryId}`, authHeader(token));
  });

  test("GET /content/posts — admin list, envelope + top-level meta", async () => {
    const { status, body } = await httpGet("/content/posts", authHeader(token));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty("meta");
  });

  test("GET /content/posts/public — public published list (no auth)", async () => {
    const { status, body } = await httpGet("/content/posts/public");
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /content/categories/public — public categories (no auth)", async () => {
    const { status, body } = await httpGet("/content/categories/public");
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("GET /content/slug-check — returns availability + suggestion", async () => {
    const { status, body } = await httpGet(
      "/content/slug-check?slug=Audit%20Test%20Post",
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.data).toHaveProperty("available");
    expect(body.data).toHaveProperty("suggestion");
  });

  test("POST /content/categories — create a category", async () => {
    const { status, body } = await httpPost(
      "/content/categories",
      { name: `E2E Cat ${Date.now()}`, description: "e2e" },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    categoryId = body.data.id;
  });

  test("POST /content/posts — create a post", async () => {
    const { status, body } = await httpPost(
      "/content/posts",
      {
        type: "BLOG",
        title: `E2E Post ${Date.now()}`,
        contentHtml: "<p>hi</p>",
        status: "DRAFT",
        categoryIds: categoryId ? [categoryId] : [],
      },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect(body.data).toHaveProperty("id");
    postId = body.data.id;
  });

  test("POST /content/posts — 400 without required type", async () => {
    const { status } = await httpPost(
      "/content/posts",
      { title: "missing type" },
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  test("GET /content/posts/:id — fetch created post", async () => {
    const { status, body } = await httpGet(`/content/posts/${postId}`, authHeader(token));
    expect(status).toBe(200);
    expect(body.data.id).toBe(postId);
  });

  test("PATCH /content/posts/:id — update title", async () => {
    const { status, body } = await httpPatch(
      `/content/posts/${postId}`,
      { title: "E2E Post Updated" },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("DELETE /content/posts/:id — soft delete", async () => {
    const { status } = await httpDelete(`/content/posts/${postId}`, authHeader(token));
    expect(status).toBe(200);
    postId = null;
  });
});
