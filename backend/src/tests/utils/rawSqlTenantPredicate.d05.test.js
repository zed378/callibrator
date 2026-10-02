/**
 * D-05 — every raw SQL statement that names a tenant-scoped table carries a
 * tenant predicate.
 *
 * Raw SQL (`sequelize.query`) bypasses the global tenant hooks entirely
 * (CLAUDE.md, Non-Negotiables). The one statement that did not carry
 * `tenant_id` — kanban.service#createCard's `card_seq` bump — is fixed, and
 * this test is the review tripwire that stops a new one landing unnoticed:
 *
 *  1. It builds the set of tenant-scoped tables from the REAL model factories
 *     (every model with a `tenantId` attribute), so a new tenant-scoped model
 *     is covered without editing this file.
 *  2. It finds every `.query(` call in application source (services,
 *     controllers, utils, middlewares, models — not migrations, scripts or
 *     config bootstrap, which run outside any tenant by design) and reads the
 *     SQL literal passed to it, or the `const <name> = \`…\`` it names.
 *  3. A statement that names a tenant-scoped table, or interpolates a table
 *     name (`${table}`), must mention `tenant_id` / `"tenantId"`. A statement
 *     that genuinely must span tenants is listed in CROSS_TENANT with the
 *     reason — adding one is the review item CLAUDE.md asks for.
 *
 * It is a textual check: it proves the predicate is PRESENT, not that it is
 * correct. It is a tripwire, not a proof.
 *
 * P9-07 (ADR-087 Amendment 12): it also reads every call of the bind-only helper,
 * `sql<Row>(runner, text, bind)` (utils/sql.util), taking the statement from its
 * SECOND argument. For those the rule is stricter: a statement naming a
 * tenant-scoped table must BIND its tenant predicate (`tenant_id = $n`), because
 * the helper exists so that values are never interpolated.
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

const SRC = path.join(__dirname, "../..");
const SCANNED_DIRS = ["services", "controllers", "utils", "middlewares", "models", "routes"];

/**
 * Raw statements that span tenants on purpose. Key: `<relative file>#<table>`.
 * Each needs a reason a reviewer can check.
 */
const CROSS_TENANT = {
  // P7-05 (ADR-078): the boot check that every stored KMS envelope names a
  // configured master key. It runs before any request, across every tenant by
  // design, and reads only key ids and counts (plus one v1 sample, decrypted
  // with its own tenant id / AAD and discarded) — never a value it returns.
  "utils/kmsVerify.util.ts#${table}":
    "boot-time KMS key check over every tenant's envelopes (ADR-078); reads key ids and counts only",
  // P9-18: the operator's key rotation (npm run keys:rotate, S-08/P6-10). It
  // pages every row of each envelope table across ALL tenants on purpose; each
  // UPDATE and re-read binds the row's id AND its tenant (`tenant_id IS NOT
  // DISTINCT FROM CAST($n AS uuid)`: a user's tenant can be NULL), and the
  // value is re-encrypted under that tenant as AAD. Reviewed with the move to
  // sql() (MEMORY/records/2026-09-30-p9-stage-c-leaf-services.md).
  "services/keyRotation.service.ts#${table}":
    "operator key rotation across every tenant's envelopes (S-08); each write binds the row's id and tenant",
};

const tenantScopedTables = () => {
  const sequelize = new Sequelize({ dialect: "postgres", logging: false });
  const tables = new Set();
  for (const file of fs.readdirSync(path.join(SRC, "models"))) {
    if (!/\.model\.(js|ts)$/.test(file)) {
      continue;
    }
    const model = require(path.join(SRC, "models", file))(sequelize, DataTypes);
    if (model && model.rawAttributes && model.rawAttributes.tenantId) {
      tables.add(model.getTableName().toString().replace(/"/g, ""));
    }
  }
  return tables;
};

const sourceFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(js|ts)$/.test(entry.name)) { // ADR-087 Amendment 4
        out.push(full);
      }
    }
  };
  for (const dir of SCANNED_DIRS) {
    walk(path.join(SRC, dir));
  }
  return out;
};

