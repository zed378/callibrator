/**
 * P24-09a — the imported user's invitation contract (ADR-139 § 3 and Am. 1): the operator's flag,
 * the revoke reasons, the codes, both names or neither, the shared-account rule, the strict schemas.
 */
import {
  UPSTREAM_INVITATIONS_OPEN_FLAG,
  USER_INVITATION_CODES,
  USER_INVITATION_REVOKED_REASONS,
  isSharedAccountName,
  issueUserInvitation,
  issueUserInvitationBody,
  userInvitationIssued,
  userInvitationParams,
  userInvitationState,
} from "@callibrator/contracts/userInvitations";

const USER = "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f";

describe("@callibrator/contracts/userInvitations", () => {
  it("names the operator's flag, the revoke reasons (migration 0144's CHECK) and the codes", () => {
    expect(UPSTREAM_INVITATIONS_OPEN_FLAG).toBe("upstream_invitations_open");
    expect([...USER_INVITATION_REVOKED_REASONS]).toEqual(["reissued", "revoked"]);
    expect(USER_INVITATION_CODES).toEqual({
      notApplicable: "INVITATION_NOT_APPLICABLE",
      gateClosed: "PRE_INVITATION_GATE_OPEN",
      personRequired: "INVITATION_PERSON_REQUIRED",
      none: "INVITATION_NONE",
    });
  });

  it("the issue: both names or neither, trimmed, 1 – 100 characters; no other key", () => {
    expect(issueUserInvitation.parse({ userId: USER })).toEqual({ userId: USER });
    expect(issueUserInvitation.parse({ userId: USER, firstName: " Siti ", lastName: "Rahma" })).toEqual({ userId: USER, firstName: "Siti", lastName: "Rahma" });
    expect(issueUserInvitation.safeParse({ userId: USER, firstName: "Siti" }).success).toBe(false);
    expect(issueUserInvitation.safeParse({ userId: USER, lastName: "Rahma" }).success).toBe(false);
    expect(issueUserInvitation.safeParse({ userId: USER, firstName: " ", lastName: "Rahma" }).success).toBe(false);
    expect(issueUserInvitation.safeParse({ userId: USER, firstName: "x".repeat(101), lastName: "Rahma" }).success).toBe(false);
    expect(issueUserInvitation.safeParse({ userId: "nope" }).success).toBe(false);
    expect(issueUserInvitation.safeParse({ userId: USER, email: "a@b.test" }).success).toBe(false);
    expect(issueUserInvitationBody.safeParse({ userId: USER }).success).toBe(false);
    expect(userInvitationParams.safeParse({ userId: USER }).success).toBe(true);
  });

  it("a shared account: no last name, or a first name that is the username", () => {
    expect(isSharedAccountName({ username: "rs1a", firstName: "rs1a", lastName: "" })).toBe(true);
    expect(isSharedAccountName({ username: "rs1a", firstName: "Klien", lastName: null })).toBe(true);
    expect(isSharedAccountName({ username: "rs1a", firstName: "rs1a", lastName: "Satu" })).toBe(true);
    expect(isSharedAccountName({ username: "rs1a", firstName: "Dewi", lastName: "Lestari" })).toBe(false);
    expect(isSharedAccountName({ username: "rs1a", firstName: null, lastName: "Lestari" })).toBe(false);
  });

  it("the answers are strict: never a token or a hash", () => {
    const issued = { issuedAt: "2026-10-22T00:00:00.000Z", expiresAt: "2026-10-29T00:00:00.000Z", emailQueued: true };
    expect(userInvitationIssued.parse(issued)).toEqual(issued);
    expect(userInvitationIssued.safeParse({ ...issued, token: "x" }).success).toBe(false);
    const state = { awaitingInvitation: true, invitationsOpen: false, personRequired: true, live: null, firstIssuedAt: null, acceptedAt: null };
    expect(userInvitationState.parse(state)).toEqual(state);
    expect(userInvitationState.safeParse({ ...state, tokenHash: "a".repeat(64) }).success).toBe(false);
  });
});
