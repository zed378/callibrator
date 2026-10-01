/**
 * P9-19 — rbac()'s bar is the LOWEST level among the listed roles.
 *
 * rbac.middleware documents that listing SUPER_ADMIN beside a lower role does
 * not raise the bar to 10: with `allowHigher` (the default) a user at or above
 * the lowest listed role's level passes. The existing rbac suite lists one role
 * per gate, so while converting the middleware a planted `Math.max` in place
 * of `Math.min` passed every suite. These cases pin the rule.
 */
import type { NextFunction, Request, Response } from "express";
import { ROLE_NAMES } from "../../constants";
import { rbac } from "../../middlewares/rbac.middleware";

/** rbac never writes a response; it reports through `next`. */
const unusedResponse: object = {};

/** Runs a gate for a principal with the given role and level; returns what reached `next`. */
const decide = (roles: string[], name: string, roleLevel: number): unknown[] => {
  const calls: unknown[][] = [];
  const next: NextFunction = (...args: unknown[]) => {
    calls.push(args);
  };
  const req = { user: { id: "u", role: { name, roleLevel } } } as unknown as Request;
  void rbac(roles)(req, unusedResponse as Response, next);
  expect(calls).toHaveLength(1);
  return calls[0] ?? [];
};

describe("rbac — the bar is the lowest listed level (P9-19)", () => {
  it("a level-8 admin passes a gate listing SUPERADMIN and TENANT_ADMIN (bar 8, not 10)", () => {
    expect(decide([ROLE_NAMES.SUPER_ADMIN, ROLE_NAMES.TENANT_ADMIN], ROLE_NAMES.CALIBRATOR_ADMIN, 8)).toEqual([]);
  });

  it("a level-5 technician passes a gate listing SUPERVISOR and TECHNICIAN (bar 5, not 6)", () => {
    expect(decide([ROLE_NAMES.SUPERVISOR, ROLE_NAMES.TECHNICIAN], ROLE_NAMES.HEALTHCARE_TECHNICIAN, 5)).toEqual([]);
  });

  it("a level-4 user below every listed level is still refused with 403", () => {
    expect(decide([ROLE_NAMES.SUPERVISOR, ROLE_NAMES.TECHNICIAN], ROLE_NAMES.WAREHOUSE_STAFF, 4)).toEqual([
      expect.objectContaining({ status: 403 }),
    ]);
  });
});
