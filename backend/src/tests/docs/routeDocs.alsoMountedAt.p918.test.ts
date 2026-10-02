/**
 * P9-18 — `alsoMountedAt`: a router index.ts mounts twice (the menu-group
 * router at /api/v1/menu-group-roles, the OIDC provider at the issuer-root
 * /oidc) is published at each mount, as the same contract. A copy's
 * operationId takes the suffix (an operationId is unique in a document) and
 * `x-alias-of` names the primary path; nothing else differs.
 */
import { z } from "zod";
import { defineRouteDocs, toPathItems } from "../../docs/openapi/operation";

const docs = defineRouteDocs({
  router: "api/example.route",
  mount: "/api/v1/things",
  alsoMountedAt: [{ mount: "/things", operationIdSuffix: "AtRoot" }],
  tag: "Example",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/:thingId",
      operationId: "getThing",
      summary: "Get a thing",
      permission: { kind: "authenticated", reason: "own" },
      audited: false,
      params: z.object({ thingId: z.guid().meta({ example: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f" }) }),
      success: { status: 200, description: "The thing", data: z.object({ id: z.guid() }) },
    },
  ],
});

describe("route docs — alsoMountedAt (P9-18)", () => {
  const paths = toPathItems(docs) as Record<string, Record<string, Record<string, unknown>>>;

  it("publishes every operation at the primary mount and at each further mount", () => {
    expect(Object.keys(paths).sort()).toEqual(["/api/v1/things/{thingId}", "/things/{thingId}"]);
  });

  it("the copy is the same contract, with a suffixed operationId and x-alias-of", () => {
    const primary = paths["/api/v1/things/{thingId}"]?.["get"] as Record<string, unknown>;
    const copy = paths["/things/{thingId}"]?.["get"] as Record<string, unknown>;
    expect(primary["operationId"]).toBe("getThing");
    expect(primary).not.toHaveProperty("x-alias-of");
    expect(copy["operationId"]).toBe("getThingAtRoot");
    expect(copy["x-alias-of"]).toBe("/api/v1/things/{thingId}");
    const without = (o: Record<string, unknown>, ...keys: string[]): Record<string, unknown> =>
      Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
    expect(without(copy, "operationId", "x-alias-of")).toEqual(without(primary, "operationId"));
  });

  it("without alsoMountedAt nothing changes", () => {
    const single = defineRouteDocs({ ...docs, alsoMountedAt: [] });
    expect(Object.keys(toPathItems(single))).toEqual(["/api/v1/things/{thingId}"]);
  });
});
