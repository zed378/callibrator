/**
 * P6-11 — audit rows are written inside the mutation's transaction, and
 * nothing compliance-bearing rests on the after-response middleware.
 *
 * Two facts the card asks to be stated, pinned so they stay true:
 *
 *  1. No route mounts `recordAudit` (auditLog.middleware.js). It writes on
 *     `res.on("finish")`, after the commit and outside any transaction. Its
 *     last three callers (user create/update/delete) moved into
 *     user.service.js under A-77; a new caller would bring back the two
 *     failures A-41 exists to prevent.
 *  2. Every `logAction(` call in services and controllers passes a
 *     `transaction`, except the ones listed below with a reason. A new call
 *     without one fails here and has to argue its way onto the list.
 *
 * This reads source text on purpose: the question is "which call sites exist",
 * and the behaviour of each covered mutation is proved by its own suite
 * (the *.audit.a41, user.audit.a77, webhook.secret.a51 tests and the rest).
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..");

const listJs = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listJs(full);
    }
    // ADR-087 Amendment 4: .ts too — a converted file must not leave this guard.
    return /\.(js|ts)$/.test(entry.name) ? [full] : [];
  });

const rel = (file) => path.relative(SRC, file).split(path.sep).join("/");

/** Every `logAction(...)` call with its full argument text (balanced parens). */
const callsIn = (source) => {
  const out = [];
  let i = 0;
  while ((i = source.indexOf("logAction(", i)) !== -1) {
    let depth = 0;
    let j = i + "logAction".length;
    for (; j < source.length; j++) {
      if (source[j] === "(") {
        depth++;
      } else if (source[j] === ")") {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }
    out.push({ line: source.slice(0, i).split("\n").length, text: source.slice(i, j + 1) });
    i = j;
  }
  return out;
};

// Call sites that write no transaction, each with the reason it is right.
const NO_TRANSACTION = {
  // The audit row is the ONLY database write (the file is already on disk);
  // a null row deletes the file and refuses the upload.
  "services/contentMedia.service.js": "the audit row is the only write; no row, no upload",
  // The expired-export sweep deletes FILES, not rows; the audit row is the
  // only database write, so there is no mutation transaction to join.
  "services/gdpr.service.js": "the export sweep's audit row is its only database write",
};

describe("P6-11 — audit rows inside the transaction", () => {
  const files = [...listJs(path.join(SRC, "services")), ...listJs(path.join(SRC, "controllers"))].filter(
    (f) => !/audit\.service\.(js|ts)$/.test(f),
  );

  it("the scan found call sites (a scan that finds nothing is not a pass)", () => {
    const total = files.reduce((n, f) => n + callsIn(fs.readFileSync(f, "utf8")).length, 0);
    expect(total).toBeGreaterThan(50);
  });

  it("every logAction call passes a transaction, or is listed with its reason", () => {
    const offenders = [];
    for (const file of files) {
      for (const call of callsIn(fs.readFileSync(file, "utf8"))) {
        if (!/transaction/.test(call.text) && !NO_TRANSACTION[rel(file)]) {
          offenders.push(`${rel(file)}:${call.line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every listed exception still exists and still has a transaction-less call (no stale entry)", () => {
    for (const file of Object.keys(NO_TRANSACTION)) {
      const calls = callsIn(fs.readFileSync(path.join(SRC, file), "utf8"));
      expect(calls.some((c) => !/transaction/.test(c.text))).toBe(true);
    }
  });

  // P6-13 found webhook.service.js writing AuditLog.create directly: no
  // actorType (NOT NULL since 0033), so every rotation 500ed on PostgreSQL
  // behind unit tests that mocked the model. logAction is the one write path.
  it("nothing but audit.service writes audit_logs directly", () => {
    const direct = listJs(SRC)
      .filter((f) => !f.includes(`${path.sep}tests${path.sep}`) && !f.includes(`${path.sep}migrations${path.sep}`))
      .filter((f) => !f.endsWith(`services${path.sep}audit.service.js`) && !f.endsWith(`services${path.sep}audit.service.ts`))
      .filter((f) => /AuditLogs?\.(create|bulkCreate|upsert)\(/.test(fs.readFileSync(f, "utf8")))
      .map(rel);
    expect(direct).toEqual([]);
  });

  it("no route mounts the after-response recordAudit middleware", () => {
    const users = listJs(path.join(SRC, "routes"))
      .concat([path.join(SRC, "..", "index.js")])
      .filter((f) => /recordAudit|withAudit/.test(fs.readFileSync(f, "utf8")))
      .map(rel);
    expect(users).toEqual([]);
  });
});
