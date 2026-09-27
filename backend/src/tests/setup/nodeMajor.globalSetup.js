/**
 * A-257 — refuse to run the backend unit suite on the wrong Node major.
 *
 * The project targets Node 26 (ADR-076: both Dockerfiles, CI's NODE_VERSION,
 * the pkg binary and the repository root .nvmrc). On another major the suite
 * does not fail cleanly: under Node 22 the ESM-only dependencies of otplib 13
 * and uuid 14 cannot be loaded even with --experimental-vm-modules, and dozens
 * of suites fail with "Must use import to load ES Module" — which reads like a
 * code defect. This turns any major mismatch into one clear message before any
 * suite runs.
 *
 * The required major is read from the root .nvmrc, the single source of truth;
 * src/tests/guards/nodeVersion.a257.test.js keeps every other pin in step.
 */

const fs = require("fs");
const path = require("path");

const NVMRC = path.resolve(__dirname, "../../../../.nvmrc");

/**
 * @param {string} [file]
 * @returns {number} the Node major the repository pins
 */
const requiredNodeMajor = (file = NVMRC) => {
  const raw = fs.readFileSync(file, "utf8").trim();
  const major = Number.parseInt(raw.replace(/^v/, "").split(".")[0], 10);
  if (!Number.isInteger(major)) {
    throw new Error(`A-257: ${file} does not name a Node major version: "${raw}"`);
  }
  return major;
};

/**
 * @param {string} [version] - a Node version string, e.g. process.versions.node
 * @param {number} [required]
 * @throws {Error} when the major differs from the pinned one
 */
const checkNodeMajor = (version = process.versions.node, required = requiredNodeMajor()) => {
  const major = Number.parseInt(String(version).replace(/^v/, "").split(".")[0], 10);
  if (major !== required) {
    throw new Error(
      `A-257: the backend tests need Node ${required} (pinned by the repository root .nvmrc), ` +
        `but this is Node ${version}. Switch first — \`nvm use\` (or fnm/volta) at the repository ` +
        "root — then run the suite through the npm scripts (npm test). On another major the " +
        'ESM-only dependencies fail with "Must use import to load ES Module", which is not a ' +
        "code defect.",
    );
  }
};

module.exports = async () => {
  checkNodeMajor();
};
module.exports.checkNodeMajor = checkNodeMajor;
module.exports.requiredNodeMajor = requiredNodeMajor;
