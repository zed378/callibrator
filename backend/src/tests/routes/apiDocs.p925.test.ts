/**
 * P9-25 (ADR-103) — the API reference (Scalar) and the OpenAPI document are
 * behind sign-in, self-hosted, and served under a CSP with no inline script.
 *
 * Real express, the real router, the real rbac gate and the real denyApiKey,
 * over HTTP. Only `auth` is replaced: it reads a test header and sets the
 * principal, as the real one does from a verified token — the question here is
 * what the gate after it lets through, not token verification (auth.middleware
 * has its own suites).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type NextFunction, type Request, type Response } from "express";
import type * as ApiDocsRoute from "../../routes/internal/apiDocs.route";
import { API_DOCS_CSP_DIRECTIVES, renderCsp } from "../../utils/csp.util";

type Principal = { role: { name: string; roleLevel: number }; isApiKey?: boolean } | undefined;

const PRINCIPALS: Record<string, Principal> = {
  superadmin: { role: { name: "SUPERADMIN", roleLevel: 10 } },
  tenantadmin: { role: { name: "TENANT_ADMIN", roleLevel: 8 } },
  technician: { role: { name: "TECHNICIAN", roleLevel: 5 } },
  apikey: { role: { name: "TENANT_ADMIN", roleLevel: 8 }, isApiKey: true },
};

jest.mock("../../middlewares/auth.middleware", () => ({
  ...jest.requireActual<object>("../../middlewares/auth.middleware"),
  auth: (req: Request, res: Response, next: NextFunction): void => {
    const who = req.headers["x-test-principal"];
    const principal = typeof who === "string" ? PRINCIPALS[who] : undefined;
    if (principal === undefined) {
      res.status(401).json({ success: false, status: 401, message: "Unauthorized", data: null });
      return;
    }
    (req as unknown as { user: Principal }).user = principal;
    next();
  },
}));

// The backend's jest transform does not hoist jest.mock (jest.transform.js), so the
// router is required AFTER the mock above, never imported at the top.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after jest.mock, see above
const { apiDocsRoutes, apiDocsSpecRoutes, scalarBundlePath, INIT_SCRIPT } = require("../../routes/internal/apiDocs.route") as typeof ApiDocsRoute;

jest.setTimeout(60000);

interface Served {
  readonly get: (path: string, who?: string) => Promise<{ status: number; body: string; csp: string; type: string }>;
  readonly close: () => Promise<void>;
}

const serve = async (): Promise<Served> => {
  const app = express();
  app.use("/docs.json", apiDocsSpecRoutes);
  app.use("/docs", apiDocsRoutes);
  app.use("/api/v1/docs", apiDocsRoutes);
  app.use("/elsewhere", apiDocsRoutes);
  // rbac hands its refusal to the error handler, as in index.js.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express knows an error handler by its four parameters
  app.use((err: { status?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ success: false, status: err.status ?? 500, message: err.message, data: null });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    get: async (path, who) => {
      const res = await fetch(`${base}${path}`, { headers: who === undefined ? {} : { "x-test-principal": who } });
      return {
        status: res.status,
        body: await res.text(),
        csp: res.headers.get("content-security-policy") ?? "",
        type: res.headers.get("content-type") ?? "",
      };
    },
    close: () => new Promise<void>((resolve) => server.close(() => { resolve(); })),
  };
};

let app: Served;
beforeAll(async () => {
  app = await serve();
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  jest.restoreAllMocks();
});

const EVERY_PATH = [
  "/docs",
  "/docs/assets/scalar.js",
  "/docs/assets/init.js",
  "/docs/openapi.json",
  "/docs.json",
  "/api/v1/docs",
  "/api/v1/docs/openapi.json",
];

describe("P9-25 — the API reference is behind sign-in", () => {
  it("answers 401 to an anonymous caller on every path, and publishes nothing", async () => {
    for (const path of EVERY_PATH) {
      const res = await app.get(path);
      expect([path, res.status]).toEqual([path, 401]);
      expect(res.body).not.toMatch(/openapi|Scalar/);
    }
  });

  it("answers 403 to a principal below tenant admin, and to an API key", async () => {
    for (const who of ["technician", "apikey"]) {
      for (const path of EVERY_PATH) {
        const res = await app.get(path, who);
        expect([who, path, res.status]).toEqual([who, path, 403]);
      }
    }
  });

  it("serves a tenant admin and the super admin", async () => {
    for (const who of ["tenantadmin", "superadmin"]) {
      for (const path of EVERY_PATH) {
        const res = await app.get(path, who);
        expect([who, path, res.status]).toEqual([who, path, 200]);
      }
    }
  });
});

describe("P9-25 — what is served", () => {
  it("the page: the reference's own CSP, no inline script, assets and spec from the mount it came through", async () => {
    const page = await app.get("/api/v1/docs", "tenantadmin");
    expect(page.type).toMatch(/text\/html/);
    expect(page.csp).toBe(renderCsp(API_DOCS_CSP_DIRECTIVES));
    const scripts = page.body.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts).toEqual([
      '<script src="/api/v1/docs/assets/scalar.js">',
      '<script src="/api/v1/docs/assets/init.js">',
    ]);
    expect(page.body).toContain('data-spec-url="/api/v1/docs/openapi.json"');
    expect(page.body).not.toMatch(/https?:\/\//);

    const direct = await app.get("/docs", "tenantadmin");
    expect(direct.body).toContain('data-spec-url="/docs/openapi.json"');
    // A mount not on the list renders the first one — the URL is never echoed back.
    const other = await app.get("/elsewhere", "tenantadmin");
    expect(other.body).toContain('data-spec-url="/docs/openapi.json"');
  });

  it("the spec is the committed openapi.json, at both URLs", async () => {
    const committed = JSON.parse(fs.readFileSync(`${__dirname}/../../../openapi.json`, "utf8")) as unknown;
    for (const path of ["/docs/openapi.json", "/docs.json"]) {
      const res = await app.get(path, "superadmin");
      expect(res.type).toMatch(/application\/json/);
      expect(JSON.parse(res.body)).toEqual(committed);
    }
  });

  it("the scripts: Scalar's own bundle, and a start-up script that turns off everything that calls out", async () => {
    const bundle = await app.get("/docs/assets/scalar.js", "tenantadmin");
    expect(bundle.type).toMatch(/javascript/);
    expect(bundle.body).toContain("createApiReference");
    const init = await app.get("/docs/assets/init.js", "tenantadmin");
    expect(init.body).toBe(INIT_SCRIPT);
    for (const off of ["withDefaultFonts: false", "telemetry: false", "persistAuth: false", "agent: { disabled: true }", "mcp: { disabled: true }"]) {
      expect(INIT_SCRIPT).toContain(off);
    }
  });

  it("answers 503 — not a crash, not an empty 200 — when the build lacks the spec or the bundle", async () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    const spec = await app.get("/docs/openapi.json", "superadmin");
    const bundle = await app.get("/docs/assets/scalar.js", "superadmin");
    expect([spec.status, JSON.parse(spec.body)]).toEqual([
      503,
      { success: false, status: 503, message: "The API contract (openapi.json) is not available on this build", data: null },
    ]);
    expect(bundle.status).toBe(503);
  });
});

describe("scalarBundlePath", () => {
  const here = __filename;

  it("prefers the bundle shipped beside the binary", () => {
    expect(scalarBundlePath(here, () => "/nowhere/index.js")).toBe(here);
  });

  it("falls back to the installed package", () => {
    const found = scalarBundlePath("/nowhere/shipped.js");
    expect(found).toMatch(/@scalar[\\/]api-reference[\\/]dist[\\/]browser[\\/]standalone\.js$/);
  });

  it("is null when the package resolves but has no bundle, or does not resolve", () => {
    expect(scalarBundlePath("/nowhere/shipped.js", () => "/nowhere/dist/index.js")).toBeNull();
    expect(
      scalarBundlePath("/nowhere/shipped.js", () => {
        throw new Error("Cannot find module");
      }),
    ).toBeNull();
  });
});
