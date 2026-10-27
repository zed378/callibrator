/**
 * P6-10 — the certificate HMAC names the CERT_SIGNING_SECRET that made it.
 *
 * Real crypto (certificatePdf.service.test.js mocks it). The id is a
 * fingerprint of the secret, so a rotated secret yields a different id and a
 * stored signature could be verified against the key it names.
 */
import crypto from "crypto";
import type * as Keyring from "../../utils/keyring.util";
import { environment } from "../../config/env";

jest.mock("../../models", () => ({}));

// The live environment object (config/env: process.env itself, not a copy).
const penv = environment();

const { keyIdOf } = jest.requireActual<typeof Keyring>("../../utils/keyring.util");

interface CertificatePdfModule {
    SIGNATURE_KEY_ID: string;
    computeSignature: (value: string) => string;
}

const load = (secret: string): CertificatePdfModule => {
  const saved = penv["CERT_SIGNING_SECRET"];

  penv["CERT_SIGNING_SECRET"] = secret;
  let mod: CertificatePdfModule | undefined;
  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the module's load IS the behaviour under test
      mod = require("../../services/certificatePdf.service") as CertificatePdfModule;
    });
  } finally {
    if (saved === undefined) {

      Reflect.deleteProperty(penv, "CERT_SIGNING_SECRET");
    } else {

      penv["CERT_SIGNING_SECRET"] = saved;
    }
  }
  const loaded: CertificatePdfModule | undefined = mod;
  if (loaded === undefined) {
    throw new Error("certificatePdf.service did not load");
  }
  return loaded;
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
