/**
 * ADR-111 — billing configuration: whether billing is enabled, and the Stripe
 * secret key, refused in production when billing needs it and it is missing.
 *
 * Read through `env.ts` at CALL time (tests and the boot sequence set variables
 * after load). `stripeWebhook.service` calls `stripeSecretKey()` once, at its
 * own load, which the boot reaches through the billing routes — so a missing
 * key in production stops the boot with an error naming the variable, as the
 * CERT_SIGNING_SECRET guard does.
 */
import { env, isProduction } from "./env";

/**
 * The stand-in key used outside production when STRIPE_SECRET_KEY is unset.
 * It authenticates nothing: Stripe refuses it. (The gitleaks allowlist names
 * exactly this literal.)
 */
export const STRIPE_KEY_PLACEHOLDER = "sk_test_placeholder";

/** A variable's trimmed value, or null when unset or blank. */
const trimmed = (name: string): string | null => {
  const value = (env(name) ?? "").trim();
  return value === "" ? null : value;
};

/**
 * Whether this deployment bills through Stripe.
 *
 * `BILLING_ENABLED=true|false` decides. Unset (or any other value), billing is
 * enabled exactly when `STRIPE_WEBHOOK_SECRET` is set: a deployment wired to
 * Stripe's webhooks is billing, and must not do so with a placeholder key.
 */
export const billingEnabled = (): boolean => {
  const flag = (trimmed("BILLING_ENABLED") ?? "").toLowerCase();
  if (flag === "true") {
    return true;
  }
  if (flag === "false") {
    return false;
  }
  return trimmed("STRIPE_WEBHOOK_SECRET") !== null;
};

/**
 * The Stripe secret key.
 *
 * STRIPE_SECRET_KEY when it is set (not blank). Otherwise: in production with
 * billing enabled, an error naming the variable (ADR-111); anywhere else, the
 * placeholder, so development and the test suites run without Stripe.
 *
 * @throws Error in production with billing enabled and no key
 */
export const stripeSecretKey = (): string => {
  const key = trimmed("STRIPE_SECRET_KEY");
  if (key !== null) {
    return key;
  }
  if (isProduction() && billingEnabled()) {
    throw new Error(
      "STRIPE_SECRET_KEY is required in production when billing is enabled (ADR-111). " +
        "Set it, or set BILLING_ENABLED=false on a deployment that does not bill through Stripe.",
    );
  }
  return STRIPE_KEY_PLACEHOLDER;
};
