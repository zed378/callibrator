/**
 * P24-09a — the invitation of an imported user (ADR-139 § 3 – § 4 and Am. 1):
 *  - two tenants: another tenant's account answers 404 on all three routes, identical to a missing
 *    one, and nothing is written; the owning tenant reaches it;
 *  - not facility-accessible: a facility-bound administrator is refused before a parameter is read;
 *  - issue: only for an account awaiting its invitation, only once the operator has opened the
 *    tenant (`upstream_invitations_open`), a shared account only with the person's name; the token
 *    goes out in the e-mail only and is stored as its SHA-256; issuing again revokes the live one
 *    (`reissued`); revoke; one audit row per act, never the token;
 *  - acceptance through the PUBLIC route: the password set, the address verified, both flags cleared,
 *    the invitation spent — and every refusal the one 400 of P10-15.
 *
 * @two-tenant api/user.route.ts GET /:userId/invitation
 * @two-tenant api/user.route.ts POST /:userId/invitation
 * @two-tenant api/user.route.ts DELETE /:userId/invitation
 *
 * REAL: both routers, the gates, the controllers, the services, the models and the tenant + facility
 * hooks over memoryDb. Doubled: the e-mail queue (to read the link), bcrypt's cost. Synthetic data.
 */
import { createHash } from "node:crypto";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type { Principal } from "../fixtures/routeClient";
import type * as UserRoute from "../../routes/api/user.route";
import type * as RateLimiter from "../../services/rateLimiter.redis.service";
import type * as Bcrypt from "bcryptjs";
import type * as InvitationService from "../../services/userInvitation.service";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import { ROLE_IDS } from "../../constants/roleConstants";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/emailQueue.service", () => {
  const api = { queueNotificationEmail: jest.fn(() => Promise.resolve(true)), queueOtpEmail: jest.fn(), queueActivationEmail: jest.fn() };
  return { __esModule: true, default: api, ...api };
});
jest.mock("bcryptjs", () => {
  const real = jest.requireActual<typeof Bcrypt>("bcryptjs");
  return { ...real, hash: (plain: string) => real.hash(plain, 4) };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const users = jest.requireActual<typeof UserRoute>("../../routes/api/user.route");
const rateLimiter = jest.requireActual<typeof RateLimiter>("../../services/rateLimiter.redis.service");
const bcrypt = jest.requireActual<typeof Bcrypt>("bcryptjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the public router, loaded after the mocks
const publicAuth = require("../../routes/api/authPublic.route") as unknown;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the doubled queue, to read the link
const emailQueue = require("../../services/emailQueue.service") as { queueNotificationEmail: jest.Mock };

const ROUTE_FILE = "api/user.route.ts";
const BASE = "/api/v1/users";
const TARGET = "cccccccc-0000-4000-8000-0000000000a1";
const NAMED = "cccccccc-0000-4000-8000-0000000000a2";
const ACCEPTED = "cccccccc-0000-4000-8000-0000000000a3";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const PASSWORD = "Str0ng-Passw0rd!";
const OPEN = { settings: { upstream_invitations_open: true } };

interface Res {
  status: number;
  body: { data?: Record<string, unknown> | null; message?: string; code?: string };
}

let ctx: SuiteContext;
let tenantA = "";

const seedImported = (id: string, extra: Record<string, unknown> = {}): void => {
  mdb.seed("User", {
    id,
    tenantId: tenantA,
    username: `rs${id.slice(-2)}`,
    email: `rs${id.slice(-2)}@example.test`,
    password: "unusable",
    firstName: `rs${id.slice(-2)}`,
    lastName: "",
    roleId: ROLE_IDS.TECHNICIAN,
    status: "ACTIVE",
    isActive: true,
    isEmailVerified: false,
    mustChangePassword: true,
    awaitingInvitation: true,
    ...extra,
  });
};

const liveInvitation = (userId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "1a000000-0000-4000-8000-000000000001",
  tenantId: tenantA,
  userId,
  tokenHash: "a".repeat(64),
  issuedBy: ctx.owner.id,
  createdAt: new Date("2026-10-20T00:00:00Z"),
  expiresAt: new Date(Date.now() + 86_400_000),
  acceptedAt: null,
  revokedAt: null,
  revokedBy: null,
  revokedReason: null,
  ...extra,
});

const build = (tenantSettings: Record<string, unknown> = OPEN): void => {
  mdb.reset();
  grantAllMenus();
  (rateLimiter as unknown as { clearMemoryStore: () => void }).clearMemoryStore();
  emailQueue.queueNotificationEmail.mockClear();
  emailQueue.queueNotificationEmail.mockImplementation(() => Promise.resolve(true));
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  tenantA = fx.tenantA.id;
  seedTenants(mdb, fx, [ctx.owner, ctx.other], { a: tenantSettings, b: OPEN });
  mdb.seed("Role", { id: ROLE_IDS.TECHNICIAN, name: "TECHNICIAN", status: "active", roleLevel: 3 });
  seedImported(TARGET);
  seedImported(NAMED, { firstName: "Dewi", lastName: "Lestari" });
  seedImported(ACCEPTED, { firstName: "Budi", lastName: "Santoso", awaitingInvitation: false });
};

beforeEach(() => {
  build();
});

const send = (who: Principal | null, method: string, path: string, body?: Record<string, unknown>): Promise<Res> => {
  as(who);
  return call(users, method, path, { routeFile: ROUTE_FILE, baseUrl: BASE, ...(body ? { body } : {}) }) as Promise<Res>;
};
const issue = (userId: string, body: Record<string, unknown> = {}): Promise<Res> => send(ctx.owner, "POST", `/${userId}/invitation`, body);
const accept = (token: string, password = PASSWORD): Promise<Res> => {
  as(null);
  return call(publicAuth, "POST", "/invitation/accept", { body: { token, password } }) as Promise<Res>;
};
const invitations = (): Record<string, unknown>[] => mdb.rows("UserInvitation");
const userRow = (id: string): Record<string, unknown> => mdb.rows("User").find((u) => u["id"] === id) as Record<string, unknown>;
const audits = (operation: string): Record<string, unknown>[] =>
  mdb.rows("AuditLog").filter((r) => (r["changes"] as { operation?: string } | null)?.operation === operation);
const sha = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
/** The token, as the e-mail carries it. */
const emailedToken = (call = -1): string => {
  const calls = emailQueue.queueNotificationEmail.mock.calls as unknown as [{ actionUrl: string }][];
  const entry = calls.at(call)?.[0];
  return new URL(entry?.actionUrl ?? "http://x/invitation?token=").searchParams.get("token") ?? "";
};

twoTenantSuite({
  module: "imported user invitation (P24-09a)",
  router: users,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:userId/invitation", method: "GET", path: (id) => `/${id}/invitation`, id: () => NAMED, ownerStatus: 200 },
    {
      key: "POST /:userId/invitation",
      method: "POST",
      path: (id) => `/${id}/invitation`,
      id: () => NAMED,
      ownerStatus: 201,
      writes: ["UserInvitation", "AuditLog"],
    },
    {
      key: "DELETE /:userId/invitation",
      method: "DELETE",
      path: (id) => `/${id}/invitation`,
      id: () => NAMED,
      before: () => mdb.seed("UserInvitation", liveInvitation(NAMED)),
      ownerStatus: 200,
      writes: ["UserInvitation", "AuditLog"],
    },
  ],
});

describe("not facility-accessible", () => {
  it.each([["GET"], ["POST"], ["DELETE"]])("%s: a facility-bound administrator is refused before the parameters are read", async (method) => {
    const bound = { ...ctx.owner, clientFacilityId: F1 } as unknown as Principal;
    for (const id of [NAMED, "not-a-uuid"]) {
      const res = await send(bound, method, `/${id}/invitation`, {});
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FACILITY_ROUTE_REFUSED");
    }
    expect(invitations()).toEqual([]);
  });
});

describe("issue", () => {
  it("a named account: 201 without the token; the hash stored; the e-mail carries the link; one audit row, never the token", async () => {
    const res = await issue(NAMED);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body.data ?? {}).sort()).toEqual(["emailQueued", "expiresAt", "issuedAt"]);
    expect(res.body.data?.["emailQueued"]).toBe(true);
    const token = emailedToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invitations()).toEqual([expect.objectContaining({ userId: NAMED, tokenHash: sha(token), issuedBy: ctx.owner.id, acceptedAt: null, revokedAt: null })]);
    const expires = (invitations()[0]?.["expiresAt"] as Date).getTime() - (invitations()[0]?.["createdAt"] as Date).getTime();
    expect(expires).toBe(7 * 24 * 60 * 60 * 1000);
    expect(audits("ISSUE_USER_INVITATION")).toHaveLength(1);
    expect(JSON.stringify(mdb.dump())).not.toContain(token);
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it("a shared account needs the person's name: 400 INVITATION_PERSON_REQUIRED without it, nothing written; with it, the names are written and audited", async () => {
    const before = mdb.dump();
    const refused = await issue(TARGET);
    expect([refused.status, refused.body.code]).toEqual([400, "INVITATION_PERSON_REQUIRED"]);
    expect(mdb.dump()).toEqual(before);

    const res = await issue(TARGET, { firstName: "Siti", lastName: "Rahma" });
    expect(res.status).toBe(201);
    expect(userRow(TARGET)).toMatchObject({ firstName: "Siti", lastName: "Rahma" });
    expect(audits("ISSUE_USER_INVITATION")[0]?.["changes"]).toMatchObject({
      renamed: { before: { firstName: "rsa1", lastName: "" }, after: { firstName: "Siti", lastName: "Rahma" } },
    });
  });

  it("one name without the other is a 400 about the body", async () => {
    const res = await issue(NAMED, { firstName: "Dewi" });
    expect(res.status).toBe(400);
    expect(invitations()).toEqual([]);
  });

  it.each([
    ["an account that does not await an invitation", ACCEPTED],
    ["an inactive account", "cccccccc-0000-4000-8000-0000000000a9"],
  ])("refuses %s (409 INVITATION_NOT_APPLICABLE), nothing written", async (_case, id) => {
    seedImported("cccccccc-0000-4000-8000-0000000000a9", { firstName: "Ina", lastName: "Putri", isActive: false });
    const before = mdb.dump();
    const res = await issue(id);
    expect([res.status, res.body.code]).toEqual([409, "INVITATION_NOT_APPLICABLE"]);
    expect(mdb.dump()).toEqual(before);
  });

  it("refuses until the operator opens the tenant (409 PRE_INVITATION_GATE_OPEN); only a true flag opens it", async () => {
    for (const settings of [null, {}, { upstream_invitations_open: "true" }, { upstream_invitations_open: false }]) {
      build({ settings });
      const before = mdb.dump();
      const res = await issue(NAMED);
      expect([res.status, res.body.code]).toEqual([409, "PRE_INVITATION_GATE_OPEN"]);
      expect(mdb.dump()).toEqual(before);
      expect(emailQueue.queueNotificationEmail).not.toHaveBeenCalled();
    }
  });

  it("issuing again revokes the live one (`reissued`): the old link stops working, the new one works", async () => {
    await issue(NAMED);
    const first = emailedToken();
    await issue(NAMED);
    const second = emailedToken();
    expect(invitations().map((i) => [i["revokedReason"], i["revokedBy"]])).toEqual([
      ["reissued", ctx.owner.id],
      [null, null],
    ]);
    expect(audits("ISSUE_USER_INVITATION")[1]?.["changes"]).toMatchObject({ reissued: { id: invitations()[0]?.["id"] } });
    expect((await accept(first)).status).toBe(400);
    expect((await accept(second)).status).toBe(200);
  });

  it("a queue failure still issues (the administrator may issue again)", async () => {
    emailQueue.queueNotificationEmail.mockImplementation(() => Promise.reject(new Error("queue down")));
    const res = await issue(NAMED);
    expect(res.status).toBe(201);
    expect(res.body.data?.["emailQueued"]).toBe(false);
    expect(invitations()).toHaveLength(1);
  });
});

