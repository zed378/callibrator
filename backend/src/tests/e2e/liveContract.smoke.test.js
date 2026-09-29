/**
 * LIVE CONTRACT SMOKE — every API route and every frontend service call,
 * against a RUNNING backend. Opt-in: skipped unless LIVE_CONTRACT=1.
 *
 * Why this exists: "A mock proves the client, not the contract. 3,863 tests
 * passed here while 13 endpoints were broken" (CLAUDE.md). This file mocks
 * nothing. It
 *
 *   1. walks the REAL Express router stack — every module index.js mounts,
 *      loaded in a child process (`node <this file> --dump-routes <out>`) with
 *      `validate()` and `dynamicAccess()` tagged so each route carries its Joi
 *      schema and its permission gate;
 *   2. signs in the principals the way a user does: the platform operator
 *      (enrolling TOTP through /auth/mfa/setup + /auth/mfa/verify with the
 *      real otplib when it has none), a tenant admin and a technician in the
 *      default tenant, and a tenant admin and a technician in a second tenant
 *      (created through the API by the operator when missing);
 *   3. sends every route a well-formed request as the appropriate principal —
 *      GETs first, then writes (bodies from the route's Joi schema, then
 *      completed from the 400's own validation details), destructive and
 *      session-ending routes last — and records the status, the envelope
 *      (`success`, `status`, `message`, `data`; rows IN `data` and pagination
 *      in a TOP-LEVEL `meta` for lists) and every 5xx;
 *   4. walks frontend/src/api/services/*.ts: every api.get/post/put/patch/
 *      delete call must name a method + path that exists in the real router,
 *      and a service that reads `data.rows`, `data.items` or `data.meta`
 *      from an endpoint whose live `data` is an array is flagged.
 *
 * Run it (the backend must be up, seeded with /migration/seeding and
 * /migration/seed-demo; see the report header for what else it needs):
 *
 *   LIVE_CONTRACT=1 LIVE_CONTRACT_BASE_URL=http://127.0.0.1:5000 \
 *     npx jest --config jest.e2e.config.js src/tests/e2e/liveContract.smoke.test.js
 *
 * The child process that dumps the routes loads the route modules, so it needs
 * the same env the server has (the jest e2e config loads backend/.env).
 *
 * Output: a JSON report at LIVE_CONTRACT_REPORT (default: the OS temp dir,
 * `callibrator-live-contract.json`). The test FAILS on any 5xx, any envelope
 * violation, and any frontend call to a route that does not exist.
 *
 * It WRITES to the database it runs against — use a throwaway one.
 */

/* eslint-disable no-console */
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const BACKEND_ROOT = path.resolve(__dirname, "../../..");
const REPO_ROOT = path.resolve(BACKEND_ROOT, "..");

// ============================================================
// 1. ROUTE DISCOVERY (child process)
// ============================================================

/** Joi describe() of a schema, JSON-safe. */
const describeSchema = (schema) => {
  try {
    return JSON.parse(JSON.stringify(schema.describe()));
  } catch {
    return null;
  }
};

const joinPath = (a, b) => {
  const joined = `${a || ""}/${b || ""}`.replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
};

/**
 * Load every router index.js mounts and flatten it to
 * [{ method, path, middlewares: [{name, access, schema, rbac, uuidParams}] }].
 */
function dumpRoutes(outFile) {
  // Tag the Router so a nested `router.use("/x", sub)` keeps its mount path
  // (router 2.x does not store it on the layer).
  const expressPath = require.resolve("express", { paths: [BACKEND_ROOT] });
  const Router = require(require.resolve("router", { paths: [path.dirname(expressPath)] }));
  const originalUse = Router.prototype.use;
  Router.prototype.use = function taggedUse(...args) {
    const before = this.stack.length;
    const result = originalUse.apply(this, args);
    const mount = typeof args[0] === "string" ? args[0] : "/";
    for (let i = before; i < this.stack.length; i += 1) {
      this.stack[i].__mount = mount;
    }
    return result;
  };

  const mw = (rel) => require(path.join(BACKEND_ROOT, "src/middlewares", rel));
  const validation = mw("validation.middleware");
  const originalValidate = validation.validate;
  validation.validate = (schema) =>
    Object.assign(originalValidate(schema), { __schema: describeSchema(schema) });
  const dyn = mw("dynamicAccess.middleware");
  const originalDyn = dyn.dynamicAccess;
  dyn.dynamicAccess = (menu, perm, options) =>
    Object.assign(originalDyn(menu, perm, options), {
      __access: { menu, perm, options: options || {} },
    });
  const rbacMod = mw("rbac.middleware");
  const originalRbac = rbacMod.rbac;
  rbacMod.rbac = (roles, options) =>
    Object.assign(originalRbac(roles, options), { __rbac: roles });
  const uuidMod = mw("validateUuid.middleware");
  const originalUuid = uuidMod.validateUuid;
  uuidMod.validateUuid = (...names) =>
    Object.assign(originalUuid(...names), { __uuid: names.flat() });

  // index.js is the source of truth for the mounts.
  const indexSrc = fs.readFileSync(path.join(BACKEND_ROOT, "index.js"), "utf8");
  const modules = {};
  for (const m of indexSrc.matchAll(/const (\w+) = require\("(\.\/src\/routes\/[^"]+)"\)/g)) {
    modules[m[1]] = { file: m[2] };
  }
  for (const m of indexSrc.matchAll(/const \{([^}]+)\} = require\("(\.\/src\/routes\/[^"]+)"\)/g)) {
    for (const name of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      modules[name] = { file: m[2], exportName: name };
    }
  }
  const mounts = [];
  for (const m of indexSrc.matchAll(/app\.use\((?:"([^"]+)",\s*)?(\w+)\);/g)) {
    if (modules[m[2]]) {
      mounts.push({ prefix: m[1] || "/", ...modules[m[2]], variable: m[2] });
    }
  }

  const describeMw = (fn) => {
    const d = { name: fn.name || "<anonymous>" };
    if (fn.__access) {d.access = fn.__access;}
    if (fn.__schema) {d.schema = fn.__schema;}
    if (fn.__rbac) {d.rbac = fn.__rbac;}
    if (fn.__uuid) {d.uuidParams = fn.__uuid;}
    return d;
  };

  const routes = [];
  const walk = (stack, prefix, inherited, mount) => {
    let routerLevel = [...inherited];
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        const methods = Object.keys(layer.route.methods).filter(
          (k) => layer.route.methods[k] && k !== "_all",
        );
        for (const p of paths) {
          for (const method of methods) {
            routes.push({
              method: method.toUpperCase(),
              path: joinPath(prefix, String(p)),
              mount,
              middlewares: [
                ...routerLevel,
                ...layer.route.stack.filter((l) => !l.method || l.method === method).map((l) => describeMw(l.handle)),
              ],
            });
          }
        }
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        walk(layer.handle.stack, joinPath(prefix, layer.__mount || "/"), routerLevel, mount);
      } else if ((layer.__mount || "/") === "/") {
        routerLevel = [...routerLevel, describeMw(layer.handle)];
      }
    }
  };

  for (const m of mounts) {
    const loaded = require(path.join(BACKEND_ROOT, m.file));
    const router = m.exportName ? loaded[m.exportName] : loaded;
    walk(router.stack, m.prefix, [], `${m.variable}@${m.prefix}`);
  }
  fs.writeFileSync(outFile, JSON.stringify({ mounts, routes }, null, 2));
}

