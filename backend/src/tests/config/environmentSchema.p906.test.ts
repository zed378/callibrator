/**
 * P9-06 part 2 (ADR-087 Amendment 30) — the environment schema refuses EXACTLY what the boot
 * already refused, module by module, and names every problem at once.
 *
 * The identity: for a matrix of configurations (a valid base, then single and combined
 * perturbations, in development and in production), the set of modules whose OWN load-time
 * check refuses — each loaded for real in an isolated registry with that environment — equals
 * the set the schema reports problems for. So a configuration that boots today still boots (no
 * new requirement), and one that does not is refused for the same reasons, all listed together.
 *
 * Module ↔ variables: config/index (DB_*), utils/jwt.util (JWT_*), certificateDocument.service
 * (CERT_SIGNING_SECRET), kms.service (KMS_*), config/publicAccess (ACCESS_REQUEST_IP_PEPPER),
 * config/billing (STRIPE_SECRET_KEY).
 */
import fs from "fs";
import path from "path";
import { environment, environmentProblems, environmentSchema, validateEnvironment } from "../../config/env";

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

type Env = Record<string, string | undefined>;

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);

const BASE: Env = {
  NODE_ENV: "test",
  DB_HOST: "127.0.0.1",
  DB_NAME: "callibrator",
  DB_USER: "app",
  DB_PASS: "secret",
  DB_PORT: "5432",
  JWT_ACCESS_SECRET: "access-secret-p906",
  JWT_REFRESH_SECRET: "refresh-secret-p906",
  CERT_SIGNING_SECRET: "cert-secret-p906",
};
const PRODUCTION: Env = { ...BASE, NODE_ENV: "production", KMS_MASTER_KEY: HEX_A, ACCESS_REQUEST_IP_PEPPER: "pepper" };

/** One change to a configuration: [variable, value] (undefined = unset). */
type Change = [string, string | undefined];
const CHANGES: Change[] = [
  ["DB_HOST", undefined], ["DB_HOST", "  "], ["DB_NAME", ""], ["DB_USER", undefined], ["DB_PASS", " "],
  ["DB_PORT", undefined], ["DB_PORT", "0"], ["DB_PORT", "70000"], ["DB_PORT", "abc"], ["DB_PORT", "5432abc"],
  ["DB_DIALECT", "mysql"], ["DB_DIALECT", " postgres "], ["DB_DIALECT", ""],
  ["JWT_ACCESS_SECRET", undefined], ["JWT_ACCESS_SECRET", ""], ["JWT_REFRESH_SECRET", undefined],
  ["JWT_REFRESH_SECRET", "access-secret-p906"], ["JWT_ALGORITHM", "none"], ["JWT_ALGORITHM", "RS256"], ["JWT_ALGORITHM", ""],
  ["CERT_SIGNING_SECRET", undefined], ["CERT_SIGNING_SECRET", ""], ["CERT_SIGNING_SECRET", " "],
  ["KMS_MASTER_KEY", undefined], ["KMS_MASTER_KEY", ""], ["KMS_MASTER_KEY", "abc"], ["KMS_MASTER_KEY", HEX_B],
  ["KMS_MASTER_KEY_PREVIOUS", `${HEX_A}, ${HEX_B}`], ["KMS_MASTER_KEY_PREVIOUS", `${HEX_A},zz`], ["KMS_MASTER_KEY_PREVIOUS", " , "],
  ["ACCESS_REQUEST_IP_PEPPER", undefined], ["ACCESS_REQUEST_IP_PEPPER", "   "],
  ["STRIPE_WEBHOOK_SECRET", "whsec_x"], ["BILLING_ENABLED", "true"], ["BILLING_ENABLED", "FALSE"], ["BILLING_ENABLED", "maybe"],
  ["STRIPE_SECRET_KEY", "sk_live_x"], ["STRIPE_SECRET_KEY", "  "],
];

/** A deterministic sample of configurations: each change alone, and seeded combinations. */
const configurations = (): [string, Env][] => {
  const out: [string, Env][] = [];
  let seed = 9065;
  const next = (n: number): number => {
    seed = (seed * 16807) % 2147483647;
    return seed % n;
  };
  for (const base of [BASE, PRODUCTION]) {
    const label = base["NODE_ENV"] ?? "";
    out.push([`${label} (valid)`, { ...base }]);
    for (const [k, v] of CHANGES) {
      out.push([`${label} ${k}=${String(v)}`, { ...base, [k]: v }]);
    }
    for (let i = 0; i < 40; i += 1) {
      const env: Env = { ...base };
      const names: string[] = [];
      for (let j = 0; j < 2 + next(3); j += 1) {
        const [k, v] = CHANGES[next(CHANGES.length)] ?? ["NODE_ENV", "test"];
        env[k] = v;
        names.push(`${k}=${String(v)}`);
      }
      out.push([`${label} ${names.join(" ")}`, env]);
    }
  }
  return out;
};

const MODULE_OF: Record<string, string> = {
  DB_HOST: "config", DB_NAME: "config", DB_USER: "config", DB_PASS: "config", DB_PORT: "config", DB_DIALECT: "config",
  JWT_ACCESS_SECRET: "jwt", JWT_REFRESH_SECRET: "jwt", JWT_ALGORITHM: "jwt",
  CERT_SIGNING_SECRET: "certificate",
  KMS_MASTER_KEY: "kms", KMS_MASTER_KEY_PREVIOUS: "kms",
  ACCESS_REQUEST_IP_PEPPER: "publicAccess",
  STRIPE_SECRET_KEY: "billing",
};

