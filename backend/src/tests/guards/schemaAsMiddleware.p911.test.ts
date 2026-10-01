/**
 * P9-11 (ADR-093) — a request schema is used as Express middleware only through
 * `validate(schema)`.
 *
 * Passing a schema's own method to a router — `schema.parse`, `safeParse`,
 * `parseAsync`, `safeParseAsync`, or the old library's `validate` — calls it with
 * `(req, res, next)`: it throws (a 500 on every request, as the old library's did, the
 * CLAUDE.md trap) or answers nothing. In a `.ts` route that is a type error
 * (TS2769). The routes are `.js` until P9-21, so until then this source guard
 * holds them to the same rule: no such member expression may be an argument of
 * a `router.<verb>(…)` / `router.use(…)` call.
 */
import fs from "node:fs";
import path from "node:path";

const ROUTES_DIR = path.join(__dirname, "..", "..", "routes");
const FORBIDDEN = /\.(parse|safeParse|parseAsync|safeParseAsync|validate|validateAsync)\s*[,)]/;

const listSources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSources(full);
    }
    return /\.(js|ts)$/.test(entry.name) ? [full] : [];
  });

/**
 * The argument lists of every `<ident>.(get|post|put|patch|delete|all|use)(…)`
 * call in a source file, comments removed, balanced on parentheses.
 *
 * @param source - a route module's text
 * @returns each call's text
 */
const routerCalls = (source: string): string[] => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const calls: string[] = [];
  const opener = /\b[A-Za-z_$][\w$]*\.(get|post|put|patch|delete|all|use)\s*\(/g;
  for (let m = opener.exec(code); m; m = opener.exec(code)) {
    let depth = 1;
    let i = opener.lastIndex;
    while (i < code.length && depth > 0) {
      const c = code.charAt(i);
      if (c === "(") {
        depth++;
      } else if (c === ")") {
        depth--;
      }
      i++;
    }
    calls.push(code.slice(m.index, i));
  }
  return calls;
};

/**
 * @param call - one router call's text
 * @returns whether a schema method is passed as a handler (not called)
 */
const passesSchemaMethod = (call: string): boolean => {
  // Only the call's own arguments, with nested calls' argument lists blanked,
  // so `validate(schema)` or `foo.parse(x)` inside an argument does not count.
  const inner = call.slice(call.indexOf("(") + 1, -1);
  let flat = "";
  let depth = 0;
  for (const c of inner) {
    if (c === "(") {
      depth++;
    }
    if (depth === 0) {
      flat += c;
    }
    if (c === ")") {
      depth--;
    }
  }
  return FORBIDDEN.test(`${flat})`);
};

describe("P9-11 — schemas reach Express only through validate(schema)", () => {
  const files = listSources(ROUTES_DIR);

  it("finds the route modules (a guard that reads nothing proves nothing)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no route passes a schema's own method as a handler", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const call of routerCalls(fs.readFileSync(file, "utf8"))) {
        if (passesSchemaMethod(call)) {
          offenders.push(`${path.basename(file)}: ${call.slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("bites: the trap shapes are caught, and validate(schema) is not", () => {
    const flagged = [
      'router.post("/a", auth, schema.parse, ctrl.create);',
      'router.put("/b", createSchema.safeParse, h);',
      'router.post("/c", addDomain.validate, h)',
      "router.use(x.parseAsync)",
    ];
    for (const source of flagged) {
      expect({ source, caught: routerCalls(source).some(passesSchemaMethod) }).toEqual({ source, caught: true });
    }
    const clean = [
      'router.post("/a", auth, validate(schema), ctrl.create);',
      'router.post("/b", validate(schema, { from: ["params", "body"] }), h);',
      'router.get("/c", (req, res) => res.json(schema.parse(req.query)));',
      "// router.post('/d', schema.parse, h);",
    ];
    for (const source of clean) {
      expect({ source, caught: routerCalls(source).some(passesSchemaMethod) }).toEqual({ source, caught: false });
    }
  });
});
