/**
 * A-176 — the server-side calls to TENANT-CHOSEN URLs go through the SSRF
 * guard (DAST 2026-09-29 reconfirmed them open).
 *
 *  - oidcJwks#discover  GET  <oidc_authority>/.well-known/openid-configuration
 *  - oidcJwks#verifyIdToken / fetchJwks  GET  the IdP's published jwks_uri
 *  - oidcJwks#verifyOidcCallback  POST  the IdP's published token_endpoint
 *  - ai.service  POST <ai_base_url>/chat/completions | /embeddings
 *  - storage/s3.driver  a tenant endpoint: the SDK connects through the
 *    pinned-lookup agents
 *
 * Before A-176 each of the first four called axios with the URL as given —
 * no host check, default redirect-following — so a tenant admin could make
 * the server fetch http://169.254.169.254/… . The refusals below are asserted
 * on axios never being called, not only on the answer.
 */
import dns from "dns";
import http from "http";
import type { AddressInfo } from "net";
import axios from "axios";
import { environment } from "../../config/env";
import { ssrfSafeLookup } from "../../utils/ssrf.util";

const mockSettings: { rows: { key: string; value: string }[] } = { rows: [] };
jest.mock("../../models", () => ({
  TenantSettings: { findAll: jest.fn(() => Promise.resolve(mockSettings.rows)) },
}));

const mockS3ClientCtor = jest.fn();
jest.mock("@aws-sdk/client-s3", () => ({
  // eslint-disable-next-line prefer-arrow-callback -- `new S3Client()` needs a constructible function
  S3Client: jest.fn(function S3Client(config: unknown) {
    mockS3ClientCtor(config);
  }),
}));

interface OidcJwks {
  discover(settings: Record<string, unknown>): Promise<Record<string, unknown>>;
  verifyIdToken(idToken: string, issuer: string, clientId: string, opts?: { jwksUri?: string }): Promise<unknown>;
  verifyOidcCallback(
    code: string,
    settings: Record<string, unknown>,
    redirectUri: string,
    flow: { nonce: string; codeVerifier: string },
  ): Promise<unknown>;
  clearCache(): void;
}
interface AiService {
  generateEmbedding(tenantId: string, text: string): Promise<number[] | null>;
  processCertificateOcr(tenantId: string, buf: Buffer, mime: string): Promise<unknown>;
  queryDocuments(tenantId: string, q: string): Promise<unknown>;
}
type S3DriverCtor = new (config: Record<string, unknown>) => unknown;

const oidcJwks = jest.requireActual<OidcJwks>("../../services/oidcJwks");
const ai = jest.requireActual<AiService>("../../services/ai.service");
const S3Driver = jest.requireActual<S3DriverCtor>("../../services/storage/s3.driver");

const penv = environment();
const saved = { nodeEnv: penv["NODE_ENV"], allow: penv["SSRF_DEV_ALLOW_HOSTS"] };
const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    Reflect.deleteProperty(penv, name);
  } else {
    penv[name] = value;
  }
};

/** A token whose header passes the algorithm check, so the JWKS fetch is reached. */
const RS256_TOKEN = `${Buffer.from('{"alg":"RS256","kid":"k1","typ":"JWT"}').toString("base64url")}.${Buffer.from(
  '{"sub":"x"}',
).toString("base64url")}.c2ln`;

let getSpy: jest.SpyInstance;
let postSpy: jest.SpyInstance;

beforeEach(() => {
  oidcJwks.clearCache();
  mockSettings.rows = [];
  mockS3ClientCtor.mockClear();
  getSpy = jest.spyOn(axios, "get");
  postSpy = jest.spyOn(axios, "post");
});

afterEach(() => {
  restore("NODE_ENV", saved.nodeEnv);
  restore("SSRF_DEV_ALLOW_HOSTS", saved.allow);
  jest.restoreAllMocks();
});

