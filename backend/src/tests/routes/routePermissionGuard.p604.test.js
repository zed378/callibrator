/**
 * P6-04 — no route without a permission gate.
 *
 * WHY
 *
 * A route carrying `auth` and nothing else works for every principal with a
 * token — every role, and every API key whatever its scopes. Nothing failed the
 * build when one was added. The audit found that defect live four times (A-01,
 * A-02, A-03, A-27) and 33 more times by enumeration (AUDIT-2026-09-AUTHZ-MATRIX),
 * each fixed by hand.
 *
 * HOW
 *
 * Every module under `src/routes` (api/ AND internal/) is required, and each
 * router's Express layer stack is walked — the chain Express will actually run,
 * `router.use(...)` layers included. The permission-gate factories
 * (`dynamicAccess`, `rbac`, `checkRoleLevel`, `abac`) are wrapped BEFORE the
 * routers load so every middleware they build is tagged with its arguments; the
 * direct gates (`superAdminOnly`, `hasDynamicPermission`) are matched by
 * identity. Nothing is replaced: the wrapped factories return the real
 * middleware, so the chains walked are the production chains.
 *
 * A route passes when its chain holds a gate, or when it is listed in
 * `constants/routeGateExemptions.js` with a kind the chain agrees with (see
 * that file). The routes `index.js` and `docs/swagger.js` register directly on
 * the app cannot be required without booting the server, so they are read from
 * source text and must all be listed.
 *
 * The guard is tested in both directions at the bottom, on synthetic routers:
 * a gated route passes; an ungated one, a stale entry, a mis-kinded entry, a
 * `service` entry naming a function that does not exist, and a gate naming a
 * menu that is not seeded all fail.
 *
 * Overlap with A-07 (`dynamicAccessSlugs.a07.test.js`): that test enumerates
 * GATES and checks their resource names; this one enumerates ROUTES and checks
 * each has a gate. The slug check is repeated here per route (the P6-04 DoD asks
 * for it: a gate naming no menu is the same hole with a longer line of code),
 * against the same vocabulary — the seed's slugs, via `seededMenuSlugs`.
 */

const fs = require("fs");
const path = require("path");
const express = require("express");

const authMiddleware = require("../../middlewares/auth.middleware");
const dynamicAccessMiddleware = require("../../middlewares/dynamicAccess.middleware");
const rbacMiddleware = require("../../middlewares/rbac.middleware");
const abacMiddleware = require("../../middlewares/abac.middleware");
const { seededMenuSlugs } = require("../../utils/authorizationWiring.util");
const {
  ROUTE_GATE_EXEMPTIONS,
  KINDS,
  EXEMPTION_KINDS,
  publicRoutes,
} = require("../../constants/routeGateExemptions");

const SRC = path.join(__dirname, "..", "..");
const ROUTES_DIR = path.join(SRC, "routes");
const INDEX_FILE = path.join(SRC, "..", "index.js");
const SWAGGER_FILE = path.join(SRC, "docs", "swagger.js");

// ---------------------------------------------------------------------------
// Tag the gate factories before any router is loaded.
// ---------------------------------------------------------------------------

const GATE_TAG = Symbol.for("callibrator.p604.gate");

const tagFactory = (mod, name) => {
  const real = mod[name];
  mod[name] = (...args) => {
    const middleware = real(...args);
    middleware[GATE_TAG] = { gate: name, args };
    return middleware;
  };
};
tagFactory(dynamicAccessMiddleware, "dynamicAccess");
tagFactory(rbacMiddleware, "rbac");
tagFactory(rbacMiddleware, "checkRoleLevel");
tagFactory(abacMiddleware, "abac");

const DIRECT_GATES = new Map([
  [authMiddleware.superAdminOnly, "superAdminOnly"],
  [dynamicAccessMiddleware.hasDynamicPermission, "hasDynamicPermission"],
]);
const AUTHENTICATORS = new Set([authMiddleware.auth, authMiddleware.optionalAuth]);

/**
 * @param {Function} fn - a middleware from a chain
 * @returns {{gate: string, args: Array}|null} the gate it is, if any
 */
const gateOf = (fn) => {
  if (fn[GATE_TAG]) {
    return fn[GATE_TAG];
  }
  if (DIRECT_GATES.has(fn)) {
    return { gate: DIRECT_GATES.get(fn), args: [] };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

const listJs = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listJs(full);
    }
    return entry.name.endsWith(".js") ? [full] : [];
  });

