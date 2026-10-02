/**
 * SOP document control and training, `/api/v1/sop`.
 *
 * P9-21 (ADR-087): converted from sop.controller.js, behaviour unchanged. The
 * handlers RETURN the envelope and `asyncHandlerWithMapping` sends it, mapping
 * the named service messages to 404, as before. `req.user`, `req.params`,
 * `req.query` and `req.body` are read INLINE as the JavaScript read them (a
 * missing user throws the same TypeError, inside the wrapper); the list paging
 * is passed raw (the service coerces it). Everything it required at load is
 * captured at load, in its order. `export =` keeps the exact object
 * `require()` returned (the same keys, in the same order).
 */
import type { Request } from "express";
import sopService from "../services/sop.service";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { asyncHandlerWithMapping as loadedAsyncHandlerWithMapping } from "../utils/controllerWrapper.util";
import type { TenantId, UserId } from "../types/ids";

const auditPrincipal = loadedAuditPrincipal;
const asyncHandlerWithMapping = loadedAsyncHandlerWithMapping;

/** The principal `auth` set (read without a guard, as before). */
interface SopPrincipal {
  tenantId: TenantId;
  id: UserId;
}

/** The body the route forwards unvalidated (`|| {}` where the JavaScript wrote it). */
type CreateBody = Parameters<typeof sopService.createDocument>[2];

/** The list paging and filter, RAW from the query string (strings at run time; the service coerces). */
interface RawListQuery {
  page?: string;
  limit?: string;
  status?: string;
}

const createDocument = asyncHandlerWithMapping(async (req: Request) => {
  const result = await sopService.createDocument(
    (req.user as SopPrincipal).tenantId,
    (req.user as SopPrincipal).id,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
    (req.body || {}) as CreateBody,
    auditPrincipal(req),
  );
  return {
    success: true,
    status: 201,
    message: "Document created successfully",
    data: result,
  };
}, {});

const getDocuments = asyncHandlerWithMapping(async (req: Request) => {
  const { page, limit, status } = req.query as RawListQuery;
  const { documents, total, page: currentPage, limit: pageLimit, totalPages } =
    await sopService.getDocuments((req.user as SopPrincipal).tenantId, page, limit, status);
  return {
    success: true,
    status: 200,
    message: "Documents retrieved successfully",
    // House envelope: rows in `data`, pagination in a top-level `meta` sibling.
    data: documents,
    meta: { total, page: currentPage, limit: pageLimit, totalPages },
  };
}, {});

// A-28: the publisher's identity is required — the service refuses to publish
// an SOP whose author is the caller (separation of duties).
const publishDocument = asyncHandlerWithMapping(async (req: Request) => {
  const result = await sopService.publishDocument(
    (req.user as SopPrincipal).tenantId,
    (req.params as { id: string }).id,
    (req.user as SopPrincipal).id,
  );
  return {
    success: true,
    status: 200,
    message: "Document published and training tasks assigned",
    data: result,
  };
}, {
  "Document not found": 404,
});

const acknowledgeTraining = asyncHandlerWithMapping(async (req: Request) => {
  const result = await sopService.acknowledgeTraining(
    (req.user as SopPrincipal).tenantId,
    (req.user as SopPrincipal).id,
    (req.params as { id: string }).id,
  );
  return {
    success: true,
    status: 200,
    message: "Training acknowledged successfully",
    data: result,
  };
}, {
  "Training acknowledgment not found": 404,
});

export = {
  createDocument,
  getDocuments,
  publishDocument,
  acknowledgeTraining,
};
