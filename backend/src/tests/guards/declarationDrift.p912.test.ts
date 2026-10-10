/**
 * P9-12 (ADR-087 Amendment 13) — a declaration file beside a still-JavaScript
 * module declares exactly that module's exports.
 *
 * Under `allowJs: false` a TypeScript module imports a JavaScript one through a
 * sibling `x.d.ts` (config/index.d.ts, config/socket.d.ts, ...). The
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

  // P9-21 (2026-10-01): the config/ twins are all gone (index, migrator, socket converted), so the
  // walker is checked against an independent scan rather than a list of names that will empty out:
  // every declaration file outside types/ and tests/ must sit beside its .js. One left behind a
  // converted module would describe a module that no longer exists, and drift unseen.
  it("sees every declaration twin, and none is left behind a converted module", () => {
    const names = pairs.map((p) => path.relative(SRC, p.dts).split(path.sep).join("/"));
    const onDisk = (fs.readdirSync(SRC, { recursive: true }) as string[])
      .map((f) => f.split(path.sep).join("/"))
      .filter((f) => f.endsWith(".d.ts") && !/^(tests|types)\//.test(f));
    expect(onDisk.filter((f) => !names.includes(f))).toEqual([]);
    expect([...names].sort()).toEqual([...onDisk].sort());
  });

  /** null when the declaration names exactly the module's exports; otherwise both key lists. */
  const driftOf = ({ dts, js }: { dts: string; js: string }): { declared: string[]; actual: string[] } | null => {
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
    const declared = declaredKeys(dts).sort();
    return JSON.stringify(declared) === JSON.stringify(actual) ? null : { declared, actual };
  };

  // P9-24 (2026-10-02): every twin went once its module converted, and noSourceJs.p924 refuses
  // a new source .js, so a twin can only reappear by mistake. The table used to fall back to an
  // `it.skip.each` placeholder when empty (2026-10-10, owner: no test is skipped); the two cases
  // below run always. A twin that reappears fails the first by name, and the second says how it
  // differs from its module.
  const twinNames = pairs.map((p) => path.relative(SRC, p.dts).split(path.sep).join("/"));

  it("no declaration twin is left under src/ (every described module converted to TypeScript)", () => {
    expect(twinNames).toEqual([]);
  });

  it("every declaration twin, if one exists, declares exactly its module's exports", () => {
    const drift = pairs.flatMap((p) => {
      const d = driftOf(p);
      return d ? [{ dts: path.relative(SRC, p.dts), ...d }] : [];
    });
    expect(drift).toEqual([]);
  });

  it("bites: the export comparison reports a module whose declaration has drifted, and passes a matching one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p912-pair-"));
    try {
      const js = path.join(dir, "m.js");
      const dts = path.join(dir, "m.d.ts");
      fs.writeFileSync(js, "module.exports = { a() {}, b: 1 };\n");
      fs.writeFileSync(dts, "declare const m: {\n  a: () => void;\n  b: number;\n};\nexport = m;\n");
      expect(driftOf({ dts, js })).toBeNull();
      fs.writeFileSync(dts, "declare const m: {\n  a: () => void;\n  gone: number;\n};\nexport = m;\n");
      expect(driftOf({ dts, js })).toEqual({ declared: ["a", "gone"], actual: ["a", "b"] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

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
