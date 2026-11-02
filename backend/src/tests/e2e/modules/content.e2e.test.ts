/**
 * E2E Tests: Content CMS (Blog & News) — /api/v1/content
 *
 * Verifies the platform-global content module end to end via real HTTP:
 * public read endpoints, admin post + category CRUD, and slug-check.
 * Content is NOT tenant-scoped. success() puts rows in `data`; list
 * pagination `meta` is a TOP-LEVEL sibling of data.
 */
const { httpGet, httpPost, httpDelete, authHeader } = require("../setup") as any;
// P10-16 (ADR-099): no default operator password — set E2E_OPERATOR_PASSWORD (see setup.js).
const { OPERATOR_PASSWORD } = require("../setup") as any;

// Express 5 exposes PATCH via httpPut? No — the harness only ships GET/POST/PUT/DELETE.
// The content update route is PATCH, so we issue it through a small local helper.
const { API_BASE, defaultHeaders } = require("../setup") as any;
async function httpPatch(path: any,  data: any = {},  headers: any = {}) {
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

let token: any = undefined;
async function login() {
  const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: OPERATOR_PASSWORD });
  token = (body as any).token || ((body as any).data && (body as any).data.token);
  return token;
}

describe("E2E Content CMS (HTTP)", () => {
  let categoryId: any = undefined;
  let postId: any = undefined;

  beforeAll(async () => {
    await login();
  });

  afterAll(async () => {
    if (postId) {await httpDelete(`/content/posts/${postId}`, authHeader(token));}
    if (categoryId) {await httpDelete(`/content/categories/${categoryId}`, authHeader(token));}
  });

  test("GET /content/posts — admin list, envelope + top-level meta", async () => {
    const { status, body } = await httpGet("/content/posts", authHeader(token));
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
    expect(Array.isArray((body as any).data)).toBe(true);
    expect(body).toHaveProperty("meta");
  });

  test("GET /content/posts/public — public published list (no auth)", async () => {
    const { status, body } = await httpGet("/content/posts/public");
    expect(status).toBe(200);
    expect(Array.isArray((body as any).data)).toBe(true);
  });

  test("GET /content/categories/public — public categories (no auth)", async () => {
    const { status, body } = await httpGet("/content/categories/public");
    expect(status).toBe(200);
    expect(Array.isArray((body as any).data)).toBe(true);
  });

  test("GET /content/slug-check — returns availability + suggestion", async () => {
    const { status, body } = await httpGet(
      "/content/slug-check?slug=Audit%20Test%20Post",
      authHeader(token),
    );
    expect(status).toBe(200);
    expect((body as any).data).toHaveProperty("available");
    expect((body as any).data).toHaveProperty("suggestion");
  });

  test("POST /content/categories — create a category", async () => {
    const { status, body } = await httpPost(
      "/content/categories",
      { name: `E2E Cat ${Date.now()}`, description: "e2e" },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect((body as any).data).toHaveProperty("id");
    categoryId = (body as any).data.id;
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
    expect((body as any).data).toHaveProperty("id");
    postId = (body as any).data.id;
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
    expect((body as any).data.id).toBe(postId);
  });

  test("PATCH /content/posts/:id — update title", async () => {
    const { status, body } = await httpPatch(
      `/content/posts/${postId}`,
      { title: "E2E Post Updated" },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
  });

  test("DELETE /content/posts/:id — soft delete", async () => {
    const { status } = await httpDelete(`/content/posts/${postId}`, authHeader(token));
    expect(status).toBe(200);
    postId = null;
  });
});
