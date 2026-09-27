/** @type {import('jest').Config} */
require("dotenv").config({ path: ".env" });

// P9-03 / ADR-087 — the same TypeScript transform as jest.config.js (see the
// comment there), so the e2e suite keeps running when its first spec converts.
const TYPESCRIPT_TRANSFORM = [
  "babel-jest",
  {
    babelrc: false,
    configFile: false,
    presets: [["@babel/preset-typescript", { allowDeclareFields: true }]],
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  },
];

module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/e2e/**/*.test.js", "**/tests/e2e/**/*.test.ts"],
  testPathIgnorePatterns: [],
  verbose: true,
  forceExit: true,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: false,
  collectCoverage: false,
  transform: { "^.+\\.ts$": TYPESCRIPT_TRANSFORM },
  transformIgnorePatterns: ["/node_modules/"],
  // "js" before "ts": a module is never both (scripts/build-dist.ts refuses
  // the build if one is), and the order keeps every existing resolution as it was.
  moduleFileExtensions: ["js", "ts", "json"],
  testTimeout: 30000,
};
