/**
 * Single sign-on: the SAML 2.0 AuthnRequest and Response, just-in-time
 * provisioning, and the OIDC authorization request and callback.
 *
 * P9-12 (ADR-087 Amendment 14): converted from sso.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned.
 * The JavaScript also required `axios` and `jsonwebtoken` mid-file and used
 * neither; those two unused requires are not carried over (loading a module
 * has no other effect, and both are loaded elsewhere).
 */
import { createVerify, randomBytes } from "crypto";
import { deflateRawSync } from "zlib";
import type { Sequelize } from "sequelize";
import models from "../models";
import { hashPassword } from "../utils/password.util";
import { ROLE_IDS } from "../constants";
import { isPlatformOperator } from "../utils/mfaPolicy.util";
import { AppError } from "../utils/appError.util";
import { logger } from "../middlewares/activityLog.middleware";
import auditService from "./audit.service";
import type { ModelInstance } from "../types/models";
import type { TenantId } from "../types/ids";
import { tenantHasClientFacilities } from "./facilityProvisioning";

const { Users, Role } = models;

type UserRow = ModelInstance<"User">;

/** The tenant's SSO settings (TenantSettings keys) these functions read. */
interface SsoSettings {
  tenant_id?: string | null;
  sso_idp_entry_point?: string | null;
  sso_sp_callback_url?: string | null;
  sso_sp_entity_id?: string | null;
  sso_idp_cert?: string | null;
  oidc_client_id?: string | null;
  oidc_redirect_uri?: string | null;
  oidc_authority?: string | null;
  [key: string]: unknown;
}

/** The identity a SAML Response or an OIDC callback yields. */
interface SsoIdentity {
  email: string;
  firstName: string;
  lastName: string;
}

/** `err.message` / `err.stack`, read exactly as the JavaScript did. */
const errorFields = (err: unknown): { message?: unknown; stack?: unknown } => err as { message?: unknown; stack?: unknown };

/**
 * Generate SAML 2.0 AuthnRequest redirect URL
 */
const generateAuthnRequest = (tenantCode: string, ssoSettings: SsoSettings): string => {
  const id = "_" + randomBytes(16).toString("hex");
  const issueInstant = new Date().toISOString();
  const destination = ssoSettings.sso_idp_entry_point;
  const assertionConsumerServiceURL =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
    ssoSettings.sso_sp_callback_url ||
    `http://localhost:5000/api/v1/auth/sso/callback/${tenantCode}`;
  const spEntityId =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
    ssoSettings.sso_sp_entity_id ||
    `http://localhost:5000/api/v1/auth/sso/metadata/${tenantCode}`;

  const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${id}" Version="2.0" IssueInstant="${issueInstant}" Destination="${String(destination)}" AssertionConsumerServiceURL="${assertionConsumerServiceURL}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${spEntityId}</saml:Issuer></samlp:AuthnRequest>`;

  const compressed = deflateRawSync(Buffer.from(xml));
  const samlRequest = compressed.toString("base64");

  return `${String(destination)}?SAMLRequest=${encodeURIComponent(samlRequest)}&RelayState=${encodeURIComponent(tenantCode)}`;
};

/**
 * Helper to extract tag content
 */
function getTagContent(xml: string, tagName: string): string | null {
  const regex = new RegExp(
    `<[^>]*?${tagName}[^>]*?>([^<]+)</[^>]*?${tagName}>`,
    "i",
  );
  const match = xml.match(regex);
  // A match always has its one capture group.
  return match ? (match[1] as string).trim() : null;
}

/**
 * Helper to extract attribute values
 */
function getAttributeValue(xml: string, attributeNames: readonly string[]): string | null {
  for (const name of attributeNames) {
    const regex = new RegExp(
      `<[^>]*?Attribute[^>]*?Name="[^"]*?${name}"[^]*?>[^]*?<[^>]*?AttributeValue[^]*?>([^<]+)</[^>]*?AttributeValue>`,
      "i",
    );
    const match = xml.match(regex);
    if (match) {
      // A match always has its one capture group.
      return (match[1] as string).trim();
    }
  }
  return null;
}

/**
 * Parse and verify SAML Response
 */
