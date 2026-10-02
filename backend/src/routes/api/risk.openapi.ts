/**
 * P9-21 / P9-25 (ADR-103) — the contract of `risk.route.ts`, code-first.
 *
 * The bodies are the objects `validate()` mounts (`validators/risk.validator`
 * → `@callibrator/contracts/risk`, A-335). The list reads its filters RAW
 * from `req.query`; `:id` has no `validateUuid`. Responses are the contract's
 * risk rows (`@callibrator/contracts/risk`). Examples are synthetic.
 */
import { z } from "zod";
import { riskResponse, riskWithPeople } from "@callibrator/contracts/risk";
import { createRisk, updateRisk } from "../../validators/risk.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

/** `:id` — NOT checked by the route (no `validateUuid`); a risk id is a uuid. */
const params = z.object({
  id: z.string().meta({ description: "The risk's id (a uuid; the route does not check its shape)", example: "8e7d6c5b-4a3f-4e2d-9c1b-0a9f8e7d6c5b" }),
});

/** The filters `risk.service#getRisks` reads, raw from `req.query`. */
const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().meta({ description: "1-based page (default 1)", example: 1 }),
  limit: z.coerce.number().int().min(1).optional().meta({ description: "Rows per page (default 10; not capped)", example: 10 }),
  status: z.string().optional().meta({ description: "Exact status, e.g. OPEN" }),
  category: z.string().optional().meta({ description: "Exact category, e.g. SAFETY" }),
});

const access = (action: "read" | "write") => ({ kind: "dynamicAccess", resource: "risk", action }) as const;
const ALLOW_LIST =
  "Only the listed fields are read; anything else (`id`, `tenantId`, `identifiedBy`, the timestamps) is " +
  "ignored, and the tenant is always the caller's (A-335). `assignedTo` must be a user of the caller's tenant, else 404.";

export default defineRouteDocs({
  router: "api/risk.route",
  mount: "/api/v1/risk",
  tag: "Risk",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/",
      operationId: "createRisk",
      summary: "Create a risk",
      description: `Records a risk in the caller's tenant's register, OPEN; the caller is its \`identifiedBy\`. ${ALLOW_LIST}`,
      permission: access("write"),
      audited: true,
      body: createRisk,
      success: { status: 201, description: "The created risk", data: riskResponse },
    },
    {
      method: "get",
      path: "/",
      operationId: "listRisks",
      summary: "List risks",
      description: "The caller's tenant's risk register, newest first, with who recorded and who owns each risk.",
      permission: access("read"),
      audited: false,
      query: listQuery,
      success: { status: 200, description: "A page of risks; pagination in the top-level `meta`", list: riskWithPeople },
    },
    {
      method: "get",
      path: "/:id",
      operationId: "getRisk",
      summary: "Get a risk",
      permission: access("read"),
      audited: false,
      params,
      success: { status: 200, description: "The risk with its people", data: riskWithPeople },
    },
    {
      method: "put",
      path: "/:id",
      operationId: "updateRisk",
      summary: "Update a risk",
      description: `Writes the fields sent (a partial body is a partial update); \`status\` moves the risk within OPEN, MITIGATED, CLOSED and ACCEPTED. ${ALLOW_LIST}`,
      permission: access("write"),
      audited: true,
      params,
      body: updateRisk,
      success: { status: 200, description: "The updated risk, with its people", data: riskResponse },
    },
    {
      method: "delete",
      path: "/:id",
      operationId: "deleteRisk",
      summary: "Delete a risk",
      description: "Soft delete: the row is kept (paranoid) and no longer listed.",
      permission: access("write"),
      audited: true,
      params,
      success: { status: 200, description: "Deleted; `data` is null", empty: true },
    },
  ],
});
