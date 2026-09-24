/**
 * A-124 (ADR-051 Q-13) — who an audit row names as its actor.
 *
 * `audit_logs.actor_type` says WHAT acted:
 *  - `user`    — a person; `user_id` names them (and `impersonator_id` the
 *                super admin behind them, F-8).
 *  - `system`  — a background job; `actor_name` names it, from SYSTEM_ACTORS.
 *  - `unknown` — ONLY rows written before migration 0033, whose actor the
 *                table never recorded (`user_id` NULL and no `changes.actor`).
 *                The migration's CHECK refuses a new one: it is history, not
 *                an option for a caller.
 *
 * Before 0033 `user_id IS NULL` meant three different things — a job, a user
 * since deleted, and an actor simply lost — and nothing on the row said which.
 *
 * SYSTEM_ACTORS is CLOSED. audit.service#logAction refuses a system actor that
 * is not on it, as it refuses an action that is not in AUDIT_ACTIONS: a new job
 * that writes audit rows adds its name here, in review, rather than inventing
 * a string at its call site. There is no system USER row (ADR-051 Q-13): a job
 * is not a principal that could log in, be granted menus or be impersonated.
 *
 * Deliberately absent (ADR-051 Q-13): individual IoT readings and session
 * sweeps are not audited, so neither has a name here.
 *
 * Kept in its own module (like auditActions.js) so a test that mocks the
 * constants barrel cannot empty it. A test asserts the model ENUM equals
 * ACTOR_TYPE_VALUES (tests/constants/systemActors.a124.test.js).
 */
const ACTOR_TYPES = Object.freeze({
  USER: "user",
  SYSTEM: "system",
  UNKNOWN: "unknown",
});

/** The `audit_logs.actor_type` ENUM, in declaration order. */
const ACTOR_TYPE_VALUES = Object.freeze([
  ACTOR_TYPES.USER,
  ACTOR_TYPES.SYSTEM,
  ACTOR_TYPES.UNKNOWN,
]);

/**
 * Every `system:` actor that may appear on an audit row. The `system:` prefix
 * is also enforced by the database (migration 0033's CHECK).
 */
const SYSTEM_ACTORS = Object.freeze({
  /** services/dataRetention.service.js — the scheduled retention purge (W-04). */
  RETENTION_PURGE: "system:retention-purge",
  /** services/tenantLifecycle.service.js — the grace-period offboarding (W-01). */
  TENANT_LIFECYCLE: "system:tenant-lifecycle",
});

const SYSTEM_ACTOR_NAMES = Object.freeze(Object.values(SYSTEM_ACTORS));

/** The longest `actor_name` the column holds (VARCHAR). */
const ACTOR_NAME_MAX_LENGTH = 100;

module.exports = {
  ACTOR_TYPES,
  ACTOR_TYPE_VALUES,
  SYSTEM_ACTORS,
  SYSTEM_ACTOR_NAMES,
  ACTOR_NAME_MAX_LENGTH,
};
