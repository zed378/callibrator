/**
 * Q-51 — rowActor: the actor columns of a data row. A key is named in
 * `apiKeyId` alone, never in the users FK; a user in `userId` alone. Exactly
 * one is set, as migration 0105's CHECK requires.
 */
import { auditPrincipal, rowActor } from "../../utils/auditPrincipal.util";

const USER = "a0000000-0000-4000-8000-000000000001";
const KEY = "a0000000-0000-4000-8000-0000000000aa";

describe("rowActor (Q-51)", () => {
  it("a key principal: apiKeyId is the key, userId null — even when a userId is passed (the controller's req.user.id is the KEY's id)", () => {
    const principal = auditPrincipal({ user: { id: KEY, isApiKey: true }, headers: {} });
    expect(rowActor(principal, KEY)).toEqual({ userId: null, apiKeyId: KEY });
    expect(rowActor(principal)).toEqual({ userId: null, apiKeyId: KEY });
  });

  it("a user principal: userId is the user, apiKeyId null", () => {
    const principal = auditPrincipal({ user: { id: USER }, headers: {} });
    expect(rowActor(principal, USER)).toEqual({ userId: USER, apiKeyId: null });
  });

  it("no principal (a service called directly): the passed user id", () => {
    expect(rowActor(undefined, USER)).toEqual({ userId: USER, apiKeyId: null });
    expect(rowActor({}, USER)).toEqual({ userId: USER, apiKeyId: null });
    expect(rowActor(null)).toEqual({ userId: null, apiKeyId: null });
  });

  it("the principal's user wins over the passed id", () => {
    expect(rowActor({ userId: USER, apiKeyId: null }, "other")).toEqual({ userId: USER, apiKeyId: null });
  });
});
