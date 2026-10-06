// src/services/contentMedia.service.ts
//
// ADR-042 step 3 (S-01) — CMS images join the deliberately PUBLIC class.
//
// The blog/news editor used to upload its images as ATTACHMENTS
// (resourceType "post") and embed the attachment's permanent `/uploads/...`
// URL into published HTML. That only worked because every attachment was on
// the unauthenticated static mount — the same mount that exposed tenant
// evidence. With attachments behind gated routes (step 4), a CMS image must be
// public on purpose: uploaded by someone holding `content:create`, written to
// `uploads/public/cms/`, recorded in the audit log, and served by the public
// mount with its image-only Content-Type allowlist.
//
// P9-18 (ADR-087, Stage C leaves): converted from contentMedia.service.js with
// no behaviour change. `export =` keeps the exact object `require()` returned.
// `fs` and `auditService` are the module objects (read at call time, so the
// tests' mocks and spies apply); `AppError` and `PUBLIC_UPLOADS_URL` are
// captured once at load, as the `.js` destructured them.

import auditService from "./audit.service";
import { AppError as LoadedAppError } from "../utils/appError.util";
import {
  PUBLIC_UPLOADS_URL as LOADED_PUBLIC_UPLOADS_URL,
  PUBLIC_UPLOAD_FOLDERS,
  deleteUpload,
} from "../utils/upload.util";
import { auditEntryActor, actorChanges } from "../utils/auditPrincipal.util";

const AppError = LoadedAppError;
const PUBLIC_UPLOADS_URL = LOADED_PUBLIC_UPLOADS_URL;

/** The multer file the upload route has already checked and placed. */
interface UploadedFile {
  path: string;
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Who uploaded it. */
interface MediaActor {
  userId?: string | null;
  /** A-282 (ADR-100): an API key uploads as `system:api-key`, never as a user. */
  apiKeyId?: string | null;
  tenantId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface RecordedMedia {
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/**
 * Record a CMS image upload that multer + the magic-byte check have already
 * placed in `uploads/public/cms/`, and return its public URL.
 *
 * The audit row is the only database write, so there is no transaction to
 * share: if it cannot be written the file is removed and the upload refused —
 * a public file nobody can be held to account for is not kept.
 *
 * @throws {AppError} 400 with no file; 500 when the audit row could not be written
 */
const recordMediaUpload = async (file: UploadedFile | null | undefined, actor: MediaActor = {}): Promise<RecordedMedia> => {
  if (!file) {
    throw new AppError(400, "No file uploaded (expected multipart field 'file')");
  }
  const url = `${PUBLIC_UPLOADS_URL}/cms/${file.filename}`;

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value also records null */
  const row = await auditService.logAction({
    tenantId: actor.tenantId || null,
    ...auditEntryActor({
      userId: actor.userId || null,
      apiKeyId: actor.apiKeyId || null,
      ipAddress: actor.ipAddress || null,
      userAgent: actor.userAgent || null,
    }),
    action: "CREATE",
    resourceType: "ContentMedia",
    resourceId: null,
    changes: {
      url,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      public: true,
      ...actorChanges(actor),
    },
  });
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  if (!row) {
    // P8-01: the image is in platform storage (file.path is its key), so it is
    // removed through deleteUpload — from storage and from the legacy folder.
    await deleteUpload(file.filename, PUBLIC_UPLOAD_FOLDERS.CMS).catch(() => {
      // as built: a failed removal is ignored; the refusal below is what matters
    });
    throw new AppError(500, "The upload could not be recorded in the audit log, so it was not published");
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a JavaScript caller's size is converted, whatever its type
  return { url, fileName: file.filename, mimeType: file.mimetype, size: Number(file.size) };
};

export = { recordMediaUpload };
