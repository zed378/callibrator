/**
 * The environment, read in ONE place (P9-06 part 1, ADR-087 Amendment 6).
 *
 * Outside `src/config/`, `process.env` is a lint error (docs/ENGINEERING/04,
 * `no-restricted-properties`). Converted modules read their variables through
 * these helpers instead, and each helper reproduces exactly the expression the
 * module used before:
 *
 *   env(name)             process.env[name]                    (unset: undefined)
 *   envOr(name, dflt)     process.env[name] || dflt            (unset OR "": dflt)
 *   isProduction()        process.env.NODE_ENV === "production"
 *
 * Every read happens at CALL time, never cached at load: tests (and the boot
 * sequence, after dotenv) set variables after this module is loaded, and a
 * module that read a variable at load still does so by calling the helper at
 * load. `envOr` keeps `||` on purpose — throughout this codebase an EMPTY
 * variable has always meant "use the default", which `??` would change.
 *
 * P9-06 part 2 (2026-10-02, ADR-087 Amendment 30): `environmentSchema` and
 * `validateEnvironment` below — every rule the boot ALREADY enforces, one
 * module at a time, checked together before any of those modules loads, so a
 * broken configuration fails listing every problem at once instead of one per
 * restart (docs/BACKEND/11 rule 3).
 */
import { z } from "zod";
import { splitKeyList } from "../utils/keyring.util";

/** The raw value of an environment variable, or `undefined` when it is unset. */
export const env = (name: string): string | undefined => process.env[name];

/**
 * The variable's value, or `fallback` when it is unset OR EMPTY — the
 * `process.env.X || fallback` idiom, in one place.
 */
export const envOr = (name: string, fallback: string): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty variable means "use the default" (see the file header)
  process.env[name] || fallback;

/**
 * The environment object itself — for the modules whose functions take an
 * injectable `env = process.env` (tests pass their own). The same object, not
 * a copy: a variable set later is seen by every reader.
 */
export const environment = (): NodeJS.ProcessEnv => process.env;

/** `NODE_ENV === "production"`, read now. */
export const isProduction = (): boolean => process.env["NODE_ENV"] === "production";

// ==========================================
// P9-06 part 2 — the environment schema (fail-listing boot)
// ==========================================
//
// Each rule below is a refusal that already exists, written where the boot
// reaches it today; the schema adds no new requirement. Every rule names its
// source, and `tests/config/environmentSchema.p906.test.ts` holds each verdict
// equal to that source's own check over a matrix of configurations. A valid
// configuration therefore boots exactly as before; an invalid one now fails
// once, naming every variable, before any module that would have refused loads.
//
// Not added (they would refuse configurations that boot today): ENCRYPT_KEY
// (read only by migration 0058), FORCE_HTTPS, HOST_URL / PUBLIC_BASE_URL (a
// request-time 500 naming the setting, A-189), PRIVACY_NOTICE_URL (optional:
// the public pages omit the link without it).

