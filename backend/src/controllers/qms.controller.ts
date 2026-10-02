/**
 * Quality: non-conformances and CAPAs, `/api/v1/qms`.
 *
 * P9-20 (ADR-087): converted from qms.controller.js, behaviour unchanged. The
 * handlers RETURN the envelope and `asyncHandlerWithMapping` sends it, mapping
 * the named service messages to 404, as before. `req.user`, `req.params` and
 * `req.query` are read INLINE as the JavaScript read them, so a missing user
 * throws the same TypeError, with the same message, inside the wrapper; the
 * list paging is passed raw, as before (the service's arithmetic coerces it).
 * Everything the JavaScript destructured at load is still captured at load.
 */
import type { Request } from "express";
import qmsService from "../services/qms.service";
import { asyncHandlerWithMapping as loadedAsyncHandlerWithMapping } from "../utils/controllerWrapper.util";
// Who did it, from where — for the audit row the service writes inside its
// transaction (A-66, the A-41 pattern).
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import type { TenantId, UserId } from "../types/ids";

const asyncHandlerWithMapping = loadedAsyncHandlerWithMapping;
const auditActor = loadedAuditActor;

/** The principal `auth` set (read without a guard, as before). */
interface QmsPrincipal {
  tenantId: TenantId;
  id: UserId;
}

/** The list paging and filter, RAW from the query string (strings at run time; the service coerces). */
interface RawListQuery {
  page?: number;
  limit?: number;
  status?: string;
}

/** The body `validate()` left on `req.body` (or `{}` where the JavaScript wrote `|| {}`). */
type Body = Parameters<typeof qmsService.createNC>[2] & Parameters<typeof qmsService.createCapa>[1];

export const createNC = asyncHandlerWithMapping(async (req: Request) => {
  const result = await qmsService.createNC(
    (req.user as QmsPrincipal).tenantId,
    (req.user as QmsPrincipal).id,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
    (req.body || {}) as Body,
    auditActor(req),
  );
  return {
    success: true,
    status: 201,
    message: "Non-Conformance created successfully",
    data: result,
  };
}, {});

export const getNCs = asyncHandlerWithMapping(async (req: Request) => {
  const { page, limit, status } = req.query as RawListQuery;
  const { nonConformances, total, page: currentPage, limit: pageLimit, totalPages } =
    await qmsService.getNCs((req.user as QmsPrincipal).tenantId, page, limit, status);
  return {
    success: true,
    status: 200,
    message: "Non-Conformances retrieved successfully",
    // House envelope: rows in `data`, pagination in a top-level `meta` sibling
    // (matches risk/audit). Previously the whole { total, …, nonConformances }
    // object sat in `data`, so a frontend reading data as an array saw nothing.
    data: nonConformances,
    meta: { total, page: currentPage, limit: pageLimit, totalPages },
  };
}, {});

export const updateNC = asyncHandlerWithMapping(async (req: Request) => {
  const result = await qmsService.updateNC(
    (req.user as QmsPrincipal).tenantId,
    req.params["id"] as string,
    req.body as Body,
    auditActor(req),
  );
  return {
    success: true,
    status: 200,
    message: "Non-Conformance updated successfully",
    data: result,
  };
}, {
  "Non-Conformance not found": 404,
});

export const createCapa = asyncHandlerWithMapping(async (req: Request) => {
  const result = await qmsService.createCapa(
    (req.user as QmsPrincipal).tenantId,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
    (req.body || {}) as Body,
    auditActor(req),
  );
  return {
    success: true,
    status: 201,
    message: "CAPA created successfully",
    data: result,
  };
}, {
  "Non-Conformance not found": 404,
});

export const getCapas = asyncHandlerWithMapping(async (req: Request) => {
  const { page, limit, status } = req.query as RawListQuery;
  const { capas, total, page: currentPage, limit: pageLimit, totalPages } =
    await qmsService.getCapas((req.user as QmsPrincipal).tenantId, page, limit, status);
  return {
    success: true,
    status: 200,
    message: "CAPAs retrieved successfully",
    data: capas,
    meta: { total, page: currentPage, limit: pageLimit, totalPages },
  };
}, {});

export const updateCapa = asyncHandlerWithMapping(async (req: Request) => {
  // A-62 — the caller is passed as the actor: a CAPA's approver is whoever
  // made the request (auditActor(req).userId), never an id named in the body.
  const result = await qmsService.updateCapa(
    (req.user as QmsPrincipal).tenantId,
    req.params["id"] as string,
    req.body as Body,
    auditActor(req),
  );
  return {
    success: true,
    status: 200,
    message: "CAPA updated successfully",
    data: result,
  };
}, {
  "CAPA not found": 404,
});
