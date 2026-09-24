// Socket singleton lifecycle (F-01).

import { io, Socket } from "socket.io-client";
import { socketTokenService } from "@/api/services/socketToken.service";
import { getSocket, disconnectSocket, joinBoardRoom } from "./socket";

jest.mock("socket.io-client", () => ({ io: jest.fn() }));

jest.mock("@/api/services/socketToken.service", () => ({
  socketTokenService: { getSocketToken: jest.fn() },
}));

interface FakeSocket {
  token: string;
  auth: { token: string };
  handlers: Record<string, (...args: unknown[]) => unknown>;
  on: jest.Mock;
  connect: jest.Mock;
  disconnect: jest.Mock;
}

const ioMock = io as unknown as jest.Mock;
const getSocketToken = socketTokenService.getSocketToken as jest.Mock;

const makeFakeSocket = (token: string): FakeSocket => {
  const fake: FakeSocket = {
    token,
    auth: { token },
    handlers: {},
    on: jest.fn((event: string, fn: (...args: unknown[]) => unknown) => {
      fake.handlers[event] = fn;
    }),
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
  return fake;
};

describe("lib/socket (F-01)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Drop any queued once-values a previous test left unconsumed.
    getSocketToken.mockReset();
    disconnectSocket();
    ioMock.mockImplementation((_url: string, opts: { auth: { token: string } }) =>
      makeFakeSocket(opts.auth.token),
    );
  });

  it("F-01: disconnectSocket closes the socket and the next getSocket opens a new one", async () => {
    getSocketToken.mockResolvedValueOnce({ token: "token-A", expiresIn: 60 });
    const first = (await getSocket()) as unknown as FakeSocket;

    disconnectSocket();
    expect(first.disconnect).toHaveBeenCalled();

    getSocketToken.mockResolvedValueOnce({ token: "token-B", expiresIn: 60 });
    const second = (await getSocket()) as unknown as FakeSocket;

    expect(second).not.toBe(first);
    expect(second.token).toBe("token-B");
  });

  it("F-01: a connection still being set up when the session ends is discarded, not kept", async () => {
    // getSocket() has fetched nothing yet; logout happens meanwhile.
    let releaseToken: (value: { token: string; expiresIn: number }) => void =
      () => undefined;
    getSocketToken.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseToken = resolve;
        }),
    );

    const pending = getSocket();
    disconnectSocket();
    releaseToken({ token: "token-A", expiresIn: 60 });

    // The departing session's connection must not be created.
    expect(await pending).toBeNull();
    expect(ioMock).not.toHaveBeenCalled();

    // The next session gets its own connection with its own token.
    getSocketToken.mockResolvedValueOnce({ token: "token-B", expiresIn: 60 });
    const next = (await getSocket()) as unknown as FakeSocket;
    expect(next.token).toBe("token-B");
  });

  it("F-01: a stale socket's connect_error handler cannot re-authenticate the next session's socket", async () => {
    getSocketToken.mockResolvedValueOnce({ token: "token-A", expiresIn: 60 });
    const first = (await getSocket()) as unknown as FakeSocket;
    disconnectSocket();

    getSocketToken.mockResolvedValueOnce({ token: "token-B", expiresIn: 60 });
    const second = (await getSocket()) as unknown as FakeSocket;

    // A late connect_error on the OLD socket.
    getSocketToken.mockResolvedValueOnce({ token: "token-X", expiresIn: 60 });
    await first.handlers["connect_error"]();

    expect(second.auth).toEqual({ token: "token-B" });
    expect(second.connect).not.toHaveBeenCalled();
    expect(first.connect).not.toHaveBeenCalled();
  });

  it("refreshes the handshake token on connect_error, up to the cap", async () => {
    getSocketToken.mockResolvedValueOnce({ token: "token-A", expiresIn: 60 });
    const s = (await getSocket()) as unknown as FakeSocket;

    getSocketToken.mockResolvedValue({ token: "fresh", expiresIn: 60 });
    await s.handlers["connect_error"]();
    expect(s.auth).toEqual({ token: "fresh" });
    expect(s.connect).toHaveBeenCalledTimes(1);

    await s.handlers["connect_error"]();
    await s.handlers["connect_error"]();
    await s.handlers["connect_error"]();
    expect(s.connect).toHaveBeenCalledTimes(3);

    // A successful connect resets the budget.
    s.handlers["connect"]();
    await s.handlers["connect_error"]();
    expect(s.connect).toHaveBeenCalledTimes(4);
  });

  it("leaves the socket disconnected when the token refresh fails", async () => {
    getSocketToken.mockResolvedValueOnce({ token: "token-A", expiresIn: 60 });
    const s = (await getSocket()) as unknown as FakeSocket;

    getSocketToken.mockRejectedValueOnce(new Error("401"));
    await s.handlers["connect_error"]();
    expect(s.connect).not.toHaveBeenCalled();
  });

  it("returns null when the handshake token cannot be obtained", async () => {
    getSocketToken.mockRejectedValueOnce(new Error("401"));
    expect(await getSocket()).toBeNull();
  });

  it("shares one in-flight connection between concurrent callers", async () => {
    getSocketToken.mockResolvedValueOnce({ token: "token-A", expiresIn: 60 });
    const [a, b] = await Promise.all([getSocket(), getSocket()]);
    expect(a).toBe(b);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });
});

