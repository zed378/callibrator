/** @type {import('jest').Config} */
require("dotenv").config({ path: ".env" });

// P9-03 / ADR-087 — TypeScript sources and tests are transformed by babel-jest
// with @babel/preset-typescript: types are ERASED, never checked (the check is
// `npm run typecheck`, TypeScript 7, which has no compiler API for a jest
// transform to call). @babel/plugin-transform-modules-commonjs emits exports
// as plain data properties (`exports.x = x`), the same shape tsc emits for
// the binary and module.exports had in the .js original — so jest.spyOn and
// jest.mock behave on a converted module exactly as they did before it was
// converted. @swc/jest (ADR-038's choice) emits non-configurable GETTERS
// instead, and every jest.spyOn on a converted export throws "Cannot redefine
// property" (ADR-087 records the probe). JavaScript stays untransformed.
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
  // A-257: fail once, clearly, on a Node major other than the root .nvmrc's.
  globalSetup: "<rootDir>/src/tests/setup/nodeMajor.globalSetup.js",
  testMatch: [
    "**/__tests__/**/*.js",
    "**/__tests__/**/*.ts",
    "**/tests/**/*.test.js",
    "**/tests/**/*.test.ts",
    "**/tests/**/*.spec.js",
    "**/tests/**/*.spec.ts",
  ],
  testPathIgnorePatterns: ["src/tests/e2e/", "/node_modules/"],
  verbose: true,
  forceExit: false,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: false,
  collectCoverage: true,
  collectCoverageFrom: [
    "src/app.js",
    "src/config/**/*.js",
    "src/config/**/*.ts",
    "src/constants/**/*.js",
    "src/constants/**/*.ts",
    "src/controllers/**/*.js",
    "src/controllers/**/*.ts",
    "src/middlewares/**/*.js",
    "src/middlewares/**/*.ts",
    "src/routes/**/*.js",
    "src/routes/**/*.ts",
    "src/services/**/*.js",
    "src/services/**/*.ts",
    "src/utils/**/*.js",
    "src/utils/**/*.ts",
    "src/validators/**/*.js",
    "src/validators/**/*.ts",
  ],
  coverageDirectory: "coverage",
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/tests/",
    "/__tests__/",
    "src/config/",
    "src/constants/",
    "src/docs/",
    "src/models/",
    "src/scripts/",
  ],
  coverageThreshold: {
    "global": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/validators/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/utils/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/middlewares/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/controllers/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/services/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    "./src/routes/": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  transform: { "^.+\\.ts$": TYPESCRIPT_TRANSFORM },
  transformIgnorePatterns: ["/node_modules/"],
  // A-99: otplib is NOT mapped to a mock any more. __mocks__/otplib.js invented
  // an `authenticator` export otplib 13 does not have, and accepted every
  // code, so MFA was broken in production behind a green suite. Note that a
  // file in <rootDir>/__mocks__/ named after a package mocks it for EVERY test
  // even without an entry here — deleting the entry alone changes nothing.
  //
  // otplib 13's CommonJS build requires ESM-only packages (@scure/base,
  // @noble/hashes). Jest loads them only with --experimental-vm-modules, which
  // the package.json test scripts pass; a bare `npx jest` on a suite that runs
  // the real otplib fails with "Must use import to load ES Module".
  //
  // A-116: uuid is NOT mocked globally any more. __mocks__/uuid.js and a
  // `^uuid$` mapping replaced the package for every require, Sequelize's
  // own included (it generates UUIDV1/UUIDV4 defaults through it), so every
  // UUIDV4 default in a unit run was one constant and UUIDV1 threw. uuid 14 is
  // ESM-only and loads under the same --experimental-vm-modules flag as
  // otplib. A test that needs a deterministic id mocks "uuid" in its own file
  // (jest.mock("uuid", ...)); do not add a file named uuid.js to
  // <rootDir>/__mocks__/, which would mock it for every test again.
  // Pinned by src/tests/models/uuidDefaults.a116.test.js.
  // "js" before "ts": a module is never both (scripts/build-dist.ts refuses
  // the build if one is), and the order keeps every existing resolution as it was.
  moduleFileExtensions: ["js", "ts", "json"],
  testTimeout: 10000,
};
