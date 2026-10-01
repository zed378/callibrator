/**
 * P6-08 — the published contract (swagger JSDoc) agrees with the enforced
 * validators (AC-29).
 *
 * WHY
 *
 * The GDPR endpoints documented request bodies their validators reject:
 * `POST /gdpr/erasure` documented `confirmDeletion` where the validator requires
 * `confirm: true`; `PUT /gdpr/consent` documented `consents`/`withdrawAll` where
 * it requires `categories`/`consent`; `PUT /gdpr/rectify` documented
 * `corrections`/`justification` where it requires `field`/`value`. Every one of
 * those validators runs with `stripUnknown`, so a client written from the spec
 * sent fields that were silently dropped and got a 400 for the ones it never
 * knew it needed. Documented drift is still drift.
 *
 * HOW
 *
 * `validation.middleware#validate` is wrapped before the routers load, so every
 * `validate(schema)` middleware carries its schema. Every router is walked, each
 * route is resolved to its mounted path(s) by reading `index.js`'s `require` and
 * `app.use` lines, and the swagger spec is generated in memory from the same
 * route files, with the same library, as `npm run swagger:generate`. For each
 * validated route the documented JSON request body is compared with the request
 * schema's `describe()`: the property names, and which are required.
 *
 * The GDPR endpoints must agree exactly. The rest of the tree is the sweep the
 * card asks for: its current divergences are pinned in KNOWN_DRIFT below, so a
 * new one fails and a fixed one forces the list to shrink.
 */

const fs = require("fs");
const path = require("path");
const { z } = require("zod");
// P9-25 (ADR-103): the published document is code-first (*.openapi.ts, zod-openapi)
// merged with the remaining JSDoc. It is built here by the SAME function
// `npm run openapi:generate` uses, so a code-first route is compared too.
const { buildDocument, serialise } = require("../../../scripts/openapi/build");

const validationMiddleware = require("../../middlewares/validation.middleware");
const { components } = require("../../docs/components");

const SRC = path.join(__dirname, "..", "..");
const ROUTES_DIR = path.join(SRC, "routes");
const INDEX_FILE = path.join(SRC, "..", "index.js");

const SCHEMA_TAG = Symbol.for("callibrator.p608.schema");
const realValidate = validationMiddleware.validate;
validationMiddleware.validate = (schema, ...rest) => {
  const middleware = realValidate(schema, ...rest);
  middleware[SCHEMA_TAG] = schema;
  return middleware;
};

const listJs = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listJs(full);
    }
    // ADR-087 Amendment 4: .ts too — a converted file must not leave this guard.
    return /\.(js|ts)$/.test(entry.name) ? [full] : [];
  });

/**
 * Mount prefixes per route module, read from index.js.
 *
 * @param {string} index - index.js source
 * @returns {Map<string, Map<string, string[]>>} module rel path -> export name
 *   ("default" for a router export) -> prefixes
 */
const mountsFrom = (index) => {
  const mounts = new Map();
  const vars = new Map();
  for (const m of index.matchAll(/const\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*require\(["']\.\/src\/routes\/([^"']+?)(?:\.js)?["']\)/g)) {
    // Keyed without the extension: a route module may be .js or .ts (ADR-087).
    const rel = m[2];
    mounts.set(rel, new Map());
    if (m[1].startsWith("{")) {
      for (const name of m[1].replace(/[{}\s]/g, "").split(",").filter(Boolean)) {
        vars.set(name, { rel, exportName: name });
      }
    } else {
      vars.set(m[1], { rel, exportName: "default" });
    }
  }
  for (const m of index.matchAll(/app\.use\(\s*(?:["']([^"']*)["']\s*,\s*)?([A-Za-z_$][\w$]*)\s*\)/g)) {
    const target = vars.get(m[2]);
    if (!target) {
      continue;
    }
    const byExport = mounts.get(target.rel);
    const list = byExport.get(target.exportName) || [];
    list.push(m[1] || "");
    byExport.set(target.exportName, list);
  }
  return mounts;
};

const toOpenApiPath = (expressPath) =>
  expressPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/(.)\/$/, "$1");

const resolveRef = (schema) => {
  if (schema && schema.$ref) {
    const name = schema.$ref.split("/").pop();
    return resolveRef(components.schemas[name]);
  }
  if (schema && Array.isArray(schema.allOf)) {
    return schema.allOf.map(resolveRef).reduce(
      (acc, part) => ({
        type: "object",
        properties: { ...acc.properties, ...(part.properties || {}) },
        required: [...acc.required, ...(part.required || [])],
      }),
      { properties: {}, required: [] },
    );
  }
  return schema;
};