describe("revoke and state", () => {
  it("revokes the live invitation; without one, 409 INVITATION_NONE", async () => {
    await issue(NAMED);
    const token = emailedToken();
    const res = await send(ctx.owner, "DELETE", `/${NAMED}/invitation`);
    expect(res.status).toBe(200);
    expect(invitations()[0]).toMatchObject({ revokedReason: "revoked", revokedBy: ctx.owner.id });
    expect(audits("REVOKE_USER_INVITATION")).toHaveLength(1);
    expect((await accept(token)).status).toBe(400);
    const again = await send(ctx.owner, "DELETE", `/${NAMED}/invitation`);
    expect([again.status, again.body.code]).toEqual([409, "INVITATION_NONE"]);
  });

  it("the state: awaiting, open, person required, the live invitation, the first issue — never the token or its hash", async () => {
    const before = await send(ctx.owner, "GET", `/${TARGET}/invitation`);
    expect(before.body.data).toEqual({
      awaitingInvitation: true,
      invitationsOpen: true,
      personRequired: true,
      live: null,
      firstIssuedAt: null,
      acceptedAt: null,
    });
    await issue(NAMED);
    const after = await send(ctx.owner, "GET", `/${NAMED}/invitation`);
    expect(after.body.data).toMatchObject({ awaitingInvitation: true, personRequired: false, live: { expired: false } });
    expect(typeof after.body.data?.["firstIssuedAt"]).toBe("string");
    expect(JSON.stringify(after.body)).not.toContain(String(invitations()[0]?.["tokenHash"]));
  });
});

