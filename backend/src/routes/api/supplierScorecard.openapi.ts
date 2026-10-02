/**
 * P9-21 / P9-25 (ADR-103) — the contract of `supplierScorecard.route.ts`,
 * code-first.
 *
 * The bodies are the objects `validate()` mounts
 * (`validators/supplierScorecard.validator` →
 * `@callibrator/contracts/supplierScorecard`, A-336). The list reads its
 * filters RAW from `req.query`; `:id` is checked by `validateUuid` (A-346: a malformed id is a 400,
 * where it was a 500). The writes also refuse an API key
 * (`denyApiKey`). Responses are the contract's scorecard rows
 * (`@callibrator/contracts/supplierScorecard`). Examples are synthetic.
 */
import { z } from "zod";
import { scorecardResponse, scorecardWithRefs } from "@callibrator/contracts/supplierScorecard";
import { createScorecard, updateScorecard } from "../../validators/supplierScorecard.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

/**
 * `:id` — checked by `validateUuid` (A-346, 2026-10-02): the 8-4-4-4-12 SHAPE, not an RFC version
 * (P6-02), so `z.guid()`, not `z.uuid()`. A malformed id is a 400 "Invalid id: must be a valid UUID".
 */
const params = z.object({
  id: z.guid().meta({ description: "The scorecard's id (a uuid; a malformed id is a 400)", example: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e" }),
});

/** The filters `supplierScorecard.service#getScorecards` reads, raw from `req.query`. */
const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().meta({ description: "1-based page (default 1)", example: 1 }),
  limit: z.coerce.number().int().min(1).optional().meta({ description: "Rows per page (default 10; not capped)", example: 10 }),
  vendorId: z.string().optional().meta({ description: "Only this vendor's scorecards" }),
  status: z.string().optional().meta({ description: "Exact status, e.g. PROBATION" }),
});

const access = (action: "read" | "write") => ({ kind: "dynamicAccess", resource: "supplier-scorecard", action }) as const;
const WRITE_RULES =
  "An API key is refused (403): a scorecard is an interactive user's evaluation. Only the listed fields are " +
  "read; anything else (`id`, `tenantId`, `evaluatedBy`, the timestamps) is ignored, and the tenant is always " +
  "the caller's (A-336).";

export default defineRouteDocs({
  router: "api/supplierScorecard.route",
  mount: "/api/v1/supplier-scorecard",
  tag: "SupplierScorecard",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/",
      operationId: "createSupplierScorecard",
      summary: "Create a supplier scorecard",
      description: `Records an evaluation of a vendor of the caller's tenant (else 404); the caller is its \`evaluatedBy\`. ${WRITE_RULES}`,
      permission: access("write"),
      audited: true,
      body: createScorecard,
      success: { status: 201, description: "The created scorecard", data: scorecardResponse },
    },
    {
      method: "get",
      path: "/",
      operationId: "listSupplierScorecards",
      summary: "List supplier scorecards",
      description: "The caller's tenant's scorecards, latest evaluation first, with the vendor and the evaluator.",
      permission: access("read"),
      audited: false,
      query: listQuery,
      success: { status: 200, description: "A page of scorecards; pagination in the top-level `meta`", list: scorecardWithRefs },
    },
    {
      method: "get",
      path: "/:id",
      operationId: "getSupplierScorecard",
      summary: "Get a supplier scorecard",
      permission: access("read"),
      audited: false,
      params,
      success: { status: 200, description: "The scorecard with its vendor and evaluator", data: scorecardWithRefs },
    },
    {
      method: "put",
      path: "/:id",
      operationId: "updateSupplierScorecard",
      summary: "Update a supplier scorecard",
      description: `Writes the attributes sent (a partial body is a partial update). A changed \`vendorId\` must be a vendor of the caller's tenant, else 404 (A-336). ${WRITE_RULES}`,
      permission: access("write"),
      audited: true,
      params,
      body: updateScorecard,
      success: { status: 200, description: "The updated scorecard, with its vendor and evaluator", data: scorecardResponse },
    },
    {
      method: "delete",
      path: "/:id",
      operationId: "deleteSupplierScorecard",
      summary: "Delete a supplier scorecard",
      description: "Soft delete: the row is kept (paranoid) and no longer listed. An API key is refused (403).",
      permission: access("write"),
      audited: true,
      params,
      success: { status: 200, description: "Deleted; `data` is null", empty: true },
    },
  ],
});