/** Run the dumper in a child process (it loads the app's modules). */
function loadRoutes() {
  const out = path.join(os.tmpdir(), `callibrator-live-routes-${process.pid}.json`);
  const child = spawnSync(process.execPath, [__filename, "--dump-routes", out], {
    cwd: BACKEND_ROOT,
    // Without JEST_WORKER_ID: the child is the CLI, not a Jest worker (see the
    // guard at the bottom of this file).
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "JEST_WORKER_ID")),
    encoding: "utf8",
    timeout: 180000,
  });
  if (child.status !== 0) {
    throw new Error(`route dump failed (${child.status}): ${child.stderr || child.stdout}`);
  }
  const dumped = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.unlinkSync(out);
  return dumped;
}

// ============================================================
// 2. HTTP + PRINCIPALS
// ============================================================

const BASE_URL = (process.env.LIVE_CONTRACT_BASE_URL || process.env.BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const OPERATOR = {
  user: process.env.LIVE_CONTRACT_OPERATOR || "sys@mail.com",
  password: process.env.LIVE_CONTRACT_OPERATOR_PASSWORD || "123123",
};
const DEMO_PASSWORD = "Demo123!";
const PRINCIPAL_PASSWORD = "LiveContract#2026";
const RUN = crypto.randomBytes(3).toString("hex");

async function http(method, url, { token, body, headers = {}, timeoutMs = 40000 } = {}) {
  const started = Date.now();
  const init = {
    method,
    headers: { "Content-Type": "application/json", "User-Agent": "Callibrator-LiveContract/1.0", ...headers },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (token) {init.headers.Authorization = `Bearer ${token}`;}
  if (body !== undefined && method !== "GET" && method !== "HEAD") {init.body = JSON.stringify(body);}
  try {
    const resp = await fetch(`${BASE_URL}${url}`, init);
    const ct = resp.headers.get("content-type") || "";
    let json = null;
    let text = null;
    if (ct.includes("json")) {
      text = await resp.text();
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    } else {
      await resp.arrayBuffer().catch(() => null);
    }
    return { status: resp.status, contentType: ct, body: json, text, ms: Date.now() - started };
  } catch (err) {
    return { status: 0, contentType: "", body: null, error: err.message, ms: Date.now() - started };
  }
}

// ---- TOTP through the real otplib (the library the backend verifies with) --
const otplib = () => require(require.resolve("otplib", { paths: [BACKEND_ROOT] }));
const usedSteps = new Map();
async function totp(secret, who) {
  for (;;) {
    const now = Math.floor(Date.now() / 30000);
    const last = usedSteps.get(who) ?? -1;
    const step = [now - 1, now, now + 1].find((s) => s > last);
    if (step !== undefined) {
      usedSteps.set(who, step);
      return otplib().generateSync({ secret, epoch: step * 30 + 1 });
    }
    await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 50));
  }
}

const MFA_STATE_FILE =
  process.env.LIVE_CONTRACT_MFA_STATE || path.join(os.tmpdir(), "callibrator-live-contract-mfa.json");
const readMfa = () => {
  try {
    return JSON.parse(fs.readFileSync(MFA_STATE_FILE, "utf8"));
  } catch {
    return {};
  }
};
const writeMfa = (state) => fs.writeFileSync(MFA_STATE_FILE, JSON.stringify(state), { mode: 0o600 });

/** Password sign-in; enrols or answers TOTP when the account needs it. */
async function signIn(credentials) {
  const who = credentials.user;
  let r = await http("POST", "/api/v1/auth/login", { body: credentials });
  if (r.status !== 200) {throw new Error(`sign-in of ${who} failed: ${r.status} ${r.text || r.error}`);}
  if (r.body?.data?.mfaEnrolmentRequired && r.body.token) {
    const setup = await http("POST", "/api/v1/auth/mfa/setup", { token: r.body.token, body: {} });
    const secret = setup.body?.data?.secret;
    if (setup.status !== 200 || !secret) {throw new Error(`MFA setup for ${who}: ${setup.status} ${setup.text}`);}
    const verify = await http("POST", "/api/v1/auth/mfa/verify", {
      token: r.body.token,
      body: { code: await totp(secret, who) },
    });
    if (verify.status !== 200) {throw new Error(`MFA verify for ${who}: ${verify.status} ${verify.text}`);}
    writeMfa({ ...readMfa(), [who]: secret });
    r = await http("POST", "/api/v1/auth/login", { body: credentials });
  }
  if (r.body?.data?.mfaRequired && r.body.token) {
    const secret = process.env.LIVE_CONTRACT_OPERATOR_TOTP_SECRET || readMfa()[who];
    if (!secret) {throw new Error(`${who} has MFA and no known secret (LIVE_CONTRACT_OPERATOR_TOTP_SECRET)`);}
    r = await http("POST", "/api/v1/auth/mfa/login", {
      body: { token: r.body.token, code: await totp(secret, who) },
    });
    if (r.status !== 200) {throw new Error(`MFA sign-in of ${who}: ${r.status} ${r.text}`);}
  }
  if (!r.body?.token) {throw new Error(`sign-in of ${who} returned no token: ${r.text}`);}
  return { token: r.body.token, user: r.body.data, credentials };
}

// ============================================================
// 3. REQUEST SYNTHESIS
// ============================================================

const uuid = () => crypto.randomUUID();
const rand = () => crypto.randomBytes(3).toString("hex");
const iso = (days = 0) => new Date(Date.now() + days * 86400000).toISOString();

/** First array of rows in a live envelope (data itself, or anything nested). */
const rowsOf = (body) => {
  const d = body?.data;
  if (Array.isArray(d)) {return d;}
  if (d && typeof d === "object") {
    for (const v of Object.values(d)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "object") {return v;}
    }
  }
  return [];
};

/**
 * Resolves ids by name. `pool` holds live rows by the list path they came
 * from; `named` holds the principal-independent anchors (tenants, users).
 */
