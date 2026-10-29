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

interface FakeReq {
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  file?: unknown;
  files?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: jest.Mock;
  validated?: unknown;
}

interface FakeRes {
  status: jest.Mock;
  json: jest.Mock;
  locals: Record<string, unknown>;
}

interface CustomDomainsServiceDouble {
  getTenantDomains: jest.Mock;
  addDomain: jest.Mock;
  verifyDomain: jest.Mock;
  removeDomain: jest.Mock;
  getDomainStatus: jest.Mock;
  setDefaultDomain: jest.Mock;
  getDnsRecords: jest.Mock;
}

type ControllerHandler = (req: FakeReq, res: FakeRes) => Promise<void>;

interface CustomDomainsControllerDouble {
  getCustomDomains: ControllerHandler;
  addCustomDomain: ControllerHandler;
  verifyDomain: ControllerHandler;
  removeCustomDomain: ControllerHandler;
  getDomainStatus: ControllerHandler;
  setDefaultDomain: ControllerHandler;
  getDnsRecords: ControllerHandler;
}

interface ResponseUtilDouble {
  success: jest.Mock;
  error: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const customDomainsService = require("../../services/customDomains.service") as CustomDomainsServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const customDomainsController = require("../../controllers/customDomains.controller") as CustomDomainsControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success, error } = require("../../utils/response.util") as ResponseUtilDouble;

// A-186: every write hands the service the request's audit actor.
const ACTOR = { userId: null, tenantId: "tenant-123", ipAddress: null, userAgent: null };

describe("customDomainsController", () => {
  let req: FakeReq;
  let res: FakeRes;

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

    success.mockImplementation((response: FakeRes, data: unknown, message: string) => {
      response.json({ success: true, data, message });
    });
    error.mockImplementation((response: FakeRes, message: string, status: number) => {
      (response.status(status) as FakeRes).json({ success: false, message });
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
      const callArgs = success.mock.calls[0] as unknown[];
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
        undefined,
        ACTOR,
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
        undefined,
        ACTOR,
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
        ACTOR,
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
        ACTOR,
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
        ACTOR,
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
