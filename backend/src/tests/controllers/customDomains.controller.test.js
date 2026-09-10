/**
 * Tests for Custom Domains Controller
 */

jest.mock("../../services/customDomains.service", () => ({
  getTenantDomains: jest.fn(),
  addDomain: jest.fn(),
  verifyDomain: jest.fn(),
  removeDomain: jest.fn(),
  getDomainStatus: jest.fn(),
  setDefaultDomain: jest.fn(),
  getDnsRecords: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const customDomainsService = require("../../services/customDomains.service");
const customDomainsController = require("../../controllers/customDomains.controller");
const { success, error } = require("../../utils/response.util");

describe("customDomainsController", () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();

    req = {
      user: { tenantId: "tenant-123" },
      query: {},
      body: {},
      params: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
    };

    success.mockImplementation((response, data, message) => {
      response.json({ success: true, data, message });
    });
    error.mockImplementation((response, message, status) => {
      response.status(status).json({ success: false, message });
    });
  });

  describe("getCustomDomains", () => {
    it("should return custom domains successfully", async () => {
      const mockDomains = [
        { id: "d1", domain: "app.example.com", status: "active" },
        { id: "d2", domain: "custom.io", status: "pending_verification" },
      ];

      customDomainsService.getTenantDomains.mockResolvedValue(mockDomains);

      await customDomainsController.getCustomDomains(req, res);

      expect(customDomainsService.getTenantDomains).toHaveBeenCalledWith(
        "tenant-123",
      );
      expect(success).toHaveBeenCalled();
      const callArgs = success.mock.calls[0];
      expect(callArgs[1]).toEqual(mockDomains);
    });
  });

  describe("addCustomDomain", () => {
    it("should add a custom domain successfully", async () => {
      const mockResult = {
        domain: "app.example.com",
        status: "pending_verification",
        verification: {
          type: "CNAME",
          name: "app.example.com",
          value: "cname.callibrator.io.",
        },
      };

      customDomainsService.addDomain.mockResolvedValue(mockResult);

      req.body = {
        domain: "app.example.com",
        type: "subdomain",
        sslEnabled: true,
      };

      await customDomainsController.addCustomDomain(req, res);

      expect(customDomainsService.addDomain).toHaveBeenCalledWith(
        "tenant-123",
        {
          domain: "app.example.com",
          type: "subdomain",
          sslEnabled: true,
        },
      );
      expect(success).toHaveBeenCalled();
    });

    it("should use defaults when type and sslEnabled are missing", async () => {
      const mockResult = {
        domain: "app.example.com",
        status: "pending_verification",
      };

      customDomainsService.addDomain.mockResolvedValue(mockResult);

      req.body = { domain: "app.example.com" };

      await customDomainsController.addCustomDomain(req, res);

      expect(customDomainsService.addDomain).toHaveBeenCalledWith(
        "tenant-123",
        {
          domain: "app.example.com",
          type: "subdomain",
          sslEnabled: true,
        },
      );
    });
  });

  describe("verifyDomain", () => {
    it("should initiate domain verification", async () => {
      const mockResult = {
        verified: true,
        dnsRecord: {
          type: "TXT",
          name: "_domain_verify.example.com",
          value: "token123",
        },
      };

      customDomainsService.verifyDomain.mockResolvedValue(mockResult);

      req.params = { domainId: "domain-123" };

      await customDomainsController.verifyDomain(req, res);

      expect(customDomainsService.verifyDomain).toHaveBeenCalledWith(
        "tenant-123",
        "domain-123",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("removeCustomDomain", () => {
    it("should remove a custom domain", async () => {
      customDomainsService.removeDomain.mockResolvedValue({ success: true });

      req.params = { domainId: "domain-123" };

      await customDomainsController.removeCustomDomain(req, res);

      expect(customDomainsService.removeDomain).toHaveBeenCalledWith(
        "tenant-123",
        "domain-123",
      );
      expect(success).toHaveBeenCalled();
    });

    it("should handle removal errors", async () => {
      customDomainsService.removeDomain.mockRejectedValue(
        new Error("Domain not found"),
      );

      req.params = { domainId: "non-existent" };

      await customDomainsController.removeCustomDomain(req, res);

      expect(error).toHaveBeenCalled();
    });
  });

  describe("getDomainStatus", () => {
    it("should return domain status", async () => {
      const mockStatus = {
        domain: "app.example.com",
        status: "active",
        sslEnabled: true,
        verifiedAt: "2024-01-01T00:00:00Z",
      };

      customDomainsService.getDomainStatus.mockResolvedValue(mockStatus);

      req.params = { domainId: "domain-123" };

      await customDomainsController.getDomainStatus(req, res);

      expect(customDomainsService.getDomainStatus).toHaveBeenCalledWith(
        "tenant-123",
        "domain-123",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("setDefaultDomain", () => {
    it("should set default domain", async () => {
      const mockResult = {
        domain: "app.example.com",
        isDefault: true,
      };

      customDomainsService.setDefaultDomain.mockResolvedValue(mockResult);

      req.params = { domainId: "domain-123" };

      await customDomainsController.setDefaultDomain(req, res);

      expect(customDomainsService.setDefaultDomain).toHaveBeenCalledWith(
        "tenant-123",
        "domain-123",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getDnsRecords", () => {
    it("should return DNS records", async () => {
      const mockRecords = {
        verification: {
          type: "TXT",
          name: "_domain_verify.example.com",
          value: "verification-token",
        },
        cname: {
          type: "CNAME",
          name: "app.example.com",
          value: "cname.callibrator.io.",
        },
      };

      customDomainsService.getDnsRecords.mockResolvedValue(mockRecords);

      req.params = { domainId: "domain-123" };

      await customDomainsController.getDnsRecords(req, res);

      expect(customDomainsService.getDnsRecords).toHaveBeenCalledWith(
        "tenant-123",
        "domain-123",
      );
      expect(success).toHaveBeenCalled();
    });
  });
});