const isRouter = (value) => typeof value === "function" && Array.isArray(value.stack);

/**
 * The routers a route module exports (a router, or an object of routers).
 *
 * @param {*} exported - module.exports of a route file
 * @returns {Function[]} routers
 */
const routersOf = (exported) =>
  isRouter(exported) ? [exported] : Object.values(exported || {}).filter(isRouter);

/**
 * Walk one router's stack into routes, each with the full chain Express runs:
 * the path-less `router.use(...)` layers registered before it, then its own.
 *
 * @param {Function} router - an Express router
 * @param {string} file - label (route file relative to src/routes)
 * @returns {{routes: Array<object>, problems: string[]}} routes and anything
 *   the walker cannot reason about
 */
const walkRouter = (router, file) => {
  const routes = [];
  const problems = [];
  const before = [];

  for (const layer of router.stack) {
    if (!layer.route) {
      // Every router.use in src/routes is path-less today. A path-scoped one
      // would gate only some routes; the walker says so rather than guessing.
      if (!layer.slash) {
        problems.push(`${file}: a path-scoped router.use layer (${layer.name}) — extend the guard before adding one`);
      }
      before.push(layer.handle);
      continue;
    }
    const chain = [...before, ...layer.route.stack.map((s) => s.handle)];
    for (const method of Object.keys(layer.route.methods)) {
      routes.push({ file, key: `${method.toUpperCase()} ${layer.route.path}`, chain });
    }
  }

  return { routes, problems };
};

/**
 * Routes registered directly on the app in a source file, read from text.
 *
 * @param {string} source - index.js or docs/swagger.js source
 * @returns {string[]} "METHOD /path" keys
 */
