/**
 * P21-09d — G-19 (spec P19-04 § 9.1; AM-20): every socket emit in services/ goes through
 * `services/realtime#emitForRow` (tenant room + the ROW's facility room) or to a user room — or is
 * on the reviewed list below with why it cannot carry another facility's data to a bound socket.
 *
 * An emit to `tenant_<id>` built anywhere else would reach provider staff only (bound sockets are
 * not in tenant rooms) — harmless to bound users but silently missing them; an emit to a facility
 * room built from the ACTOR's facility would deliver a row to the wrong client. One helper keeps
 * the room naming in one place.
 */
import fs from "fs";
import path from "path";
import { emitForRow, roomsForRow } from "../../services/realtime";

/** The socket server emitForRow reaches (lazy-required at call time): a test sets it, or leaves none. */
const mockSocket: { io: { to: (rooms: string[]) => { emit: (e: string, p?: unknown) => unknown } } | null } = { io: null };
jest.mock("../../config/socket", () => ({
  getIo: () => {
    if (!mockSocket.io) {
      throw new Error("Socket.io is not initialized!");
    }
    return mockSocket.io;
  },
}));

const SERVICES = path.join(__dirname, "../../services");

/** Reviewed emits that do not use the helper: `<file>` → reason. */
const REVIEWED: Readonly<Record<string, string>> = {
  "notification.service.ts":
    "a notification goes to its addressee's user room, or — a tenant broadcast with no user — to the tenant room; a broadcast carries no facility data and reaches no bound socket (spec § 9.1)",
};

const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full) : e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") ? [full] : [];
  });

/** Room expressions passed to `.to(` / `.in(` on a socket server, outside the helper. */
const emitsIn = (text: string): string[] =>
  [...text.matchAll(/\b(?:io|getIo\(\)|server)\s*\.\s*(?:to|in)\(\s*([^)]*)\)/g)].map((m) => (m[1] ?? "").trim());

/** An emit is fine when it names a user room only. */
const userRoomOnly = (room: string): boolean => /^`user_\$\{[^}]+\}`$/.test(room);

const offenders = (entries: readonly { file: string; text: string }[]): string[] =>
  entries
    .filter(({ file }) => file !== "realtime.ts" && !Object.hasOwn(REVIEWED, file))
    .flatMap(({ file, text }) => emitsIn(text).filter((room) => !userRoomOnly(room)).map((room) => `${file}: ${room}`));

describe("G-19 — socket emitters in services/", () => {
  const entries = files(SERVICES).map((f) => ({ file: path.relative(SERVICES, f).split(path.sep).join("/"), text: fs.readFileSync(f, "utf8") }));

  it("every emit goes through emitForRow, a user room, or a reviewed entry", () => {
    expect(offenders(entries)).toEqual([]);
  });

  it("every reviewed entry still emits (the list only holds what exists)", () => {
    for (const file of Object.keys(REVIEWED)) {
      const entry = entries.find((e) => e.file === file);
      expect({ file, emits: (entry ? emitsIn(entry.text) : []).length > 0 }).toEqual({ file, emits: true });
    }
  });

  it("bites (fail-before): a tenant-room emit and an actor-facility emit are caught; a user room is not", () => {
    const planted = [
      { file: "planted.ts", text: "getIo().to(`tenant_${tenantId}`).emit('device:updated', row);" },
      { file: "planted2.ts", text: "io.to(`facility_${req.user.tenantId}_${req.user.clientFacilityId}`).emit('x', row);" },
      { file: "planted3.ts", text: "io.to(`user_${userId}`).emit('x', row);" },
    ];
    expect(offenders(planted)).toEqual(["planted.ts: `tenant_${tenantId}`", "planted2.ts: `facility_${req.user.tenantId}_${req.user.clientFacilityId}`"]);
  });
});

describe("services/realtime — the rooms come from the ROW", () => {
  const T = "aaaaaaaa-0000-4000-8000-000000000001";
  const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";

  it("tenant room, plus the row's facility room when it has one; nothing without a tenant", () => {
    expect(roomsForRow({ tenantId: T, clientFacilityId: F1 })).toEqual([`tenant_${T}`, `facility_${T}_${F1}`]);
    expect(roomsForRow({ tenantId: T, clientFacilityId: null })).toEqual([`tenant_${T}`]);
    expect(roomsForRow({ tenantId: T })).toEqual([`tenant_${T}`]);
    expect(roomsForRow({ tenantId: null, clientFacilityId: F1 })).toEqual([]);
  });

  it("emits to both rooms at once; nothing for a row without a tenant", () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    mockSocket.io = { to };
    emitForRow({ tenantId: T, clientFacilityId: F1 }, "device:moved_in", { id: "d1" });
    emitForRow({ tenantId: null }, "ignored");
    mockSocket.io = null;
    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith([`tenant_${T}`, `facility_${T}_${F1}`]);
    expect(emit).toHaveBeenCalledWith("device:moved_in", { id: "d1" });
  });

  it("an emit that fails (no socket server) is logged, never thrown", () => {
    mockSocket.io = null;
    expect(() => {
      emitForRow({ tenantId: T, clientFacilityId: F1 }, "device:moved_out");
    }).not.toThrow();
  });
});
