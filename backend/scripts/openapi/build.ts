/**
 * P9-25 (ADR-103) — assemble the published OpenAPI 3.1 document.
 *
 *   published = code-first operations (every src/routes/**\/*.openapi.ts, via zod-openapi)
 *             + the shared components and tags (src/docs/components.ts, src/docs/tags.ts)
 *
 * Every operation is generated from the Zod schemas `validate()` enforces
 * (src/docs/openapi/operation.ts). The JSDoc half (swagger-jsdoc) is gone since
 * 2026-10-02 (P9-24): every route had moved to `.openapi.ts`, and the JSDoc half
 * contributed no path and no component. A route source that still carries an
 * `@swagger` / `@openapi` JSDoc tag is refused, so a contract written that way
 * cannot be dropped silently. The shared components are written in OpenAPI 3.0
 * style and are normalised to 3.1 here.
 *
 * Nothing here loads a router, a model or the environment: generation is a
 * pure function of the source tree, so it runs the same in CI, in the image
 * build and on a laptop. The route-to-document checks that DO load routers
 * are the guard tests (tests/guards/openapiRoutes.p925.test.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { createDocument, type ZodOpenApiPathsObject } from "zod-openapi";
import { toPathItems, type RouteDocs } from "../../src/docs/openapi/operation";
import legacyComponents from "../../src/docs/components";
import legacyTags from "../../src/docs/tags";

const BACKEND = path.resolve(__dirname, "..", "..");
const ROUTES = path.join(BACKEND, "src", "routes");

/** Where the committed document lives (served by routes/internal/apiDocs.route.ts). */
export const OPENAPI_FILE = path.join(BACKEND, "openapi.json");

type Json = Record<string, unknown>;
type Methods = Record<string, Json>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const listFiles = (dir: string, wanted: (name: string) => boolean): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listFiles(full, wanted);
      }
      return wanted(entry.name) ? [full] : [];
    })
    .sort();

/** Route modules: never the .openapi.ts or declaration files. */
export const routeSources = (dir: string = ROUTES): string[] =>
  listFiles(dir, (n) => /\.(js|ts)$/.test(n) && !n.endsWith(".d.ts") && !n.endsWith(".openapi.ts"));

/** Every code-first module under `dir`, loaded and checked against its file name. */
export const loadRouteDocs = (dir: string = ROUTES): RouteDocs[] =>
  listFiles(dir, (n) => n.endsWith(".openapi.ts")).map((file) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- discovered at run time: every *.openapi.ts is a module
    const loaded = require(file) as { default?: RouteDocs };
    const docs = loaded.default;
    if (docs === undefined || !Array.isArray(docs.operations)) {
      throw new Error(`${file}: must default-export defineRouteDocs({...})`);
    }
    const expected = path
      .relative(dir, file)
      .split(path.sep)
      .join("/")
      .replace(/\.openapi\.ts$/, ".route");
    if (docs.router !== expected) {
      throw new Error(`${file}: documents router "${docs.router}", but sits beside "${expected}"`);
    }
    return docs;
  });

/**
 * OpenAPI 3.0 → 3.1 for the shared components, in place: `nullable: true` becomes a
 * `"null"` type (3.1 dropped `nullable`); a boolean `exclusiveMinimum` /
 * `exclusiveMaximum` becomes the numeric form.
 */
export const normaliseLegacy = (node: unknown): void => {
  if (Array.isArray(node)) {
    node.forEach(normaliseLegacy);
    return;
  }
  if (!isObject(node)) {
    return;
  }
  for (const value of Object.values(node)) {
    normaliseLegacy(value);
  }
  if (node["nullable"] === true) {
    Reflect.deleteProperty(node, "nullable");
    const type = node["type"];
    if (typeof type === "string") {
      node["type"] = [type, "null"];
    } else if (Array.isArray(type)) {
      node["type"] = [...new Set([...(type as unknown[]), "null"])];
    } else {
      const copy: Json = { ...node };
      for (const key of Object.keys(node)) {
        Reflect.deleteProperty(node, key);
      }
      node["anyOf"] = [copy, { type: "null" }];
    }
  } else if (node["nullable"] === false) {
    Reflect.deleteProperty(node, "nullable");
  }
  for (const [flag, bound] of [
    ["exclusiveMinimum", "minimum"],
    ["exclusiveMaximum", "maximum"],
  ] as const) {
    const exclusive = node[flag];
    if (typeof exclusive === "boolean") {
      if (exclusive && typeof node[bound] === "number") {
        node[flag] = node[bound];
        Reflect.deleteProperty(node, bound);
      } else {
        Reflect.deleteProperty(node, flag);
      }
    }
  }
};

/** A JSDoc contract tag at the start of a comment line (what swagger-jsdoc read). */
const JSDOC_CONTRACT_TAG = /^\s*\*\s*@(swagger|openapi)\b/m;

