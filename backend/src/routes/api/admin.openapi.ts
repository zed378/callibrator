/**
 * P9-21 / P9-25 (ADR-103) — the contract of `admin.route.ts`, code-first.
 *
 * The platform operator's console. `router.use(auth)` and
 * `router.use(rbac(["SUPER_ADMIN", "SUPERADMIN"]))` gate every route: super
 * admin only, across tenants. The tenant routes (status, flags) and the SSO
 * email-domain claim (P10-04) act on a named tenant; the access-request queue
 * (P10-05 / P10-07) has no tenant at all. Bodies and filters are the mounted
 * schemas (validators/admin.validator, @callibrator/contracts/accessRequest
 * and /publicAuth); the tenant list and status bodies are read raw.
 * Examples are synthetic.
 */
import { z } from "zod";
import { updateTenantFlagsSchema } from "../../validators/admin.validator";
import {
  approveAccessRequestSchema,
  eraseAccessRequestsSchema,
  listAccessRequestsSchema,
  rejectAccessRequestSchema,
} from "../../validators/accessRequest.validator";
import { ssoEmailDomainsSchema } from "../../validators/publicAuth.validator";
import {
  ACCESS_REQUEST_STATUSES,
  DEVICE_COUNT_BANDS,
  FACILITY_TYPES,
  REQUEST_LOCALES,
} from "@callibrator/contracts/accessRequestValues";
import { storedTenantRow, TENANT_STATUSES } from "../../docs/openapi/tenantSchemas";
import { defineRouteDocs } from "../../docs/openapi/operation";

const superAdmin = { kind: "rbac", roles: ["SUPER_ADMIN", "SUPERADMIN"] } as const;

const tenantParams = z.object({
  id: z.guid().meta({ description: "The tenant's id", example: "2b7c9e41-5d3a-4f6e-8a1b-0c9d8e7f6a5b" }),
});
const requestParams = z.object({
  id: z.guid().meta({ description: "The access request's id", example: "0d9c8b7a-6f5e-4d3c-8b2a-19f8e7d6c5b4" }),
});

/** One request as the queue lists it (accessRequest.service#toQueueRow). */
const queueRow = z
  .object({
    id: z.guid(),
    organisationName: z.string(),
    facilityType: z.enum(FACILITY_TYPES),
    city: z.string(),
    deviceCountBand: z.enum(DEVICE_COUNT_BANDS),
    contactName: z.string(),
    contactRole: z.string().nullable(),
    workEmail: z.string(),
    whatsapp: z.string(),
    needs: z.string().nullable(),
    locale: z.enum(REQUEST_LOCALES),
    status: z.enum(ACCESS_REQUEST_STATUSES),
    createdAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
    provisionedTenantId: z.guid().nullable(),
    duplicateCount: z.number().int().meta({ description: "Other requests from the same address" }),
  })
  .meta({ id: "AccessRequestQueueRow", description: "An access request, as the queue lists it" });

const queueAnswer = z.object({
  success: z.literal(true),
  status: z.literal(200),
  message: z.string(),
  data: z.array(queueRow),
  meta: z.object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    counts: z.record(z.enum(ACCESS_REQUEST_STATUSES), z.number().int()).meta({ description: "Requests per status, over the whole queue" }),
  }),
});

const domains = z.object({ domains: z.array(z.string()).meta({ example: ["hospital.example"] }) });

