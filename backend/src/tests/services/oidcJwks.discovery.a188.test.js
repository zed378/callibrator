/**
 * A-188 — OIDC provider discovery and the public client, at the service.
 *
 * Before: every endpoint was DERIVED from the configured authority
 * (`${authority}/authorize`, `/token`, `/.well-known/jwks.json`) and the ID
 * token's `iss` had to equal the authority string. Microsoft Entra ID fits
 * none of that. A public client (no secret) sent `client_secret=undefined`.
 *
 * axios is faked here (the discovery document is the input under test); the
 * end-to-end flow against a real in-process IdP in Entra ID's shape is in
 * routes/sso.oidcRoundTrip.a68.test.js.
 */
jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const axios = require("axios");
const { logger } = require("../../middlewares/activityLog.middleware");
const oidcJwks = require("../../services/oidcJwks");

const TENANT = "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47";
const METADATA = Object.freeze({
  issuer: `${TENANT}/v2.0`,
  authorization_endpoint: `${TENANT}/oauth2/v2.0/authorize`,
  token_endpoint: `${TENANT}/oauth2/v2.0/token`,
  jwks_uri: "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/discovery/v2.0/keys",
});
const FLOW = Object.freeze({ nonce: "n-1", codeVerifier: "v-1" });

const httpError = (status) => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, data: {} },
});

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockReset();
  axios.post.mockReset();
  oidcJwks.clearCache();
});

describe("A-188: discover()", () => {
  it("reads the provider metadata at <authority>/.well-known/openid-configuration", async () => {
    axios.get.mockResolvedValueOnce({ data: METADATA });

    const provider = await oidcJwks.discover({ oidc_authority: `${TENANT}/v2.0/` });

    expect(axios.get).toHaveBeenCalledWith(
      `${TENANT}/v2.0/.well-known/openid-configuration`,
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(provider).toEqual({
      issuer: METADATA.issuer,
      authorizationEndpoint: METADATA.authorization_endpoint,
      tokenEndpoint: METADATA.token_endpoint,
      jwksUri: METADATA.jwks_uri,
      discovered: true,
    });
  });

  it("reads an Entra authority written as its /oauth2/v2.0 endpoint base from the /v2.0 issuer base", async () => {
    axios.get.mockResolvedValueOnce({ data: METADATA });

    await oidcJwks.discover({ oidc_authority: `${TENANT}/oauth2/v2.0` });

    expect(axios.get.mock.calls[0][0]).toBe(`${TENANT}/v2.0/.well-known/openid-configuration`);
  });

  it("caches the answer: a second sign-in does not fetch it again, clearCache() does", async () => {
    axios.get.mockResolvedValue({ data: METADATA });
    const settings = { oidc_authority: `${TENANT}/v2.0` };

    await oidcJwks.discover(settings);
    await oidcJwks.discover(settings);
    expect(axios.get).toHaveBeenCalledTimes(1);

    oidcJwks.clearCache();
    await oidcJwks.discover(settings);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it("refuses a missing authority with 400 — the old silent default was Entra's multi-tenant /common", async () => {
    await expect(oidcJwks.discover({})).rejects.toMatchObject({
      status: 400,
      message: "OIDC authority is not configured for this tenant",
    });
    await expect(oidcJwks.discover({ oidc_authority: "   " })).rejects.toMatchObject({ status: 400 });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("refuses a multi-tenant issuer ({tenantid} placeholder) with 400", async () => {
    axios.get.mockResolvedValueOnce({
      data: { ...METADATA, issuer: "https://login.microsoftonline.com/{tenantid}/v2.0" },
    });

    await expect(
      oidcJwks.discover({ oidc_authority: "https://login.microsoftonline.com/common/v2.0" }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/multi-tenant/) });
  });

  it("an IdP with no discovery document (404) gets the derived endpoints, logged and cached", async () => {
    axios.get.mockRejectedValueOnce(httpError(404));
    const settings = { oidc_authority: "https://idp.example.com/oauth" };

    const provider = await oidcJwks.discover(settings);
    await oidcJwks.discover(settings);

    expect(provider).toEqual({
      issuer: "https://idp.example.com/oauth",
      authorizationEndpoint: "https://idp.example.com/oauth/authorize",
      tokenEndpoint: "https://idp.example.com/oauth/token",
      jwksUri: "https://idp.example.com/oauth/.well-known/jwks.json",
      discovered: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "OIDC provider publishes no discovery document; deriving its endpoints",
      { authority: "https://idp.example.com/oauth" },
    );
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a server error", httpError(500)],
    ["a network error", new Error("getaddrinfo ENOTFOUND")],
  ])("any other failure (%s) is a 502, never a fallback", async (_label, err) => {
    axios.get.mockRejectedValueOnce(err);

    await expect(oidcJwks.discover({ oidc_authority: TENANT })).rejects.toMatchObject({
      status: 502,
      message: "The identity provider could not be reached",
    });
  });

  it.each([
    ["no body", undefined],
    ["no issuer", { ...METADATA, issuer: undefined }],
    ["an issuer that is not a string", { ...METADATA, issuer: 42 }],
    ["no jwks_uri", { ...METADATA, jwks_uri: undefined }],
    ["an empty token_endpoint", { ...METADATA, token_endpoint: "" }],
    ["a token_endpoint that is not a URL", { ...METADATA, token_endpoint: "not a url" }],
    ["an authorization_endpoint that is not http(s)", { ...METADATA, authorization_endpoint: "javascript:alert(1)" }],
  ])("an incomplete document (%s) is a 502", async (_label, data) => {
    axios.get.mockResolvedValueOnce({ data });

    await expect(oidcJwks.discover({ oidc_authority: TENANT })).rejects.toMatchObject({
      status: 502,
      message: "The identity provider's discovery document is incomplete",
    });
  });
});

describe("A-188: the token request of a public and a confidential client", () => {
  const PROVIDER = {
    issuer: METADATA.issuer,
    authorizationEndpoint: METADATA.authorization_endpoint,
    tokenEndpoint: METADATA.token_endpoint,
    jwksUri: METADATA.jwks_uri,
    discovered: true,
  };

  const tokenBody = async (settings) => {
    jest.spyOn(oidcJwks, "discover").mockResolvedValue(PROVIDER);
    // The request is what is under test; the answer ends the flow at once.
    axios.post.mockResolvedValueOnce({ data: {} });
    await oidcJwks
      .verifyOidcCallback("code-1", { oidc_client_id: "client-1", ...settings }, "https://sp/cb", FLOW)
      .catch(() => undefined);
    expect(axios.post.mock.calls[0][0]).toBe(PROVIDER.tokenEndpoint);
    return new URLSearchParams(axios.post.mock.calls[0][1]);
  };

  it.each([
    ["absent", {}],
    ["empty", { oidc_client_secret: "" }],
    ["null", { oidc_client_secret: null }],
  ])("with the secret %s, the request carries no client_secret at all", async (_label, settings) => {
    const body = await tokenBody(settings);

    expect(body.has("client_secret")).toBe(false);
    expect(body.toString()).not.toContain("undefined");
    expect(body.get("code_verifier")).toBe(FLOW.codeVerifier);
  });

  it("with a secret, the request carries it", async () => {
    const body = await tokenBody({ oidc_client_secret: "s3cret" });

    expect(body.get("client_secret")).toBe("s3cret");
  });

  it("a discovery failure propagates as its own AppError — no token request is made", async () => {
    await expect(
      oidcJwks.verifyOidcCallback("code-1", { oidc_client_id: "client-1" }, "https://sp/cb", FLOW),
    ).rejects.toMatchObject({ status: 400 });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
