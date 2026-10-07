/**
 * A-365 (F-2 of docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md § 9) — an open
 * socket whose principal's SCOPE changed is disconnected on the next re-check.
 *
 * The handshake builds the socket's tenant context and joins its rooms once
 * (`tenant_<id>`, `user_<id>`, `super_admins`). Before A-365 the 60-second
 * re-check refused only status changes (a revoked session, a ban, a suspended
 * tenant), so a super admin demoted to a tenant role kept the `super_admins`
 * room — every tenant's notifications — for as long as the socket stayed open,
 * and a user moved to another tenant or role kept the old context. The fix
 * disconnects; the next handshake rebuilds context and rooms from the
 * principal as it is now.
 *
 * Fail-before: the four "disconnected" cases (recheckSocket answered false and
 * never called disconnect; `scopeDrift` did not exist).
 */
import type * as SocketModule from "../../config/socket";

jest.mock("socket.io", () => ({ Server: jest.fn() }));
jest.mock("../../services/session.service", () => ({ isSessionLive: jest.fn() }));
jest.mock("../../services/auth.service", () => ({ getAuthUserWithTenant: jest.fn() }));
jest.mock("../../services/redis.service", () => ({ getRedisConnection: jest.fn(() => ({ status: "wait" })) }));

interface Principal {
  id: string;
  tenantId: string | null;
  isActive: boolean;
  status: string;
  role: { name: string };
  tenant: { id: string; status: string } | null;
}

const sessionService = jest.requireMock<{ isSessionLive: jest.Mock }>("../../services/session.service");
const authService = jest.requireMock<{ getAuthUserWithTenant: jest.Mock }>("../../services/auth.service");
const socketModule = jest.requireActual<typeof SocketModule>("../../config/socket");
const { recheckSocket, scopeDrift } = socketModule.__testables;
const { logger } = jest.requireActual<{ logger: { warn: (...a: unknown[]) => void; info: (...a: unknown[]) => void } }>(
  "../../middlewares/activityLog.middleware",
);

type RecheckSocket = Parameters<typeof recheckSocket>[0];

const principal = (over: Partial<Principal> = {}): Principal => ({
  id: "user-1",
  tenantId: "tenant-1",
  isActive: true,
  status: "ACTIVE",
  role: { name: "TECHNICIAN" },
  tenant: { id: "tenant-1", status: "active" },
  ...over,
});

/** A socket as the handshake left it for `p`. */
const openSocket = (p: Principal, isSuperAdmin = false): RecheckSocket & { disconnect: jest.Mock } =>
  ({
    user: { id: p.id, tenantId: p.tenantId, role: p.role },
    tenantContext: { tenantId: p.tenantId, isSuperAdmin, isSystemTask: false },
    sessionId: "sess-1",
    disconnect: jest.fn(),
  }) as unknown as RecheckSocket & { disconnect: jest.Mock };

/** The socket's disconnect double, read without unbinding a method. */
const disconnectOf = (socket: { disconnect: jest.Mock }): jest.Mock => Reflect.get(socket, "disconnect");

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  jest.spyOn(logger, "info").mockImplementation(() => undefined);
  sessionService.isSessionLive.mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  authService.getAuthUserWithTenant.mockReset();
});

describe("A-365 — the re-check disconnects a socket whose principal's scope changed", () => {
  it("a super admin demoted to a tenant role leaves the super_admins room: disconnected", async () => {
    const before = principal({ role: { name: "SUPERADMIN" } });
    const socket = openSocket(before, true);
    authService.getAuthUserWithTenant.mockResolvedValue(principal({ role: { name: "TECHNICIAN" } }));
    expect(await recheckSocket(socket)).toBe(true);
    expect(disconnectOf(socket)).toHaveBeenCalledWith(true);
  });

  it("a user promoted to super admin is disconnected (the next handshake joins super_admins)", async () => {
    const socket = openSocket(principal());
    authService.getAuthUserWithTenant.mockResolvedValue(principal({ role: { name: "SUPERADMIN" } }));
    expect(await recheckSocket(socket)).toBe(true);
    expect(disconnectOf(socket)).toHaveBeenCalledWith(true);
  });

  it("a user whose tenant changed is disconnected (it would keep tenant_<old>)", async () => {
    const socket = openSocket(principal());
    authService.getAuthUserWithTenant.mockResolvedValue(
      principal({ tenantId: "tenant-2", tenant: { id: "tenant-2", status: "active" } }),
    );
    expect(await recheckSocket(socket)).toBe(true);
    expect(disconnectOf(socket)).toHaveBeenCalledWith(true);
  });

  it("a user whose role changed inside its tenant is disconnected", async () => {
    const socket = openSocket(principal());
    authService.getAuthUserWithTenant.mockResolvedValue(principal({ role: { name: "HEALTCARE_ADMIN" } }));
    expect(await recheckSocket(socket)).toBe(true);
    expect(disconnectOf(socket)).toHaveBeenCalledWith(true);
  });

  it("an unchanged principal keeps its socket", async () => {
    const socket = openSocket(principal());
    authService.getAuthUserWithTenant.mockResolvedValue(principal());
    expect(await recheckSocket(socket)).toBe(false);
    expect(disconnectOf(socket)).not.toHaveBeenCalled();
  });

  it("scopeDrift reads an empty tenantId as none, as the handshake does", () => {
    const socket = openSocket(principal({ tenantId: null }));
    expect(scopeDrift(socket, principal({ tenantId: "" }))).toBeNull();
    expect(scopeDrift(socket, principal({ tenantId: "tenant-9" }))).toBe("user user-1 changed tenant");
  });
});
