/**
 * Types for `src/services/webhook.service.js`, which is still JavaScript
 * (P9-15, ADR-087 Amendment 13; the `config/index.d.ts` precedent). It emits
 * nothing and is never copied into `dist/`. It declares exactly what the module
 * exports (`exports.x = ...`, eighteen keys); `tests/guards/declarationDrift`
 * holds it to the module. It is deleted when webhook.service.js converts.
 *
 * Members a converted TypeScript module calls are typed from the code
 * (`emitAfterCommit`, for stock.service; `emitEvent`, for calibrationScheduler.service). The others are
 * `(...args: never[]) => unknown`: callable only once someone types them, which
 * is the point — the first TypeScript caller writes the type.
 */
import type { Transaction } from "sequelize";

/** Not yet typed: the first TypeScript caller types it. */
type Untyped = (...args: never[]) => unknown;

declare const webhookService: {
  createWebhook: Untyped;
  listWebhooks: Untyped;
  getWebhook: Untyped;
  updateWebhook: Untyped;
  rotateSecret: Untyped;
  deleteWebhook: Untyped;
  listDeliveries: Untyped;
  dispatchDue: Untyped;
  /**
   * Fan a domain event out to the tenant's subscribed webhooks (best-effort:
   * it never throws; a failure resolves with `{ matched: 0, error }`). Typed for
   * calibrationScheduler.service.
   */
  emitEvent(
    tenantId: string,
    event: string,
    payload?: Record<string, unknown>,
  ): Promise<{ matched: number; deferred?: number; error?: string }>;
  /**
   * Announce a domain event once, and only if `transaction` commits (A-11):
   * with a transaction the emit runs from its afterCommit; with none it emits
   * now. It never throws and never delays the caller.
   */
  emitAfterCommit(
    transaction: Transaction | null | undefined,
    tenantId: string,
    event: string,
    payload: Record<string, unknown>,
  ): void;
  testWebhook: Untyped;
  _sign: Untyped;
  _backoffMs: Untyped;
  _claim: Untyped;
  _dispatchDelivery: Untyped;
  _config: Readonly<Record<string, number>>;
  _emitInFlight: Untyped;
  _positiveInt: Untyped;
};

export = webhookService;
