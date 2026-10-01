/**
 * Types for `src/services/emailQueue.service.js`, which is still JavaScript
 * (P9-12, ADR-087 Amendment 13; the `config/index.d.ts` precedent). It emits
 * nothing and is never copied into `dist/`. It declares exactly what the
 * module exports (`module.exports = {...}`); `tests/guards/declarationDrift`
 * holds it to the module. It is deleted when the module converts.
 *
 * Members a converted TypeScript module calls are typed from the code; the
 * others are `(...args: never[]) => unknown` until their first TypeScript caller.
 */

/** Not yet typed: the first TypeScript caller types it. */
type Untyped = (...args: never[]) => unknown;

/** Who an e-mail goes to, as the templates greet them. */
interface Recipient {
  email: string;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
}

declare const emailQueue: {
  processEmailQueue: Untyped;
  /** Queue the account-activation e-mail; resolves whether it was queued (or sent inline). */
  queueActivationEmail: (params: Recipient & { activationLink: string }) => Promise<boolean>;
  /** Queue a one-time-code e-mail; resolves whether it was queued (or sent inline). */
  queueOtpEmail: (params: Recipient & { otp: string }) => Promise<boolean>;
  /** Queue a generic notification e-mail (title, text, one link); resolves whether it was queued (or sent inline). */
  queueNotificationEmail: (params: {
    email: string;
    firstName?: string | null | undefined;
    title: string;
    message: string;
    actionUrl?: string | null | undefined;
  }) => Promise<boolean>;
  getQueueStats: Untyped;
  clearQueue: Untyped;
  closeRabbitMQ: Untyped;
  processJob: Untyped;
  retryQueueOf: Untyped;
  retryDelayMs: Untyped;
  EMAIL_QUEUE: string;
  EMAIL_DLQ: string;
};

export = emailQueue;
