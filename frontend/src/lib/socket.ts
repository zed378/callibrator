// src/lib/socket.ts
// Singleton socket.io client. Connects to the backend origin (not the Next
// proxy) using a short-lived handshake token from /api/v1/auth/socket-token —
// the app JWT lives in an httpOnly cookie that browser JS cannot read.

import { io, Socket } from "socket.io-client";
import { API_BASE_URL } from "@/constants";
import { socketTokenService } from "@/api/services/socketToken.service";

let socket: Socket | null = null;
let connecting: Promise<Socket | null> | null = null;
let refreshAttempts = 0;
const MAX_REFRESH_ATTEMPTS = 3;

/**
 * Lazily create (or return) the shared socket connection.
 * Returns null during SSR or when the token cannot be obtained.
 */
export const getSocket = async (): Promise<Socket | null> => {
  if (typeof window === "undefined") return null;
  if (socket) return socket;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const { token } = await socketTokenService.getSocketToken();

      socket = io(API_BASE_URL, {
        auth: { token },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 2000,
      });

      socket.on("connect", () => {
        refreshAttempts = 0;
      });

      // Handshake failures are most likely an expired short-lived token —
      // fetch a fresh one and retry, with a cap to avoid loops.
      socket.on("connect_error", async () => {
        if (!socket || refreshAttempts >= MAX_REFRESH_ATTEMPTS) return;
        refreshAttempts += 1;
        try {
          const fresh = await socketTokenService.getSocketToken();
          socket.auth = { token: fresh.token };
          socket.connect();
        } catch {
          // Token refresh failed (e.g. logged out) — leave it disconnected.
        }
      });

      return socket;
    } catch {
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
};

export const disconnectSocket = (): void => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  refreshAttempts = 0;
};
