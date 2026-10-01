/**
 * Types for `src/config/socket.js`, which is still JavaScript. Written for
 * P9-18 (ADR-087 Amendment 13), following the `config/index.d.ts` and
 * `services/redis.service.d.ts` precedent: the release build compiles with
 * `allowJs: false`, so a `.ts` module (first `notification.service`) cannot
 * import a `.js` one without declared types. TypeScript resolves
 * `../config/socket` to this file; Node resolves it to `socket.js`. This file
 * emits nothing and is never copied into `dist/`.
 *
 * It declares exactly the keys socket.js exports (`exports.x = ...`), typed
 * from its code; declarationDrift.p912 fails when the two differ. It is
 * deleted when socket.js converts; until then a change to that module's
 * exports must change this file too.
 */
import type { Server as HttpServer } from "http";
import type { Server } from "socket.io";

declare const socket: {
  /** Creates the Socket.IO server on `server` (CORS, Redis adapter, handshake gate, rooms) and returns it. */
  initSocket: (server: HttpServer) => Server;
  /** The server `initSocket` created; throws "Socket.io is not initialized!" before that. */
  getIo: () => Server;
  /** Best-effort emit to a kanban board's room; never throws. */
  emitToBoard: (projectId: unknown, event: string, payload?: unknown) => void;
  /** The handshake gate, CORS policy and helpers, exported for their tests only. */
  __testables: Record<string, unknown>;
};
export = socket;
