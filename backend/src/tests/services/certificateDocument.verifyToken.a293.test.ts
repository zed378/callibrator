/**
 * A-293 (ADR-100) — the URL a certificate's QR code carries includes the
 * certificate's verification token, so a scan unlocks the full public
 * verdict while a walked number gets the minimal one.
 *
 *  - the verification PAGE form (CERT_VERIFY_BASE_URL): `<base>/<number>?t=<token>`;
 *  - the API fallback form: `<base>/api/v1/certificates/verify/<number>?token=<token>`;
 *  - a row with no token (none can exist after migration 0096) prints the
 *    token-less URL rather than `?t=undefined`.
 *
 * GET /certificates/:id/document (authenticated, own tenant) returns it, so
 * the PDF the frontend renders prints it.
 */
import { environment } from "../../config/env";
import models from "../../models";
import {
  getCertificateDocument,
  resolveVerifyUrl,
  toCertificateDocument,
  type CertificateSource,
} from "../../services/certificateDocument.service";

const processEnv = environment();
const TOKEN = "Zq3v8Xr1TtY0bN4kLmP2sW9aE6hJcF5u";

const cert = (over: Partial<CertificateSource> = {}): CertificateSource => ({
  certificateNumber: "CERT-20260929-RSH-0001",
  tenantId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  status: "signed",
  verificationToken: TOKEN,
  ...over,
});

describe("A-293 — the printed verification URL carries the token", () => {
  const saved = { ...processEnv };
  beforeEach(() => {
    delete processEnv["CERT_VERIFY_BASE_URL"];
    delete processEnv["PUBLIC_BASE_URL"];
  });
  afterEach(() => {
    Object.assign(processEnv, {
      CERT_VERIFY_BASE_URL: saved["CERT_VERIFY_BASE_URL"],
      PUBLIC_BASE_URL: saved["PUBLIC_BASE_URL"],
    });
  });

  it("the verification page form uses `t`", () => {
    processEnv["CERT_VERIFY_BASE_URL"] = "https://app.test/verify/";

    expect(resolveVerifyUrl("CERT-1", "https://ignored.test", TOKEN)).toBe(`https://app.test/verify/CERT-1?t=${TOKEN}`);
  });

  it("the API fallback form uses `token`", () => {
    expect(resolveVerifyUrl("CERT-1", "https://api.test/", TOKEN)).toBe(
      `https://api.test/api/v1/certificates/verify/CERT-1?token=${TOKEN}`,
    );
  });

  it("with no token, the URL is the token-less one — never `undefined` or `null` in it", () => {
    processEnv["CERT_VERIFY_BASE_URL"] = "https://app.test/verify";

    expect(resolveVerifyUrl("CERT-1", null, null)).toBe("https://app.test/verify/CERT-1");
    expect(resolveVerifyUrl("CERT-1", null, "")).toBe("https://app.test/verify/CERT-1");
    expect(resolveVerifyUrl("CERT-1")).toBe("https://app.test/verify/CERT-1");
  });

  it("toCertificateDocument prints the row's own token", () => {
    processEnv["CERT_VERIFY_BASE_URL"] = "https://app.test/verify";

    expect(toCertificateDocument(cert()).verifyUrl).toBe(`https://app.test/verify/CERT-20260929-RSH-0001?t=${TOKEN}`);
    expect(toCertificateDocument(cert({ verificationToken: null })).verifyUrl).toBe(
      "https://app.test/verify/CERT-20260929-RSH-0001",
    );
  });

  it("GET /certificates/:id/document returns the tokened verifyUrl the PDF's QR encodes", async () => {
    const spy = jest.spyOn(models.Certificate, "findOne").mockResolvedValueOnce(cert() as never);

    const result = await getCertificateDocument("tenant-a", "cert-1", { baseUrl: "https://api.test" });

    expect(result.success).toBe(true);
    expect(result.success && result.data.verifyUrl).toBe(
      `https://api.test/api/v1/certificates/verify/CERT-20260929-RSH-0001?token=${TOKEN}`,
    );
    spy.mockRestore();
  });
});
