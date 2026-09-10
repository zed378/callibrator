import { authService } from "./auth.service";
import { api } from "../client";

// Mock the api module
jest.mock("../client", () => ({
  api: {
    post: jest.fn(),
    get: jest.fn(),
  },
}));

// Mock document.cookie
Object.defineProperty(document, "cookie", {
  writable: true,
  value: "",
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string | object> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string | object) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("authService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    document.cookie = "";
  });

  describe("login", () => {
    it("should login successfully following Swagger spec", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "Login successful",
        data: {
          id: "user-uuid-123",
          username: "john_doe",
          email: "john@example.com",
          role: {
            id: "role-uuid-123",
            name: "USER",
          },
        },
        token: "test-jwt-token",
        session: {
          id: "session-uuid-123",
          createdAt: "2024-01-01T00:00:00Z",
          expiresAt: "2024-01-02T00:00:00Z",
        },
      };

      (api.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await authService.login({
        user: "john_doe",
        password: "password123",
      });

      expect(api.post).toHaveBeenCalledWith("/api/v1/auth/login", {
        user: "john_doe",
        password: "password123",
      });
      expect(result.data.username).toBe("john_doe");
    });

    it("should handle login failure with 401", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        response: {
          status: 401,
          data: {
            success: false,
            status: 401,
            message: "Invalid credentials",
          },
        },
      });

      await expect(
        authService.login({ user: "wrong", password: "wrong" }),
      ).rejects.toBeDefined();
    });

    it("should handle account locked (423)", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        response: {
          status: 423,
          data: {
            success: false,
            status: 423,
            message: "Account temporarily locked",
          },
        },
      });

      await expect(
        authService.login({ user: "locked", password: "wrong" }),
      ).rejects.toBeDefined();
    });

    it("should handle rate limited (429)", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        response: {
          status: 429,
          data: {
            success: false,
            status: 429,
            message: "Too many login attempts",
          },
        },
      });

      await expect(
        authService.login({ user: "rate-limited", password: "wrong" }),
      ).rejects.toBeDefined();
    });
  });

  describe("register", () => {
    it("should register successfully following Swagger spec", async () => {
      const mockResponse = {
        success: true,
        status: 201,
        message: "Registration successful",
        data: {
          id: "new-user-uuid",
          username: "new_user",
          email: "new@example.com",
        },
      };

      (api.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await authService.register({
        username: "new_user",
        email: "new@example.com",
        password: "password123",
        firstName: "New",
        lastName: "User",
      });

      expect(api.post).toHaveBeenCalledWith("/api/v1/auth/register", {
        username: "new_user",
        email: "new@example.com",
        password: "password123",
        firstName: "New",
        lastName: "User",
      });
      expect(result.success).toBe(true);
    });

    it("should handle conflict (409)", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        response: {
          status: 409,
          data: {
            success: false,
            status: 409,
            message: "Email or username already exists",
          },
        },
      });

      await expect(
        authService.register({
          username: "existing",
          email: "existing@example.com",
          password: "password123",
          firstName: "Existing",
          lastName: "User",
        }),
      ).rejects.toBeDefined();
    });
  });

  describe("logout", () => {
    it("should logout successfully following Swagger spec", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "Logout successful",
      });

      await authService.logout();

      expect(api.post).toHaveBeenCalledWith("/api/v1/auth/logout", {
        sessionId: undefined,
      });
    });

    it("should logout with sessionId", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "Logout successful",
      });

      await authService.logout("session-123");

      expect(api.post).toHaveBeenCalledWith("/api/v1/auth/logout", {
        sessionId: "session-123",
      });
    });

    it("should propagate error if logout API fails", async () => {
      (api.post as jest.Mock).mockRejectedValue(new Error("Network error"));

      await expect(authService.logout()).rejects.toThrow("Network error");
    });
  });

  describe("logoutAll", () => {
    it("should logout from all devices following Swagger spec", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "All sessions revoked successfully",
      });

      await authService.logoutAll();

      expect(api.post).toHaveBeenCalledWith("/api/v1/auth/logout-all");
    });
  });

  describe("verifyAndFetchUser", () => {
    it("should verify token and fetch user following Swagger spec", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "Token valid",
        data: {
          id: "user-uuid-123",
          username: "john_doe",
          email: "john@example.com",
          role: {
            id: "role-uuid-123",
            name: "USER",
          },
        },
        token: "new-token",
        session: {
          id: "new-session",
          createdAt: "2024-01-01T00:00:00Z",
          expiresAt: "2024-01-02T00:00:00Z",
        },
      };

      (api.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await authService.verifyAndFetchUser();

      expect(api.post).toHaveBeenCalledWith("/api/v1/auth/verify", {});
      expect(result.id).toBe("user-uuid-123");
      expect(result.username).toBe("john_doe");
      expect(result.email).toBe("john@example.com");
    });
  });

  describe("verifyToken", () => {
    it("should return true for valid token", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "Token valid",
      });

      const result = await authService.verifyToken();

      expect(result).toBe(true);
    });

    it("should return false for invalid token", async () => {
      (api.post as jest.Mock).mockRejectedValue({
        response: {
          status: 401,
          data: {
            success: false,
            status: 401,
            message: "Invalid session",
          },
        },
      });

      const result = await authService.verifyToken();

      expect(result).toBe(false);
    });
  });

  describe("sendOtp", () => {
    it("should send OTP following Swagger spec", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "OTP sent successfully",
      });

      await authService.sendOtp("test@example.com");

      expect(api.post).toHaveBeenCalledWith("/api/v1/auth/send-otp", {
        email: "test@example.com",
      });
    });
  });

  describe("resetPassword", () => {
    it("should reset password following Swagger spec", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "Password reset successful",
      });

      await authService.resetPassword(
        "test@example.com",
        "123456",
        "newpassword",
      );

      expect(api.post).toHaveBeenCalledWith("/api/v1/auth/reset-password", {
        email: "test@example.com",
        otp: "123456",
        password: "newpassword",
      });
    });
  });

  describe("updatePassword", () => {
    it("should update password following Swagger spec", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "Password updated successfully",
      });

      await authService.updatePassword("oldpass", "newpass");

      expect(api.post).toHaveBeenCalledWith(
        "/api/v1/auth/just-update-password",
        {
          currentPassword: "oldpass",
          newPassword: "newpass",
        },
      );
    });
  });

  describe("verifyPassword", () => {
    // The backend envelopes this as { ..., data: { valid } } — see
    // backend/src/services/auth.service.js passIsValid.
    it("should verify password", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "Password is valid",
        data: { valid: true },
      });

      const result = await authService.verifyPassword("testpass");

      expect(api.post).toHaveBeenCalledWith("/api/v1/auth/pass-is-valid", {
        password: "testpass",
      });
      expect(result).toBe(true);
    });

    it("should return false for invalid password", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "Password is valid",
        data: { valid: false },
      });

      const result = await authService.verifyPassword("wrongpass");

      expect(result).toBe(false);
    });

    it("should return false when the envelope omits data", async () => {
      (api.post as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "Password is valid",
      });

      await expect(authService.verifyPassword("x")).resolves.toBe(false);
    });
  });

  describe("activateAccount", () => {
    it("should activate account following Swagger spec", async () => {
      (api.get as jest.Mock).mockResolvedValue({
        success: true,
        status: 200,
        message: "Account activated successfully",
      });

      await authService.activateAccount("activation-token-123");

      expect(api.get).toHaveBeenCalledWith("/api/v1/auth/activation", {
        params: { token: "activation-token-123" },
      });
    });
  });
});
