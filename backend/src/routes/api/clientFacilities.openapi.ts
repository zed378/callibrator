/**
 * The contract of `clientFacilities.route.ts`, code-first (ADR-103): client facilities (P21-09;
 * ADR-124; spec MEMORY/specs/P19-04-client-facilities.md § 13.1, § 4.4 – § 4.6). Examples are
 * synthetic.
 */
import { z } from "zod";
import { CLIENT_FACILITY_KINDS, CLIENT_FACILITY_STATUSES } from "@callibrator/contracts/states";
import {
  clientFacilityCreate,
  clientFacilityIdParams,
  clientFacilityListQuery,
  clientFacilityStatusChange,
  clientFacilityUpdate,
} from "@callibrator/contracts/clientFacilities";
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

const ClientFacility = z
  .object({
    id: z.guid(),
    name: z.string(),
    code: z.string(),
    kind: z.enum(CLIENT_FACILITY_KINDS),
    isSelf: z.boolean(),
    status: z.enum(CLIENT_FACILITY_STATUSES),
    statusReason: z.string().nullable(),
    statusChangedAt: z.iso.datetime().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    province: z.string().nullable(),
    postalCode: z.string().nullable(),
    phone: z.string().nullable(),
    contactName: z.string().nullable(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({
    id: "ClientFacility",
    description: "A health facility the tenant serves (ADR-124). Never carries the import key.",
    example: {
      id: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1",
      name: "Facility One",
      code: "F-0001",
      kind: "hospital",
      isSelf: false,
      status: "active",
      statusReason: null,
      statusChangedAt: null,
      address: null,
      city: null,
      province: null,
      postalCode: null,
      phone: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
    },
  });

const ClientFacilityOption = z
  .object({ id: z.guid(), name: z.string(), code: z.string(), status: z.enum(CLIENT_FACILITY_STATUSES), isSelf: z.boolean() })
  .meta({ id: "ClientFacilityOption", description: "A facility in a picker or the provider's facility filter" });

const ClientFacilityUser = z
  .object({
    id: z.guid(),
    username: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    roleId: z.guid().nullable(),
    status: z.string().nullable(),
  })
  .meta({ id: "ClientFacilityUser", description: "A user bound to the facility" });

const params = z.object({
  clientFacilityId: clientFacilityIdParams.shape.clientFacilityId.meta({
    description: "The client facility's id",
    example: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1",
  }),
});

const read = { kind: "dynamicAccess", resource: "client-facilities", action: "read" } as const;
const write = { kind: "dynamicAccess", resource: "client-facilities", action: "write" } as const;
const NO_KEY = "An API key is refused (403): a person answers for a facility's lifecycle.";
const UNMARKED = "Not available to a facility-bound account (403 FACILITY_ROUTE_REFUSED).";

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
    {
      method: "get",
      path: "/",
      operationId: "listClientFacilities",
      summary: "List the tenant's client facilities",
      description: `Filter by \`status\`, \`kind\` or \`q\` (name or code); every order ends in \`id\`. ${UNMARKED}`,
      permission: read,
      audited: false,
      query: clientFacilityListQuery,
      success: { status: 200, description: "A page of facilities; pagination in the top-level `meta`", list: ClientFacility },
    },
    {
      method: "get",
      path: "/options",
      operationId: "listClientFacilityOptions",
      summary: "The tenant's facilities for a picker",
      description: `Any one of \`calibration\`, \`ipm\` or \`client-facilities\` read: technicians pick a facility without administering them. By name. ${UNMARKED}`,
      permission: { kind: "dynamicAccess", resource: ["calibration", "ipm", "client-facilities"], action: "read" },
      audited: false,
      success: { status: 200, description: "Every facility of the tenant, short form", data: z.array(ClientFacilityOption) },
    },
    {
      method: "get",
      path: "/:clientFacilityId",
      operationId: "getClientFacility",
      summary: "One client facility",
      description: `Another tenant's facility is a 404, identical to one that does not exist. ${UNMARKED}`,
      permission: read,
      audited: false,
      params,
      success: { status: 200, description: "The facility", data: ClientFacility },
    },
    {
      method: "post",
      path: "/",
      operationId: "createClientFacility",
      summary: "Add a client facility",
      description: `A new facility of the caller's tenant, active; never a self facility. The code and the name are unique per tenant (409 names the clash). ${NO_KEY} ${UNMARKED}`,
      permission: write,
      audited: true,
      body: clientFacilityCreate,
      conflict: "A facility with this code / name already exists in the tenant.",
      success: { status: 201, description: "The facility", data: ClientFacility },
    },
    {
      method: "patch",
      path: "/:clientFacilityId",
      operationId: "updateClientFacility",
      summary: "Edit a client facility",
      description: `Its organisational and contact fields; the tenant's own facility keeps its code SELF (409). ${NO_KEY} ${UNMARKED}`,
      permission: write,
      audited: true,
      params,
      body: clientFacilityUpdate,
      conflict: "The code or name clashes with another facility of the tenant, or the self facility's code would change.",
      success: { status: 200, description: "The facility", data: ClientFacility },
    },
    {
      method: "post",
      path: "/:clientFacilityId/status",
      operationId: "changeClientFacilityStatus",
      summary: "Deactivate, end, reactivate or reinstate a client facility",
      description:
        "With a reason. Leaving `active` revokes every session of the facility's bound users in the same transaction. " +
        "Reinstating an ended facility needs a tenant administrator (403). " +
        `${NO_KEY} ${UNMARKED}`,
      permission: write,
      audited: true,
      params,
      body: clientFacilityStatusChange,
      conflict:
        "The self facility's status never changes; the facility is already in that status; an ended facility goes back to active only.",
      success: {
        status: 200,
        description: "The facility and how many sessions were revoked",
        data: z.object({ facility: ClientFacility, sessionsRevoked: z.number().int() }),
      },
    },
    {
      method: "delete",
      path: "/:clientFacilityId",
      operationId: "deleteClientFacility",
      summary: "Delete a client facility created by mistake",
      description:
        "Tenant administrators only (rbac), who also need `client-facilities` write (dynamicAccess). Only a facility nothing " +
        `references — end it otherwise; its history is kept. ${NO_KEY} ${UNMARKED}`,
      permission: { kind: "rbac", roles: ["TENANT_ADMIN"] },
      audited: true,
      params,
      conflict: "The self facility, or a facility that holds devices, users, rooms or moves.",
      success: { status: 200, description: "Deleted", empty: true },
    },
    {
      method: "get",
      path: "/:clientFacilityId/users",
      operationId: "listClientFacilityUsers",
      summary: "The users bound to a client facility",
      description: `\`users\` read. Another tenant's facility is a 404. ${UNMARKED}`,
      permission: { kind: "dynamicAccess", resource: "users", action: "read" },
      audited: false,
      params,
      success: { status: 200, description: "The bound users, by name", data: z.array(ClientFacilityUser) },
    },
  ],
});
