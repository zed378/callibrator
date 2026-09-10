import { customDomainService } from "./customDomain.service";
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

const BASE = "/api/v1/custom-domains";

describe("customDomainService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("reads the plain array in data (not data.rows)", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ id: "d1", domain: "clinic.example.com" }]),
      );

      const res = await customDomainService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/domains`);
      expect(res).toHaveLength(1);
      expect(res[0].domain).toBe("clinic.example.com");
    });

    it("returns [] when data is empty", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      await expect(customDomainService.getAll()).resolves.toEqual([]);
    });
  });

  describe("create", () => {
    it("posts the domain payload", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "d1" }));

      await customDomainService.create({
        domain: "clinic.example.com",
        type: "custom",
        sslEnabled: true,
      });

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/domains`, {
        domain: "clinic.example.com",
        type: "custom",
        sslEnabled: true,
      });
    });
  });

  describe("verify", () => {
    it("puts the id in the path, with no body", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ verified: true }));

      const res = await customDomainService.verify("d1");

      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/domains/d1/verify`,
      );
      expect(res.verified).toBe(true);
    });
  });

  describe("setAsDefault", () => {
    it("uses POST, not PATCH", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "d1" }));

      await customDomainService.setAsDefault("d1");

      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/domains/d1/default`,
      );
      expect(mockedApi.patch).not.toHaveBeenCalled();
    });
  });

  describe("getStatus", () => {
    it("fetches the status", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ status: "verified" }));

      const res = await customDomainService.getStatus("d1");

      expect(mockedApi.get).toHaveBeenCalledWith(
        `${BASE}/domains/d1/status`,
      );
      expect(res.status).toBe("verified");
    });
  });

  describe("getDnsRecords", () => {
    it("returns the record list", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ type: "CNAME", name: "clinic", value: "app.example.com" }]),
      );

      const res = await customDomainService.getDnsRecords("d1");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/domains/d1/dns`);
      expect(res[0].type).toBe("CNAME");
    });

    it("returns [] when there are no records", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      await expect(customDomainService.getDnsRecords("d1")).resolves.toEqual([]);
    });
  });

  describe("delete", () => {
    it("deletes by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await customDomainService.delete("d1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/domains/d1`);
    });
  });
});
