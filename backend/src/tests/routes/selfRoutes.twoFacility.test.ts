/**
 * P21-09e — the remaining SELF routes a facility-bound account needs (P18-03 § 8.1 S-1, S-2, S-3,
 * S-5, S-7), marked facility-accessible, with their two-facility cases (G-07): one tenant, a user
 * bound to F1 (the caller) and a user bound to F2. A row of the F2 user is the same 404 as a
 * missing one, nothing written; the caller's own row is reached.
 *
 * REAL: the routers (auth double → tenant context + facility route gate), the services, the hooks
 * (Session and Notification FACILITY_READABLE by user; WebauthnCredential keyed by user, C-9),
 * memoryDb. DOUBLED: Redis (the session liveness and challenge store), bcrypt's cost.
 *
 * @two-facility api/session.route.ts POST /mine/:id/revoke
 * @two-facility api/notifications.route.ts PATCH /:notificationId/read
 * @two-facility api/notifications.route.ts DELETE /:notificationId
 * @two-facility api/webauthn.route.ts PATCH /credentials/:id
 * @two-facility api/webauthn.route.ts DELETE /credentials/:id
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as FacilitySuite from "../fixtures/twoFacilitySuite";
import type { FacilitySuiteContext } from "../fixtures/twoFacilitySuite";
import type { Principal } from "../fixtures/routeClient";
import type * as BcryptModule from "bcryptjs";
import type * as SessionRoute from "../../routes/api/session.route";
import type * as NotificationsRoute from "../../routes/api/notifications.route";
import type * as UserRoute from "../../routes/api/user.route";
import type * as AuthRoute from "../../routes/api/auth.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/redis.service", () => {
  const actual = jest.requireActual<Record<string, unknown>>("../../services/redis.service");
  const store = new Map<string, unknown>();
  return {
    ...actual,
    set: jest.fn((k: string, v: unknown) => {
      store.set(k, v);
      return Promise.resolve(true);
    }),
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    del: jest.fn((k: string) => Promise.resolve(store.delete(k))),
    getDel: jest.fn((k: string) => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return Promise.resolve(v);
    }),
    delPattern: jest.fn(() => Promise.resolve(undefined)),
  };
});
jest.mock("bcryptjs", () => {
  const real = jest.requireActual<typeof BcryptModule>("bcryptjs");
  return { ...real, hash: (plain: string) => real.hash(plain, 4) };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoFacilitySuite } = jest.requireActual<typeof FacilitySuite>("../fixtures/twoFacilitySuite");
const bcrypt = jest.requireActual<typeof BcryptModule>("bcryptjs");
const sessions = jest.requireActual<typeof SessionRoute>("../../routes/api/session.route");
const notifications = jest.requireActual<typeof NotificationsRoute>("../../routes/api/notifications.route");
const users = jest.requireActual<typeof UserRoute>("../../routes/api/user.route");
const auth = jest.requireActual<typeof AuthRoute>("../../routes/api/auth.route");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router, loaded after the mocks
const webauthn = require("../../routes/api/webauthn.route") as unknown;

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const ME = "cccccccc-0000-4000-8000-0000000000f1";
const PEER = "cccccccc-0000-4000-8000-0000000000f2";
const PASSWORD = "Str0ngPassw0rd";
const ID = {
  mySession: "5e550000-0000-4000-8000-0000000000f1",
  peerSession: "5e550000-0000-4000-8000-0000000000f2",
  myNote: "a0000000-0000-4000-8000-0000000000f1",
  peerNote: "a0000000-0000-4000-8000-0000000000f2",
  broadcast: "a0000000-0000-4000-8000-0000000000b0",
  myKey: "a1a1a1a1-0000-4000-8000-0000000000f1",
  myKey2: "a1a1a1a1-0000-4000-8000-0000000000f3",
  peerKey: "a1a1a1a1-0000-4000-8000-0000000000f2",
} as const;

let ctx: FacilitySuiteContext & { readonly bound: Principal };

const passkey = (id: string, userId: string, credentialId: string): Record<string, unknown> => ({
  id,
  userId,
  credentialId,
  publicKey: Buffer.from("pk").toString("base64url"),
  signCount: 0,
  transports: ["internal"],
  name: "Laptop",
  createdAt: new Date("2026-09-01T00:00:00Z"),
});

beforeEach(async () => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  const T = fx.tenantA.id;
  const base = fx.principal(fx.tenantA, "HEALTHCARE_TECHNICIAN");
  const bound = { ...base, id: ME, clientFacilityId: F1, sessionId: ID.mySession } as unknown as Principal;
  ctx = { bound };
  seedTenants(mdb, fx, []);
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = (id: string, f: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, tenantId: T, username: id.slice(-4), email: `${id.slice(-4)}@example.test`, password: hash, firstName: "F", lastName: id.slice(-2),
    roleId: base.role.id, clientFacilityId: f, status: "ACTIVE", isActive: true, webauthnEnabled: true, mfaEnabled: false, avatarUrl: null, ...extra,
  });
  mdb.seed("User", [user(ME, F1), user(PEER, F2)]);
  mdb.seed("ClientFacility", [
    { id: F1, tenantId: T, name: "Facility One", code: "F-0001", status: "active" },
    { id: F2, tenantId: T, name: "Facility Two", code: "F-0002", status: "active" },
  ]);
  mdb.seed("Session", [
    { id: ID.mySession, user_id: ME, tenant_id: T, token_hash: "h1", is_revoked: false, is_active: true, expired_at: new Date(Date.now() + 86400000) },
    { id: ID.peerSession, user_id: PEER, tenant_id: T, token_hash: "h2", is_revoked: false, is_active: true, expired_at: new Date(Date.now() + 86400000) },
  ]);
  mdb.seed("Notification", [
    { id: ID.myNote, tenantId: T, userId: ME, type: "CALIBRATION", title: "Due", message: "Pump due" },
    { id: ID.peerNote, tenantId: T, userId: PEER, type: "CALIBRATION", title: "Due", message: "Pump due" },
    { id: ID.broadcast, tenantId: T, userId: null, type: "SYSTEM", title: "Window", message: "Tonight" },
  ]);
  mdb.seed("WebauthnCredential", [passkey(ID.myKey, ME, "cred-me-1"), passkey(ID.myKey2, ME, "cred-me-2"), passkey(ID.peerKey, PEER, "cred-peer-1")]);
});

twoFacilitySuite({
  module: "sessions",
  router: sessions,
  routeFile: "api/session.route.ts",
  mdb,
  context: () => ctx,
  routes: [{ key: "POST /mine/:id/revoke", method: "POST", path: (id) => `/mine/${id}/revoke`, ownId: () => ID.mySession, foreignId: () => ID.peerSession, writes: ["Session"] }],
});

twoFacilitySuite({
  module: "notifications",
  router: notifications,
  routeFile: "api/notifications.route.ts",
  mdb,
  context: () => ctx,
  routes: [
    { key: "PATCH /:notificationId/read", method: "PATCH", path: (id) => `/${id}/read`, ownId: () => ID.myNote, foreignId: () => ID.peerNote, writes: ["NotificationState"] },
    { key: "DELETE /:notificationId", method: "DELETE", path: (id) => `/${id}`, ownId: () => ID.myNote, foreignId: () => ID.peerNote, writes: ["Notification"] },
  ],
});

twoFacilitySuite({
  module: "webauthn",
  router: webauthn,
  routeFile: "api/webauthn.route.ts",
  mdb,
  context: () => ctx,
  routes: [
    { key: "PATCH /credentials/:id", method: "PATCH", path: (id) => `/credentials/${id}`, ownId: () => ID.myKey, foreignId: () => ID.peerKey, body: { name: "Work laptop" }, writes: ["WebauthnCredential"] },
    { key: "DELETE /credentials/:id", method: "DELETE", path: (id) => `/credentials/${id}`, ownId: () => ID.myKey, foreignId: () => ID.peerKey, body: { currentPassword: PASSWORD }, writes: ["WebauthnCredential"] },
  ],
});

const send = (router: unknown, file: string, method: string, url: string, body: unknown = {}): ReturnType<typeof call> => {
  as(ctx.bound);
  return call(router, method, url, { body, routeFile: file });
};

describe("S-5 / S-7 / S-1 — the rest of the self routes for a bound account", () => {
  it("a tenant broadcast is not the bound user's: the same 404 as a missing id (S-5)", async () => {
    const res = await send(notifications, "api/notifications.route.ts", "PATCH", `/${ID.broadcast}/read`);
    expect(res.status).toBe(404);
  });

  it("DELETE /all and DELETE /bulk touch only the caller's own notifications (S-5)", async () => {
    expect((await send(notifications, "api/notifications.route.ts", "DELETE", "/bulk", { ids: [ID.myNote, ID.peerNote] })).status).toBe(200);
    expect(mdb.rows("Notification").map((n) => n["id"]).sort()).toEqual([ID.broadcast, ID.peerNote].sort());
    expect((await send(notifications, "api/notifications.route.ts", "DELETE", "/all")).status).toBe(200);
    expect(mdb.rows("Notification").map((n) => n["id"]).sort()).toEqual([ID.broadcast, ID.peerNote].sort());
  });

  it("S-7: another user's avatar is refused before the handler (403, id-independent); its own is reached", async () => {
    const other = await send(users, "api/user.route.ts", "DELETE", `/${PEER}/avatar`);
    const missing = await send(users, "api/user.route.ts", "DELETE", "/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/avatar");
    expect([other.status, (other.body as { code?: string }).code]).toEqual([403, "FACILITY_ROUTE_REFUSED"]);
    expect(other.body).toEqual(missing.body);
    expect((await send(users, "api/user.route.ts", "DELETE", `/${ME}/avatar`)).status).toBe(200);
  });

  it("S-1: the password and MFA self routes are reachable by the bound account", async () => {
    const check = await send(auth, "api/auth.route.ts", "POST", "/pass-is-valid", { password: PASSWORD });
    expect(check.status).toBe(200);
    // (`/mfa/setup` answers the new secret to its own caller; the response scanner refuses to carry
    // it, so its reach is proved by the route gate's own tests — facilityRouteDefault, G-10.)
    for (const url of ["/mfa/verify", "/mfa/disable", "/just-update-password"]) {
      const res = await send(auth, "api/auth.route.ts", "POST", url, {});
      expect({ url, refusedByTheGate: (res.body as { code?: string }).code === "FACILITY_ROUTE_REFUSED" }).toEqual({ url, refusedByTheGate: false });
    }
  });
});