export default defineRouteDocs({
  router: "api/admin.route",
  mount: "/api/v1/admin",
  tag: "Admin",
  tagDescription: "The platform operator's console: every tenant, its status and flags, its SSO domain claim, and the access-request queue.",
  tenantScoped: false,
  operations: [
    {
      method: "get",
      path: "/tenants",
      operationId: "adminListTenants",
      summary: "List every tenant",
      description: "Newest first. `search` matches the name or code. `page` and `limit` (default 10) are used as sent.",
      permission: superAdmin,
      audited: false,
      query: z.object({
        page: z.string().optional().meta({ example: "1" }),
        limit: z.string().optional().meta({ example: "10" }),
        search: z.string().optional(),
      }),
      success: {
        status: 200,
        description: "A page of tenants (the page is inside `data`)",
        data: z.object({
          total: z.number().int(),
          page: z.number().int(),
          limit: z.number().int(),
          totalPages: z.number().int(),
          tenants: z.array(storedTenantRow),
        }),
      },
    },
    {
      method: "patch",
      path: "/tenants/:id/status",
      operationId: "adminUpdateTenantStatus",
      summary: "Set a tenant's status",
      description: "Audited under PLATFORM and the tenant; the tenant caches are invalidated after the commit.",
      permission: superAdmin,
      audited: true,
      params: tenantParams,
      body: z.object({ status: z.enum(TENANT_STATUSES).meta({ description: "Any other value is a 400" }) }),
      success: { status: 200, description: "The tenant", data: storedTenantRow },
    },
    {
      method: "patch",
      path: "/tenants/:id/flags",
      operationId: "adminUpdateTenantFlags",
      summary: "Set a tenant's flags",
      description: "A-174: a plain object of flag keys to scalar values, never a secret-named key. Audited.",
      permission: superAdmin,
      audited: true,
      params: tenantParams,
      body: updateTenantFlagsSchema,
      success: { status: 200, description: "The tenant", data: storedTenantRow },
    },
    {
      method: "get",
      path: "/tenants/:id/sso-domains",
      operationId: "adminGetSsoDomains",
      summary: "Get a tenant's SSO email-domain claim",
      description: "P10-04: the domains whose identifier-first sign-in discovery starts this tenant's SSO.",
      permission: superAdmin,
      audited: false,
      params: tenantParams,
      success: { status: 200, description: "The claimed domains", data: domains },
    },
    {
      method: "put",
      path: "/tenants/:id/sso-domains",
      operationId: "adminPutSsoDomains",
      summary: "Set a tenant's SSO email-domain claim",
      description: "Replaces the list; audited. A public mailbox domain is a 400.",
      permission: superAdmin,
      audited: true,
      params: tenantParams,
      body: ssoEmailDomainsSchema.omit({ id: true }),
      success: { status: 200, description: "The saved list", data: domains },
      conflict: "Another tenant has claimed one of the domains.",
    },
    {
      method: "get",
      path: "/access-requests",
      operationId: "adminListAccessRequests",
      summary: "The access-request queue",
      description: "P10-07: filtered by `status` (default `pending`), newest first.",
      permission: superAdmin,
      audited: false,
      query: listAccessRequestsSchema,
      success: { status: 200, description: "A page of requests, with per-status counts in `meta`", body: queueAnswer },
    },
    {
      method: "post",
      path: "/access-requests/erasure",
      operationId: "adminEraseAccessRequests",
      summary: "Erase a requester's access requests (DSAR)",
      description:
        "By address. Requests that never became a tenant are deleted; an approved one keeps its tenant link with its " +
        "personal fields masked. Audited.",
      permission: superAdmin,
      audited: true,
      body: eraseAccessRequestsSchema,
      success: { status: 200, description: "What was erased", data: z.object({ deleted: z.number().int(), masked: z.number().int() }) },
    },
    {
      method: "get",
      path: "/access-requests/:id",
      operationId: "adminGetAccessRequest",
      summary: "One access request",
      description: "The request, its decider, its tenant, its invitation state and the other requests from the same address.",
      permission: superAdmin,
      audited: false,
      params: requestParams,
      success: {
        status: 200,
        description: "The request",
        data: queueRow.extend({
          decisionNote: z.string().nullable(),
          decidedBy: z.object({ id: z.guid(), name: z.string().nullable() }).nullable(),
          provisionedTenant: z.object({ id: z.guid(), code: z.string().nullable(), name: z.string() }).nullable(),
          adminUserId: z.guid().nullable(),
          invitation: z.object({
            sentAt: z.iso.datetime().nullable(),
            expiresAt: z.iso.datetime().nullable(),
            acceptedAt: z.iso.datetime().nullable(),
            resendable: z.boolean(),
          }),
          duplicates: z.array(z.object({ id: z.guid(), organisationName: z.string(), status: z.enum(ACCESS_REQUEST_STATUSES), createdAt: z.iso.datetime() })),
        }),
      },
    },
    {
      method: "post",
      path: "/access-requests/:id/approve",
      operationId: "adminApproveAccessRequest",
      summary: "Approve an access request",
      description:
        "P10-05: in ONE transaction under a row lock, creates the tenant (tenant.service#createTenant), its first " +
        "administrator with no usable password, and a single-use seven-day invitation; audited. The invitation email " +
        "goes to the request's own address after the commit.",
      permission: superAdmin,
      audited: true,
      params: requestParams,
      body: approveAccessRequestSchema.omit({ id: true }),
      success: {
        status: 200,
        description: "Approved",
        data: z.object({
          request: queueRow,
          // tenantService.createTenant's row (P9-25: the fields the queue reads, named).
          tenant: z.looseObject({ id: z.guid(), code: z.string().nullable(), name: z.string() }),
          adminUser: z.object({ id: z.guid(), email: z.string() }),
          invitationSent: z.boolean(),
        }),
      },
      conflict: "The request is not pending, the tenant code or name is taken, or the address already has an account; the request stays pending.",
    },
    {
      method: "post",
      path: "/access-requests/:id/reject",
      operationId: "adminRejectAccessRequest",
      summary: "Reject an access request, or mark it spam",
      description: "A reason is required; audited.",
      permission: superAdmin,
      audited: true,
      params: requestParams,
      body: rejectAccessRequestSchema.omit({ id: true }),
      success: { status: 200, description: "The rejected request", data: queueRow },
      conflict: "The request is not pending.",
    },
    {
      method: "post",
      path: "/access-requests/:id/resend-invitation",
      operationId: "adminResendInvitation",
      summary: "Re-issue an approved request's invitation",
      description: "A new token; the old one stops working; audited.",
      permission: superAdmin,
      audited: true,
      params: requestParams,
      success: {
        status: 200,
        description: "Re-issued",
        data: z.object({ invitationSent: z.boolean(), expiresAt: z.iso.datetime() }),
      },
      conflict: "The request is not approved, or its invitation was already accepted.",
    },
  ],
});
