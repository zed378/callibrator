// src/lib/socket.ts
// Singleton socket.io client. Connects to the backend origin (not the Next
// proxy) using a short-lived handshake token from /api/v1/auth/socket-token —
// the app JWT lives in an httpOnly cookie that browser JS cannot read.
//
// The singleton is per SESSION, not per page load (F-01). Sign-out and sign-in
// are client-side navigations, so this module outlives both; every sign-out
// path must call disconnectSocket() or the next user in the tab inherits a
// socket authenticated as — and joined to the rooms of — the previous one.

import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "@/constants";
import { socketTokenService } from "@/api/services/socketToken.service";

let socket: Socket | null = null;
let connecting: Promise<Socket | null> | null = null;
let refreshAttempts = 0;
// Bumped by disconnectSocket(). A connection that started under an earlier
// generation belongs to a session that has ended and must not be kept.
let generation = 0;
const MAX_REFRESH_ATTEMPTS = 3;

/**
 * Lazily create (or return) the shared socket connection.
 * Returns null during SSR, when the token cannot be obtained, or when the
 * session ended while the connection was being set up.
 */
export const getSocket = async (): Promise<Socket | null> => {
  if (typeof window === "undefined") return null;
  if (socket) return socket;
  if (connecting) return connecting;

  const startedIn = generation;

  connecting = (async () => {
    try {
      const { token } = await socketTokenService.getSocketToken();

      // Signed out while the token was in flight: do not open a connection
      // for a session that no longer exists.
      if (startedIn !== generation) return null;

      const created = io(API_BASE_URL, {
        auth: { token },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 2000,
      });

      created.on("connect", () => {
        refreshAttempts = 0;
      });

      // Handshake failures are most likely an expired short-lived token —
      // fetch a fresh one and retry, with a cap to avoid loops. Bound to THIS
      // socket: a late error on a socket from an ended session must never
      // re-authenticate the next session's socket.
      created.on("connect_error", async () => {
        if (socket !== created || refreshAttempts >= MAX_REFRESH_ATTEMPTS) {
          return;
        }
        refreshAttempts += 1;
        try {
          const fresh = await socketTokenService.getSocketToken();
          if (socket !== created) return;
          created.auth = { token: fresh.token };
          created.connect();
        } catch {
          // Token refresh failed (e.g. logged out) — leave it disconnected.
        }
      });

      socket = created;
      return created;
    } catch {
      return null;
    } finally {
      // A disconnect already cleared this slot; a newer session's attempt may
      // own it now, and must not be clobbered.
      if (startedIn === generation) connecting = null;
    }
  })();

  return connecting;
};

/**
 * Close the shared socket and forget it. Call on EVERY path that ends a
 * session (logout, exit impersonation, failed session restore) — before the
 * next principal can call getSocket().
 */
export const disconnectSocket = (): void => {
  generation += 1;
  connecting = null;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  refreshAttempts = 0;
};
