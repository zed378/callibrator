// Session hand-off on a shared browser tab (F-01, F-06).
//
// Logout and login are both client-side navigations (`router.push`), so
// nothing unloads the page between one user and the next. Everything that
// lives at module scope or in a client-writable cookie survives unless the
// sign-out path clears it explicitly. These tests drive the REAL socket
// singleton (`@/lib/socket`) and the REAL cookie jar (jsdom), mocking only the
// network edges: socket.io-client's `io` and the HTTP services.

import { io } from "socket.io-client";
import { useAuthStore } from "../authStore";
import { useTenantStore } from "../tenantStore";
import { useTenantBrandingStore } from "../tenantBrandingStore";
import { authService } from "@/api/services/auth.service";
import { socketTokenService } from "@/api/services/socketToken.service";
import { getSocket } from "@/lib/socket";

jest.mock("socket.io-client", () => ({ io: jest.fn() }));

jest.mock("@/api/services/auth.service", () => ({
  authService: {
    login: jest.fn(),
    logout: jest.fn(),
    verifyAndFetchUser: jest.fn(),
    impersonate: jest.fn(),
    exitImpersonation: jest.fn(),
  },
}));

jest.mock("@/api/services/socketToken.service", () => ({
  socketTokenService: { getSocketToken: jest.fn() },
}));

interface FakeSocket {
  token: string;
  connected: boolean;
  auth: { token: string };
  on: jest.Mock;
  connect: jest.Mock;
  disconnect: jest.Mock;
}

const ioMock = io as unknown as jest.Mock;
const getSocketToken = socketTokenService.getSocketToken as jest.Mock;

const makeFakeSocket = (token: string): FakeSocket => {
  const fake: FakeSocket = {
    token,
    connected: true,
    auth: { token },
    on: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(() => {
      fake.connected = false;
    }),
  };
  return fake;
};

const userA = {
  id: "user-a",
  username: "a",
  tenantId: "tenant-a",
  role: { name: "SUPERADMIN" },
};
const userB = {
  id: "user-b",
  username: "b",
  tenantId: "tenant-b",
  role: { name: "TECHNICIAN" },
};

const clearAllCookies = () => {
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }
  });
};

const cookieNames = () =>
  document.cookie
    .split(";")
    .map((c) => c.split("=")[0].trim())
    .filter(Boolean);

