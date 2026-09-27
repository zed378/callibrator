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
 * Wiring:
 *
 *   jest.mock("../../middlewares/auth.middleware", () => require("../fixtures/routeClient").authMock());
 *   const { as, call } = require("../fixtures/routeClient");
 *   as(principal);                       // or as(principal, { tenantId, impersonatorId })
 *   const res = await call(router, "GET", `/${id}`, { body, query, headers });
 *   res.status, res.body
 */

const state = { principal: null, tenantId: undefined, impersonatorId: null };

/** Act as `principal` (a createTwoTenants principal); null for no principal. */
const as = (principal, { tenantId, impersonatorId = null } = {}) => {
  state.principal = principal;
  state.tenantId = tenantId;
  state.impersonatorId = impersonatorId;
};

/** The auth.middleware module with `auth` replaced (everything else real). */
const authMock = () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  const { tenantContextMiddleware } = jest.requireActual("../../middlewares/tenantContext.middleware");
  const auth = (req, res, next) => {
    if (!state.principal) {
      return res.status(401).json({ success: false, status: 401, message: "Unauthorized" });
    }
    req.user = state.principal;
    req.tenantId = state.tenantId === undefined ? state.principal.tenantId : state.tenantId;
    req.impersonatorId = state.impersonatorId;
    return tenantContextMiddleware(req, res, next);
  };
  return { ...actual, auth };
};

const makeRes = (resolve) => {
  const headers = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    locals: {},
    status(code) {
      res.statusCode = code;
      return res;
    },
    sendStatus(code) {
      res.statusCode = code;
      return res.end();
    },
    json(payload) {
      res.headersSent = true;
      resolve({ status: res.statusCode, body: JSON.parse(JSON.stringify(payload ?? null)), headers });
      return res;
    },
    send(payload) {
      if (payload !== null && typeof payload === "object" && !Buffer.isBuffer(payload)) {
        return res.json(payload);
      }
      res.headersSent = true;
      resolve({ status: res.statusCode, body: payload, headers });
      return res;
    },
    end(payload) {
      res.headersSent = true;
      resolve({ status: res.statusCode, body: payload ?? null, headers });
      return res;
    },
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
      return res;
    },
    set(name, value) {
      if (typeof name === "object") {
        for (const [k, v] of Object.entries(name)) {res.setHeader(k, v);}
        return res;
      }
      return res.setHeader(name, value);
    },
    header(name, value) {
      return res.set(name, value);
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    removeHeader(name) {
      delete headers[String(name).toLowerCase()];
    },
    type(value) {
      return res.setHeader("content-type", value);
    },
    attachment(name) {
      return res.setHeader("content-disposition", `attachment; filename="${name}"`);
    },
    redirect(a, b) {
      res.statusCode = typeof a === "number" ? a : 302;
      res.headersSent = true;
      resolve({ status: res.statusCode, body: null, headers: { ...headers, location: typeof a === "number" ? b : a } });
    },
    download(file) {
      res.headersSent = true;
      resolve({ status: res.statusCode, body: { download: file }, headers });
    },
    sendFile(file) {
      res.headersSent = true;
      resolve({ status: res.statusCode, body: { sendFile: file }, headers });
    },
    cookie() {
      return res;
    },
    clearCookie() {
      return res;
    },
    write() {
      return true;
    },
    on() {
      return res;
    },
    once() {
      return res;
    },
    emit() {
      return true;
    },
  };
  return res;
};

/**
 * Run one request through `router`.
 *
 * @param {Function} router - an Express router (a route module's export)
 * @param {string} method - HTTP verb
 * @param {string} url - path relative to the router's mount point
 * @param {object} [opts] - { body, query, headers, baseUrl, file, files }
 * @returns {Promise<{status: number, body: *, headers: object}>}
 */
const call = (router, method, url, { body = {}, query = {}, headers = {}, baseUrl = "/api/v1/test", file, files } = {}) => {
  const { errorHandler } = jest.requireActual("../../middlewares/errorHandlers.middleware");
  const { notFound } = jest.requireActual("../../middlewares/notFound.middleware");
  return new Promise((resolve) => {
    const res = makeRes(resolve);
    const lower = {};
    for (const [k, v] of Object.entries(headers)) {lower[k.toLowerCase()] = v;}
    const req = {
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
      get(name) {
        return lower[String(name).toLowerCase()];
      },
      header(name) {
        return lower[String(name).toLowerCase()];
      },
      on() {
        return req;
      },
    };
    router.handle(req, res, (err) => {
      if (err) {
        errorHandler(err, req, res, () => {});
      } else {
        notFound(req, res);
      }
    });
  });
};

/**
 * Seed the two fixture tenants (and, optionally, principals as Users rows)
 * into memoryDb, so the real models find them.
 *
 * @param {object} mdb - memoryDb()
 * @param {object} fx - createTwoTenants()
 * @param {object[]} [principals] - principals to insert as users
 */
const seedTenants = (mdb, fx, principals = []) => {
  for (const t of [fx.tenantA, fx.tenantB]) {
    mdb.seed("Tenant", { ...fx.snapshot(t) });
  }
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
 * Give every role full read/write on every menu (the permission MATRIX is
 * not what these tests are about; tenant isolation is). dynamicAccess itself
 * stays real — including its checkTenant and checkSelf branches.
 */
const grantAllMenus = () => {
  const RolesService = require("../../services/roles.service");
  const userPermissionService = require("../../services/userPermission.service");
  const all = new Proxy({}, { get: () => ["read", "write"], has: () => true });
  jest.spyOn(RolesService, "getRolePermissionsMatrix").mockResolvedValue(all);
  jest.spyOn(userPermissionService, "getUserOverrideMatrix").mockResolvedValue({});
};

/**
 * Ask for another tenant's record, then for one that does not exist, and
 * record what changed. The ids are masked in both bodies (a message that
 * echoes the requested id is not a disclosure), so `foreign.body` and
 * `missing.body` compare on everything else.
 *
 * @param {object} mdb - memoryDb()
 * @param {Function} request - (id) => Promise<response>
 * @param {string} foreignId - an id that exists in ANOTHER tenant
 * @param {string} missingId - an id that exists nowhere
 * @returns {Promise<{foreign, missing, tablesBefore, tablesAfter, committed}>}
 */
const probeCrossTenant = async (mdb, request, foreignId, missingId) => {
  const tablesBefore = mdb.dump();
  const writesBefore = mdb.committed().length;
  const mask = (res, id) => ({
    ...res,
    body: JSON.parse(JSON.stringify(res.body ?? null).split(id).join("<id>")),
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

module.exports = { as, authMock, call, seedTenants, grantAllMenus, probeCrossTenant };
