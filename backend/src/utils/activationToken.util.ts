/**
 * A-191 — an activation link verifies the ADDRESS it was sent to, and no other.
 *
 * The activation token used to carry only the user id. A link sent to the
 * registration address and never followed therefore still verified the
 * account after its email had been rectified (gdpr.service#rectifyData) to a
 * new, unproven address: whoever held the OLD mailbox verified the NEW one.
 *
 * The token now also carries `eh`, the SHA-256 of the address it was mailed to
 * (trimmed, lower-cased — how every writer stores `users.email`).
 * auth.service#activateAccount refuses a token whose `eh` is absent or is not
 * the account's CURRENT address. The address itself is not in the token: a
 * JWT is readable by anyone who sees the link.
 *
 * P9-09 (ADR-087): converted from activationToken.util.js with no behaviour
 * change.
 */
import { createHash } from "crypto";

/** The claims of an activation token. */
export interface ActivationClaims {
  id: string;
  eh: string;
}

/**
 * @param email - the address; `String()`-ed, as before, so a JavaScript
 *   caller's non-string still hashes the same way
 * @returns hex SHA-256 of the normalised address
 */
export const activationEmailHash = (email: string): string =>
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as-built (ADR-038 rule 3): JavaScript callers may pass a non-string
  createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");

/**
 * The claims of an activation token for this account and address.
 *
 * @param userId
 * @param email - the address the link is being mailed to
 */
export const activationClaims = (userId: string, email: string): ActivationClaims => ({
  id: userId,
  eh: activationEmailHash(email),
});