/**
 * Refuses a route source that still documents its contract in JSDoc: nothing
 * reads it any more, so it would be dropped from the contract silently.
 * @param files - the route modules
 * @throws Error naming each offending file
 */
export const assertNoJsdocContract = (files: string[] = routeSources()): void => {
  const offenders = files.filter((file) => JSDOC_CONTRACT_TAG.test(fs.readFileSync(file, "utf8")));
  if (offenders.length > 0) {
    throw new Error(
      "an @swagger/@openapi JSDoc block is no longer read — document the route in its .openapi.ts module instead:\n  " +
        offenders.map((file) => path.relative(BACKEND, file)).join("\n  "),
    );
  }
};

const mergeSection = (into: Json, from: Json, where: string): void => {
  for (const [name, value] of Object.entries(from)) {
    if (name in into && JSON.stringify(into[name]) !== JSON.stringify(value)) {
      throw new Error(`components.${where}.${name} is defined twice, differently (code-first and JSDoc)`);
    }
    into[name] = value;
  }
};

const sortKeys = <T extends Json>(object: T): T =>
  Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b))) as T;

interface BuildInput {
  readonly docs?: readonly RouteDocs[];
  readonly version?: string;
}

/** The published document. */
export const buildDocument = (input: BuildInput = {}): Json => {
  assertNoJsdocContract();
  const docs = input.docs ?? loadRouteDocs();
  const legacyCopy = JSON.parse(JSON.stringify(legacyComponents.components)) as Json;
  normaliseLegacy(legacyCopy);

  const codePaths: ZodOpenApiPathsObject = {};
  const tags = new Map<string, Json>(legacyTags.tags.map((t: { name: string; description: string }) => [t.name, { ...t }]));
  for (const module of docs) {
    for (const [key, item] of Object.entries(toPathItems(module))) {
      const existing = codePaths[key] ?? {};
      for (const method of Object.keys(item)) {
        if (method in existing) {
          throw new Error(`${method.toUpperCase()} ${key} is documented by two .openapi.ts modules`);
        }
      }
      codePaths[key] = { ...existing, ...item };
    }
    if (!tags.has(module.tag)) {
      tags.set(module.tag, { name: module.tag, ...(module.tagDescription ? { description: module.tagDescription } : {}) });
    }
  }

  const generated = createDocument(
    {
      openapi: "3.1.0",
      info: {
        title: "Callibrator API",
        version: input.version ?? "1.0.0",
        description:
          "Multi-tenant hospital medical-device calibration, maintenance and lifecycle management.\n\n" +
          "**Envelope.** Every JSON answer is `{ success, status, message, data }`; a paginated list adds a " +
          "top-level `meta` beside `data` (never `data.rows`).\n\n" +
          "**Tenancy.** Every row is read inside the caller's tenant. Another tenant's id answers **404**, " +
          "exactly like an id that does not exist. **403** means a permission failure inside your own tenant; " +
          "**409** explains a state that does not allow the action.\n\n" +
          "**Extensions.** `x-permission` is the gate the route's middleware chain carries (checked against " +
          "the mounted router by a test); `gate: authenticated` means a token and no gate (the caller's own " +
          "resources, or a check inside the handler: `note` says which); `x-audited` says whether a success writes an audit row; " +
          "`x-rate-limit` states the limiter.\n\n" +
          "Generated by `npm run openapi:generate`, code-first: every operation comes from its route's " +
          "`*.openapi.ts` module and the Zod schemas `validate()` enforces, with the shared components and " +
          "tags of `src/docs/` (ADR-103). Do not edit `openapi.json` by hand.",
      },
      servers: [{ url: "/", description: "This deployment" }],
      security: [{ bearerAuth: [] }],
      paths: codePaths,
      components: {},
    },
  ) as unknown as Json;

  const paths = (generated["paths"] ?? {}) as Record<string, Methods>;

  const components = (generated["components"] ?? {}) as Record<string, Json>;
  for (const source of [legacyCopy]) {
    for (const [section, entries] of Object.entries(source)) {
      if (isObject(entries)) {
        components[section] ??= {};
        mergeSection(components[section], entries, section);
      }
    }
  }
  for (const [section, entries] of Object.entries(components)) {
    components[section] = sortKeys(entries);
  }

  return {
    openapi: generated["openapi"],
    info: generated["info"],
    servers: generated["servers"],
    security: generated["security"],
    tags: [...tags.values()].sort((a, b) => String(a["name"]).localeCompare(String(b["name"]))),
    paths: sortKeys(paths),
    components: sortKeys(components),
  };
};

/** The document as it is written to disk (stable: sorted keys, two-space JSON, final newline). */
export const serialise = (document: Json): string => `${JSON.stringify(document, null, 2)}\n`;

/** Whether the committed file equals a fresh build (line endings ignored: git may check out CRLF). */
export const isCurrent = (committed: string, fresh: string): boolean =>
  committed.replace(/\r\n/g, "\n") === fresh.replace(/\r\n/g, "\n");
