const crypto = require("crypto");
const zlib = require("zlib");
const { Users, Role } = require("../models");
const { hashPassword } = require("../utils/password.util");
const { ROLE_IDS } = require("../constants");
const { AppError } = require("../utils/appError.util");
const { logger } = require("../middlewares/activityLog.middleware");

/**
 * Generate SAML 2.0 AuthnRequest redirect URL
 */
exports.generateAuthnRequest = (tenantCode, ssoSettings) => {
  const id = "_" + crypto.randomBytes(16).toString("hex");
  const issueInstant = new Date().toISOString();
  const destination = ssoSettings.sso_idp_entry_point;
  const assertionConsumerServiceURL =
    ssoSettings.sso_sp_callback_url ||
    `http://localhost:5000/api/v1/auth/sso/callback/${tenantCode}`;
  const spEntityId =
    ssoSettings.sso_sp_entity_id ||
    `http://localhost:5000/api/v1/auth/sso/metadata/${tenantCode}`;

  const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${id}" Version="2.0" IssueInstant="${issueInstant}" Destination="${destination}" AssertionConsumerServiceURL="${assertionConsumerServiceURL}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${spEntityId}</saml:Issuer></samlp:AuthnRequest>`;

  const compressed = zlib.deflateRawSync(Buffer.from(xml));
  const samlRequest = compressed.toString("base64");

  return `${destination}?SAMLRequest=${encodeURIComponent(samlRequest)}&RelayState=${encodeURIComponent(tenantCode)}`;
};

/**
 * Helper to extract tag content
 */
function getTagContent(xml, tagName) {
  const regex = new RegExp(
    `<[^>]*?${tagName}[^>]*?>([^<]+)</[^>]*?${tagName}>`,
    "i",
  );
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Helper to extract attribute values
 */
function getAttributeValue(xml, attributeNames) {
  for (const name of attributeNames) {
    const regex = new RegExp(
      `<[^>]*?Attribute[^>]*?Name="[^"]*?${name}"[^]*?>[^]*?<[^>]*?AttributeValue[^]*?>([^<]+)</[^>]*?AttributeValue>`,
      "i",
    );
    const match = xml.match(regex);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * Parse and verify SAML Response
 */
