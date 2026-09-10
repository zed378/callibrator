import { oidcService } from "./oidc.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const envelope = <T,>(data: T) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
});

const BASE = "/api/v1/oidc";

describe("oidcService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("well-known endpoints", () => {
    it("fetches the discovery document", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ issuer: "http://localhost:5000" }),
      );
      const res = await oidcService.getDiscovery();
      expect(mockedApi.get).toHaveBeenCalledWith(
        `${BASE}/.well-known/openid-configuration`,
      );
      expect(res.issuer).toBe("http://localhost:5000");
    });

    it("fetches the JWKS", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ keys: [{ kid: "k1" }] }));
      const res = await oidcService.getJwks();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/.well-known/jwks.json`);
      expect(res.keys).toHaveLength(1);
    });
  });

  describe("clients", () => {
    it("lists clients", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ clientId: "c1", name: "Portal" }]),
      );
      const res = await oidcService.getClients();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/clients`);
      expect(res).toHaveLength(1);
    });

    it("returns [] when the backend sends no clients", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      await expect(oidcService.getClients()).resolves.toEqual([]);
    });

    it("registers a client and surfaces the one-time secret", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ clientId: "c1", clientSecret: "s3cret", name: "Portal" }),
      );
      const res = await oidcService.registerClient({
        name: "Portal",
        redirectUris: ["https://app.example.com/callback"],
      });
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/clients`, {
        name: "Portal",
        redirectUris: ["https://app.example.com/callback"],
      });
      expect(res.clientSecret).toBe("s3cret");
    });

    it("rotates a client secret", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ clientId: "c1", clientSecret: "new-secret" }),
      );
      const res = await oidcService.rotateSecret("c1");
      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/clients/c1/rotate-secret`,
      );
      expect(res.clientSecret).toBe("new-secret");
    });

    it("deletes a client", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope({ deleted: true }));
      const res = await oidcService.deleteClient("c1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/clients/c1`);
      expect(res.deleted).toBe(true);
    });
  });
});
