/**
 * A-51 — every webhook route that takes a body mounts `validate(schema)`, and
 * the rotation route exists behind the same tenant-admin gate as the others.
 *
 * `validate` is wrapped (not replaced) so each middleware it builds carries the
 * schema it was built from; the chain can then be checked for the schema by
 * identity. This also catches the `schema.validate`-passed-to-Express trap
 * (CLAUDE.md): that would put a schema's own method in the chain, not a tagged
 * middleware, and the assertion below would fail.
 */
import type { RequestHandler, Router } from "express";
import type { z } from "zod";
import type * as AuthMiddleware from "../../middlewares/auth.middleware";
import type * as ValidationMiddleware from "../../middlewares/validation.middleware";
import { ROLE_NAMES } from "../../constants";
import { createWebhookSchema, updateWebhookSchema } from "../../validators/webhook.validator";

jest.mock("../../middlewares/validation.middleware", () => {
  const actual = jest.requireActual<typeof ValidationMiddleware>("../../middlewares/validation.middleware");
  return {
    ...actual,
    validate: (schema: z.ZodType) => {
      const mw = actual.validate(schema);
      (mw as unknown as { __schema: z.ZodType }).__schema = schema;
      return mw;
    },
  };
});

// Tag the role gate with its roles, as routeGuards.a02.test.js does.
jest.mock("../../middlewares/rbac.middleware", () => ({
  rbac: jest.fn((roles: string[]) => {
    const fn = (_req: unknown, _res: unknown, next: () => void): void => {
      next();
    };
    (fn as unknown as { __roles: string[] }).__roles = roles;
    return fn;
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
const webhooks = require("../../routes/api/webhooks.route") as Router;
const authModule = jest.requireActual<typeof AuthMiddleware>("../../middlewares/auth.middleware");
const { auth, denyApiKey } = authModule;

interface TaggedHandler extends RequestHandler {
    __schema?: z.ZodType;
    __roles?: string[];
}

interface RouteStackEntry {
    handle: TaggedHandler;
}

interface RouteLayer {
    route?: { path: string; methods: Record<string, boolean>; stack: RouteStackEntry[] };
}

const chain = (path: string, method: string): TaggedHandler[] => {
  const layer = (webhooks.stack as unknown as RouteLayer[]).find(
    (l) => l.route?.path === path && l.route.methods[method] === true,
  );
  expect(layer).toBeDefined();
  return (layer?.route?.stack ?? []).map((s) => s.handle);
};

const schemaOf = (handlers: TaggedHandler[]): z.ZodType | undefined =>
  handlers.find((h) => h.__schema !== undefined)?.__schema;

describe("A-51 — webhook routes validate their bodies", () => {
  it("POST / mounts validate(createWebhookSchema)", () => {
    expect(schemaOf(chain("/", "post"))).toBe(createWebhookSchema);
  });

  it("PATCH /:id mounts validate(updateWebhookSchema)", () => {
    expect(schemaOf(chain("/:id", "patch"))).toBe(updateWebhookSchema);
  });

  it("no handler in any webhook chain is a bare schema `validate` method", () => {
    for (const layer of webhooks.stack as unknown as RouteLayer[]) {
      if (layer.route === undefined) {
        continue;
      }
      for (const s of layer.route.stack) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- the assertion IS the check: a bare schema method in the chain must fail
        expect(s.handle).not.toBe(createWebhookSchema.validate);
        // eslint-disable-next-line @typescript-eslint/unbound-method -- the assertion IS the check: a bare schema method in the chain must fail
        expect(s.handle).not.toBe(updateWebhookSchema.validate);
      }
    }
  });

  it("validation runs after the auth and role gates, and before the controller", () => {
    const handlers = chain("/", "post");
    const v = handlers.findIndex((h) => h.__schema !== undefined);
    const a = handlers.indexOf(auth as TaggedHandler);
    const r = handlers.findIndex((h) => Array.isArray(h.__roles));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(v);
    expect(r).toBeLessThan(v);
    expect(v).toBe(handlers.length - 2);
  });

  it("POST /:id/rotate-secret exists, tenant-admin only, never for an API key", () => {
    const handlers = chain("/:id/rotate-secret", "post");
    expect(handlers).toContain(auth);
    expect(handlers).toContain(denyApiKey);
    expect(handlers.find((h) => Array.isArray(h.__roles))?.__roles).toEqual([ROLE_NAMES.TENANT_ADMIN]);
  });
});