/**
 * The keys of a request schema and which are required, read from the Zod
 * schema (P9-11: what the old library's `describe()` gave). A union of objects (storage's
 * per-provider bodies) accepts the union of their keys and requires a key
 * every branch requires. A key typed `never` is named only so its 400 can say
 * why (P6-13: a caller-supplied webhook `secret`); it is refused, not
 * accepted, so the contract does not document it.
 *
 * @param {import("zod").ZodType} schema - a request schema
 * @returns {{keys: string[], required: string[]}|null} null when not a keyed object body
 */
const describeBody = (schema) => {
  if (schema instanceof z.ZodUnion) {
    const parts = schema.options.map(describeBody);
    if (parts.some((p) => p === null)) {
      return null;
    }
    const keys = [...new Set(parts.flatMap((p) => p.keys))];
    const required = keys.filter((k) => parts.every((p) => p.required.includes(k)));
    return { keys, required };
  }
  if (!(schema instanceof z.ZodObject)) {
    return null;
  }
  const refused = (field) => field instanceof z.ZodOptional && field.unwrap() instanceof z.ZodNever;
  const keys = Object.keys(schema.shape).filter((k) => !refused(schema.shape[k]));
  // Required: the field refuses an absent value (a default or `.optional()` accepts it).
  const required = keys.filter((k) => !schema.shape[k].safeParse(undefined).success);
  return { keys, required };
};

/**
 * Compare one documented request body with one request schema.
 *
 * @param {object|undefined} operation - the swagger operation, if any
 * @param {import("zod").ZodType} schema - a request schema
 * @returns {string[]} divergences
 */
const compare = (operation, schema) => {
  const described = describeBody(schema);
  if (!described) {
    return []; // not a keyed object body — nothing comparable by name
  }
  const keys = described.keys;
  const required = [...described.required].sort();

  if (!operation) {
    return ["no swagger operation documents this route"];
  }
  const body = resolveRef(operation.requestBody?.content?.["application/json"]?.schema);
  if (!body || !body.properties) {
    return required.length > 0 ? [`no documented JSON body; the validator requires ${required.join(", ")}`] : [];
  }
  const documented = Object.keys(body.properties);
  const out = [];
  const specOnly = documented.filter((k) => !keys.includes(k));
  const validatorOnly = keys.filter((k) => !documented.includes(k));
  const documentedRequired = [...new Set(body.required || [])].sort();
  if (specOnly.length) {
    out.push(`documented but stripped by the validator: ${specOnly.join(", ")}`);
  }
  if (validatorOnly.length) {
    out.push(`accepted by the validator but undocumented: ${validatorOnly.join(", ")}`);
  }
  if (JSON.stringify(documentedRequired) !== JSON.stringify(required)) {
    out.push(`required: documented [${documentedRequired.join(", ")}], validator [${required.join(", ")}]`);
  }
  return out;
};

