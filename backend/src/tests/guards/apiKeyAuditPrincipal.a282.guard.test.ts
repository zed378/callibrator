/**
 * A-282 (ADR-094, ADR-100) — a route an API key can reach never audits the
 * key's id as a user.
 *
 * WHY
 *
 * An API key authenticates as a synthetic principal whose `id` is the KEY's id
 * (auth.middleware#tryApiKeyAuth). `audit_logs.user_id` references `users`
 * (migration 0030), so an audit row naming `req.user.id` as its user fails its
 * foreign key on PostgreSQL and the mutation it belongs to rolls back — the key
 * can never write, and a unit test with a mocked model never notices.
 * `utils/auditPrincipal.util.ts` records a key as the system actor
 * `system:api-key` with the key's id in `changes.apiKeyId`.
 *
 * HOW
 *
 * 1. Every route module is required and its Express stack walked (as
 *    routePermissionGuard.p604 and twoTenantRoutes.guard do). A route is
 *    REACHABLE BY A KEY when its chain authenticates, carries a middleware
 *    that authorizes a key (`req.apiKeyAuthorized = true` — dynamicAccess's
 *    scope check or the SCIM gate — V-05 removed allowApiKey), and carries nothing that refuses
 *    one (denyApiKey, superAdminOnly, an rbac or role-level gate: a key's role
 *    is `API_KEY`, level 0). utils/controllerWrapper refuses a key that no gate
 *    authorized, so a chain without an authorizing gate is not reachable.
 * 2. The route's handler (the last function of the chain) is matched by
 *    identity to a controller export, and that export's source — with every
 *    same-file helper it calls, transitively — is read.
 * 3. The source may not build an audit actor with `auditActor(` (it names
 *    `req.user.id` as the user) or name `req.user.id` as an audit `userId:`.
 *    It uses `auditPrincipal(req)` instead.
 *
 * LIMITS (stated, not hidden): the check reads the controller layer. A service
 * that receives a bare user id and audits with it is caught only where the
 * controller builds that id with one of the two patterns above; the services
 * converted under A-282 are proved by their own behaviour suites.
 *
 * The check is tested in both directions at the bottom on synthetic inputs.
 */
import fs from "node:fs";
import path from "node:path";

type Handler = (...args: unknown[]) => unknown;

const SRC = path.join(__dirname, "..", "..");
const ROUTES_DIR = path.join(SRC, "routes");
const CONTROLLERS_DIR = path.join(SRC, "controllers");

// ---------------------------------------------------------------------------
// Tag the role gates before any router loads. Nothing is replaced.
// ---------------------------------------------------------------------------

const ROLE_GATE = Symbol.for("callibrator.a282.roleGate");
interface RbacModule {
  rbac: (...args: unknown[]) => Handler;
  checkRoleLevel: (...args: unknown[]) => Handler;
}
const rbacModule = jest.requireActual<RbacModule>("../../middlewares/rbac.middleware");
for (const name of ["rbac", "checkRoleLevel"] as const) {
  const real = rbacModule[name];
  rbacModule[name] = (...args: unknown[]): Handler => {
    const middleware = real(...args);
    Object.defineProperty(middleware, ROLE_GATE, { value: name });
    return middleware;
  };
}

interface AuthModule {
  auth: Handler;
  optionalAuth: Handler;
  superAdminOnly: Handler;
  denyApiKey: Handler;
}
const authModule = jest.requireActual<AuthModule>("../../middlewares/auth.middleware");

// ---------------------------------------------------------------------------
// Pure helpers (tested at the bottom)
// ---------------------------------------------------------------------------

const AUTHORIZES_KEY = /apiKeyAuthorized\s*=\s*true/;

/** Does this chain let an API key through to its handler? */
const keyReachable = (chain: readonly unknown[]): boolean => {
  const fns = chain.filter((fn): fn is Handler => typeof fn === "function");
  const authenticates = fns.some((fn) => fn === authModule.auth || fn === authModule.optionalAuth);
  const refuses = fns.some(
    (fn) =>
      fn === authModule.denyApiKey ||
      fn === authModule.superAdminOnly ||
      (fn as unknown as Record<symbol, unknown>)[ROLE_GATE] !== undefined,
  );
  const authorizes = fns.some((fn) => AUTHORIZES_KEY.test(Function.prototype.toString.call(fn)));
  return authenticates && authorizes && !refuses;
};

/**
 * The text of one balanced statement starting at `start`: runs until the
 * brackets opened after `start` are closed and the statement ends.
 */
