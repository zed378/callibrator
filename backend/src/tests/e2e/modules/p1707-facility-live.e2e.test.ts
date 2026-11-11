/**
 * P17-07 (part 2) — the live cases of docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md § 12 that need a
 * real socket or a second principal kind: PT-13 (the dashboard cache), PT-14 (socket rooms), PT-15
 * (a socket after the user moves), PT-19 (impersonation) and PT-20 (an API key). The HTTP cases are in
 * `p1707-facility-pentest.e2e.test.ts`; both run against the same kind of disposable production-mode
 * stack, with FACILITY_BINDING_ENABLED=true in its throwaway env file.
 *
 * Every case asserts the PASS condition of the checklist; a red case is a finding. A socket case
 * always has a positive control (the room that SHOULD hear the event does), so silence from the
 * attacked socket means isolation, not a dead connection.
 *
 * Env: BASE_URL, E2E_OPERATOR_PASSWORD (+ E2E_BOOTSTRAP_PASSWORD on a fresh stack), E2E_MAILPIT_URL.
 */
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { environment } from "../../../config/env";
import { io, type Socket } from "socket.io-client";
import {
  apiBase,
  arr,
  call,
  dataOf,
  messageOf,
  newClientAddress,
  obj,
  operatorSession,
  replaceOneTimePassword,
  roleNamed,
  runStamp,
  str,
  strongPassword,
} from "../p10Live";

jest.setTimeout(300_000);

const execFileAsync = promisify(execFile);
const penv = environment();

const stamp = runStamp();
type Reply = Awaited<ReturnType<typeof call>>;

const expectOk = (reply: Reply, want: number, what: string): Record<string, unknown> => {
  if (reply.status !== want) {
    throw new Error(`${what}: ${String(reply.status)} ${JSON.stringify(reply.body).slice(0, 900)}`);
  }
  return dataOf(reply);
};
const rowsOf = (reply: Reply): Record<string, unknown>[] => arr(obj(reply.body)["data"]).map(obj);

interface Principal {
  token: string;
  userId: string;
  email: string;
  password: string;
}
const blank = (): Principal => ({ token: "", userId: "", email: "", password: "" });

let operator = "";
let t1Id = "";
let t2Id = "";
const p = { admin: blank(), hcA1: blank(), hcMover: blank(), hcA2: blank(), adminB: blank() };
const ids = { f1: "", f2: "", f3: "", d1: "", d2: "", d3: "" };

const signIn = async (email: string, password: string): Promise<string> => {
  const res = await call("POST", "/auth/login", { body: { user: email, password }, from: newClientAddress() });
  const token = str(obj(res.body)["token"]);
  if (res.status !== 200 || token === "") {
    throw new Error(`sign-in ${email}: ${String(res.status)} ${messageOf(res)}`);
  }
  return token;
};

const tenant = async (label: string): Promise<string> =>
  str(expectOk(await call("POST", "/tenants/create", { token: operator, body: { name: `Pentest ${label} ${stamp}`, code: `PL${label}${stamp}`.slice(0, 40).toUpperCase() } }), 201, "tenant")["id"]);

/**
 * `api_keys` is a business-plan feature and no API route sets a tenant's plan (billing's override acts on the
 * caller's own tenant; the hierarchy route is off). PT-20 needs the key, so the throwaway stack's database is
 * told directly: E2E_POSTGRES_CONTAINER names its PostgreSQL container. A disposable stack only.
 */
const setPlan = async (tenantId: string, plan: string): Promise<void> => {
  const container = penv["E2E_POSTGRES_CONTAINER"] ?? "";
  if (container === "") {
    throw new Error("PT-20 needs E2E_POSTGRES_CONTAINER (the disposable stack's PostgreSQL container) to give T1 the business plan");
  }
  await execFileAsync("docker", ["exec", container, "psql", "-U", penv["E2E_POSTGRES_USER"] ?? "callibrator", "-d", penv["E2E_POSTGRES_DB"] ?? "callibrator", "-v", "ON_ERROR_STOP=1", "-c", `UPDATE tenants SET plan = '${plan}' WHERE id = '${tenantId}'`]);
};

