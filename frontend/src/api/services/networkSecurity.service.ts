import { typedApi, unwrap, type DataOf, type JsonBody, type Op } from "../typed";

/**
 * Network Security — tenant IP allowlisting and geofencing.
 *
 * The tenant is taken from the caller's JWT, so no tenantId is sent.
 * Backend: src/routes/api/networkSecurity.route.js (mounted /api/v1/network-security)
 *   GET  /ip-allowlist
 *   PUT  /ip-allowlist    (super admin)
 *   GET  /geofence
 *   PUT  /geofence        (super admin)
 *   POST /evaluate-login
 */

// ---------- Types ----------
// P9-25 (ADR-103 item 11): from the contract
// (backend/src/routes/api/networkSecurity.openapi.ts); the names are unchanged.

type NS = "/api/v1/network-security";
type Geo = `${NS}/geofence`;
type Evaluate = `${NS}/evaluate-login`;

/** Defaults to 50 km server-side when `radiusKm` is omitted on write. */
export type Geofence = NonNullable<DataOf<Op<Geo, "get">>["geofence"]>;

export type LoginEvaluation = DataOf<Op<Evaluate, "post">>;
/** `reason: "no_restrictions"` when the allowlist is empty. */
export type IpAllowlistCheck = LoginEvaluation["ip"];
/** `reason: "no_geofence"` when no geofence is configured. */
export type GeofenceCheck = LoginEvaluation["geofence"];

// ---------- Service ----------

export const networkSecurityService = {
  /** GET /api/v1/network-security/ip-allowlist — [] means unrestricted. */
  getIpAllowlist: async (): Promise<string[]> => {
    const response = await typedApi.GET("/api/v1/network-security/ip-allowlist").then(unwrap);
    return response.data.allowlist ?? [];
  },

  /**
   * PUT /api/v1/network-security/ip-allowlist — super admin only.
   * Replaces the whole list. An empty array removes all IP restrictions.
   */
  setIpAllowlist: async (cidrs: string[]): Promise<DataOf<Op<`${NS}/ip-allowlist`, "put">>> =>
    (await typedApi.PUT("/api/v1/network-security/ip-allowlist", { body: { cidrs } }).then(unwrap)).data,

  /** GET /api/v1/network-security/geofence — null when not configured. */
  getGeofence: async (): Promise<Geofence | null> => {
    const response = await typedApi.GET("/api/v1/network-security/geofence").then(unwrap);
    return response.data.geofence ?? null;
  },

  /**
   * PUT /api/v1/network-security/geofence — `network-security: write` (a tenant
   * administrator since Q-38, ADR-100). `currentLocation` is this device's
   * position: the server refuses (409 SELF_LOCKOUT) a geofence that does not
   * contain it, unless the caller is a platform operator.
   */
  setGeofence: async (
    latitude: number,
    longitude: number,
    radiusKm?: number,
    currentLocation?: { latitude: number; longitude: number },
  ): Promise<DataOf<Op<Geo, "put">>> => {
    const body: JsonBody<Op<Geo, "put">> = { latitude, longitude };
    // Omit rather than send undefined: the server applies its 50km default.
    if (radiusKm !== undefined) body.radiusKm = radiusKm;
    if (currentLocation !== undefined) body.currentLocation = currentLocation;
    return (await typedApi.PUT("/api/v1/network-security/geofence", { body }).then(unwrap)).data;
  },

  /**
   * POST /api/v1/network-security/evaluate-login
   * Dry-run both checks for a candidate IP/location.
   */
  evaluateLogin: async (ip: string, latitude?: number, longitude?: number): Promise<LoginEvaluation> => {
    const body: JsonBody<Op<Evaluate, "post">> = { ip };
    if (latitude !== undefined) body.latitude = latitude;
    if (longitude !== undefined) body.longitude = longitude;
    return (await typedApi.POST("/api/v1/network-security/evaluate-login", { body }).then(unwrap)).data;
  },
};

export default networkSecurityService;
