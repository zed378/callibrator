/**
 * A-331 (ADR-100 Amendment 4) — attributes that never leave the server in a
 * serialised model.
 *
 * `POST /roles/assign` answered `User.findByPk(userId)` as it came: the bcrypt
 * hash, the MFA seed envelopes, the recovery codes, the OTP and the WebAuthn
 * columns reached the response body. The service now answers a projection;
 * this is the defence in depth for every OTHER place an unfiltered row reaches
 * `res.json`: each listed model's `toJSON()` drops these attributes, so
 * `JSON.stringify(row)` — what Express does — can never carry them. Code that
 * needs a value reads the instance (`user.password`, `row.get("keyHash")`),
 * which is unchanged.
 *
 * A value a caller must see ONCE (a new webhook secret, a new API key) is
 * returned by its service as a separate field it names, never through the row.
 *
 * The response-scanning guard (tests/support/secretScan.ts, S-20) holds the
 * same names at the response boundary.
 */

/** Per model, the attributes `toJSON()` drops. */
export const SECRET_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  User: Object.freeze([
    "password",
    "mfaSecret",
    "mfaPendingSecret",
    "mfaPendingCreatedAt",
    "mfaLastUsedStep",
    "mfaRecoveryCodes",
    "otpCode",
    "otpExpiredAt",
    "otpRequestCount",
    "otpLastRequestedAt",
    "webauthnCredentialId",
    "webauthnPublicKey",
    "webauthnSignCount",
  ]),
  ApiKey: Object.freeze(["keyHash"]),
  Session: Object.freeze(["token_hash"]),
  Webhook: Object.freeze(["secret", "previousSecret"]),
  TenantKey: Object.freeze(["privateKey"]),
  AccessRequest: Object.freeze(["invitationTokenHash", "sourceIpHash"]),
  CalibrationDevice: Object.freeze(["iotTokenHash"]),
});

/** What the installer needs of a model class. */
interface SerialisableModel {
  prototype: { toJSON: (this: unknown) => unknown };
}

/**
 * Wrap each listed model's `toJSON` so the listed attributes are dropped from
 * whatever the model's own `toJSON` produced (a model that already overrides
 * it, like CalibrationDevice, keeps its override).
 *
 * @param models - the loaded models, by name
 * @returns the names of the models it wrapped
 */
export const installSecretRedaction = (models: Readonly<Record<string, SerialisableModel | undefined>>): string[] => {
  const wrapped: string[] = [];
  for (const [name, attributes] of Object.entries(SECRET_ATTRIBUTES)) {
    const model = models[name];
    if (!model) {
      throw new Error(`secretAttributes: no model named ${name} is loaded`);
    }
    const original = model.prototype.toJSON;
    model.prototype.toJSON = function redactedToJSON(this: unknown): unknown {
      const plain = original.call(this);
      if (plain === null || typeof plain !== "object") {
        return plain;
      }
      const copy: Record<string, unknown> = { ...(plain as Record<string, unknown>) };
      for (const attribute of attributes) {
        Reflect.deleteProperty(copy, attribute);
      }
      return copy;
    };
    wrapped.push(name);
  }
  return wrapped;
};