function makeIdSource(state) {
  const fromList = (listPath, field = "id") => {
    const rows = state.lists[listPath] || [];
    const row = rows.find((x) => x && x[field]);
    return row ? row[field] : null;
  };
  const byKey = (key) => {
    const k = String(key).replace(/Ids?$/, "").replace(/_id$/, "").toLowerCase();
    const map = {
      tenant: () => state.tenantA,
      parent: () => state.tenantC,
      user: () => state.users.victimA,
      assignedto: () => state.users.techA,
      assignee: () => state.users.techA,
      technician: () => state.users.techA,
      performedby: () => state.users.techA,
      member: () => state.users.techA,
      owner: () => state.users.adminA,
      role: () => state.roles.TECHNICIAN,
      device: () => fromList("/api/v1/calibration-devices"),
      calibrationdevice: () => fromList("/api/v1/calibration-devices"),
      equipment: () => fromList("/api/v1/calibration-devices"),
      asset: () => fromList("/api/v1/calibration-devices"),
      calibrationrecord: () => fromList("/api/v1/calibration-records"),
      record: () => fromList("/api/v1/calibration-records"),
      certificate: () => fromList("/api/v1/certificates"),
      vendor: () => fromList("/api/v1/vendors"),
      supplier: () => fromList("/api/v1/vendors"),
      warehouse: () => fromList("/api/v1/warehouses"),
      stock: () => fromList("/api/v1/stocks"),
      item: () => fromList("/api/v1/stocks"),
      location: () => state.locationId,
      storagelocation: () => state.locationId,
      fromlocation: () => state.locationId,
      tolocation: () => state.locationId2 || state.locationId,
      fromwarehouse: () => fromList("/api/v1/warehouses"),
      towarehouse: () => fromList("/api/v1/warehouses"),
      workflow: () => fromList("/api/v1/workflows"),
      project: () => fromList("/api/v1/kanban/projects"),
      menugroup: () => fromList("/api/v1/menu-groups/menu-groups"),
      menu: () => fromList("/api/v1/menu-groups/menu-groups"),
      ticket: () => fromList("/api/v1/tickets"),
      risk: () => fromList("/api/v1/risk"),
      nc: () => fromList("/api/v1/qms/nc"),
      nonconformance: () => fromList("/api/v1/qms/nc"),
      capa: () => fromList("/api/v1/qms/capa"),
      maintenance: () => fromList("/api/v1/maintenance"),
      workorder: () => fromList("/api/v1/maintenance"),
      order: () => fromList("/api/v1/maintenance"),
      category: () => fromList("/api/v1/content/categories"),
      post: () => fromList("/api/v1/content/posts"),
      sop: () => fromList("/api/v1/sop"),
      document: () => fromList("/api/v1/sop"),
      keypair: () => fromList("/api/v1/esignature/key-pairs"),
      signer: () => state.users.adminA,
      entity: () => fromList("/api/v1/calibration-devices"),
      resource: () => fromList("/api/v1/calibration-devices"),
      column: () => state.kanban.columnId,
      tocolumn: () => state.kanban.columnId,
      card: () => state.kanban.cardId,
      targetcard: () => state.kanban.cardId2 || state.kanban.cardId,
      sprint: () => state.kanban.sprintId,
      label: () => state.kanban.labelId,
    };
    const fn = map[k] || map[k.replace(/s$/, "")];
    return fn ? fn() : null;
  };
  return { byKey, fromList };
}

/** A plausible value for a field, by its name. */
function valueFor(key, ids) {
  const k = String(key);
  const low = k.toLowerCase();
  if (/ids$/i.test(k)) {
    const one = ids.byKey(k.replace(/Ids$/, "Id").replace(/ids$/, "id"));
    return one ? [one] : [uuid()];
  }
  if (/(^id$|Id$|_id$)/.test(k)) {return ids.byKey(k) || uuid();}
  if (low.includes("email")) {return `lc.${rand()}@example.com`;}
  if (low.includes("password")) {return PRINCIPAL_PASSWORD;}
  if (/(url|uri|endpoint|callback|redirect|website)/.test(low)) {return "https://example.com/lc-hook";}
  if (/(domain|hostname)/.test(low)) {return `lc-${rand()}.example.com`;}
  if (/(^ip$|cidr|ipaddress|allowlist)/.test(low)) {return "10.0.0.0/24";}
  if (/(date|_at$|at$|due|expir|deadline|until|since|from$|to$)/i.test(k)) {return iso(30);}
  if (/(count|quantity|qty|amount|price|cost|value|level|score|rating|interval|days|months|years|limit|size|position|capacity|threshold|weight|percent|min|max|hours)/.test(low)) {return 1;}
  if (/^(is|has|enable|allow)|enabled$|active$/.test(k)) {return true;}
  if (/(code|sku|serial)/.test(low)) {return `LC${rand().toUpperCase()}`;}
  if (/(slug|username|key)$/.test(low)) {return `lc${rand()}`;}
  if (/(phone|mobile)/.test(low)) {return "+6281234567890";}
  if (/(color|colour)/.test(low)) {return "#336699";}
  if (/(^time$|time$)/.test(low)) {return "08:00";}
  if (/(cron|schedule)/.test(low)) {return "0 2 * * *";}
  if (/(items|rows|steps|entries|lines|members|signers|events|scopes|permissions|tags|labels)$/.test(low)) {return [];}
  if (/(settings|metadata|config|payload|data|scorecard|criteria|options)$/.test(low)) {return {};}
  if (/(token|code|otp)$/.test(low)) {return "000000";}
  return `LC ${k} ${rand()}`;
}

/** A body from a Joi describe(): required keys, well-typed. */
function bodyFromSchema(desc, ids, key = "") {
  if (!desc) {return undefined;}
  const flags = desc.flags || {};
  if (flags.only && Array.isArray(desc.allow) && desc.allow.length) {
    return desc.allow.find((v) => v !== null && v !== "") ?? desc.allow[0];
  }
  const rules = (desc.rules || []).map((r) => r.name);
  const ruleArg = (name) => (desc.rules || []).find((r) => r.name === name)?.args;
  switch (desc.type) {
    case "object": {
      const out = {};
      for (const [k, child] of Object.entries(desc.keys || {})) {
        if (child?.flags?.presence === "required") {out[k] = bodyFromSchema(child, ids, k);}
      }
      return out;
    }
    case "array": {
      const min = ruleArg("min")?.limit || 0;
      const item = desc.items?.[0];
      const out = [];
      for (let i = 0; i < Math.max(min, 0); i += 1) {out.push(bodyFromSchema(item, ids, key.replace(/s$/, "")));}
      return out;
    }
    case "number": {
      const min = ruleArg("min")?.limit ?? ruleArg("greater")?.limit;
      return min !== undefined ? Number(min) + (ruleArg("greater") ? 1 : 0) : 1;
    }
    case "boolean":
      return true;
    case "date":
      return iso(30);
    case "alternatives":
      return bodyFromSchema(desc.matches?.[0]?.schema || desc.matches?.[0]?.then, ids, key);
    case "string": {
      if (rules.includes("guid") || rules.includes("uuid")) {return ids.byKey(key) || uuid();}
      if (rules.includes("email")) {return `lc.${rand()}@example.com`;}
      if (rules.includes("isoDate")) {return iso(30);}
      if (rules.includes("uri")) {return "https://example.com/lc-hook";}
      if (rules.includes("hostname") || rules.includes("domain")) {return `lc-${rand()}.example.com`;}
      if (rules.includes("ip")) {return "10.0.0.1";}
      const v = valueFor(key, ids);
      let s = typeof v === "string" ? v : String(v);
      if (rules.includes("alphanum")) {s = `lc${rand()}`;}
      const min = ruleArg("min")?.limit;
      if (min && s.length < min) {s = s.padEnd(min, "x");}
      const max = ruleArg("max")?.limit;
      if (max && s.length > max) {s = s.slice(0, max);}
      return s;
    }
    default:
      return valueFor(key, ids);
  }
}

