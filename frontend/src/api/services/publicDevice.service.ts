import { typedApi, unwrap, type DataOf, type Op } from "../typed";

/**
 * P22-08 — a device's public link, for staff (ADR-138 § 1, Am. 1 § 6; spec
 * MEMORY/specs/P19-07-public-device-page.md § 6, as built by P21-08). Every call is on the GENERATED
 * client.
 *
 *  - `GET /calibration-devices/:id/public-token` — the link's state and the tenant's page setting;
 *    never the token or its hash.
 *  - `POST …/public-token` — issue (409 `PUBLIC_TOKEN_ACTIVE` when one is active); the answer is the
 *    ONLY time the token is shown.
 *  - `POST …/public-token/rotate` — revoke the active one and issue a new one (409 `PUBLIC_TOKEN_NONE`).
 *  - `DELETE …/public-token` — revoke (409 `PUBLIC_TOKEN_NONE`).
 *
 * Unbound staff only: a facility-bound account is refused by the server (403 FACILITY_ROUTE_REFUSED),
 * and the page offers it nothing.
 */
type LinkPath = "/api/v1/calibration-devices/{calibrationDeviceId}/public-token";

export type PublicLinkState = DataOf<Op<LinkPath, "get">>;
export type IssuedPublicLink = DataOf<Op<LinkPath, "post">>;

const path = (calibrationDeviceId: string) => ({ params: { path: { calibrationDeviceId } } });

export const publicDeviceService = {
  state: async (calibrationDeviceId: string): Promise<PublicLinkState> =>
    (await typedApi.GET("/api/v1/calibration-devices/{calibrationDeviceId}/public-token", path(calibrationDeviceId)).then(unwrap)).data,

  issue: async (calibrationDeviceId: string): Promise<IssuedPublicLink> =>
    (await typedApi.POST("/api/v1/calibration-devices/{calibrationDeviceId}/public-token", path(calibrationDeviceId)).then(unwrap)).data,

  rotate: async (calibrationDeviceId: string): Promise<IssuedPublicLink> =>
    (await typedApi.POST("/api/v1/calibration-devices/{calibrationDeviceId}/public-token/rotate", path(calibrationDeviceId)).then(unwrap)).data,

  revoke: async (calibrationDeviceId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/calibration-devices/{calibrationDeviceId}/public-token", path(calibrationDeviceId)).then(unwrap);
  },
};
