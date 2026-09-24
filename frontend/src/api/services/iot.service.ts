import { api } from "../client";

/**
 * IoT device provisioning (A-29, A-46) — Node `/api/v1/iot/devices/:deviceId`.
 *
 * The ingest token is returned ONCE, by `issueToken`, and never again: the
 * server stores only its SHA-256 hash, and `getConfig` reports `hasToken`.
 */

/** Bounds for one metric; a reading below `min` or above `max` is an anomaly. */
export interface MetricBounds {
  min?: number;
  max?: number;
}

export type ReadingTolerance = Record<string, MetricBounds>;

export interface IotConfig {
  deviceId: string;
  name: string;
  iotEnabled: boolean;
  readingTolerance: ReadingTolerance | null;
  hasToken: boolean;
  tokenIssuedAt: string | null;
}

export interface IssuedToken extends IotConfig {
  /** The plaintext token — shown once, never retrievable again. */
  token: string;
  rotated: boolean;
}

export interface IotConfigUpdate {
  iotEnabled?: boolean;
  readingTolerance?: ReadingTolerance | null;
}

interface Envelope<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

const base = (deviceId: string) => `/api/v1/iot/devices/${encodeURIComponent(deviceId)}`;

export const iotService = {
  getConfig: async (deviceId: string): Promise<IotConfig> =>
    (await api.get<Envelope<IotConfig>>(base(deviceId))).data,

  updateConfig: async (deviceId: string, update: IotConfigUpdate): Promise<IotConfig> =>
    (await api.patch<Envelope<IotConfig>>(base(deviceId), update)).data,

  /** Issue, or rotate: the previous token stops working at once. */
  issueToken: async (deviceId: string): Promise<IssuedToken> =>
    (await api.post<Envelope<IssuedToken>>(`${base(deviceId)}/token`)).data,

  /** Revoke the token and disable ingest. */
  revokeToken: async (deviceId: string): Promise<IotConfig> =>
    (await api.delete<Envelope<IotConfig>>(`${base(deviceId)}/token`)).data,
};

/**
 * Parse the tolerance editor's rows into the API shape. A blank bound is
 * omitted; a row with a name but no bound, a non-numeric bound, or min > max
 * is an error — the server refuses those too, so they are caught here first.
 */
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
    const bounds: MetricBounds = {};
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
    tolerance[metric] = bounds;
  }
  return { tolerance: Object.keys(tolerance).length ? tolerance : null, error: null };
};
