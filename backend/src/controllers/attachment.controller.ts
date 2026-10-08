/**
 * Attachments, `/api/v1/attachments`.
 *
 * P9-18 (ADR-087): converted from attachment.controller.js, behaviour
 * unchanged. `req.user` is read without a guard on the authenticated routes
 * (`auth` runs first; the token-gated download never reads it), `req.file` is
 * multer's, and the list filters are passed raw (the service coerces them).
 * The service (still JavaScript; typed by attachment.service.d.ts) is read
 * through its module object at call time; the utilities are captured at load,
 * as the `.js` destructured them. `export =` keeps the exact object
 * `require()` returned (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import attachmentService from "../services/attachment.service";
import { withDisplay, withDisplays } from "../services/personDisplay.service";

/** P21-09e (spec § 12): the uploader shown beside each file, for every viewer. */
const FILE_PEOPLE = { uploaderDisplay: "uploadedBy" } as const;
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
// A-189: the configured public origin, never the proxy-facing Host header.
import { baseUrlOf as loadedBaseUrlOf } from "../utils/publicBaseUrl.util";
import { sendStoredFile as loadedSendStoredFile, sendStorageObject as loadedSendStorageObject } from "../utils/fileResponse.util";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { validated } from "../middlewares/validation.middleware";
import { createSignedUrlSchema } from "../validators/attachment.validator";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const baseUrlOf = loadedBaseUrlOf;
const sendStoredFile = loadedSendStoredFile;
const sendStorageObject = loadedSendStorageObject;
const auditPrincipal = loadedAuditPrincipal;

/** The principal `auth` set (read without a guard, as before). */
interface AttachmentPrincipal {
  tenantId: string;
}

const tenantOf = (req: Request): string => (req.user as AttachmentPrincipal).tenantId;

// POST /api/v1/attachments (multipart: file + resourceType/resourceId)
const upload = asyncHandler(async (req: Request, res: Response) => {
  // A-09: multer only populates req.body for a multipart request; a POST with
  // no body at all leaves it `undefined` under Express 5, and reading
  // `.resourceType` off it threw a TypeError (500) instead of reaching the
  // service's own 400.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
  const { resourceType, resourceId } = (req.body || {}) as { resourceType?: unknown; resourceId?: unknown };
  // A-282 (ADR-100): an API key is not a user — `uploaded_by` and the audit
  // row's user reference `users`, so a key uploads as no user and is named
  // by `apiKeyId` (system:api-key) instead.
  const principal = auditPrincipal(req);
  const data = await attachmentService.createAttachment(tenantOf(req), req.file, {
    resourceType,
    resourceId,
    uploadedBy: principal.userId,
    apiKeyId: principal.apiKeyId,
    // A-117: for the CREATE audit row written with the attachment.
    ipAddress: principal.ipAddress,
    userAgent: principal.userAgent,
  });
  success(res, data, null, "Attachment uploaded", 201);
});

// GET /api/v1/attachments
const list = asyncHandler(async (req: Request, res: Response) => {
  const { resourceType, resourceId, page, limit } = req.query;
  const result = await attachmentService.listAttachments(tenantOf(req), {
    resourceType,
    resourceId,
    page,
    limit,
  });
  success(res, await withDisplays(result.rows, FILE_PEOPLE), result.meta, "Attachments retrieved", 200);
});

// GET /api/v1/attachments/orphans — D-22 (ADR-070): the tenant's live
// attachments whose linked record is gone. Rows in `data`, a top-level `meta`.
const listOrphans = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = req.query;
  const result = await attachmentService.listOrphans(tenantOf(req), { page, limit });
  success(res, result.rows, result.meta, "Orphaned attachments retrieved", 200);
});

// GET /api/v1/attachments/:id
const getOne = asyncHandler(async (req: Request, res: Response) => {
  const data = await attachmentService.getAttachment(tenantOf(req), req.params["id"] as string);
  success(res, await withDisplay(data, FILE_PEOPLE), null, "Attachment retrieved", 200);
});

/** What the service answers for a download: a storage object, or a legacy path. */
type AttachmentDownload = Awaited<ReturnType<typeof attachmentService.getDownload>>;

/**
 * Put an attachment on the wire. P8-01 (ADR-086 Amendment 1): a stored object
 * goes through sendStorageObject — the same 304/206/416/HEAD semantics and
 * headers sendFile gave a file on disk (routes/storedFiles.identity.p801 proves
 * the two identical) — and a row written before the cut-over is still sent
 * from its legacy file by sendStoredFile.
 */
const sendAttachment = async (req: Request, res: Response, file: AttachmentDownload): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty type is sent as a download
  const opts = { contentType: file.mimeType || "application/octet-stream", fileName: file.fileName };
  if (file.object) {
    await sendStorageObject(req, res, file.object, opts);
    return;
  }
  await sendStoredFile(res, file.absPath as string, opts);
};

// GET /api/v1/attachments/:id/download
// ADR-042 step 4/5: this is now THE url an attachment response carries, so it
// must do what the static mount did — ETag/304, Range/206, and inline for
// images and PDF (anything else stays a download) — see fileResponse.util.
const download = asyncHandler(async (req: Request, res: Response) => {
  await sendAttachment(req, res, await attachmentService.getDownload(tenantOf(req), req.params["id"] as string));
});

// POST /api/v1/attachments/:id/signed-url
// A-365: the body passed validate(createSignedUrlSchema) on the route (the
// lifetime is bounded), and the link is bound to the principal minting it.
const createSignedUrl = asyncHandler(async (req: Request, res: Response) => {
  const { expiresInSec } = validated(req, createSignedUrlSchema);
  const principal = auditPrincipal(req);
  const data = await attachmentService.generateSignedUrl(tenantOf(req), req.params["id"] as string, {
    baseUrl: baseUrlOf(req),
    expiresInSec,
    issuer: { userId: principal.userId, apiKeyId: principal.apiKeyId },
  });
  success(res, data, null, "Signed URL generated", 200);
});

// GET /api/v1/attachments/:id/signed?token=... (PUBLIC, token-gated)
const downloadSigned = asyncHandler(async (req: Request, res: Response) => {
  await sendAttachment(
    req,
    res,
    await attachmentService.getSignedDownload(req.params["id"] as string, req.query["token"]),
  );
});

// DELETE /api/v1/attachments/:id
// A-28: the actor is carried into the service so the audit row written inside
// the delete transaction is attributable.
const remove = asyncHandler(async (req: Request, res: Response) => {
  // A-282 (ADR-100): an API key is audited as system:api-key.
  const data = await attachmentService.deleteAttachment(tenantOf(req), req.params["id"] as string, auditPrincipal(req));
  success(res, data, null, "Attachment deleted", 200);
});

// P21-03 (G-O8): the idempotency replay's reader — the attachment, re-read in the current context.
const readForReplay = (id: string, req: Request): Promise<unknown> => attachmentService.getAttachment(tenantOf(req), id);

const controller = { upload, list, listOrphans, getOne, download, createSignedUrl, downloadSigned, remove, readForReplay };

export = controller;
