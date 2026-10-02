/**
 * The risk register: `/api/v1/risk`.
 *
 * P9-20 (ADR-087): converted from risk.controller.js, behaviour unchanged.
 * As the JavaScript did: the body goes to the service as it came (`|| {}`; no
 * schema is mounted, A-335), the list query RAW; `req.user` and `req.params`
 * are read inline, so a missing principal throws the same TypeError (whose
 * message reaches the client outside production); the list puts rows in
 * `data` and `{ total, page, limit, totalPages }` in the top-level `meta`, with
 * `limit` parsed here as before. Each handler keeps its message-to-status map.
 */
import type { Request, Response } from "express";
import riskService from "../services/risk.service";
import { success as loadedSuccess } from "../utils/response.util";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { asyncHandlerWithMapping as loadedAsyncHandlerWithMapping } from "../utils/controllerWrapper.util";
import type { TenantId, UserId } from "../types/ids";

const success = loadedSuccess;
const auditPrincipal = loadedAuditPrincipal;
const asyncHandlerWithMapping = loadedAsyncHandlerWithMapping;

/** The principal `auth` set, read inline as `req.user.tenantId` / `req.user.id`. */
interface Principal {
  tenantId: TenantId;
  id: UserId;
}

/** `:id`, read without a schema. */
interface RiskParams {
  id: string;
}

/** What reaches the service is what the JavaScript passed: the body or `{}` (and the query RAW). */
type RiskBody = Parameters<typeof riskService.createRisk>[1];

/** The list query's `limit`, parsed here as the JavaScript did (`parseInt(req.query.limit, 10) || 10`). */
interface LimitQuery {
  limit: string;
}

export const createRisk = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
    const data = await riskService.createRisk((req.user as Principal).tenantId, (req.body as RiskBody | undefined) || {}, (req.user as Principal).id, auditPrincipal(req));
    success(res, data, null, "Risk created successfully", 201);
  },
  {},
);

export const getRisks = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    // House style: rows go in `data` (a top-level array) and pagination in the
    // `meta` sibling. Previously the whole { rows, total, ... } object sat in
    // `data`, so the frontend (which reads `data` as an array) always rendered
    // an empty list and lost pagination.
    const { rows, total, page, totalPages } = await riskService.getRisks(
      (req.user as Principal).tenantId,
      req.query,
    );
    // As built: NaN and 0 fall back to 10.
    const limit = parseInt((req.query as unknown as LimitQuery).limit, 10) || 10;
    success(res, rows, { total, page, limit, totalPages }, "Risks retrieved successfully", 200);
  },
  {},
);

export const getRiskById = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    const data = await riskService.getRiskById((req.user as Principal).tenantId, (req.params as unknown as RiskParams).id);
    success(res, data, null, "Risk retrieved successfully", 200);
  },
  {
    "Risk not found": 404,
  },
);

export const updateRisk = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
    const data = await riskService.updateRisk((req.user as Principal).tenantId, (req.params as unknown as RiskParams).id, (req.body as RiskBody | undefined) || {}, auditPrincipal(req));
    success(res, data, null, "Risk updated successfully", 200);
  },
  {
    "Risk not found": 404,
  },
);

export const deleteRisk = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    await riskService.deleteRisk((req.user as Principal).tenantId, (req.params as unknown as RiskParams).id, auditPrincipal(req));
    success(res, null, null, "Risk deleted successfully", 200);
  },
  {
    "Risk not found": 404,
  },
);
