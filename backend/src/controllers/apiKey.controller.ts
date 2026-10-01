// src/controllers/apiKey.controller.ts
//
// P9-20 (ADR-087): converted from apiKey.controller.js with no behaviour
// change. `export =` keeps the exact object `require()` returned (the same
// keys, in the same order). The service is the module object; `asyncHandler`,
// `success` and `auditActor` are captured at load, as the `.js` destructured
// them. Request data is read through typed views, so the emitted expressions
// are the `.js` ones (`req.user.tenantId` unguarded, as before).
import type { Request, Response } from "express";

import apiKeyService from "../services/apiKey.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import type { TenantId, UserId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const auditActor = loadedAuditActor;

/** The request as `auth` leaves it. */
interface KeyRequest extends Request {
  user: { id: UserId; tenantId: TenantId };
}

/**
 * The create body, as the service reads it. The route mounts no validator: the
 * service refuses a missing name, a bad scope list and a bad date itself.
 */
interface CreateKeyBody {
  name?: string;
  scopes?: unknown;
  expiresAt?: Date | string | null;
}

/** The list query, as the query string carries it. */
interface ListQuery {
  page?: string;
  limit?: string;
}

const create = asyncHandler(async (req: Request, res: Response) => {
  const r = req as KeyRequest;
  // A-09: Express 5 gives `undefined`, not `{}`, when no body was sent, so
  // `req.body.name` threw a TypeError — a 500 where the service already owes a
  // 400 ("name is required").
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { name, scopes, expiresAt } = (r.body as CreateKeyBody | undefined) || {};
  const data = await apiKeyService.createApiKey(
    r.user.tenantId,
    {
      name,
      scopes,
      expiresAt,
      createdBy: r.user.id,
    },
    auditActor(req),
  );
  success(
    res,
    data,
    null,
    "API key created — copy the key now, it will not be shown again",
    201,
  );
});

const list = asyncHandler(async (req: Request, res: Response) => {
  const r = req as KeyRequest;
  const query = r.query as ListQuery;
  const result = await apiKeyService.listApiKeys(r.user.tenantId, {
    page: query.page,
    limit: query.limit,
  });
  success(res, result.rows, result.meta, "API keys retrieved", 200);
});

const getOne = asyncHandler(async (req: Request, res: Response) => {
  const r = req as KeyRequest;
  const data = await apiKeyService.getApiKey(r.user.tenantId, r.params["id"] as string);
  success(res, data, null, "API key retrieved", 200);
});

const revoke = asyncHandler(async (req: Request, res: Response) => {
  const r = req as KeyRequest;
  const data = await apiKeyService.revokeApiKey(r.user.tenantId, r.params["id"] as string, auditActor(req));
  success(res, data, null, "API key revoked", 200);
});

const controller = {
  create,
  list,
  getOne,
  revoke,
};

export = controller;
