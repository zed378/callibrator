import { useAuthStore } from "../authStore";
import { authService } from "@/api/services/auth.service";

// Mock the auth service
jest.mock("@/api/services/auth.service", () => ({
  authService: {
    login: jest.fn(),
    verifyAndFetchUser: jest.fn(),
    logout: jest.fn(),
  },
}));

let mockCookie = "";
Object.defineProperty(document, "cookie", {
  get: () => mockCookie,
  set: (v) => {
    mockCookie = v;
  },
  configurable: true,
});

describe("authStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockCookie = "";
    // Reset store state
    const store = useAuthStore.getState();
    useAuthStore.setState({
      user: null,
      avatarUrl: "",
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  describe("initialize", () => {
    it("should do nothing if no auth_logged_in cookie", async () => {
      await useAuthStore.getState().initialize();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(authService.verifyAndFetchUser).not.toHaveBeenCalled();
    });

    it("should verify token and set user if auth_logged_in cookie is true", async () => {
      const mockUser = {
        id: "123",
        username: "testuser",
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        picture: "http://localhost:5000/uploads/profile/avatar.jpg",
        createdAt: "2024-01-01T00:00:00Z",
        role: null,
        roleId: null,
      };

      mockCookie = "auth_logged_in=true";
      (authService.verifyAndFetchUser as jest.Mock).mockResolvedValue(mockUser);

      await useAuthStore.getState().initialize();

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().avatarUrl).toBe(
        "http://localhost:5000/uploads/profile/avatar.jpg",
      );
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it("should clear state if token verification fails", async () => {
      mockCookie = "auth_logged_in=true";
      (authService.verifyAndFetchUser as jest.Mock).mockRejectedValue(
        new Error("Unauthorized"),
      );

      await useAuthStore.getState().initialize();

      expect(authService.logout).toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().avatarUrl).toBe("");
      expect(useAuthStore.getState().error).toBe("Unauthorized");
    });
  });

  describe("login", () => {
    it("should login successfully and set user state", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "Login successful",
        data: {
          id: "123",
          username: "testuser",
          firstName: "Test",
          lastName: "User",
          email: "test@example.com",
          picture: "http://localhost:5000/uploads/profile/avatar.jpg",
          createdAt: "2024-01-01T00:00:00Z",
          role: null,
          roleId: null,
        },
        token: "test-token",
        session: {
          id: "session-123",
          createdAt: "2024-01-01T00:00:00Z",
        },
      };

      (authService.login as jest.Mock).mockResolvedValue(mockResponse);

      await useAuthStore.getState().login("testuser", "password123");

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockResponse.data);
      expect(useAuthStore.getState().avatarUrl).toBe(
        "http://localhost:5000/uploads/profile/avatar.jpg",
      );
      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().error).toBeNull();
    });

    it("should set error state when login fails", async () => {
      (authService.login as jest.Mock).mockRejectedValue(
        new Error("Invalid credentials"),
      );

      await expect(
        useAuthStore.getState().login("testuser", "wrongpassword"),
      ).rejects.toThrow("Invalid credentials");

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().error).toBe("Invalid credentials");
    });
  });

  describe("logout", () => {
    it("should logout successfully", async () => {
      useAuthStore.setState({
        user: {
          id: "123",
          username: "testuser",
          firstName: "Test",
          lastName: "User",
          email: "test@example.com",
          picture: "http://localhost:5000/uploads/profile/avatar.jpg",
          createdAt: "2024-01-01T00:00:00Z",
        },
        avatarUrl: "http://localhost:5000/uploads/profile/avatar.jpg",
        isAuthenticated: true,
      });

      (authService.logout as jest.Mock).mockResolvedValue(undefined);

      await useAuthStore.getState().logout();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().avatarUrl).toBe("");
    });

    it("should clear state even if logout API call fails", async () => {
      useAuthStore.setState({
        user: {
          id: "123",
          username: "testuser",
          firstName: "Test",
          lastName: "User",
          email: "test@example.com",
          picture: "http://localhost:5000/uploads/profile/avatar.jpg",
          createdAt: "2024-01-01T00:00:00Z",
        },
        avatarUrl: "http://localhost:5000/uploads/profile/avatar.jpg",
        isAuthenticated: true,
      });

      (authService.logout as jest.Mock).mockRejectedValue(
        new Error("Network error"),
      );

      await useAuthStore.getState().logout();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().avatarUrl).toBe("");
    });
  });

  describe("fetchUser", () => {
    it("should fetch and set user data", async () => {
      const mockUser = {
        id: "123",
        username: "testuser",
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        picture: "http://localhost:5000/uploads/profile/avatar.jpg",
        createdAt: "2024-01-01T00:00:00Z",
        role: null,
        roleId: null,
      };

      (authService.verifyAndFetchUser as jest.Mock).mockResolvedValue(mockUser);

      await useAuthStore.getState().fetchUser();

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().avatarUrl).toBe(
        "http://localhost:5000/uploads/profile/avatar.jpg",
      );
    });

    it("should clear state when fetch user fails", async () => {
      useAuthStore.setState({
        user: {
          id: "123",
          username: "testuser",
          firstName: "Test",
          lastName: "User",
          email: "test@example.com",
          picture: "http://localhost:5000/uploads/profile/avatar.jpg",
          createdAt: "2024-01-01T00:00:00Z",
        },
        avatarUrl: "http://localhost:5000/uploads/profile/avatar.jpg",
        isAuthenticated: true,
      });

      (authService.verifyAndFetchUser as jest.Mock).mockRejectedValue(
        new Error("Not found"),
      );

      await useAuthStore.getState().fetchUser();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().avatarUrl).toBe("");
      expect(useAuthStore.getState().error).toBe("Not found");
    });
  });

  describe("setError", () => {
    it("should set custom error message", () => {
      useAuthStore.getState().setError("Custom error message");

      expect(useAuthStore.getState().error).toBe("Custom error message");
    });
  });

  describe("avatarUrl", () => {
    it("should use picture field from user as avatarUrl", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "Login successful",
        data: {
          id: "123",
          username: "testuser",
          firstName: "Test",
          lastName: "User",
          email: "test@example.com",
          picture: "http://localhost:5000/uploads/profile/custom-avatar.png",
          createdAt: "2024-01-01T00:00:00Z",
        },
        token: "test-token",
        session: {
          id: "session-123",
          createdAt: "2024-01-01T00:00:00Z",
        },
      };

      (authService.login as jest.Mock).mockResolvedValue(mockResponse);

      await useAuthStore.getState().login("testuser", "password123");

      expect(useAuthStore.getState().avatarUrl).toBe(
        "http://localhost:5000/uploads/profile/custom-avatar.png",
      );
    });

    it("should set empty avatarUrl when user has no picture", async () => {
      const mockResponse = {
        success: true,
        status: 200,
        message: "Login successful",
        data: {
          id: "123",
          username: "testuser",
          firstName: "Test",
          lastName: "User",
          email: "test@example.com",
          picture: "",
          createdAt: "2024-01-01T00:00:00Z",
        },
        token: "test-token",
        session: {
          id: "session-123",
          createdAt: "2024-01-01T00:00:00Z",
        },
      };

      (authService.login as jest.Mock).mockResolvedValue(mockResponse);

      await useAuthStore.getState().login("testuser", "password123");

      expect(useAuthStore.getState().avatarUrl).toBe("");
    });
  });
});
