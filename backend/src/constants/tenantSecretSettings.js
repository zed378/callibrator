/**
 * A-150 — which `tenant_settings` keys hold a credential.
 *
 * One definition, read by three places that must agree:
 *
 *  - models/tenantSettings.model.js envelope-encrypts the value of every
 *    SECRET key at rest (kms.service, tenant id as AAD) and decrypts it on read;
 *  - services/tenant.service.js never copies a REDACTED key into the
 *    `tenants.settings` JSONB column, strips one from every tenant row it
 *    returns, and masks its value in a settings response;
 *  - migration 0035 scrubs REDACTED keys already copied into
 *    `tenants.settings`, and encrypts SECRET values stored in plaintext.
 *
 * Before A-150 the encrypted list lived inside the model and named five keys.
 * `ai_api_key` — the tenant's AI vendor key, read by ai.service — was not one
 * of them, and `updateTenantSettings` copied every DECRYPTED value into
 * `tenants.settings` in plaintext, which every tenant-row API then returned.
 *
 * SECRET is the explicit list PLUS any key whose name looks like a credential
 * (`SECRET_KEY_PATTERN`). `PATCH /tenants/settings` accepts arbitrary keys, so
 * a list alone would leave `smtp_password` — or any key added tomorrow — in
 * plaintext until someone remembered to name it. Encrypting a key that turns
 * out not to be secret costs nothing: the model decrypts it transparently.
 *
 * REDACTED is SECRET plus `oidc_rp_*`: an OIDC relying-party record holds the
 * SHA-256 of that client's secret. It is not encrypted (oidcProvider.service
 * rewrites it with a static `update`, which runs no instance hook), but it is
 * credential material and no response or JSONB copy carries it.
 */

/** Keys that are credentials by name. Encrypted at rest; never returned. */
const SECRET_SETTING_KEYS = Object.freeze([
  "oidc_client_secret",
  "stripe_secret_key",
  "webhook_signing_secret",
  // A tenant's own object-storage keys (bring-your-own bucket).
  "storage_credentials",
  // A-150: the tenant's AI vendor API key (ai.service#getAiConfig).
  "ai_api_key",
  "smtp_password",
]);

/**
 * A key whose name says it holds a credential, in snake_case or camelCase:
 * `smtp_password`, `smtpPassword`, `apiKey`, `x_api_key`, `client_secret`,
 * `access_token`, `private_key`, `aws_access_key_id`, `bind_credentials`.
 */
const SECRET_KEY_PATTERN =
  /(secret|passw(or)?d|passphrase|api_?key|private_?key|access_?key|token|credential)/i;

/**
 * A-178 — keys that USED to be encrypted and no longer are.
 *
 * `sso_idp_cert` is the identity provider's PUBLIC X.509 certificate: it is
 * published in the IdP's metadata and exists to be shared. Classifying it as
 * a secret masked it in `POST /tenants/settings`, so the SSO form showed
 * `[REDACTED]` and a save round-tripped nothing useful. It is now stored and
 * returned as given. A row written before A-178 still holds a `v1:` envelope;
 * the model decrypts an envelope for these keys on read, so such a row reads
 * back as the certificate and is rewritten in plaintext on its next save.
 */
const LEGACY_ENCRYPTED_SETTING_KEYS = Object.freeze(["sso_idp_cert"]);

/** Credential records that are not encrypted but are never returned. */
const REDACTED_KEY_PREFIXES = Object.freeze(["oidc_rp_"]);

/** What a secret setting's value reads as in an API response. */
const SECRET_SETTING_MASK = "[REDACTED]";

/**
 * @param {string} key - a tenant_settings key
 * @returns {boolean} true when the value is envelope-encrypted at rest
 */
const isSecretSettingKey = (key) =>
  typeof key === "string" &&
  (SECRET_SETTING_KEYS.includes(key) || SECRET_KEY_PATTERN.test(key));

/**
 * @param {string} key - a tenant_settings key
 * @returns {boolean} true when a stored `v1:` envelope under this key is
 *   decrypted on read (a secret key, or one that used to be secret)
 */
const isEnvelopeSettingKey = (key) =>
  isSecretSettingKey(key) || LEGACY_ENCRYPTED_SETTING_KEYS.includes(key);

/**
 * @param {string} key - a tenant_settings key
 * @returns {boolean} true when the key must never leave the server or be
 *   copied into `tenants.settings`
 */
const isRedactedSettingKey = (key) =>
  isSecretSettingKey(key) ||
  (typeof key === "string" && REDACTED_KEY_PREFIXES.some((p) => key.startsWith(p)));

module.exports = {
  SECRET_SETTING_KEYS,
  SECRET_KEY_PATTERN,
  REDACTED_KEY_PREFIXES,
  LEGACY_ENCRYPTED_SETTING_KEYS,
  SECRET_SETTING_MASK,
  isSecretSettingKey,
  isEnvelopeSettingKey,
  isRedactedSettingKey,
};