/* eslint-disable @typescript-eslint/no-require-imports -- each module is loaded for real, in its own registry, under the configuration */
const CHECKS: [string, () => void][] = [
  ["config", () => { require("../../config"); }],
  ["jwt", () => { require("../../utils/jwt.util"); }],
  // Its own rule only: the models barrel (which loads config/index and its DB check) is stubbed.
  ["certificate", () => {
    jest.doMock("../../models", () => ({}));
    (require("../../services/certificateDocument.service") as { requireSigningSecret: () => string }).requireSigningSecret();
  }],
  ["kms", () => { require("../../services/kms.service"); }],
  ["publicAccess", () => { (require("../../config/publicAccess") as { assertPublicAccessConfig: () => void }).assertPublicAccessConfig(); }],
  ["billing", () => { (require("../../config/billing") as { stripeSecretKey: () => string }).stripeSecretKey(); }],
];
/* eslint-enable @typescript-eslint/no-require-imports */

/** The modules whose own check refuses this configuration. */
const refusingModules = (env: Env): string[] => {
  const live = environment();
  const saved = { ...live };
  const refused: string[] = [];
  try {
    for (const key of Object.keys(live)) {
      Reflect.deleteProperty(live, key);
    }
    for (const [k, v] of Object.entries(env)) {
      if (v !== undefined) {
        live[k] = v;
      }
    }
    for (const [name, check] of CHECKS) {
      jest.isolateModules(() => {
        try {
          check();
        } catch {
          refused.push(name);
        }
      });
    }
  } finally {
    for (const key of Object.keys(live)) {
      Reflect.deleteProperty(live, key);
    }
    Object.assign(live, saved);
  }
  return refused.sort();
};

const schemaModules = (env: Env): string[] =>
  [...new Set(environmentProblems(env).map((p) => MODULE_OF[p.variable] ?? `unknown:${p.variable}`))].sort();

describe("P9-06 part 2 — the environment schema refuses exactly what the modules refuse", () => {
  jest.setTimeout(240000);

  it("over the configuration matrix, the schema's refusing modules equal the modules that refuse", () => {
    const mismatches: string[] = [];
    let refusedConfigs = 0;
    const all = configurations();
    for (const [label, env] of all) {
      const modules = refusingModules(env);
      const schema = schemaModules(env);
      if (modules.length > 0) {
        refusedConfigs += 1;
      }
      if (JSON.stringify(modules) !== JSON.stringify(schema)) {
        mismatches.push(`${label}: modules ${JSON.stringify(modules)} schema ${JSON.stringify(schema)}`);
      }
    }
    expect(mismatches).toEqual([]);
    // The matrix exercises both sides: some configurations boot, most do not.
    expect(all.length).toBeGreaterThan(150);
    expect(refusedConfigs).toBeGreaterThan(50);
    expect(all.length - refusedConfigs).toBeGreaterThan(10);
  });

  it("a valid configuration passes, in development and in production", () => {
    expect(() => {
      validateEnvironment(BASE);
    }).not.toThrow();
    expect(() => {
      validateEnvironment(PRODUCTION);
    }).not.toThrow();
  });

  it("an invalid one fails ONCE, naming every failing variable", () => {
    const broken: Env = {
      NODE_ENV: "production",
      DB_HOST: "db",
      DB_PORT: "99999",
      JWT_ACCESS_SECRET: "same",
      JWT_REFRESH_SECRET: "same",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
    };
    let message = "";
    try {
      validateEnvironment(broken);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/^Invalid configuration: 9 problem\(s\)/);
    for (const variable of ["DB_NAME", "DB_USER", "DB_PASS", "DB_PORT", "JWT_REFRESH_SECRET", "CERT_SIGNING_SECRET", "KMS_MASTER_KEY", "ACCESS_REQUEST_IP_PEPPER", "STRIPE_SECRET_KEY"]) {
      expect(message).toContain(`  - ${variable}: `);
    }
    expect(message).not.toMatch(/sk_|whsec_|same/);
  });

  it("every variable the schema governs is documented in .env.example and docs/BACKEND/11 (they cannot drift)", () => {
    const repo = path.resolve(__dirname, "../../../..");
    const example = fs.readFileSync(path.join(repo, "backend", ".env.example"), "utf8");
    const doc = fs.readFileSync(path.join(repo, "docs", "BACKEND", "11-CONFIGURATION.md"), "utf8");
    // The name as a whole word: not part of a longer variable name.
    const mentions = (text: string, name: string): boolean => new RegExp(`(^|[^A-Z0-9_])${name}([^A-Z0-9_]|$)`, "m").test(text);
    const undocumented = Object.keys(environmentSchema.shape).filter((name) => !mentions(example, name) || !mentions(doc, name));
    expect(undocumented).toEqual([]);
  });

  it("variables the schema does not govern pass through untouched", () => {
    const extra: Env = { ...BASE, SOMETHING_ELSE: "x", ENCRYPT_KEY: undefined };
    expect(environmentProblems(extra)).toEqual([]);
  });
});
