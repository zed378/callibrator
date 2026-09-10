// src/services/notificationChannels.service.js
//
// Channel dispatcher for notifications. The realtime (socket.io) push is handled
// inline by notification.service.emitNotification; this dispatcher fans a
// notification out to the additional channels (email via the RabbitMQ queue).
// Every channel is best-effort and isolated so one failing channel never blocks
// the others or the notification itself.

const { queueNotificationEmail } = require("./emailQueue.service");
const { logger } = require("../middlewares/activityLog.middleware");

// Channels a notification defaults to when none are specified. Realtime only,
// which preserves the historical behaviour (socket push, no email/SMS).
const DEFAULT_CHANNELS = ["realtime"];

/**
 * Dispatch a notification across non-realtime channels.
 * @param {Object} notification - { title, message, actionUrl, ... }
 * @param {Object} opts
 * @param {string[]} opts.channels - e.g. ["realtime","email"]
 * @param {string} [opts.recipientEmail]
 * @param {string} [opts.recipientName]
 * @returns {Promise<Object>} per-channel outcome
 */
exports.dispatch = async (
  notification,
  { channels = DEFAULT_CHANNELS, recipientEmail, recipientName } = {},
) => {
  const results = {};

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
      results.email = `error: ${err.message}`;
      logger.error(`Notification email dispatch failed: ${err.message}`);
    }
  }

  return results;
};

exports.DEFAULT_CHANNELS = DEFAULT_CHANNELS;
