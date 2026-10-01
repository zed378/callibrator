/**
 * V-05 guard — who may authorize an API key, and which controllers bypass the
 * API-key chokepoint.
 *
 * utils/controllerWrapper refuses an API-key principal unless a gate set
 * `req.apiKeyAuthorized = true` (A-03). The review found the designated
 * opt-in, auth.middleware#allowApiKey, exported with no call site while the
 * one consumer (SCIM) open-coded the flag, and the wrapper's comment
 * miscounting the controllers that bypass it. `allowApiKey` is removed
 * (an unconditional opt-in authorizes a key without checking anything about
 * it); this file makes the remaining claims defend themselves:
 *
 *  1. exactly two source files write `apiKeyAuthorized = true`:
 *     dynamicAccess (scope check) and scim.route (the `scim` scope);
 *  2. auth.middleware exports no `allowApiKey`, and every middleware it
 *     exports has a call site outside the tests;
 *  3. the controllers that do not go through controllerWrapper are exactly
 *     the reviewed list.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../..");
const BACKEND = path.resolve(SRC, "..");

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return full === path.join(SRC, "tests") ? [] : sourceFiles(full);
    }
    return /\.(c|m)?(j|t)s$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");
const read = (file: string): string => fs.readFileSync(file, "utf8");

/** The reviewed writers of `apiKeyAuthorized = true`. */
const AUTHORIZERS = ["middlewares/dynamicAccess.middleware.js", "routes/api/scim.route.js"];

/** Controllers not wrapped by controllerWrapper, each reviewed (controllerWrapper.util.ts comment). */
const UNWRAPPED_CONTROLLERS = ["health.controller.js", "predictiveMaintenance.controller.js"];

describe("V-05 — API-key authorization", () => {
  it("exactly the reviewed gates set apiKeyAuthorized = true", () => {
    const writers = sourceFiles(SRC)
      .filter((file) => /apiKeyAuthorized\s*=\s*true/.test(read(file)))
      .map(rel)
      .sort();
    expect(writers).toEqual([...AUTHORIZERS].sort());
  });

  it("auth.middleware exports no allowApiKey", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the middleware is JavaScript (CommonJS)
    const auth = require("../../middlewares/auth.middleware") as Record<string, unknown>;
    expect(auth["allowApiKey"]).toBeUndefined();
  });

  it("every middleware auth.middleware exports has a call site outside the tests", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the middleware is JavaScript (CommonJS)
    const auth = require("../../middlewares/auth.middleware") as Record<string, unknown>;
    const middlewares = Object.keys(auth).filter((name) => typeof auth[name] === "function");
    const others = [...sourceFiles(SRC), path.join(BACKEND, "index.js")]
      .filter((file) => !file.endsWith(path.join("middlewares", "auth.middleware.js")))
      .map(read);
    const unused = middlewares.filter((name) => !others.some((text) => new RegExp(String.raw`\b${name}\b`).test(text)));
    expect(middlewares.length).toBeGreaterThan(0);
    expect(unused).toEqual([]);
  });

  it("the controllers that bypass controllerWrapper are exactly the reviewed list", () => {
    const dir = path.join(SRC, "controllers");
    const unwrapped = fs
      .readdirSync(dir)
      .filter((name) => /\.(j|t)s$/.test(name) && !name.endsWith(".d.ts"))
      .filter((name) => !/asyncHandler|controllerWrapper/.test(read(path.join(dir, name))))
      .sort();
    expect(unwrapped).toEqual([...UNWRAPPED_CONTROLLERS].sort());
  });
});
