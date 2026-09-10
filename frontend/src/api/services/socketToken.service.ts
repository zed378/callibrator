import { api } from "../client";

// Backend route: POST /api/v1/auth/socket-token
// The app JWT lives in an httpOnly cookie that browser JS cannot read, so
// the socket.io handshake uses this short-lived token instead (fetched
// through the cookie-authenticated proxy like every other API call).

export interface SocketToken {
  token: string;
  expiresIn: number; // seconds
}

export const socketTokenService = {
  getSocketToken: async (): Promise<SocketToken> => {
    const response = await api.post<{
      success: boolean;
      status: number;
      message: string;
      data: SocketToken;
    }>("/api/v1/auth/socket-token", {});
    return response.data;
  },
};
