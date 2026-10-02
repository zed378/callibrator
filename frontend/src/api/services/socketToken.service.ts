// src/api/services/socketToken.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. The calls and the types are
// read off `paths` (src/api/generated/schema.d.ts, `npm run api:types`, from
// backend/src/routes/api/auth.openapi.ts); the exported names are unchanged, so
// no caller changed.
import { typedApi, unwrap, type DataOf, type Op } from "../typed";

// Backend route: POST /api/v1/auth/socket-token
// The app JWT lives in an httpOnly cookie that browser JS cannot read, so
// the socket.io handshake uses this short-lived token instead (fetched
// through the cookie-authenticated proxy like every other API call).

export type SocketToken = DataOf<Op<"/api/v1/auth/socket-token", "post">>;

export const socketTokenService = {
  getSocketToken: async (): Promise<SocketToken> => {
    const response = await typedApi
      .POST("/api/v1/auth/socket-token", {
        // As built: an empty JSON object is sent, though the contract reads no
        // body (the route ignores it). Kept so the request is unchanged.
        body: {} as never,
      })
      .then(unwrap);
    return response.data;
  },
};
