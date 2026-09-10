import { api } from "../client";

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

export interface Geofence {
  latitude: number;
  longitude: number;
  /** Defaults to 50 km server-side when omitted on write. */
  radiusKm: number;
}

export interface IpAllowlistCheck {
  allowed: boolean;
  /** "no_restrictions" when the allowlist is empty. */
  reason?: string;
  ip?: string;
  allowlist?: string[];
}

export interface GeofenceCheck {
  allowed: boolean;
  /** "no_geofence" when no geofence is configured. */
  reason?: string;
  distanceKm?: number;
  radiusKm?: number;
}

export interface LoginEvaluation {
  allowed: boolean;
  ip: IpAllowlistCheck;
  geofence: GeofenceCheck;
  /** True when either check failed — the caller should force step-up auth. */
  requiresStepUp: boolean;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const networkSecurityService = {
  /** GET /api/v1/network-security/ip-allowlist — [] means unrestricted. */
  getIpAllowlist: async (): Promise<string[]> => {
    const response = await api.get<BackendResponse<{ allowlist: string[] }>>(
      "/api/v1/network-security/ip-allowlist",
    );
    return response.data.allowlist ?? [];
  },

  /**
   * PUT /api/v1/network-security/ip-allowlist — super admin only.
   * Replaces the whole list. An empty array removes all IP restrictions.
   */
  setIpAllowlist: async (
    cidrs: string[],
  ): Promise<{ tenantId: string; allowlist: string[] }> => {
    const response = await api.put<
      BackendResponse<{ tenantId: string; allowlist: string[] }>
    >("/api/v1/network-security/ip-allowlist", { cidrs });
    return response.data;
  },

  /** GET /api/v1/network-security/geofence — null when not configured. */
  getGeofence: async (): Promise<Geofence | null> => {
    const response = await api.get<
      BackendResponse<{ geofence: Geofence | null }>
    >("/api/v1/network-security/geofence");
    return response.data.geofence ?? null;
  },

  /** PUT /api/v1/network-security/geofence — super admin only. */
  setGeofence: async (
    latitude: number,
    longitude: number,
    radiusKm?: number,
  ): Promise<{ tenantId: string; geofence: Geofence }> => {
    const body: Record<string, number> = { latitude, longitude };
    // Omit rather than send undefined: the server applies its 50km default.
    if (radiusKm !== undefined) body.radiusKm = radiusKm;
    const response = await api.put<
      BackendResponse<{ tenantId: string; geofence: Geofence }>
    >("/api/v1/network-security/geofence", body);
    return response.data;
  },

  /**
   * POST /api/v1/network-security/evaluate-login
   * Dry-run both checks for a candidate IP/location.
   */
  evaluateLogin: async (
    ip: string,
    latitude?: number,
    longitude?: number,
  ): Promise<LoginEvaluation> => {
    const body: Record<string, string | number> = { ip };
    if (latitude !== undefined) body.latitude = latitude;
    if (longitude !== undefined) body.longitude = longitude;
    const response = await api.post<BackendResponse<LoginEvaluation>>(
      "/api/v1/network-security/evaluate-login",
      body,
    );
    return response.data;
  },
};

export default networkSecurityService;
