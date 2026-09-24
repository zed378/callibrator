/**
 * The closed set of `audit_logs.action` values — the ENUM declared in
 * models/auditLog.model.js. Writing any other value is rejected by PostgreSQL
 * and, inside a transaction, rolls the whole mutation back.
 *
 * Operations with no member of their own (restore, revoke, submit, purge) are
 * recorded under the nearest action with `changes.operation` naming them.
 *
 * Kept in its own module (not only in constants/index.js) so that test files
 * that mock the constants barrel cannot empty it. A test asserts it equals the
 * model ENUM (tests/services/auditLedger.fixture.test.js).
 */
const AUDIT_ACTIONS = Object.freeze([
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "APPROVE",
  "EXPORT",
  // A-126 (ADR-051 Q-15) — appended, in this order, by migration
  // 0049-audit-actions-lockout-signature. Recorded as themselves, never as an
  // UPDATE, so every query that looks for them finds them.
  "ACCOUNT_LOCKED", // a brute-force lockout engaged on an account
  "SIGNATURE_AUTH_FAILED", // a wrong password / MFA code at signing (21 CFR 11.300(d))
]);

module.exports = { AUDIT_ACTIONS };
