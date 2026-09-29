// src/utils/packaged.util.ts
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
//
// P9-03 canary (ADR-087): converted from packaged.util.js with no behaviour
// change. `process.pkg` is typed in src/types/node-process.d.ts; `Bun` is
// declared here because this is its only reader. Neither emits anything.

/** Bun's global object — present only under the Bun runtime. */
declare const Bun: unknown;

const execPath = process.execPath || "";
// True when the process was launched via the `bun` or `node` CLI (i.e. dev),
// as opposed to a self-contained compiled binary.
const launchedByRuntime = /[\\/](bun|node)(\.exe)?$/i.test(execPath);

export const isPackaged: boolean =
  !!process.pkg || (typeof Bun !== "undefined" && !launchedByRuntime);
