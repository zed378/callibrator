/**
 * P6-10 — the certificate HMAC names the CERT_SIGNING_SECRET that made it.
 *
 * Real crypto (certificatePdf.service.test.js mocks it). The id is a
 * fingerprint of the secret, so a rotated secret yields a different id and a
 * stored signature could be verified against the key it names.
 */
jest.mock("../../models", () => ({}));

const crypto = require("crypto");
const { keyIdOf } = require("../../utils/keyring.util");

const load = (secret) => {
  const saved = process.env.CERT_SIGNING_SECRET;
  process.env.CERT_SIGNING_SECRET = secret;
  let mod;
  try {
    jest.isolateModules(() => {
      mod = require("../../services/certificatePdf.service");
    });
  } finally {
    process.env.CERT_SIGNING_SECRET = saved;
  }
  return mod;
};

describe("certificate signature key id (P6-10)", () => {
  it("is hmac-sha256:<fingerprint of CERT_SIGNING_SECRET>, never the secret", () => {
    const { SIGNATURE_KEY_ID } = load("cert-secret-one");
    expect(SIGNATURE_KEY_ID).toBe(`hmac-sha256:${keyIdOf(Buffer.from("cert-secret-one"))}`);
    expect(SIGNATURE_KEY_ID).not.toContain("cert-secret-one");
  });

  it("a rotated secret has a different id, and its HMACs differ", () => {
    const one = load("cert-secret-one");
    const two = load("cert-secret-two");
    expect(one.SIGNATURE_KEY_ID).not.toBe(two.SIGNATURE_KEY_ID);
    expect(one.computeSignature("h")).toBe(crypto.createHmac("sha256", "cert-secret-one").update("h").digest("hex"));
    expect(one.computeSignature("h")).not.toBe(two.computeSignature("h"));
  });
});
