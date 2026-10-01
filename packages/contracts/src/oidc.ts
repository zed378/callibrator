/**
 * OIDC provider client registration.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/oidc.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the oidc routes.
 */
import { z } from "zod";

const oidcClientSchema = z.object({
  name: z.string().min(1),
  redirectUris: z.array(z.url()),
  scopes: z.array(z.string().min(1)).default(["openid", "profile", "email"]),
  grantTypes: z.array(z.string().min(1)).default(["authorization_code"]),
});

export { oidcClientSchema };

// The client-side (input) and handler-side (output) types of each schema.
export type OidcClientInput = z.input<typeof oidcClientSchema>;
export type OidcClientBody = z.output<typeof oidcClientSchema>;
