/**
 * P21-09d — G-14, the facility twin of rawSqlTenantPredicate.d05 (spec P19-04 § 8; AM-9, FT-35).
 *
 * Raw SQL bypasses the hooks. A raw statement (`sql(` or `.query(`) whose text names a
 * FACILITY-scoped table — derived from the real model factories declaring `clientFacilityId`, so
 * a new facility model is covered without editing this file — must build its text with
 * `facilityClause(` (the file calls it and the statement interpolates its clause), OR be listed in
 * RAW_SQL_UNREACHABLE_BY_BOUND with a reason and the routes it is reachable from, none of which
 * may be marked facility-accessible (a marked route is reachable by a bound principal, and its
 * raw SQL then needs the clause and a live twin — memoryDb refuses raw SQL, F-9).
 *
 * No `client_facility_id IS NULL OR` anywhere in application source (FT-35): a NULL facility is
 * never "every facility".
 *
 * Textual, like d05: it proves the clause is PRESENT, not that it is correct.
 */
import fs from "fs";
import path from "path";
import { Sequelize, DataTypes } from "sequelize";
import { FACILITY_ACCESSIBLE_ROUTES, RAW_SQL_UNREACHABLE_BY_BOUND } from "../../constants/facilityAccess";

const SRC = path.join(__dirname, "../..");
const SCANNED_DIRS = ["services", "controllers", "utils", "middlewares", "models", "routes"];

interface ModelLike {
  rawAttributes?: Record<string, unknown>;
  getTableName(): unknown;
}
type ModelFactory = (db: Sequelize, types: typeof DataTypes) => ModelLike | null;

