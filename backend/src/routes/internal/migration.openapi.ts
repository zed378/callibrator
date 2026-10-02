/**
 * P9-18 / P9-25 (ADR-103) — the contract of `migration.route.ts`, code-first.
 *
 * Operator endpoints. Migrating, seeding and demo seeding are open while
 * `ALLOW_SEEDING=true` (the bootstrap of a fresh deployment, before any user
 * exists) and a super admin's otherwise; the check is inside the chain, so it
 * is published with no gate. Dropping tables and unseeding are super admin and
 * also need `ALLOW_DESTRUCTIVE_MIGRATION=true` outside production (403
 * otherwise). Demo seeding also needs `SEED_DEMO=true` (403 otherwise).
 * Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";

const BOOTSTRAP =
  "Open while ALLOW_SEEDING=true (the bootstrap of a fresh deployment); otherwise it authenticates and requires a super admin, inside the chain.";
const DESTRUCTIVE = "Also refused (403) in production, and unless ALLOW_DESTRUCTIVE_MIGRATION=true.";
const counts = z.object({}).loose();

export default defineRouteDocs({
  router: "internal/migration.route",
  mount: "/api/v1/migration",
  tag: "Migration",
  tenantScoped: false,
  operations: [
    {
      method: "get",
      path: "/up",
      operationId: "runMigrations",
      summary: "Run the database migrations",
      description: BOOTSTRAP,
      permission: null,
      audited: false,
      success: { status: 200, description: "Migrated", empty: true },
    },
    {
      method: "get",
      path: "/down",
      operationId: "dropTables",
      summary: "Drop the database tables",
      description: DESTRUCTIVE,
      permission: { kind: "superAdminOnly" },
      audited: false,
      success: { status: 200, description: "Dropped", empty: true },
    },
    {
      method: "get",
      path: "/seeding",
      operationId: "seedDatabase",
      summary: "Seed the initial data (roles, menus, the platform tenant)",
      description: BOOTSTRAP,
      permission: null,
      audited: false,
      success: { status: 200, description: "What was seeded", data: counts },
    },
    {
      method: "get",
      path: "/unseeding",
      operationId: "unseedDatabase",
      summary: "Remove the seeded data",
      description: DESTRUCTIVE,
      permission: { kind: "superAdminOnly" },
      audited: false,
      success: { status: 200, description: "What was removed", data: counts },
    },
    {
      method: "get",
      path: "/seed-demo",
      operationId: "seedDemoData",
      summary: "Seed realistic demo data for every module",
      description: `${BOOTSTRAP} Also refused (403) unless SEED_DEMO=true.`,
      permission: null,
      audited: false,
      success: {
        status: 200,
        description: "What was created, and any errors",
        data: z.object({ created: z.record(z.string(), z.number().int()), errors: z.array(z.string()) }),
      },
    },
  ],
});
