/**
 * Operational alerts (P7-02).
 *
 * An alert here is something an operator must act on: a scheduled job that
 * failed, a job that did not run in its window, a batch job stuck in
 * PROCESSING. It goes to three sinks, in this order:
 *
 *  1. the log, ALWAYS, at `error` (or `warn` for a recovery). Production logs
 *     JSON to stdout (A-14), so this is the line a log aggregator matches on:
 *     every alert line carries `alert.key` and `alert.severity`. The log line
 *     is the alert of record — the other two sinks are best-effort.
 *  2. ALERT_WEBHOOK_URL, when set: one POST of
 *     `{ "text": "...", "alert": {...} }`. The `text` field is what Slack and
 *     Mattermost incoming webhooks render; Teams, Alertmanager-style receivers
 *     and custom endpoints can read the structured `alert` object.
 *  3. ALERT_EMAIL_TO, when set: a plain-text email through the application's
 *     own SMTP transport (email.service).
 *
 * A sink that fails is logged at `error` and never throws into the job that
 * raised the alert: a broken webhook must not turn a failed backup into a
 * crashed process.
 *
 * Every alert says WHAT IT MEANS and WHAT TO DO (Phase 7 DoD): "Retention
 * purge failed: data past its window was NOT purged" is actionable, "Scheduler
 * failed" trains people to ignore alerts.
 */
const { logger } = require("../middlewares/activityLog.middleware");

/** Longest a webhook POST may take before it is abandoned. */
const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000;

const SEVERITY = Object.freeze({
  CRITICAL: "critical",
  WARNING: "warning",
  RESOLVED: "resolved",
});

const webhookUrl = () => String(process.env.ALERT_WEBHOOK_URL || "").trim();
const emailTo = () => String(process.env.ALERT_EMAIL_TO || "").trim();

const webhookTimeoutMs = () => {
  const n = Number.parseInt(process.env.ALERT_WEBHOOK_TIMEOUT_MS, 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_WEBHOOK_TIMEOUT_MS;
};

/**
 * The human-readable form of an alert, shared by the webhook and the email.
 * @param {{severity: string, title: string, meaning: string, action: string, detail?: string}} alert
 * @returns {string}
 */
const formatText = (alert) => {
  const lines = [
    `[${alert.severity.toUpperCase()}] ${alert.title}`,
    alert.meaning,
    `What to do: ${alert.action}`,
  ];
  if (alert.detail) {
    lines.push(`Detail: ${alert.detail}`);
  }
  return lines.join("\n");
};

const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * POST the alert to ALERT_WEBHOOK_URL.
 * @param {object} alert
 * @returns {Promise<"sent"|"not-configured">}
 */
async function postWebhook(alert) {
  const url = webhookUrl();
  if (!url) {
    return "not-configured";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), webhookTimeoutMs());
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: formatText(alert), alert }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`webhook answered HTTP ${response.status}`);
    }
    return "sent";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Email the alert to ALERT_EMAIL_TO (comma-separated addresses allowed).
 * @param {object} alert
 * @returns {Promise<"sent"|"not-configured">}
 */
async function sendAlertEmail(alert) {
  const to = emailTo();
  if (!to) {
    return "not-configured";
  }
  const { sendEmail } = require("./email.service");
  await sendEmail({
    to,
    subject: `[Callibrator ${alert.severity}] ${alert.title}`,
    html: `<pre>${escapeHtml(formatText(alert))}</pre>`,
  });
  return "sent";
}

const SINKS = Object.freeze([
  ["webhook", postWebhook],
  ["email", sendAlertEmail],
]);

/**
 * Raise an operational alert. Never rejects.
 *
 * @param {object} input
 * @param {string} input.key       stable identifier, e.g. `job.retention-sweep.failed`
 * @param {string} input.severity  one of SEVERITY
 * @param {string} input.title     one line, names the thing that broke
 * @param {string} input.meaning   what is now true that the operator would not assume
 * @param {string} input.action    what to do about it
 * @param {string} [input.detail]  the error or the counts
 * @param {object} [input.context] structured fields for the log line
 * @returns {Promise<{webhook: string, email: string}>} what each sink did
 */
async function raiseAlert(input) {
  const alert = {
    key: input.key,
    severity: input.severity,
    title: input.title,
    meaning: input.meaning,
    action: input.action,
    detail: input.detail || null,
    context: input.context || {},
    raisedAt: new Date().toISOString(),
  };

  const level = alert.severity === SEVERITY.RESOLVED ? "warn" : "error";
  logger[level](`ALERT [${alert.severity}] ${alert.title}: ${alert.meaning}`, { alert });

  const results = {};
  for (const [name, sink] of SINKS) {
    try {
      results[name] = await sink(alert);
    } catch (err) {
      results[name] = "failed";
      logger.error(`Alert sink "${name}" failed for ${alert.key}: ${err.message}`, {
        alertKey: alert.key,
        sink: name,
      });
    }
  }
  return results;
}

module.exports = {
  SEVERITY,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  raiseAlert,
  formatText,
  postWebhook,
  sendAlertEmail,
};
