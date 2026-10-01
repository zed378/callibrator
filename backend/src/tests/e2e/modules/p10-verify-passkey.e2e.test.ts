/**
 * P10-13 (AC-12) — live: public certificate verification (A-293 / P10-14,
 * P10-08) and the passwordless passkey ceremony's refusals (P10-10), against a
 * RUNNING backend in production mode.
 *
 * Verification: the QR's token → the FULL verdict; the bare number, or a
 * wrong token → the MINIMAL one, identical for both (a wrong token must not
 * be distinguishable from none); an unknown number → found:false; the minimal
 * verdict is budgeted at 60 per 15 minutes per address (the 61st is a 429),
 * and that budget does not stop a token holder.
 *
 * Passkey: the options carry no allowCredentials and require user
 * verification; every refusal of /verify is ONE 401 (unknown ceremony, a
 * credential no account holds, a replayed ceremony), and a malformed body is
 * a 400 about its shape. The successful ceremony is proven in the browser
 * with a virtual authenticator (automate/p10.browser.ts).
 *
 * Env: BASE_URL, E2E_OPERATOR_PASSWORD.
 */
import { randomBytes } from "crypto";
import { call, dataOf, envelope, issueSignedCertificate, newClientAddress, obj, operatorSession, stackMode, str } from "../p10Live";

let operator = "";
let tenantId = "";
let certificate: Awaited<ReturnType<typeof issueSignedCertificate>> | null = null;

beforeAll(async () => {
  ({ token: operator, tenantId } = await operatorSession());
  certificate = await issueSignedCertificate(operator, tenantId);
}, 120000);

afterAll(async () => {
  await certificate?.cleanup();
});

const cert = (): NonNullable<typeof certificate> => {
  if (!certificate) {
    throw new Error("E2E P10: no certificate was issued");
  }
  return certificate;
};

const verify = async (number: string, token: string | null, from: string) =>
  call("GET", `/certificates/verify/${encodeURIComponent(number)}${token === null ? "" : `?token=${encodeURIComponent(token)}`}`, { from });