const statementAt = (source: string, start: number): string => {
  let depth = 0;
  let opened = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      opened = true;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
    }
    if (opened && depth === 0 && (ch === ";" || ch === "\n" || ch === "}" || ch === ")")) {
      // A function declaration ends at its closing brace; an expression at ; or newline.
      const next = /^[ \t]*([;,\n]|$)/.exec(source.slice(i + 1));
      if (ch === ";" || ch === "\n" || next) {
        return source.slice(start, i + 1);
      }
    }
  }
  return source.slice(start);
};

const escape = (name: string): string => name.replace(/[$]/g, "\\$");

/** Where `name` is defined in `source` (exports.x =, const x =, function x(, x: in an object). */
const definitionOf = (source: string, name: string): string | null => {
  const n = escape(name);
  const patterns = [
    new RegExp(`(?:^|\\n)\\s*(?:module\\.)?exports\\.${n}\\s*=`),
    new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:const|let|var)\\s+${n}\\s*=`),
    new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*${n}\\s*\\(`),
    new RegExp(`(?:^|\\n)\\s*${n}\\s*:\\s*(?:asyncHandler|async|\\()`),
  ];
  for (const re of patterns) {
    const m = re.exec(source);
    if (m) {
      return statementAt(source, m.index + (m[0].startsWith("\n") ? 1 : 0));
    }
  }
  return null;
};

/** The export's source plus every same-file helper it calls, transitively. */
const sourceOfExport = (source: string, name: string): string | null => {
  const root = definitionOf(source, name);
  if (root === null) {
    return null;
  }
  const seen = new Set<string>([name]);
  const parts = [root];
  // An array iterator also visits the helpers pushed while it runs.
  for (const part of parts) {
    for (const m of part.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const callee = m[1] ?? "";
      if (seen.has(callee)) {
        continue;
      }
      seen.add(callee);
      const def = definitionOf(source, callee);
      if (def !== null) {
        parts.push(def);
      }
    }
  }
  return parts.join("\n");
};

const RAW_ACTOR = [
  { re: /\bauditActor\s*\(/, what: "auditActor(" },
  { re: /\buserId\s*:\s*req\.user\??\.id\b/, what: "userId: req.user.id" },
];

/** The raw-actor patterns this source uses. */
const rawActorUses = (text: string): string[] => RAW_ACTOR.filter((p) => p.re.test(text)).map((p) => p.what);

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

const listFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(full);
    }
    return /\.(js|ts)$/.test(entry.name) && !/\.(openapi|d)\.ts$/.test(entry.name) ? [full] : [];
  });

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

const isRouter = (value: unknown): value is { stack: unknown[] } =>
  typeof value === "function" && Array.isArray((value as { stack?: unknown }).stack);

interface LayerLike {
  readonly route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  readonly handle: unknown;
}

interface KeyRoute {
  readonly id: string;
  readonly handler: unknown;
}

const keyReachableRoutes = (): { all: number; routes: KeyRoute[] } => {
  let all = 0;
  const routes: KeyRoute[] = [];
  for (const full of listFiles(ROUTES_DIR)) {
    const exported = jest.requireActual<object>(full);
    const routers = isRouter(exported)
      ? [exported]
      : Object.values(exported as Record<string, unknown>).filter(isRouter);
    for (const router of routers) {
      const before: unknown[] = [];
      for (const layer of router.stack as LayerLike[]) {
        if (!layer.route) {
          before.push(layer.handle);
          continue;
        }
        const own = layer.route.stack.map((s) => s.handle);
        const chain = [...before, ...own];
        for (const method of Object.keys(layer.route.methods)) {
          all++;
          if (keyReachable(chain)) {
            routes.push({ id: `${rel(full)} ${method.toUpperCase()} ${layer.route.path}`, handler: own[own.length - 1] });
          }
        }
      }
    }
  }
  return { all, routes };
};

interface ControllerExport {
  readonly file: string;
  readonly name: string;
}

const controllerExports = (): Map<unknown, ControllerExport> => {
  const map = new Map<unknown, ControllerExport>();
  for (const full of listFiles(CONTROLLERS_DIR)) {
    const exported = jest.requireActual<Record<string, unknown>>(full);
    for (const [name, value] of Object.entries(exported)) {
      if (typeof value === "function" && !map.has(value)) {
        map.set(value, { file: full, name });
      }
    }
  }
  return map;
};

// ---------------------------------------------------------------------------
// Offenders another change owns. Each entry is an open defect, not an
// exemption: it names who is converting it, and the guard fails once the
// handler is clean so the entry cannot outlive the fix.
// ---------------------------------------------------------------------------

const PENDING_OWNER: Readonly<Record<string, string>> = {
};

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

