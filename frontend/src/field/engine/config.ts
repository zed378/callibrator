/**
 * P22-10a — the numbers P19-08 fixed (`docs/SHARED/06-SYNC-ENGINE.md` § 5): defaults the app may
 * TIGHTEN but never loosen. A looser value is refused at construction, so no platform can keep a
 * working set longer, retry slower or run more captures at once than the spec allows.
 */
export interface EngineConfig {
  /** How long a working set lives after the last successful sync (P19-08 § 10: 72 h). */
  readonly workingSetLifeMs: number;
  /** Captures synced at once; one capture's ops always in order (P19-08 § 9.2: 2). */
  readonly parallelCaptures: number;
  /** The first backoff and its ceiling (P19-08 § 9.3: 2 s × 2ⁿ up to 5 min). */
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  /** ± jitter as a fraction (P19-08 § 9.3: 20 %). */
  readonly backoffJitter: number;
  /** "Captured offline" when no confirmed server contact in this window (ADR-127 § 7: 60 s). */
  readonly offlineWindowMs: number;
  /** The pause after the last edit before planning (P19-08 § 9.2: 2 s). */
  readonly editDebounceMs: number;
}

export const DEFAULT_CONFIG: EngineConfig = Object.freeze({
  workingSetLifeMs: 72 * 3600 * 1000,
  parallelCaptures: 2,
  backoffBaseMs: 2000,
  backoffMaxMs: 5 * 60 * 1000,
  backoffJitter: 0.2,
  offlineWindowMs: 60 * 1000,
  editDebounceMs: 2000,
});

/** The config with the overrides applied; throws on any value looser than P19-08's. */
export const engineConfig = (overrides: Partial<EngineConfig> = {}): EngineConfig => {
  const c = { ...DEFAULT_CONFIG, ...overrides };
  const refuse = (what: string) => {
    throw new Error(`Engine config: ${what} may not be looser than P19-08`);
  };
  if (!(c.workingSetLifeMs > 0 && c.workingSetLifeMs <= DEFAULT_CONFIG.workingSetLifeMs)) refuse("workingSetLifeMs");
  if (!(Number.isInteger(c.parallelCaptures) && c.parallelCaptures >= 1 && c.parallelCaptures <= DEFAULT_CONFIG.parallelCaptures)) refuse("parallelCaptures");
  if (!(c.backoffBaseMs > 0 && c.backoffBaseMs <= DEFAULT_CONFIG.backoffBaseMs)) refuse("backoffBaseMs");
  if (!(c.backoffMaxMs >= c.backoffBaseMs && c.backoffMaxMs <= DEFAULT_CONFIG.backoffMaxMs)) refuse("backoffMaxMs");
  if (!(c.backoffJitter >= 0 && c.backoffJitter <= DEFAULT_CONFIG.backoffJitter)) refuse("backoffJitter");
  if (!(c.offlineWindowMs > 0 && c.offlineWindowMs <= DEFAULT_CONFIG.offlineWindowMs)) refuse("offlineWindowMs");
  if (!(c.editDebounceMs >= 0 && c.editDebounceMs <= DEFAULT_CONFIG.editDebounceMs)) refuse("editDebounceMs");
  return Object.freeze(c);
};

/**
 * The wait before attempt `attempts + 1` (2 s × 2ⁿ, at most the ceiling, ± jitter), or the server's
 * `Retry-After` when it asks for longer.
 *
 * @param attempts - attempts made so far (1 after the first failure)
 * @param unit - a number in [0, 1) from the Random port (the jitter)
 */
export const backoffMs = (config: EngineConfig, attempts: number, unit: number, retryAfterSec: number | null = null): number => {
  const exp = Math.min(config.backoffMaxMs, config.backoffBaseMs * 2 ** Math.max(0, attempts - 1));
  const jittered = Math.round(exp * (1 + config.backoffJitter * (2 * unit - 1)));
  const server = retryAfterSec !== null && retryAfterSec > 0 ? retryAfterSec * 1000 : 0;
  return Math.max(jittered, server);
};