/** `schema` without the keys that are the route's `:params` (an object schema only). */
const withoutPathParams = (schema, routePath) => {
  const params = [...routePath.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  if (!(schema instanceof z.ZodObject) || params.length === 0) {
    return schema;
  }
  const present = params.filter((p) => p in schema.shape);
  return present.length ? schema.omit(Object.fromEntries(present.map((p) => [p, true]))) : schema;
};

let divergences;
let generatedSpec;
let compared;
const gdprCompared = [];

beforeAll(() => {
  // Route modules only: a *.openapi.ts contract module or a .d.ts exports no router.
  const files = listJs(ROUTES_DIR).filter((f) => !/\.(openapi|d)\.ts$/.test(f));
  const spec = buildDocument({ version: require("../../../package.json").version });
  generatedSpec = spec;
  const mounts = mountsFrom(fs.readFileSync(INDEX_FILE, "utf8"));

  divergences = {};
  compared = 0;
  for (const file of files) {
    const rel = path.relative(ROUTES_DIR, file).split(path.sep).join("/");
    const exported = require(file);
    const routers = typeof exported === "function" ? { default: exported } : exported;
    for (const [exportName, router] of Object.entries(routers)) {
      if (!router || !Array.isArray(router.stack)) {
        continue;
      }
      const prefixes = mounts.get(rel.replace(/\.(js|ts)$/, ""))?.get(exportName) || [];
      for (const layer of router.stack) {
        if (!layer.route) {
          continue;
        }
        const schemas = layer.route.stack.map((s) => s.handle[SCHEMA_TAG]).filter(Boolean);
        if (schemas.length === 0) {
          continue;
        }
        for (const method of Object.keys(layer.route.methods)) {
          // A router mounted twice is documented once; any mount that has an
          // operation counts.
          const operations = prefixes
            .map((prefix) => spec.paths?.[toOpenApiPath(prefix + layer.route.path)]?.[method])
            .filter(Boolean);
          // A validator that reads `from: ["params", "body"]` (P9-11) sees the
          // path parameters too; they are documented as parameters, not body
          // fields, so they are left out of the body comparison.
          const found = compare(operations[0], withoutPathParams(schemas[schemas.length - 1], layer.route.path));
          compared++;
          if (prefixes.some((p) => p === "/api/v1/gdpr")) {
            gdprCompared.push(`${method.toUpperCase()} ${layer.route.path}`);
          }
          if (found.length) {
            const where = prefixes.length ? prefixes[0] + layer.route.path : `(unmounted) ${rel} ${layer.route.path}`;
            divergences[`${method.toUpperCase()} ${where}`] = found;
          }
        }
      }
    }
  }
});

/**
 * The sweep (P6-08 DoD 4): validated routes elsewhere whose documented body
 * disagrees with the validator, as of 2026-09-24. Each is the AC-29 defect in
 * another module. The list may only shrink: fix the annotation (or the
 * validator), then delete the line.
 */
const KNOWN_DRIFT = require("./swaggerValidatorAlignment.knownDrift.json");
// To re-derive the list after fixing entries: P608_DUMP=/tmp/drift.json npm test -- <this file>
if (process.env.P608_DUMP) {
  afterAll(() => fs.writeFileSync(process.env.P608_DUMP, JSON.stringify(divergences, null, 2)));
}

describe("P6-08 — swagger request bodies agree with the request validators", () => {
  it("found validated routes to compare (a sweep that compares nothing is not a pass)", () => {
    expect(compared).toBeGreaterThan(50);
    expect(gdprCompared.sort()).toEqual(["POST /erasure", "POST /restrict", "PUT /consent", "PUT /rectify"]);
  });

  it("every /api/v1/gdpr endpoint documents exactly what its validator enforces", () => {
    const gdpr = Object.fromEntries(
      Object.entries(divergences).filter(([k]) => k.includes("/api/v1/gdpr")),
    );
    expect(gdpr).toEqual({});
  });

  it("the committed openapi.json (what /docs serves) carries the corrected GDPR contract, and is current", () => {
    // P9-25 (ADR-103): openapi.json replaced swagger.json. It is committed and
    // served as is; `npm run openapi:check` (build, CI) fails when it is stale.
    const raw = fs.readFileSync(path.join(SRC, "..", "openapi.json"), "utf8");
    expect(raw.split(String.fromCharCode(13)).join("")).toBe(serialise(generatedSpec)); // CRLF-agnostic
    const committed = JSON.parse(raw);
    const gdprPaths = Object.keys(generatedSpec.paths).filter((p) => p.startsWith("/api/v1/gdpr"));
    expect(gdprPaths.length).toBe(8);
    for (const p of gdprPaths) {
      expect([p, committed.paths[p]]).toEqual([p, generatedSpec.paths[p]]);
    }
  });

  it("the rest of the tree: no divergence beyond the pinned list, and no stale entry in it", () => {
    const current = Object.keys(divergences).sort();
    expect(current).toEqual(Object.keys(KNOWN_DRIFT).sort());
  });

  it("compare() in both directions", () => {
    const schema = z.object({ a: z.string(), b: z.number().optional(), s: z.never().optional() });
    const op = (properties, required) => ({
      requestBody: { content: { "application/json": { schema: { type: "object", properties, required } } } },
    });
    expect(compare(op({ a: {}, b: {} }, ["a"]), schema)).toEqual([]);
    expect(compare(op({ a: {}, c: {} }, ["a"]), schema)).toEqual([
      "documented but stripped by the validator: c",
      "accepted by the validator but undocumented: b",
    ]);
    expect(compare(op({ a: {}, b: {} }, []), schema)).toEqual([
      "required: documented [], validator [a]",
    ]);
    expect(compare(undefined, schema)).toEqual(["no swagger operation documents this route"]);
    expect(compare({}, schema)).toEqual(["no documented JSON body; the validator requires a"]);
    expect(compare({}, z.object({ x: z.string().optional() }))).toEqual([]);
    expect(compare(undefined, z.string())).toEqual([]);
    const union = z.discriminatedUnion("k", [
      z.object({ k: z.literal("a"), a: z.string(), both: z.string() }),
      z.object({ k: z.literal("b"), b: z.string().optional(), both: z.string() }),
    ]);
    expect(compare(op({ k: {}, a: {}, b: {}, both: {} }, ["both", "k"]), union)).toEqual([]);
    expect(compare(undefined, z.union([z.object({ a: z.string() }), z.string()]))).toEqual([]);
    expect(
      compare({ requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/LoginRequest" } } } } }, schema)[0],
    ).toMatch(/documented but stripped/);
  });
});
