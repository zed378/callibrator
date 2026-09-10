import { create } from "zustand";
import { User } from "@/types";
import { authService } from "@/api/services/auth.service";
import { useMenuStore } from "./menuStore";

const setCookie = (name: string, value: string, days = 7) => {
  if (typeof document === "undefined") return;
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = `expires=${date.toUTCString()}`;
  document.cookie = `${name}=${value};${expires};path=/;SameSite=Lax`;
};

const deleteCookie = (name: string) => {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
};

interface AuthState {
  user: User | null;
  avatarUrl: string;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  token: string | null;
  isImpersonating: boolean;

  // Actions
  // Resolves with { mfaRequired: true, mfaToken } when the account has MFA
  // enabled — the caller must then call completeMfaLogin. Otherwise the user is
  // authenticated on resolve.
  login: (
    username: string,
    password: string,
  ) => Promise<{ mfaRequired: boolean; mfaToken?: string }>;
  completeMfaLogin: (mfaToken: string, code: string) => Promise<void>;
  loginWithSSOToken: (token: string) => Promise<void>;
  impersonate: (tenantId: string, userId: string) => Promise<void>;
  exitImpersonation: () => Promise<void>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  fetchUser: () => Promise<void>;
  setError: (error: string | null) => void;
}

const readCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  token: null,
  user: null,
  avatarUrl: "",
  isAuthenticated: false,
  isLoading: false,
  error: null,
  isImpersonating: false,

  // Initialize auth state from the non-httpOnly auth_logged_in cookie.
  // The JWT itself lives ONLY in an httpOnly cookie (never localStorage) and
  // is attached server-side by the API proxy.
  initialize: async () => {
    const hasCookie =
      typeof document !== "undefined" &&
      document.cookie
        .split(";")
        .some((c) => c.trim().startsWith("auth_logged_in=true"));
    const isLoggedIn = hasCookie || get().token !== null;

    if (isLoggedIn) {
      set({ isLoading: true, error: null });
      try {
        const user = await authService.verifyAndFetchUser();
        // Ensure user data has roleId and role for menu assignment
        const enrichedUser = {
          ...user,
          firstName: user?.firstName ?? user?.first_name ?? "",
          lastName: user?.lastName ?? user?.last_name ?? "",
          picture: user?.picture ?? user?.avatarUrl ?? "",
          roleId: user?.roleId ?? null,
          role: user?.role ?? null,
        } as User;
        set({
          user: enrichedUser,
          avatarUrl: enrichedUser?.picture || "",
          isAuthenticated: true,
          isLoading: false,
          error: null,
          isImpersonating: readCookie("impersonating") === "true",
        });
      } catch (error: unknown) {
        // Token invalid or expired - clear server-side session/cookies
        try {
          await authService.logout();
        } catch {
          // ignore
        }
        const message =
          error instanceof Error ? error.message : "Session expired";
        set({
          isLoading: false,
          token: null,
          error: message,
          isAuthenticated: false,
          user: null,
          avatarUrl: "",
        });
      }
    }
  },

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authService.login({ user: username, password });
      // Actual backend response: { success, status, message, data: user, token, session }

      // MFA-enabled account: the backend returns data.mfaRequired plus a
      // short-lived token instead of a session. Stay unauthenticated and hand
      // the temp token back so the caller can drive the second-factor step.
      const mfaData = response.data as User & { mfaRequired?: boolean };
      if (mfaData?.mfaRequired) {
        set({ isLoading: false });
        return { mfaRequired: true, mfaToken: response.token };
      }

      const userData = response.data;
      // The JWT is set as an httpOnly cookie by the /api/v1/auth/login route
      // handler and attached server-side by the proxy — it is intentionally
      // NOT stored in localStorage or exposed to client JS.

      // Ensure user data has roleId and role for menu assignment
      const enrichedUser = {
        ...userData,
        firstName: userData?.firstName || userData?.first_name || "",
        lastName: userData?.lastName || userData?.last_name || "",
        picture: userData?.picture || userData?.avatarUrl || "",
        roleId: userData?.roleId || null,
        role: userData?.role || null,
      } as User;

      set({
        user: enrichedUser,
        avatarUrl: enrichedUser?.picture || "",
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
      return { mfaRequired: false };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Login failed";
      set({
        isLoading: false,
        error: message,
        isAuthenticated: false,
      });
      throw error;
    }
  },

  completeMfaLogin: async (mfaToken: string, code: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authService.mfaLogin(mfaToken, code);
      const userData = response.data;
      const enrichedUser = {
        ...userData,
        firstName: userData?.firstName || userData?.first_name || "",
        lastName: userData?.lastName || userData?.last_name || "",
        picture: userData?.picture || userData?.avatarUrl || "",
        roleId: userData?.roleId || null,
        role: userData?.role || null,
      } as User;

      // The generic proxy set the real httpOnly auth_token/auth_session on this
      // successful mfa/login; set the client-visible logged-in marker to match
      // the normal login route so a refresh re-hydrates the session.
      setCookie("auth_logged_in", "true", 7);

      set({
        user: enrichedUser,
        avatarUrl: enrichedUser?.picture || "",
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "MFA verification failed";
      set({ isLoading: false, error: message, isAuthenticated: false });
      throw error;
    }
  },

  loginWithSSOToken: async (token: string) => {
    set({ isLoading: true, error: null });
    try {
      if (token) {
        // Persist the SSO token in an httpOnly cookie via the server route
        // (never localStorage) so the proxy can attach it server-side.
        await fetch("/api/v1/auth/sso-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
      }

      const user = await authService.verifyAndFetchUser();
      const enrichedUser = {
        ...user,
        firstName: user?.firstName || user?.first_name || "",
        lastName: user?.lastName || user?.last_name || "",
        picture: user?.picture || user?.avatarUrl || "",
        roleId: user?.roleId || null,
        role: user?.role || null,
      } as User;

      if (enrichedUser.tenantId) {
        setCookie("x_tenant_id", enrichedUser.tenantId, 7);
      }

      set({
        user: enrichedUser,
        avatarUrl: enrichedUser?.picture || "",
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error: unknown) {
      deleteCookie("auth_logged_in");
      deleteCookie("x_tenant_id");
      const message =
        error instanceof Error ? error.message : "SSO Login failed";
      set({
        isLoading: false,
        error: message,
        isAuthenticated: false,
        token: null,
        user: null,
        avatarUrl: "",
      });
      throw error;
    }
  },

  impersonate: async (tenantId: string, userId: string) => {
    set({ isLoading: true, error: null });
    // The impersonated user has a different role/tenant — clear the cached menu.
    useMenuStore.getState().clearMenu();
    try {
      const response = await authService.impersonate(tenantId, userId);
      const userData = response.data;
      const enrichedUser = {
        ...userData,
        firstName: userData?.firstName || userData?.first_name || "",
        lastName: userData?.lastName || userData?.last_name || "",
        picture: userData?.picture || userData?.avatarUrl || "",
        roleId: userData?.roleId || null,
        role: userData?.role || null,
      } as User;

      // The proxy swapped the httpOnly auth cookies to the impersonation
      // session. Set the client-visible markers so a refresh keeps the banner
      // and the correct tenant context.
      setCookie("auth_logged_in", "true", 7);
      setCookie("impersonating", "true", 7);
      if (enrichedUser.tenantId) {
        setCookie("x_tenant_id", enrichedUser.tenantId, 7);
      }

      set({
        user: enrichedUser,
        avatarUrl: enrichedUser?.picture || "",
        isAuthenticated: true,
        isImpersonating: true,
        isLoading: false,
        error: null,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Impersonation failed";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  exitImpersonation: async () => {
    // Backend maps exit → logout: the impersonation session is revoked and the
    // operator signs back in as themselves.
    useMenuStore.getState().clearMenu();
    try {
      await authService.exitImpersonation();
    } catch {
      // ignore
    } finally {
      deleteCookie("impersonating");
      deleteCookie("auth_logged_in");
      deleteCookie("x_tenant_id");
      set({
        token: null,
        user: null,
        avatarUrl: "",
        isAuthenticated: false,
        isImpersonating: false,
        error: null,
      });
    }
  },

  logout: async () => {
    // Clear the menu store so the next user gets a fresh menu fetch
    useMenuStore.getState().clearMenu();

    try {
      await authService.logout();
    } catch {
      // Ignore logout errors
    } finally {
      // The httpOnly auth cookies are cleared server-side by the logout route;
      // just reset in-memory state here.
      deleteCookie("impersonating");
      set({
        token: null,
        user: null,
        avatarUrl: "",
        isAuthenticated: false,
        isImpersonating: false,
        error: null,
      });
    }
  },

  fetchUser: async () => {
    set({ isLoading: true, error: null });
    try {
      const user = await authService.verifyAndFetchUser();
      // Ensure user data has roleId and role for menu assignment
      const enrichedUser = {
        ...user,
        firstName: user?.firstName || user?.first_name || "",
        lastName: user?.lastName || user?.last_name || "",
        picture: user?.picture || user?.avatarUrl || "",
        roleId: user?.roleId || null,
        role: user?.role || null,
      } as User;
      set({
        user: enrichedUser,
        avatarUrl: enrichedUser?.picture || "",
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch user";
      set({
        isLoading: false,
        error: message,
        isAuthenticated: false,
        user: null,
        avatarUrl: "",
      });
    }
  },

  setError: (error) => set({ error }),
}));
