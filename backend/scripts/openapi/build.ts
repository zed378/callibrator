/**
 * P9-25 (ADR-103) — assemble the published OpenAPI 3.1 document.
 *
 *   published = code-first operations (every src/routes/**\/*.openapi.ts, via zod-openapi)
 *             ∪ the @swagger JSDoc of the routes not yet moved (swagger-jsdoc)
 *
 * The code-first half is generated from the Zod schemas `validate()` enforces
 * (src/docs/openapi/operation.ts). The JSDoc half is what `swagger:generate`
 * produced before P9-25, normalised from OpenAPI 3.0 to 3.1. An operation
 * documented in BOTH halves is refused: a route moves to `.openapi.ts` and its
 * JSDoc block is deleted in the same change (the owner's per-module migration).
 *
 * Nothing here loads a router, a model or the environment: generation is a
 * pure function of the source tree, so it runs the same in CI, in the image
 * build and on a laptop. The route-to-document checks that DO load routers
 * are the guard tests (tests/guards/openapiRoutes.p925.test.ts).
 */
import fs from "node:fs";
import path from "node:path";
import swaggerJsdoc from "swagger-jsdoc";
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

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

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

/** Route sources swagger-jsdoc reads: route modules, never the .openapi.ts or declaration files. */
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
 * OpenAPI 3.0 → 3.1 for the JSDoc half, in place: `nullable: true` becomes a
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

/** The JSDoc half: paths and components, as swagger-jsdoc reads them. */
export const legacySpec = (files: string[] = routeSources()): { paths: Record<string, Methods>; components: Json } => {
  const spec = swaggerJsdoc({
    definition: { openapi: "3.0.0", info: { title: "legacy", version: "0" } },
    apis: files,
    // A block with broken YAML is DROPPED silently by default: its route vanishes from the contract.
    failOnErrors: true,
  }) as Json;
  const paths = (isObject(spec["paths"]) ? spec["paths"] : {}) as Record<string, Methods>;
  const components = isObject(spec["components"]) ? spec["components"] : {};
  normaliseLegacy(paths);
  normaliseLegacy(components);
  return { paths, components };
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
  readonly legacy?: { paths: Record<string, Methods>; components: Json };
  readonly version?: string;
}

/** The published document. */
export const buildDocument = (input: BuildInput = {}): Json => {
  const docs = input.docs ?? loadRouteDocs();
  const legacy = input.legacy ?? legacySpec();
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
          "the mounted router by a test); `x-audited` says whether a success writes an audit row; " +
          "`x-rate-limit` states the limiter.\n\n" +
          "Generated by `npm run openapi:generate` from the Zod request schemas (`*.openapi.ts`) and the " +
          "remaining route JSDoc (ADR-103). Do not edit `openapi.json` by hand.",
      },
      servers: [{ url: "/", description: "This deployment" }],
      security: [{ bearerAuth: [] }],
      paths: codePaths,
      components: {},
    },
  ) as unknown as Json;

  const paths = (generated["paths"] ?? {}) as Record<string, Methods>;
  for (const [key, methods] of Object.entries(legacy.paths)) {
    const target = (paths[key] ??= {});
    for (const [method, operation] of Object.entries(methods)) {
      if (HTTP_METHODS.has(method) && method in target) {
        throw new Error(
          `${method.toUpperCase()} ${key} is documented twice: by a .openapi.ts module AND a @swagger JSDoc block — delete the JSDoc`,
        );
      }
      target[method] = operation;
    }
  }

  const components = (generated["components"] ?? {}) as Record<string, Json>;
  for (const source of [legacyCopy, legacy.components]) {
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