describe("acceptance through the public route (ADR-139 § 4)", () => {
  it("sets the password, verifies the address, clears both flags, spends the invitation, one audit row; then signs in with it", async () => {
    await issue(NAMED);
    const res = await accept(emailedToken());
    expect(res.status).toBe(200);
    const user = userRow(NAMED);
    expect(user).toMatchObject({ isEmailVerified: true, mustChangePassword: false, awaitingInvitation: false });
    expect(await bcrypt.compare(PASSWORD, String(user["password"]))).toBe(true);
    expect(invitations()[0]?.["acceptedAt"]).toBeInstanceOf(Date);
    expect(audits("INVITATION_ACCEPTED")).toEqual([expect.objectContaining({ resourceId: NAMED, userId: NAMED })]);
  });

  it("every refusal is the one 400: spent, expired, account no longer awaiting or inactive, unknown", async () => {
    await issue(NAMED);
    const token = emailedToken();
    expect((await accept(token)).status).toBe(200);
    const spent = await accept(token);
    expect([spent.status, spent.body.message]).toEqual([400, "This invitation link is invalid or has expired"]);

    build();
    mdb.seed("UserInvitation", liveInvitation(NAMED, { tokenHash: sha("E".repeat(43)), expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 10_000) }));
    expect((await accept("E".repeat(43))).body.message).toBe("This invitation link is invalid or has expired");

    build();
    mdb.seed("UserInvitation", liveInvitation(ACCEPTED, { tokenHash: sha("F".repeat(43)) }));
    expect((await accept("F".repeat(43))).body.message).toBe("This invitation link is invalid or has expired");

    build();
    seedImported("cccccccc-0000-4000-8000-0000000000b1", { firstName: "Ani", lastName: "Wijaya", isActive: false });
    mdb.seed("UserInvitation", liveInvitation("cccccccc-0000-4000-8000-0000000000b1", { tokenHash: sha("G".repeat(43)) }));
    expect((await accept("G".repeat(43))).body.message).toBe("This invitation link is invalid or has expired");
    expect(userRow("cccccccc-0000-4000-8000-0000000000b1")).toMatchObject({ password: "unusable", awaitingInvitation: true });

    const unknown = await accept("H".repeat(43));
    expect([unknown.status, unknown.body.message]).toEqual([400, "This invitation link is invalid or has expired"]);
  });
});

