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

describe("P17-07 live — PT-18: reminder inboxes", () => {
  it("overdue F1 and F2 devices notify only their own facility's users", async () => {
    const container = penv["E2E_POSTGRES_CONTAINER"] ?? "";
    expect(container).not.toBe("");
    // Fixture setup only: the scan itself and both inbox reads use the live API.
    await execFileAsync("docker", ["exec", container, "psql", "-U", penv["E2E_POSTGRES_USER"] ?? "callibrator", "-d", penv["E2E_POSTGRES_DB"] ?? "callibrator", "-v", "ON_ERROR_STOP=1", "-c",
      `UPDATE calibration_devices SET next_calibration_date = '2020-01-01' WHERE tenant_id = '${t1Id}' AND id IN ('${ids.d1}', '${ids.d2}')`]);
    const scan = expectOk(await call("POST", "/calibration-scheduler/run", { token: p.admin.token }), 200, "reminder scan");
    expect(scan["errors"]).toBe(0);
    expect(scan["notificationsCreated"]).toBe(2);
    const first = rowsOf(await call("GET", "/notifications?limit=100&type=CALIBRATION", { token: p.hcA1.token }));
    const second = rowsOf(await call("GET", "/notifications?limit=100&type=CALIBRATION", { token: p.hcA2.token }));
    expect(first.map((row) => row["actionUrl"])).toContain(`/dashboard/devices/${ids.d1}`);
    expect(first.map((row) => row["actionUrl"])).not.toContain(`/dashboard/devices/${ids.d2}`);
    expect(second.map((row) => row["actionUrl"])).toContain(`/dashboard/devices/${ids.d2}`);
    expect(second.map((row) => row["actionUrl"])).not.toContain(`/dashboard/devices/${ids.d1}`);
    expect(first.every((row) => row["userId"] === p.hcA1.userId)).toBe(true);
    expect(second.every((row) => row["userId"] === p.hcA2.userId)).toBe(true);
  });
});