// The reconnect itself is proven against a real Socket.IO server in
// app/dashboard/kanban/[projectId]/hooks/useBoard.realtime.test.ts; these pin
// the bookkeeping around it.
describe("lib/socket joinBoardRoom (A-53)", () => {
  interface RoomSocket extends FakeSocket {
    connected: boolean;
    emit: jest.Mock;
  }

  const open = async (): Promise<RoomSocket> => {
    getSocketToken.mockResolvedValueOnce({ token: "token-A", expiresIn: 60 });
    const s = (await getSocket()) as unknown as RoomSocket;
    s.connected = true;
    s.emit = jest.fn();
    return s;
  };

  const joins = (s: RoomSocket) =>
    s.emit.mock.calls.filter((c) => c[0] === "kanban:join").map((c) => c[1]);

  beforeEach(() => {
    jest.clearAllMocks();
    getSocketToken.mockReset();
    disconnectSocket();
    ioMock.mockImplementation((_url: string, opts: { auth: { token: string } }) =>
      makeFakeSocket(opts.auth.token),
    );
  });

  it("A-53: waits for connect when the socket is not connected yet, then joins", async () => {
    const s = await open();
    s.connected = false;
    joinBoardRoom(s as unknown as Socket, "p1");
    expect(joins(s)).toEqual([]);

    s.handlers["connect"]();
    expect(joins(s)).toEqual(["p1"]);
  });

  it("A-53: a connect on a socket from an ended session replays nothing", async () => {
    const old = await open();
    joinBoardRoom(old as unknown as Socket, "p1");
    disconnectSocket();
    old.emit.mockClear();

    old.handlers["connect"]();
    expect(joins(old)).toEqual([]);
  });

  it("A-53: ignores a refusal that arrives after the caller unsubscribed", async () => {
    const s = await open();
    const onRefused = jest.fn();
    const leave = joinBoardRoom(s as unknown as Socket, "p1", onRefused);
    const ack = s.emit.mock.calls[0][2] as (r?: unknown) => void;

    leave();
    ack({ ok: false, error: "nope" });
    ack(undefined);
    expect(onRefused).not.toHaveBeenCalled();
  });

  it("A-53: reports a refusal with a default message when the server gives none", async () => {
    const s = await open();
    const onRefused = jest.fn();
    joinBoardRoom(s as unknown as Socket, "p1", onRefused);
    (s.emit.mock.calls[0][2] as (r: unknown) => void)({ ok: false });
    expect(onRefused).toHaveBeenCalledWith(
      "Live updates for this board were refused",
    );
  });

  it("A-53: a refusal without an onRefused handler is harmless", async () => {
    const s = await open();
    joinBoardRoom(s as unknown as Socket, "p1");
    const ack = s.emit.mock.calls[0][2] as (r: unknown) => void;
    expect(() => ack({ ok: false, error: "nope" })).not.toThrow();
  });

  it("A-53: leaves the room only when its last subscriber goes, and only once", async () => {
    const s = await open();
    const leaveA = joinBoardRoom(s as unknown as Socket, "p1");
    const leaveB = joinBoardRoom(s as unknown as Socket, "p1");

    leaveA();
    expect(s.emit).not.toHaveBeenCalledWith("kanban:leave", "p1");
    leaveB();
    leaveB();
    expect(
      s.emit.mock.calls.filter((c) => c[0] === "kanban:leave"),
    ).toEqual([["kanban:leave", "p1"]]);
  });

  it("A-53: does not emit a leave on a disconnected socket", async () => {
    const s = await open();
    const leave = joinBoardRoom(s as unknown as Socket, "p1");
    s.connected = false;
    leave();
    expect(s.emit).not.toHaveBeenCalledWith("kanban:leave", "p1");
  });
});
