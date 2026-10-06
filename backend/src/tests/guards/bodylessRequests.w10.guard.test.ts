/**
 * W-10 — no mutating route answers 5xx to an empty or array body.
 *
 * WHY
 *
 * Express 5 leaves `req.body` undefined when no body was sent, and a handler
 * that reads `req.body.x` then throws: a 500 for what is a client mistake
 * (M-10, A-09). `bodyDefault` (index.ts, after the parsers) now turns an
 * absent body into `{}`, and `express.json()` in its default strict mode
 * refuses a JSON scalar or `null` with a 400 before any route runs
 * (middlewares/bodyShapes.w10.test.ts pins both). So the only bodies a
 * handler can receive are an OBJECT and an ARRAY — and the remaining W-10
 * question is whether a handler without a schema answers 5xx to one that
 * lacks its fields. On 2026-10-05 one did: `POST /api/v1/sop` reached the
 * model's NOT NULL on `title` (500), fixed by mounting `validate()`.
 *
 * HOW
 *
 * A source scan for `req.body` cannot decide this: handlers read the body
 * through helpers (`bodyOf`, `bodyOrEmpty`), pass it whole to services, and
 * validate inline with `validateInput` / `checkInput` (the as-built rule for
 * controllers). So the guard asks the running code instead. Every route
 * module under `src/routes` is required and its Express stack walked (as
 * routePermissionGuard.p604 does), with `validate()` tagged so a chain that
 * validates its BODY is recognised. Every other POST / PUT / PATCH / DELETE
 * is called through its REAL chain (fixtures/routeClient: only `auth` is
 * replaced; memoryDb holds the real models and tenant hooks) with `{}` and
 * with `[]`, as a tenant admin and as the super admin, and must answer below
 * 500. Path parameters are filled with the principal's tenant / user id or an
 * id that does not exist. Redis is an in-memory map, so the challenge-store
 * routes (WebAuthn, passkeys) run instead of answering 503 for the fixture.
 *
 * LIMITS (stated, not hidden)
 *
 *  - A handler that answers 404 for the missing id before it reads the body
 *    is not driven past the lookup. Those were read by hand on 2026-10-05
 *    (MEMORY/records/2026-10-05-w10-bodyless-requests.md); none dereferences
 *    a body field.
 *  - Only the body's SHAPE is probed (`{}` / `[]`), not a wrong type inside
 *    it (`{ "title": 5 }`): that is each route's schema's job.
 *
 * A reviewed exception goes in REVIEWED below with the outcome it must keep;
 * a stale entry fails. The check is tested in both directions at the bottom.
 */
import fs from "node:fs";
import path from "node:path";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, RouteResponse } from "../fixtures/routeClient";
import express from "express";
import { z } from "zod";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

type Handler = ((...args: unknown[]) => unknown) & { [TAG]?: true };

const TAG = Symbol.for("callibrator.w10.bodyValidated");

// Tag validate() BEFORE any router loads: a route module calls it at load.
const validation = jest.requireActual<Record<string, unknown>>("../../middlewares/validation.middleware");
const realValidate = validation["validate"] as (schema: unknown, options?: { from?: string | readonly string[] }) => Handler;
validation["validate"] = (schema: unknown, options: { from?: string | readonly string[] } = {}): Handler => {
  const middleware = realValidate(schema, options);
  const from = options.from ?? "body";
  if (from === "body" || (Array.isArray(from) && from.includes("body"))) {
    middleware[TAG] = true;
  }
  return middleware;
};

// The challenge store: an in-memory map instead of an absent Redis.
const redis = jest.requireActual<Record<string, (...args: unknown[]) => Promise<unknown>>>("../../services/redis.service");
const store = new Map<string, unknown>();
/** Install the in-memory store (jest.config restores every spy before each test). */
const useMemoryRedis = (): void => {
  jest.spyOn(redis, "set").mockImplementation((key: unknown, value: unknown) => {
    store.set(String(key), value);
    return Promise.resolve(true);
  });
  jest.spyOn(redis, "get").mockImplementation((key: unknown) => Promise.resolve(store.get(String(key)) ?? null));
  jest.spyOn(redis, "del").mockImplementation((key: unknown) => Promise.resolve(store.delete(String(key))));
  jest.spyOn(redis, "getDel").mockImplementation((key: unknown) => {
    const value = store.get(String(key)) ?? null;
    store.delete(String(key));
    return Promise.resolve(value);
  });
};

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");

const ROUTES_DIR = path.join(__dirname, "..", "..", "routes");
const MISSING_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const BODIES = { object: (): unknown => ({}), array: (): unknown => [] } as const;
type BodyKind = keyof typeof BODIES;
type Who = "tenant-admin" | "super-admin";

