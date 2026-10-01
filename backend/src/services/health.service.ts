// src/services/health.service.ts
//
// P9-18 (ADR-087, Stage C): converted from health.service.js with no behaviour
// change. `export =` keeps the exact object `require()` returned (the same
// keys, in the same order). `amqplib.connect` is a named import read at call
// time, as `amqplib.connect(...)` was, so the tests' `jest.mock("amqplib")`
// still applies; `db` and `getRedisConnection` are captured at load, as the
// `.js` destructured them; `iotService` and `clamAv` are the module objects.
// The environment is read through src/config/env (P9-06), at call time.
//
// Dependency probes behind the health endpoints (A-06, A-15).
//
// A-06 — the public probes disclose nothing about the runtime: no Node
// version, no pid, no memory figures, no hostname and no per-dependency
// breakdown. This module produces the breakdown; only the gated readiness
// endpoint is allowed to render it.
//
// A-15 — the old `/health` called `db.authenticate()` and nothing else, so it
// answered 200 while Redis (session lockout, passkey challenges, the OIDC
// provider) or RabbitMQ (email queue, batch jobs) were down. A load balancer
// and an uptime monitor act on that answer, so it now covers every dependency
// the application actually requires, and reports one that is switched off by
// configuration as "not configured" rather than as healthy.

import { connect as amqpConnect } from "amqplib";

import { db as loadedDb } from "../config";
import redisService from "./redis.service";
import iotService from "./iot.service";
import clamAv from "./clamAv.service";
import { env } from "../config/env";

const db = loadedDb;
const { getRedisConnection } = redisService;

/** One dependency's line in the report. */
interface DependencyReport {
  name: string;
  required: boolean;
  status: string;
  latencyMs?: number;
  error?: string;
  detail?: string;
}

/** The aggregate. */
interface ReadinessReport {
  status: string;
  checkedAt: string;
  dependencies: DependencyReport[];
}

/** The message of a caught error, read as the `.js` read `err.message`. */
const messageOf = (err: unknown): string => (err as Error).message;

// ==========================================
// STATUS VOCABULARY
// ==========================================

const STATUS = {
  HEALTHY: "healthy",
  UNHEALTHY: "unhealthy",
  // Switched off by configuration. NEVER reported as healthy: "healthy" would
  // claim a probe succeeded against something that is not even running.
  NOT_CONFIGURED: "not configured",
  // Configured, but this process has no way to probe it. Honest about the gap
  // instead of asserting health it has not measured.
  UNKNOWN: "unknown",
};

// ==========================================
// TUNING
// ==========================================

/**
 * Per-probe ceiling. A health endpoint that hangs is worse than one that says
 * "unhealthy": the orchestrator learns nothing and the request occupies a
 * socket until the 30s request timeout fires.
 */
// parseInt applies ToString, so an unset variable parses "undefined" (NaN), as before.
const probeTimeoutMs = (): number =>
  parseInt(String(env("HEALTH_PROBE_TIMEOUT_MS")), 10) || 2000;

/**
 * The aggregate is cached for this long. The public endpoints are hit by a load
 * balancer on a short interval; without a cache each hit would authenticate
 * against PostgreSQL, PING Redis and open an AMQP connection.
 */
const cacheTtlMs = (): number =>
  parseInt(String(env("HEALTH_CACHE_TTL_MS")), 10) || 5000;

/**
 * Run a probe with a hard deadline.
 *
 * @param label - dependency name, used in the timeout message
 * @param probe - the check
 */
const withTimeout = <T>(label: string, probe: () => T | Promise<T>): Promise<T> => {
  const ms = probeTimeoutMs();
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => {
        reject(new Error(`${label} probe timed out after ${String(ms)}ms`));
      },
      ms,
    );
    // Never hold the event loop open for a health probe.
    timer.unref();
  });

  return Promise.race([Promise.resolve().then(probe), deadline]).finally(() => {
    clearTimeout(timer);
  });
};

const report = (
  name: string,
  required: boolean,
  status: string,
  extra: { latencyMs?: number; error?: string; detail?: string } = {},
): DependencyReport => ({
  name,
  required,
  status,
  ...extra,
});

// ==========================================
// PROBES
// ==========================================

/**
 * PostgreSQL — required. The only dependency the endpoint used to check.
 */