const appRoutesIn = (source) => {
  const keys = [];
  for (const m of source.matchAll(/\bapp\.(get|post|put|patch|delete|all)\(\s*["'`]([^"'`]+)["'`]/g)) {
    keys.push(`${m[1].toUpperCase()} ${m[2]}`);
  }
  // app.use("/path", <handler>) that is not a router from src/routes nor a
  // static directory: an app-level endpoint in its own right.
  for (const m of source.matchAll(/\bapp\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z_$][\w$.]*)/g)) {
    const handler = m[2];
    if (/Routes$/.test(handler) || handler === "express.static") {
      continue;
    }
    keys.push(`USE ${m[1]}`);
  }
  return keys;
};

// ---------------------------------------------------------------------------
// The check — pure, so the bottom of this file can test it in both directions.
// ---------------------------------------------------------------------------

/**
 * Does `file#fn` name a function defined in that source file?
 *
 * @param {string} check - "services/x.service.js#name"
 * @param {Function} readSource - (relativePath) => source text, or throws
 * @returns {boolean} whether the function exists
 */
const serviceCheckExists = (check, readSource) => {
  const [file, fn] = String(check).split("#");
  if (!file || !fn) {
    return false;
  }
  let source;
  try {
    source = readSource(file);
  } catch {
    return false;
  }
  const escaped = fn.replace(/[$]/g, "\\$");
  return new RegExp(
    `(?:\\bfunction\\s+${escaped}\\s*\\(|\\b(?:const|let)\\s+${escaped}\\s*=|\\bexports\\.${escaped}\\s*=|\\bstatic\\s+(?:async\\s+)?${escaped}\\s*\\()`,
  ).test(source);
};

/**
 * Check every enumerated route against the gate rule and the exemption list.
 *
 * @param {object} input - input
 * @param {Array<{file: string, key: string, chain: Function[]}>} input.routes -
 *   routes walked from routers (their chains are inspected)
 * @param {Object<string, string[]>} input.appRoutes - file -> route keys read
 *   from source (no chain; must be listed as public)
 * @param {object} input.exemptions - ROUTE_GATE_EXEMPTIONS shape
 * @param {Set<string>} input.slugs - seeded menu slugs
 * @param {Function} input.readSource - reads a file relative to src
 * @returns {string[]} violations, one line each
 */
const checkRoutes = ({ routes, appRoutes, exemptions, slugs, readSource }) => {
  const violations = [];
  const seen = new Set();

  for (const route of routes) {
    const id = `${route.file} ${route.key}`;
    seen.add(id);
    const gates = route.chain.map(gateOf).filter(Boolean);
    const authenticated = route.chain.some((fn) => AUTHENTICATORS.has(fn));
    const entry = exemptions[route.file]?.[route.key];

    for (const g of gates.filter((x) => x.gate === "dynamicAccess")) {
      const names = Array.isArray(g.args[0]) ? g.args[0] : [g.args[0]];
      for (const name of names) {
        if (typeof name !== "string" || !slugs.has(name)) {
          violations.push(`${id}: dynamicAccess(${JSON.stringify(name)}) names no seeded menu slug — a gate that grants nobody (A-07)`);
        }
      }
    }

    if (gates.length > 0) {
      if (entry) {
        violations.push(`${id}: carries ${gates.map((g) => g.gate).join(", ")} AND an exemption — remove the stale exemption`);
      }
      continue;
    }

    if (!entry) {
      violations.push(
        `${id}: no permission gate (dynamicAccess / rbac / checkRoleLevel / abac / superAdminOnly) and no exemption in constants/routeGateExemptions.js — ` +
          "every principal with a token can call it",
      );
      continue;
    }

    violations.push(...checkEntry(id, entry, { authenticated, chain: route.chain, readSource }));
  }

  for (const [file, keys] of Object.entries(appRoutes)) {
    for (const key of keys) {
      const id = `${file} ${key}`;
      seen.add(id);
      const entry = exemptions[file]?.[key];
      if (!entry) {
        violations.push(`${id}: registered directly on the app with no exemption entry — gate it or list it`);
      } else if (entry.kind !== EXEMPTION_KINDS.PUBLIC) {
        violations.push(`${id}: app-level routes can only be listed as public (the guard cannot see their chain)`);
      } else {
        violations.push(...checkEntry(id, entry, { authenticated: false, chain: [], readSource }));
      }
    }
  }

  for (const [file, entries] of Object.entries(exemptions)) {
    for (const key of Object.keys(entries)) {
      if (!seen.has(`${file} ${key}`)) {
        violations.push(`${file} ${key}: exemption for a route that does not exist — remove it`);
      }
    }
  }

  return violations;
};

/**
 * Validate one exemption entry against the route's chain.
 *
 * @param {string} id - route id
 * @param {object} entry - exemption
 * @param {object} ctx - chain facts
 * @returns {string[]} violations
 */
const checkEntry = (id, entry, { authenticated, chain, readSource }) => {
  const out = [];
  if (!KINDS.includes(entry.kind)) {
    out.push(`${id}: unknown exemption kind ${JSON.stringify(entry.kind)}`);
    return out;
  }
  if (typeof entry.reason !== "string" || entry.reason.trim().length < 20) {
    out.push(`${id}: an exemption needs a reason a reviewer can check (at least a sentence)`);
  }
  if (entry.kind === EXEMPTION_KINDS.PUBLIC && authenticated) {
    out.push(`${id}: listed as public but its chain authenticates — list it by what actually authorizes it`);
  }
  if (entry.kind !== EXEMPTION_KINDS.PUBLIC && entry.kind !== EXEMPTION_KINDS.INLINE && !authenticated) {
    out.push(`${id}: listed as ${entry.kind} but its chain has no auth — it is public, whatever the list says`);
  }
  if (entry.kind === EXEMPTION_KINDS.SERVICE && !serviceCheckExists(entry.check, readSource)) {
    out.push(`${id}: service check ${JSON.stringify(entry.check)} does not name a function in that file`);
  }
  if (entry.kind === EXEMPTION_KINDS.INLINE && !chain.some((fn) => fn.name === entry.gate)) {
    out.push(`${id}: inline gate ${JSON.stringify(entry.gate)} is not in the route's chain`);
  }
  if (entry.kind === EXEMPTION_KINDS.PENDING && !entry.card) {
    out.push(`${id}: a pending exemption must name the card that closes it`);
  }
  if (entry.kind === EXEMPTION_KINDS.ACCEPTED && !entry.decision) {
    out.push(`${id}: an accepted exemption must name the decision that accepted it`);
  }
  return out;
};

const readSrc = (relative) => fs.readFileSync(path.join(SRC, relative), "utf8");

// ---------------------------------------------------------------------------
// The real tree
// ---------------------------------------------------------------------------

const ROUTE_FILES = listJs(ROUTES_DIR);
let tree;

beforeAll(() => {
  const routes = [];
  const problems = [];
  const routerCount = {};
  for (const file of ROUTE_FILES) {
    const label = path.relative(ROUTES_DIR, file).split(path.sep).join("/");
    const routers = routersOf(require(file));
    routerCount[label] = routers.length;
    for (const router of routers) {
      const walked = walkRouter(router, label);
      routes.push(...walked.routes);
      problems.push(...walked.problems);
    }
  }
  tree = {
    routes,
    problems,
    routerCount,
    appRoutes: {
      "index.js": appRoutesIn(fs.readFileSync(INDEX_FILE, "utf8")),
      "docs/swagger.js": appRoutesIn(fs.readFileSync(SWAGGER_FILE, "utf8")),
    },
  };
});

describe("P6-04 — every route carries a permission gate or a reviewed exemption", () => {
  it("walked the whole tree, api/ AND internal/ (a scan that finds nothing is not a pass)", () => {
    const labels = Object.keys(tree.routerCount);
    expect(labels.some((l) => l.startsWith("api/"))).toBe(true);
    expect(labels.some((l) => l.startsWith("internal/"))).toBe(true);
    expect(labels.length).toBeGreaterThanOrEqual(55);
    for (const label of labels) {
      expect([label, tree.routerCount[label]]).toEqual([label, expect.any(Number)]);
      expect(tree.routerCount[label]).toBeGreaterThan(0);
    }
    expect(tree.routes.length).toBeGreaterThan(350);
    expect(tree.appRoutes["index.js"].length).toBeGreaterThan(0);
    expect(tree.problems).toEqual([]);
  });

  it("every route is gated or exempted, and every exemption is live and consistent", () => {
    const violations = checkRoutes({
      routes: tree.routes,
      appRoutes: tree.appRoutes,
      exemptions: ROUTE_GATE_EXEMPTIONS,
      slugs: seededMenuSlugs(),
      readSource: readSrc,
    });
    expect(violations).toEqual([]);
  });

  it("every route module is mounted by index.js (an unmounted router is dead or forgotten)", () => {
    const index = fs.readFileSync(INDEX_FILE, "utf8");
    const unmounted = [];
    for (const file of ROUTE_FILES) {
      const rel = `./src/routes/${path.relative(ROUTES_DIR, file).split(path.sep).join("/").replace(/\.js$/, "")}`;
      const req = index.match(
        new RegExp(`const\\s+(\\{[^}]*\\}|[A-Za-z_$][\\w$]*)\\s*=\\s*require\\(["']${rel.replace(/[.]/g, "\\.")}(?:\\.js)?["']\\)`),
      );
      if (!req) {
        unmounted.push(`${rel}: not required by index.js`);
        continue;
      }
      const names = req[1].startsWith("{")
        ? req[1].replace(/[{}\s]/g, "").split(",").filter(Boolean)
        : [req[1]];
      for (const name of names) {
        if (!new RegExp(`app\\.use\\((?:\\s*["'][^"']+["']\\s*,)?\\s*${name}\\s*\\)`).test(index)) {
          unmounted.push(`${rel}: ${name} required but never app.use()d`);
        }
      }
    }
    expect(unmounted).toEqual([]);
  });

  it("publicRoutes() — the list P9-21's public() marker reads — is exactly the public entries", () => {
    const listed = publicRoutes();
    expect(listed).toContain("api/auth.route.js POST /login");
    expect(listed).toContain("index.js GET /");
    expect(listed).not.toContain("api/auth.route.js POST /logout");
    const count = Object.values(ROUTE_GATE_EXEMPTIONS)
      .flatMap((r) => Object.values(r))
      .filter((e) => e.kind === EXEMPTION_KINDS.PUBLIC).length;
    expect(listed).toHaveLength(count);
  });

  it("records the whole-tree result (P6-04 DoD: run over the whole tree, not only diffs)", () => {
    const byKind = {};
    let gated = 0;
    for (const route of tree.routes) {
      if (route.chain.some(gateOf)) {
        gated++;
        continue;
      }
      const kind = ROUTE_GATE_EXEMPTIONS[route.file][route.key].kind;
      byKind[kind] = (byKind[kind] || 0) + 1;
    }
    // Not a snapshot of exact numbers (they move with every route added);
    // the invariant is that every route is one or the other.
    const exempted = Object.values(byKind).reduce((a, b) => a + b, 0);
    expect(gated + exempted).toBe(tree.routes.length);
    expect(gated).toBeGreaterThan(exempted);
  });
});

// ---------------------------------------------------------------------------
// The guard itself, both directions, on synthetic routers.
// ---------------------------------------------------------------------------

describe("P6-04 — the guard fails what it must and passes what it must", () => {
  const { auth, superAdminOnly, denyApiKey } = authMiddleware;
  const handler = function controller(req, res) {
    res.end();
  };
  const SLUGS = new Set(["reports", "users"]);
  const sources = {
    "services/fake.service.js": "exports.assertThing = async () => {};\nconst helper = () => 1;",
  };
  const readSource = (rel) => {
    if (!(rel in sources)) {
      throw new Error("ENOENT");
    }
    return sources[rel];
  };
  const run = (router, exemptions = {}, appRoutes = {}) =>
    checkRoutes({
      routes: walkRouter(router, "api/fake.route.js").routes,
      appRoutes,
      exemptions,
      slugs: SLUGS,
      readSource,
    });

  it("passes a route gated by dynamicAccess, rbac, superAdminOnly or a router-level gate", () => {
    const r = express.Router();
    r.get("/a", auth, dynamicAccessMiddleware.dynamicAccess("reports", "read"), handler);
    r.get("/b", auth, rbacMiddleware.rbac(["SUPERADMIN"]), handler);
    r.get("/c", auth, superAdminOnly, handler);
    const withUse = express.Router();
    withUse.use(auth);
    withUse.use(rbacMiddleware.checkRoleLevel(5));
    withUse.post("/d", handler);
    expect(run(r)).toEqual([]);
    expect(run(withUse)).toEqual([]);
  });

  it("FAILS a route carrying auth alone — and auth + denyApiKey is still not a gate", () => {
    const r = express.Router();
    r.get("/open", auth, handler);
    r.post("/still-open", auth, denyApiKey, handler);
    const violations = run(r);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toMatch(/^api\/fake\.route\.js GET \/open: no permission gate/);
    expect(violations[1]).toMatch(/^api\/fake\.route\.js POST \/still-open: no permission gate/);
  });

  it("FAILS a gate that names no seeded menu slug (A-07) even though a gate is present", () => {
    const r = express.Router();
    r.get("/x", auth, dynamicAccessMiddleware.dynamicAccess("Reports", "read"), handler);
    r.get("/y", auth, dynamicAccessMiddleware.dynamicAccess(["users", "AuditLogs"], "read"), handler);
    const violations = run(r);
    expect(violations).toEqual([
      expect.stringMatching(/GET \/x: dynamicAccess\("Reports"\) names no seeded menu slug/),
      expect.stringMatching(/GET \/y: dynamicAccess\("AuditLogs"\) names no seeded menu slug/),
    ]);
  });

  it("passes an exempted route whose kind agrees with its chain", () => {
    const r = express.Router();
    r.post("/login", handler);
    r.get("/me", auth, handler);
    r.get("/svc", auth, handler);
    const ex = {
      "api/fake.route.js": {
        "POST /login": { kind: "public", reason: "the login surface, rate limited" },
        "GET /me": { kind: "self", reason: "the caller's own profile, req.user.id" },
        "GET /svc": { kind: "service", check: "services/fake.service.js#assertThing", reason: "checked below the route by assertThing" },
      },
    };
    expect(run(r, ex)).toEqual([]);
  });

  it("FAILS a service exemption whose named check does not exist (AZ-03)", () => {
    const r = express.Router();
    r.get("/svc", auth, handler);
    const bad = (check) => ({
      "api/fake.route.js": { "GET /svc": { kind: "service", check, reason: "checked below the route, allegedly" } },
    });
    expect(run(r, bad("services/fake.service.js#noSuchCheck"))).toEqual([
      expect.stringMatching(/does not name a function in that file/),
    ]);
    expect(run(r, bad("services/missing.service.js#assertThing"))).toHaveLength(1);
    expect(run(r, bad("no-hash-here"))).toHaveLength(1);
    // a non-exported helper still counts as existing
    expect(run(r, bad("services/fake.service.js#helper"))).toEqual([]);
  });

  it("FAILS a stale exemption: the route is gated now, or does not exist", () => {
    const r = express.Router();
    r.get("/gated", auth, superAdminOnly, handler);
    const ex = {
      "api/fake.route.js": {
        "GET /gated": { kind: "self", reason: "was self-service before it was gated" },
        "GET /gone": { kind: "self", reason: "a route that was deleted since" },
      },
    };
    const violations = run(r, ex);
    expect(violations).toEqual([
      expect.stringMatching(/GET \/gated: carries superAdminOnly AND an exemption/),
      expect.stringMatching(/GET \/gone: exemption for a route that does not exist/),
    ]);
  });

  it("FAILS an exemption whose kind contradicts the chain, or that lacks what its kind requires", () => {
    const r = express.Router();
    r.get("/p", auth, handler);
    r.get("/s", handler);
    r.get("/i", auth, handler);
    r.get("/pend", auth, handler);
    r.get("/acc", auth, handler);
    r.get("/why", auth, handler);
    r.get("/k", auth, handler);
    const ex = {
      "api/fake.route.js": {
        "GET /p": { kind: "public", reason: "claims public, but authenticates" },
        "GET /s": { kind: "self", reason: "claims self, but has no auth at all" },
        "GET /i": { kind: "inline", gate: "missingGuard", reason: "names a guard that is not in the chain" },
        "GET /pend": { kind: "pending", reason: "pending, but on which card?" },
        "GET /acc": { kind: "accepted", reason: "accepted, but by which decision?" },
        "GET /why": { kind: "self", reason: "short" },
        "GET /k": { kind: "whatever", reason: "not a kind the list knows about" },
      },
    };
    const violations = run(r, ex);
    expect(violations).toEqual([
      expect.stringMatching(/GET \/p: listed as public but its chain authenticates/),
      expect.stringMatching(/GET \/s: listed as self but its chain has no auth/),
      expect.stringMatching(/GET \/i: inline gate "missingGuard" is not in the route's chain/),
      expect.stringMatching(/GET \/pend: a pending exemption must name the card/),
      expect.stringMatching(/GET \/acc: an accepted exemption must name the decision/),
      expect.stringMatching(/GET \/why: an exemption needs a reason/),
      expect.stringMatching(/GET \/k: unknown exemption kind/),
    ]);
  });

  it("passes an inline gate present in the chain, and pending/accepted entries that name their card", () => {
    const r = express.Router();
    const ownThingOnly = (req, res, next) => next();
    r.use(ownThingOnly);
    r.get("/i", handler);
    r.get("/pend", auth, handler);
    r.get("/acc", auth, handler);
    const ex = {
      "api/fake.route.js": {
        "GET /i": { kind: "inline", gate: "ownThingOnly", reason: "an inline guard defined in the router" },
        "GET /pend": { kind: "pending", card: "A-999", reason: "another change closes this gap" },
        "GET /acc": { kind: "accepted", decision: "ADR-000", reason: "left at auth by a recorded decision" },
      },
    };
    expect(run(r, ex)).toEqual([]);
  });

  it("FAILS an app-level route that is unlisted, or listed as anything but public", () => {
    const ex = { "index.js": { "GET /listed": { kind: "self", reason: "app routes cannot be self-service" } } };
    const violations = run(express.Router(), ex, { "index.js": ["GET /unlisted", "GET /listed"] });
    expect(violations).toEqual([
      expect.stringMatching(/index\.js GET \/unlisted: registered directly on the app with no exemption/),
      expect.stringMatching(/index\.js GET \/listed: app-level routes can only be listed as public/),
    ]);
  });

  it("reads app-level routes from source, skipping router mounts and static directories", () => {
    const source = [
      'app.get("/", (req, res) => res.end());',
      "app.post('/hook', h);",
      'app.use("/api/v1/users", userRoutes);',
      'app.use("/public", express.static(p));',
      'app.use("/docs", swaggerUi.serve, x);',
      "app.use(notFound);",
    ].join("\n");
    expect(appRoutesIn(source)).toEqual(["GET /", "POST /hook", "USE /docs"]);
  });

  it("reports a path-scoped router.use, which it cannot attribute to routes", () => {
    const r = express.Router();
    r.use("/admin", superAdminOnly);
    r.get("/admin/x", auth, handler);
    expect(walkRouter(r, "api/fake.route.js").problems).toEqual([
      expect.stringMatching(/path-scoped router\.use layer/),
    ]);
  });

  it("finds routers exported as a router or as an object of routers", () => {
    const a = express.Router();
    const b = express.Router();
    expect(routersOf(a)).toEqual([a]);
    expect(routersOf({ a, b, notARouter: 1 })).toEqual([a, b]);
    expect(routersOf(undefined)).toEqual([]);
  });
});
