/**
 * `idempotency()` — honour an `Idempotency-Key` header on a write route (P21-03b; ADR-127 § 7;
 * spec MEMORY/specs/P19-02-ipm-session-aggregate.md § 9.2; P19-08 § 9.5 G-O8; AM-25; G-26).
 *
 * Absent header → the route runs as usual. Present (a UUID v4, else 400):
 *  1. the request hash — SHA-256 over the method, the route template, the path parameters and the
 *     canonical JSON body (a multipart upload: the file's SHA-256 and the fields) — and the scope
 *     fingerprint — SHA-256 over the tenant, the facility (or "unbound"), the role and the
 *     effective permission on the route's menu slug;
 *  2. `beginIdempotentRequest`: a repeat of a COMPLETED request is answered with the stored status
 *     and the resource RE-READ IN THE CURRENT CONTEXT (`read`; gone from view → 404); a different
 *     body under the key, a changed scope or a request still in flight → 409 with its top-level
 *     `code` (`IDEMPOTENCY_CONFLICT_CODES`);
 *  3. otherwise the route runs with the key's handle in `idempotencyStorage`; its service completes
 *     the key inside its own transaction; any answer that is not a success frees the key.
 *
 * Mounted AFTER `auth`, the gates and `validate` (a request the route would refuse never takes a
 * key) — and, on `POST /attachments`, after multer and the bound gate (the file is hashed).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { createHash } from "node:crypto";
import fs from "fs";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { UUID_V4 } from "@callibrator/contracts/inspectionSessions";
import { facilityContextOf } from "./tenantContext.middleware";
import { accessOf, loadPermissionSources, type PermissionPrincipal } from "../services/effectivePermission.service";
import {
  beginIdempotentRequest,
  idempotencyStorage,
  releaseIdempotentRequest,
  type IdempotencyHandle,
} from "../services/idempotency.service";
import { success } from "../utils/response.util";
import { logger } from "./activityLog.middleware";
import type { TenantId } from "../types/ids";

/** The header (RFC draft "The Idempotency-Key HTTP Header Field"). */
export const IDEMPOTENCY_HEADER = "idempotency-key";
/** The version tag that opens the scope fingerprint's input. */
export const IDEMPOTENCY_SCOPE_VERSION = "idempotency-scope/v1";

/** How a route honours the header. */
export interface IdempotencyOptions {
  /** The menu slug of the route's gate: its effective permission is part of the scope. */
  readonly slug: string;
  /** Re-read the stored resource in the current context (a 404 when gone from view). */
  readonly read: (id: string, req: Request) => Promise<unknown>;
}

interface KeyPrincipal {
  readonly id: string;
  readonly isApiKey?: boolean;
  readonly role?: { readonly id?: string | null } | null;
  readonly clientFacilityId?: unknown;
}

/** JSON with object keys sorted at every depth (the request hash's canonical body). */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

const sha256 = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");

/** The uploaded file's SHA-256, when the request carries one (multer's disk storage). */
const fileHash = async (req: Request): Promise<string | null> => {
  const file = (req as Request & { file?: { path?: string } }).file;
  return file?.path ? sha256(await fs.promises.readFile(file.path)) : null;
};

/** `"METHOD /mount/path-template"` — the route a key belongs to (a route-level middleware: `req.route` is set). */
const routeOf = (req: Request): string => `${req.method} ${req.baseUrl}${(req.route as { path: string }).path}`.slice(0, 128);

/** A refused or replayed upload's quarantined file is removed (it is never stored). */
const discardUpload = async (req: Request): Promise<void> => {
  const file = (req as Request & { file?: { path?: string } }).file;
  if (file?.path) {
    await fs.promises.unlink(file.path).catch(() => undefined);
  }
};

const scopeOf = async (principal: KeyPrincipal, tenantId: string, slug: string): Promise<string> => {
  const { clientFacilityId } = facilityContextOf(principal);
  const access = principal.isApiKey ? "api-key" : String(accessOf(await loadPermissionSources(principal as unknown as PermissionPrincipal), slug));
  const roleId = principal.role?.id ?? "-";
  return sha256([IDEMPOTENCY_SCOPE_VERSION, tenantId, clientFacilityId ?? "unbound", roleId, `${slug}=${access}`].join("\n"));
};

const refuse = (res: Response, status: number, message: string, code?: string): void => {
  res.status(status).json({ success: false, status, message, data: null, ...(code ? { code } : {}) });
};

/** Settle the key when the route answers: `res.json` is the one exit every handler and error path takes. */
const settleOnAnswer = (res: Response, handle: IdempotencyHandle): void => {
  const send = res.json.bind(res);
  res.json = ((body: unknown) => {
    void releaseIdempotentRequest(handle, res.statusCode)
      .catch((err: unknown) => {
        logger.error("Idempotency key could not be settled", { error: String(err) });
      })
      .finally(() => send(body));
    return res;
  }) as Response["json"];
};

/**
 * The middleware for one route.
 *
 * @param options - the route's slug and its resource reader
 * @returns the handler
 */
export const idempotency =
  (options: IdempotencyOptions): RequestHandler =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const header = req.headers[IDEMPOTENCY_HEADER];
      if (header === undefined) {
        next();
        return;
      }
      if (!UUID_V4.test(String(header))) {
        refuse(res, 400, "Idempotency-Key must be a UUID v4.");
        return;
      }
      try {
        const principal = req.user as KeyPrincipal;
        const tenantId = req.tenantId as TenantId;
        const file = await fileHash(req);
        const requestHash = sha256(canonicalJson({ route: routeOf(req), params: req.params, body: req.body as unknown, file }));
        const begun = await beginIdempotentRequest({
          tenantId,
          userId: principal.isApiKey ? null : principal.id,
          apiKeyId: principal.isApiKey ? principal.id : null,
          key: String(header).toLowerCase(),
          route: routeOf(req),
          requestHash,
          scopeFingerprint: await scopeOf(principal, tenantId, options.slug),
        });
        if (begun.kind === "conflict") {
          await discardUpload(req);
          refuse(res, 409, begun.message, begun.code);
          return;
        }
        if (begun.kind === "replay") {
          await discardUpload(req);
          const data = begun.resourceId ? await options.read(begun.resourceId, req) : null;
          res.setHeader("Idempotent-Replayed", "true");
          success(res, data, null, "Replayed", begun.status);
          return;
        }
        settleOnAnswer(res, begun.handle);
        idempotencyStorage.run(begun.handle, () => {
          next();
        });
      } catch (err) {
        next(err);
      }
    };