exports.parseAndVerifyResponse = async (samlResponseBase64, ssoSettings) => {
  if (!samlResponseBase64) {
    throw new AppError(400, "SAMLResponse parameter is required");
  }

  const xml = Buffer.from(samlResponseBase64, "base64").toString("utf8");

  // Validate conditions (expiry check)
  const conditionsMatch = xml.match(
    /<[^>]*?Conditions[^>]*?NotBefore="([^"]+)"[^]*?NotOnOrAfter="([^"]+)"/i,
  );
  if (conditionsMatch) {
    const notBefore = new Date(conditionsMatch[1]);
    const notOnOrAfter = new Date(conditionsMatch[2]);
    const now = new Date();
    // Allow 5-minute clock skew
    if (
      now.getTime() + 300000 < notBefore.getTime() ||
      now.getTime() - 300000 >= notOnOrAfter.getTime()
    ) {
      throw new AppError(
        401,
        "SAML Assertion conditions not met (expired or not yet valid)",
      );
    }
  }

  // Extract NameID
  let email = getTagContent(xml, "NameID");

  // Fallback to attribute statements if NameID is empty or not an email
  if (!email || !email.includes("@")) {
    email = getAttributeValue(xml, [
      "email",
      "mail",
      "emailaddress",
      "userprincipalname",
    ]);
  }

  if (!email) {
    throw new AppError(
      400,
      "SAML Response does not contain a valid email address attribute",
    );
  }

  const firstName =
    getAttributeValue(xml, [
      "firstname",
      "givenname",
      "displayname",
      "first_name",
    ]) || "SSO";
  const lastName =
    getAttributeValue(xml, ["lastname", "sn", "surname", "last_name"]) ||
    "User";

  // Signature verification (if cert is configured)
  if (ssoSettings.sso_idp_cert) {
    let cert = ssoSettings.sso_idp_cert.trim();
    if (!cert.includes("-----BEGIN CERTIFICATE-----")) {
      cert = `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
    }

    // Extract SignatureValue
    const signatureMatch = xml.match(
      /<[^>]*?SignatureValue[^>]*?>([^<]+)<\/[^>]*?SignatureValue>/i,
    );
    const signedInfoMatch = xml.match(
      /(<[^>]*?SignedInfo[^]*?>[^]*?<\/[^>]*?SignedInfo>)/i,
    );

    if (!signatureMatch || !signedInfoMatch) {
      throw new AppError(401, "SAML Response signature elements are missing");
    }

    const signatureValue = signatureMatch[1].replace(/\s/g, "");
    const signedInfoString = signedInfoMatch[1];

    let verified;
    try {
      // Use SHA-256 only (SHA-1 is deprecated and vulnerable to collision attacks)
      // Per NIST, SHA-1 should not be used for digital signatures after 2012
      const verifier = crypto.createVerify("sha256");
      verifier.update(signedInfoString);
      verified = verifier.verify(cert, signatureValue, "base64");

      // Only fall back to SHA-256 with different cert parsing, NOT SHA-1
      // SHA-1 is cryptographically broken and must not be used
      if (!verified) {
        logger.warn(
          "SAML signature verification failed with SHA-256 (SHA-1 fallback disabled per NIST SP 800-131A)",
          {
            tenantId: ssoSettings?.tenant_id,
          },
        );
      }
    } catch (err) {
      console.error("SSO CRYPTO ERROR:", err);
      logger.error("SAML cryptographic verification failed", {
        error: err.message,
      });
      throw new AppError(
        401,
        "SAML signature verification encountered an error",
      );
    }

    if (!verified) {
      throw new AppError(401, "SAML signature verification failed");
    }
  }

  return {
    email: email.toLowerCase(),
    firstName,
    lastName,
  };
};

/**
 * JIT (Just-In-Time) User Provisioning or retrieval
 */
exports.provisionUser = async (tenantId, { email, firstName, lastName }) => {
  let user = await Users.findOne({
    where: { email, tenantId },
    include: [
      {
        model: Role,
        as: "role",
        attributes: ["id", "name"],
        required: false,
      },
    ],
  });

  if (!user) {
    const transaction = await Users.sequelize.transaction();
    try {
      // Generate clean username from email prefix + random suffix to ensure uniqueness
      const prefix = email
        .split("@")[0]
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 20);
      const username = `${prefix}_${crypto.randomBytes(3).toString("hex")}`;
      const randomPassword = crypto.randomBytes(24).toString("hex");
      const hashedPassword = await hashPassword(randomPassword);

      user = await Users.create(
        {
          tenantId,
          email,
          username,
          firstName,
          lastName,
          password: hashedPassword,
          roleId: ROLE_IDS.USER, // Default to USER
          isEmailVerified: true,
          status: "ACTIVE",
        },
        { transaction },
      );

      await transaction.commit();

      // Fetch newly created user with role
      user = await Users.findByPk(user.id, {
        include: [
          {
            model: Role,
            as: "role",
            attributes: ["id", "name"],
            required: false,
          },
        ],
      });
      logger.info("JIT provisioned user via SSO", {
        userId: user.id,
        email,
        tenantId,
      });
    } catch (err) {
      await transaction.rollback();
      logger.error("JIT User Provisioning failed", { error: err.message });
      throw new AppError(500, "Failed to provision user context");
    }
  }

  if (user.status !== "ACTIVE") {
    throw new AppError(403, "Account is suspended");
  }

  return user;
};

const axios = require("axios");
const jwt = require("jsonwebtoken");

/**
 * Generate OIDC Auth Request URL (Specifically tailored for Entra ID, though generic OIDC is similar)
 */
exports.generateOidcAuthRequest = (tenantCode, ssoSettings) => {
  const clientId = ssoSettings.oidc_client_id;
  const redirectUri =
    ssoSettings.oidc_redirect_uri ||
    `http://localhost:5000/api/v1/auth/sso/oidc/callback/${tenantCode}`;
  const authority =
    ssoSettings.oidc_authority ||
    "https://login.microsoftonline.com/common/oauth2/v2.0";

  const state = crypto.randomBytes(16).toString("hex") + "_" + tenantCode;

  const authUrl = new URL(`${authority}/authorize`);
  authUrl.searchParams.append("client_id", clientId);
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("redirect_uri", redirectUri);
  authUrl.searchParams.append("response_mode", "query");
  authUrl.searchParams.append("scope", "openid profile email");
  authUrl.searchParams.append("state", state);

  return authUrl.toString();
};

/**
 * Verify OIDC callback (exchange code for tokens and verify id_token).
 *
 * SECURITY: Delegates to services/oidcJwks.js, which fetches the IdP's JWKS and
 * cryptographically verifies the id_token signature (algorithm allowlist +
 * iss/aud/exp validation). This replaces the previous insecure path that trusted
 * the token via jwt.decode() without any signature verification — which allowed a
 * forged/unsigned id_token to authenticate an arbitrary user.
 *
 * NOTE: JWKS verification enforces the `iss` claim. For a multi-tenant Entra ID
 * `common` authority the id_token `iss` is tenant-specific, so configure the
 * per-tenant `oidc_authority` to the tenant-specific issuer if strict validation
 * rejects tokens.
 */
exports.verifyOidcCallback = async (code, ssoSettings, redirectUri) => {
  const oidcJwks = require("./oidcJwks");
  return oidcJwks.verifyOidcCallback(code, ssoSettings, redirectUri);
};
