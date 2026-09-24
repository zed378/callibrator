/**
 * P7-02 — alert.service: every alert is logged (the alert of record), and
 * the optional webhook and email sinks are best-effort: a failing sink is
 * logged and never throws into the job that raised the alert.
 */
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../services/email.service", () => ({ sendEmail: jest.fn() }));

const http = require("http");
const { logger } = require("../../middlewares/activityLog.middleware");
const { sendEmail } = require("../../services/email.service");
const alerts = require("../../services/alert.service");

const ALERT = {
  key: "job.retention-sweep.failed",
  severity: alerts.SEVERITY.CRITICAL,
  title: "Data-retention purge FAILED",
  meaning: "Data past its retention window was NOT purged.",
  action: "Fix it and run the purge by hand.",
  detail: 'column "tenantId" does not exist',
};

describe("P7-02 alert.service", () => {
  const saved = { ...process.env };
  let server;
  let received;
  let status;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        received.push({ headers: req.headers, body: JSON.parse(body) });
        if (status === "hang") {
          return; // never answers: the timeout must abandon it
        }
        res.writeHead(status).end();
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received = [];
    status = 204;
    delete process.env.ALERT_WEBHOOK_URL;
    delete process.env.ALERT_EMAIL_TO;
    delete process.env.ALERT_WEBHOOK_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env = saved;
  });

  const url = () => `http://127.0.0.1:${server.address().port}/hook`;

  it("logs every alert at error, carrying a matchable alert.key, even with no sink configured", async () => {
    const result = await alerts.raiseAlert(ALERT);

    expect(result).toEqual({ webhook: "not-configured", email: "not-configured" });
    expect(logger.error).toHaveBeenCalledWith(
      "ALERT [critical] Data-retention purge FAILED: Data past its retention window was NOT purged.",
      { alert: expect.objectContaining({ key: ALERT.key, severity: "critical", detail: ALERT.detail }) },
    );
  });

  it("logs a recovery at warn, not error", async () => {
    await alerts.raiseAlert({ ...ALERT, severity: alerts.SEVERITY.RESOLVED, detail: undefined });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("ALERT [resolved]"), {
      alert: expect.objectContaining({ detail: null, context: {} }),
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("POSTs a Slack-compatible text and the structured alert to ALERT_WEBHOOK_URL", async () => {
    process.env.ALERT_WEBHOOK_URL = url();
    const result = await alerts.raiseAlert({ ...ALERT, context: { job: "retention-sweep" } });

    expect(result.webhook).toBe("sent");
    expect(received).toHaveLength(1);
    expect(received[0].headers["content-type"]).toBe("application/json");
    expect(received[0].body.text).toBe(
      "[CRITICAL] Data-retention purge FAILED\nData past its retention window was NOT purged.\n" +
        'What to do: Fix it and run the purge by hand.\nDetail: column "tenantId" does not exist',
    );
    expect(received[0].body.alert).toEqual(expect.objectContaining({ key: ALERT.key, context: { job: "retention-sweep" } }));
  });

  it("a webhook answering non-2xx is a failed sink, logged, and does not throw", async () => {
    process.env.ALERT_WEBHOOK_URL = url();
    status = 500;
    await expect(alerts.raiseAlert(ALERT)).resolves.toEqual({ webhook: "failed", email: "not-configured" });
    expect(logger.error).toHaveBeenCalledWith(
      `Alert sink "webhook" failed for ${ALERT.key}: webhook answered HTTP 500`,
      { alertKey: ALERT.key, sink: "webhook" },
    );
  });

  it("a hanging webhook is abandoned after ALERT_WEBHOOK_TIMEOUT_MS", async () => {
    process.env.ALERT_WEBHOOK_URL = url();
    process.env.ALERT_WEBHOOK_TIMEOUT_MS = "50";
    status = "hang";
    const result = await alerts.raiseAlert(ALERT);
    expect(result.webhook).toBe("failed");
  });

  it("emails ALERT_EMAIL_TO with the severity in the subject and the text escaped", async () => {
    process.env.ALERT_EMAIL_TO = "oncall@example.org";
    sendEmail.mockResolvedValue({});
    const result = await alerts.raiseAlert({ ...ALERT, detail: "<script>&" });

    expect(result.email).toBe("sent");
    expect(sendEmail).toHaveBeenCalledWith({
      to: "oncall@example.org",
      subject: "[Callibrator critical] Data-retention purge FAILED",
      html: expect.stringContaining("Detail: &lt;script&gt;&amp;"),
    });
  });

  it("a failing email sink is logged and does not throw", async () => {
    process.env.ALERT_EMAIL_TO = "oncall@example.org";
    sendEmail.mockRejectedValue(new Error("SMTP down"));
    await expect(alerts.raiseAlert(ALERT)).resolves.toEqual({ webhook: "not-configured", email: "failed" });
  });

  it("an invalid timeout falls back to the default, and the webhook still sends", async () => {
    process.env.ALERT_WEBHOOK_URL = url();
    process.env.ALERT_WEBHOOK_TIMEOUT_MS = "zero";
    expect(alerts.DEFAULT_WEBHOOK_TIMEOUT_MS).toBe(5000);
    await expect(alerts.postWebhook({ ...ALERT, detail: null })).resolves.toBe("sent");
    expect(received[0].body.text).not.toContain("Detail:");
  });
});
