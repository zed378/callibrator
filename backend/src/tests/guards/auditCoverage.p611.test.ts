/**
 * P6-11 (A-41 addendum, 2026-09-30) — every mutating service entry point
 * writes an audit row, or is on the list below with its reason.
 *
 * WHY
 *
 * CLAUDE.md: "Every mutation writes an audit row, inside the transaction."
 * auditInTransaction.p611.test.js pins the second half — every `logAction`
 * call passes a transaction — but not the first: a service that never calls
 * `logAction` at all passes it. On 2026-09-28 fifteen mutating services wrote
 * no audit row (apiKey, kanban, ticket, vendor, warehouse, …); the owner put
 * all fifteen in scope. This guard makes a NEW unaudited mutation fail the
 * build instead of waiting for the next inventory.
 *
 * HOW (source text, on purpose — the question is "which entry points exist")
 *
 * 1. Every file under services/ (not audit.service, not a .d.ts) is split into
 *    top-level functions (`exports.x =`, `const x =`, `function x`, and
 *    two-space-indented class methods for the class-instance modules).
 * 2. Its ENTRY POINTS are the names it exports: `exports.x`, the keys of an
 *    `export =` / `module.exports =` object, or every method of a
 *    `module.exports = new X()` instance.
 * 3. From each entry point the same-file functions it calls are followed,
 *    transitively. The entry point MUTATES when any of that source writes
 *    (a model create/update/destroy/save/upsert/…, or raw INSERT/UPDATE/
 *    DELETE); it is AUDITED when any of it calls `logAction(` or one of the
 *    cross-file audit helpers named in AUDIT_CALL.
 * 4. A mutating, unaudited entry point fails unless it is listed below, keyed
 *    `services/<file without extension>#<name>` (so a .js → .ts conversion
 *    keeps its entry) with the reason it is right, or the gap it is.
 *
 * LIMITS (stated, not hidden): this reads source, so it proves an audit call is
 * REACHABLE from the entry point, not that every branch makes it — each
 * service's behaviour suite proves that (tests/services/auditCoverage.p611.test.ts
 * for the services this card converted). A write through a helper in ANOTHER
 * file is not followed. The check itself is tested in both directions at the
 * bottom, on synthetic sources.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(__dirname, "..", "..");
const SERVICES = path.join(SRC, "services");

/** A write to the database, as source text. `.update(` on a hash/cipher is not one. */
const MUTATION =
  /\.(?:create|bulkCreate|destroy|upsert|findOrCreate|softDelete|restore|increment|decrement|save)\(|\b(?!createHash\b|hash\b|hmac\b|cipher\b|decipher\b|sign\b|verify\b)\w+\.update\(|\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+"?[a-z_]+"?\s+SET)\b/i;

/**
 * An audit write: logAction, or a cross-file helper that writes one for the
 * caller's own resource. attachment.service#softDeleteForResource is NOT one:
 * it audits the ATTACHMENTS it soft-deletes (none, when there are none), so it
 * let kanban's deleteProject/deleteCard pass while writing no row of their own.
 */
const AUDIT_CALL = /logAction\(|auditCredentialChange\(|recordAccountLock\(/;

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "constructor"]);

/** name → source of that top-level function (a repeated name concatenates). */
const functionsOf = (source: string): Map<string, string> => {
  const lines = source.split("\n");
  const starts: { line: number; name: string }[] = [];
  lines.forEach((text, line) => {
    const match =
      /^exports\.(\w+)\s*=/.exec(text) ??
      /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=/.exec(text) ??
      /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/.exec(text) ??
      /^ {2}(?:(?:public|private|protected|static|readonly|override)\s+)*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::[^{]*)?\{\s*$/.exec(text) ??
      // 2026-09-30 (the services helper's report): a method whose parameters
      // continue on the next line, as the converted .ts classes write them.
      /^ {2}(?:(?:public|private|protected|static|readonly|override)\s+)*(?:async\s+)?(\w+)\s*\($/.exec(text);
    const name = match?.[1];
    if (name && !KEYWORDS.has(name)) {
      starts.push({ line, name });
    }
  });
  const out = new Map<string, string>();
  starts.forEach((start, k) => {
    const end = starts[k + 1]?.line ?? lines.length;
    out.set(start.name, (out.get(start.name) ?? "") + lines.slice(start.line, end).join("\n"));
  });
  return out;
};

/** The keys of an object literal's body: `a,` `b:` and `c` on the last line. */
const objectKeys = (body: string): string[] =>
  [...body.matchAll(/^\s*(\w+)\s*(?:[,:]|$)/gm)].flatMap((m) => (m[1] ? [m[1]] : []));

/** The names a module exports, restricted to functions found in it. */
const entryPointsOf = (source: string, functions: Map<string, string>): string[] => {
  const names = new Set<string>();
  for (const m of source.matchAll(/^exports\.(\w+)\s*=/gm)) {
    if (m[1]) {
      names.add(m[1]);
    }
  }
  const inline = /(?:export\s*=|module\.exports\s*=)\s*\{([\s\S]*?)\};?\s*$/m.exec(source);
  if (inline?.[1]) {
    objectKeys(inline[1]).forEach((n) => names.add(n));
  }
  const named = /(?:export\s*=|module\.exports\s*=)\s*(\w+);/.exec(source);
  if (named?.[1]) {
    const decl = new RegExp(`const\\s+${named[1]}\\s*(?::[^=]+)?=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(source);
    if (decl?.[1]) {
      objectKeys(decl[1]).forEach((n) => names.add(n));
    }
  }
  // A class instance: `module.exports = new X()`, `export = new X()`, or
  // `export = x;` where `const x = new X(...)` (optionally `as ...`) — the
  // shapes workflow.service.ts and iot.service.ts took when converted.
  const instanceName = named?.[1];
  const exportsInstance =
    /(?:module\.exports|export)\s*=\s*new\s+\w+/.test(source) ||
    (instanceName !== undefined && new RegExp(`const\\s+${instanceName}\\s*(?::[^=]+)?=\\s*new\\s+\\w+`).test(source));
  if (exportsInstance) {
    for (const name of functions.keys()) {
      if (!/^[A-Z]/.test(name)) {
        names.add(name);
      }
    }
  }
  return [...names].filter((n) => functions.has(n));
};

/** The source an entry point runs: itself and every same-file function it calls, transitively. */
const reachableSource = (entry: string, functions: Map<string, string>): string => {
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    const body = functions.get(name) ?? "";
    for (const other of functions.keys()) {
      if (other !== name && new RegExp(`\\b${other}\\s*\\(|(?:service|exports|this)\\.${other}\\b`).test(body)) {
        visit(other);
      }
    }
  };
  visit(entry);
  return [...seen].map((n) => functions.get(n) ?? "").join("\n");
};

/** The entry points of one module that write without an audit row. */
const unauditedMutations = (source: string): string[] => {
  const functions = functionsOf(source);
  return entryPointsOf(source, functions).filter((name) => {
    const body = reachableSource(name, functions);
    return MUTATION.test(body) && !AUDIT_CALL.test(body);
  });
};

/** Mutating entry points that ARE audited (to prove the scan sees them). */
const auditedMutations = (source: string): string[] => {
  const functions = functionsOf(source);
  return entryPointsOf(source, functions).filter((name) => {
    const body = reachableSource(name, functions);
    return MUTATION.test(body) && AUDIT_CALL.test(body);
  });
};

const listSources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSources(full);
    }
    return /\.(js|ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });

/** `services/<path without extension>` — stable across a .js → .ts conversion. */
const keyOf = (file: string): string =>
  path.relative(SRC, file).split(path.sep).join("/").replace(/\.(js|ts)$/, "");

// ---------------------------------------------------------------------------
// The reviewed list. Every entry is either right (a reason) or a named gap.
// ---------------------------------------------------------------------------

const INFRA =
  "infrastructure, not a user mutation (A-41 addendum 2026-09-28 lists it so)";
const AUTH_STEP =
  "a step of authentication; the login it belongs to is audited (auth.service#openLoginSession, sso.controller#issueSsoTokens)";
const SEEDER =
  "a seeder/unseeder run by the migration CLI and schema setup, not by a principal";
const NOTIFICATION =
  "a notification is a derived message (W-04 writes it beside the caller's own audit row), and read/hide is the user's own inbox state; one audit row per read would fill the append-only audit_logs (0091) with noise";
const WEBHOOK =
  "a webhook delivery row is an outbox entry derived from an event its own caller already audited";
/*
 * The KNOWN GAP entries — found by this guard on 2026-09-30 outside the fifteen
 * services in scope for P6-11 (MEMORY/records/2026-09-30-p6-11-audit-coverage.md)
 * — are all closed: the last two, stock#createOpname and #updateOpnameStatus,
 * were audited on 2026-09-30 (stock.opnameAudit.p611.test.ts). A new gap is
 * audited, or listed below with its reason; there is no "known gap" category
 * left to put it in.
 */

const ALLOWED: Readonly<Record<string, string>> = Object.freeze({
  // --- from the fifteen, each deliberately left unaudited ---
  "services/ai.service#ingestDocument":
    "the RAG index (document_chunks) is derived from its source document and rebuilt idempotently; the only caller is the backfillEmbeddings CLI",
  "services/apiKey.service#verifyApiKey": `${AUTH_STEP}: a throttled lastUsedAt stamp on the key`,
  "services/webauthn.service#verifyLogin": `${AUTH_STEP}: the passkey's signature counter`,
  "services/meteredBilling.service#trackUsage":
    "usage metering counters (UsageMetrics), incremented on every request",
  "services/meteredBilling.service#resetUsage": "no caller outside tests",
  "services/notification.service#emitNotification": NOTIFICATION,
  "services/notification.service#markAsRead": NOTIFICATION,
  "services/notification.service#markAllAsRead": NOTIFICATION,
  "services/notification.service#deleteAllNotifications": NOTIFICATION,
  "services/notification.service#deleteManyNotifications": NOTIFICATION,
  "services/notification.service#deleteNotification": NOTIFICATION,

  // --- infrastructure named by the A-41 addendum ---
  "services/auth.service#requestOTP": `${AUTH_STEP}: stores a one-time code`,
  "services/mfa.service#consumeCode": `${AUTH_STEP}: consumes a one-time code`,
  "services/mfa.service#verifyLogin": `${AUTH_STEP}: consumes a one-time code`,
  "services/mfa.service#consumeRecoveryCode": `${AUTH_STEP}: consumes a recovery code`,
  "services/sso.service#parseAndVerifyResponse": `${AUTH_STEP}: the assertion replay cache`,
  "services/clamAv.service#scanFile": INFRA,
  "services/clamAv.service#scanFiles": INFRA,
  "services/clamAv.service#ping": INFRA,
  "services/rateLimiter.redis.service#resetAuthFailures": INFRA,
  "services/rateLimiter.redis.service#revokeTokenByHash": INFRA,
  "services/rateLimiter.redis.service#revokeAllUserTokens": INFRA,
  "services/rateLimiter.redis.service#noteAuthSuccess": INFRA,
  "services/session.service#createSession": INFRA,
  "services/session.service#validateSession": INFRA,
  "services/session.service#revokeSession": INFRA,
  "services/session.service#revokeAllSessions": INFRA,
  "services/session.service#revokeOtherSessions": INFRA,
  "services/session.service#rotateRefreshToken": INFRA,
  "services/session.service#cleanupExpiredSessions": INFRA,
  "services/session.service#revokeSessionById": INFRA,
  "services/storageMigration.service#migrateAttachment": `${INFRA}: the operator's storage-migration tool moves file bytes`,
  "services/tenantBackup.service#cleanupExpiredBackups": `${INFRA}: the retention sweep of expired backup files`,
  "services/migration.service#seedDefaultRoles": SEEDER,
  "services/migration.service#seedApplicationRoles": SEEDER,
  "services/migration.service#seedAllRoles": SEEDER,
  "services/migration.service#seedMenuGroupsAndItems": SEEDER,
  "services/migration.service#seedRoleMenuPermissions": SEEDER,
  "services/migration.service#seedPlatformTenant": SEEDER,
  "services/migration.service#seedAll": SEEDER,
  "services/migration.service#seedDemoData": SEEDER,
  "services/migration.service#unseedDemoData": SEEDER,
  "services/migration.service#unseedAll": SEEDER,
  "services/migration.service#unseedRoles": SEEDER,
  "services/migration.service#unseedUsers": SEEDER,
  "services/migration.service#unseedMenuData": SEEDER,
  "services/webhook.service#dispatchDue": WEBHOOK,
  "services/webhook.service#emitEvent": WEBHOOK,
  "services/webhook.service#emitAfterCommit": WEBHOOK,
  "services/webhook.service#testWebhook": `${WEBHOOK} (a test ping to the tenant's own endpoint)`,

  // --- outside the fifteen (the KNOWN GAP entries are all closed, see above) ---
  // Reclassified 2026-09-30: every caller (certificate create and resubmit,
  // stock transfer) starts the instance in ITS transaction and records
  // `workflowInstanceId` in ITS own audit row — pinned below.
  "services/workflow.service#startWorkflow":
    "audited by its callers: each runs it inside its own transaction and records workflowInstanceId in its own audit row",
});

// ---------------------------------------------------------------------------

describe("P6-11 — every mutating service entry point writes an audit row", () => {
  const files = listSources(SERVICES).filter((f) => !/[\\/]audit\.service\.(js|ts)$/.test(f));
  const found = files.flatMap((file) =>
    unauditedMutations(fs.readFileSync(file, "utf8")).map((name) => `${keyOf(file)}#${name}`),
  );

  it("the scan sees the audited mutations (a scan that finds nothing is not a pass)", () => {
    const audited = files.reduce((n, f) => n + auditedMutations(fs.readFileSync(f, "utf8")).length, 0);
    expect(audited).toBeGreaterThan(150);
  });

  it("each service this card audited has every mutating entry point audited", () => {
    const expected: Record<string, number> = {
      "services/kanban.service": 23,
      "services/ticket.service": 5,
      "services/content.service": 6,
      "services/featureFlag.service": 3,
      "services/warehouse.service": 6,
      "services/meteredBilling.service": 3, // A-322: enforceQuotas audits its quota suspension
    };
    for (const [key, count] of Object.entries(expected)) {
      const file = files.find((f) => keyOf(f) === key);
      expect(file).toBeDefined();
      const source = fs.readFileSync(file ?? "", "utf8");
      expect({ key, audited: auditedMutations(source).length }).toEqual({ key, audited: count });
    }
  });

  it("no mutating entry point is unaudited unless it is listed with its reason", () => {
    expect(found.filter((k) => !(k in ALLOWED))).toEqual([]);
  });

  it("no listed entry is stale: each still exists and still writes without an audit row", () => {
    expect(Object.keys(ALLOWED).filter((k) => !found.includes(k))).toEqual([]);
  });
});

describe("P6-11 — a workflow instance is recorded by the write that starts it", () => {
  it("every service that calls startWorkflow( records workflowInstanceId in its own audit row", () => {
    const callers = listSources(SERVICES)
      .filter((f) => !/[\\/]workflow\.service\.(js|ts)$/.test(f))
      .filter((f) => fs.readFileSync(f, "utf8").includes("startWorkflow("));
    expect(callers.length).toBeGreaterThanOrEqual(2);
    expect(callers.filter((f) => !fs.readFileSync(f, "utf8").includes("workflowInstanceId")).map(keyOf)).toEqual([]);
  });
});

describe("the check itself, on synthetic sources", () => {
  it("reads a `.ts` class instance (`export = x` of `const x = new X()`) with a multi-line method head", () => {
    const src = [
      "class X {",
      "  async put(",
      "    tenantId: string,",
      "    row: object,",
      "  ): Promise<void> {",
      "    await Thing.create(row);",
      "  }",
      "  private async helper(id: string): Promise<void> {",
      "    await Thing.destroy({ where: { id } });",
      "  }",
      "}",
      "const service = new X() as unknown as XService;",
      "export = service;",
    ].join("\n");
    expect(unauditedMutations(src)).toEqual(["put", "helper"]);
  });

  it("reads `export = new X()`", () => {
    const src = ["class X {", "  async put(row) {", "    await Thing.save(row);", "  }", "}", "export = new X();"].join("\n");
    expect(unauditedMutations(src)).toEqual(["put"]);
  });

  it("flags an exported write with no audit call", () => {
    const src = [
      "exports.create = async (data) => {",
      "  return Thing.create(data);",
      "};",
    ].join("\n");
    expect(unauditedMutations(src)).toEqual(["create"]);
  });

  it("follows a same-file helper to its logAction, and ignores reads", () => {
    const src = [
      "const audit = (t) => auditService.logAction({}, { transaction: t });",
      "exports.create = async (data) => {",
      "  const row = await Thing.create(data, { transaction });",
      "  await audit(transaction);",
      "};",
      "exports.list = async () => Thing.findAll();",
    ].join("\n");
    expect(unauditedMutations(src)).toEqual([]);
  });

  it("reads the keys of an `export =` object and a hash's .update( is not a write", () => {
    const src = [
      "const hashKey = (raw) => createHash(\"sha256\").update(raw).digest(\"hex\");",
      "const removeIt = async (id) => {",
      "  await Thing.destroy({ where: { id } });",
      "};",
      "const service = {",
      "  hashKey,",
      "  removeIt,",
      "};",
      "export = service;",
    ].join("\n");
    expect(unauditedMutations(src)).toEqual(["removeIt"]);
  });

  it("reads the methods of a `module.exports = new X()` instance", () => {
    const src = [
      "class X {",
      "  async put(row) {",
      "    await db.query(`INSERT INTO things VALUES ($1)`, { bind: [row] });",
      "  }",
      "}",
      "module.exports = new X();",
    ].join("\n");
    expect(unauditedMutations(src)).toEqual(["put"]);
  });
});