describe("P17-07 live — PT-21: SCIM provisioning", () => {
  it("a newly provisioned identity cannot read devices before administrator confirmation", async () => {
    const key = str(expectOk(await call("POST", "/api-keys", {
      token: p.admin.token, body: { name: `p1707 SCIM ${stamp}`, scopes: ["scim:write"] },
    }), 201, "SCIM key")["key"]);
    expect(key).not.toBe("");
    const provisioned = expectOk(await call("POST", "/scim/v2/Users", {
      headers: { Authorization: `ApiKey ${key}` },
      body: { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: `p1707-scim-${stamp}@example.test`, active: true },
    }), 201, "SCIM provision");
    const userId = str(provisioned["id"]);
    expect(userId).not.toBe("");
    const impersonated = await call("POST", "/auth/impersonate", { token: operator, body: { tenantId: t1Id, userId } });
    expect(impersonated.status).toBe(200);
    const token = str(obj(impersonated.body)["token"]);
    expect(token).not.toBe("");
    const refused = await call("GET", "/calibration-devices", { token });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toContain("FACILITY_BINDING_PENDING");
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
    const operatorId = str(expectOk(await call("POST", "/auth/verify", { token: operator }), 200, "operator identity")["id"]);
    expect(operatorId).not.toBe("");
    const audit = await call("GET", "/audit?action=LOGIN&resourceType=Session&limit=200", { token: p.admin.token });
    expectOk(audit, 200, "impersonation audit");
    const rows = rowsOf(audit).filter((row) => {
      const changes = obj(row["changes"]);
      return changes["operation"] === "impersonate" && changes["targetUserId"] === p.hcA1.userId;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: t1Id, clientFacilityId: ids.f1, userId: operatorId,
      changes: { impersonatorId: operatorId, targetUserId: p.hcA1.userId, targetTenantId: t1Id },
    });

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

describe("P17-07 live — PT-30: upstream exploit regressions", () => {
  it("S-04: self-registration cannot mint a credential or open inventory/recap reads", async () => {
    const email = `p1730-${stamp}@example.com`;
    const password = strongPassword("p1730");
    const registered = await call("POST", "/auth/register", {
      body: { firstName: "Security", lastName: "Probe", username: `p1730${stamp}`.slice(0, 30), email, password },
      from: newClientAddress(),
    });
    // This checklist targets the disposable production build: registration is absent.
    expect(registered.status).toBe(404);
    expect(obj(registered.body)["token"]).toBeUndefined();
    const login = await call("POST", "/auth/login", { body: { user: email, password }, from: newClientAddress() });
    expect(login.status).toBe(401);
    expect(obj(login.body)["token"]).toBeUndefined();
    for (const path of ["/calibration-devices?limit=10", "/calibration-records?limit=10"]) {
      expect((await call("GET", path)).status).toBe(401);
    }
  });

  it("S-05/S-11: legacy request identity fields cannot widen facility reads or attribute a session", async () => {
    const own = await call("GET", `/calibration-devices/${ids.d1}`, { token: p.hcA1.token });
    expect(own.status).toBe(200);
    expect(str(dataOf(own)["clientFacilityId"])).toBe(ids.f1);
    const injected = await call("GET", `/calibration-devices?limit=100&id_client=${ids.f2}&id_user=${p.hcA2.userId}`, { token: p.hcA1.token });
    expect(injected.status).toBe(200);
    expect(rowsOf(injected).map((row) => str(row["id"]))).toContain(ids.d1);
    expect(rowsOf(injected).every((row) => row["clientFacilityId"] === ids.f1)).toBe(true);
    expect(JSON.stringify(injected.body)).not.toContain(ids.d2);
    expect(JSON.stringify(injected.body)).not.toContain(ids.d3);
    expect((await call("GET", `/calibration-devices/${ids.d2}?id_client=${ids.f1}&id_user=${p.hcA1.userId}`, { token: p.hcA1.token })).status).toBe(404);
    const attempted = await call("POST", "/ipm/sessions", {
      token: p.hcMover.token,
      headers: { "Idempotency-Key": randomUUID() },
      body: { deviceId: ids.d1, id_client: ids.f2, id_user: p.hcA2.userId },
    });
    expect(attempted.status).toBe(400);
  });

  it("S-06: sequential QR guesses and real QR/device identifiers do not grant anonymous access", async () => {
    const own = expectOk(await call("GET", `/calibration-devices/${ids.d1}`, { token: p.admin.token }), 200, "positive device control");
    const qr = str(own["qrCode"]);
    expect(qr).not.toBe("");
    for (const path of [
      "/calibration-devices/by-qr/0000000000001",
      `/calibration-devices/by-qr/${qr}`,
      `/calibration-devices/${ids.d1}`,
    ]) {
      expect((await call("GET", path, { from: newClientAddress() })).status).toBe(401);
    }
    for (const guess of ["0000000000001", qr, ids.d1]) {
      expect((await call("GET", `/public/devices/${guess}`, { from: newClientAddress() })).status).toBe(404);
    }
  });

  it("S-10: real login access tokens contain only the reviewed identifier/session claims", () => {
    for (const who of [p.admin, p.hcA1, p.hcMover, p.hcA2, p.adminB]) {
      const segments = who.token.split(".");
      expect(segments).toHaveLength(3);
      const claims = obj(JSON.parse(Buffer.from(segments[1] ?? "", "base64url").toString("utf8")) as unknown);
      // Independent allow-list catches newly exposed user-row fields, including unknown secrets.
      expect(Object.keys(claims).sort()).toEqual(["email", "exp", "iat", "id", "sid", "typ"]);
      expect(claims["id"]).toBe(who.userId);
      expect(claims["email"]).toBe(who.email);
      expect(claims["typ"]).toBe("access");
      expect(typeof claims["sid"]).toBe("string");
    }
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
