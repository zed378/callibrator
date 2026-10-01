/**
 * P9-12 (ADR-087 Amendment 13) — a declaration file beside a still-JavaScript
 * module declares exactly that module's exports.
 *
 * Under `allowJs: false` a TypeScript module imports a JavaScript one through a
 * sibling `x.d.ts` (config/index.d.ts, services/redis.service.d.ts, ...). The
 * compiler trusts the declaration and never reads the `.js`, so an export added
 * to or removed from the JavaScript leaves the declaration silently wrong: a
 * removed function still type-checks and throws at run time. The first such
 * drift happened within an hour of the first declaration (audit.service gained
 * two constants). This guard compares, for every such pair, the keys the
 * declaration names with the keys `require()` of the JavaScript returns.
 *
 * It reads the declaration's shape the one way these files are written: a
 * `declare const <name>: { ... }` object type exported with `export = <name>`,
 * or top-level `export declare const/function` names.
 */
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

const SRC = path.join(__dirname, "../..");

/** Every `x.d.ts` under src/ (tests excluded) that sits beside an `x.js`. */
const declarationPairs = (): { dts: string; js: string }[] => {
  const pairs: { dts: string; js: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "tests" && entry.name !== "types") {
          walk(full);
        }
      } else if (entry.name.endsWith(".d.ts")) {
        const js = full.replace(/\.d\.ts$/, ".js");
        if (fs.existsSync(js)) {
          pairs.push({ dts: full, js });
        }
      }
    }
  };
  walk(SRC);
  return pairs;
};

/** The export names a declaration file declares. */
const declaredKeys = (file: string): string[] => {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const keys: string[] = [];
  let assigned: string | null = null;
  const objects = new Map<string, string[]>();
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement) && statement.isExportEquals && ts.isIdentifier(statement.expression)) {
      assigned = statement.expression.text;
    }
    if (ts.isVariableStatement(statement)) {
      const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) {
          continue;
        }
        if (exported) {
          keys.push(decl.name.text);
        }
        if (decl.type && ts.isTypeLiteralNode(decl.type)) {
          objects.set(
            decl.name.text,
            decl.type.members.flatMap((m) => (m.name && ts.isIdentifier(m.name) ? [m.name.text] : [])),
          );
        }
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (exported) {
        keys.push(statement.name.text);
      }
    }
  }
  return assigned ? (objects.get(assigned) ?? []) : keys;
};

describe("P9-12 — declaration files match the JavaScript they describe", () => {
  const pairs = declarationPairs();

  it("finds the declaration files (config/index, redis.service, audit.service at least)", () => {
    const names = pairs.map((p) => path.relative(SRC, p.dts).split(path.sep).join("/"));
    expect(names).toEqual(
      expect.arrayContaining(["config/index.d.ts", "services/redis.service.d.ts", "services/audit.service.d.ts"]),
    );
  });

  it.each(declarationPairs().map((p) => [path.relative(SRC, p.dts).split(path.sep).join("/"), p] as const))(
    "%s declares exactly the module's exports",
    (_name, { dts, js }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the JavaScript module itself, as require() returns it
      const mod = require(js) as object;
      // A module that exports a class INSTANCE (mfa.service: `new MfaService()`)
      // carries its methods on the prototype; they are part of what callers use.
      const proto: object | null = Object.getPrototypeOf(mod) as object | null;
      // A plain object's prototype IS Object.prototype, whose own prototype is null.
      // Compared structurally: under Jest the module's realm is not this file's.
      const isClassPrototype = proto !== null && Object.getPrototypeOf(proto) !== null && typeof mod !== "function";
      const inherited = isClassPrototype
        ? Object.getOwnPropertyNames(proto).filter((k) => k !== "constructor")
        : [];
      const actual = [...new Set([...Object.keys(mod), ...inherited])].sort();
      expect(declaredKeys(dts).sort()).toEqual(actual);
    },
  );

  it("bites: a declaration missing an export, or naming one that does not exist, differs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p912-"));
    const file = path.join(dir, "x.d.ts");
    fs.writeFileSync(file, "declare const x: {\n  a: () => void;\n  gone: number;\n};\nexport = x;\n");
    expect(declaredKeys(file).sort()).not.toEqual(["a", "b"]);
    expect(declaredKeys(file).sort()).toEqual(["a", "gone"]);
    fs.writeFileSync(file, "export declare const db: unknown;\nexport declare function Connection(): void;\n");
    expect(declaredKeys(file).sort()).toEqual(["Connection", "db"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
