/**
 * P7-08 / ADR-071 follow-up — may the verification page frame the certificate
 * PDF, and may nothing else be framed?
 *
 * The public verification page (frontend `verify/[certificateNumber]`) shows
 * the signed PDF in an <iframe> whose src is `NEXT_PUBLIC_API_BASE_URL` +
 * `documentUrl`. In every deployment template that base is the public origin,
 * so the frame is served through the Next `/api` proxy, which relays the
 * backend's headers unchanged. The question was whether helmet's global
 * `frame-ancestors 'none'` and `X-Frame-Options` reach that iframe.
 *
 * They do not: the document route replaces the CSP with its own
 * `frame-ancestors 'self' <CORS_ORIGIN…>` and removes X-Frame-Options
 * (fileResponse.util applyFileHeaders). Through the proxy, `'self'` is the
 * page's own origin. Verified live 2026-09-25 (headless Chrome 154, real
 * backend on PostgreSQL 18, `next build` + `next start`): the PDF viewer
 * rendered in the frame, and a control iframe of an ordinary API response was
 * refused for `frame-ancestors 'none'`.
 *
 * This suite pins those headers over helmet configured EXACTLY as index.js
 * configures it, so a change to either side is caught:
 *  - the verification document: framable by 'self' and the configured
 *    frontend origins, no X-Frame-Options;
 *  - everything else — the verification JSON and the gated certificate PDF
 *    download — keeps helmet's `frame-ancestors 'none'` and
 *    `X-Frame-Options: SAMEORIGIN`.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const express = require("express");
const helmet = require("helmet");

jest.mock("../../services/certificatePdf.service", () => ({
  verifyByCertificateNumber: jest.fn(),
  getVerifiedDocument: jest.fn(),
  getOrCreatePdf: jest.fn(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const certificatePdfService = require("../../services/certificatePdf.service");
const controller = require("../../controllers/certificatePdf.controller");
const { API_CSP_DIRECTIVES } = require("../../utils/csp.util");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p708-frame-"));
const PDF_PATH = path.join(dir, "cert.pdf");
const CERT_ID = "7f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const NUMBER = "CERT-20260925-ACME-0001";

let server;
let base;

const get = (urlPath) =>
  new Promise((resolve, reject) => {
    http
      .get(`${base}${urlPath}`, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
      })
      .on("error", reject);
  });

beforeAll(async () => {
  fs.writeFileSync(PDF_PATH, `%PDF-1.7\n${"x".repeat(64)}`);
  process.env.CORS_ORIGIN = "https://app.example.test";

  const app = express();
  // index.js, verbatim.
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: true, directives: { ...API_CSP_DIRECTIVES } },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.get("/api/v1/certificates/verify/:certificateNumber", controller.verifyCertificate);
  app.get("/api/v1/certificates/verify/:certificateNumber/document", controller.verifyDocument);
  app.get(
    "/api/v1/certificates/:certificateId/pdf",
    (req, _res, next) => {
      req.user = { id: "u-1", tenantId: "t-1" };
      next();
    },
    controller.downloadPdf,
  );
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CORS_ORIGIN;
});

beforeEach(() => {
  certificatePdfService.getVerifiedDocument.mockResolvedValue({
    success: true,
    data: { absPath: PDF_PATH, fileName: `${NUMBER}.pdf` },
  });
  certificatePdfService.getOrCreatePdf.mockResolvedValue({
    success: true,
    data: { absPath: PDF_PATH, fileName: `${NUMBER}.pdf` },
  });
  certificatePdfService.verifyByCertificateNumber.mockResolvedValue({
    success: true,
    data: { found: true, valid: true },
  });
});

describe("P7-08 — only the verification document may be framed", () => {
  it("the verification document is framable by 'self' and the frontend origin, with no X-Frame-Options, under the real helmet", async () => {
    const res = await get(`/api/v1/certificates/verify/${NUMBER}/document?token=t`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'self' https://app.example.test",
    );
    expect(res.headers["x-frame-options"]).toBeUndefined();
  });

  it("the verification JSON keeps helmet's frame-ancestors 'none' and X-Frame-Options: SAMEORIGIN", async () => {
    const res = await get(`/api/v1/certificates/verify/${NUMBER}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  it("the gated certificate PDF download is not framable: frame-ancestors 'none' and X-Frame-Options: SAMEORIGIN", async () => {
    const res = await get(`/api/v1/certificates/${CERT_ID}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });
});
