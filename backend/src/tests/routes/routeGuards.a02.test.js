/**
 * Route guard composition (A-02)
 *
 * webhooks, storage settings and custom domains were each guarded by `auth`
 * and nothing else until 2026-09-23: any role in the tenant could repoint a
 * webhook at a host it controlled, read the tenant's object-storage
 * credentials, or claim a hostname.
 *
 * These cases assert the gate is *in the chain*. They do not re-test the
 * middlewares themselves — rbac and dynamicAccess have their own suites — but
 * they fail loudly if a route is added or edited without one, which is the
 * defect shape CLAUDE.md calls the most likely authorization defect here.
 */

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: jest.fn((req, res, next) => next()),
  denyApiKey: jest.fn((req, res, next) => next()),
  superAdminOnly: jest.fn((req, res, next) => next()),
}));

jest.mock("../../middlewares/rbac.middleware", () => ({
  rbac: jest.fn((roles) => {
    const fn = (req, res, next) => next();
    fn.__roles = roles;
    return fn;
  }),
}));

jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: jest.fn((slug, permission) => {
    const fn = (req, res, next) => next();
    fn.__gate = `${slug}:${permission}`;
    return fn;
  }),
}));

const webhooks = require("../../routes/api/webhooks.route");
const storage = require("../../routes/api/storage.route");
const customDomains = require("../../routes/api/customDomains.route");
const { auth, denyApiKey } = require("../../middlewares/auth.middleware");
const { ROLE_NAMES, MENU_SLUGS } = require("../../constants");

const chain = (router, path, method) => {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  expect(layer).toBeDefined();
  return layer.route.stack.map((s) => s.handle);
};

const roleGate = (handlers) => handlers.find((h) => Array.isArray(h.__roles));
const accessGate = (handlers) => handlers.find((h) => typeof h.__gate === "string");

describe("A-02 — webhook routes are tenant-admin only", () => {
  const routes = [
    ["/", "post"],
    ["/", "get"],
    ["/:id", "get"],
    ["/:id", "patch"],
    ["/:id", "delete"],
    ["/:id/deliveries", "get"],
    ["/:id/test", "post"],
    // A-51: rotation issues a new signing secret — same gate as the rest.
    ["/:id/rotate-secret", "post"],
  ];

  it.each(routes)("%s %s carries auth, denyApiKey and a TENANT_ADMIN gate", (path, method) => {
    const handlers = chain(webhooks, path, method);
    expect(handlers).toContain(auth);
    expect(handlers).toContain(denyApiKey);
    expect(roleGate(handlers).__roles).toEqual([ROLE_NAMES.TENANT_ADMIN]);
  });

  it("leaves no route on auth alone", () => {
    for (const layer of webhooks.stack.filter((l) => l.route)) {
      const handlers = layer.route.stack.map((s) => s.handle);
      expect(roleGate(handlers)).toBeDefined();
    }
  });
});

describe("A-02 — storage settings are tenant-admin only", () => {
  const routes = [
    ["/settings", "get"],
    ["/settings", "put"],
    ["/settings", "delete"],
    ["/settings/test", "post"],
    // /usage reports this tenant's stored bytes and object count. It was missed
    // in the first pass of A-02 and found by the documentation sweep.
    ["/usage", "get"],
  ];

  it.each(routes)("%s %s carries auth, denyApiKey and a TENANT_ADMIN gate", (path, method) => {
    const handlers = chain(storage, path, method);
    expect(handlers).toContain(auth);
    expect(handlers).toContain(denyApiKey);
    expect(roleGate(handlers).__roles).toEqual([ROLE_NAMES.TENANT_ADMIN]);
  });

  // /object is the public read path for stored files; it is deliberately not
  // behind the settings gate, and has its own signed-path handling.
  it("does not gate GET /object as a settings route", () => {
    const handlers = chain(storage, "/object", "get");
    expect(roleGate(handlers)).toBeUndefined();
  });

  // The webhook and custom-domain routers have this sweep; storage did not, so
  // GET /usage stayed on auth alone without failing anything.
  it("leaves no route but /object on auth alone", () => {
    for (const layer of storage.stack.filter((l) => l.route)) {
      if (layer.route.path === "/object") {
        continue;
      }
      expect(roleGate(layer.route.stack.map((h) => h.handle))).toBeDefined();
    }
  });
});

describe("A-02 — custom domains use the custom-domains menu gate", () => {
  const reads = [
    ["/domains", "get"],
    ["/domains/:domainId/status", "get"],
    ["/domains/:domainId/dns", "get"],
  ];
  const writes = [
    ["/domains", "post"],
    ["/domains/:domainId/verify", "post"],
    ["/domains/:domainId", "delete"],
    ["/domains/:domainId/default", "post"],
  ];

  it.each(reads)("%s %s requires read on custom-domains", (path, method) => {
    const handlers = chain(customDomains, path, method);
    expect(handlers).toContain(auth);
    expect(accessGate(handlers).__gate).toBe(`${MENU_SLUGS.CUSTOM_DOMAINS}:read`);
  });

  it.each(writes)("%s %s requires write on custom-domains and denies API keys", (path, method) => {
    const handlers = chain(customDomains, path, method);
    expect(handlers).toContain(auth);
    expect(handlers).toContain(denyApiKey);
    expect(accessGate(handlers).__gate).toBe(`${MENU_SLUGS.CUSTOM_DOMAINS}:write`);
  });

  it("leaves no route on auth alone", () => {
    for (const layer of customDomains.stack.filter((l) => l.route)) {
      const handlers = layer.route.stack.map((s) => s.handle);
      expect(accessGate(handlers)).toBeDefined();
    }
  });
});