const facilityScopedTables = (): Set<string> => {
  const sequelize = new Sequelize({ dialect: "postgres", logging: false });
  const tables = new Set<string>();
  for (const file of fs.readdirSync(path.join(SRC, "models"))) {
    if (!file.endsWith(".model.ts")) {
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- every model factory, by file name (as d05)
    const factory = require(path.join(SRC, "models", file)) as ModelFactory;
    const model = factory(sequelize, DataTypes);
    if (model?.rawAttributes?.["clientFacilityId"]) {
      tables.add(String(model.getTableName()).replace(/"/g, ""));
    }
  }
  return tables;
};

const sourceFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(js|ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  };
  for (const dir of SCANNED_DIRS) {
    walk(path.join(SRC, dir));
  }
  return out;
};

/** Literals joined by `+` from the start of `text` (template, double- or single-quoted), concatenated. */
const literalsAt = (text: string): string | null => {
  let rest = text.replace(/^\s+/, "");
  let out = "";
  let read = false;
  for (;;) {
    const quote = rest[0];
    if (quote !== "`" && quote !== '"' && quote !== "'") {
      break;
    }
    let i = 1;
    while (i < rest.length && rest[i] !== quote) {
      i += rest[i] === "\\" ? 2 : 1;
    }
    out += rest.slice(1, i);
    read = true;
    rest = rest.slice(i + 1).replace(/^\s+/, "");
    if (!rest.startsWith("+")) {
      break;
    }
    rest = rest.slice(1).replace(/^\s+/, "");
  }
  return read ? out : null;
};

/** The literal text a `const NAME =` declaration in `source` holds, or null. */
const constText = (source: string, name: string): string | null => {
  const decl = new RegExp(`(?:const|let)\\s+${name}(?:\\s*:\\s*[\\w<>]+)?\\s*=`).exec(source);
  return decl ? literalsAt(source.slice(decl.index + decl[0].length)) : null;
};

/** Expand `${NAME}` interpolations that name a const of the same file (two levels). */
const expand = (source: string, text: string, depth = 2): string =>
  depth === 0
    ? text
    : text.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (whole, name: string) => {
      const inner = constText(source, name);
      return inner === null ? whole : expand(source, inner, depth - 1);
    });

/** The SQL text at `index`: literals, or the const an identifier names — expanded. */
const sqlAt = (source: string, index: number): string | null => {
  const rest = source.slice(index).replace(/^\s+/, "");
  const direct = literalsAt(rest);
  if (direct !== null) {
    return expand(source, direct);
  }
  const ident = /^([A-Za-z_$][\w$]*)/.exec(rest);
  const held = ident ? constText(source, ident[1] as string) : null;
  return held === null ? null : expand(source, held);
};

/** The index just past the first top-level comma after `from` (the runner argument skipped). */
const afterFirstArgument = (source: string, from: number): number => {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(" || ch === "{" || ch === "[") {depth += 1;}
    if (ch === ")" || ch === "}" || ch === "]") {depth -= 1;}
    if (ch === "," && depth === 0) {return i + 1;}
  }
  return source.length;
};

const TABLE_REF = /\b(?:FROM|UPDATE|INTO|JOIN)\s+"?([a-z_][a-z0-9_]*)"?/gi;
const DYNAMIC_TABLE = /\b(?:FROM|UPDATE|INTO|JOIN)\s+"?\$\{/i;
const HELPER_CALL = /\bsql(?:<[^()]*?>)?\(/g;
const QUERY_CALL = /\b(?:sequelize|db|connection|bootstrapDb)\.query\(/g;

interface Statement {
  readonly file: string;
  readonly sql: string | null;
  readonly usesClause: boolean;
}

const statementsIn = (source: string, file: string): Statement[] => {
  const found: Statement[] = [];
  const fileCallsClause = /\bfacilityClause\(/.test(source) && file !== "utils/facilityPredicate.util.ts";
  const push = (text: string | null): void => {
    found.push({ file, sql: text, usesClause: fileCallsClause && text !== null && /\$\{[^}]*[Cc]lause[^}]*\}/.test(text) });
  };
  let match: RegExpExecArray | null;
  const query = new RegExp(QUERY_CALL.source, "g");
  while ((match = query.exec(source))) {
    push(sqlAt(source, match.index + match[0].length));
  }
  if (file === "utils/sql.util.ts" || file === "utils/facilityPredicate.util.ts") {
    return found;
  }
  const helper = new RegExp(HELPER_CALL.source, "g");
  while ((match = helper.exec(source))) {
    // Only a CALL: the character before `sql` is not part of an identifier or a property name.
    if (/[\w$.]/.test(source[match.index - 1] ?? "")) {continue;}
    push(sqlAt(source, afterFirstArgument(source, match.index + match[0].length)));
  }
  return found;
};

/** `<file>#<table>` for every statement naming a facility table without the clause and unlisted. */
const offendersOf = (list: readonly Statement[], scoped: ReadonlySet<string>, listed: Readonly<Record<string, unknown>>): string[] => {
  const out: string[] = [];
  for (const { file, sql, usesClause } of list) {
    if (sql === null || usesClause) {
      continue;
    }
    const touched = [...new Set([...sql.matchAll(TABLE_REF)].map((m) => (m[1] as string).toLowerCase()))].filter((t) => scoped.has(t));
    if (DYNAMIC_TABLE.test(sql)) {
      touched.push("${table}");
    }
    for (const table of touched) {
      if (!Object.hasOwn(listed, `${file}#${table}`) && !out.includes(`${file}#${table}`)) {
        out.push(`${file}#${table}`);
      }
    }
  }
  return out;
};

const isMarked = (routeFile: string, key: string): boolean =>
  Boolean((FACILITY_ACCESSIBLE_ROUTES as Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>)[routeFile]?.[key]);

describe("G-14 — raw SQL naming a facility-scoped table binds the facility clause, or is unreachable by bound principals", () => {
  const scoped = facilityScopedTables();
  const all: Statement[] = sourceFiles().flatMap((full) =>
    statementsIn(fs.readFileSync(full, "utf8"), path.relative(SRC, full).split(path.sep).join("/")),
  );

  it("sanity: the evidence-chain tables are facility-scoped, provider tables are not", () => {
    expect([...scoped]).toEqual(expect.arrayContaining(["calibration_devices", "calibration_records", "certificates", "attachments", "audit_logs"]));
    expect(scoped.has("users")).toBe(true);
    expect(scoped.has("vendors")).toBe(false);
    expect(scoped.has("client_facility_moves")).toBe(false);
  });

  it("every statement naming a facility-scoped table uses facilityClause or is listed", () => {
    expect(offendersOf(all, scoped, RAW_SQL_UNREACHABLE_BY_BOUND)).toEqual([]);
  });

  it("every listed entry still names a real statement (the list only holds what exists)", () => {
    const unlisted = offendersOf(all, scoped, {});
    for (const key of Object.keys(RAW_SQL_UNREACHABLE_BY_BOUND)) {
      expect({ key, present: unlisted.includes(key) }).toEqual({ key, present: true });
    }
  });

  it("every listed entry has a reason and is reachable only from UNMARKED routes or system work", () => {
    for (const [key, entry] of Object.entries(RAW_SQL_UNREACHABLE_BY_BOUND)) {
      expect({ key, reason: entry.reason.length > 10 }).toEqual({ key, reason: true });
      expect({ key, reachable: entry.reachableFrom.length > 0 }).toEqual({ key, reachable: true });
      for (const from of entry.reachableFrom) {
        const route = /^(\S+\.route\.ts) (GET|POST|PUT|PATCH|DELETE) (\S+)$/.exec(from);
        if (route) {
          expect({ key, from, marked: isMarked(route[1] as string, `${route[2] as string} ${route[3] as string}`) }).toEqual({ key, from, marked: false });
        } else {
          expect({ key, from, system: /^system: .{5,}/.test(from) }).toEqual({ key, from, system: true });
        }
      }
    }
  });

  it("FT-35: no `client_facility_id IS NULL OR` anywhere in application source", () => {
    const hits = sourceFiles().filter((full) => /client_facility_id\s+IS\s+NULL\s+OR/i.test(fs.readFileSync(full, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the rule bites (fail-before): an unlisted statement, a listed one without the clause, the clause form", () => {
    const source = [
      "const a = await sql(db, `SELECT id FROM calibration_devices WHERE tenant_id = $1`, [t]);",
      "const { clause, bind: fb } = facilityClause(\"client_facility_id\", 2);",
      "const b = await sql(db, `SELECT id FROM calibration_records WHERE tenant_id = $1${clause}`, [t, ...fb]);",
      "const c = await sql(db, `SELECT id FROM vendors WHERE tenant_id = $1`, [t]);",
    ].join("\n");
    const found = statementsIn(source, "synthetic.ts");
    expect(offendersOf(found, scoped, {})).toEqual(["synthetic.ts#calibration_devices"]);
    expect(offendersOf(found, scoped, { "synthetic.ts#calibration_devices": {} })).toEqual([]);
    // A clause interpolated in a file that never calls the helper does not count.
    expect(offendersOf(statementsIn(source.replace("facilityClause(", "otherHelper("), "synthetic.ts"), scoped, {})).toEqual([
      "synthetic.ts#calibration_devices",
      "synthetic.ts#calibration_records",
    ]);
  });
});
