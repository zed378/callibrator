/**
 * The jest transform for backend TypeScript (P9-03, ADR-087 amendment of
 * 2026-09-28).
 *
 * WHY NOT babel-jest: babel-jest 30 requires the ROOT `@babel/core`, which is
 * 7.29.7 (the frontend's), while the backend's presets are Babel 8 (ADR-076).
 * Babel 7's parser puts a call's type arguments under `typeParameters`; Babel
 * 8's TypeScript plugin strips `typeArguments`. So `new AsyncLocalStorage<T>()`
 * reached jest with `<T>` still in it — a SyntaxError on the first converted
 * module that wrote an explicit type argument (tenantContext.middleware.ts).
 * This transformer runs the BACKEND's own `@babel/core` 8 with the same
 * presets, so parser and plugin agree.
 *
 * Coverage: `canInstrument` is not declared, so jest instruments the output
 * itself (babel-plugin-istanbul), mapped back through the source map returned
 * here. Types are erased, never checked — `npm run typecheck` checks them.
 *
 * This is jest tooling beside jest.config.js, not application code; the
 * TypeScript ratchet does not count backend-root tool files (scripts/ts-ratchet.ts).
 */
const crypto = require("crypto");
const babel = require("@babel/core");

const OPTIONS = {
  babelrc: false,
  configFile: false,
  presets: ["@babel/preset-typescript"],
  plugins: ["@babel/plugin-transform-modules-commonjs"],
  sourceMaps: "both",
};

module.exports = {
  process(sourceText, sourcePath) {
    const result = babel.transformSync(sourceText, { ...OPTIONS, filename: sourcePath });
    return { code: result.code, map: result.map };
  },
  getCacheKey(sourceText, sourcePath, { configString }) {
    return crypto
      .createHash("sha256")
      .update(babel.version)
      .update("\0")
      .update(sourcePath)
      .update("\0")
      .update(sourceText)
      .update("\0")
      .update(configString)
      .digest("hex");
  },
};
