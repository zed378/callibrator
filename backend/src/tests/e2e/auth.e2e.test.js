/**
 * E2E Tests: Authentication Flow
 *
 * Tests the full auth lifecycle via real HTTP requests against the running API server:
 * 1. POST /auth/register — validate input, detect conflicts
 * 2. GET /auth/activation — test activation token validation
 * 3. POST /auth/login — login with credentials
 * 4. POST /auth/verify — verify token validity
 * 5. POST /auth/refresh — refresh opaque token + rotation
 * 6. POST /auth/logout — single session logout
 * 7. POST /auth/send-otp — test OTP validation
 * 8. POST /auth/reset-password — test reset validation
 *
 * NOTE: Express 5 returns 404 (not 405) for wrong methods on defined routes.
 * Error body format: { success: false, status: N, message: "...", data: null }
 */
const {
  httpPost,
  httpGet,
  extractToken,
  extractRefreshToken,
  authHeader,
} = require("./setup");

// Test user credentials
const TEST_USER = {
  firstName: "E2E",
  lastName: "Tester",
  username: "e2e_tester",
  email: "e2e_tester@test.com",
  password: "TestPass123",
};

// P6-02: the refresh tests need an account that CAN sign in. TEST_USER is
// self-registered and never activated, so its sign-in always failed: the two
// refresh tests passed with no assertion at all ("if login fails, test passes
// without assertion"), and every run spent two failed sign-ins on that
// identifier, so from the third run in fifteen minutes it answered 429 (A-185).
// A signer is created per run by the seeded operator instead, and replaces
// the temporary password an administrator set (A-215), so the refresh tests
// assert unconditionally.
const HEALTHCARE_ADMIN_ROLE = "HEALTHCARE ADMIN";
const signer = { email: null, password: null, userId: null, adminToken: null };

async function createSigner() {
  const op = await httpPost("/auth/login", { user: "sys@mail.com", password: "123123" });
  signer.adminToken = extractToken(op.body);
  const admin = authHeader(signer.adminToken);
  const roles = await httpGet("/roles?limit=50", admin);
  const role = (roles.body.data || []).find((r) => r.name === HEALTHCARE_ADMIN_ROLE);
  const stamp = Date.now();
  const temporary = `Temp-${stamp}-Aa1!`;
  signer.email = `auth-refresh-${stamp}@example.com`;
  signer.password = `Chosen-${stamp}-Bb2!`;
  const created = await httpPost(
    "/users/create",
    {
      tenantId: op.body.data.tenantId,
      username: `authref${stamp}`.slice(0, 20),
      firstName: "Auth",
      lastName: "Refresh",
      email: signer.email,
      password: temporary,
      roleId: role.id,
    },
    admin,
  );
  signer.userId = created.body.data.id;
  const first = await httpPost("/auth/login", { email: signer.email, password: temporary });
  const changed = await httpPost(
    "/auth/just-update-password",
    { currentPassword: temporary, newPassword: signer.password },
    authHeader(extractToken(first.body)),
  );
  if (changed.status !== 200) {
    throw new Error(`E2E: the refresh signer could not set a password (${changed.status})`);
  }
}

