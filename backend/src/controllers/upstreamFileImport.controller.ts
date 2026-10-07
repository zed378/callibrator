/**
 * The rsync image import's handlers (super admin only: the route's `superAdminOnly`). Every body
 * arrives validated (`validate(schema)` on the route) and is read with `validated(req, schema)`.
 * The credential in a body is passed to the service and nowhere else — this file logs nothing.
 */
import type { Request, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { validated } from "../middlewares/validation.middleware";
import {
  checkConnectionSchema,
  importIdSchema,
  listImportsSchema,
  startImportSchema,
} from "../validators/upstreamFileImport.validator";
import {
  cancelImport,
  checkConnection,
  getImport,
  getImportConfig,
  listImports,
  startImport,
  type Actor,
} from "../services/upstreamFileImport.service";
import { actorIdOf, requestOriginOf } from "../utils/requestOrigin.util";

/** The super admin acting, with the request's address (for the audit rows). */
const actorOf = (req: Request): Actor => {
  const { ip, userAgent } = requestOriginOf(req);
  return { userId: actorIdOf(req), ipAddress: ip, userAgent };
};

/** GET /admin/upstream-file-imports/config */
export const config = asyncHandler((_req: Request, res: Response) => {
  success(res, getImportConfig(), "Upstream import configuration", 200);
  return Promise.resolve();
});

/** POST /admin/upstream-file-imports/check-connection */
export const check = asyncHandler(async (req: Request, res: Response) => {
  success(res, await checkConnection(validated(req, checkConnectionSchema), actorOf(req)), "Connection checked", 200);
});

/** POST /admin/upstream-file-imports */
export const start = asyncHandler(async (req: Request, res: Response) => {
  success(res, await startImport(validated(req, startImportSchema), actorOf(req)), "Import queued", 201);
});

/** GET /admin/upstream-file-imports — rows in `data`, pagination in a top-level `meta`. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listImports(validated(req, listImportsSchema));
  success(res, rows, meta, "Imports retrieved", 200);
});

/** GET /admin/upstream-file-imports/:id */
export const detail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = validated(req, importIdSchema);
  success(res, await getImport(id), "Import retrieved", 200);
});

/** POST /admin/upstream-file-imports/:id/cancel */
export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const { id } = validated(req, importIdSchema);
  success(res, await cancelImport(id, actorOf(req)), "Cancel requested", 200);
});
