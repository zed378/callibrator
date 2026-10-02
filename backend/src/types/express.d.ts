/**
 * Request fields this application adds to Express's `Request` (P9-05,
 * docs/ENGINEERING/04 § Express request augmentation). Declaration merging,
 * never `req as AuthedRequest`.
 *
 * Seeded with the fields converted modules read or write, each typed as the
 * JavaScript that sets it actually leaves it — a field is optional when the
 * middleware that sets it has not necessarily run. Fields no converted module
 * touches yet (`tenant`, `validated`) are added with the first one that does.
 */
import type { TenantId } from "./ids";

/**
 * The authenticated principal, as far as converted code reads it. The full
 * shape — a Sequelize `User` or an API-key principal (auth.middleware.js) —
 * is typed when the models convert (P9-10); until then only these members.
 */
export interface AuthenticatedPrincipal {
  readonly id?: string | null;
  readonly tenantId?: TenantId | null;
  readonly role?: {
    readonly name?: string | null;
    /** P9-19: read by rbac.middleware (`role_level || roleLevel || 0`): the raw column or the model attribute. */
    readonly roleLevel?: number | null;
    readonly role_level?: number | null;
  } | null;
  /** An API-key principal (auth.middleware.js), read by utils/controllerWrapper.util. */
  readonly isApiKey?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by the request-id middleware in index.js, or by activityLogger. */
      requestId?: string;
      /** Set by auth.middleware.js; absent before it runs. */
      user?: AuthenticatedPrincipal;
      /** Set by auth.middleware.js (honouring the super admin's override); absent before it runs. */
      tenantId?: TenantId | null;
      /**
       * Set by auth.middleware.js from the token's `impersonatorId` claim (a string, else null):
       * the super admin behind an impersonation session (A-82/A-146). Absent before it runs.
       */
      impersonatorId?: string | null;
      /** Set when a gate authorized an API-key principal (dynamicAccess, the SCIM gate — V-05); read by controllerWrapper. */
      apiKeyAuthorized?: boolean;
      /** Set by utils/upload.util: the target folder and the allow-lists multer's fileFilter reads. */
      uploadFolder?: string;
      allowedMimes?: readonly string[] | undefined;
      allowedExtensions?: readonly string[] | undefined;
      /** Set by utils/upload.util's storage: the generated file name. */
      uploadFilename?: string;
      /**
       * Set by middlewares/validation.middleware `validate()`: the parsed, stripped
       * value from the declared source (P9-11). Read it through the middleware's
       * typed `validated(req, schema)`, never by a cast.
       */
      validated?: unknown;
    }
  }
}
