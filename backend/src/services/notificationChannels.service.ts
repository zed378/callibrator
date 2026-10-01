// src/services/notificationChannels.service.ts
//
// Channel dispatcher for notifications. The realtime (socket.io) push is handled
// inline by notification.service.emitNotification; this dispatcher fans a
// notification out to the additional channels (email via the RabbitMQ queue).
// Every channel is best-effort and isolated so one failing channel never blocks
// the others or the notification itself.
//
// P9-18 (ADR-087, Stage C leaves): converted from notificationChannels.service.js
// with no behaviour change. `export =` keeps the exact object `require()`
// returned (the same keys, in the same order). `queueNotificationEmail` and the
// logger are captured once at load, as the `.js` destructured them.

import emailQueue from "./emailQueue.service";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";

const { queueNotificationEmail } = emailQueue;
const logger = loadedLogger;

/** The notification fields the email channel carries. */
interface DispatchedNotification {
  title: string;
  message: string;
  actionUrl?: string | null;
}

interface DispatchOptions {
  channels?: readonly string[];
  recipientEmail?: string | null;
  recipientName?: string | null;
}

// Channels a notification defaults to when none are specified. Realtime only,
// which preserves the historical behaviour (socket push, no email/SMS).
const DEFAULT_CHANNELS = ["realtime"];

/**
 * Dispatch a notification across non-realtime channels.
 * @returns per-channel outcome
 */
const dispatch = async (
  notification: DispatchedNotification,
  { channels = DEFAULT_CHANNELS, recipientEmail, recipientName }: DispatchOptions = {},
): Promise<{ email?: string }> => {
  const results: { email?: string } = {};

  if (channels.includes("email") && recipientEmail) {
    try {
      await queueNotificationEmail({
        email: recipientEmail,
        firstName: recipientName,
        title: notification.title,
        message: notification.message,
        actionUrl: notification.actionUrl,
      });
      results.email = "queued";
    } catch (err) {
      results.email = `error: ${(err as Error).message}`;
      logger.error(`Notification email dispatch failed: ${(err as Error).message}`);
    }
  }

  return results;
};

export = { dispatch, DEFAULT_CHANNELS };
