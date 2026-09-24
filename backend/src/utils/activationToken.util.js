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
 */
const crypto = require("crypto");

/**
 * @param {string} email
 * @returns {string} hex SHA-256 of the normalised address
 */
const activationEmailHash = (email) =>
  crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");

/**
 * The claims of an activation token for this account and address.
 *
 * @param {string} userId
 * @param {string} email - the address the link is being mailed to
 * @returns {{id: string, eh: string}}
 */
const activationClaims = (userId, email) => ({ id: userId, eh: activationEmailHash(email) });

module.exports = { activationEmailHash, activationClaims };
