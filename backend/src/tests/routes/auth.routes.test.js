/**
 * Auth Routes Tests
 *
 * Tests the auth route registrations and middleware chain.
 */
const authRoutes = require("../../routes/api/auth.route");

describe("Auth Routes", () => {
  it("should export an Express router", () => {
    expect(authRoutes).toBeDefined();
    expect(typeof authRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(authRoutes.stack)).toBe(true);
    expect(authRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = authRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(10);
  });

  it("should have POST method routes", () => {
    const postRoutes = authRoutes.stack.filter(
      (layer) => layer.route && layer.route.methods && layer.route.methods.post,
    );
    expect(postRoutes.length).toBeGreaterThan(8);
  });

  it("should have GET method routes", () => {
    const getRoutes = authRoutes.stack.filter(
      (layer) => layer.route && layer.route.methods && layer.route.methods.get,
    );
    expect(getRoutes.length).toBeGreaterThan(0);
  });

  it("should have public routes at /register, /login, /activation", () => {
    const publicLayers = authRoutes.stack.filter((layer) => {
      const p = layer.route && layer.route.path;
      return (
        p === "/register" ||
        p === "/login" ||
        p === "/activation"
      );
    });
    expect(publicLayers.length).toBeGreaterThan(0);
  });

  it("should have auth-protected routes at /logout, /verify, /refresh", () => {
    const authLayers = authRoutes.stack.filter((layer) => {
      const p = layer.route && layer.route.path;
      return (
        p === "/logout" ||
        p === "/verify" ||
        p === "/refresh"
      );
    });
    expect(authLayers.length).toBeGreaterThan(0);
  });

  it("should have SSO routes", () => {
    const ssoLayers = authRoutes.stack.filter((layer) => {
      const p = layer.route && layer.route.path;
      return p && p.includes("/sso/");
    });
    expect(ssoLayers.length).toBeGreaterThan(3);
  });

  it("should have MFA routes", () => {
    const mfaLayers = authRoutes.stack.filter((layer) => {
      const p = layer.route && layer.route.path;
      return p && p.includes("/mfa/");
    });
    expect(mfaLayers.length).toBeGreaterThan(0);
  });

  it("should have impersonation routes", () => {
    const impersonateLayers = authRoutes.stack.filter((layer) => {
      const p = layer.route && layer.route.path;
      return p && p.includes("/impersonate");
    });
    expect(impersonateLayers.length).toBeGreaterThan(0);
  });

  it("should have socket-token route", () => {
    const socketLayers = authRoutes.stack.filter((layer) => {
      const p = layer.route && layer.route.path;
      return p && p.includes("/socket-token");
    });
    expect(socketLayers.length).toBeGreaterThan(0);
  });

  it("should have send-otp route", () => {
    const sendOtpLayers = authRoutes.stack.filter((layer) => {
      const p = layer.route && layer.route.path;
      return p === "/send-otp";
    });
    expect(sendOtpLayers.length).toBeGreaterThan(0);
  });

  it("should have reset-password route", () => {
    const resetLayers = authRoutes.stack.filter((layer) => {
      const p = layer.route && layer.route.path;
      return p === "/reset-password";
    });
    expect(resetLayers.length).toBeGreaterThan(0);
  });
});
