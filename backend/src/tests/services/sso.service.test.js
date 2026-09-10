/**
 * Tests for sso.service.js
 */

const crypto = require("crypto");

jest.mock("../../models", () => ({
  Users: {
    findOne: jest.fn(),
    create: jest.fn(),
    findByPk: jest.fn(),
    sequelize: {
      transaction: jest.fn().mockImplementation(() => ({
        commit: jest.fn(),
        rollback: jest.fn(),
      })),
    },
  },
  Role: {
    findOne: jest.fn(),
  },
}));

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn().mockResolvedValue("hashed-password"),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  return { AppError };
});

const { Users } = require("../../models");
const ssoService = require("../../services/sso.service");

describe("sso.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe("generateAuthnRequest", () => {
    it("should generate a valid SAML AuthnRequest URL", () => {
      const ssoSettings = {
        sso_idp_entry_point: "https://idp.example.com/sso",
        sso_sp_entity_id: "https://sp.example.com/metadata",
        sso_sp_callback_url: "https://sp.example.com/callback",
      };

      const url = ssoService.generateAuthnRequest("tenant-abc", ssoSettings);

      expect(url).toContain("https://idp.example.com/sso");
      expect(url).toContain("SAMLRequest=");
      expect(url).toContain("RelayState=tenant-abc");
    });

    it("should generate URL using default SP settings if not configured", () => {
      const ssoSettings = {
        sso_idp_entry_point: "https://idp.example.com/sso",
      };

      const url = ssoService.generateAuthnRequest("tenant-abc", ssoSettings);

      expect(url).toContain("https://idp.example.com/sso");
      expect(url).toContain("SAMLRequest=");
      expect(url).toContain("RelayState=tenant-abc");
    });
  });

  describe("parseAndVerifyResponse", () => {
    const validResponseXml = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" IssueInstant="2026-06-23T10:00:00Z">
        <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
          <saml:Conditions NotBefore="2026-06-23T00:00:00Z" NotOnOrAfter="2036-06-23T00:00:00Z"/>
          <saml:Subject>
            <saml:NameID>john.doe@hospital.com</saml:NameID>
          </saml:Subject>
          <saml:AttributeStatement>
            <saml:Attribute Name="firstname"><saml:AttributeValue>John</saml:AttributeValue></saml:Attribute>
            <saml:Attribute Name="lastname"><saml:AttributeValue>Doe</saml:AttributeValue></saml:Attribute>
          </saml:AttributeStatement>
        </saml:Assertion>
      </samlp:Response>
    `;

    const validResponseBase64 = Buffer.from(validResponseXml).toString("base64");

    it("should throw error if SAMLResponse is missing", async () => {
      await expect(ssoService.parseAndVerifyResponse("", {})).rejects.toThrow("SAMLResponse parameter is required");
    });

    it("should parse valid SAML Response attributes successfully without signature validation", async () => {
      const result = await ssoService.parseAndVerifyResponse(validResponseBase64, {});

      expect(result.email).toBe("john.doe@hospital.com");
      expect(result.firstName).toBe("John");
      expect(result.lastName).toBe("Doe");
    });

    it("should parse fallback attributes when NameID is missing or invalid", async () => {
      const fallbackXml = `
        <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
          <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
            <saml:AttributeStatement>
              <saml:Attribute Name="email"><saml:AttributeValue>fallback@hospital.com</saml:AttributeValue></saml:Attribute>
            </saml:AttributeStatement>
          </saml:Assertion>
        </samlp:Response>
      `;
      const fallbackBase64 = Buffer.from(fallbackXml).toString("base64");

      const result = await ssoService.parseAndVerifyResponse(fallbackBase64, {});
      expect(result.email).toBe("fallback@hospital.com");
      expect(result.firstName).toBe("SSO");
      expect(result.lastName).toBe("User");
    });

    it("should throw error if no email attribute is found", async () => {
      const invalidXml = "<samlp:Response xmlns:samlp=\"urn:oasis:names:tc:SAML:2.0:protocol\"></samlp:Response>";
      const invalidBase64 = Buffer.from(invalidXml).toString("base64");

      await expect(ssoService.parseAndVerifyResponse(invalidBase64, {})).rejects.toThrow("SAML Response does not contain a valid email address attribute");
    });

    it("should verify signature successfully when cert is provided", async () => {
      const signedXml = `
        <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
          <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
            <saml:Subject><saml:NameID>john.doe@hospital.com</saml:NameID></saml:Subject>
          </saml:Assertion>
          <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
            <SignedInfo>
              <CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
              <SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
            </SignedInfo>
            <SignatureValue>dummy-signature</SignatureValue>
          </Signature>
        </samlp:Response>
      `;
      const signedBase64 = Buffer.from(signedXml).toString("base64");

      const mockVerify = {
        update: jest.fn(),
        verify: jest.fn().mockReturnValue(true),
      };
      jest.spyOn(crypto, "createVerify").mockReturnValue(mockVerify);

      const result = await ssoService.parseAndVerifyResponse(signedBase64, {
        sso_idp_cert: "mock-cert",
      });

      expect(result.email).toBe("john.doe@hospital.com");
      expect(crypto.createVerify).toHaveBeenCalledWith("sha256");
      expect(mockVerify.verify).toHaveBeenCalled();
    });

    it("should throw error if signature elements are missing but cert is provided", async () => {
      await expect(ssoService.parseAndVerifyResponse(validResponseBase64, {
        sso_idp_cert: "mock-cert",
      })).rejects.toThrow("SAML Response signature elements are missing");
    });

    it("should throw error if signature verification fails", async () => {
      const signedXml = `
        <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
          <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
            <saml:Subject><saml:NameID>john.doe@hospital.com</saml:NameID></saml:Subject>
          </saml:Assertion>
          <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
            <SignedInfo></SignedInfo>
            <SignatureValue>dummy-signature</SignatureValue>
          </Signature>
        </samlp:Response>
      `;
      const signedBase64 = Buffer.from(signedXml).toString("base64");

      const mockVerify = {
        update: jest.fn(),
        verify: jest.fn().mockReturnValue(false),
      };
      jest.spyOn(crypto, "createVerify").mockReturnValue(mockVerify);

      await expect(ssoService.parseAndVerifyResponse(signedBase64, {
        sso_idp_cert: "mock-cert",
      })).rejects.toThrow("SAML signature verification failed");
    });

    it("should throw error if signature verification errors out", async () => {
      const signedXml = `
        <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
          <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
            <saml:Subject><saml:NameID>john.doe@hospital.com</saml:NameID></saml:Subject>
          </saml:Assertion>
          <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
            <SignedInfo></SignedInfo>
            <SignatureValue>dummy-signature</SignatureValue>
          </Signature>
        </samlp:Response>
      `;
      const signedBase64 = Buffer.from(signedXml).toString("base64");

      jest.spyOn(crypto, "createVerify").mockImplementation(() => {
        throw new Error("Crypto error");
      });

      await expect(ssoService.parseAndVerifyResponse(signedBase64, {
        sso_idp_cert: "mock-cert",
      })).rejects.toThrow("SAML signature verification encountered an error");
    });

    it("should throw error if conditions (expiry check) fail", async () => {
      const expiredXml = `
        <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
          <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
            <saml:Conditions NotBefore="2010-01-01T00:00:00Z" NotOnOrAfter="2011-01-01T00:00:00Z"/>
            <saml:Subject><saml:NameID>john@hospital.com</saml:NameID></saml:Subject>
          </saml:Assertion>
        </samlp:Response>
      `;
      const expiredBase64 = Buffer.from(expiredXml).toString("base64");

      await expect(ssoService.parseAndVerifyResponse(expiredBase64, {})).rejects.toThrow("SAML Assertion conditions not met");
    });
  });

  describe("provisionUser", () => {
    it("should return the existing user if already present", async () => {
      const mockUser = {
        id: "user-123",
        email: "existing@hospital.com",
        status: "ACTIVE",
      };
      Users.findOne.mockResolvedValueOnce(mockUser);

      const user = await ssoService.provisionUser("tenant-1", {
        email: "existing@hospital.com",
      });

      expect(user).toEqual(mockUser);
      expect(Users.create).not.toHaveBeenCalled();
    });

    it("should throw error if existing user is suspended", async () => {
      const mockUser = {
        id: "user-123",
        email: "suspended@hospital.com",
        status: "SUSPENDED",
      };
      Users.findOne.mockResolvedValueOnce(mockUser);

      await expect(ssoService.provisionUser("tenant-1", {
        email: "suspended@hospital.com",
      })).rejects.toThrow("Account is suspended");
    });

    it("should create and JIT-provision user if they do not exist", async () => {
      Users.findOne.mockResolvedValueOnce(null);
      const mockCreatedUser = {
        id: "user-new",
        email: "new@hospital.com",
        status: "ACTIVE",
      };
      Users.create.mockResolvedValueOnce(mockCreatedUser);
      Users.findByPk.mockResolvedValueOnce(mockCreatedUser);

      const user = await ssoService.provisionUser("tenant-1", {
        email: "new@hospital.com",
        firstName: "New",
        lastName: "User",
      });

      expect(Users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "new@hospital.com",
          tenantId: "tenant-1",
          firstName: "New",
          lastName: "User",
        }),
        expect.any(Object),
      );
      expect(user).toEqual(mockCreatedUser);
    });

    it("should rollback transaction and throw error on creation failure", async () => {
      Users.findOne.mockResolvedValueOnce(null);
      Users.create.mockRejectedValueOnce(new Error("Database error"));

      await expect(ssoService.provisionUser("tenant-1", {
        email: "error@hospital.com",
      })).rejects.toThrow("Failed to provision user context");
    });
  });

  describe("parseAndVerifyResponse cert formatting", () => {
    const signedXml = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
        <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
          <saml:Subject><saml:NameID>john.doe@hospital.com</saml:NameID></saml:Subject>
        </saml:Assertion>
        <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
          <SignedInfo></SignedInfo>
          <SignatureValue>dummy-signature</SignatureValue>
        </Signature>
      </samlp:Response>
    `;
    const signedBase64 = Buffer.from(signedXml).toString("base64");

    it("passes an already-PEM-wrapped cert through without re-wrapping it", async () => {
      const pem =
        "-----BEGIN CERTIFICATE-----\nMIIBpayload\n-----END CERTIFICATE-----";
      const mockVerify = { update: jest.fn(), verify: jest.fn().mockReturnValue(true) };
      jest.spyOn(crypto, "createVerify").mockReturnValue(mockVerify);

      const result = await ssoService.parseAndVerifyResponse(signedBase64, {
        sso_idp_cert: `  ${pem}  `,
      });

      expect(result.email).toBe("john.doe@hospital.com");
      // The already-wrapped cert is trimmed, but not double-wrapped.
      expect(mockVerify.verify).toHaveBeenCalledWith(pem, "dummy-signature", "base64");
    });

    it("wraps a bare base64 cert body in PEM armour", async () => {
      const mockVerify = { update: jest.fn(), verify: jest.fn().mockReturnValue(true) };
      jest.spyOn(crypto, "createVerify").mockReturnValue(mockVerify);

      await ssoService.parseAndVerifyResponse(signedBase64, {
        sso_idp_cert: "MIIBbarecert",
      });

      expect(mockVerify.verify).toHaveBeenCalledWith(
        "-----BEGIN CERTIFICATE-----\nMIIBbarecert\n-----END CERTIFICATE-----",
        "dummy-signature",
        "base64",
      );
    });
  });

  // ================================================================
  // OIDC
  // ================================================================
  describe("generateOidcAuthRequest", () => {
    it("builds an authorize URL from the configured authority and redirect URI", () => {
      const url = new URL(
        ssoService.generateOidcAuthRequest("acme", {
          oidc_client_id: "client-123",
          oidc_authority: "https://login.example.com/tenant/oauth2/v2.0",
          oidc_redirect_uri: "https://app.example.com/callback",
        }),
      );

      expect(url.origin + url.pathname).toBe(
        "https://login.example.com/tenant/oauth2/v2.0/authorize",
      );
      expect(url.searchParams.get("client_id")).toBe("client-123");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "https://app.example.com/callback",
      );
      expect(url.searchParams.get("response_mode")).toBe("query");
      expect(url.searchParams.get("scope")).toBe("openid profile email");
    });

    it("defaults the authority to the Entra ID common endpoint", () => {
      const url = new URL(
        ssoService.generateOidcAuthRequest("acme", { oidc_client_id: "client-123" }),
      );

      expect(url.origin + url.pathname).toBe(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      );
    });

    it("defaults the redirect URI to the per-tenant callback route", () => {
      const url = new URL(
        ssoService.generateOidcAuthRequest("acme", { oidc_client_id: "client-123" }),
      );

      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://localhost:5000/api/v1/auth/sso/oidc/callback/acme",
      );
    });

    it("suffixes the state with the tenant code so the callback can route it", () => {
      const url = new URL(
        ssoService.generateOidcAuthRequest("acme", { oidc_client_id: "client-123" }),
      );
      const state = url.searchParams.get("state");

      expect(state).toMatch(/^[0-9a-f]{32}_acme$/);
    });

    it("generates a fresh state on every call (no replay)", () => {
      const settings = { oidc_client_id: "client-123" };
      const a = new URL(ssoService.generateOidcAuthRequest("acme", settings));
      const b = new URL(ssoService.generateOidcAuthRequest("acme", settings));

      expect(a.searchParams.get("state")).not.toBe(b.searchParams.get("state"));
    });
  });

  describe("verifyOidcCallback", () => {
    it("delegates verification to the JWKS service and returns its result", async () => {
      const oidcJwks = require("../../services/oidcJwks");
      const spy = jest
        .spyOn(oidcJwks, "verifyOidcCallback")
        .mockResolvedValue({ email: "user@example.com", firstName: "A", lastName: "B" });

      const settings = { oidc_client_id: "c1", oidc_client_secret: "s1" };
      const result = await ssoService.verifyOidcCallback(
        "code-1",
        settings,
        "https://app.example.com/callback",
      );

      expect(spy).toHaveBeenCalledWith(
        "code-1",
        settings,
        "https://app.example.com/callback",
      );
      expect(result).toEqual({
        email: "user@example.com",
        firstName: "A",
        lastName: "B",
      });

      spy.mockRestore();
    });

    it("propagates the JWKS service's rejection unchanged", async () => {
      const oidcJwks = require("../../services/oidcJwks");
      const err = Object.assign(new Error("Invalid id_token signature"), { status: 401 });
      const spy = jest.spyOn(oidcJwks, "verifyOidcCallback").mockRejectedValue(err);

      await expect(
        ssoService.verifyOidcCallback("code-1", { oidc_client_id: "c1" }, "https://cb"),
      ).rejects.toMatchObject({ status: 401, message: "Invalid id_token signature" });

      spy.mockRestore();
    });
  });
});
