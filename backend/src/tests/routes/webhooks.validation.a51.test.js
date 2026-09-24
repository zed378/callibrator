/**
 * A-51 — every webhook route that takes a body mounts `validate(schema)`, and
 * the rotation route exists behind the same tenant-admin gate as the others.
 *
 * `validate` is wrapped (not replaced) so each middleware it builds carries the
 * schema it was built from; the chain can then be checked for the schema by
 * identity. This also catches the `schema.validate`-passed-to-Express trap
 * (CLAUDE.md): that would put a Joi method in the chain, not a tagged
 * middleware, and the assertion below would fail.
 */
jest.mock("../../middlewares/validation.middleware", () => {
  const actual = jest.requireActual("../../middlewares/validation.middleware");
  return {
    ...actual,
    validate: (schema) => {
      const mw = actual.validate(schema);
      mw.__schema = schema;
      return mw;
    },
  };
});

// Tag the role gate with its roles, as routeGuards.a02.test.js does.
jest.mock("../../middlewares/rbac.middleware", () => ({
  rbac: jest.fn((roles) => {
    const fn = (req, res, next) => next();
    fn.__roles = roles;
    return fn;
  }),
}));

const webhooks = require("../../routes/api/webhooks.route");
const { createWebhookSchema, updateWebhookSchema } = require("../../validators/webhook.validator");
const { auth, denyApiKey } = require("../../middlewares/auth.middleware");
const { ROLE_NAMES } = require("../../constants");

const chain = (path, method) => {
  const layer = webhooks.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  expect(layer).toBeDefined();
  return layer.route.stack.map((s) => s.handle);
};

const schemaOf = (handlers) => handlers.find((h) => h.__schema)?.__schema;

describe("A-51 — webhook routes validate their bodies", () => {
  it("POST / mounts validate(createWebhookSchema)", () => {
    expect(schemaOf(chain("/", "post"))).toBe(createWebhookSchema);
  });

  it("PATCH /:id mounts validate(updateWebhookSchema)", () => {
    expect(schemaOf(chain("/:id", "patch"))).toBe(updateWebhookSchema);
  });

  it("no handler in any webhook chain is a bare Joi `validate` method", () => {
    for (const layer of webhooks.stack.filter((l) => l.route)) {
      for (const s of layer.route.stack) {
        expect(s.handle).not.toBe(createWebhookSchema.validate);
        expect(s.handle).not.toBe(updateWebhookSchema.validate);
      }
    }
  });

  it("validation runs after the auth and role gates, and before the controller", () => {
    const handlers = chain("/", "post");
    const v = handlers.findIndex((h) => h.__schema);
    const a = handlers.indexOf(auth);
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
    expect(handlers.find((h) => Array.isArray(h.__roles)).__roles).toEqual([ROLE_NAMES.TENANT_ADMIN]);
  });
});
