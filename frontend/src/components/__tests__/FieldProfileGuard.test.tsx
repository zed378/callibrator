/**
 * P22-10c1 (P19-08 § 11.2, AM-23) — the profile guard in the dashboard's shell: nothing is loaded
 * on a profile without the field flag; with it, the guard runs once the user is known, for that
 * user; a failure is swallowed (the field app runs it again). The flag name is the registry's.
 */
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { useAuthStore } from "@/stores/authStore";
import { PRESENT_FLAG } from "@/field/platform/registryStore";
import { FieldProfileGuard, FIELD_PRESENT_FLAG } from "../FieldProfileGuard";

const run = jest.fn();
jest.mock("@/field/app/profileGuard", () => ({ runFieldProfileGuard: (...args: unknown[]) => run(...args) }));

const signIn = (user: { id: string; tenantId: string } | null) => useAuthStore.setState({ user: user as never });

beforeEach(() => {
  run.mockReset().mockResolvedValue({ purged: 0, othersPending: 0 });
  window.localStorage.clear();
  signIn(null);
});

it("uses the registry's flag name", () => {
  expect(FIELD_PRESENT_FLAG).toBe(PRESENT_FLAG);
});

it("loads nothing without the flag, or before the user is known", async () => {
  signIn({ id: "u1", tenantId: "t1" });
  render(<FieldProfileGuard />);
  window.localStorage.setItem(FIELD_PRESENT_FLAG, "1");
  signIn(null);
  render(<FieldProfileGuard />);
  await new Promise((r) => setTimeout(r, 20));
  expect(run).not.toHaveBeenCalled();
});

it("with the flag, runs the guard for the signed-in user", async () => {
  window.localStorage.setItem(FIELD_PRESENT_FLAG, "1");
  signIn({ id: "u1", tenantId: "t1" });
  render(<FieldProfileGuard />);
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(run.mock.calls[0]?.[1]).toEqual({ id: "u1", tenantId: "t1" });
});

it("swallows a failing guard and a throwing storage", async () => {
  window.localStorage.setItem(FIELD_PRESENT_FLAG, "1");
  run.mockRejectedValue(new Error("blocked"));
  signIn({ id: "u1", tenantId: "t1" });
  render(<FieldProfileGuard />);
  await waitFor(() => expect(run).toHaveBeenCalled());

  run.mockClear();
  const spy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("private");
  });
  signIn({ id: "u2", tenantId: "t1" });
  render(<FieldProfileGuard />);
  await new Promise((r) => setTimeout(r, 20));
  expect(run).not.toHaveBeenCalled();
  spy.mockRestore();
});
