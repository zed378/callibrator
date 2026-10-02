/**
 * P9-25 (ADR-103) — how a route module documents itself, code-first.
 *
 * A route file `routes/api/<name>.route.*` gets a sibling `<name>.openapi.ts`
 * that default-exports `defineRouteDocs({...})`. Request schemas are the SAME
 * Zod objects `validate()` enforces (imported from `validators/` or
 * `@callibrator/contracts`), so the published request contract cannot drift
 * from the enforced one. `scripts/openapi/build.ts` turns every such module
 * into OpenAPI 3.1 operations with `toPathItems`, and merges the JSDoc of the
 * routes not yet moved.
 *
 * What an operation DECLARES (permission, authentication) is checked against
 * the mounted Express chain by `tests/guards/openapiRoutes.p925.test.ts`: the
 * `dynamicAccess(resource, action)` / `rbac(roles)` gate the router really
 * carries must equal `permission`, so `x-permission` cannot lie.
 */
import { z } from "zod";
import type { ZodOpenApiOperationObject, ZodOpenApiPathsObject, ZodOpenApiResponsesObject } from "zod-openapi";
import { emptyEnvelope, envelope, errorResponses, listEnvelope, type ErrorStatus } from "./envelope";

/** HTTP methods a route may be documented under. */
export type Method = "get" | "post" | "put" | "patch" | "delete";

/** The gate a route's chain carries — what `x-permission` publishes. */
export type Permission =
  | {
      readonly kind: "dynamicAccess";
      /**
       * The menu/resource slug: `dynamicAccess("vendors", ...)`. P9-21: or the list
       * of slugs a gate accepts ANY of (`dynamicAccess(["certificate", "warehouse"], "write")`).
       */
      readonly resource: string | readonly string[];
      /** The action: read, create, update, delete, write. */
      readonly action: string;
    }
  | { readonly kind: "rbac"; readonly roles: readonly string[] }
  | { readonly kind: "superAdminOnly" }
  /**
   * P9-21: a route that authenticates (`auth`) and carries NO gate factory —
   * the caller's own resources (`/auth/me`, own sessions, own passkeys), or a
   * check made inside the handler (SCIM's API-key scope). `reason` says which;
   * it is published as `x-permission.note`. The guard holds it to the chain:
   * declaring it on a route that carries a gate is a mismatch.
   */
  | { readonly kind: "authenticated"; readonly reason: string };

/** What the successful answer carries in `data`. */
export type Success =
  | { readonly status: 200 | 201; readonly description: string; readonly data: z.ZodType }
  | { readonly status: 200; readonly description: string; readonly list: z.ZodType }
  | { readonly status: 200 | 201; readonly description: string; readonly empty: true }
  // P10-05: an accepted-for-processing answer that says nothing more (the access-request intake).
  | { readonly status: 202; readonly description: string; readonly empty: true }
  // P9-21: a file download, not the envelope (the stock CSV export): the body is the file itself.
  | { readonly status: 200; readonly description: string; readonly file: { readonly contentType: string } }
  // P9-21: a handler that answers its own JSON shape, NOT the house envelope (roles.controller answers
  // `{ success, data }` with no status or message). Documented as it is; converging on the envelope is a
  // behaviour change for its own card, never for a conversion.
  | { readonly status: 200 | 201; readonly description: string; readonly body: z.ZodType }
  // P9-21: a 204 — no body. (scim.controller's deletes call `res.status(204).json(...)`; Express drops a 204's body.)
  | { readonly status: 204; readonly description: string; readonly noContent: true }
  // P9-21: a redirect (the OIDC authorization endpoint): no body; `Location` says where.
  | { readonly status: 302; readonly description: string; readonly redirect: true };

/** An error status whose body this operation answers in its OWN shape (see `Success.body`). */
export interface ErrorBody {
  readonly description: string;
  readonly body: z.ZodType;
  /** A synthetic example (Spectral requires one on an error response). */
  readonly example: Readonly<Record<string, unknown>>;
}

