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
const CROSS_TENANT = {};

const tenantScopedTables = () => {
  const sequelize = new Sequelize({ dialect: "postgres", logging: false });
  const tables = new Set();
  for (const file of fs.readdirSync(path.join(SRC, "models"))) {
    if (!file.endsWith(".model.js")) {
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
      } else if (entry.name.endsWith(".js")) {
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

const statements = () => {
  const found = [];
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(file, "utf8");
    const re = /\b(?:sequelize|db|connection|bootstrapDb)\.query\(/g;
    let match;
    while ((match = re.exec(source))) {
      found.push({
        // POSIX separators, so the CROSS_TENANT keys and the assertions
        // below mean the same thing on Windows as on Linux.
        file: path.relative(SRC, file).split(path.sep).join("/"),
        sql: sqlAt(source, match.index + match[0].length),
      });
    }
  }
  return found;
};

describe("D-05 — raw SQL naming a tenant-scoped table carries a tenant predicate", () => {
  const scoped = tenantScopedTables();
  const all = statements();

  it("sanity: the scan sees the tenant-scoped tables and the known raw statements", () => {
    expect(scoped.has("kanban_projects")).toBe(true);
    expect(scoped.has("audit_logs")).toBe(true);
    expect(scoped.has("roles")).toBe(false);
    expect(all.some((s) => s.file === "services/kanban.service.js")).toBe(true);
  });

  it("every statement can be read (a literal, or a const it names)", () => {
    expect(all.filter((s) => s.sql === null)).toEqual([]);
  });

  it("every statement that names a tenant-scoped table, or interpolates one, mentions tenant_id", () => {
    const offenders = [];
    for (const { file, sql } of all) {
      const tables = [...sql.matchAll(TABLE_REF)].map((m) => m[1].toLowerCase());
      const dynamic = /(?:FROM|UPDATE|INTO|JOIN)\s+\$\{/i.test(sql);
      const touched = tables.filter((t) => scoped.has(t));
      if (!dynamic && touched.length === 0) {
        continue;
      }
      if (/tenant_id|"tenantId"/.test(sql)) {
        continue;
      }
      const unexplained = (dynamic ? ["${table}"] : touched).filter((t) => !CROSS_TENANT[`${file}#${t}`]);
      if (unexplained.length) {
        offenders.push(`${file}: ${unexplained.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the tripwire fires on the D-05 shape (the pre-fix card_seq statement)", () => {
    const sql = "UPDATE kanban_projects SET card_seq = card_seq + 1 WHERE id = :projectId RETURNING card_seq";
    const tables = [...sql.matchAll(TABLE_REF)].map((m) => m[1]);
    expect(tables.filter((t) => scoped.has(t))).toEqual(["kanban_projects"]);
    expect(/tenant_id|"tenantId"/.test(sql)).toBe(false);
  });
});