describe("the service's own checks (behind the route gates)", () => {
  const svc = jest.requireActual<typeof InvitationService>("../../services/userInvitation.service");
  const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");
  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantStorage.run({ tenantId: ctx.owner.tenantId as never, isSuperAdmin: false, isSystemTask: false, userId: ctx.owner.id }, fn);
  const MISSING = "cccccccc-0000-4000-8000-0000000000ff";

  it("an account out of view is the 404 in every function (checkTenant answers first on the routes)", async () => {
    await expect(inTenant(() => svc.getInvitationState(MISSING))).rejects.toMatchObject({ status: 404, message: "User not found" });
    await expect(inTenant(() => svc.issueInvitation(ctx.owner.tenantId as never, { userId: MISSING }, { userId: ctx.owner.id }))).rejects.toMatchObject({ status: 404 });
    await expect(inTenant(() => svc.revokeInvitation(ctx.owner.tenantId as never, MISSING, { userId: ctx.owner.id }))).rejects.toMatchObject({ status: 404 });
  });

  it("a tenant that is not there is never open", async () => {
    expect(await inTenant(() => svc.openTenantName("eeeeeeee-0000-4000-8000-0000000000ee"))).toBeNull();
    expect(await inTenant(() => svc.openTenantName(ctx.owner.tenantId))).toEqual(expect.any(String));
  });

  it("the state shows an issuer from outside the tenant as platform support, and the acceptance once accepted", async () => {
    mdb.seed("UserInvitation", liveInvitation(NAMED, { issuedBy: "eeeeeeee-0000-4000-8000-0000000000e1" }));
    const live = await send(ctx.owner, "GET", `/${NAMED}/invitation`);
    expect(live.body.data?.["live"]).toMatchObject({ issuedBy: { name: "Platform support" } });
    build();
    await issue(NAMED);
    expect((await accept(emailedToken())).status).toBe(200);
    const done = await send(ctx.owner, "GET", `/${NAMED}/invitation`);
    expect(done.body.data).toMatchObject({ awaitingInvitation: false, live: null });
    expect(typeof done.body.data?.["acceptedAt"]).toBe("string");
  });

  it("no person, no invitation: 403 (the routes refuse API keys first)", async () => {
    await expect(inTenant(() => svc.issueInvitation(ctx.owner.tenantId as never, { userId: NAMED }, {}))).rejects.toMatchObject({ status: 403 });
    await expect(inTenant(() => svc.revokeInvitation(ctx.owner.tenantId as never, NAMED, {}))).rejects.toMatchObject({ status: 403 });
    expect(invitations()).toEqual([]);
  });
});