/** One documented operation. */
export interface DocumentedOperation {
  readonly method: Method;
  /** The path as the ROUTER registers it (`/`, `/:vendorId`), not the mounted one. */
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly description?: string;
  /** The gate. `null` only for a route with no `auth` (public) — a reviewed fact, checked by the guard. */
  readonly permission: Permission | null;
  /** Whether a successful call writes an audit row (inside its transaction). */
  readonly audited: boolean;
  /** Path parameters; a `:param` in `path` without an entry here is an error. */
  readonly params?: z.ZodObject;
  readonly query?: z.ZodObject;
  /** The request body: the same schema `validate()` enforces on this route. */
  readonly body?: z.ZodType;
  /**
   * P9-20: the body's media type, when it is not JSON — a file upload through
   * `upload()` (multer) is `multipart/form-data`. Absent: `application/json`.
   */
  readonly bodyMediaType?: "multipart/form-data";
  readonly success: Success;
  /**
   * A 409 this operation can answer, and the state that causes it. Stated,
   * because a 409 is a state explanation, never a generic error (CLAUDE.md).
   */
  readonly conflict?: string;
  /** Extra error statuses beyond the ones derived (400, 401, 403, 404, 409, 429). */
  readonly errors?: readonly ErrorStatus[];
  /**
   * An error status the handler answers in its own shape instead of the
   * standard `ErrorEnvelope` component (as-built; documented as it is).
   */
  readonly errorBodies?: Readonly<Partial<Record<ErrorStatus, ErrorBody>>>;
}

/** Everything one route module documents. */
export interface RouteDocs {
  /** The route module, relative to `src/routes`, without extension: `api/vendor.route`. */
  readonly router: string;
  /** Where `index.js` mounts it: `/api/v1/vendors`. */
  readonly mount: string;
  /** The tag the operations are grouped under (one of `docs/tags.js`, or new). */
  readonly tag: string;
  readonly tagDescription?: string;
  /** Whether rows are tenant-owned (adds the cross-tenant 404 note to `:param` operations). */
  readonly tenantScoped: boolean;
  readonly operations: readonly DocumentedOperation[];
  /**
   * P9-18: further mounts of the SAME router (index.ts mounts it again: the
   * menu-group router at `/api/v1/menu-group-roles`, the OIDC provider at the
   * issuer-root `/oidc`). Every operation is published at each, as the same
   * contract: same handlers, same chain (the P9-25 guard checks each mounted
   * path against its chain). An OpenAPI operationId is unique, so the copy's
   * takes `operationIdSuffix`, and `x-alias-of` names the primary path.
   */
  readonly alsoMountedAt?: readonly { readonly mount: string; readonly operationIdSuffix: string }[];
}

/** Identity, typed: the default export of every `*.openapi.ts`. */
export const defineRouteDocs = (docs: RouteDocs): RouteDocs => docs;

/**
 * The global limiter every route sits behind (`index.js` `defaultLimiter`),
 * published as `x-rate-limit`. `tests/guards/openapiRoutes.p925.test.ts` pins
 * these values against the `index.js` source.
 */
export const DEFAULT_RATE_LIMIT = Object.freeze({
  policy: "default",
  scope: "per client address",
  windowSeconds: 900,
  limitProduction: 5000,
  limitOtherwise: 100000,
  overriddenBy: "RATE_LIMIT_MAX",
  headers: "RateLimit-Policy, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset",
});

const TENANT_NOTE =
  "Tenant-scoped: the row is looked up inside the caller's tenant. Another tenant's id answers **404**, " +
  "exactly like an id that does not exist — never 403.";

/** `/:vendorId/qualify` → `/{vendorId}/qualify`; the root `/` of a mount disappears. */
export const toOpenApiPath = (mount: string, path: string): string =>
  (mount + path).replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/(.)\/$/, "$1");

/** The `:param` names of an Express path. */
export const pathParams = (path: string): string[] => [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] ?? "");

const successResponse = (success: Success) => {
  if ("noContent" in success) {
    return { description: success.description };
  }
  if ("redirect" in success) {
    return {
      description: success.description,
      headers: { Location: { description: "Where the browser goes next", schema: { type: "string" as const } } },
    };
  }
  if ("body" in success) {
    return { description: success.description, content: { "application/json": { schema: success.body } } };
  }
  if ("file" in success) {
    return {
      description: success.description,
      content: { [success.file.contentType]: { schema: z.string().meta({ description: "The file itself" }) } },
    };
  }
  const schema =
    "list" in success ? listEnvelope(success.list) : "data" in success ? envelope(success.data) : emptyEnvelope();
  return { description: success.description, content: { "application/json": { schema } } };
};

