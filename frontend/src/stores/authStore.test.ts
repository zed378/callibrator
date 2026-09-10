import { useAuthStore } from "./authStore";
import { authService } from "@/api/services/auth.service";

// Mock authService
jest.mock("@/api/services/auth.service", () => ({
  authService: {
    login: jest.fn(),
    logout: jest.fn(),
    verifyAndFetchUser: jest.fn(),
  },
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
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
    localStorageMock.clear();
    mockCookie = "";
    useAuthStore.getState().setError(null);
    useAuthStore.setState({
      user: null,
      avatarUrl: "",
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  describe("initialize", () => {
    it("should do nothing if no token cookie", async () => {
      await useAuthStore.getState().initialize();

      expect(authService.verifyAndFetchUser).not.toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it("should verify token and set user if token exists following Swagger spec", async () => {
      mockCookie = "auth_logged_in=true";

      const mockUser = {
        id: "user-uuid-123",
        username: "john_doe",
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        status: "ACTIVE" as const,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        role: null,
        roleId: null,
      };

      (authService.verifyAndFetchUser as jest.Mock).mockResolvedValue(mockUser);

      await useAuthStore.getState().initialize();

      expect(authService.verifyAndFetchUser).toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      // initialize() enriches the user with derived fields (picture defaults to "")
      expect(useAuthStore.getState().user).toEqual({ ...mockUser, picture: "" });
      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().error).toBeNull();
    });

    it("should clear storage if token is invalid following Swagger spec", async () => {
      mockCookie = "auth_logged_in=true";

      (authService.verifyAndFetchUser as jest.Mock).mockRejectedValue(
        new Error("Token expired"),
      );

      await useAuthStore.getState().initialize();

      expect(authService.logout).toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().error).toBe("Token expired");
    });
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
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          status: "ACTIVE" as const,
          createdAt: "2024-01-01T00:00:00Z",
        },
        token: "test-jwt-token",
        session: {
          id: "session-uuid",
          createdAt: "2024-01-01T00:00:00Z",
          expiresAt: "2024-01-02T00:00:00Z",
        },
      };

      (authService.login as jest.Mock).mockResolvedValue(mockResponse);

      await useAuthStore.getState().login("john_doe", "password123");

      expect(authService.login).toHaveBeenCalledWith({
        user: "john_doe",
        password: "password123",
      });
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user?.username).toBe("john_doe");
      expect(useAuthStore.getState().user?.email).toBe("john@example.com");
      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().error).toBeNull();
    });

    it("should handle login failure", async () => {
      (authService.login as jest.Mock).mockRejectedValue(
        new Error("Invalid credentials"),
      );

      await expect(
        useAuthStore.getState().login("wrong", "wrong"),
      ).rejects.toThrow("Invalid credentials");

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().error).toBe("Invalid credentials");
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe("logout", () => {
    it("should logout successfully", async () => {
      // Set authenticated state first
      useAuthStore.setState({
        user: {
          id: "1",
          username: "john_doe",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          status: "ACTIVE" as const,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        isAuthenticated: true,
      });

      (authService.logout as jest.Mock).mockResolvedValue(undefined);

      await useAuthStore.getState().logout();

      expect(authService.logout).toHaveBeenCalled();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().error).toBeNull();
    });

    it("should clear state even if logout API fails", async () => {
      useAuthStore.setState({
        user: {
          id: "1",
          username: "john_doe",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          status: "ACTIVE" as const,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        isAuthenticated: true,
      });

      (authService.logout as jest.Mock).mockRejectedValue(
        new Error("Network error"),
      );

      await useAuthStore.getState().logout();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
    });
  });

  describe("fetchUser", () => {
    it("should fetch and update user data", async () => {
      useAuthStore.setState({
        user: {
          id: "1",
          username: "john_doe",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          status: "ACTIVE" as const,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        isAuthenticated: true,
      });

      const updatedUser = {
        id: "1",
        username: "john_doe_updated",
        firstName: "John",
        lastName: "Doe Updated",
        email: "john.updated@example.com",
        status: "ACTIVE" as const,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      };

      (authService.verifyAndFetchUser as jest.Mock).mockResolvedValue(
        updatedUser,
      );

      await useAuthStore.getState().fetchUser();

      expect(authService.verifyAndFetchUser).toHaveBeenCalled();
      expect(useAuthStore.getState().user?.username).toBe("john_doe_updated");
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it("should handle fetch user failure", async () => {
      useAuthStore.setState({
        user: {
          id: "1",
          username: "john_doe",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          status: "ACTIVE" as const,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        isAuthenticated: true,
      });

      (authService.verifyAndFetchUser as jest.Mock).mockRejectedValue(
        new Error("Failed to fetch"),
      );

      await useAuthStore.getState().fetchUser();

      expect(useAuthStore.getState().error).toBe("Failed to fetch");
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe("setError", () => {
    it("should set error message", () => {
      useAuthStore.getState().setError("Test error message");

      expect(useAuthStore.getState().error).toBe("Test error message");
    });

    it("should clear error message", () => {
      useAuthStore.setState({ error: "Test error" });
      useAuthStore.getState().setError(null);

      expect(useAuthStore.getState().error).toBeNull();
    });
  });

  describe("state management", () => {
    it("should have correct initial state", () => {
      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
