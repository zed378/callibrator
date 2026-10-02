/**
 * Supplier scorecards: `/api/v1/supplier-scorecard`.
 *
 * P9-20 (ADR-087): converted from supplierScorecard.controller.js, behaviour
 * unchanged. As the JavaScript did: the body goes to the service as it came
 * (`|| {}`; no schema is mounted, A-336), the list query RAW; `req.user` and
 * `req.params` are read inline, so a missing principal throws the same
 * TypeError (whose message reaches the client outside production); the list
 * puts rows in `data` and `{ total, page, limit, totalPages }` in the top-level
 * `meta`, with `limit` parsed here as before. Each handler keeps its
 * message-to-status map.
 */
import type { Request, Response } from "express";
import scorecardService from "../services/supplierScorecard.service";
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
interface ScorecardParams {
  id: string;
}

/** What reaches the service is what the JavaScript passed: the body or `{}` (and the query RAW). */
type ScorecardBody = Parameters<typeof scorecardService.createScorecard>[1];

/** The list query's `limit`, parsed here as the JavaScript did (`parseInt(req.query.limit, 10) || 10`). */
interface LimitQuery {
  limit: string;
}

export const createScorecard = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
    const data = await scorecardService.createScorecard((req.user as Principal).tenantId, (req.body as ScorecardBody | undefined) || {}, (req.user as Principal).id, auditPrincipal(req));
    success(res, data, null, "Scorecard created successfully", 201);
  },
  {
    "Vendor not found": 404,
  },
);

export const getScorecards = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    // House style: rows in `data` (top-level array), pagination in `meta`.
    // The whole { rows, total, ... } object used to sit in `data`, so the
    // frontend list (reads `data` as an array) always rendered empty.
    const { rows, total, page, totalPages } = await scorecardService.getScorecards(
      (req.user as Principal).tenantId,
      req.query,
    );
    // As built: NaN and 0 fall back to 10.
    const limit = parseInt((req.query as unknown as LimitQuery).limit, 10) || 10;
    success(res, rows, { total, page, limit, totalPages }, "Scorecards retrieved successfully", 200);
  },
  {},
);

export const getScorecardById = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    const data = await scorecardService.getScorecardById((req.user as Principal).tenantId, (req.params as unknown as ScorecardParams).id);
    success(res, data, null, "Scorecard retrieved successfully", 200);
  },
  {
    "Scorecard not found": 404,
  },
);

export const updateScorecard = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
    const data = await scorecardService.updateScorecard((req.user as Principal).tenantId, (req.params as unknown as ScorecardParams).id, (req.body as ScorecardBody | undefined) || {}, auditPrincipal(req));
    success(res, data, null, "Scorecard updated successfully", 200);
  },
  {
    "Scorecard not found": 404,
  },
);

export const deleteScorecard = asyncHandlerWithMapping(
  async (req: Request, res: Response) => {
    await scorecardService.deleteScorecard((req.user as Principal).tenantId, (req.params as unknown as ScorecardParams).id, auditPrincipal(req));
    success(res, null, null, "Scorecard deleted successfully", 200);
  },
  {
    "Scorecard not found": 404,
  },
);
