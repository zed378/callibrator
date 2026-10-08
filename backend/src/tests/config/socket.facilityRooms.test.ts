/**
 * P21-09 — G-19 (the server half) of docs/SECURITY/15 § 11 (spec
 * MEMORY/specs/P19-04-client-facilities.md § 9.1; AM-19, AM-20): a facility-bound socket.
 *
 *  - the handshake builds the facility half of the context from the loaded row and refuses the
 *    § 7.2 conditions (the re-check refuses them too — a facility leaving `active` closes its
 *    bound users' sockets within one interval);
 *  - a bound socket joins `facility_<tenant>_<facility>` and its user room — NEVER `tenant_<id>`,
 *    whose broadcasts carry every facility's data;
 *  - `scopeDrift` disconnects on a binding change; `kanban:join` is refused (provider-internal).
 * Same technique as socket.test.js: the exact functions Socket.IO is handed, no transport.
 */
import type { Socket } from "socket.io";

jest.mock("socket.io", () => ({ Server: jest.fn() }));
jest.mock("../../utils/jwt.util", () => ({ verifyPurposeToken: jest.fn() }));
jest.mock("../../services/session.service", () => ({ isSessionLive: jest.fn() }));
jest.mock("../../services/auth.service", () => ({ getAuthUserWithTenant: jest.fn() }));
jest.mock("../../services/kanban.service", () => ({ assertAccess: jest.fn() }));
jest.mock("../../services/redis.service", () => ({ getRedisConnection: jest.fn(() => ({ status: "wait" })) }));
jest.mock("@socket.io/redis-adapter", () => ({ createAdapter: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports -- the mocked modules, typed by what this test calls */
const { Server } = require("socket.io") as { Server: jest.Mock };
const { verifyPurposeToken } = require("../../utils/jwt.util") as { verifyPurposeToken: jest.Mock };
const sessionService = require("../../services/session.service") as { isSessionLive: jest.Mock };
const authService = require("../../services/auth.service") as { getAuthUserWithTenant: jest.Mock };
const kanban = require("../../services/kanban.service") as { assertAccess: jest.Mock };
const socketModule = require("../../config/socket") as {
  initSocket: (server: unknown) => unknown;
  __testables: {
    authenticateHandshake: (socket: Socket, next: (err?: Error) => void) => Promise<unknown>;
    scopeDrift: (socket: unknown, user: unknown) => string | null;
    recheckSocket: (socket: unknown) => Promise<boolean>;
  };
};
/* eslint-enable @typescript-eslint/no-require-imports */
const { authenticateHandshake, scopeDrift } = socketModule.__testables;

const T = "22222222-2222-4222-8222-222222222222";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";

const user = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "user-1",
  tenantId: T,
  isActive: true,
  status: "ACTIVE",
  role: { name: "HEALTHCARE TECHNICIAN" },
  tenant: { id: T, status: "active" },
  clientFacilityId: F1,
  clientFacility: { id: F1, status: "active" },
  ...over,
});

interface FakeSocket {
  handshake: { auth: { token: string } };
  user?: Record<string, unknown>;
  tenantContext?: Record<string, unknown>;
  join: jest.Mock;
  leave: jest.Mock;
  on: jest.Mock;
  disconnect: jest.Mock;
}

const fakeSocket = (): FakeSocket => ({
  handshake: { auth: { token: "t" } },
  join: jest.fn(),
  leave: jest.fn(),
  on: jest.fn(),
  disconnect: jest.fn(),
});

const handshake = async (loaded: Record<string, unknown>): Promise<{ socket: FakeSocket; error: Error | undefined }> => {
  verifyPurposeToken.mockReturnValue({ id: "user-1", sid: "sess-1" });
  sessionService.isSessionLive.mockResolvedValue(true);
  authService.getAuthUserWithTenant.mockResolvedValue(loaded);
  const socket = fakeSocket();
  let error: Error | undefined;
  await authenticateHandshake(socket as unknown as Socket, (err?: Error) => {
    error = err;
  });
  return { socket, error };
};

describe("a facility-bound socket", () => {
  it("the handshake builds the facility context from the loaded row", async () => {
    const { socket, error } = await handshake(user());
    expect(error).toBeUndefined();
    expect(socket.tenantContext).toEqual({
      tenantId: T,
      isSuperAdmin: false,
      isSystemTask: false,
      userId: "user-1",
      clientFacilityId: F1,
      facilityBound: true,
    });
  });

  it.each([
    ["inactive", { clientFacility: { id: F1, status: "inactive" } }],
    ["ended", { clientFacility: { id: F1, status: "ended" } }],
    ["unresolved", { clientFacility: null }],
    ["pending", { clientFacilityId: null, clientFacility: null, facilityBindingPending: true }],
  ])("the handshake refuses a %s facility account (§ 7.2)", async (_case, over) => {
    const { socket, error } = await handshake(user(over));
    expect(error).toBeInstanceOf(Error);
    expect(socket.tenantContext).toBeUndefined();
  });

  it("joins its facility room and its user room — never the tenant room; kanban is refused", async () => {
    const fakeIo = { use: jest.fn(), on: jest.fn(), to: jest.fn() };
    Server.mockImplementation(() => fakeIo);
    socketModule.initSocket({});
    const { socket } = await handshake(user());
    const connect = (fakeIo.on.mock.calls.find((c: unknown[]) => c[0] === "connection") as [string, (s: unknown) => void])[1];
    connect(socket);
    const rooms = socket.join.mock.calls.map((c: unknown[]) => c[0]);
    expect(rooms).toEqual([`facility_${T}_${F1}`, "user_user-1"]);
    expect(rooms).not.toContain(`tenant_${T}`);
    const handlers = Object.fromEntries(socket.on.mock.calls as [string, (...a: unknown[]) => Promise<unknown>][]);
    const ack = jest.fn();
    await (handlers["kanban:join"] as (p: unknown, a: unknown) => Promise<unknown>)("proj-1", ack);
    expect(kanban.assertAccess).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ ok: false, error: "Kanban boards are not available to facility accounts" });
    expect(socket.join).not.toHaveBeenCalledWith("board_proj-1");
  });

  it("scopeDrift disconnects on a binding change (bind, unbind, re-bind), not otherwise", async () => {
    const { socket } = await handshake(user());
    expect(scopeDrift(socket, user())).toBeNull();
    expect(scopeDrift(socket, user({ clientFacilityId: F2 }))).toBe("user user-1 changed client facility");
    expect(scopeDrift(socket, user({ clientFacilityId: null }))).toBe("user user-1 changed client facility");
    const unbound = await handshake(user({ clientFacilityId: null, clientFacility: null }));
    expect(scopeDrift(unbound.socket, user({ clientFacilityId: null }))).toBeNull();
    expect(scopeDrift(unbound.socket, user({ clientFacilityId: "" }))).toBeNull();
    expect(scopeDrift(unbound.socket, user())).toBe("user user-1 changed client facility");
    // A context built before P21-09 (no facility field) reads as unbound.
    const legacy = { user: { id: "user-1", role: { name: "HEALTHCARE TECHNICIAN" } }, tenantContext: { tenantId: T, isSuperAdmin: false, isSystemTask: false } };
    expect(scopeDrift(legacy, user({ clientFacilityId: null }))).toBeNull();
  });

  it("the re-check closes a bound socket once its facility leaves active (AM-20)", async () => {
    const { socket } = await handshake(user());
    authService.getAuthUserWithTenant.mockResolvedValue(user({ clientFacility: { id: F1, status: "ended" } }));
    const recheck = socketModule.__testables.recheckSocket;
    await expect(recheck(Object.assign(socket, { sessionId: "sess-1" }))).resolves.toBe(true);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
