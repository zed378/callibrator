/**
 * P9-21 — the A-58 boot check (`utils/authorizationWiring.util#collectRouteGates`)
 * must see a converted route's gates, in the source tree AND in the built one.
 *
 * Before this, the scan walked `.js` files only (a converted `.route.ts` was
 * invisible in the source tree) and matched `dynamicAccess(` as written (the
 * TypeScript 7 emit in `dist/`, `(0, x.dynamicAccess)(...)`, was invisible
 * there): with warehouse and stock converted, the boot check validated 149
 * gates instead of 173 and said nothing.
 *
 * 1. Which files are route sources: `.js`, `.ts`; never `.d.ts` or `*.openapi.ts`.
 * 2. PARITY: every `.ts` route file under src/routes, compiled to CommonJS the
 *    way the build compiles it, yields the same gates (names, order, count) as
 *    its source. A scanner that misses the emitted form fails here.
 */
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { collectRouteGates, parseGates } from "../../utils/authorizationWiring.util";

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const ROUTES = path.join(__dirname, "..", "..", "routes");

/** Every file under a directory, recursively. */
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

/** A gate's identity, independent of the line it sits on. */
const shapeOf = (gates: ReturnType<typeof parseGates>): string[] =>
  gates.map((g) => `${JSON.stringify(g.names)} requireAll=${String(g.requireAll)}`);

describe("P9-21 — the route-gate scan reads converted routes", () => {
  it("scans .js and .ts route sources, and neither declarations nor *.openapi.ts contracts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p921-routes-"));
    try {
      const gate = 'router.get("/", auth, dynamicAccess("warehouse", "read"), handler);\n';
      fs.writeFileSync(path.join(dir, "a.route.js"), gate);
      fs.writeFileSync(path.join(dir, "b.route.ts"), gate);
      fs.writeFileSync(path.join(dir, "c.middleware.d.ts"), "export declare function dynamicAccess(x: string): void;\n" + gate);
      fs.writeFileSync(path.join(dir, "b.openapi.ts"), gate);
      fs.writeFileSync(path.join(dir, "notes.md"), gate);
      const files = collectRouteGates(dir).map((g) => path.basename(g.file));
      expect(files.sort()).toEqual(["a.route.js", "b.route.ts"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads the call as TypeScript emits it: (0, x.dynamicAccess)(...)", () => {
    const emitted =
      'router.get("/", auth_middleware_1.auth, (0, dynamicAccess_middleware_1.dynamicAccess)("warehouse", "read"), h);\n' +
      'router.post("/", (0, dynamicAccess_middleware_1.dynamicAccess)(["vendors", "warehouse"], "write", { requireAll: true }), h);\n' +
      // An imported constant, as emitted (qms.route.ts: `dynamicAccess(MENU_SLUGS.QMS, "read")`).
      'router.get("/nc", (0, dynamicAccess_middleware_1.dynamicAccess)(constants_1.MENU_SLUGS.QMS, "read"), h);\n';
    expect(shapeOf(parseGates(emitted, "x.route.js"))).toEqual([
      '["warehouse"] requireAll=false',
      '["vendors","warehouse"] requireAll=true',
      '["qms"] requireAll=false',
    ]);
  });

  it("PARITY: every .ts route file yields the same gates compiled as in source", () => {
    const tsRoutes = walk(ROUTES).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.endsWith(".openapi.ts"),
    );
    // Not vacuous: the converted routes exist (warehouse and stock carry dynamicAccess gates).
    expect(tsRoutes.length).toBeGreaterThan(0);
    let gates = 0;
    for (const file of tsRoutes) {
      const source = fs.readFileSync(file, "utf8");
      const emitted = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText;
      const inSource = shapeOf(parseGates(source, file));
      expect([path.basename(file), shapeOf(parseGates(emitted, file))]).toEqual([path.basename(file), inSource]);
      gates += inSource.length;
    }
    expect(gates).toBeGreaterThanOrEqual(24);
  });
});
