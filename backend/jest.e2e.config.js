/** @type {import('jest').Config} */
require("dotenv").config({ path: ".env" });

module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/e2e/**/*.test.js"],
  testPathIgnorePatterns: [],
  verbose: true,
  forceExit: true,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: false,
  collectCoverage: false,
  transform: {},
  transformIgnorePatterns: ["/node_modules/"],
  moduleFileExtensions: ["js", "json"],
  testTimeout: 30000,
};