/** The SQL text a `.query(` call at `index` passes, or null if not a literal/const. */
const sqlAt = (source, index) => {
  const rest = source.slice(index).replace(/^\s+/, "");
  const quote = rest[0];
  if (quote === "`" || quote === '"' || quote === "'") {
    const end = rest.indexOf(quote, 1);
    return rest.slice(1, end);
  }
  const ident = /^([A-Za-z_$][\w$]*)/.exec(rest);
  if (!ident) {
    return null;
  }
  const decl = new RegExp(`(?:const|let)\\s+${ident[1]}\\s*=\\s*\`([^\`]*)\``).exec(source);
  return decl ? decl[1] : null;
};

const TABLE_REF = /\b(?:FROM|UPDATE|INTO|JOIN)\s+"?([a-z_][a-z0-9_]*)"?/gi;

/** P9-07: `sql(` / `sql<Row>(`, then the runner argument; the statement is the next argument. */
const HELPER_CALL = /\bsql(?:<[^()]*?>)?\(\s*[\w$.]+\s*,/g;

/** Every raw statement in one source text: direct `.query(` calls and helper `sql(` calls. */
const statementsIn = (source, file) => {
  const found = [];
  const re = /\b(?:sequelize|db|connection|bootstrapDb)\.query\(/g;
  let match;
  while ((match = re.exec(source))) {
    found.push({ file, kind: "query", sql: sqlAt(source, match.index + match[0].length) });
  }
  // The helper module DEFINES sql() (its doc comment shows a call shape); it calls nothing.
  const helper = new RegExp(HELPER_CALL.source, "g");
  while (file !== "utils/sql.util.ts" && (match = helper.exec(source))) {
    found.push({ file, kind: "helper", sql: sqlAt(source, match.index + match[0].length) });
  }
  return found;
};

const statements = () => {
  const found = [];
  for (const file of sourceFiles()) {
    // POSIX separators, so the CROSS_TENANT keys and the assertions
    // below mean the same thing on Windows as on Linux.
    found.push(...statementsIn(fs.readFileSync(file, "utf8"), path.relative(SRC, file).split(path.sep).join("/")));
  }
  return found;
};

/** A tenant predicate BOUND as a parameter (the helper's rule). */
const BOUND_TENANT = /(?:tenant_id|"tenantId")\s*=\s*\$\d+/;

/** Split a list on its top-level commas (a value may be `now()` or `gen_random_uuid()`). */
const topLevel = (list) => {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") {depth += 1;}
    if (ch === ")") {depth -= 1;}
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts;
};

/**
 * P9-18: an INSERT has no predicate; its tenant is the VALUE it writes. A
 * helper INSERT passes when its column list names `tenant_id` and the value in
 * that position is a bound `$n` (optionally cast), never a literal or an
 * interpolation.
 */
const insertBindsTenant = (sql) => {
  const m = /^\s*INSERT\s+INTO\s+"?[a-z_][a-z0-9_]*"?\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)\s*(?:RETURNING[\s\S]*)?$/i.exec(sql);
  if (!m) {
    return false;
  }
  const columns = topLevel(m[1]).map((col) => col.replace(/"/g, "").toLowerCase());
  const index = columns.findIndex((col) => col === "tenant_id" || col === "tenantid");
  return index >= 0 && /^\$\d+(?:::\w+)?$/.test(topLevel(m[2])[index] || "");
};

/** Offending statements (shared by the real scan and the bite checks). */
const offendersOf = (list, scoped) => {
  const offenders = [];
  for (const { file, kind, sql } of list) {
    const tables = [...sql.matchAll(TABLE_REF)].map((m) => m[1].toLowerCase());
    const dynamic = /(?:FROM|UPDATE|INTO|JOIN)\s+\$\{/i.test(sql);
    const touched = tables.filter((t) => scoped.has(t));
    if (!dynamic && touched.length === 0) {
      continue;
    }
    const ok = kind === "helper" ? BOUND_TENANT.test(sql) || insertBindsTenant(sql) : /tenant_id|"tenantId"/.test(sql);
    if (ok) {
      continue;
    }
    const unexplained = (dynamic ? ["${table}"] : touched).filter((t) => !CROSS_TENANT[`${file}#${t}`]);
    if (unexplained.length) {
      offenders.push(`${file}: ${unexplained.join(", ")}`);
    }
  }
  return offenders;
};

describe("D-05 — raw SQL naming a tenant-scoped table carries a tenant predicate", () => {
  const scoped = tenantScopedTables();
  const all = statements();

  it("sanity: the scan sees the tenant-scoped tables and the known raw statements", () => {
    expect(scoped.has("kanban_projects")).toBe(true);
    expect(scoped.has("audit_logs")).toBe(true);
    expect(scoped.has("roles")).toBe(false);
    expect(all.some((s) => s.file === "services/kanban.service.ts")).toBe(true);
  });

  it("every statement can be read (a literal, or a const it names)", () => {
    expect(all.filter((s) => s.sql === null)).toEqual([]);
  });

  it("every statement that names a tenant-scoped table, or interpolates one, mentions tenant_id (a helper call: BINDS it)", () => {
    expect(offendersOf(all, scoped)).toEqual([]);
  });

  it("P9-07: the scan reads the helper calls (sql(...)) in the converted utils", () => {
    const helper = all.filter((s) => s.kind === "helper");
    expect(helper.length).toBeGreaterThanOrEqual(7);
    expect(helper.map((s) => s.file)).toEqual(
      expect.arrayContaining(["utils/authorizationWiring.util.ts", "utils/dbRole.util.ts", "utils/schemaVerify.util.ts"]),
    );
    expect(helper.filter((s) => s.sql === null)).toEqual([]);
  });

  it("P9-07: the helper rule bites — a tenant-scoped statement must BIND its tenant predicate", () => {
    const source = [
      "await sql<Row>(sequelize, `SELECT * FROM usage_alerts WHERE tenant_id = $1`, [tenantId]);",
      "await sql(models.sequelize, `SELECT * FROM usage_alerts WHERE tenant_id = '${tenantId}'`);",
      "await sql(sequelize, `UPDATE kanban_projects SET card_seq = card_seq + 1 WHERE id = $1 RETURNING card_seq`, [id]);",
      "await sql(sequelize, `SELECT name FROM roles`);",
    ].join("\n");
    const found = statementsIn(source, "synthetic.ts");
    expect(found.map((s) => s.kind)).toEqual(["helper", "helper", "helper", "helper"]);
    // interpolated (not bound) and missing predicates are flagged; the bound one and the global table are not
    expect(offendersOf(found, scoped)).toEqual(["synthetic.ts: usage_alerts", "synthetic.ts: kanban_projects"]);
  });

  it("P9-18: a helper INSERT passes only when it BINDS the tenant column's value", () => {
    const source = [
      "await sql(db, `INSERT INTO document_chunks (id, tenant_id, content) VALUES (gen_random_uuid(), $1, $2)`, [t, c]);",
      "await sql(db, `INSERT INTO document_chunks (id, tenant_id, content) VALUES (gen_random_uuid(), '${t}', $1)`, [c]);",
      "await sql(db, `INSERT INTO document_chunks (id, content) VALUES (gen_random_uuid(), $1)`, [c]);",
      "await sql(db, `INSERT INTO document_chunks (id, tenant_id, content) VALUES (gen_random_uuid(), $1::uuid, now())`, [t]);",
      // An INSERT ... SELECT is not an INSERT ... VALUES: the rule does not
      // apply, and its SELECT must bind its own tenant predicate.
      "await sql(db, `INSERT INTO document_chunks (id, tenant_id, content) SELECT gen_random_uuid(), $1, content FROM document_chunks WHERE source_id = $2`, [t, s]);",
      "await sql(db, `INSERT INTO document_chunks (id, tenant_id, content) SELECT gen_random_uuid(), tenant_id, content FROM document_chunks WHERE tenant_id = $1 AND source_id = $2`, [t, s]);",
    ].join("\n");
    const found = statementsIn(source, "synthetic-insert.ts");
    expect(offendersOf(found, scoped)).toEqual([
      "synthetic-insert.ts: document_chunks",
      "synthetic-insert.ts: document_chunks",
      // the INSERT ... SELECT names the table twice (INTO and FROM)
      "synthetic-insert.ts: document_chunks, document_chunks",
    ]);
  });

  it("the tripwire fires on the D-05 shape (the pre-fix card_seq statement)", () => {
    const sql = "UPDATE kanban_projects SET card_seq = card_seq + 1 WHERE id = :projectId RETURNING card_seq";
    const tables = [...sql.matchAll(TABLE_REF)].map((m) => m[1]);
    expect(tables.filter((t) => scoped.has(t))).toEqual(["kanban_projects"]);
    expect(/tenant_id|"tenantId"/.test(sql)).toBe(false);
  });
});