const setPath = (obj, dotted, value) => {
  const parts = String(dotted).split(".").filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (cur[p] === undefined || typeof cur[p] !== "object") {cur[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};}
    cur = cur[p];
  }
  if (parts.length) {cur[parts[parts.length - 1]] = value;}
};
const delPath = (obj, dotted) => {
  const parts = String(dotted).split(".").filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur = cur?.[parts[i]];
  }
  if (cur && parts.length) {delete cur[parts[parts.length - 1]];}
};

/** The Joi validation complaints in a 400, as [{field, message}]. */
function complaintsOf(body) {
  const out = [];
  const pools = [body?.details, body?.errors, body?.data?.errors, body?.data];
  for (const pool of pools) {
    if (Array.isArray(pool)) {
      for (const d of pool) {
        if (d && typeof d === "object" && (d.message || d.msg)) {
          out.push({ field: d.field || d.path || (String(d.message).match(/^"([^"]+)"/) || [])[1], message: String(d.message || d.msg) });
        }
      }
    }
  }
  if (!out.length && typeof body?.message === "string") {
    for (const part of body.message.split(/[.;,]\s+(?=")/)) {
      const m = part.match(/^"([^"]+)"\s+(.*)$/);
      if (m) {out.push({ field: m[1], message: part });}
    }
  }
  return out.filter((c) => c.field);
}

/** Adjust a body to one Joi complaint. Returns false when nothing was learned. */
function applyComplaint(body, { field, message }, ids) {
  const key = String(field).split(".").pop();
  const msg = message.toLowerCase();
  const oneOf = message.match(/must be (?:one of|\[?)\s*\[([^\]]*)\]/);
  if (msg.includes("is not allowed") && !msg.includes("to be empty")) {
    delPath(body, field);
    return true;
  }
  if (oneOf) {
    const first = oneOf[1].split(",")[0].trim().replace(/^["']|["']$/g, "");
    setPath(body, field, /^-?\d+(\.\d+)?$/.test(first) ? Number(first) : first === "true" ? true : first === "false" ? false : first);
    return true;
  }
  if (msg.includes("guid") || msg.includes("uuid")) {return setPath(body, field, ids.byKey(key) || uuid()) || true;}
  if (msg.includes("must be a number") || msg.includes("must be an integer")) {return setPath(body, field, 1) || true;}
  let m = message.match(/greater than or equal to (-?[\d.]+)/);
  if (m) {return setPath(body, field, Number(m[1])) || true;}
  m = message.match(/greater than (-?[\d.]+)/);
  if (m) {return setPath(body, field, Number(m[1]) + 1) || true;}
  m = message.match(/less than or equal to (-?[\d.]+)/);
  if (m) {return setPath(body, field, Number(m[1])) || true;}
  if (msg.includes("must be greater than") || msg.includes("must be larger than")) {return setPath(body, field, iso(60)) || true;}
  if (msg.includes("must be a boolean")) {return setPath(body, field, true) || true;}
  if (msg.includes("date") || msg.includes("iso 8601")) {return setPath(body, field, iso(30)) || true;}
  m = message.match(/must contain at least (\d+) items/);
  if (m) {
    const one = valueFor(key.replace(/s$/, "Id"), ids);
    setPath(body, field, Array.from({ length: Number(m[1]) }, () => (typeof one === "string" ? one : {})));
    return true;
  }
  if (msg.includes("must be an array")) {return setPath(body, field, []) || true;}
  if (msg.includes("must be of type object")) {return setPath(body, field, {}) || true;}
  if (msg.includes("valid email")) {return setPath(body, field, `lc.${rand()}@example.com`) || true;}
  if (msg.includes("valid uri")) {return setPath(body, field, "https://example.com/lc-hook") || true;}
  if (msg.includes("valid ip")) {return setPath(body, field, "10.0.0.1") || true;}
  if (msg.includes("hostname") || msg.includes("domain")) {return setPath(body, field, `lc-${rand()}.example.com`) || true;}
  m = message.match(/length must be at least (\d+)/);
  if (m) {return setPath(body, field, `lc${rand()}`.padEnd(Number(m[1]), "x")) || true;}
  m = message.match(/length must be less than or equal to (\d+)/);
  if (m) {return setPath(body, field, "lc".padEnd(Math.min(Number(m[1]), 2), "x")) || true;}
  if (msg.includes("alpha-numeric")) {return setPath(body, field, `lc${rand()}`) || true;}
  if (msg.includes("must be a string")) {return setPath(body, field, `LC ${key}`) || true;}
  if (msg.includes("pattern")) {
    const low = key.toLowerCase();
    const guess = low.includes("color")
      ? "#336699"
      : low.includes("phone")
        ? "+6281234567890"
        : low.includes("slug")
          ? `lc-${rand()}`
          : low.includes("time")
            ? "08:00"
            : low.includes("key")
              ? `lc_${rand()}`
              : low.includes("period") || low.includes("month")
                ? new Date().toISOString().slice(0, 7)
                : `LC${rand().toUpperCase()}`;
    setPath(body, field, guess);
    return true;
  }
  if (msg.includes("is required") || msg.includes("must have at least") || msg.includes("must contain at least one of")) {
    const peers = message.match(/\[([^\]]+)\]/);
    const target = peers ? peers[1].split(",")[0].trim() : field;
    setPath(body, target, valueFor(String(target).split(".").pop(), ids));
    return true;
  }
  if (msg.includes("is not allowed to be empty")) {return setPath(body, field, valueFor(key, ids)) || true;}
  return false;
}

// ============================================================
// 4. ENVELOPE RULES
// ============================================================

/** Paths whose wire format is a protocol, not the envelope. */
const PROTOCOL_PATH = /^\/(oidc\/|api\/v1\/oidc\/(\.well-known|token|userinfo|authorize$)|api\/v1\/scim\/|health$|live$|ready$|api\/v1\/health\/metrics)/;

function envelopeViolations(route, res) {
  const v = [];
  if (!res.contentType.includes("json") || !res.body || typeof res.body !== "object") {return v;}
  if (PROTOCOL_PATH.test(route.path.replace(/^\//, "/"))) {return v;}
  const b = res.body;
  if (typeof b.success !== "boolean") {v.push("no boolean `success`");}
  if (!("data" in b)) {v.push("no `data` key");}
  if (typeof b.message !== "string") {v.push("no string `message`");}
  if ("status" in b && b.status !== res.status) {v.push(`body status ${b.status} != HTTP ${res.status}`);}
  if (typeof b.success === "boolean" && b.success !== (res.status < 400)) {v.push(`success=${b.success} on HTTP ${res.status}`);}
  const d = b.data;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    for (const key of ["rows", "items", "records", "results", "list", "data"]) {
      if (Array.isArray(d[key])) {v.push(`list rows in data.${key} (must be data[])`);}
    }
    if (d.meta && typeof d.meta === "object") {v.push("pagination in data.meta (must be top-level meta)");}
    if (d.pagination && typeof d.pagination === "object") {v.push("pagination in data.pagination (must be top-level meta)");}
    if (typeof d.count === "number" && Array.isArray(d.rows)) {v.push("raw findAndCountAll {count, rows} in data");}
  }
  if (b.pagination) {v.push("top-level `pagination` (must be `meta`)");}
  return v;
}

// ============================================================
// 5. THE WALK
// ============================================================

const TEMP_PASSWORD = "TempPass#2026lc";

/** Create (or reuse) a user and hand back a signed-in, password-changed session. */
async function ensureUser(creator, spec) {
  const created = await http("POST", "/api/v1/users/create", {
    token: creator.token,
    body: { ...spec, password: TEMP_PASSWORD, status: "ACTIVE" },
  });
  if (created.status >= 300 && created.status !== 409) {
    throw new Error(`creating ${spec.email} (${JSON.stringify(spec)}): ${created.status} ${String(created.text).slice(0, 300)}`);
  }
  const first = await http("POST", "/api/v1/auth/login", {
    body: { user: spec.email, password: created.status === 409 ? PRINCIPAL_PASSWORD : TEMP_PASSWORD },
  });
  if (first.status === 200 && first.body?.data?.mustChangePassword) {
    const changed = await http("POST", "/api/v1/auth/just-update-password", {
      token: first.body.token,
      body: { currentPassword: TEMP_PASSWORD, newPassword: PRINCIPAL_PASSWORD },
    });
    if (changed.status !== 200) {throw new Error(`password change of ${spec.email}: ${changed.status} ${changed.text}`);}
  }
  return signIn({ user: spec.email, password: PRINCIPAL_PASSWORD });
}

/** Paths that end the caller's own session or identity: a disposable principal. */
const SELF_DESTRUCTIVE =
  /\/auth\/(logout|logout-all|just-update-password|mfa\/(setup|verify|disable)|impersonate\/exit)$|\/gdpr\/(erasure|restrict|rectify|consent|export)$|\/webauthn\/disable$/;
/** Run after every create/update: destroys, revokes, restores, re-plans. */
const LATE =
  /(\/delete$|\/revoke|\/purge|\/anonymize|\/mask-pii|\/offboard|\/suspend|\/resume|\/restore$|\/rotate|\/reset$|\/disable$|\/logout|\/erasure|\/restrict|\/legal-hold|\/grace-period|\/impersonate|\/storage\/settings|\/billing\/subscription|\/bulk-revoke|\/unseeding|\/down$|\/status$|\/flags$)/;
/** Last of all: settings that can lock the test client out of the tenant. */
const LAST = /\/network-security\/(ip-allowlist|geofence)$/;
/** Tenant-lifecycle targets: the sacrificial tenant C, never A or B. */
const TENANT_C_ROUTE =
  /\/tenants\/:tenantId\/(suspend|resume|offboard|purge|mask-pii|anonymize|grace-period|legal-hold)|\/admin\/tenants\/:id\//;
/** Parents whose seeded rows the principals depend on: only ids this run created. */
const CREATED_ONLY = /^\/api\/v1\/(roles|menu-groups|menu-group-roles|users|sessions|tenants\/(delete|edit))/;
/** Operator-only surfaces. */
const OPERATOR_ONLY = /^\/(api\/v1\/(admin|migration|health)\b)/;

async function runLiveContract() {
  const started = Date.now();
  const { routes } = loadRoutes();
  const state = {
    lists: {},
    created: {},
    users: {},
    roles: {},
    kanban: {},
    tenantA: null,
    tenantB: null,
    tenantC: null,
  };
  const ids = makeIdSource(state);
  const results = [];

  // ---- principals --------------------------------------------------------
  const P = {};
  P.operator = await signIn(OPERATOR);
  state.tenantA = P.operator.user.tenantId;
  const tenants = rowsOf((await http("GET", "/api/v1/tenants/all?limit=100", { token: P.operator.token })).body);
  const bySub = (s) => tenants.find((t) => t.subdomain === s);
  state.tenantB = bySub("demo-alpha")?.id;
  state.tenantC = bySub("demo-beta")?.id;
  if (!state.tenantB || !state.tenantC) {throw new Error("seed-demo tenants demo-alpha / demo-beta are missing");}
  state.tenantCodeA = tenants.find((t) => t.id === state.tenantA)?.code;
  const roles = rowsOf((await http("GET", "/api/v1/roles?limit=100", { token: P.operator.token })).body);
  for (const r of roles) {state.roles[String(r.name).replace(/ /g, "_")] = r.id;}
  const adminRole = state.roles.HEALTHCARE_ADMIN;

  P.adminA = await signIn({ user: "demo.healtcare_admin@demo.callibrator.test", password: DEMO_PASSWORD });
  P.techA = await signIn({ user: "demo.technician@demo.callibrator.test", password: DEMO_PASSWORD });
  const mk = (who, tenantId, roleId) => ({
    username: `lc${who}`.toLowerCase(),
    firstName: "Live",
    lastName: `Contract ${who}`,
    email: `lc.${who}@example.com`.toLowerCase(),
    roleId,
    tenantId,
  });
  P.adminB = await ensureUser(P.operator, mk("adminB", state.tenantB, adminRole));
  P.techB = await ensureUser(P.operator, mk("techB", state.tenantB, state.roles.TECHNICIAN));
  P.victimA = await ensureUser(P.operator, mk("victimA", state.tenantA, state.roles.TECHNICIAN));
  P.selfA = await ensureUser(P.operator, mk("selfA", state.tenantA, adminRole));
  state.users = {
    adminA: P.adminA.user.id,
    techA: P.techA.user.id,
    victimA: P.victimA.user.id,
    selfA: P.selfA.user.id,
    adminB: P.adminB.user.id,
  };

  // ---- path params -------------------------------------------------------
  const paramValue = (route, name, concretePrefix, phase) => {
    if (name === "tenantId" || (name === "id" && /\/admin\/tenants\/:id/.test(route.path))) {
      return TENANT_C_ROUTE.test(route.path) ? state.tenantC : state.tenantA;
    }
    if (name === "userId") {return state.users.victimA;}
    if (name === "parentId") {return state.tenantB;}
    if (name === "tenantCode") {return state.tenantCodeA || "DEFAULT";}
    if (name === "certificateNumber") {return ids.fromList("/api/v1/certificates", "certificateNumber") || "CERT-NONE";}
    if (name === "slug") {return ids.fromList("/api/v1/content/posts/public", "slug") || "none";}
    if (name === "flagKey") {
      const defs = state.lists["/api/v1/feature-flags/definitions"] || [];
      return defs[0]?.key || defs[0]?.flagKey || defs[0]?.name || "advanced_reporting";
    }
    if (name === "memberId") {return state.kanban.memberId || uuid();}
    if (name === "menuGroupId") {return ids.fromList("/api/v1/menu-groups/menu-groups") || uuid();}
    if (route.path.startsWith("/api/v1/sessions") && name === "id") {
      const own = new Set(Object.values(P).map((p) => p.user?.id));
      const rows = state.lists["/api/v1/sessions"] || [];
      const victim = rows.find((s) => (s.userId || s.user_id) === state.users.victimA);
      if (victim) {return victim.id;}
      const other = rows.find((s) => !own.has(s.userId || s.user_id));
      return other ? other.id : uuid();
    }
    const created = state.created[concretePrefix];
    if (created && created.length) {return created[0];}
    if (phase !== "GET" && CREATED_ONLY.test(route.path)) {return uuid();}
    const listed = (state.lists[concretePrefix] || []).find((x) => x && (x.id || x[name]));
    if (listed) {return listed[name] || listed.id;}
    return ids.byKey(name) || uuid();
  };

  const concretise = (route, phase) => {
    const out = [];
    for (const seg of route.path.split("/")) {
      if (seg.startsWith(":")) {
        const name = seg.slice(1).replace(/\?$/, "");
        out.push(encodeURIComponent(paramValue(route, name, out.join("/"), phase)));
      } else {
        out.push(seg);
      }
    }
    return out.join("/");
  };

  const principalsFor = (route) => {
    if (SELF_DESTRUCTIVE.test(route.path)) {return ["selfA"];}
    if (OPERATOR_ONLY.test(route.path)) {return ["operator"];}
    if (route.middlewares.some((m) => (m.rbac || []).some((r) => /SUPER/.test(r)))) {return ["operator"];}
    return ["adminA", "operator"];
  };

  const queryFor = (route) => {
    if (route.method !== "GET") {return "";}
    if (/\/search$/.test(route.path)) {return "?q=demo";}
    if (/\/slug-check$/.test(route.path)) {return "?slug=lc-slug";}
    if (/\/storage\/object$/.test(route.path)) {return "?key=none";}
    if (/\/oidc\/authorize$/.test(route.path)) {
      return "?client_id=none&response_type=code&redirect_uri=https%3A%2F%2Fexample.com&scope=openid";
    }
    if (/\/sso\/oidc\/callback/.test(route.path)) {return "?code=none&state=none";}
    if (/\/auth\/activation$/.test(route.path)) {return "?token=none";}
    return "";
  };

  const describeShape = (res) => {
    if (res.body && Array.isArray(res.body.data)) {return "list";}
    if (res.body && res.body.data && typeof res.body.data === "object") {
      return `object{${Object.keys(res.body.data).slice(0, 12).join(",")}}`;
    }
    return res.body ? typeof res.body.data : res.contentType || "none";
  };

  const record = (route, url, who, res, extra = {}) => {
    const r = {
      method: route.method,
      path: route.path,
      url,
      principal: who,
      status: res.status,
      ms: res.ms,
      message: res.body?.message,
      envelope: envelopeViolations(route, res),
      shape: describeShape(res),
      metaTopLevel: Boolean(res.body && res.body.meta),
      ...extra,
    };
    if (res.error) {r.error = res.error;}
    if (res.status >= 500 || res.status === 0 || res.status === 408) {
      r.detail = (res.text || res.error || "").slice(0, 600);
    }
    results.push(r);
    return r;
  };

  const send = async (route, phase) => {
    const url = concretise(route, phase) + queryFor(route);
    const params = {};
    const urlSegs = url.split("?")[0].split("/");
    route.path.split("/").forEach((s, i) => {
      if (s.startsWith(":")) {params[s.slice(1)] = decodeURIComponent(urlSegs[i]);}
    });
    let lastRes = null;
    let lastWho = null;
    let lastExtra = {};
    for (const who of principalsFor(route)) {
      const token = P[who].token;
      let body;
      if (route.method !== "GET" && route.method !== "DELETE") {
        const schema = route.middlewares.find((m) => m.schema)?.schema;
        body = (schema && bodyFromSchema(schema, ids)) || {};
        if (typeof body !== "object" || Array.isArray(body)) {body = {};}
        if (/\/users\/(edit|delete|role-update|detail)$/.test(route.path)) {body.userId = state.users.victimA;}
        if (/\/auth\/impersonate$/.test(route.path)) {Object.assign(body, { userId: state.users.victimA, tenantId: state.tenantA });}
        if (/\/auth\/just-update-password$/.test(route.path)) {
          Object.assign(body, { currentPassword: PRINCIPAL_PASSWORD, newPassword: `${PRINCIPAL_PASSWORD}x` });
        }
        if (LAST.test(route.path)) {body.enabled = false;}
      } else if (route.method === "DELETE") {
        body = {};
        if (/\/users\/delete$/.test(route.path)) {body.userId = state.users.victimA;}
      }
      const pin = () => {
        if (body && /\/tenants\/(edit|delete)$/.test(route.path)) {body.tenantId = state.tenantC;}
      };
      pin();
      let res = await http(route.method, url, { token, body });
      let rounds = 0;
      // Complete the body from the 400's own validation complaints.
      while (res.status === 400 && body && rounds < 8) {
        const complaints = complaintsOf(res.body);
        if (!complaints.length) {break;}
        let learned = false;
        for (const c of complaints) {
          const k = String(c.field).split(".").pop();
          if (params[k] && /is required/.test(c.message)) {
            setPath(body, c.field, params[k]);
            learned = true;
          } else if (applyComplaint(body, c, ids)) {
            learned = true;
          }
        }
        if (!learned) {break;}
        pin();
        rounds += 1;
        res = await http(route.method, url, { token, body });
      }
      lastRes = res;
      lastWho = who;
      lastExtra = { rounds, body: route.method === "GET" ? undefined : body };
      if (res.status !== 403) {break;}
    }
    record(route, url, lastWho, lastRes, lastExtra);
    return lastRes;
  };

  const learn = (route, url, res) => {
    const concrete = url.split("?")[0];
    if (res.status === 200 && route.method === "GET") {
      const rows = rowsOf(res.body);
      if (rows.length) {state.lists[concrete] = rows;}
      if (/\/warehouses\/[^/]+\/locations$/.test(concrete) && rows[0]) {
        state.locationId = rows[0].id;
        state.locationId2 = rows[1]?.id;
      }
      if (/\/kanban\/projects\/[^/]+$/.test(concrete) && res.body?.data) {
        const p = res.body.data;
        state.kanban.columnId = state.kanban.columnId || p.columns?.[0]?.id;
        const cards = p.cards || (p.columns || []).flatMap((c) => c.cards || []);
        state.kanban.cardId = state.kanban.cardId || cards[0]?.id;
        state.kanban.cardId2 = state.kanban.cardId2 || cards[1]?.id;
        state.kanban.labelId = state.kanban.labelId || p.labels?.[0]?.id;
        state.kanban.memberId = state.kanban.memberId || p.members?.[0]?.id;
      }
      if (/\/kanban\/projects\/[^/]+\/sprints$/.test(concrete) && rows[0]) {state.kanban.sprintId = rows[0].id;}
    }
    if ((res.status === 200 || res.status === 201) && route.method === "POST" && res.body?.data?.id) {
      // A create: later :id routes under this collection act on what we made.
      (state.created[concrete] = state.created[concrete] || []).unshift(res.body.data.id);
      const k = route.path;
      if (/\/kanban\/projects\/:projectId\/columns$/.test(k)) {state.kanban.columnId = res.body.data.id;}
      if (/\/kanban\/projects\/:projectId\/cards$/.test(k)) {
        state.kanban.cardId2 = state.kanban.cardId;
        state.kanban.cardId = res.body.data.id;
      }
      if (/\/kanban\/projects\/:projectId\/sprints$/.test(k)) {state.kanban.sprintId = res.body.data.id;}
      if (/\/kanban\/projects\/:projectId\/labels$/.test(k)) {state.kanban.labelId = res.body.data.id;}
    }
  };

  const nParams = (r) => (r.path.match(/:/g) || []).length;
  const unique = routes.filter(
    (r, i) => routes.findIndex((x) => x.method === r.method && x.path === r.path) === i,
  );
  const gets = unique
    .filter((r) => r.method === "GET")
    .sort((a, b) => nParams(a) - nParams(b) || a.path.length - b.path.length);
  const writes = unique.filter((r) => r.method !== "GET");
  const early = writes
    .filter((r) => r.method !== "DELETE" && !LATE.test(r.path) && !LAST.test(r.path) && !SELF_DESTRUCTIVE.test(r.path))
    .sort((a, b) => nParams(a) - nParams(b) || a.path.localeCompare(b.path));
  const self = writes.filter((r) => SELF_DESTRUCTIVE.test(r.path) && !/logout|disable|erasure|restrict/.test(r.path));
  const selfEnd = writes
    .filter((r) => SELF_DESTRUCTIVE.test(r.path) && /logout|disable|erasure|restrict/.test(r.path))
    .sort((a, b) => (/logout-all|erasure/.test(a.path) ? 1 : 0) - (/logout-all|erasure/.test(b.path) ? 1 : 0));
  const last = writes.filter((r) => LAST.test(r.path));
  const late = writes
    .filter((r) => !early.includes(r) && !self.includes(r) && !selfEnd.includes(r) && !last.includes(r))
    .sort((a, b) => b.path.length - a.path.length);

  // Phase 1: every GET, as the principal who may read it.
  for (const route of gets) {
    const res = await send(route, "GET");
    learn(route, results[results.length - 1].url, res);
  }
  // Phase 1b: the same GETs as a technician (a lower role must never 5xx).
  const techResults = [];
  for (const route of gets) {
    if (OPERATOR_ONLY.test(route.path)) {continue;}
    const url = concretise(route, "GET") + queryFor(route);
    const res = await http("GET", url, { token: P.techA.token });
    techResults.push({
      method: "GET",
      path: route.path,
      url,
      principal: "techA",
      status: res.status,
      envelope: envelopeViolations(route, res),
      detail: res.status >= 500 ? (res.text || "").slice(0, 400) : undefined,
    });
  }
  // Phase 1c: cross-tenant — tenant B's admin asks for tenant A's objects.
  const crossTenant = [];
  for (const route of gets) {
    if (!route.path.includes(":") || OPERATOR_ONLY.test(route.path)) {continue;}
    const url = concretise(route, "GET") + queryFor(route);
    const res = await http("GET", url, { token: P.adminB.token });
    crossTenant.push({ path: route.path, url, status: res.status, message: res.body?.message });
  }
  // Phase 2 creates/updates; 3 selfA's own identity; 4 destroys, revokes,
  // lifecycle (tenant C); 5 selfA's sign-outs; 6 network locks (disabled).
  for (const phase of [early, self, late, selfEnd, last]) {
    for (const route of phase) {
      const res = await send(route, "WRITE");
      learn(route, results[results.length - 1].url, res);
    }
  }

  return {
    started,
    finished: Date.now(),
    baseUrl: BASE_URL,
    routeCount: unique.length,
    results,
    techResults,
    crossTenant,
    routes: unique,
  };
}

// ============================================================
// 6. FRONTEND SERVICES
// ============================================================

/** Every api.<verb>(path) call in frontend/src/api/services/*.ts. */
function extractFrontendCalls() {
  const dir = path.join(REPO_ROOT, "frontend/src/api/services");
  const calls = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const consts = {};
    for (const m of src.matchAll(/const (\w+)\s*=\s*(["'`])(\/api[^"'`]*)\2/g)) {consts[m[1]] = m[3];}
    const re = /\b(?:api|apiClient)\s*\.\s*(get|post|put|patch|delete)\s*/g;
    let m;
    while ((m = re.exec(src))) {
      let i = re.lastIndex;
      if (src[i] === "<") {
        let depth = 0;
        for (; i < src.length; i += 1) {
          if (src[i] === "<") {depth += 1;}
          else if (src[i] === ">" && src[i - 1] !== "=") {
            depth -= 1;
            if (depth === 0) {
              i += 1;
              break;
            }
          }
        }
      }
      while (/\s/.test(src[i])) {i += 1;}
      if (src[i] !== "(") {continue;}
      i += 1;
      while (/\s/.test(src[i])) {i += 1;}
      const line = src.slice(0, m.index).split("\n").length;
      const q = src[i];
      let raw = null;
      if (q === '"' || q === "'" || q === "`") {
        const end = src.indexOf(q, i + 1);
        raw = src.slice(i + 1, end);
      } else {
        const ident = src.slice(i).match(/^(\w+)/);
        raw = ident && consts[ident[1]] ? consts[ident[1]] : null;
        if (!raw) {
          calls.push({ file, line, method: m[1].toUpperCase(), raw: src.slice(i, i + 60).split("\n")[0], unresolved: true });
          continue;
        }
      }
      const resolved = raw
        .replace(/\$\{(\w+)\}/g, (all, name) => (consts[name] !== undefined ? consts[name] : ":param"))
        .replace(/\$\{[^}]+\}/g, ":param")
        .split("?")[0];
      const window = src.slice(m.index, m.index + 1400);
      calls.push({ file, line, method: m[1].toUpperCase(), raw, path: resolved, window });
    }
  }
  return calls;
}

/** Does a frontend call name a real route? */
function matchRoute(call, routes) {
  const segs = call.path.replace(/\/$/, "").split("/");
  return routes.filter((r) => {
    if (r.method !== call.method) {return false;}
    const rs = r.path.split("/");
    if (rs.length !== segs.length) {return false;}
    return rs.every((s, i) => s.startsWith(":") || segs[i] === ":param" || segs[i] === s);
  });
}

function checkFrontend(routes, live) {
  const calls = extractFrontendCalls();
  const findings = [];
  const liveByRoute = new Map(live.map((r) => [`${r.method} ${r.path}`, r]));
  for (const call of calls) {
    if (call.unresolved) {
      findings.push({ kind: "unresolved-path", ...call });
      continue;
    }
    if (!call.path.startsWith("/api/")) {continue;}
    const matches = matchRoute(call, routes);
    // Prefer the literal route over a param one (/x/stats over /x/:id).
    matches.sort((a, b) => (a.path.match(/:/g) || []).length - (b.path.match(/:/g) || []).length);
    if (!matches.length) {
      const anyMethod = matchRoute({ ...call, method: "GET" }, routes)
        .concat(matchRoute({ ...call, method: "POST" }, routes))
        .concat(matchRoute({ ...call, method: "PUT" }, routes))
        .concat(matchRoute({ ...call, method: "PATCH" }, routes))
        .concat(matchRoute({ ...call, method: "DELETE" }, routes));
      findings.push({
        kind: anyMethod.length ? "wrong-method" : "no-such-route",
        file: call.file,
        line: call.line,
        method: call.method,
        path: call.path,
        realMethods: [...new Set(anyMethod.map((r) => `${r.method} ${r.path}`))],
      });
      continue;
    }
    const liveRes = liveByRoute.get(`${matches[0].method} ${matches[0].path}`);
    const w = call.window.split(/\n\s*(?:\w+\s*:\s*async|async\s+\w+\s*\(|\},\s*\n\s*\w+\s*[:(])/)[0];
    const reads = [...new Set((w.match(/\.data\??\.(rows|items|meta|pagination|records|results|list|data)\b/g) || []))];
    if (liveRes && liveRes.shape === "list" && reads.length) {
      findings.push({
        kind: "shape-mismatch",
        file: call.file,
        line: call.line,
        method: call.method,
        path: call.path,
        route: matches[0].path,
        reads,
        live: `data is an array${liveRes.metaTopLevel ? ", meta top-level" : ""}`,
      });
    }
  }
  return { callCount: calls.length, findings };
}

// ============================================================
// 7. VERDICT
// ============================================================

function verdict(run, frontend) {
  const serverErrors = run.results
    .concat(run.techResults)
    .filter((r) => r.status >= 500 || r.status === 0 || r.status === 408)
    // /health and /ready answer 503 by design when a dependency is down.
    .filter((r) => !/^\/(health|ready)$|^\/api\/v1\/health$/.test(r.path));
  const envelope = run.results.concat(run.techResults).filter((r) => r.envelope && r.envelope.length);
  const crossTenantLeaks = run.crossTenant.filter((r) => r.status >= 200 && r.status < 300);
  const crossTenant403 = run.crossTenant.filter((r) => r.status === 403);
  const frontendMissing = frontend.findings.filter((f) => f.kind === "no-such-route" || f.kind === "wrong-method");
  const frontendShape = frontend.findings.filter((f) => f.kind === "shape-mismatch");
  return { serverErrors, envelope, crossTenantLeaks, crossTenant403, frontendMissing, frontendShape };
}

async function main() {
  const run = await runLiveContract();
  const frontend = checkFrontend(run.routes, run.results);
  const v = verdict(run, frontend);
  const reportFile = process.env.LIVE_CONTRACT_REPORT || path.join(os.tmpdir(), "callibrator-live-contract.json");
  const statusHistogram = {};
  for (const r of run.results) {statusHistogram[r.status] = (statusHistogram[r.status] || 0) + 1;}
  const report = {
    baseUrl: run.baseUrl,
    runId: RUN,
    seconds: Math.round((run.finished - run.started) / 1000),
    routeCount: run.routeCount,
    frontendCallCount: frontend.callCount,
    statusHistogram,
    verdict: v,
    frontendFindings: frontend.findings,
    results: run.results,
    techResults: run.techResults,
    crossTenant: run.crossTenant,
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(
    `[live-contract] ${run.routeCount} routes, ${frontend.callCount} frontend calls, report ${reportFile}\n` +
      `  status: ${JSON.stringify(statusHistogram)}\n` +
      `  5xx/timeouts: ${v.serverErrors.length}  envelope: ${v.envelope.length}  ` +
      `cross-tenant 2xx: ${v.crossTenantLeaks.length}  cross-tenant 403: ${v.crossTenant403.length}  ` +
      `frontend missing: ${v.frontendMissing.length}  frontend shape: ${v.frontendShape.length}`,
  );
  return report;
}

module.exports = { main, dumpRoutes, extractFrontendCalls, envelopeViolations, complaintsOf, applyComplaint };

// P6-02: under Jest `require.main === module` is TRUE for the test file, so
// the CLI branch used to run inside `npm run test:e2e` — main() ran with no
// LIVE_CONTRACT opt-in and its process.exit(1) killed the whole suite after
// ~20 s. JEST_WORKER_ID is set in every Jest worker, --runInBand included.
if (require.main === module && !process.env.JEST_WORKER_ID) {
  if (process.argv.includes("--dump-routes")) {
    try {
      dumpRoutes(process.argv[process.argv.indexOf("--dump-routes") + 1]);
      process.exit(0);
    } catch (err) {
      console.error(err.stack || err.message);
      process.exit(1);
    }
  } else {
    main().then(
      () => process.exit(0),
      (err) => {
        console.error(err.stack || err.message);
        process.exit(1);
      },
    );
  }
} else if (typeof describe === "function") {
  const suite = process.env.LIVE_CONTRACT === "1" ? describe : describe.skip;
  suite("live contract: every route and every frontend service call (LIVE_CONTRACT=1)", () => {
    let report;
    beforeAll(async () => {
      report = await main();
    }, 30 * 60 * 1000);

    it("no route answers a 5xx or times out", () => {
      expect(report.verdict.serverErrors.map((r) => `${r.method} ${r.path} ${r.status} ${r.detail || ""}`)).toEqual([]);
    });
    it("every JSON answer is the envelope: rows in data, pagination in a top-level meta", () => {
      expect(report.verdict.envelope.map((r) => `${r.method} ${r.path}: ${r.envelope.join("; ")}`)).toEqual([]);
    });
    it("no tenant-B admin reads a tenant-A object (404, never 2xx)", () => {
      expect(report.verdict.crossTenantLeaks.map((r) => `${r.url} ${r.status}`)).toEqual([]);
    });
    it("every frontend service call names a real method + path", () => {
      expect(report.verdict.frontendMissing.map((f) => `${f.file}:${f.line} ${f.method} ${f.path}`)).toEqual([]);
    });
    it("no frontend service reads data.rows / data.items / data.meta from a list endpoint", () => {
      expect(report.verdict.frontendShape.map((f) => `${f.file}:${f.line} ${f.method} ${f.path} reads ${f.reads}`)).toEqual([]);
    });
  });
}
