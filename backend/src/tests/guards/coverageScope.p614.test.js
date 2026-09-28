/**
 * P6-14 — the coverage figure's scope is what jest.config.js says it is.
 *
 * `collectCoverageFrom` named `src/app.js`, which does not exist: a pattern
 * that matches nothing reads as coverage of something. And "100%" was quoted
 * as if it were the whole backend, when the ignore list removes config,
 * constants, docs, models and scripts, and the entry point is not collected.
 *
 * This pins both: every collected pattern matches a real file, and the layers
 * outside the figure are exactly the ones docs/BACKEND/09-TESTING.md
 * § "What 100% covers" lists — widening the exclusions fails here first.
 */
const fs = require("fs");
const path = require("path");
const config = require("../../../jest.config");

const ROOT = path.join(__dirname, "..", "..", "..");

describe("P6-14 — the coverage scope", () => {
  it("every collectCoverageFrom pattern of the JavaScript tree matches at least one file (no phantom src/app.js)", () => {
    const empty = config.collectCoverageFrom
      .filter((pattern) => pattern.endsWith(".js"))
      .filter((pattern) => fs.globSync(pattern, { cwd: ROOT }).length === 0);
    expect(empty).toEqual([]);
    expect(config.collectCoverageFrom).not.toContain("src/app.js");
  });

  it("the entry point index.js is outside the figure, and says why", () => {
    expect(config.collectCoverageFrom.some((p) => p.includes("index.js"))).toBe(false);
    const source = fs.readFileSync(path.join(ROOT, "jest.config.js"), "utf8");
    expect(source).toMatch(/backend\/index\.js`, is NOT measured/);
    expect(source).toMatch(/liveContract\.smoke\.test\.js/);
    expect(fs.existsSync(path.join(ROOT, "src/tests/e2e/liveContract.smoke.test.js"))).toBe(true);
  });

  it("the excluded layers are exactly the documented five — widening them is a reviewed change", () => {
    const layers = config.coveragePathIgnorePatterns.filter((p) => p.startsWith("src/"));
    expect(layers.sort()).toEqual(["src/config/", "src/constants/", "src/docs/", "src/models/", "src/scripts/"]);
    const doc = fs.readFileSync(path.join(ROOT, "..", "docs", "BACKEND", "09-TESTING.md"), "utf8");
    for (const layer of layers) {
      expect(doc).toContain(`\`${layer}\``);
    }
  });

  it("the threshold is 100% on the six measured layers and globally", () => {
    const expected = { branches: 100, functions: 100, lines: 100, statements: 100 };
    for (const key of ["global", "./src/controllers/", "./src/middlewares/", "./src/routes/", "./src/services/", "./src/utils/", "./src/validators/"]) {
      expect(config.coverageThreshold[key]).toEqual(expected);
    }
  });
});