interface Layer {
  readonly route?: { readonly path: string; readonly methods: Record<string, boolean>; readonly stack: readonly { handle: Handler }[] };
  readonly handle: Handler;
}
interface RouterLike {
  readonly stack: readonly Layer[];
}

interface ProbedRoute {
  readonly file: string;
  readonly key: string;
  readonly router: RouterLike;
  readonly method: string;
  readonly path: string;
}

interface Outcome {
  readonly id: string;
  readonly body: BodyKind;
  readonly who: Who;
  /** The HTTP status, or what happened instead of one. */
  readonly status: number | "timeout" | `refused: ${string}`;
  readonly message: string;
}

/** A reviewed exception: the outcome the route must keep answering. */
interface Reviewed {
  readonly status: Outcome["status"];
  readonly reason: string;
}

/**
 * Reviewed 2026-10-05. Keyed "file METHOD /path".
 */
const REVIEWED: Record<string, Reviewed> = {
  "api/auth.route.ts POST /mfa/setup": {
    status: "refused: S-20/A-331",
    reason:
      "Answers 200 with the new TOTP secret (MFA is off for the fixture principal, so no re-authentication is asked); " +
      "routeClient's S-20 credential scan refuses to hand a response carrying a secret back to a test. Not a 5xx.",
  },
};

const isRouter = (value: unknown): value is RouterLike =>
  typeof value === "function" && Array.isArray((value as { stack?: unknown }).stack);

const listRouteFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listRouteFiles(full);
    }
    return /\.(js|ts)$/.test(entry.name) && !/\.(openapi|d)\.ts$/.test(entry.name) ? [full] : [];
  });

/**
 * The mutating routes of one router whose chain validates no body.
 *
 * @param router - an Express router
 * @param file - its label
 * @returns the routes to probe, and how many mutating routes validate their body
 */
const unvalidatedRoutes = (router: RouterLike, file: string): { routes: ProbedRoute[]; validated: number } => {
  const routes: ProbedRoute[] = [];
  let validated = 0;
  const before: Handler[] = [];
  for (const layer of router.stack) {
    if (!layer.route) {
      before.push(layer.handle);
      continue;
    }
    const chain = [...before, ...layer.route.stack.map((s) => s.handle)];
    for (const verb of Object.keys(layer.route.methods)) {
      const method = verb.toUpperCase();
      if (!MUTATING.has(method)) {
        continue;
      }
      if (chain.some((fn) => fn[TAG] === true)) {
        validated += 1;
        continue;
      }
      routes.push({ file, key: `${file} ${method} ${layer.route.path}`, router, method, path: layer.route.path });
    }
  }
  return { routes, validated };
};

/**
 * Call one route with one body shape as one principal.
 *
 * @param route - the route
 * @param body - the body shape
 * @param who - the principal
 * @returns the outcome
 */
