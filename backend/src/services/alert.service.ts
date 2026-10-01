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
 *
 * P9-18 (ADR-087, Stage C leaves): converted from alert.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order). The logger is captured once at load, as
 * before; `email.service` is still required lazily inside `sendAlertEmail`,
 * because loading it reads the templates and builds the SMTP transport, and
 * this module must not do that at load. Environment reads go through
 * src/config/env (P9-06) at call time.
 */
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { env, envOr } from "../config/env";
import type EmailService from "./email.service";

const logger = loadedLogger;

/** An alert as `raiseAlert` receives it. */
interface AlertInput {
  key: string;
  severity: string;
  title: string;
  meaning: string;
  action: string;
  detail?: string | null;
  context?: Record<string, unknown> | null;
}

/** An alert as the sinks receive it. */
interface Alert {
  key: string;
  severity: string;
  title: string;
  meaning: string;
  action: string;
  detail?: string | null;
  context?: Record<string, unknown>;
  raisedAt?: string;
}

type SinkResult = "sent" | "not-configured";
type Sink = (alert: Alert) => Promise<SinkResult>;

/** Longest a webhook POST may take before it is abandoned. */
const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000;

const SEVERITY = Object.freeze({
  CRITICAL: "critical",
  WARNING: "warning",
  RESOLVED: "resolved",
});

const webhookUrl = (): string => envOr("ALERT_WEBHOOK_URL", "").trim();
const emailTo = (): string => envOr("ALERT_EMAIL_TO", "").trim();

const webhookTimeoutMs = (): number => {
  // parseInt applies ToString to its argument, so an unset variable parses "undefined" (NaN) as before.
  const n = Number.parseInt(String(env("ALERT_WEBHOOK_TIMEOUT_MS")), 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_WEBHOOK_TIMEOUT_MS;
};

/**
 * The human-readable form of an alert, shared by the webhook and the email.
 * @param {{severity: string, title: string, meaning: string, action: string, detail?: string}} alert
 * @returns {string}
 */
const formatText = (alert: Alert): string => {
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

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * POST the alert to ALERT_WEBHOOK_URL.
 * @param {object} alert
 * @returns {Promise<"sent"|"not-configured">}
 */
async function postWebhook(alert: Alert): Promise<SinkResult> {
  const url = webhookUrl();
  if (!url) {
    return "not-configured";
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, webhookTimeoutMs());
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: formatText(alert), alert }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`webhook answered HTTP ${String(response.status)}`);
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
async function sendAlertEmail(alert: Alert): Promise<SinkResult> {
  const to = emailTo();
  if (!to) {
    return "not-configured";
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded on first use, never at this module's load (see the file header)
  const { sendEmail } = require("./email.service") as typeof EmailService;
  await sendEmail({
    to,
    subject: `[Callibrator ${alert.severity}] ${alert.title}`,
    html: `<pre>${escapeHtml(formatText(alert))}</pre>`,
  });
  return "sent";
}

/**
 * ADR-082 — where alerts go, for the boot log. Names the webhook's HOST only:
 * a Slack or Teams incoming-webhook URL is itself a credential.
 * @returns {{routed: boolean, webhook: string, email: string}}
 */
function describeRouting(): { routed: boolean; webhook: string; email: string } {
  const url = webhookUrl();
  let webhook = "off";
  if (url) {
    try {
      webhook = new URL(url).host;
    } catch {
      webhook = "INVALID URL";
    }
  }
  const addresses = emailTo()
    .split(",")
    .filter((address) => address.trim());
  const email = addresses.length ? `${String(addresses.length)} address(es)` : "off";
  return { routed: Boolean(url || addresses.length), webhook, email };
}

const SINKS: readonly (readonly [string, Sink])[] = Object.freeze([
  ["webhook", postWebhook] as const,
  ["email", sendAlertEmail] as const,
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
async function raiseAlert(input: AlertInput): Promise<Record<string, string>> {
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty detail or context also falls back */
  const alert: Alert = {
    key: input.key,
    severity: input.severity,
    title: input.title,
    meaning: input.meaning,
    action: input.action,
    detail: input.detail || null,
    context: input.context || {},
    raisedAt: new Date().toISOString(),
  };
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  const level = alert.severity === SEVERITY.RESOLVED ? "warn" : "error";
  logger[level](`ALERT [${alert.severity}] ${alert.title}: ${alert.meaning}`, { alert });

  const results: Record<string, string> = {};
  for (const [name, sink] of SINKS) {
    try {
      results[name] = await sink(alert);
    } catch (err) {
      results[name] = "failed";
      logger.error(`Alert sink "${name}" failed for ${alert.key}: ${(err as Error).message}`, {
        alertKey: alert.key,
        sink: name,
      });
    }
  }
  return results;
}

export = {
  SEVERITY,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  raiseAlert,
  formatText,
  postWebhook,
  sendAlertEmail,
  describeRouting,
};
