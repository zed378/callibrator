/**
 * P10-13 (AC-12) — live: request access → the super admin's queue → approve
 * (tenant + first administrator + invitation, ONE transaction) → the
 * invitation accepted (single use) → the new administrator signs in; and the
 * reject path. Against a RUNNING backend in production mode (the budgets are
 * the production ones; see p10Live.ts on client addresses).
 *
 * Spec: MEMORY/specs/P10-05-request-access.md · ADR-098 §6 · ADR-108.
 *
 * Env: BASE_URL, E2E_OPERATOR_PASSWORD (+ E2E_BOOTSTRAP_PASSWORD on a fresh
 * stack), E2E_MAILPIT_URL for the invitation mail (without it the invitation
 * and sign-in tests are SKIPPED, by name).
 *
 * The SERVER must have PRIVACY_NOTICE_URL set (Q-42, ADR-113): without a
 * published notice the intake is absent (404). The disposable stack sets it
 * (scripts/ci/e2e-env.sh); the first test says so by name when it is not.
 */
import {
  arr,
  call,
  dataOf,
  envelope,
  stackMode,
  invitationTokenFor,
  mailAvailable,
  messageOf,
  newClientAddress,
  obj,
  operatorToken,
  queuedFor,
  accessRequestBody,
  runStamp,
  signIn,
  str,
  strongPassword,
  submitAndFind,
  tenantCodeFor,
} from "../p10Live";

const withMail = mailAvailable() ? test : test.skip;

const stamp = runStamp();
const address = (label: string): string => `p10-${label}-${stamp}@rs-p10-${stamp}.example.com`;

let operator = "";
/** The approved request's first administrator. */
const admin = { email: address("admin"), password: strongPassword("admin"), token: "", requestId: "", tenantId: "", tenantCode: "" };
let approvedAt = 0;

beforeAll(async () => {
  operator = await operatorToken();
});

