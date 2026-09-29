/**
 * routeClient — drive a REAL router the way the app does, as a chosen
 * principal, for two-tenant route tests.
 *
 * The chain that runs is the production chain of the route module: every
 * middleware it registers (validateUuid, dynamicAccess, rbac, abac,
 * denyPlatformAuthoring, validate, ...), the controller and the service. Only
 * `auth` is replaced — by `authMock()`, which sets `req.user` / `req.tenantId`
 * / `req.impersonatorId` as auth.middleware does and then calls the REAL
 * `tenantContextMiddleware`, so the tenant hooks see exactly the context a
 * live request would give them. An error reaches the REAL `errorHandler`, an
 * unmatched path the REAL `notFound`, as they do behind index.js.
 *
 * Wiring (see routes/qms.twoTenant.test.ts):
 *
 *   jest.mock("../../middlewares/auth.middleware", () =>
 *     jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock());
 *   as(principal);                       // or as(principal, { tenantId, impersonatorId })
 *   const res = await call(router, "GET", `/${id}`, { body, query, headers });
 */
import type * as AuthMiddleware from "../../middlewares/auth.middleware";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as ErrorHandlers from "../../middlewares/errorHandlers.middleware";
import type * as NotFound from "../../middlewares/notFound.middleware";
import type * as TwoTenants from "./twoTenants";
import type { MemoryDb } from "./memoryDb";

/** A principal shaped as auth.middleware builds `req.user` (fixtures/twoTenants). */
export interface Principal {
  readonly id: string;
  readonly username: string;
  readonly tenantId: string;
  readonly tenant: { id: string; name: string; status: string };
  readonly role: { id: string; name: string; roleLevel: number };
  readonly isActive: boolean;
  readonly status: string;
  readonly isApiKey: boolean;
  readonly mfaEnabled?: boolean;
  /** An API-key principal's scopes (auth.middleware#tryApiKeyAuth). */
  readonly apiKeyScopes?: readonly string[];
}

/** A tenant row of fixtures/twoTenants. */
export interface TenantRow {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly status: string;
}

/** createTwoTenants(), typed. */
export interface TwoTenantWorld {
  readonly tenantA: TenantRow;
  readonly tenantB: TenantRow;
  readonly superAdmin: Principal;
  principal(tenant: TenantRow, role: string): Principal;
  snapshot(tenant: TenantRow): Record<string, unknown>;
}

/** A response as the router gave it. */
export interface RouteResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Record<string, unknown>;
}

export interface CallOptions {
  readonly body?: unknown;
  readonly query?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
  readonly baseUrl?: string;
  readonly file?: unknown;
  readonly files?: unknown;
}

interface AuthState {
  principal: Principal | null;
  tenantId: string | null | undefined;
  impersonatorId: string | null;
}

const state: AuthState = { principal: null, tenantId: undefined, impersonatorId: null };

type Next = (err?: unknown) => void;
type Handler = (req: unknown, res: unknown, next: Next) => unknown;
type RouterLike = unknown;

/** createTwoTenants(), typed for TypeScript tests. */
export const twoTenants = (): TwoTenantWorld => {
  const { createTwoTenants } = jest.requireActual<typeof TwoTenants>("./twoTenants");
  return createTwoTenants() as unknown as TwoTenantWorld;
};

/** Act as `principal`; null for no principal (401). */
export const as = (
  principal: Principal | null,
  { tenantId, impersonatorId = null }: { tenantId?: string | null; impersonatorId?: string | null } = {},
): void => {
  state.principal = principal;
  state.tenantId = tenantId;
  state.impersonatorId = impersonatorId;
};