const user = async (tenantId: string, role: string, label: string): Promise<Principal> => {
  const r = await roleNamed(operator, role);
  const email = `p1707l-${label}-${stamp}@example.com`;
  const oneTime = strongPassword("once");
  const created = expectOk(
    await call("POST", "/users/create", {
      token: operator,
      body: { tenantId, username: `pl${label}${stamp}`.replace(/[^a-z0-9]/gi, "").slice(0, 30), firstName: "Pentest", lastName: label, email, password: oneTime, roleId: r["id"] },
    }),
    201,
    `user ${label}`,
  );
  const password = strongPassword(label);
  await replaceOneTimePassword(email, oneTime, password);
  return { token: await signIn(email, password), userId: str(created["id"]), email, password };
};

const bind = async (who: Principal, facility: string | null): Promise<void> => {
  expectOk(
    await call("PUT", `/users/${who.userId}/client-facility`, { token: p.admin.token, body: { clientFacilityId: facility, reason: "P17-07 live pentest binding" } }),
    200,
    "bind",
  );
  who.token = await signIn(who.email, who.password);
};

const device = async (facility: string, label: string): Promise<string> => {
  const qr = `PL${label}${stamp}`.slice(0, 13).toUpperCase();
  const d = expectOk(
    await call("POST", "/calibration-devices", {
      token: p.admin.token,
      body: { name: `Alat Live ${label} ${stamp}`, serialNumber: `SN-${qr}`, clientFacilityId: facility, qrCode: qr, room: { name: `Ruang ${label} ${stamp}` } },
    }),
    201,
    `device ${label}`,
  );
  return str(d["id"]);
};

/**
 * Move a device to another facility (the provider administrator's act, no checklist needed): the server
 * emits `device:moved_out` to the row's old tenant and facility rooms and `device:moved_in` to the new
 * facility's room (services/deviceMove.service.ts, through the one facility emitter).
 */
const moveDevice = async (deviceId: string, target: string): Promise<void> => {
  expectOk(
    await call("POST", `/calibration-devices/${deviceId}/move`, { token: p.admin.token, body: { targetClientFacilityId: target, reason: "P17-07 live pentest event" } }),
    200,
    "move device",
  );
};

// ── sockets ────────────────────────────────────────────────────────────────────────────────────

interface Probe {
  socket: Socket;
  /** Every `device:*` event the socket has heard, as `<event>:<device id>`, in order. */
  heard: string[];
  /** Set when the server closed the connection. */
  closedAt: { at: number | null };
}
const open: Probe[] = [];

const origin = (): string => apiBase().replace(/\/api\/v1$/, "");

const listen = async (who: Principal): Promise<Probe> => {
  const minted = expectOk(await call("POST", "/auth/socket-token", { token: who.token }), 200, "socket token");
  const socket = io(origin(), { auth: { token: str(minted["token"]) }, transports: ["websocket"], reconnection: false, forceNew: true });
  const probe: Probe = { socket, heard: [], closedAt: { at: null } };
  socket.onAny((event: string, payload: unknown) => {
    if (event.startsWith("device:")) {
      probe.heard.push(`${event}:${str(obj(payload)["id"])}`);
    }
  });
  socket.on("disconnect", () => {
    probe.closedAt.at = Date.now();
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error("socket did not connect in 15 s")); }, 15_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  open.push(probe);
  return probe;
};

