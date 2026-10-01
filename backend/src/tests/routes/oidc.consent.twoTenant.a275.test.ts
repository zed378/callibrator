/**
 * A-275 (ADR-094) — the OIDC consent screen and decision belong to the
 * client's tenant.
 *
 * A request staged by `GET /oidc/authorize` carries its client's tenant. Only
 * a signed-in user of THAT tenant may read it (`GET /authorize/request/:id`)
 * or decide it (`POST /authorize/decision`): the code a decision mints names
 * the user as `sub` and the client's tenant as `tenant_id`. Another tenant's
 * request is the same 404 as one that does not exist, it is NOT consumed (its
 * own users can still decide it), no code is minted and nothing is written.
 * A decision writes one audit row in the client's tenant, inside the
 * transaction that mints the code.
 *
 * REAL router (public /authorize, auth, the consent routes), controller and
 * oidcProvider service on the REAL models and tenant hooks (fixtures/memoryDb);
 * Redis is an in-memory map, because the staged request and the code live
 * there.
 *
 * @two-tenant api/oidc.route.js GET /authorize/request/:requestId
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TwoTenantWorld } from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/oidc.route";

/** An asymmetric matcher, typed so it can sit inside an object literal. */
const containing = (fields: Record<string, unknown>): unknown =>
  expect.objectContaining(fields) as unknown;

