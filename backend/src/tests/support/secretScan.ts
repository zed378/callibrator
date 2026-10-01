/**
 * S-20 / A-331 (ADR-100 Amendment 4) — no response body carries a credential.
 *
 * `POST /roles/assign` answered a whole User row: its bcrypt hash, MFA seed
 * envelopes, recovery codes, OTP and WebAuthn columns. This scanner holds the
 * class at the response boundary in the test suites:
 *
 *  - every response `fixtures/routeClient.ts#call` returns (the real routers
 *    over memoryDb) is scanned, and a finding fails that call;
 *  - every body a REAL Express response serialises (`res.json`) is scanned by
 *    tests/setup/secretScan.setup.ts, and a finding fails the test.
 *
 * A finding is a KEY that names a credential (the attributes
 * models/secretAttributes.ts drops, their snake_case columns, and a few
 * generic names), or a VALUE shaped like a password hash (bcrypt, argon2).
 * A secret a caller must see ONCE (a new webhook secret) is allowed only for
 * the named routes in ONE_TIME_SECRETS, each with its reason.
 */
import { SECRET_ATTRIBUTES } from "../../models/secretAttributes";

const snake = (name: string): string => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Keys that never appear in a response body. */
export const SECRET_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(SECRET_ATTRIBUTES).flat(),
  ...Object.values(SECRET_ATTRIBUTES).flat().map(snake),
  "passwordHash",
  "password_hash",
  "clientSecretHash",
  "client_secret_hash",
  "secretAccessKey",
  "secret_access_key",
  "privateKeyPem",
]);

/** A value shaped like a stored password hash. */
export const HASH_PATTERNS: readonly RegExp[] = [/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, /^\$argon2(?:id|i|d)\$/];

/**
 * A secret a route returns ONCE, by design, as a field its service names.
 * Keyed by the key; the value is the route (METHOD + a path pattern) and why.
 */
export const ONE_TIME_SECRETS: readonly { key: string; route: RegExp; reason: string }[] = [
  {
    key: "secret",
    // The webhook routes by path, and a rotation wherever its router is mounted
    // (the route suites mount routers under a test base path).
    route: /^(POST|PUT|PATCH) (.*\/webhooks(\/[^/?]+)?|.*\/[^/?]+\/rotate-secret)(\?.*)?$/,
    reason: "webhook.service returns a NEW signing secret exactly once (create, URL change, rotation; P6-13, ADR-085)",
  },
];

/** A credential found in a body, with its path. */
export interface SecretFinding {
  path: string;
  kind: "key" | "hash";
  detail: string;
}

/**
 * Every credential key and hash-shaped value in `body`.
 *
 * @param body - a parsed response body
 * @param route - "METHOD /path", to apply ONE_TIME_SECRETS
 */
export const findSecrets = (body: unknown, route = ""): SecretFinding[] => {
  const findings: SecretFinding[] = [];
  const allowed = new Set(ONE_TIME_SECRETS.filter((s) => s.route.test(route)).map((s) => s.key));
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (HASH_PATTERNS.some((p) => p.test(value))) {
        findings.push({ path, kind: "hash", detail: `${value.slice(0, 7)}…` });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        walk(item, `${path}[${String(i)}]`);
      });
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const childPath = path === "" ? key : `${path}.${key}`;
        if (SECRET_KEYS.has(key) && !allowed.has(key) && child !== null && child !== undefined && child !== "[REDACTED]") {
          findings.push({ path: childPath, kind: "key", detail: key });
        }
        walk(child, childPath);
      }
    }
  };
  walk(body, "");
  return findings;
};

/** The failure message for findings, or null when there are none. */
export const secretsMessage = (findings: readonly SecretFinding[], route: string): string | null =>
  findings.length === 0
    ? null
    : `S-20/A-331: the response to ${route} carries credential material: ${findings
      .map((f) => `${f.path} (${f.kind === "key" ? "credential key" : "hash-shaped value"} ${f.detail})`)
      .join(", ")}. Answer through a named projection (see models/secretAttributes.ts).`;