const until = async (what: string, ms: number, done: () => boolean): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (done()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for: ${what}`);
};
const quiet = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  operator = (await operatorSession()).token;
  t1Id = await tenant("T1");
  await setPlan(t1Id, "business");
  t2Id = await tenant("T2");
  p.admin = await user(t1Id, "CALIBRATOR ADMIN", "admin");
  p.hcA1 = await user(t1Id, "HEALTHCARE ADMIN", "hca1");
  p.hcMover = await user(t1Id, "HEALTHCARE TECHNICIAN", "mover");
  p.hcA2 = await user(t1Id, "HEALTHCARE ADMIN", "hca2");
  p.adminB = await user(t2Id, "CALIBRATOR ADMIN", "adminb");
  for (const [key, name] of [["f1", "F1"], ["f2", "F2"], ["f3", "F3"]] as const) {
    ids[key] = str(
      expectOk(await call("POST", "/client-facilities", { token: p.admin.token, body: { name: `Faskes ${name} ${stamp}`, code: `${name}L${stamp}`.slice(0, 20).toUpperCase() } }), 201, "facility")["id"],
    );
  }
  ids.d1 = await device(ids.f1, "A");
  ids.d2 = await device(ids.f2, "B");
  ids.d3 = await device(ids.f2, "C");
  await bind(p.hcA1, ids.f1);
  await bind(p.hcMover, ids.f1);
  await bind(p.hcA2, ids.f2);
});

afterAll(() => {
  for (const probe of open) {
    probe.socket.close();
  }
});

// PT-13 runs first: the moves below change which facility holds which device.
describe("P17-07 live — PT-13: the dashboard cache", () => {
  const devicesTotal = (reply: Reply): number => {
    const devices = obj(dataOf(reply)["devices"]);
    return Number(devices["total"]);
  };

  it("the provider and a bound F1 user load the dashboard back to back, in both orders, and each sees only its own scope", async () => {
    // Provider first, then F1 (the F1 user must not be served the provider's cached figure) ...
    const providerFirst = await call("GET", "/dashboard/metrics", { token: p.admin.token });
    expectOk(providerFirst, 200, "provider dashboard");
    const f1After = await call("GET", "/dashboard/metrics", { token: p.hcA1.token });
    expectOk(f1After, 200, "F1 dashboard");
    expect(devicesTotal(providerFirst)).toBeGreaterThanOrEqual(3);
    expect(devicesTotal(f1After)).toBe(1);

    // ... and the reverse: F1's figure must not be served to the provider within the 30 s window.
    const f2Second = await call("GET", "/dashboard/metrics", { token: p.hcA2.token });
    const providerAfter = await call("GET", "/dashboard/metrics", { token: p.admin.token });
    expect(devicesTotal(f2Second)).toBe(2);
    expect(devicesTotal(providerAfter)).toBeGreaterThanOrEqual(3);
  });
});

// PT-19 and PT-20 read the facilities as first set up, so they too run before the moves.
describe("P17-07 live — PT-19: impersonation", () => {
  it("the operator impersonating a bound F1 user sees F1 only, and not F2's devices", async () => {
    const res = await call("POST", "/auth/impersonate", { token: operator, body: { tenantId: t1Id, userId: p.hcA1.userId } });
    const token = str(obj(res.body)["token"]);
    expect(res.status).toBe(200);
    expect(token).not.toBe("");

    const seen = rowsOf(await call("GET", "/calibration-devices", { token })).map((r) => str(r["id"]));
    expect(seen).toContain(ids.d1);
    expect(seen).not.toContain(ids.d2);
    expect(seen).not.toContain(ids.d3);
  });

  it("a tenant administrator cannot impersonate anyone", async () => {
    const res = await call("POST", "/auth/impersonate", { token: p.admin.token, body: { tenantId: t1Id, userId: p.hcA1.userId } });
    expect(res.status).toBe(403);
  });
});

describe("P17-07 live — PT-20: an API key", () => {
  it("a tenant key reads every facility's devices (documented), cannot reach key management, and cannot cross tenants", async () => {
    const created = expectOk(
      await call("POST", "/api-keys", { token: p.admin.token, body: { name: `p1707 live ${stamp}`, scopes: ["calibration:read"] } }),
      201,
      "api key",
    );
    const key = str(created["key"]);
    expect(key).not.toBe("");

    const asKey = (path: string, method = "GET"): Promise<Reply> => call(method, path, { headers: { Authorization: `ApiKey ${key}` } });

    const devices = rowsOf(await asKey("/calibration-devices")).map((r) => str(r["id"]));
    expect(devices).toEqual(expect.arrayContaining([ids.d1, ids.d2, ids.d3]));

    // Key management and the facility switches are not the key's to use.
    const list = await asKey("/api-keys");
    expect([401, 403]).toContain(list.status);
    const bound = await call("PUT", `/users/${p.hcA1.userId}/client-facility`, {
      headers: { Authorization: `ApiKey ${key}` },
      body: { clientFacilityId: null, reason: "key attempt" },
    });
    expect([401, 403]).toContain(bound.status);

    // The key belongs to T1: T2's administrator cannot see it, and T1's device is a 404 for T2.
    const otherTenant = await call("GET", `/calibration-devices/${ids.d1}`, { token: p.adminB.token });
    expect(otherTenant.status).toBe(404);
  });
});

describe("P17-07 live — PT-14: socket rooms", () => {
  it("a move out of F2 reaches F2's user and the provider's tenant room, and neither F1's user nor another tenant", async () => {
    const [f1, f2, provider, other] = [await listen(p.hcA1), await listen(p.hcA2), await listen(p.admin), await listen(p.adminB)];

    await moveDevice(ids.d2, ids.f3);

    // The positive controls hear it, so the silence below is isolation and not a dead connection.
    await until("F2's user hears device:moved_out", 15_000, () => f2.heard.includes(`device:moved_out:${ids.d2}`));
    await until("the provider hears device:moved_out", 15_000, () => provider.heard.includes(`device:moved_out:${ids.d2}`));
    await quiet(3_000);
    expect(f1.heard).toEqual([]);
    expect(other.heard).toEqual([]);
  });

  it("a bound user cannot talk their way into another room: kanban:join is refused and forged room names change nothing", async () => {
    const f1 = await listen(p.hcA1);
    const f2 = await listen(p.hcA2);

    const ack = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error("no ack for kanban:join")); }, 10_000);
      f1.socket.emit("kanban:join", randomUUID(), (reply: unknown) => {
        clearTimeout(timer);
        resolve(obj(reply));
      });
    });
    expect(ack["ok"]).toBe(false);

    // There is no generic join event; asking for F2's and the tenant's rooms by name must still change nothing.
    for (const event of ["join", "join:room", "room:join", "subscribe"]) {
      f1.socket.emit(event, `facility_${t1Id}_${ids.f2}`);
      f1.socket.emit(event, `tenant_${t1Id}`);
    }
    await quiet(500);

    await moveDevice(ids.d3, ids.f3);
    await until("F2's user hears the second event", 15_000, () => f2.heard.includes(`device:moved_out:${ids.d3}`));
    await quiet(3_000);
    expect(f1.heard).toEqual([]);
  });
});

describe("P17-07 live — PT-15: a socket after the user moves", () => {
  it("a user moved from F1 to F2 is disconnected within the re-check window and hears no F1 event after the move", async () => {
    const mover = await listen(p.hcMover);
    const f1Control = await listen(p.hcA1);

    await bind(p.hcMover, ids.f2);
    const movedAt = Date.now();
    await moveDevice(ids.d1, ids.f3);

    await until("F1's own user hears the F1 event", 15_000, () => f1Control.heard.includes(`device:moved_out:${ids.d1}`));
    // The socket is closed by the 60 s re-check (the bind revoked its session); allow a second tick.
    await until("the moved user's socket is closed by the server", 130_000, () => mover.closedAt.at !== null);

    expect((mover.closedAt.at ?? 0) - movedAt).toBeLessThan(130_000);
    expect(mover.heard.filter((e) => e.endsWith(`:${ids.d1}`))).toEqual([]);
  });
});
