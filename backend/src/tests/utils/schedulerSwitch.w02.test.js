/**
 * W-02 — every scheduler is covered by the "not the scheduler" switch, and
 * every scheduler variable the code reads is documented and disabled on an
 * API pod.
 *
 * Static checks over the source and the deployment files, so the NEXT
 * scheduler fails here instead of running on every replica:
 *
 *  1. every file in src/ that calls `cron.schedule(` reads its expression
 *     through `scheduleSetting(` — except the named, replica-safe exemption;
 *  2. every `*_SCHEDULER` variable the code reads is listed in both
 *     `.env.example` files;
 *  3. the Helm ConfigMap's `cron.enabled: false` branch sets
 *     SCHEDULERS_ENABLED "false" and disables every singleton variable.
 *
 * Item 3 is read from the template text, not from `helm template` output: no
 * helm binary was available. It proves what the branch says, not a render.
 */
const fs = require("fs");
const path = require("path");

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { scheduleSetting, schedulersEnabled, DISABLED } = require("../../utils/schedulerSwitch.util");
const { logger } = require("../../middlewares/activityLog.middleware");

const BACKEND = path.join(__dirname, "../../..");
const SRC = path.join(BACKEND, "src");
const REPO = path.join(BACKEND, "..");

/** Replica-safe schedulers, each with the reason it may run everywhere. */
const EXEMPT = {
  "middlewares/webhookDeliveryScheduler.middleware.js":
    "claims deliveries with FOR UPDATE SKIP LOCKED (ADR-054); the chart runs it on API pods",
};
const EXEMPT_VARIABLES = ["WEBHOOK_DISPATCH_SCHEDULER"];

const sourceFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "tests" ? [] : sourceFiles(full);
    }
    return entry.name.endsWith(".js") ? [full] : [];
  });

const files = sourceFiles(SRC).map((file) => ({
  rel: path.relative(SRC, file).split(path.sep).join("/"),
  text: fs.readFileSync(file, "utf8"),
}));

const schedulerVariables = [
  ...new Set(
    files.flatMap(({ text }) => [
      ...[...text.matchAll(/process\.env\.([A-Z_]+_SCHEDULER)\b/g)].map((m) => m[1]),
      ...[...text.matchAll(/scheduleSetting\(\s*"([A-Z_]+_SCHEDULER)"/g)].map((m) => m[1]),
    ]),
  ),
].sort();

describe("W-02 — scheduleSetting", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.clearAllMocks();
  });

  it("defaults to enabled and returns the job's own variable, or its default", () => {
    delete process.env.SCHEDULERS_ENABLED;
    delete process.env.X_SCHEDULER;
    expect(schedulersEnabled()).toBe(true);
    expect(scheduleSetting("X_SCHEDULER", "0 1 * * *")).toBe("0 1 * * *");
    process.env.X_SCHEDULER = "5 4 * * *";
    expect(scheduleSetting("X_SCHEDULER", "0 1 * * *")).toBe("5 4 * * *");
  });

  it.each(["false", "FALSE", " 0 ", "off", "no"])("SCHEDULERS_ENABLED=%j disables every job, whatever its own variable says", (value) => {
    process.env.SCHEDULERS_ENABLED = value;
    process.env.X_SCHEDULER = "5 4 * * *";
    expect(scheduleSetting("X_SCHEDULER", "0 1 * * *")).toBe(DISABLED);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("X_SCHEDULER ignored: SCHEDULERS_ENABLED=false"));
  });

  it("SCHEDULERS_ENABLED=true leaves the jobs on", () => {
    process.env.SCHEDULERS_ENABLED = "true";
    expect(scheduleSetting("X_SCHEDULER", "0 1 * * *")).toBe("0 1 * * *");
  });
});