const probe = async (route: ProbedRoute, body: BodyKind, who: Who): Promise<Outcome> => {
  mdb.reset();
  store.clear();
  useMemoryRedis();
  grantAllMenus();
  const fx = twoTenants();
  const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin, fx.superAdmin]);
  const principal: Principal = who === "super-admin" ? fx.superAdmin : admin;
  as(principal);
  const url = route.path
    .replace(/:tenantId\b/g, principal.tenantId)
    .replace(/:userId\b/g, principal.id)
    .replace(/:[A-Za-z]+/g, MISSING_ID);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      resolve("timeout");
    }, 15_000);
  });
  const id = route.key;
  try {
    const res: RouteResponse | "timeout" = await Promise.race([
      call(route.router, route.method, url, { body: BODIES[body](), headers: { "content-type": "application/json" } }),
      timeout,
    ]);
    if (res === "timeout") {
      return { id, body, who, status: "timeout", message: "" };
    }
    const payload = res.body as { message?: unknown } | null;
    const message = typeof payload?.message === "string" ? payload.message : "";
    return { id, body, who, status: res.status, message };
  } catch (error) {
    const message = (error as Error).message;
    return { id, body, who, status: `refused: ${message.split(":")[0] ?? ""}`, message };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Every outcome that breaks the rule, and every stale REVIEWED entry.
 *
 * @param outcomes - what the probes answered
 * @param reviewed - the reviewed exceptions
 * @param probedIds - every route probed (an entry naming none is stale)
 * @returns one line per violation
 */
const violationsOf = (
  outcomes: readonly Outcome[],
  reviewed: Record<string, Reviewed>,
  probedIds: ReadonlySet<string>,
): string[] => {
  const violations: string[] = [];
  for (const o of outcomes) {
    const entry = reviewed[o.id];
    if (entry) {
      if (o.status !== entry.status) {
        violations.push(`${o.id} (${o.body} body, ${o.who}): reviewed as ${String(entry.status)}, now answers ${String(o.status)} ${o.message}`);
      }
      continue;
    }
    if (typeof o.status !== "number" || o.status >= 500) {
      violations.push(
        `${o.id} (${o.body} body, ${o.who}): answered ${String(o.status)} ${o.message} — a body without its fields is a client mistake (400), ` +
          "mount validate(schema, { from }) on the route",
      );
    }
  }
  for (const key of Object.keys(reviewed)) {
    if (!probedIds.has(key)) {
      violations.push(`${key}: reviewed exception for a route that is not probed (validated now, or gone) — remove it`);
    }
  }
  return violations;
};

jest.setTimeout(300_000);

describe("W-10 — a mutating route without a body schema answers no 5xx to an empty or array body", () => {
  let routes: ProbedRoute[] = [];
  let validatedCount = 0;
  let files = 0;

  beforeAll(() => {
    for (const file of listRouteFiles(ROUTES_DIR)) {
      const label = path.relative(ROUTES_DIR, file).split(path.sep).join("/");
      const exported: unknown = jest.requireActual(file);
      const routers = isRouter(exported) ? [exported] : Object.values(exported ?? {}).filter(isRouter);
      files += 1;
      for (const router of routers) {
        const walked = unvalidatedRoutes(router, label);
        routes.push(...walked.routes);
        validatedCount += walked.validated;
      }
    }
    routes = routes.sort((a, b) => a.key.localeCompare(b.key));
  });

  it("walked the whole tree (a scan that finds nothing is not a pass)", () => {
    expect(files).toBeGreaterThanOrEqual(58);
    expect(validatedCount).toBeGreaterThan(50);
    expect(routes.length).toBeGreaterThan(150);
  });

  it("every one answers below 500, as a tenant admin and as the super admin, or keeps its reviewed outcome", async () => {
    const outcomes: Outcome[] = [];
    for (const route of routes) {
      for (const who of ["tenant-admin", "super-admin"] as const) {
        for (const body of ["object", "array"] as const) {
          outcomes.push(await probe(route, body, who));
        }
      }
    }
    expect(outcomes).toHaveLength(routes.length * 4);
    expect(violationsOf(outcomes, REVIEWED, new Set(routes.map((r) => r.key)))).toEqual([]);
  });

  describe("the check, both directions", () => {
    const { validate } = jest.requireActual<{ validate: (schema: unknown) => Handler }>("../../middlewares/validation.middleware");

    const planted = (): RouterLike => {
      const router = express.Router();
      // The W-10 shape: a handler that trusts the body.
      router.post("/crash", (req, res) => {
        const items = (req.body as { items: string[] }).items;
        res.status(201).json({ count: items.map((i) => i.trim()).length });
      });
      router.post("/validated", validate(z.object({ items: z.array(z.string()) })) as never, (_req, res) => {
        res.status(201).json({});
      });
      router.post("/tolerant", (req, res) => {
        const { name } = req.body as { name?: string };
        res.status(name ? 201 : 400).json({ message: name ? "ok" : "name is required" });
      });
      return router as unknown as RouterLike;
    };

    it("finds the unvalidated routes and skips the validated one", () => {
      const { routes: found, validated } = unvalidatedRoutes(planted(), "planted");
      expect(found.map((r) => r.key)).toEqual(["planted POST /crash", "planted POST /tolerant"]);
      expect(validated).toBe(1);
    });

    it("refuses a 5xx, passes a 400, and flags a reviewed entry whose outcome moved or whose route is gone", async () => {
      const { routes: found } = unvalidatedRoutes(planted(), "planted");
      const outcomes = await Promise.all(found.map((r) => probe(r, "object", "tenant-admin")));
      expect(outcomes.map((o) => o.status)).toEqual([500, 400]);
      const ids = new Set(found.map((r) => r.key));
      expect(violationsOf(outcomes, {}, ids)).toEqual([expect.stringContaining("planted POST /crash (object body, tenant-admin): answered 500")]);
      expect(violationsOf(outcomes, { "planted POST /crash": { status: 500, reason: "planted" } }, ids)).toEqual([]);
      expect(violationsOf(outcomes, { "planted POST /tolerant": { status: 200, reason: "planted" } }, ids)).toEqual([
        expect.stringContaining("planted POST /crash"),
        expect.stringContaining("reviewed as 200, now answers 400"),
      ]);
      expect(violationsOf([], { "planted POST /gone": { status: 400, reason: "planted" } }, ids)).toEqual([
        expect.stringContaining("not probed"),
      ]);
      expect(
        violationsOf([{ id: "x", body: "array", who: "super-admin", status: "timeout", message: "" }], {}, new Set(["x"])),
      ).toEqual([expect.stringContaining("answered timeout")]);
    });
  });
});