describe("P10 public certificate verification (live, A-293)", () => {
  test("the QR token gives the full verdict: device, signer, the document", async () => {
    const reply = await verify(cert().number, cert().verificationToken, newClientAddress());
    expect(reply.status).toBe(200);
    const data = dataOf(reply);
    expect(data).toMatchObject({ disclosure: "full", found: true, valid: true, status: "signed", certificateNumber: cert().number });
    expect(obj(data["device"])["serialNumber"]).toEqual(expect.any(String));
    expect(data["signedBy"]).toBeTruthy();
    expect(obj(data["document"])).not.toEqual({});
  });

  test("the bare number and a WRONG token give the same minimal verdict — no device, no signer, no document", async () => {
    const bare = await verify(cert().number, null, newClientAddress());
    const wrong = await verify(cert().number, randomBytes(24).toString("base64url"), newClientAddress());
    for (const reply of [bare, wrong]) {
      expect(reply.status).toBe(200);
      const data = dataOf(reply);
      expect(data).toMatchObject({ disclosure: "minimal", found: true, valid: true, certificateNumber: cert().number });
      for (const hidden of ["device", "signedBy", "document", "documentUrl", "verifyUrl", "standard"]) {
        expect(data).not.toHaveProperty(hidden);
      }
    }
    expect(wrong.body).toEqual(bare.body);
  });

  test("an unknown number is found:false, not an error", async () => {
    const reply = await verify(`CERT-NOPE-${randomBytes(4).toString("hex")}`, null, newClientAddress());
    expect(reply.status).toBe(200);
    expect(dataOf(reply)).toMatchObject({ found: false, valid: false });
  });

  test("the minimal verdict is budgeted per address: 60 answer, the 61st is 429 with Retry-After — and the token holder is not stopped (production only)", async () => {
    const from = newClientAddress();
    if ((await stackMode()) !== "production") {
      process.stderr.write("P10-13: non-production stack — the minimal-verdict budget (60/15 min per address) was not asserted\n");
      expect((await verify(cert().number, null, from)).status).toBe(200);
      return;
    }
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      statuses.push((await verify(i % 2 === 0 ? cert().number : `CERT-NOPE-${String(i)}`, null, from)).status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    const paused = await verify(cert().number, null, from);
    expect(statuses[60]).toBe(429);
    expect(paused.status).toBe(429);
    expect(Number(paused.headers["retry-after"])).toBeGreaterThan(0);

    const full = await verify(cert().number, cert().verificationToken, from);
    expect(full.status).toBe(200);
    expect(dataOf(full)["disclosure"]).toBe("full");
  }, 120000);
});

describe("P10 passwordless passkey ceremony — refusals (live, P10-10)", () => {
  const b64 = (n: number): string => randomBytes(n).toString("base64url");

  const assertion = (ceremonyId: string, credentialId = b64(32)) => ({
    ceremonyId,
    credential: {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      response: {
        clientDataJSON: Buffer.from(
          JSON.stringify({ type: "webauthn.get", challenge: b64(32), origin: "http://localhost:3000" }),
        ).toString("base64url"),
        authenticatorData: b64(37),
        signature: b64(70),
        userHandle: b64(16),
      },
      clientExtensionResults: {},
    },
  });

  test("the options name no account: no allowCredentials, user verification required, a fresh ceremony each time", async () => {
    const first = await call("POST", "/auth/passkey/options", { body: {}, from: newClientAddress() });
    const second = await call("POST", "/auth/passkey/options", { body: { email: "someone@example.com" }, from: newClientAddress() });
    for (const reply of [first, second]) {
      expect(reply.status).toBe(200);
      const options = obj(dataOf(reply)["options"]);
      expect(options["userVerification"]).toBe("required");
      expect(options["allowCredentials"] ?? []).toEqual([]);
      expect(str(dataOf(reply)["ceremonyId"]).length).toBeGreaterThanOrEqual(20);
    }
    expect(dataOf(first)["ceremonyId"]).not.toBe(dataOf(second)["ceremonyId"]);
    expect(obj(dataOf(first)["options"])["challenge"]).not.toBe(obj(dataOf(second)["options"])["challenge"]);
  });

  test("an unknown ceremony, a credential no account holds, and a spent ceremony all get ONE 401", async () => {
    const from = newClientAddress();
    const unknownCeremony = await call("POST", "/auth/passkey/verify", { body: assertion(b64(32)), from });

    const options = await call("POST", "/auth/passkey/options", { body: {}, from });
    const ceremonyId = str(dataOf(options)["ceremonyId"]);
    const unknownCredential = await call("POST", "/auth/passkey/verify", { body: assertion(ceremonyId), from });
    const replayed = await call("POST", "/auth/passkey/verify", { body: assertion(ceremonyId), from });

    for (const reply of [unknownCeremony, unknownCredential, replayed]) {
      expect(reply.status).toBe(401);
      expect(envelope(reply)).toEqual(envelope(unknownCeremony));
      expect(obj(reply.body)["token"]).toBeUndefined();
    }
  });

  test("a malformed assertion is a 400 about its shape, never a 500", async () => {
    const from = newClientAddress();
    const noCredential = await call("POST", "/auth/passkey/verify", { body: { ceremonyId: b64(32) }, from });
    const badType = await call("POST", "/auth/passkey/verify", {
      body: { ...assertion(b64(32)), credential: { ...assertion(b64(32)).credential, type: "password" } },
      from,
    });
    const notBase64url = await call("POST", "/auth/passkey/verify", {
      body: { ...assertion(b64(32)), credential: { ...assertion(b64(32)).credential, id: "not base64url!" } },
      from,
    });
    for (const reply of [noCredential, badType, notBase64url]) {
      expect(reply.status).toBe(400);
    }
  });
});
