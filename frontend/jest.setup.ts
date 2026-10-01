import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// `npm test` runs `jest --coverage` (F-03). Under coverage instrumentation, on a
// loaded machine, full-page suites that render a real hook + service chain
// (page.a156 backup restore, DataRetentionPage A-135) took longer than Testing
// Library's default 1000 ms for `findBy*` / `waitFor` and failed
// intermittently: 4 failures in 1 of 3 coverage runs on 2026-09-25, 0 in 3 runs
// without coverage. A longer ceiling only costs time when a test is failing
// anyway; it does not change what any assertion accepts.
configure({ asyncUtilTimeout: 5000 });

// P9-25 (ADR-103): the generated API client (src/api/typed.ts, openapi-fetch)
// builds WHATWG Request/Response objects, which jsdom does not provide. The
// browser and Node both have them; the jsdom test realm gets undici's, the
// implementation Node's own are built on. Only when absent.
if (typeof globalThis.Request === "undefined") {
  // undici expects the platform's text, stream and message primitives; jsdom lacks them too.
  /* eslint-disable @typescript-eslint/no-require-imports -- Node built-ins, test realm only */
  const { TextDecoder, TextEncoder } = require("node:util") as typeof import("node:util");
  const webStreams = require("node:stream/web") as typeof import("node:stream/web");
  const { MessageChannel, MessagePort } = require("node:worker_threads") as typeof import("node:worker_threads");
  const { Blob, File } = require("node:buffer") as typeof import("node:buffer");
  /* eslint-enable @typescript-eslint/no-require-imports */
  for (const [name, value] of Object.entries({
    TextDecoder, TextEncoder, MessageChannel, MessagePort, Blob, File,
    ReadableStream: webStreams.ReadableStream,
    WritableStream: webStreams.WritableStream,
    TransformStream: webStreams.TransformStream,
  })) {
    if (!(name in globalThis)) {
      Object.assign(globalThis, { [name]: value });
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a test-only polyfill, loaded only when needed
  const undici = require("undici") as typeof import("undici");
  Object.assign(globalThis, { Request: undici.Request, Response: undici.Response, Headers: undici.Headers });
}