/** The auth.middleware module with `auth` replaced (everything else real). */
export const authMock = (): typeof AuthMiddleware => {
  const actual = jest.requireActual<typeof AuthMiddleware>("../../middlewares/auth.middleware");
  const { tenantContextMiddleware } = jest.requireActual<typeof TenantContext>(
    "../../middlewares/tenantContext.middleware",
  );
  const run = tenantContextMiddleware as unknown as Handler;
  const auth: Handler = (req, res, next) => {
    const r = req as Record<string, unknown>;
    if (!state.principal) {
      const out = res as { status: (c: number) => { json: (b: unknown) => unknown } };
      return out.status(401).json({ success: false, status: 401, message: "Unauthorized" });
    }
    r["user"] = state.principal;
    r["tenantId"] = state.tenantId === undefined ? state.principal.tenantId : state.tenantId;
    r["impersonatorId"] = state.impersonatorId;
    return run(req, res, next);
  };
  return { ...actual, auth } as unknown as typeof AuthMiddleware;
};

const makeRes = (resolve: (r: RouteResponse) => void): Record<string, unknown> => {
  const headers: Record<string, unknown> = {};
  const res: Record<string, unknown> & { statusCode: number; headersSent: boolean } = {
    statusCode: 200,
    headersSent: false,
    locals: {},
  };
  const done = (body: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => {
    res.headersSent = true;
    resolve({ status: res.statusCode, body, headers: { ...headers, ...extra } });
    return res;
  };
  const setHeader = (name: string, value: unknown): Record<string, unknown> => {
    headers[name.toLowerCase()] = value;
    return res;
  };
  Object.assign(res, {
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    sendStatus(code: number) {
      res.statusCode = code;
      return done(null);
    },
    json(payload: unknown) {
      return done(JSON.parse(JSON.stringify(payload ?? null)) as unknown);
    },
    send(payload: unknown) {
      if (payload !== null && typeof payload === "object" && !Buffer.isBuffer(payload)) {
        return done(JSON.parse(JSON.stringify(payload)) as unknown);
      }
      return done(payload);
    },
    end(payload?: unknown) {
      return done(payload ?? null);
    },
    setHeader,
    set(name: string | Record<string, unknown>, value?: unknown) {
      if (typeof name === "object") {
        for (const [k, v] of Object.entries(name)) {
          setHeader(k, v);
        }
        return res;
      }
      return setHeader(name, value);
    },
    header(name: string, value: unknown) {
      return setHeader(name, value);
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    removeHeader(name: string) {
      headers[name.toLowerCase()] = undefined;
    },
    type(value: string) {
      return setHeader("content-type", value);
    },
    attachment(name: string) {
      return setHeader("content-disposition", `attachment; filename="${name}"`);
    },
    redirect(a: number | string, b?: string) {
      res.statusCode = typeof a === "number" ? a : 302;
      return done(null, { location: typeof a === "number" ? b : a });
    },
    download(file: unknown) {
      return done({ download: file });
    },
    sendFile(file: unknown) {
      return done({ sendFile: file });
    },
    cookie: () => res,
    clearCookie: () => res,
    write: () => true,
    on: () => res,
    once: () => res,
    emit: () => true,
  });
  return res;
};

/**
 * Run one request through `router`.
 *
 * @param router - an Express router (a route module's export)
 * @param method - HTTP verb
 * @param url - path relative to the router's mount point
 * @param opts - body, query, headers, baseUrl, file, files
 * @returns the status, body and headers the chain answered with
 */
export const call = (router: RouterLike, method: string, url: string, opts: CallOptions = {}): Promise<RouteResponse> => {
  const { errorHandler } = jest.requireActual<typeof ErrorHandlers>("../../middlewares/errorHandlers.middleware");
  const { notFound } = jest.requireActual<typeof NotFound>("../../middlewares/notFound.middleware");
  const { body = {}, query = {}, headers = {}, baseUrl = "/api/v1/test", file, files } = opts;
  return new Promise((resolve) => {
    const res = makeRes(resolve);
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      lower[k.toLowerCase()] = v;
    }
    const req: Record<string, unknown> = {
      method: method.toUpperCase(),
      url,
      originalUrl: baseUrl + url,
      baseUrl: "",
      path: url.split("?")[0],
      body,
      query,
      params: {},
      headers: lower,
      ip: "127.0.0.1",
      ips: [],
      protocol: "https",
      secure: true,
      hostname: "callibrator.test",
      requestId: "two-tenant-test",
      socket: { remoteAddress: "127.0.0.1" },
      connection: { remoteAddress: "127.0.0.1" },
      file,
      files,
      get: (name: string) => lower[name.toLowerCase()],
      header: (name: string) => lower[name.toLowerCase()],
      on: () => req,
    };
    const handle = (router as { handle: (q: unknown, s: unknown, done: Next) => void }).handle.bind(router);
    handle(req, res, (err?: unknown) => {
      if (err) {
        (errorHandler as unknown as (e: unknown, q: unknown, s: unknown, n: Next) => void)(err, req, res, () => undefined);
      } else {
        (notFound as unknown as (q: unknown, s: unknown) => void)(req, res);
      }
    });
  });
};

/**
 * Seed the two fixture tenants (and principals as Users rows) into memoryDb,
 * so the real models find them. `overrides` adds or replaces tenant columns
 * (e.g. a logo) on either tenant row.
 */
export const seedTenants = (
  mdb: MemoryDb,
  fx: TwoTenantWorld,
  principals: readonly Principal[] = [],
  overrides: { a?: Record<string, unknown>; b?: Record<string, unknown> } = {},
): void => {
  mdb.seed("Tenant", { ...fx.snapshot(fx.tenantA), ...overrides.a });
  mdb.seed("Tenant", { ...fx.snapshot(fx.tenantB), ...overrides.b });
  for (const p of principals) {
    mdb.seed("User", {
      id: p.id,
      tenantId: p.tenantId,
      username: p.username,
      name: p.username,
      email: `${p.username}@${p.tenantId.slice(0, 8)}.test`,
      password: "not-a-hash",
      roleId: p.role.id,
      status: "ACTIVE",
      isActive: true,
    });
  }
};

/**
 * Give every role full read/write on every menu (the permission MATRIX is not
 * what these tests are about; tenant isolation is). dynamicAccess itself stays
 * real — including its checkTenant and checkSelf branches.
 */
interface MatrixSource {
  getRolePermissionsMatrix(roleId: string): Promise<Record<string, string[]>>;
}
interface OverrideSource {
  getUserOverrideMatrix(userId: string): Promise<Record<string, string>>;
}

export const grantAllMenus = (): void => {
  // Both modules are JavaScript whose inferred shapes jest.spyOn cannot key;
  // these are the two functions dynamicAccess calls.
  const roles = jest.requireActual<MatrixSource>("../../services/roles.service");
  const overrides = jest.requireActual<OverrideSource>("../../services/userPermission.service");
  const all: Record<string, string[]> = new Proxy({}, { get: () => ["read", "write"], has: () => true });
  jest.spyOn(roles, "getRolePermissionsMatrix").mockResolvedValue(all);
  jest.spyOn(overrides, "getUserOverrideMatrix").mockResolvedValue({});
};

export interface CrossTenantProbe {
  readonly foreign: RouteResponse;
  readonly missing: RouteResponse;
  readonly tablesBefore: Record<string, unknown>;
  readonly tablesAfter: Record<string, unknown>;
  readonly committed: unknown[];
}

/**
 * Ask for another tenant's record, then for one that does not exist, and
 * record what changed. The ids are masked in both bodies (a message that
 * echoes the requested id is not a disclosure), so `foreign.body` and
 * `missing.body` compare on everything else.
 */
export const probeCrossTenant = async (
  mdb: MemoryDb,
  request: (id: string) => Promise<RouteResponse>,
  foreignId: string,
  missingId: string,
): Promise<CrossTenantProbe> => {
  const tablesBefore = mdb.dump();
  const writesBefore = mdb.committed().length;
  const mask = (res: RouteResponse, id: string): RouteResponse => ({
    ...res,
    body: JSON.parse(JSON.stringify(res.body ?? null).split(id).join("<id>")) as unknown,
  });
  const foreign = mask(await request(foreignId), foreignId);
  const missing = mask(await request(missingId), missingId);
  return {
    foreign,
    missing,
    tablesBefore,
    tablesAfter: mdb.dump(),
    committed: mdb.committed().slice(writesBefore),
  };
};
