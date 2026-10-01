/**
 * V-17 — the algorithm recorded on a Part 11 signature is the one that made it.
 *
 * eSignature.service read SIGNATURE_ALGORITHM from the environment, stored it
 * on every record (`signatureAlgorithm`) and bound it into the canonical
 * payload, while signing and verification were hardcoded RSA-SHA256. With
 * SIGNATURE_ALGORITHM=RS512 every new record claimed RS512 over a SHA-256
 * signature — a false statement in a compliance record.
 *
 * Decision (ADR-style note in MEMORY/records/2026-09-30-correctness-batch.md):
 * REMOVE the setting rather than honour it. Honouring it would need every
 * verifier, the scheme id (`esig-v2-rsa-sha256`) and the stored records to
 * agree on a per-record digest, for no requirement anyone has stated; removing
 * it makes the label a constant that cannot disagree with the crypto. A
 * deployment that still sets another value is refused at load.
 *
 * Fail-before: loading the service with SIGNATURE_ALGORITHM=RS512 succeeded and
 * getStatus().algorithm was "RS512"; there was no assertSignatureAlgorithmSetting.
 */
import crypto from "node:crypto";
import { environment } from "../../config/env";

/** The process environment (config/env.ts); the service reads it at load. */
const penv = environment();

jest.mock("../../config", () => ({ db: { transaction: jest.fn() } }));
jest.mock("../../models", () => ({}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

interface ESignatureService {
  getStatus: () => { algorithm: string };
  assertSignatureAlgorithmSetting: (value: string | undefined) => void;
}

const load = (setting: string | undefined): ESignatureService => {
  const saved = penv["SIGNATURE_ALGORITHM"];
  if (setting === undefined) {
    Reflect.deleteProperty(penv, "SIGNATURE_ALGORITHM");
  } else {
    penv["SIGNATURE_ALGORITHM"] = setting;
  }
  try {
    let service: ESignatureService | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the service is JavaScript (CommonJS)
      service = require("../../services/eSignature.service") as ESignatureService;
    });
    if (!service) {
      throw new Error("not loaded");
    }
    return service;
  } finally {
    if (saved === undefined) {
      Reflect.deleteProperty(penv, "SIGNATURE_ALGORITHM");
    } else {
      penv["SIGNATURE_ALGORITHM"] = saved;
    }
  }
};

describe("V-17 — SIGNATURE_ALGORITHM cannot relabel a signature", () => {
  it("unset: the service records RS256", () => {
    expect(load(undefined).getStatus().algorithm).toBe("RS256");
  });

  it("RS256 set explicitly is accepted (the value that is true)", () => {
    expect(load("RS256").getStatus().algorithm).toBe("RS256");
  });

  it("an empty value is treated as unset", () => {
    expect(load("").getStatus().algorithm).toBe("RS256");
  });

  it.each(["RS512", "PS256", "ES256", "rs256"])("SIGNATURE_ALGORITHM=%s refuses the service at load", (value) => {
    expect(() => load(value)).toThrow(/SIGNATURE_ALGORITHM=.* is not supported/);
  });

  it("RS256 is what crypto.sign('sha256') makes with an RSA key: PKCS#1 v1.5 + SHA-256", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const payload = Buffer.from("canonical payload", "utf8");
    const signature = crypto.sign("sha256", payload, privateKey);
    // Verifying with the explicit PKCS#1 v1.5 padding proves the default is RS256's.
    expect(
      crypto.verify("sha256", payload, { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, signature),
    ).toBe(true);
    // And an RS512 verifier (SHA-512) would reject it — the old label was false.
    expect(crypto.verify("sha512", payload, publicKey, signature)).toBe(false);
  });
});
