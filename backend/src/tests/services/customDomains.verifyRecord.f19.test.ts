/**
 * F-19 — the verify answer tells the tenant which DNS record to publish, and
 * it said `type: "CNAME"` while the check (checkDnsTxtRecord) resolves a TXT
 * record at `_domain_verify.<domain>`. A tenant who followed it could never
 * verify. The instruction must be the record the check reads.
 *
 * REAL router, controller, service and audit on the REAL models and tenant
 * hooks (fixtures/memoryDb). Doubled: DNS resolution.
 */
import dns from "dns";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as CustomDomainsRoute from "../../routes/api/customDomains.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof CustomDomainsRoute>("../../routes/api/customDomains.route");

const DOMAIN = "c1f19000-0000-4000-8000-0000000000d1";
const TOKEN = "callibrator-verify=f19";
// eslint-disable-next-line no-restricted-properties -- customDomains.service.js reads CUSTOM_DOMAINS_ENABLED raw at call time; the test switches the feature on and restores it
const env = process.env;
const previousFlag = env["CUSTOM_DOMAINS_ENABLED"];

interface VerifyBody {
  data: { verified: boolean; dnsRecord: { type: string; name: string; value: string } };
}

beforeAll(() => {
  env["CUSTOM_DOMAINS_ENABLED"] = "true";
});
afterAll(() => {
  if (previousFlag === undefined) {
    delete env["CUSTOM_DOMAINS_ENABLED"];
  } else {
    env["CUSTOM_DOMAINS_ENABLED"] = previousFlag;
  }
});

let resolveTxt: jest.SpyInstance;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  const admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  seedTenants(mdb, fx, [admin]);
  mdb.seed("CustomDomain", {
    id: DOMAIN,
    tenantId: fx.tenantA.id,
    domain: "calibration.hospital-a.example.com",
    domainType: "custom",
    status: "pending_verification",
    isDefault: false,
    sslEnabled: false,
    verificationToken: TOKEN,
  });
  as(admin);
  resolveTxt = jest.spyOn(dns.promises, "resolveTxt");
});

afterEach(() => {
  resolveTxt.mockRestore();
});

describe("F-19 — verify names the record the check reads", () => {
  it("a failed check tells the tenant to publish a TXT record, at the name the check looked up", async () => {
    resolveTxt.mockRejectedValue(Object.assign(new Error("queryTxt ENOTFOUND"), { code: "ENOTFOUND" }));
    const res = await call(router, "POST", `/domains/${DOMAIN}/verify`);

    expect(res.status).toBe(200);
    const { dnsRecord, verified } = (res.body as VerifyBody).data;
    expect(verified).toBe(false);
    expect(dnsRecord).toEqual({
      type: "TXT",
      name: "_domain_verify.calibration.hospital-a.example.com",
      value: TOKEN,
    });
    expect(resolveTxt).toHaveBeenCalledWith(dnsRecord.name);
  });

  it("publishing exactly that record verifies the domain", async () => {
    resolveTxt.mockResolvedValue([[TOKEN]]);
    const res = await call(router, "POST", `/domains/${DOMAIN}/verify`);

    const { dnsRecord, verified } = (res.body as VerifyBody).data;
    expect(verified).toBe(true);
    expect(dnsRecord.type).toBe("TXT");
  });
});