describe("E2E Authentication Flow (HTTP)", () => {
  beforeAll(createSigner);

  afterAll(async () => {
    if (signer.userId) {
      const resp = await fetch(
        `${require("./setup").API_BASE}/users/delete?userId=${signer.userId}`,
        { method: "DELETE", headers: authHeader(signer.adminToken) },
      );
      await resp.text();
    }
  });
  // ─── 1. REGISTER ───────────────────────────────────────────

  test("POST /auth/register — returns valid response structure", async () => {
    const { status, body } = await httpPost("/auth/register", TEST_USER);

    // User may already exist (409) or validation may fail (400) from env
    // Just verify response structure is correct
    expect(body).toHaveProperty("success");
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("message");
  });

  test("POST /auth/register — 400 on missing firstName", async () => {
    const { status, body } = await httpPost("/auth/register", {
      lastName: "Test",
      username: "nobody1",
      email: "nobody123@test.com",
      password: "TestPass123",
    });

    expect(status).toBe(400);
    expect(body).toHaveProperty("message");
    expect(body.success).toBe(false);
  });

  test("POST /auth/register — 400 on invalid email format", async () => {
    const { status, body } = await httpPost("/auth/register", {
      firstName: "Bad",
      lastName: "User",
      username: "baduser12",
      email: "not-an-email",
      password: "TestPass123",
    });

    expect(status).toBe(400);
    expect(body).toHaveProperty("message");
  });

  test("POST /auth/register — 400 on weak password (no uppercase)", async () => {
    const { status, body } = await httpPost("/auth/register", {
      firstName: "Weak",
      lastName: "Password",
      username: "weakpass_1",
      email: "weakpass1@test.com",
      password: "testpass123", // all lowercase
    });

    expect(status).toBe(400);
    expect(body).toHaveProperty("message");
  });

  test("POST /auth/register — 400 on weak password (no number)", async () => {
    const { status, body } = await httpPost("/auth/register", {
      firstName: "Weak",
      lastName: "Password",
      username: "weakpass_2",
      email: "weakpass2@test.com",
      password: "TestPassNoNumber", // no digit
    });

    expect(status).toBe(400);
    expect(body).toHaveProperty("message");
  });

  test("POST /auth/register — 400 on short username", async () => {
    const { status, body } = await httpPost("/auth/register", {
      firstName: "Bad",
      lastName: "Username",
      username: "ab", // 2 chars, min is 3
      email: "abuser1@test.com",
      password: "TestPass123",
    });

    expect(status).toBe(400);
  });

  test("POST /auth/register — 400 on special chars in username", async () => {
    const { status, body } = await httpPost("/auth/register", {
      firstName: "Bad",
      lastName: "Username",
      username: "user@name", // non-alphanumeric
      email: "special1@test.com",
      password: "TestPass123",
    });

    expect(status).toBe(400);
  });

  test("POST /auth/register — 404 on GET method (Express 5 behavior)", async () => {
    // Express 5 returns 404 (not 405) for wrong methods on routes
    const { status } = await httpGet("/auth/register");
    expect([404, 405]).toContain(status);
  });

  // ─── 2. ACTIVATION ─────────────────────────────────────────

  test("GET /auth/activation — 400 without token", async () => {
    const { status, body } = await httpGet("/auth/activation");
    expect(status).toBe(400);
    expect(body.message).toContain("Activation token is required");
  });

  test("GET /auth/activation — 400 with an invalid token", async () => {
    // A-59: only a valid activation purpose token is looked up; anything else
    // is "Invalid or expired activation token" (400) — never a 500. A-191: a
    // valid token for an address the account no longer has is 400 too.
    const { status, body } = await httpGet("/auth/activation?token=invalidtoken123");
    expect(status).toBe(400);
    expect(body.message).toBe("Invalid or expired activation token");
  });

  test("GET /auth/activation — 400 with empty token", async () => {
    const { status, body } = await httpGet("/auth/activation?token=");
    expect(status).toBe(400);
  });

  // ─── 3. LOGIN ──────────────────────────────────────────────

  test("POST /auth/login — 401 on wrong password", async () => {
    // P6-02: a per-run identifier. Failed sign-ins are throttled per
    // identifier AND address — five in fifteen minutes (A-185) — so the fixed
    // TEST_USER address was paused (429) from the fifth run in a quarter hour.
    // An unknown identifier answers exactly as a wrong password for a real one
    // (A-185: the same 401, by design), so the contract asserted is unchanged.
    const { status, body } = await httpPost("/auth/login", {
      email: `wrong-password-${Date.now()}@e2e.example.com`,
      password: "WrongPassword99",
    });

    expect(status).toBe(401);
    expect(body.message).toContain("Invalid");
  });

  test("POST /auth/login — 400 on missing email", async () => {
    const { status, body } = await httpPost("/auth/login", {
      password: TEST_USER.password,
    });

    expect(status).toBe(400);
  });

  test("POST /auth/login — 400 on missing password", async () => {
    const { status, body } = await httpPost("/auth/login", {
      email: TEST_USER.email,
    });

    expect(status).toBe(400);
  });

  test("POST /auth/login — 400 on empty body", async () => {
    const { status, body } = await httpPost("/auth/login", {});
    expect(status).toBe(400);
  });

  test("POST /auth/login — 404 on GET method (Express 5 behavior)", async () => {
    const { status } = await httpGet("/auth/login");
    expect([404, 405]).toContain(status);
  });

  // ─── 4. SESSION VERIFY ─────────────────────────────────────

  test("POST /auth/verify — 401 without token", async () => {
    const { status, body } = await httpPost("/auth/verify", {});
    expect(status).toBe(401);
  });

  test("POST /auth/verify — 401 with invalid token", async () => {
    const { status, body } = await httpPost("/auth/verify", {}, {
      Authorization: "Bearer invalidtoken",
    });
    expect(status).toBe(401);
    // Message may say "Invalid token" or similar
    expect(body).toHaveProperty("message");
  });

  // ─── 5. REFRESH TOKEN ──────────────────────────────────────

  test("POST /auth/refresh — 400 without refreshToken", async () => {
    const { status, body } = await httpPost("/auth/refresh", {});
    expect(status).toBe(400);
  });

  test("POST /auth/refresh — 401 with invalid token", async () => {
    const { status, body } = await httpPost("/auth/refresh", {
      refreshToken: "invalid_refresh_token_12345",
    });
    expect(status).toBe(401);
  });

  test("POST /auth/refresh — opaque tokens are 64-char hex", async () => {
    // Login first to get a valid refresh token
    const loginRes = await httpPost("/auth/login", {
      email: signer.email,
      password: signer.password,
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toHaveProperty("token");
    expect(loginRes.body).toHaveProperty("refreshToken");

    const refreshToken = extractRefreshToken(loginRes.body);
    expect(refreshToken).toBeTruthy();
    expect(refreshToken.length).toBe(64); // 32 bytes hex
    expect(refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });

  test("POST /auth/refresh — token rotation invalidates old token", async () => {
    const loginRes = await httpPost("/auth/login", {
      email: signer.email,
      password: signer.password,
    });

    expect(loginRes.status).toBe(200);
    {
      const refreshToken = extractRefreshToken(loginRes.body);
      expect(refreshToken).toBeTruthy();

      // First refresh
      const refresh1 = await httpPost("/auth/refresh", { refreshToken });
      expect(refresh1.status).toBe(200);

      const newRefreshToken = extractRefreshToken(refresh1.body);

      // Old refresh token should now be invalid (401)
      const refresh2 = await httpPost("/auth/refresh", { refreshToken });
      expect(refresh2.status).toBe(401);

      // New refresh token still works
      const refresh3 = await httpPost("/auth/refresh", {
        refreshToken: newRefreshToken,
      });
      expect(refresh3.status).toBe(200);
    }
  });

  // ─── 6. LOGOUT ─────────────────────────────────────────────

  test("POST /auth/logout — 401 without token", async () => {
    const { status } = await httpPost("/auth/logout", {});
    expect(status).toBe(401);
  });

  test("POST /auth/logout — 401 with invalid token", async () => {
    const { status } = await httpPost("/auth/logout", {}, {
      Authorization: "Bearer invalid",
    });
    expect(status).toBe(401);
  });

  test("POST /auth/logout-all — 401 without token", async () => {
    const { status } = await httpPost("/auth/logout-all", {});
    expect(status).toBe(401);
  });

  // ─── 7. PASSWORD RESET FLOW ────────────────────────────────

  test("POST /auth/send-otp — 400 without email", async () => {
    const { status, body } = await httpPost("/auth/send-otp", {});
    expect(status).toBe(400);
  });

  test("POST /auth/send-otp — returns 200 for unknown email (info leak — should be 404)", async () => {
    const { status } = await httpPost("/auth/send-otp", {
      email: "nonexistent_user_xyz@test.com",
    });
    // Current behavior: returns 200 (info leak). Documented as observation.
    // This is a security concern worth noting.
    expect(status).toBe(200);
  });

  test("POST /auth/send-otp — 400 on invalid email format", async () => {
    const { status } = await httpPost("/auth/send-otp", {
      email: "not-an-email",
    });
    expect(status).toBe(400);
  });

  test("POST /auth/reset-password — 400 on missing fields", async () => {
    const { status } = await httpPost("/auth/reset-password", {
      email: TEST_USER.email,
    });
    expect(status).toBe(400);
  });

  test("POST /auth/reset-password — 400 on invalid OTP length", async () => {
    const { status } = await httpPost("/auth/reset-password", {
      email: TEST_USER.email,
      otp: "12345", // 5 digits, needs 6
      password: "NewPass123",
    });
    expect(status).toBe(400);
  });

  test("POST /auth/reset-password — 400 on weak new password", async () => {
    const { status } = await httpPost("/auth/reset-password", {
      email: TEST_USER.email,
      otp: "123456",
      password: "simple", // too short, no uppercase
    });
    expect(status).toBe(400);
  });

  // ─── 8. CONTENT TYPE VALIDATION ────────────────────────────

  test("All auth endpoints return application/json content-type", async () => {
    const testCases = [
      { path: "/auth/register", method: httpGet },
      { path: "/auth/login", method: httpGet },
      { path: "/auth/verify", method: httpPost },
    ];

    for (const { path, method } of testCases) {
      const result = method(path, method === httpPost ? {} : undefined);
      const { headers } = await result;
      expect(headers["content-type"]).toContain("application/json");
    }
  });
});
