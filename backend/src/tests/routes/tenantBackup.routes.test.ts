interface TenantBackupRouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

interface TenantBackupRouter {
  handle: unknown;
  stack: TenantBackupRouteLayer[];
}

const tenantBackupRoutes =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
  require("../../routes/api/tenantBackup.route") as TenantBackupRouter;

describe("Tenant Backup Routes", () => {
  it("should export an Express router", () => {
    expect(tenantBackupRoutes).toBeDefined();
    expect(typeof tenantBackupRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(tenantBackupRoutes.stack)).toBe(true);
    expect(tenantBackupRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have POST /:tenantId/backups route", () => {
    const route = tenantBackupRoutes.stack.find(
      (layer) => layer.route?.path === "/:tenantId/backups" && layer.route.methods["post"],
    );
    expect(route).toBeDefined();
  });

  it("should have GET /:tenantId/backups route", () => {
    const route = tenantBackupRoutes.stack.find(
      (layer) => layer.route?.path === "/:tenantId/backups" && layer.route.methods["get"],
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /:tenantId/backups/:backupId route", () => {
    const route = tenantBackupRoutes.stack.find(
      (layer) =>
        layer.route?.path === "/:tenantId/backups/:backupId" && layer.route.methods["delete"],
    );
    expect(route).toBeDefined();
  });
});
