/**
 * Types for `src/services/attachment.service.js`, which is still JavaScript
 * (P9-14, ADR-087 Amendment 13; the `config/index.d.ts` precedent). It emits
 * nothing and is never copied into `dist/`. It declares exactly what the module
 * exports (`exports.x = ...`, fourteen keys); `tests/guards/declarationDrift`
 * holds it to the module. It is deleted when attachment.service.js converts
 * (whoever converts it keeps these types as the floor).
 *
 * Members a converted TypeScript module calls are typed from the code
 * (`softDeleteForResource` and `restoreForResource`, for calibrationDevices and
 * certificate). The others are `(...args: never[]) => unknown`: callable only
 * once someone types them.
 */
import type { Transaction } from "sequelize";

/** Not yet typed: the first TypeScript caller types it. */
type Untyped = (...args: never[]) => unknown;

/** Who acts, and from where (auditActor / auditPrincipal of the request). */
interface AttachmentActor {
  userId?: string | null;
  apiKeyId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

declare const attachmentService: {
  /**
   * D-22 (ADR-070): soft-delete the live attachments of a parent (or a page of
   * parents) in the parent delete's transaction, auditing each. Resolves with
   * the ids soft-deleted.
   */
  softDeleteForResource(
    tenantId: string,
    modelName: string,
    resourceId: string | string[],
    options: { transaction: Transaction; actor?: AttachmentActor; via?: { type: string; id: string } },
  ): Promise<string[]>;
  /**
   * A-133: restore exactly the attachments a parent's delete took with it, in
   * the parent restore's transaction. Resolves with the ids restored.
   */
  restoreForResource(
    tenantId: string,
    modelName: string,
    resourceId: string,
    options: { transaction: Transaction; actor?: AttachmentActor },
  ): Promise<string[]>;
  listOrphans: Untyped;
  LINKABLE_RESOURCES: Readonly<Record<string, string>>;
  LIVE_PARENTS: Readonly<Record<string, unknown>>;
  createAttachment: Untyped;
  listAttachments: Untyped;
  getAttachment: Untyped;
  getDownload: Untyped;
  deleteAttachment: Untyped;
  generateSignedUrl: Untyped;
  getSignedDownload: Untyped;
  _verifySignedToken: Untyped;
  resolveAbsPath: Untyped;
};

export = attachmentService;
