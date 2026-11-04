/**
 * BUG-02 (the 2026-11 audit) — ONE definition of a live session.
 *
 * The Session model carries two flags for the same fact: `is_revoked` and
 * `is_active`. The read paths picked different ones, so they could disagree:
 *
 *  - the session LIST filtered on `is_revoked = false AND expired_at >= now()`
 *    — it ignored `is_active` entirely;
 *  - `session.service#validateSession` and `ownSessions` filtered on
 *    `is_revoked = false AND is_active = true` — they ignored the expiry,
 *    and checked it afterwards in code;
 *  - `getSessionStatus` read `is_revoked` only, so a session deactivated
 *    without being revoked (the `is_active` flag alone) was reported as
 *    "active" in the UI while the validator refused it.
 *
 * A session that is deactivated but not revoked is the window this closes. It
 * is small, but it is exactly the kind of window a session revocation is
 * supposed to close.
 *
 * This module is the one place the predicate lives. It is a plain function,
 * not a Sequelize scope, for two reasons:
 *
 *  - a scope's `where` is built ONCE, when the model is defined, so a
 *    `new Date()` inside it would freeze the moment the process started and
 *    every later query would compare the expiry against a stale "now";
 *  - a scope is reached as `Model.scope("active")`, and naming a scope
 *    REPLACES the default one (Sequelize 6) — the soft-delete predicate would
 *    have to be named again at every call site, which is exactly the drift
 *    this file exists to stop.
 *
 * The expiry is a PARAMETER, so each caller compares against the clock of the
 * moment it asked.
 */
import { Op } from "sequelize";

/**
 * The flags of a live session: not revoked, not deactivated.
 *
 * A type alias, not an interface: a type alias of an object type gets an
 * implicit index signature, and Sequelize's `WhereOptions` needs one.
 */
/* eslint-disable @typescript-eslint/consistent-type-definitions -- the implicit index signature is the point */
export type LiveSessionFlags = {
  is_revoked: false;
  is_active: true;
};

/** The flags AND the expiry: the whole predicate of a live session. */
export type LiveSessionWhere = LiveSessionFlags & {
  expired_at: { [Op.gt]: Date };
};
/* eslint-enable @typescript-eslint/consistent-type-definitions */

/**
 * The flags of a live session, as a `where` fragment.
 *
 * @returns the flags
 */
export const liveSessionFlags = (): LiveSessionFlags => ({ is_revoked: false, is_active: true });

/**
 * The predicate of a live session, as a `where` fragment — the flags AND the
 * expiry.
 *
 * @param now - the moment the expiry is compared against (the caller's clock)
 * @returns the flags and the expiry bound
 */
export const liveSessionWhere = (now: Date): LiveSessionWhere => ({
  ...liveSessionFlags(),
  expired_at: { [Op.gt]: now },
});

/** A session's flags, as they are read back from a row. */
export interface SessionFlags {
  is_revoked?: boolean | null;
  is_active?: boolean | null;
}

/**
 * A session's status, from the ONE definition of a live session.
 *
 * A session that is deactivated but not revoked reads as "revoked": the
 * flags mean the same thing, and the UI shows one status, not two.
 *
 * @param session - the row's flags and its expiry
 * @returns the status
 */
export const sessionStatus = (
  session: SessionFlags & { expired_at: Date | string },
): "revoked" | "expired" | "active" => {
  if (session.is_revoked === true) {
    return "revoked";
  }
  if (new Date(session.expired_at).getTime() < Date.now()) {
    return "expired";
  }
  // BUG-02: a session that was deactivated but not revoked is not live either.
  // The expiry is read FIRST, so an expired session still reads as expired —
  // the status a user sees has not changed for that case.
  if (session.is_active === false) {
    return "revoked";
  }
  return "active";
};
