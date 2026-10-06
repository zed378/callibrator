/**
 * GDPR/CCPA Compliance Controller
 *
 * Handles data subject requests and privacy compliance endpoints.
 *
 * P9-18 (ADR-087): converted from gdpr.controller.js, behaviour unchanged.
 * The bodies arrive validated (`validate(schema)` on the writes) and are read
 * as the JavaScript read them; the casts are typing only. The service is read
 * through its module object at call time; everything else is captured at load,
 * as the `.js` destructured it. `export =` keeps the exact object `require()`
 * returned (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import gdprService from "../services/gdpr.service";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { success as loadedSuccess } from "../utils/response.util";
import { sendStorageObject } from "../utils/fileResponse.util";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { principalHasMenuPermission as loadedPrincipalHasMenuPermission } from "../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS as LOADED_MENU_SLUGS } from "../constants/roleConstants";
import type { TenantId, UserId } from "../types/ids";

const auditPrincipal = loadedAuditPrincipal;
const success = loadedSuccess;
const asyncHandler = loadedAsyncHandler;
const auditActor = loadedAuditActor;
const AppError = LoadedAppError;
const principalHasMenuPermission = loadedPrincipalHasMenuPermission;
const MENU_SLUGS = LOADED_MENU_SLUGS;

type Service = typeof gdprService;
/** The service method's N-th parameter (what the handler passes it). */
type Arg<K extends keyof Service, N extends number> = Service[K] extends (...args: infer A) => unknown ? A[N] : never;

/** The data subject and their tenant (read as the `.js` read them; null when absent). */
interface Subject {
  tenantId: TenantId;
  userId: UserId;
}

/**
 * Resolve the authenticated actor. tenantId comes from the auth-middleware
 * (req.tenantId, which honours SUPER_ADMIN overrides) and the subject is the
 * authenticated user's id (req.user.id — NOT req.user.userId, which is undefined).
 */
const actor = (req: Request): Subject => {
  const user = req.user as { tenantId?: TenantId; id?: UserId } | undefined;
  const subject = {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy value falls through to null
    tenantId: req.tenantId || user?.tenantId || null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
    userId: user?.id || null,
  };
  // As built: the service is called with null when either is missing (it answers that itself).
  return subject as Subject;
};

/**
 * Export all user data (GDPR Article 20 - Data Portability)
 */
const exportUserData = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, userId } = actor(req);
  // A-364: the request's actor, for the export's audit row.
  const result = await gdprService.exportUserData(tenantId, userId, auditPrincipal(req));
  return success(res, result, "Data export initiated");
});

/**
 * Download the caller's own export archive (A-360, ADR-114): the ZIP that
 * POST /export wrote, as an attachment. Another subject's, another tenant's,
 * an expired or an unknown export is the same 404 (the service decides, and
 * writes the EXPORT audit row before anything is sent).
 */
const downloadExport = asyncHandler(async (req: Request, res: Response) => {
  const { exportId } = req.params as { exportId: string };
  const { tenantId, userId } = actor(req);
  const { filePath, object, filename, fileSize } = await gdprService.getExportDownload(
    tenantId,
    userId,
    exportId,
    auditPrincipal(req),
  );
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Length", String(fileSize));
  // Personal data: never kept by a shared cache or the browser's.
  res.setHeader("Cache-Control", "no-store");
  if (object) {
    // P8-01 (ADR-086 Amendment 1): an archive in the tenant's storage, sent
    // with the headers res.download gives a file (the saved-as name; the
    // no-store above is kept, as send keeps a Cache-Control already set).
    await sendStorageObject(req, res, object, {
      contentType: "application/zip",
      fileName: filename,
      applyHeaders: (r) => {
        r.attachment(filename);
      },
    });
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- the handler resolves to what res.download returns, as tenantBackup.controller#downloadBackup does
  return res.download(filePath as string, filename);
});

/**
 * Request data erasure (GDPR Article 17 - Right to Erasure)
 * Recorded as a DSAR of type "erasure" for the compliance team to action.
 */
const requestErasure = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, userId } = actor(req);
  const { reason } = req.body as { reason?: unknown };
  const request = await gdprService.createDsar(
    tenantId,
    userId,
    "erasure",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty reason is stored as null
    { reason: reason || null },
    auditPrincipal(req),
  );
  return success(res, request, null, "Erasure request submitted", 201);
});

/**
 * Get erasure request status
 */
const getErasureStatus = asyncHandler(async (req: Request, res: Response) => {
  const { requestId } = req.params as { requestId: string };
  const { tenantId, userId } = actor(req);
  const status = await gdprService.getDsarStatus(tenantId, requestId);
  // A-252: the lookup is tenant-scoped only, so any member who held another
  // member's request id read that person's erasure request, and an unknown id
  // answered 200 with null. A data subject reads their OWN request; the
  // tenant's privacy officer (`gdpr` read) reads any in the tenant. Everything
  // else — unknown, another tenant's, another member's — is the same 404.
  const mayRead =
    status &&
    (status.userId === userId ||
      (await principalHasMenuPermission(req.user as Parameters<typeof principalHasMenuPermission>[0], MENU_SLUGS.GDPR, "read")));
  if (!mayRead) {
    throw new AppError(404, "Erasure request not found");
  }
  return success(res, status, "Erasure status retrieved");
});

/**
 * Update consent preferences
 */
const updateConsent = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, userId } = actor(req);
  const { categories, consent } = req.body as { categories?: unknown; consent?: unknown };
  const result = await gdprService.updateConsent(
    tenantId,
    userId,
    categories,
    consent,
    req.ip,
    auditPrincipal(req),
  );
  return success(res, result, "Consent preferences updated");
});

/**
 * Get consent history
 */
const getConsentHistory = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, userId } = actor(req);
  const history = await gdprService.getConsentHistory(tenantId, userId);
  return success(res, history, "Consent history retrieved");
});

/**
 * Get data processing activities (GDPR Article 30)
 */
const getProcessingActivities = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, userId } = actor(req);
  const activities = await gdprService.getProcessingActivities(
    tenantId,
    userId,
  );
  return success(res, activities, "Processing activities retrieved");
});

/**
 * Rectify personal data (GDPR Article 16)
 */
const rectifyData = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, userId } = actor(req);
  const { field, value, currentPassword, code, recoveryCode } = req.body as Record<string, unknown>;
  // A-153: the request's IP / user agent go on the audit row the service
  // writes inside its transaction.
  // A-214: an email change re-authenticates the caller; `signInMethod` (the
  // session's `amr`) tells the service whether an identity provider owns it.
  const reauth = {
    currentPassword,
    code,
    recoveryCode,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty method reads as null
    signInMethod: (req as Request & { signInMethod?: string | null }).signInMethod || null,
  };
  const result = await gdprService.rectifyData(
    tenantId,
    userId,
    field as string,
    value,
    auditActor(req) as Arg<"rectifyData", 4>,
    reauth as Arg<"rectifyData", 5>,
  );
  return success(res, result, "Data rectified");
});

/**
 * Restrict processing (GDPR Article 18)
 */
const restrictProcessing = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, userId } = actor(req);
  const { reason } = req.body as { reason?: unknown };
  const result = await gdprService.restrictProcessing(tenantId, userId, reason, auditPrincipal(req));
  return success(res, result, "Processing restricted");
});

const controller = {
  exportUserData,
  downloadExport,
  requestErasure,
  getErasureStatus,
  updateConsent,
  getConsentHistory,
  getProcessingActivities,
  rectifyData,
  restrictProcessing,
};

export = controller;
