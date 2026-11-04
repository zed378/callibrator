/**
 * BUG-02 (the 2026-11 audit) — the ONE definition of a live session.
 *
 * The list, the stats, the validator and the own-sessions page all read it, so
 * a session deactivated without being revoked can no longer read "active" in
 * one place and be refused in another.
 */
import { Op } from "sequelize";
import { liveSessionFlags, liveSessionWhere, sessionStatus } from "../../utils/sessionState.util";

const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

describe("sessionState.util — one definition of a live session", () => {
  it("the flags of a live session: not revoked, not deactivated", () => {
    expect(liveSessionFlags()).toEqual({ is_revoked: false, is_active: true });
  });

  it("the predicate adds the expiry, compared against the caller's clock", () => {
    const now = new Date("2026-11-04T00:00:00Z");
    expect(liveSessionWhere(now)).toEqual({ is_revoked: false, is_active: true, expired_at: { [Op.gt]: now } });
  });

  it("a revoked session reads revoked, whether or not it has expired", () => {
    expect(sessionStatus({ is_revoked: true, is_active: false, expired_at: FUTURE })).toBe("revoked");
    expect(sessionStatus({ is_revoked: true, is_active: false, expired_at: PAST })).toBe("revoked");
  });

  it("an expired session reads expired, even when it was also deactivated", () => {
    expect(sessionStatus({ is_revoked: false, is_active: true, expired_at: PAST })).toBe("expired");
    expect(sessionStatus({ is_revoked: false, is_active: false, expired_at: PAST.toISOString() })).toBe("expired");
  });

  it("a session deactivated without being revoked is not live: it reads revoked (the window BUG-02 closes)", () => {
    expect(sessionStatus({ is_revoked: false, is_active: false, expired_at: FUTURE })).toBe("revoked");
  });

  it("a session neither revoked, deactivated nor expired reads active; missing flags read as live", () => {
    expect(sessionStatus({ is_revoked: false, is_active: true, expired_at: FUTURE })).toBe("active");
    expect(sessionStatus({ expired_at: FUTURE })).toBe("active");
  });
});