jest.mock("../../config", () => ({
  db: jest
    .requireActual<typeof MemoryDbModule>("../fixtures/memoryDb")
    .memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mockRedis = new Map<string, unknown>();
const mockRedisSetResult = { value: true };
jest.mock("../../services/redis.service", () => ({
  get: (key: string) =>
    Promise.resolve(mockRedis.has(key) ? mockRedis.get(key) : null),
  set: (key: string, value: unknown) => {
    if (!mockRedisSetResult.value) {
      return Promise.resolve(false);
    }
    mockRedis.set(key, JSON.parse(JSON.stringify(value)) as unknown);
    return Promise.resolve(true);
  },
  del: (key: string) => Promise.resolve(mockRedis.delete(key)),
}));

const mdb = jest
  .requireActual<typeof MemoryDbModule>("../fixtures/memoryDb")
  .memoryDb();
const { twoTenants, seedTenants, as, call } = jest.requireActual<
  typeof RouteClient
>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>(
  "../../routes/api/oidc.route",
);

const CLIENT_ID = "0c1e0000-0000-4000-8000-00000000c11e";
const REDIRECT = "https://pacs.hospital-a.example/callback";
const MISSING_REQUEST = "bm90LWEtcmVxdWVzdC10aGF0LWV4aXN0cy0xMjM0";

let fx: TwoTenantWorld;
let ownerA: Principal;
let userB: Principal;

/** Stage a request for tenant A's client the way a browser does, and return its id. */
const stage = async (): Promise<string> => {
  as(null);
  const res = await call(router, "GET", "/authorize", {
    query: {
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: "openid email",
      state: "xyz",
    },
  });
  expect(res.status).toBe(302);
  const location = String(res.headers["location"]);
  return decodeURIComponent(location.split("request=")[1] ?? "");
};

const codes = (): string[] =>
  [...mockRedis.keys()].filter((k) => k.startsWith("oidc:code:"));
const auditRows = (): Record<string, unknown>[] => mdb.rows("AuditLog");

beforeEach(() => {
  mdb.reset();
  mockRedis.clear();
  mockRedisSetResult.value = true;
  fx = twoTenants();
  ownerA = fx.principal(fx.tenantA, "USER");
  userB = fx.principal(fx.tenantB, "USER");
  seedTenants(mdb, fx, [ownerA, userB]);
  mdb.seed("TenantSettings", {
    id: "5e770000-0000-4000-8000-000000000001",
    tenantId: fx.tenantA.id,
    key: `oidc_rp_${CLIENT_ID}`,
    value: JSON.stringify({
      clientId: CLIENT_ID,
      clientSecretHash: "00",
      name: "PACS viewer",
      redirectUris: [REDIRECT],
      scopes: ["openid", "email"],
      grantTypes: ["authorization_code"],
    }),
  });
});

describe("A-275 — GET /authorize/request/:requestId", () => {
  it("another tenant's request answers 404, identical to one that does not exist, and stays staged", async () => {
    const requestId = await stage();

    as(userB);
    const foreign = await call(
      router,
      "GET",
      `/authorize/request/${requestId}`,
    );
    const missing = await call(
      router,
      "GET",
      `/authorize/request/${MISSING_REQUEST}`,
    );

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(mockRedis.has(`oidc:authreq:${requestId}`)).toBe(true);
  });

  it("the client's own tenant reads it", async () => {
    const requestId = await stage();

    as(ownerA);
    const res = await call(router, "GET", `/authorize/request/${requestId}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: { clientName: "PACS viewer", redirectUri: REDIRECT },
    });
  });
});

describe("A-275 — POST /authorize/decision", () => {
  it("another tenant's user approving answers 404, identical to a missing request; no code, no write, still staged", async () => {
    const requestId = await stage();
    const before = mdb.dump();

    as(userB);
    const foreign = await call(router, "POST", "/authorize/decision", {
      body: { request: requestId, approve: true },
    });
    const missing = await call(router, "POST", "/authorize/decision", {
      body: { request: MISSING_REQUEST, approve: true },
    });

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(codes()).toEqual([]);
    expect(mdb.dump()).toEqual(before);
    expect(mdb.committed()).toEqual([]);
    // Not consumed: tenant A's own user can still decide it.
    expect(mockRedis.has(`oidc:authreq:${requestId}`)).toBe(true);
  });

  it("the super admin of another home tenant is refused the same way (the tokens are about the account)", async () => {
    // fx.superAdmin's home tenant is A; stage a request for a client in B.
    mdb.seed("TenantSettings", {
      id: "5e770000-0000-4000-8000-000000000002",
      tenantId: fx.tenantB.id,
      key: "oidc_rp_0c1e0000-0000-4000-8000-00000000c22e",
      value: JSON.stringify({
        clientId: "0c1e0000-0000-4000-8000-00000000c22e",
        name: "B app",
        redirectUris: ["https://b.example/cb"],
      }),
    });
    as(null);
    const staged = await call(router, "GET", "/authorize", {
      query: {
        client_id: "0c1e0000-0000-4000-8000-00000000c22e",
        redirect_uri: "https://b.example/cb",
        response_type: "code",
      },
    });
    const requestId = decodeURIComponent(
      String(staged.headers["location"]).split("request=")[1] ?? "",
    );

    as(fx.superAdmin, { tenantId: fx.tenantB.id });
    const res = await call(router, "POST", "/authorize/decision", {
      body: { request: requestId, approve: true },
    });

    expect(res.status).toBe(404);
    expect(codes()).toEqual([]);
  });

  it("the client's own tenant approves: a code for that user, and one APPROVE row in the same transaction", async () => {
    const requestId = await stage();

    as(ownerA);
    const res = await call(router, "POST", "/authorize/decision", {
      body: { request: requestId, approve: true },
    });

    expect(res.status).toBe(200);
    const redirectTo = (res.body as { data: { redirectTo: string } }).data
      .redirectTo;
    expect(redirectTo).toMatch(
      /^https:\/\/pacs\.hospital-a\.example\/callback\?state=xyz&code=/,
    );
    expect(codes()).toHaveLength(1);
    expect(mockRedis.get(codes()[0] ?? "")).toMatchObject({
      userId: ownerA.id,
      tenantId: fx.tenantA.id,
    });

    expect(auditRows()).toEqual([
      expect.objectContaining({
        tenantId: fx.tenantA.id,
        userId: ownerA.id,
        action: "APPROVE",
        resourceType: "OidcClient",
        resourceId: CLIENT_ID,
        changes: containing({
          operation: "OIDC_AUTHORIZATION_DECISION",
          outcome: "approved",
        }),
      }),
    ]);
    const audit = mdb.committed().filter((w) => w.model === "AuditLog");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.tx).not.toBeNull();
  });

  it("a denial is recorded too (UPDATE, outcome denied) and redirects with access_denied", async () => {
    const requestId = await stage();

    as(ownerA);
    const res = await call(router, "POST", "/authorize/decision", {
      body: { request: requestId, approve: false },
    });

    expect(res.status).toBe(200);
    expect(
      (res.body as { data: { redirectTo: string } }).data.redirectTo,
    ).toContain("error=access_denied");
    expect(codes()).toEqual([]);
    expect(auditRows()).toEqual([
      expect.objectContaining({
        action: "UPDATE",
        changes: containing({ outcome: "denied" }),
      }),
    ]);
  });

  it("a code Redis would not store rolls the APPROVE row back and answers 503", async () => {
    const requestId = await stage();
    mockRedisSetResult.value = false;

    as(ownerA);
    const res = await call(router, "POST", "/authorize/decision", {
      body: { request: requestId, approve: true },
    });

    expect(res.status).toBe(503);
    expect(auditRows()).toEqual([]);
  });
});