describe("P10 request access — the public intake (live, production budgets)", () => {
  test("Q-42: the stack publishes a privacy notice, so the intake EXISTS (an empty body is a 400, not the absent-route 404)", async () => {
    const res = await call("POST", "/access-requests", { body: {}, from: newClientAddress() });
    expect({ status: res.status, hint: "404 here means the server has no PRIVACY_NOTICE_URL (Q-42, ADR-113)" }).toEqual({
      status: 400,
      hint: "404 here means the server has no PRIVACY_NOTICE_URL (Q-42, ADR-113)",
    });
  });

  test("a new request, a duplicate, an over-cap address and a honeypot hit get ONE answer: 202 'Request received'", async () => {
    const email = address("neutral");
    const trap = address("honeypot");
    const answers = [];
    // new, then duplicates up to the per-address cap (3 a day), then one over it
    for (let i = 0; i < 4; i++) {
      answers.push(await call("POST", "/access-requests", { body: accessRequestBody(email, `RS Netral ${stamp}`), from: newClientAddress() }));
    }
    answers.push(
      await call("POST", "/access-requests", {
        body: { ...accessRequestBody(trap, `RS Umpan ${stamp}`), website: "http://spam.example" },
        from: newClientAddress(),
      }),
    );
    for (const answer of answers) {
      expect(answer.status).toBe(202);
      expect(answer.body).toEqual(answers[0]?.body);
    }
    expect(obj(answers[0]?.body)).toMatchObject({ success: true, status: 202, message: "Request received", data: null });

    // What was stored is not what was answered: three for the capped address, none for the honeypot.
    expect(await queuedFor(operator, email)).toHaveLength(3);
    expect(await queuedFor(operator, trap)).toHaveLength(0);
    for (const status of ["rejected", "spam", "approved"]) {
      expect(await queuedFor(operator, trap, status)).toHaveLength(0);
    }
  });

  test("a body's tenantId / status / decidedBy / provisionedTenantId is ignored (BR-P10-5)", async () => {
    const email = address("strip");
    const answer = await call("POST", "/access-requests", {
      body: {
        ...accessRequestBody(email, `RS Strip ${stamp}`),
        tenantId: "00000000-0000-0000-0000-000000000001",
        status: "approved",
        decidedBy: "00000000-0000-0000-0000-000000000002",
        provisionedTenantId: "00000000-0000-0000-0000-000000000003",
      },
      from: newClientAddress(),
    });
    expect(answer.status).toBe(202);
    const [row] = await queuedFor(operator, email);
    expect(row).toMatchObject({ status: "pending", provisionedTenantId: null, decidedAt: null });
  });

  test("a malformed field is a 400 about its shape (consent missing)", async () => {
    const answer = await call("POST", "/access-requests", {
      body: { ...accessRequestBody(address("shape"), `RS Bentuk ${stamp}`), consent: false },
      from: newClientAddress(),
    });
    expect(answer.status).toBe(400);
  });

  test("the per-address budget: five an hour, the sixth is 429 with Retry-After (ADR-100 accessRequest; production only)", async () => {
    const from = newClientAddress();
    if ((await stackMode()) !== "production") {
      // Outside production the limit is 5 × RATE_LIMIT_NON_PRODUCTION_FACTOR: six pass, and the 429 is NOT asserted here.
      for (let i = 0; i < 6; i++) {
        const reply = await call("POST", "/access-requests", { body: accessRequestBody(address(`nbudget${String(i)}`), `RS Kuota ${stamp}`), from });
        expect(reply.status).toBe(202);
      }
      process.stderr.write("P10-13: non-production stack — the access-request budget (5/h per address) was not asserted\n");
      return;
    }
    const replies = [];
    for (let i = 0; i < 6; i++) {
      replies.push(await call("POST", "/access-requests", { body: accessRequestBody(address(`budget${String(i)}`), `RS Kuota ${stamp}`), from }));
    }
    expect(replies.map((r) => r.status)).toEqual([202, 202, 202, 202, 202, 429]);
    const last = replies[5];
    if (!last) {
      throw new Error("the sixth request was not sent");
    }
    expect(Number(last.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(obj(last.body)["retryAfter"])).toBeGreaterThan(0);
    // Another client is not paused by it.
    const other = await call("POST", "/access-requests", { body: accessRequestBody(address("budget-other"), `RS Kuota ${stamp}`), from: newClientAddress() });
    expect(other.status).toBe(202);
  });
});

describe("P10 the super admin's queue (live)", () => {
  test("GET /admin/access-requests: rows in `data`, pagination and counts in a TOP-LEVEL `meta`", async () => {
    const reply = await call("GET", "/admin/access-requests?status=pending&limit=5", { token: operator });
    expect(reply.status).toBe(200);
    const body = obj(reply.body);
    expect(Array.isArray(body["data"])).toBe(true);
    expect(obj(body["meta"])).toMatchObject({ page: 1, limit: 5 });
    expect(typeof obj(body["meta"])["total"]).toBe("number");
    expect(obj(obj(body["meta"])["counts"])["pending"]).toEqual(expect.any(Number));
    expect(obj(body["data"])["rows"]).toBeUndefined();
  });

  test("the queue refuses a caller with no token (401)", async () => {
    expect((await call("GET", "/admin/access-requests")).status).toBe(401);
  });

  test("approve creates the tenant, its first administrator and the invitation — and a second approve is a 409 state explanation", async () => {
    const row = await submitAndFind(operator, admin.email, `RS Disetujui ${stamp}`);
    admin.requestId = str(row["id"]);
    admin.tenantCode = tenantCodeFor("APR");
    approvedAt = Date.now();
    const approved = await call("POST", `/admin/access-requests/${admin.requestId}/approve`, {
      token: operator,
      body: { tenantCode: admin.tenantCode, adminFirstName: "Siti", adminLastName: "Rahma" },
    });
    expect(approved.status).toBe(200);
    const data = dataOf(approved);
    expect(obj(data["tenant"])["code"]).toBe(admin.tenantCode);
    expect(obj(data["adminUser"])["email"]).toBe(admin.email.toLowerCase());
    expect(data["invitationSent"]).toBe(true);
    expect(JSON.stringify(approved.body)).not.toMatch(/token/i);
    admin.tenantId = str(obj(data["tenant"])["id"]);

    const detail = await call("GET", `/admin/access-requests/${admin.requestId}`, { token: operator });
    expect(detail.status).toBe(200);
    expect(dataOf(detail)).toMatchObject({ status: "approved", provisionedTenantId: admin.tenantId });

    const again = await call("POST", `/admin/access-requests/${admin.requestId}/approve`, {
      token: operator,
      body: { tenantCode: tenantCodeFor("AGN") },
    });
    expect(again.status).toBe(409);
    expect(messageOf(again)).toMatch(/approved/i);

    // Before the invitation is accepted the account has no usable password.
    expect((await signIn(admin.email, admin.password)).status).toBe(401);
  });

  test("two concurrent approvals of one request → exactly one tenant (one 200, one 409)", async () => {
    const email = address("race");
    const row = await submitAndFind(operator, email, `RS Balapan ${stamp}`);
    const codes = [tenantCodeFor("RCA"), tenantCodeFor("RCB")];
    const replies = await Promise.all(
      codes.map((tenantCode) =>
        call("POST", `/admin/access-requests/${str(row["id"])}/approve`, { token: operator, body: { tenantCode } }),
      ),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    let tenants = 0;
    for (const code of codes) {
      const found = await call("GET", `/admin/tenants?search=${code}&limit=10`, { token: operator });
      expect(found.status).toBe(200);
      tenants += arr(dataOf(found)["tenants"]).map(obj).filter((t) => str(t["code"]) === code).length;
    }
    expect(tenants).toBe(1);
  });

  test("reject: a reason is required; a rejected request cannot be approved or re-invited", async () => {
    const email = address("reject");
    const row = await submitAndFind(operator, email, `RS Ditolak ${stamp}`);
    const id = str(row["id"]);
    expect((await call("POST", `/admin/access-requests/${id}/reject`, { token: operator, body: {} })).status).toBe(400);
    const rejected = await call("POST", `/admin/access-requests/${id}/reject`, {
      token: operator,
      body: { reason: "P10-13 live E2E: not a healthcare facility" },
    });
    expect(rejected.status).toBe(200);
    expect(dataOf(rejected)).toMatchObject({ status: "rejected" });
    const approve = await call("POST", `/admin/access-requests/${id}/approve`, { token: operator, body: { tenantCode: tenantCodeFor("REJ") } });
    expect(approve.status).toBe(409);
    expect(messageOf(approve)).toMatch(/rejected/i);
    expect((await call("POST", `/admin/access-requests/${id}/resend-invitation`, { token: operator })).status).toBe(409);
    expect(await queuedFor(operator, email, "rejected")).toHaveLength(1);
  });

  test("an unknown request id is a 404", async () => {
    const reply = await call("GET", "/admin/access-requests/9b2f7c1e-0d6a-4f3b-8a21-5c4e3d2b1a09", { token: operator });
    expect(reply.status).toBe(404);
  });
});

describe("P10 the invitation (live, mailed link)", () => {
  withMail("the invitation link sets the password once: a second use and a forged token get the same 400", async () => {
    const token = await invitationTokenFor(admin.email, approvedAt);
    expect(token.length).toBeGreaterThanOrEqual(20);

    // A password that breaks the rule is refused before the link is spent.
    const weak = await call("POST", "/auth/invitation/accept", { body: { token, password: "short" }, from: newClientAddress() });
    expect(weak.status).toBe(400);

    const accepted = await call("POST", "/auth/invitation/accept", { body: { token, password: admin.password }, from: newClientAddress() });
    expect(accepted.status).toBe(200);

    const reused = await call("POST", "/auth/invitation/accept", { body: { token, password: strongPassword("again") }, from: newClientAddress() });
    const forged = await call("POST", "/auth/invitation/accept", {
      body: { token: `${token.slice(0, -4)}AAAA`, password: strongPassword("forged") },
      from: newClientAddress(),
    });
    expect(reused.status).toBe(400);
    expect(forged.status).toBe(400);
    expect(envelope(forged)).toEqual(envelope(reused));
  });

  withMail("the new administrator signs in with the password they chose: a full session in their own tenant, no password change asked", async () => {
    const reply = await signIn(admin.email, admin.password);
    expect(reply.status).toBe(200);
    const data = dataOf(reply);
    expect(data["passwordChangeRequired"]).toBeUndefined();
    expect(data["mfaRequired"]).toBeUndefined();
    expect(data["tenantId"]).toBe(admin.tenantId);
    admin.token = str(obj(reply.body)["token"]);
    expect(admin.token).not.toBe("");
    expect((await call("POST", "/auth/verify", { token: admin.token })).status).toBe(200);
  });

  withMail("the new administrator is refused the platform queue (403 inside their own tenant)", async () => {
    expect((await call("GET", "/admin/access-requests", { token: admin.token })).status).toBe(403);
  });

  withMail("an accepted invitation cannot be re-sent (409 state explanation)", async () => {
    const reply = await call("POST", `/admin/access-requests/${admin.requestId}/resend-invitation`, { token: operator });
    expect(reply.status).toBe(409);
    expect(messageOf(reply)).toMatch(/already accepted/i);
  });
});
