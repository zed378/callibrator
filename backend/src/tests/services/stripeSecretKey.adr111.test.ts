/**
 * ADR-111 — in production with billing enabled, the backend refuses to start
 * without STRIPE_SECRET_KEY.
 *
 * `stripeWebhook.service` fell back to the placeholder `sk_test_placeholder`
 * whenever STRIPE_SECRET_KEY was unset — production included. A deployment
 * wired to Stripe but missing the key booted, and ran billing against a fake
 * credential with nothing saying so. Now, as the CERT_SIGNING_SECRET guard
 * does, the module throws at load (the boot requires it through the billing
 * routes) with an error naming the variable.
 *
 * Billing is enabled when BILLING_ENABLED=true, or when BILLING_ENABLED is
 * unset and STRIPE_WEBHOOK_SECRET is set (a deployment wired to Stripe);
 * BILLING_ENABLED=false turns it off. Outside production the placeholder stays
 * allowed, for development and tests.
 *
 * Each case loads the REAL module in an isolated registry with the environment
 * it names.
 */

import { environment } from "../../config/env";

// The live environment object (config/env: process.env itself, not a copy).
const penv = environment();

const VARS = ["NODE_ENV", "BILLING_ENABLED", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "KMS_MASTER_KEY"] as const;
type Vars = Partial<Record<(typeof VARS)[number], string>>;

const saved: Vars = {};
beforeAll(() => {
  for (const name of VARS) {
    const value = penv[name];
    if (value !== undefined) {
      saved[name] = value;
    }
  }
});
afterEach(() => {
  for (const name of VARS) {
    const value = saved[name];
    if (value === undefined) {
      Reflect.deleteProperty(penv, name);
    } else {
      penv[name] = value;
    }
  }
});

/** Load stripeWebhook.service with exactly these variables; the error it throws, or null. */
const loadWith = (input: Vars): Error | null => {
  // Production refuses to load the models without a real KMS master key; that
  // guard is not what this file is about, so every case carries one.
  const vars: Vars = { KMS_MASTER_KEY: "a1".repeat(32), ...input };
  for (const name of VARS) {
    const value = vars[name];
    if (value === undefined) {
      Reflect.deleteProperty(penv, name);
    } else {
      penv[name] = value;
    }
  }
  let failure: Error | null = null;
  jest.isolateModules(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the module's load IS the behaviour under test
      require("../../services/stripeWebhook.service");
    } catch (err) {
      failure = err as Error;
    }
  });
  return failure;
};

const REFUSAL = /STRIPE_SECRET_KEY is required in production when billing is enabled/;

describe("ADR-111 — production with billing enabled refuses a missing STRIPE_SECRET_KEY", () => {
  it("BILLING_ENABLED=true, no key: the load throws, naming the variable", () => {
    expect(loadWith({ NODE_ENV: "production", BILLING_ENABLED: "true" })?.message).toMatch(REFUSAL);
  });

  it("an empty key is a missing key", () => {
    expect(loadWith({ NODE_ENV: "production", BILLING_ENABLED: "true", STRIPE_SECRET_KEY: "  " })?.message).toMatch(REFUSAL);
  });

  it("BILLING_ENABLED unset but STRIPE_WEBHOOK_SECRET set (wired to Stripe): the load throws", () => {
    expect(loadWith({ NODE_ENV: "production", STRIPE_WEBHOOK_SECRET: "whsec_live" })?.message).toMatch(REFUSAL);
  });
});

describe("ADR-111 — everything else still starts", () => {
  it.each<[string, Vars]>([
    ["production with the key set", { NODE_ENV: "production", BILLING_ENABLED: "true", STRIPE_SECRET_KEY: "sk_live_x" }],
    ["production, billing off (no flag, no webhook secret)", { NODE_ENV: "production" }],
    ["production, BILLING_ENABLED=false even with a webhook secret", { NODE_ENV: "production", BILLING_ENABLED: "false", STRIPE_WEBHOOK_SECRET: "whsec_x" }],
    ["development, billing on, no key (the placeholder stands in)", { NODE_ENV: "development", BILLING_ENABLED: "true" }],
    ["test, wired to Stripe, no key", { NODE_ENV: "test", STRIPE_WEBHOOK_SECRET: "whsec_x" }],
  ])("%s", (_name, vars) => {
    expect(loadWith(vars)).toBeNull();
  });
});