describe("W-02 — no scheduler escapes the switch", () => {
  it("finds the schedulers it is checking (the scan is not vacuous)", () => {
    expect(files.filter(({ text }) => text.includes("cron.schedule(")).length).toBeGreaterThanOrEqual(8);
  });

  it("every cron.schedule call site reads its expression through scheduleSetting, or is a named exemption", () => {
    const escaping = files
      .filter(({ text }) => text.includes("cron.schedule("))
      .filter(({ rel, text }) => !text.includes("scheduleSetting(") && !EXEMPT[rel])
      .map(({ rel }) => rel);
    expect(escaping).toEqual([]);
  });

  it("no singleton scheduler reads its variable directly (bypassing the switch)", () => {
    const direct = files
      .filter(({ rel }) => !EXEMPT[rel])
      .flatMap(({ rel, text }) =>
        [...text.matchAll(/process\.env\.([A-Z_]+_SCHEDULER)\b/g)].map((m) => `${rel}: ${m[1]}`),
      );
    expect(direct).toEqual([]);
  });

  it("every scheduler variable the code reads is documented in both .env.example files", () => {
    expect(schedulerVariables.length).toBeGreaterThanOrEqual(8);
    for (const file of ["backend/.env.example", "deploy/compose/.env.example"]) {
      const text = fs.readFileSync(path.join(REPO, file), "utf8");
      const missing = [...schedulerVariables, "SCHEDULERS_ENABLED"].filter((name) => !text.includes(name));
      expect({ file, missing }).toEqual({ file, missing: [] });
    }
  });

  it("the ConfigMap's API-pod branch sets SCHEDULERS_ENABLED=false and disables every singleton scheduler", () => {
    const template = fs.readFileSync(
      path.join(REPO, "deploy/helm/callibrator/templates/configmap.yaml"),
      "utf8",
    );
    const start = template.indexOf("{{- if .Values.backend.cron.enabled }}");
    const elseAt = template.indexOf("{{- else }}", start);
    const end = template.indexOf("{{- end }}", elseAt);
    expect(start).toBeGreaterThan(-1);
    const apiBranch = template.slice(elseAt, end);

    expect(apiBranch).toMatch(/^\s*SCHEDULERS_ENABLED: "false"$/m);
    const notDisabled = schedulerVariables
      .filter((name) => !EXEMPT_VARIABLES.includes(name))
      .filter((name) => !new RegExp(`^\\s*${name}: "disabled"$`, "m").test(apiBranch));
    expect(notDisabled).toEqual([]);
  });
});

// The DoD asks for the RENDERED ConfigMap, not the template text. `helm` is
// not a dependency of the backend suite, so this runs where it is installed
// (it was, for the 2026-09-25 verification) and says it was skipped otherwise.
const helmAvailable = (() => {
  try {
    require("child_process").execFileSync("helm", ["version", "--short"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

(helmAvailable ? describe : describe.skip)("W-02 — the rendered chart (needs helm on PATH)", () => {
  const render = (...extra) =>
    require("child_process").execFileSync(
      "helm",
      [
        "template", "r", path.join(REPO, "deploy/helm/callibrator"),
        // The CI render's minimum values (.github/workflows/ci.yml).
        "--set", "backend.image.tag=ci", "--set", "frontend.image.tag=ci",
        "--set", "global.corsOrigin=https://ci.invalid", "--set", "backend.clamav.host=clamd",
        "--set", "secrets.certSigningSecret=x", "--set", "secrets.encryptKey=x",
        "--set", "secrets.attachmentUrlSecret=x", "--set", "secrets.kmsMasterKey=x",
        ...extra,
      ],
      { encoding: "utf8", timeout: 60000 },
    );
  const value = (manifest, name) => {
    const m = manifest.match(new RegExp(`^[ \\t]*${name}: "([^"]*)"\\r?$`, "m"));
    return m ? m[1] : undefined;
  };

  it("an API deployment (cron.enabled false, three replicas) renders NO enabled singleton scheduler", () => {
    const manifest = render("--set", "backend.cron.enabled=false", "--set", "backend.replicaCount=3");

    expect(value(manifest, "SCHEDULERS_ENABLED")).toBe("false");
    const enabled = schedulerVariables
      .filter((name) => !EXEMPT_VARIABLES.includes(name))
      .filter((name) => value(manifest, name) !== "disabled");
    expect(enabled).toEqual([]);
  });

  it("the scheduler deployment (cron.enabled true) does not switch them off", () => {
    const manifest = render();

    expect(value(manifest, "SCHEDULERS_ENABLED")).not.toBe("false");
    expect(value(manifest, "RETENTION_SCHEDULER")).toBe("0 2 * * *");
  });
});
