// Tenant storage settings (bring-your-own bucket) + the public signed-object
// stream that local/NFS download URLs point at.
//
// P9-18 (ADR-087): converted from storage.controller.js, behaviour unchanged.
// `req.user` is read without a guard on the settings routes (`auth`,
// `denyApiKey` and the tenant-admin `rbac` run first; the public object stream
// never reads it), and the settings body arrives validated. The services are
// read through their module objects at call time; the utilities are captured
// at load, as the `.js` destructured them. `export =` keeps the exact object
// `require()` returned (the same keys, in the same order).
import type { Request, Response } from "express";
import path from "path";
import storageSettingsService from "../services/storageSettings.service";
import storage from "../services/storage";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { contentTypeFor as loadedContentTypeFor, applyFileHeaders as loadedApplyFileHeaders } from "../utils/fileResponse.util";
import type { TenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const auditPrincipal = loadedAuditPrincipal;
const contentTypeFor = loadedContentTypeFor;
const applyFileHeaders = loadedApplyFileHeaders;

/** The principal `auth` set (read without a guard, as before). */
interface StoragePrincipal {
  tenantId: TenantId;
}

const tenantOf = (req: Request): TenantId => (req.user as StoragePrincipal).tenantId;

/** What a driver's `stat` answers for an object (fields read as the `.js` read them). */
interface ObjectMeta {
  key?: unknown;
  contentType?: string | null;
  size?: unknown;
  etag?: unknown;
  modifiedAt?: string | number | Date | null;
}

/** The object stream a driver's `get` answers. */
interface ObjectStream {
  on(event: "error", listener: () => void): unknown;
  pipe(destination: Response): unknown;
}

// GET /api/v1/storage/settings
const getSettings = asyncHandler(async (req: Request, res: Response) => {
  const data = await storageSettingsService.getSettings(tenantOf(req));
  success(res, data, null, "Storage settings retrieved", 200);
});

// PUT /api/v1/storage/settings
const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const data = await storageSettingsService.updateSettings(
    tenantOf(req),
    req.body as Parameters<typeof storageSettingsService.updateSettings>[1],
    auditPrincipal(req),
  );
  success(res, data, null, "Storage settings updated", 200);
});

// DELETE /api/v1/storage/settings  (revert to the platform default)
const clearSettings = asyncHandler(async (req: Request, res: Response) => {
  const data = await storageSettingsService.clearSettings(tenantOf(req), auditPrincipal(req));
  success(res, data, null, "Storage settings reset to platform default", 200);
});

// POST /api/v1/storage/settings/test  (health-check the active storage)
const testConnection = asyncHandler(async (req: Request, res: Response) => {
  const data = await storageSettingsService.testConnection(tenantOf(req));
  success(res, data, null, "Storage connection tested", 200);
});

// GET /api/v1/storage/usage
const getUsage = asyncHandler(async (req: Request, res: Response) => {
  const data = await storageSettingsService.getUsage(tenantOf(req));
  success(res, data, null, "Storage usage retrieved", 200);
});

/**
 * A validator for the object: the driver's own ETag when it has one (S3),
 * otherwise a weak tag from size + mtime (local/NFS) — the same inputs
 * express.static uses. Null when there is nothing stable to derive it from.
 */
const entityTag = (meta: ObjectMeta): string | null => {
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: the driver's tag, stringified
  if (meta.etag) {return String(meta.etag);}
  if (typeof meta.size === "number" && meta.modifiedAt) {
    const mtime = new Date(meta.modifiedAt).getTime();
    return `W/"${meta.size.toString(16)}-${mtime.toString(16)}"`;
  }
  return null;
};

// GET /api/v1/storage/object?key=...&token=...  (PUBLIC, HMAC-gated)
// This is where local/NFS signed URLs resolve; S3 URLs never reach the app.
//
// ADR-042 step 5: this used to set a hardcoded `Content-Disposition:
// attachment`, no ETag, no Last-Modified, and ignore Range — so it could back
// neither an <img>/<iframe> nor a resumed download. It now answers
//   - If-None-Match / If-Modified-Since with 304 (req.fresh),
//   - a single `bytes=` Range with 206 + Content-Range, an unsatisfiable one
//     with 416, and a malformed or multi-range request with the whole object
//     (RFC 9110 §14.2 lets a server ignore Range), honouring If-Range,
//   - a Content-Disposition chosen by the Content-Type (fileResponse.util):
//     inline only for raster images and PDF.
const getObject = asyncHandler(async (req: Request, res: Response) => {
  const { key, token } = req.query;
  // Token is verified and the object stat'ed BEFORE any header is written.
  const signed = await storage.openSignedObject(key, token);
  const meta = signed.meta as ObjectMeta;
  const { open } = signed;

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built: an empty key falls back to the asked one, stringified
  const objectKey = String(meta.key || key);
  const contentType = contentTypeFor(meta.contentType, objectKey);
  applyFileHeaders(res, { contentType, fileName: path.posix.basename(objectKey) });

  const size = typeof meta.size === "number" ? meta.size : null;
  const etag = entityTag(meta);
  if (etag) {res.setHeader("ETag", etag);}
  const lastModified = meta.modifiedAt ? new Date(meta.modifiedAt).toUTCString() : null;
  if (lastModified) {res.setHeader("Last-Modified", lastModified);}

  if ((etag || lastModified) && req.fresh) {
    return res.status(304).end();
  }

  let range: { start: number; end: number } | null = null;
  if (size !== null) {
    res.setHeader("Accept-Ranges", "bytes");
    const ifRange = req.headers["if-range"];
    const rangeApplies = !ifRange || ifRange === etag || ifRange === lastModified;
    const parsed = rangeApplies ? req.range(size, { combine: true }) : undefined;
    if (parsed === -1) {
      res.setHeader("Content-Range", `bytes */${String(size)}`);
      return res.status(416).end();
    }
    if (Array.isArray(parsed) && parsed.type === "bytes" && parsed.length === 1) {
      const [only] = parsed as unknown as [{ start: number; end: number }];
      range = { start: only.start, end: only.end };
    }
  }

  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`);
    res.setHeader("Content-Length", range.end - range.start + 1);
  } else if (size !== null) {
    res.setHeader("Content-Length", size);
  }

  if (req.method === "HEAD") {
    return res.end();
  }

  const stream = (await open(range)) as ObjectStream;
  stream.on("error", () => {
    // The object vanished mid-stream (concurrent delete). Headers may already
    // be sent, so we can only abort the connection.
    if (!res.headersSent) {res.status(410).end();}
    else {res.destroy();}
  });
  stream.pipe(res);
  return undefined;
});

const controller = {
  getSettings,
  updateSettings,
  clearSettings,
  testConnection,
  getUsage,
  getObject,
  _entityTag: entityTag, // exported for tests
};

export = controller;