const checkDatabase = async (): Promise<DependencyReport> => {
  const startedAt = Date.now();

  try {
    await withTimeout("PostgreSQL", () => db.authenticate());
    return report("postgres", true, STATUS.HEALTHY, {
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return report("postgres", true, STATUS.UNHEALTHY, {
      latencyMs: Date.now() - startedAt,
      error: messageOf(err),
    });
  }
};

/**
 * Redis — required. Sessions, brute-force lockout, passkey challenges and the
 * OIDC authorization store all live here; "up without Redis" is not ready.
 */
const checkRedis = async (): Promise<DependencyReport> => {
  const startedAt = Date.now();

  try {
    const client = getRedisConnection();
    const reply = await withTimeout("Redis", () => client.ping());

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: the typings promise "PONG", a real client (or a double) may answer otherwise
    if (reply !== "PONG") {
      throw new Error(`unexpected PING reply: ${String(reply)}`);
    }

    return report("redis", true, STATUS.HEALTHY, {
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return report("redis", true, STATUS.UNHEALTHY, {
      latencyMs: Date.now() - startedAt,
      error: messageOf(err),
    });
  }
};

/** Same URL resolution as services/rabbitmq.service.ts. */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty variable means "unset" */
const rabbitUrl = (): string =>
  env("RABBITMQ_URL") ||
  `amqp://${env("RABBITMQ_HOST") || "localhost"}:${
    env("RABBITMQ_PORT") || String(5672)
  }`;
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

const closeQuietly = async (connection: { close(): Promise<unknown> }): Promise<void> => {
  try {
    await connection.close();
  } catch {
    // The probe already succeeded; a failure to hang up does not make the
    // broker unhealthy.
  }
};

/**
 * RabbitMQ — required. The email queue and the batch-job worker consume from
 * it; with the broker down, queued work silently stops.
 *
 * This opens and closes its own connection rather than calling
 * `rabbitmq.service#getConnection()`, deliberately: a probe should answer
 * "can I reach the broker right now", not "is the cached handle still there".
 * Reusing the shared connection would report healthy whenever the cached
 * object exists, which is the state a probe is meant to disprove.
 *
 * (Until 2026-09-23 there was a second reason: that helper cached on
 * `connection.isOpen`, which amqplib 2.x does not define, so every call opened
 * a new connection and nothing closed it. That leak is fixed — A-36 — and the
 * rationale above is what stands on its own.)
 */
const checkRabbitMq = async (): Promise<DependencyReport> => {
  const startedAt = Date.now();

  try {
    const connection = await withTimeout("RabbitMQ", () =>
      amqpConnect(rabbitUrl()),
    );
    await closeQuietly(connection);

    return report("rabbitmq", true, STATUS.HEALTHY, {
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return report("rabbitmq", true, STATUS.UNHEALTHY, {
      latencyMs: Date.now() - startedAt,
      error: messageOf(err),
    });
  }
};

/**
 * MQTT — optional. The backend is a CLIENT of an external broker and only
 * connects when MQTT_HOST and MQTT_PORT are BOTH set (see index.js). Unset, it
 * is not a dependency of this deployment at all.
 */
const checkMqtt = (): DependencyReport => {
  if (!env("MQTT_HOST") || !env("MQTT_PORT")) {
    return report("mqtt", false, STATUS.NOT_CONFIGURED, {
      detail: "MQTT_HOST and MQTT_PORT are not both set",
    });
  }

  if (!iotService.connected) {
    return report("mqtt", false, STATUS.UNHEALTHY, {
      error: "MQTT client is not connected to the configured broker",
    });
  }

  return report("mqtt", false, STATUS.HEALTHY);
};

/**
 * ClamAV — optional, off unless CLAMAV_ENABLED=true.
 *
 * clamAv.service exposes no reachability probe, and scanning a file to find out
 * would be an expensive side effect on an endpoint a load balancer polls. So an
 * enabled ClamAV is reported as UNKNOWN — configured, not measured — rather
 * than as healthy.
 */
const checkClamAv = (): DependencyReport => {
  if (!clamAv.isConfigured()) {
    return report("clamav", false, STATUS.NOT_CONFIGURED, {
      detail: "CLAMAV_ENABLED is not true",
    });
  }

  return report("clamav", false, STATUS.UNKNOWN, {
    detail: "enabled; this process has no reachability probe for ClamAV",
  });
};

// ==========================================
// AGGREGATE
// ==========================================

let cached: { at: number; report: ReadinessReport } | null = null;

const buildReport = async (): Promise<ReadinessReport> => {
  const [postgres, redis, rabbitmq] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkRabbitMq(),
  ]);

  const dependencies = [
    postgres,
    redis,
    rabbitmq,
    checkMqtt(),
    checkClamAv(),
  ];

  // Only a REQUIRED dependency moves the overall verdict. An optional one that
  // is off, or configured but unprobed, must never make a working deployment
  // look broken.
  const failed = dependencies.filter(
    (dependency) => dependency.required && dependency.status !== STATUS.HEALTHY,
  );

  return {
    status: failed.length === 0 ? STATUS.HEALTHY : STATUS.UNHEALTHY,
    checkedAt: new Date().toISOString(),
    dependencies,
  };
};

/**
 * The full dependency report.
 *
 * @param options - fresh:true bypasses the cache — used by the gated
 *   endpoint, where an operator is asking right now.
 */
const getReadiness = async ({ fresh = false }: { fresh?: boolean } = {}): Promise<ReadinessReport> => {
  const now = Date.now();

  if (!fresh && cached && now - cached.at < cacheTtlMs()) {
    return cached.report;
  }

  const fresherReport = await buildReport();
  cached = { at: now, report: fresherReport };

  return fresherReport;
};

/**
 * Aggregate verdict only — this is all a public endpoint is allowed to say.
 *
 * @param options - as getReadiness
 */
const isReady = async (options?: { fresh?: boolean }): Promise<boolean> => {
  const current = await getReadiness(options);
  return current.status === STATUS.HEALTHY;
};

/** Drop the cached aggregate (process restart semantics; used by tests). */
const resetCache = (): void => {
  cached = null;
};

export = {
  STATUS,
  checkDatabase,
  checkRedis,
  checkRabbitMq,
  checkMqtt,
  checkClamAv,
  getReadiness,
  isReady,
  resetCache,
};
