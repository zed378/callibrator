/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// A-53 — a reconnected socket must re-join its board rooms.
//
// Not a mock: a REAL Socket.IO server runs in this process and the REAL
// socket.io-client (through lib/socket.ts) connects to it. A reconnect gives
// the client a new server-side socket with no room membership, which is the
// defect; the test drops the engine, lets the client reconnect on its own,
// then emits to the board room and asserts the event reaches the store.
//
// The export conditions select the Node builds of socket.io-client and `ws`
// (the browser condition would pick `ws`'s browser stub, which throws), while
// jsdom still provides the `window` lib/socket.ts and renderHook need.
// `socket.io` resolves from the root node_modules (the backend workspace's
// copy, hoisted); it is test-only here.

import http from "http";
import { AddressInfo } from "net";
import { renderHook, waitFor } from "@testing-library/react";
import { Server, Socket as ServerSocket } from "socket.io";
import { useBoard } from "./useBoard";
import { useKanbanStore } from "@/stores/kanbanStore";
import { getSocket, disconnectSocket } from "@/lib/socket";
import { kanbanService, KanbanBoard } from "@/api/services/kanban.service";

let mockBaseUrl = "";

jest.mock("@/constants", () => ({
  get API_BASE_URL() {
    return mockBaseUrl;
  },
}));

jest.mock("@/api/services/socketToken.service", () => ({
  socketTokenService: {
    getSocketToken: jest.fn(async () => ({ token: "socket-token", expiresIn: 60 })),
  },
}));

jest.mock("@/api/services/kanban.service", () => ({
  kanbanService: { getBoard: jest.fn() },
}));

const board = (projectId: string): KanbanBoard => ({
  id: projectId,
  name: "Board",
  myAccess: "viewer",
  activeSprintId: "all",
  columns: [],
  cards: [],
  labels: [],
  sprints: [],
  members: [],
});

const card = (id: string, projectId: string) => ({
  id,
  projectId,
  columnId: "col-1",
  sprintId: null,
  title: id,
  position: 0,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
  assignees: [],
  labels: [],
});

const REFUSED = "Project not found";

describe("useBoard realtime over a real Socket.IO server (A-53)", () => {
  let httpServer: http.Server;
  let io: Server;
  let connections: ServerSocket[];

  const inRoom = async (projectId: string) =>
    (await io.in(`board_${projectId}`).fetchSockets()).length;

  beforeEach(async () => {
    connections = [];
    httpServer = http.createServer();
    io = new Server(httpServer);
    io.on("connection", (socket) => {
      connections.push(socket);
      // Same contract as backend/src/config/socket.js: join after an access
      // check, answer through the ack when one is passed.
      socket.on(
        "kanban:join",
        (projectId: string, ack?: (r: { ok: boolean; error?: string }) => void) => {
          if (projectId === "denied") {
            if (typeof ack === "function") ack({ ok: false, error: REFUSED });
            return;
          }
          socket.join(`board_${projectId}`);
          if (typeof ack === "function") ack({ ok: true });
        },
      );
      socket.on("kanban:leave", (projectId: string) => {
        socket.leave(`board_${projectId}`);
      });
    });
    await new Promise<void>((resolve) =>
      httpServer.listen(0, "127.0.0.1", () => resolve()),
    );
    mockBaseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

    (kanbanService.getBoard as jest.Mock).mockImplementation(async (id: string) =>
      board(id),
    );
    useKanbanStore.setState({ board: null, error: null, viewSprintId: "" });
  });

  afterEach(async () => {
    disconnectSocket();
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });

  it(
    "A-53: re-joins the board room after a reconnect, so a later board event still arrives",
    async () => {
      renderHook(() => useBoard("proj-53"));

      await waitFor(async () => expect(await inRoom("proj-53")).toBe(1));
      expect(useKanbanStore.getState().board?.id).toBe("proj-53");

      // Drop the transport under the client. It reconnects on its own, as a
      // browser does after a network blip or a backend restart.
      const client = await getSocket();
      client!.io.engine.close();
      await waitFor(() => expect(connections).toHaveLength(2), {
        timeout: 8000,
      });
      expect(connections[0].connected).toBe(false);
      expect(client!.connected).toBe(true);

      // The new server-side socket starts with no rooms; only the client can
      // put it back in the board room.
      await waitFor(async () => expect(await inRoom("proj-53")).toBe(1), {
        timeout: 2000,
      });

      io.to("board_proj-53").emit("kanban:card:created", {
        card: card("card-after-reconnect", "proj-53"),
      });

      await waitFor(() =>
        expect(
          useKanbanStore.getState().board?.cards.map((c) => c.id),
        ).toEqual(["card-after-reconnect"]),
      );
    },
    15000,
  );

  it("A-53: a refused join surfaces as a board error instead of silence", async () => {
    renderHook(() => useBoard("denied"));

    await waitFor(() =>
      expect(useKanbanStore.getState().error).toMatch(REFUSED),
    );
    expect(await inRoom("denied")).toBe(0);
  });

  it(
    "A-53: an unmounted board leaves its room and is not re-joined on reconnect",
    async () => {
      const { unmount } = renderHook(() => useBoard("proj-left"));
      await waitFor(async () => expect(await inRoom("proj-left")).toBe(1));

      unmount();
      await waitFor(async () => expect(await inRoom("proj-left")).toBe(0));

      const client = await getSocket();
      client!.io.engine.close();
      await waitFor(() => expect(connections).toHaveLength(2), {
        timeout: 8000,
      });
      await waitFor(() => expect(client!.connected).toBe(true));

      // Give a stray re-join time to land, then check it did not.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await inRoom("proj-left")).toBe(0);
    },
    15000,
  );
});
