/**
 * E2E Tests: Certificates module (LIVE HTTP)
 *
 * Mount: /api/v1/certificates  (see index.js)
 * A certificate requires a deviceId FK (validator: createCertificateSchema),
 * so a parent device + record are created in beforeAll.
 *
 * KNOWN DEFECT captured below: POST /:id/approve on a freshly-created (draft)
 * certificate returns HTTP 500 ("Cannot approve certificate with status:
 * draft") — the model's approve() throws a plain Error for any status other
 * than PENDING_APPROVAL, and there is no submit-for-approval route to move a
 * draft into PENDING_APPROVAL. A business-rule rejection should be a 4xx.
 */
const {
  httpGet,
  httpPost,
  httpDelete,
  authHeader,
  extractToken,
} = require("../setup") as any;
// P10-16 (ADR-099): no default operator password — set E2E_OPERATOR_PASSWORD (see setup.js).
const { OPERATOR_PASSWORD } = require("../setup") as any;

describe("E2E Certificates (HTTP)", () => {
  let token: any = undefined;
  let deviceId: any = undefined;
  let recordId: any = undefined;
  let certId: any = undefined;
  let certNumber: any = undefined;

  async function login() {
    const { body } = await httpPost("/auth/login", {
      user: "sys@mail.com",
      password: OPERATOR_PASSWORD,
    });
    return extractToken(body);
  }

  beforeAll(async () => {
    token = await login();
    expect(token).toBeTruthy();
    const dev = await httpPost(
      "/calibration-devices",
      { name: "E2E Cert Device", serialNumber: `E2E-CERT-${Date.now()}` },
      authHeader(token),
    );
    deviceId = (dev.body as any).data.id;
    const rec = await httpPost(
      "/calibration-records",
      { deviceId, calibrationDate: "2026-06-15" },
      authHeader(token),
    );
    recordId = (rec.body as any).data.id;
  });

  afterAll(async () => {
    if (certId) {await httpDelete(`/certificates/${certId}`, authHeader(token));}
    if (recordId) {
      // P6-03: calibration records cannot be deleted; teardown voids it.
      await httpPost(`/calibration-records/${recordId}/void`, { reason: "e2e teardown" }, authHeader(token));
    }
    if (deviceId) {
      await httpDelete(`/calibration-devices/${deviceId}`, authHeader(token));
    }
  });

  test("GET /certificates — 200, data array, meta top-level", async () => {
    const { status, body } = await httpGet("/certificates", authHeader(token));
    expect(status).toBe(200);
    expect(Array.isArray((body as any).data)).toBe(true);
    expect((body as any).meta).toBeDefined();
  });

  test("GET /certificates/stats — 200 returns stats object", async () => {
    const { status, body } = await httpGet(
      "/certificates/stats",
      authHeader(token),
    );
    expect(status).toBe(200);
    expect(typeof (body as any).data).toBe("object");
  });

  test("POST /certificates — 201 creates certificate", async () => {
    const { status, body } = await httpPost(
      "/certificates",
      { deviceId, calibrationRecordId: recordId, type: "calibration", summary: "e2e" },
      authHeader(token),
    );
    expect(status).toBe(201);
    expect((body as any).data).toHaveProperty("id");
    certId = (body as any).data.id;
    certNumber = (body as any).data.certificateNumber;
  });

  test("GET /certificates/:id — 200 returns the certificate", async () => {
    const { status, body } = await httpGet(
      `/certificates/${certId}`,
      authHeader(token),
    );
    expect(status).toBe(200);
    expect((body as any).data.id).toBe(certId);
  });

  // M-11 (ADR-095): the backend renders no PDF. The document is data, rendered
  // into a PDF by the frontend; only a PDF stored before the change is served.
  test("GET /certificates/:id/document — 200, the printed fields and the v2 integrity hash", async () => {
    const { status, body } = await httpGet(
      `/certificates/${certId}/document`,
      authHeader(token),
    );
    expect(status).toBe(200);
    expect((body as any).success).toBe(true);
    expect((body as any).data.certificateNumber).toBe(certNumber);
    expect((body as any).data.status).toBe("draft");
    expect((body as any).data.verifyUrl).toContain(certNumber);
    expect((body as any).data.integrity).toMatchObject({
      scheme: "certificate-content-v2",
      algorithm: "SHA-256",
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      legacyHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      signature: expect.stringMatching(/^[0-9a-f]{64}$/),
      signatureKeyId: expect.stringMatching(/^hmac-sha256:/),
    });
  });

  test("GET /certificates/:id/document — 404 for a certificate that does not exist", async () => {
    const { status, body } = await httpGet(
      "/certificates/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/document",
      authHeader(token),
    );
    expect(status).toBe(404);
    expect((body as any).success).toBe(false);
  });

  test("GET /certificates/:id/pdf — 404 enveloped: nothing is rendered, and this one has no stored PDF", async () => {
    const { status, body } = await httpGet(
      `/certificates/${certId}/pdf`,
      authHeader(token),
    );
    expect(status).toBe(404);
    expect((body as any).success).toBe(false);
    expect((body as any).message).toMatch(/\/document/);
  });

  test("POST /certificates/:id/pdf — the render route is gone (404)", async () => {
    const { status } = await httpPost(`/certificates/${certId}/pdf`, {}, authHeader(token));
    expect(status).toBe(404);
  });

  // A-293 (2026-09-29-security-followups): a lookup by the bare number is the
  // MINIMAL verdict — no document, no device, no signer — with the hashes
  // (M-11). The full verdict needs the QR token (p10-verify-passkey.e2e).
  test("GET /certificates/verify/:number — 200 public verification result (minimal, by number)", async () => {
    const { status, body } = await httpGet(
      `/certificates/verify/${certNumber}`,
    );
    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
    expect((body as any).data.disclosure).toBe("minimal");
    expect((body as any).data).not.toHaveProperty("document");
    expect((body as any).data.integrity.scheme).toBe("certificate-content-v2");
    expect((body as any).data.integrity.legacyHash).toEqual(expect.any(String));
  });

  test("POST /certificates — 400 when deviceId missing", async () => {
    const { status } = await httpPost(
      "/certificates",
      { type: "calibration" },
      authHeader(token),
    );
    expect(status).toBe(400);
  });

  // DEFECT: approving a draft certificate 500s instead of a 4xx. This test
  // documents the current behavior; tighten to expect a 4xx once fixed.
  test("POST /certificates/:id/approve — rejects draft (currently 500)", async () => {
    const { status } = await httpPost(
      `/certificates/${certId}/approve`,
      {
        approvedBy: "757de053-22bc-499a-975c-5a594ec5ffa8",
        authMethod: "password",
        authPayload: OPERATOR_PASSWORD,
        meaning: "I approve",
      },
      authHeader(token),
    );
    // Should be 400/409/422; currently the model throws a plain Error -> 500.
    expect([400, 409, 422, 500]).toContain(status);
  });

  test("DELETE /certificates/:id — 200 removes the certificate", async () => {
    const { status } = await httpDelete(
      `/certificates/${certId}`,
      authHeader(token),
    );
    expect(status).toBe(200);
    certId = null;
  });
});
