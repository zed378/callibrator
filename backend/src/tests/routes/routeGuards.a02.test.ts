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
 *
 * V-08: this file is the SHAPE sweep only — its rbac stub is satisfied by the
 * argument, not the outcome, and it passed while the real gate admitted no
 * tenant admin (V-01). The behaviour evidence for A-02 (the REAL rbac and
 * denyApiKey admitting a tenant admin and refusing a technician and a key) is
 * routeGuards.a02.behaviour.v08.test.ts.
 */
import type * as AuthMiddleware from "../../middlewares/auth.middleware";
import type * as WebhooksRoute from "../../routes/api/webhooks.route";
import type * as StorageRoute from "../../routes/api/storage.route";
import type * as CustomDomainsRoute from "../../routes/api/customDomains.route";
import type * as Constants from "../../constants";

interface GateHandle {
  (...args: unknown[]): void;
  __roles?: unknown;
  __gate?: string;
}

interface RouteStackEntry {
  handle: GateHandle;
}

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: RouteStackEntry[] };
}

interface TestRouter {
  stack: (RouteLayer & { route?: { path: string; methods: Record<string, boolean>; stack: RouteStackEntry[] } })[];
}

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: jest.fn((_req: unknown, _res: unknown, next: () => void) => {
    next();
  }),
  denyApiKey: jest.fn((_req: unknown, _res: unknown, next: () => void) => {
    next();
  }),
  superAdminOnly: jest.fn((_req: unknown, _res: unknown, next: () => void) => {
    next();
  }),
}));

jest.mock("../../middlewares/rbac.middleware", () => ({
  rbac: jest.fn((roles: unknown[]) => {
    const fn = ((_req: unknown, _res: unknown, next: () => void): void => {
      next();
    }) as GateHandle;
    fn.__roles = roles;
    return fn;
  }),
}));

jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: jest.fn((slug: string, permission: string) => {
    const fn = ((_req: unknown, _res: unknown, next: () => void): void => {
      next();
    }) as GateHandle;
    fn.__gate = `${slug}:${permission}`;
    return fn;
  }),
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const webhooks = require("../../routes/api/webhooks.route") as typeof WebhooksRoute as unknown as TestRouter;
const storage = require("../../routes/api/storage.route") as typeof StorageRoute as unknown as TestRouter;
const customDomains = require("../../routes/api/customDomains.route") as typeof CustomDomainsRoute as unknown as TestRouter;
const { auth, denyApiKey } = require("../../middlewares/auth.middleware") as typeof AuthMiddleware;
const { ROLE_NAMES, MENU_SLUGS } = require("../../constants") as typeof Constants;
/* eslint-enable @typescript-eslint/no-require-imports */

const chain = (router: TestRouter, path: string, method: string): GateHandle[] => {
  const layer = router.stack.find((l) => l.route?.path === path && l.route.methods[method] === true);
  expect(layer).toBeDefined();
  return (layer?.route?.stack ?? []).map((s) => s.handle);
};

const roleGate = (handlers: GateHandle[]): GateHandle | undefined => handlers.find((h) => Array.isArray(h.__roles));
const accessGate = (handlers: GateHandle[]): GateHandle | undefined => handlers.find((h) => typeof h.__gate === "string");

describe("A-02 — webhook routes are tenant-admin only", () => {
  const routes: [string, string][] = [
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

  it.each(routes)("%s %s carries auth, denyApiKey and a TENANT_ADMIN gate", (path: string, method: string) => {
    const handlers = chain(webhooks, path, method);
    expect(handlers).toContain(auth);
    expect(handlers).toContain(denyApiKey);
    expect(roleGate(handlers)?.__roles).toEqual([ROLE_NAMES.TENANT_ADMIN]);
  });

  it("leaves no route on auth alone", () => {
    for (const layer of webhooks.stack.filter((l) => l.route)) {
      const handlers = (layer.route?.stack ?? []).map((s) => s.handle);
      expect(roleGate(handlers)).toBeDefined();
    }
  });
});

describe("A-02 — storage settings are tenant-admin only", () => {
  const routes: [string, string][] = [
    ["/settings", "get"],
    ["/settings", "put"],
    ["/settings", "delete"],
    ["/settings/test", "post"],
    // /usage reports this tenant's stored bytes and object count. It was missed
    // in the first pass of A-02 and found by the documentation sweep.
    ["/usage", "get"],
  ];

  it.each(routes)("%s %s carries auth, denyApiKey and a TENANT_ADMIN gate", (path: string, method: string) => {
    const handlers = chain(storage, path, method);
    expect(handlers).toContain(auth);
    expect(handlers).toContain(denyApiKey);
    expect(roleGate(handlers)?.__roles).toEqual([ROLE_NAMES.TENANT_ADMIN]);
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
      if (layer.route?.path === "/object") {
        continue;
      }
      expect(roleGate((layer.route?.stack ?? []).map((h) => h.handle))).toBeDefined();
    }
  });
});

describe("A-02 — custom domains use the custom-domains menu gate", () => {
  const reads: [string, string][] = [
    ["/domains", "get"],
    ["/domains/:domainId/status", "get"],
    ["/domains/:domainId/dns", "get"],
  ];
  const writes: [string, string][] = [
    ["/domains", "post"],
    ["/domains/:domainId/verify", "post"],
    ["/domains/:domainId", "delete"],
    ["/domains/:domainId/default", "post"],
  ];

  it.each(reads)("%s %s requires read on custom-domains", (path: string, method: string) => {
    const handlers = chain(customDomains, path, method);
    expect(handlers).toContain(auth);
    expect(accessGate(handlers)?.__gate).toBe(`${MENU_SLUGS.CUSTOM_DOMAINS}:read`);
  });

  it.each(writes)("%s %s requires write on custom-domains and denies API keys", (path: string, method: string) => {
    const handlers = chain(customDomains, path, method);
    expect(handlers).toContain(auth);
    expect(handlers).toContain(denyApiKey);
    expect(accessGate(handlers)?.__gate).toBe(`${MENU_SLUGS.CUSTOM_DOMAINS}:write`);
  });

  it("leaves no route on auth alone", () => {
    for (const layer of customDomains.stack.filter((l) => l.route)) {
      const handlers = (layer.route?.stack ?? []).map((s) => s.handle);
      expect(accessGate(handlers)).toBeDefined();
    }
  });
});
