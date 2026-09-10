// src/utils/packaged.util.js
//
// Single source of truth for "am I running as a compiled single-file binary?".
// Two packagers are supported:
//   - @yao-pkg/pkg (and legacy Vercel pkg): sets `process.pkg`.
//   - `bun build --compile`: does NOT set `process.pkg`. Instead the executable
//     itself is the app binary, so `process.execPath` is NOT the bun/node
//     launcher. Under `bun run index.js` in dev, execPath ends in `bun(.exe)`,
//     so we correctly stay "not packaged".
//
// Kept dependency-free (only reads `process`/`Bun`) so it can be required before
// dotenv runs in env.util.js.

const execPath = process.execPath || "";
// True when the process was launched via the `bun` or `node` CLI (i.e. dev),
// as opposed to a self-contained compiled binary.
const launchedByRuntime = /[\\/](bun|node)(\.exe)?$/i.test(execPath);

const isPackaged =
  !!process.pkg || (typeof Bun !== "undefined" && !launchedByRuntime);

module.exports = { isPackaged };
