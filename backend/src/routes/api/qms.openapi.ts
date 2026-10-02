/**
 * P9-21 / P9-25 (ADR-103) — the contract of `qms.route.ts`, code-first.
 *
 * Every route sits behind `router.use(auth)` and a `dynamicAccess` gate on the
 * seeded `qms` menu (A-66); the mutations also refuse an API key (`denyApiKey`).
 * Bodies are the objects `validate()` mounts (`validators/qms.validator` →
 * `@callibrator/contracts/qms`). The lists read their paging RAW from
 * `req.query` (no schema). Responses are the contract's NC and CAPA rows; the
 * handlers return the house envelope, which `asyncHandlerWithMapping` sends.
 * Examples are synthetic.
 */
import { z } from "zod";
import { createCapaSchema, createNCSchema, updateCapaSchema, updateNCSchema } from "../../validators/qms.validator";
import {
  capaListItem,
  capaResponse,
  nonConformanceListItem,
  nonConformanceResponse,
} from "@callibrator/contracts/qms";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { CAPA_STATUSES } from "@callibrator/contracts/states";

/** `:id` — read without `validateUuid` here; an unknown id is the service's 404. */
const idParams = (what: string, example: string): z.ZodObject<{ id: z.ZodString }> =>
  z.object({ id: z.string().meta({ description: `The ${what}'s id`, example }) });

/** The paging and filter the lists read raw (the service's defaults: page 1, limit 10). */
const listQuery = (statuses: readonly [string, ...string[]]): z.ZodObject =>
  z.object({
    page: z.coerce.number().int().min(1).optional().meta({ description: "1-based page", example: 1 }),
    limit: z.coerce.number().int().min(1).optional().meta({ description: "Rows per page", example: 10 }),
    status: z.enum(statuses).optional(),
  });

const read = { kind: "dynamicAccess", resource: "qms", action: "read" } as const;
const write = { kind: "dynamicAccess", resource: "qms", action: "write" } as const;
const update = { kind: "dynamicAccess", resource: "qms", action: "update" } as const;
const NO_API_KEY = "An API key is refused (403): quality records are written by a signed-in person.";
const NC_STATUSES = ["OPEN", "UNDER_INVESTIGATION", "CAPA_REQUIRED", "CLOSED"] as const;

export default defineRouteDocs({
  router: "api/qms.route",
  mount: "/api/v1/qms",
  tag: "QMS",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/nc",
      operationId: "createNonConformance",
      summary: "Raise a non-conformance",
      description: `The number (NC-…) is issued per tenant. ${NO_API_KEY}`,
      permission: write,
      audited: true,
      body: createNCSchema,
      success: { status: 201, description: "The raised non-conformance", data: nonConformanceResponse },
    },
    {
      method: "get",
      path: "/nc",
      operationId: "listNonConformances",
      summary: "List non-conformances",
      description: "Newest first, with the reporter and the device.",
      permission: read,
      audited: false,
      query: listQuery(NC_STATUSES),
      success: { status: 200, description: "A page of non-conformances; pagination in the top-level `meta`", list: nonConformanceListItem },
    },
    {
      method: "patch",
      path: "/nc/:id",
      operationId: "updateNonConformance",
      summary: "Update a non-conformance",
      description: NO_API_KEY,
      permission: update,
      audited: true,
      params: idParams("non-conformance", "4e5f6a7b-8c9d-4e0f-a1b2-c3d4e5f6a7b8"),
      body: updateNCSchema,
      success: { status: 200, description: "The updated non-conformance", data: nonConformanceResponse },
    },
    {
      method: "post",
      path: "/capa",
      operationId: "createCapa",
      summary: "Raise a CAPA on a non-conformance",
      description: `The non-conformance must be the caller's tenant's (else 404). ${NO_API_KEY}`,
      permission: write,
      audited: true,
      body: createCapaSchema,
      success: { status: 201, description: "The raised CAPA", data: capaResponse },
      errors: [404],
    },
    {
      method: "get",
      path: "/capa",
      operationId: "listCapas",
      summary: "List CAPAs",
      description: "Newest first, with the non-conformance and the assignee.",
      permission: read,
      audited: false,
      query: listQuery(CAPA_STATUSES),
      success: { status: 200, description: "A page of CAPAs; pagination in the top-level `meta`", list: capaListItem },
    },
    {
      method: "patch",
      path: "/capa/:id",
      operationId: "updateCapa",
      summary: "Update a CAPA",
      description: `An approval records the caller as the approver, never a body value (A-62). ${NO_API_KEY}`,
      permission: update,
      audited: true,
      params: idParams("CAPA", "5f6a7b8c-9d0e-4f1a-b2c3-d4e5f6a7b8c9"),
      body: updateCapaSchema,
      success: { status: 200, description: "The updated CAPA", data: capaResponse },
    },
  ],
});
