/**
 * Outbound webhooks, `/api/v1/webhooks`.
 *
 * P9-18 (ADR-087): converted from webhook.controller.js, behaviour unchanged.
 * `req.user` is read without a guard (`auth`, `denyApiKey` and the tenant-admin
 * `rbac` run first), the bodies arrive already validated (`validate(schema)` on
 * the writes), and the paging is passed raw (the service coerces it). The
 * casts are typing only. The service is read through its module object at
 * call time; `asyncHandler` and `success` are captured at load, as the `.js`
 * destructured them. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import webhookService from "../services/webhook.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import type { TenantId, UserId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;

type Service = typeof webhookService;
/** The service method's N-th parameter (what the handler passes it). */
type Arg<K extends keyof Service, N extends number> = Service[K] extends (...args: infer A) => unknown ? A[N] : never;

/** The principal `auth` set (read without a guard, as before). */
interface WebhookPrincipal {
  tenantId: TenantId;
  id: UserId;
}

const principal = (req: Request): WebhookPrincipal => req.user as WebhookPrincipal;

/** The paging, raw from the query string (the service coerces it). */
interface RawPaging {
  page?: string;
  limit?: string;
}
const paging = (req: Request): RawPaging => {
  const raw = { page: req.query["page"], limit: req.query["limit"] };
  return raw as RawPaging;
};

// Who did it, for the audit row the service writes inside its transaction.
const actorOf = (req: Request): Arg<"createWebhook", 2> => ({
  userId: principal(req).id,
  ipAddress: req.ip as string,
  userAgent: req.get("user-agent") as string,
});

// A-51. The accepted fields are named, not spread: `validate(createWebhookSchema)`
// already strips anything else, and this keeps a caller-supplied `secret` (or
// `tenantId`) out of the service even if the route's validator is ever removed.
const create = asyncHandler(async (req: Request, res: Response) => {
  const { url, events, description, isActive } = req.body as Required<Arg<"createWebhook", 1>>;
  const data = await webhookService.createWebhook(
    principal(req).tenantId,
    { url, events, description, isActive, createdBy: principal(req).id },
    actorOf(req),
  );
  success(res, data, null, "Webhook created", 201);
});

const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await webhookService.listWebhooks(principal(req).tenantId, paging(req));
  success(res, result.rows, result.meta, "Webhooks retrieved", 200);
});

const getOne = asyncHandler(async (req: Request, res: Response) => {
  const data = await webhookService.getWebhook(principal(req).tenantId, req.params["id"] as string);
  success(res, data, null, "Webhook retrieved", 200);
});

const update = asyncHandler(async (req: Request, res: Response) => {
  const data = await webhookService.updateWebhook(
    principal(req).tenantId,
    req.params["id"] as string,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
    (req.body || {}) as Arg<"updateWebhook", 2>,
    actorOf(req),
  );
  success(res, data, null, "Webhook updated", 200);
});

const remove = asyncHandler(async (req: Request, res: Response) => {
  const data = await webhookService.deleteWebhook(principal(req).tenantId, req.params["id"] as string, actorOf(req));
  success(res, data, null, "Webhook deleted", 200);
});

const deliveries = asyncHandler(async (req: Request, res: Response) => {
  const result = await webhookService.listDeliveries(principal(req).tenantId, req.params["id"] as string, paging(req));
  success(res, result.rows, result.meta, "Deliveries retrieved", 200);
});

const test = asyncHandler(async (req: Request, res: Response) => {
  const data = await webhookService.testWebhook(principal(req).tenantId, req.params["id"] as string);
  success(res, data, null, "Test delivery attempted", 200);
});

// A-51. Issues a new signing secret and returns it once. P6-13: the validated
// body names the overlap window (rotateWebhookSecretSchema defaults it).
const rotateSecret = asyncHandler(async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
  const { overlapHours } = (req.body || {}) as { overlapHours?: unknown };
  const data = await webhookService.rotateSecret(principal(req).tenantId, req.params["id"] as string, actorOf(req), {
    overlapHours,
  });
  success(res, data, null, "Webhook secret rotated", 200);
});

const controller = { create, list, getOne, update, remove, deliveries, test, rotateSecret };

export = controller;
