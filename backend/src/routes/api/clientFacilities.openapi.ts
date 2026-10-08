/**
 * The contract of `clientFacilities.route.ts`, code-first (ADR-103): client facilities (P21-09;
 * ADR-124; spec MEMORY/specs/P19-04-client-facilities.md § 13.1). Examples are synthetic.
 */
import { z } from "zod";
import { CLIENT_FACILITY_KINDS, CLIENT_FACILITY_STATUSES } from "@callibrator/contracts/states";
import { defineRouteDocs } from "../../docs/openapi/operation";

const mine = z
  .object({
    id: z.guid(),
    name: z.string(),
    code: z.string(),
    kind: z.enum(CLIENT_FACILITY_KINDS),
    isSelf: z.boolean(),
    status: z.enum(CLIENT_FACILITY_STATUSES),
  })
  .nullable()
  .meta({ id: "ClientFacilityMine", description: "The caller's own client facility; null for an account not bound to one" });

export default defineRouteDocs({
  router: "api/clientFacilities.route",
  mount: "/api/v1/client-facilities",
  tag: "Client Facilities",
  tagDescription:
    "The health facilities a calibration company serves (ADR-124): each is a client inside the tenant. " +
    "A facility-bound account sees its own facility only.",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/mine",
      operationId: "getMyClientFacility",
      summary: "The caller's own client facility",
      description:
        "For a facility-bound account: its facility (name, code, kind, status) for the app shell. For an unbound account " +
        "(the provider's staff, a self-served hospital): null. Reachable by a bound account (facility-accessible, S-8).",
      permission: { kind: "authenticated", reason: "the caller's own facility (S-8) — read through the facility rule `id = own`" },
      audited: false,
      success: { status: 200, description: "The facility, or null", data: mine },
    },
  ],
});
