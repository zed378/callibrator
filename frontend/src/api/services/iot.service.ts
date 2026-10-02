// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the contract's
// (backend/src/routes/api/iot.openapi.ts). The exported names are unchanged.
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";

/**
 * IoT device provisioning (A-29, A-46) — Node `/api/v1/iot/devices/:deviceId`.
 *
 * The ingest token is returned ONCE, by `issueToken`, and never again: the
 * server stores only its SHA-256 hash, and `getConfig` reports `hasToken`.
 */

/** Bounds for one metric; a reading below `min` or above `max` is an anomaly. */
export type IotConfig = components["schemas"]["DeviceIotConfig"];
export type IssuedToken = DataOf<Op<"/api/v1/iot/devices/{deviceId}/token", "post">>;
export type IotConfigUpdate = JsonBody<Op<"/api/v1/iot/devices/{deviceId}", "patch">>;

/** The tolerance the contract accepts: per metric, a min, a max, or both. */
export type ReadingTolerance = NonNullable<IotConfigUpdate["readingTolerance"]>;
export type MetricBounds = ReadingTolerance[string];

const path = (deviceId: string) => ({ params: { path: { deviceId } } });

export const iotService = {
  getConfig: async (deviceId: string): Promise<IotConfig> =>
    (await typedApi.GET("/api/v1/iot/devices/{deviceId}", path(deviceId)).then(unwrap)).data,

  updateConfig: async (deviceId: string, update: IotConfigUpdate): Promise<IotConfig> =>
    (await typedApi.PATCH("/api/v1/iot/devices/{deviceId}", { ...path(deviceId), body: update }).then(unwrap)).data,

  /** Issue, or rotate: the previous token stops working at once. */
  issueToken: async (deviceId: string): Promise<IssuedToken> =>
    (await typedApi.POST("/api/v1/iot/devices/{deviceId}/token", path(deviceId)).then(unwrap)).data,

  /** Revoke the token and disable ingest. */
  revokeToken: async (deviceId: string): Promise<IotConfig> =>
    (await typedApi.DELETE("/api/v1/iot/devices/{deviceId}/token", path(deviceId)).then(unwrap)).data,
};

export const toleranceFromRows = (
  rows: Array<{ metric: string; min: string; max: string }>,
): { tolerance: ReadingTolerance | null; error: string | null } => {
  const tolerance: ReadingTolerance = {};
  for (const row of rows) {
    const metric = row.metric.trim();
    if (!metric && !row.min.trim() && !row.max.trim()) {
      continue;
    }
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(metric)) {
      return { tolerance: null, error: `"${metric}" is not a valid metric name (letters, digits, _ . -)` };
    }
    const bounds: { min?: number; max?: number } = {};
    for (const key of ["min", "max"] as const) {
      const raw = row[key].trim();
      if (raw) {
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          return { tolerance: null, error: `${metric}: ${key} must be a number` };
        }
        bounds[key] = value;
      }
    }
    if (bounds.min === undefined && bounds.max === undefined) {
      return { tolerance: null, error: `${metric}: give a min, a max, or both` };
    }
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max) {
      return { tolerance: null, error: `${metric}: min must not be greater than max` };
    }
    // Checked above: at least one of min and max is set, which is the contract's shape.
    tolerance[metric] = bounds as MetricBounds;
  }
  return { tolerance: Object.keys(tolerance).length ? tolerance : null, error: null };
};
