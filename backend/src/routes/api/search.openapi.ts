/**
 * P9-18 / P9-25 (ADR-103) — the contract of `search.route.ts`, code-first.
 *
 * One read behind `auth` and an OR gate over the menus a result can come from
 * (A-04): a caller holding `read` on any of them gets in, and the controller
 * then searches only the types that caller may read (the same `dynamicAccess`
 * each type's own list route runs). A type that fails on both full-text and
 * ILIKE is a 500 (A-56), never an empty result. Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";

/*
 * One row per searchable type, exactly the columns `search.service`'s TYPES
 * select (P9-25 item 11, 2026-10-02: this was a loose sketch). Every row
 * carries its `type` and a `rank` (ts_rank, or 0 from the ILIKE fallback).
 */
const rank = z.number().meta({ description: "ts_rank; 0 for an ILIKE fallback row" });
const DeviceRow = z.object({
  type: z.literal("device"),
  id: z.guid(),
  name: z.string(),
  serialNumber: z.string().nullable(),
  qrCode: z.string().nullable().meta({ description: "P21-07 (F-72): matched exactly (upper-cased) and ranked first (rank 1)" }),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  category: z.string().nullable(),
  rank,
});
const StockRow = z.object({
  type: z.literal("stock"),
  id: z.guid(),
  itemName: z.string(),
  sku: z.string().nullable(),
  serialNumber: z.string().nullable(),
  quantity: z.number().int(),
  rank,
});
const CertificateRow = z.object({
  type: z.literal("certificate"),
  id: z.guid(),
  certificateNumber: z.string(),
  status: z.string(),
  standard: z.string().nullable(),
  deviceId: z.guid(),
  rank,
});
const SearchRow = z.discriminatedUnion("type", [DeviceRow, StockRow, CertificateRow]).meta({ id: "SearchRow" });

/** What `search.service#search` answers. */
const SearchResults = z
  .object({
    query: z.string(),
    total: z.number().int(),
    results: z.array(SearchRow),
    byType: z.object({ device: z.array(DeviceRow).optional(), stock: z.array(StockRow).optional(), certificate: z.array(CertificateRow).optional() }),
  })
  .meta({
    id: "SearchResults",
    description: "Ranked rows across the permitted types, and the same rows grouped by type. An empty `q` answers no rows.",
    example: {
      query: "infusion",
      total: 1,
      results: [{ type: "device", id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f", name: "Infusion pump", serialNumber: "SN-0001", qrCode: "TST000001", manufacturer: "Acme", model: "IP-2", category: "Infusion", rank: 0.61 }],
      byType: { device: [{ type: "device", id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f", name: "Infusion pump", serialNumber: "SN-0001", qrCode: "TST000001", manufacturer: "Acme", model: "IP-2", category: "Infusion", rank: 0.61 }] },
    },
  });

export default defineRouteDocs({
  router: "api/search.route",
  mount: "/api/v1/search",
  tag: "Search",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "search",
      summary: "Unified tenant-scoped full-text search (devices, stock, certificates)",
      description:
        "PostgreSQL full-text search ranked by relevance, falling back to ILIKE. Scoped to the caller's tenant. A requested type the caller may not read is dropped, not refused; a caller who may read none of them gets 403.",
      permission: { kind: "dynamicAccess", resource: ["calibration", "warehouse", "certificate"], action: "read" },
      audited: false,
      query: z.object({
        q: z.string().meta({ description: "The search text", example: "infusion" }),
        types: z.string().optional().meta({ description: "Comma-separated subset of device, stock, certificate", example: "device,stock" }),
        limit: z.coerce.number().int().min(1).max(50).optional().meta({ description: "Rows per type (1-50, default 10)", example: 10 }),
      }),
      success: { status: 200, description: "The results", data: SearchResults },
    },
  ],
});