// eslint-disable-next-line @typescript-eslint/require-await -- as built: async, so a throw is a rejection
const parseAndVerifyResponse = async (samlResponseBase64: string | null | undefined, ssoSettings: SsoSettings): Promise<SsoIdentity> => {
  if (!samlResponseBase64) {
    throw new AppError(400, "SAMLResponse parameter is required");
  }

  const xml = Buffer.from(samlResponseBase64, "base64").toString("utf8");

  // Validate conditions (expiry check)
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- as built
  const conditionsMatch = xml.match(
    /<[^>]*?Conditions[^>]*?NotBefore="([^"]+)"[^]*?NotOnOrAfter="([^"]+)"/i,
  );
  if (conditionsMatch) {
    // A match always has both capture groups.
    const notBefore = new Date(conditionsMatch[1] as string);
    const notOnOrAfter = new Date(conditionsMatch[2] as string);
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
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
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

  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: `||` */
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
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  // Signature verification (if cert is configured)
  if (ssoSettings.sso_idp_cert) {
    let cert = ssoSettings.sso_idp_cert.trim();
    if (!cert.includes("-----BEGIN CERTIFICATE-----")) {
      cert = `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
    }

    // Extract SignatureValue
    /* eslint-disable @typescript-eslint/prefer-regexp-exec -- as built */
    const signatureMatch = xml.match(
      /<[^>]*?SignatureValue[^>]*?>([^<]+)<\/[^>]*?SignatureValue>/i,
    );
    const signedInfoMatch = xml.match(
      /(<[^>]*?SignedInfo[^]*?>[^]*?<\/[^>]*?SignedInfo>)/i,
    );
    /* eslint-enable @typescript-eslint/prefer-regexp-exec */

    if (!signatureMatch || !signedInfoMatch) {
      throw new AppError(401, "SAML Response signature elements are missing");
    }

    // Each match has its one capture group.
    const signatureValue = (signatureMatch[1] as string).replace(/\s/g, "");
    const signedInfoString = signedInfoMatch[1] as string;

    let verified: boolean;
    try {
      // Use SHA-256 only (SHA-1 is deprecated and vulnerable to collision attacks)
      // Per NIST, SHA-1 should not be used for digital signatures after 2012
      const verifier = createVerify("sha256");
      verifier.update(signedInfoString);
      verified = verifier.verify(cert, signatureValue, "base64");

      // Only fall back to SHA-256 with different cert parsing, NOT SHA-1
      // SHA-1 is cryptographically broken and must not be used
      if (!verified) {
        logger.warn(
          "SAML signature verification failed with SHA-256 (SHA-1 fallback disabled per NIST SP 800-131A)",
          {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `?.`
            tenantId: ssoSettings?.tenant_id,
          },
        );
      }
    } catch (err) {
      logger.error("SAML cryptographic verification failed", {
        error: errorFields(err).message,
        stack: errorFields(err).stack,
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
/**
 * P6-11 (2026-09-30): just-in-time provisioning creates an account, so it
 * commits with one audit row in its transaction. The actor is the provisioned
 * account itself — the person the identity provider asserted; the LOGIN row
 * that follows (sso.controller#issueSsoTokens) records the sign-in. The row
 * names the account by id only, never its email.
 */
const provisionUser = async (
  tenantId: TenantId,
  { email, firstName, lastName }: SsoIdentity,
  request: { readonly ipAddress?: string | null; readonly userAgent?: string | null } = {},
): Promise<UserRow> => {
  let user = await Users.findOne({
    where: { email, tenantId },
    include: [
      {
        model: Role,
        as: "role",
        // A-210: roleLevel, so a platform operator is recognised below.
        attributes: ["id", "name", "roleLevel"],
        required: false,
      },
    ],
  });

  // A-210: a platform operator (role level 10) never signs in through a
  // tenant's identity provider. A tenant's administrators configure that IdP
  // (PATCH /tenants/settings, the sso_* / oidc_* keys), so honouring it for
  // the super admin whose home is that tenant would let them mint a platform
  // session by asserting the operator's address. Operators sign in with a
  // password and the second factor P6-07 requires.
  if (user && isPlatformOperator(user)) {
    throw new AppError(
      403,
      "Platform operators sign in with a password and a second factor, not through single sign-on",
    );
  }

  if (!user) {
    // The model's own instance: every model is initialised on one.
    const transaction = await (Users.sequelize as Sequelize).transaction();
    try {
      // Generate clean username from email prefix + random suffix to ensure uniqueness
      const prefix = (email
        .split("@")[0] as string)
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 20);
      const username = `${prefix}_${randomBytes(3).toString("hex")}`;
      const randomPassword = randomBytes(24).toString("hex");
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
          // P21-09e (§ 10.6, AM-15): in a multi-facility tenant the account waits for an
          // administrator to bind it or confirm it unbound (refused FACILITY_BINDING_PENDING).
          facilityBindingPending: await tenantHasClientFacilities(tenantId, transaction),
        },
        { transaction },
      );
      await auditService.logAction(
        {
          tenantId,
          userId: user.id,
          action: "CREATE",
          resourceType: "User",
          resourceId: user.id,
          changes: { operation: "SSO_JIT_PROVISION", roleId: ROLE_IDS.USER, isEmailVerified: true },
          ipAddress: request.ipAddress ?? null,
          userAgent: request.userAgent ?? null,
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
        // As built: the row was just created and read back.
        userId: (user as UserRow).id,
        email,
        tenantId,
      });
    } catch (err) {
      await transaction.rollback();
      logger.error("JIT User Provisioning failed", { error: errorFields(err).message });
      throw new AppError(500, "Failed to provision user context");
    }
  }

  // A-70: `status` alone was checked, so a user switched off by `isActive`
  // (the flag auth.middleware reports as "Account banned") signed in: a
  // hand-off code, a session and a LOGIN audit row for a login that should
  // have been refused. Both are checked here, before any of those exist.
  // As built: `user` is the row found, or the one just provisioned and read back.
  const signedIn = user as UserRow;
  if (!signedIn.isActive || signedIn.status !== "ACTIVE") {
    throw new AppError(403, "Account is suspended");
  }

  return signedIn;
};

/** The flow values the caller (sso.controller#beginOidcFlow) stored for the callback. */
interface OidcFlow {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri?: string;
  authorizationEndpoint?: string;
}

/**
 * Generate OIDC Auth Request URL (Specifically tailored for Entra ID, though generic OIDC is similar)
 *
 * A-68: the `state`, `nonce` and PKCE `code_challenge` come from the caller
 * (sso.controller's beginOidcFlow), which stores them for the callback. This
 * function used to invent a `state` it stored nowhere and send no nonce and no
 * challenge.
 *
 * @param tenantCode - the tenant's code
 * @param ssoSettings - the tenant's SSO settings
 * @param flow - state, nonce, code challenge, and optionally the redirect URI and the discovered endpoint
 * @returns the authorization URL
 */
const generateOidcAuthRequest = (tenantCode: string, ssoSettings: SsoSettings, flow: OidcFlow): string => {
  const clientId = ssoSettings.oidc_client_id;
  const redirectUri =
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: `||` */
    flow.redirectUri ||
    ssoSettings.oidc_redirect_uri ||
    `http://localhost:5000/api/v1/auth/sso/oidc/callback/${tenantCode}`;
  const authority =
    ssoSettings.oidc_authority ||
    "https://login.microsoftonline.com/common/oauth2/v2.0";

  const { state, nonce, codeChallenge } = flow;

  // A-188: the discovered authorization_endpoint when the caller has one
  // (sso.controller always does); the derived path otherwise.
  const authUrl = new URL(flow.authorizationEndpoint || `${authority}/authorize`);
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  // As built: an unset client id is sent as "undefined" / "null" (String()).
  authUrl.searchParams.append("client_id", clientId as string);
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("redirect_uri", redirectUri);
  authUrl.searchParams.append("response_mode", "query");
  authUrl.searchParams.append("scope", "openid profile email");
  authUrl.searchParams.append("state", state);
  authUrl.searchParams.append("nonce", nonce);
  authUrl.searchParams.append("code_challenge", codeChallenge);
  authUrl.searchParams.append("code_challenge_method", "S256");

  return authUrl.toString();
};

/** oidcJwks's callback verifier (oidcJwks.js is still JavaScript and is loaded lazily, as before). */
interface OidcJwksModule {
  verifyOidcCallback: (code: unknown, ssoSettings: SsoSettings, redirectUri: unknown, flow: unknown) => Promise<SsoIdentity>;
}

/**
 * Verify OIDC callback (exchange code for tokens and verify id_token).
 *
 * SECURITY: Delegates to services/oidcJwks.js, which fetches the IdP's JWKS and
 * cryptographically verifies the id_token signature (algorithm allowlist +
 * iss/aud/exp validation). This replaces the previous insecure path that trusted
 * the token via jwt.decode() without any signature verification — which allowed a
 * forged/unsigned id_token to authenticate an arbitrary user.
 *
 * A-188: the endpoints, the JWKS location and the issuer the `iss` claim is
 * checked against come from the IdP's discovery document (oidcJwks#discover).
 * A multi-tenant authority (Entra ID's /common) is refused there.
 */
const verifyOidcCallback = async (code: unknown, ssoSettings: SsoSettings, redirectUri: unknown, flow: unknown): Promise<SsoIdentity> => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require of a JavaScript module
  const oidcJwks = require("./oidcJwks") as OidcJwksModule;
  return oidcJwks.verifyOidcCallback(code, ssoSettings, redirectUri, flow);
};

export = {
  generateAuthnRequest,
  parseAndVerifyResponse,
  provisionUser,
  generateOidcAuthRequest,
  verifyOidcCallback,
};
