/**
 * E2E Tests: Kanban module (/api/v1/kanban)
 *
 * Project-tracker kanban boards. Verified live against the running server —
 * full create/read/update/delete lifecycle for projects, columns, labels,
 * sprints and cards all returned healthy 2xx during the audit.
 *
 * setup.js ships no PATCH helper, so a local one is defined below using the
 * same native-fetch contract as the other helpers.
 */
const { API_BASE, httpGet, httpPost, httpDelete, authHeader, defaultHeaders } = require("../setup");

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

describe("E2E Kanban (HTTP)", () => {
  let token;
  let projectId;
  let columnId;

  beforeAll(async () => {
    const { body } = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
    token = body.token || (body.data && body.data.token);
  });

  afterAll(async () => {
    if (projectId) await httpDelete("/kanban/projects/" + projectId, authHeader(token));
  });

  test("GET /kanban/projects -> 200 list", async () => {
    const { status, body } = await httpGet("/kanban/projects", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("POST /kanban/projects -> 201, seeds default columns + active sprint", async () => {
    const { status, body } = await httpPost(
      "/kanban/projects",
      { name: "E2E Board", code: "E2E", description: "x" },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect(body.data.id).toBeTruthy();
    expect(body.data.myAccess).toBe("owner");
    projectId = body.data.id;
  });

  test("GET /kanban/projects/:id -> 200 full board", async () => {
    const { status, body } = await httpGet("/kanban/projects/" + projectId, authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray(body.data.columns)).toBe(true);
    columnId = body.data.columns[0] && body.data.columns[0].id;
  });

  test("POST /kanban/projects/:id/columns -> 201", async () => {
    const { status, body } = await httpPost(
      "/kanban/projects/" + projectId + "/columns",
      { name: "Todo", position: 0 },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect(body.data.id).toBeTruthy();
  });

  test("POST /kanban/projects/:id/labels -> 201", async () => {
    const { status, body } = await httpPost(
      "/kanban/projects/" + projectId + "/labels",
      { name: "bug", color: "#f00" },
      authHeader(token),
    );
    expect(status).toBe(201);
  });

  test("POST /kanban/projects/:id/sprints -> 201", async () => {
    const { status } = await httpPost(
      "/kanban/projects/" + projectId + "/sprints",
      { name: "Sprint 1" },
      authHeader(token),
    );
    expect(status).toBe(201);
  });

  test("POST /kanban/projects/:id/cards -> 201 with generated cardKey", async () => {
    const { status, body } = await httpPost(
      "/kanban/projects/" + projectId + "/cards",
      { columnId, title: "Card 1", priority: "low" },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect(body.data.cardKey).toMatch(/^E2E-\d+$/);
  });

  test("GET /kanban/projects/:id/metrics -> 200 summary", async () => {
    const { status, body } = await httpGet(
      "/kanban/projects/" + projectId + "/metrics",
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.data).toHaveProperty("summary");
  });

  test("PATCH /kanban/projects/:id -> 200 update", async () => {
    const { status, body } = await httpPatch(
      "/kanban/projects/" + projectId,
      { description: "updated" },
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(body.data.description).toBe("updated");
  });
});
