/**
 * A-299 — the scopes the create dialog offers: exactly what
 * `POST /api/v1/api-keys` accepts (`apiKey.service#assertScopes`): a seeded
 * menu slug, lower case, with `read` or `write`. No wildcard (A-27).
 *
 * The list is @callibrator/contracts/apiKeyScopes, which a backend guard
 * (tests/services/apiKey.scopeContract.a299.test.ts) pins to MENU_SLUGS and
 * sends through the real createApiKey — so the dialog cannot offer a scope
 * the API refuses.
 */
import { API_KEY_SCOPE_ACTIONS, API_KEY_SCOPE_RESOURCES } from "@callibrator/contracts/apiKeyScopes";

// Words shown in capitals or with their own spelling.
const WORDS: Record<string, string> = {
  ai: "AI",
  api: "API",
  gdpr: "GDPR",
  oidc: "OIDC",
  qms: "QMS",
  scim: "SCIM",
  sop: "SOP",
  sql: "SQL", // P24-06: "upstream-sql-import"
  webauthn: "WebAuthn",
  esignature: "E-Signature",
};

/** "supplier-scorecard" → "Supplier Scorecard"; "api-keys" → "API Keys". */
export const scopeLabel = (slug: string): string =>
  slug
    .split("-")
    .map((w) => WORDS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/** The resource choices, alphabetical by label. */
export const RESOURCE_OPTIONS = API_KEY_SCOPE_RESOURCES.map((value) => ({
  value,
  label: scopeLabel(value),
})).sort((a, b) => a.label.localeCompare(b.label));

/** The action choices; write implies read on the backend. */
const ACTION_LABELS: Record<(typeof API_KEY_SCOPE_ACTIONS)[number], string> = {
  read: "Read",
  write: "Write (includes read)",
};
export const ACTION_OPTIONS = API_KEY_SCOPE_ACTIONS.map((value) => ({ value, label: ACTION_LABELS[value] }));
