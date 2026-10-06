/**
 * The purge of finished webhook deliveries (ADR-070; the open item of
 * ADR-064 decision 4).
 *
 * `webhook_deliveries` is the delivery queue AND the tenant's delivery log
 * (ADR-054): one row per webhook per event, forever. Nothing removed a row, so
 * the table grew with every event of every tenant. This removes the FINISHED
 * ones — `success` (delivered) and `exhausted` (the dead letter) — once they
 * are older than the retention window. A `pending` or `failed` row is live
 * queue state and is never touched, however old.
 *
 *  - WINDOW: `WEBHOOK_DELIVERY_RETENTION_DAYS`, default 30, never below 7.
 *    Age is `updated_at`: a finished row is last written when it finishes.
 *  - BOUNDED: at most `WEBHOOK_DELIVERY_PURGE_BATCH` rows (1,000) per
 *    statement and `WEBHOOK_DELIVERY_PURGE_MAX_ROWS` (50,000) per run; a
 *    backlog larger than that is finished by the following runs, and the run
 *    says it stopped early.
 *  - PER TENANT, in the tenant's context (runForTenant, ADR-060): the hooks
 *    confine every statement to that tenant besides the explicit predicate.
 *  - AUDITED: each batch's DELETE and its audit row (actor
 *    `system:webhook-delivery-purge`, ADR-051 Q-13) commit together, in the
 *    tenant's own trail — how many rows, of which status, older than when.
 *
 * Run daily by middlewares/webhookDeliveryPurgeScheduler.middleware.js, under
 * the one scheduler switch (SCHEDULERS_ENABLED, ADR-060).
 *
 * P9-18 (ADR-087, Stage C leaves): converted from
 * webhookDeliveryPurge.service.js with no behaviour change. `export =` keeps the
 * exact object `require()` returned (the same keys, in the same order). The two
 * models, `db`, `runForTenant` and `SYSTEM_ACTORS` are captured once at load,
 * as the `.js` destructured them; `auditService` is the module object. The
 * environment is read through src/config/env (P9-06), at call time.
 */
import { Op, type Transaction } from "sequelize";
import models from "../models";
import { db as loadedDb } from "../config";
import auditService from "./audit.service";
import { runForTenant as loadedRunForTenant } from "../utils/jobContext.util";
import { SYSTEM_ACTORS as LOADED_SYSTEM_ACTORS } from "../constants/systemActors";
import { env } from "../config/env";
import type { TenantId } from "../types/ids";

const { Tenant, WebhookDelivery } = models;
const db = loadedDb;
const runForTenant = loadedRunForTenant;
const SYSTEM_ACTORS = LOADED_SYSTEM_ACTORS;

/** What one purge run did. */
interface PurgeRun {
  tenants: number;
  deleted: number;
  retentionDays: number;
  cutoff: string;
  stoppedEarly: boolean;
}

const FINISHED_STATUSES = Object.freeze(["success", "exhausted"] as const);
const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 7;
const DEFAULT_BATCH = 1000;
const DEFAULT_MAX_ROWS = 50000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A positive integer from the environment, or the fallback.
 * @param name - the variable
 * @param fallback - the value when it is unset or not a positive integer
 */
const positiveInt = (name: string, fallback: number): number => {
  const n = Math.floor(Number(env(name)));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** The retention window in days: the variable, else 30, never below 7. */
const retentionDays = (): number =>
  Math.max(positiveInt("WEBHOOK_DELIVERY_RETENTION_DAYS", DEFAULT_RETENTION_DAYS), MIN_RETENTION_DAYS);

/**
 * Purge one tenant's finished deliveries older than `cutoff`, a batch per
 * transaction, until none is left or `budget` rows are gone.
 *
 * @param tenantId - the tenant being purged
 * @param cutoff - rows last written before this go
 * @param days - the window, recorded on the audit row
 * @param batch - rows per statement
 * @param budget - rows this tenant may still remove in this run
 * @returns rows deleted
 */
const purgeTenant = async (tenantId: TenantId, cutoff: Date, days: number, batch: number, budget: number): Promise<number> => {
  let deleted = 0;
  while (deleted < budget) {
    const removed = await db.transaction(async (transaction: Transaction): Promise<number> => {
      const rows = await WebhookDelivery.findAll({
        where: { tenantId, status: FINISHED_STATUSES, updatedAt: { [Op.lt]: cutoff } },
        attributes: ["id", "status"],
        order: [["updatedAt", "ASC"], ["id", "ASC"]],
        limit: Math.min(batch, budget - deleted),
        transaction,
      });
      if (rows.length === 0) {
        return 0;
      }
      const byStatus: Record<string, number> = {};
      for (const row of rows) {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `|| 0`
        byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      }
      // The status is re-checked by the DELETE itself: only a finished row
      // is ever removed, whatever happened since it was read.
      const count = await WebhookDelivery.destroy({
        where: { id: rows.map((row) => row.id), tenantId, status: FINISHED_STATUSES },
        transaction,
      });
      await auditService.logAction(
        {
          tenantId,
          systemActor: SYSTEM_ACTORS.WEBHOOK_DELIVERY_PURGE,
          action: "DELETE",
          resourceType: "WebhookDelivery",
          resourceId: null,
          changes: {
            operation: "purge",
            deleted: count,
            byStatus,
            olderThan: cutoff.toISOString(),
            retentionDays: days,
          },
        },
        { transaction },
      );
      return count;
    });
    if (removed === 0) {
      break;
    }
    deleted += removed;
  }
  return deleted;
};

/**
 * One purge run over every tenant, soft-deleted tenants included (their
 * deliveries remain until the tenant row itself is purged).
 *
 * @param options - `now`, the run's clock
 */
const purgeFinishedDeliveries = async ({ now = new Date() }: { now?: Date } = {}): Promise<PurgeRun> => {
  const days = retentionDays();
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const batch = positiveInt("WEBHOOK_DELIVERY_PURGE_BATCH", DEFAULT_BATCH);
  const maxRows = positiveInt("WEBHOOK_DELIVERY_PURGE_MAX_ROWS", DEFAULT_MAX_ROWS);

  // `tenants` carries no tenant column: listing them needs no opt-out.
  const tenants = await Tenant.findAll({ attributes: ["id"], order: [["id", "ASC"]], paranoid: false });

  let deleted = 0;
  for (const { id: tenantId } of tenants) {
    if (deleted >= maxRows) {
      break;
    }
    deleted += await runForTenant(tenantId, () => purgeTenant(tenantId, cutoff, days, batch, maxRows - deleted));
  }

  return {
    tenants: tenants.length,
    deleted,
    retentionDays: days,
    cutoff: cutoff.toISOString(),
    stoppedEarly: deleted >= maxRows,
  };
};

export = {
  purgeFinishedDeliveries,
  retentionDays,
  FINISHED_STATUSES,
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
};