describe("oidcJwks — the OIDC authority and what its IdP publishes (A-176)", () => {
  it.each([
    "http://169.254.169.254/latest",
    "http://10.0.0.7/realms/x",
    "http://localhost:8080/realms/x",
    "http://[::ffff:a9fe:a9fe]/",
  ])("discover refuses authority %s with a 400 and fetches nothing", async (authority) => {
    await expect(oidcJwks.discover({ oidc_authority: authority })).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/^OIDC authority: URL host/) as unknown,
    });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("discover refuses plain http in production", async () => {
    penv["NODE_ENV"] = "production";
    await expect(oidcJwks.discover({ oidc_authority: "http://idp.example.com" })).rejects.toMatchObject({
      status: 400,
      message: "OIDC authority must use https",
    });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("discover of a public authority goes out through the guarded options", async () => {
    getSpy.mockResolvedValue({
      data: {
        issuer: "https://idp.example.com",
        authorization_endpoint: "https://idp.example.com/auth",
        token_endpoint: "https://idp.example.com/token",
        jwks_uri: "https://idp.example.com/keys",
      },
    });
    await oidcJwks.discover({ oidc_authority: "https://idp.example.com" });
    expect(getSpy).toHaveBeenCalledWith(
      "https://idp.example.com/.well-known/openid-configuration",
      expect.objectContaining({ maxRedirects: 0, proxy: false, timeout: 10000, maxContentLength: 2097152 }),
    );
    const options = getSpy.mock.calls[0] as [string, { httpsAgent: { options: { lookup: unknown } } }];
    expect(options[1].httpsAgent.options.lookup).toBe(ssrfSafeLookup);
  });

  it("a hostname that RESOLVES internally is refused at connect time (real axios)", async () => {
    getSpy.mockRestore();
    // dns.lookup's overloads cannot be spied with a typed implementation.
    jest.spyOn(dns, "lookup").mockImplementation(((
      _h: string,
      _o: unknown,
      cb: (e: null, a: dns.LookupAddress[]) => void,
    ) => {
      cb(null, [{ address: "169.254.169.254", family: 4 }]);
    }) as unknown as typeof dns.lookup);
    await expect(oidcJwks.discover({ oidc_authority: "https://idp.rebind.example" })).rejects.toMatchObject({
      status: 502,
    });
  });

  it("a published jwks_uri pointing inside is refused before any fetch", async () => {
    await expect(
      oidcJwks.verifyIdToken(RS256_TOKEN, "https://idp.example.com", "client", {
        jwksUri: "http://169.254.169.254/keys",
      }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^OIDC JWKS URL: /) as unknown });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("the JWKS fetch of a public jwks_uri uses the guarded options", async () => {
    getSpy.mockResolvedValue({ data: { keys: [{ kid: "other" }] } });
    await expect(
      oidcJwks.verifyIdToken(RS256_TOKEN, "https://idp.example.com", "client", {
        jwksUri: "https://idp.example.com/keys",
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(getSpy).toHaveBeenCalledWith(
      "https://idp.example.com/keys",
      expect.objectContaining({ maxRedirects: 0, timeout: 10000 }),
    );
  });

  it("a published token_endpoint pointing inside is refused before the code is sent", async () => {
    getSpy.mockResolvedValue({
      data: {
        issuer: "https://idp.example.com",
        authorization_endpoint: "https://idp.example.com/auth",
        token_endpoint: "http://10.0.0.9/token",
        jwks_uri: "https://idp.example.com/keys",
      },
    });
    await expect(
      oidcJwks.verifyOidcCallback(
        "code",
        { oidc_authority: "https://idp.example.com", oidc_client_id: "c" },
        "https://app/cb",
        { nonce: "n", codeVerifier: "v" },
      ),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^OIDC token endpoint: /) as unknown });
    expect(postSpy).not.toHaveBeenCalled();
  });

  describe("a redirecting IdP (real socket, loopback development-allowed)", () => {
    let server: http.Server;
    let base = "";
    let hits: string[] = [];

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        hits.push(req.url ?? "");
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" });
        res.end();
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    });

    it("discovery does not follow the redirect: 502, one request", async () => {
      getSpy.mockRestore();
      hits = [];
      penv["SSRF_DEV_ALLOW_HOSTS"] = "127.0.0.1";
      await expect(oidcJwks.discover({ oidc_authority: base })).rejects.toMatchObject({ status: 502 });
      expect(hits).toEqual(["/.well-known/openid-configuration"]);
    });
  });
});

describe("ai.service — the tenant's ai_base_url (A-176)", () => {
  const tenantUrl = (url: string): void => {
    mockSettings.rows = [
      { key: "ai_api_key", value: "sk-test" },
      { key: "ai_base_url", value: url },
    ];
  };

  it.each(["http://169.254.169.254/v1", "http://127.0.0.1:11434/v1", "http://[fd00::5]/v1"])(
    "an internal ai_base_url (%s) is never called",
    async (url) => {
      tenantUrl(url);
      await expect(ai.generateEmbedding("t1", "text")).resolves.toBeNull();
      await expect(ai.processCertificateOcr("t1", Buffer.from("x"), "image/png")).resolves.toBeNull();
      expect(postSpy).not.toHaveBeenCalled();
    },
  );

  it("a public ai_base_url is called through the guarded options", async () => {
    tenantUrl("https://llm.example.com/v1");
    postSpy.mockResolvedValue({ data: { data: [{ embedding: [0.5] }] } });
    await expect(ai.generateEmbedding("t1", "text")).resolves.toEqual([0.5]);
    expect(postSpy).toHaveBeenCalledWith(
      "https://llm.example.com/v1/embeddings",
      expect.anything(),
      expect.objectContaining({ maxRedirects: 0, proxy: false, timeout: 60000 }),
    );
  });

  it("the operator's own base URL (env / default) is not the tenant's: a plain timeout", async () => {
    mockSettings.rows = [{ key: "ai_api_key", value: "sk-test" }];
    postSpy.mockResolvedValue({ data: { data: [{ embedding: [1] }] } });
    await ai.generateEmbedding("t1", "text");
    const options = (postSpy.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(options["timeout"]).toBe(60000);
    expect(options["maxRedirects"]).toBeUndefined();
  });

  it("queryDocuments' answer call is guarded too", async () => {
    tenantUrl("https://llm.example.com/v1");
    postSpy
      .mockResolvedValueOnce({ data: { data: [{ embedding: [0.1] }] } })
      .mockRejectedValueOnce(new Error("stop here"));
    jest.spyOn(ai as unknown as { retrieveContext(): Promise<unknown[]> }, "retrieveContext").mockResolvedValue([]);
    await ai.queryDocuments("t1", "question");
    expect(postSpy).toHaveBeenLastCalledWith(
      "https://llm.example.com/v1/chat/completions",
      expect.anything(),
      expect.objectContaining({ maxRedirects: 0 }),
    );
  });
});

describe("storage/s3.driver — a tenant endpoint connects through the pinned lookup (A-176)", () => {
  interface HandlerOptions {
    httpsAgent: { options: { lookup: unknown } };
    httpAgent: { options: { lookup: unknown } };
  }
  const lastConfig = (): Record<string, unknown> =>
    (mockS3ClientCtor.mock.calls.at(-1) as [Record<string, unknown>])[0];

  it("a tenant endpoint gets the SSRF-safe agents", () => {
    new S3Driver({ bucket: "b", endpoint: "https://minio.tenant.example" });
    const handler = lastConfig()["requestHandler"] as HandlerOptions;
    expect(handler.httpsAgent.options.lookup).toBe(ssrfSafeLookup);
    expect(handler.httpAgent.options.lookup).toBe(ssrfSafeLookup);
  });

  it("the operator's trusted endpoint keeps the SDK's own handler", () => {
    new S3Driver({ bucket: "b", endpoint: "http://minio:9000", endpointTrusted: true });
    expect(lastConfig()["requestHandler"]).toBeUndefined();
  });
});