describe("A-282 — a route an API key can reach audits the key as system:api-key", () => {
  const { all, routes } = keyReachableRoutes();
  const exportsByHandler = controllerExports();

  it("the walk found routes, and key-reachable ones among them (a scan that finds nothing is not a pass)", () => {
    expect(all).toBeGreaterThan(300);
    expect(routes.length).toBeGreaterThan(50);
  });

  it("every key-reachable handler is a controller export this guard can read", () => {
    const unread = routes
      .filter((r) => {
        const target = exportsByHandler.get(r.handler);
        return !target || sourceOfExport(fs.readFileSync(target.file, "utf8"), target.name) === null;
      })
      .map((r) => r.id);
    expect(unread).toEqual([]);
  });

  /** Every key-reachable handler that uses a raw actor, by `file#export`. */
  const offending = (): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const route of routes) {
      const target = exportsByHandler.get(route.handler);
      if (!target) {
        continue;
      }
      const text = sourceOfExport(fs.readFileSync(target.file, "utf8"), target.name) ?? "";
      const uses = rawActorUses(text);
      if (uses.length > 0) {
        const id = `${rel(target.file)}#${target.name}`;
        out.set(id, [...(out.get(id) ?? []), `${route.id}: ${uses.join(", ")}`]);
      }
    }
    return out;
  };

  it("no key-reachable handler names req.user.id as an audit user (auditActor / userId: req.user.id)", () => {
    const offenders = [...offending()]
      .filter(([id]) => !(id in PENDING_OWNER))
      .flatMap(([id, uses]) => uses.map((u) => `${u} -> ${id}`));
    expect(offenders).toEqual([]);
  });

  it("every PENDING_OWNER entry is still an offender (no stale entry outlives its fix)", () => {
    const live = offending();
    const stale = Object.keys(PENDING_OWNER).filter((id) => !live.has(id));
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The guard's own logic, in both directions
// ---------------------------------------------------------------------------

describe("A-282 guard — its checks", () => {
  const authorizing: Handler = (req) => {
    (req as { apiKeyAuthorized?: boolean }).apiKeyAuthorized = true;
  };
  const plain: Handler = () => undefined;

  it("a chain with auth and a key-authorizing gate is reachable", () => {
    expect(keyReachable([authModule.auth, authorizing, plain])).toBe(true);
  });

  it("a chain without auth, without an authorizing gate, or with a refusing gate is not", () => {
    expect(keyReachable([authorizing, plain])).toBe(false);
    expect(keyReachable([authModule.auth, plain])).toBe(false);
    expect(keyReachable([authModule.auth, authModule.denyApiKey, authorizing, plain])).toBe(false);
    expect(keyReachable([authModule.auth, authModule.superAdminOnly, authorizing, plain])).toBe(false);
    expect(keyReachable([authModule.auth, rbacModule.rbac(["TENANT_ADMIN"]), authorizing, plain])).toBe(false);
  });

  it("reads an export and the same-file helpers it calls, and flags the raw actor", () => {
    const source = [
      'const { auditActor } = require("../utils/auditActor.util");',
      "const actorOf = (req) => auditActor(req);",
      "exports.bad = asyncHandler(async (req, res) => {",
      "  await svc.create(req.body, actorOf(req));",
      "});",
      "exports.alsoBad = asyncHandler(async (req, res) => {",
      "  await auditService.logAction({ userId: req.user?.id, action: 'X' }, { transaction });",
      "});",
      "exports.good = asyncHandler(async (req, res) => {",
      "  await svc.create(req.body, auditPrincipal(req));",
      "});",
    ].join("\n");
    expect(rawActorUses(sourceOfExport(source, "bad") ?? "")).toEqual(["auditActor("]);
    expect(rawActorUses(sourceOfExport(source, "alsoBad") ?? "")).toEqual(["userId: req.user.id"]);
    expect(rawActorUses(sourceOfExport(source, "good") ?? "")).toEqual([]);
    expect(sourceOfExport(source, "missing")).toBeNull();
  });

  it("finds const, function and object-literal definitions", () => {
    const source = [
      "const a = asyncHandler(async (req) => { auditActor(req); });",
      "async function b(req) {",
      "  return 1;",
      "}",
      "module.exports = {",
      "  c: asyncHandler(async (req) => ({ userId: req.user.id })),",
      "  a,",
      "};",
    ].join("\n");
    expect(rawActorUses(sourceOfExport(source, "a") ?? "")).toEqual(["auditActor("]);
    expect(sourceOfExport(source, "b")).toContain("return 1;");
    expect(rawActorUses(sourceOfExport(source, "c") ?? "")).toEqual(["userId: req.user.id"]);
  });
});
