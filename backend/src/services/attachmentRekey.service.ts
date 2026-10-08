/**
 * P21-09d — re-keying the files of a moved device (spec MEMORY/specs/P19-04-client-facilities.md
 * § 9.3 – § 9.4).
 *
 * A device move (services/deviceMove.service) changes `client_facility_id` on the device, every
 * child and every attachment in ONE transaction, and flags each attachment whose key's facility
 * segment no longer matches (`rekey_pending = true`). Bytes are not moved inside that transaction
 * (an object store is not transactional). This job does it afterwards, per file, copy-then-switch
 * (the storage migration tool's order, P8-01):
 *
 *  1. copy the object to `t/<tenant>/f/<facility>/attachments/<name>` (the row's CURRENT facility);
 *  2. in one transaction: switch `storage_key` and clear the flag — only if the row still holds the
 *     old key and the flag (a concurrent run or a second move is not overwritten) — with its audit
 *     row (system actor `system:attachment-rekey`);
 *  3. after commit, delete the old object (best effort: a leftover is unreachable, never served).
 *
 * Re-runnable: a failed file keeps its flag, and the integrity check (attachment.service) accepts a
 * flagged row, so nothing is unreadable meanwhile; RC-F3 (P25) accepts flagged rows too. A row
 * without a storage key (a legacy file on disk) has no key to move: its flag is cleared.
 *
 * Named exports only.
 */
import path from "path";
import models from "../models";
import { db } from "../config";
import storage from "./storage";
import storedFile from "./storedFile.service";
import auditService from "./audit.service";
import { runForTenant } from "../utils/jobContext.util";
import { SYSTEM_ACTORS } from "../constants/systemActors";
import { logger } from "../middlewares/activityLog.middleware";

/** Files re-keyed per run of one tenant (the next run continues). */
export const REKEY_BATCH = 200;

/** What one run did. */
export interface RekeySummary {
  readonly tenantId: string;
  readonly examined: number;
  readonly rekeyed: number;
  readonly cleared: number;
  readonly failed: number;
}

interface PendingRow {
  id: string;
  tenantId: string;
  storageKey: string | null;
  clientFacilityId: string | null;
  mimeType: string | null;
}

/** Switch the key and clear the flag, with its audit row, if the row is still as read. */
const switchKey = async (row: PendingRow, newKey: string | null): Promise<boolean> =>
  db.transaction(async (transaction) => {
    const values = newKey === null ? { rekeyPending: false } : { storageKey: newKey, rekeyPending: false };
    const [count] = await models.Attachment.update(
      values,
      { where: { id: row.id, tenantId: row.tenantId, rekeyPending: true, storageKey: row.storageKey }, transaction },
    );
    if (count !== 1) {
      return false;
    }
    await auditService.logAction(
      {
        tenantId: row.tenantId,
        systemActor: SYSTEM_ACTORS.ATTACHMENT_REKEY,
        action: "UPDATE",
        resourceType: "Attachment",
        resourceId: row.id,
        clientFacilityId: row.clientFacilityId,
        changes: { operation: "REKEY_ATTACHMENT", from: row.storageKey, to: newKey ?? row.storageKey },
      },
      { transaction },
    );
    return true;
  });

/**
 * Re-key up to REKEY_BATCH flagged files of one tenant, in that tenant's context.
 *
 * @param tenantId - the tenant whose flagged files to move
 * @returns what was examined, moved, cleared without a move, and failed
 */
export const rekeyTenantAttachments = async (tenantId: string): Promise<RekeySummary> =>
  runForTenant(tenantId, async () => {
    const rows = (await models.Attachment.findAll({
      where: { tenantId, rekeyPending: true },
      attributes: ["id", "tenantId", "storageKey", "clientFacilityId", "mimeType"],
      order: [["id", "ASC"]],
      limit: REKEY_BATCH,
    })) as unknown as PendingRow[];
    let rekeyed = 0;
    let cleared = 0;
    let failed = 0;
    const scoped = await storage.getTenantStorage(tenantId);
    for (const row of rows) {
      try {
        if (!row.storageKey || !row.clientFacilityId) {
          cleared += (await switchKey(row, null)) ? 1 : 0;
          continue;
        }
        const newKey = scoped.buildKey({ domain: "attachments", name: path.posix.basename(row.storageKey), clientFacilityId: row.clientFacilityId });
        if (newKey === row.storageKey) {
          cleared += (await switchKey(row, null)) ? 1 : 0;
          continue;
        }
        const bytes = await storedFile.readObject(scoped, row.storageKey);
        await scoped.put(newKey, bytes, { contentType: row.mimeType });
        if (await switchKey(row, newKey)) {
          rekeyed += 1;
          await storedFile.removeObject(scoped, row.storageKey).catch((err: unknown) => {
            logger.warn("Attachment re-key: the old object was not removed", { attachmentId: row.id, error: String(err) });
          });
        }
      } catch (err) {
        failed += 1;
        logger.error("Attachment re-key failed; the row keeps its flag for the next run", { attachmentId: row.id, tenantId, error: String(err) });
      }
    }
    return { tenantId, examined: rows.length, rekeyed, cleared, failed };
  });

/**
 * Start a re-key run for `tenantId` after the current request (a device move enqueues it after
 * its commit). Never throws; a failure is logged and the flags stay for the next run.
 */
export const enqueueRekey = (tenantId: string): void => {
  setImmediate(() => {
    rekeyTenantAttachments(tenantId).catch((err: unknown) => {
      logger.error("Attachment re-key run failed", { tenantId, error: String(err) });
    });
  });
};