const permissionExtension = (permission: Permission | null): Record<string, unknown> | null => {
  if (permission === null) {
    return null;
  }
  if (permission.kind === "dynamicAccess") {
    const resource = typeof permission.resource === "string" ? permission.resource : [...permission.resource];
    return { gate: "dynamicAccess", resource, action: permission.action, superAdmin: "bypasses" };
  }
  if (permission.kind === "rbac") {
    return { gate: "rbac", roles: [...permission.roles], higherRoles: "allowed", superAdmin: "bypasses" };
  }
  if (permission.kind === "authenticated") {
    return { gate: "authenticated", note: permission.reason };
  }
  return { gate: "superAdminOnly" };
};

/** One documented operation as a zod-openapi operation object. */
export const toOperation = (docs: RouteDocs, op: DocumentedOperation): ZodOpenApiOperationObject => {
  const params = pathParams(op.path);
  const declared = op.params ? Object.keys(op.params.shape) : [];
  const missing = params.filter((p) => !declared.includes(p));
  const extra = declared.filter((p) => !params.includes(p));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${docs.router} ${op.method.toUpperCase()} ${op.path}: path parameters [${params.join(", ")}] ` +
        `and declared params [${declared.join(", ")}] differ`,
    );
  }

  const responses: ZodOpenApiResponsesObject = { [String(op.success.status)]: successResponse(op.success) };
  const statuses = new Set<ErrorStatus>(op.errors ?? []);
  if (op.body !== undefined || op.query !== undefined || params.length > 0) {
    statuses.add(400);
  }
  if (op.permission !== null) {
    statuses.add(401);
    statuses.add(403);
  }
  if (params.length > 0) {
    statuses.add(404);
  }
  if (op.conflict !== undefined) {
    statuses.add(409);
  }
  statuses.add(429);
  for (const code of [...statuses].sort((a, b) => a - b)) {
    const own = op.errorBodies?.[code];
    responses[String(code) as `4${string}`] =
      own === undefined
        ? errorResponses[code]
        : { description: own.description, content: { "application/json": { schema: own.body, example: own.example } } };
  }

  const notes = [
    op.description,
    docs.tenantScoped && params.length > 0 ? TENANT_NOTE : undefined,
    op.conflict === undefined ? undefined : `**409** — ${op.conflict}`,
  ].filter((n): n is string => n !== undefined);

  const operation: ZodOpenApiOperationObject = {
    operationId: op.operationId,
    summary: op.summary,
    tags: [docs.tag],
    security: op.permission === null ? [] : [{ bearerAuth: [] }],
    responses,
    "x-audited": op.audited,
    "x-rate-limit": DEFAULT_RATE_LIMIT,
    "x-source": `code-first: src/routes/${docs.router.replace(/\.route$/, ".openapi.ts")}`,
  };
  const permission = permissionExtension(op.permission);
  if (permission === null) {
    operation["x-public"] = true;
  } else {
    operation["x-permission"] = permission;
  }
  if (notes.length > 0) {
    operation.description = notes.join("\n\n");
  }
  if (op.params !== undefined || op.query !== undefined) {
    operation.requestParams = {
      ...(op.params === undefined ? {} : { path: op.params }),
      ...(op.query === undefined ? {} : { query: op.query }),
    };
  }
  if (op.body !== undefined) {
    operation.requestBody = { required: true, content: { [op.bodyMediaType ?? "application/json"]: { schema: op.body } } };
  }
  return operation;
};

/** Every operation of a route module, keyed by OpenAPI path then method. */
export const toPathItems = (docs: RouteDocs): ZodOpenApiPathsObject => {
  const paths: ZodOpenApiPathsObject = {};
  const mounts = [{ mount: docs.mount, operationIdSuffix: "" }, ...(docs.alsoMountedAt ?? [])];
  for (const { mount, operationIdSuffix } of mounts) {
    for (const op of docs.operations) {
      const key = toOpenApiPath(mount, op.path);
      const item = (paths[key] ??= {});
      if (item[op.method] !== undefined) {
        throw new Error(`${docs.router}: ${op.method.toUpperCase()} ${key} is documented twice`);
      }
      const operation = toOperation(docs, op);
      if (operationIdSuffix !== "") {
        operation.operationId = `${op.operationId}${operationIdSuffix}`;
        operation["x-alias-of"] = toOpenApiPath(docs.mount, op.path);
      }
      item[op.method] = operation;
    }
  }
  return paths;
};
