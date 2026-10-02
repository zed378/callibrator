/**
 * A-42 — no `console.*` in backend application code.
 *
 * `console.*` bypasses the winston logger: no JSON shape, no request id, and
 * no A-14 redactor, so a password or bearer token passed to it reaches stdout
 * verbatim. Application code logs through
 * `require("../middlewares/activityLog.middleware").logger`.
 *
 * This is a static scan of backend/src (tests excluded) and backend/index.js.
 * A NEW console use anywhere in that tree fails this suite unless it is added
 * to ALLOWED below, with a reason, in review. An allowed file must also carry
 * the in-file marker comment `A-42 console-allowed:` so the exception is
 * visible to whoever edits the file, not only to whoever reads this test.
 *
 * What is legitimately allowed: a CLI script run by hand in a terminal, whose
 * console output IS the operator's report. Nothing on the request path, the
 * boot path, a scheduler or a migration qualifies — the logger loads before
 * any of them (it requires only winston and a path helper).
 */

const fs = require("fs");
const path = require("path");

const BACKEND = path.resolve(__dirname, "../../..");
const SRC = path.join(BACKEND, "src");

/**
 * Reviewed exceptions: path relative to backend/, with the reason.
 * `pendingRemoval` marks dead code the owner has been asked to delete; it is
 * exempt from the marker comment because it is not to be edited, only removed.
 */
const ALLOWED = {
  "src/scripts/backfillEmbeddings.ts": { reason: "CLI: `tsx src/scripts/backfillEmbeddings.ts`" },
  "src/scripts/breakGlassMfaReset.ts": { reason: "CLI: break-glass MFA reset, run by an operator" },
  "src/scripts/migrateStorage.ts": { reason: "CLI: `npm run migrate:storage` progress report" },
  "src/scripts/rotateKeys.ts": { reason: "CLI: `npm run keys:rotate` report" },
  "src/scripts/seedDemo.ts": { reason: "CLI: `tsx src/scripts/seedDemo.ts` summary" },
  "src/scripts/verifySchema.ts": { reason: "CLI: `npm run migrate:verify` report" },
  "src/utils/checkMenu.util.js": {
    reason:
      "debug dump with no caller (A-18); deletion was not permitted in the A-42 change and is left to the owner",
    pendingRemoval: true,
  },
};

const MARKER = "A-42 console-allowed:";

/**
 * Remove comments while keeping string and template literals intact, so that
 * `// console.log(x)` is not a use but `"a // b"; console.log(x)` still is.
 * Regex literals are not modelled; a `//` inside one only shortens what is
 * scanned on that line, which errs towards a false negative on that line alone.
 */
const stripComments = (source) =>
  source.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, literal) => (literal !== undefined ? literal : match.replace(/[^\n]/g, " ")),
  );

/** Every reference to the global `console` object, as 1-based line numbers. */
const findConsoleUses = (source) => {
  const code = stripComments(source);
  const lines = [];
  const re = /(^|[^.\w$])console\b(?!\s*:)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const at = m.index + m[1].length;
    lines.push(code.slice(0, at).split("\n").length);
  }
  return lines;
};

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === path.join(SRC, "tests")) {
        continue;
      }
      walk(full, out);
    } else if (/\.(c|m)?[jt]s$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

const rel = (file) => path.relative(BACKEND, file).split(path.sep).join("/");

const scanned = () =>
  [...walk(SRC), path.join(BACKEND, "index.ts")].map((file) => ({
    file: rel(file),
    source: fs.readFileSync(file, "utf8"),
  }));

describe("A-42: console.* guard", () => {
  describe("the detector", () => {
    it("flags every form of reaching the console", () => {
      expect(findConsoleUses('console.log("x");')).toEqual([1]);
      expect(findConsoleUses("a();\n  console.error(err);")).toEqual([2]);
      expect(findConsoleUses('console["warn"]("x");')).toEqual([1]);
      expect(findConsoleUses("const { info } = console;")).toEqual([1]);
      expect(findConsoleUses("const c = console; c.debug(1);")).toEqual([1]);
      expect(findConsoleUses('const s = "// not a comment"; console.table(t);')).toEqual([1]);
      expect(findConsoleUses("x();/* a */console.dir(o);")).toEqual([1]);
    });

    it("does not flag comments, other identifiers or object keys", () => {
      expect(findConsoleUses("// console.log(x)")).toEqual([]);
      expect(findConsoleUses("/* console.warn(x)\n console.error(y) */")).toEqual([]);
      expect(findConsoleUses("/**\n * reported (console.warn) in a JSDoc line\n */")).toEqual([]);
      expect(findConsoleUses("const consoleTransport = new transports.Console();")).toEqual([]);
      expect(findConsoleUses("logger.console = 1; x.console.log(1);")).toEqual([]);
      expect(findConsoleUses("const opts = { console: false };")).toEqual([]);
    });
  });

  it("no console.* in backend/src (tests excluded) or backend/index.js outside the reviewed allow-list", () => {
    const offenders = [];
    for (const { file, source } of scanned()) {
      if (ALLOWED[file]) {
        continue;
      }
      for (const line of findConsoleUses(source)) {
        offenders.push(`${file}:${line}`);
      }
    }
    // Log through the winston logger instead (activityLog.middleware).
    expect(offenders).toEqual([]);
  });

  it("every allow-list entry still exists and still uses the console (no stale exceptions)", () => {
    const byFile = new Map(scanned().map((s) => [s.file, s.source]));
    for (const file of Object.keys(ALLOWED)) {
      expect({ file, exists: byFile.has(file) }).toEqual({ file, exists: true });
      expect({ file, uses: findConsoleUses(byFile.get(file)).length > 0 }).toEqual({
        file,
        uses: true,
      });
    }
  });

  it("every allowed file carries the in-file marker comment, unless it is pending removal", () => {
    const byFile = new Map(scanned().map((s) => [s.file, s.source]));
    const unmarked = Object.entries(ALLOWED)
      .filter(([, entry]) => !entry.pendingRemoval)
      .filter(([file]) => !byFile.get(file).includes(MARKER))
      .map(([file]) => file);
    expect(unmarked).toEqual([]);
  });

  it("every allowed file that is not pending removal is a CLI script under src/scripts", () => {
    const misplaced = Object.entries(ALLOWED)
      .filter(([, entry]) => !entry.pendingRemoval)
      .filter(([file]) => !file.startsWith("src/scripts/"))
      .map(([file]) => file);
    expect(misplaced).toEqual([]);
  });
});