/** The JWT algorithms utils/jwt.util accepts (A-31: pinned in code). */
const JWT_ALGORITHMS = ["HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "ES256", "ES384", "ES512"] as const;

/** A variable's value trimmed, or null when unset or blank (config/billing, config/publicAccess). */
const trimmedOf = (value: string | undefined): string | null => {
  const t = value?.trim();
  return t !== undefined && t !== "" ? t : null;
};

/** A hex key that decodes to 32 bytes (services/kms.service#parseMasterKey). */
const isMasterKey = (hex: string): boolean => Buffer.from(hex, "hex").length === 32;

/** The variables the schema reads; every other variable passes through untouched. */
const optionalVariable = z.string().optional();

export const environmentSchema = z
  .looseObject({
    NODE_ENV: optionalVariable,
    DB_HOST: optionalVariable,
    DB_NAME: optionalVariable,
    DB_USER: optionalVariable,
    DB_PASS: optionalVariable,
    DB_PORT: optionalVariable,
    DB_DIALECT: optionalVariable,
    JWT_ACCESS_SECRET: optionalVariable,
    JWT_REFRESH_SECRET: optionalVariable,
    JWT_ALGORITHM: optionalVariable,
    CERT_SIGNING_SECRET: optionalVariable,
    KMS_MASTER_KEY: optionalVariable,
    KMS_MASTER_KEY_PREVIOUS: optionalVariable,
    ACCESS_REQUEST_IP_PEPPER: optionalVariable,
    BILLING_ENABLED: optionalVariable,
    STRIPE_SECRET_KEY: optionalVariable,
    STRIPE_WEBHOOK_SECRET: optionalVariable,
  })
  .superRefine((e, ctx) => {
    const problem = (variable: string, message: string): void => {
      ctx.addIssue({ code: "custom", path: [variable], message });
    };
    const production = e.NODE_ENV === "production";

    // config/index.ts#validateConfig — every environment.
    for (const key of ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASS", "DB_PORT"] as const) {
      const value = e[key];
      if (!value || value.trim() === "") {
        problem(key, "is required (the database connection, config/index.ts)");
      }
    }
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as config/index.ts: an empty DB_DIALECT means postgres
    const dialect = (e.DB_DIALECT || "postgres").trim();
    if (dialect !== "postgres") {
      problem("DB_DIALECT", `"${dialect}" is not supported: PostgreSQL is the only database (ADR-039)`);
    }
    if (e.DB_PORT && e.DB_PORT.trim() !== "") {
      const port = parseInt(e.DB_PORT, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        problem("DB_PORT", `"${e.DB_PORT}" must be a number between 1 and 65535`);
      }
    }

    // utils/jwt.util.ts — every environment (A-31).
    if (!e.JWT_ACCESS_SECRET) {
      problem("JWT_ACCESS_SECRET", "is required");
    }
    if (!e.JWT_REFRESH_SECRET) {
      problem("JWT_REFRESH_SECRET", "is required");
    }
    if (e.JWT_ACCESS_SECRET && e.JWT_REFRESH_SECRET && e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) {
      problem("JWT_REFRESH_SECRET", "must differ from JWT_ACCESS_SECRET: equal secrets make the two token types interchangeable");
    }
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as jwt.util's envOr: an empty JWT_ALGORITHM means HS256
    const algorithm = e.JWT_ALGORITHM || "HS256";
    if (!(JWT_ALGORITHMS as readonly string[]).includes(algorithm)) {
      problem("JWT_ALGORITHM", `"${algorithm}" is not supported; use one of: ${JWT_ALGORITHMS.join(", ")}`);
    }

    // services/certificateDocument.service.ts#requireSigningSecret — every environment
    // (it also satisfies attachment.service's ATTACHMENT_URL_SECRET-or-CERT_SIGNING_SECRET).
    if (!e.CERT_SIGNING_SECRET) {
      problem("CERT_SIGNING_SECRET", "is required (certificate signatures and verification links have no default)");
    }

    // services/kms.service.ts — production needs the key; a key that is set must parse, everywhere.
    if (production && !e.KMS_MASTER_KEY) {
      problem("KMS_MASTER_KEY", "is required in production (64-character hex, 32 bytes): refusing the development master key");
    }
    if (e.KMS_MASTER_KEY && !isMasterKey(e.KMS_MASTER_KEY)) {
      problem("KMS_MASTER_KEY", "must be a 64-character hex string (32 bytes)");
    }
    splitKeyList(e.KMS_MASTER_KEY_PREVIOUS).forEach((hex, i) => {
      if (!isMasterKey(hex)) {
        problem("KMS_MASTER_KEY_PREVIOUS", `entry ${String(i)} must be a 64-character hex string (32 bytes)`);
      }
    });

    // config/publicAccess.ts#assertPublicAccessConfig — production (P10-05).
    if (production && trimmedOf(e.ACCESS_REQUEST_IP_PEPPER) === null) {
      problem("ACCESS_REQUEST_IP_PEPPER", "is required in production (P10-05)");
    }

    // config/billing.ts#stripeSecretKey — production with billing enabled (ADR-111).
    const billingFlag = (trimmedOf(e.BILLING_ENABLED) ?? "").toLowerCase();
    const billing = billingFlag === "true" || (billingFlag !== "false" && trimmedOf(e.STRIPE_WEBHOOK_SECRET) !== null);
    if (production && billing && trimmedOf(e.STRIPE_SECRET_KEY) === null) {
      problem(
        "STRIPE_SECRET_KEY",
        "is required in production when billing is enabled (ADR-111); set it, or BILLING_ENABLED=false on a deployment that does not bill through Stripe",
      );
    }
  });

/** One failing variable and why. */
export interface EnvironmentProblem {
  variable: string;
  problem: string;
}

/**
 * Every problem with the environment, in rule order (empty when it is valid).
 *
 * @param raw - the environment (defaults to process.env, read now)
 * @returns the problems
 */
export const environmentProblems = (raw: NodeJS.ProcessEnv = process.env): EnvironmentProblem[] => {
  const result = environmentSchema.safeParse(raw);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ variable: issue.path.map(String).join("."), problem: issue.message }));
};

/**
 * The fail-listing boot check (docs/BACKEND/11 rule 3): throws ONE error that
 * names every failing variable, before any module that checks its own
 * variable loads. Called by index.ts right after dotenv.
 *
 * @param raw - the environment (defaults to process.env)
 * @throws Error listing every problem
 */
export const validateEnvironment = (raw: NodeJS.ProcessEnv = process.env): void => {
  const problems = environmentProblems(raw);
  if (problems.length > 0) {
    const lines = problems.map(({ variable, problem }) => `  - ${variable}: ${problem}`);
    throw new Error(
      `Invalid configuration: ${String(problems.length)} problem(s). Fix all of them; see .env.example and docs/BACKEND/11-CONFIGURATION.md.\n${lines.join("\n")}`,
    );
  }
};