describe("authStore session hand-off (F-01, F-06)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    ioMock.mockImplementation((_url: string, opts: { auth: { token: string } }) =>
      makeFakeSocket(opts.auth.token),
    );
    (authService.logout as jest.Mock).mockResolvedValue(undefined);
    // Start every test signed out, with no socket and no cookies left over.
    await useAuthStore.getState().logout();
    jest.clearAllMocks();
    clearAllCookies();
    localStorage.clear();
  });

  describe("F-01 — the socket does not outlive the session", () => {
    it("F-01: logout disconnects the socket and the next login gets a fresh connection with the new token", async () => {
      // User A signs in and the realtime hooks open the socket.
      (authService.login as jest.Mock).mockResolvedValueOnce({ data: userA });
      getSocketToken.mockResolvedValueOnce({ token: "token-A", expiresIn: 60 });
      await useAuthStore.getState().login("a", "pw");
      const socketA = (await getSocket()) as unknown as FakeSocket;
      expect(socketA.token).toBe("token-A");

      // A signs out (client-side navigation — the module stays loaded).
      await useAuthStore.getState().logout();
      expect(socketA.disconnect).toHaveBeenCalled();

      // User B signs in on the same tab.
      (authService.login as jest.Mock).mockResolvedValueOnce({ data: userB });
      getSocketToken.mockResolvedValueOnce({ token: "token-B", expiresIn: 60 });
      await useAuthStore.getState().login("b", "pw");
      const socketB = (await getSocket()) as unknown as FakeSocket;

      // B must never be handed A's authenticated socket.
      expect(socketB).not.toBe(socketA);
      expect(socketB.token).toBe("token-B");
      expect(ioMock).toHaveBeenCalledTimes(2);
      expect(ioMock.mock.calls[1][1]).toMatchObject({
        auth: { token: "token-B" },
      });
    });

    it("F-01: the socket is disconnected before the logout request is sent", async () => {
      getSocketToken.mockResolvedValueOnce({ token: "token-A", expiresIn: 60 });
      const socketA = (await getSocket()) as unknown as FakeSocket;

      let connectedDuringLogoutCall: boolean | null = null;
      (authService.logout as jest.Mock).mockImplementationOnce(async () => {
        connectedDuringLogoutCall = socketA.connected;
      });

      await useAuthStore.getState().logout();
      // No event for the departing user can land while the request is in flight.
      expect(connectedDuringLogoutCall).toBe(false);
    });

    it("F-01: exitImpersonation disconnects the socket", async () => {
      getSocketToken.mockResolvedValueOnce({ token: "token-A", expiresIn: 60 });
      const socketA = (await getSocket()) as unknown as FakeSocket;
      (authService.exitImpersonation as jest.Mock).mockResolvedValue(undefined);

      await useAuthStore.getState().exitImpersonation();

      expect(socketA.disconnect).toHaveBeenCalled();
    });

    it("F-01: a failed session restore (initialize) disconnects the socket", async () => {
      getSocketToken.mockResolvedValueOnce({ token: "token-A", expiresIn: 60 });
      const socketA = (await getSocket()) as unknown as FakeSocket;
      document.cookie = "auth_logged_in=true;path=/";
      (authService.verifyAndFetchUser as jest.Mock).mockRejectedValueOnce(
        new Error("Session expired"),
      );

      await useAuthStore.getState().initialize();

      expect(socketA.disconnect).toHaveBeenCalled();
    });
  });

  describe("F-06 — the tenant override does not outlive the session", () => {
    it("F-06: logout after impersonation removes x_tenant_id, the impersonation marker and the cached tenant", async () => {
      (authService.impersonate as jest.Mock).mockResolvedValueOnce({
        data: { ...userB, id: "impersonated" },
      });
      await useAuthStore.getState().impersonate("tenant-b", "impersonated");
      expect(cookieNames()).toContain("x_tenant_id");
      expect(cookieNames()).toContain("impersonating");

      // A super admin who also picked a tenant in the tenant selector.
      useTenantStore.getState().selectTenant({
        id: "tenant-b",
        name: "Tenant B",
      } as Parameters<ReturnType<typeof useTenantStore.getState>["selectTenant"]>[0]);
      useTenantBrandingStore.getState().setBranding({ appName: "Tenant B" });

      // Signs out with the normal button, not "exit impersonation".
      await useAuthStore.getState().logout();

      expect(cookieNames()).not.toContain("x_tenant_id");
      expect(cookieNames()).not.toContain("impersonating");
      expect(cookieNames()).not.toContain("auth_logged_in");
      expect(useTenantStore.getState().currentTenant).toBeNull();
      expect(useTenantBrandingStore.getState().branding).toBeNull();
      expect(localStorage.getItem("tenant_branding")).toBeNull();
      expect(useAuthStore.getState().isImpersonating).toBe(false);
    });

    it("F-06: logout clears x_tenant_id even when the logout request fails", async () => {
      document.cookie = "x_tenant_id=tenant-b;path=/";
      (authService.logout as jest.Mock).mockRejectedValueOnce(
        new Error("network down"),
      );

      await useAuthStore.getState().logout();

      expect(cookieNames()).not.toContain("x_tenant_id");
    });

    it("F-06: a password login does not inherit a stale x_tenant_id", async () => {
      // Left behind by a path that never ran logout (e.g. the 401 redirect,
      // which is a full page load straight to /login).
      document.cookie = "x_tenant_id=tenant-b;path=/";
      document.cookie = "impersonating=true;path=/";
      (authService.login as jest.Mock).mockResolvedValueOnce({ data: userA });

      await useAuthStore.getState().login("a", "pw");

      expect(cookieNames()).not.toContain("x_tenant_id");
      expect(cookieNames()).not.toContain("impersonating");
    });
  });
});
